import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  permissionGrantDigest,
  permissionSavedRuleDigest,
  permissionPolicyDigest,
  permissionScopeDigest,
  permissionPreviewDigest,
} from "./permission-control-digests.mjs";

const digest = "a".repeat(64);
const otherDigest = "b".repeat(64);
const grant = () => ({
  projectIdentityDigest: digest,
  action: "read",
  resource: "\uFEFF한글\r\n*",
  effect: "allow",
});
const saved = () => ({
  ...grant(),
  savedId: "saved:actual",
  createdAt: 10,
  updatedAt: 20,
});
const policy = () => ({
  compilerVersion: 1,
  floorDigest: digest,
  mode: "custom",
  modeGeneration: 1,
  settings: [{ capabilityId: "read", effect: "ask" }],
  selectedAgentIdentityDigest: digest,
  inventoryDigest: digest,
  rules: [
    { action: "read", resource: "*", effect: "ask" },
    { action: "write", resource: "*", effect: "deny" },
  ],
});
const scope = () => ({
  locations: [],
  sessions: [],
  projectIdentityDigest: digest,
});
const preview = () => ({
  kind: "reply",
  clock: { runtimeEpoch: "epoch:1", revision: 0, observationSequence: 1 },
  scope: { kind: "project", scopeDigest: digest, locations: [], sessions: [] },
  trustRevision: 0,
  rootIdentityDigest: digest,
  nativeIdentityDigest: digest,
  generations: { control: 1, inventory: 1, pending: 1, saved: 1, locations: 1 },
  inventoryDigest: digest,
  previewId: "opaque-preview",
  expiresAt: 100,
  impact: { kind: "reply" },
});

// Independent byte encoder for valid fixtures, never the production serializer.
function expected(domain, value) {
  function encode(item) {
    if (Array.isArray(item)) return `[${item.map(encode).join(",")}]`;
    if (item && typeof item === "object") {
      return `{${Object.keys(item)
        .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
        .map((key) => `${JSON.stringify(key)}:${encode(item[key])}`)
        .join(",")}}`;
    }
    return JSON.stringify(item);
  }
  return createHash("sha256")
    .update(
      Buffer.from(`omoc.permission.${domain}.v1\n${encode(value)}`, "utf8"),
    )
    .digest("hex");
}

const cases = [
  ["grant", permissionGrantDigest, grant],
  ["saved", permissionSavedRuleDigest, saved],
  ["policy", permissionPolicyDigest, policy],
  ["scope", permissionScopeDigest, scope],
  ["preview", permissionPreviewDigest, preview],
];

test("named APIs hash exact domain and UTF-8 bytes", () => {
  assert.equal(
    permissionGrantDigest({ ...grant(), resource: "*" }),
    "ae81130a69b795076b8b2f32b5e77831f47ee5b132df5b76eb89cee5751fda2f",
  );
  for (const [domain, hash, fixture] of cases) {
    const body = fixture();
    assert.equal(hash(body), expected(domain, body));
    assert.equal(
      hash(Object.fromEntries(Object.entries(body).reverse())),
      hash(body),
    );
    assert.throws(() => hash({ ...body, extra: 1 }));
    for (const key of Object.keys(body)) {
      const missing = { ...body };
      delete missing[key];
      assert.throws(() => hash(missing));
      if (key.endsWith("Digest")) {
        assert.throws(() => hash({ ...body, [key]: "invalid" }));
      }
    }
  }
});

test("grant intent differs from actual returned saved identity and timestamps", () => {
  const row = saved();
  assert.notEqual(
    permissionGrantDigest(grant()),
    permissionSavedRuleDigest(row),
  );
  for (const change of [
    { savedId: "saved:dedup" },
    { createdAt: 11 },
    { updatedAt: 21 },
    { projectIdentityDigest: otherDigest },
  ]) {
    assert.notEqual(
      permissionSavedRuleDigest(row),
      permissionSavedRuleDigest({ ...row, ...change }),
    );
  }
  assert.notEqual(
    permissionGrantDigest(grant()),
    permissionGrantDigest({ ...grant(), projectIdentityDigest: otherDigest }),
  );
  assert.throws(() => permissionGrantDigest(row));
});

test("policy binds ordered rules, generation, Agent and inventory without normalization", () => {
  const body = policy();
  for (const change of [
    { rules: [...body.rules].reverse() },
    { modeGeneration: 2 },
    { selectedAgentIdentityDigest: otherDigest },
    { inventoryDigest: otherDigest },
    { floorDigest: otherDigest },
  ]) {
    assert.notEqual(
      permissionPolicyDigest(body),
      permissionPolicyDigest({ ...body, ...change }),
    );
  }
  assert.equal(body.rules[0].action, "read");
  assert.notEqual(
    permissionGrantDigest(grant()),
    permissionGrantDigest({ ...grant(), resource: "한글\n*" }),
  );
});

test("rejects wrong digest, IDs, timestamps, generation and closed nested fields", () => {
  for (const bad of [
    null,
    1,
    "A".repeat(64),
    "a".repeat(63),
    "a".repeat(65),
    "g".repeat(64),
  ]) {
    assert.throws(() =>
      permissionGrantDigest({ ...grant(), projectIdentityDigest: bad }),
    );
    assert.throws(() =>
      permissionPolicyDigest({ ...policy(), inventoryDigest: bad }),
    );
  }
  for (const bad of [-1, -0, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1, "1"]) {
    assert.throws(() =>
      permissionSavedRuleDigest({ ...saved(), createdAt: bad }),
    );
    assert.throws(() =>
      permissionPolicyDigest({ ...policy(), modeGeneration: bad }),
    );
  }
  for (const savedId of ["", "bad/id", "a".repeat(129), 1])
    assert.throws(() => permissionSavedRuleDigest({ ...saved(), savedId }));
  assert.throws(() => permissionGrantDigest({ ...grant(), effect: "ask" }));
  assert.throws(() =>
    permissionGrantDigest({ ...grant(), action: "한".repeat(1366) }),
  );
  assert.doesNotThrow(() =>
    permissionGrantDigest({ ...grant(), action: "a".repeat(4096) }),
  );
  for (const change of [
    { compilerVersion: 2 },
    { mode: "unknown" },
    { modeGeneration: 0 },
    { mode: "ask" },
    { settings: [{ capabilityId: "read", effect: "bad" }] },
    { settings: [{ capabilityId: "read", effect: "ask", extra: 1 }] },
    {
      settings: [
        { capabilityId: "read", effect: "ask" },
        { capabilityId: "read", effect: "deny" },
      ],
    },
    {
      settings: [
        { capabilityId: "z", effect: "ask" },
        { capabilityId: "a", effect: "deny" },
      ],
    },
    { rules: [{ action: "read", resource: "*", effect: "allow", extra: 1 }] },
  ])
    assert.throws(() => permissionPolicyDigest({ ...policy(), ...change }));
  assert.doesNotThrow(() =>
    permissionPolicyDigest({ ...policy(), mode: "ask", settings: [] }),
  );
  for (const change of [
    { clock: { ...preview().clock, extra: 1 } },
    { clock: { ...preview().clock, runtimeEpoch: "bad/id" } },
    { clock: { ...preview().clock, observationSequence: 0 } },
    { generations: { ...preview().generations, pending: 0 } },
    { generations: { ...preview().generations, extra: 1 } },
    { scope: { ...preview().scope, extra: 1 } },
    { impact: [] },
    { previewId: "" },
    { kind: "unknown" },
  ])
    assert.throws(() => permissionPreviewDigest({ ...preview(), ...change }));
});

test("rejects dangerous data before any nested getter or Proxy trap runs", () => {
  let calls = 0;
  const getter = {
    get effect() {
      calls++;
      return "allow";
    },
  };
  assert.throws(() => permissionPolicyDigest({ ...policy(), rules: [getter] }));
  const proxy = new Proxy(
    {},
    {
      ownKeys() {
        calls++;
        return [];
      },
    },
  );
  assert.throws(() => permissionPreviewDigest({ ...preview(), impact: proxy }));
  assert.throws(() =>
    permissionGrantDigest(
      Object.defineProperty(grant(), "action", {
        get() {
          calls++;
          return "read";
        },
      }),
    ),
  );
  assert.equal(calls, 0);
  for (const [, hash, fixture] of cases) {
    assert.throws(() => hash(Object.assign(Object.create({}), fixture())));
    assert.throws(() => hash({ ...fixture(), extra: undefined }));
  }
  for (const bad of [new Array(1), [undefined]])
    assert.throws(() => permissionScopeDigest({ ...scope(), sessions: bad }));
  for (const bad of ["\0", "\uD800"])
    assert.throws(() => permissionGrantDigest({ ...grant(), resource: bad }));
  assert.throws(() =>
    permissionPreviewDigest({
      ...preview(),
      impact: { text: "x".repeat(1024 * 1024) },
    }),
  );
  let deep = {};
  for (let i = 0; i < 33; i++) deep = { nested: deep };
  assert.throws(() => permissionPreviewDigest({ ...preview(), impact: deep }));
});

test("scope and preview bind nested ordered bytes but do not prove producer authority", () => {
  const body = scope();
  body.sessions = [{ sessionId: "b" }, { sessionId: "a" }];
  const original = JSON.parse(JSON.stringify(body));
  assert.equal(permissionScopeDigest(body), expected("scope", body));
  assert.notEqual(
    permissionScopeDigest(body),
    permissionScopeDigest({ ...body, sessions: [...body.sessions].reverse() }),
  );
  assert.deepEqual(body, original);
  for (const change of [
    { trustRevision: 1 },
    { expiresAt: 101 },
    { inventoryDigest: otherDigest },
    { nativeIdentityDigest: otherDigest },
    { rootIdentityDigest: otherDigest },
    { generations: { ...preview().generations, control: 2 } },
  ]) {
    assert.notEqual(
      permissionPreviewDigest(preview()),
      permissionPreviewDigest({ ...preview(), ...change }),
    );
  }
  // These deliberately incomplete nested fixtures demonstrate the producer boundary.
  assert.doesNotThrow(() => permissionPreviewDigest(preview()));
});

test("bounds and valid set order are enforced without changing ordered rules or Unicode", () => {
  const settings = [
    { capabilityId: "a", effect: "deny" },
    { capabilityId: "b", effect: "allow" },
  ];
  assert.equal(
    permissionPolicyDigest({ ...policy(), settings }),
    expected("policy", { ...policy(), settings }),
  );
  assert.throws(() =>
    permissionPolicyDigest({
      ...policy(),
      settings: Array.from({ length: 257 }, (_, i) => ({
        capabilityId: String(i).padStart(3, "0"),
        effect: "ask",
      })),
    }),
  );
  assert.throws(() =>
    permissionScopeDigest({
      ...scope(),
      locations: Array.from({ length: 33 }, () => ({})),
    }),
  );
  assert.throws(() =>
    permissionScopeDigest({
      ...scope(),
      sessions: Array.from({ length: 1025 }, () => ({})),
    }),
  );
  const duplicateRules = [policy().rules[0], policy().rules[0]];
  assert.equal(
    permissionPolicyDigest({ ...policy(), rules: duplicateRules }),
    expected("policy", { ...policy(), rules: duplicateRules }),
  );
  assert.notEqual(
    permissionGrantDigest({ ...grant(), resource: "é" }),
    permissionGrantDigest({ ...grant(), resource: "e\u0301" }),
  );
});
