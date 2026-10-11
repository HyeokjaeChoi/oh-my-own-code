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
