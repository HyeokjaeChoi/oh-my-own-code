import { configurationFileVersion } from "./configuration-file-observation.mjs";
import { constants } from "node:fs";
import * as actualIO from "node:fs/promises";
import { join } from "node:path";
import { fail } from "../workbench-contract.mjs";
import {
  CONFIGURATION_DRAFT_LIMITS,
  configurationFileContentFits,
} from "../renderer/shared/configuration-draft/validation.mjs";
import { metadataPath } from "./workbench-configuration.mjs";

const maxBytes = CONFIGURATION_DRAFT_LIMITS.bytes;
const openFlags =
  constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const sameIdentity = (a, b) => a.dev === b.dev && a.ino === b.ino;
const regularFile = (stat) =>
  stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1n;
const sameFile = (a, b) =>
  sameIdentity(a, b) &&
  a.size === b.size &&
  a.mtimeNs === b.mtimeNs &&
  a.ctimeNs === b.ctimeNs;

class ObservationFailure extends Error {
  constructor(reason) {
    super("Configuration file observation failed.");
    this.reason = reason;
  }
}
const changed = () => {
  throw new ObservationFailure("file_changed");
};
const denied = () => {
  throw new ObservationFailure("path_denied");
};

export async function readConfigurationFile(workspace, kind, options = {}) {
  // Keep the frozen { check, io } API, while rejecting malformed direct options.
  if (
    !options ||
    Object.getPrototypeOf(options) !== Object.prototype ||
    Reflect.ownKeys(options).some(
      (key) =>
        !["check", "io"].includes(key) ||
        !Object.hasOwn(Object.getOwnPropertyDescriptor(options, key), "value"),
    )
  )
    fail("INVALID_REQUEST");
  const { check = () => {}, io = actualIO } = options;
  // Use own data fields: direct malformed calls must not execute accessors.
  const id = workspace && Object.getOwnPropertyDescriptor(workspace, "id");
  const root = workspace && Object.getOwnPropertyDescriptor(workspace, "path");
  if (
    !workspace ||
    Object.getPrototypeOf(workspace) !== Object.prototype ||
    !id ||
    !Object.hasOwn(id, "value") ||
    typeof id.value !== "string" ||
    !/^[\w.:-]{1,256}$/.test(id.value) ||
    !root ||
    !Object.hasOwn(root, "value") ||
    !metadataPath(root.value) ||
    !["instructions", "mcp"].includes(kind) ||
    typeof check !== "function" ||
    !io ||
    !["lstat", "realpath", "open"].every((key) => typeof io[key] === "function")
  )
    fail("INVALID_REQUEST");

  const base = {
    workspaceId: id.value,
    workspacePath: root.value,
    kind,
    path: join(
      root.value,
      kind === "instructions" ? "AGENTS.md" : "opencode.json",
    ),
  };
  const result = (status, reason) => ({ ...base, status, reason });
  let rootFD;
  let fileFD;

  async function checked(operation, cleanup = false) {
    let admissionError;
    try {
      check();
    } catch (error) {
      if (!cleanup) throw error;
      admissionError = error;
    }
    let value;
    try {
      value = await operation();
    } catch (error) {
      check();
      if (admissionError) throw admissionError;
      throw error;
    }
    check();
    if (admissionError) throw admissionError;
    return value;
  }
  const statPath = (path) => checked(() => io.lstat(path, { bigint: true }));
  const canonical = (path) => checked(() => io.realpath(path));

  async function observe() {
    // Do not silently drop a required safety flag on an unsupported platform.
    if (
      ![
        constants.O_NOFOLLOW,
        constants.O_NONBLOCK,
        constants.O_DIRECTORY,
      ].every((flag) => typeof flag === "number" && flag !== 0)
    )
      denied();
    const rootBefore = await statPath(base.workspacePath);
    if (!rootBefore.isDirectory() || rootBefore.isSymbolicLink()) denied();
    if ((await canonical(base.workspacePath)) !== base.workspacePath) denied();
    await checked(async () => {
      // Retain each acquired handle before the post-await admission check.
      rootFD = await io.open(
        base.workspacePath,
        openFlags | constants.O_DIRECTORY,
      );
    });
    const heldRoot = await checked(() => rootFD.stat({ bigint: true }));
    if (!heldRoot.isDirectory() || !sameIdentity(rootBefore, heldRoot))
      changed();

    async function stableRoot() {
      try {
        const held = await checked(() => rootFD.stat({ bigint: true }));
        const named = await statPath(base.workspacePath);
        if (
          !held.isDirectory() ||
          !named.isDirectory() ||
          named.isSymbolicLink() ||
          !sameIdentity(heldRoot, held) ||
          !sameIdentity(heldRoot, named) ||
          (await canonical(base.workspacePath)) !== base.workspacePath
        )
          changed();
        // Directory timestamps can change when an unrelated file is added.
      } catch (error) {
        if (!error?.appCode && ["ENOENT", "ENOTDIR"].includes(error?.code))
          changed();
        throw error;
      }
    }
    await stableRoot();
    let namedFile;
    try {
      namedFile = await statPath(base.path);
    } catch (error) {
      if (error?.code !== "ENOENT" || error?.appCode) throw error;
      await stableRoot();
      try {
        await statPath(base.path);
      } catch (absence) {
        if (absence?.code !== "ENOENT" || absence?.appCode) throw absence;
        await stableRoot();
        return result("missing", "missing_file");
      }
      changed();
    }
    if (!regularFile(namedFile)) denied();
    if ((await canonical(base.path)) !== base.path) denied();
    await stableRoot();
    try {
      await checked(async () => {
        fileFD = await io.open(base.path, openFlags);
      });
    } catch (error) {
      if (
        !error?.appCode &&
        ["ENOENT", "ENOTDIR", "ELOOP"].includes(error?.code)
      )
        changed();
      throw error;
    }
    const heldFile = await checked(() => fileFD.stat({ bigint: true }));
    if (!regularFile(heldFile) || !sameFile(namedFile, heldFile)) changed();

    async function stableFile() {
      try {
        const held = await checked(() => fileFD.stat({ bigint: true }));
        const named = await statPath(base.path);
        if (
          !regularFile(held) ||
          !regularFile(named) ||
          !sameFile(heldFile, held) ||
          !sameFile(heldFile, named) ||
          (await canonical(base.path)) !== base.path
        )
          changed();
      } catch (error) {
        if (!error?.appCode && ["ENOENT", "ENOTDIR"].includes(error?.code))
          changed();
        throw error;
      }
    }
    await stableRoot();
    await stableFile();
    await stableRoot();
    if (heldFile.size > BigInt(maxBytes))
      return result("unavailable", "too_large");

    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const remaining = buffer.length - length;
      const { bytesRead } = await checked(() =>
        fileFD.read(buffer, length, remaining, length),
      );
      if (
        !Number.isInteger(bytesRead) ||
        bytesRead < 0 ||
        bytesRead > remaining
      )
        changed();
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > maxBytes) return result("unavailable", "too_large");
    await stableRoot();
    await stableFile();
    await stableRoot();
    if (BigInt(length) !== heldFile.size) changed();

    const bytes = buffer.subarray(0, length);
    let content;
    try {
      // Preserve BOM and all original text; validation never rewrites a document.
      content = new globalThis.TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(bytes);
    } catch {
      return result("unsupported", "unsupported_content");
    }
    if (!configurationFileContentFits(kind, content))
      return result("unsupported", "unsupported_content");
    return {
      ...base,
      status: "available",
      content,
      version: configurationFileVersion(base, heldRoot, heldFile, bytes),
    };
  }

  let response;
  let failure;
  try {
    response = await observe();
  } catch (error) {
    failure = error;
  } finally {
    for (const handle of [fileFD, rootFD]) {
      if (!handle) continue;
      try {
        // Cancellation must not prevent cleanup of either retained FD.
        await checked(() => handle.close(), true);
      } catch (error) {
        if (!failure || (!failure?.appCode && error?.appCode)) failure = error;
      }
    }
  }
  if (failure?.appCode) throw failure;
  if (failure)
    return result(
      "unavailable",
      failure instanceof ObservationFailure ? failure.reason : "path_denied",
    );
  return response;
}
