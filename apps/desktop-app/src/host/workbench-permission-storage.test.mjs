import test from "node:test";
import assert from "node:assert/strict";
import { validateJournalPayload } from "./storage-journal.mjs";
const D = "a".repeat(64);
export function permissionFixture() {
  const key = { runtimeEpoch: "old", operationId: "permission-1" };
  const target = {
    version: 1,
    kind: "reply",
    previewId: "0123456789abcdef0123456789abcdef",
    previewDigest: D,
    scopeDigest: D,
    projectIdentityDigest: D,
    generations: {
      control: 1,
      inventory: 1,
      pending: 1,
      saved: 1,
      locations: 1,
    },
    targets: [
      { kind: "project", scopeDigest: D },
      {
        kind: "pending",
        workspaceId: "w",
        sessionId: "s",
        locationId: "0123456789abcdef0123456789abcdef",
        permissionId: "p",
        requestDigest: D,
        resolution: "once",
      },
    ],
    plan: [
      { ordinal: 0, step: "native.permission.hold", targetIndex: 0 },
      { ordinal: 1, step: "native.permission.reply", targetIndex: 1 },
      { ordinal: 2, step: "native.permission.activate", targetIndex: 0 },
    ],
    ruleBindings: [],
    policyBindings: [],
  };
  const identity = {
    ...key,
    type: "permission.reply.apply",
    workspaceId: "w",
    sessionId: "s",
    digest: D,
  };
  return { key, target, identity };
}
test("permission marker accepts the new feature", () => {
  assert.equal(
    validateJournalPayload({
      kind: "feature_gate",
      revision: 1,
      feature: "permission_control_v1",
    }).feature,
    "permission_control_v1",
  );
});
test("permission admission retains exact target and private bindings", () => {
  const f = permissionFixture();
  assert.deepEqual(
    validateJournalPayload({
      kind: "admission",
      revision: 2,
      identity: f.identity,
      permissionTarget: f.target,
    }).permissionTarget,
    f.target,
  );
});
test("permission ordinal dispatch accepts its exact closed payload", () => {
  const f = permissionFixture();
  const input = {
    kind: "dispatch",
    revision: 3,
    ...f.key,
    step: f.target.plan[0].step,
    permissionEffect: { ordinal: 0, targetIndex: 0, previewDigest: D },
  };
  assert.deepEqual(validateJournalPayload(input), input);
});

import {
  validatePermissionTarget,
  validatePermissionAdmission,
  validatePermissionDispatch,
  validatePermissionDispatchPayload,
  validatePermissionProgress,
  validatePermissionCompletion,
  permissionPartialOutcomes,
  permissionControlFromBinding,
  validatePermissionControl,
} from "./workbench-permission-storage.mjs";
import {
  permissionGrantDigest,
  permissionSavedRuleDigest,
  permissionPolicyDigest,
} from "../permission-control-digests.mjs";
import { permissionCanonicalJSON } from "../permission-control-canonical.mjs";
import { createHash } from "node:crypto";
const copy = (v) => globalThis.structuredClone(v);

test("permission existingSaved presence requires an exact object at target, admission and parser boundaries", async (t) => {
  const f = permissionFixture();
  f.identity.type = "permission.remember.apply";
  f.target.kind = "remember";
  const binding = { action: "read", resource: "*" };
  binding.grantDigest = permissionGrantDigest({
    projectIdentityDigest: D,
    ...binding,
    effect: "allow",
  });
  f.target.ruleBindings = [binding];
  f.target.targets.push({ kind: "grant", grantDigest: binding.grantDigest });
  f.target.plan.splice(1, 0, {
    ordinal: 1,
    step: "native.permission.grant",
    targetIndex: 2,
  });
  f.target.plan.forEach((slot, ordinal) => (slot.ordinal = ordinal));
  const admission = (target) => ({
    kind: "admission",
    revision: 2,
    identity: f.identity,
    permissionTarget: target,
  });
  for (const value of [null, false, 0, "", [], {}]) {
    await t.test(`reject ${JSON.stringify(value)}`, () => {
      const target = copy(f.target);
      target.targets[2].existingSaved = value;
      assert.throws(() => validatePermissionTarget(target, f.identity.type));
      assert.throws(() => validatePermissionAdmission(admission(target)));
      assert.throws(() => validateJournalPayload(admission(target)));
    });
  }
  validatePermissionTarget(f.target, f.identity.type);
  validatePermissionAdmission(admission(f.target));
  validateJournalPayload(admission(f.target));
  f.target.targets[2].existingSaved = {
    savedId: "original-saved",
    ruleDigest: D,
  };
  validatePermissionTarget(f.target, f.identity.type);
  validatePermissionAdmission(admission(f.target));
  validateJournalPayload(admission(f.target));
});

function operation(f = permissionFixture()) {
  return {
    identity: f.identity,
    permissionTarget: f.target,
    dispatches: [],
    permissionProgress: [],
  };
}
function dispatchFor(op, ordinal) {
  const s = op.permissionTarget.plan[ordinal];
  return {
    ...op.identity,
    step: s.step,
    permissionEffect: {
      ordinal,
      targetIndex: s.targetIndex,
      previewDigest: op.permissionTarget.previewDigest,
    },
  };
}
function progressFor(op, ordinal, outcome = "verified") {
  return {
    kind: "permission_progress",
    runtimeEpoch: op.identity.runtimeEpoch,
    operationId: op.identity.operationId,
    ordinal,
    outcome,
    observation: { kind: "state", stateDigest: D },
  };
}
function advance(op) {
  for (const slot of op.permissionTarget.plan) {
    const d = dispatchFor(op, slot.ordinal);
    delete d.type;
    delete d.workspaceId;
    delete d.sessionId;
    delete d.digest;
    validatePermissionDispatch(op, d);
    op.dispatches.push(d);
    const p = progressFor(op, slot.ordinal);
    validatePermissionProgress(op, p);
    op.permissionProgress.push(p);
  }
}
function completeFor(op) {
  return {
    receipt: {
      ...op.identity,
      admission: "dispatched",
      delivery: "accepted",
      effect: "confirmed",
      revision: 9,
      evidence: [],
      result: {
        kind: "permission_replied",
        workspaceId: "w",
        sessionId: "s",
        previewDigest: D,
        scopeDigest: D,
        digest: D,
        decision: "once",
        resolved: [
          {
            locationId: op.permissionTarget.targets[1].locationId,
            sessionId: "s",
            permissionId: "p",
          },
        ],
      },
    },
    delta: { workspaces: [], sessions: [], tombstones: [] },
  };
}
for (const mutation of [
  (v) => {
    v.extra = true;
  },
  (v) => {
    v.projectIdentityDigest = "bad";
  },
  (v) => {
    delete v.policyBindings;
  },
  (v) => {
    v.plan[1].ordinal = 0;
  },
  (v) => {
    v.plan[1].targetIndex = 99;
  },
  (v) => {
    v.plan[1].step = "native.permission.policy";
  },
  (v) => {
    v.targets.push(copy(v.targets[1]));
  },
  (v) => {
    v.ruleBindings.push({ grantDigest: D, action: "read", resource: "*" });
  },
  (v) => {
    v.policyBindings.push({ targetIndex: 0, after: {} });
  },
  (v) => {
    v.previewId = "bad handle";
  },
  (v) => {
    v.plan = new Array(8193).fill(v.plan[0]);
  },
  (v) => {
    v.targets[0].scopeDigest = "b".repeat(64);
  },
  (v) => {
    v.plan[1].ordinal = -0;
  },
  (v) => {
    v.plan[0].extra = undefined;
  },
  (v) => {
    delete v.plan[1];
  },
  (v) => {
    Object.defineProperty(v, "kind", {
      get() {
        throw new Error("getter executed");
      },
    });
  },
  (v) => {
    v[Symbol("secret")] = true;
  },
  (v) => {
    v.targets[1].permissionId = "\ud800";
  },
])
  test(`permission target rejects adversarial case ${mutation.toString()}`, () => {
    const f = permissionFixture();
    mutation(f.target);
    assert.throws(() => validatePermissionTarget(f.target, f.identity.type));
  });
test("permission target and policy data are detached before queue awaits", () => {
  const f = permissionFixture(),
    v = validatePermissionTarget(f.target, f.identity.type);
  f.target.targets[1].permissionId = "changed";
  assert.equal(v.targets[1].permissionId, "p");
});
test("permission dispatch cannot skip replay or advance without verified progress", () => {
  const op = operation();
  const d = {
    runtimeEpoch: "old",
    operationId: "permission-1",
    step: op.permissionTarget.plan[0].step,
    permissionEffect: { ordinal: 0, targetIndex: 0, previewDigest: D },
  };
  validatePermissionDispatch(op, d);
  op.dispatches.push(d);
  assert.throws(() => validatePermissionDispatch(op, d));
  const next = {
    ...d,
    step: op.permissionTarget.plan[1].step,
    permissionEffect: { ordinal: 1, targetIndex: 1, previewDigest: D },
  };
  assert.throws(() => validatePermissionDispatch(op, next));
  const p = progressFor(op, 0, "unverified");
  validatePermissionProgress(op, p);
  op.permissionProgress.push(p);
  assert.throws(() => validatePermissionDispatch(op, next));
  assert.throws(() =>
    validatePermissionProgress(op, { ...p, outcome: "verified" }),
  );
});
test("permission progress cannot precede dispatch or substitute grant for state", () => {
  const op = operation(),
    p = progressFor(op, 0);
  assert.throws(() => validatePermissionProgress(op, p));
  op.dispatches.push({});
  p.observation = {
    kind: "grant",
    grantDigest: D,
    savedId: "saved",
    ruleDigest: D,
    createdAt: 1,
    updatedAt: 2,
  };
  assert.throws(() => validatePermissionProgress(op, p));
});
test("permission partial uses exact original-key unknown-slot hash and state observation", () => {
  const op = operation();
  op.dispatches.push({});
  const body = {
    runtimeEpoch: "old",
    operationId: "permission-1",
    previewDigest: D,
    ...op.permissionTarget.plan[0],
  };
  const expected = createHash("sha256")
    .update("omoc.permission.slot.v1\n" + permissionCanonicalJSON(body))
    .digest("hex");
  assert.deepEqual(permissionPartialOutcomes(op), [
    { ordinal: 0, targetIndex: 0, state: "unknown", stateDigest: expected },
  ]);
  op.permissionProgress.push(progressFor(op, 0));
  assert.equal(permissionPartialOutcomes(op)[0].stateDigest, D);
});
test("permission completion requires every slot, original digest and exact pending set", () => {
  const op = operation(),
    p = completeFor(op);
  assert.throws(() => validatePermissionCompletion(op, p, new Map()));
  advance(op);
  validatePermissionCompletion(op, p, new Map());
  for (const field of ["digest", "previewDigest", "scopeDigest"]) {
    const bad = copy(p);
    bad.receipt.result[field] = "b".repeat(64);
    assert.throws(() => validatePermissionCompletion(op, bad, new Map()));
  }
  for (const mutate of [
    (p) => (p.receipt.result.resolved[0].permissionId = "foreign"),
    (p) => (p.receipt.result.decision = "reject"),
    (p) => p.delta.sessions.push({}),
    (p) => p.receipt.result.resolved.push(copy(p.receipt.result.resolved[0])),
  ]) {
    const bad = copy(p);
    mutate(bad);
    assert.throws(() => validatePermissionCompletion(op, bad, new Map()));
  }
  op.completedDelta = p.delta;
  assert.throws(() => validatePermissionCompletion(op, p, new Map()));
});
test("permission partial completion cannot omit/add outcomes or claim none after hold", () => {
  const op = operation();
  op.dispatches.push({});
  const p = completeFor(op);
  p.receipt.delivery = "unknown";
  p.receipt.effect = "unknown";
  p.receipt.result = {
    kind: "permission_partial",
    workspaceId: "w",
    sessionId: "s",
    previewDigest: D,
    scopeDigest: D,
    digest: D,
    hold: "project",
    outcomes: permissionPartialOutcomes(op),
  };
  validatePermissionCompletion(op, p, new Map());
  p.receipt.result.outcomes = [];
  assert.throws(() => validatePermissionCompletion(op, p, new Map()));
  delete p.receipt.result;
  p.receipt.effect = "none";
  assert.throws(() => validatePermissionCompletion(op, p, new Map()));
});
function modeFixture() {
  const f = permissionFixture();
  f.identity.type = "permission.mode.apply";
  f.target.kind = "mode";
  const after = {
    compilerVersion: 1,
    floorDigest: D,
    mode: "ask",
    modeGeneration: 2,
    settings: [],
    selectedAgentIdentityDigest: D,
    inventoryDigest: D,
    rules: [],
  };
  f.target.targets[1] = {
    kind: "session",
    workspaceId: "w",
    sessionId: "s",
    beforePolicyDigest: D,
    afterPolicyDigest: permissionPolicyDigest(after),
  };
  f.target.policyBindings = [{ targetIndex: 1, after }];
  f.target.plan[1].step = "native.permission.policy";
  return f;
}
test("permission mode binds exact hash body and refuses missing BEFORE policy bootstrap", () => {
  const f = modeFixture();
  validatePermissionTarget(f.target, f.identity.type);
  assert.throws(
    () =>
      validatePermissionAdmission(
        { identity: f.identity, permissionTarget: f.target },
        new Map(),
      ),
    { code: "POLICY_UNVERIFIED" },
  );
  const sessions = new Map([
    ["s", { workspaceId: "w", permissionControl: { policyDigest: D } }],
  ]);
  validatePermissionAdmission(
    { identity: f.identity, permissionTarget: f.target },
    sessions,
  );
  for (const mutate of [
    (t) => (t.policyBindings[0].after.mode = "read_plan"),
    (t) => (t.policyBindings[0].after.policyDigest = D),
    (t) => (t.policyBindings[0].targetIndex = 0),
    (t) => t.policyBindings.push(copy(t.policyBindings[0])),
    (t) =>
      t.policyBindings[0].after.rules.push({
        action: "write",
        resource: "*",
        effect: "allow",
      }),
  ]) {
    const t = copy(f.target);
    mutate(t);
    assert.throws(() => validatePermissionTarget(t, f.identity.type));
  }
});
test("permission mode completion preserves every existing session field", () => {
  const f = modeFixture(),
    op = operation(f);
  advance(op);
  const old = {
    appSessionId: "s",
    workspaceId: "w",
    nativeSessionId: "n",
    lifecycleState: "active",
    pinned: false,
    archived: false,
    permissionControl: { policyDigest: D },
  };
  const control = permissionControlFromBinding(
    f.target.policyBindings[0].after,
  );
  validatePermissionControl(control);
  const p = completeFor(op);
  p.receipt.type = f.identity.type;
  p.receipt.result = {
    kind: "permission_mode_applied",
    workspaceId: "w",
    sessionId: "s",
    previewDigest: D,
    scopeDigest: D,
    digest: D,
    changes: [
      {
        workspaceId: "w",
        sessionId: "s",
        mode: control.mode,
        modeGeneration: control.modeGeneration,
        policyDigest: control.policyDigest,
      },
    ],
  };
  p.delta.sessions = [{ ...old, permissionControl: control }];
  validatePermissionCompletion(op, p, new Map([["s", old]]));
  for (const mutate of [
    (p) => (p.delta.sessions[0].nativeSessionId = "foreign"),
    (p) =>
      (p.delta.sessions[0].permissionControl.settings = [
        { capabilityId: "x", effect: "allow" },
      ]),
    (p) => (p.receipt.result.changes[0].modeGeneration = 3),
  ]) {
    const bad = copy(p);
    mutate(bad);
    assert.throws(() =>
      validatePermissionCompletion(op, bad, new Map([["s", old]])),
    );
  }
});
test("permission grant readback recomputes actual saved identity and timestamps", () => {
  const f = permissionFixture();
  f.identity.type = "permission.remember.apply";
  f.target.kind = "remember";
  const binding = { action: "read", resource: "*" };
  binding.grantDigest = permissionGrantDigest({
    projectIdentityDigest: D,
    ...binding,
    effect: "allow",
  });
  f.target.ruleBindings = [binding];
  f.target.targets.push({ kind: "grant", grantDigest: binding.grantDigest });
  f.target.plan.splice(1, 0, {
    ordinal: 1,
    step: "native.permission.grant",
    targetIndex: 2,
  });
  f.target.plan.forEach((s, i) => (s.ordinal = i));
  validatePermissionTarget(f.target, f.identity.type);
  const op = operation(f);
  op.dispatches.push({});
  op.permissionProgress.push(progressFor(op, 0));
  op.dispatches.push({});
  const observation = {
    kind: "grant",
    grantDigest: binding.grantDigest,
    savedId: "actual-saved",
    createdAt: 10,
    updatedAt: 20,
  };
  observation.ruleDigest = permissionSavedRuleDigest({
    projectIdentityDigest: D,
    savedId: observation.savedId,
    action: "read",
    resource: "*",
    effect: "allow",
    createdAt: 10,
    updatedAt: 20,
  });
  const p = { ...progressFor(op, 1), observation };
  validatePermissionProgress(op, p);
  for (const field of [
    "savedId",
    "createdAt",
    "updatedAt",
    "grantDigest",
    "ruleDigest",
  ]) {
    const bad = copy(p);
    bad.observation[field] =
      typeof bad.observation[field] === "number" ? 99 : "b".repeat(64);
    assert.throws(() => validatePermissionProgress(op, bad));
  }
  f.target.targets[2].existingSaved = {
    savedId: "other",
    ruleDigest: observation.ruleDigest,
  };
  assert.throws(() => validatePermissionProgress(op, p));
});

test("permission stored control validates settings without inventing omitted hash inputs", () => {
  const base = {
    version: 1,
    compilerVersion: 1,
    floorDigest: D,
    policyDigest: D,
    mode: "custom",
    modeGeneration: 1,
    settings: [
      { capabilityId: "a", effect: "ask" },
      { capabilityId: "b", effect: "deny" },
    ],
  };
  assert.deepEqual(validatePermissionControl(base), base);
  for (const mutate of [
    (c) => c.settings.reverse(),
    (c) => c.settings.push({ capabilityId: "b", effect: "allow" }),
    (c) => (c.settings[0].effect = "invalid"),
    (c) => (c.mode = "ask"),
    (c) => (c.settings[0].extra = true),
  ]) {
    const c = copy(base);
    mutate(c);
    assert.throws(() => validatePermissionControl(c));
  }
});
test("permission handles accept valid runtime-owned base64url identifiers", () => {
  const f = permissionFixture();
  f.target.previewId = "r4nd0m_Owner_Handle-128bits";
  f.target.targets[1].locationId = "r4nd0m_Location_Handle-128bits";
  validatePermissionTarget(f.target, f.identity.type);
});
test("permission repeated policy step consumes consecutive ordinals including same admitted target", () => {
  const f = modeFixture();
  f.target.plan.splice(2, 0, {
    ordinal: 2,
    step: "native.permission.policy",
    targetIndex: 1,
  });
  f.target.plan.forEach((s, i) => (s.ordinal = i));
  validatePermissionTarget(f.target, f.identity.type);
  const op = operation(f);
  advance(op);
  assert.equal(
    op.dispatches.filter((d) => d.step === "native.permission.policy").length,
    2,
  );
});
test("permission detached target exceeds 1MiB without truncation", () => {
  const f = permissionFixture();
  f.target.ruleBindings = Array.from({ length: 1024 }, (_, i) => ({
    grantDigest: D,
    action: String(i) + "a".repeat(4090),
    resource: "*",
  }));
  assert.throws(() => validatePermissionTarget(f.target, f.identity.type));
});

test("permission result allowlists cannot be mutated by an importing consumer", async () => {
  const { PERMISSION_RESULT_FIELDS } = await import(
    "./workbench-permission-storage.mjs"
  );
  assert.throws(
    () => PERMISSION_RESULT_FIELDS.permission_replied.push("secret"),
    TypeError,
  );
});
test("permission completion rejects foreign original keys and scope", () => {
  const op = operation();
  advance(op);
  for (const field of [
    "runtimeEpoch",
    "operationId",
    "type",
    "workspaceId",
    "sessionId",
  ]) {
    const p = completeFor(op);
    p.receipt[field] = "foreign";
    assert.throws(() => validatePermissionCompletion(op, p, new Map()));
  }
});
test("permission dispatch descriptors never execute getters", () => {
  let called = false;
  const f = permissionFixture();
  const value = {
    ...f.key,
    permissionEffect: { ordinal: 0, targetIndex: 0, previewDigest: D },
  };
  Object.defineProperty(value, "step", {
    get() {
      called = true;
      return "native.permission.hold";
    },
  });
  const journalInput = {
    kind: "dispatch",
    revision: 3,
    ...f.key,
    permissionEffect: value.permissionEffect,
  };
  Object.defineProperty(journalInput, "step", {
    get() {
      called = true;
      return "native.permission.hold";
    },
  });
  assert.throws(() => validateJournalPayload(journalInput));
  assert.throws(() => validatePermissionDispatchPayload(value));
  assert.equal(called, false);
});
