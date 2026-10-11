// Private app-to-bundled-plugin protocol. Importing it performs no IO.
import { createHash } from "node:crypto";
import { isAbsolute, join, normalize } from "node:path";
import {
  validSkillSourceName,
  skillFileContentFits,
} from "./renderer/shared/configuration-draft/skill.mjs";
const hex = (v) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
const identifier = (v) => typeof v === "string" && /^[\w.:-]{1,256}$/u.test(v);
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
const safe = (v, max) =>
  typeof v === "string" &&
  v.length <= max &&
  v.isWellFormed() &&
  ![...v].some(
    (c) =>
      c.charCodeAt(0) < 32 ||
      (c.charCodeAt(0) >= 127 && c.charCodeAt(0) <= 159),
  );
const root = (v) =>
  safe(v, 32768) && isAbsolute(v) && normalize(v) === v && v !== "/";
const sha = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
export const NATIVE_SKILL_LIMITS = Object.freeze({
  owned: 16,
  native: 64,
  operations: 256,
});
export function validSkillOwner(v) {
  return (
    closed(v, [
      "runtimeEpoch",
      "operationId",
      "workspaceId",
      "workspacePath",
      "sourceName",
      "digest",
    ]) &&
    identifier(v.runtimeEpoch) &&
    identifier(v.operationId) &&
    identifier(v.workspaceId) &&
    root(v.workspacePath) &&
    validSkillSourceName(v.sourceName) &&
    hex(v.digest)
  );
}
export function nativeSkillRegistrationId(identity) {
  if (
    !identifier(identity?.runtimeEpoch) ||
    !identifier(identity?.workspaceId) ||
    !identifier(identity?.operationId) ||
    !validSkillSourceName(identity?.sourceName)
  )
    throw new Error("native_skill_invalid");
  return (
    "omoc-skill-" +
    sha([
      identity.runtimeEpoch,
      identity.workspaceId,
      identity.sourceName,
      identity.operationId,
    ])
  );
}
export function nativeSkillId(owner) {
  if (!validSkillOwner(owner)) throw new Error("native_skill_invalid");
  return nativeSkillRegistrationId(owner);
}
export function sameSkillOwner(a, b) {
  return (
    validSkillOwner(a) &&
    validSkillOwner(b) &&
    [
      "runtimeEpoch",
      "operationId",
      "workspaceId",
      "workspacePath",
      "sourceName",
      "digest",
    ].every((k) => a[k] === b[k])
  );
}
export function validNativeSkillShape(v) {
  return (
    closed(
      v,
      ["id", "name", "autoinvoke", "path", "content"],
      ["description"],
    ) &&
    safe(v.id, 512) &&
    Boolean(v.id) &&
    safe(v.name, 256) &&
    Boolean(v.name.trim()) &&
    v.autoinvoke === false &&
    root(v.path) &&
    skillFileContentFits(v.content) &&
    (!Object.hasOwn(v, "description") ||
      (safe(v.description, 1024) && Boolean(v.description.trim())))
  );
}
export function validObservedNativeSkill(v) {
  if (
    !closed(v, ["id", "name", "path", "content"], ["description", "autoinvoke"])
  )
    return false;
  if (Object.hasOwn(v, "autoinvoke") && typeof v.autoinvoke !== "boolean")
    return false;
  return validNativeSkillShape({ ...v, autoinvoke: false });
}
export function validNativeSkill(v, owner) {
  return Boolean(
    validSkillOwner(owner) &&
      validNativeSkillShape(v) &&
      v.content.trim() &&
      v.id === nativeSkillId(owner) &&
      v.path ===
        join(
          owner.workspacePath,
          ".opencode",
          "skills",
          owner.sourceName,
          "SKILL.md",
        ),
  );
}
export function nativeSkillDigest(v) {
  if (!validNativeSkillShape(v)) throw new Error("native_skill_invalid");
  return sha([
    v.id,
    v.name,
    v.description ?? null,
    v.autoinvoke,
    v.path,
    v.content,
  ]);
}
export const nativeSkillOperationKey = (owner) => {
  if (!validSkillOwner(owner)) throw new Error("native_skill_invalid");
  return JSON.stringify([owner.runtimeEpoch, owner.operationId]);
};
export function validateSkillRpc(method, v) {
  let valid = false;
  if (method === "observe")
    valid =
      closed(v, ["nonce", "workspaceId", "workspacePath"]) &&
      hex(v.nonce) &&
      identifier(v.workspaceId) &&
      root(v.workspacePath);
  if (method === "registerDisabled")
    valid =
      closed(v, [
        "nonce",
        "owner",
        "record",
        "recordDigest",
        "expectedNativeId",
      ]) &&
      hex(v.nonce) &&
      validNativeSkill(v.record, v.owner) &&
      v.recordDigest === nativeSkillDigest(v.record) &&
      (v.expectedNativeId === null ||
        (typeof v.expectedNativeId === "string" &&
          /^omoc-skill-[a-f0-9]{64}$/u.test(v.expectedNativeId)));
  if (method === "removeOwned")
    valid =
      closed(v, [
        "nonce",
        "owner",
        "registration",
        "nativeId",
        "recordDigest",
      ]) &&
      hex(v.nonce) &&
      validSkillOwner(v.owner) &&
      validSkillOwner(v.registration) &&
      ["workspaceId", "workspacePath", "sourceName"].every(
        (k) => v.owner[k] === v.registration[k],
      ) &&
      v.nativeId === nativeSkillId(v.registration) &&
      hex(v.recordDigest);
  if (!valid) throw new Error("native_skill_invalid");
  return v;
}
export function nativeSkillRequestDigest(method, input) {
  validateSkillRpc(method, input);
  const owner = (v) => [
    v.runtimeEpoch,
    v.operationId,
    v.workspaceId,
    v.workspacePath,
    v.sourceName,
    v.digest,
  ];
  if (method === "registerDisabled")
    return sha([
      method,
      owner(input.owner),
      input.recordDigest,
      input.expectedNativeId,
    ]);
  if (method === "removeOwned")
    return sha([
      method,
      owner(input.owner),
      owner(input.registration),
      input.nativeId,
      input.recordDigest,
    ]);
  return sha([method, input.workspaceId, input.workspacePath]);
}
// The pinned Effect JSON adapter rejects regex patterns and drops excess keys.
// Portable Standard Schema keeps raw fields visible and uses the same closed
// authority validators at both Native handler entry and client result decoding.
export function validateSkillRpcResult(method, value) {
  const invalid = () => {
    throw new Error("native_skill_invalid");
  };
  const unknown = () =>
    closed(value, ["status", "reason"]) &&
    value.status === "unknown" &&
    ["reload_failed", "verification_failed"].includes(value.reason);
  if (method === "observe") {
    if (
      closed(value, ["status", "reason"]) &&
      value.status === "unavailable" &&
      [
        "identity_conflict",
        "retained_limit",
        "runtime_error",
        "invalid_context",
      ].includes(value.reason)
    )
      return value;
    if (
      !closed(value, [
        "status",
        "version",
        "workspaceId",
        "workspacePath",
        "rows",
        "native",
      ]) ||
      value.status !== "ready" ||
      value.version !== 1 ||
      !identifier(value.workspaceId) ||
      !root(value.workspacePath) ||
      !Array.isArray(value.rows) ||
      value.rows.length > NATIVE_SKILL_LIMITS.owned ||
      !Array.isArray(value.native) ||
      value.native.length > NATIVE_SKILL_LIMITS.native ||
      value.native.some((record) => !validObservedNativeSkill(record)) ||
      new Set(value.native.map((record) => record.id)).size !==
        value.native.length
    )
      invalid();
    const sources = new Set();
    for (const row of value.rows) {
      if (
        !closed(row, ["owner", "record", "recordDigest"]) ||
        !validSkillOwner(row.owner) ||
        row.owner.workspaceId !== value.workspaceId ||
        row.owner.workspacePath !== value.workspacePath ||
        !validNativeSkill(row.record, row.owner) ||
        row.recordDigest !== nativeSkillDigest(row.record) ||
        sources.has(row.owner.sourceName)
      )
        invalid();
      const native = value.native.find((record) => record.id === row.record.id);
      if (
        !validNativeSkill(native, row.owner) ||
        nativeSkillDigest(native) !== row.recordDigest
      )
        invalid();
      sources.add(row.owner.sourceName);
    }
    return value;
  }
  if (unknown() && ["registerDisabled", "removeOwned"].includes(method))
    return value;
  if (method === "registerDisabled") {
    if (
      !closed(value, [
        "status",
        "owner",
        "record",
        "recordDigest",
        "previousNativeId",
      ]) ||
      value.status !== "registered_disabled" ||
      !validNativeSkill(value.record, value.owner) ||
      value.recordDigest !== nativeSkillDigest(value.record) ||
      !(
        value.previousNativeId === null ||
        (typeof value.previousNativeId === "string" &&
          /^omoc-skill-[a-f0-9]{64}$/u.test(value.previousNativeId) &&
          value.previousNativeId !== value.record.id)
      )
    )
      invalid();
    return value;
  }
  if (method === "removeOwned") {
    if (
      !closed(value, [
        "status",
        "owner",
        "registration",
        "nativeId",
        "recordDigest",
      ]) ||
      value.status !== "removed" ||
      !validSkillOwner(value.owner) ||
      !validSkillOwner(value.registration) ||
      value.owner.workspaceId !== value.registration.workspaceId ||
      value.owner.workspacePath !== value.registration.workspacePath ||
      value.owner.sourceName !== value.registration.sourceName ||
      value.nativeId !== nativeSkillId(value.registration) ||
      !hex(value.recordDigest)
    )
      invalid();
    return value;
  }
  invalid();
}
function portable(validate) {
  return {
    "~standard": {
      version: 1,
      vendor: "oh-my-own-code",
      validate(value) {
        try {
          return { value: validate(value) };
        } catch {
          return { issues: [{ message: "Invalid Native Skill RPC value" }] };
        }
      },
    },
  };
}
function freeze(v) {
  if (v && typeof v === "object") {
    for (const value of Object.values(v)) freeze(value);
    Object.freeze(v);
  }
  return v;
}
const denied = portable((value) => {
  if (
    !closed(value, ["code"]) ||
    ![
      "invalid_context",
      "nonce_mismatch",
      "identity_conflict",
      "retained_limit",
      "collision",
      "changed",
    ].includes(value.code)
  )
    throw new Error("native_skill_invalid");
  return value;
});
export const NATIVE_SKILLS_RPC = freeze({
  id: "omoc.workbench.skills.v1",
  events: {},
  methods: Object.fromEntries(
    ["observe", "registerDisabled", "removeOwned"].map((method) => [
      method,
      {
        input: portable((value) => validateSkillRpc(method, value)),
        output: portable((value) => validateSkillRpcResult(method, value)),
        errors: { denied },
      },
    ]),
  ),
});
