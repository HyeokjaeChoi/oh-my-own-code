import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { redactReceipt } from "./workbench-receipts.mjs";
const backup = (epoch, op) =>
  `.omoc-configuration-${createHash("sha256")
    .update(JSON.stringify([epoch, op]))
    .digest("hex")}.skill.backup`;
const saved = () => ({
  runtimeEpoch: "old",
  operationId: "skill",
  type: "configuration.skill.save",
  workspaceId: "ws",
  skillSourceName: "review",
  admission: "dispatched",
  delivery: "accepted",
  effect: "confirmed",
  revision: 3,
  evidence: [],
  result: {
    kind: "skill_file_saved",
    workspaceId: "ws",
    sourceName: "review",
    version: "a".repeat(64),
    backupId: backup("old", "skill"),
  },
});
test("SKILL receipt exposes only exact private source and original key bound success", () => {
  const record = saved();
  assert.deepEqual(redactReceipt(record).result, record.result);
  assert.deepEqual(
    redactReceipt({ ...record, sessionId: undefined }).result,
    record.result,
  );
  assert.equal(redactReceipt(record).skillSourceName, undefined);
  for (const change of [
    { skillSourceName: "other" },
    { skillSourceName: undefined },
    { workspaceId: "other" },
    { sessionId: "session" },
    { operationId: "other" },
    { runtimeEpoch: "other" },
    { type: "configuration.save" },
    { effect: "unknown" },
    { delivery: "unknown" },
    { admission: "admitted" },
  ])
    assert.equal(redactReceipt({ ...record, ...change }).result, undefined);
  for (const change of [
    { sourceName: "../escape" },
    { version: "bad" },
    { backupId: backup("old", "other") },
    { text: "PRIVATE" },
    { path: "/private" },
  ])
    assert.equal(
      redactReceipt({ ...record, result: { ...record.result, ...change } })
        .result,
      undefined,
    );
  const missing = saved();
  delete missing.result.backupId;
  assert.deepEqual(redactReceipt(missing).result, missing.result);
});

import { nativeSkillRegistrationId } from "../native-skills-protocol.mjs";
for (const action of ["register", "remove", "apply"]) {
  test(`Native Skill ${action} receipt exposes exact closed result and no private admission data`, () => {
    const registration = {
      runtimeEpoch: "old",
      operationId: "register",
      workspaceId: "ws",
      sourceName: "review",
    };
    const record = {
      runtimeEpoch: "old",
      operationId: action,
      workspaceId: "ws",
      type: `configuration.skill.${action}`,
      admission: "dispatched",
      delivery: "accepted",
      effect: "confirmed",
      revision: 1,
      evidence: [],
      sessionId: action === "apply" ? "session" : undefined,
      digest: "SECRET",
      skillRuntime: { nativeId: "PRIVATE" },
      result: {
        kind: {
          register: "skill_registered",
          remove: "skill_removed",
          apply: "skill_applied",
        }[action],
        workspaceId: "ws",
        sourceName: "review",
        nativeId: nativeSkillRegistrationId(registration),
        digest: "a".repeat(64),
        nativeDigest: "b".repeat(64),
        registrationRuntimeEpoch: "old",
        registrationOperationId: "register",
        ...(action !== "remove" && { bodyDigest: "c".repeat(64) }),
        ...(action === "register" && {
          version: "d".repeat(64),
          directoryVersion: "e".repeat(64),
        }),
        ...(action === "apply" && {
          sessionId: "session",
          nativeSessionId: "native",
          nativeMessageId: "message",
        }),
      },
    };
    assert.deepEqual(redactReceipt(record).result, record.result);
    assert.equal(redactReceipt(record).skillRuntime, undefined);
    assert.equal(redactReceipt(record).digest, undefined);
    for (const change of [
      { admission: "admitted" },
      { effect: "none" },
      { delivery: "unknown" },
      { workspaceId: "foreign" },
      { runtimeEpoch: "other" },
    ])
      assert.equal(redactReceipt({ ...record, ...change }).result, undefined);
    for (const change of [
      { text: "PRIVATE" },
      { path: "/PRIVATE" },
      { nonce: "PRIVATE" },
      { digest: "bad" },
      { nativeId: `omoc-skill-${"0".repeat(64)}` },
      ...(action === "apply"
        ? [{ nativeMessageId: undefined }, { sessionId: "other" }]
        : []),
    ])
      assert.equal(
        redactReceipt({ ...record, result: { ...record.result, ...change } })
          .result,
        undefined,
      );
    assert.throws(() =>
      validateRuntimeReceipt({
        ...redactReceipt(record),
        effect: "none",
        admission: "admitted",
      }),
    );
  });
}
import { validateStorageReceipt as validateRuntimeReceipt } from "./storage-journal.mjs";

const agentReceiptBackup = (epoch, op) =>
  `.omoc-configuration-${createHash("sha256")
    .update(JSON.stringify([epoch, op]))
    .digest("hex")}.agent.backup`;
const agentSaved = () => ({
  runtimeEpoch: "old",
  operationId: "agent",
  type: "configuration.agent.save",
  workspaceId: "ws",
  agentSourceName: "review",
  admission: "dispatched",
  delivery: "accepted",
  effect: "confirmed",
  revision: 3,
  evidence: [],
  result: {
    kind: "agent_file_saved",
    workspaceId: "ws",
    sourceName: "review",
    version: "a".repeat(64),
    backupId: agentReceiptBackup("old", "agent"),
  },
});
test("AGENT file receipt exposes only exact private source and original key bound success", () => {
  const record = agentSaved();
  assert.deepEqual(redactReceipt(record).result, record.result);
  assert.deepEqual(
    redactReceipt({ ...record, sessionId: undefined }).result,
    record.result,
  );
  assert.equal(redactReceipt(record).agentSourceName, undefined);
  for (const change of [
    { agentSourceName: "other" },
    { agentSourceName: undefined },
    { workspaceId: "other" },
    { sessionId: "session" },
    { operationId: "other" },
    { runtimeEpoch: "other" },
    { type: "configuration.save" },
    { effect: "unknown" },
    { delivery: "unknown" },
    { admission: "admitted" },
  ])
    assert.equal(redactReceipt({ ...record, ...change }).result, undefined);
  for (const change of [
    { sourceName: "../escape" },
    { version: "bad" },
    { backupId: agentReceiptBackup("old", "other") },
    { text: "PRIVATE" },
    { path: "/private" },
  ])
    assert.equal(
      redactReceipt({ ...record, result: { ...record.result, ...change } })
        .result,
      undefined,
    );
  const missing = agentSaved();
  delete missing.result.backupId;
  assert.deepEqual(redactReceipt(missing).result, missing.result);
});

import { nativeAgentRegistrationId } from "../native-agents-protocol.mjs";
for (const action of ["register", "remove"]) {
  test(`Native Agent ${action} receipt exposes exact closed result and no private admission data`, () => {
    const registration = {
      runtimeEpoch: "old",
      operationId: "register",
      workspaceId: "ws",
      sourceName: "review",
    };
    const record = {
      runtimeEpoch: "old",
      operationId: action,
      workspaceId: "ws",
      type: `configuration.agent.${action}`,
      admission: "dispatched",
      delivery: "accepted",
      effect: "confirmed",
      revision: 1,
      evidence: [],
      digest: "SECRET",
      agentRuntime: { nativeId: "PRIVATE" },
      result: {
        kind: {
          register: "agent_registered",
          remove: "agent_removed",
        }[action],
        workspaceId: "ws",
        sourceName: "review",
        nativeId: nativeAgentRegistrationId(registration),
        digest: "a".repeat(64),
        nativeDigest: "b".repeat(64),
        registrationRuntimeEpoch: "old",
        registrationOperationId: "register",
        systemDigest: "c".repeat(64),
        defaultAgentId: "build",
        ...(action === "register" && {
          version: "d".repeat(64),
          directoryVersion: "e".repeat(64),
        }),
      },
    };
    assert.deepEqual(redactReceipt(record).result, record.result);
    assert.equal(redactReceipt(record).agentRuntime, undefined);
    assert.equal(redactReceipt(record).digest, undefined);
    for (const change of [
      { admission: "admitted" },
      { effect: "none" },
      { delivery: "unknown" },
      { workspaceId: "foreign" },
      { runtimeEpoch: "other" },
    ])
      assert.equal(redactReceipt({ ...record, ...change }).result, undefined);
    for (const change of [
      { text: "PRIVATE" },
      { path: "/PRIVATE" },
      { nonce: "PRIVATE" },
      { digest: "bad" },
      { nativeId: `omoc-agent-${"0".repeat(64)}` },
    ])
      assert.equal(
        redactReceipt({ ...record, result: { ...record.result, ...change } })
          .result,
        undefined,
      );
    assert.throws(() =>
      validateRuntimeReceipt({
        ...redactReceipt(record),
        effect: "none",
        admission: "admitted",
      }),
    );
  });
}

// Private permission target is authority for projection, never result-selected IDs.
function permissionRedactionFixture(kind = "reply") {
  const d = "a".repeat(64),
    key = { runtimeEpoch: "original", operationId: "permission-redaction" };
  const target = {
    version: 1,
    kind,
    previewId: "base64url_preview_owner_handle",
    previewDigest: d,
    scopeDigest: d,
    projectIdentityDigest: d,
    generations: {
      control: 1,
      inventory: 1,
      pending: 1,
      saved: 1,
      locations: 1,
    },
    targets: [
      { kind: "project", scopeDigest: d },
      {
        kind: "pending",
        workspaceId: "w",
        sessionId: "s",
        locationId: "base64url_location_owner_handle",
        permissionId: "p",
        requestDigest: d,
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
  const record = {
    ...key,
    type: "permission.reply.apply",
    workspaceId: "w",
    sessionId: "s",
    admission: "dispatched",
    delivery: "accepted",
    effect: "confirmed",
    revision: 9,
    evidence: [],
    digest: d,
    permissionTarget: target,
    result: {
      kind: "permission_replied",
      workspaceId: "w",
      sessionId: "s",
      previewDigest: d,
      scopeDigest: d,
      digest: d,
      decision: "once",
      resolved: [
        {
          locationId: target.targets[1].locationId,
          sessionId: "s",
          permissionId: "p",
        },
      ],
    },
  };
  return { record, target, d };
}
test("permission redaction detaches exact admitted pending IDs and omits all private bindings", () => {
  const { record } = permissionRedactionFixture();
  record.secret = "private";
  const out = redactReceipt(record);
  assert.deepEqual(out.result, record.result);
  assert.equal(Object.hasOwn(out, "digest"), false);
  assert.equal(Object.hasOwn(out, "permissionTarget"), false);
  assert.equal(Object.hasOwn(out, "permissionProgress"), false);
  record.result.resolved[0].permissionId = "changed";
  assert.equal(out.result.resolved[0].permissionId, "p");
});
for (const mutate of [
  (r) => delete r.permissionTarget,
  (r) => (r.result.resolved[0].permissionId = "foreign"),
  (r) => (r.result.resolved[0].locationId = "foreign"),
  (r) => (r.result.decision = "reject"),
  (r) => (r.result.digest = "b".repeat(64)),
  (r) => (r.result.previewDigest = "b".repeat(64)),
  (r) => (r.result.scopeDigest = "b".repeat(64)),
  (r) => (r.result.secret = "raw"),
  (r) => r.result.resolved.push({ ...r.result.resolved[0] }),
  (r) =>
    Object.defineProperty(r.result, "resolved", {
      get() {
        throw new Error("getter executed");
      },
    }),
  (r) => (r.result.resolved[0].extra = undefined),
])
  test(`permission raw redaction drops substituted or malformed result ${mutate.toString()}`, () => {
    const { record } = permissionRedactionFixture();
    mutate(record);
    assert.equal(redactReceipt(record).result, undefined);
  });
test("permission raw redaction correlates mode fields with actual admitted policy hash body", async () => {
  const { record, target, d } = permissionRedactionFixture("mode");
  const { permissionPolicyDigest } = await import(
    "../permission-control-digests.mjs"
  );
  const after = {
    compilerVersion: 1,
    floorDigest: d,
    mode: "read_plan",
    modeGeneration: 2,
    settings: [],
    selectedAgentIdentityDigest: d,
    inventoryDigest: d,
    rules: [],
  };
  const policyDigest = permissionPolicyDigest(after);
  record.type = "permission.mode.apply";
  target.targets[1] = {
    kind: "session",
    workspaceId: "w",
    sessionId: "s",
    beforePolicyDigest: d,
    afterPolicyDigest: policyDigest,
  };
  target.policyBindings = [{ targetIndex: 1, after }];
  target.plan[1].step = "native.permission.policy";
  record.result = {
    kind: "permission_mode_applied",
    workspaceId: "w",
    sessionId: "s",
    previewDigest: d,
    scopeDigest: d,
    digest: d,
    changes: [
      {
        workspaceId: "w",
        sessionId: "s",
        mode: "read_plan",
        modeGeneration: 2,
        policyDigest,
      },
    ],
  };
  assert.deepEqual(redactReceipt(record).result, record.result);
  for (const mutate of [
    (r) => (r.result.changes[0].mode = "custom"),
    (r) => (r.result.changes[0].sessionId = "foreign"),
    (r) => (r.result.changes[0].modeGeneration = 99),
    (r) =>
      (r.permissionTarget.policyBindings[0].after.inventoryDigest = "b".repeat(
        64,
      )),
  ]) {
    const r = globalThis.structuredClone(record);
    mutate(r);
    assert.equal(redactReceipt(r).result, undefined);
  }
});
test("permission raw redaction correlates exact admitted saved ID and rule digest", () => {
  const { record, target, d } = permissionRedactionFixture("revoke");
  record.type = "permission.saved.revoke";
  target.targets[1] = { kind: "saved", savedId: "saved", ruleDigest: d };
  target.plan[1].step = "native.permission.revoke";
  return import("../permission-control-digests.mjs").then(
    ({ permissionGrantDigest }) => {
      target.ruleBindings = [
        {
          grantDigest: permissionGrantDigest({
            projectIdentityDigest: d,
            action: "read",
            resource: "*",
            effect: "allow",
          }),
          action: "read",
          resource: "*",
        },
      ];
      record.result = {
        kind: "permission_revoked",
        workspaceId: "w",
        sessionId: "s",
        previewDigest: d,
        scopeDigest: d,
        digest: d,
        absentSavedId: "saved",
        ruleDigest: d,
      };
      assert.deepEqual(redactReceipt(record).result, record.result);
      record.result.absentSavedId = "other";
      assert.equal(redactReceipt(record).result, undefined);
      record.result.absentSavedId = "saved";
      record.result.ruleDigest = "b".repeat(64);
      assert.equal(redactReceipt(record).result, undefined);
    },
  );
});
test("permission raw remember projection requires immutable verified actual saved progress", async () => {
  const { record, target, d } = permissionRedactionFixture("remember"),
    { permissionGrantDigest, permissionSavedRuleDigest } = await import(
      "../permission-control-digests.mjs"
    );
  const grantDigest = permissionGrantDigest({
    projectIdentityDigest: d,
    action: "read",
    resource: "*",
    effect: "allow",
  });
  const ruleDigest = permissionSavedRuleDigest({
    projectIdentityDigest: d,
    savedId: "actual",
    action: "read",
    resource: "*",
    effect: "allow",
    createdAt: 10,
    updatedAt: 20,
  });
  record.type = "permission.remember.apply";
  target.ruleBindings = [{ grantDigest, action: "read", resource: "*" }];
  target.targets.push({ kind: "grant", grantDigest });
  target.plan.splice(1, 0, {
    ordinal: 1,
    step: "native.permission.grant",
    targetIndex: 2,
  });
  target.plan.forEach((s, i) => (s.ordinal = i));
  record.result = {
    kind: "permission_remembered",
    workspaceId: "w",
    sessionId: "s",
    previewDigest: d,
    scopeDigest: d,
    digest: d,
    saved: [{ grantDigest, savedId: "actual", ruleDigest }],
    resolved: record.result.resolved,
  };
  assert.equal(redactReceipt(record).result, undefined);
  record.dispatches = target.plan.map((s) => ({
    runtimeEpoch: record.runtimeEpoch,
    operationId: record.operationId,
    step: s.step,
    permissionEffect: {
      ordinal: s.ordinal,
      targetIndex: s.targetIndex,
      previewDigest: d,
    },
  }));
  record.permissionProgress = target.plan.map((s) => ({
    kind: "permission_progress",
    runtimeEpoch: record.runtimeEpoch,
    operationId: record.operationId,
    ordinal: s.ordinal,
    outcome: "verified",
    observation:
      s.step === "native.permission.grant"
        ? {
            kind: "grant",
            grantDigest,
            savedId: "actual",
            ruleDigest,
            createdAt: 10,
            updatedAt: 20,
          }
        : { kind: "state", stateDigest: d },
  }));
  assert.deepEqual(redactReceipt(record).result, record.result);
  for (const mutate of [
    (r) => (r.permissionProgress[1].outcome = "unverified"),
    (r) => (r.permissionProgress[1].observation.createdAt = 99),
    (r) => (r.result.saved[0].savedId = "foreign"),
    (r) => (r.permissionTarget.targets[2].grantDigest = "b".repeat(64)),
    (r) => (r.permissionProgress[1].operationId = "foreign"),
  ]) {
    const r = globalThis.structuredClone(record);
    mutate(r);
    assert.equal(redactReceipt(r).result, undefined);
  }
});

test("permission raw kind getter is rejected without execution", () => {
  const { record } = permissionRedactionFixture();
  let called = false;
  Object.defineProperty(record.result, "kind", {
    get() {
      called = true;
      return "permission_replied";
    },
  });
  assert.equal(redactReceipt(record).result, undefined);
  assert.equal(called, false);
});

test("permission partial raw projection validates exact progress prefix and missing-slot digest", async () => {
  const { record, target, d } = permissionRedactionFixture();
  const { permissionPartialOutcomes } = await import(
    "./workbench-permission-storage.mjs"
  );
  record.delivery = "unknown";
  record.effect = "unknown";
  record.dispatches = [
    {
      runtimeEpoch: record.runtimeEpoch,
      operationId: record.operationId,
      step: target.plan[0].step,
      permissionEffect: { ordinal: 0, targetIndex: 0, previewDigest: d },
    },
  ];
  record.permissionProgress = [];
  record.result = {
    kind: "permission_partial",
    workspaceId: "w",
    sessionId: "s",
    previewDigest: d,
    scopeDigest: d,
    digest: d,
    hold: "project",
    outcomes: permissionPartialOutcomes({
      identity: record,
      permissionTarget: target,
      dispatches: record.dispatches,
      permissionProgress: [],
    }),
  };
  assert.deepEqual(redactReceipt(record).result, record.result);
  for (const mutate of [
    (r) => (r.result.outcomes[0].stateDigest = d),
    (r) => (r.result.outcomes[0].state = "verified"),
    (r) => (r.dispatches[0].permissionEffect.targetIndex = 1),
    (r) =>
      r.permissionProgress.push({
        kind: "permission_progress",
        runtimeEpoch: r.runtimeEpoch,
        operationId: r.operationId,
        ordinal: 1,
        outcome: "verified",
        observation: { kind: "state", stateDigest: d },
      }),
  ]) {
    const r = globalThis.structuredClone(record);
    mutate(r);
    assert.equal(redactReceipt(r).result, undefined);
  }
});
