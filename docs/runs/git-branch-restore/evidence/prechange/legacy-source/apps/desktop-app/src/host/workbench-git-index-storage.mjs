// Private durable authority. Retain only the exact public target, never proposal bytes.
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  GIT_INDEX_FEATURE,
  GIT_INDEX_STEPS,
  gitIndexTargetFromApply,
  validGitIndexTarget,
  validGitIndexPaths,
  validateGitIndexReceiptResult,
} from "../renderer/shared/git-index/index.mjs";
export { GIT_INDEX_FEATURE, GIT_INDEX_STEPS };
export const isGitIndexApply = (type) => type === "git.index.apply";
export const gitIndexTargetAdmission = gitIndexTargetFromApply;
export const GIT_INDEX_RESULT_FIELDS = Object.freeze([
  "kind",
  "workspaceId",
  "action",
  "paths",
  "indexDigest",
  "previewDigest",
  "backupId",
  "digest",
]);
const id = (v, max = 128) =>
  typeof v === "string" &&
  new RegExp(`^[A-Za-z0-9_.:-]{1,${max}}$`, "u").test(v);
const hex = (v) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
const need = (ok, code = "identity_conflict") => {
  if (!ok) throw Object.assign(new Error(code), { code });
};
const closed = (v, fields) =>
  Boolean(
    v &&
      Object.getPrototypeOf(v) === Object.prototype &&
      Reflect.ownKeys(v).length === fields.length &&
      fields.every((k) =>
        Object.hasOwn(Object.getOwnPropertyDescriptor(v, k) ?? {}, "value"),
      ),
  );
export function gitIndexBackupId(runtimeEpoch, operationId) {
  need(id(runtimeEpoch) && id(operationId), "invalid_record");
  return `.omoc-git-index-${createHash("sha256")
    .update(JSON.stringify([runtimeEpoch, operationId]))
    .digest("hex")}.backup`;
}
export function validateGitIndexScope(identity) {
  if (isGitIndexApply(identity.type))
    need(
      id(identity.workspaceId, 256) && !Object.hasOwn(identity, "sessionId"),
      "invalid_record",
    );
}
export function validateGitIndexAdmission(value) {
  validateGitIndexScope(value.identity);
  need(
    isGitIndexApply(value.identity.type)
      ? validGitIndexTarget(value.gitIndexTarget)
      : !Object.hasOwn(value, "gitIndexTarget"),
    "invalid_record",
  );
}
export function validateGitIndexDispatchPayload(value) {
  const selected = Object.values(GIT_INDEX_STEPS).includes(value.step);
  need(
    selected
      ? validGitIndexTarget(value.gitIndexTarget)
      : !Object.hasOwn(value, "gitIndexTarget"),
    "invalid_record",
  );
  if (selected)
    need(
      ![
        "nativeSessionId",
        "nativeServerName",
        "agentRuntime",
        "skillRuntime",
        "fileTarget",
      ].some((k) => Object.hasOwn(value, k)),
      "invalid_record",
    );
}
export function validateGitIndexDispatch(operation, dispatch) {
  if (!isGitIndexApply(operation.identity.type)) {
    need(
      !Object.hasOwn(dispatch, "gitIndexTarget") &&
        !Object.values(GIT_INDEX_STEPS).includes(dispatch.step),
    );
    return;
  }
  validateGitIndexDispatchPayload(dispatch);
  need(!operation.completedDelta);
  const { dispatches, gitIndexTarget } = operation;
  need(
    validGitIndexTarget(gitIndexTarget) &&
      isDeepStrictEqual(gitIndexTarget, dispatch.gitIndexTarget) &&
      dispatches.length < 2 &&
      dispatch.step ===
        [GIT_INDEX_STEPS.stage, GIT_INDEX_STEPS.publish][dispatches.length] &&
      (dispatches.length === 0 ||
        (dispatches[0].step === GIT_INDEX_STEPS.stage &&
          isDeepStrictEqual(dispatches[0].gitIndexTarget, gitIndexTarget))),
  );
}
function savedShape(record) {
  return Boolean(
    isGitIndexApply(record.type) &&
      id(record.runtimeEpoch) &&
      id(record.operationId) &&
      id(record.workspaceId, 256) &&
      !Object.hasOwn(record, "sessionId") &&
      record.admission === "dispatched" &&
      record.delivery === "accepted" &&
      record.effect === "confirmed" &&
      closed(record.result, GIT_INDEX_RESULT_FIELDS),
  );
}
// Result cannot provide its own authority: use the admitted target and original digest.
export function validGitIndexUpdatedResult(
  record,
  gitIndexTarget,
  originalDigest,
) {
  if (
    !savedShape(record) ||
    !validGitIndexTarget(gitIndexTarget) ||
    !hex(originalDigest)
  )
    return false;
  try {
    validateGitIndexReceiptResult(record.result, {
      workspaceId: record.workspaceId,
      target: gitIndexTarget,
      digest: originalDigest,
      backupId: gitIndexTarget.indexExists
        ? gitIndexBackupId(record.runtimeEpoch, record.operationId)
        : null,
    });
    return true;
  } catch {
    return false;
  }
}
export function validateGitIndexReceipt(value) {
  if (!isGitIndexApply(value.type)) {
    need(value.result?.kind !== "git_index_updated", "invalid_record");
    return;
  }
  validateGitIndexScope(value);
  if (value.effect === "confirmed") {
    need(savedShape(value), "invalid_record");
    // Structural check only. Completion independently binds to durable admission.
    const r = value.result;
    need(
      r.kind === "git_index_updated" &&
        r.workspaceId === value.workspaceId &&
        validGitIndexPaths(r.paths) &&
        (r.action === "stage" || r.action === "unstage") &&
        hex(r.indexDigest) &&
        hex(r.previewDigest) &&
        hex(r.digest) &&
        (r.backupId === null ||
          r.backupId ===
            gitIndexBackupId(value.runtimeEpoch, value.operationId)),
      "invalid_record",
    );
  } else
    need(
      (value.result === undefined ||
        (value.result.kind === "rejected" &&
          value.admission === "rejected" &&
          value.effect === "none")) &&
        !(value.delivery === "accepted" && value.effect === "none"),
      "invalid_record",
    );
}
export function validateGitIndexCompletion(operation, payload, features) {
  if (!isGitIndexApply(operation.identity.type)) return;
  need(features.includes(GIT_INDEX_FEATURE), "unsupported_version");
  const { receipt, delta } = payload;
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
      validGitIndexUpdatedResult(
        receipt,
        operation.gitIndexTarget,
        operation.identity.digest,
      ) &&
        operation.dispatches.length === 2 &&
        operation.dispatches[0].step === GIT_INDEX_STEPS.stage &&
        operation.dispatches[1].step === GIT_INDEX_STEPS.publish &&
        operation.dispatches.every((d) =>
          isDeepStrictEqual(d.gitIndexTarget, operation.gitIndexTarget),
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
  need(
    !(
      receipt.effect === "confirmed" &&
      operation.completedDelta &&
      operation.receipt?.effect !== "confirmed"
    ),
  );
}
