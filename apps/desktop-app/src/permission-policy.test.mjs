import test from "node:test";
import assert from "node:assert/strict";
import { BASELINE_POLICY } from "./workbench-contract.mjs";
import { validateEnvelope } from "./workbench-contract.mjs";
import {
  projectPermissionPolicy,
  validatePermissionPolicyObservation,
  validPermissionPolicyRules,
} from "./renderer/shared/configuration-draft/permission-policy.mjs";
const scope = {
  runtimeEpoch: "epoch-1",
  revision: 0,
  workspaceId: "workspace-1",
  workspacePath: "/synthetic/workspace",
  sessionId: "session-1",
};
test("policy projection distinguishes absent, empty and exact ordered baseline", () => {
  const absent = projectPermissionPolicy(scope, {});
  assert.equal(absent.sessionRulesState, "absent");
  assert.equal(absent.baselineMatches, false);
  const empty = projectPermissionPolicy(scope, { permissions: [] });
  assert.equal(empty.sessionRulesState, "present");
  assert.equal(empty.baselineMatches, false);
  assert.equal(
    projectPermissionPolicy(scope, { permissions: BASELINE_POLICY })
      .baselineMatches,
    true,
  );
  assert.equal(
    projectPermissionPolicy(scope, {
      permissions: [...BASELINE_POLICY].reverse(),
    }).baselineMatches,
    false,
  );
});
test("policy projection detaches ordered duplicates without exporting native metadata", () => {
  const permissions = [
    { action: "edit", resource: "folder/*", effect: "ask" },
    { action: "edit", resource: "folder/*", effect: "deny" },
  ];
  const result = projectPermissionPolicy(scope, {
    permissions,
    secret: "not exported",
  });
  permissions[0].effect = "allow";
  assert.equal(result.sessionRules[0].effect, "ask");
  assert.equal(result.sessionRules.length, 2);
  assert.equal(Object.hasOwn(result, "secret"), false);
  assert.equal(validatePermissionPolicyObservation(result), result);
});
for (const [name, rules] of [
  ["undefined", undefined],
  ["null", null],
  ["invalid effect", [{ action: "*", resource: "*", effect: "maybe" }]],
  [
    "surplus field",
    [{ action: "*", resource: "*", effect: "ask", secret: "hidden" }],
  ],
  ["empty action", [{ action: "", resource: "*", effect: "ask" }]],
  ["long action", [{ action: "a".repeat(129), resource: "*", effect: "ask" }]],
  [
    "long resource",
    [{ action: "*", resource: "a".repeat(2049), effect: "ask" }],
  ],
  ["control", [{ action: "edit", resource: "x\nsecret", effect: "ask" }]],
  [
    "too many",
    Array.from({ length: 129 }, () => ({
      action: "*",
      resource: "*",
      effect: "ask",
    })),
  ],
  ["hole", new Array(1)],
])
  test(`policy malformed ${name} is closed unavailable`, () => {
    assert.equal(validPermissionPolicyRules(rules), false);
    const result = projectPermissionPolicy(scope, { permissions: rules });
    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "native_policy_unverified");
    assert.equal(Object.hasOwn(result, "sessionRules"), false);
  });
test("policy accessors cannot execute while validating or projecting", () => {
  let calls = 0;
  const native = {};
  Object.defineProperty(native, "permissions", {
    enumerable: true,
    get() {
      calls++;
      return [];
    },
  });
  assert.equal(projectPermissionPolicy(scope, native).status, "unavailable");
  const observed = { ...scope };
  Object.defineProperty(observed, "status", {
    enumerable: true,
    get() {
      calls++;
      return "available";
    },
  });
  assert.throws(() => validatePermissionPolicyObservation(observed), {
    appCode: "INVALID_REQUEST",
  });
  assert.equal(calls, 0);
});
test("policy response refuses forged baseline, mismatch, clock and extra fields", () => {
  const result = projectPermissionPolicy(scope, {
    permissions: BASELINE_POLICY,
  });
  for (const altered of [
    { ...result, baselineMatches: false },
    { ...result, requiredBaselineRules: [] },
    { ...result, revision: -1 },
    { ...result, revision: Number.MAX_SAFE_INTEGER + 1 },
    { ...result, evaluation: "effective" },
    { ...result, secret: "hidden" },
    { ...result, sessionRulesState: "absent" },
  ])
    assert.throws(() => validatePermissionPolicyObservation(altered), {
      appCode: "INVALID_REQUEST",
    });
});
for (const kind of [
  "string",
  "symbol",
  "getter",
  "index getter",
  "prototype getter",
])
  test(`policy baseline array refuses ${kind} without executing accessors`, () => {
    const result = projectPermissionPolicy(scope, {
      permissions: BASELINE_POLICY,
    });
    let calls = 0;
    const getter = () => {
      calls++;
      return "not allowed";
    };
    const rules = result.requiredBaselineRules;
    if (kind === "string") rules.secret = "not allowed";
    if (kind === "symbol") rules[Symbol("secret")] = "not allowed";
    if (kind === "getter")
      Object.defineProperty(rules, "secret", { enumerable: true, get: getter });
    if (kind === "index getter")
      Object.defineProperty(rules, "0", { enumerable: true, get: getter });
    if (kind === "prototype getter") {
      const prototype = Object.create(Array.prototype);
      Object.defineProperty(prototype, "every", { get: getter });
      Object.setPrototypeOf(rules, prototype);
    }
    assert.throws(() => validatePermissionPolicyObservation(result), {
      appCode: "INVALID_REQUEST",
    });
    assert.equal(calls, 0);
  });
test("policy uses original v2 read envelope and refuses mutation/outer requestId", () => {
  const operation = {
    type: "permission.policy.read",
    workspaceId: "workspace-1",
    sessionId: "session-1",
  };
  const envelope = {
    version: 2,
    runtimeEpoch: "epoch-1",
    readId: "read-1",
    operation,
  };
  assert.equal(validateEnvelope(envelope).operation.type, operation.type);
  assert.throws(() => validateEnvelope({ ...envelope, requestId: "read-1" }));
  assert.throws(() =>
    validateEnvelope({
      version: 2,
      runtimeEpoch: "epoch-1",
      operationId: "op-1",
      expectedRevision: 0,
      operation,
    }),
  );
});

import { classifyPreset } from "./renderer/shared/configuration-draft/permission-preset.mjs";
import { compileModeRules, legacyModeRules } from "./permission-mode.mjs";
test("classifyPreset matches every compiled mode (and legacy), else custom", () => {
  for (const mode of ["ask", "scoped_edit", "read_plan"]) {
    assert.equal(classifyPreset(compileModeRules(mode)), mode);
    assert.equal(classifyPreset(legacyModeRules(mode)), mode);
  }
  const ask = compileModeRules("ask").map((r) => ({ ...r }));
  assert.equal(classifyPreset(ask), "ask");
  // mixed: scoped_edit with shell opened up, or floor removed / reordered
  const scoped = compileModeRules("scoped_edit").map((r) => ({ ...r }));
  const open = scoped.map((r) =>
    r.action === "shell" ? { ...r, effect: "allow" } : r,
  );
  assert.equal(classifyPreset(open), "custom");
  assert.equal(classifyPreset(scoped.slice(0, -1)), "custom");
  assert.equal(classifyPreset([...ask].reverse()), "custom");
  assert.equal(classifyPreset([...ask, { ...ask[0] }]), "custom");
});
test("classifyPreset treats empty and malformed input as custom", () => {
  for (const bad of [[], undefined, null, "ask", {}, [null], [1], [{}]])
    assert.equal(classifyPreset(bad), "custom");
});
