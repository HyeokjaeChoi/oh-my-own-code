import { agentRuntimeIdPayload } from "./renderer/shared/configuration-draft/agent-runtime.mjs";
// Closed Main-to-fixed-plugin authority. Importing it performs no IO.
import { createHash } from "node:crypto";
import { isAbsolute, normalize } from "node:path";
import {
  validAgentSourceName,
  AGENT_LIMITS,
} from "./renderer/shared/configuration-draft/agent.mjs";
import { policyMatches } from "./renderer/shared/configuration-draft/policy.mjs";

const hex = (v) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
const id = (v) => typeof v === "string" && /^[\w.:-]{1,256}$/u.test(v);
const safe = (v, max, multiline = false) =>
  typeof v === "string" &&
  v.length <= max &&
  v.isWellFormed() &&
  ![...v].some((c) => {
    const n = c.charCodeAt(0);
    return (
      (n < 32 && !(multiline && [9, 10, 13].includes(n))) ||
      (n >= 127 && n <= 159)
    );
  });
const root = (v) =>
  safe(v, 32768) && isAbsolute(v) && normalize(v) === v && v !== "/";
const data = (v) =>
  v &&
  Object.getPrototypeOf(v) === Object.prototype &&
  Reflect.ownKeys(v).every(
    (k) =>
      typeof k === "string" &&
      Object.hasOwn(Object.getOwnPropertyDescriptor(v, k), "value"),
  );
const closed = (v, required, optional = []) =>
  Boolean(
    data(v) &&
      required.every((k) => Object.hasOwn(v, k)) &&
      Reflect.ownKeys(v).every(
        (k) => required.includes(k) || optional.includes(k),
      ),
  );
const sha = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
export const NATIVE_AGENT_LIMITS = Object.freeze({
  owned: 16,
  native: 64,
  operations: 256,
  referencePages: 16,
  referencePageSize: 64,
});
export function validAgentOwner(v) {
  return (
    closed(v, [
      "runtimeEpoch",
      "operationId",
      "workspaceId",
      "workspacePath",
      "sourceName",
      "digest",
    ]) &&
    id(v.runtimeEpoch) &&
    id(v.operationId) &&
    id(v.workspaceId) &&
    root(v.workspacePath) &&
    validAgentSourceName(v.sourceName) &&
    hex(v.digest)
  );
}
export function nativeAgentRegistrationId(identity) {
  return (
    "omoc-agent-" +
    createHash("sha256").update(agentRuntimeIdPayload(identity)).digest("hex")
  );
}
export function nativeAgentId(owner) {
  if (!validAgentOwner(owner)) throw new Error("native_agent_invalid");
  return nativeAgentRegistrationId(owner);
}
export function sameAgentOwner(a, b) {
  return Boolean(
    validAgentOwner(a) &&
      validAgentOwner(b) &&
      Object.keys(a).every((k) => a[k] === b[k]),
  );
}
export function validNativeAgentShape(v) {
  return Boolean(
    closed(
      v,
      ["id", "name", "system", "mode", "hidden", "request", "permissions"],
      ["description", "color"],
    ) &&
      typeof v.id === "string" &&
      /^omoc-agent-[a-f0-9]{64}$/u.test(v.id) &&
      validAgentSourceName(v.name) &&
      safe(v.system, AGENT_LIMITS.bytes, true) &&
      v.system.trim() === v.system &&
      v.system.length > 0 &&
      new globalThis.TextEncoder().encode(v.system).length <=
        AGENT_LIMITS.bytes &&
      v.mode === "primary" &&
      v.hidden === false &&
      closed(v.request, ["settings", "headers", "body"]) &&
      ["settings", "headers", "body"].every((k) => closed(v.request[k], [])) &&
      policyMatches(v.permissions) &&
      (!Object.hasOwn(v, "description") ||
        (safe(v.description, 1024) && v.description.trim().length > 0)) &&
      (!Object.hasOwn(v, "color") ||
        (typeof v.color === "string" && /^#[a-f0-9]{6}$/iu.test(v.color))),
  );
}
export function validNativeAgent(v, owner) {
  return Boolean(
    validAgentOwner(owner) &&
      validNativeAgentShape(v) &&
      v.id === nativeAgentId(owner) &&
      v.name === owner.sourceName,
  );
}
export function nativeAgentDigest(v) {
  if (!validNativeAgentShape(v)) throw new Error("native_agent_invalid");
  return sha([
    v.id,
    v.name,
    v.system,
    v.description ?? null,
    v.color ?? null,
    v.mode,
    v.hidden,
    v.request.settings,
    v.request.headers,
    v.request.body,
    v.permissions.map((r) => [r.action, r.resource, r.effect]),
  ]);
}
export function validAgentProjection(v) {
  return Boolean(
    closed(v, ["id", "name", "mode", "hidden"]) &&
      safe(v.id, 512) &&
      v.id.length > 0 &&
      safe(v.name, 256) &&
      v.name.length > 0 &&
      ["primary", "subagent", "all"].includes(v.mode) &&
      typeof v.hidden === "boolean",
  );
}
export function nativeAgentOperationKey(owner) {
  if (!validAgentOwner(owner)) throw new Error("native_agent_invalid");
  return JSON.stringify([owner.runtimeEpoch, owner.operationId]);
}
export function validateAgentRpc(method, v) {
  let valid = false;
  if (method === "observe")
    valid =
      closed(v, ["nonce", "workspaceId", "workspacePath"]) &&
      hex(v.nonce) &&
      id(v.workspaceId) &&
      root(v.workspacePath);
  if (method === "register")
    valid =
      closed(v, [
        "nonce",
        "owner",
        "record",
        "recordDigest",
        "expectedNativeId",
      ]) &&
      hex(v.nonce) &&
      validNativeAgent(v.record, v.owner) &&
      v.recordDigest === nativeAgentDigest(v.record) &&
      v.expectedNativeId === null;
  if (method === "remove")
    valid =
      closed(v, [
        "nonce",
        "owner",
        "registration",
        "nativeId",
        "recordDigest",
      ]) &&
      hex(v.nonce) &&
      validAgentOwner(v.owner) &&
      validAgentOwner(v.registration) &&
      ["workspaceId", "workspacePath", "sourceName"].every(
        (k) => v.owner[k] === v.registration[k],
      ) &&
      v.nativeId === nativeAgentId(v.registration) &&
      hex(v.recordDigest);
  if (!valid) throw new Error("native_agent_invalid");
  return v;
}
export function nativeAgentRequestDigest(method, v) {
  validateAgentRpc(method, v);
  const owner = (o) => [
    o.runtimeEpoch,
    o.operationId,
    o.workspaceId,
    o.workspacePath,
    o.sourceName,
    o.digest,
  ];
  return method === "register"
    ? sha([method, owner(v.owner), v.recordDigest, v.expectedNativeId])
    : method === "remove"
      ? sha([
          method,
          owner(v.owner),
          owner(v.registration),
          v.nativeId,
          v.recordDigest,
        ])
      : sha([method, v.workspaceId, v.workspacePath]);
}
const dense = (array, max, validate) => {
  if (
    !Array.isArray(array) ||
    array.length > max ||
    Reflect.ownKeys(array).length !== array.length + 1
  )
    return false;
  for (let i = 0; i < array.length; i++) {
    const s = Object.getOwnPropertyDescriptor(array, String(i));
    if (!s || !Object.hasOwn(s, "value") || !validate(s.value)) return false;
  }
  return true;
};
const defaultId = (v) => v === null || (safe(v, 512) && v.length > 0);
export function validateAgentRpcResult(method, v) {
  const invalid = () => {
    throw new Error("native_agent_invalid");
  };
  if (method === "observe") {
    if (
      closed(v, ["status", "reason"]) &&
      v.status === "unavailable" &&
      [
        "identity_conflict",
        "retained_limit",
        "runtime_error",
        "invalid_context",
      ].includes(v.reason)
    )
      return v;
    if (
      !closed(v, [
        "status",
        "version",
        "workspaceId",
        "workspacePath",
        "rows",
        "native",
        "defaultAgentId",
      ]) ||
      v.status !== "ready" ||
      v.version !== 1 ||
      !id(v.workspaceId) ||
      !root(v.workspacePath) ||
      !defaultId(v.defaultAgentId) ||
      !dense(v.native, NATIVE_AGENT_LIMITS.native, validAgentProjection) ||
      !dense(
        v.rows,
        NATIVE_AGENT_LIMITS.owned,
        (r) =>
          closed(r, ["owner", "record", "recordDigest"]) &&
          validNativeAgent(r.record, r.owner) &&
          r.recordDigest === nativeAgentDigest(r.record),
      )
    )
      invalid();
    if (
      new Set(v.native.map((r) => r.id)).size !== v.native.length ||
      new Set(v.rows.map((r) => r.owner.sourceName)).size !== v.rows.length
    )
      invalid();
    for (const r of v.rows) {
      const native = v.native.find((a) => a.id === r.record.id);
      if (
        r.owner.workspaceId !== v.workspaceId ||
        r.owner.workspacePath !== v.workspacePath ||
        !native ||
        native.name !== r.record.name ||
        native.mode !== r.record.mode ||
        native.hidden !== r.record.hidden
      )
        invalid();
    }
    if (
      v.defaultAgentId !== null &&
      !v.native.some((r) => r.id === v.defaultAgentId)
    )
      invalid();
    return v;
  }
  if (
    ["register", "remove"].includes(method) &&
    closed(v, ["status", "reason"]) &&
    v.status === "unknown" &&
    ["reload_failed", "verification_failed"].includes(v.reason)
  )
    return v;
  if (
    method === "register" &&
    closed(v, [
      "status",
      "owner",
      "record",
      "recordDigest",
      "defaultAgentId",
    ]) &&
    v.status === "registered" &&
    validNativeAgent(v.record, v.owner) &&
    v.recordDigest === nativeAgentDigest(v.record) &&
    defaultId(v.defaultAgentId) &&
    v.defaultAgentId !== v.record.id
  )
    return v;
  if (
    method === "remove" &&
    closed(v, [
      "status",
      "owner",
      "registration",
      "nativeId",
      "recordDigest",
      "defaultAgentId",
    ]) &&
    v.status === "removed" &&
    validAgentOwner(v.owner) &&
    validAgentOwner(v.registration) &&
    ["workspaceId", "workspacePath", "sourceName"].every(
      (k) => v.owner[k] === v.registration[k],
    ) &&
    v.nativeId === nativeAgentId(v.registration) &&
    hex(v.recordDigest) &&
    defaultId(v.defaultAgentId) &&
    v.defaultAgentId !== v.nativeId
  )
    return v;
  invalid();
}
const portable = (validate) => ({
  "~standard": {
    version: 1,
    vendor: "oh-my-own-code",
    validate(v) {
      try {
        return { value: validate(v) };
      } catch {
        return { issues: [{ message: "Invalid Native Agent RPC value" }] };
      }
    },
  },
});
function freeze(v) {
  if (v && typeof v === "object") {
    for (const value of Object.values(v)) freeze(value);
    Object.freeze(v);
  }
  return v;
}
const denied = portable((v) => {
  if (
    !closed(v, ["code"]) ||
    ![
      "invalid_context",
      "nonce_mismatch",
      "identity_conflict",
      "retained_limit",
      "collision",
      "changed",
      "in_use",
    ].includes(v.code)
  )
    throw new Error("native_agent_invalid");
  return v;
});
export const NATIVE_AGENTS_RPC = freeze({
  id: "omoc.workbench.agents.v1",
  events: {},
  methods: Object.fromEntries(
    ["observe", "register", "remove"].map((method) => [
      method,
      {
        input: portable((v) => validateAgentRpc(method, v)),
        output: portable((v) => validateAgentRpcResult(method, v)),
        errors: { denied },
      },
    ]),
  ),
});
