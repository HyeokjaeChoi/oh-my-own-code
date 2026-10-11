// Closed browser-safe branch/restore authority. Importing performs no IO.
import {
  GIT_INDEX_REASONS,
  GIT_ABSENT_INDEX_DIGEST,
} from "../git-index/index.mjs";
import {
  validGitCommitAuthor,
  validGitCommitBranch,
} from "../git-commit/index.mjs";
import { validGitDigest, validGitOid } from "../git-review/index.mjs";
import {
  validWorkspaceFileRoot,
  workspaceFilePathReason,
} from "../workspace-file/index.mjs";

export const GIT_BRANCH_RESTORE_FEATURE = "git_branch_restore_mutation_v1";
export const GIT_BRANCH_RESTORE_STEPS = Object.freeze({
  stage: "filesystem.git.branch_restore.stage",
  publish: "filesystem.git.branch_restore.publish",
});
export const GIT_BRANCH_RESTORE_LIMITS = Object.freeze({
  paths: 128,
  pathBytes: 32768,
  fileBytes: 16777216,
  affectedBytes: 16777216,
  dtoBytes: 196608,
  previewsPerWorkspace: 16,
  previews: 64,
  previewMs: 60000,
  treeEntries: 4096,
});
export const GIT_BRANCH_RESTORE_REASONS = Object.freeze([
  ...GIT_INDEX_REASONS,
  "unsupported_branch_restore_state",
  "unsupported_branch_restore",
  "branch_occupied",
  "branch_conflict",
  "identity_changed",
]);
export const GIT_BRANCH_RESTORE_METADATA_ROLES = Object.freeze([
  "index",
  "head_log",
  "head_ref",
  "branch_log",
  "branch_ref",
]);
export const GIT_BRANCH_RESTORE_TARGET_FIELDS = Object.freeze([
  "action",
  "objectFormat",
  "previewDigest",
  "occupancyDigest",
  "branch",
  "source",
  "currentBranch",
  "headOid",
  "nextHeadOid",
  "treeOid",
  "headDigest",
  "indexExists",
  "indexDigest",
  "identityDigest",
  "timestamp",
  "paths",
  "metadata",
]);
const bytes = (v) => new globalThis.TextEncoder().encode(v).length;
const plain = (v) =>
  Boolean(
    v &&
      Object.getPrototypeOf(v) === Object.prototype &&
      Reflect.ownKeys(v).every(
        (k) =>
          typeof k === "string" &&
          Object.hasOwn(Object.getOwnPropertyDescriptor(v, k), "value"),
      ),
  );
const closed = (v, keys) =>
  plain(v) &&
  Reflect.ownKeys(v).length === keys.length &&
  keys.every((k) => Object.hasOwn(v, k));
const dense = (v, max) =>
  Array.isArray(v) &&
  Object.getPrototypeOf(v) === Array.prototype &&
  v.length <= max &&
  Reflect.ownKeys(v).length === v.length + 1 &&
  Array.from({ length: v.length }, (_, i) => i).every((i) =>
    Object.hasOwn(Object.getOwnPropertyDescriptor(v, String(i)) ?? {}, "value"),
  );
const id = (v, max = 128) =>
  typeof v === "string" &&
  new RegExp(`^[A-Za-z0-9_.:-]{1,${max}}$`, "u").test(v);
const need = (ok) => {
  if (!ok)
    throw Object.assign(new Error("Invalid Git branch/restore request."), {
      appCode: "INVALID_REQUEST",
    });
};
const uint = (v, max = Number.MAX_SAFE_INTEGER) =>
  Number.isSafeInteger(v) && v >= 0 && v <= max;
const fits = (v) => {
  try {
    return bytes(JSON.stringify(v)) <= GIT_BRANCH_RESTORE_LIMITS.dtoBytes;
  } catch {
    return false;
  }
};
const compare = (a, b) => {
  const x = new globalThis.TextEncoder().encode(a),
    y = new globalThis.TextEncoder().encode(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++)
    if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
};
const validMode = (v) => uint(v, 0o777) && (v & 0o444) !== 0;
export function gitBranchRestoreMode(oldMode, executable) {
  need(
    (oldMode === null || validMode(oldMode)) && typeof executable === "boolean",
  );
  return oldMode === null
    ? executable
      ? 0o700
      : 0o600
    : (oldMode & 0o666) | (executable ? (oldMode & 0o444) >> 2 : 0);
}
const fileState = (v) =>
  v === null ||
  (closed(v, ["bytes", "digest", "mode"]) &&
    uint(v.bytes, GIT_BRANCH_RESTORE_LIMITS.fileBytes) &&
    validGitDigest(v.digest) &&
    validMode(v.mode));
const byteState = (v) =>
  v === null ||
  (closed(v, ["bytes", "digest"]) &&
    uint(v.bytes, GIT_BRANCH_RESTORE_LIMITS.fileBytes) &&
    validGitDigest(v.digest));
const entry = (v, format) =>
  v === null ||
  (closed(v, ["mode", "oid"]) &&
    [0o100644, 0o100755].includes(v.mode) &&
    validGitOid(v.oid, format));
export function validGitBranchRestorePaths(v) {
  return (
    dense(v, GIT_BRANCH_RESTORE_LIMITS.paths) &&
    v.length > 0 &&
    v.every(
      (p, i) =>
        typeof p === "string" &&
        workspaceFilePathReason(p) === undefined &&
        (i === 0 || compare(v[i - 1], p) < 0),
    ) &&
    v.reduce((n, p) => n + bytes(p), 0) <= GIT_BRANCH_RESTORE_LIMITS.pathBytes
  );
}
const same = (a, b) =>
  a === null || b === null
    ? a === b
    : a.bytes === b.bytes && a.digest === b.digest && a.mode === b.mode;
export function validGitBranchRestoreTarget(v) {
  if (
    !closed(v, GIT_BRANCH_RESTORE_TARGET_FIELDS) ||
    !["create", "select", "restore"].includes(v.action) ||
    !["sha1", "sha256"].includes(v.objectFormat)
  )
    return false;
  if (
    ![v.previewDigest, v.occupancyDigest, v.headDigest, v.indexDigest].every(
      validGitDigest,
    ) ||
    ![v.headOid, v.nextHeadOid, v.treeOid].every((x) =>
      validGitOid(x, v.objectFormat),
    ) ||
    !(v.currentBranch === null || validGitCommitBranch(v.currentBranch)) ||
    typeof v.indexExists !== "boolean"
  )
    return false;
  if (!v.indexExists && v.indexDigest !== GIT_ABSENT_INDEX_DIGEST) return false;
  if (
    v.action === "restore"
      ? !(
          v.branch === null &&
          ["index", "head"].includes(v.source) &&
          v.identityDigest === null &&
          v.timestamp === null &&
          v.headOid === v.nextHeadOid
        )
      : !(
          validGitCommitBranch(v.branch) &&
          v.source === null &&
          validGitDigest(v.identityDigest) &&
          uint(v.timestamp)
        )
  )
    return false;
  if (v.action === "create" && v.headOid !== v.nextHeadOid) return false;
  if (v.action === "select" && v.branch === v.currentBranch) return false;
  if (
    !dense(v.paths, GIT_BRANCH_RESTORE_LIMITS.paths) ||
    (v.action === "create"
      ? v.paths.length !== 0
      : v.action === "restore" && v.paths.length === 0)
  )
    return false;
  if (
    v.paths.length &&
    !validGitBranchRestorePaths(
      v.paths.map((x) => (plain(x) ? x.path : undefined)),
    )
  )
    return false;
  let total = 0;
  for (const p of v.paths) {
    if (
      !closed(p, [
        "path",
        "before",
        "after",
        "beforeEntry",
        "afterEntry",
        "ident",
      ]) ||
      !fileState(p.before) ||
      !fileState(p.after) ||
      !entry(p.beforeEntry, v.objectFormat) ||
      !entry(p.afterEntry, v.objectFormat) ||
      typeof p.ident !== "boolean" ||
      (p.before === null && p.after === null) ||
      same(p.before, p.after)
    )
      return false;
    if (
      (p.after === null) !== (p.afterEntry === null) ||
      (p.after === null && p.ident)
    )
      return false;
    if (
      p.after &&
      p.after.mode !==
        gitBranchRestoreMode(
          p.before?.mode ?? null,
          p.afterEntry.mode === 0o100755,
        )
    )
      return false;
    if (
      v.action === "restore" &&
      v.source === "index" &&
      (p.beforeEntry === null ||
        p.afterEntry === null ||
        p.beforeEntry.mode !== p.afterEntry.mode ||
        p.beforeEntry.oid !== p.afterEntry.oid)
    )
      return false;
    if (
      v.action === "restore" &&
      v.source === "head" &&
      p.beforeEntry === null &&
      p.afterEntry === null
    )
      return false;
    total += (p.before?.bytes ?? 0) + (p.after?.bytes ?? 0);
  }
  if (total > GIT_BRANCH_RESTORE_LIMITS.affectedBytes || !dense(v.metadata, 3))
    return false;
  const roles = v.metadata.map((x) => (plain(x) ? x.role : undefined));
  if (
    v.action === "restore"
      ? roles.length !== 0
      : v.action === "create"
        ? !(
            roles.length >= 1 &&
            roles.at(-1) === "branch_ref" &&
            roles.every((x) => ["branch_log", "branch_ref"].includes(x))
          )
        : !(
            roles.length >= 2 &&
            roles[0] === "index" &&
            roles.at(-1) === "head_ref" &&
            roles.every((x) => ["index", "head_log", "head_ref"].includes(x))
          )
  )
    return false;
  if (
    !v.metadata.every(
      (m, i) =>
        closed(m, ["role", "before", "after"]) &&
        byteState(m.before) &&
        m.after !== null &&
        byteState(m.after) &&
        (i === 0 ||
          GIT_BRANCH_RESTORE_METADATA_ROLES.indexOf(v.metadata[i - 1].role) <
            GIT_BRANCH_RESTORE_METADATA_ROLES.indexOf(m.role)),
    )
  )
    return false;
  if (
    v.action === "create" &&
    v.metadata.find((x) => x.role === "branch_ref").before !== null
  )
    return false;
  if (v.action === "select") {
    const ix = v.metadata[0],
      head = v.metadata.at(-1);
    if (
      (ix.before !== null) !== v.indexExists ||
      (ix.before && ix.before.digest !== v.indexDigest) ||
      head.before === null ||
      head.before.digest !== v.headDigest
    )
      return false;
  }
  return fits(v);
}
export function validateGitBranchRestoreRequest(v) {
  need(plain(v));
  if (v.type === "git.branch.preview.read")
    need(
      closed(v, [
        "type",
        "workspaceId",
        "observationId",
        "action",
        "branch",
        "author",
      ]) &&
        id(v.workspaceId, 256) &&
        validGitDigest(v.observationId) &&
        ["create", "select"].includes(v.action) &&
        validGitCommitBranch(v.branch) &&
        validGitCommitAuthor(v.author),
    );
  else if (v.type === "git.restore.preview.read")
    need(
      closed(v, ["type", "workspaceId", "observationId", "source", "paths"]) &&
        id(v.workspaceId, 256) &&
        validGitDigest(v.observationId) &&
        ["index", "head"].includes(v.source) &&
        validGitBranchRestorePaths(v.paths),
    );
  else {
    need(
      ["git.branch.apply", "git.restore.apply"].includes(v.type) &&
        closed(v, [
          "type",
          "workspaceId",
          "requestId",
          "previewId",
          ...GIT_BRANCH_RESTORE_TARGET_FIELDS,
        ]) &&
        id(v.workspaceId, 256) &&
        id(v.requestId) &&
        validGitDigest(v.previewId),
    );
    need(
      validGitBranchRestoreTarget(
        Object.fromEntries(
          GIT_BRANCH_RESTORE_TARGET_FIELDS.map((k) => [k, v[k]]),
        ),
      ) && (v.type === "git.restore.apply") === (v.action === "restore"),
    );
  }
  need(fits(v));
  return v;
}
export function gitBranchRestoreTargetFromApply(v) {
  validateGitBranchRestoreRequest(v);
  need(["git.branch.apply", "git.restore.apply"].includes(v.type));
  return globalThis.structuredClone(
    Object.fromEntries(GIT_BRANCH_RESTORE_TARGET_FIELDS.map((k) => [k, v[k]])),
  );
}
const baseFields = [
  "runtimeEpoch",
  "revision",
  "workspaceId",
  "workspacePath",
  "status",
];
export function validateGitBranchRestorePreview(v) {
  need(
    plain(v) &&
      id(v.runtimeEpoch) &&
      uint(v.revision) &&
      id(v.workspaceId, 256) &&
      validWorkspaceFileRoot(v.workspacePath),
  );
  if (v.status === "unavailable")
    need(
      closed(v, [...baseFields, "reason"]) &&
        GIT_BRANCH_RESTORE_REASONS.includes(v.reason),
    );
  else {
    need(
      v.status === "available" &&
        closed(v, [
          ...baseFields,
          "previewId",
          ...GIT_BRANCH_RESTORE_TARGET_FIELDS,
          "author",
        ]) &&
        validGitDigest(v.previewId),
    );
    need(
      validGitBranchRestoreTarget(
        Object.fromEntries(
          GIT_BRANCH_RESTORE_TARGET_FIELDS.map((k) => [k, v[k]]),
        ),
      ) &&
        (v.action === "restore"
          ? v.author === null
          : validGitCommitAuthor(v.author)),
    );
  }
  need(fits(v));
  return v;
}
export const validGitBranchRestoreBackupId = (v) =>
  typeof v === "string" &&
  /^\.omoc-git-branch-restore-[a-f0-9]{64}\.backup$/u.test(v);
const backupShape = (v) =>
  dense(v, 131) &&
  v.every(
    (x) =>
      closed(x, ["role", "path", "backupId"]) &&
      (x.role === "worktree"
        ? typeof x.path === "string" &&
          workspaceFilePathReason(x.path) === undefined
        : GIT_BRANCH_RESTORE_METADATA_ROLES.includes(x.role) &&
          x.path === null) &&
      (x.backupId === null || validGitBranchRestoreBackupId(x.backupId)),
  ) &&
  new Set(v.map((x) => JSON.stringify([x.role, x.path]))).size === v.length;
export function gitBranchRestoreBackupRoles(target) {
  need(validGitBranchRestoreTarget(target));
  return [
    ...target.paths.map((x) => ({
      role: "worktree",
      path: x.path,
      exists: x.before !== null,
    })),
    ...target.metadata.map((x) => ({
      role: x.role,
      path: null,
      exists: x.before !== null,
    })),
  ];
}
function completed(v, keys) {
  return (
    closed(v, keys) &&
    ["create", "select", "restore"].includes(v.action) &&
    validGitDigest(v.previewDigest) &&
    dense(v.paths, 128) &&
    v.paths.every(
      (x, i) =>
        closed(x, ["path", "after"]) &&
        typeof x.path === "string" &&
        workspaceFilePathReason(x.path) === undefined &&
        fileState(x.after) &&
        (i === 0 || compare(v.paths[i - 1].path, x.path) < 0),
    ) &&
    dense(v.metadata, 3) &&
    v.metadata.every(
      (x, i) =>
        closed(x, ["role", "digest"]) &&
        GIT_BRANCH_RESTORE_METADATA_ROLES.includes(x.role) &&
        validGitDigest(x.digest) &&
        (i === 0 ||
          GIT_BRANCH_RESTORE_METADATA_ROLES.indexOf(v.metadata[i - 1].role) <
            GIT_BRANCH_RESTORE_METADATA_ROLES.indexOf(x.role)),
    ) &&
    backupShape(v.backups) &&
    fits(v)
  );
}
const resultFields = [
  "action",
  "previewDigest",
  "paths",
  "metadata",
  "backups",
];
export function validateGitBranchRestoreMutationResult(v) {
  need(plain(v) && id(v.requestId));
  need(
    v.status === "unknown"
      ? closed(v, ["requestId", "status"])
      : v.status === "applied" &&
          completed(v, ["requestId", "status", ...resultFields]),
  );
  return v;
}
export function validateGitBranchRestoreReceiptResult(v, expected) {
  need(
    closed(expected, ["workspaceId", "target", "digest", "backups"]) &&
      id(expected.workspaceId, 256) &&
      validGitBranchRestoreTarget(expected.target) &&
      validGitDigest(expected.digest) &&
      backupShape(expected.backups),
  );
  const t = expected.target,
    roles = gitBranchRestoreBackupRoles(t);
  need(
    expected.backups.length === roles.length &&
      expected.backups.every(
        (x, i) =>
          x.role === roles[i].role &&
          x.path === roles[i].path &&
          (roles[i].exists
            ? validGitBranchRestoreBackupId(x.backupId)
            : x.backupId === null),
      ),
  );
  need(
    completed(v, ["kind", "workspaceId", ...resultFields, "digest"]) &&
      v.kind === "git_branch_restore_applied" &&
      v.workspaceId === expected.workspaceId &&
      v.digest === expected.digest &&
      v.action === t.action &&
      v.previewDigest === t.previewDigest &&
      JSON.stringify(v.paths) ===
        JSON.stringify(
          t.paths.map((x) => ({ path: x.path, after: x.after })),
        ) &&
      JSON.stringify(v.metadata) ===
        JSON.stringify(
          t.metadata.map((x) => ({ role: x.role, digest: x.after.digest })),
        ) &&
      JSON.stringify(v.backups) === JSON.stringify(expected.backups),
  );
  return v;
}
