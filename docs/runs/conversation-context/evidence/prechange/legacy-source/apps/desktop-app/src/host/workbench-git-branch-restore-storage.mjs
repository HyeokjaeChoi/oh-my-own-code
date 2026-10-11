// Private durable authority. Retain only the exact public target, never proposal bytes.
import { isDeepStrictEqual } from "node:util";
import {
  GIT_BRANCH_RESTORE_FEATURE,
  GIT_BRANCH_RESTORE_STEPS,
  gitBranchRestoreTargetFromApply,
  validGitBranchRestoreTarget,
  validateGitBranchRestoreMutationResult,
  validateGitBranchRestoreReceiptResult,
} from "../renderer/shared/git-branch-restore/index.mjs";
export { GIT_BRANCH_RESTORE_FEATURE, GIT_BRANCH_RESTORE_STEPS };
export const isGitBranchRestoreApply = (type) =>
  ["git.branch.apply", "git.restore.apply"].includes(type);
export const gitBranchRestoreTargetAdmission = gitBranchRestoreTargetFromApply;
export const GIT_BRANCH_RESTORE_RESULT_FIELDS = Object.freeze([
  "kind",
  "workspaceId",
  "action",
  "previewDigest",
  "paths",
  "metadata",
  "backups",
  "digest",
]);
import { gitBranchRestoreExpectedBackups } from "./git-branch-restore-contract.mjs";
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
export function validateGitBranchRestoreScope(identity) {
  if (isGitBranchRestoreApply(identity.type))
    need(
      id(identity.workspaceId, 256) && !Object.hasOwn(identity, "sessionId"),
      "invalid_record",
    );
}
export function validateGitBranchRestoreAdmission(value) {
  validateGitBranchRestoreScope(value.identity);
  if (isGitBranchRestoreApply(value.identity.type))
    need(
      Number.isSafeInteger(value.expectedRevision) &&
        value.expectedRevision >= 0 &&
        ![
          "nativeSessionId",
          "nativeServerName",
          "agentRuntime",
          "skillRuntime",
          "fileTarget",
          "gitIndexTarget",
          "gitCommitTarget",
          "agentSourceName",
          "skillSourceName",
        ].some((k) => Object.hasOwn(value, k)),
      "invalid_record",
    );

  need(
    isGitBranchRestoreApply(value.identity.type)
      ? validGitBranchRestoreTarget(value.gitBranchRestoreTarget) &&
          (value.identity.type === "git.restore.apply") ===
            (value.gitBranchRestoreTarget.action === "restore")
      : !Object.hasOwn(value, "gitBranchRestoreTarget"),
    "invalid_record",
  );
}
export function validateGitBranchRestoreDispatchPayload(value) {
  const fields = ["step", "gitBranchRestoreTarget"];
  const optional = ["kind", "revision", "runtimeEpoch", "operationId"];

  const selected = Object.values(GIT_BRANCH_RESTORE_STEPS).includes(value.step);
  need(
    selected
      ? validGitBranchRestoreTarget(value.gitBranchRestoreTarget)
      : !Object.hasOwn(value, "gitBranchRestoreTarget"),
    "invalid_record",
  );
  if (selected)
    need(
      value &&
        Object.getPrototypeOf(value) === Object.prototype &&
        Reflect.ownKeys(value).every(
          (k) =>
            [...fields, ...optional].includes(k) &&
            Object.hasOwn(
              Object.getOwnPropertyDescriptor(value, k) ?? {},
              "value",
            ),
        ) &&
        ![
          "nativeSessionId",
          "nativeServerName",
          "agentRuntime",
          "skillRuntime",
          "fileTarget",
          "gitIndexTarget",
          "gitCommitTarget",
        ].some((k) => Object.hasOwn(value, k)),
      "invalid_record",
    );
}
export function validateGitBranchRestoreDispatch(operation, dispatch) {
  if (!isGitBranchRestoreApply(operation.identity.type)) {
    need(
      !Object.hasOwn(dispatch, "gitBranchRestoreTarget") &&
        !Object.values(GIT_BRANCH_RESTORE_STEPS).includes(dispatch.step),
    );
    return;
  }
  validateGitBranchRestoreDispatchPayload(dispatch);
  need(!operation.completedDelta);
  const { dispatches, gitBranchRestoreTarget } = operation;
  need(
    validGitBranchRestoreTarget(gitBranchRestoreTarget) &&
      isDeepStrictEqual(
        gitBranchRestoreTarget,
        dispatch.gitBranchRestoreTarget,
      ) &&
      dispatches.length < 2 &&
      dispatch.step ===
        [GIT_BRANCH_RESTORE_STEPS.stage, GIT_BRANCH_RESTORE_STEPS.publish][
          dispatches.length
        ] &&
      (dispatches.length === 0 ||
        (dispatches[0].step === GIT_BRANCH_RESTORE_STEPS.stage &&
          isDeepStrictEqual(
            dispatches[0].gitBranchRestoreTarget,
            gitBranchRestoreTarget,
          ))),
  );
}
function savedShape(record) {
  return Boolean(
    isGitBranchRestoreApply(record.type) &&
      id(record.runtimeEpoch) &&
      id(record.operationId) &&
      id(record.workspaceId, 256) &&
      !Object.hasOwn(record, "sessionId") &&
      record.admission === "dispatched" &&
      record.delivery === "accepted" &&
      record.effect === "confirmed" &&
      closed(record.result, GIT_BRANCH_RESTORE_RESULT_FIELDS),
  );
}
// Result cannot provide its own authority: use the admitted target and original digest.
export function validGitBranchRestoreAppliedResult(
  record,
  gitBranchRestoreTarget,
  originalDigest,
) {
  if (
    !savedShape(record) ||
    !validGitBranchRestoreTarget(gitBranchRestoreTarget) ||
    !hex(originalDigest) ||
    (record.type === "git.restore.apply") !==
      (gitBranchRestoreTarget.action === "restore")
  )
    return false;
  try {
    validateGitBranchRestoreReceiptResult(record.result, {
      workspaceId: record.workspaceId,
      target: gitBranchRestoreTarget,
      digest: originalDigest,
      backups: gitBranchRestoreExpectedBackups(
        gitBranchRestoreTarget,
        record.runtimeEpoch,
        record.operationId,
      ),
    });
    return true;
  } catch {
    return false;
  }
}
export function validateGitBranchRestoreReceipt(value) {
  if (!isGitBranchRestoreApply(value.type)) {
    need(value.result?.kind !== "git_branch_restore_applied", "invalid_record");
    return;
  }
  validateGitBranchRestoreScope(value);
  if (value.effect === "confirmed") {
    need(savedShape(value), "invalid_record");
    // Structural check only. Completion independently binds to durable admission.
    const r = value.result;
    try {
      validateGitBranchRestoreMutationResult({
        requestId: value.operationId,
        status: "applied",
        action: r.action,
        previewDigest: r.previewDigest,
        paths: r.paths,
        metadata: r.metadata,
        backups: r.backups,
      });
      need(
        r.kind === "git_branch_restore_applied" &&
          r.workspaceId === value.workspaceId &&
          hex(r.digest) &&
          (value.type === "git.restore.apply") === (r.action === "restore"),
        "invalid_record",
      );
    } catch {
      need(false, "invalid_record");
    }
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
export function validateGitBranchRestoreCompletion(
  operation,
  payload,
  features,
) {
  if (!isGitBranchRestoreApply(operation.identity.type)) return;
  need(features.includes(GIT_BRANCH_RESTORE_FEATURE), "unsupported_version");
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
      validGitBranchRestoreAppliedResult(
        receipt,
        operation.gitBranchRestoreTarget,
        operation.identity.digest,
      ) &&
        operation.dispatches.length === 2 &&
        operation.dispatches[0].step === GIT_BRANCH_RESTORE_STEPS.stage &&
        operation.dispatches[1].step === GIT_BRANCH_RESTORE_STEPS.publish &&
        operation.dispatches.every((d) =>
          isDeepStrictEqual(
            d.gitBranchRestoreTarget,
            operation.gitBranchRestoreTarget,
          ),
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
