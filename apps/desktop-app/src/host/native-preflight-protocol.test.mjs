import test from "node:test";
import assert from "node:assert/strict";
import {
  PREFLIGHT_LIMITS,
  validatePreflightRequest,
  validatePreflightDecision,
  createPreflightRequestDecoder,
} from "../native-preflight-protocol.mjs";

const nonce = "a".repeat(64);
const mapping = (id = "root") => ({
  appSessionId: id,
  nativeSessionId: `ses_${id}`,
  workspaceId: "w",
  canonicalPath: "/workspace",
});
const request = () => ({
  version: 1,
  nonce,
  database: "/copy/event-host.sqlite",
  mappings: [mapping()],
});
const decision = () => ({
  version: 1,
  nonce,
  allowed: true,
  reason: null,
  counts: {
    sessions: 1,
    messages: 0,
    pending: 0,
    inbox: 0,
    kv: 0,
    migrations: 48,
  },
  correlations: [
    {
      nativeSessionId: "ses_root",
      appSessionId: "root",
      workspaceId: "w",
      runtimeEpoch: "epoch",
      operationId: "op",
      digest: "b".repeat(64),
    },
  ],
});
const invalid = (fn) => assert.throws(fn, { message: "invalid_preflight" });

test("consumer API returns the same closed values and pinned bounds", () => {
  const r = request();
  const d = decision();
  assert.equal(validatePreflightRequest(r), r);
  assert.equal(validatePreflightDecision(d, nonce), d);
  assert.equal(PREFLIGHT_LIMITS.deadlineMs, 20000);
  assert.equal(PREFLIGHT_LIMITS.requestBytes, 65536);
  assert.equal(PREFLIGHT_LIMITS.responseBytes, 131072);
});

test("request rejects extra authority, malformed IDs, aliases, size and duplicate mappings", () => {
  for (const extra of ["originalpath", "environment", "executable"])
    invalid(() =>
      validatePreflightRequest({ ...request(), [extra]: "secret" }),
    );
  for (const database of ["relative", "/bad\0path", "/" + "가".repeat(2731)])
    invalid(() => validatePreflightRequest({ ...request(), database }));
  for (const nonce of ["A".repeat(64), "a".repeat(63)])
    invalid(() => validatePreflightRequest({ ...request(), nonce }));
  for (const id of ["", "space id", "a".repeat(129)])
    invalid(() =>
      validatePreflightRequest({ ...request(), mappings: [mapping(id)] }),
    );
  invalid(() =>
    validatePreflightRequest({
      ...request(),
      mappings: [mapping(), mapping()],
    }),
  );
  invalid(() =>
    validatePreflightRequest({
      ...request(),
      mappings: [
        mapping(),
        { ...mapping("other"), nativeSessionId: "ses_root" },
      ],
    }),
  );
  invalid(() =>
    validatePreflightRequest({
      ...request(),
      mappings: Array.from({ length: 201 }, (_, i) => mapping(`s${i}`)),
    }),
  );
  invalid(() =>
    validatePreflightRequest({
      ...request(),
      mappings: Array.from({ length: 100 }, (_, i) => ({
        ...mapping(`s${i}`),
        canonicalPath: "/" + "x".repeat(1000),
      })),
    }),
  );
});

test("parent must be an existing distinct app mapping and closed mapping keys are enforced", () => {
  const child = { ...mapping("child"), parentAppSessionId: "root" };
  assert.equal(
    validatePreflightRequest({ ...request(), mappings: [mapping(), child] })
      .mappings[1],
    child,
  );
  for (const parentAppSessionId of ["missing", "child", "", undefined])
    invalid(() =>
      validatePreflightRequest({
        ...request(),
        mappings: [mapping(), { ...child, parentAppSessionId }],
      }),
    );
  invalid(() =>
    validatePreflightRequest({
      ...request(),
      mappings: [{ ...mapping(), parentSessionId: "root" }],
    }),
  );
});

test("decision binds nonce, closed counts/reasons and correlation identities", () => {
  invalid(() => validatePreflightDecision(decision(), "c".repeat(64)));
  for (const patch of [
    { reason: "error" },
    { reason: "pending_inbox" },
    { originalpath: "/private" },
    { allowed: 1 },
  ])
    invalid(() =>
      validatePreflightDecision({ ...decision(), ...patch }, nonce),
    );
  for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER, NaN])
    invalid(() =>
      validatePreflightDecision(
        { ...decision(), counts: { ...decision().counts, sessions: value } },
        nonce,
      ),
    );
  invalid(() =>
    validatePreflightDecision(
      { ...decision(), counts: { ...decision().counts, pending: 1 } },
      nonce,
    ),
  );
  invalid(() =>
    validatePreflightDecision(
      {
        ...decision(),
        correlations: [...decision().correlations, ...decision().correlations],
      },
      nonce,
    ),
  );
  invalid(() =>
    validatePreflightDecision(
      {
        ...decision(),
        correlations: [{ ...decision().correlations[0], metadata: {} }],
      },
      nonce,
    ),
  );
  const deny = {
    ...decision(),
    allowed: false,
    reason: "native_startup_unverified",
    correlations: [],
    counts: {
      sessions: 201,
      messages: 10001,
      pending: 1,
      inbox: 1,
      kv: 1,
      migrations: 49,
    },
  };
  assert.equal(validatePreflightDecision(deny, nonce), deny);
  invalid(() => validatePreflightDecision({ ...deny, reason: null }, nonce));
  invalid(() =>
    validatePreflightDecision(
      { ...deny, correlations: decision().correlations },
      nonce,
    ),
  );
});

test("request frame accepts split UTF-8 with an open pipe; EOF/error/extra bytes cancel once", () => {
  for (const cancellation of ["end", "error", "push"]) {
    const got = [];
    const cancelled = [];
    const decoder = createPreflightRequestDecoder({
      onRequest: (r) => got.push(r),
      onCancel: () => cancelled.push(true),
    });
    const frame = Buffer.from(JSON.stringify(request()) + "\n");
    for (const byte of frame) decoder.push(Buffer.from([byte]));
    assert.deepEqual(got, [request()]);
    assert.equal(cancelled.length, 0);
    if (cancellation === "push") decoder.push(Buffer.from("x"));
    else decoder[cancellation]();
    decoder.end();
    decoder.error();
    assert.equal(cancelled.length, 1);
  }
});

test("malformed, oversized, multi-frame and invalid UTF-8 input never starts inspection", () => {
  for (const frame of [
    Buffer.alloc(65537, 120),
    Buffer.from("{}\n"),
    Buffer.from(JSON.stringify(request()) + "\n{}\n"),
    Buffer.from([0xff, 10]),
  ]) {
    let started = 0;
    let cancelled = 0;
    const decoder = createPreflightRequestDecoder({
      onRequest: () => started++,
      onCancel: () => cancelled++,
    });
    decoder.push(frame);
    decoder.end();
    assert.equal(started, 0);
    assert.equal(cancelled, 1);
  }
});

test("partial-frame parent loss and UTF-8 split boundaries preserve cancellation semantics", () => {
  const r = request();
  r.mappings[0].canonicalPath = "/작업";
  const frame = Buffer.from(JSON.stringify(r) + "\n");
  for (let cut = 1; cut < frame.length; cut++) {
    let received;
    let cancellations = 0;
    const decoder = createPreflightRequestDecoder({
      onRequest: (value) => (received = value),
      onCancel: () => cancellations++,
    });
    decoder.push(frame.subarray(0, cut));
    decoder.push(frame.subarray(cut));
    assert.deepEqual(received, r);
    assert.equal(cancellations, 0);
  }
  for (const chunk of [Buffer.alloc(0), frame.subarray(0, frame.length - 1)]) {
    let starts = 0;
    let cancellations = 0;
    const decoder = createPreflightRequestDecoder({
      onRequest: () => starts++,
      onCancel: () => cancellations++,
    });
    decoder.push(chunk);
    decoder.end();
    decoder.push(frame);
    assert.equal(starts, 0);
    assert.equal(cancellations, 1);
  }
});

test("wire objects reject accessors, hidden fields and inherited serialization hooks", () => {
  const hidden = request();
  Object.defineProperty(hidden, "version", { value: 1, enumerable: false });
  invalid(() => validatePreflightRequest(hidden));
  const accessor = request();
  Object.defineProperty(accessor, "nonce", {
    get() {
      throw new Error("private path");
    },
    enumerable: true,
  });
  invalid(() => validatePreflightRequest(accessor));
  const inherited = Object.assign(
    Object.create({
      toJSON() {
        return {};
      },
    }),
    request(),
  );
  invalid(() => validatePreflightRequest(inherited));
});

const planned = (id = "plan", extra = {}) => ({
  appSessionId: id,
  nativeSessionId: `ses_${id}`,
  workspaceId: "w",
  canonicalPath: "/workspace",
  operationId: "op",
  originalRuntimeEpoch: "epoch",
  digest: "b".repeat(64),
  ...extra,
});
test("provisional sessions are optional, closed, distinct from mappings and bounded", () => {
  const ok = { ...request(), provisional: [planned()] };
  assert.equal(validatePreflightRequest(ok), ok);
  for (const provisional of [
    [],
    "x",
    [planned("root")], // app id collides with a mapping
    [planned("plan", { nativeSessionId: "ses_root" })],
    [planned("a"), planned("a")],
    [planned("plan", { parentAppSessionId: "root" })],
    [planned("plan", { digest: "short" })],
    [planned("plan", { canonicalPath: "relative" })],
    Array.from({ length: 17 }, (_, n) => planned(`p${n}`)),
  ])
    invalid(() => validatePreflightRequest({ ...request(), provisional }));
  // A mapped fork may not name a provisional session as its parent.
  invalid(() =>
    validatePreflightRequest({
      ...request(),
      mappings: [{ ...mapping("fork"), parentAppSessionId: "plan" }],
      provisional: [planned()],
    }),
  );
});

const forkSlot = (extra = {}) => ({
  appSessionId: "fork-plan",
  workspaceId: "w",
  canonicalPath: "/workspace",
  parentAppSessionId: "root",
  parentNativeSessionId: "ses_root",
  ...extra,
});
test("provisional fork children are optional, closed, bound to a mapped parent and bounded", () => {
  const ok = { ...request(), provisionalForks: [forkSlot()] };
  assert.equal(validatePreflightRequest(ok), ok);
  for (const provisionalForks of [
    [],
    "x",
    [forkSlot({ parentAppSessionId: "other" })],
    [forkSlot({ parentNativeSessionId: "ses_other" })],
    [forkSlot({ workspaceId: "other" })],
    [forkSlot({ appSessionId: "root" })], // collides with a mapping
    [forkSlot(), forkSlot()],
    [forkSlot({ nativeSessionId: "ses_fork" })], // child id is unknown
    [forkSlot({ canonicalPath: "relative" })],
    Array.from({ length: 17 }, (_, n) => forkSlot({ appSessionId: `f${n}` })),
  ])
    invalid(() => validatePreflightRequest({ ...request(), provisionalForks }));
});
