import test from "node:test";
import assert from "node:assert/strict";
import { validateEnvelope, validateCancel } from "../workbench-contract.mjs";
import { createWorkbenchService } from "../workbench-service.mjs";

test("v2 closed identity rejects legacy, extra fields, prototypes and malformed cancellation", () => {
  const read = { version: 2, readId: "r", operation: { type: "snapshot" } };
  assert.deepEqual(validateEnvelope(read), read);
  for (const bad of [
    { type: "snapshot" },
    { ...read, sender: "forged" },
    { ...read, operationId: "op" },
    { ...read, readId: "space id" },
    { ...read, expectedRevision: 0 },
    { ...read, operation: Object.create({ type: "snapshot" }) },
    { ...read, operation: { type: "snapshot", extra: {} } },
    {
      version: 2,
      readId: "r",
      operation: {
        type: "operation.lookup",
        runtimeEpoch: "old",
        operationId: "op",
      },
    },
    {
      version: 2,
      runtimeEpoch: "e",
      operationId: "op",
      expectedRevision: -1,
      operation: { type: "workspace.import" },
    },
  ])
    assert.throws(() => validateEnvelope(bad), { appCode: "INVALID_REQUEST" });
  for (const bad of [
    null,
    { version: 1, runtimeEpoch: "e", readId: "r" },
    { version: 2, runtimeEpoch: "e", readId: "r", sender: "x" },
  ])
    assert.throws(() => validateCancel(bad), { appCode: "INVALID_REQUEST" });
});

test("production service rejects direct legacy renderer requests", async () => {
  const service = createWorkbenchService({});
  try {
    assert.equal(
      (await service.handle({ type: "snapshot" }, "sender")).code,
      "INVALID_REQUEST",
    );
  } finally {
    service.close();
  }
});

import { mkdtemp, realpath, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BASELINE_POLICY } from "../workbench-contract.mjs";
import { createHostAdmission } from "./workbench-admission.mjs";
import { redactReceipt } from "./workbench-receipts.mjs";
const tick = () => new Promise((r) => setImmediate(r));
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
async function until(fn) {
  for (let i = 0; i < 300; i++) {
    if (fn()) return;
    await delay(1);
  }
  assert.fail("expected bounded progress");
}

async function hostFixture(t, { deadlineMs = 100, startup } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "p4-host-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "sample.txt"), "synthetic preview");
  const records = new Map();
  let next = 0;
  const info = (id, patch = {}) => ({
    id,
    title: "PRIVATE TITLE",
    location: { directory: root },
    permissions: BASELINE_POLICY,
    ...patch,
  });
  records.set("native-default", info("native-default"));
  const state = {
    calls: [],
    inFlight: 0,
    max: 0,
    hooks: {},
    pick: root,
    permissions: [],
    inbox: [],
    active: {},
    messages: [],
  };
  if (startup) state.hooks.update = startup;
  const method =
    (name, fn) =>
    async (...args) => {
      state.calls.push({ name, args });
      state.inFlight++;
      state.max = Math.max(state.max, state.inFlight);
      try {
        return await (state.hooks[name]
          ? state.hooks[name](...args)
          : fn(...args));
      } finally {
        state.inFlight--;
      }
    };
  const client = {
    session: {
      get: method("get", ({ sessionID }) => {
        if (!records.has(sessionID))
          throw { _tag: "SessionNotFoundError", sessionID };
        return globalThis.structuredClone(records.get(sessionID));
      }),
      update: method("update", ({ sessionID, ...patch }) =>
        Object.assign(records.get(sessionID), patch),
      ),
      create: method("create", ({ title, location, permissions }) => {
        const result = info(`native-${++next}`, {
          title,
          location,
          permissions,
        });
        records.set(result.id, result);
        return globalThis.structuredClone(result);
      }),
      fork: method("fork", ({ sessionID }) => {
        const result = info(`native-${++next}`, { parentID: sessionID });
        records.set(result.id, result);
        return globalThis.structuredClone(result);
      }),
      list: method("sessions", () => ({
        data: [...records.values()],
        cursor: {},
      })),
      remove: method("remove", ({ sessionID }) => records.delete(sessionID)),
      active: method("active", () => state.active),
      inbox: { list: method("inbox", () => state.inbox) },
      prompt: method("prompt", ({ sessionID, text }) => ({
        id: `inbox-${++next}`,
        sessionID,
        type: "user",
        payload: { text },
      })),
      command: method("command", () => undefined),
      interrupt: method("interrupt", () => ({ interrupted: true })),
      switchAgent: method("switchAgent", () => undefined),
      switchModel: method("switchModel", () => undefined),
    },
    message: {
      list: method("messages", () => ({ data: state.messages, cursor: {} })),
    },
    permission: {
      list: method("permissions", () => state.permissions),
      reply: method("reply", () => undefined),
    },
    command: {
      list: method("commands", () => ({ data: [{ name: "review" }] })),
    },
    skill: { list: method("skills", () => ({ data: [] })) },
    mcp: { list: method("mcp", () => ({ data: [] })) },
    agent: {
      list: method("agents", () => ({
        data: [{ id: "build", name: "Build", mode: "primary" }],
      })),
    },
    model: {
      list: method("models", () => ({
        data: [
          { id: "model", providerID: "provider", name: "Model", enabled: true },
        ],
      })),
    },
    provider: {
      list: method("providers", () => ({
        data: [
          {
            id: "provider",
            integrationID: "integration",
            activation: "enabled",
          },
        ],
      })),
    },
    integration: {
      list: method("integrations", () => ({
        data: [
          {
            id: "integration",
            connections: [{ type: "credential", secret: "PRIVATE TOKEN" }],
          },
        ],
      })),
    },
  };
  const runtime = {
    workspace: root,
    snapshot: () => ({ state: "connected" }),
    workbenchContext: () => ({
      client,
      session: records.get("native-default"),
    }),
  };
  const service = createWorkbenchService({
    runtime,
    deadlineMs,
    pickDirectory: method("dialog", () => state.pick),
    confirmTrust: async () => true,
    confirmSessionRemoval: method("confirm", () => true),
  });
  t.after(() => service.close());
  let serial = 0;
  let epoch;
  const read = (operation, readId = `read-${++serial}`, sender = "sender-a") =>
    service.handle(
      { version: 2, ...(epoch && { runtimeEpoch: epoch }), readId, operation },
      sender,
    );
  const mutate = (operation, operationId = `op-${++serial}`, extra = {}) =>
    service.handle(
      { version: 2, runtimeEpoch: epoch, operationId, operation, ...extra },
      "sender-a",
    );
  const lookup = (operationId, target = epoch) =>
    read({ type: "operation.lookup", runtimeEpoch: target, operationId });
  const bootstrap = async () => {
    const result = await read({ type: "snapshot" });
    assert.equal(result.ok, true, JSON.stringify(result));
    epoch = result.value.runtimeEpoch;
    return result.value;
  };
  return {
    root,
    records,
    info,
    state,
    client,
    service,
    read,
    mutate,
    lookup,
    bootstrap,
    get epoch() {
      return epoch;
    },
    set epoch(value) {
      epoch = value;
    },
  };
}

test("actual snapshot SDK call stays quarantined after timeout; expired projection never commits", async (t) => {
  const f = await hostFixture(t);
  const initial = await f.bootstrap();
  const ids = {
    workspaceId: initial.selectedWorkspaceId,
    sessionId: initial.selectedSessionId,
  };
  const pending = deferred();
  let entered = false;
  f.state.hooks.get = () => {
    entered = true;
    return pending.promise;
  };
  const waiting = f.read({ type: "snapshot", ...ids });
  await until(() => entered);
  for (let i = 0; i < 12; i++)
    assert.equal((await f.read({ type: "snapshot" })).code, "READ_BUSY");
  assert.equal((await waiting).code, "READ_TIMEOUT");
  assert.equal(f.state.inFlight, 1);
  assert.equal((await f.read({ type: "snapshot", ...ids })).code, "READ_BUSY");
  const health = await f.lookup("absent");
  assert.equal(health.value.status, "missing");
  pending.resolve({
    ...f.records.get("native-default"),
    title: "EXPIRED TITLE",
  });
  await until(() => f.state.inFlight === 0);
  await tick();
  delete f.state.hooks.get;
  const next = await f.read({ type: "snapshot", ...ids });
  assert.equal(next.ok, true);
  assert.equal(next.value.sessions[0].title, "PRIVATE TITLE");
  assert.equal(f.state.max, 1);
});

test("coalesced subscribers are bounded8 with immutable IDs and sender-owned cancel", async (t) => {
  const f = await hostFixture(t, { deadlineMs: 300 });
  const initial = await f.bootstrap();
  const op = { type: "snapshot", workspaceId: initial.selectedWorkspaceId };
  const pending = deferred();
  let entered = false;
  f.state.hooks.get = () => {
    entered = true;
    return pending.promise;
  };
  const first = f.read(op, "same");
  await until(() => entered);
  const same = f.read(op, "same");
  assert.equal(first, same);
  assert.equal(
    (await f.read({ type: "diagnostics.list" }, "same")).code,
    "INVALID_REQUEST",
  );
  const joined = Array.from({ length: 7 }, (_, i) => f.read(op, `join-${i}`));
  assert.equal((await f.read(op, "overflow")).code, "READ_BUSY");
  assert.equal(
    f.service.cancelRead(
      { version: 2, runtimeEpoch: f.epoch, readId: "same" },
      "sender-b",
    ).value.status,
    "missing",
  );
  assert.equal(
    f.service.cancelRead(
      { version: 2, runtimeEpoch: "retired", readId: "same" },
      "sender-a",
    ).code,
    "STALE_EPOCH",
  );
  assert.equal(
    f.service.cancelRead(
      { version: 2, runtimeEpoch: f.epoch, readId: "same", extra: true },
      "sender-a",
    ).code,
    "INVALID_REQUEST",
  );
  assert.equal(
    f.service.cancelRead(
      { version: 2, runtimeEpoch: f.epoch, readId: "same" },
      "sender-a",
    ).value.status,
    "cancelled",
  );
  assert.equal((await first).code, "CANCELLED");
  assert.equal(f.state.calls.at(-1).args.at(-1).signal.aborted, false);
  pending.resolve(f.records.get("native-default"));
  for (const result of await Promise.all(joined)) assert.equal(result.ok, true);
  assert.equal(f.state.calls.filter((c) => c.name === "get").length, 3); // startup, bootstrap, one coalesced refresh
});

test("last subscriber cancel and sender close retain actual lane until ignored abort settles", async (t) => {
  const f = await hostFixture(t, { deadlineMs: 300 });
  const initial = await f.bootstrap();
  const op = { type: "catalog.list", workspaceId: initial.selectedWorkspaceId };
  const pending = deferred();
  f.state.hooks.commands = () => pending.promise;
  const a = f.read(op, "a");
  await until(() => f.state.inFlight === 1);
  f.service.closeSender("sender-b");
  assert.equal(f.state.calls.at(-1).args.at(-1).signal.aborted, false);
  f.service.closeSender("sender-a");
  assert.equal((await a).code, "CANCELLED");
  assert.equal(f.state.calls.at(-1).args.at(-1).signal.aborted, true);
  assert.equal((await f.read(op, "b")).code, "READ_BUSY");
  assert.equal((await f.lookup("absent")).value.status, "missing");
  pending.resolve({ data: [] });
  await until(() => f.state.inFlight === 0);
  await tick();
  delete f.state.hooks.commands;
  assert.equal((await f.read(op)).ok, true);
});

test("ready is service-owned; one mutation waiter admitted before ready and never dispatches after expiry", async (t) => {
  const pending = deferred();
  const f = await hostFixture(t, {
    deadlineMs: 60,
    startup: () => pending.promise,
  });
  const bootstrap = f.read({ type: "snapshot" }, "bootstrap");
  await until(() => f.state.inFlight === 1);
  // Test the admitted host epoch through the reserved local lookup (not bootstrap mutation authorization).
  // A separate admission-unit probe below covers known epoch admission before ready.
  assert.equal((await bootstrap).code, "READ_TIMEOUT");
  assert.equal(f.state.calls.filter((c) => c.name === "update").length, 1);
  await until(() => f.state.calls.at(-1).args.at(-1).signal.aborted); // startup's independent deadline
  assert.equal(f.state.calls.at(-1).args.at(-1).signal.aborted, true);
  assert.equal((await f.read({ type: "snapshot" })).code, "READ_BUSY");
  pending.resolve();
  await until(() => f.state.inFlight === 0);
  await tick();
  assert.equal(f.state.calls.filter((c) => c.name === "create").length, 0);
});

test("mutation identity, admission1, no late ready dispatch and reserved lookup independent of ready", async (t) => {
  const ready = deferred();
  let dispatches = 0;
  const admission = createHostAdmission({
    ready: () => ready.promise,
    revision: () => 0,
    deadlineMs: 50,
    execute: async () => {
      dispatches++;
      return { ok: true, value: {} };
    },
    projectReceipt: () => {},
  });
  t.after(() => admission.close());
  const request = {
    version: 2,
    runtimeEpoch: admission.epoch,
    operationId: "intent",
    operation: { type: "workspace.import" },
  };
  const waiting = admission.handle(request, "a");
  const duplicate = await admission.handle(request, "a");
  assert.equal(duplicate.value.status, "duplicate");
  assert.equal(duplicate.receipt.admission, "admitted");
  assert.equal(
    (
      await admission.handle(
        { ...request, operation: { type: "workspace.create" } },
        "a",
      )
    ).code,
    "DUPLICATE_CONFLICT",
  );
  assert.equal(
    (await admission.handle({ ...request, operationId: "other" }, "a")).code,
    "BUSY",
  );
  const lookup = await admission.handle(
    {
      version: 2,
      runtimeEpoch: admission.epoch,
      readId: "r",
      operation: {
        type: "operation.lookup",
        runtimeEpoch: admission.epoch,
        operationId: "intent",
      },
    },
    "a",
  );
  assert.equal(lookup.value.receipt.effect, "none");
  assert.equal((await waiting).receipt.effect, "none");
  ready.resolve();
  await tick();
  await tick();
  assert.equal(dispatches, 0);
  assert.equal(
    (await admission.handle(request, "a")).value.status,
    "duplicate",
  );
});

test("late native create finalizes SAME host registry and evidence receipt; no duplicate replay", async (t) => {
  const f = await hostFixture(t, { deadlineMs: 70 });
  const initial = await f.bootstrap();
  const pending = deferred();
  f.state.hooks.create = () => pending.promise;
  const op = {
    type: "session.create",
    workspaceId: initial.selectedWorkspaceId,
    title: "SECRET NEW TITLE",
  };
  const waiting = f.mutate(op, "create-late");
  await until(() => f.state.calls.some((c) => c.name === "create"));
  assert.equal((await waiting).code, "UNKNOWN_OUTCOME");
  assert.equal((await f.mutate(op, "create-late")).value.status, "duplicate");
  assert.equal((await f.mutate(op, "second-create")).code, "BUSY");
  assert.equal(f.state.inFlight, 1);
  const result = f.info("late-native", { title: op.title });
  f.records.set(result.id, result);
  pending.resolve(result);
  await until(
    () => f.state.calls.filter((c) => c.name === "update").length >= 2,
  );
  await delay(10);
  const found = await f.lookup("create-late");
  assert.equal(found.value.receipt.result.kind, "created");
  assert.equal(found.value.receipt.result.nativeSessionId, "late-native");
  assert.equal(found.value.receipt.effect, "confirmed");
  assert.equal(JSON.stringify(found).includes(op.title), false);
  assert.equal(JSON.stringify(found).includes(f.root), false);
  const fresh = await f.read({ type: "snapshot" });
  assert.equal(fresh.value.sessions.length, 2);
  assert.equal(f.state.calls.filter((c) => c.name === "create").length, 1);
});

test("all mutation types are pre-effect deduplicated, receipts closed and first normal DTO separate", async (t) => {
  const f = await hostFixture(t, { deadlineMs: 1000 });
  let snapshot = await f.bootstrap();
  const ids = {
    workspaceId: snapshot.selectedWorkspaceId,
    sessionId: snapshot.selectedSessionId,
  };
  const imported = join(f.root, "imported");
  await mkdir(imported);
  f.state.pick = imported;
  let ordinal = 0;
  const exercise = async (op) => {
    const id = `all-${++ordinal}`;
    const first = await f.mutate(op, id);
    const count = f.state.calls.length;
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.ok(first.receipt);
    assert.ok(first.value);
    const second = await f.mutate(op, id);
    assert.deepEqual(second.value, { status: "duplicate" });
    assert.equal(f.state.calls.length, count);
    assert.deepEqual(second.receipt, first.receipt);
    assert.equal(
      (
        await f.mutate(
          {
            ...op,
            ...(op.title !== undefined
              ? { title: "CONFLICT" }
              : { extra: "invalid" }),
          },
          id,
        )
      ).ok,
      false,
    );
    const lookup = await f.lookup(id);
    assert.deepEqual(lookup.value.receipt, first.receipt);
    for (const secret of [
      "PRIVATE TITLE",
      "SECRET PROMPT",
      "SECRET ARGUMENT",
      f.root,
      "PRIVATE TOKEN",
    ])
      assert.equal(JSON.stringify(lookup).includes(secret), false);
    return first;
  };
  await exercise({
    type: "session.rename",
    ...ids,
    requestId: "native-rename",
    title: "PRIVATE TITLE",
  });
  await exercise({
    type: "session.pin",
    ...ids,
    requestId: "native-pin",
    pinned: true,
  });
  await exercise({
    type: "session.archive",
    ...ids,
    requestId: "native-archive",
    archived: true,
  });
  await f.mutate(
    {
      type: "session.archive",
      ...ids,
      requestId: "native-restore",
      archived: false,
    },
    "restore",
  );
  await exercise({ type: "session.fork", ...ids, requestId: "native-fork" });
  const send = await exercise({
    type: "message.send",
    ...ids,
    requestId: "native-send",
    text: "SECRET PROMPT",
  });
  assert.equal(send.receipt.result.kind, "delivery");
  assert.ok(send.receipt.result.nativeInboxId);
  assert.equal(send.receipt.effect, "pending");
  await exercise({ type: "session.interrupt", ...ids });
  f.records.get("native-default").time = { idle: Date.now() + 1000 };
  await f.read({ type: "snapshot", ...ids });
  await exercise({
    type: "command.run",
    ...ids,
    requestId: "native-command",
    name: "review",
    arguments: "SECRET ARGUMENT",
  });
  f.state.permissions = [
    { id: "permission-native", sessionID: "native-default" },
  ];
  await exercise({
    type: "permission.respond",
    ...ids,
    requestId: "permission-native",
    decision: "once",
  });
  const importedResult = await exercise({ type: "workspace.import" });
  const importedId = importedResult.value.selectedWorkspaceId;
  const created = await exercise({
    type: "session.create",
    workspaceId: importedId,
    title: "PRIVATE TITLE",
  });
  const childId = created.value.selectedSessionId;
  await exercise({
    type: "session.remove",
    workspaceId: importedId,
    sessionId: childId,
    requestId: "native-remove",
  });
  await exercise({ type: "workspace.remove", workspaceId: importedId });
  f.state.pick = f.root;
  const folder = await exercise({
    type: "workspace.create",
    name: "created-folder",
  });
  assert.equal(folder.receipt.result.kind, "created");
});

test("receipt cap2048 keeps rejected identities; missing and old epoch never imply no effect", async (t) => {
  const f = await hostFixture(t, { deadlineMs: 1000 });
  await f.bootstrap();
  for (let i = 0; i < 2048; i++)
    assert.equal(
      (
        await f.mutate(
          { type: "workspace.remove", workspaceId: "missing" },
          `cap-${i}`,
        )
      ).code,
      "NOT_FOUND",
    );
  assert.equal(
    (await f.mutate({ type: "workspace.import" }, "overflow")).code,
    "LIMIT_REACHED",
  );
  assert.equal(
    (
      await f.mutate(
        { type: "workspace.remove", workspaceId: "missing" },
        "cap-0",
      )
    ).value.status,
    "duplicate",
  );
  assert.equal((await f.lookup("cap-0")).value.receipt.effect, "none");
  assert.deepEqual((await f.lookup("absent")).value, {
    status: "missing",
    runtimeEpoch: f.epoch,
    operationId: "absent",
    effect: "unknown",
  });
  assert.deepEqual((await f.lookup("cap-0", "old-epoch")).value, {
    status: "wrong_epoch",
    runtimeEpoch: "old-epoch",
    operationId: "cap-0",
    effect: "unknown",
  });
});

test("redactor never retains raw DTO, private digest or nested payload", () => {
  const record = {
    runtimeEpoch: "e",
    operationId: "o",
    type: "message.send",
    admission: "dispatched",
    delivery: "accepted",
    effect: "pending",
    revision: 1,
    digest: "PRIVATE",
    text: "PRIVATE",
    evidence: [{ kind: "inbox", id: "native", payload: "PRIVATE" }],
    result: {
      kind: "delivery",
      status: "accepted",
      nativeInboxId: "native",
      snapshot: { text: "PRIVATE" },
      path: "PRIVATE",
    },
  };
  assert.equal(
    JSON.stringify(redactReceipt(record)).includes("PRIVATE"),
    false,
  );
});

test("shared startup/mutation lane and read classes bound actual SDK4 without fanout or queue; lookup8 reserved", async (t) => {
  const pending = deferred();
  const ready = Promise.resolve();
  let calls = 0;
  let inFlight = 0;
  let max = 0;
  let admission;
  const sdk = async () => {
    calls++;
    inFlight++;
    max = Math.max(max, inFlight);
    try {
      return await pending.promise;
    } finally {
      inFlight--;
    }
  };
  admission = createHostAdmission({
    ready: () => ready,
    revision: () => 0,
    deadlineMs: 150,
    execute: async (operation) => {
      await admission.sdk(sdk, []);
      return { ok: true, value: operation.type };
    },
    projectReceipt: () => {},
  });
  t.after(() => admission.close());
  const epoch = admission.epoch;
  const request = (type, readId) => ({
    version: 2,
    runtimeEpoch: epoch,
    readId,
    operation: {
      type,
      ...(type === "catalog.list" || type === "file.list"
        ? { workspaceId: "w" }
        : {}),
    },
  });
  const startup = admission.startup(() => admission.sdk(sdk, []));
  startup.catch(() => {});
  const reads = ["snapshot", "catalog.list", "file.list"].map((type, i) =>
    admission.handle(request(type, `read-${i}`), "a"),
  );
  await until(() => calls === 4);
  assert.equal(max, 4);
  const overflow = await admission.handle(request("snapshot", "other"), "b");
  assert.equal(overflow.code, "READ_BUSY");
  const lookupOp = {
    type: "operation.lookup",
    runtimeEpoch: epoch,
    operationId: "absent",
  };
  const lookupReads = Array.from({ length: 8 }, (_, i) =>
    admission.handle(
      {
        version: 2,
        runtimeEpoch: epoch,
        readId: `lookup-${i}`,
        operation: lookupOp,
      },
      "a",
    ),
  );
  assert.equal(
    (
      await admission.handle(
        {
          version: 2,
          runtimeEpoch: epoch,
          readId: "lookup-overflow",
          operation: lookupOp,
        },
        "a",
      )
    ).code,
    "READ_BUSY",
  );
  for (const result of await Promise.all(lookupReads))
    assert.equal(result.value.status, "missing");
  for (const result of await Promise.all(reads))
    assert.equal(result.code, "READ_TIMEOUT");
  assert.equal(calls, 4);
  assert.equal(inFlight, 4);
  pending.resolve();
  await Promise.allSettled([startup]);
  await tick();
  assert.equal(inFlight, 0);
  const fresh = await admission.handle(request("snapshot", "fresh"), "a");
  assert.equal(fresh.ok, true);
  assert.equal(calls, 5);
});

test("epoch and revision rejection occurs before effects; closed service cannot resurrect native creation", async (t) => {
  const f = await hostFixture(t, { deadlineMs: 500 });
  const initial = await f.bootstrap();
  const op = {
    type: "session.create",
    workspaceId: initial.selectedWorkspaceId,
  };
  const before = f.state.calls.length;
  assert.equal(
    (await f.mutate(op, "wrong-epoch", { runtimeEpoch: "wrong" })).code,
    "STALE_EPOCH",
  );
  assert.equal(
    (
      await f.mutate(op, "wrong-revision", {
        expectedRevision: initial.revision - 1,
      })
    ).code,
    "STALE_REVISION",
  );
  assert.equal(f.state.calls.length, before);
  const pending = deferred();
  f.state.hooks.create = () => pending.promise;
  const waiting = f.mutate(op, "close-create");
  await until(() => f.state.calls.some((c) => c.name === "create"));
  f.service.close();
  assert.equal((await waiting).code, "UNKNOWN_OUTCOME");
  pending.resolve(f.info("closed-native"));
  await until(() => f.state.inFlight === 0);
  await tick();
  assert.equal((await f.read({ type: "snapshot" })).code, "UNAVAILABLE");
  assert.equal(f.state.calls.filter((c) => c.name === "update").length, 1);
});

test("whole catalog deadline stops sequential siblings, without aggregate fanout", async (t) => {
  const f = await hostFixture(t, { deadlineMs: 65 });
  const initial = await f.bootstrap();
  const count = f.state.calls.length;
  for (const name of [
    "commands",
    "skills",
    "mcp",
    "agents",
    "models",
    "providers",
    "integrations",
  ]) {
    f.state.hooks[name] = async () => {
      await delay(24);
      return { data: [] };
    };
  }
  assert.equal(
    (
      await f.read({
        type: "catalog.list",
        workspaceId: initial.selectedWorkspaceId,
      })
    ).code,
    "READ_TIMEOUT",
  );
  await until(() => f.state.inFlight === 0);
  await tick();
  const started = f.state.calls.slice(count).map((call) => call.name);
  assert.deepEqual(started, ["commands", "skills", "mcp"]);
  assert.equal(f.state.max, 1);
});

test("read cancellation detaches from ready and does not abort service-owned startup", async (t) => {
  const startup = deferred();
  const f = await hostFixture(t, {
    deadlineMs: 300,
    startup: () => startup.promise,
  });
  const waiting = f.read({ type: "snapshot" }, "boot");
  await until(() => f.state.inFlight === 1);
  // The transport epoch is intentionally unavailable before bootstrap; sender close is authoritative.
  f.service.closeSender("sender-a");
  assert.equal((await waiting).code, "CANCELLED");
  assert.equal(f.state.calls[0].args.at(-1).signal.aborted, false);
  startup.resolve();
  await until(() => f.state.calls.some((call) => call.name === "get"));
  await delay(5);
  delete f.state.hooks.update;
  const snapshot = await f.bootstrap();
  assert.equal(snapshot.state, "connected");
  assert.equal(
    f.state.calls.filter((call) => call.name === "update").length,
    1,
  );
});

test("late send, fork, rename and permission acknowledgements reconcile only their original operation", async (t) => {
  for (const type of [
    "message.send",
    "session.fork",
    "session.rename",
    "permission.respond",
  ]) {
    await t.test(type, async (t) => {
      const f = await hostFixture(t, { deadlineMs: 60 });
      const initial = await f.bootstrap();
      const target = {
        workspaceId: initial.selectedWorkspaceId,
        sessionId: initial.selectedSessionId,
        requestId: "native-request",
      };
      const pending = deferred();
      let fired = false;
      let operation;
      let result;
      let method;
      if (type === "message.send") {
        method = "prompt";
        operation = { type, ...target, text: "PRIVATE LATE PROMPT" };
        result = {
          id: "late-inbox",
          sessionID: "native-default",
          type: "user",
          payload: { text: operation.text },
        };
      } else if (type === "session.fork") {
        method = "fork";
        operation = { type, ...target };
        result = f.info("late-fork", { parentID: "native-default" });
        f.records.set(result.id, result);
      } else if (type === "session.rename") {
        method = "update";
        operation = { type, ...target, title: "PRIVATE LATE TITLE" };
      } else {
        method = "reply";
        operation = { type, ...target, decision: "once" };
        f.state.permissions = [
          {
            id: target.requestId,
            sessionID: "native-default",
            detail: "PRIVATE PERMISSION DETAIL",
          },
        ];
      }
      f.state.hooks[method] = () => {
        fired = true;
        return pending.promise;
      };
      const response = f.mutate(operation, "late-intent");
      await until(() => fired);
      assert.equal((await response).code, "UNKNOWN_OUTCOME");
      assert.equal(
        (await f.mutate(operation, "late-intent")).value.status,
        "duplicate",
      );
      assert.equal(
        (await f.lookup("late-intent")).value.receipt.effect,
        "unknown",
      );
      if (type === "session.rename")
        f.records.get("native-default").title = operation.title;
      delete f.state.hooks[method];
      pending.resolve(result);
      await until(() => f.state.inFlight === 0);
      await delay(8);
      const found = await f.lookup("late-intent");
      assert.equal(
        found.value.receipt.delivery,
        "accepted",
        JSON.stringify(found),
      );
      assert.equal(
        found.value.receipt.effect,
        type === "message.send" || type === "permission.respond"
          ? "pending"
          : "confirmed",
      );
      assert.equal(JSON.stringify(found).includes("PRIVATE"), false);
      if (type === "message.send")
        assert.equal(found.value.receipt.result.nativeInboxId, "late-inbox");
      if (type === "permission.respond")
        assert.equal(
          found.value.receipt.result.nativeRequestId,
          "native-request",
        );
      const count = f.state.calls.filter((c) => c.name === method).length;
      assert.equal(
        (await f.mutate(operation, "late-intent")).value.status,
        "duplicate",
      );
      assert.equal(
        f.state.calls.filter((c) => c.name === method).length,
        count,
      );
    });
  }
});

test("a late native dialog never starts a new filesystem effect or SDK dispatch", async (t) => {
  const f = await hostFixture(t, { deadlineMs: 60 });
  await f.bootstrap();
  const pending = deferred();
  f.state.hooks.dialog = () => pending.promise;
  const response = f.mutate(
    { type: "workspace.create", name: "never-created" },
    "dialog-expired",
  );
  await until(() => f.state.calls.some((c) => c.name === "dialog"));
  assert.equal((await response).code, "UNKNOWN_OUTCOME");
  assert.equal(
    (await f.mutate({ type: "workspace.import" }, "another-dialog")).code,
    "BUSY",
  );
  pending.resolve(f.root);
  await delay(8);
  const { access } = await import("node:fs/promises");
  await assert.rejects(access(join(f.root, "never-created")), {
    code: "ENOENT",
  });
  assert.equal(
    (await f.lookup("dialog-expired")).value.receipt.effect,
    "unknown",
  );
  assert.equal(f.state.calls.filter((c) => c.name === "dialog").length, 1);
});

test("only exact typed empty-session fork rejection proves none; lookalike remains unknown", async (t) => {
  for (const typed of [true, false]) {
    await t.test(typed ? "exact rejection" : "lookalike", async (t) => {
      const f = await hostFixture(t);
      const initial = await f.bootstrap();
      f.state.hooks.fork = () => {
        throw {
          _tag: typed ? "InvalidRequestError" : "OtherError",
          kind: "empty_session",
          message: "PRIVATE RAW ERROR",
        };
      };
      const operation = {
        type: "session.fork",
        workspaceId: initial.selectedWorkspaceId,
        sessionId: initial.selectedSessionId,
        requestId: "native-fork",
      };
      const result = await f.mutate(operation, "empty");
      assert.equal(result.code, typed ? "EMPTY_SESSION" : "UNKNOWN_OUTCOME");
      assert.equal(result.receipt.effect, typed ? "none" : "unknown");
      const count = f.state.calls.filter((c) => c.name === "fork").length;
      assert.equal(
        (await f.mutate(operation, "empty")).value.status,
        "duplicate",
      );
      assert.equal(
        f.state.calls.filter((c) => c.name === "fork").length,
        count,
      );
      assert.equal(
        JSON.stringify(await f.lookup("empty")).includes("PRIVATE RAW ERROR"),
        false,
      );
    });
  }
});
