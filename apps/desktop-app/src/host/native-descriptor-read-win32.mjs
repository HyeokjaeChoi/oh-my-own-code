// Windows implementation of the private physical file reader (same contract as
// the darwin openat kernel in native-descriptor-read.mjs; no Native tool, policy,
// task or settlement grant).
//
// Windows has no openat/O_NOFOLLOW. The darwin kernel already re-proves every
// held descriptor against its NAME (lstat + realpath + dev/ino/mode comparison)
// before and after IO; that name-based proof is the whole defence here:
//   * every directory component is lstat'ed: a symlink or junction (reparse
//     point reported by libuv as a symbolic link) is refused, as is any
//     component whose realpath differs from the walked path;
//   * the leaf is lstat'ed BEFORE open (a symlink is never opened), opened
//     read-only, fstat'ed, and compared field by field with the lstat before,
//     during and after every read;
//   * only regular single-link files are read; directories are never opened
//     (their identity is the lstat identity, rechecked around every step).
// The residual difference to darwin is the window between lstat and open of a
// leaf; a swap inside it is detected by the fstat/lstat identity comparison
// and no bytes are disclosed unless all checks hold after the read.
import * as nodeFs from "node:fs";
import { join, isAbsolute, normalize } from "node:path";
import { types } from "node:util";
import {
  assertWorkspaceRootGuard,
  invalidateWorkspaceRootGuard,
} from "./workspace-root-authority.mjs";
import {
  validWorkspaceFilePath,
  validWorkspaceFileRoot,
} from "../renderer/shared/workspace-file/index.mjs";
import { isWindowsShortAlias } from "../platform-paths.mjs";

const fail = (reason = "native_permission_file_unverified") => {
  throw new Error(reason);
};
const need = (condition, reason) => {
  if (!condition) fail(reason);
};
const directory = (value) => value.isDirectory() && !value.isSymbolicLink();
const same = (a, b) => a.dev === b.dev && a.ino === b.ino;
const sameFile = (a, b) =>
  same(a, b) &&
  ["size", "mtimeNs", "ctimeNs", "mode", "nlink", "uid", "gid"].every(
    (key) => a[key] === b[key],
  );
const sameDirectory = (a, b) =>
  same(a, b) && ["mode", "uid", "gid"].every((key) => a[key] === b[key]);
const MAX_CHUNK = 20 * 1024 * 1024;
const pathKinds = new WeakMap();
const pathFailures = new WeakMap();
export const win32PathKind = (error) => pathKinds.get(error);
export const win32FailureKind = (error) => pathFailures.get(error);

function openFailure(error) {
  const kind =
    error?.code === "ENOENT" || error?.code === "ENOTDIR"
      ? "missing"
      : error?.code === "EACCES" || error?.code === "EPERM"
        ? "denied"
        : undefined;
  return {
    kind,
    error: new Error(
      kind === "missing"
        ? "path_missing"
        : kind === "denied"
          ? "path_denied"
          : "native_permission_file_unverified",
    ),
  };
}
function wrongKind(kind) {
  const error = new Error("native_permission_path_kind");
  pathKinds.set(error, kind);
  throw error;
}
// A component NTFS would resolve through an 8.3 alias is not a plain literal.
const plainWindowsPath = (relativePath) =>
  relativePath === "" ||
  relativePath.split("/").every((part) => !isWindowsShortAlias(part));

// `io` is injectable for the platform-injected unit tests; production passes node:fs.
export function createWin32DescriptorReadKernel(
  workspace,
  { checkRoot, check },
  io = nodeFs,
) {
  const source = workspace;
  need(
    typeof source.id === "string" &&
      /^[A-Za-z0-9_.:-]{1,128}$/.test(source.id) &&
      validWorkspaceFileRoot(source.path) &&
      isAbsolute(source.path) &&
      normalize(source.path) === source.path,
    "invalid_request",
  );
  let root,
    closed = false,
    entered = false,
    cleanupFailed = false;
  const identities = new WeakMap();
  function authority() {
    need(!closed && !cleanupFailed);
    let result;
    try {
      result = check();
    } catch (error) {
      pathFailures.delete(error);
      pathKinds.delete(error);
      throw error;
    }
    if (types.isPromise(result)) {
      result.catch(() => {});
      fail("invalid_request");
    }
    need(
      result === null ||
        (typeof result !== "object" && typeof result !== "function"),
      "invalid_request",
    );
    need(!closed);
  }
  function rootGuard() {
    need(root !== undefined);
    const held = io.lstatSync(root.path, { bigint: true });
    need(directory(held) && sameDirectory(root.stat, held));
    assertWorkspaceRootGuard(checkRoot, {
      workspaceId: source.id,
      workspacePath: source.path,
      dev: String(held.dev),
      ino: String(held.ino),
    });
  }
  function stable(chain) {
    authority();
    try {
      rootGuard();
      for (const entry of chain) {
        const named = io.lstatSync(entry.path, { bigint: true });
        need(
          directory(named) &&
            named.dev === root.stat.dev &&
            sameDirectory(entry.stat, named),
        );
        need(io.realpathSync(entry.path) === entry.path);
      }
    } catch (error) {
      invalidateWorkspaceRootGuard(checkRoot);
      throw error;
    }
  }
  function closeEntries(entries) {
    let failed = false;
    for (const entry of entries.toReversed()) {
      const { fd, stream } = entry;
      entry.fd = undefined;
      entry.stream = undefined;
      try {
        if (stream) stream.closeSync();
        else if (fd !== undefined) io.closeSync(fd);
      } catch {
        failed = true;
      }
    }
    if (failed) {
      cleanupFailed = true;
      fail("native_permission_file_cleanup_unverified");
    }
  }
  function endOperation() {
    entered = false;
    if (closed)
      need(!cleanupFailed, "native_permission_file_cleanup_unverified");
  }
  function close() {
    if (closed) {
      need(!cleanupFailed, "native_permission_file_cleanup_unverified");
      return;
    }
    closed = true;
    need(!cleanupFailed, "native_permission_file_cleanup_unverified");
  }
  try {
    authority();
    const before = io.lstatSync(source.path, { bigint: true });
    need(directory(before) && io.realpathSync(source.path) === source.path);
    root = { path: source.path, stat: before };
    stable([root]);
  } catch (error) {
    close();
    throw error;
  }

  // Walk `parts` below the root. Directories are identified by lstat only; the
  // optional leaf is returned for the caller to open (file) or list (directory).
  function walk(parts, chain, entries, record) {
    let parent = root;
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index];
      const leaf = index === parts.length - 1;
      stable(chain);
      const path = part === "." ? parent.path : join(parent.path, part);
      let stat;
      try {
        stat = io.lstatSync(path, { bigint: true });
      } catch (cause) {
        record.failure = openFailure(cause);
        throw record.failure.error;
      }
      need(stat.dev === root.stat.dev);
      const entry = { path, stat };
      if (!leaf || directory(stat)) {
        need(directory(stat), "unsupported_file");
        chain.push(entry);
        parent = entry;
        if (leaf) record.target = entry;
        continue;
      }
      record.leaf = entry;
      record.target = entry;
      entries.push(entry);
    }
    return parent;
  }

  function read(relativePath, page = {}) {
    need(!entered && !closed && !cleanupFailed);
    need(
      relativePath === "" ||
        (validWorkspaceFilePath(relativePath) &&
          plainWindowsPath(relativePath)),
      "invalid_request",
    );
    need(
      page &&
        typeof page === "object" &&
        !types.isProxy(page) &&
        Object.getPrototypeOf(page) === Object.prototype,
      "invalid_request",
    );
    for (const key of Reflect.ownKeys(page)) {
      need(
        typeof key === "string" &&
          ["offset", "length", "identity"].includes(key),
        "invalid_request",
      );
      const field = Object.getOwnPropertyDescriptor(page, key);
      need(
        field.enumerable && Object.hasOwn(field, "value"),
        "invalid_request",
      );
    }
    const offset = Object.hasOwn(page, "offset") ? page.offset : 0;
    const length = Object.hasOwn(page, "length") ? page.length : 256 * 1024;
    need(
      Number.isSafeInteger(offset) &&
        offset >= 0 &&
        Number.isSafeInteger(length) &&
        length >= 1 &&
        length <= MAX_CHUNK,
      "invalid_request",
    );
    let prior;
    if (Object.hasOwn(page, "identity")) {
      prior = identities.get(page.identity);
      need(prior && prior.path === relativePath, "invalid_request");
    }
    entered = true;
    const entries = [],
      chain = [root],
      record = {};
    let bytes, original, leafPath, error, observedKind;
    try {
      stable(chain);
      const parts = relativePath === "" ? ["."] : relativePath.split("/");
      walk(parts, chain, [], record);
      if (record.target && !record.leaf) {
        // The leaf is a directory.
        observedKind = "directory";
        original = record.target.stat;
        leafPath = record.target.path;
      } else {
        const leaf = record.leaf;
        leafPath = leaf.path;
        const lstatBefore = leaf.stat;
        // A symlink leaf is never opened (no O_NOFOLLOW on Windows).
        need(!lstatBefore.isSymbolicLink(), "unsupported_file");
        need(
          lstatBefore.isFile() && lstatBefore.nlink === 1n,
          "unsupported_file",
        );
        let fd;
        try {
          fd = io.openSync(leafPath, io.constants.O_RDONLY);
        } catch (cause) {
          record.failure = openFailure(cause);
          throw record.failure.error;
        }
        const handle = { path: leafPath, fd };
        entries.push(handle);
        handle.stat = io.fstatSync(fd, { bigint: true });
        original = handle.stat;
        need(original.dev === root.stat.dev);
        need(
          original.isFile() &&
            !original.isSymbolicLink() &&
            original.nlink === 1n,
          "unsupported_file",
        );
        need(
          original.size >= 0n &&
            original.size <= BigInt(Number.MAX_SAFE_INTEGER),
          "unsupported_file",
        );
        need(!prior || sameFile(prior.stat, original));
        const named = io.lstatSync(leafPath, { bigint: true });
        need(
          sameFile(original, named) &&
            sameFile(original, lstatBefore) &&
            io.realpathSync(leafPath) === leafPath,
        );
        bytes = Buffer.alloc(
          Math.min(length, Math.max(Number(original.size) - offset, 0)),
        );
        let count = 0;
        while (count < bytes.length) {
          stable(chain);
          need(sameFile(original, io.fstatSync(fd, { bigint: true })));
          const got = io.readSync(
            fd,
            bytes,
            count,
            bytes.length - count,
            offset + count,
          );
          need(Number.isInteger(got) && got > 0 && got <= bytes.length - count);
          count += got;
        }
        stable(chain);
        need(sameFile(original, io.fstatSync(fd, { bigint: true })));
      }
    } catch (cause) {
      error = cause;
    }
    try {
      closeEntries(entries);
    } catch (cause) {
      error = cause;
    }
    try {
      if (error) {
        pathFailures.delete(error);
        if (
          error === record.failure?.error &&
          record.failure.kind &&
          !cleanupFailed
        ) {
          stable(chain);
          pathFailures.set(error, record.failure.kind);
        }
        throw error;
      }
      stable(chain);
      need(
        sameFile(original, io.lstatSync(leafPath, { bigint: true })) &&
          io.realpathSync(leafPath) === leafPath,
      );
      if (observedKind) wrongKind(observedKind);
      const identity = page.identity ?? Object.freeze({});
      if (!prior)
        identities.set(identity, { path: relativePath, stat: original });
      return Object.freeze({
        bytes,
        info: Object.freeze({ size: Number(original.size) }),
        identity,
      });
    } catch (cause) {
      bytes?.fill(0);
      throw cause;
    } finally {
      endOperation();
    }
  }

  function list(relativePath = "") {
    need(!entered && !closed && !cleanupFailed);
    need(
      relativePath === "" ||
        (validWorkspaceFilePath(relativePath) &&
          plainWindowsPath(relativePath)),
      "invalid_request",
    );
    entered = true;
    const entries = [],
      chain = [root],
      rows = [],
      names = new Set(),
      record = {};
    let target,
      observedKind,
      error,
      recordCount = 0,
      nameBytes = 0;
    try {
      stable(chain);
      const parts = relativePath === "" ? ["."] : relativePath.split("/");
      walk(parts, chain, [], record);
      if (record.leaf) {
        // The leaf is not a directory; only a regular file is a typed wrong kind.
        need(record.leaf.stat.isFile(), "unsupported_file");
        observedKind = "file";
        target = record.leaf;
      } else {
        target = record.target ?? chain.at(-1);
        stable(chain);
        need(
          sameDirectory(
            target.stat,
            io.lstatSync(target.path, { bigint: true }),
          ),
        );
        let stream;
        try {
          stream = io.opendirSync(target.path);
        } catch (cause) {
          const failure = openFailure(cause);
          fail(
            failure.kind === "denied"
              ? "path_denied"
              : "native_permission_file_unverified",
          );
        }
        entries.push({ stream });
        for (;;) {
          stable(chain);
          need(
            sameDirectory(
              target.stat,
              io.lstatSync(target.path, { bigint: true }),
            ),
          );
          const next = stream.readSync();
          if (next === null) break;
          need(++recordCount <= 4098, "directory_too_large");
          const name = next.name;
          need(
            !name.includes("/") &&
              !name.includes("\\") &&
              validWorkspaceFilePath(name),
            "unsupported_directory_entry",
          );
          need(!names.has(name));
          names.add(name);
          nameBytes += Buffer.byteLength(name, "utf8");
          need(
            rows.length < 4096 && nameBytes <= 1024 * 1024,
            "directory_too_large",
          );
          rows.push(
            Object.freeze({
              name,
              type: next.isSymbolicLink()
                ? "symlink"
                : next.isDirectory()
                  ? "directory"
                  : next.isFile()
                    ? "file"
                    : "other",
            }),
          );
        }
        stable(chain);
        need(
          sameDirectory(
            target.stat,
            io.lstatSync(target.path, { bigint: true }),
          ),
        );
      }
    } catch (cause) {
      error = cause;
    }
    try {
      closeEntries(entries);
    } catch (cause) {
      error = cause;
    }
    try {
      if (error) {
        pathFailures.delete(error);
        if (
          error === record.failure?.error &&
          record.failure.kind &&
          !cleanupFailed
        ) {
          stable(chain);
          pathFailures.set(error, record.failure.kind);
        }
        throw error;
      }
      stable(chain);
      if (observedKind) {
        need(
          sameFile(target.stat, io.lstatSync(target.path, { bigint: true })),
        );
        wrongKind(observedKind);
      }
      need(
        sameDirectory(target.stat, io.lstatSync(target.path, { bigint: true })),
      );
      return Object.freeze(rows);
    } finally {
      endOperation();
    }
  }
  return Object.freeze({ read, list, close });
}
