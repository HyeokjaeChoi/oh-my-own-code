// Private before-message fork authority. Never persist request text or attachments.
import { isDeepStrictEqual } from "node:util";
import { validWireId } from "../workbench-contract.mjs";

export const BEFORE_BRANCH_FEATURE = "conversation_context_before_branch_v1";
const need = (ok, code = "identity_conflict") => {
  if (!ok) throw Object.assign(new Error(code), { code });
};
export function validForkTarget(value) {
  return Boolean(
    value &&
      Object.getPrototypeOf(value) === Object.prototype &&
      Reflect.ownKeys(value).length === 1 &&
      Object.hasOwn(value, "beforeMessageId") &&
      Object.hasOwn(
        Object.getOwnPropertyDescriptor(value, "beforeMessageId"),
        "value",
      ) &&
      Object.getOwnPropertyDescriptor(value, "beforeMessageId").enumerable &&
      validWireId(value.beforeMessageId),
  );
}
export function forkTargetAdmission(operation) {
  if (operation.type !== "session.fork" || !Object.hasOwn(operation, "before"))
    return undefined;
  need(
    Object.hasOwn(
      Object.getOwnPropertyDescriptor(operation, "before"),
      "value",
    ) && validWireId(operation.before),
    "invalid_record",
  );
  return Object.freeze({ beforeMessageId: operation.before });
}
export function validateBeforeBranchAdmission(value) {
  if (!Object.hasOwn(value, "forkTarget")) return;
  need(
    value.identity.type === "session.fork" &&
      validForkTarget(value.forkTarget) &&
      typeof value.identity.workspaceId === "string" &&
      /^[A-Za-z0-9_.:-]{1,256}$/.test(value.identity.workspaceId) &&
      typeof value.identity.sessionId === "string" &&
      /^[A-Za-z0-9_.:-]{1,256}$/.test(value.identity.sessionId),
    "invalid_record",
  );
}
export function validateBeforeBranchDispatchPayload(value) {
  if (!Object.hasOwn(value, "forkTarget")) return;
  need(
    value.step === "native.fork" && validForkTarget(value.forkTarget),
    "invalid_record",
  );
  need(
    Reflect.ownKeys(value).every((k) =>
      [
        "kind",
        "revision",
        "runtimeEpoch",
        "operationId",
        "step",
        "nativeSessionId",
        "forkTarget",
      ].includes(k),
    ),
    "invalid_record",
  );
}
export function validateBeforeBranchDispatch(operation, dispatch) {
  validateBeforeBranchDispatchPayload(dispatch);
  if (!Object.hasOwn(operation, "forkTarget")) {
    need(!Object.hasOwn(dispatch, "forkTarget"));
    return;
  }
  need(
    !operation.completedDelta &&
      !operation.terminal &&
      !operation.dispatches.some((d) => d.step === dispatch.step),
  );
  if (dispatch.step === "native.fork")
    need(isDeepStrictEqual(dispatch.forkTarget, operation.forkTarget));
  else need(!Object.hasOwn(dispatch, "forkTarget"));
}
export function validateBeforeBranchCompletion(operation, payload, features) {
  if (!Object.hasOwn(operation, "forkTarget")) return;
  need(features.includes(BEFORE_BRANCH_FEATURE), "unsupported_version");
  const { receipt, delta } = payload;
  if (receipt.effect === "confirmed") {
    const fork = operation.dispatches.find((d) => d.step === "native.fork");
    const child = delta.sessions.find(
      (s) => s.appSessionId === operation.reservation?.appSessionId,
    );
    need(
      (!operation.completedDelta ||
        operation.receipt?.effect === "confirmed") &&
        fork &&
        isDeepStrictEqual(fork.forkTarget, operation.forkTarget) &&
        receipt.admission === "dispatched" &&
        receipt.delivery === "accepted" &&
        receipt.result?.kind === "forked" &&
        receipt.result.workspaceId === operation.identity.workspaceId &&
        child &&
        child.workspaceId === operation.identity.workspaceId &&
        child.parentSessionId === operation.identity.sessionId &&
        child.lifecycleState === "active" &&
        receipt.result.sessionId === child.appSessionId &&
        receipt.result.nativeSessionId === child.nativeSessionId,
    );
  }
}
