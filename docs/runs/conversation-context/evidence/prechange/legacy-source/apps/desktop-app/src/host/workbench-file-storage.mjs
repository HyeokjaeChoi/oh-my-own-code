// Private durable file authority. Never retain text, absolute roots or stage tokens.
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  WORKSPACE_FILE_FEATURE,
  workspaceFilePathReason,
} from "../renderer/shared/workspace-file/index.mjs";
export const FILE_FEATURE = WORKSPACE_FILE_FEATURE;
export const FILE_TARGET_FIELDS = Object.freeze([
  "path",
  "version",
  "directoryVersion",
]);
export const FILE_RESULT_FIELDS = Object.freeze([
  "kind",
  "workspaceId",
  "path",
  "version",
  "digest",
  "backupId",
]);
export const isFileSave = (type) => type === "file.save";
const hex = (v) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
const id = (v, max = 128) =>
  typeof v === "string" &&
  new RegExp(`^[A-Za-z0-9_.:-]{1,${max}}$`, "u").test(v);
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
export const validFileTarget = (v) =>
  closed(v, FILE_TARGET_FIELDS) &&
  workspaceFilePathReason(v.path) === undefined &&
  hex(v.version) &&
  hex(v.directoryVersion);
export function fileTargetAdmission(operation) {
  const target = Object.fromEntries(
    FILE_TARGET_FIELDS.map((k) => [k, operation[k]]),
  );
  need(
    isFileSave(operation.type) &&
      operation.expectation === "version" &&
      validFileTarget(target),
    "invalid_record",
  );
  return target;
}
export function fileBackupId(runtimeEpoch, operationId) {
  need(id(runtimeEpoch) && id(operationId), "invalid_record");
  const hash = createHash("sha256")
    .update(JSON.stringify([runtimeEpoch, operationId]))
    .digest("hex");
  return `.omoc-configuration-${hash}.file.backup`;
}
export function validateFileScope(identity) {
  if (isFileSave(identity.type))
    need(
      id(identity.workspaceId, 256) && !Object.hasOwn(identity, "sessionId"),
      "invalid_record",
    );
}
export function validateFileAdmission(value) {
  need(
    isFileSave(value.identity.type)
      ? validFileTarget(value.fileTarget)
      : !Object.hasOwn(value, "fileTarget"),
    "invalid_record",
  );
}
export function validateFileDispatchPayload(value) {
  if (!Object.hasOwn(value, "fileTarget")) return;
  need(
    validFileTarget(value.fileTarget) &&
      [
        "filesystem.configuration.stage",
        "filesystem.configuration.publish",
      ].includes(value.step),
    "invalid_record",
  );
}
export function validateFileDispatch(operation, dispatch) {
  if (!isFileSave(operation.identity.type)) {
    need(!Object.hasOwn(dispatch, "fileTarget"));
    return;
  }
  need(
    validFileTarget(operation.fileTarget) &&
      validFileTarget(dispatch.fileTarget) &&
      isDeepStrictEqual(operation.fileTarget, dispatch.fileTarget) &&
      ![
        "nativeSessionId",
        "nativeServerName",
        "agentRuntime",
        "skillRuntime",
      ].some((k) => Object.hasOwn(dispatch, k)) &&
      [
        "filesystem.configuration.stage",
        "filesystem.configuration.publish",
      ].includes(dispatch.step) &&
      (dispatch.step !== "filesystem.configuration.publish" ||
        (operation.dispatches.length >= 1 &&
          operation.dispatches[0].step === "filesystem.configuration.stage" &&
          isDeepStrictEqual(
            operation.dispatches[0].fileTarget,
            operation.fileTarget,
          ))),
  );
}
const savedShape = (record) => {
  const r = record.result;
  return Boolean(
    isFileSave(record.type) &&
      id(record.runtimeEpoch) &&
      id(record.operationId) &&
      id(record.workspaceId, 256) &&
      record.sessionId === undefined &&
      record.admission === "dispatched" &&
      record.delivery === "accepted" &&
      record.effect === "confirmed" &&
      closed(r, FILE_RESULT_FIELDS) &&
      r.kind === "file_saved" &&
      r.workspaceId === record.workspaceId &&
      workspaceFilePathReason(r.path) === undefined &&
      hex(r.version) &&
      hex(r.digest) &&
      r.backupId === fileBackupId(record.runtimeEpoch, record.operationId),
  );
};
// Projection requires independent private admission authority; never self-bind a result.
export function validFileSavedResult(record, fileTarget, originalDigest) {
  return (
    savedShape(record) &&
    validFileTarget(fileTarget) &&
    hex(originalDigest) &&
    record.result.path === fileTarget.path &&
    record.result.digest === originalDigest
  );
}
export function validateFileReceipt(value) {
  if (!isFileSave(value.type)) {
    need(value.result?.kind !== "file_saved", "invalid_record");
    return;
  }
  validateFileScope(value);
  if (value.effect === "confirmed") need(savedShape(value), "invalid_record");
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
export function validateFileCompletion(operation, payload, features) {
  if (!isFileSave(operation.identity.type)) return;
  need(features.includes(FILE_FEATURE), "unsupported_version");
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
      validFileSavedResult(
        receipt,
        operation.fileTarget,
        operation.identity.digest,
      ) &&
        operation.dispatches.length === 2 &&
        operation.dispatches[0].step === "filesystem.configuration.stage" &&
        operation.dispatches[1].step === "filesystem.configuration.publish" &&
        operation.dispatches.every((d) =>
          isDeepStrictEqual(d.fileTarget, operation.fileTarget),
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
}
