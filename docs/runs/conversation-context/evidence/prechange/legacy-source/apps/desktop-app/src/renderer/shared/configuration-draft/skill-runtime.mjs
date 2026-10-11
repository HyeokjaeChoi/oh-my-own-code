// Browser-safe closed DTO validation. No IO, registration or execution.
import { validSkillSourceName, skillFileContentFits } from "./skill.mjs";
export const SKILL_RUNTIME_FEATURE = "configuration_skill_runtime_v1";
const steps = Object.freeze({
  "configuration.skill.register": "native.skill.register",
  "configuration.skill.remove": "native.skill.remove",
  "configuration.skill.apply": "native.skill.apply",
});
export const skillRuntimeStep = (type) =>
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
const closed = (v, required, optional = []) =>
  Boolean(
    v &&
      Object.getPrototypeOf(v) === Object.prototype &&
      required.every((k) => Object.hasOwn(v, k)) &&
      Reflect.ownKeys(v).every(
        (k) =>
          typeof k === "string" &&
          (required.includes(k) || optional.includes(k)) &&
          Object.hasOwn(Object.getOwnPropertyDescriptor(v, k), "value"),
      ),
  );
export const validSkillNativeId = (v) =>
  typeof v === "string" && /^omoc-skill-[a-f0-9]{64}$/u.test(v);
export function skillRuntimeIdPayload(v) {
  if (
    !id(v?.runtimeEpoch) ||
    !id(v?.workspaceId) ||
    !id(v?.operationId) ||
    !validSkillSourceName(v?.sourceName)
  )
    throw new Error("Invalid Skill identity.");
  return JSON.stringify([
    v.runtimeEpoch,
    v.workspaceId,
    v.sourceName,
    v.operationId,
  ]);
}
const registrationFields = [
  "sourceName",
  "nativeId",
  "digest",
  "nativeDigest",
  "registrationRuntimeEpoch",
  "registrationOperationId",
];
const registration = (v) =>
  validSkillSourceName(v.sourceName) &&
  validSkillNativeId(v.nativeId) &&
  hex(v.digest) &&
  hex(v.nativeDigest) &&
  id(v.registrationRuntimeEpoch) &&
  id(v.registrationOperationId);
export function validSkillRuntimeRow(v) {
  return (
    closed(
      v,
      [
        ...registrationFields,
        "name",
        "autoinvoke",
        "path",
        "content",
        "bodyDigest",
      ],
      ["description"],
    ) &&
    registration(v) &&
    safe(v.name) &&
    v.name.trim().length > 0 &&
    v.autoinvoke === false &&
    safe(v.path, 32768) &&
    skillFileContentFits(v.content) &&
    v.content.trim().length > 0 &&
    hex(v.bodyDigest) &&
    (!Object.hasOwn(v, "description") ||
      (safe(v.description, 1024) && v.description.trim().length > 0))
  );
}
const dense = (rows, maximum) => {
  if (!Array.isArray(rows) || rows.length > maximum) return false;
  for (let i = 0; i < rows.length; i++) {
    const slot = Object.getOwnPropertyDescriptor(rows, String(i));
    if (!slot || !Object.hasOwn(slot, "value")) return false;
  }
  return true;
};
const unique = (rows, key) =>
  new Set(rows.map((r) => r[key])).size === rows.length;
const file = (v) => {
  if (!validSkillSourceName(v?.sourceName)) return false;
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
const message = (v) =>
  closed(v, ["nativeId", "messageId", "name", "bodyDigest"]) &&
  safe(v.nativeId, 512) &&
  id(v.messageId) &&
  safe(v.name) &&
  hex(v.bodyDigest);
const session = (v) => {
  if (!id(v?.sessionId)) return false;
  if (v.status === "observed")
    return (
      closed(v, ["sessionId", "status", "messages"]) &&
      dense(v.messages, 1024) &&
      v.messages.every(message) &&
      unique(v.messages, "messageId")
    );
  return (
    closed(v, ["sessionId", "status", "reason"]) &&
    v.status === "unavailable" &&
    ["history_unverified", "history_truncated", "scope_mismatch"].includes(
      v.reason,
    )
  );
};
export function validSkillRuntimeObservation(v) {
  const common = ["workspaceId", "workspacePath", "runtimeEpoch", "status"];
  if (
    !id(v?.workspaceId) ||
    !id(v?.runtimeEpoch) ||
    !safe(v?.workspacePath, 32768)
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
        "history_unverified",
      ].includes(v.reason)
    );
  if (
    !closed(
      v,
      [...common, "observationId", "owned", "unowned"],
      ["file", "session"],
    ) ||
    v.status !== "observed" ||
    !id(v.observationId) ||
    !dense(v.owned, 16) ||
    !v.owned.every(
      (r) =>
        validSkillRuntimeRow(r) &&
        r.registrationRuntimeEpoch === v.runtimeEpoch &&
        r.path ===
          `${v.workspacePath}/.opencode/skills/${r.sourceName}/SKILL.md`,
    ) ||
    !unique(v.owned, "nativeId") ||
    !unique(v.owned, "sourceName") ||
    !dense(v.unowned, 64)
  )
    return false;
  if (
    !v.unowned.every(
      (r) =>
        closed(r, ["nativeId", "name"], ["autoinvoke"]) &&
        safe(r.nativeId, 512) &&
        safe(r.name) &&
        (!Object.hasOwn(r, "autoinvoke") || typeof r.autoinvoke === "boolean"),
    ) ||
    !unique(v.unowned, "nativeId") ||
    new Set([...v.owned, ...v.unowned].map((r) => r.nativeId)).size !==
      v.owned.length + v.unowned.length
  )
    return false;
  return (
    (!Object.hasOwn(v, "file") || file(v.file)) &&
    (!Object.hasOwn(v, "session") || session(v.session))
  );
}
export function validSkillRuntimeMutation(v) {
  if (!id(v?.requestId)) return false;
  if (v.status === "unknown") return closed(v, ["requestId", "status"]);
  const common = ["requestId", "status", ...registrationFields];
  if (!registration(v)) return false;
  if (v.status === "registered_disabled")
    return (
      closed(v, [...common, "version", "directoryVersion", "bodyDigest"]) &&
      hex(v.version) &&
      hex(v.directoryVersion) &&
      hex(v.bodyDigest)
    );
  if (v.status === "removed") return closed(v, common);
  return (
    v.status === "applied" &&
    closed(v, [
      ...common,
      "sessionId",
      "nativeSessionId",
      "nativeMessageId",
      "bodyDigest",
    ]) &&
    id(v.sessionId) &&
    id(v.nativeSessionId) &&
    id(v.nativeMessageId) &&
    hex(v.bodyDigest)
  );
}
