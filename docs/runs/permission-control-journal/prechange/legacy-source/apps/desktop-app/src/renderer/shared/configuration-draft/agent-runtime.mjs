// Browser-safe closed public Agent contract. No IO, hashing, registration or execution.
import { validAgentSourceName, agentFileContentFits } from "./agent.mjs";
import { policyMatches } from "./policy.mjs";
export const AGENT_RUNTIME_FEATURE = "configuration_agents_v1";
const steps = Object.freeze({
  "configuration.agent.register": "native.agent.register",
  "configuration.agent.remove": "native.agent.remove",
});
export const agentRuntimeStep = (type) =>
  Object.hasOwn(steps, type) ? steps[type] : undefined;
const id = (v) => typeof v === "string" && /^[\w.:-]{1,256}$/u.test(v);
const hex = (v) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
const safe = (v, max = 256) =>
  typeof v === "string" &&
  v.length > 0 &&
  v.length <= max &&
  v.isWellFormed() &&
  ![...v].some(
    (c) =>
      c.charCodeAt(0) < 32 ||
      (c.charCodeAt(0) >= 127 && c.charCodeAt(0) <= 159),
  );
const data = (v) =>
  Boolean(
    v &&
      Object.getPrototypeOf(v) === Object.prototype &&
      Reflect.ownKeys(v).every(
        (k) =>
          typeof k === "string" &&
          Object.hasOwn(Object.getOwnPropertyDescriptor(v, k), "value"),
      ),
  );
const closed = (v, required, optional = []) =>
  data(v) &&
  required.every((k) => Object.hasOwn(v, k)) &&
  Reflect.ownKeys(v).every((k) => required.includes(k) || optional.includes(k));
const dense = (v, max) => {
  if (
    !Array.isArray(v) ||
    v.length > max ||
    Reflect.ownKeys(v).length !== v.length + 1
  )
    return false;
  for (let n = 0; n < v.length; n++) {
    const d = Object.getOwnPropertyDescriptor(v, String(n));
    if (!d || !Object.hasOwn(d, "value")) return false;
  }
  return true;
};
const unique = (v, k) => new Set(v.map((r) => r[k])).size === v.length;
export const validAgentNativeId = (v) =>
  typeof v === "string" && /^omoc-agent-[a-f0-9]{64}$/u.test(v);
export function agentRuntimeIdPayload(v) {
  if (
    !data(v) ||
    !id(v.runtimeEpoch) ||
    !id(v.workspaceId) ||
    !id(v.operationId) ||
    !validAgentSourceName(v.sourceName)
  )
    throw new Error("Invalid Agent identity.");
  return JSON.stringify([
    v.runtimeEpoch,
    v.workspaceId,
    v.sourceName,
    v.operationId,
  ]);
}
const identityFields = [
  "sourceName",
  "nativeId",
  "digest",
  "nativeDigest",
  "registrationRuntimeEpoch",
  "registrationOperationId",
];
const identity = (v) =>
  validAgentSourceName(v.sourceName) &&
  validAgentNativeId(v.nativeId) &&
  hex(v.digest) &&
  hex(v.nativeDigest) &&
  id(v.registrationRuntimeEpoch) &&
  id(v.registrationOperationId);
export function validAgentRuntimeRow(v) {
  return (
    closed(
      v,
      [
        ...identityFields,
        "name",
        "system",
        "systemDigest",
        "path",
        "mode",
        "hidden",
        "permissions",
        "referenceCount",
      ],
      ["description", "color"],
    ) &&
    identity(v) &&
    v.name === v.sourceName &&
    agentFileContentFits(v.system) &&
    v.system.length > 0 &&
    v.system === v.system.trim() &&
    hex(v.systemDigest) &&
    safe(v.path, 32768) &&
    v.mode === "primary" &&
    v.hidden === false &&
    policyMatches(v.permissions) &&
    Number.isSafeInteger(v.referenceCount) &&
    v.referenceCount >= 0 &&
    v.referenceCount <= 1024 &&
    (!Object.hasOwn(v, "description") ||
      (safe(v.description, 1024) && v.description.trim().length > 0)) &&
    (!Object.hasOwn(v, "color") ||
      (typeof v.color === "string" && /^#[a-f0-9]{6}$/iu.test(v.color)))
  );
}
const file = (v) => {
  if (!data(v) || !validAgentSourceName(v.sourceName)) return false;
  if (v.status === "available")
    return (
      closed(v, [
        "sourceName",
        "status",
        "version",
        "directoryVersion",
        "digest",
      ]) &&
      hex(v.version) &&
      hex(v.directoryVersion) &&
      hex(v.digest)
    );
  return (
    closed(v, ["sourceName", "status", "reason"]) &&
    ((v.status === "missing" && v.reason === "missing_file") ||
      (v.status === "unsupported" && v.reason === "unsupported_content") ||
      (v.status === "unavailable" &&
        ["path_missing", "path_denied", "file_changed", "too_large"].includes(
          v.reason,
        )))
  );
};
const projection = (v) =>
  closed(v, ["nativeId", "name", "mode", "hidden"]) &&
  safe(v.nativeId, 512) &&
  safe(v.name) &&
  ["primary", "subagent", "all"].includes(v.mode) &&
  typeof v.hidden === "boolean";
const defaultId = (v) => v === null || safe(v, 512);
export function validAgentRuntimeObservation(v) {
  if (!data(v)) return false;
  const common = ["workspaceId", "workspacePath", "runtimeEpoch", "status"];
  if (
    !id(v.workspaceId) ||
    !id(v.runtimeEpoch) ||
    !safe(v.workspacePath, 32768)
  )
    return false;
  if (v.status === "unavailable")
    return (
      closed(v, [...common, "reason"]) &&
      [
        "runtime_error",
        "identity_conflict",
        "retained_limit",
        "invalid_context",
        "references_unverified",
      ].includes(v.reason)
    );
  if (
    !closed(
      v,
      [...common, "observationId", "defaultAgentId", "owned", "unowned"],
      ["file"],
    ) ||
    v.status !== "observed" ||
    !id(v.observationId) ||
    !defaultId(v.defaultAgentId) ||
    !dense(v.owned, 16) ||
    !dense(v.unowned, 64)
  )
    return false;
  if (
    !v.owned.every(
      (r) =>
        validAgentRuntimeRow(r) &&
        r.registrationRuntimeEpoch === v.runtimeEpoch &&
        r.path === `${v.workspacePath}/.opencode/agents/${r.sourceName}.md`,
    ) ||
    !v.unowned.every(projection) ||
    !unique(v.owned, "nativeId") ||
    !unique(v.owned, "sourceName") ||
    !unique(v.unowned, "nativeId")
  )
    return false;
  const all = [...v.owned, ...v.unowned];
  return (
    all.length <= 64 &&
    unique(all, "nativeId") &&
    (v.defaultAgentId === null
      ? all.length === 0
      : v.unowned.some((r) => r.nativeId === v.defaultAgentId)) &&
    (!Object.hasOwn(v, "file") || file(v.file))
  );
}
export function validAgentRuntimeMutation(v) {
  if (!data(v) || !id(v.requestId)) return false;
  if (v.status === "unknown") return closed(v, ["requestId", "status"]);
  const common = [
    "requestId",
    "status",
    ...identityFields,
    "systemDigest",
    "defaultAgentId",
  ];
  if (
    !identity(v) ||
    !hex(v.systemDigest) ||
    !safe(v.defaultAgentId, 512) ||
    v.defaultAgentId === v.nativeId
  )
    return false;
  if (v.status === "registered_primary")
    return (
      closed(v, [...common, "version", "directoryVersion"]) &&
      hex(v.version) &&
      hex(v.directoryVersion)
    );
  return v.status === "removed" && closed(v, common);
}
