import { validMcpSourceName } from "../workbench-contract.mjs";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { configurationFileWriteFits } from "../renderer/shared/configuration-draft/validation.mjs";

export const MCP_FEATURE = "configuration_mcp_v1";
export const MCP_STATUSES = Object.freeze([
  "connected",
  "pending",
  "disabled",
  "failed",
  "needs_auth",
]);
export const mcpDigest = (value) =>
  createHash("sha256").update(value, "utf8").digest("hex");
export { validMcpSourceName };
export const validMcpNativeName = (value) =>
  typeof value === "string" && /^omoc-mcp-[a-f0-9]{40}$/.test(value);
export function mcpNativeName(workspaceId, sourceName) {
  if (
    typeof workspaceId !== "string" ||
    !/^[\w.:-]{1,256}$/.test(workspaceId) ||
    !validMcpSourceName(sourceName)
  )
    throw new Error("invalid_mcp_identity");
  return `omoc-mcp-${mcpDigest(JSON.stringify([workspaceId, sourceName])).slice(0, 40)}`;
}
export function mcpStep(type) {
  const steps = {
    "configuration.mcp.register": "native.mcp.add",
    "configuration.mcp.connect": "native.mcp.connect",
    "configuration.mcp.disconnect": "native.mcp.disconnect",
    "configuration.mcp.remove": "native.mcp.remove",
  };
  return Object.hasOwn(steps, type) ? steps[type] : undefined;
}
const unsupported = () => {
  throw Object.assign(new Error("Unsupported MCP runtime conversion"), {
    appCode: "MCP_UNSUPPORTED",
  });
};
const safeName = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 256 &&
  ![...value].some(
    (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
  );
const hash = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const plain = (value) =>
  value && Object.getPrototypeOf(value) === Object.prototype;

// Native resolves cwd again when connecting. Recheck the live path, not only
// the immutable definition accepted at registration.
export async function validateMcpLocalCwd(
  workspacePath,
  cwd,
  { io = fs } = {},
) {
  try {
    if (!isAbsolute(workspacePath) || typeof cwd !== "string") unsupported();
    if ((await io.realpath(workspacePath)) !== workspacePath) unsupported();
    const directory = resolve(workspacePath, cwd);
    const rel = relative(workspacePath, directory);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
      unsupported();
    let current = workspacePath;
    if (!(await io.lstat(current)).isDirectory()) unsupported();
    for (const component of rel.split(sep).filter(Boolean)) {
      current = join(current, component);
      const stat = await io.lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) unsupported();
    }
    if ((await io.realpath(directory)) !== directory) unsupported();
    return directory;
  } catch {
    unsupported();
  }
}

// No evaluation, install or process launch. Call again around confirmation.
export async function normalizeMcpDefinition(
  workspacePath,
  text,
  sourceName,
  { io = fs } = {},
) {
  if (
    !validMcpSourceName(sourceName) ||
    !configurationFileWriteFits("mcp", text) ||
    !isAbsolute(workspacePath)
  )
    unsupported();
  const parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
  if (!Object.hasOwn(parsed.mcp.servers, sourceName)) unsupported();
  const config = parsed.mcp.servers[sourceName];
  let definition;
  if (config.type === "local") {
    const directory = await validateMcpLocalCwd(
      workspacePath,
      config.cwd ?? ".",
      {
        io,
      },
    );
    definition = {
      type: "local",
      command: Object.freeze([...config.command]),
      cwd: directory,
      disabled: true,
    };
  } else {
    if (config.oauth !== false) unsupported();
    definition = {
      type: "remote",
      url: config.url,
      oauth: false,
      disabled: true,
    };
  }
  for (const key of ["codemode", "protocol"])
    if (Object.hasOwn(config, key)) definition[key] = config[key];
  Object.freeze(definition);
  return Object.freeze({
    sourceName,
    definition,
    digest: mcpDigest(JSON.stringify(definition)),
  });
}

// List is status evidence only; submitted digests never describe current Native config.
export function observeMcpCatalog(
  result,
  { workspaceId, path, runtimeEpoch, owned = new Map() },
) {
  const unavailable = (reason = "unsupported_catalog") => ({
    workspaceId,
    status: "unavailable",
    reason,
  });
  if (
    !plain(result) ||
    !plain(result.location) ||
    result.location.directory !== path
  )
    return unavailable("scope_mismatch");
  if (
    !Array.isArray(result.data) ||
    result.data.length > 300 ||
    !(owned instanceof Map)
  )
    return unavailable();
  const statuses = new Map();
  for (const row of result.data) {
    if (
      !plain(row) ||
      !safeName(row.name) ||
      !plain(row.status) ||
      !MCP_STATUSES.includes(row.status.status) ||
      statuses.has(row.name)
    )
      return unavailable();
    statuses.set(row.name, row.status.status);
  }
  const registrations = new Map();
  for (const [nativeName, registration] of owned) {
    if (
      registration?.workspaceId !== workspaceId ||
      registration?.path !== path ||
      registration?.runtimeEpoch !== runtimeEpoch
    )
      continue;
    if (
      !validMcpSourceName(registration.sourceName) ||
      !hash(registration.digest) ||
      !hash(registration.sourceVersion) ||
      nativeName !== mcpNativeName(workspaceId, registration.sourceName)
    )
      return unavailable();
    registrations.set(nativeName, registration);
    if (!statuses.has(nativeName)) statuses.set(nativeName, "absent");
  }
  if (registrations.size > 16) return unavailable();
  const servers = [...statuses]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([nativeName, status]) => {
      const registration = registrations.get(nativeName);
      return registration
        ? {
            nativeName,
            status,
            ownership: "current_runtime",
            sourceName: registration.sourceName,
            submittedDefinitionDigest: registration.digest,
            sourceVersion: registration.sourceVersion,
          }
        : { nativeName, status, ownership: "unowned" };
    });
  return {
    workspaceId,
    status: "observed",
    version: mcpDigest(
      JSON.stringify([runtimeEpoch, workspaceId, path, servers]),
    ),
    servers,
  };
}
