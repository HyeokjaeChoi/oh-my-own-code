// Existing-file observation only. Importing this module does no IO.
import { constants } from "node:fs";
import * as actualIO from "node:fs/promises";
import { isAbsolute, normalize, join } from "node:path";
import { fail } from "../workbench-errors.mjs";
import {
  isWorkspaceRootGuard,
  assertWorkspaceRootGuard,
} from "./workspace-root-authority.mjs";
import {
  WORKSPACE_FILE_LIMITS,
  validWorkspaceFileRoot,
  workspaceFilePathReason,
  workspaceFileTargetPath,
  workspaceFileContentFits,
} from "../renderer/shared/workspace-file/index.mjs";
import {
  configurationFileVersion,
  configurationWorkspaceFileDirectoryVersion,
} from "./configuration-file-observation.mjs";

const identity = (a, b) => a.dev === b.dev && a.ino === b.ino;
const regular = (s) => s.isFile() && !s.isSymbolicLink() && s.nlink === 1n;
const sameFile = (a, b) =>
  identity(a, b) &&
  a.size === b.size &&
  a.mtimeNs === b.mtimeNs &&
  a.ctimeNs === b.ctimeNs;
const absent = (e) => !e?.appCode && ["ENOENT", "ENOTDIR"].includes(e?.code);
const data = (v) =>
  v &&
  Object.getPrototypeOf(v) === Object.prototype &&
  Reflect.ownKeys(v).every(
    (k) =>
      typeof k === "string" &&
      Object.hasOwn(Object.getOwnPropertyDescriptor(v, k), "value"),
  );
class ObservationFailure extends Error {}
const refuse = (reason) => {
  throw new ObservationFailure(reason);
};

export async function readWorkspaceFile(workspace, relativePath, options = {}) {
  if (
    !data(options) ||
    Reflect.ownKeys(options).some(
      (k) => !["check", "io", "checkRoot"].includes(k),
    )
  )
    fail("INVALID_REQUEST");
  const { check = () => {} } = options;
  const observed = await observeWorkspaceFileBytes(
    workspace,
    relativePath,
    options,
  );
  check();
  if (observed.status !== "available") return observed;
  const { bytes, ...base } = observed;
  let content;
  try {
    content = new globalThis.TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
  } catch {
    return textRefusal(base);
  }
  if (!workspaceFileContentFits(content)) return textRefusal(base);
  return { ...base, content };
}

function textRefusal(observed) {
  const {
    version: _version,
    directoryVersion: _directoryVersion,
    ...base
  } = observed;
  return { ...base, status: "unsupported", reason: "unsupported_content" };
}

// Private host primitive. No path is reopened after the checked capture. A caller
// may choose a smaller content bound from <=16 held prefix bytes before bulk IO.
export async function observeWorkspaceFileBytes(
  workspace,
  relativePath,
  options = {},
) {
  if (
    !data(workspace) ||
    !data(options) ||
    Reflect.ownKeys(options).some(
      (k) => !["check", "io", "maxBytes", "byteLimit", "checkRoot"].includes(k),
    )
  )
    fail("INVALID_REQUEST");
  const { id, path: root } = workspace;
  const {
    check = () => {},
    io = actualIO,
    maxBytes = WORKSPACE_FILE_LIMITS.bytes,
    byteLimit,
    checkRoot,
  } = options;
  const pathReason = workspaceFilePathReason(relativePath);
  if (
    typeof id !== "string" ||
    !/^[A-Za-z0-9_.:-]{1,128}$/.test(id) ||
    !validWorkspaceFileRoot(root) ||
    !isAbsolute(root) ||
    normalize(root) !== root ||
    pathReason === "invalid_path" ||
    typeof check !== "function" ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 0 ||
    maxBytes > 8 * 1024 * 1024 ||
    (byteLimit !== undefined && typeof byteLimit !== "function") ||
    (Object.hasOwn(options, "checkRoot") && !isWorkspaceRootGuard(checkRoot)) ||
    !io ||
    !["lstat", "realpath", "open"].every((k) => typeof io[k] === "function")
  )
    fail("INVALID_REQUEST");
  const base = {
    workspaceId: id,
    workspacePath: root,
    path: relativePath,
    targetPath: workspaceFileTargetPath(root, relativePath),
  };
  const result = (status, reason) => ({ ...base, status, reason });
  check();
  if (pathReason === "protected_source")
    return result("unsupported", "protected_source");
  const chain = [],
    handles = [];
  let leaf, response, failure;
  const flags =
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
  function rootGuard() {
    if (!checkRoot || !chain.length) return;
    const rootStat = chain[0].stat;
    assertWorkspaceRootGuard(
      checkRoot,
      Object.freeze({
        workspaceId: id,
        workspacePath: root,
        dev: String(rootStat.dev),
        ino: String(rootStat.ino),
      }),
    );
  }
  async function checked(action) {
    check();
    rootGuard();
    let value;
    try {
      value = await action();
    } catch (e) {
      check();
      throw e;
    }
    check();
    rootGuard();
    return value;
  }
  async function stable() {
    for (const entry of [...chain, ...(leaf ? [leaf] : [])]) {
      try {
        const held = await checked(() => entry.handle.stat({ bigint: true }));
        const named = await checked(() =>
          io.lstat(entry.path, { bigint: true }),
        );
        const directory = entry !== leaf;
        if (
          !(directory
            ? held.isDirectory() &&
              named.isDirectory() &&
              identity(entry.stat, held) &&
              identity(entry.stat, named)
            : regular(held) &&
              regular(named) &&
              sameFile(entry.stat, held) &&
              sameFile(entry.stat, named)) ||
          named.isSymbolicLink() ||
          named.dev !== chain[0].stat.dev ||
          held.dev !== chain[0].stat.dev ||
          (await checked(() => io.realpath(entry.path))) !== entry.path
        )
          refuse("file_changed");
      } catch (e) {
        if (absent(e) || e?.code === "ELOOP") refuse("file_changed");
        throw e;
      }
    }
  }
  async function guarded(action) {
    await stable();
    let value, error;
    try {
      value = await checked(action);
    } catch (e) {
      error = e;
    }
    await stable();
    if (error) throw error;
    return value;
  }
  async function acquire(path, directory) {
    let named;
    try {
      named = await guarded(() => io.lstat(path, { bigint: true }));
    } catch (e) {
      if (absent(e)) refuse(directory ? "path_missing" : "missing_file");
      throw e;
    }
    if (
      !(directory
        ? named.isDirectory() && !named.isSymbolicLink()
        : regular(named)) ||
      (chain.length && named.dev !== chain[0].stat.dev) ||
      (await guarded(() => io.realpath(path))) !== path
    )
      refuse("path_denied");
    let handle;
    try {
      // Register before post-await checks, so cancellation cannot leak this FD.
      await guarded(async () => {
        handle = await io.open(
          path,
          flags | (directory ? constants.O_DIRECTORY : 0),
        );
        handles.push(handle);
      });
    } catch (e) {
      if (absent(e) || e?.code === "ELOOP") refuse("file_changed");
      throw e;
    }
    const held = await guarded(() => handle.stat({ bigint: true }));
    if (
      !(directory
        ? held.isDirectory() && identity(named, held)
        : regular(held) && sameFile(named, held)) ||
      held.dev !== named.dev
    )
      refuse("file_changed");
    const entry = { path, stat: held, handle };
    if (directory) chain.push(entry);
    else leaf = entry;
    await stable();
  }
  async function run() {
    if (
      ![
        constants.O_NOFOLLOW,
        constants.O_NONBLOCK,
        constants.O_DIRECTORY,
      ].every((f) => Number.isInteger(f) && f !== 0)
    )
      refuse("path_denied");
    await acquire(root, true);
    let parent = root;
    for (const component of relativePath.split("/").slice(0, -1)) {
      parent = join(parent, component);
      await acquire(parent, true);
    }
    await acquire(base.targetPath, false);
    if (leaf.stat.size < 0n) refuse("file_changed");
    if (leaf.stat.size > BigInt(maxBytes))
      return result("unsupported", "too_large");
    let limit = maxBytes;
    if (byteLimit) {
      const prefix = Buffer.alloc(Math.min(16, Number(leaf.stat.size)));
      let count = 0;
      while (count < prefix.length) {
        const { bytesRead } = await guarded(() =>
          leaf.handle.read(prefix, count, prefix.length - count, count),
        );
        if (
          !Number.isInteger(bytesRead) ||
          bytesRead <= 0 ||
          bytesRead > prefix.length - count
        )
          refuse("file_changed");
        count += bytesRead;
      }
      check();
      limit = byteLimit(prefix);
      check();
      if (!Number.isSafeInteger(limit) || limit < 0 || limit > maxBytes)
        fail("INVALID_REQUEST");
      if (leaf.stat.size > BigInt(limit))
        return result("unsupported", "too_large");
    }
    const buffer = Buffer.alloc(Number(leaf.stat.size) + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await guarded(() =>
        leaf.handle.read(buffer, length, buffer.length - length, length),
      );
      if (
        !Number.isInteger(bytesRead) ||
        bytesRead < 0 ||
        bytesRead > buffer.length - length
      )
        refuse("file_changed");
      if (!bytesRead) break;
      length += bytesRead;
    }
    await stable();
    if (length > limit) return result("unsupported", "too_large");
    if (BigInt(length) !== leaf.stat.size) refuse("file_changed");
    const bytes = buffer.subarray(0, length);
    const identities = chain.map((e) => [
      e.path,
      String(e.stat.dev),
      String(e.stat.ino),
    ]);
    return {
      ...base,
      status: "available",
      bytes,
      directoryVersion: configurationWorkspaceFileDirectoryVersion(
        base,
        identities,
      ),
      version: configurationFileVersion(
        { ...base, kind: "file" },
        chain[0].stat,
        leaf.stat,
        bytes,
        identities,
      ),
    };
  }
  try {
    response = await run();
  } catch (e) {
    failure = e;
  } finally {
    // Close all handles even after a failed authority check or another close.
    for (const handle of handles.toReversed()) {
      try {
        await handle.close();
        check();
        // The callback may revoke the root. Recheck after it, including after
        // the final close, before disclosing the already-observed bytes.
        rootGuard();
      } catch (e) {
        if (!failure || (!failure?.appCode && e?.appCode)) failure = e;
      }
    }
  }
  if (failure?.appCode) throw failure;
  if (failure)
    return result(
      "unavailable",
      failure instanceof ObservationFailure ? failure.message : "path_denied",
    );
  return response;
}
