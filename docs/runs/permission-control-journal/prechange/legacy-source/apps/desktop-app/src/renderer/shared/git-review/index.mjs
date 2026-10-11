// Browser-safe closed Git read contracts. Importing this module performs no IO.
import {
  validWorkspaceFilePath,
  validWorkspaceFileRoot,
  workspaceFileContentFits,
} from "../workspace-file/index.mjs";

export const GIT_REVIEW_LIMITS = Object.freeze({
  candidates: 4096,
  files: 512,
  branches: 128,
  branchBytes: 512,
  sourceBytes: 65536,
  patchBytes: 65536,
  patchLines: 2048,
  patchHunks: 128,
  dtoBytes: 196608,
  envelopeBytes: 262144,
  indexBytes: 16777216,
  metadataBytes: 1048576,
  objectBytes: 134217728,
  objectFiles: 16384,
  refs: 4096,
  refDepth: 32,
  copyChunkBytes: 1048576,
  stdoutBytes: 16777216,
  childStdoutBytes: 8388608,
  stderrBytes: 8192,
  deadlineMs: 8000,
  childMs: 2000,
  termMs: 250,
  exitMs: 1500,
  observationsPerWorkspace: 4,
  observations: 256,
  observationMs: 30000,
});
export const GIT_REVIEW_REASONS = Object.freeze([
  "not_repository",
  "not_repository_root",
  "platform_unavailable",
  "git_unavailable",
  "unsupported_repository",
  "unsupported_configuration",
  "path_denied",
  "path_changed",
  "metadata_changed",
  "too_large",
  "read_failed",
  "process_unverified",
]);
export const GIT_DIFF_REASONS = Object.freeze([
  ...GIT_REVIEW_REASONS,
  "protected_source",
  "binary",
  "missing_file",
  "conflict",
  "not_staged",
  "expired_observation",
  "stale_observation",
]);
export const GIT_DIFF_MODES = Object.freeze(["staged", "unstaged", "base"]);
export const GIT_FILE_STATES = Object.freeze([
  "none",
  "added",
  "modified",
  "deleted",
  "type_changed",
  "unmerged",
]);
const bytes = (value) => new globalThis.TextEncoder().encode(value).length;
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
const array = (value, limit) =>
  Array.isArray(value) &&
  Object.getPrototypeOf(value) === Array.prototype &&
  value.length <= limit &&
  Reflect.ownKeys(value).length === value.length + 1 &&
  Array.from({ length: value.length }, (_, i) => i).every((i) =>
    Object.hasOwn(
      Object.getOwnPropertyDescriptor(value, String(i)) ?? {},
      "value",
    ),
  );
const id = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/u.test(value);
export const validGitDigest = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
export const validGitOid = (value, format) =>
  typeof value === "string" &&
  (format === undefined || ["sha1", "sha256"].includes(format)) &&
  (format === "sha1"
    ? /^[a-f0-9]{40}$/u.test(value)
    : format === "sha256"
      ? validGitDigest(value)
      : /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(value));
export function validGitBranch(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= GIT_REVIEW_LIMITS.branchBytes &&
    value.isWellFormed() &&
    bytes(value) <= GIT_REVIEW_LIMITS.branchBytes &&
    !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp} ~^:?*[\\]/u.test(value) &&
    !["@", "HEAD"].includes(value) &&
    !value.startsWith("-") &&
    !value.endsWith(".") &&
    !value.includes("..") &&
    !value.includes("@{") &&
    value
      .split("/")
      .every((part) => part && !part.startsWith(".") && !part.endsWith(".lock"))
  );
}
const invalid = () => {
  throw Object.assign(new Error("INVALID_REQUEST"), {
    appCode: "INVALID_REQUEST",
  });
};
function wire(value) {
  if (bytes(JSON.stringify(value)) > GIT_REVIEW_LIMITS.dtoBytes) invalid();
  return value;
}
export function validateGitReviewRequest(value) {
  if (!plain(value) || !id(value.workspaceId)) invalid();
  if (value.type === "git.review.read") {
    if (!closed(value, ["type", "workspaceId"])) invalid();
  } else if (value.type === "git.diff.read") {
    if (
      !closed(value, [
        "type",
        "workspaceId",
        "observationId",
        "mode",
        "path",
        ...(value.mode === "base" ? ["baseRef"] : []),
      ]) ||
      !validGitDigest(value.observationId) ||
      !GIT_DIFF_MODES.includes(value.mode) ||
      !validWorkspaceFilePath(value.path) ||
      (value.mode === "base" && !validGitBranch(value.baseRef))
    )
      invalid();
  } else invalid();
  return wire(value);
}
const clock = (value) =>
  id(value.runtimeEpoch) &&
  id(value.workspaceId) &&
  Number.isSafeInteger(value.revision) &&
  value.revision >= 0 &&
  validWorkspaceFileRoot(value.workspacePath);
export function validateGitReviewObservation(value) {
  if (!plain(value) || !clock(value)) invalid();
  const available = value.status === "available";
  if (
    !closed(value, [
      "runtimeEpoch",
      "revision",
      "workspaceId",
      "workspacePath",
      "status",
      ...(available
        ? ["observationId", "repository", "branches", "files"]
        : ["reason"]),
    ])
  )
    invalid();
  if (!available) {
    if (
      value.status !== "unavailable" ||
      !GIT_REVIEW_REASONS.includes(value.reason)
    )
      invalid();
    return wire(value);
  }
  const repo = value.repository;
  if (
    !validGitDigest(value.observationId) ||
    !closed(repo, [
      "worktreePath",
      "gitDirectory",
      "commonDirectory",
      "objectFormat",
      "head",
      "branch",
    ]) ||
    repo.worktreePath !== value.workspacePath ||
    !validWorkspaceFileRoot(repo.gitDirectory) ||
    !validWorkspaceFileRoot(repo.commonDirectory) ||
    !["sha1", "sha256"].includes(repo.objectFormat) ||
    !(repo.head === null || validGitOid(repo.head, repo.objectFormat)) ||
    !(repo.branch === null || validGitBranch(repo.branch)) ||
    !array(value.branches, GIT_REVIEW_LIMITS.branches) ||
    !array(value.files, GIT_REVIEW_LIMITS.files)
  )
    invalid();
  const branchNames = new Set();
  for (const row of value.branches) {
    if (
      !closed(row, ["name", "oid"]) ||
      !validGitBranch(row.name) ||
      !validGitOid(row.oid, repo.objectFormat) ||
      branchNames.has(row.name)
    )
      invalid();
    branchNames.add(row.name);
  }
  if (
    repo.branch !== null &&
    repo.head !== null &&
    !value.branches.some(
      (row) => row.name === repo.branch && row.oid === repo.head,
    )
  )
    invalid();
  const paths = new Set();
  for (const row of value.files) {
    if (
      !closed(row, ["path", "index", "worktree", "kind"]) ||
      !validWorkspaceFilePath(row.path) ||
      paths.has(row.path) ||
      !GIT_FILE_STATES.includes(row.index) ||
      !GIT_FILE_STATES.includes(row.worktree) ||
      !["tracked", "untracked", "conflict"].includes(row.kind) ||
      (row.kind === "untracked" &&
        (row.index !== "none" || row.worktree !== "none")) ||
      (row.kind === "conflict" &&
        ![row.index, row.worktree].includes("unmerged")) ||
      (row.kind === "tracked" &&
        ([row.index, row.worktree].includes("unmerged") ||
          (row.index === "none" && row.worktree === "none")))
    )
      invalid();
    paths.add(row.path);
  }
  return wire(value);
}
export function validateGitDiffObservation(value) {
  if (
    !plain(value) ||
    !clock(value) ||
    !validGitDigest(value.observationId) ||
    !GIT_DIFF_MODES.includes(value.mode) ||
    !validWorkspaceFilePath(value.path)
  )
    invalid();
  const available = value.status === "available";
  if (
    !closed(value, [
      "runtimeEpoch",
      "revision",
      "workspaceId",
      "workspacePath",
      "observationId",
      "mode",
      "path",
      "status",
      ...(value.mode === "base" ? ["baseRef", "baseOid"] : []),
      ...(available ? ["patch", "sourceDigest"] : ["reason"]),
    ]) ||
    (value.mode === "base" &&
      (!validGitBranch(value.baseRef) || !validGitOid(value.baseOid)))
  )
    invalid();
  if (available) {
    if (
      !workspaceFileContentFits(value.patch) ||
      !validGitDigest(value.sourceDigest) ||
      (value.patch
        ? value.patch.split("\n").length - Number(value.patch.endsWith("\n"))
        : 0) > GIT_REVIEW_LIMITS.patchLines ||
      (value.patch.match(/^@@ /gmu)?.length ?? 0) > GIT_REVIEW_LIMITS.patchHunks
    )
      invalid();
  } else if (
    value.status !== "unavailable" ||
    !GIT_DIFF_REASONS.includes(value.reason)
  )
    invalid();
  return wire(value);
}
