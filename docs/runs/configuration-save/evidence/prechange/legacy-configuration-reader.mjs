// apps/desktop-app/src/host/workbench-configuration-files.mjs
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import * as actualIO from "node:fs/promises";
import { join as join2 } from "node:path";

// apps/desktop-app/src/workbench-contract.mjs
var ERRORS = Object.freeze({
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
  FILE_DENIED: "This path cannot be accessed in the text preview.",
  FILE_UNSUPPORTED: "This file is not supported by the text preview.",
  FILE_TOO_LARGE: "This file exceeds the text preview limit.",
  RUNTIME_ERROR: "The runtime operation failed.",
  TOOL_ERROR: "A tool operation failed.",
  UNKNOWN_OUTCOME: "The operation outcome is unknown. It will not be resent automatically."
});
function fail(code) {
  const error = new Error(ERRORS[code]);
  error.appCode = code;
  throw error;
}
var BASELINE_POLICY = Object.freeze([
  Object.freeze({ action: "*", resource: "*", effect: "ask" }),
  Object.freeze({
    action: "external_directory",
    resource: "*",
    effect: "deny"
  }),
  Object.freeze({ action: "subagent", resource: "*", effect: "deny" })
]);
var READ_TYPES = Object.freeze([
  "snapshot",
  "diagnostics.list",
  "catalog.list",
  "file.list",
  "file.read",
  "configuration.read",
  "operation.lookup"
]);
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
var configurationDraftFits = (text) => typeof text === "string" && text.length <= CONFIGURATION_DRAFT_LIMITS.bytes && new globalThis.TextEncoder().encode(text).length <= CONFIGURATION_DRAFT_LIMITS.bytes;
var controls = (text, multiline = false) => [...text].some((char) => {
  const code = char.charCodeAt(0);
  return code < 32 && !(multiline && [9, 10, 13].includes(code)) || code >= 127 && code <= 159;
});
var object = (value) => Boolean(
  value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype
);
var closed = (value, keys) => Object.keys(value).every((key) => keys.includes(key));
var basicString = (value, max) => typeof value === "string" && value.length > 0 && value.length <= max && !controls(value);
var result = (status, ...issues) => ({ status, issues });
function depthExceeded(text) {
  let depth = 0, quoted = false, escaped = false;
  for (const char of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "[" || char === "{") {
      if (++depth > 16) return true;
    } else if (char === "]" || char === "}") depth--;
  }
  return false;
}
function validateConfigurationDraft(kind, text) {
  if (!configurationDraftFits(text)) return result("invalid", "too_large");
  if (!text.trim()) return result("invalid", "empty");
  if (controls(text, true)) return result("invalid", "control_bytes");
  if (kind === "instructions") return result("valid");
  if (kind !== "mcp") return result("unsupported", "unsupported_shape");
  if (depthExceeded(text)) return result("invalid", "too_deep");
  let parsed;
  try {
    parsed = JSON.parse(text);
    if (duplicateMembers(text))
      return result("unsupported", "unsupported_shape");
  } catch {
    return result("invalid", "json_invalid");
  }
  if (!object(parsed) || !closed(parsed, ["mcp"]) || !object(parsed.mcp) || !closed(parsed.mcp, ["servers"]) || !object(parsed.mcp.servers))
    return result("unsupported", "unsupported_shape");
  const servers = Object.entries(parsed.mcp.servers);
  if (!servers.length || servers.length > 16)
    return result("invalid", "invalid_server");
  for (const [name, config] of servers) {
    if (!/^[A-Za-z0-9_.-]{1,80}$/.test(name) || ["__proto__", "prototype", "constructor"].includes(name) || !object(config))
      return result("invalid", "invalid_server");
    const common = ["type", "disabled", "codemode", "protocol"];
    if (config.type === "local") {
      if (!closed(config, [...common, "command", "cwd"]))
        return result("unsupported", "unsupported_shape");
      if (!Array.isArray(config.command) || !config.command.length || config.command.length > 32 || !config.command.every((part) => basicString(part, 1024)))
        return result("invalid", "invalid_command");
      if (config.cwd !== void 0 && !basicString(config.cwd, 1024))
        return result("invalid", "invalid_option");
    } else if (config.type === "remote") {
      if (!closed(config, [...common, "url", "oauth"]))
        return result("unsupported", "unsupported_shape");
      if (!basicString(config.url, 2048))
        return result("invalid", "invalid_url");
      try {
        const url = new URL(config.url);
        if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash)
          return result("invalid", "invalid_url");
      } catch {
        return result("invalid", "invalid_url");
      }
      if (config.oauth !== void 0 && config.oauth !== false)
        return result("unsupported", "unsupported_shape");
    } else return result("unsupported", "unsupported_shape");
    for (const key of ["disabled", "codemode"])
      if (config[key] !== void 0 && typeof config[key] !== "boolean")
        return result("invalid", "invalid_option");
    if (config.protocol !== void 0 && (typeof config.protocol !== "string" || !["legacy", "auto", "2026-07-28"].includes(config.protocol)))
      return result("invalid", "invalid_option");
  }
  return result("valid");
}
function configurationFileContentFits(kind, text) {
  if (!configurationDraftFits(text) || controls(text, true)) return false;
  return kind === "instructions" || kind === "mcp" && validateConfigurationDraft(kind, text).status === "valid";
}
function duplicateMembers(text) {
  const tokens = [...text.matchAll(/"(?:[^"\\]|\\[\s\S])*"|[{}[\]:,]/g)].map(
    (match) => match[0]
  );
  const stack = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "{") stack.push(/* @__PURE__ */ new Set());
    else if (token === "[") stack.push(null);
    else if (token === "}" || token === "]") stack.pop();
    else if (token.startsWith('"') && tokens[i + 1] === ":") {
      const keys = stack.at(-1);
      const key = JSON.parse(token);
      if (!keys || keys.has(key)) return true;
      keys.add(key);
    }
  }
  return false;
}

// apps/desktop-app/src/host/workbench-configuration.mjs
import { isAbsolute, join, relative, sep } from "node:path";
var markers = Object.freeze([
  ["AGENTS.md", "instructions", "file"],
  ["CLAUDE.md", "instructions", "file"],
  ["opencode.json", "configuration", "file"],
  ["opencode.jsonc", "configuration", "file"],
  [".opencode", "configuration", "directory"],
  [".agents", "configuration", "directory"],
  [".claude", "configuration", "directory"],
  [".codex/config.toml", "configuration", "file"]
]);
function metadataPath(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 4096 && isAbsolute(value) && ![...value].some((char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code >= 127 && code <= 159;
  });
}

// apps/desktop-app/src/host/workbench-configuration-files.mjs
var maxBytes = CONFIGURATION_DRAFT_LIMITS.bytes;
var openFlags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
var sameIdentity = (a, b) => a.dev === b.dev && a.ino === b.ino;
var regularFile = (stat) => stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1n;
var sameFile = (a, b) => sameIdentity(a, b) && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
var ObservationFailure = class extends Error {
  constructor(reason) {
    super("Configuration file observation failed.");
    this.reason = reason;
  }
};
var changed = () => {
  throw new ObservationFailure("file_changed");
};
var denied = () => {
  throw new ObservationFailure("path_denied");
};
function versionFor(base, root, file, bytes) {
  const fields = [
    base.workspaceId,
    base.workspacePath,
    base.kind,
    base.path,
    root.dev,
    root.ino,
    root.mtimeNs,
    root.ctimeNs,
    file.dev,
    file.ino,
    file.size,
    file.mtimeNs,
    file.ctimeNs,
    createHash("sha256").update(bytes).digest("hex")
  ].map(String);
  return createHash("sha256").update(JSON.stringify(fields)).digest("hex");
}
async function readConfigurationFile(workspace, kind, options = {}) {
  if (!options || Object.getPrototypeOf(options) !== Object.prototype || Reflect.ownKeys(options).some(
    (key) => !["check", "io"].includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(options, key), "value")
  ))
    fail("INVALID_REQUEST");
  const { check = () => {
  }, io = actualIO } = options;
  const id = workspace && Object.getOwnPropertyDescriptor(workspace, "id");
  const root = workspace && Object.getOwnPropertyDescriptor(workspace, "path");
  if (!workspace || Object.getPrototypeOf(workspace) !== Object.prototype || !id || !Object.hasOwn(id, "value") || typeof id.value !== "string" || !/^[\w.:-]{1,256}$/.test(id.value) || !root || !Object.hasOwn(root, "value") || !metadataPath(root.value) || !["instructions", "mcp"].includes(kind) || typeof check !== "function" || !io || !["lstat", "realpath", "open"].every((key) => typeof io[key] === "function"))
    fail("INVALID_REQUEST");
  const base = {
    workspaceId: id.value,
    workspacePath: root.value,
    kind,
    path: join2(
      root.value,
      kind === "instructions" ? "AGENTS.md" : "opencode.json"
    )
  };
  const result2 = (status, reason) => ({ ...base, status, reason });
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
    if (![
      constants.O_NOFOLLOW,
      constants.O_NONBLOCK,
      constants.O_DIRECTORY
    ].every((flag) => typeof flag === "number" && flag !== 0))
      denied();
    const rootBefore = await statPath(base.workspacePath);
    if (!rootBefore.isDirectory() || rootBefore.isSymbolicLink()) denied();
    if (await canonical(base.workspacePath) !== base.workspacePath) denied();
    await checked(async () => {
      rootFD = await io.open(
        base.workspacePath,
        openFlags | constants.O_DIRECTORY
      );
    });
    const heldRoot = await checked(() => rootFD.stat({ bigint: true }));
    if (!heldRoot.isDirectory() || !sameIdentity(rootBefore, heldRoot))
      changed();
    async function stableRoot() {
      try {
        const held = await checked(() => rootFD.stat({ bigint: true }));
        const named = await statPath(base.workspacePath);
        if (!held.isDirectory() || !named.isDirectory() || named.isSymbolicLink() || !sameIdentity(heldRoot, held) || !sameIdentity(heldRoot, named) || await canonical(base.workspacePath) !== base.workspacePath)
          changed();
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
        return result2("missing", "missing_file");
      }
      changed();
    }
    if (!regularFile(namedFile)) denied();
    if (await canonical(base.path) !== base.path) denied();
    await stableRoot();
    try {
      await checked(async () => {
        fileFD = await io.open(base.path, openFlags);
      });
    } catch (error) {
      if (!error?.appCode && ["ENOENT", "ENOTDIR", "ELOOP"].includes(error?.code))
        changed();
      throw error;
    }
    const heldFile = await checked(() => fileFD.stat({ bigint: true }));
    if (!regularFile(heldFile) || !sameFile(namedFile, heldFile)) changed();
    async function stableFile() {
      try {
        const held = await checked(() => fileFD.stat({ bigint: true }));
        const named = await statPath(base.path);
        if (!regularFile(held) || !regularFile(named) || !sameFile(heldFile, held) || !sameFile(heldFile, named) || await canonical(base.path) !== base.path)
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
      return result2("unavailable", "too_large");
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const remaining = buffer.length - length;
      const { bytesRead } = await checked(
        () => fileFD.read(buffer, length, remaining, length)
      );
      if (!Number.isInteger(bytesRead) || bytesRead < 0 || bytesRead > remaining)
        changed();
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > maxBytes) return result2("unavailable", "too_large");
    await stableRoot();
    await stableFile();
    await stableRoot();
    if (BigInt(length) !== heldFile.size) changed();
    const bytes = buffer.subarray(0, length);
    let content;
    try {
      content = new globalThis.TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true
      }).decode(bytes);
    } catch {
      return result2("unsupported", "unsupported_content");
    }
    if (!configurationFileContentFits(kind, content))
      return result2("unsupported", "unsupported_content");
    return {
      ...base,
      status: "available",
      content,
      version: versionFor(base, heldRoot, heldFile, bytes)
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
        await checked(() => handle.close(), true);
      } catch (error) {
        if (!failure || !failure?.appCode && error?.appCode) failure = error;
      }
    }
  }
  if (failure?.appCode) throw failure;
  if (failure)
    return result2(
      "unavailable",
      failure instanceof ObservationFailure ? failure.reason : "path_denied"
    );
  return response;
}
export {
  readConfigurationFile
};
