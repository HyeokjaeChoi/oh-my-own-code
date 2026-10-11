// Browser-safe selected index contracts. Importing this module performs no IO.
import {
  GIT_REVIEW_REASONS,
  validGitDigest,
  validGitOid,
} from "../git-review/index.mjs";
import {
  validWorkspaceFileRoot,
  workspaceFilePathReason,
} from "../workspace-file/index.mjs";

export const GIT_INDEX_FEATURE = "git_index_mutation_v1";
export const GIT_INDEX_STEPS = Object.freeze({
  stage: "filesystem.git.index.stage",
  publish: "filesystem.git.index.publish",
});
export const GIT_INDEX_LIMITS = Object.freeze({
  paths: 128,
  pathBytes: 32768,
  dtoBytes: 196608,
  previewsPerWorkspace: 16,
  previews: 64,
  previewMs: 60000,
});
export const GIT_INDEX_REASONS = Object.freeze([
  ...GIT_REVIEW_REASONS,
  "protected_source",
  "missing_file",
  "conflict",
  "expired_observation",
  "stale_observation",
  "expired_preview",
  "stale_preview",
  "lock_conflict",
  "no_changes",
  "busy",
  "unsupported_index_mutation",
]);
export const GIT_INDEX_TARGET_FIELDS = Object.freeze([
  "action",
  "paths",
  "previewDigest",
  "headOid",
  "indexExists",
  "indexDigest",
  "nextIndexDigest",
  "objectFormat",
]);
// SHA256(UTF8("omoc-absent-git-index-v1")); not the hash of an empty file.
export const GIT_ABSENT_INDEX_DIGEST =
  "1e805e1eec918accfc6bba36e68b1a5f77c81ec7f1a7a90ed99b688b7b141eae";

const bytes = (text) => new globalThis.TextEncoder().encode(text).length;
const plain = (value) =>
  Boolean(
    value &&
      Object.getPrototypeOf(value) === Object.prototype &&
      Reflect.ownKeys(value).every(
        (key) =>
          typeof key === "string" &&
          Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value"),
      ),
  );
const closed = (value, fields) =>
  plain(value) &&
  Reflect.ownKeys(value).length === fields.length &&
  fields.every((key) => Object.hasOwn(value, key));
const dense = (value, max) =>
  Array.isArray(value) &&
  Object.getPrototypeOf(value) === Array.prototype &&
  value.length <= max &&
  Reflect.ownKeys(value).length === value.length + 1 &&
  Array.from({ length: value.length }, (_, i) => i).every((i) =>
    Object.hasOwn(
      Object.getOwnPropertyDescriptor(value, String(i)) ?? {},
      "value",
    ),
  );
const id = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/u.test(value);
const workspaceId = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_.:-]{1,256}$/u.test(value);
const action = (value) => value === "stage" || value === "unstage";
const need = (condition) => {
  if (!condition)
    throw Object.assign(new Error("Invalid Git index request."), {
      appCode: "INVALID_REQUEST",
    });
};
const fits = (value) => {
  try {
    return bytes(JSON.stringify(value)) <= GIT_INDEX_LIMITS.dtoBytes;
  } catch {
    return false;
  }
};
export function validGitIndexPaths(value) {
  return (
    dense(value, GIT_INDEX_LIMITS.paths) &&
    value.length > 0 &&
    value.every(
      (path, i) =>
        workspaceFilePathReason(path) === undefined &&
        (i === 0 || value[i - 1] < path),
    ) &&
    value.reduce((sum, path) => sum + bytes(path), 0) <=
      GIT_INDEX_LIMITS.pathBytes
  );
}
export function validGitIndexTarget(value) {
  return (
    closed(value, GIT_INDEX_TARGET_FIELDS) &&
    action(value.action) &&
    validGitIndexPaths(value.paths) &&
    ["sha1", "sha256"].includes(value.objectFormat) &&
    (value.headOid === null ||
      validGitOid(value.headOid, value.objectFormat)) &&
    typeof value.indexExists === "boolean" &&
    validGitDigest(value.indexDigest) &&
    (value.indexExists || value.indexDigest === GIT_ABSENT_INDEX_DIGEST) &&
    validGitDigest(value.nextIndexDigest) &&
    validGitDigest(value.previewDigest)
  );
}
export function validateGitIndexRequest(value) {
  need(plain(value));
  if (value.type === "git.index.preview.read") {
    need(
      closed(value, [
        "type",
        "workspaceId",
        "observationId",
        "action",
        "paths",
      ]) &&
        workspaceId(value.workspaceId) &&
        validGitDigest(value.observationId) &&
        action(value.action) &&
        validGitIndexPaths(value.paths),
    );
  } else if (value.type === "git.index.apply") {
    need(
      closed(value, [
        "type",
        "workspaceId",
        "requestId",
        "previewId",
        ...GIT_INDEX_TARGET_FIELDS,
      ]) &&
        workspaceId(value.workspaceId) &&
        id(value.requestId) &&
        validGitDigest(value.previewId),
    );
    need(
      validGitIndexTarget(
        Object.fromEntries(
          GIT_INDEX_TARGET_FIELDS.map((key) => [key, value[key]]),
        ),
      ),
    );
  } else need(false);
  need(fits(value));
  return value;
}
export function gitIndexTargetFromApply(value) {
  validateGitIndexRequest(value);
  need(value.type === "git.index.apply");
  return Object.fromEntries(
    GIT_INDEX_TARGET_FIELDS.map((key) => [
      key,
      key === "paths" ? [...value.paths] : value[key],
    ]),
  );
}
const entry = (value, format) =>
  value === null ||
  (closed(value, ["mode", "oid"]) &&
    [0o100644, 0o100755].includes(value.mode) &&
    validGitOid(value.oid, format));
const sameEntry = (a, b) =>
  a === null || b === null ? a === b : a.mode === b.mode && a.oid === b.oid;
const baseFields = [
  "runtimeEpoch",
  "revision",
  "workspaceId",
  "workspacePath",
  "status",
];
export function validateGitIndexPreview(value) {
  need(
    plain(value) &&
      id(value.runtimeEpoch) &&
      Number.isSafeInteger(value.revision) &&
      value.revision >= 0 &&
      workspaceId(value.workspaceId) &&
      validWorkspaceFileRoot(value.workspacePath),
  );
  if (value.status === "unavailable") {
    need(
      closed(value, [...baseFields, "reason"]) &&
        GIT_INDEX_REASONS.includes(value.reason),
    );
  } else {
    need(
      value.status === "available" &&
        closed(value, [
          ...baseFields,
          "previewId",
          ...GIT_INDEX_TARGET_FIELDS,
          "entries",
        ]) &&
        validGitDigest(value.previewId),
    );
    const target = Object.fromEntries(
      GIT_INDEX_TARGET_FIELDS.map((key) => [key, value[key]]),
    );
    need(validGitIndexTarget(target));
    need(
      dense(value.entries, GIT_INDEX_LIMITS.paths) &&
        value.entries.length === value.paths.length &&
        value.entries.every(
          (item, i) =>
            closed(item, ["path", "before", "after"]) &&
            item.path === value.paths[i] &&
            entry(item.before, value.objectFormat) &&
            entry(item.after, value.objectFormat) &&
            (item.before !== null || item.after !== null),
        ) &&
        value.entries.some((item) => !sameEntry(item.before, item.after)),
    );
  }
  need(fits(value));
  return value;
}
export const validGitIndexBackupId = (value) =>
  typeof value === "string" &&
  /^\.omoc-git-index-[a-f0-9]{64}\.backup$/u.test(value);
export function validateGitIndexMutationResult(value) {
  need(plain(value) && id(value.requestId));
  if (value.status === "unknown") need(closed(value, ["requestId", "status"]));
  else
    need(
      value.status === "applied" &&
        closed(value, ["requestId", "status", "indexDigest", "backupId"]) &&
        validGitDigest(value.indexDigest) &&
        (value.backupId === null || validGitIndexBackupId(value.backupId)),
    );
  return value;
}
export function validateGitIndexReceiptResult(value, expected) {
  need(
    closed(expected, ["workspaceId", "target", "digest", "backupId"]) &&
      workspaceId(expected.workspaceId) &&
      validGitIndexTarget(expected.target) &&
      validGitDigest(expected.digest) &&
      (expected.target.indexExists
        ? validGitIndexBackupId(expected.backupId)
        : expected.backupId === null),
  );
  need(
    closed(value, [
      "kind",
      "workspaceId",
      "action",
      "paths",
      "indexDigest",
      "previewDigest",
      "backupId",
      "digest",
    ]) &&
      value.kind === "git_index_updated" &&
      value.workspaceId === expected.workspaceId &&
      value.action === expected.target.action &&
      validGitIndexPaths(value.paths) &&
      JSON.stringify(value.paths) === JSON.stringify(expected.target.paths) &&
      value.indexDigest === expected.target.nextIndexDigest &&
      value.previewDigest === expected.target.previewDigest &&
      value.backupId === expected.backupId &&
      value.digest === expected.digest,
  );
  return value;
}
