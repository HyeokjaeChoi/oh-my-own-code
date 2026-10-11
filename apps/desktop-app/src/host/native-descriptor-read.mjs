// Private physical file reader. No Native tool, policy, task or settlement grant.
// Instruction discovery is not implemented here. No Native tool activation.
import * as fs from "node:fs";
import { join, isAbsolute, normalize } from "node:path";
import { types } from "node:util";
import { openDarwinDescriptorFFI } from "./darwin-descriptor-ffi.mjs";
import { decodeDarwinDirectoryEntry } from "./darwin-directory-entry.mjs";
import {
  isWorkspaceRootGuard,
  assertWorkspaceRootGuard,
  invalidateWorkspaceRootGuard,
} from "./workspace-root-authority.mjs";
import {
  validWorkspaceFilePath,
  validWorkspaceFileRoot,
} from "../renderer/shared/workspace-file/index.mjs";

const fail = (reason = "native_permission_file_unverified") => {
  throw new Error(reason);
};
const need = (condition, reason) => {
  if (!condition) fail(reason);
};
function capture(input, required, optional = []) {
  need(
    input && typeof input === "object" && !types.isProxy(input),
    "invalid_request",
  );
  need(Object.getPrototypeOf(input) === Object.prototype, "invalid_request");
  const copy = {};
  for (const key of Reflect.ownKeys(input)) {
    need(
      typeof key === "string" && [...required, ...optional].includes(key),
      "invalid_request",
    );
    const field = Object.getOwnPropertyDescriptor(input, key);
    need(field.enumerable && Object.hasOwn(field, "value"), "invalid_request");
    copy[key] = field.value;
  }
  need(
    required.every((key) => Object.hasOwn(copy, key)),
    "invalid_request",
  );
  return copy;
}
const directory = (value) => value.isDirectory() && !value.isSymbolicLink();
const same = (a, b) => a.dev === b.dev && a.ino === b.ino;
const sameFile = (a, b) =>
  same(a, b) &&
  ["size", "mtimeNs", "ctimeNs", "mode", "nlink", "uid", "gid"].every(
    (key) => a[key] === b[key],
  );
const sameDirectory = (a, b) =>
  same(a, b) && ["mode", "uid", "gid"].every((key) => a[key] === b[key]);
const synchronous = (value) =>
  typeof value === "function" &&
  !types.isProxy(value) &&
  !types.isAsyncFunction(value) &&
  !types.isGeneratorFunction(value);
const MAX_CHUNK = 20 * 1024 * 1024;
const pathKinds = new WeakMap();
const pathFailures = new WeakMap();
function openFailure(code) {
  const kind =
    code === 2 ? "missing" : code === 13 || code === 1 ? "denied" : undefined;
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
// Classification is produced only after an actual descriptor observation and
// cleanup/final authority checks, never from caller error tags or properties.
export function nativeDescriptorPathKind(error) {
  return pathKinds.get(error);
}
// Only this invocation's failed descriptor open can publish a reason, after
// temporary cleanup and final root/authority checks. Error fields are not proof.
export function nativeDescriptorFailureKind(error) {
  return pathFailures.get(error);
}

export async function createNativeDescriptorReadKernel(workspace, options) {
  const source = capture(workspace, ["id", "path"]);
  const { checkRoot, check } = capture(options, ["checkRoot", "check"]);
  need(
    typeof source.id === "string" &&
      /^[A-Za-z0-9_.:-]{1,128}$/.test(source.id) &&
      validWorkspaceFileRoot(source.path) &&
      isAbsolute(source.path) &&
      normalize(source.path) === source.path,
    "invalid_request",
  );
  need(
    isWorkspaceRootGuard(checkRoot) && synchronous(check),
    "invalid_request",
  );
  // The loader checks the exact runtime before loading libc or opening any file.
  const { library, ptr, toArrayBuffer } = await openDarwinDescriptorFFI({
    directory: true,
  });
  let root,
    closed = false,
    entered = false,
    cleanupFailed = false,
    libraryClosed = false;
  const identities = new WeakMap();
  const flags = { ...fs.constants, O_CLOEXEC: 0x1000000 };
  let native, errno, clearErrno;
  function authority() {
    need(!closed && !cleanupFailed);
    let result;
    try {
      result = check();
    } catch (error) {
      // A reused earlier IO error is now an authority failure, including at
      // the final post-close check. It cannot carry old path observations.
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
    need(root?.fd !== undefined);
    const held = fs.fstatSync(root.fd, { bigint: true });
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
        const named = fs.lstatSync(entry.path, { bigint: true });
        need(
          directory(named) &&
            named.dev === root.stat.dev &&
            sameDirectory(entry.stat, named),
        );
        if (entry.fd !== undefined) {
          const held = fs.fstatSync(entry.fd, { bigint: true });
          need(directory(held) && sameDirectory(entry.stat, held));
        }
        need(fs.realpathSync(entry.path) === entry.path);
      }
    } catch (error) {
      // An observed root/ancestor identity failure cannot be undone by putting
      // the old names back. Revoke the actual shared owner, not just this call.
      invalidateWorkspaceRootGuard(checkRoot);
      throw error;
    }
  }
  function closeEntries(entries) {
    let failed = false;
    for (const entry of entries.toReversed()) {
      const fd = entry.fd;
      const stream = entry.stream;
      entry.fd = undefined;
      entry.stream = undefined;
      if (fd === undefined) continue;
      try {
        if (stream) {
          if (native.closedir(stream) !== 0) failed = true;
        } else fs.closeSync(fd);
      } catch {
        failed = true;
      }
    }
    if (failed) {
      cleanupFailed = true;
      fail("native_permission_file_cleanup_unverified");
    }
  }
  function closeLibrary() {
    if (libraryClosed || entered) return;
    libraryClosed = true;
    try {
      library.close();
    } catch {
      cleanupFailed = true;
    }
  }
  function endOperation() {
    entered = false;
    if (closed) {
      closeLibrary();
      need(!cleanupFailed, "native_permission_file_cleanup_unverified");
    }
  }
  function close() {
    if (closed) {
      closeLibrary();
      need(!cleanupFailed, "native_permission_file_cleanup_unverified");
      return;
    }
    closed = true;
    try {
      closeEntries(root ? [root] : []);
    } finally {
      // A reentrant close may revoke while a directory stream still needs
      // closedir. Keep libc loaded until the original operation's finally.
      closeLibrary();
    }
    need(!cleanupFailed, "native_permission_file_cleanup_unverified");
  }
  try {
    need(
      ["O_NOFOLLOW", "O_NONBLOCK", "O_DIRECTORY"].every(
        (key) => Number.isInteger(flags[key]) && flags[key] !== 0,
      ),
      "unsupported_runtime",
    );
    native = library.symbols;
    const cell = new Int32Array(toArrayBuffer(native.__error(), 0, 4));
    errno = () => cell[0];
    clearErrno = () => {
      cell[0] = 0;
    };
    authority();
    const before = fs.lstatSync(source.path, { bigint: true });
    need(directory(before) && fs.realpathSync(source.path) === source.path);
    const fd = fs.openSync(
      source.path,
      flags.O_RDONLY |
        flags.O_NOFOLLOW |
        flags.O_NONBLOCK |
        flags.O_DIRECTORY |
        flags.O_CLOEXEC,
    );
    root = { fd, path: source.path, stat: before };
    stable([root]);
  } catch (error) {
    try {
      close();
    } catch {
      fail("native_permission_file_cleanup_unverified");
    }
    throw error;
  }

  function read(relativePath, page = {}) {
    need(!entered && !closed && !cleanupFailed);
    need(
      relativePath === "" || validWorkspaceFilePath(relativePath),
      "invalid_request",
    );
    const request = capture(page, [], ["offset", "length", "identity"]);
    const offset = Object.hasOwn(request, "offset") ? request.offset : 0;
    const length = Object.hasOwn(request, "length")
      ? request.length
      : 256 * 1024;
    need(
      Number.isSafeInteger(offset) &&
        offset >= 0 &&
        Number.isSafeInteger(length) &&
        length >= 1 &&
        length <= MAX_CHUNK,
      "invalid_request",
    );
    let prior;
    if (Object.hasOwn(request, "identity")) {
      prior = identities.get(request.identity);
      need(prior && prior.path === relativePath, "invalid_request");
    }
    entered = true;
    const entries = [],
      chain = [root];
    let bytes, original, leafPath, error, observedKind, observedFailure;
    try {
      stable(chain);
      let parent = root;
      const parts = relativePath === "" ? ["."] : relativePath.split("/");
      for (let index = 0; index < parts.length; index++) {
        const leaf = index === parts.length - 1;
        stable(chain);
        const name = Buffer.from(parts[index] + "\0");
        const fd = native.openat(
          parent.fd,
          ptr(name),
          flags.O_RDONLY |
            flags.O_NOFOLLOW |
            flags.O_NONBLOCK |
            flags.O_CLOEXEC |
            (leaf ? 0 : flags.O_DIRECTORY),
          0,
          0,
          0,
          0,
          0,
          0,
        );
        if (fd < 0) {
          observedFailure = openFailure(errno());
          throw observedFailure.error;
        }
        const entry = { fd, path: join(parent.path, parts[index]) };
        entries.push(entry);
        entry.stat = fs.fstatSync(fd, { bigint: true });
        need(entry.stat.dev === root.stat.dev);
        if (!leaf) {
          need(directory(entry.stat));
          chain.push(entry);
          parent = entry;
          continue;
        }
        original = entry.stat;
        leafPath = entry.path;
        if (directory(original)) {
          observedKind = "directory";
          break;
        }
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
        const named = fs.lstatSync(leafPath, { bigint: true });
        need(
          sameFile(original, named) && fs.realpathSync(leafPath) === leafPath,
        );
        bytes = Buffer.alloc(
          Math.min(length, Math.max(Number(original.size) - offset, 0)),
        );
        let count = 0;
        while (count < bytes.length) {
          stable(chain);
          need(sameFile(original, fs.fstatSync(fd, { bigint: true })));
          const got = fs.readSync(
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
        need(sameFile(original, fs.fstatSync(fd, { bigint: true })));
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
          error === observedFailure?.error &&
          observedFailure.kind &&
          !cleanupFailed
        ) {
          stable(chain);
          pathFailures.set(error, observedFailure.kind);
        }
        throw error;
      }
      // Every temporary FD is closed. Reentrant authority callbacks run before
      // the final callback-free root/chain/leaf checks and byte disclosure.
      stable(chain);
      need(
        sameFile(original, fs.lstatSync(leafPath, { bigint: true })) &&
          fs.realpathSync(leafPath) === leafPath,
      );
      if (observedKind) wrongKind(observedKind);
      const identity = request.identity ?? Object.freeze({});
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
      relativePath === "" || validWorkspaceFilePath(relativePath),
      "invalid_request",
    );
    entered = true;
    const entries = [],
      chain = [root],
      rows = [],
      names = new Set();
    let target,
      observedKind,
      observedFailure,
      error,
      recordCount = 0,
      nameBytes = 0;
    try {
      stable(chain);
      let parent = root;
      const parts = relativePath === "" ? ["."] : relativePath.split("/");
      for (let index = 0; index < parts.length; index++) {
        const part = parts[index],
          leaf = index === parts.length - 1;
        stable(chain);
        const name = Buffer.from(part + "\0");
        const fd = native.openat(
          parent.fd,
          ptr(name),
          flags.O_RDONLY |
            flags.O_NOFOLLOW |
            flags.O_NONBLOCK |
            flags.O_CLOEXEC |
            (leaf ? 0 : flags.O_DIRECTORY),
          0,
          0,
          0,
          0,
          0,
          0,
        );
        if (fd < 0) {
          observedFailure = openFailure(errno());
          throw observedFailure.error;
        }
        const entry = {
          fd,
          path: part === "." ? parent.path : join(parent.path, part),
        };
        entries.push(entry);
        entry.stat = fs.fstatSync(fd, { bigint: true });
        need(entry.stat.dev === root.stat.dev);
        if (leaf && entry.stat.isFile()) {
          observedKind = "file";
          parent = entry;
          break;
        }
        need(directory(entry.stat), "unsupported_file");
        chain.push(entry);
        parent = entry;
      }
      target = parent;
      stable(chain);
      need(sameFile(target.stat, fs.fstatSync(target.fd, { bigint: true })));
      if (!observedKind) {
        const stream = native.fdopendir(target.fd);
        if (!stream) {
          const code = errno();
          fail(
            code === 13 || code === 1
              ? "path_denied"
              : "native_permission_file_unverified",
          );
        }
        // Ownership transfers only on success. Cleanup must now use closedir.
        target.stream = stream;
        while (true) {
          stable(chain);
          need(
            sameFile(target.stat, fs.fstatSync(target.fd, { bigint: true })),
          );
          clearErrno();
          const next = native.readdir(stream);
          if (!next) {
            const code = errno();
            need(code === 0);
            break;
          }
          need(++recordCount <= 4098, "directory_too_large");
          const header = new Uint8Array(toArrayBuffer(next, 0, 22));
          const size = header[16] + header[17] * 256;
          need(
            size >= 24 && size <= 1048 && size % 4 === 0,
            "unsupported_directory_entry",
          );
          const record = Buffer.from(
            new Uint8Array(toArrayBuffer(next, 0, size)),
          );
          let row;
          try {
            row = decodeDarwinDirectoryEntry(record);
          } finally {
            record.fill(0);
          }
          if (!row) continue;
          need(!names.has(row.name));
          names.add(row.name);
          nameBytes += Buffer.byteLength(row.name, "utf8");
          need(
            rows.length < 4096 && nameBytes <= 1024 * 1024,
            "directory_too_large",
          );
          rows.push(row);
        }
        stable(chain);
        need(sameFile(target.stat, fs.fstatSync(target.fd, { bigint: true })));
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
          error === observedFailure?.error &&
          observedFailure.kind &&
          !cleanupFailed
        ) {
          stable(chain);
          pathFailures.set(error, observedFailure.kind);
        }
        throw error;
      }
      stable(chain);
      need(sameFile(target.stat, fs.lstatSync(target.path, { bigint: true })));
      if (observedKind) wrongKind(observedKind);
      return Object.freeze(rows);
    } finally {
      endOperation();
    }
  }
  return Object.freeze({ read, list, close });
}
