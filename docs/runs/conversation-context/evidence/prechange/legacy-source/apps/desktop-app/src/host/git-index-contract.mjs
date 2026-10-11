// Private descriptor publisher contract. No filesystem or process access at import.
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { isAbsolute, normalize } from "node:path";
import {
  GIT_INDEX_FEATURE,
  validGitIndexTarget,
} from "../renderer/shared/git-index/index.mjs";
export const GIT_INDEX_KERNEL_LIMITS = Object.freeze({
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
const controls = (v) =>
  Array.from(v).some((c) => c.codePointAt(0) < 32 || c.codePointAt(0) === 127);
const absolute = (v) =>
  typeof v === "string" &&
  v.length <= 32768 &&
  isAbsolute(v) &&
  normalize(v) === v &&
  !controls(v);
const relative = (v) =>
  typeof v === "string" &&
  v.length <= 4096 &&
  !isAbsolute(v) &&
  v.split("/").every((p) => p && p !== "." && p !== "..") &&
  !v.includes("\\") &&
  !controls(v);
const uint = (v) =>
  typeof v === "string" && /^(?:0|[1-9][0-9]{0,29})$/u.test(v);
const bytes = (v) => Number.isSafeInteger(v) && v >= 0;
const inside = (a, b) => b === a || b.startsWith(a === "/" ? a : a + "/");
const need = (ok) => {
  if (!ok)
    throw Object.assign(new Error("Invalid private Git index authority."), {
      appCode: "INVALID_REQUEST",
    });
};
const fits = (v, cap) => {
  try {
    return Buffer.byteLength(JSON.stringify(v)) <= cap;
  } catch {
    return false;
  }
};
const directory = (v) =>
  closed(v, ["path", "dev", "ino"]) &&
  absolute(v.path) &&
  uint(v.dev) &&
  uint(v.ino);
const fileRef = (v, cap) =>
  closed(v, ["path", "bytes", "digest"]) &&
  relative(v.path) &&
  bytes(v.bytes) &&
  v.bytes <= cap &&
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
export function gitIndexBackupId(runtimeEpoch, operationId) {
  need(id(runtimeEpoch) && id(operationId));
  return `.omoc-git-index-${createHash("sha256")
    .update(JSON.stringify([runtimeEpoch, operationId]))
    .digest("hex")}.backup`;
}
export function validateGitIndexKernelRequest(v) {
  need(closed(v, [...originalFields, "artifact"]));
  need(
    id(v.runtimeEpoch) &&
      id(v.operationId) &&
      id(v.workspaceId, 256) &&
      absolute(v.workspacePath) &&
      v.workspacePath !== "/" &&
      hex(v.digest) &&
      validGitIndexTarget(v.target),
  );
  const a = v.artifact;
  need(
    closed(a, ["root", "dev", "ino", "manifest"]) &&
      absolute(a.root) &&
      a.root !== "/" &&
      uint(a.dev) &&
      uint(a.ino) &&
      fileRef(a.manifest, GIT_INDEX_KERNEL_LIMITS.manifestBytes) &&
      a.manifest.path === "manifest.json" &&
      a.manifest.bytes > 0,
  );
  need(
    !inside(v.workspacePath, a.root) &&
      !inside(a.root, v.workspacePath) &&
      fits(v, GIT_INDEX_KERNEL_LIMITS.wireBytes),
  );
  return v;
}
export function validateGitIndexArtifactManifest(v, request) {
  validateGitIndexKernelRequest(request);
  need(
    closed(v, [
      "schemaVersion",
      "feature",
      ...originalFields,
      "layout",
      "source",
      "proposal",
      "objects",
    ]),
  );
  need(
    v.schemaVersion === 1 &&
      v.feature === GIT_INDEX_FEATURE &&
      originalFields.every((k) => isDeepStrictEqual(v[k], request[k])),
  );
  need(
    closed(v.layout, ["root", "gitDirectory", "commonDirectory"]) &&
      Object.values(v.layout).every(directory) &&
      v.layout.root.path === v.workspacePath,
  );
  const roots = Object.values(v.layout).map((x) => x.path);
  need(
    roots.every(
      (p) =>
        !inside(p, request.artifact.root) && !inside(request.artifact.root, p),
    ),
  );
  // Git metadata may be inside the selected root (.git) or an external linked worktree.
  need(
    v.layout.gitDirectory.path !== v.workspacePath &&
      v.layout.commonDirectory.path !== v.workspacePath,
  );
  const s = v.source;
  need(closed(s, ["directories", "files", "listings", "missing"]));
  need(
    dense(s.directories, GIT_INDEX_KERNEL_LIMITS.directories) &&
      s.directories.every(directory) &&
      unique(s.directories, (x) => x.path),
  );
  need(
    s.directories.every((x) =>
      roots.some((p) => inside(p, x.path) || inside(x.path, p)),
    ),
  );
  need(
    dense(s.files, GIT_INDEX_KERNEL_LIMITS.sourceFiles) &&
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
    dense(s.listings, GIT_INDEX_KERNEL_LIMITS.directories) &&
      s.listings.every(
        (x) =>
          closed(x, ["path", "names"]) &&
          absolute(x.path) &&
          roots.some((p) => inside(p, x.path)) &&
          dense(x.names, GIT_INDEX_KERNEL_LIMITS.artifactFiles) &&
          x.names.every(
            (name, i) =>
              relative(name) &&
              !name.includes("/") &&
              (i === 0 || x.names[i - 1] < name),
          ),
      ) &&
      unique(s.listings, (x) => x.path),
  );
  need(
    dense(s.missing, GIT_INDEX_KERNEL_LIMITS.sourceFiles) &&
      s.missing.every((x) => absolute(x) && roots.some((p) => inside(p, x))) &&
      unique(s.missing, (x) => x),
  );
  need(
    !s.missing.some(
      (p) =>
        s.files.some((f) => f.path === p) ||
        s.directories.some((d) => d.path === p),
    ),
  );
  need(
    fileRef(v.proposal, GIT_INDEX_KERNEL_LIMITS.indexBytes) &&
      v.proposal.path === "proposal.index" &&
      v.proposal.digest === v.target.nextIndexDigest,
  );
  need(
    dense(v.objects, GIT_INDEX_KERNEL_LIMITS.artifactFiles - 2) &&
      v.objects.every(
        (x) =>
          closed(x, ["oid", "rawBytes", "path", "bytes", "digest"]) &&
          typeof x.oid === "string" &&
          new RegExp(
            `^[a-f0-9]{${v.target.objectFormat === "sha1" ? 40 : 64}}$`,
            "u",
          ).test(x.oid) &&
          bytes(x.rawBytes) &&
          x.rawBytes <= GIT_INDEX_KERNEL_LIMITS.artifactBytes &&
          fileRef(
            { path: x.path, bytes: x.bytes, digest: x.digest },
            GIT_INDEX_KERNEL_LIMITS.artifactBytes,
          ) &&
          x.path === `objects/${x.oid.slice(0, 2)}/${x.oid.slice(2)}`,
      ) &&
      unique(v.objects, (x) => x.oid),
  );
  need(v.target.action === "stage" || v.objects.length === 0);
  need(
    v.proposal.bytes +
      v.objects.reduce((n, x) => n + x.bytes, 0) +
      request.artifact.manifest.bytes <=
      GIT_INDEX_KERNEL_LIMITS.artifactBytes,
  );
  need(fits(v, GIT_INDEX_KERNEL_LIMITS.manifestBytes));
  return v;
}
export function validateGitIndexKernelTokenRequest(v) {
  need(closed(v, ["token"]) && hex(v.token));
  return v;
}
export function validateGitIndexKernelResult(v) {
  need(plain(v));
  if (v.status === "prepared")
    need(closed(v, ["status", "token"]) && hex(v.token));
  else if (v.status === "applied")
    need(
      closed(v, ["status", "indexDigest", "backupId"]) &&
        hex(v.indexDigest) &&
        (v.backupId === null ||
          (typeof v.backupId === "string" &&
            /^\.omoc-git-index-[a-f0-9]{64}\.backup$/u.test(v.backupId))),
    );
  else if (v.status === "aborted") need(closed(v, ["status"]));
  else
    need(
      v.status === "unknown" &&
        closed(v, ["status", "reason"]) &&
        [
          "invalid_request",
          "unsupported_runtime",
          "path_changed",
          "path_missing",
          "path_denied",
          "metadata_changed",
          "lock_conflict",
          "backup_conflict",
          "object_conflict",
          "deadline",
          "io_failed",
          "process_unverified",
        ].includes(v.reason),
    );
  return v;
}
