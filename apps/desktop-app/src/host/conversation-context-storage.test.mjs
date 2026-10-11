import test from "node:test";
import assert from "node:assert/strict";
import {
  inboxTargetAdmission,
  validInboxTarget,
  validInboxCancelRequestedResult,
  validateInboxCancelAdmission,
  validateInboxCancelDispatchPayload,
  validateInboxCancelReceipt,
} from "./conversation-context-storage.mjs";
import { redactReceipt } from "./workbench-receipts.mjs";
const record = () => ({
  runtimeEpoch: "epoch",
  operationId: "cancel",
  type: "session.inbox.cancel",
  workspaceId: "workspace",
  sessionId: "session",
  digest: "a".repeat(64),
  inboxTarget: { inboxId: "pending-1" },
  admission: "dispatched",
  delivery: "accepted",
  effect: "confirmed",
  revision: 1,
  evidence: [],
  result: {
    kind: "inbox_cancel_requested",
    workspaceId: "workspace",
    sessionId: "session",
    inboxId: "pending-1",
    digest: "a".repeat(64),
  },
});
test("CTX-CANCEL helper target is closed, bounded and has no accessor or Native payload authority", () => {
  const request = { type: "session.inbox.cancel", inboxId: "pending-1" };
  const target = inboxTargetAdmission(request);
  request.inboxId = "changed";
  assert.deepEqual(target, { inboxId: "pending-1" });
  let reads = 0;
  const accessor = Object.defineProperty({}, "inboxId", {
    enumerable: true,
    get() {
      reads++;
      return "pending-1";
    },
  });
  for (const bad of [
    null,
    [],
    {},
    { inboxId: "" },
    { inboxId: "a".repeat(257) },
    { inboxId: "space id" },
    { inboxId: "pending-1", body: "PRIVATE" },
    Object.create({ inboxId: "pending-1" }),
    accessor,
    { ...target, [Symbol("token")]: "PRIVATE" },
  ])
    assert.equal(validInboxTarget(bad), false);
  assert.equal(reads, 0);
  assert.equal(validInboxTarget({ inboxId: "a".repeat(256) }), true);
  for (const field of [
    "nativeSessionId",
    "nativeServerName",
    "agentRuntime",
    "skillRuntime",
    "fileTarget",
    "gitIndexTarget",
    "gitCommitTarget",
    "gitBranchRestoreTarget",
  ])
    assert.throws(
      () =>
        validateInboxCancelAdmission({
          identity: record(),
          inboxTarget: target,
          [field]: "PRIVATE",
        }),
      { code: "invalid_record" },
    );
  assert.throws(
    () =>
      validateInboxCancelAdmission({
        identity: { ...record(), type: "message.send" },
        inboxTarget: target,
      }),
    { code: "invalid_record" },
  );
  assert.throws(
    () =>
      validateInboxCancelDispatchPayload({
        step: "native.policy.before_selection",
        inboxTarget: target,
      }),
    { code: "invalid_record" },
  );
});
test("CTX-CANCEL redaction requires independent admitted target and original digest", () => {
  const r = record();
  assert.equal(
    validInboxCancelRequestedResult(r, r.inboxTarget, r.digest),
    true,
  );
  assert.deepEqual(redactReceipt(r).result, r.result);
  const safe = redactReceipt(r);
  safe.result.inboxId = "changed";
  assert.equal(r.result.inboxId, "pending-1");
  assert.equal(Object.hasOwn(safe, "inboxTarget"), false);
  assert.equal(Object.hasOwn(safe, "digest"), false);
  for (const patch of [
    { inboxTarget: undefined },
    { digest: undefined },
    { digest: "f".repeat(64) },
    { inboxTarget: { inboxId: "other" } },
    { type: "message.send" },
    { admission: "admitted" },
    { delivery: "unknown" },
    { effect: "unknown" },
    { workspaceId: "other" },
    { sessionId: "other" },
  ])
    assert.equal(redactReceipt({ ...r, ...patch }).result, undefined);
  for (const patch of [
    { body: "PRIVATE" },
    { attachments: [] },
    { bytes: "PRIVATE" },
    { token: "PRIVATE" },
    { nativeSessionId: "PRIVATE" },
    { inboxId: "other" },
    { digest: "f".repeat(64) },
    { workspaceId: "other" },
    { sessionId: "other" },
    { kind: "cancelled" },
  ])
    assert.equal(
      redactReceipt({ ...r, result: { ...r.result, ...patch } }).result,
      undefined,
    );
  for (const effect of ["none", "unknown", "pending"])
    assert.throws(() => validateInboxCancelReceipt({ ...r, effect }), {
      code: "invalid_record",
    });
  const { inboxTarget: _target, digest: _digest, ...receipt } = r;
  assert.throws(
    () => validateInboxCancelReceipt({ ...receipt, type: "message.send" }),
    { code: "invalid_record" },
  );
});
