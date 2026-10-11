// Closed browser-safe explicit commit contract. No import-time IO.
import { GIT_INDEX_REASONS } from "../git-index/index.mjs";
import { validGitDigest, validGitOid } from "../git-review/index.mjs";
import {
  validWorkspaceFileRoot,
  workspaceFilePathReason,
} from "../workspace-file/index.mjs";

export const GIT_COMMIT_FEATURE = "git_commit_mutation_v1";
export const GIT_COMMIT_STEPS = Object.freeze({
  stage: "filesystem.git.commit.stage",
  publish: "filesystem.git.commit.publish",
});
export const GIT_COMMIT_LIMITS = Object.freeze({
  paths: 128,
  pathBytes: 32768,
  identityBytes: 256,
  messageBytes: 65536,
  dtoBytes: 196608,
  previewsPerWorkspace: 16,
  previews: 64,
  previewMs: 60000,
  treeEntries: 4096,
});
export const GIT_COMMIT_REASONS = Object.freeze([
  ...GIT_INDEX_REASONS,
  "unsupported_commit_state",
  "unsupported_commit",
  "identity_changed",
]);
export const GIT_COMMIT_REFLOG_REASON = "commit: explicit local app commit";
export const GIT_COMMIT_ABSENT_DIGEST =
  "f3560bbc703230ea0f066682a64be64c85613c9fd03cc4fb1f0cb8af9642818d";
export const GIT_COMMIT_TARGET_FIELDS = Object.freeze([
  "objectFormat",
  "previewDigest",
  "indexDigest",
  "headOid",
  "treeOid",
  "treeDigest",
  "commitOid",
  "commitBodyDigest",
  "reference",
  "logs",
]);
export const GIT_COMMIT_LOG_ROLES = Object.freeze(["head_log", "branch_log"]);
export const GIT_COMMIT_BACKUP_ROLES = Object.freeze([
  "head_log",
  "branch_log",
  "head_ref",
  "branch_ref",
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
    throw Object.assign(new Error("Invalid Git commit request."), {
      appCode: "INVALID_REQUEST",
    });
};
const fits = (v) => {
  try {
    return bytes(JSON.stringify(v)) <= GIT_COMMIT_LIMITS.dtoBytes;
  } catch {
    return false;
  }
};
const unicode = (v) => typeof v === "string" && v.isWellFormed();
// Git ident.c removes these boundary bytes. Reject rather than silently trim.
const boundary = (c) => c <= 32 || [44, 58, 59, 60, 62, 34, 92, 39].includes(c);
const ident = (v, email) =>
  unicode(v) &&
  v.length > 0 &&
  bytes(v) <= GIT_COMMIT_LIMITS.identityBytes &&
  !Array.from(v).some(
    (c) =>
      c.codePointAt(0) < 32 ||
      c.codePointAt(0) === 127 ||
      c === "<" ||
      c === ">",
  ) &&
  (!email || !/\s/u.test(v)) &&
  !boundary(v.charCodeAt(0)) &&
  !boundary(v.charCodeAt(v.length - 1));
export const validGitCommitAuthor = (v) =>
  closed(v, ["name", "email"]) && ident(v.name, false) && ident(v.email, true);
export const validGitCommitMessage = (v) =>
  unicode(v) &&
  v.trim().length > 0 &&
  !v.includes("\0") &&
  bytes(v) <= GIT_COMMIT_LIMITS.messageBytes;
export function canonicalGitCommitMessage(v) {
  need(validGitCommitMessage(v));
  return v.endsWith("\n") ? v : v + "\n";
}
export function validGitCommitBranch(v) {
  return (
    unicode(v) &&
    v.startsWith("refs/heads/") &&
    bytes(v) <= 4096 &&
    !Array.from(v).some(
      (c) =>
        c.codePointAt(0) <= 32 ||
        c.codePointAt(0) === 127 ||
        "~^:?*[\\".includes(c),
    ) &&
    !v.includes("..") &&
    !v.includes("@{") &&
    !v.endsWith(".") &&
    v.split("/").every((p) => p && !p.startsWith(".") && !p.endsWith(".lock"))
  );
}
const reference = (v) =>
  closed(v, ["kind", "name", "exists", "digest", "nextDigest"]) &&
  ((v.kind === "head" && v.name === null && v.exists === true) ||
    (v.kind === "branch" && validGitCommitBranch(v.name))) &&
  typeof v.exists === "boolean" &&
  validGitDigest(v.digest) &&
  (v.exists || v.digest === GIT_COMMIT_ABSENT_DIGEST) &&
  validGitDigest(v.nextDigest);
const logs = (v) =>
  dense(v, 2) &&
  v.every(
    (x, i) =>
      closed(x, ["role", "exists", "digest", "nextDigest", "nextBytes"]) &&
      GIT_COMMIT_LOG_ROLES.includes(x.role) &&
      (i === 0 ||
        GIT_COMMIT_LOG_ROLES.indexOf(v[i - 1].role) <
          GIT_COMMIT_LOG_ROLES.indexOf(x.role)) &&
      typeof x.exists === "boolean" &&
      validGitDigest(x.digest) &&
      (x.exists || x.digest === GIT_COMMIT_ABSENT_DIGEST) &&
      validGitDigest(x.nextDigest) &&
      Number.isSafeInteger(x.nextBytes) &&
      x.nextBytes > 0 &&
      x.nextBytes <= 16777216,
  );
export function validGitCommitTarget(v) {
  return (
    closed(v, GIT_COMMIT_TARGET_FIELDS) &&
    ["sha1", "sha256"].includes(v.objectFormat) &&
    [v.previewDigest, v.indexDigest, v.treeDigest, v.commitBodyDigest].every(
      validGitDigest,
    ) &&
    (v.headOid === null || validGitOid(v.headOid, v.objectFormat)) &&
    validGitOid(v.treeOid, v.objectFormat) &&
    validGitOid(v.commitOid, v.objectFormat) &&
    reference(v.reference) &&
    logs(v.logs) &&
    (v.reference.kind !== "head" ||
      (v.headOid !== null && !v.logs.some((x) => x.role === "branch_log")))
  );
}
export function validateGitCommitRequest(v) {
  need(plain(v));
  if (v.type === "git.commit.preview.read")
    need(
      closed(v, [
        "type",
        "workspaceId",
        "observationId",
        "author",
        "message",
      ]) &&
        id(v.workspaceId, 256) &&
        validGitDigest(v.observationId) &&
        validGitCommitAuthor(v.author) &&
        validGitCommitMessage(v.message),
    );
  else if (v.type === "git.commit.apply") {
    need(
      closed(v, [
        "type",
        "workspaceId",
        "requestId",
        "previewId",
        ...GIT_COMMIT_TARGET_FIELDS,
      ]) &&
        id(v.workspaceId, 256) &&
        id(v.requestId) &&
        validGitDigest(v.previewId),
    );
    need(
      validGitCommitTarget(
        Object.fromEntries(GIT_COMMIT_TARGET_FIELDS.map((k) => [k, v[k]])),
      ),
    );
  } else need(false);
  need(fits(v));
  return v;
}
export function gitCommitTargetFromApply(v) {
  validateGitCommitRequest(v);
  need(v.type === "git.commit.apply");
  return Object.fromEntries(
    GIT_COMMIT_TARGET_FIELDS.map((k) => [
      k,
      k === "reference"
        ? { ...v.reference }
        : k === "logs"
          ? v.logs.map((x) => ({ ...x }))
          : v[k],
    ]),
  );
}
const entry = (v, format) =>
  v === null ||
  (closed(v, ["mode", "oid"]) &&
    [0o100644, 0o100755].includes(v.mode) &&
    validGitOid(v.oid, format));
const byteCompare = (a, b) => {
  const x = new globalThis.TextEncoder().encode(a),
    y = new globalThis.TextEncoder().encode(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++)
    if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
};
const baseFields = [
  "runtimeEpoch",
  "revision",
  "workspaceId",
  "workspacePath",
  "status",
];
export function validateGitCommitPreview(v) {
  need(
    plain(v) &&
      id(v.runtimeEpoch) &&
      Number.isSafeInteger(v.revision) &&
      v.revision >= 0 &&
      id(v.workspaceId, 256) &&
      validWorkspaceFileRoot(v.workspacePath),
  );
  if (v.status === "unavailable")
    need(
      closed(v, [...baseFields, "reason"]) &&
        GIT_COMMIT_REASONS.includes(v.reason),
    );
  else {
    need(
      v.status === "available" &&
        closed(v, [
          ...baseFields,
          "previewId",
          ...GIT_COMMIT_TARGET_FIELDS,
          "author",
          "timestamp",
          "canonicalMessage",
          "entries",
        ]) &&
        validGitDigest(v.previewId),
    );
    need(
      validGitCommitTarget(
        Object.fromEntries(GIT_COMMIT_TARGET_FIELDS.map((k) => [k, v[k]])),
      ) &&
        validGitCommitAuthor(v.author) &&
        Number.isSafeInteger(v.timestamp) &&
        v.timestamp >= 0 &&
        typeof v.canonicalMessage === "string" &&
        validGitCommitMessage(
          v.canonicalMessage.endsWith("\n")
            ? v.canonicalMessage.slice(0, -1)
            : v.canonicalMessage,
        ) &&
        v.canonicalMessage.endsWith("\n"),
    );
    need(
      dense(v.entries, GIT_COMMIT_LIMITS.paths) &&
        v.entries.length > 0 &&
        v.entries.every(
          (x, i) =>
            closed(x, ["path", "before", "after"]) &&
            unicode(x.path) &&
            workspaceFilePathReason(x.path) === undefined &&
            (i === 0 || byteCompare(v.entries[i - 1].path, x.path) < 0) &&
            entry(x.before, v.objectFormat) &&
            entry(x.after, v.objectFormat) &&
            (x.before !== null || x.after !== null) &&
            (x.before === null ||
              x.after === null ||
              x.before.mode !== x.after.mode ||
              x.before.oid !== x.after.oid),
        ) &&
        v.entries.reduce((n, x) => n + bytes(x.path), 0) <=
          GIT_COMMIT_LIMITS.pathBytes,
    );
  }
  need(fits(v));
  return v;
}
export const validGitCommitBackupId = (v) =>
  typeof v === "string" && /^\.omoc-git-commit-[a-f0-9]{64}\.backup$/u.test(v);
const backups = (v) =>
  dense(v, 3) &&
  v.length > 0 &&
  v.every(
    (x, i) =>
      closed(x, ["role", "backupId"]) &&
      GIT_COMMIT_BACKUP_ROLES.includes(x.role) &&
      (i === 0 ||
        GIT_COMMIT_BACKUP_ROLES.indexOf(v[i - 1].role) <
          GIT_COMMIT_BACKUP_ROLES.indexOf(x.role)) &&
      (x.backupId === null || validGitCommitBackupId(x.backupId)),
  ) &&
  ["head_ref", "branch_ref"].filter((role) => v.some((x) => x.role === role))
    .length === 1;
const logDigests = (v) =>
  dense(v, 2) &&
  v.every(
    (x, i) =>
      closed(x, ["role", "digest"]) &&
      GIT_COMMIT_LOG_ROLES.includes(x.role) &&
      (i === 0 ||
        GIT_COMMIT_LOG_ROLES.indexOf(v[i - 1].role) <
          GIT_COMMIT_LOG_ROLES.indexOf(x.role)) &&
      validGitDigest(x.digest),
  );
export function validateGitCommitMutationResult(v) {
  need(plain(v) && id(v.requestId));
  if (v.status === "unknown") need(closed(v, ["requestId", "status"]));
  else
    need(
      v.status === "committed" &&
        closed(v, [
          "requestId",
          "status",
          "commitOid",
          "treeOid",
          "referenceDigest",
          "logDigests",
          "backups",
        ]) &&
        [40, 64].includes(v.commitOid?.length) &&
        validGitOid(
          v.commitOid,
          v.commitOid.length === 40 ? "sha1" : "sha256",
        ) &&
        validGitOid(v.treeOid, v.commitOid.length === 40 ? "sha1" : "sha256") &&
        validGitDigest(v.referenceDigest) &&
        logDigests(v.logDigests) &&
        backups(v.backups),
    );
  return v;
}
export function validateGitCommitReceiptResult(v, expected) {
  need(
    closed(expected, ["workspaceId", "target", "digest", "backups"]) &&
      id(expected.workspaceId, 256) &&
      validGitCommitTarget(expected.target) &&
      validGitDigest(expected.digest) &&
      backups(expected.backups),
  );
  const t = expected.target;
  const roles = [
    ...t.logs.map((x) => x.role),
    t.reference.kind === "head" ? "head_ref" : "branch_ref",
  ];
  need(
    expected.backups.length === roles.length &&
      expected.backups.every(
        (x, i) =>
          x.role === roles[i] &&
          ((i < t.logs.length ? t.logs[i].exists : t.reference.exists)
            ? validGitCommitBackupId(x.backupId)
            : x.backupId === null),
      ),
  );
  need(
    closed(v, [
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
    ]) &&
      v.kind === "git_commit_created" &&
      v.workspaceId === expected.workspaceId &&
      v.commitOid === t.commitOid &&
      v.treeOid === t.treeOid &&
      v.parentOid === t.headOid &&
      v.referenceDigest === t.reference.nextDigest &&
      logDigests(v.logDigests) &&
      JSON.stringify(v.logDigests) ===
        JSON.stringify(
          t.logs.map((x) => ({ role: x.role, digest: x.nextDigest })),
        ) &&
      v.previewDigest === t.previewDigest &&
      backups(v.backups) &&
      JSON.stringify(v.backups) === JSON.stringify(expected.backups) &&
      v.digest === expected.digest,
  );
  return v;
}
