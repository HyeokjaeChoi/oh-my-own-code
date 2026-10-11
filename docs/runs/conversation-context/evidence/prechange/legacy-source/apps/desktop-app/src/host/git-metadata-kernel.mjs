// Private descriptor publisher. Importing in Node performs no IO or FFI loading.
import * as fs from "node:fs";
import { dirname, basename, join, resolve } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { inflateSync } from "node:zlib";
import { performance } from "node:perf_hooks";
import { isDeepStrictEqual } from "node:util";
import {
  GIT_INDEX_KERNEL_LIMITS as L,
  gitIndexBackupId,
  validateGitIndexKernelRequest,
  validateGitIndexArtifactManifest,
  validateGitIndexKernelTokenRequest,
  validateGitIndexKernelResult,
} from "./git-index-contract.mjs";
import {
  gitCommitBackupId,
  gitCommitExpectedBackups,
  GIT_COMMIT_STATE_MARKERS,
  validateGitCommitKernelRequest,
  validateGitCommitArtifactManifest,
  validateGitCommitKernelTokenRequest,
  validateGitCommitKernelResult,
} from "./git-commit-contract.mjs";
import {
  GIT_COMMIT_REFLOG_REASON,
  GIT_COMMIT_ABSENT_DIGEST,
  validGitCommitBranch,
} from "../renderer/shared/git-commit/index.mjs";
import {
  gitBranchRestoreBackupId,
  gitBranchRestoreExpectedBackups,
  gitBranchRestoreBlob,
  gitBranchRestoreOccupancyDigest,
  validateGitBranchRestoreKernelRequest,
  validateGitBranchRestoreArtifactManifest,
  validateGitBranchRestoreKernelTokenRequest,
  validateGitBranchRestoreKernelResult,
} from "./git-branch-restore-contract.mjs";
import { gitBranchRestoreMode } from "../renderer/shared/git-branch-restore/index.mjs";
import { workspaceFilePathReason } from "../renderer/shared/workspace-file/index.mjs";
import { validWorkspaceFilePath } from "../renderer/shared/workspace-file/index.mjs";

class Failure extends Error {}
const fail = (reason) => {
  throw new Failure(reason);
};
const need = (ok, reason = "metadata_changed") => {
  if (!ok) fail(reason);
};
const digest = (b, format = "sha256") =>
  createHash(format).update(b).digest("hex");
const identity = (a, b) => a.dev === b.dev && a.ino === b.ino;
const signature = (s) =>
  [s.dev, s.ino, s.mode, s.nlink, s.size, s.mtimeNs, s.ctimeNs].join(":");
const text = (b) =>
  new globalThis.TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
    b,
  );
const result = (e, kind = "index") =>
  (kind === "branchRestore"
    ? validateGitBranchRestoreKernelResult
    : kind === "commit"
      ? validateGitCommitKernelResult
      : validateGitIndexKernelResult)({
    status: "unknown",
    reason:
      e instanceof Failure
        ? e.message
        : e?.appCode === "INVALID_REQUEST"
          ? "invalid_request"
          : ["ENOENT", "ENOTDIR"].includes(e?.code)
            ? "path_missing"
            : ["EACCES", "EPERM", "ELOOP"].includes(e?.code)
              ? "path_denied"
              : "io_failed",
  });

// The original may carry optional uppercase cache extensions; the proposal is
// strictly v2, zero stat cache, regular stage0 entries and no extensions.
function parseIndex(bytes, format, canonical = false) {
  const width = format === "sha1" ? 20 : 32,
    end = bytes.length - width;
  need(bytes.length <= L.indexBytes && end >= 12, "invalid_request");
  need(
    bytes.toString("ascii", 0, 4) === "DIRC" &&
      (canonical
        ? bytes.readUInt32BE(4) === 2
        : [2, 3].includes(bytes.readUInt32BE(4))),
    "invalid_request",
  );
  need(
    createHash(format)
      .update(bytes.subarray(0, end))
      .digest()
      .equals(bytes.subarray(end)),
    "invalid_request",
  );
  const count = bytes.readUInt32BE(8);
  need(count <= 12288, "invalid_request");
  let at = 12,
    previous;
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    const start = at;
    need(at + 42 + width <= end, "invalid_request");
    const mode = bytes.readUInt32BE(at + 24),
      oid = bytes.subarray(at + 40, at + 40 + width).toString("hex");
    const flags = bytes.readUInt16BE(at + 40 + width);
    need(
      [0o100644, 0o100755].includes(mode) && !(flags & 0xb000),
      "invalid_request",
    );
    if (canonical) {
      need(!(flags & 0x4000), "invalid_request");
      for (let i = 0; i < 40; i++)
        if (i < 24 || i >= 28) need(bytes[start + i] === 0, "invalid_request");
    }
    at += 42 + width;
    if (flags & 0x4000) {
      need(
        bytes.readUInt32BE(4) === 3 &&
          at + 2 <= end &&
          bytes.readUInt16BE(at) === 0,
        "invalid_request",
      );
      at += 2;
    }
    const zero = bytes.indexOf(0, at);
    need(zero >= at && zero < end, "invalid_request");
    const nameBytes = bytes.subarray(at, zero),
      path = text(nameBytes);
    need(
      validWorkspaceFilePath(path) &&
        !path.split("/").some((p) => p.toLowerCase() === ".git") &&
        (flags & 0xfff) === Math.min(nameBytes.length, 0xfff) &&
        (!previous ||
          (Buffer.compare(previous, nameBytes) < 0 &&
            !path.startsWith(text(previous) + "/"))) &&
        !/^0+$/u.test(oid),
      "invalid_request",
    );
    const next = start + Math.ceil((zero + 1 - start) / 8) * 8;
    need(next <= end, "invalid_request");
    for (let i = zero; i < next; i++) need(bytes[i] === 0, "invalid_request");
    entries.set(path, { mode, oid });
    previous = nameBytes;
    at = next;
  }
  if (canonical) need(at === end, "invalid_request");
  while (at < end) {
    need(
      at + 8 <= end &&
        /^[A-Z][A-Za-z0-9]{3}$/u.test(bytes.toString("ascii", at, at + 4)),
      "invalid_request",
    );
    const size = bytes.readUInt32BE(at + 4);
    at += 8 + size;
    need(at <= end, "invalid_request");
  }
  return entries;
}
function compareEntries(old, next, paths) {
  const selected = new Set(paths);
  let changed = false;
  for (const path of new Set([...old.keys(), ...next.keys()])) {
    const a = old.get(path),
      b = next.get(path),
      same = a?.mode === b?.mode && a?.oid === b?.oid;
    if (selected.has(path)) changed ||= !same;
    else need(same, "invalid_request");
  }
  need(changed, "invalid_request");
}
function object(bytes, record, format, type = record.type ?? "blob") {
  let raw;
  try {
    raw = inflateSync(bytes, {
      maxOutputLength: Math.min(L.artifactBytes + 128, record.rawBytes + 128),
      info: true,
    });
  } catch {
    fail("object_conflict");
  }
  need(raw.engine.bytesWritten === bytes.length, "object_conflict");
  const body = raw.buffer,
    zero = body.indexOf(0);
  need(
    zero >= 0 &&
      body
        .subarray(0, zero)
        .equals(Buffer.from(`${type} ${record.rawBytes}`)) &&
      body.length - zero - 1 === record.rawBytes &&
      digest(body, format) === record.oid,
    "object_conflict",
  );
  return body;
}

export async function createGitMetadataKernel(options = {}) {
  let check, timeoutMs;
  try {
    need(
      options &&
        Object.getPrototypeOf(options) === Object.prototype &&
        Reflect.ownKeys(options).every(
          (k) =>
            ["check", "timeoutMs"].includes(k) &&
            Object.hasOwn(Object.getOwnPropertyDescriptor(options, k), "value"),
        ),
      "invalid_request",
    );
    const data = Object.fromEntries(
      Reflect.ownKeys(options).map((k) => [
        k,
        Object.getOwnPropertyDescriptor(options, k).value,
      ]),
    );
    ({ check = () => {}, timeoutMs = L.deadlineMs } = data);
    need(
      typeof check === "function" &&
        Number.isInteger(timeoutMs) &&
        timeoutMs >= 1 &&
        timeoutMs <= L.deadlineMs,
      "invalid_request",
    );
  } catch {
    fail("invalid_request");
  }
  need(
    process.platform === "darwin" &&
      process.arch === "arm64" &&
      globalThis.Bun?.version === "1.4.2" &&
      ["O_NOFOLLOW", "O_NONBLOCK", "O_DIRECTORY"].every(
        (k) => Number.isInteger(fs.constants[k]) && fs.constants[k] !== 0,
      ),
    "unsupported_runtime",
  );
  let library, ptr, toArrayBuffer;
  try {
    const ffi = await import("bun:ffi");
    ({ ptr, toArrayBuffer } = ffi);
    library = ffi.dlopen("/usr/lib/libSystem.B.dylib", {
      // Apple arm64 openat is variadic: mode is stack[0], after x3..x7.
      openat: {
        args: ["i32", "ptr", "i32", "u64", "u64", "u64", "u64", "u64", "u64"],
        returns: "i32",
      },
      renameatx_np: {
        args: ["i32", "ptr", "i32", "ptr", "u32"],
        returns: "i32",
      },
      mkdirat: { args: ["i32", "ptr", "u32"], returns: "i32" },
      unlinkat: { args: ["i32", "ptr", "i32"], returns: "i32" },
      fdopendir: { args: ["i32"], returns: "ptr" },
      readdir: { args: ["ptr"], returns: "ptr" },
      closedir: { args: ["ptr"], returns: "i32" },
      acl_get_fd_np: { args: ["i32", "i32"], returns: "ptr" },
      acl_free: { args: ["ptr"], returns: "i32" },
      fgetxattr: {
        args: ["i32", "ptr", "ptr", "u64", "u32", "i32"],
        returns: "i64",
      },
      fsetxattr: {
        args: ["i32", "ptr", "ptr", "u64", "u32", "i32"],
        returns: "i32",
      },
      fremovexattr: { args: ["i32", "ptr", "i32"], returns: "i32" },
      flistxattr: { args: ["i32", "ptr", "u64", "i32"], returns: "i64" },
      fgetattrlist: {
        args: ["i32", "ptr", "ptr", "u64", "u32"],
        returns: "i32",
      },
      __error: { args: [], returns: "ptr" },
    });
  } catch {
    fail("unsupported_runtime");
  }
  const native = library.symbols,
    c = { ...fs.constants, O_CLOEXEC: 0x1000000 };
  const readFlags = c.O_RDONLY | c.O_NOFOLLOW | c.O_NONBLOCK | c.O_CLOEXEC;
  const exclusiveFlags =
    c.O_RDWR | c.O_CREAT | c.O_EXCL | c.O_NOFOLLOW | c.O_NONBLOCK | c.O_CLOEXEC;
  const cs = (s) => Buffer.from(s + "\0"),
    stat = (fd) => fs.fstatSync(fd, { bigint: true });
  // Cache the thread-local errno view: allocating an FFI buffer view after a
  // syscall can itself overwrite errno in Bun. All native calls here are sync.
  const errnoCell = new Int32Array(toArrayBuffer(native.__error(), 0, 4));
  const errno = () => errnoCell[0];
  const worktreeDescriptors = new Set();
  let active = null,
    last = null,
    entered = false,
    stopped = false;
  const gate = (t) => {
    need(!stopped, "invalid_request");
    if (t) need(performance.now() < t.deadline, "deadline");
    try {
      const v = t?.fenced ? undefined : check();
      need(!v || typeof v.then !== "function", "invalid_request");
      need(v !== false, "path_changed");
    } catch (e) {
      if (e instanceof Failure) throw e;
      fail("path_changed");
    }
    if (t) {
      need(performance.now() < t.deadline, "deadline");
    }
  };
  function commitState(t) {
    if (["commit", "branchRestore"].includes(t.kind) && t.git) {
      need(
        identity(stat(t.git.fd), fs.lstatSync(t.git.path, { bigint: true })) &&
          fs.realpathSync(t.git.path) === t.git.path,
        "path_changed",
      );
      for (const name of GIT_COMMIT_STATE_MARKERS) {
        try {
          fs.lstatSync(join(t.git.path, name));
        } catch (e) {
          if (e.code === "ENOENT") continue;
          throw e;
        }
        fail(
          t.kind === "commit"
            ? "unsupported_commit_state"
            : "unsupported_branch_restore_state",
        );
      }
    }
  }
  function openAt(t, parent, name, flags = readFlags, mode = 0) {
    const b = cs(name),
      fd = native.openat(parent, ptr(b), flags, 0, 0, 0, 0, 0, mode),
      error = fd < 0 ? errno() : 0;
    if (fd >= 0) t.fds.add(fd);
    return { fd, error };
  }
  function dispose(t, fd) {
    t.fds.delete(fd);
    worktreeDescriptors.delete(fd);
    fs.closeSync(fd);
  }
  function closeTask(t) {
    if (!t) return;
    clearTimeout(t.timer);
    let error;
    for (const fd of [...t.fds].reverse()) {
      try {
        dispose(t, fd);
      } catch (e) {
        error = e;
      }
    }
    if (error) throw error;
  }
  function meta(fd, s, write = false, artifact = false) {
    need(s.isDirectory() || (s.isFile() && s.nlink === 1n), "path_denied");
    if (!write && !artifact) return;
    need(
      s.uid === BigInt(process.getuid()) &&
        !(s.mode & 0o7022n) &&
        (s.isDirectory() || worktreeDescriptors.has(fd) || !(s.mode & 0o111n)),
      "path_denied",
    );
    const acl = native.acl_get_fd_np(fd, 0x100),
      error = errno();
    if (acl) {
      native.acl_free(acl);
      fail("metadata_changed");
    }
    need(error === 2, "metadata_changed");
    const attrs = Buffer.alloc(24),
      flags = Buffer.alloc(8);
    attrs.writeUInt16LE(5);
    attrs.writeUInt32LE(0x40000, 4);
    need(
      native.fgetattrlist(fd, ptr(attrs), ptr(flags), 8, 0) === 0 &&
        flags.readUInt32LE(0) === 8 &&
        flags.readUInt32LE(4) === 0,
      "metadata_changed",
    );
    const names = Buffer.alloc(32768);
    const count = Number(native.flistxattr(fd, ptr(names), names.length, 0));
    need(
      Number.isInteger(count) && count >= 0 && count <= names.length,
      "metadata_changed",
    );
    const entries = [];
    let start = 0,
      total = count;
    for (let i = 0; i < count; i++) {
      if (names[i] !== 0) continue;
      need(i > start && entries.length < 32, "metadata_changed");
      const name = Buffer.from(names.subarray(start, i + 1)),
        value = Buffer.alloc(Math.max(1, 32768 - total));
      start = i + 1;
      const size = Number(
        native.fgetxattr(fd, ptr(name), ptr(value), value.length, 0, 0),
      );
      need(
        Number.isInteger(size) && size >= 0 && size <= 32768 - total,
        "metadata_changed",
      );
      total += size;
      entries.push([name, Buffer.from(value.subarray(0, size))]);
    }
    need(start === count, "metadata_changed");
    entries.sort((a, b) => Buffer.compare(a[0], b[0]));
    for (let i = 1; i < entries.length; i++)
      need(!entries[i - 1][0].equals(entries[i][0]), "metadata_changed");
    return { mode: s.mode, entries };
  }
  function sameMeta(a, b) {
    return (
      a.mode === b.mode &&
      a.entries.length === b.entries.length &&
      a.entries.every(
        ([n, v], i) => n.equals(b.entries[i][0]) && v.equals(b.entries[i][1]),
      )
    );
  }
  function authority(d, artifact = false) {
    const value = meta(d.fd, stat(d.fd), !artifact, artifact);
    if (d.meta) need(sameMeta(d.meta, value), "metadata_changed");
    else d.meta = value;
    return d;
  }
  function directory(t, path, expected) {
    if (t.dirs.has(path)) {
      const d = t.dirs.get(path);
      if (expected)
        need(
          String(d.s.dev) === expected.dev && String(d.s.ino) === expected.ino,
          "path_changed",
        );
      return d;
    }
    need(
      t.dirs.size < L.directories && path.split("/").length - 1 <= L.depth,
      "invalid_request",
    );
    gate(t);
    const before = fs.lstatSync(path, { bigint: true });
    need(
      before.isDirectory() &&
        !before.isSymbolicLink() &&
        fs.realpathSync(path) === path,
      "path_denied",
    );
    const parent = path === "/" ? null : directory(t, dirname(path));
    let fd;
    if (parent)
      ({ fd } = openAt(
        t,
        parent.fd,
        basename(path),
        readFlags | c.O_DIRECTORY,
      ));
    else {
      fd = fs.openSync("/", readFlags | c.O_DIRECTORY);
      t.fds.add(fd);
    }
    need(fd >= 0, "path_denied");
    const s = stat(fd);
    need(s.isDirectory() && identity(s, before), "path_changed");
    if (expected)
      need(
        String(s.dev) === expected.dev && String(s.ino) === expected.ino,
        "path_changed",
      );
    const d = { path, fd, s };
    t.dirs.set(path, d);
    return d;
  }
  function stable(t) {
    gate(t);
    for (const d of t.dirs.values()) {
      const held = stat(d.fd),
        named = fs.lstatSync(d.path, { bigint: true });
      if (d.meta)
        need(sameMeta(d.meta, meta(d.fd, held, true)), "metadata_changed");
      need(
        held.isDirectory() &&
          named.isDirectory() &&
          identity(d.s, held) &&
          identity(d.s, named) &&
          fs.realpathSync(d.path) === d.path,
        "path_changed",
      );
    }
  }
  function writeDirectory(t, path) {
    const d = directory(t, path);
    stable(t);
    return authority(d);
  }
  function named(t, path, flags = readFlags) {
    const d = directory(t, dirname(path));
    stable(t);
    const before = fs.lstatSync(path, { bigint: true });
    need(
      before.isFile() &&
        before.nlink === 1n &&
        !before.isSymbolicLink() &&
        fs.realpathSync(path) === path,
      "path_denied",
    );
    const { fd } = openAt(t, d.fd, basename(path), flags);
    need(fd >= 0, "path_denied");
    need(signature(before) === signature(stat(fd)), "metadata_changed");
    return fd;
  }
  function observe(t, fd, cap, keep = true) {
    stable(t);
    const before = stat(fd);
    meta(fd, before);
    need(before.size <= BigInt(cap), "invalid_request");
    let offset = 0;
    const hash = createHash("sha256"),
      chunks = [];
    while (offset < Number(before.size)) {
      stable(t);
      const b = Buffer.alloc(
        Math.min(L.chunkBytes, Number(before.size) - offset),
      );
      const n = fs.readSync(fd, b, 0, b.length, offset);
      need(n > 0 && n <= b.length, "metadata_changed");
      const part = b.subarray(0, n);
      hash.update(part);
      if (keep) chunks.push(part);
      offset += n;
    }
    need(
      fs.readSync(fd, Buffer.alloc(1), 0, 1, offset) === 0 &&
        signature(before) === signature(stat(fd)),
      "metadata_changed",
    );
    stable(t);
    return {
      s: before,
      signature: signature(before),
      digest: hash.digest("hex"),
      bytes: keep ? Buffer.concat(chunks, offset) : null,
    };
  }
  function read(t, path, cap, keep = true) {
    const fd = named(t, path);
    try {
      const value = observe(t, fd, cap, keep);
      need(
        value.signature === signature(fs.lstatSync(path, { bigint: true })),
        "metadata_changed",
      );
      return value;
    } finally {
      dispose(t, fd);
    }
  }
  function list(t, path) {
    stable(t);
    const d = directory(t, path),
      { fd: duplicate } = openAt(t, d.fd, ".", readFlags | c.O_DIRECTORY);
    need(duplicate >= 0, "io_failed");
    const stream = native.fdopendir(duplicate);
    if (!stream) {
      dispose(t, duplicate);
      fail("io_failed");
    }
    t.fds.delete(duplicate); // fdopendir now owns this duplicate.
    const names = [];
    try {
      for (;;) {
        // readdir's EOF is distinguished from error using thread-local errno.
        errnoCell[0] = 0;
        const p = native.readdir(stream);
        if (!p) {
          need(errno() === 0, "io_failed");
          break;
        }
        const header = Buffer.from(toArrayBuffer(p, 0, 21)),
          length = header.readUInt16LE(18),
          recordLength = header.readUInt16LE(16);
        need(
          length > 0 && length <= 1024 && recordLength >= 22 + length,
          "path_denied",
        );
        const b = Buffer.from(toArrayBuffer(p, 21, length + 1));
        need(b[length] === 0, "path_denied");
        const name = text(b.subarray(0, length));
        if (name === "." || name === "..") continue;
        need(
          !name.includes("/") &&
            !Array.from(name).some(
              (c) =>
                c.codePointAt(0) < 32 || c.codePointAt(0) === 127 || c === "\\",
            ) &&
            names.length < L.artifactFiles,
          "path_denied",
        );
        names.push(name);
      }
    } finally {
      need(native.closedir(stream) === 0, "io_failed");
    }
    need(new Set(names).size === names.length, "path_changed");
    stable(t);
    return names.sort();
  }
  function missing(t, path, reason = "metadata_changed") {
    let candidate = path;
    if (["commit", "branchRestore"].includes(t.kind)) {
      while (!t.dirs.has(dirname(candidate))) {
        need(candidate !== dirname(candidate), "invalid_request");
        candidate = dirname(candidate);
      }
    }
    const d = directory(t, dirname(candidate));
    stable(t);
    const { fd, error } = openAt(t, d.fd, basename(candidate));
    if (fd >= 0) {
      dispose(t, fd);
      fail(reason);
    }
    need(error === 2, "metadata_changed");
  }
  function artifactRead(t, record) {
    const path = join(t.request.artifact.root, record.path),
      old = t.artifacts.get(path);
    const fd = named(t, path);
    let retained = false;
    try {
      const metadata = meta(fd, stat(fd), false, true);
      if (["commit", "branchRestore"].includes(t.kind) && old) {
        // The bytes were hashed on admission. Unchanged named/held inode and
        // nanosecond signature preserve that authority across bounded effects.
        need(
          signature(stat(fd)) === old.signature &&
            signature(stat(old.fd)) === old.signature &&
            sameMeta(old.meta, metadata),
          "metadata_changed",
        );
        return old.bytes;
      }
      const v = observe(t, fd, record.bytes);
      need(
        v.s.size === BigInt(record.bytes) &&
          v.digest === record.digest &&
          signature(fs.lstatSync(path, { bigint: true })) === v.signature,
        "metadata_changed",
      );
      if (old) {
        const held = observe(t, old.fd, record.bytes, false);
        need(
          old.signature === v.signature &&
            old.signature === held.signature &&
            held.digest === record.digest &&
            sameMeta(old.meta, metadata),
          "metadata_changed",
        );
      } else {
        t.artifacts.set(path, { fd, ...v, meta: metadata, record });
        retained = true;
      }
      return v.bytes;
    } finally {
      if (!retained) dispose(t, fd);
    }
  }
  function verifyArtifact(t) {
    stable(t);
    const root = directory(t, t.request.artifact.root);
    need((stat(root.fd).mode & 0o7777n) === 0o700n, "path_denied");
    for (const path of t.artifactDirectories)
      meta(directory(t, path).fd, stat(directory(t, path).fd), false, true);
    for (const v of t.artifacts.values()) {
      if (t.kind === "branchRestore") {
        // Full admission hashes plus held/named nanosecond signatures bind
        // immutable bytes and metadata without rehashing each raw graph per effect.
        need(
          signature(stat(v.fd)) === v.signature &&
            signature(
              fs.lstatSync(join(t.request.artifact.root, v.record.path), {
                bigint: true,
              }),
            ) === v.signature,
          "metadata_changed",
        );
      } else artifactRead(t, v.record);
    }
    for (const [path, names] of t.artifactListings)
      need(
        JSON.stringify(list(t, path)) === JSON.stringify(names),
        "metadata_changed",
      );
  }
  function delta(t, path, present) {
    t.deltas.set(path, present);
  }
  function expectedNames(t, entry) {
    const names = new Set(entry.names);
    for (const [path, present] of t.deltas)
      if (dirname(path) === entry.path) {
        if (present) names.add(basename(path));
        else names.delete(basename(path));
      }
    return [...names].sort();
  }
  function verifySource(t, published = false) {
    stable(t);
    commitState(t);
    const indexPath = join(t.git.path, "index");
    for (const d of t.manifest.source.directories) directory(t, d.path, d);
    let budget = 0;
    for (const f of t.manifest.source.files) {
      if (t.kind === "index" && published && f.path === indexPath) continue;
      const moved =
        ["commit", "branchRestore"].includes(t.kind) &&
        t.targets?.find((x) => x.path === f.path && x.published);
      if (moved) {
        if (t.kind === "branchRestore") verifyBranchTarget(t, moved);
        else verifyCommitTarget(t, moved);
        continue;
      }
      const fd = t.sourceFDs.get(f.path),
        s = stat(fd);
      budget += Number(s.size);
      need(budget <= L.artifactBytes, "invalid_request");
      let v;
      if (
        ["commit", "branchRestore"].includes(t.kind) &&
        t.verifiedSources.has(f.path)
      ) {
        need(signature(s) === f.signature, "metadata_changed");
        v = { s, signature: f.signature, digest: f.digest };
      } else {
        v = observe(t, fd, L.artifactBytes, false);
        if (
          ["commit", "branchRestore"].includes(t.kind) &&
          v.signature === f.signature &&
          v.digest === f.digest
        )
          t.verifiedSources.add(f.path);
      }
      // The named descriptor must be the same immutable observation. Hashing
      // that same inode twice adds IO without adding a second authority.
      if (t.kind === "branchRestore" && t.verifiedSources.has(f.path)) {
        const namedStat = fs.lstatSync(f.path, { bigint: true });
        need(
          v.signature === f.signature &&
            v.digest === f.digest &&
            signature(namedStat) === f.signature &&
            identity(namedStat, v.s),
          "metadata_changed",
        );
        continue;
      }
      const namedFD = named(t, f.path);
      try {
        const namedStat = stat(namedFD);
        need(
          v.signature === f.signature &&
            v.digest === f.digest &&
            signature(namedStat) === f.signature &&
            identity(namedStat, v.s),
          "metadata_changed",
        );
      } finally {
        dispose(t, namedFD);
      }
    }
    for (const e of t.manifest.source.listings)
      need(
        JSON.stringify(list(t, e.path)) === JSON.stringify(expectedNames(t, e)),
        "metadata_changed",
      );
    for (const [path, names] of t.objectListings)
      need(
        JSON.stringify(list(t, path)) ===
          JSON.stringify(expectedNames(t, { path, names })),
        "metadata_changed",
      );
    for (const path of t.manifest.source.missing) {
      if (t.deltas.get(path) === true) continue;
      missing(t, path);
    }
    if (t.kind === "index" && t.original) {
      const fd = t.sourceFDs.get(indexPath),
        v = observe(t, fd, L.indexBytes);
      need(
        sameMeta(t.original.meta, meta(fd, stat(fd), true)),
        "metadata_changed",
      );
      need(
        v.digest === t.original.digest &&
          v.bytes.equals(t.original.bytes) &&
          identity(v.s, t.original.s),
        "metadata_changed",
      );
      if (!published)
        need(v.signature === t.original.signature, "metadata_changed");
    } else if (t.kind === "index" && !published) missing(t, indexPath);
    if (t.kind === "branchRestore") {
      // Every allowed delta retains exact owned inode and bytes authority.
      // Newly created targets have no source.files row, so validate them here.
      for (const x of t.targets ?? []) {
        if (x.aborted) continue;
        if (x.published && !x.original) verifyBranchTarget(t, x);
        else if (!x.published && x.stage)
          verifyOwned(
            t,
            join(x.root.path, x.stageName),
            x.stage,
            x.stage.writtenBytes,
          );
      }
      for (const l of t.locks ?? [])
        if (!l.removed) verifyOwned(t, l.path, l.owned, l.owned.writtenBytes);
    }
    verifyLayout(t);
    stable(t);
  }
  function sourceBytes(t, path, optional = false, cap = L.indexBytes) {
    if (!t.sourceFDs.has(path)) {
      need(
        optional && t.manifest.source.missing.includes(path),
        "invalid_request",
      );
      if (!t.deltas.get(path)) missing(t, path);
      return null;
    }
    return observe(t, t.sourceFDs.get(path), cap).bytes;
  }
  function verifyLayout(t) {
    const root = t.manifest.layout.root.path,
      git = t.git.path,
      common = t.common.path;
    const dot = join(root, ".git");
    if (git === dot)
      need(
        common === git && directory(t, dot).s.ino === t.git.s.ino,
        "path_changed",
      );
    else {
      const b = sourceBytes(t, dot);
      const line = text(b).trimEnd();
      need(/^gitdir: [^\n\r]+$/u.test(line), "path_denied");
      need(resolve(root, line.slice(8)) === git, "path_changed");
      const backlink = text(sourceBytes(t, join(git, "gitdir"))).trimEnd();
      need(resolve(git, backlink) === dot, "path_changed");
      const commondir = text(sourceBytes(t, join(git, "commondir"))).trimEnd();
      need(resolve(git, commondir) === common, "path_changed");
    }
    const head = text(sourceBytes(t, join(git, "HEAD"))).trimEnd(),
      width = t.request.target.objectFormat === "sha1" ? 40 : 64;
    let oid;
    if (head.startsWith("ref: ")) {
      const ref = head.slice(5);
      need(
        /^refs\/(heads|tags|remotes)\//u.test(ref) &&
          ref.split("/").every((p) => p && p !== "." && p !== "..") &&
          !Array.from(ref).some(
            (c) =>
              c.codePointAt(0) <= 32 || c.codePointAt(0) === 127 || c === "\\",
          ),
        "path_denied",
      );
      const loose = sourceBytes(t, join(common, ref), true);
      oid = loose ? text(loose).trimEnd() : null;
      if (!oid) {
        const packed = sourceBytes(t, join(common, "packed-refs"), true);
        if (packed)
          for (const line of text(packed).split("\n")) {
            const [value, name] = line.split(" ");
            if (name === ref) oid = value;
          }
      }
    } else oid = head;
    need(
      oid === null || new RegExp(`^[a-f0-9]{${width}}$`, "u").test(oid),
      "path_changed",
    );
    need(oid === t.request.target.headOid, "path_changed");
    sourceBytes(t, join(common, "config"));
  }
  function verifyOwned(t, path, record, bytes, renamed = false) {
    stable(t);
    const a = observe(t, record.fd, bytes.length),
      b = read(t, path, bytes.length);
    need(
      identity(a.s, record.s) &&
        identity(b.s, record.s) &&
        a.bytes.equals(bytes) &&
        b.bytes.equals(bytes) &&
        a.s.mode === record.s.mode &&
        b.s.mode === record.s.mode &&
        a.s.uid === record.s.uid &&
        b.s.uid === record.s.uid &&
        a.s.gid === record.s.gid &&
        b.s.gid === record.s.gid &&
        a.s.mtimeNs === record.s.mtimeNs &&
        b.s.mtimeNs === record.s.mtimeNs &&
        (renamed ||
          (a.signature === record.signature &&
            b.signature === record.signature)),
      "metadata_changed",
    );
    need(sameMeta(record.meta, meta(record.fd, a.s, true)), "metadata_changed");
  }
  function checkedEffect(t, action) {
    if (!["commit", "branchRestore"].includes(t.kind)) return action();
    gate(t);
    const fenced = t.fenced;
    t.fenced = true;
    try {
      verifySource(t);
      verifyArtifact(t);
      return action();
    } finally {
      t.fenced = fenced;
    }
  }
  function createFile(t, parent, name, conflict) {
    return checkedEffect(t, () => {
      stable(t);
      gate(t);
      meta(parent.fd, stat(parent.fd), true);
      commitState(t);
      const { fd, error } = openAt(t, parent.fd, name, exclusiveFlags, 0o600);
      need(fd >= 0, error === 17 ? conflict : "io_failed");
      const s = stat(fd);
      meta(fd, s, true);
      need((s.mode & 0o7777n) === 0o600n, "metadata_changed");
      return {
        fd,
        s,
        signature: signature(s),
        meta: meta(fd, s, true),
        writtenBytes: Buffer.alloc(0),
      };
    });
  }
  function writeBytes(t, owned, bytes, mode = 0o600) {
    return checkedEffect(t, () => {
      let offset = 0;
      while (offset < bytes.length) {
        stable(t);
        gate(t);
        commitState(t);
        const n = fs.writeSync(
          owned.fd,
          bytes,
          offset,
          Math.min(L.chunkBytes, bytes.length - offset),
          offset,
        );
        need(
          n > 0 && n <= Math.min(L.chunkBytes, bytes.length - offset),
          "io_failed",
        );
        offset += n;
      }
      gate(t);
      commitState(t);
      fs.fchmodSync(owned.fd, mode);
      fs.fsyncSync(owned.fd);
      owned.s = stat(owned.fd);
      owned.signature = signature(owned.s);
      owned.meta = meta(owned.fd, owned.s, true);
      owned.writtenBytes = Buffer.from(bytes);
    });
  }
  function rename(t, parent, from, to, flags, reason, destination = parent) {
    return checkedEffect(t, () => {
      stable(t);
      gate(t);
      meta(parent.fd, stat(parent.fd), true);
      meta(destination.fd, stat(destination.fd), true);
      need(stat(parent.fd).dev === stat(destination.fd).dev, "path_denied");
      commitState(t);
      const a = cs(from),
        b = cs(to);
      need(
        native.renameatx_np(
          parent.fd,
          ptr(a),
          destination.fd,
          ptr(b),
          flags,
        ) === 0,
        reason,
      );
      fs.fsyncSync(parent.fd);
      if (destination.fd !== parent.fd) fs.fsyncSync(destination.fd);
    });
  }
  function removeOwned(t, parent, name, owned, bytes) {
    return checkedEffect(t, () => {
      verifyOwned(t, join(parent.path, name), owned, bytes);
      stable(t);
      gate(t);
      const { fd } = openAt(t, parent.fd, name);
      need(fd >= 0, "path_changed");
      try {
        need(
          signature(stat(fd)) === signature(stat(owned.fd)) &&
            identity(stat(fd), owned.s),
          "path_changed",
        );
      } finally {
        dispose(t, fd);
      }
      // No host callback between the final named inode comparison and unlink.
      commitState(t);
      const b = cs(name);
      need(native.unlinkat(parent.fd, ptr(b), 0) === 0, "io_failed");
      fs.fsyncSync(parent.fd);
      delta(t, join(parent.path, name), false);
    });
  }
  function publishObjects(t) {
    const selectedOids =
      t.kind === "commit"
        ? new Set(t.manifest.objects.map((o) => o.oid))
        : new Set(
            t.request.target.paths
              .filter((p) => t.next.get(p)?.oid !== t.old.get(p)?.oid)
              .map((p) => t.next.get(p)?.oid)
              .filter(Boolean),
          );
    // Check the whole body budget before any inflate allocation, separately
    // from both the manifest compressed-byte budget and the original snapshot.
    need(
      t.manifest.objects.reduce((n, o) => n + o.rawBytes, 0) <= L.artifactBytes,
      "invalid_request",
    );
    for (const record of t.manifest.objects) {
      need(selectedOids.has(record.oid), "invalid_request");
      const bytes = artifactRead(t, record);
      object(bytes, record, t.request.target.objectFormat);
    }
    for (const record of t.manifest.objects) {
      if (t.kind === "commit" && !record.install) continue;
      verifySource(t);
      verifyArtifact(t);
      const bytes = artifactRead(t, record),
        prefix = record.oid.slice(0, 2),
        leaf = record.oid.slice(2);
      const objectRoot = writeDirectory(t, join(t.common.path, "objects")),
        folder = join(objectRoot.path, prefix);
      if (!t.dirs.has(folder)) {
        const rootNames = t.manifest.source.listings.find(
          (e) => e.path === objectRoot.path,
        )?.names;
        need(rootNames && !rootNames.includes(prefix), "object_conflict");
        createDirectory(t, objectRoot, prefix, "object_conflict");
      }
      const parent = writeDirectory(t, folder),
        path = join(folder, leaf);
      const baseline = t.manifest.source.files.find((f) => f.path === path);
      if (baseline) {
        const existing = read(t, path, L.artifactBytes).bytes;
        need(
          object(existing, record, t.request.target.objectFormat).equals(
            object(bytes, record, t.request.target.objectFormat),
          ),
          "object_conflict",
        );
        continue;
      }
      missing(t, path);
      const temp = `.omoc-${t.nonce}-${leaf}`,
        tempPath = join(folder, temp);
      const owned = createFile(t, parent, temp, "object_conflict");
      delta(t, tempPath, true);
      t.objects.set(tempPath, { owned, bytes });
      writeBytes(t, owned, bytes);
      verifyOwned(t, tempPath, owned, bytes);
      verifySource(t);
      verifyArtifact(t);
      rename(t, parent, temp, leaf, 4, "object_conflict");
      delta(t, tempPath, false);
      delta(t, path, true);
      t.objects.delete(tempPath);
      t.objects.set(path, { owned, bytes });
      fs.fsyncSync(owned.fd);
      verifyOwned(t, path, owned, bytes, true);
      verifySource(t);
    }
  }
  function verifyObjects(t) {
    for (const [path, { owned, bytes }] of t.objects)
      verifyOwned(t, path, owned, bytes, true);
    for (const [path, names] of t.objectListings)
      need(
        JSON.stringify(list(t, path)) ===
          JSON.stringify(expectedNames(t, { path, names })),
        "metadata_changed",
      );
  }
  function verifyPrepared(t, published = false) {
    verifySource(t, published);
    verifyArtifact(t);
    verifyObjects(t);
    verifyOwned(t, join(t.git.path, "index.lock"), t.lock, t.lockBytes);
    verifyOwned(
      t,
      join(t.git.path, published ? "index" : t.backup),
      t.stage,
      t.proposal,
      published,
    );
    if (published) {
      need(
        digest(read(t, join(t.git.path, "index"), L.indexBytes).bytes) ===
          t.request.target.nextIndexDigest,
        "metadata_changed",
      );
      parseIndex(
        read(t, join(t.git.path, "index"), L.indexBytes).bytes,
        t.request.target.objectFormat,
        true,
      );
      if (t.original) {
        const back = read(t, join(t.git.path, t.backup), L.indexBytes);
        need(
          identity(back.s, t.original.s) && back.bytes.equals(t.original.bytes),
          "metadata_changed",
        );
      } else missing(t, join(t.git.path, t.backup));
    }
    stable(t);
  }
  function preserveMetadata(t, stage, original, nextMode = original.meta.mode) {
    return checkedEffect(t, () => {
      const inherited = meta(stage.fd, stat(stage.fd), true);
      for (const [name] of inherited.entries)
        need(
          native.fremovexattr(stage.fd, ptr(name), 0) === 0,
          "metadata_changed",
        );
      for (const [name, value] of original.meta.entries) {
        const data = value.length ? value : Buffer.alloc(1);
        need(
          native.fsetxattr(
            stage.fd,
            ptr(name),
            ptr(data),
            value.length,
            0,
            0,
          ) === 0,
          "metadata_changed",
        );
      }
      stage.s = stat(stage.fd);
      stage.signature = signature(stage.s);
      stage.meta = meta(stage.fd, stage.s, true);
      need(
        sameMeta(stage.meta, { ...original.meta, mode: nextMode }) &&
          stage.s.uid === original.s.uid &&
          stage.s.gid === original.s.gid,
        "metadata_changed",
      );
      fs.fsyncSync(stage.fd);
    });
  }

  // These policies use the same held descriptors, IO bounds and typed deltas
  // as index publication. They do not expose arbitrary caller paths or hooks.
  function createDirectory(t, parent, name, conflict) {
    return checkedEffect(t, () => {
      verifySource(t);
      verifyArtifact(t);
      authority(parent);
      missing(t, join(parent.path, name), conflict);
      stable(t);
      gate(t);
      commitState(t);
      const b = cs(name);
      need(native.mkdirat(parent.fd, ptr(b), 0o700) === 0, conflict);
      const path = join(parent.path, name);
      // Record immediately; uncertainty never permits recursive removal/rebase.
      delta(t, path, true);
      const d = directory(t, path);
      authority(d);
      need(
        d.s.dev === parent.s.dev && (stat(d.fd).mode & 0o7777n) === 0o700n,
        "metadata_changed",
      );
      need(list(t, path).length === 0, conflict);
      t.objectListings.set(path, []);
      fs.fsyncSync(parent.fd);
      verifySource(t);
      return d;
    });
  }
  function ensureCommitParent(t, path, root) {
    need(
      path === root.path || path.startsWith(root.path + "/"),
      "invalid_request",
    );
    let parent = root;
    for (const name of path
      .slice(root.path.length + 1)
      .split("/")
      .filter(Boolean)) {
      const child = join(parent.path, name);
      if (t.dirs.has(child)) parent = writeDirectory(t, child);
      else {
        need(t.allowedDirectories.has(child), "invalid_request");
        need(
          t.manifest.source.missing.some(
            (p) => child === p || child.startsWith(p + "/"),
          ),
          "invalid_request",
        );
        parent = createDirectory(t, authority(parent), name, "path_changed");
      }
    }
    return authority(parent);
  }
  function packedOids(t) {
    const format = t.request.target.objectFormat,
      width = format === "sha1" ? 20 : 32;
    const set = new Set(),
      root = join(t.common.path, "objects/pack");
    for (const f of t.manifest.source.files.filter(
      (x) => dirname(x.path) === root && x.path.endsWith(".idx"),
    )) {
      const b = sourceBytes(t, f.path, false, L.artifactBytes),
        n = b.length;
      need(
        n >= 8 + 1024 + width * 2 &&
          b.readUInt32BE(0) === 0xff744f63 &&
          b.readUInt32BE(4) === 2,
        "object_conflict",
      );
      need(
        digest(b.subarray(0, -width), format) ===
          b.subarray(-width).toString("hex"),
        "object_conflict",
      );
      const count = b.readUInt32BE(8 + 255 * 4),
        table = 1032,
        offsets = table + count * (width + 4),
        end = offsets + count * 4;
      need(
        count <= L.artifactFiles * 256 && end <= n - width * 2,
        "object_conflict",
      );
      const bigCount = (n - width * 2 - end) / 8;
      need(Number.isInteger(bigCount) && bigCount <= count, "object_conflict");
      const packPath = f.path.slice(0, -4) + ".pack",
        pack = sourceBytes(t, packPath, false, L.artifactBytes);
      need(
        pack.length >= 12 + width &&
          pack.toString("ascii", 0, 4) === "PACK" &&
          [2, 3].includes(pack.readUInt32BE(4)) &&
          pack.readUInt32BE(8) === count,
        "object_conflict",
      );
      const packDigest = digest(pack.subarray(0, -width), format);
      need(
        packDigest === pack.subarray(-width).toString("hex") &&
          packDigest === b.subarray(n - width * 2, n - width).toString("hex"),
        "object_conflict",
      );
      const fan = new Array(256).fill(0),
        large = new Set();
      let prev;
      for (let i = 0; i < count; i++) {
        if (i % 1024 === 0) gate(t);
        const oid = b.subarray(table + i * width, table + (i + 1) * width);
        need(!prev || Buffer.compare(prev, oid) < 0, "object_conflict");
        prev = oid;
        fan[oid[0]]++;
        set.add(oid.toString("hex"));
        let offset = BigInt(b.readUInt32BE(offsets + i * 4));
        if (offset & 0x80000000n) {
          const j = Number(offset & 0x7fffffffn);
          need(j < bigCount && !large.has(j), "object_conflict");
          large.add(j);
          offset = b.readBigUInt64BE(end + j * 8);
        }
        need(
          offset >= 12n && offset < BigInt(pack.length - width),
          "object_conflict",
        );
      }
      need(large.size === bigCount, "object_conflict");
      let total = 0;
      for (let i = 0; i < 256; i++) {
        total += fan[i];
        need(b.readUInt32BE(8 + i * 4) === total, "object_conflict");
      }
    }
    return set;
  }
  function verifyCommitGraph(t) {
    const m = t.manifest,
      target = t.request.target,
      format = target.objectFormat,
      width = format === "sha1" ? 20 : 32;
    const indexBytes = sourceBytes(t, join(t.git.path, "index"));
    need(digest(indexBytes) === target.indexDigest, "metadata_changed");
    const entries = [...parseIndex(indexBytes, format)].map(([path, x]) => ({
      path,
      ...x,
    }));
    need(isDeepStrictEqual(entries, m.entries), "invalid_request");
    const records = new Map(),
      packed = packedOids(t);
    for (const record of m.objects) {
      const bytes = artifactRead(t, record),
        raw = object(bytes, record, format),
        zero = raw.indexOf(0),
        body = raw.subarray(zero + 1);
      records.set(record.oid, { record, body });
      const path = join(t.common.path, record.path),
        original = t.manifest.source.files.find((x) => x.path === path);
      if (original) {
        need(
          !record.install &&
            object(sourceBytes(t, path), record, format).equals(raw),
          "object_conflict",
        );
      } else {
        need(record.install === !packed.has(record.oid), "object_conflict");
        missing(t, path, "object_conflict");
      }
    }
    const visited = new Set(),
      flattened = [];
    function tree(oid, prefix = "", depth = 0) {
      need(depth <= L.depth, "invalid_request");
      const proof = records.get(oid);
      need(proof?.record.type === "tree", "object_conflict");
      visited.add(oid);
      const b = proof.body;
      need(prefix === "" || b.length > 0, "object_conflict");
      let at = 0,
        previous;
      while (at < b.length) {
        const space = b.indexOf(32, at),
          zero = b.indexOf(0, space + 1);
        need(
          space > at && zero > space + 1 && zero + 1 + width <= b.length,
          "object_conflict",
        );
        const mode = b.toString("ascii", at, space),
          name = text(b.subarray(space + 1, zero));
        need(
          ["40000", "100644", "100755"].includes(mode) &&
            !name.includes("/") &&
            name !== "." &&
            name !== ".." &&
            name.toLowerCase() !== ".git",
          "object_conflict",
        );
        const path = prefix + name,
          sortKey = Buffer.from(name + (mode === "40000" ? "/" : ""));
        need(
          validWorkspaceFilePath(path) &&
            (!previous || Buffer.compare(previous, sortKey) < 0),
          "object_conflict",
        );
        previous = sortKey;
        const child = b.subarray(zero + 1, zero + 1 + width).toString("hex");
        need(!/^0+$/u.test(child), "object_conflict");
        at = zero + 1 + width;
        if (mode === "40000") {
          need(depth < L.depth, "object_conflict");
          tree(child, path + "/", depth + 1);
        } else {
          need(flattened.length < 4096, "invalid_request");
          flattened.push({ path, mode: parseInt(mode, 8), oid: child });
        }
      }
    }
    tree(target.treeOid);
    flattened.sort((a, b) =>
      Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)),
    );
    need(isDeepStrictEqual(flattened, m.entries), "object_conflict");
    const ident = `${m.author.name} <${m.author.email}> ${m.timestamp} +0000`;
    const expected = Buffer.from(
      `tree ${target.treeOid}\n${target.headOid ? `parent ${target.headOid}\n` : ""}author ${ident}\ncommitter ${ident}\n\n${m.canonicalMessage}`,
    );
    const proof = records.get(target.commitOid),
      body = artifactRead(t, m.commit);
    need(
      proof?.record.type === "commit" &&
        proof.body.equals(body) &&
        body.equals(expected) &&
        digest(body) === target.commitBodyDigest,
      "object_conflict",
    );
    visited.add(target.commitOid);
    need(visited.size === records.size, "object_conflict");
    t.ident = ident;
  }
  function commitLogPolicy(t) {
    // This closed parser only extracts the source-owned log boolean. Git has
    // already parsed configuration on the private copy; this check independently
    // binds the applicable original log paths without running original Git.
    let policy = true;
    const paths = [
      join(t.common.path, "config"),
      join(t.git.path, "config.worktree"),
    ];
    for (const path of paths) {
      if (!t.sourceFDs.has(path)) {
        need(path === paths[1], "invalid_request");
        continue;
      }
      const raw = text(sourceBytes(t, path));
      need(!raw.includes("\0"), "invalid_request");
      let section = "",
        seen = false;
      for (const line of raw.replace(/\\\r?\n/gu, "").split(/\r?\n/u)) {
        const v = line.trim();
        if (!v || /^[#;]/u.test(v)) continue;
        if (v.startsWith("[")) {
          const m = /^\[([^\]]+)\]\s*(?:[#;].*)?$/u.exec(v);
          need(m, "invalid_request");
          section = m[1].trim().toLowerCase();
          continue;
        }
        if (section !== "core") continue;
        const m = /^logallrefupdates\s*(?:=\s*(.*)|([#;].*))?$/iu.exec(v);
        if (!m) continue;
        need(!seen, "invalid_request");
        seen = true;
        const source = m[1] ?? "true";
        let value = "",
          quoted = false;
        for (let i = 0; i < source.length; i++) {
          const ch = source[i];
          if (ch === '"') {
            quoted = !quoted;
            continue;
          }
          if (!quoted && (ch === "#" || ch === ";")) break;
          if (ch === "\\") {
            const next = source[++i],
              escapes = { n: "\n", t: "\t", b: "\b", '"': '"', "\\": "\\" };
            need(Object.hasOwn(escapes, next), "invalid_request");
            value += escapes[next];
          } else value += ch;
        }
        need(!quoted, "invalid_request");
        value = value.trim().toLowerCase();
        need(
          [
            "true",
            "yes",
            "on",
            "1",
            "always",
            "false",
            "no",
            "off",
            "0",
            "",
          ].includes(value),
          "invalid_request",
        );
        policy = ["true", "yes", "on", "1", "always"].includes(value);
      }
    }
    return policy;
  }
  function initializeCommit(t) {
    const m = t.manifest,
      target = t.request.target;
    verifyCommitGraph(t);
    const symbolic = text(sourceBytes(t, join(t.git.path, "HEAD")));
    if (target.reference.kind === "branch")
      need(
        validGitCommitBranch(target.reference.name) &&
          symbolic.trimEnd() === `ref: ${target.reference.name}`,
        "path_changed",
      );
    else need(symbolic.trimEnd() === `${target.headOid}`, "path_changed");
    const logPaths = [
      ["head_log", join(t.git.path, "logs/HEAD"), t.git],
      ...(target.reference.kind === "branch"
        ? [
            [
              "branch_log",
              join(t.common.path, "logs", target.reference.name),
              t.common,
            ],
          ]
        : []),
    ];
    const logPolicy = commitLogPolicy(t);
    for (const [role, path] of logPaths) {
      const exists = t.sourceFDs.has(path);
      need(
        target.logs.some((x) => x.role === role) === (exists || logPolicy),
        "invalid_request",
      );
      if (!exists) {
        need(m.source.missing.includes(path), "invalid_request");
        missing(t, path);
      }
    }
    t.targets = [];
    for (const log of target.logs) {
      const [role, path, root] = logPaths.find((x) => x[0] === log.role),
        proposal = artifactRead(
          t,
          m.logs.find((x) => x.role === role).proposal,
        );
      const original = sourceBytes(t, path, !log.exists);
      need(
        log.exists === (original !== null) &&
          (original ? digest(original) : GIT_COMMIT_ABSENT_DIGEST) ===
            log.digest,
        "metadata_changed",
      );
      need(!original?.length || original.at(-1) === 10, "invalid_request");
      const line = Buffer.from(
        `${target.headOid ?? "0".repeat(target.objectFormat === "sha1" ? 40 : 64)} ${target.commitOid} ${t.ident}\t${GIT_COMMIT_REFLOG_REASON}\n`,
      );
      need(
        proposal.equals(Buffer.concat([original ?? Buffer.alloc(0), line])),
        "invalid_request",
      );
      t.targets.push({
        role,
        path,
        root,
        proposal,
        expected: log,
        originalBytes: original,
      });
    }
    const path =
        target.reference.kind === "head"
          ? join(t.git.path, "HEAD")
          : join(t.common.path, target.reference.name),
      root = target.reference.kind === "head" ? t.git : t.common;
    const original = sourceBytes(t, path, !target.reference.exists),
      proposal = artifactRead(t, m.reference);
    need(
      target.reference.exists === (original !== null) &&
        (original ? digest(original) : GIT_COMMIT_ABSENT_DIGEST) ===
          target.reference.digest &&
        proposal.equals(Buffer.from(target.commitOid + "\n")),
      "invalid_request",
    );
    t.targets.push({
      role: target.reference.kind === "head" ? "head_ref" : "branch_ref",
      path,
      root,
      proposal,
      expected: target.reference,
      originalBytes: original,
    });
    t.allowedDirectories = new Set();
    for (const x of t.targets) {
      for (let p = dirname(x.path); ; p = dirname(p)) {
        if (t.manifest.source.directories.some((d) => d.path === p)) {
          need(
            t.manifest.source.listings.some((l) => l.path === p),
            "invalid_request",
          );
          const d = directory(t, p);
          need(d.s.dev === x.root.s.dev, "path_denied");
        }
        if (p === x.root.path) break;
        need(p.startsWith(x.root.path + "/"), "invalid_request");
      }

      need(
        x.root.s.dev === t.git.s.dev && x.root.s.dev === t.common.s.dev,
        "path_denied",
      );
      let p = dirname(x.path);
      while (p !== x.root.path) {
        need(p.startsWith(x.root.path + "/"), "invalid_request");
        t.allowedDirectories.add(p);
        p = dirname(p);
      }
      x.backup = gitCommitBackupId(
        t.request.runtimeEpoch,
        t.request.operationId,
        x.role,
      );
      missing(t, join(x.root.path, x.backup), "backup_conflict");
      if (x.originalBytes !== null) {
        const fd = t.sourceFDs.get(x.path),
          v = observe(t, fd, L.indexBytes);
        x.original = { ...v, fd, meta: meta(fd, stat(fd), true) };
        const probe = named(t, x.path, (readFlags & ~c.O_RDONLY) | c.O_RDWR);
        try {
          need(
            signature(stat(probe)) === v.signature &&
              (stat(probe).mode & 0o200n) !== 0n,
            "path_denied",
          );
        } finally {
          dispose(t, probe);
        }
      }
    }
    // Index is read authority only. No writable probe or metadata narrowing.
    verifySource(t);
    authority(t.git);
    authority(t.common);
    writeDirectory(t, join(t.common.path, "objects"));
    t.locks = [];
    const lock = (path) => {
      const parent = writeDirectory(t, dirname(path));
      verifySource(t);
      verifyArtifact(t);
      const owned = createFile(t, parent, basename(path), "lock_conflict"),
        bytes = Buffer.from(t.nonce);
      delta(t, path, true);
      t.locks.push({ path, parent, owned, bytes });
      writeBytes(t, owned, bytes);
      fs.fsyncSync(parent.fd);
      verifySource(t);
    };
    lock(join(t.git.path, "index.lock"));
    lock(join(t.git.path, "HEAD.lock"));
    const ref = t.targets.at(-1);
    if (target.reference.kind === "branch") {
      ensureCommitParent(t, dirname(ref.path), ref.root);
      lock(ref.path + ".lock");
    }
    // No log parent, immutable object or proposal effect before all locks.
    for (const x of t.targets)
      x.parent = ensureCommitParent(t, dirname(x.path), x.root);
    publishObjects(t);
    for (const x of t.targets) {
      verifySource(t);
      verifyArtifact(t);
      verifyObjects(t);
      x.stage = createFile(t, authority(x.root), x.backup, "backup_conflict");
      delta(t, join(x.root.path, x.backup), true);
      writeBytes(
        t,
        x.stage,
        x.proposal,
        x.original ? Number(x.original.s.mode & 0o777n) : 0o600,
      );
      if (x.original) preserveMetadata(t, x.stage, x.original);
      fs.fsyncSync(x.root.fd);
    }
    verifyCommitPrepared(t);
  }
  function verifyCommitTarget(t, x) {
    const stagePath = x.published ? x.path : join(x.root.path, x.backup);
    verifyOwned(t, stagePath, x.stage, x.proposal, Boolean(x.published));
    if (x.original) {
      const held = observe(t, x.original.fd, L.indexBytes);
      need(
        identity(held.s, x.original.s) &&
          held.bytes.equals(x.original.bytes) &&
          held.s.mtimeNs === x.original.s.mtimeNs &&
          held.s.uid === x.original.s.uid &&
          held.s.gid === x.original.s.gid &&
          sameMeta(x.original.meta, meta(x.original.fd, held.s, true)),
        "metadata_changed",
      );
      const old = read(
        t,
        x.published ? join(x.root.path, x.backup) : x.path,
        L.indexBytes,
      );
      need(
        identity(old.s, x.original.s) &&
          old.bytes.equals(x.original.bytes) &&
          old.s.mtimeNs === x.original.s.mtimeNs &&
          old.s.uid === x.original.s.uid &&
          old.s.gid === x.original.s.gid &&
          (x.published || old.signature === x.original.signature),
        "metadata_changed",
      );
    } else if (x.published) missing(t, join(x.root.path, x.backup));
    else missing(t, x.path);
  }
  function verifyCommitPrepared(t) {
    verifySource(t);
    verifyArtifact(t);
    verifyObjects(t);
    for (const x of t.targets) if (!x.aborted) verifyCommitTarget(t, x);
    for (const l of t.locks)
      if (!l.removed) verifyOwned(t, l.path, l.owned, l.bytes);
  }
  function renameCommitTarget(t, x) {
    gate(t);
    const fenced = t.fenced;
    t.fenced = true;
    try {
      verifyCommitPrepared(t);
      stable(t);
      gate(t);
      authority(x.root);
      authority(x.parent);
      need(stat(x.root.fd).dev === stat(x.parent.fd).dev, "path_denied");
      // Final named inode/absence checks have no callback before rename.
      const stage = openAt(t, x.root.fd, x.backup);
      need(stage.fd >= 0, "path_changed");
      try {
        need(
          signature(stat(stage.fd)) === signature(stat(x.stage.fd)),
          "metadata_changed",
        );
      } finally {
        dispose(t, stage.fd);
      }
      const old = openAt(t, x.parent.fd, basename(x.path));
      if (x.original) {
        need(old.fd >= 0, "path_changed");
        try {
          need(
            signature(stat(old.fd)) === x.original.signature,
            "metadata_changed",
          );
        } finally {
          dispose(t, old.fd);
        }
      } else {
        if (old.fd >= 0) dispose(t, old.fd);
        need(old.fd < 0 && old.error === 2, "path_changed");
      }
      rename(
        t,
        x.root,
        x.backup,
        basename(x.path),
        x.original ? 2 : 4,
        "path_changed",
        x.parent,
      );
      x.published = true;
      delta(t, x.path, true);
      if (!x.original) delta(t, join(x.root.path, x.backup), false);
      fs.fsyncSync(x.stage.fd);
      if (x.original) fs.fsyncSync(x.original.fd);
      fs.fsyncSync(x.root.fd);
      if (x.parent.fd !== x.root.fd) fs.fsyncSync(x.parent.fd);
      verifyCommitPrepared(t);
    } finally {
      t.fenced = fenced;
    }
  }
  function finishCommit(t, publish) {
    verifyCommitPrepared(t);
    if (publish) for (const x of t.targets) renameCommitTarget(t, x);
    else
      for (const x of t.targets) {
        verifyCommitPrepared(t);
        removeOwned(t, x.root, x.backup, x.stage, x.proposal);
        x.aborted = true;
      }
    gate(t);
    t.fenced = true;
    // After abort, stages are absent; original source and object effects still
    // receive full validation. A partial publication is never replayed/undone.
    if (publish) verifyCommitPrepared(t);
    else {
      verifySource(t);
      verifyArtifact(t);
      verifyObjects(t);
    }
    for (const l of t.locks) {
      removeOwned(t, l.parent, basename(l.path), l.owned, l.bytes);
      l.removed = true;
    }
    verifySource(t);
    verifyArtifact(t);
    verifyObjects(t);
    if (publish) for (const x of t.targets) verifyCommitTarget(t, x);
    return publish
      ? {
          status: "committed",
          commitOid: t.request.target.commitOid,
          treeOid: t.request.target.treeOid,
          referenceDigest: t.request.target.reference.nextDigest,
          logDigests: t.request.target.logs.map((x) => ({
            role: x.role,
            digest: x.nextDigest,
          })),
          backups: gitCommitExpectedBackups(
            t.request.target,
            t.request.runtimeEpoch,
            t.request.operationId,
          ),
        }
      : { status: "aborted" };
  }
  // Branch/restore uses the same held descriptors and finite delta engine.
  // Raw private proofs never become original object-store writes.
  function branchConfig(t) {
    const values = new Map();
    for (const path of [
      join(t.common.path, "config"),
      join(t.git.path, "config.worktree"),
    ]) {
      const b = sourceBytes(t, path, path.endsWith("config.worktree"));
      if (b === null) continue;
      const raw = text(b);
      need(!raw.includes("\0"), "unsupported_branch_restore");
      let section = "";
      const seen = new Set();
      for (const line of raw.replace(/\\\r?\n/gu, "").split(/\r?\n/u)) {
        const v = line.trim();
        if (!v || /^[#;]/u.test(v)) continue;
        if (v.startsWith("[")) {
          const m =
            /^\[([A-Za-z0-9.-]+)(?:\s+"([^"\\]*)")?\]\s*(?:[#;].*)?$/u.exec(v);
          need(m, "unsupported_branch_restore");
          section = m[1].toLowerCase() + (m[2] === undefined ? "" : "." + m[2]);
          continue;
        }
        const m = /^([A-Za-z][A-Za-z0-9-]*)\s*(?:=\s*(.*)|([#;].*))?$/u.exec(v);
        need(m && section, "unsupported_branch_restore");
        const key = section + "." + m[1].toLowerCase();
        need(!seen.has(key), "unsupported_branch_restore");
        seen.add(key);
        const src = m[2] ?? "true";
        let value = "",
          quoted = false;
        for (let i = 0; i < src.length; i++) {
          const ch = src[i];
          if (ch === '"') {
            quoted = !quoted;
            continue;
          }
          if (!quoted && (ch === "#" || ch === ";")) break;
          if (ch === "\\") {
            const next = src[++i],
              escapes = { n: "\n", t: "\t", b: "\b", '"': '"', "\\": "\\" };
            need(Object.hasOwn(escapes, next), "unsupported_branch_restore");
            value += escapes[next];
          } else value += ch;
        }
        need(!quoted, "unsupported_branch_restore");
        values.set(key, value.trim());
      }
    }
    const boolean = (v) => {
      need(
        ["true", "yes", "on", "1", "false", "no", "off", "0", ""].includes(
          v.toLowerCase(),
        ),
        "unsupported_branch_restore",
      );
      return ["true", "yes", "on", "1"].includes(v.toLowerCase());
    };
    for (const [key, value] of values) {
      need(
        !/^(include\.|includeif\.|filter\.|merge\.|diff\.[^.]+\.)/u.test(key) &&
          ![
            "core.excludesfile",
            "core.attributesfile",
            "core.sparsecheckout",
            "core.sparsecheckoutcone",
            "extensions.partialclone",
            "extensions.refstorage",
          ].includes(key) &&
          !/^remote\..*\.promisor$/u.test(key),
        "unsupported_branch_restore",
      );
      if (key.startsWith("extensions."))
        need(
          ["extensions.objectformat", "extensions.worktreeconfig"].includes(
            key,
          ),
          "unsupported_branch_restore",
        );
      if (["core.bare", "core.autocrlf"].includes(key))
        need(!boolean(value), "unsupported_branch_restore");
      if (key === "core.eol")
        need(["lf", "native"].includes(value), "unsupported_branch_restore");
      if (key === "core.worktree")
        need(
          resolve(t.git.path, value) === t.request.workspacePath,
          "path_changed",
        );
    }
    need(
      (values.get("extensions.objectformat") ?? "sha1") ===
        t.request.target.objectFormat &&
        ["0", "1"].includes(
          values.get("core.repositoryformatversion") ?? "0",
        ) &&
        (t.request.target.objectFormat !== "sha256" ||
          values.get("core.repositoryformatversion") === "1"),
      "unsupported_branch_restore",
    );
    if (t.sourceFDs.has(join(t.git.path, "config.worktree")))
      need(
        values.has("extensions.worktreeconfig") &&
          boolean(values.get("extensions.worktreeconfig")),
        "unsupported_branch_restore",
      );
    t.fileMode =
      !values.has("core.filemode") || boolean(values.get("core.filemode"));
    return commitLogPolicy(t);
  }
  function branchGraph(t) {
    const m = t.manifest,
      target = t.request.target,
      format = target.objectFormat,
      width = format === "sha1" ? 20 : 32,
      records = new Map();
    for (const r of m.objects) {
      const b = artifactRead(t, r);
      need(
        digest(
          Buffer.concat([Buffer.from(`${r.type} ${b.length}\0`), b]),
          format,
        ) === r.oid,
        "object_conflict",
      );
      records.set(r.oid, { type: r.type, body: b });
    }
    const blob = (oid) => {
      const r = records.get(oid);
      need(r?.type === "blob", "object_conflict");
      return r.body;
    };
    const graph = (commitOid) => {
      const commit = records.get(commitOid);
      need(commit?.type === "commit", "object_conflict");
      const first = commit.body
        .subarray(0, commit.body.indexOf(10))
        .toString("ascii");
      need(
        new RegExp(`^tree [a-f0-9]{${width * 2}}$`, "u").test(first),
        "object_conflict",
      );
      const rootOid = first.slice(5),
        entries = new Map(),
        visiting = new Set();
      function walk(oid, prefix = "", depth = 0) {
        gate(t);
        const record = records.get(oid);
        need(
          depth <= L.depth && !visiting.has(oid) && record?.type === "tree",
          "object_conflict",
        );
        visiting.add(oid);
        const b = record.body;
        need(!prefix || b.length > 0, "object_conflict");
        let at = 0,
          previous;
        while (at < b.length) {
          const space = b.indexOf(32, at),
            zero = b.indexOf(0, space + 1);
          need(
            space > at && zero > space + 1 && zero + 1 + width <= b.length,
            "object_conflict",
          );
          const mode = b.toString("ascii", at, space),
            name = text(b.subarray(space + 1, zero)),
            path = prefix + name;
          const key = Buffer.from(name + (mode === "40000" ? "/" : ""));
          need(
            ["40000", "100644", "100755"].includes(mode) &&
              !name.includes("/") &&
              validWorkspaceFilePath(path) &&
              name.toLowerCase() !== ".git" &&
              (!previous || Buffer.compare(previous, key) < 0),
            "object_conflict",
          );
          previous = key;
          const child = b.subarray(zero + 1, zero + 1 + width).toString("hex");
          at = zero + 1 + width;
          if (mode === "40000") walk(child, path + "/", depth + 1);
          else {
            need(entries.size < 4096, "invalid_request");
            entries.set(path, { mode: parseInt(mode, 8), oid: child });
          }
        }
        visiting.delete(oid);
      }
      walk(rootOid);
      return {
        rootOid,
        entries: new Map(
          [...entries].sort(([a], [b]) =>
            Buffer.compare(Buffer.from(a), Buffer.from(b)),
          ),
        ),
      };
    };
    const bytes = sourceBytes(
      t,
      join(t.git.path, "index"),
      !target.indexExists,
    );
    need(
      (bytes !== null) === target.indexExists &&
        (bytes ? digest(bytes) : GIT_COMMIT_ABSENT_DIGEST) ===
          target.indexDigest,
      "metadata_changed",
    );
    t.old = bytes ? parseIndex(bytes, format) : new Map();
    const current = graph(target.headOid),
      desired =
        target.action === "select" ? graph(target.nextHeadOid) : current;
    need(target.treeOid === desired.rootOid, "object_conflict");
    const entries =
      target.action === "select" || target.source === "head"
        ? desired.entries
        : t.old;
    const rows = (map) => [...map].map(([path, x]) => ({ path, ...x }));
    need(
      isDeepStrictEqual(rows(t.old), m.currentEntries) &&
        isDeepStrictEqual(rows(entries), m.desiredEntries),
      "invalid_request",
    );
    // Attribute blobs are raw object proofs too, including cached attributes.
    for (const map of [t.old, current.entries, desired.entries])
      for (const [path, e] of map)
        if (basename(path) === ".gitattributes") blob(e.oid);
    for (const p of target.paths)
      for (const map of [t.old, current.entries, entries]) {
        const e = map.get(p.path);
        if (e) blob(e.oid);
      }
    t.branchProof = { blob, current: current.entries, desired: entries };
  }
  function branchAttributes(t, entries, currentWorktree = false) {
    const out = new Map(),
      root = t.request.workspacePath;
    for (const [path, e] of entries)
      if (basename(path) === ".gitattributes")
        out.set(path, t.branchProof.blob(e.oid));
    if (currentWorktree)
      for (const f of t.manifest.source.files)
        if (
          f.path.startsWith(root + "/") &&
          basename(f.path) === ".gitattributes"
        )
          out.set(f.path.slice(root.length + 1), sourceBytes(t, f.path));
    const infoPath = join(t.common.path, "info/attributes");
    let info;
    if (t.sourceFDs.has(infoPath)) info = sourceBytes(t, infoPath);
    else {
      need(
        t.manifest.source.missing.some(
          (p) => infoPath === p || infoPath.startsWith(p + "/"),
        ),
        "invalid_request",
      );
      missing(t, infoPath);
      info = null;
    }
    // Byte-based dynamic programming keeps wildmatch bounded. Backtracking
    // regular expressions can exceed the kernel deadline on valid long patterns.
    // C-quoted/escaped and POSIX class patterns refuse as incomplete proofs.
    const matches = (pattern, path) => {
      need(
        !/[\\"]/u.test(pattern) &&
          !pattern.startsWith("!") &&
          Buffer.byteLength(pattern) <= 2048,
        "unsupported_branch_restore",
      );
      if (pattern.endsWith("/")) return false;
      const anchored = pattern.startsWith("/") || pattern.includes("/");
      if (pattern.startsWith("/")) pattern = pattern.slice(1);
      const p = Buffer.from(pattern),
        b = Buffer.from(anchored ? path : basename(path)),
        tokens = [];
      for (let i = 0; i < p.length; i++) {
        const ch = p[i];
        if (ch === 42 && p[i + 1] === 42) {
          need(
            (i === 0 || p[i - 1] === 47) &&
              (i + 2 === p.length || p[i + 2] === 47),
            "unsupported_branch_restore",
          );
          i++;
          if (p[i + 1] === 47) {
            i++;
            tokens.push({ kind: "dirs" });
          } else tokens.push({ kind: "glob" });
        } else if (ch === 42) tokens.push({ kind: "star" });
        else if (ch === 63) tokens.push({ kind: "one" });
        else if (ch === 91) {
          const accepted = new Uint8Array(256);
          let j = i + 1,
            negate = false,
            count = 0;
          if (p[j] === 33 || p[j] === 94) {
            negate = true;
            j++;
          }
          if (p[j] === 93) {
            accepted[93] = 1;
            count++;
            j++;
          }
          while (j < p.length && p[j] !== 93) {
            need(p[j] !== 91, "unsupported_branch_restore");
            if (p[j + 1] === 45 && j + 2 < p.length && p[j + 2] !== 93) {
              need(p[j] <= p[j + 2], "unsupported_branch_restore");
              for (let c = p[j]; c <= p[j + 2]; c++) accepted[c] = 1;
              j += 3;
            } else accepted[p[j++]] = 1;
            count++;
          }
          need(count > 0 && p[j] === 93, "unsupported_branch_restore");
          i = j;
          if (negate) for (let c = 0; c < 256; c++) accepted[c] ^= 1;
          accepted[47] = 0;
          tokens.push({ kind: "class", accepted });
        } else tokens.push({ kind: "literal", byte: ch });
      }
      let previous = new Uint8Array(b.length + 1);
      previous[0] = 1;
      for (let i = 0; i < tokens.length; i++) {
        if (i % 32 === 0) gate(t);
        const token = tokens[i],
          next = new Uint8Array(b.length + 1);
        if (["star", "glob", "dirs"].includes(token.kind))
          next[0] = previous[0];
        let prefix = previous[0];
        for (let j = 1; j <= b.length; j++) {
          if (token.kind === "star")
            next[j] = previous[j] || (b[j - 1] !== 47 && next[j - 1]);
          else if (token.kind === "glob") next[j] = previous[j] || next[j - 1];
          else if (token.kind === "dirs")
            next[j] = previous[j] || (b[j - 1] === 47 && prefix);
          else if (token.kind === "one")
            next[j] = previous[j - 1] && b[j - 1] !== 47;
          else if (token.kind === "class")
            next[j] = previous[j - 1] && token.accepted[b[j - 1]];
          else next[j] = previous[j - 1] && token.byte === b[j - 1];
          prefix ||= previous[j];
        }
        previous = next;
      }
      return previous[b.length] === 1;
    };
    return (path) => {
      const effective = new Map();
      const files = [...out]
        .filter(
          ([p]) => dirname(p) === "." || path.startsWith(dirname(p) + "/"),
        )
        .sort(([a], [b]) => a.split("/").length - b.split("/").length);
      if (info !== null) files.push(["@info", info]);
      for (const [attr, raw] of files) {
        need(raw.length <= L.indexBytes, "invalid_request");
        for (const line of text(raw).split(/\r?\n/u)) {
          if (!line.trim() || line.startsWith("#")) continue;
          need(!line.includes("\0"), "unsupported_branch_restore");
          const fields = line.trim().split(/[ \t]+/u),
            pattern = fields.shift();
          need(
            fields.length > 0 && !pattern.startsWith("[attr]"),
            "unsupported_branch_restore",
          );
          const relative =
            attr === "@info" || dirname(attr) === "."
              ? path
              : path.slice(dirname(attr).length + 1);
          if (!matches(pattern, relative)) continue;
          for (const field of fields) {
            const m = /^([-!]?)([a-zA-Z][a-zA-Z0-9-]*)(?:=(.*))?$/u.exec(field);
            need(m, "unsupported_branch_restore");
            const value =
              m[1] === "!"
                ? "unspecified"
                : m[1] === "-"
                  ? "unset"
                  : (m[3] ?? "set");
            need(!m[1] || m[3] === undefined, "unsupported_branch_restore");
            if (m[2] === "binary" && value === "set")
              for (const key of ["text", "diff", "merge"])
                effective.set(key, "unset");
            else effective.set(m[2], value);
          }
        }
      }
      for (const [key, value] of effective) {
        need(
          value === "unspecified" ||
            (key === "text" && ["set", "unset", "auto"].includes(value)) ||
            (key === "eol" && value === "lf") ||
            (["ident", "binary", "diff"].includes(key) &&
              ["set", "unset"].includes(value)),
          "unsupported_branch_restore",
        );
      }
      return effective.get("ident") === "set";
    };
  }
  function branchRef(t, name) {
    const loose = sourceBytes(t, join(t.common.path, name), true);
    if (loose !== null) {
      const oid = text(loose).trimEnd();
      need(
        new RegExp(`^[a-f0-9]{${t.request.target.headOid.length}}$`, "u").test(
          oid,
        ),
        "branch_conflict",
      );
      return oid;
    }
    const packed = sourceBytes(t, join(t.common.path, "packed-refs"), true);
    let oid = null;
    if (packed)
      for (const line of text(packed).split("\n")) {
        if (!line || line.startsWith("#") || line.startsWith("^")) continue;
        const parts = line.split(" ");
        need(
          parts.length === 2 &&
            new RegExp(
              `^[a-f0-9]{${t.request.target.headOid.length}}$`,
              "u",
            ).test(parts[0]),
          "branch_conflict",
        );
        if (parts[1] === name) {
          need(oid === null, "branch_conflict");
          oid = parts[0];
        }
      }
    return oid;
  }
  function branchOccupancy(t) {
    const common = t.common.path,
      registry = join(common, "worktrees"),
      rows = [];
    let dirs = [common];
    if (t.manifest.source.directories.some((d) => d.path === registry)) {
      const listing = t.manifest.source.listings.find(
        (l) => l.path === registry,
      );
      need(
        listing && isDeepStrictEqual(list(t, registry), listing.names),
        "metadata_changed",
      );
      dirs.push(...listing.names.map((n) => join(registry, n)));
    } else {
      need(t.manifest.source.missing.includes(registry), "invalid_request");
      missing(t, registry);
    }
    for (const dir of dirs) {
      need(
        t.manifest.source.directories.some((d) => d.path === dir) &&
          t.manifest.source.listings.some((l) => l.path === dir),
        "invalid_request",
      );
      const head = sourceBytes(t, join(dir, "HEAD")),
        value = text(head).trimEnd();
      const isBranch = value.startsWith("ref: ");
      need(
        isBranch
          ? validGitCommitBranch(value.slice(5))
          : new RegExp(
              `^[a-f0-9]{${t.request.target.headOid.length}}$`,
              "u",
            ).test(value),
        "branch_conflict",
      );
      if (
        dir !== t.git.path &&
        isBranch &&
        value.slice(5) === t.request.target.branch
      )
        fail("branch_occupied");
      const records = [];
      for (const leaf of ["gitdir", "commondir", "locked"]) {
        const path = join(dir, leaf);
        const declared = t.sourceFDs.has(path);
        if (dir !== common && leaf !== "locked")
          need(declared, "unsupported_branch_restore");
        if (!declared) {
          need(
            !t.manifest.source.listings
              .find((l) => l.path === dir)
              .names.includes(leaf),
            "invalid_request",
          );
          missing(t, path);
          records.push(null);
        } else {
          const b = sourceBytes(t, path);
          if (leaf !== "locked")
            need(
              b.length > 0 && !text(b).trimEnd().includes("\n"),
              "unsupported_branch_restore",
            );
          if (leaf === "commondir")
            need(resolve(dir, text(b).trimEnd()) === common, "branch_conflict");
          records.push(digest(b));
        }
      }
      rows.push([dir, digest(head), ...records]);
    }
    need(
      gitBranchRestoreOccupancyDigest(
        rows.sort((a, b) =>
          Buffer.compare(Buffer.from(a[0]), Buffer.from(b[0])),
        ),
      ) === t.request.target.occupancyDigest,
      "metadata_changed",
    );
  }
  function initializeBranchRestore(t) {
    const m = t.manifest,
      target = t.request.target,
      root = directory(t, t.request.workspacePath);
    const policy = branchConfig(t);
    branchGraph(t);
    branchOccupancy(t);
    const symbolic = sourceBytes(t, join(t.git.path, "HEAD"));
    need(
      digest(symbolic) === target.headDigest &&
        text(symbolic).trimEnd() ===
          (target.currentBranch
            ? `ref: ${target.currentBranch}`
            : target.headOid),
      "path_changed",
    );
    if (target.currentBranch)
      need(
        branchRef(t, target.currentBranch) === target.headOid,
        "path_changed",
      );
    if (target.branch) {
      const refs = [];
      for (const f of m.source.files)
        if (f.path.startsWith(join(t.common.path, "refs") + "/"))
          refs.push(f.path.slice(t.common.path.length + 1));
      const packed = sourceBytes(t, join(t.common.path, "packed-refs"), true);
      if (packed)
        for (const line of text(packed).split("\n"))
          if (line && !/^[#^]/u.test(line)) refs.push(line.split(" ")[1]);
      const folded = target.branch.toLowerCase();
      for (const name of refs)
        need(
          name === target.branch ||
            !(
              name.toLowerCase() === folded ||
              name.toLowerCase().startsWith(folded + "/") ||
              folded.startsWith(name.toLowerCase() + "/")
            ),
          "branch_conflict",
        );
      for (const d of m.source.directories)
        if (d.path.startsWith(join(t.common.path, "refs") + "/")) {
          const name = d.path.slice(t.common.path.length + 1);
          need(
            name.toLowerCase() !== folded &&
              !(
                folded.startsWith(name.toLowerCase() + "/") &&
                !target.branch.startsWith(name + "/")
              ),
            "branch_conflict",
          );
        }
      need(
        branchRef(t, target.branch) ===
          (target.action === "create" ? null : target.nextHeadOid),
        "branch_conflict",
      );
    }
    const currentPolicy = branchAttributes(t, t.old, true),
      cachedPolicy = branchAttributes(t, t.old),
      headPolicy = branchAttributes(t, t.branchProof.current),
      desiredPolicy = branchAttributes(t, t.branchProof.desired);
    for (const path of new Set([
      ...t.old.keys(),
      ...t.branchProof.current.keys(),
      ...t.branchProof.desired.keys(),
    ])) {
      gate(t);
      currentPolicy(path);
      cachedPolicy(path);
      headPolicy(path);
      desiredPolicy(path);
    }
    const sameEntry = (a, b) => isDeepStrictEqual(a ?? null, b ?? null);
    if (target.action === "select") {
      need(
        isDeepStrictEqual([...t.old], [...t.branchProof.current]),
        "unsupported_branch_restore",
      );
      for (const [path, e] of t.old) {
        const actual = sourceBytes(t, join(root.path, path)),
          expected = gitBranchRestoreBlob(
            t.branchProof.blob(e.oid),
            e.oid,
            target.objectFormat,
            currentPolicy(path),
          );
        cachedPolicy(path);
        headPolicy(path);
        const fd = t.sourceFDs.get(join(root.path, path));
        need(
          actual.equals(expected) &&
            (!t.fileMode ||
              Boolean(stat(fd).mode & 0o111n) === (e.mode === 0o100755)),
          "unsupported_branch_restore",
        );
      }
      const selected = new Set(target.paths.map((p) => p.path));
      for (const path of new Set([
        ...t.old.keys(),
        ...t.branchProof.desired.keys(),
      ])) {
        const a = t.old.get(path),
          b = t.branchProof.desired.get(path);
        let changed = !sameEntry(a, b);
        if (a && b && !changed)
          changed =
            currentPolicy(path) !== desiredPolicy(path) &&
            !gitBranchRestoreBlob(
              t.branchProof.blob(a.oid),
              a.oid,
              target.objectFormat,
              currentPolicy(path),
            ).equals(
              gitBranchRestoreBlob(
                t.branchProof.blob(b.oid),
                b.oid,
                target.objectFormat,
                desiredPolicy(path),
              ),
            );
        if (changed)
          need(
            selected.has(path) && workspaceFilePathReason(path) === undefined,
            "invalid_request",
          );
      }
    }
    t.targets = [];
    for (let i = 0; i < target.paths.length; i++) {
      const p = target.paths[i],
        path = join(root.path, p.path),
        entry = t.branchProof.desired.get(p.path) ?? null;
      need(
        sameEntry(p.beforeEntry, t.old.get(p.path)) &&
          sameEntry(p.afterEntry, entry),
        "invalid_request",
      );
      if (target.action === "restore" && target.source === "head")
        need(
          t.old.has(p.path) || t.branchProof.current.has(p.path),
          "invalid_request",
        );
      const before = sourceBytes(t, path, p.before === null);
      need(
        (before !== null) === (p.before !== null) &&
          (!before ||
            (digest(before) === p.before.digest &&
              before.length === p.before.bytes &&
              Number(stat(t.sourceFDs.get(path)).mode & 0o777n) ===
                p.before.mode)),
        "metadata_changed",
      );
      if (target.action === "select" && !t.old.has(p.path))
        need(before === null, "path_changed");
      // Evaluate all original policy views independently, including absent output.
      currentPolicy(p.path);
      cachedPolicy(p.path);
      headPolicy(p.path);
      const ident = entry ? desiredPolicy(p.path) : false;
      need(ident === p.ident, "invalid_request");
      const proposal = p.after ? artifactRead(t, m.worktree[i].proposal) : null;
      if (entry) {
        const expected = gitBranchRestoreBlob(
          t.branchProof.blob(entry.oid),
          entry.oid,
          target.objectFormat,
          ident,
        );
        need(
          proposal.equals(expected) &&
            p.after.mode ===
              gitBranchRestoreMode(
                p.before?.mode ?? null,
                entry.mode === 0o100755,
              ),
          "invalid_request",
        );
      }
      t.targets.push({
        role: "worktree",
        relative: p.path,
        path,
        root: t.git,
        parentRoot: root,
        proposal,
        originalBytes: before,
        nextMode: p.after?.mode ?? null,
      });
    }
    const logRole = target.action === "create" ? "branch_log" : "head_log",
      logPath =
        target.action === "create"
          ? join(t.common.path, "logs", target.branch)
          : join(t.git.path, "logs/HEAD");
    if (target.action !== "restore") {
      const original = sourceBytes(t, logPath, true);
      need(
        target.metadata.some((x) => x.role === logRole) ===
          (original !== null || policy),
        "invalid_request",
      );
    }
    for (let i = 0; i < target.metadata.length; i++) {
      const item = target.metadata[i],
        role = item.role,
        path =
          role === "index"
            ? join(t.git.path, "index")
            : role === "head_ref"
              ? join(t.git.path, "HEAD")
              : role === "branch_ref"
                ? join(t.common.path, target.branch)
                : logPath;
      const before = sourceBytes(t, path, item.before === null),
        proposal = artifactRead(t, m.metadata[i].proposal);
      need(
        (before !== null) === (item.before !== null) &&
          (!before ||
            (digest(before) === item.before.digest &&
              before.length === item.before.bytes)),
        "metadata_changed",
      );
      if (role === "index")
        need(
          isDeepStrictEqual(
            [...parseIndex(proposal, target.objectFormat, true)],
            [...t.branchProof.desired],
          ),
          "invalid_request",
        );
      else if (role === "head_ref")
        need(
          proposal.equals(Buffer.from(`ref: ${target.branch}\n`)),
          "invalid_request",
        );
      else if (role === "branch_ref")
        need(
          before === null &&
            proposal.equals(Buffer.from(target.headOid + "\n")),
          "invalid_request",
        );
      else {
        need(!before?.length || before.at(-1) === 10, "invalid_request");
        const old =
          target.action === "create"
            ? "0".repeat(target.headOid.length)
            : target.headOid;
        const reason =
          target.action === "create"
            ? "branch: Created from HEAD"
            : `checkout: moving from ${target.currentBranch ? target.currentBranch.slice(11) : target.headOid} to ${target.branch.slice(11)}`;
        const line = Buffer.from(
          `${old} ${target.nextHeadOid} ${m.author.name} <${m.author.email}> ${target.timestamp} +0000\t${reason}\n`,
        );
        need(
          proposal.equals(Buffer.concat([before ?? Buffer.alloc(0), line])),
          "invalid_request",
        );
      }
      t.targets.push({
        role,
        path,
        root: role.startsWith("branch_") ? t.common : t.git,
        parentRoot: role.startsWith("branch_") ? t.common : t.git,
        proposal,
        originalBytes: before,
      });
    }
    t.allowedDirectories = new Set();
    for (const x of t.targets) {
      need(x.root.s.dev === x.parentRoot.s.dev, "path_denied");
      for (let p = dirname(x.path); ; p = dirname(p)) {
        if (t.dirs.has(p)) {
          need(
            m.source.listings.some((l) => l.path === p),
            "invalid_request",
          );
          need(directory(t, p).s.dev === x.root.s.dev, "path_denied");
        } else t.allowedDirectories.add(p);
        if (p === x.parentRoot.path) break;
        need(p.startsWith(x.parentRoot.path + "/"), "invalid_request");
      }
      x.backup = gitBranchRestoreBackupId(
        t.request.runtimeEpoch,
        t.request.operationId,
        x.role,
        x.relative ?? null,
      );
      x.stageName = x.originalBytes !== null ? x.backup : `${x.backup}.new`;
      missing(t, join(x.root.path, x.backup), "backup_conflict");
      if (x.originalBytes !== null) {
        const fd = t.sourceFDs.get(x.path);
        if (x.role === "worktree") worktreeDescriptors.add(fd);
        const v = observe(t, fd, L.indexBytes);
        x.original = { ...v, fd, meta: meta(fd, stat(fd), true) };
        x.nextMode ??= Number(v.s.mode & 0o777n);
        const probe = named(t, x.path, (readFlags & ~c.O_RDONLY) | c.O_RDWR);
        try {
          need(
            signature(stat(probe)) === v.signature &&
              (stat(probe).mode & 0o200n) !== 0n,
            "path_denied",
          );
        } finally {
          dispose(t, probe);
        }
      } else x.nextMode ??= 0o600;
    }
    // All source/graph/policy checks precede the first original effect.
    verifySource(t);
    verifyArtifact(t);
    authority(t.git);
    authority(t.common);
    t.locks = [];
    const lock = (path) => {
      const parent = writeDirectory(t, dirname(path));
      const owned = createFile(t, parent, basename(path), "lock_conflict"),
        bytes = Buffer.from(t.nonce);
      delta(t, path, true);
      t.locks.push({ path, parent, owned, bytes });
      writeBytes(t, owned, bytes);
      fs.fsyncSync(parent.fd);
      verifySource(t);
    };
    lock(join(t.git.path, "index.lock"));
    lock(join(t.git.path, "HEAD.lock"));
    const refs = new Set();
    if (target.currentBranch) refs.add(target.currentBranch);
    if (target.branch) refs.add(target.branch);
    for (const name of [...refs].sort()) {
      const path = join(t.common.path, name);
      if (target.action === "create" && name === target.branch) {
        for (let p = dirname(path); p !== t.common.path; p = dirname(p))
          t.allowedDirectories.add(p);
        ensureCommitParent(t, dirname(path), t.common);
      }
      lock(path + ".lock");
    }
    for (const x of t.targets)
      x.parent = ensureCommitParent(t, dirname(x.path), x.parentRoot);
    for (const x of t.targets) {
      if (x.proposal === null) continue; // Deletion has no stage and never unlinks.
      x.stage = createFile(
        t,
        authority(x.root),
        x.stageName,
        "backup_conflict",
      );
      if (x.role === "worktree") worktreeDescriptors.add(x.stage.fd);
      delta(t, join(x.root.path, x.stageName), true);
      writeBytes(t, x.stage, x.proposal, x.nextMode);
      if (x.original)
        preserveMetadata(
          t,
          x.stage,
          x.original,
          (x.original.meta.mode & ~0o777n) | BigInt(x.nextMode),
        );
      fs.fsyncSync(x.root.fd);
    }
    verifyBranchPrepared(t);
  }
  function verifyBranchTarget(t, x) {
    if (x.stage && x.published)
      need(
        signature(stat(x.stage.fd)) === x.stageAfterSignature,
        "metadata_changed",
      );
    if (x.stage)
      verifyOwned(
        t,
        x.published ? x.path : join(x.root.path, x.stageName),
        x.stage,
        x.proposal,
        !!x.published,
      );
    else if (x.published) missing(t, x.path);
    if (x.original) {
      if (x.published)
        need(
          signature(stat(x.original.fd)) === x.oldAfterSignature,
          "metadata_changed",
        );
      const held = observe(t, x.original.fd, L.indexBytes),
        old = read(
          t,
          x.published ? join(x.root.path, x.backup) : x.path,
          L.indexBytes,
        );
      need(
        identity(held.s, x.original.s) &&
          identity(old.s, x.original.s) &&
          held.bytes.equals(x.original.bytes) &&
          old.bytes.equals(x.original.bytes) &&
          held.s.mtimeNs === x.original.s.mtimeNs &&
          held.s.uid === x.original.s.uid &&
          held.s.gid === x.original.s.gid &&
          sameMeta(x.original.meta, meta(x.original.fd, held.s, true)) &&
          (x.published || old.signature === x.original.signature),
        "metadata_changed",
      );
    } else if (!x.published) missing(t, x.path);
    else missing(t, join(x.root.path, x.backup));
  }
  function verifyBranchPrepared(t) {
    verifySource(t);
    verifyArtifact(t);
    for (const x of t.targets) if (!x.aborted) verifyBranchTarget(t, x);
    for (const l of t.locks)
      if (!l.removed) verifyOwned(t, l.path, l.owned, l.bytes);
  }
  function publishBranchTarget(t, x) {
    gate(t);
    const fenced = t.fenced;
    t.fenced = true;
    try {
      verifyBranchPrepared(t);
      authority(x.root);
      authority(x.parent);
      const old = openAt(t, x.parent.fd, basename(x.path));
      if (x.original) {
        need(old.fd >= 0, "path_changed");
        try {
          need(
            signature(stat(old.fd)) === x.original.signature,
            "metadata_changed",
          );
        } finally {
          dispose(t, old.fd);
        }
      } else {
        if (old.fd >= 0) dispose(t, old.fd);
        need(old.fd < 0 && old.error === 2, "path_changed");
      }
      if (x.proposal === null) {
        missing(t, join(x.root.path, x.backup), "backup_conflict");
        rename(
          t,
          x.parent,
          basename(x.path),
          x.backup,
          4,
          "path_changed",
          x.root,
        );
        delta(t, x.path, false);
        delta(t, join(x.root.path, x.backup), true);
      } else {
        const stage = openAt(t, x.root.fd, x.stageName);
        need(stage.fd >= 0, "path_changed");
        try {
          need(
            signature(stat(stage.fd)) === x.stage.signature,
            "metadata_changed",
          );
        } finally {
          dispose(t, stage.fd);
        }
        rename(
          t,
          x.root,
          x.stageName,
          basename(x.path),
          x.original ? 2 : 4,
          "path_changed",
          x.parent,
        );
        delta(t, x.path, true);
        if (!x.original) delta(t, join(x.root.path, x.stageName), false);
      }
      x.published = true;
      if (x.original) x.oldAfterSignature = signature(stat(x.original.fd));
      if (x.stage) x.stageAfterSignature = signature(stat(x.stage.fd));
      if (x.stage) fs.fsyncSync(x.stage.fd);
      if (x.original) fs.fsyncSync(x.original.fd);
      verifyBranchPrepared(t);
    } finally {
      t.fenced = fenced;
    }
  }
  function finishBranchRestore(t, publish) {
    verifyBranchPrepared(t);
    if (publish) for (const x of t.targets) publishBranchTarget(t, x);
    else
      for (const x of t.targets) {
        verifyBranchPrepared(t);
        if (x.stage) removeOwned(t, x.root, x.stageName, x.stage, x.proposal);
        x.aborted = true;
      }
    gate(t);
    t.fenced = true;
    verifySource(t);
    verifyArtifact(t);
    for (const l of t.locks) {
      removeOwned(t, l.parent, basename(l.path), l.owned, l.bytes);
      l.removed = true;
    }
    verifySource(t);
    verifyArtifact(t);
    if (publish) for (const x of t.targets) verifyBranchTarget(t, x);
    const target = t.request.target;
    return publish
      ? {
          status: "applied",
          action: target.action,
          previewDigest: target.previewDigest,
          paths: target.paths.map((x) => ({ path: x.path, after: x.after })),
          metadata: target.metadata.map((x) => ({
            role: x.role,
            digest: x.after.digest,
          })),
          backups: gitBranchRestoreExpectedBackups(
            target,
            t.request.runtimeEpoch,
            t.request.operationId,
          ),
        }
      : { status: "aborted" };
  }
  function initialize(t) {
    const r = t.request;
    const a = directory(t, r.artifact.root, {
      dev: r.artifact.dev,
      ino: r.artifact.ino,
    });
    authority(a, true);
    need((stat(a.fd).mode & 0o7777n) === 0o700n, "path_denied");
    const bytes = artifactRead(t, r.artifact.manifest);
    t.manifest = (
      t.kind === "branchRestore"
        ? validateGitBranchRestoreArtifactManifest
        : t.kind === "commit"
          ? validateGitCommitArtifactManifest
          : validateGitIndexArtifactManifest
    )(JSON.parse(text(bytes)), r);
    const m = t.manifest;
    need(
      m.objects.reduce((n, o) => n + o.rawBytes, 0) <= L.artifactBytes,
      "invalid_request",
    );
    for (const d of Object.values(m.layout)) directory(t, d.path, d);
    t.git = directory(t, m.layout.gitDirectory.path);
    t.common = directory(t, m.layout.commonDirectory.path);
    need(
      identity(t.git.s, t.common.s) === (t.git.path === t.common.path),
      "path_denied",
    );
    const root = directory(t, r.workspacePath);
    need(
      !identity(root.s, t.git.s) && !identity(root.s, t.common.s),
      "path_denied",
    );
    for (const d of m.source.directories) directory(t, d.path, d);
    for (const layout of Object.values(m.layout)) {
      for (let path = layout.path; ; path = dirname(path)) {
        need(
          m.source.directories.some((x) => x.path === path),
          "invalid_request",
        );
        if (path === "/") break;
      }
    }
    const ids = new Map();
    for (const d of m.source.directories) {
      const id = d.dev + ":" + d.ino;
      need(!ids.has(id) || ids.get(id) === d.path, "path_denied");
      ids.set(id, d.path);
    }
    const directoryPaths = new Set(m.source.directories.map((d) => d.path));
    const filePaths = new Set(m.source.files.map((f) => f.path));
    const listingPaths = new Map(m.source.listings.map((l) => [l.path, l]));
    for (const f of m.source.files)
      need(
        !directoryPaths.has(f.path) && directoryPaths.has(dirname(f.path)),
        "invalid_request",
      );
    for (const l of m.source.listings)
      need(directoryPaths.has(l.path), "invalid_request");
    for (const path of m.source.missing)
      need(
        (directoryPaths.has(dirname(path)) ||
          (["commit", "branchRestore"].includes(t.kind) &&
            m.source.missing.some(
              (a) => path.startsWith(a + "/") && directoryPaths.has(dirname(a)),
            ))) &&
          !listingPaths.get(dirname(path))?.names.includes(basename(path)),
        "invalid_request",
      );
    // No worktree, ref, or object omission may hide a nonselected change.
    for (const tree of [
      r.workspacePath,
      join(t.common.path, "refs"),
      join(t.common.path, "objects"),
    ]) {
      const walk = (path) => {
        const listing = listingPaths.get(path);
        need(listing, "invalid_request");
        for (const name of listing.names) {
          const child = join(path, name);
          if (path === r.workspacePath && name === ".git") continue;
          if (directoryPaths.has(child)) walk(child);
          else need(filePaths.has(child), "invalid_request");
        }
      };
      walk(tree);
    }
    for (const path of new Set([t.git.path, t.common.path]))
      need(listingPaths.has(path), "invalid_request");
    // Mandatory authority records cannot be omitted from a structurally valid manifest.
    for (const p of [
      r.workspacePath,
      t.git.path,
      t.common.path,
      join(t.common.path, "objects"),
      join(t.common.path, "refs"),
    ])
      need(
        m.source.directories.some((x) => x.path === p),
        "invalid_request",
      );
    const declared = new Map(m.source.files.map((f) => [f.path, f]));
    let total = 0;
    for (const f of m.source.files) {
      const fd = named(t, f.path);
      t.sourceFDs.set(f.path, fd);
      total += Number(stat(fd).size);
      need(total <= L.artifactBytes, "invalid_request");
    }
    const allowed = new Set([
      "manifest.json",
      ...(t.kind === "branchRestore"
        ? [
            ...m.worktree.flatMap((x) => (x.proposal ? [x.proposal.path] : [])),
            ...m.metadata.map((x) => x.proposal.path),
          ]
        : t.kind === "commit"
          ? [
              m.commit.path,
              m.reference.path,
              ...m.logs.map((x) => x.proposal.path),
            ]
          : [m.proposal.path]),
      ...m.objects.map((o) => o.path),
    ]);
    t.artifactDirectories = new Set([r.artifact.root]);
    function walk(path, rel = "") {
      const names = list(t, path);
      t.artifactListings.set(path, names);
      for (const name of names) {
        const child = join(path, name),
          key = rel ? rel + "/" + name : name;
        const s = fs.lstatSync(child, { bigint: true });
        if (s.isDirectory() && !s.isSymbolicLink()) {
          need(
            [...allowed].some((p) => p.startsWith(key + "/")),
            "invalid_request",
          );
          const d = directory(t, child);
          authority(d, true);
          t.artifactDirectories.add(child);
          walk(child, key);
        } else need(allowed.delete(key), "invalid_request");
      }
    }
    walk(r.artifact.root);
    need(allowed.size === 0, "invalid_request");
    for (const path of t.artifactDirectories) {
      const d = directory(t, path);
      need(!ids.has(String(d.s.dev) + ":" + String(d.s.ino)), "path_denied");
    }
    if (t.kind === "branchRestore") {
      verifySource(t);
      initializeBranchRestore(t);
      return;
    }
    if (t.kind === "commit") {
      verifySource(t);
      initializeCommit(t);
      return;
    }
    t.proposal = artifactRead(t, m.proposal);
    t.next = parseIndex(t.proposal, r.target.objectFormat, true);
    const indexPath = join(t.git.path, "index");
    if (r.target.indexExists) {
      need(declared.has(indexPath), "invalid_request");
      const fd = t.sourceFDs.get(indexPath);
      meta(fd, stat(fd), true);
      t.original = observe(t, fd, L.indexBytes);
      t.original.meta = meta(fd, stat(fd), true);
      need(t.original.digest === r.target.indexDigest, "metadata_changed");
      // Prove write access without creating or truncating the original.
      const probe = named(t, indexPath, (readFlags & ~c.O_RDONLY) | c.O_RDWR);
      try {
        need(
          signature(stat(probe)) === t.original.signature &&
            (stat(probe).mode & 0o200n) !== 0n,
          "path_denied",
        );
      } finally {
        dispose(t, probe);
      }
    } else {
      need(
        r.target.headOid === null && m.source.missing.includes(indexPath),
        "invalid_request",
      );
      missing(t, indexPath);
    }
    t.old = t.original
      ? parseIndex(t.original.bytes, r.target.objectFormat)
      : new Map();
    compareEntries(t.old, t.next, r.target.paths);
    verifySource(t);
    writeDirectory(t, t.git.path);
    writeDirectory(t, t.common.path);
    writeDirectory(t, join(t.common.path, "objects"));
    t.backup = gitIndexBackupId(r.runtimeEpoch, r.operationId);
    missing(t, join(t.git.path, t.backup), "backup_conflict");
    t.lockBytes = Buffer.from(t.nonce);
    t.lock = createFile(t, t.git, "index.lock", "lock_conflict");
    delta(t, join(t.git.path, "index.lock"), true);
    writeBytes(t, t.lock, t.lockBytes);
    fs.fsyncSync(t.git.fd);
    verifySource(t);
    t.stage = createFile(t, t.git, t.backup, "backup_conflict");
    delta(t, join(t.git.path, t.backup), true);
    writeBytes(
      t,
      t.stage,
      t.proposal,
      t.original ? Number(t.original.s.mode & 0o777n) : 0o600,
    );
    if (t.original) preserveMetadata(t, t.stage, t.original);
    fs.fsyncSync(t.git.fd);
    publishObjects(t);
    gate(t);
    t.fenced = true;
    try {
      verifyPrepared(t);
    } finally {
      t.fenced = false;
    }
  }
  function admit() {
    need(!stopped && !entered, "invalid_request");
  }
  async function prepare(request, kind = "index") {
    let t,
      response,
      acquired = false;
    try {
      admit();
      need(!active, "invalid_request");
      entered = true;
      acquired = true;
      (kind === "branchRestore"
        ? validateGitBranchRestoreKernelRequest
        : kind === "commit"
          ? validateGitCommitKernelRequest
          : validateGitIndexKernelRequest)(request);
      // Freeze validated data before invoking any untrusted host callback.
      request = JSON.parse(JSON.stringify(request));
      t = {
        request,
        kind,
        deadline: performance.now() + timeoutMs,
        nonce: randomBytes(32).toString("hex"),
        fds: new Set(),
        dirs: new Map(),
        artifacts: new Map(),
        artifactListings: new Map(),
        sourceFDs: new Map(),
        verifiedSources: new Set(),
        deltas: new Map(),
        objects: new Map(),
        objectListings: new Map(),
      };
      initialize(t);
      t.token = randomBytes(32).toString("hex");
      active = t;
      t.timer = setTimeout(
        () => {
          if (active !== t || entered) return;
          active = null;
          const response = result(new Failure("deadline"), kind);
          try {
            closeTask(t);
          } catch {
            response.reason = "io_failed";
          }
          last = {
            token: t.token,
            kind: t.kind,
            response: globalThis.structuredClone(response),
          };
        },
        Math.max(1, t.deadline - performance.now()),
      );
      t.timer.unref();
      response = { status: "prepared", token: t.token };
    } catch (e) {
      response = result(e, kind);
    } finally {
      if (t && t !== active) {
        try {
          closeTask(t);
        } catch (e) {
          response = result(e, kind);
        }
      }
      if (acquired) entered = false;
    }
    return (
      kind === "branchRestore"
        ? validateGitBranchRestoreKernelResult
        : kind === "commit"
          ? validateGitCommitKernelResult
          : validateGitIndexKernelResult
    )(response);
  }
  async function finish(request, publish, kind = "index") {
    let t,
      response,
      acquired = false;
    try {
      admit();
      (kind === "branchRestore"
        ? validateGitBranchRestoreKernelTokenRequest
        : kind === "commit"
          ? validateGitCommitKernelTokenRequest
          : validateGitIndexKernelTokenRequest)(request);
      if (!active || active.token !== request.token || active.kind !== kind) {
        if (last?.token === request.token && last.kind === kind)
          return globalThis.structuredClone(last.response);
        fail("invalid_request");
      }
      entered = true;
      acquired = true;
      t = active;
      active = null;
      clearTimeout(t.timer);
      if (kind === "branchRestore") {
        response = finishBranchRestore(t, publish);
      } else if (kind === "commit") {
        response = finishCommit(t, publish);
      } else {
        verifyPrepared(t);
        gate(t);
        if (publish) {
          rename(
            t,
            t.git,
            t.backup,
            "index",
            t.original ? 2 : 4,
            "path_changed",
          );
          t.published = true;
          delta(t, join(t.git.path, "index"), true);
          if (!t.original) delta(t, join(t.git.path, t.backup), false);
          fs.fsyncSync(t.stage.fd);
          verifyPrepared(t, true);
          gate(t);
          t.fenced = true;
          verifyPrepared(t, true);
          removeOwned(t, t.git, "index.lock", t.lock, t.lockBytes);
          verifySource(t, true);
          verifyObjects(t);
          verifyArtifact(t);
          response = {
            status: "applied",
            indexDigest: t.request.target.nextIndexDigest,
            backupId: t.original ? t.backup : null,
          };
        } else {
          gate(t);
          t.fenced = true;
          verifyPrepared(t);
          removeOwned(t, t.git, t.backup, t.stage, t.proposal);
          removeOwned(t, t.git, "index.lock", t.lock, t.lockBytes);
          verifySource(t);
          verifyObjects(t);
          verifyArtifact(t);
          response = { status: "aborted" };
        }
      }
    } catch (e) {
      response = result(e, kind);
    } finally {
      if (t) {
        try {
          closeTask(t);
        } catch (e) {
          response = result(e, kind);
        }
        last = {
          token: t.token,
          kind: t.kind,
          response: globalThis.structuredClone(response),
        };
      }
      if (acquired) entered = false;
    }
    return (
      kind === "branchRestore"
        ? validateGitBranchRestoreKernelResult
        : kind === "commit"
          ? validateGitCommitKernelResult
          : validateGitIndexKernelResult
    )(response);
  }
  async function close() {
    // Reentry from check must not close descriptors while a syscall is active.
    need(!entered, "invalid_request");
    if (stopped) return;
    stopped = true;
    const t = active;
    active = null;
    try {
      closeTask(t);
    } finally {
      library.close();
    }
    if (t)
      last = {
        token: t.token,
        kind: t.kind,
        response: result(new Failure("invalid_request"), t.kind),
      };
  }
  const index = Object.freeze({
    prepare,
    publish: (r) => finish(r, true),
    abort: (r) => finish(r, false),
    close,
  });
  const commit = Object.freeze({
    prepare: (r) => prepare(r, "commit"),
    publish: (r) => finish(r, true, "commit"),
    abort: (r) => finish(r, false, "commit"),
    close,
  });
  const branchRestore = Object.freeze({
    prepare: (r) => prepare(r, "branchRestore"),
    publish: (r) => finish(r, true, "branchRestore"),
    abort: (r) => finish(r, false, "branchRestore"),
    close,
  });
  return Object.freeze({ index, commit, branchRestore, close });
}
