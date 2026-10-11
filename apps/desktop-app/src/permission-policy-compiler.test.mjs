import assert from "node:assert/strict";
import test from "node:test";
import {
  compilePermissionRules,
  compilePermissionPolicy,
  matchesOrderedPermissionRules,
  matchesAuthenticatedFloor,
  matchesModeRecord,
} from "./permission-policy-compiler.mjs";
import { BASELINE_POLICY } from "./renderer/shared/configuration-draft/policy.mjs";
import { permissionPolicyDigest } from "./permission-control-digests.mjs";
const input = () => ({
  mode: "ask",
  settings: [],
  capabilities: [],
  authenticatedDenies: [],
  agentDenies: [],
});
const capability = (id, category, support = "verified") => ({
  capabilityId: id,
  category,
  support,
  action: id,
  resource: "*",
  adapterId: `adapter.${id}`,
});
test("default ask compilation preserves exact baseline bytes and order", () => {
  assert.deepEqual(compilePermissionRules(input()), BASELINE_POLICY);
  assert.deepEqual(
    compilePermissionRules({
      ...input(),
      capabilities: [capability("read", "file_read")],
    }),
    BASELINE_POLICY,
  );
});
test("mode rules precede non-overridable floor and authenticated Agent denies", () => {
  const rules = compilePermissionRules({
    ...input(),
    mode: "read_plan",
    capabilities: [
      capability("write", "file_write"),
      capability("read", "file_read"),
      capability("shell", "shell"),
    ],
    agentDenies: [{ action: "read", resource: "secret/*", effect: "deny" }],
  });
  assert.deepEqual(rules.slice(0, 4), [
    { action: "*", resource: "*", effect: "ask" },
    { action: "read", resource: "*", effect: "allow" },
    { action: "shell", resource: "*", effect: "deny" },
    { action: "write", resource: "*", effect: "deny" },
  ]);
  assert.equal(
    matchesAuthenticatedFloor(
      rules,
      [],
      [{ action: "read", resource: "secret/*", effect: "deny" }],
    ),
    true,
  );
  assert.equal(
    matchesAuthenticatedFloor([
      ...rules,
      { action: "external_directory", resource: "*", effect: "allow" },
    ]),
    false,
  );
});
test("unsupported capability cannot be enabled by custom settings", () => {
  const rules = compilePermissionRules({
    ...input(),
    mode: "custom",
    settings: [{ capabilityId: "write", effect: "allow" }],
    capabilities: [capability("write", "file_write", "unsupported")],
  });
  assert.equal(rules[1].effect, "deny");
  assert.throws(() =>
    compilePermissionRules({
      ...input(),
      mode: "custom",
      settings: [{ capabilityId: "missing", effect: "allow" }],
    }),
  );
});
test("compiler refuses conflicting action mapping, wildcard ambiguity and partial data", () => {
  const first = capability("read", "file_read");
  for (const capabilities of [
    [first, { ...first, capabilityId: "other" }],
    [{ ...first, action: "*" }],
    [{ ...first, arbitraryProof: true }],
  ])
    assert.throws(() => compilePermissionRules({ ...input(), capabilities }));
  assert.throws(() =>
    compilePermissionRules({
      ...input(),
      mode: "read_plan",
      settings: [{ capabilityId: "read", effect: "allow" }],
    }),
  );
  let calls = 0;
  const getter = { ...input() };
  Object.defineProperty(getter, "capabilities", {
    enumerable: true,
    get() {
      calls++;
      return [];
    },
  });
  assert.throws(() => compilePermissionRules(getter));
  assert.equal(calls, 0);
});
test("compiled policy digest uses actual shared policy domain and exact mode record", () => {
  const value = {
    ...input(),
    compilerVersion: 1,
    floorDigest: "a".repeat(64),
    modeGeneration: 3,
    selectedAgentIdentityDigest: "b".repeat(64),
    inventoryDigest: "c".repeat(64),
  };
  const compiled = compilePermissionPolicy(value);
  const { policyDigest, ...body } = compiled;
  assert.equal(policyDigest, permissionPolicyDigest(body));
  const record = {
    version: 1,
    mode: "ask",
    modeGeneration: 3,
    settings: [],
    floorDigest: value.floorDigest,
    compilerVersion: 1,
    policyDigest,
  };
  assert.equal(matchesModeRecord(record, compiled), true);
  assert.equal(
    matchesModeRecord({ ...record, modeGeneration: 4 }, compiled),
    false,
  );
  assert.equal(
    matchesOrderedPermissionRules(compiled.rules, BASELINE_POLICY),
    true,
  );
  assert.equal(
    matchesOrderedPermissionRules(
      compiled.rules,
      [...BASELINE_POLICY].reverse(),
    ),
    false,
  );
});

test("actual pinned Native evaluator observes compiled order; saved rules still require final gate", async () => {
  const { readFile } = await import("node:fs/promises");
  const { createHash } = await import("node:crypto");
  const { runInNewContext } = await import("node:vm");
  const inputs = {
    "config-vgpkvtp0.js":
      "a28683ef6d49fad12e71abb5ed77b23aaa093becd9369d5d2eea2c639f524f65",
    "config-y1fvbwt7.js":
      "f2a86d00b5b2fc63ce689db5563fe6a9b1f7023412a5aca08a939212a1cb4456",
  };
  const sources = {};
  for (const [name, expected] of Object.entries(inputs)) {
    const bytes = await readFile(
      new URL(
        `../runtime-event-host/.generated/install/node_modules/@opencode/core/dist/chunks/${name}`,
        import.meta.url,
      ),
    );
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expected);
    sources[name] = bytes.toString("utf8");
  }
  const matcher = sources["config-y1fvbwt7.js"].slice(
    sources["config-y1fvbwt7.js"].indexOf("function match2("),
    sources["config-y1fvbwt7.js"].indexOf("\nexport {"),
  );
  const evaluator = sources["config-vgpkvtp0.js"].slice(
    sources["config-vgpkvtp0.js"].indexOf("function evaluate2("),
    sources["config-vgpkvtp0.js"].indexOf("\nfunction merge2("),
  );
  const evaluate = runInNewContext(`${matcher}\n${evaluator}\nevaluate2`, {
    process: { platform: process.platform },
  });
  const compiled = compilePermissionRules({
    ...input(),
    mode: "read_plan",
    capabilities: [
      capability("read", "file_read"),
      capability("write", "file_write"),
    ],
  });
  assert.equal(evaluate("read", "src/a.ts", compiled).effect, "allow");
  assert.equal(evaluate("write", "src/a.ts", compiled).effect, "deny");
  assert.equal(
    evaluate("external_directory", "/external", compiled).effect,
    "deny",
  );
  // Native's public last-match evaluation alone cannot protect a floor from a
  // later saved allow. Production still requires the independent final gate.
  assert.equal(
    evaluate("write", "src/a.ts", compiled, [
      { action: "write", resource: "*", effect: "allow" },
    ]).effect,
    "allow",
  );
});

test("Native Windows action case folding cannot create overlapping capability mappings", () => {
  assert.throws(() =>
    compilePermissionRules({
      ...input(),
      capabilities: [
        capability("read", "file_read"),
        { ...capability("other", "file_write"), action: "READ" },
      ],
    }),
  );
});
