// Private durable authority. Retain only the exact public target, never proposal bytes.
import { isDeepStrictEqual } from "node:util";
import {
  GIT_COMMIT_FEATURE,
  GIT_COMMIT_STEPS,
  gitCommitTargetFromApply,
  validGitCommitTarget,
  validateGitCommitMutationResult,
  validateGitCommitReceiptResult,
} from "../renderer/shared/git-commit/index.mjs";
export { GIT_COMMIT_FEATURE, GIT_COMMIT_STEPS };
export const isGitCommitApply = (type) => type === "git.commit.apply";
export const gitCommitTargetAdmission = gitCommitTargetFromApply;
export const GIT_COMMIT_RESULT_FIELDS = Object.freeze([
  "kind",
  "workspaceId",
  "commitOid",
  "treeOid",
  "parentOid",
  "referenceDigest",
  "logDigests",
  "previewDigest",
  "backups",
  "digest",
]);
import { gitCommitExpectedBackups } from "./git-commit-contract.mjs";
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
export function validateGitCommitScope(identity) {
  if (isGitCommitApply(identity.type))
    need(
      id(identity.workspaceId, 256) && !Object.hasOwn(identity, "sessionId"),
      "invalid_record",
    );
}
export function validateGitCommitAdmission(value) {
  validateGitCommitScope(value.identity);
  if (isGitCommitApply(value.identity.type))
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
          "agentSourceName",
          "skillSourceName",
        ].some((k) => Object.hasOwn(value, k)),
      "invalid_record",
    );
  else need(!Object.hasOwn(value, "expectedRevision"), "invalid_record");
  need(
    isGitCommitApply(value.identity.type)
      ? validGitCommitTarget(value.gitCommitTarget)
      : !Object.hasOwn(value, "gitCommitTarget"),
    "invalid_record",
  );
}
export function validateGitCommitDispatchPayload(value) {
  const selected = Object.values(GIT_COMMIT_STEPS).includes(value.step);
  need(
    selected
      ? validGitCommitTarget(value.gitCommitTarget)
      : !Object.hasOwn(value, "gitCommitTarget"),
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
        "gitIndexTarget",
      ].some((k) => Object.hasOwn(value, k)),
      "invalid_record",
    );
}
export function validateGitCommitDispatch(operation, dispatch) {
  if (!isGitCommitApply(operation.identity.type)) {
    need(
      !Object.hasOwn(dispatch, "gitCommitTarget") &&
        !Object.values(GIT_COMMIT_STEPS).includes(dispatch.step),
    );
    return;
  }
  validateGitCommitDispatchPayload(dispatch);
  need(!operation.completedDelta);
  const { dispatches, gitCommitTarget } = operation;
  need(
    validGitCommitTarget(gitCommitTarget) &&
      isDeepStrictEqual(gitCommitTarget, dispatch.gitCommitTarget) &&
      dispatches.length < 2 &&
      dispatch.step ===
        [GIT_COMMIT_STEPS.stage, GIT_COMMIT_STEPS.publish][dispatches.length] &&
      (dispatches.length === 0 ||
        (dispatches[0].step === GIT_COMMIT_STEPS.stage &&
          isDeepStrictEqual(dispatches[0].gitCommitTarget, gitCommitTarget))),
  );
}
function savedShape(record) {
  return Boolean(
    isGitCommitApply(record.type) &&
      id(record.runtimeEpoch) &&
      id(record.operationId) &&
      id(record.workspaceId, 256) &&
      !Object.hasOwn(record, "sessionId") &&
      record.admission === "dispatched" &&
      record.delivery === "accepted" &&
      record.effect === "confirmed" &&
      closed(record.result, GIT_COMMIT_RESULT_FIELDS),
  );
}
// Result cannot provide its own authority: use the admitted target and original digest.
export function validGitCommitCreatedResult(
  record,
  gitCommitTarget,
  originalDigest,
) {
  if (
    !savedShape(record) ||
    !validGitCommitTarget(gitCommitTarget) ||
    !hex(originalDigest)
  )
    return false;
  try {
    validateGitCommitReceiptResult(record.result, {
      workspaceId: record.workspaceId,
      target: gitCommitTarget,
      digest: originalDigest,
      backups: gitCommitExpectedBackups(
        gitCommitTarget,
        record.runtimeEpoch,
        record.operationId,
      ),
    });
    return true;
  } catch {
    return false;
  }
}
export function validateGitCommitReceipt(value) {
  if (!isGitCommitApply(value.type)) {
    need(value.result?.kind !== "git_commit_created", "invalid_record");
    return;
  }
  validateGitCommitScope(value);
  if (value.effect === "confirmed") {
    need(savedShape(value), "invalid_record");
    // Structural check only. Completion independently binds to durable admission.
    const r = value.result;
    try {
      validateGitCommitMutationResult({
        requestId: value.operationId,
        status: "committed",
        commitOid: r.commitOid,
        treeOid: r.treeOid,
        referenceDigest: r.referenceDigest,
        logDigests: r.logDigests,
        backups: r.backups,
      });
      need(
        r.kind === "git_commit_created" &&
          r.workspaceId === value.workspaceId &&
          (r.parentOid === null ||
            (typeof r.parentOid === "string" &&
              r.parentOid.length === r.commitOid.length &&
              /^[a-f0-9]+$/u.test(r.parentOid))) &&
          hex(r.previewDigest) &&
          hex(r.digest),
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
export function validateGitCommitCompletion(operation, payload, features) {
  if (!isGitCommitApply(operation.identity.type)) return;
  need(features.includes(GIT_COMMIT_FEATURE), "unsupported_version");
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
      validGitCommitCreatedResult(
        receipt,
        operation.gitCommitTarget,
        operation.identity.digest,
      ) &&
        operation.dispatches.length === 2 &&
        operation.dispatches[0].step === GIT_COMMIT_STEPS.stage &&
        operation.dispatches[1].step === GIT_COMMIT_STEPS.publish &&
        operation.dispatches.every((d) =>
          isDeepStrictEqual(d.gitCommitTarget, operation.gitCommitTarget),
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
