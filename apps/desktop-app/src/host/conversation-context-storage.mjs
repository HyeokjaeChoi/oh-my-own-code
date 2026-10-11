// Private cancellation authority in the existing operation journal. No inbox bodies.
import { isDeepStrictEqual } from "node:util";
export const INBOX_CANCEL_FEATURE = "conversation_context_cancel_v1";
export const INBOX_CANCEL_STEP = "native.inbox.cancel";
export const INBOX_CANCEL_RESULT_FIELDS = Object.freeze([
  "kind",
  "workspaceId",
  "sessionId",
  "inboxId",
  "digest",
]);
export const isInboxCancel = (type) => type === "session.inbox.cancel";
const policySteps = [
  "native.policy",
  "native.policy.before_selection",
  "native.policy.after_selection",
];
const id = (v, max = 256) =>
  typeof v === "string" &&
  new RegExp(`^[A-Za-z0-9_.:-]{1,${max}}$`, "u").test(v);
const hex = (v) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
const closed = (v, keys) =>
  Boolean(
    v &&
      Object.getPrototypeOf(v) === Object.prototype &&
      keys.every((k) => Object.hasOwn(v, k)) &&
      Reflect.ownKeys(v).every(
        (k) =>
          typeof k === "string" &&
          keys.includes(k) &&
          Object.hasOwn(Object.getOwnPropertyDescriptor(v, k), "value"),
      ),
  );
const need = (ok, code = "identity_conflict") => {
  if (!ok) throw Object.assign(new Error(code), { code });
};
export const validInboxTarget = (v) => closed(v, ["inboxId"]) && id(v.inboxId);
export function inboxTargetAdmission(operation) {
  const target = { inboxId: operation.inboxId };
  need(
    isInboxCancel(operation.type) && validInboxTarget(target),
    "invalid_record",
  );
  return target;
}
export function validateInboxCancelScope(identity) {
  if (isInboxCancel(identity.type))
    need(id(identity.workspaceId) && id(identity.sessionId), "invalid_record");
}
export function validateInboxCancelAdmission(value) {
  validateInboxCancelScope(value.identity);
  need(
    isInboxCancel(value.identity.type)
      ? validInboxTarget(value.inboxTarget)
      : !Object.hasOwn(value, "inboxTarget"),
    "invalid_record",
  );
  if (isInboxCancel(value.identity.type))
    need(
      ![
        "nativeServerName",
        "nativeSessionId",
        "fileTarget",
        "gitIndexTarget",
        "gitCommitTarget",
        "gitBranchRestoreTarget",
        "agentRuntime",
        "skillRuntime",
        "agentSourceName",
        "skillSourceName",
      ].some((k) => Object.hasOwn(value, k)),
      "invalid_record",
    );
}
export function validateInboxCancelDispatchPayload(value) {
  need(
    value.step === INBOX_CANCEL_STEP
      ? validInboxTarget(value.inboxTarget)
      : !Object.hasOwn(value, "inboxTarget"),
    "invalid_record",
  );
  if (value.step === INBOX_CANCEL_STEP)
    need(
      Reflect.ownKeys(value).every((k) =>
        [
          "kind",
          "revision",
          "runtimeEpoch",
          "operationId",
          "step",
          "inboxTarget",
        ].includes(k),
      ),
      "invalid_record",
    );
}
export function validateInboxCancelDispatch(operation, dispatch) {
  validateInboxCancelDispatchPayload(dispatch);
  if (!isInboxCancel(operation.identity.type)) {
    need(dispatch.step !== INBOX_CANCEL_STEP);
    return;
  }
  const steps = operation.dispatches.map((d) => d.step);
  need(
    !operation.completedDelta &&
      validInboxTarget(operation.inboxTarget) &&
      !operation.reservation &&
      !operation.reserved &&
      !steps.includes(dispatch.step) &&
      !steps.includes(INBOX_CANCEL_STEP) &&
      Reflect.ownKeys(dispatch).every((k) =>
        [
          "kind",
          "revision",
          "runtimeEpoch",
          "operationId",
          "step",
          "inboxTarget",
        ].includes(k),
      ),
  );
  if (dispatch.step === INBOX_CANCEL_STEP)
    need(
      isDeepStrictEqual(dispatch.inboxTarget, operation.inboxTarget) &&
        steps.includes("native.policy.before_selection") &&
        steps.includes("native.policy.after_selection"),
    );
  else {
    need(policySteps.includes(dispatch.step));
    if (dispatch.step === "native.policy") need(steps.length === 0);
    if (dispatch.step === "native.policy.before_selection")
      need(!steps.includes("native.policy.after_selection"));
    if (dispatch.step === "native.policy.after_selection")
      need(steps.includes("native.policy.before_selection"));
  }
}
const requestedShape = (record) => {
  const r = record.result;
  return Boolean(
    isInboxCancel(record.type) &&
      id(record.runtimeEpoch, 128) &&
      id(record.operationId, 128) &&
      id(record.workspaceId) &&
      id(record.sessionId) &&
      record.admission === "dispatched" &&
      record.delivery === "accepted" &&
      record.effect === "confirmed" &&
      closed(r, INBOX_CANCEL_RESULT_FIELDS) &&
      r.kind === "inbox_cancel_requested" &&
      r.workspaceId === record.workspaceId &&
      r.sessionId === record.sessionId &&
      id(r.inboxId) &&
      hex(r.digest),
  );
};
// The result cannot supply its own target or original digest authority.
export function validInboxCancelRequestedResult(
  record,
  inboxTarget,
  originalDigest,
) {
  return (
    requestedShape(record) &&
    validInboxTarget(inboxTarget) &&
    hex(originalDigest) &&
    record.result.inboxId === inboxTarget.inboxId &&
    record.result.digest === originalDigest
  );
}
export function validateInboxCancelReceipt(value) {
  if (!isInboxCancel(value.type)) {
    need(value.result?.kind !== "inbox_cancel_requested", "invalid_record");
    return;
  }
  validateInboxCancelScope(value);
  if (value.effect === "confirmed")
    need(requestedShape(value), "invalid_record");
  else
    need(
      (value.result === undefined ||
        (value.result.kind === "rejected" &&
          value.admission === "rejected" &&
          value.effect === "none")) &&
        !(value.delivery === "accepted" && value.effect === "none"),
      "invalid_record",
    );
}
export function validateInboxCancelCompletion(operation, payload, features) {
  if (!isInboxCancel(operation.identity.type)) return;
  need(features.includes(INBOX_CANCEL_FEATURE), "unsupported_version");
  const { receipt, delta } = payload;
  validateInboxCancelReceipt(receipt);
  need(
    ["runtimeEpoch", "operationId", "type", "workspaceId", "sessionId"].every(
      (k) => receipt[k] === operation.identity[k],
    ) &&
      !operation.reservation &&
      !operation.reserved &&
      delta.workspaces.length === 0 &&
      delta.sessions.length === 0 &&
      delta.tombstones.length === 0,
  );
  if (receipt.effect === "confirmed")
    need(
      (!operation.completedDelta ||
        operation.receipt?.effect === "confirmed") &&
        validInboxCancelRequestedResult(
          receipt,
          operation.inboxTarget,
          operation.identity.digest,
        ) &&
        operation.dispatches.at(-1)?.step === INBOX_CANCEL_STEP &&
        operation.dispatches.some(
          (d) => d.step === "native.policy.before_selection",
        ) &&
        operation.dispatches.some(
          (d) => d.step === "native.policy.after_selection",
        ) &&
        isDeepStrictEqual(
          operation.dispatches.at(-1).inboxTarget,
          operation.inboxTarget,
        ),
    );
  else
    need(
      receipt.result === undefined ||
        (receipt.result.kind === "rejected" &&
          receipt.admission === "rejected" &&
          receipt.effect === "none" &&
          operation.dispatches.length === 0),
    );
  need(receipt.effect !== "none" || operation.dispatches.length === 0);
}
