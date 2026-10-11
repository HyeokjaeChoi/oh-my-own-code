// apps/desktop-app/src/host/workbench-git-index-storage.mjs
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

// apps/desktop-app/src/renderer/shared/workspace-file/index.mjs
var WORKSPACE_FILE_FEATURE = "workspace_file_save_v1";
var WORKSPACE_FILE_LIMITS = Object.freeze({
  bytes: 65536,
  pathBytes: 2048,
  rootBytes: 4096,
  components: 32,
  componentBytes: 255
});
var bytes = (value) => new globalThis.TextEncoder().encode(value).length;
var safe = (v, max) => typeof v === "string" && v.length > 0 && v.length <= max && v.isWellFormed() && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(v) && bytes(v) <= max;
var device = /^(con|prn|aux|nul|clock\$|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/iu;
function validWorkspaceFilePath(value) {
  if (!safe(value, WORKSPACE_FILE_LIMITS.pathBytes) || /[\\:<>"|?*]/u.test(value))
    return false;
  const parts = value.split("/");
  return parts.length <= WORKSPACE_FILE_LIMITS.components && parts.every(
    (part) => safe(part, WORKSPACE_FILE_LIMITS.componentBytes) && ![".", ".."].includes(part) && !/[. ]$/u.test(part) && !device.test(part)
  );
}
var protectedName = (part) => /^\.omoc-configuration-/iu.test(part) || /^(\.env(?:\..*)?|\.git|\.ssh|\.aws|\.azure|\.config|\.npmrc|\.netrc|\.pypirc|credentials(?:\..*)?|secrets?(?:\..*)?|auth\.json|opencode\.jsonc?|id_(rsa|ed25519|ecdsa)(?:\.pub)?|\.opencode|\.agents|\.codex|\.claude|AGENTS\.md|CLAUDE\.md)$/iu.test(
  part
) || /\.(pem|key|p12|pfx|keystore)$/iu.test(part);
function workspaceFilePathReason(value) {
  if (!validWorkspaceFilePath(value)) return "invalid_path";
  return value.split("/").some(protectedName) ? "protected_source" : void 0;
}
var workspaceFileIssueMessages = Object.freeze({
  too_large: "\uD30C\uC77C\uC740 UTF-8 \uAE30\uC900 64KiB \uC774\uD558\uC5EC\uC57C \uD569\uB2C8\uB2E4.",
  unsupported_content: "\uC0AC\uC6A9\uD560 \uC218 \uC5C6\uB294 \uBB38\uC790 \uB610\uB294 \uC798\uBABB\uB41C Unicode\uAC00 \uC788\uC2B5\uB2C8\uB2E4."
});

// apps/desktop-app/src/renderer/shared/git-review/index.mjs
var GIT_REVIEW_LIMITS = Object.freeze({
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
  deadlineMs: 8e3,
  childMs: 2e3,
  termMs: 250,
  exitMs: 1500,
  observationsPerWorkspace: 4,
  observations: 256,
  observationMs: 3e4
});
var GIT_REVIEW_REASONS = Object.freeze([
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
  "process_unverified"
]);
var GIT_DIFF_REASONS = Object.freeze([
  ...GIT_REVIEW_REASONS,
  "protected_source",
  "binary",
  "missing_file",
  "conflict",
  "not_staged",
  "expired_observation",
  "stale_observation"
]);
var GIT_DIFF_MODES = Object.freeze(["staged", "unstaged", "base"]);
var GIT_FILE_STATES = Object.freeze([
  "none",
  "added",
  "modified",
  "deleted",
  "type_changed",
  "unmerged"
]);
var validGitDigest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
var validGitOid = (value, format) => typeof value === "string" && (format === void 0 || ["sha1", "sha256"].includes(format)) && (format === "sha1" ? /^[a-f0-9]{40}$/u.test(value) : format === "sha256" ? validGitDigest(value) : /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(value));

// apps/desktop-app/src/renderer/shared/git-index/index.mjs
var GIT_INDEX_FEATURE = "git_index_mutation_v1";
var GIT_INDEX_STEPS = Object.freeze({
  stage: "filesystem.git.index.stage",
  publish: "filesystem.git.index.publish"
});
var GIT_INDEX_LIMITS = Object.freeze({
  paths: 128,
  pathBytes: 32768,
  dtoBytes: 196608,
  previewsPerWorkspace: 16,
  previews: 64,
  previewMs: 6e4
});
var GIT_INDEX_REASONS = Object.freeze([
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
  "unsupported_index_mutation"
]);
var GIT_INDEX_TARGET_FIELDS = Object.freeze([
  "action",
  "paths",
  "previewDigest",
  "headOid",
  "indexExists",
  "indexDigest",
  "nextIndexDigest",
  "objectFormat"
]);
var GIT_ABSENT_INDEX_DIGEST = "1e805e1eec918accfc6bba36e68b1a5f77c81ec7f1a7a90ed99b688b7b141eae";
var bytes2 = (text) => new globalThis.TextEncoder().encode(text).length;
var plain = (value) => Boolean(
  value && Object.getPrototypeOf(value) === Object.prototype && Reflect.ownKeys(value).every(
    (key) => typeof key === "string" && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value")
  )
);
var closed = (value, fields) => plain(value) && Reflect.ownKeys(value).length === fields.length && fields.every((key) => Object.hasOwn(value, key));
var dense = (value, max) => Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype && value.length <= max && Reflect.ownKeys(value).length === value.length + 1 && Array.from({ length: value.length }, (_, i) => i).every(
  (i) => Object.hasOwn(
    Object.getOwnPropertyDescriptor(value, String(i)) ?? {},
    "value"
  )
);
var workspaceId = (value) => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,256}$/u.test(value);
var action = (value) => value === "stage" || value === "unstage";
var need = (condition) => {
  if (!condition)
    throw Object.assign(new Error("Invalid Git index request."), {
      appCode: "INVALID_REQUEST"
    });
};
function validGitIndexPaths(value) {
  return dense(value, GIT_INDEX_LIMITS.paths) && value.length > 0 && value.every(
    (path2, i) => workspaceFilePathReason(path2) === void 0 && (i === 0 || value[i - 1] < path2)
  ) && value.reduce((sum, path2) => sum + bytes2(path2), 0) <= GIT_INDEX_LIMITS.pathBytes;
}
function validGitIndexTarget(value) {
  return closed(value, GIT_INDEX_TARGET_FIELDS) && action(value.action) && validGitIndexPaths(value.paths) && ["sha1", "sha256"].includes(value.objectFormat) && (value.headOid === null || validGitOid(value.headOid, value.objectFormat)) && typeof value.indexExists === "boolean" && validGitDigest(value.indexDigest) && (value.indexExists || value.indexDigest === GIT_ABSENT_INDEX_DIGEST) && validGitDigest(value.nextIndexDigest) && validGitDigest(value.previewDigest);
}
var validGitIndexBackupId = (value) => typeof value === "string" && /^\.omoc-git-index-[a-f0-9]{64}\.backup$/u.test(value);
function validateGitIndexReceiptResult(value, expected) {
  need(
    closed(expected, ["workspaceId", "target", "digest", "backupId"]) && workspaceId(expected.workspaceId) && validGitIndexTarget(expected.target) && validGitDigest(expected.digest) && (expected.target.indexExists ? validGitIndexBackupId(expected.backupId) : expected.backupId === null)
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
      "digest"
    ]) && value.kind === "git_index_updated" && value.workspaceId === expected.workspaceId && value.action === expected.target.action && validGitIndexPaths(value.paths) && JSON.stringify(value.paths) === JSON.stringify(expected.target.paths) && value.indexDigest === expected.target.nextIndexDigest && value.previewDigest === expected.target.previewDigest && value.backupId === expected.backupId && value.digest === expected.digest
  );
  return value;
}

// apps/desktop-app/src/host/workbench-git-index-storage.mjs
var isGitIndexApply = (type) => type === "git.index.apply";
var GIT_INDEX_RESULT_FIELDS = Object.freeze([
  "kind",
  "workspaceId",
  "action",
  "paths",
  "indexDigest",
  "previewDigest",
  "backupId",
  "digest"
]);
var id = (v, max = 128) => typeof v === "string" && new RegExp(`^[A-Za-z0-9_.:-]{1,${max}}$`, "u").test(v);
var hex = (v) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
var need2 = (ok, code = "identity_conflict") => {
  if (!ok) throw Object.assign(new Error(code), { code });
};
var closed2 = (v, fields) => Boolean(
  v && Object.getPrototypeOf(v) === Object.prototype && Reflect.ownKeys(v).length === fields.length && fields.every(
    (k) => Object.hasOwn(Object.getOwnPropertyDescriptor(v, k) ?? {}, "value")
  )
);
function gitIndexBackupId(runtimeEpoch, operationId) {
  need2(id(runtimeEpoch) && id(operationId), "invalid_record");
  return `.omoc-git-index-${createHash("sha256").update(JSON.stringify([runtimeEpoch, operationId])).digest("hex")}.backup`;
}
function validateGitIndexScope(identity2) {
  if (isGitIndexApply(identity2.type))
    need2(
      id(identity2.workspaceId, 256) && !Object.hasOwn(identity2, "sessionId"),
      "invalid_record"
    );
}
function validateGitIndexAdmission(value) {
  validateGitIndexScope(value.identity);
  need2(
    isGitIndexApply(value.identity.type) ? validGitIndexTarget(value.gitIndexTarget) : !Object.hasOwn(value, "gitIndexTarget"),
    "invalid_record"
  );
}
function validateGitIndexDispatchPayload(value) {
  const selected = Object.values(GIT_INDEX_STEPS).includes(value.step);
  need2(
    selected ? validGitIndexTarget(value.gitIndexTarget) : !Object.hasOwn(value, "gitIndexTarget"),
    "invalid_record"
  );
  if (selected)
    need2(
      ![
        "nativeSessionId",
        "nativeServerName",
        "agentRuntime",
        "skillRuntime",
        "fileTarget"
      ].some((k) => Object.hasOwn(value, k)),
      "invalid_record"
    );
}
function validateGitIndexDispatch(operation, dispatch) {
  if (!isGitIndexApply(operation.identity.type)) {
    need2(
      !Object.hasOwn(dispatch, "gitIndexTarget") && !Object.values(GIT_INDEX_STEPS).includes(dispatch.step)
    );
    return;
  }
  validateGitIndexDispatchPayload(dispatch);
  need2(!operation.completedDelta);
  const { dispatches, gitIndexTarget } = operation;
  need2(
    validGitIndexTarget(gitIndexTarget) && isDeepStrictEqual(gitIndexTarget, dispatch.gitIndexTarget) && dispatches.length < 2 && dispatch.step === [GIT_INDEX_STEPS.stage, GIT_INDEX_STEPS.publish][dispatches.length] && (dispatches.length === 0 || dispatches[0].step === GIT_INDEX_STEPS.stage && isDeepStrictEqual(dispatches[0].gitIndexTarget, gitIndexTarget))
  );
}
function savedShape(record) {
  return Boolean(
    isGitIndexApply(record.type) && id(record.runtimeEpoch) && id(record.operationId) && id(record.workspaceId, 256) && !Object.hasOwn(record, "sessionId") && record.admission === "dispatched" && record.delivery === "accepted" && record.effect === "confirmed" && closed2(record.result, GIT_INDEX_RESULT_FIELDS)
  );
}
function validGitIndexUpdatedResult(record, gitIndexTarget, originalDigest) {
  if (!savedShape(record) || !validGitIndexTarget(gitIndexTarget) || !hex(originalDigest))
    return false;
  try {
    validateGitIndexReceiptResult(record.result, {
      workspaceId: record.workspaceId,
      target: gitIndexTarget,
      digest: originalDigest,
      backupId: gitIndexTarget.indexExists ? gitIndexBackupId(record.runtimeEpoch, record.operationId) : null
    });
    return true;
  } catch {
    return false;
  }
}
function validateGitIndexReceipt(value) {
  if (!isGitIndexApply(value.type)) {
    need2(value.result?.kind !== "git_index_updated", "invalid_record");
    return;
  }
  validateGitIndexScope(value);
  if (value.effect === "confirmed") {
    need2(savedShape(value), "invalid_record");
    const r = value.result;
    need2(
      r.kind === "git_index_updated" && r.workspaceId === value.workspaceId && validGitIndexPaths(r.paths) && (r.action === "stage" || r.action === "unstage") && hex(r.indexDigest) && hex(r.previewDigest) && hex(r.digest) && (r.backupId === null || r.backupId === gitIndexBackupId(value.runtimeEpoch, value.operationId)),
      "invalid_record"
    );
  } else
    need2(
      (value.result === void 0 || value.result.kind === "rejected" && value.admission === "rejected" && value.effect === "none") && !(value.delivery === "accepted" && value.effect === "none"),
      "invalid_record"
    );
}
function validateGitIndexCompletion(operation, payload, features) {
  if (!isGitIndexApply(operation.identity.type)) return;
  need2(features.includes(GIT_INDEX_FEATURE), "unsupported_version");
  const { receipt, delta } = payload;
  need2(
    ["runtimeEpoch", "operationId", "type", "workspaceId", "sessionId"].every(
      (k) => receipt[k] === operation.identity[k]
    ) && !operation.reservation && !operation.reserved && delta.workspaces.length === 0 && delta.sessions.length === 0 && delta.tombstones.length === 0
  );
  if (receipt.effect === "confirmed")
    need2(
      validGitIndexUpdatedResult(
        receipt,
        operation.gitIndexTarget,
        operation.identity.digest
      ) && operation.dispatches.length === 2 && operation.dispatches[0].step === GIT_INDEX_STEPS.stage && operation.dispatches[1].step === GIT_INDEX_STEPS.publish && operation.dispatches.every(
        (d) => isDeepStrictEqual(d.gitIndexTarget, operation.gitIndexTarget)
      )
    );
  else
    need2(
      receipt.result === void 0 || receipt.result.kind === "rejected" && receipt.admission === "rejected" && receipt.effect === "none" && operation.dispatches.length === 0
    );
  need2(
    !(receipt.effect === "confirmed" && operation.completedDelta && operation.receipt?.effect !== "confirmed")
  );
}

// apps/desktop-app/src/host/workbench-git-commit-storage.mjs
import { isDeepStrictEqual as isDeepStrictEqual2 } from "node:util";

// apps/desktop-app/src/renderer/shared/git-commit/index.mjs
var GIT_COMMIT_FEATURE = "git_commit_mutation_v1";
var GIT_COMMIT_STEPS = Object.freeze({
  stage: "filesystem.git.commit.stage",
  publish: "filesystem.git.commit.publish"
});
var GIT_COMMIT_LIMITS = Object.freeze({
  paths: 128,
  pathBytes: 32768,
  identityBytes: 256,
  messageBytes: 65536,
  dtoBytes: 196608,
  previewsPerWorkspace: 16,
  previews: 64,
  previewMs: 6e4,
  treeEntries: 4096
});
var GIT_COMMIT_REASONS = Object.freeze([
  ...GIT_INDEX_REASONS,
  "unsupported_commit_state",
  "unsupported_commit",
  "identity_changed"
]);
var GIT_COMMIT_ABSENT_DIGEST = "f3560bbc703230ea0f066682a64be64c85613c9fd03cc4fb1f0cb8af9642818d";
var GIT_COMMIT_TARGET_FIELDS = Object.freeze([
  "objectFormat",
  "previewDigest",
  "indexDigest",
  "headOid",
  "treeOid",
  "treeDigest",
  "commitOid",
  "commitBodyDigest",
  "reference",
  "logs"
]);
var GIT_COMMIT_LOG_ROLES = Object.freeze(["head_log", "branch_log"]);
var GIT_COMMIT_BACKUP_ROLES = Object.freeze([
  "head_log",
  "branch_log",
  "head_ref",
  "branch_ref"
]);
var bytes3 = (v) => new globalThis.TextEncoder().encode(v).length;
var plain2 = (v) => Boolean(
  v && Object.getPrototypeOf(v) === Object.prototype && Reflect.ownKeys(v).every(
    (k) => typeof k === "string" && Object.hasOwn(Object.getOwnPropertyDescriptor(v, k), "value")
  )
);
var closed3 = (v, keys) => plain2(v) && Reflect.ownKeys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
var dense2 = (v, max) => Array.isArray(v) && Object.getPrototypeOf(v) === Array.prototype && v.length <= max && Reflect.ownKeys(v).length === v.length + 1 && Array.from({ length: v.length }, (_, i) => i).every(
  (i) => Object.hasOwn(Object.getOwnPropertyDescriptor(v, String(i)) ?? {}, "value")
);
var id2 = (v, max = 128) => typeof v === "string" && new RegExp(`^[A-Za-z0-9_.:-]{1,${max}}$`, "u").test(v);
var need3 = (ok) => {
  if (!ok)
    throw Object.assign(new Error("Invalid Git commit request."), {
      appCode: "INVALID_REQUEST"
    });
};
var unicode = (v) => typeof v === "string" && v.isWellFormed();
function validGitCommitBranch(v) {
  return unicode(v) && v.startsWith("refs/heads/") && bytes3(v) <= 4096 && !Array.from(v).some(
    (c) => c.codePointAt(0) <= 32 || c.codePointAt(0) === 127 || "~^:?*[\\".includes(c)
  ) && !v.includes("..") && !v.includes("@{") && !v.endsWith(".") && v.split("/").every((p) => p && !p.startsWith(".") && !p.endsWith(".lock"));
}
var reference = (v) => closed3(v, ["kind", "name", "exists", "digest", "nextDigest"]) && (v.kind === "head" && v.name === null && v.exists === true || v.kind === "branch" && validGitCommitBranch(v.name)) && typeof v.exists === "boolean" && validGitDigest(v.digest) && (v.exists || v.digest === GIT_COMMIT_ABSENT_DIGEST) && validGitDigest(v.nextDigest);
var logs = (v) => dense2(v, 2) && v.every(
  (x, i) => closed3(x, ["role", "exists", "digest", "nextDigest", "nextBytes"]) && GIT_COMMIT_LOG_ROLES.includes(x.role) && (i === 0 || GIT_COMMIT_LOG_ROLES.indexOf(v[i - 1].role) < GIT_COMMIT_LOG_ROLES.indexOf(x.role)) && typeof x.exists === "boolean" && validGitDigest(x.digest) && (x.exists || x.digest === GIT_COMMIT_ABSENT_DIGEST) && validGitDigest(x.nextDigest) && Number.isSafeInteger(x.nextBytes) && x.nextBytes > 0 && x.nextBytes <= 16777216
);
function validGitCommitTarget(v) {
  return closed3(v, GIT_COMMIT_TARGET_FIELDS) && ["sha1", "sha256"].includes(v.objectFormat) && [v.previewDigest, v.indexDigest, v.treeDigest, v.commitBodyDigest].every(
    validGitDigest
  ) && (v.headOid === null || validGitOid(v.headOid, v.objectFormat)) && validGitOid(v.treeOid, v.objectFormat) && validGitOid(v.commitOid, v.objectFormat) && reference(v.reference) && logs(v.logs) && (v.reference.kind !== "head" || v.headOid !== null && !v.logs.some((x) => x.role === "branch_log"));
}
var validGitCommitBackupId = (v) => typeof v === "string" && /^\.omoc-git-commit-[a-f0-9]{64}\.backup$/u.test(v);
var backups = (v) => dense2(v, 3) && v.length > 0 && v.every(
  (x, i) => closed3(x, ["role", "backupId"]) && GIT_COMMIT_BACKUP_ROLES.includes(x.role) && (i === 0 || GIT_COMMIT_BACKUP_ROLES.indexOf(v[i - 1].role) < GIT_COMMIT_BACKUP_ROLES.indexOf(x.role)) && (x.backupId === null || validGitCommitBackupId(x.backupId))
) && ["head_ref", "branch_ref"].filter((role) => v.some((x) => x.role === role)).length === 1;
var logDigests = (v) => dense2(v, 2) && v.every(
  (x, i) => closed3(x, ["role", "digest"]) && GIT_COMMIT_LOG_ROLES.includes(x.role) && (i === 0 || GIT_COMMIT_LOG_ROLES.indexOf(v[i - 1].role) < GIT_COMMIT_LOG_ROLES.indexOf(x.role)) && validGitDigest(x.digest)
);
function validateGitCommitMutationResult(v) {
  need3(plain2(v) && id2(v.requestId));
  if (v.status === "unknown") need3(closed3(v, ["requestId", "status"]));
  else
    need3(
      v.status === "committed" && closed3(v, [
        "requestId",
        "status",
        "commitOid",
        "treeOid",
        "referenceDigest",
        "logDigests",
        "backups"
      ]) && [40, 64].includes(v.commitOid?.length) && validGitOid(
        v.commitOid,
        v.commitOid.length === 40 ? "sha1" : "sha256"
      ) && validGitOid(v.treeOid, v.commitOid.length === 40 ? "sha1" : "sha256") && validGitDigest(v.referenceDigest) && logDigests(v.logDigests) && backups(v.backups)
    );
  return v;
}
function validateGitCommitReceiptResult(v, expected) {
  need3(
    closed3(expected, ["workspaceId", "target", "digest", "backups"]) && id2(expected.workspaceId, 256) && validGitCommitTarget(expected.target) && validGitDigest(expected.digest) && backups(expected.backups)
  );
  const t = expected.target;
  const roles = [
    ...t.logs.map((x) => x.role),
    t.reference.kind === "head" ? "head_ref" : "branch_ref"
  ];
  need3(
    expected.backups.length === roles.length && expected.backups.every(
      (x, i) => x.role === roles[i] && ((i < t.logs.length ? t.logs[i].exists : t.reference.exists) ? validGitCommitBackupId(x.backupId) : x.backupId === null)
    )
  );
  need3(
    closed3(v, [
      "kind",
      "workspaceId",
      "commitOid",
      "treeOid",
      "parentOid",
      "referenceDigest",
      "logDigests",
      "previewDigest",
      "backups",
      "digest"
    ]) && v.kind === "git_commit_created" && v.workspaceId === expected.workspaceId && v.commitOid === t.commitOid && v.treeOid === t.treeOid && v.parentOid === t.headOid && v.referenceDigest === t.reference.nextDigest && logDigests(v.logDigests) && JSON.stringify(v.logDigests) === JSON.stringify(
      t.logs.map((x) => ({ role: x.role, digest: x.nextDigest }))
    ) && v.previewDigest === t.previewDigest && backups(v.backups) && JSON.stringify(v.backups) === JSON.stringify(expected.backups) && v.digest === expected.digest
  );
  return v;
}

// apps/desktop-app/src/host/git-commit-contract.mjs
import { createHash as createHash2 } from "node:crypto";
var GIT_COMMIT_KERNEL_LIMITS = Object.freeze({
  wireBytes: 262144,
  manifestBytes: 16777216,
  indexBytes: 16777216,
  artifactBytes: 134217728,
  artifactFiles: 16384,
  sourceFiles: 16384,
  directories: 32768,
  depth: 32,
  chunkBytes: 1048576,
  deadlineMs: 1e4
});
var id3 = (v, max = 128) => typeof v === "string" && new RegExp(`^[A-Za-z0-9_.:-]{1,${max}}$`, "u").test(v);
var need4 = (ok) => {
  if (!ok)
    throw Object.assign(new Error("Invalid private Git commit authority."), {
      appCode: "INVALID_REQUEST"
    });
};
function gitCommitBackupId(runtimeEpoch, operationId, role) {
  need4(
    id3(runtimeEpoch) && id3(operationId) && GIT_COMMIT_BACKUP_ROLES.includes(role)
  );
  return `.omoc-git-commit-${createHash2("sha256").update(JSON.stringify([runtimeEpoch, operationId, role])).digest("hex")}.backup`;
}
var GIT_COMMIT_STATE_MARKERS = Object.freeze([
  "MERGE_HEAD",
  "CHERRY_PICK_HEAD",
  "REVERT_HEAD",
  "REBASE_HEAD",
  "rebase-apply",
  "rebase-merge",
  "sequencer",
  "MERGE_MSG",
  "MERGE_MODE",
  "SQUASH_MSG",
  "AUTO_MERGE"
]);
function gitCommitExpectedBackups(target, runtimeEpoch, operationId) {
  need4(validGitCommitTarget(target));
  return [
    ...target.logs.map((x) => ({
      role: x.role,
      backupId: x.exists ? gitCommitBackupId(runtimeEpoch, operationId, x.role) : null
    })),
    {
      role: target.reference.kind === "head" ? "head_ref" : "branch_ref",
      backupId: target.reference.exists ? gitCommitBackupId(
        runtimeEpoch,
        operationId,
        target.reference.kind === "head" ? "head_ref" : "branch_ref"
      ) : null
    }
  ];
}

// apps/desktop-app/src/host/workbench-git-commit-storage.mjs
var isGitCommitApply = (type) => type === "git.commit.apply";
var GIT_COMMIT_RESULT_FIELDS = Object.freeze([
  "kind",
  "workspaceId",
  "commitOid",
  "treeOid",
  "parentOid",
  "referenceDigest",
  "logDigests",
  "previewDigest",
  "backups",
  "digest"
]);
var id4 = (v, max = 128) => typeof v === "string" && new RegExp(`^[A-Za-z0-9_.:-]{1,${max}}$`, "u").test(v);
var hex2 = (v) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
var need5 = (ok, code = "identity_conflict") => {
  if (!ok) throw Object.assign(new Error(code), { code });
};
var closed4 = (v, fields) => Boolean(
  v && Object.getPrototypeOf(v) === Object.prototype && Reflect.ownKeys(v).length === fields.length && fields.every(
    (k) => Object.hasOwn(Object.getOwnPropertyDescriptor(v, k) ?? {}, "value")
  )
);
function validateGitCommitScope(identity2) {
  if (isGitCommitApply(identity2.type))
    need5(
      id4(identity2.workspaceId, 256) && !Object.hasOwn(identity2, "sessionId"),
      "invalid_record"
    );
}
function validateGitCommitAdmission(value) {
  validateGitCommitScope(value.identity);
  if (isGitCommitApply(value.identity.type))
    need5(
      Number.isSafeInteger(value.expectedRevision) && value.expectedRevision >= 0 && ![
        "nativeSessionId",
        "nativeServerName",
        "agentRuntime",
        "skillRuntime",
        "fileTarget",
        "gitIndexTarget",
        "agentSourceName",
        "skillSourceName"
      ].some((k) => Object.hasOwn(value, k)),
      "invalid_record"
    );
  else need5(!Object.hasOwn(value, "expectedRevision"), "invalid_record");
  need5(
    isGitCommitApply(value.identity.type) ? validGitCommitTarget(value.gitCommitTarget) : !Object.hasOwn(value, "gitCommitTarget"),
    "invalid_record"
  );
}
function validateGitCommitDispatchPayload(value) {
  const selected = Object.values(GIT_COMMIT_STEPS).includes(value.step);
  need5(
    selected ? validGitCommitTarget(value.gitCommitTarget) : !Object.hasOwn(value, "gitCommitTarget"),
    "invalid_record"
  );
  if (selected)
    need5(
      ![
        "nativeSessionId",
        "nativeServerName",
        "agentRuntime",
        "skillRuntime",
        "fileTarget",
        "gitIndexTarget"
      ].some((k) => Object.hasOwn(value, k)),
      "invalid_record"
    );
}
function validateGitCommitDispatch(operation, dispatch) {
  if (!isGitCommitApply(operation.identity.type)) {
    need5(
      !Object.hasOwn(dispatch, "gitCommitTarget") && !Object.values(GIT_COMMIT_STEPS).includes(dispatch.step)
    );
    return;
  }
  validateGitCommitDispatchPayload(dispatch);
  need5(!operation.completedDelta);
  const { dispatches, gitCommitTarget } = operation;
  need5(
    validGitCommitTarget(gitCommitTarget) && isDeepStrictEqual2(gitCommitTarget, dispatch.gitCommitTarget) && dispatches.length < 2 && dispatch.step === [GIT_COMMIT_STEPS.stage, GIT_COMMIT_STEPS.publish][dispatches.length] && (dispatches.length === 0 || dispatches[0].step === GIT_COMMIT_STEPS.stage && isDeepStrictEqual2(dispatches[0].gitCommitTarget, gitCommitTarget))
  );
}
function savedShape2(record) {
  return Boolean(
    isGitCommitApply(record.type) && id4(record.runtimeEpoch) && id4(record.operationId) && id4(record.workspaceId, 256) && !Object.hasOwn(record, "sessionId") && record.admission === "dispatched" && record.delivery === "accepted" && record.effect === "confirmed" && closed4(record.result, GIT_COMMIT_RESULT_FIELDS)
  );
}
function validGitCommitCreatedResult(record, gitCommitTarget, originalDigest) {
  if (!savedShape2(record) || !validGitCommitTarget(gitCommitTarget) || !hex2(originalDigest))
    return false;
  try {
    validateGitCommitReceiptResult(record.result, {
      workspaceId: record.workspaceId,
      target: gitCommitTarget,
      digest: originalDigest,
      backups: gitCommitExpectedBackups(
        gitCommitTarget,
        record.runtimeEpoch,
        record.operationId
      )
    });
    return true;
  } catch {
    return false;
  }
}
function validateGitCommitReceipt(value) {
  if (!isGitCommitApply(value.type)) {
    need5(value.result?.kind !== "git_commit_created", "invalid_record");
    return;
  }
  validateGitCommitScope(value);
  if (value.effect === "confirmed") {
    need5(savedShape2(value), "invalid_record");
    const r = value.result;
    try {
      validateGitCommitMutationResult({
        requestId: value.operationId,
        status: "committed",
        commitOid: r.commitOid,
        treeOid: r.treeOid,
        referenceDigest: r.referenceDigest,
        logDigests: r.logDigests,
        backups: r.backups
      });
      need5(
        r.kind === "git_commit_created" && r.workspaceId === value.workspaceId && (r.parentOid === null || typeof r.parentOid === "string" && r.parentOid.length === r.commitOid.length && /^[a-f0-9]+$/u.test(r.parentOid)) && hex2(r.previewDigest) && hex2(r.digest),
        "invalid_record"
      );
    } catch {
      need5(false, "invalid_record");
    }
  } else
    need5(
      (value.result === void 0 || value.result.kind === "rejected" && value.admission === "rejected" && value.effect === "none") && !(value.delivery === "accepted" && value.effect === "none"),
      "invalid_record"
    );
}
function validateGitCommitCompletion(operation, payload, features) {
  if (!isGitCommitApply(operation.identity.type)) return;
  need5(features.includes(GIT_COMMIT_FEATURE), "unsupported_version");
  const { receipt, delta } = payload;
  need5(
    ["runtimeEpoch", "operationId", "type", "workspaceId", "sessionId"].every(
      (k) => receipt[k] === operation.identity[k]
    ) && !operation.reservation && !operation.reserved && delta.workspaces.length === 0 && delta.sessions.length === 0 && delta.tombstones.length === 0
  );
  if (receipt.effect === "confirmed")
    need5(
      validGitCommitCreatedResult(
        receipt,
        operation.gitCommitTarget,
        operation.identity.digest
      ) && operation.dispatches.length === 2 && operation.dispatches[0].step === GIT_COMMIT_STEPS.stage && operation.dispatches[1].step === GIT_COMMIT_STEPS.publish && operation.dispatches.every(
        (d) => isDeepStrictEqual2(d.gitCommitTarget, operation.gitCommitTarget)
      )
    );
  else
    need5(
      receipt.result === void 0 || receipt.result.kind === "rejected" && receipt.admission === "rejected" && receipt.effect === "none" && operation.dispatches.length === 0
    );
  need5(
    !(receipt.effect === "confirmed" && operation.completedDelta && operation.receipt?.effect !== "confirmed")
  );
}

// apps/desktop-app/src/host/workbench-file-storage.mjs
import { createHash as createHash3 } from "node:crypto";
import { isDeepStrictEqual as isDeepStrictEqual3 } from "node:util";
var FILE_FEATURE = WORKSPACE_FILE_FEATURE;
var FILE_TARGET_FIELDS = Object.freeze([
  "path",
  "version",
  "directoryVersion"
]);
var FILE_RESULT_FIELDS = Object.freeze([
  "kind",
  "workspaceId",
  "path",
  "version",
  "digest",
  "backupId"
]);
var isFileSave = (type) => type === "file.save";
var hex3 = (v) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
var id5 = (v, max = 128) => typeof v === "string" && new RegExp(`^[A-Za-z0-9_.:-]{1,${max}}$`, "u").test(v);
var closed5 = (v, keys) => Boolean(
  v && Object.getPrototypeOf(v) === Object.prototype && keys.every((k) => Object.hasOwn(v, k)) && Reflect.ownKeys(v).every(
    (k) => typeof k === "string" && keys.includes(k) && Object.hasOwn(Object.getOwnPropertyDescriptor(v, k), "value")
  )
);
var need6 = (ok, code = "identity_conflict") => {
  if (!ok) throw Object.assign(new Error(code), { code });
};
var validFileTarget = (v) => closed5(v, FILE_TARGET_FIELDS) && workspaceFilePathReason(v.path) === void 0 && hex3(v.version) && hex3(v.directoryVersion);
function fileBackupId(runtimeEpoch, operationId) {
  need6(id5(runtimeEpoch) && id5(operationId), "invalid_record");
  const hash2 = createHash3("sha256").update(JSON.stringify([runtimeEpoch, operationId])).digest("hex");
  return `.omoc-configuration-${hash2}.file.backup`;
}
function validateFileScope(identity2) {
  if (isFileSave(identity2.type))
    need6(
      id5(identity2.workspaceId, 256) && !Object.hasOwn(identity2, "sessionId"),
      "invalid_record"
    );
}
function validateFileAdmission(value) {
  need6(
    isFileSave(value.identity.type) ? validFileTarget(value.fileTarget) : !Object.hasOwn(value, "fileTarget"),
    "invalid_record"
  );
}
function validateFileDispatchPayload(value) {
  if (!Object.hasOwn(value, "fileTarget")) return;
  need6(
    validFileTarget(value.fileTarget) && [
      "filesystem.configuration.stage",
      "filesystem.configuration.publish"
    ].includes(value.step),
    "invalid_record"
  );
}
function validateFileDispatch(operation, dispatch) {
  if (!isFileSave(operation.identity.type)) {
    need6(!Object.hasOwn(dispatch, "fileTarget"));
    return;
  }
  need6(
    validFileTarget(operation.fileTarget) && validFileTarget(dispatch.fileTarget) && isDeepStrictEqual3(operation.fileTarget, dispatch.fileTarget) && ![
      "nativeSessionId",
      "nativeServerName",
      "agentRuntime",
      "skillRuntime"
    ].some((k) => Object.hasOwn(dispatch, k)) && [
      "filesystem.configuration.stage",
      "filesystem.configuration.publish"
    ].includes(dispatch.step) && (dispatch.step !== "filesystem.configuration.publish" || operation.dispatches.length >= 1 && operation.dispatches[0].step === "filesystem.configuration.stage" && isDeepStrictEqual3(
      operation.dispatches[0].fileTarget,
      operation.fileTarget
    ))
  );
}
var savedShape3 = (record) => {
  const r = record.result;
  return Boolean(
    isFileSave(record.type) && id5(record.runtimeEpoch) && id5(record.operationId) && id5(record.workspaceId, 256) && record.sessionId === void 0 && record.admission === "dispatched" && record.delivery === "accepted" && record.effect === "confirmed" && closed5(r, FILE_RESULT_FIELDS) && r.kind === "file_saved" && r.workspaceId === record.workspaceId && workspaceFilePathReason(r.path) === void 0 && hex3(r.version) && hex3(r.digest) && r.backupId === fileBackupId(record.runtimeEpoch, record.operationId)
  );
};
function validFileSavedResult(record, fileTarget, originalDigest) {
  return savedShape3(record) && validFileTarget(fileTarget) && hex3(originalDigest) && record.result.path === fileTarget.path && record.result.digest === originalDigest;
}
function validateFileReceipt(value) {
  if (!isFileSave(value.type)) {
    need6(value.result?.kind !== "file_saved", "invalid_record");
    return;
  }
  validateFileScope(value);
  if (value.effect === "confirmed") need6(savedShape3(value), "invalid_record");
  else
    need6(
      (value.result === void 0 || value.result.kind === "rejected" && value.admission === "rejected" && value.effect === "none") && !(value.delivery === "accepted" && value.effect === "none"),
      "invalid_record"
    );
}
function validateFileCompletion(operation, payload, features) {
  if (!isFileSave(operation.identity.type)) return;
  need6(features.includes(FILE_FEATURE), "unsupported_version");
  const { receipt, delta } = payload;
  need6(
    ["runtimeEpoch", "operationId", "type", "workspaceId", "sessionId"].every(
      (k) => receipt[k] === operation.identity[k]
    ) && !operation.reservation && !operation.reserved && delta.workspaces.length === 0 && delta.sessions.length === 0 && delta.tombstones.length === 0
  );
  if (receipt.effect === "confirmed")
    need6(
      validFileSavedResult(
        receipt,
        operation.fileTarget,
        operation.identity.digest
      ) && operation.dispatches.length === 2 && operation.dispatches[0].step === "filesystem.configuration.stage" && operation.dispatches[1].step === "filesystem.configuration.publish" && operation.dispatches.every(
        (d) => isDeepStrictEqual3(d.fileTarget, operation.fileTarget)
      )
    );
  else
    need6(
      receipt.result === void 0 || receipt.result.kind === "rejected" && receipt.admission === "rejected" && receipt.effect === "none" && operation.dispatches.length === 0
    );
}

// apps/desktop-app/src/renderer/shared/configuration-draft/agent.mjs
var AGENT_LIMITS = Object.freeze({
  bytes: 32768,
  entries: 16,
  scan: 64
});
var validAgentSourceName = (v) => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(v) && !["__proto__", "prototype", "constructor"].includes(v);
var agentIssueMessages = Object.freeze({
  empty: "Markdown \uBCF8\uBB38\uC744 \uC785\uB825\uD558\uC138\uC694.",
  too_large: "\uD30C\uC77C\uC740 UTF-8 \uAE30\uC900 32KiB \uC774\uD558\uC5EC\uC57C \uD569\uB2C8\uB2E4.",
  control_bytes: "\uC0AC\uC6A9\uD560 \uC218 \uC5C6\uB294 \uBB38\uC790 \uB610\uB294 \uC798\uBABB\uB41C Unicode\uAC00 \uC788\uC2B5\uB2C8\uB2E4.",
  unsupported_frontmatter: "\uC55E\uBA38\uB9AC\uB294 description, mode: primary, color\uC758 JSON\uB9CC \uC9C0\uC6D0\uD569\uB2C8\uB2E4. model\xB7\uAD8C\uD55C\xB7\uC2E4\uD589 \uC124\uC815\uACFC \uB2E4\uB978 YAML \uD615\uC2DD\uC740 \uC9C0\uC6D0\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4."
});

// apps/desktop-app/src/renderer/shared/configuration-draft/policy.mjs
var BASELINE_POLICY = Object.freeze([
  Object.freeze({ action: "*", resource: "*", effect: "ask" }),
  Object.freeze({
    action: "external_directory",
    resource: "*",
    effect: "deny"
  }),
  Object.freeze({ action: "subagent", resource: "*", effect: "deny" })
]);
function policyMatches(rules) {
  if (!Array.isArray(rules) || rules.length !== BASELINE_POLICY.length)
    return false;
  for (let index = 0; index < rules.length; index++) {
    const slot = Object.getOwnPropertyDescriptor(rules, String(index));
    if (!slot || !Object.hasOwn(slot, "value")) return false;
    const rule = slot.value;
    if (!rule || Object.getPrototypeOf(rule) !== Object.prototype || Reflect.ownKeys(rule).length !== 3)
      return false;
    for (const key of ["action", "resource", "effect"]) {
      const field = Object.getOwnPropertyDescriptor(rule, key);
      if (!field || !Object.hasOwn(field, "value") || field.value !== BASELINE_POLICY[index][key])
        return false;
    }
  }
  return true;
}

// apps/desktop-app/src/renderer/shared/configuration-draft/agent-runtime.mjs
var AGENT_RUNTIME_FEATURE = "configuration_agents_v1";
var steps = Object.freeze({
  "configuration.agent.register": "native.agent.register",
  "configuration.agent.remove": "native.agent.remove"
});
var agentRuntimeStep = (type) => Object.hasOwn(steps, type) ? steps[type] : void 0;
var id6 = (v) => typeof v === "string" && /^[\w.:-]{1,256}$/u.test(v);
var hex4 = (v) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
var safe2 = (v, max = 256) => typeof v === "string" && v.length > 0 && v.length <= max && v.isWellFormed() && ![...v].some(
  (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) >= 127 && c.charCodeAt(0) <= 159
);
var data = (v) => Boolean(
  v && Object.getPrototypeOf(v) === Object.prototype && Reflect.ownKeys(v).every(
    (k) => typeof k === "string" && Object.hasOwn(Object.getOwnPropertyDescriptor(v, k), "value")
  )
);
var closed6 = (v, required, optional = []) => data(v) && required.every((k) => Object.hasOwn(v, k)) && Reflect.ownKeys(v).every((k) => required.includes(k) || optional.includes(k));
var validAgentNativeId = (v) => typeof v === "string" && /^omoc-agent-[a-f0-9]{64}$/u.test(v);
function agentRuntimeIdPayload(v) {
  if (!data(v) || !id6(v.runtimeEpoch) || !id6(v.workspaceId) || !id6(v.operationId) || !validAgentSourceName(v.sourceName))
    throw new Error("Invalid Agent identity.");
  return JSON.stringify([
    v.runtimeEpoch,
    v.workspaceId,
    v.sourceName,
    v.operationId
  ]);
}
var identityFields = [
  "sourceName",
  "nativeId",
  "digest",
  "nativeDigest",
  "registrationRuntimeEpoch",
  "registrationOperationId"
];
var identity = (v) => validAgentSourceName(v.sourceName) && validAgentNativeId(v.nativeId) && hex4(v.digest) && hex4(v.nativeDigest) && id6(v.registrationRuntimeEpoch) && id6(v.registrationOperationId);
function validAgentRuntimeMutation(v) {
  if (!data(v) || !id6(v.requestId)) return false;
  if (v.status === "unknown") return closed6(v, ["requestId", "status"]);
  const common = [
    "requestId",
    "status",
    ...identityFields,
    "systemDigest",
    "defaultAgentId"
  ];
  if (!identity(v) || !hex4(v.systemDigest) || !safe2(v.defaultAgentId, 512) || v.defaultAgentId === v.nativeId)
    return false;
  if (v.status === "registered_primary")
    return closed6(v, [...common, "version", "directoryVersion"]) && hex4(v.version) && hex4(v.directoryVersion);
  return v.status === "removed" && closed6(v, common);
}

// apps/desktop-app/src/native-agents-protocol.mjs
import { createHash as createHash4 } from "node:crypto";
import { isAbsolute, normalize } from "node:path";
var hex5 = (v) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
var id7 = (v) => typeof v === "string" && /^[\w.:-]{1,256}$/u.test(v);
var safe3 = (v, max, multiline = false) => typeof v === "string" && v.length <= max && v.isWellFormed() && ![...v].some((c) => {
  const n = c.charCodeAt(0);
  return n < 32 && !(multiline && [9, 10, 13].includes(n)) || n >= 127 && n <= 159;
});
var root = (v) => safe3(v, 32768) && isAbsolute(v) && normalize(v) === v && v !== "/";
var data2 = (v) => v && Object.getPrototypeOf(v) === Object.prototype && Reflect.ownKeys(v).every(
  (k) => typeof k === "string" && Object.hasOwn(Object.getOwnPropertyDescriptor(v, k), "value")
);
var closed7 = (v, required, optional = []) => Boolean(
  data2(v) && required.every((k) => Object.hasOwn(v, k)) && Reflect.ownKeys(v).every(
    (k) => required.includes(k) || optional.includes(k)
  )
);
var sha = (v) => createHash4("sha256").update(JSON.stringify(v)).digest("hex");
var NATIVE_AGENT_LIMITS = Object.freeze({
  owned: 16,
  native: 64,
  operations: 256,
  referencePages: 16,
  referencePageSize: 64
});
function validAgentOwner(v) {
  return closed7(v, [
    "runtimeEpoch",
    "operationId",
    "workspaceId",
    "workspacePath",
    "sourceName",
    "digest"
  ]) && id7(v.runtimeEpoch) && id7(v.operationId) && id7(v.workspaceId) && root(v.workspacePath) && validAgentSourceName(v.sourceName) && hex5(v.digest);
}
function nativeAgentRegistrationId(identity2) {
  return "omoc-agent-" + createHash4("sha256").update(agentRuntimeIdPayload(identity2)).digest("hex");
}
function nativeAgentId(owner) {
  if (!validAgentOwner(owner)) throw new Error("native_agent_invalid");
  return nativeAgentRegistrationId(owner);
}
function validNativeAgentShape(v) {
  return Boolean(
    closed7(
      v,
      ["id", "name", "system", "mode", "hidden", "request", "permissions"],
      ["description", "color"]
    ) && typeof v.id === "string" && /^omoc-agent-[a-f0-9]{64}$/u.test(v.id) && validAgentSourceName(v.name) && safe3(v.system, AGENT_LIMITS.bytes, true) && v.system.trim() === v.system && v.system.length > 0 && new globalThis.TextEncoder().encode(v.system).length <= AGENT_LIMITS.bytes && v.mode === "primary" && v.hidden === false && closed7(v.request, ["settings", "headers", "body"]) && ["settings", "headers", "body"].every((k) => closed7(v.request[k], [])) && policyMatches(v.permissions) && (!Object.hasOwn(v, "description") || safe3(v.description, 1024) && v.description.trim().length > 0) && (!Object.hasOwn(v, "color") || typeof v.color === "string" && /^#[a-f0-9]{6}$/iu.test(v.color))
  );
}
function validNativeAgent(v, owner) {
  return Boolean(
    validAgentOwner(owner) && validNativeAgentShape(v) && v.id === nativeAgentId(owner) && v.name === owner.sourceName
  );
}
function nativeAgentDigest(v) {
  if (!validNativeAgentShape(v)) throw new Error("native_agent_invalid");
  return sha([
    v.id,
    v.name,
    v.system,
    v.description ?? null,
    v.color ?? null,
    v.mode,
    v.hidden,
    v.request.settings,
    v.request.headers,
    v.request.body,
    v.permissions.map((r) => [r.action, r.resource, r.effect])
  ]);
}
function validAgentProjection(v) {
  return Boolean(
    closed7(v, ["id", "name", "mode", "hidden"]) && safe3(v.id, 512) && v.id.length > 0 && safe3(v.name, 256) && v.name.length > 0 && ["primary", "subagent", "all"].includes(v.mode) && typeof v.hidden === "boolean"
  );
}
function validateAgentRpc(method, v) {
  let valid = false;
  if (method === "observe")
    valid = closed7(v, ["nonce", "workspaceId", "workspacePath"]) && hex5(v.nonce) && id7(v.workspaceId) && root(v.workspacePath);
  if (method === "register")
    valid = closed7(v, [
      "nonce",
      "owner",
      "record",
      "recordDigest",
      "expectedNativeId"
    ]) && hex5(v.nonce) && validNativeAgent(v.record, v.owner) && v.recordDigest === nativeAgentDigest(v.record) && v.expectedNativeId === null;
  if (method === "remove")
    valid = closed7(v, [
      "nonce",
      "owner",
      "registration",
      "nativeId",
      "recordDigest"
    ]) && hex5(v.nonce) && validAgentOwner(v.owner) && validAgentOwner(v.registration) && ["workspaceId", "workspacePath", "sourceName"].every(
      (k) => v.owner[k] === v.registration[k]
    ) && v.nativeId === nativeAgentId(v.registration) && hex5(v.recordDigest);
  if (!valid) throw new Error("native_agent_invalid");
  return v;
}
var dense3 = (array, max, validate) => {
  if (!Array.isArray(array) || array.length > max || Reflect.ownKeys(array).length !== array.length + 1)
    return false;
  for (let i = 0; i < array.length; i++) {
    const s = Object.getOwnPropertyDescriptor(array, String(i));
    if (!s || !Object.hasOwn(s, "value") || !validate(s.value)) return false;
  }
  return true;
};
var defaultId = (v) => v === null || safe3(v, 512) && v.length > 0;
function validateAgentRpcResult(method, v) {
  const invalid = () => {
    throw new Error("native_agent_invalid");
  };
  if (method === "observe") {
    if (closed7(v, ["status", "reason"]) && v.status === "unavailable" && [
      "identity_conflict",
      "retained_limit",
      "runtime_error",
      "invalid_context"
    ].includes(v.reason))
      return v;
    if (!closed7(v, [
      "status",
      "version",
      "workspaceId",
      "workspacePath",
      "rows",
      "native",
      "defaultAgentId"
    ]) || v.status !== "ready" || v.version !== 1 || !id7(v.workspaceId) || !root(v.workspacePath) || !defaultId(v.defaultAgentId) || !dense3(v.native, NATIVE_AGENT_LIMITS.native, validAgentProjection) || !dense3(
      v.rows,
      NATIVE_AGENT_LIMITS.owned,
      (r) => closed7(r, ["owner", "record", "recordDigest"]) && validNativeAgent(r.record, r.owner) && r.recordDigest === nativeAgentDigest(r.record)
    ))
      invalid();
    if (new Set(v.native.map((r) => r.id)).size !== v.native.length || new Set(v.rows.map((r) => r.owner.sourceName)).size !== v.rows.length)
      invalid();
    for (const r of v.rows) {
      const native = v.native.find((a) => a.id === r.record.id);
      if (r.owner.workspaceId !== v.workspaceId || r.owner.workspacePath !== v.workspacePath || !native || native.name !== r.record.name || native.mode !== r.record.mode || native.hidden !== r.record.hidden)
        invalid();
    }
    if (v.defaultAgentId !== null && !v.native.some((r) => r.id === v.defaultAgentId))
      invalid();
    return v;
  }
  if (["register", "remove"].includes(method) && closed7(v, ["status", "reason"]) && v.status === "unknown" && ["reload_failed", "verification_failed"].includes(v.reason))
    return v;
  if (method === "register" && closed7(v, [
    "status",
    "owner",
    "record",
    "recordDigest",
    "defaultAgentId"
  ]) && v.status === "registered" && validNativeAgent(v.record, v.owner) && v.recordDigest === nativeAgentDigest(v.record) && defaultId(v.defaultAgentId) && v.defaultAgentId !== v.record.id)
    return v;
  if (method === "remove" && closed7(v, [
    "status",
    "owner",
    "registration",
    "nativeId",
    "recordDigest",
    "defaultAgentId"
  ]) && v.status === "removed" && validAgentOwner(v.owner) && validAgentOwner(v.registration) && ["workspaceId", "workspacePath", "sourceName"].every(
    (k) => v.owner[k] === v.registration[k]
  ) && v.nativeId === nativeAgentId(v.registration) && hex5(v.recordDigest) && defaultId(v.defaultAgentId) && v.defaultAgentId !== v.nativeId)
    return v;
  invalid();
}
var portable = (validate) => ({
  "~standard": {
    version: 1,
    vendor: "oh-my-own-code",
    validate(v) {
      try {
        return { value: validate(v) };
      } catch {
        return { issues: [{ message: "Invalid Native Agent RPC value" }] };
      }
    }
  }
});
function freeze(v) {
  if (v && typeof v === "object") {
    for (const value of Object.values(v)) freeze(value);
    Object.freeze(v);
  }
  return v;
}
var denied = portable((v) => {
  if (!closed7(v, ["code"]) || ![
    "invalid_context",
    "nonce_mismatch",
    "identity_conflict",
    "retained_limit",
    "collision",
    "changed",
    "in_use"
  ].includes(v.code))
    throw new Error("native_agent_invalid");
  return v;
});
var NATIVE_AGENTS_RPC = freeze({
  id: "omoc.workbench.agents.v1",
  events: {},
  methods: Object.fromEntries(
    ["observe", "register", "remove"].map((method) => [
      method,
      {
        input: portable((v) => validateAgentRpc(method, v)),
        output: portable((v) => validateAgentRpcResult(method, v)),
        errors: { denied }
      }
    ])
  )
});

// apps/desktop-app/src/host/configuration-file-observation.mjs
import { createHash as createHash5 } from "node:crypto";
function configurationBackupId(runtimeEpoch, operationId, kind3) {
  if (![runtimeEpoch, operationId].every(
    (v) => typeof v === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(v)
  ) || !["instructions", "mcp", "skill", "agent", "file"].includes(kind3))
    throw new Error("invalid_request");
  const key = createHash5("sha256").update(JSON.stringify([runtimeEpoch, operationId])).digest("hex");
  return `.omoc-configuration-${key}.${kind3}.backup`;
}

// apps/desktop-app/src/host/workbench-agent-storage.mjs
var AGENT_FEATURE = AGENT_RUNTIME_FEATURE;
var AGENT_RUNTIME_DISPATCH_FIELDS = Object.freeze([
  "sourceName",
  "nativeId",
  "digest",
  "nativeDigest",
  "registrationRuntimeEpoch",
  "registrationOperationId",
  "systemDigest"
]);
var AGENT_RUNTIME_RESULT_FIELDS = Object.freeze({
  agent_registered: [
    ...AGENT_RUNTIME_DISPATCH_FIELDS,
    "version",
    "directoryVersion",
    "defaultAgentId"
  ],
  agent_removed: [...AGENT_RUNTIME_DISPATCH_FIELDS, "defaultAgentId"]
});
var hex6 = (v) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
var id8 = (v) => typeof v === "string" && /^[\w.:-]{1,256}$/u.test(v);
var closed8 = (v, keys) => Boolean(
  v && Object.getPrototypeOf(v) === Object.prototype && keys.every((k) => Object.hasOwn(v, k)) && Reflect.ownKeys(v).every(
    (k) => typeof k === "string" && keys.includes(k) && Object.hasOwn(Object.getOwnPropertyDescriptor(v, k), "value")
  )
);
var need7 = (ok, code = "identity_conflict") => {
  if (!ok) throw Object.assign(new Error(code), { code });
};
var register = (type) => type === "configuration.agent.register";
var kind = (type) => ({
  "configuration.agent.register": "agent_registered",
  "configuration.agent.remove": "agent_removed"
})[type];
var registrationId = (identity2, target) => nativeAgentRegistrationId({
  runtimeEpoch: target.registrationRuntimeEpoch,
  operationId: target.registrationOperationId,
  workspaceId: identity2.workspaceId,
  sourceName: target.sourceName
});
function validateAgentRuntimeScope(identity2) {
  if (!agentRuntimeStep(identity2.type)) return;
  need7(
    id8(identity2.workspaceId) && !Object.hasOwn(identity2, "sessionId"),
    "invalid_record"
  );
}
function validateAgentRuntimeAdmission(value) {
  const { identity: identity2, agentRuntime } = value;
  if (!agentRuntimeStep(identity2.type)) {
    need7(!Object.hasOwn(value, "agentRuntime"), "invalid_record");
    return;
  }
  validateAgentRuntimeScope(identity2);
  need7(
    closed8(
      agentRuntime,
      register(identity2.type) ? ["sourceName", "nativeId", "digest", "version", "directoryVersion"] : ["nativeId"]
    ),
    "invalid_record"
  );
  need7(validAgentNativeId(agentRuntime.nativeId), "invalid_record");
  if (register(identity2.type))
    need7(
      validAgentSourceName(agentRuntime.sourceName) && ["digest", "version", "directoryVersion"].every(
        (k) => hex6(agentRuntime[k])
      ) && agentRuntime.nativeId === nativeAgentRegistrationId({
        ...identity2,
        sourceName: agentRuntime.sourceName
      }),
      "invalid_record"
    );
}
function validateAgentRuntimeDispatchPayload(dispatch) {
  const isStep = ["native.agent.register", "native.agent.remove"].includes(
    dispatch.step
  );
  if (!isStep) {
    need7(!Object.hasOwn(dispatch, "agentRuntime"), "invalid_record");
    return;
  }
  const t = dispatch.agentRuntime;
  need7(
    closed8(t, AGENT_RUNTIME_DISPATCH_FIELDS) && validAgentSourceName(t.sourceName) && validAgentNativeId(t.nativeId) && ["digest", "nativeDigest", "systemDigest"].every((k) => hex6(t[k])) && id8(t.registrationRuntimeEpoch) && id8(t.registrationOperationId) && !Object.hasOwn(dispatch, "nativeSessionId") && !Object.hasOwn(dispatch, "nativeServerName"),
    "invalid_record"
  );
}
function validAgentRuntimeResult(record) {
  const r = record.result;
  if (!r || !agentRuntimeStep(record.type) || !closed8(r, [
    "kind",
    "workspaceId",
    ...AGENT_RUNTIME_RESULT_FIELDS[kind(record.type)]
  ]))
    return false;
  const { kind: _kind, workspaceId: _workspace, ...fields } = r;
  const status = {
    agent_registered: "registered_primary",
    agent_removed: "removed"
  }[r.kind];
  try {
    validateAgentRuntimeScope({
      type: record.type,
      workspaceId: record.workspaceId,
      ...record.sessionId !== void 0 && { sessionId: record.sessionId }
    });
    return Boolean(
      r.kind === kind(record.type) && r.workspaceId === record.workspaceId && record.admission === "dispatched" && record.delivery === "accepted" && record.effect === "confirmed" && validAgentRuntimeMutation({
        requestId: record.operationId,
        status,
        ...fields
      }) && r.nativeId === registrationId(record, r) && (register(record.type) ? r.registrationRuntimeEpoch === record.runtimeEpoch && r.registrationOperationId === record.operationId : r.registrationRuntimeEpoch === record.runtimeEpoch)
    );
  } catch {
    return false;
  }
}
function validateAgentRuntimeReceipt(receipt) {
  if (!agentRuntimeStep(receipt.type)) return;
  validateAgentRuntimeScope(receipt);
  if (receipt.effect === "confirmed")
    need7(validAgentRuntimeResult(receipt), "invalid_record");
  else
    need7(
      (receipt.result === void 0 || receipt.result.kind === "rejected" && receipt.admission === "rejected" && receipt.effect === "none") && !(receipt.delivery === "accepted" && receipt.effect === "none"),
      "invalid_record"
    );
}
function validateAgentRuntimeDispatch(operation, dispatch, sessions, operations) {
  const expected = agentRuntimeStep(operation.identity.type);
  if (!expected && !dispatch.step.startsWith("native.agent.") && !Object.hasOwn(dispatch, "agentRuntime"))
    return;
  validateAgentRuntimeDispatchPayload(dispatch);
  need7(expected === dispatch.step);
  const { identity: identity2, agentRuntime: admitted } = operation;
  const target = dispatch.agentRuntime;
  need7(
    admitted && target.nativeId === admitted.nativeId && target.nativeId === registrationId(identity2, target)
  );
  need7(operation.dispatches.every((d) => d.step === expected));
  if (register(identity2.type)) {
    need7(
      target.registrationRuntimeEpoch === identity2.runtimeEpoch && target.registrationOperationId === identity2.operationId && ["sourceName", "digest"].every((k) => target[k] === admitted[k])
    );
  } else {
    const original = operations.get(
      JSON.stringify([
        target.registrationRuntimeEpoch,
        target.registrationOperationId
      ])
    );
    need7(
      target.registrationRuntimeEpoch === identity2.runtimeEpoch && original?.terminal && original.identity.type === "configuration.agent.register" && original.identity.workspaceId === identity2.workspaceId && validAgentRuntimeResult(original.receipt) && AGENT_RUNTIME_DISPATCH_FIELDS.every(
        (k) => target[k] === original.receipt.result[k]
      ) && ![...operations.values()].some(
        (entry) => entry !== operation && entry.terminal && entry.identity.type === "configuration.agent.remove" && entry.identity.workspaceId === identity2.workspaceId && validAgentRuntimeResult(entry.receipt) && AGENT_RUNTIME_DISPATCH_FIELDS.every(
          (k) => entry.receipt.result[k] === target[k]
        )
      )
    );
  }
}
function validateAgentRuntimeCompletion(operation, payload, features, sessions, operations) {
  for (const tombstone of payload.delta.tombstones) {
    if (tombstone.kind !== "workspace") continue;
    need7(
      ![...operations.values()].some(
        (registered) => registered.terminal && registered.identity.type === "configuration.agent.register" && registered.identity.workspaceId === tombstone.id && registered.identity.runtimeEpoch === operation.identity.runtimeEpoch && validAgentRuntimeResult(registered.receipt) && ![...operations.values()].some(
          (removed) => removed.terminal && removed.identity.type === "configuration.agent.remove" && removed.identity.workspaceId === tombstone.id && validAgentRuntimeResult(removed.receipt) && AGENT_RUNTIME_DISPATCH_FIELDS.every(
            (k) => removed.receipt.result[k] === registered.receipt.result[k]
          )
        )
      )
    );
  }
  if (!agentRuntimeStep(operation.identity.type)) return;
  need7(features.includes(AGENT_FEATURE), "unsupported_version");
  const { receipt, delta } = payload;
  need7(
    !operation.reservation && !operation.reserved && delta.workspaces.length === 0 && delta.sessions.length === 0 && delta.tombstones.length === 0
  );
  validateAgentRuntimeReceipt(receipt);
  if (receipt.effect !== "confirmed") return;
  need7(operation.dispatches.length === 1);
  const dispatch = operation.dispatches[0];
  validateAgentRuntimeDispatch(operation, dispatch, sessions, operations);
  need7(
    AGENT_RUNTIME_DISPATCH_FIELDS.every(
      (k) => receipt.result[k] === dispatch.agentRuntime[k]
    )
  );
  if (register(operation.identity.type))
    need7(
      ["version", "directoryVersion"].every(
        (k) => receipt.result[k] === operation.agentRuntime[k]
      )
    );
}
var isAgentSave = (type) => type === "configuration.agent.save";
var wireId = (value) => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
var resourceId = (value) => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,256}$/.test(value);
var agentBackupId = (runtimeEpoch, operationId) => configurationBackupId(runtimeEpoch, operationId, "agent");
function validAgentSavedResult(record, sourceName) {
  const result = record.result;
  return !!(isAgentSave(record.type) && wireId(record.runtimeEpoch) && wireId(record.operationId) && resourceId(record.workspaceId) && record.sessionId === void 0 && record.admission === "dispatched" && record.delivery === "accepted" && record.effect === "confirmed" && validAgentSourceName(sourceName) && result && Object.getPrototypeOf(result) === Object.prototype && ["kind", "workspaceId", "sourceName", "version"].every(
    (key) => Object.hasOwn(result, key)
  ) && Reflect.ownKeys(result).every(
    (key) => ["kind", "workspaceId", "sourceName", "version", "backupId"].includes(
      key
    ) && Object.hasOwn(Object.getOwnPropertyDescriptor(result, key), "value")
  ) && result.kind === "agent_file_saved" && result.workspaceId === record.workspaceId && result.sourceName === sourceName && typeof result.version === "string" && /^[a-f0-9]{64}$/.test(result.version) && (!Object.hasOwn(result, "backupId") || result.backupId === agentBackupId(record.runtimeEpoch, record.operationId)));
}

// apps/desktop-app/src/renderer/shared/configuration-draft/skill.mjs
var SKILL_LIMITS = Object.freeze({
  bytes: 32768,
  entries: 16,
  scan: 64
});
var validSkillSourceName = (value) => typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value);
var controls = (text, multiline = false) => [...text].some((char) => {
  const code = char.charCodeAt(0);
  return code < 32 && !(multiline && [9, 10, 13].includes(code)) || code >= 127 && code <= 159;
});
var skillFileContentFits = (text) => typeof text === "string" && text.length <= SKILL_LIMITS.bytes && text.isWellFormed() && !controls(text, true) && new globalThis.TextEncoder().encode(text).length <= SKILL_LIMITS.bytes;
var skillIssueMessages = Object.freeze({
  empty: "Markdown \uBCF8\uBB38\uC744 \uC785\uB825\uD558\uC138\uC694.",
  too_large: "\uD30C\uC77C\uC740 UTF-8 \uAE30\uC900 32KiB \uC774\uD558\uC5EC\uC57C \uD569\uB2C8\uB2E4.",
  control_bytes: "\uC0AC\uC6A9\uD560 \uC218 \uC5C6\uB294 \uBB38\uC790 \uB610\uB294 \uC798\uBABB\uB41C Unicode\uAC00 \uC788\uC2B5\uB2C8\uB2E4.",
  unsupported_frontmatter: "\uC9C0\uC6D0\uD558\uB294 \uC55E\uBA38\uB9AC\uB294 name\uACFC description\uC758 JSON \uBB38\uC790\uC5F4, metadata \uC544\uB798\uC758 opencode/autoinvoke: true \uB610\uB294 false\uC785\uB2C8\uB2E4. \uB2E4\uB978 YAML \uBB38\uBC95\uC740 \uC9C0\uC6D0\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4."
});

// apps/desktop-app/src/renderer/shared/configuration-draft/skill-runtime.mjs
var SKILL_RUNTIME_FEATURE = "configuration_skill_runtime_v1";
var steps2 = Object.freeze({
  "configuration.skill.register": "native.skill.register",
  "configuration.skill.remove": "native.skill.remove",
  "configuration.skill.apply": "native.skill.apply"
});
var skillRuntimeStep = (type) => Object.hasOwn(steps2, type) ? steps2[type] : void 0;
var id9 = (v) => typeof v === "string" && /^[\w.:-]{1,256}$/u.test(v);
var hex7 = (v) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
var closed9 = (v, required, optional = []) => Boolean(
  v && Object.getPrototypeOf(v) === Object.prototype && required.every((k) => Object.hasOwn(v, k)) && Reflect.ownKeys(v).every(
    (k) => typeof k === "string" && (required.includes(k) || optional.includes(k)) && Object.hasOwn(Object.getOwnPropertyDescriptor(v, k), "value")
  )
);
var validSkillNativeId = (v) => typeof v === "string" && /^omoc-skill-[a-f0-9]{64}$/u.test(v);
var registrationFields = [
  "sourceName",
  "nativeId",
  "digest",
  "nativeDigest",
  "registrationRuntimeEpoch",
  "registrationOperationId"
];
var registration = (v) => validSkillSourceName(v.sourceName) && validSkillNativeId(v.nativeId) && hex7(v.digest) && hex7(v.nativeDigest) && id9(v.registrationRuntimeEpoch) && id9(v.registrationOperationId);
function validSkillRuntimeMutation(v) {
  if (!id9(v?.requestId)) return false;
  if (v.status === "unknown") return closed9(v, ["requestId", "status"]);
  const common = ["requestId", "status", ...registrationFields];
  if (!registration(v)) return false;
  if (v.status === "registered_disabled")
    return closed9(v, [...common, "version", "directoryVersion", "bodyDigest"]) && hex7(v.version) && hex7(v.directoryVersion) && hex7(v.bodyDigest);
  if (v.status === "removed") return closed9(v, common);
  return v.status === "applied" && closed9(v, [
    ...common,
    "sessionId",
    "nativeSessionId",
    "nativeMessageId",
    "bodyDigest"
  ]) && id9(v.sessionId) && id9(v.nativeSessionId) && id9(v.nativeMessageId) && hex7(v.bodyDigest);
}

// apps/desktop-app/src/native-skills-protocol.mjs
import { createHash as createHash6 } from "node:crypto";
import { isAbsolute as isAbsolute2, join, normalize as normalize2 } from "node:path";
var hex8 = (v) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
var identifier = (v) => typeof v === "string" && /^[\w.:-]{1,256}$/u.test(v);
var data3 = (v) => v && Object.getPrototypeOf(v) === Object.prototype && Reflect.ownKeys(v).every(
  (k) => typeof k === "string" && Object.hasOwn(Object.getOwnPropertyDescriptor(v, k), "value")
);
var closed10 = (v, required, optional = []) => Boolean(
  data3(v) && required.every((k) => Object.hasOwn(v, k)) && Reflect.ownKeys(v).every(
    (k) => required.includes(k) || optional.includes(k)
  )
);
var safe4 = (v, max) => typeof v === "string" && v.length <= max && v.isWellFormed() && ![...v].some(
  (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) >= 127 && c.charCodeAt(0) <= 159
);
var root2 = (v) => safe4(v, 32768) && isAbsolute2(v) && normalize2(v) === v && v !== "/";
var sha2 = (v) => createHash6("sha256").update(JSON.stringify(v)).digest("hex");
var NATIVE_SKILL_LIMITS = Object.freeze({
  owned: 16,
  native: 64,
  operations: 256
});
function validSkillOwner(v) {
  return closed10(v, [
    "runtimeEpoch",
    "operationId",
    "workspaceId",
    "workspacePath",
    "sourceName",
    "digest"
  ]) && identifier(v.runtimeEpoch) && identifier(v.operationId) && identifier(v.workspaceId) && root2(v.workspacePath) && validSkillSourceName(v.sourceName) && hex8(v.digest);
}
function nativeSkillRegistrationId(identity2) {
  if (!identifier(identity2?.runtimeEpoch) || !identifier(identity2?.workspaceId) || !identifier(identity2?.operationId) || !validSkillSourceName(identity2?.sourceName))
    throw new Error("native_skill_invalid");
  return "omoc-skill-" + sha2([
    identity2.runtimeEpoch,
    identity2.workspaceId,
    identity2.sourceName,
    identity2.operationId
  ]);
}
function nativeSkillId(owner) {
  if (!validSkillOwner(owner)) throw new Error("native_skill_invalid");
  return nativeSkillRegistrationId(owner);
}
function validNativeSkillShape(v) {
  return closed10(
    v,
    ["id", "name", "autoinvoke", "path", "content"],
    ["description"]
  ) && safe4(v.id, 512) && Boolean(v.id) && safe4(v.name, 256) && Boolean(v.name.trim()) && v.autoinvoke === false && root2(v.path) && skillFileContentFits(v.content) && (!Object.hasOwn(v, "description") || safe4(v.description, 1024) && Boolean(v.description.trim()));
}
function validObservedNativeSkill(v) {
  if (!closed10(v, ["id", "name", "path", "content"], ["description", "autoinvoke"]))
    return false;
  if (Object.hasOwn(v, "autoinvoke") && typeof v.autoinvoke !== "boolean")
    return false;
  return validNativeSkillShape({ ...v, autoinvoke: false });
}
function validNativeSkill(v, owner) {
  return Boolean(
    validSkillOwner(owner) && validNativeSkillShape(v) && v.content.trim() && v.id === nativeSkillId(owner) && v.path === join(
      owner.workspacePath,
      ".opencode",
      "skills",
      owner.sourceName,
      "SKILL.md"
    )
  );
}
function nativeSkillDigest(v) {
  if (!validNativeSkillShape(v)) throw new Error("native_skill_invalid");
  return sha2([
    v.id,
    v.name,
    v.description ?? null,
    v.autoinvoke,
    v.path,
    v.content
  ]);
}
function validateSkillRpc(method, v) {
  let valid = false;
  if (method === "observe")
    valid = closed10(v, ["nonce", "workspaceId", "workspacePath"]) && hex8(v.nonce) && identifier(v.workspaceId) && root2(v.workspacePath);
  if (method === "registerDisabled")
    valid = closed10(v, [
      "nonce",
      "owner",
      "record",
      "recordDigest",
      "expectedNativeId"
    ]) && hex8(v.nonce) && validNativeSkill(v.record, v.owner) && v.recordDigest === nativeSkillDigest(v.record) && (v.expectedNativeId === null || typeof v.expectedNativeId === "string" && /^omoc-skill-[a-f0-9]{64}$/u.test(v.expectedNativeId));
  if (method === "removeOwned")
    valid = closed10(v, [
      "nonce",
      "owner",
      "registration",
      "nativeId",
      "recordDigest"
    ]) && hex8(v.nonce) && validSkillOwner(v.owner) && validSkillOwner(v.registration) && ["workspaceId", "workspacePath", "sourceName"].every(
      (k) => v.owner[k] === v.registration[k]
    ) && v.nativeId === nativeSkillId(v.registration) && hex8(v.recordDigest);
  if (!valid) throw new Error("native_skill_invalid");
  return v;
}
function validateSkillRpcResult(method, value) {
  const invalid = () => {
    throw new Error("native_skill_invalid");
  };
  const unknown = () => closed10(value, ["status", "reason"]) && value.status === "unknown" && ["reload_failed", "verification_failed"].includes(value.reason);
  if (method === "observe") {
    if (closed10(value, ["status", "reason"]) && value.status === "unavailable" && [
      "identity_conflict",
      "retained_limit",
      "runtime_error",
      "invalid_context"
    ].includes(value.reason))
      return value;
    if (!closed10(value, [
      "status",
      "version",
      "workspaceId",
      "workspacePath",
      "rows",
      "native"
    ]) || value.status !== "ready" || value.version !== 1 || !identifier(value.workspaceId) || !root2(value.workspacePath) || !Array.isArray(value.rows) || value.rows.length > NATIVE_SKILL_LIMITS.owned || !Array.isArray(value.native) || value.native.length > NATIVE_SKILL_LIMITS.native || value.native.some((record) => !validObservedNativeSkill(record)) || new Set(value.native.map((record) => record.id)).size !== value.native.length)
      invalid();
    const sources = /* @__PURE__ */ new Set();
    for (const row of value.rows) {
      if (!closed10(row, ["owner", "record", "recordDigest"]) || !validSkillOwner(row.owner) || row.owner.workspaceId !== value.workspaceId || row.owner.workspacePath !== value.workspacePath || !validNativeSkill(row.record, row.owner) || row.recordDigest !== nativeSkillDigest(row.record) || sources.has(row.owner.sourceName))
        invalid();
      const native = value.native.find((record) => record.id === row.record.id);
      if (!validNativeSkill(native, row.owner) || nativeSkillDigest(native) !== row.recordDigest)
        invalid();
      sources.add(row.owner.sourceName);
    }
    return value;
  }
  if (unknown() && ["registerDisabled", "removeOwned"].includes(method))
    return value;
  if (method === "registerDisabled") {
    if (!closed10(value, [
      "status",
      "owner",
      "record",
      "recordDigest",
      "previousNativeId"
    ]) || value.status !== "registered_disabled" || !validNativeSkill(value.record, value.owner) || value.recordDigest !== nativeSkillDigest(value.record) || !(value.previousNativeId === null || typeof value.previousNativeId === "string" && /^omoc-skill-[a-f0-9]{64}$/u.test(value.previousNativeId) && value.previousNativeId !== value.record.id))
      invalid();
    return value;
  }
  if (method === "removeOwned") {
    if (!closed10(value, [
      "status",
      "owner",
      "registration",
      "nativeId",
      "recordDigest"
    ]) || value.status !== "removed" || !validSkillOwner(value.owner) || !validSkillOwner(value.registration) || value.owner.workspaceId !== value.registration.workspaceId || value.owner.workspacePath !== value.registration.workspacePath || value.owner.sourceName !== value.registration.sourceName || value.nativeId !== nativeSkillId(value.registration) || !hex8(value.recordDigest))
      invalid();
    return value;
  }
  invalid();
}
function portable2(validate) {
  return {
    "~standard": {
      version: 1,
      vendor: "oh-my-own-code",
      validate(value) {
        try {
          return { value: validate(value) };
        } catch {
          return { issues: [{ message: "Invalid Native Skill RPC value" }] };
        }
      }
    }
  };
}
function freeze2(v) {
  if (v && typeof v === "object") {
    for (const value of Object.values(v)) freeze2(value);
    Object.freeze(v);
  }
  return v;
}
var denied2 = portable2((value) => {
  if (!closed10(value, ["code"]) || ![
    "invalid_context",
    "nonce_mismatch",
    "identity_conflict",
    "retained_limit",
    "collision",
    "changed"
  ].includes(value.code))
    throw new Error("native_skill_invalid");
  return value;
});
var NATIVE_SKILLS_RPC = freeze2({
  id: "omoc.workbench.skills.v1",
  events: {},
  methods: Object.fromEntries(
    ["observe", "registerDisabled", "removeOwned"].map((method) => [
      method,
      {
        input: portable2((value) => validateSkillRpc(method, value)),
        output: portable2((value) => validateSkillRpcResult(method, value)),
        errors: { denied: denied2 }
      }
    ])
  )
});

// apps/desktop-app/src/host/workbench-skill-runtime-storage.mjs
var SKILL_RUNTIME_DISPATCH_FIELDS = Object.freeze([
  "sourceName",
  "nativeId",
  "digest",
  "nativeDigest",
  "registrationRuntimeEpoch",
  "registrationOperationId",
  "bodyDigest"
]);
var SKILL_RUNTIME_RESULT_FIELDS = Object.freeze({
  skill_registered: [
    ...SKILL_RUNTIME_DISPATCH_FIELDS,
    "version",
    "directoryVersion"
  ],
  skill_removed: SKILL_RUNTIME_DISPATCH_FIELDS.filter(
    (k) => k !== "bodyDigest"
  ),
  skill_applied: [
    ...SKILL_RUNTIME_DISPATCH_FIELDS,
    "sessionId",
    "nativeSessionId",
    "nativeMessageId"
  ]
});
var hex9 = (v) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
var id10 = (v) => typeof v === "string" && /^[\w.:-]{1,256}$/u.test(v);
var closed11 = (v, keys) => Boolean(
  v && Object.getPrototypeOf(v) === Object.prototype && keys.every((k) => Object.hasOwn(v, k)) && Reflect.ownKeys(v).every(
    (k) => typeof k === "string" && keys.includes(k) && Object.hasOwn(Object.getOwnPropertyDescriptor(v, k), "value")
  )
);
var need8 = (ok, code = "identity_conflict") => {
  if (!ok) throw Object.assign(new Error(code), { code });
};
var register2 = (type) => type === "configuration.skill.register";
var apply = (type) => type === "configuration.skill.apply";
var kind2 = (type) => ({
  "configuration.skill.register": "skill_registered",
  "configuration.skill.remove": "skill_removed",
  "configuration.skill.apply": "skill_applied"
})[type];
var registrationId2 = (identity2, target) => nativeSkillRegistrationId({
  runtimeEpoch: target.registrationRuntimeEpoch,
  operationId: target.registrationOperationId,
  workspaceId: identity2.workspaceId,
  sourceName: target.sourceName
});
function validateSkillRuntimeScope(identity2) {
  if (!skillRuntimeStep(identity2.type)) return;
  need8(
    id10(identity2.workspaceId) && (apply(identity2.type) ? id10(identity2.sessionId) : !Object.hasOwn(identity2, "sessionId")),
    "invalid_record"
  );
}
function validateSkillRuntimeAdmission(value) {
  const { identity: identity2, skillRuntime } = value;
  if (!skillRuntimeStep(identity2.type)) {
    need8(!Object.hasOwn(value, "skillRuntime"), "invalid_record");
    return;
  }
  validateSkillRuntimeScope(identity2);
  need8(
    closed11(
      skillRuntime,
      register2(identity2.type) ? ["sourceName", "nativeId", "digest", "version", "directoryVersion"] : ["nativeId"]
    ),
    "invalid_record"
  );
  need8(validSkillNativeId(skillRuntime.nativeId), "invalid_record");
  if (register2(identity2.type))
    need8(
      validSkillSourceName(skillRuntime.sourceName) && ["digest", "version", "directoryVersion"].every(
        (k) => hex9(skillRuntime[k])
      ) && skillRuntime.nativeId === nativeSkillRegistrationId({
        ...identity2,
        sourceName: skillRuntime.sourceName
      }),
      "invalid_record"
    );
}
function validateSkillRuntimeDispatchPayload(dispatch) {
  const isStep = [
    "native.skill.register",
    "native.skill.remove",
    "native.skill.apply"
  ].includes(dispatch.step);
  if (!isStep) {
    need8(!Object.hasOwn(dispatch, "skillRuntime"), "invalid_record");
    return;
  }
  const t = dispatch.skillRuntime;
  need8(
    closed11(t, SKILL_RUNTIME_DISPATCH_FIELDS) && validSkillSourceName(t.sourceName) && validSkillNativeId(t.nativeId) && ["digest", "nativeDigest", "bodyDigest"].every((k) => hex9(t[k])) && id10(t.registrationRuntimeEpoch) && id10(t.registrationOperationId) && (dispatch.step === "native.skill.apply" ? id10(dispatch.nativeSessionId) : !Object.hasOwn(dispatch, "nativeSessionId")) && !Object.hasOwn(dispatch, "nativeServerName"),
    "invalid_record"
  );
}
function validSkillRuntimeResult(record) {
  const r = record.result;
  if (!r || !skillRuntimeStep(record.type) || !closed11(r, [
    "kind",
    "workspaceId",
    ...SKILL_RUNTIME_RESULT_FIELDS[kind2(record.type)]
  ]))
    return false;
  const { kind: _kind, workspaceId: _workspace, ...fields } = r;
  const status = {
    skill_registered: "registered_disabled",
    skill_removed: "removed",
    skill_applied: "applied"
  }[r.kind];
  try {
    validateSkillRuntimeScope({
      type: record.type,
      workspaceId: record.workspaceId,
      ...record.sessionId !== void 0 && { sessionId: record.sessionId }
    });
    return Boolean(
      r.kind === kind2(record.type) && r.workspaceId === record.workspaceId && record.admission === "dispatched" && record.delivery === "accepted" && record.effect === "confirmed" && validSkillRuntimeMutation({
        requestId: record.operationId,
        status,
        ...fields
      }) && r.nativeId === registrationId2(record, r) && (register2(record.type) ? r.registrationRuntimeEpoch === record.runtimeEpoch && r.registrationOperationId === record.operationId : r.registrationRuntimeEpoch === record.runtimeEpoch) && (!apply(record.type) || r.sessionId === record.sessionId)
    );
  } catch {
    return false;
  }
}
function validateSkillRuntimeReceipt(receipt) {
  if (!skillRuntimeStep(receipt.type)) return;
  validateSkillRuntimeScope(receipt);
  if (receipt.effect === "confirmed")
    need8(validSkillRuntimeResult(receipt), "invalid_record");
  else
    need8(
      (receipt.result === void 0 || receipt.result.kind === "rejected" && receipt.admission === "rejected" && receipt.effect === "none") && !(receipt.delivery === "accepted" && receipt.effect === "none"),
      "invalid_record"
    );
}
function validateSkillRuntimeDispatch(operation, dispatch, sessions, operations) {
  const expected = skillRuntimeStep(operation.identity.type);
  if (!expected && !dispatch.step.startsWith("native.skill.") && !Object.hasOwn(dispatch, "skillRuntime"))
    return;
  validateSkillRuntimeDispatchPayload(dispatch);
  need8(expected === dispatch.step);
  const { identity: identity2, skillRuntime: admitted } = operation;
  const target = dispatch.skillRuntime;
  need8(
    admitted && target.nativeId === admitted.nativeId && target.nativeId === registrationId2(identity2, target)
  );
  if (register2(identity2.type)) {
    need8(
      target.registrationRuntimeEpoch === identity2.runtimeEpoch && target.registrationOperationId === identity2.operationId && ["sourceName", "digest"].every((k) => target[k] === admitted[k])
    );
  } else {
    const original = operations.get(
      JSON.stringify([
        target.registrationRuntimeEpoch,
        target.registrationOperationId
      ])
    );
    need8(
      target.registrationRuntimeEpoch === identity2.runtimeEpoch && original?.terminal && original.identity.type === "configuration.skill.register" && original.identity.workspaceId === identity2.workspaceId && validSkillRuntimeResult(original.receipt) && SKILL_RUNTIME_DISPATCH_FIELDS.every(
        (k) => target[k] === original.receipt.result[k]
      )
    );
  }
  if (apply(identity2.type)) {
    const mapped = sessions.get(identity2.sessionId);
    need8(
      mapped?.workspaceId === identity2.workspaceId && mapped.lifecycleState === "active" && mapped.nativeSessionId === dispatch.nativeSessionId && id10(dispatch.nativeSessionId)
    );
  }
}
function validateSkillRuntimeCompletion(operation, payload, features, sessions, operations) {
  if (!skillRuntimeStep(operation.identity.type)) return;
  need8(features.includes(SKILL_RUNTIME_FEATURE), "unsupported_version");
  const { receipt, delta } = payload;
  need8(
    !operation.reservation && !operation.reserved && delta.workspaces.length === 0 && delta.sessions.length === 0 && delta.tombstones.length === 0
  );
  validateSkillRuntimeReceipt(receipt);
  if (receipt.effect !== "confirmed") return;
  need8(operation.dispatches.length === 1);
  const dispatch = operation.dispatches[0];
  validateSkillRuntimeDispatch(operation, dispatch, sessions, operations);
  need8(
    SKILL_RUNTIME_DISPATCH_FIELDS.filter(
      (k) => receipt.result.kind !== "skill_removed" || k !== "bodyDigest"
    ).every((k) => receipt.result[k] === dispatch.skillRuntime[k])
  );
  if (register2(operation.identity.type))
    need8(
      ["version", "directoryVersion"].every(
        (k) => receipt.result[k] === operation.skillRuntime[k]
      )
    );
  if (apply(operation.identity.type))
    need8(receipt.result.nativeSessionId === dispatch.nativeSessionId);
}

// apps/desktop-app/src/host/workbench-skill-storage.mjs
var SKILL_FEATURE = "configuration_skill_files_v1";
var isSkillSave = (type) => type === "configuration.skill.save";
var wireId2 = (value) => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
var resourceId2 = (value) => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,256}$/.test(value);
var skillBackupId = (runtimeEpoch, operationId) => configurationBackupId(runtimeEpoch, operationId, "skill");
function validSkillSavedResult(record, sourceName) {
  const result = record.result;
  return !!(isSkillSave(record.type) && wireId2(record.runtimeEpoch) && wireId2(record.operationId) && resourceId2(record.workspaceId) && record.sessionId === void 0 && record.admission === "dispatched" && record.delivery === "accepted" && record.effect === "confirmed" && validSkillSourceName(sourceName) && result && Object.getPrototypeOf(result) === Object.prototype && ["kind", "workspaceId", "sourceName", "version"].every(
    (key) => Object.hasOwn(result, key)
  ) && Object.keys(result).every(
    (key) => ["kind", "workspaceId", "sourceName", "version", "backupId"].includes(
      key
    )
  ) && result.kind === "skill_file_saved" && result.workspaceId === record.workspaceId && result.sourceName === sourceName && typeof result.version === "string" && /^[a-f0-9]{64}$/.test(result.version) && (!Object.hasOwn(result, "backupId") || result.backupId === skillBackupId(record.runtimeEpoch, record.operationId)));
}

// apps/desktop-app/src/renderer/shared/configuration-draft/validation.mjs
var CONFIGURATION_DRAFT_LIMITS = Object.freeze({
  bytes: 32768,
  entries: 16,
  diffRows: 80
});
var emptyConfigurationDraft = Object.freeze({
  text: "",
  baseline: "",
  revision: 0,
  validation: null
});

// apps/desktop-app/src/workbench-contract.mjs
var ERRORS = Object.freeze({
  AGENT_CHANGED: "The Native Agent observation changed.",
  AGENT_UNVERIFIED: "The Native Agent identity or references could not be verified.",
  AGENT_UNSUPPORTED: "The Agent file cannot be converted for Native registration.",
  AGENT_OWNERSHIP_CONFLICT: "The Native Agent is not owned by this runtime.",
  AGENT_IN_USE: "A Native session still references this Agent.",
  SKILL_CHANGED: "The Native Skill observation changed.",
  SKILL_UNVERIFIED: "The Native Skill identity or history could not be verified.",
  SKILL_UNSUPPORTED: "The Skill file cannot be converted for Native registration.",
  SKILL_OWNERSHIP_CONFLICT: "The Native Skill is not owned by this runtime.",
  SKILL_ALREADY_APPLIED: "This Native Skill already has a record in the session.",
  MCP_CHANGED: "The MCP catalog changed after its observation.",
  MCP_UNVERIFIED: "The MCP status or ownership could not be verified.",
  MCP_UNSUPPORTED: "This MCP definition cannot be converted for runtime use.",
  MCP_OWNERSHIP_CONFLICT: "This MCP registration is not owned by the current runtime.",
  READ_BUSY: "The read capacity is occupied.",
  READ_TIMEOUT: "The whole-read deadline expired.",
  STALE_EPOCH: "The runtime epoch is no longer current.",
  STALE_REVISION: "The expected revision is no longer current.",
  ARCHIVED_SESSION: "Restore this archived session before executing.",
  EMPTY_SESSION: "Add conversation history before forking this session.",
  HAS_DESCENDANTS: "Remove descendant conversations first.",
  DESCENDANTS_UNVERIFIED: "The descendant list could not be verified.",
  INVALID_REQUEST: "Invalid workbench request.",
  NOT_FOUND: "The workspace or session is not registered.",
  BUSY: "The session is busy or its outcome is unconfirmed.",
  CANCELLED: "The operation was cancelled.",
  UNAVAILABLE: "The runtime is unavailable.",
  AUTH_REQUIRED: "No verified model credentials are available.",
  POLICY_UNVERIFIED: "The required permission policy could not be verified.",
  INVALID_SELECTION: "The selected runtime option is unavailable.",
  STALE_PERMISSION: "This permission request is no longer pending.",
  DUPLICATE_CONFLICT: "This request ID was already used with different content.",
  LIMIT_REACHED: "The temporary workbench limit was reached.",
  FILE_CHANGED: "The configuration file changed after its observation.",
  INSTRUCTIONS_CHANGED: "The session instruction registration changed after its observation.",
  INSTRUCTIONS_UNVERIFIED: "The session instruction ownership or state could not be verified.",
  FILE_DENIED: "This path cannot be accessed in the text preview.",
  FILE_UNSUPPORTED: "This file is not supported by the text preview.",
  FILE_TOO_LARGE: "This file exceeds the text preview limit.",
  RUNTIME_ERROR: "The runtime operation failed.",
  TOOL_ERROR: "A tool operation failed.",
  UNKNOWN_OUTCOME: "The operation outcome is unknown. It will not be resent automatically."
});
function validMcpSourceName(value) {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(value) && !["__proto__", "prototype", "constructor"].includes(value);
}
var READ_TYPES = Object.freeze([
  "git.commit.preview.read",
  "git.index.preview.read",
  "git.review.read",
  "git.diff.read",
  "file.edit.read",
  "configuration.extensions.read",
  "configuration.agent.runtime.read",
  "configuration.agent.list",
  "configuration.agent.read",
  "configuration.skill.runtime.read",
  "configuration.skill.list",
  "configuration.skill.read",
  "configuration.mcp.read",
  "configuration.instructions.read",
  "snapshot",
  "diagnostics.list",
  "catalog.list",
  "file.list",
  "file.read",
  "configuration.read",
  "operation.lookup"
]);
function validWireId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
}
var STORE_RECOVERY_REASONS = Object.freeze([
  "owner_conflict",
  "owner_unverified",
  "corrupt_journal",
  "unsupported_version",
  "identity_conflict",
  "unconfirmed_tail",
  "writer_poisoned",
  "pending_inbox",
  "native_startup_unverified",
  "storage_denied",
  "retained_limit"
]);
var RESOURCE_RECOVERY_REASONS = Object.freeze([
  "path_missing",
  "path_denied",
  "path_conflict",
  "native_mapping_unverified",
  "partial_native_mapping",
  "unresolved_operation"
]);

// apps/desktop-app/src/host/workbench-mcp.mjs
import { createHash as createHash7 } from "node:crypto";
var MCP_FEATURE = "configuration_mcp_v1";
var MCP_STATUSES = Object.freeze([
  "connected",
  "pending",
  "disabled",
  "failed",
  "needs_auth"
]);
var mcpDigest = (value) => createHash7("sha256").update(value, "utf8").digest("hex");
var validMcpNativeName = (value) => typeof value === "string" && /^omoc-mcp-[a-f0-9]{40}$/.test(value);
function mcpNativeName(workspaceId2, sourceName) {
  if (typeof workspaceId2 !== "string" || !/^[\w.:-]{1,256}$/.test(workspaceId2) || !validMcpSourceName(sourceName))
    throw new Error("invalid_mcp_identity");
  return `omoc-mcp-${mcpDigest(JSON.stringify([workspaceId2, sourceName])).slice(0, 40)}`;
}
function mcpStep(type) {
  const steps3 = {
    "configuration.mcp.register": "native.mcp.add",
    "configuration.mcp.connect": "native.mcp.connect",
    "configuration.mcp.disconnect": "native.mcp.disconnect",
    "configuration.mcp.remove": "native.mcp.remove"
  };
  return Object.hasOwn(steps3, type) ? steps3[type] : void 0;
}

// apps/desktop-app/src/host/storage-journal.mjs
import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import { createHash as createHash8 } from "node:crypto";
import { isAbsolute as isAbsolute3, join as join2, resolve } from "node:path";
import { isDeepStrictEqual as isDeepStrictEqual4 } from "node:util";

// apps/desktop-app/src/host/workbench-instructions.mjs
var INSTRUCTION_KEY = "omoc.project-instructions";
var INSTRUCTION_FEATURE = "configuration_instructions_v1";
var digest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
var id11 = (value) => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,256}$/.test(value);
function validInstructionRegistration(value) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || value.key !== INSTRUCTION_KEY)
    return false;
  if (value.state === "absent") return Object.keys(value).length === 2;
  if (value.state !== "registered" || !digest(value.digest) || !digest(value.sourceVersion))
    return false;
  const fields = ["state", "key", "digest", "sourceVersion", "origin"];
  if (value.origin === "fork") {
    if (!id11(value.inheritedFromSessionId)) return false;
    fields.push("inheritedFromSessionId");
  } else if (value.origin !== "direct") return false;
  return Object.keys(value).length === fields.length && fields.every((key) => Object.hasOwn(value, key));
}
function canonicalInstructionRegistration(value) {
  if (value === void 0) return null;
  if (!validInstructionRegistration(value))
    throw new Error("invalid_instruction_registration");
  if (value.state === "absent")
    return { state: "absent", key: INSTRUCTION_KEY };
  return {
    state: "registered",
    key: INSTRUCTION_KEY,
    digest: value.digest,
    sourceVersion: value.sourceVersion,
    origin: value.origin,
    ...value.origin === "fork" && {
      inheritedFromSessionId: value.inheritedFromSessionId
    }
  };
}

// apps/desktop-app/src/host/storage-journal.mjs
var STORAGE_LIMITS = Object.freeze({
  recordBytes: 4 * 1024 * 1024,
  operations: 2048,
  workspaces: 100,
  sessions: 200
});
var STORE_RECOVERY_REASONS2 = Object.freeze([
  "owner_conflict",
  "owner_unverified",
  "corrupt_journal",
  "unsupported_version",
  "identity_conflict",
  "unconfirmed_tail",
  "writer_poisoned",
  "pending_inbox",
  "native_startup_unverified",
  "storage_denied",
  "retained_limit"
]);
var RESOURCE_RECOVERY_REASONS2 = Object.freeze([
  "path_missing",
  "path_denied",
  "path_conflict",
  "native_mapping_unverified",
  "partial_native_mapping",
  "unresolved_operation"
]);
var mutations = /* @__PURE__ */ new Set([
  "git.commit.apply",
  "git.index.apply",
  "file.save",
  "configuration.agent.save",
  "configuration.agent.register",
  "configuration.agent.remove",
  "configuration.skill.register",
  "configuration.skill.remove",
  "configuration.skill.apply",
  "configuration.mcp.register",
  "configuration.mcp.connect",
  "configuration.mcp.disconnect",
  "configuration.mcp.remove",
  "configuration.save",
  "configuration.skill.save",
  "configuration.instructions.apply",
  "configuration.instructions.remove",
  "session.rename",
  "session.pin",
  "session.archive",
  "session.fork",
  "session.remove",
  "workspace.import",
  "workspace.create",
  "workspace.remove",
  "session.create",
  "message.send",
  "session.interrupt",
  "permission.respond",
  "command.run"
]);
var DISPATCH_STEPS = Object.freeze([
  ...Object.values(GIT_COMMIT_STEPS),
  ...Object.values(GIT_INDEX_STEPS),
  "native.agent.register",
  "native.agent.remove",
  "native.skill.register",
  "native.skill.remove",
  "native.skill.apply",
  "native.mcp.add",
  "native.mcp.connect",
  "native.mcp.disconnect",
  "native.mcp.remove",
  "filesystem.configuration.stage",
  "filesystem.configuration.publish",
  "native.instructions.put",
  "native.instructions.remove",
  "native.create",
  "native.fork",
  "native.remove",
  "native.rename",
  "native.pin",
  "native.archive",
  "native.metadata",
  "native.send",
  "native.command",
  "native.interrupt",
  "native.permission",
  "native.policy",
  "native.policy.before_selection",
  "native.policy.after_selection",
  "native.agent",
  "native.model",
  "registry.metadata",
  "registry.unregister",
  "filesystem.managed_base",
  "filesystem.managed_folder"
]);
var zeroHash = "0".repeat(64);
var clone = (value) => JSON.parse(JSON.stringify(value));
var hash = (value) => createHash8("sha256").update(JSON.stringify(value)).digest("hex");
function storageError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
function need9(condition, code = "invalid_record") {
  if (!condition) throw storageError(code);
}
var dataObject = (value) => Boolean(
  value && Object.getPrototypeOf(value) === Object.prototype && Reflect.ownKeys(value).every(
    (key) => typeof key === "string" && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value")
  )
);
var denseArray = (value) => Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype && Reflect.ownKeys(value).length === value.length + 1 && Array.from({ length: value.length }, (_, i) => i).every(
  (i) => Object.hasOwn(
    Object.getOwnPropertyDescriptor(value, String(i)) ?? {},
    "value"
  )
);
function closed12(value, required, optional = []) {
  need9(
    value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype
  );
  need9(
    required.every((key) => Object.hasOwn(value, key)) && Reflect.ownKeys(value).every(
      (key) => typeof key === "string" && [...required, ...optional].includes(key) && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value")
    )
  );
}
var integer = (value) => Number.isSafeInteger(value) && value >= 0;
var digest2 = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
var id12 = (value) => validWireId(value);
var resourceId3 = (value) => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,256}$/.test(value);
var displayText = (value) => ![...value].some(
  (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127
);
var path = (value) => typeof value === "string" && value.length <= 4096 && !value.includes("\0") && isAbsolute3(value) && resolve(value) === value;
function optionalIds(value, names) {
  for (const name of names)
    if (Object.hasOwn(value, name)) need9(resourceId3(value[name]));
}
function validateStorageIdentity(value) {
  closed12(
    value,
    ["runtimeEpoch", "operationId", "type", "digest"],
    ["workspaceId", "sessionId"]
  );
  need9(
    id12(value.runtimeEpoch) && id12(value.operationId) && mutations.has(value.type) && digest2(value.digest)
  );
  optionalIds(value, ["workspaceId", "sessionId"]);
  need9(!value.sessionId || value.workspaceId);
  if (isSkillSave(value.type) || isAgentSave(value.type))
    need9(value.workspaceId && !Object.hasOwn(value, "sessionId"));
  if (instructionStep(value.type)) need9(value.workspaceId && value.sessionId);
  if (mcpStep(value.type))
    need9(value.workspaceId && !Object.hasOwn(value, "sessionId"));
  validateFileScope(value);
  validateGitIndexScope(value);
  validateGitCommitScope(value);
  validateSkillRuntimeScope(value);
  validateAgentRuntimeScope(value);
  return clone(value);
}
function validateStorageReceipt(value) {
  closed12(
    value,
    [
      "runtimeEpoch",
      "operationId",
      "type",
      "admission",
      "delivery",
      "effect",
      "revision",
      "evidence"
    ],
    ["workspaceId", "sessionId", "result"]
  );
  need9(
    id12(value.runtimeEpoch) && id12(value.operationId) && mutations.has(value.type) && integer(value.revision)
  );
  optionalIds(value, ["workspaceId", "sessionId"]);
  need9(!value.sessionId || value.workspaceId);
  need9(["admitted", "dispatched", "rejected"].includes(value.admission));
  need9(
    ["pending", "accepted", "unknown"].includes(value.delivery) && ["none", "pending", "confirmed", "unknown"].includes(value.effect)
  );
  need9(
    Array.isArray(value.evidence) && value.evidence.length <= 8 && denseArray(value.evidence)
  );
  for (const entry of value.evidence) {
    closed12(entry, ["kind"], ["id"]);
    need9(resourceId3(entry.kind));
    optionalIds(entry, ["id"]);
  }
  if (Object.hasOwn(value, "result")) {
    const result = value.result;
    need9(dataObject(result));
    const shapes = {
      git_commit_created: [GIT_COMMIT_RESULT_FIELDS, []],
      git_index_updated: [GIT_INDEX_RESULT_FIELDS, []],
      created: [
        ["kind", "workspaceId"],
        ["sessionId", "nativeSessionId"]
      ],
      forked: [["kind", "workspaceId", "sessionId", "nativeSessionId"], []],
      removed: [
        ["kind", "workspaceId", "workspaceRemoved"],
        ["removedSessionIds"]
      ],
      metadata: [["kind", "workspaceId", "sessionId"], []],
      agent_file_saved: [
        ["kind", "workspaceId", "sourceName", "version"],
        ["backupId"]
      ],
      skill_file_saved: [
        ["kind", "workspaceId", "sourceName", "version"],
        ["backupId"]
      ],
      file_saved: [
        ["kind", "workspaceId", "path", "version", "digest", "backupId"],
        []
      ],
      configuration_saved: [
        ["kind", "workspaceId", "configurationKind", "version"],
        ["backupId"]
      ],
      mcp_registered: [
        [
          "kind",
          "workspaceId",
          "sourceName",
          "nativeName",
          "digest",
          "sourceVersion",
          "status"
        ],
        []
      ],
      mcp_connection: [
        [
          "kind",
          "workspaceId",
          "sourceName",
          "nativeName",
          "action",
          "connectionStatus"
        ],
        []
      ],
      mcp_removed: [["kind", "workspaceId", "sourceName", "nativeName"], []],
      instruction_registered: [
        ["kind", "workspaceId", "sessionId", "digest", "sourceVersion"],
        []
      ],
      instruction_removed: [["kind", "workspaceId", "sessionId"], []],
      delivery: [
        ["kind", "status"],
        ["nativeInboxId", "nativeRequestId"]
      ],
      rejected: [["kind", "code"], []]
    };
    for (const [kind3, fields] of Object.entries(SKILL_RUNTIME_RESULT_FIELDS))
      shapes[kind3] = [["kind", "workspaceId", ...fields], []];
    for (const [kind3, fields] of Object.entries(AGENT_RUNTIME_RESULT_FIELDS))
      shapes[kind3] = [["kind", "workspaceId", ...fields], []];
    need9(Object.hasOwn(shapes, result.kind));
    closed12(result, ...shapes[result.kind]);
    if (Object.hasOwn(SKILL_RUNTIME_RESULT_FIELDS, result.kind))
      need9(skillRuntimeStep(value.type));
    if (Object.hasOwn(AGENT_RUNTIME_RESULT_FIELDS, result.kind))
      need9(agentRuntimeStep(value.type));
    if (result.kind === "agent_file_saved")
      need9(validAgentSavedResult(value, result.sourceName));
    optionalIds(result, [
      "workspaceId",
      "sessionId",
      "nativeSessionId",
      "nativeInboxId",
      "nativeRequestId"
    ]);
    if (["mcp_registered", "mcp_connection", "mcp_removed"].includes(result.kind)) {
      need9(
        mcpStep(value.type) && value.workspaceId === result.workspaceId && !Object.hasOwn(value, "sessionId") && validMcpSourceName(result.sourceName) && validMcpNativeName(result.nativeName) && result.nativeName === mcpNativeName(value.workspaceId, result.sourceName) && value.delivery === "accepted" && (value.effect === "confirmed" && value.admission === "dispatched" || isMcpAbsentRemoval(value))
      );
      if (result.kind === "mcp_registered")
        need9(
          value.type === "configuration.mcp.register" && digest2(result.digest) && digest2(result.sourceVersion) && result.status === "disabled"
        );
      if (result.kind === "mcp_connection")
        need9(
          value.type === "configuration.mcp.connect" && result.action === "connect" && ["connected", "failed", "needs_auth"].includes(
            result.connectionStatus
          ) || value.type === "configuration.mcp.disconnect" && result.action === "disconnect" && result.connectionStatus === "disabled"
        );
      if (result.kind === "mcp_removed")
        need9(value.type === "configuration.mcp.remove");
    }
    if (result.kind === "skill_file_saved")
      need9(validSkillSavedResult(value, result.sourceName));
    if (result.kind === "configuration_saved")
      need9(
        value.type === "configuration.save" && value.workspaceId === result.workspaceId && value.effect === "confirmed" && ["instructions", "mcp"].includes(result.configurationKind) && digest2(result.version) && (result.backupId === void 0 || typeof result.backupId === "string" && new RegExp(
          `^\\.omoc-configuration-[a-f0-9]{64}\\.${result.configurationKind}\\.backup$`
        ).test(result.backupId))
      );
    if (["instruction_registered", "instruction_removed"].includes(result.kind)) {
      need9(
        value.type === (result.kind === "instruction_registered" ? "configuration.instructions.apply" : "configuration.instructions.remove") && value.workspaceId === result.workspaceId && value.sessionId === result.sessionId && value.admission === "dispatched" && value.delivery === "accepted" && value.effect === "confirmed"
      );
      if (result.kind === "instruction_registered")
        need9(digest2(result.digest) && digest2(result.sourceVersion));
    }
    if (result.kind === "removed") {
      need9(typeof result.workspaceRemoved === "boolean");
      if (Object.hasOwn(result, "removedSessionIds"))
        need9(
          Array.isArray(result.removedSessionIds) && result.removedSessionIds.length <= 200 && result.removedSessionIds.every(resourceId3) && new Set(result.removedSessionIds).size === result.removedSessionIds.length
        );
    }
    if (result.kind === "delivery")
      need9(["accepted", "stopping", "decided"].includes(result.status));
    if (result.kind === "rejected") need9(Object.hasOwn(ERRORS, result.code));
  }
  if (mcpStep(value.type)) {
    need9(value.workspaceId && !Object.hasOwn(value, "sessionId"));
    need9(
      value.result === void 0 || [
        "mcp_registered",
        "mcp_connection",
        "mcp_removed",
        "rejected"
      ].includes(value.result.kind)
    );
    if (value.effect === "confirmed")
      need9(value.result && value.result.kind !== "rejected");
    if (value.result?.kind === "rejected")
      need9(value.admission === "rejected" && value.effect === "none");
    if (value.effect === "none" && value.delivery === "accepted")
      need9(isMcpAbsentRemoval(value));
  }
  if (isSkillSave(value.type)) {
    need9(value.workspaceId && !Object.hasOwn(value, "sessionId"));
    if (value.effect === "confirmed")
      need9(validSkillSavedResult(value, value.result?.sourceName));
    else
      need9(
        value.result === void 0 || value.result.kind === "rejected" && value.admission === "rejected" && value.effect === "none"
      );
  }
  if (isAgentSave(value.type)) {
    need9(value.workspaceId && !Object.hasOwn(value, "sessionId"));
    if (value.effect === "confirmed")
      need9(validAgentSavedResult(value, value.result?.sourceName));
    else
      need9(
        (value.result === void 0 || value.result.kind === "rejected" && value.admission === "rejected" && value.effect === "none") && !(value.delivery === "accepted" && value.effect === "none")
      );
  }
  validateFileReceipt(value);
  validateGitIndexReceipt(value);
  validateGitCommitReceipt(value);
  validateSkillRuntimeReceipt(value);
  validateAgentRuntimeReceipt(value);
  return clone(value);
}
function validateRegistryDelta(value) {
  closed12(value, ["workspaces", "sessions", "tombstones"]);
  need9(
    Array.isArray(value.workspaces) && value.workspaces.length <= 100 && Array.isArray(value.sessions) && value.sessions.length <= 200 && Array.isArray(value.tombstones) && value.tombstones.length <= 300 && [value.workspaces, value.sessions, value.tombstones].every(denseArray)
  );
  for (const workspace of value.workspaces) {
    closed12(
      workspace,
      ["workspaceId", "ownership", "canonicalPath", "registrationState"],
      ["folderSessionId", "name", "trustRevision", "storageGeneration"]
    );
    need9(
      resourceId3(workspace.workspaceId) && ["managed", "imported", "legacy"].includes(workspace.ownership) && path(workspace.canonicalPath) && ["reserved", "registered", "unavailable"].includes(
        workspace.registrationState
      )
    );
    optionalIds(workspace, ["folderSessionId"]);
    if (workspace.ownership === "managed")
      need9(
        typeof workspace.folderSessionId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
          workspace.folderSessionId
        )
      );
    if (workspace.name !== void 0)
      need9(
        typeof workspace.name === "string" && workspace.name.length <= 256 && displayText(workspace.name)
      );
    for (const key of ["trustRevision", "storageGeneration"])
      if (workspace[key] !== void 0) need9(integer(workspace[key]));
  }
  for (const session of value.sessions) {
    closed12(
      session,
      ["appSessionId", "workspaceId", "lifecycleState", "pinned", "archived"],
      [
        "nativeSessionId",
        "parentSessionId",
        "title",
        "lastViewedAt",
        "recoveryReason",
        "instructionRegistration"
      ]
    );
    need9(
      resourceId3(session.appSessionId) && resourceId3(session.workspaceId) && ["reserved", "active", "unavailable"].includes(
        session.lifecycleState
      ) && typeof session.pinned === "boolean" && typeof session.archived === "boolean"
    );
    optionalIds(session, ["nativeSessionId", "parentSessionId"]);
    if (Object.hasOwn(session, "instructionRegistration"))
      need9(validInstructionRegistration(session.instructionRegistration));
    if (session.title !== void 0)
      need9(
        typeof session.title === "string" && session.title.length <= 256 && displayText(session.title)
      );
    if (session.lastViewedAt !== void 0) need9(integer(session.lastViewedAt));
    if (session.recoveryReason !== void 0)
      need9(
        session.lifecycleState === "unavailable" && RESOURCE_RECOVERY_REASONS2.includes(session.recoveryReason)
      );
  }
  for (const entry of value.tombstones) {
    closed12(entry, ["kind", "id"]);
    need9(["workspace", "session"].includes(entry.kind) && resourceId3(entry.id));
  }
  for (const [entries, key] of [
    [value.workspaces, "workspaceId"],
    [value.sessions, "appSessionId"]
  ])
    need9(
      new Set(entries.map((entry) => entry[key])).size === entries.length,
      "identity_conflict"
    );
  need9(
    new Set(
      value.tombstones.map((entry) => JSON.stringify([entry.kind, entry.id]))
    ).size === value.tombstones.length,
    "identity_conflict"
  );
  return clone(value);
}
function validateJournalPayload(value) {
  need9(dataObject(value));
  const common = ["kind", "revision"];
  need9(
    value && typeof value.kind === "string" && integer(value.revision) && value.revision > 0
  );
  switch (value.kind) {
    case "feature_gate":
      closed12(value, [...common, "feature"]);
      need9(
        [
          FILE_FEATURE,
          GIT_COMMIT_FEATURE,
          GIT_INDEX_FEATURE,
          "configuration_save_v1",
          INSTRUCTION_FEATURE,
          MCP_FEATURE,
          SKILL_FEATURE,
          SKILL_RUNTIME_FEATURE,
          AGENT_FEATURE
        ].includes(value.feature),
        "unsupported_version"
      );
      break;
    case "admission":
      closed12(
        value,
        [...common, "identity"],
        [
          "rejectionCode",
          "nativeServerName",
          "skillSourceName",
          "agentSourceName",
          "agentRuntime",
          "skillRuntime",
          "fileTarget",
          "expectedRevision",
          "gitCommitTarget",
          "gitIndexTarget"
        ]
      );
      validateStorageIdentity(value.identity);
      validateFileAdmission(value);
      validateGitIndexAdmission(value);
      validateGitCommitAdmission(value);
      validateMcpAdmission(value);
      validateSkillAdmission(value);
      validateAgentFileAdmission(value);
      validateAgentRuntimeAdmission(value);
      validateSkillRuntimeAdmission(value);
      if (value.rejectionCode !== void 0)
        need9(Object.hasOwn(ERRORS, value.rejectionCode));
      break;
    case "reservation":
      closed12(
        value,
        [...common, "runtimeEpoch", "operationId", "workspace", "appSessionId"],
        ["plannedNativeSessionId"]
      );
      need9(
        id12(value.runtimeEpoch) && id12(value.operationId) && resourceId3(value.appSessionId)
      );
      optionalIds(value, ["plannedNativeSessionId"]);
      validateRegistryDelta({
        workspaces: [value.workspace],
        sessions: [],
        tombstones: []
      });
      need9(value.workspace.registrationState === "reserved");
      break;
    case "dispatch":
      closed12(
        value,
        [...common, "runtimeEpoch", "operationId", "step"],
        [
          "nativeSessionId",
          "nativeServerName",
          "skillRuntime",
          "agentRuntime",
          "fileTarget",
          "gitCommitTarget",
          "gitIndexTarget"
        ]
      );
      need9(
        id12(value.runtimeEpoch) && id12(value.operationId) && DISPATCH_STEPS.includes(value.step)
      );
      optionalIds(value, ["nativeSessionId"]);
      validateFileDispatchPayload(value);
      validateGitIndexDispatchPayload(value);
      validateGitCommitDispatchPayload(value);
      validateSkillRuntimeDispatchPayload(value);
      validateAgentRuntimeDispatchPayload(value);
      if (value.step.startsWith("native.mcp."))
        need9(
          validMcpNativeName(value.nativeServerName) && !Object.hasOwn(value, "nativeSessionId")
        );
      else need9(!Object.hasOwn(value, "nativeServerName"));
      if (value.step.startsWith("native.instructions."))
        need9(resourceId3(value.nativeSessionId));
      break;
    case "completion":
      closed12(value, [
        ...common,
        "runtimeEpoch",
        "operationId",
        "receipt",
        "delta"
      ]);
      need9(id12(value.runtimeEpoch) && id12(value.operationId));
      validateStorageReceipt(value.receipt);
      validateRegistryDelta(value.delta);
      need9(
        value.receipt.runtimeEpoch === value.runtimeEpoch && value.receipt.operationId === value.operationId && value.receipt.revision === value.revision
      );
      break;
    case "owner_intent":
      closed12(value, [...common, "ownerNonce", "phase"], ["childId"]);
      need9(
        id12(value.ownerNonce) && ["startup", "child_started", "shutdown"].includes(value.phase)
      );
      optionalIds(value, ["childId"]);
      break;
    case "migration_phase":
      closed12(value, [
        ...common,
        "migrationId",
        "sourceStoreId",
        "destinationStoreId",
        "phase",
        "inventoryHash"
      ]);
      need9(
        id12(value.migrationId) && id12(value.sourceStoreId) && id12(value.destinationStoreId) && value.sourceStoreId !== value.destinationStoreId && [
          "retained",
          "quiesced",
          "copied",
          "verified",
          "cutover",
          "rollback"
        ].includes(value.phase) && digest2(value.inventoryHash)
      );
      break;
    case "recovery_decision":
      closed12(value, [...common, "action", "throughSequence", "throughHash"]);
      need9(
        value.action === "adopt_validated_tail" && integer(value.throughSequence) && digest2(value.throughHash)
      );
      break;
    default:
      throw storageError("unsupported_version");
  }
  return clone(value);
}
var operationKey = (value) => JSON.stringify([value.runtimeEpoch, value.operationId]);
function instructionStep(type) {
  if (type === "configuration.instructions.apply")
    return "native.instructions.put";
  if (type === "configuration.instructions.remove")
    return "native.instructions.remove";
  return void 0;
}
function validateInstructionDispatch(identity2, dispatch, sessions) {
  const expected = instructionStep(identity2.type);
  if (!expected && !dispatch.step.startsWith("native.instructions.")) return;
  const target = sessions.get(identity2.sessionId);
  need9(
    expected === dispatch.step && target?.workspaceId === identity2.workspaceId && target.lifecycleState === "active" && target.nativeSessionId && target.nativeSessionId === dispatch.nativeSessionId,
    "identity_conflict"
  );
}
function validateInstructionCompletion(operation, payload, sessions, features) {
  const { identity: identity2, reservation, dispatches } = operation;
  const { receipt, delta } = payload;
  const step = instructionStep(identity2.type);
  const confirmed = receipt.effect === "confirmed";
  if (delta.sessions.some(
    (session) => Object.hasOwn(session, "instructionRegistration")
  ))
    need9(features.includes(INSTRUCTION_FEATURE), "unsupported_version");
  if (step) {
    if (!confirmed) {
      need9(
        delta.sessions.length === 0 && delta.workspaces.length === 0 && delta.tombstones.length === 0 && (receipt.result === void 0 || receipt.admission === "rejected" && receipt.effect === "none" && receipt.result.kind === "rejected"),
        "identity_conflict"
      );
      return;
    }
    const target = sessions.get(identity2.sessionId);
    const session = delta.sessions[0] ?? target;
    const result = receipt.result;
    need9(
      target && target.workspaceId === identity2.workspaceId && target.lifecycleState === "active" && target.nativeSessionId && dispatches.some(
        (entry) => entry.step === step && entry.nativeSessionId === target.nativeSessionId
      ) && receipt.admission === "dispatched" && receipt.delivery === "accepted" && delta.workspaces.length === 0 && delta.tombstones.length === 0 && delta.sessions.length <= 1 && session.appSessionId === identity2.sessionId && session.workspaceId === identity2.workspaceId && session.nativeSessionId === target.nativeSessionId && session.lifecycleState === "active" && result?.workspaceId === identity2.workspaceId && result?.sessionId === identity2.sessionId,
      "identity_conflict"
    );
    const expected = step === "native.instructions.put" ? {
      state: "registered",
      key: INSTRUCTION_KEY,
      digest: result.digest,
      sourceVersion: result.sourceVersion,
      origin: "direct"
    } : { state: "absent", key: INSTRUCTION_KEY };
    need9(
      result.kind === (step === "native.instructions.put" ? "instruction_registered" : "instruction_removed") && isDeepStrictEqual4(
        canonicalInstructionRegistration(session.instructionRegistration),
        expected
      ),
      "identity_conflict"
    );
    const {
      instructionRegistration: _before,
      revision: _revision,
      ...before
    } = target;
    const {
      instructionRegistration: _after,
      revision: _afterRevision,
      ...after
    } = session;
    need9(isDeepStrictEqual4(before, after), "identity_conflict");
  }
  for (const session of delta.sessions) {
    if (step) continue;
    const existing = sessions.get(session.appSessionId);
    let expected = canonicalInstructionRegistration(
      existing?.instructionRegistration
    );
    if (identity2.type === "session.fork" && session.appSessionId === reservation?.appSessionId && confirmed) {
      const parent = sessions.get(identity2.sessionId);
      const registration2 = parent?.instructionRegistration;
      if (registration2 !== void 0) {
        need9(
          parent.workspaceId === identity2.workspaceId && session.parentSessionId === identity2.sessionId && session.lifecycleState === "active" && session.nativeSessionId && dispatches.some((entry) => entry.step === "native.fork") && receipt.admission === "dispatched" && receipt.delivery === "accepted" && receipt.result?.kind === "forked" && receipt.result.workspaceId === session.workspaceId && receipt.result.sessionId === session.appSessionId && receipt.result.nativeSessionId === session.nativeSessionId && receipt.evidence.some(
            (entry) => entry.kind === "native_session_verified" && entry.id === session.nativeSessionId
          ),
          "identity_conflict"
        );
        expected = registration2.state === "registered" ? {
          state: "registered",
          key: INSTRUCTION_KEY,
          digest: registration2.digest,
          sourceVersion: registration2.sourceVersion,
          origin: "fork",
          inheritedFromSessionId: identity2.sessionId
        } : canonicalInstructionRegistration(registration2);
      }
    }
    need9(
      isDeepStrictEqual4(
        canonicalInstructionRegistration(session.instructionRegistration),
        expected
      ),
      "identity_conflict"
    );
  }
}
function validateMcpAdmission(value) {
  need9(
    mcpStep(value.identity.type) ? validMcpNativeName(value.nativeServerName) : !Object.hasOwn(value, "nativeServerName")
  );
}
function validateMcpDispatch(operation, dispatch) {
  need9(typeof dispatch.step === "string");
  const expected = mcpStep(operation.identity.type);
  if (!expected && !dispatch.step.startsWith("native.mcp.") && !Object.hasOwn(dispatch, "nativeServerName"))
    return;
  need9(
    expected === dispatch.step && operation.identity.workspaceId && !Object.hasOwn(operation.identity, "sessionId") && !Object.hasOwn(dispatch, "nativeSessionId") && validMcpNativeName(dispatch.nativeServerName) && dispatch.nativeServerName === operation.nativeServerName,
    "identity_conflict"
  );
}
function isMcpAbsentRemoval(receipt) {
  return receipt.type === "configuration.mcp.remove" && receipt.admission === "admitted" && receipt.delivery === "accepted" && receipt.effect === "none" && receipt.result?.kind === "mcp_removed";
}
function validateMcpCompletion(operation, payload, features) {
  const { identity: identity2, dispatches } = operation;
  const { receipt, delta } = payload;
  if (!mcpStep(identity2.type)) return;
  need9(features.includes(MCP_FEATURE), "unsupported_version");
  need9(
    delta.workspaces.length === 0 && delta.sessions.length === 0 && delta.tombstones.length === 0,
    "identity_conflict"
  );
  const successful = receipt.effect === "confirmed" || isMcpAbsentRemoval(receipt);
  if (!successful) {
    need9(
      receipt.result === void 0 || receipt.admission === "rejected" && receipt.effect === "none" && receipt.result.kind === "rejected",
      "identity_conflict"
    );
    return;
  }
  need9(
    receipt.result?.nativeName === operation.nativeServerName && receipt.result?.workspaceId === identity2.workspaceId && receipt.result.nativeName === mcpNativeName(identity2.workspaceId, receipt.result.sourceName) && (isMcpAbsentRemoval(receipt) ? dispatches.length === 0 : dispatches.length === 1 && dispatches[0].step === mcpStep(identity2.type) && dispatches[0].nativeServerName === operation.nativeServerName),
    "identity_conflict"
  );
}
function validateSkillAdmission(value) {
  need9(
    isSkillSave(value.identity.type) ? validSkillSourceName(value.skillSourceName) : !Object.hasOwn(value, "skillSourceName")
  );
}
function validateSkillDispatch(operation, dispatch) {
  if (!isSkillSave(operation.identity.type)) return;
  need9(
    [
      "filesystem.configuration.stage",
      "filesystem.configuration.publish"
    ].includes(dispatch.step) && !Object.hasOwn(dispatch, "nativeSessionId") && !Object.hasOwn(dispatch, "nativeServerName") && (dispatch.step !== "filesystem.configuration.publish" || operation.dispatches.some(
      (entry) => entry.step === "filesystem.configuration.stage"
    )),
    "identity_conflict"
  );
}
function validateSkillCompletion(operation, payload, features) {
  if (!isSkillSave(operation.identity.type)) return;
  need9(features.includes(SKILL_FEATURE), "unsupported_version");
  const { receipt, delta } = payload;
  need9(
    !operation.reservation && !operation.reserved && delta.workspaces.length === 0 && delta.sessions.length === 0 && delta.tombstones.length === 0,
    "identity_conflict"
  );
  if (receipt.effect === "confirmed") {
    need9(
      validSkillSavedResult(receipt, operation.skillSourceName) && operation.dispatches.length === 2 && operation.dispatches[0].step === "filesystem.configuration.stage" && operation.dispatches[1].step === "filesystem.configuration.publish",
      "identity_conflict"
    );
  } else
    need9(
      receipt.result === void 0 || receipt.result.kind === "rejected" && receipt.admission === "rejected" && receipt.effect === "none" && operation.dispatches.length === 0,
      "identity_conflict"
    );
}
function validateAgentFileAdmission(value) {
  need9(
    isAgentSave(value.identity.type) ? validAgentSourceName(value.agentSourceName) : !Object.hasOwn(value, "agentSourceName")
  );
}
function validateAgentFileDispatch(operation, dispatch) {
  if (!isAgentSave(operation.identity.type)) return;
  need9(
    [
      "filesystem.configuration.stage",
      "filesystem.configuration.publish"
    ].includes(dispatch.step) && !Object.hasOwn(dispatch, "nativeSessionId") && !Object.hasOwn(dispatch, "nativeServerName") && (dispatch.step !== "filesystem.configuration.publish" || operation.dispatches.some(
      (entry) => entry.step === "filesystem.configuration.stage"
    )),
    "identity_conflict"
  );
}
function validateAgentFileCompletion(operation, payload, features) {
  if (!isAgentSave(operation.identity.type)) return;
  need9(features.includes(AGENT_FEATURE), "unsupported_version");
  const { receipt, delta } = payload;
  need9(
    !operation.reservation && !operation.reserved && delta.workspaces.length === 0 && delta.sessions.length === 0 && delta.tombstones.length === 0,
    "identity_conflict"
  );
  if (receipt.effect === "confirmed") {
    need9(
      validAgentSavedResult(receipt, operation.agentSourceName) && operation.dispatches.length === 2 && operation.dispatches[0].step === "filesystem.configuration.stage" && operation.dispatches[1].step === "filesystem.configuration.publish",
      "identity_conflict"
    );
  } else
    need9(
      receipt.result === void 0 || receipt.result.kind === "rejected" && receipt.admission === "rejected" && receipt.effect === "none" && operation.dispatches.length === 0,
      "identity_conflict"
    );
}
function historyValidator() {
  const operations = /* @__PURE__ */ new Map();
  const migrations = /* @__PURE__ */ new Map();
  const sessions = /* @__PURE__ */ new Map();
  const features = /* @__PURE__ */ new Set();
  let revision = 0;
  return (payload) => {
    need9(payload.revision === revision + 1, "identity_conflict");
    const key = operationKey(payload.identity ?? payload);
    const prior = operations.get(key);
    if (payload.kind === "feature_gate") {
      need9(!features.has(payload.feature), "identity_conflict");
      features.add(payload.feature);
    } else if (payload.kind === "admission") {
      need9(
        !isGitCommitApply(payload.identity.type) || features.has(GIT_COMMIT_FEATURE),
        "unsupported_version"
      );
      need9(
        !isGitIndexApply(payload.identity.type) || features.has(GIT_INDEX_FEATURE),
        "unsupported_version"
      );
      need9(
        !isFileSave(payload.identity.type) || features.has(FILE_FEATURE),
        "unsupported_version"
      );
      need9(
        payload.identity.type !== "configuration.save" || features.has("configuration_save_v1"),
        "unsupported_version"
      );
      need9(
        !instructionStep(payload.identity.type) || features.has(INSTRUCTION_FEATURE),
        "unsupported_version"
      );
      need9(
        !mcpStep(payload.identity.type) || features.has(MCP_FEATURE),
        "unsupported_version"
      );
      need9(
        !skillRuntimeStep(payload.identity.type) || features.has(SKILL_RUNTIME_FEATURE),
        "unsupported_version"
      );
      need9(
        !isSkillSave(payload.identity.type) || features.has(SKILL_FEATURE),
        "unsupported_version"
      );
      need9(
        !(isAgentSave(payload.identity.type) || agentRuntimeStep(payload.identity.type)) || features.has(AGENT_FEATURE),
        "unsupported_version"
      );
      if (payload.identity.type === "session.fork" && sessions.get(payload.identity.sessionId)?.instructionRegistration !== void 0)
        need9(features.has(INSTRUCTION_FEATURE), "unsupported_version");
      need9(!prior, "identity_conflict");
      need9(operations.size < STORAGE_LIMITS.operations, "retained_limit");
      operations.set(key, {
        identity: payload.identity,
        ...isGitCommitApply(payload.identity.type) && {
          gitCommitTarget: payload.gitCommitTarget,
          expectedRevision: payload.expectedRevision
        },
        ...isGitIndexApply(payload.identity.type) && {
          gitIndexTarget: payload.gitIndexTarget
        },
        ...isFileSave(payload.identity.type) && {
          fileTarget: payload.fileTarget
        },
        ...isAgentSave(payload.identity.type) && {
          agentSourceName: payload.agentSourceName
        },
        ...agentRuntimeStep(payload.identity.type) && {
          agentRuntime: payload.agentRuntime
        },
        ...skillRuntimeStep(payload.identity.type) && {
          skillRuntime: payload.skillRuntime
        },
        ...isSkillSave(payload.identity.type) && {
          skillSourceName: payload.skillSourceName
        },
        ...mcpStep(payload.identity.type) && {
          nativeServerName: payload.nativeServerName
        },
        terminal: !!payload.rejectionCode,
        reserved: false,
        steps: /* @__PURE__ */ new Set(),
        dispatches: []
      });
    } else if (["reservation", "dispatch", "completion"].includes(payload.kind)) {
      need9(prior && !prior.terminal, "identity_conflict");
      if (payload.kind === "reservation") {
        need9(
          !isGitCommitApply(prior.identity.type) && !isGitIndexApply(prior.identity.type) && !isFileSave(prior.identity.type) && !agentRuntimeStep(prior.identity.type) && !isAgentSave(prior.identity.type) && !skillRuntimeStep(prior.identity.type) && !isSkillSave(prior.identity.type) && !instructionStep(prior.identity.type) && !mcpStep(prior.identity.type) && !prior.reserved,
          "identity_conflict"
        );
        prior.reserved = true;
        prior.reservation = payload;
      }
      if (payload.kind === "dispatch") {
        validateInstructionDispatch(prior.identity, payload, sessions);
        validateFileDispatch(prior, payload);
        validateGitIndexDispatch(prior, payload);
        validateGitCommitDispatch(prior, payload);
        validateMcpDispatch(prior, payload);
        validateSkillDispatch(prior, payload);
        validateAgentFileDispatch(prior, payload);
        validateAgentRuntimeDispatch(prior, payload, sessions, operations);
        validateSkillRuntimeDispatch(prior, payload, sessions, operations);
        need9(
          [
            "file.save",
            "configuration.save",
            "configuration.skill.save",
            "configuration.agent.save"
          ].includes(prior.identity.type) === payload.step.startsWith("filesystem.configuration."),
          "identity_conflict"
        );
        if (payload.step === "filesystem.configuration.publish")
          need9(
            prior.steps.has("filesystem.configuration.stage"),
            "identity_conflict"
          );
        need9(!prior.steps.has(payload.step), "identity_conflict");
        prior.steps.add(payload.step);
        prior.dispatches.push(payload);
      }
      if (payload.kind === "completion") {
        for (const field of [
          "runtimeEpoch",
          "operationId",
          "type",
          "workspaceId",
          "sessionId"
        ])
          need9(
            payload.receipt[field] === prior.identity[field],
            "identity_conflict"
          );
        need9(
          payload.receipt.effect !== "confirmed" || prior.steps.size > 0,
          "identity_conflict"
        );
        need9(
          payload.receipt.effect !== "none" || prior.steps.size === 0,
          "identity_conflict"
        );
        need9(
          payload.receipt.admission !== "rejected" || payload.receipt.effect === "none",
          "identity_conflict"
        );
        if (prior.identity.type === "configuration.save" && payload.receipt.effect === "confirmed")
          need9(
            prior.steps.has("filesystem.configuration.stage") && prior.steps.has("filesystem.configuration.publish") && payload.receipt.result?.kind === "configuration_saved" && payload.delta.workspaces.length === 0 && payload.delta.sessions.length === 0 && payload.delta.tombstones.length === 0,
            "identity_conflict"
          );
        validateInstructionCompletion(prior, payload, sessions, [...features]);
        validateFileCompletion(prior, payload, [...features]);
        validateGitIndexCompletion(prior, payload, [...features]);
        validateGitCommitCompletion(prior, payload, [...features]);
        validateMcpCompletion(prior, payload, [...features]);
        validateSkillCompletion(prior, payload, [...features]);
        validateAgentFileCompletion(prior, payload, [...features]);
        validateAgentRuntimeCompletion(
          prior,
          payload,
          [...features],
          sessions,
          operations
        );
        validateSkillRuntimeCompletion(
          prior,
          payload,
          [...features],
          sessions,
          operations
        );
        need9(
          !((isGitIndexApply(prior.identity.type) || isGitCommitApply(prior.identity.type)) && prior.completedDelta && payload.receipt.effect === "confirmed"),
          "identity_conflict"
        );
        prior.receipt = payload.receipt;
        if (isGitIndexApply(prior.identity.type) || isGitCommitApply(prior.identity.type))
          prior.completedDelta = payload.delta;
        for (const session of payload.delta.sessions)
          sessions.set(session.appSessionId, session);
        for (const tombstone of payload.delta.tombstones)
          if (tombstone.kind === "session") sessions.delete(tombstone.id);
        prior.terminal = payload.receipt.effect === "confirmed" || isMcpAbsentRemoval(payload.receipt) || payload.receipt.admission === "rejected";
      }
    } else if (payload.kind === "migration_phase") {
      const priorMigration = migrations.get(payload.migrationId);
      if (priorMigration)
        need9(
          priorMigration.sourceStoreId === payload.sourceStoreId && priorMigration.destinationStoreId === payload.destinationStoreId && priorMigration.phase !== "rollback",
          "identity_conflict"
        );
      const transitions = {
        retained: ["quiesced", "rollback"],
        quiesced: ["copied", "rollback"],
        copied: ["verified", "rollback"],
        verified: ["cutover", "rollback"],
        cutover: ["rollback"]
      };
      need9(
        priorMigration ? transitions[priorMigration.phase]?.includes(payload.phase) : payload.phase === "retained",
        "identity_conflict"
      );
      migrations.set(payload.migrationId, payload);
    }
    revision = payload.revision;
  };
}
async function openStorageJournal({
  directory,
  storeId,
  io = {},
  recoveryReason
} = {}) {
  need9(path(directory) && id12(storeId));
  if (recoveryReason !== void 0)
    need9(STORE_RECOVERY_REASONS2.includes(recoveryReason));
  const adapter = {
    write: (file, bytes4) => file.writeFile(bytes4),
    syncFile: (file) => file.sync(),
    syncDirectory: async (directory2) => {
      const handle2 = await fs.open(directory2, constants.O_RDONLY);
      try {
        await handle2.sync();
      } finally {
        await handle2.close();
      }
    },
    rename: fs.rename,
    unlink: fs.unlink,
    ...io
  };
  const filename = join2(directory, "journal.jsonl");
  const current = join2(directory, "checkpoint.json");
  const previous = join2(directory, "checkpoint.previous.json");
  const pending = join2(directory, "checkpoint.pending.json");
  const temp = join2(directory, "checkpoint.tmp.json");
  let handle;
  let reason = recoveryReason;
  let closedWriter = false;
  let queue = Promise.resolve();
  let records = [];
  let committed = [];
  let checkpointGeneration = 0;
  let checkpointValue;
  let lastHash = zeroHash;
  let uncertainCheckpoint = false;
  try {
    const stat = await fs.lstat(directory);
    need9(stat.isDirectory() && !stat.isSymbolicLink(), "storage_denied");
    need9(await fs.realpath(directory) === directory, "storage_denied");
    for (const entry of [filename, current, previous, pending, temp]) {
      try {
        const stat2 = await fs.lstat(entry);
        need9(
          stat2.isFile() && !stat2.isSymbolicLink() && stat2.nlink === 1,
          "storage_denied"
        );
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    let bytes4;
    try {
      bytes4 = await fs.readFile(filename);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      bytes4 = Buffer.alloc(0);
    }
    const validateHistory = historyValidator();
    let offset = 0;
    while (offset < bytes4.length) {
      const end = bytes4.indexOf(10, offset);
      try {
        need9(
          end !== -1 && end - offset + 1 <= STORAGE_LIMITS.recordBytes,
          "corrupt_journal"
        );
        const line = bytes4.subarray(offset, end);
        const decoded = line.toString("utf8");
        need9(Buffer.from(decoded).equals(line), "corrupt_journal");
        const record = JSON.parse(decoded);
        closed12(record, [
          "schemaVersion",
          "storeId",
          "sequence",
          "previousHash",
          "payload",
          "checksum"
        ]);
        need9(record.schemaVersion === 1, "unsupported_version");
        need9(
          record.storeId === storeId && record.sequence === records.length + 1 && record.previousHash === lastHash,
          "identity_conflict"
        );
        const { checksum, ...body } = record;
        need9(digest2(checksum) && hash(body) === checksum, "corrupt_journal");
        validateJournalPayload(record.payload);
        if (record.payload.kind === "recovery_decision")
          need9(
            record.payload.throughSequence === records.length && record.payload.throughHash === lastHash,
            "identity_conflict"
          );
        validateHistory(record.payload);
        records.push(record);
        lastHash = checksum;
        offset = end + 1;
      } catch (error) {
        reason = [
          "unsupported_version",
          "identity_conflict",
          "retained_limit"
        ].includes(error.code) ? error.code : "corrupt_journal";
        break;
      }
    }
    let ceiling = Infinity;
    try {
      const marker = JSON.parse(await fs.readFile(pending, "utf8"));
      closed12(marker, ["schemaVersion", "storeId", "baseGeneration"]);
      need9(
        marker.schemaVersion === 1 && marker.storeId === storeId && integer(marker.baseGeneration)
      );
      ceiling = marker.baseGeneration;
      uncertainCheckpoint = true;
    } catch (error) {
      if (error.code !== "ENOENT") {
        ceiling = 0;
        uncertainCheckpoint = true;
        reason ??= "corrupt_journal";
      }
    }
    const checkpoints = [];
    for (const entry of [current, previous]) {
      try {
        const candidate = JSON.parse(await fs.readFile(entry, "utf8"));
        closed12(candidate, [
          "schemaVersion",
          "storeId",
          "generation",
          "sequence",
          "hash",
          "checksum"
        ]);
        need9(candidate.schemaVersion === 1, "unsupported_version");
        const { checksum, ...body } = candidate;
        need9(
          candidate.storeId === storeId && integer(candidate.generation) && candidate.generation > 0 && integer(candidate.sequence) && candidate.sequence <= records.length && candidate.hash === (candidate.sequence ? records[candidate.sequence - 1].checksum : zeroHash) && checksum === hash(body),
          "corrupt_journal"
        );
        if (candidate.generation <= ceiling) checkpoints.push(candidate);
      } catch (error) {
        if (error.code !== "ENOENT")
          reason ??= error.code === "unsupported_version" ? "unsupported_version" : "corrupt_journal";
      }
    }
    checkpoints.sort((a, b) => b.generation - a.generation);
    checkpointValue = checkpoints[0];
    checkpointGeneration = checkpointValue?.generation ?? 0;
    committed = records.slice(0, checkpointValue?.sequence ?? 0);
    if (records.length > committed.length || uncertainCheckpoint)
      reason ??= "unconfirmed_tail";
    if (!reason) {
      handle = await fs.open(
        filename,
        constants.O_CREAT | constants.O_APPEND | constants.O_WRONLY | constants.O_NOFOLLOW,
        384
      );
      await adapter.syncFile(handle, "open");
      await adapter.syncDirectory(directory, "open");
    }
  } catch (error) {
    reason = error.code === "storage_denied" ? error.code : "storage_denied";
    if (handle) {
      await handle.close();
      handle = void 0;
    }
  }
  const status = () => ({
    state: reason ? "recovery_required" : "ready",
    ...reason && { reason },
    sequence: records.length,
    hash: lastHash,
    checkpointGeneration,
    checkpointSequence: checkpointValue?.sequence ?? 0,
    directoryFlush: "required; platform failures block writes; power-loss durability unverified",
    closed: closedWriter
  });
  const assertWritable = () => {
    if (closedWriter) throw storageError("closed");
    if (reason) throw storageError(reason);
  };
  const serialized = (fn) => {
    const task = queue.then(fn);
    queue = task.catch(() => {
    });
    return task;
  };
  const poison = () => {
    reason = "writer_poisoned";
  };
  async function appendInternal(payload) {
    assertWritable();
    const validated = validateJournalPayload(payload);
    if (validated.kind === "recovery_decision")
      need9(
        validated.throughSequence === records.length && validated.throughHash === lastHash,
        "identity_conflict"
      );
    const validateHistory = historyValidator();
    for (const record2 of records) validateHistory(record2.payload);
    validateHistory(validated);
    const body = {
      schemaVersion: 1,
      storeId,
      sequence: records.length + 1,
      previousHash: lastHash,
      payload: validated
    };
    const record = { ...body, checksum: hash(body) };
    const bytes4 = Buffer.from(JSON.stringify(record) + "\n");
    need9(bytes4.length <= STORAGE_LIMITS.recordBytes);
    try {
      await adapter.write(handle, bytes4, "append");
      await adapter.syncFile(handle, `append:${payload.kind}`);
      await adapter.syncDirectory(directory, "append");
    } catch {
      poison();
      throw storageError(reason);
    }
    records.push(record);
    lastHash = record.checksum;
    return clone(record);
  }
  async function writeFlushed(filename2, value, context, exclusive = false) {
    const file = await fs.open(
      filename2,
      constants.O_WRONLY | constants.O_CREAT | (exclusive ? constants.O_EXCL : constants.O_TRUNC) | constants.O_NOFOLLOW,
      384
    );
    try {
      await adapter.write(
        file,
        Buffer.from(JSON.stringify(value) + "\n"),
        context
      );
      await adapter.syncFile(file, context);
    } finally {
      await file.close();
    }
  }
  async function checkpointInternal() {
    assertWritable();
    const body = {
      schemaVersion: 1,
      storeId,
      generation: checkpointGeneration + 1,
      sequence: records.length,
      hash: lastHash
    };
    const candidate = { ...body, checksum: hash(body) };
    try {
      await writeFlushed(
        pending,
        { schemaVersion: 1, storeId, baseGeneration: checkpointGeneration },
        "checkpoint:pending",
        !uncertainCheckpoint
      );
      await adapter.syncDirectory(directory, "checkpoint:pending");
      if (checkpointValue)
        await writeFlushed(previous, checkpointValue, "checkpoint:previous");
      await writeFlushed(temp, candidate, "checkpoint:file");
      await adapter.rename(temp, current);
      await adapter.syncDirectory(directory, "checkpoint:publish");
      await adapter.unlink(pending);
    } catch {
      poison();
      throw storageError(reason);
    }
    checkpointValue = candidate;
    checkpointGeneration = candidate.generation;
    committed = records.slice();
    uncertainCheckpoint = false;
    return clone(candidate);
  }
  return {
    status,
    readRecords: () => clone({
      committed,
      uncertain: records.slice(committed.length),
      validated: records
    }),
    append: (payload) => {
      const copy = validateJournalPayload(payload);
      return serialized(() => appendInternal(copy));
    },
    checkpoint: () => serialized(checkpointInternal),
    // Only a trusted local host recovery decision may adopt a complete validated tail.
    recover: (decision) => serialized(async () => {
      closed12(decision, [
        "action",
        "expectedSequence",
        "expectedHash",
        "ownerVerified",
        "preflightVerified"
      ]);
      need9(
        decision.action === "adopt_validated_tail" && decision.ownerVerified === true && decision.preflightVerified === true && decision.expectedSequence === records.length && decision.expectedHash === lastHash,
        "recovery_denied"
      );
      need9(
        reason === "unconfirmed_tail" && !uncertainCheckpoint,
        "recovery_denied"
      );
      need9(
        !records.slice(committed.length).some(
          ({ payload }) => payload.kind === "completion" && isGitCommitApply(payload.receipt.type) && payload.receipt.effect === "confirmed"
        ),
        "recovery_denied"
      );
      reason = void 0;
      try {
        handle = await fs.open(
          filename,
          constants.O_APPEND | constants.O_WRONLY | constants.O_NOFOLLOW
        );
        await appendInternal({
          kind: "recovery_decision",
          revision: (records.at(-1)?.payload.revision ?? 0) + 1,
          action: decision.action,
          throughSequence: decision.expectedSequence,
          throughHash: decision.expectedHash
        });
        await checkpointInternal();
        return status();
      } catch {
        poison();
        throw storageError(reason);
      }
    }),
    close: () => serialized(async () => {
      if (closedWriter) return;
      closedWriter = true;
      if (handle) {
        await handle.close();
        handle = void 0;
      }
    })
  };
}
export {
  DISPATCH_STEPS,
  RESOURCE_RECOVERY_REASONS2 as RESOURCE_RECOVERY_REASONS,
  STORAGE_LIMITS,
  STORE_RECOVERY_REASONS2 as STORE_RECOVERY_REASONS,
  instructionStep,
  isMcpAbsentRemoval,
  openStorageJournal,
  storageError,
  validateAgentFileAdmission,
  validateAgentFileCompletion,
  validateAgentFileDispatch,
  validateInstructionCompletion,
  validateInstructionDispatch,
  validateJournalPayload,
  validateMcpAdmission,
  validateMcpCompletion,
  validateMcpDispatch,
  validateRegistryDelta,
  validateSkillAdmission,
  validateSkillCompletion,
  validateSkillDispatch,
  validateStorageIdentity,
  validateStorageReceipt
};
