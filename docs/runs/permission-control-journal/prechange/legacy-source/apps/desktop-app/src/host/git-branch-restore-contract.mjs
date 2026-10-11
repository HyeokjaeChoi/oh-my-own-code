// Private typed descriptor contract. No IO or process activity at import.
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { isAbsolute, normalize, join } from "node:path";
import { GIT_COMMIT_STATE_MARKERS } from "./git-commit-contract.mjs";
import { validGitCommitAuthor } from "../renderer/shared/git-commit/index.mjs";
import { validWorkspaceFilePath } from "../renderer/shared/workspace-file/index.mjs";
import {
  GIT_BRANCH_RESTORE_FEATURE,
  validGitBranchRestoreTarget,
  gitBranchRestoreBackupRoles,
  validateGitBranchRestoreMutationResult,
} from "../renderer/shared/git-branch-restore/index.mjs";
export const GIT_BRANCH_RESTORE_STATE_MARKERS = GIT_COMMIT_STATE_MARKERS;
export const GIT_BRANCH_RESTORE_KERNEL_LIMITS = Object.freeze({
  wireBytes: 262144,
  manifestBytes: 16777216,
  indexBytes: 16777216,
  artifactBytes: 134217728,
  artifactFiles: 16384,
  sourceFiles: 16384,
  directories: 32768,
  depth: 32,
  chunkBytes: 1048576,
  deadlineMs: 10000,
});
const L = GIT_BRANCH_RESTORE_KERNEL_LIMITS;
const hash = (v, format = "sha256") =>
  createHash(format).update(v).digest("hex");
const hex = (v) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
const id = (v, max = 128) =>
  typeof v === "string" &&
  new RegExp(`^[A-Za-z0-9_.:-]{1,${max}}$`, "u").test(v);
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
const need = (v) => {
  if (!v)
    throw Object.assign(
      new Error("Invalid private Git branch/restore authority."),
      { appCode: "INVALID_REQUEST" },
    );
};
const controls = (v) => /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(v);
const absolute = (v) =>
  typeof v === "string" &&
  v.isWellFormed() &&
  Buffer.byteLength(v) <= 32768 &&
  isAbsolute(v) &&
  normalize(v) === v &&
  !controls(v);
const relative = (v) =>
  typeof v === "string" &&
  v.isWellFormed() &&
  Buffer.byteLength(v) <= 4096 &&
  !isAbsolute(v) &&
  v.split("/").every((p) => p && p !== "." && p !== "..") &&
  !v.includes("\\") &&
  !controls(v);
const uint = (v) =>
  typeof v === "string" && /^(?:0|[1-9][0-9]{0,29})$/u.test(v);
const bytes = (v, cap = L.artifactBytes) =>
  Number.isSafeInteger(v) && v >= 0 && v <= cap;
const inside = (a, b) => b === a || b.startsWith(a === "/" ? a : a + "/");
const directory = (v) =>
  closed(v, ["path", "dev", "ino"]) &&
  absolute(v.path) &&
  uint(v.dev) &&
  uint(v.ino);
const fileRef = (v, cap = L.artifactBytes) =>
  closed(v, ["path", "bytes", "digest"]) &&
  relative(v.path) &&
  bytes(v.bytes, cap) &&
  hex(v.digest);
const unique = (xs, key) => new Set(xs.map(key)).size === xs.length;
const originalFields = [
  "runtimeEpoch",
  "operationId",
  "workspaceId",
  "workspacePath",
  "digest",
  "target",
];
export function gitBranchRestoreBackupId(
  epoch,
  operationId,
  role,
  path = null,
) {
  need(
    id(epoch) &&
      id(operationId) &&
      ((role === "worktree" && validWorkspaceFilePath(path)) ||
        (["index", "head_log", "head_ref", "branch_log", "branch_ref"].includes(
          role,
        ) &&
          path === null)),
  );
  return `.omoc-git-branch-restore-${hash(JSON.stringify([epoch, operationId, role, path]))}.backup`;
}
export function gitBranchRestoreExpectedBackups(target, epoch, operationId) {
  return gitBranchRestoreBackupRoles(target).map((x) => ({
    role: x.role,
    path: x.path,
    backupId: x.exists
      ? gitBranchRestoreBackupId(epoch, operationId, x.role, x.path)
      : null,
  }));
}
export function gitBranchRestoreIdentityDigest(author, timestamp) {
  need(
    validGitCommitAuthor(author) &&
      Number.isSafeInteger(timestamp) &&
      timestamp >= 0,
  );
  return hash(JSON.stringify([author.name, author.email, timestamp]));
}
// Main and the kernel independently call this on verified raw object bytes.
// It preserves every byte except canonical ident tokens under the LF-only policy.
export function gitBranchRestoreBlob(raw, oid, format, ident) {
  need(
    Buffer.isBuffer(raw) &&
      raw.length <= 16777216 &&
      ["sha1", "sha256"].includes(format) &&
      typeof oid === "string" &&
      new RegExp(`^[a-f0-9]{${format === "sha1" ? 40 : 64}}$`, "u").test(oid) &&
      typeof ident === "boolean",
  );
  need(
    createHash(format)
      .update(Buffer.from(`blob ${raw.length}\0`))
      .update(raw)
      .digest("hex") === oid,
  );
  if (!ident) return Buffer.from(raw);
  need(!raw.includes(Buffer.from("$Id:")));
  const token = Buffer.from("$Id$"),
    replacement = Buffer.from(`$Id: ${oid} $`),
    chunks = [];
  let at = 0,
    total = 0;
  for (;;) {
    const next = raw.indexOf(token, at);
    if (next < 0) {
      const tail = raw.subarray(at);
      chunks.push(tail);
      total += tail.length;
      break;
    }
    const prefix = raw.subarray(at, next);
    chunks.push(prefix, replacement);
    total += prefix.length + replacement.length;
    need(total <= 16777216);
    at = next + token.length;
  }
  need(total <= 16777216);
  return Buffer.concat(chunks, total);
}
export function gitBranchRestoreOccupancyDigest(rows) {
  need(
    dense(rows, 4096) &&
      rows.every(
        (r, i) =>
          dense(r, 5) &&
          r.length === 5 &&
          absolute(r[0]) &&
          hex(r[1]) &&
          r.slice(2).every((x) => x === null || hex(x)) &&
          (i === 0 ||
            Buffer.compare(Buffer.from(rows[i - 1][0]), Buffer.from(r[0])) < 0),
      ),
  );
  return hash(JSON.stringify(rows));
}
export function validateGitBranchRestoreKernelRequest(v) {
  need(
    closed(v, [...originalFields, "artifact"]) &&
      id(v.runtimeEpoch) &&
      id(v.operationId) &&
      id(v.workspaceId, 256) &&
      absolute(v.workspacePath) &&
      v.workspacePath !== "/" &&
      hex(v.digest) &&
      validGitBranchRestoreTarget(v.target),
  );
  const a = v.artifact;
  need(
    closed(a, ["root", "dev", "ino", "manifest"]) &&
      absolute(a.root) &&
      a.root !== "/" &&
      uint(a.dev) &&
      uint(a.ino) &&
      fileRef(a.manifest, L.manifestBytes) &&
      a.manifest.path === "manifest.json" &&
      a.manifest.bytes > 0 &&
      !inside(v.workspacePath, a.root) &&
      !inside(a.root, v.workspacePath),
  );
  need(Buffer.byteLength(JSON.stringify(v)) <= L.wireBytes);
  return v;
}
export function validateGitBranchRestoreArtifactManifest(v, r) {
  validateGitBranchRestoreKernelRequest(r);
  need(
    closed(v, [
      "schemaVersion",
      "feature",
      ...originalFields,
      "layout",
      "source",
      "author",
      "currentEntries",
      "desiredEntries",
      "worktree",
      "metadata",
      "objects",
    ]) &&
      v.schemaVersion === 1 &&
      v.feature === GIT_BRANCH_RESTORE_FEATURE &&
      originalFields.every((k) => isDeepStrictEqual(v[k], r[k])),
  );
  need(
    closed(v.layout, ["root", "gitDirectory", "commonDirectory"]) &&
      Object.values(v.layout).every(directory) &&
      v.layout.root.path === v.workspacePath &&
      v.layout.gitDirectory.path !== v.workspacePath &&
      v.layout.commonDirectory.path !== v.workspacePath,
  );
  const roots = Object.values(v.layout).map((x) => x.path);
  need(
    roots.every(
      (p) => !inside(p, r.artifact.root) && !inside(r.artifact.root, p),
    ),
  );
  const s = v.source;
  need(closed(s, ["directories", "files", "listings", "missing"]));
  need(
    dense(s.directories, L.directories) &&
      s.directories.every(
        (x) =>
          directory(x) &&
          roots.some((p) => inside(p, x.path) || inside(x.path, p)),
      ) &&
      unique(s.directories, (x) => x.path),
  );
  need(
    dense(s.files, L.sourceFiles) &&
      s.files.every(
        (x) =>
          closed(x, ["path", "signature", "digest"]) &&
          absolute(x.path) &&
          roots.some((p) => inside(p, x.path)) &&
          typeof x.signature === "string" &&
          /^[0-9]+(?::[0-9]+){6}$/u.test(x.signature) &&
          hex(x.digest),
      ) &&
      unique(s.files, (x) => x.path),
  );
  need(
    dense(s.listings, L.directories) &&
      s.listings.every(
        (x) =>
          closed(x, ["path", "names"]) &&
          absolute(x.path) &&
          roots.some((p) => inside(p, x.path)) &&
          dense(x.names, L.artifactFiles) &&
          x.names.every(
            (n, i) =>
              relative(n) &&
              !n.includes("/") &&
              (i === 0 || x.names[i - 1] < n),
          ),
      ) &&
      unique(s.listings, (x) => x.path),
  );
  need(
    dense(s.missing, L.sourceFiles) &&
      s.missing.every(
        (p) => absolute(p) && roots.some((root) => inside(root, p)),
      ) &&
      unique(s.missing, (x) => x) &&
      !s.missing.some(
        (p) =>
          s.files.some((f) => f.path === p) ||
          s.directories.some((d) => d.path === p),
      ),
  );
  need(
    GIT_BRANCH_RESTORE_STATE_MARKERS.every((name) =>
      s.missing.includes(join(v.layout.gitDirectory.path, name)),
    ),
  );
  need(
    v.target.action === "restore"
      ? v.author === null
      : validGitCommitAuthor(v.author) &&
          gitBranchRestoreIdentityDigest(v.author, v.target.timestamp) ===
            v.target.identityDigest,
  );
  const oid = (x) =>
    typeof x === "string" &&
    new RegExp(
      `^[a-f0-9]{${v.target.objectFormat === "sha1" ? 40 : 64}}$`,
      "u",
    ).test(x);
  const entries = (xs) =>
    dense(xs, 4096) &&
    xs.every(
      (x, i) =>
        closed(x, ["path", "mode", "oid"]) &&
        validWorkspaceFilePath(x.path) &&
        [0o100644, 0o100755].includes(x.mode) &&
        oid(x.oid) &&
        (i === 0 ||
          Buffer.compare(Buffer.from(xs[i - 1].path), Buffer.from(x.path)) < 0),
    );
  need(entries(v.currentEntries) && entries(v.desiredEntries));
  need(
    dense(v.worktree, 128) &&
      v.worktree.length === v.target.paths.length &&
      v.worktree.every(
        (x, i) =>
          closed(x, ["path", "proposal"]) &&
          x.path === v.target.paths[i].path &&
          (v.target.paths[i].after === null
            ? x.proposal === null
            : fileRef(x.proposal, 16777216) &&
              x.proposal.path === `worktree/${i}` &&
              x.proposal.digest === v.target.paths[i].after.digest &&
              x.proposal.bytes === v.target.paths[i].after.bytes),
      ),
  );
  need(
    dense(v.metadata, 3) &&
      v.metadata.length === v.target.metadata.length &&
      v.metadata.every(
        (x, i) =>
          closed(x, ["role", "proposal"]) &&
          x.role === v.target.metadata[i].role &&
          fileRef(x.proposal, L.indexBytes) &&
          x.proposal.path === `proposal.${x.role}` &&
          x.proposal.digest === v.target.metadata[i].after.digest &&
          x.proposal.bytes === v.target.metadata[i].after.bytes,
      ),
  );
  need(
    dense(v.objects, L.artifactFiles) &&
      v.objects.every(
        (x) =>
          closed(x, [
            "oid",
            "type",
            "rawBytes",
            "path",
            "bytes",
            "digest",
            "install",
          ]) &&
          oid(x.oid) &&
          ["blob", "tree", "commit"].includes(x.type) &&
          x.install === false &&
          bytes(x.rawBytes) &&
          x.rawBytes === x.bytes &&
          fileRef({ path: x.path, bytes: x.bytes, digest: x.digest }) &&
          x.path === `objects/${x.oid}`,
      ) &&
      unique(v.objects, (x) => x.oid),
  );
  need(
    v.objects.some((x) => x.type === "commit" && x.oid === v.target.headOid) &&
      v.objects.some((x) => x.type === "tree" && x.oid === v.target.treeOid),
  );
  if (v.target.action === "select")
    need(
      v.objects.some(
        (x) => x.type === "commit" && x.oid === v.target.nextHeadOid,
      ),
    );
  need(
    v.target.paths.every(
      (x) =>
        x.afterEntry === null ||
        v.objects.some((o) => o.type === "blob" && o.oid === x.afterEntry.oid),
    ),
  );
  need(
    v.worktree.reduce((n, x) => n + (x.proposal?.bytes ?? 0), 0) +
      v.metadata.reduce((n, x) => n + x.proposal.bytes, 0) +
      v.objects.reduce((n, x) => n + x.bytes, 0) +
      r.artifact.manifest.bytes <=
      L.artifactBytes,
  );
  need(Buffer.byteLength(JSON.stringify(v)) <= L.manifestBytes);
  return v;
}
export function validateGitBranchRestoreKernelTokenRequest(v) {
  need(closed(v, ["token"]) && hex(v.token));
  return v;
}
export function validateGitBranchRestoreKernelResult(v) {
  need(plain(v));
  if (v.status === "prepared")
    need(closed(v, ["status", "token"]) && hex(v.token));
  else if (v.status === "applied") {
    need(
      closed(v, [
        "status",
        "action",
        "previewDigest",
        "paths",
        "metadata",
        "backups",
      ]),
    );
    validateGitBranchRestoreMutationResult({
      requestId: "kernel-result",
      ...v,
    });
  } else if (v.status === "aborted") need(closed(v, ["status"]));
  else
    need(
      v.status === "unknown" &&
        closed(v, ["status", "reason"]) &&
        [
          "invalid_request",
          "unsupported_runtime",
          "unsupported_branch_restore_state",
          "unsupported_branch_restore",
          "path_changed",
          "path_missing",
          "path_denied",
          "metadata_changed",
          "lock_conflict",
          "backup_conflict",
          "object_conflict",
          "branch_occupied",
          "branch_conflict",
          "deadline",
          "io_failed",
          "process_unverified",
        ].includes(v.reason),
    );
  return v;
}
