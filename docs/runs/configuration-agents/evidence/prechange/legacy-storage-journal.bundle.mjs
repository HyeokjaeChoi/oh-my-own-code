// apps/desktop-app/src/renderer/shared/configuration-draft/skill.mjs
var SKILL_LIMITS = Object.freeze({
  bytes: 32768,
  entries: 16,
  scan: 64
});
var validSkillSourceName = (value) => typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value);
var controls = (text, multiline = false) => [...text].some((char) => {
  const code = char.charCodeAt(0);
  return code < 32 && !(multiline && [9, 10, 13].includes(code)) || code >= 127 && code <= 159;
});
var skillFileContentFits = (text) => typeof text === "string" && text.length <= SKILL_LIMITS.bytes && text.isWellFormed() && !controls(text, true) && new globalThis.TextEncoder().encode(text).length <= SKILL_LIMITS.bytes;
var skillIssueMessages = Object.freeze({
  empty: "Markdown \uBCF8\uBB38\uC744 \uC785\uB825\uD558\uC138\uC694.",
  too_large: "\uD30C\uC77C\uC740 UTF-8 \uAE30\uC900 32KiB \uC774\uD558\uC5EC\uC57C \uD569\uB2C8\uB2E4.",
  control_bytes: "\uC0AC\uC6A9\uD560 \uC218 \uC5C6\uB294 \uBB38\uC790 \uB610\uB294 \uC798\uBABB\uB41C Unicode\uAC00 \uC788\uC2B5\uB2C8\uB2E4.",
  unsupported_frontmatter: "\uC9C0\uC6D0\uD558\uB294 \uC55E\uBA38\uB9AC\uB294 name\uACFC description\uC758 JSON \uBB38\uC790\uC5F4, metadata \uC544\uB798\uC758 opencode/autoinvoke: true \uB610\uB294 false\uC785\uB2C8\uB2E4. \uB2E4\uB978 YAML \uBB38\uBC95\uC740 \uC9C0\uC6D0\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4."
});

// apps/desktop-app/src/renderer/shared/configuration-draft/skill-runtime.mjs
var SKILL_RUNTIME_FEATURE = "configuration_skill_runtime_v1";
var steps = Object.freeze({
  "configuration.skill.register": "native.skill.register",
  "configuration.skill.remove": "native.skill.remove",
  "configuration.skill.apply": "native.skill.apply"
});
var skillRuntimeStep = (type) => Object.hasOwn(steps, type) ? steps[type] : void 0;
var id = (v) => typeof v === "string" && /^[\w.:-]{1,256}$/u.test(v);
var hex = (v) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
var closed = (v, required, optional = []) => Boolean(
  v && Object.getPrototypeOf(v) === Object.prototype && required.every((k) => Object.hasOwn(v, k)) && Reflect.ownKeys(v).every(
    (k) => typeof k === "string" && (required.includes(k) || optional.includes(k)) && Object.hasOwn(Object.getOwnPropertyDescriptor(v, k), "value")
  )
);
var validSkillNativeId = (v) => typeof v === "string" && /^omoc-skill-[a-f0-9]{64}$/u.test(v);
var registrationFields = [
  "sourceName",
  "nativeId",
  "digest",
  "nativeDigest",
  "registrationRuntimeEpoch",
  "registrationOperationId"
];
var registration = (v) => validSkillSourceName(v.sourceName) && validSkillNativeId(v.nativeId) && hex(v.digest) && hex(v.nativeDigest) && id(v.registrationRuntimeEpoch) && id(v.registrationOperationId);
function validSkillRuntimeMutation(v) {
  if (!id(v?.requestId)) return false;
  if (v.status === "unknown") return closed(v, ["requestId", "status"]);
  const common = ["requestId", "status", ...registrationFields];
  if (!registration(v)) return false;
  if (v.status === "registered_disabled")
    return closed(v, [...common, "version", "directoryVersion", "bodyDigest"]) && hex(v.version) && hex(v.directoryVersion) && hex(v.bodyDigest);
  if (v.status === "removed") return closed(v, common);
  return v.status === "applied" && closed(v, [
    ...common,
    "sessionId",
    "nativeSessionId",
    "nativeMessageId",
    "bodyDigest"
  ]) && id(v.sessionId) && id(v.nativeSessionId) && id(v.nativeMessageId) && hex(v.bodyDigest);
}

// apps/desktop-app/src/native-skills-protocol.mjs
import { createHash } from "node:crypto";
import { isAbsolute, join, normalize } from "node:path";
var hex2 = (v) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
var identifier = (v) => typeof v === "string" && /^[\w.:-]{1,256}$/u.test(v);
var data = (v) => v && Object.getPrototypeOf(v) === Object.prototype && Reflect.ownKeys(v).every(
  (k) => typeof k === "string" && Object.hasOwn(Object.getOwnPropertyDescriptor(v, k), "value")
);
var closed2 = (v, required, optional = []) => Boolean(
  data(v) && required.every((k) => Object.hasOwn(v, k)) && Reflect.ownKeys(v).every(
    (k) => required.includes(k) || optional.includes(k)
  )
);
var safe = (v, max) => typeof v === "string" && v.length <= max && v.isWellFormed() && ![...v].some(
  (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) >= 127 && c.charCodeAt(0) <= 159
);
var root = (v) => safe(v, 32768) && isAbsolute(v) && normalize(v) === v && v !== "/";
var sha = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
var NATIVE_SKILL_LIMITS = Object.freeze({
  owned: 16,
  native: 64,
  operations: 256
});
function validSkillOwner(v) {
  return closed2(v, [
    "runtimeEpoch",
    "operationId",
    "workspaceId",
    "workspacePath",
    "sourceName",
    "digest"
  ]) && identifier(v.runtimeEpoch) && identifier(v.operationId) && identifier(v.workspaceId) && root(v.workspacePath) && validSkillSourceName(v.sourceName) && hex2(v.digest);
}
function nativeSkillRegistrationId(identity) {
  if (!identifier(identity?.runtimeEpoch) || !identifier(identity?.workspaceId) || !identifier(identity?.operationId) || !validSkillSourceName(identity?.sourceName))
    throw new Error("native_skill_invalid");
  return "omoc-skill-" + sha([
    identity.runtimeEpoch,
    identity.workspaceId,
    identity.sourceName,
    identity.operationId
  ]);
}
function nativeSkillId(owner) {
  if (!validSkillOwner(owner)) throw new Error("native_skill_invalid");
  return nativeSkillRegistrationId(owner);
}
function validNativeSkillShape(v) {
  return closed2(
    v,
    ["id", "name", "autoinvoke", "path", "content"],
    ["description"]
  ) && safe(v.id, 512) && Boolean(v.id) && safe(v.name, 256) && Boolean(v.name.trim()) && v.autoinvoke === false && root(v.path) && skillFileContentFits(v.content) && (!Object.hasOwn(v, "description") || safe(v.description, 1024) && Boolean(v.description.trim()));
}
function validObservedNativeSkill(v) {
  if (!closed2(v, ["id", "name", "path", "content"], ["description", "autoinvoke"]))
    return false;
  if (Object.hasOwn(v, "autoinvoke") && typeof v.autoinvoke !== "boolean")
    return false;
  return validNativeSkillShape({ ...v, autoinvoke: false });
}
function validNativeSkill(v, owner) {
  return Boolean(
    validSkillOwner(owner) && validNativeSkillShape(v) && v.content.trim() && v.id === nativeSkillId(owner) && v.path === join(
      owner.workspacePath,
      ".opencode",
      "skills",
      owner.sourceName,
      "SKILL.md"
    )
  );
}
function nativeSkillDigest(v) {
  if (!validNativeSkillShape(v)) throw new Error("native_skill_invalid");
  return sha([
    v.id,
    v.name,
    v.description ?? null,
    v.autoinvoke,
    v.path,
    v.content
  ]);
}
function validateSkillRpc(method, v) {
  let valid = false;
  if (method === "observe")
    valid = closed2(v, ["nonce", "workspaceId", "workspacePath"]) && hex2(v.nonce) && identifier(v.workspaceId) && root(v.workspacePath);
  if (method === "registerDisabled")
    valid = closed2(v, [
      "nonce",
      "owner",
      "record",
      "recordDigest",
      "expectedNativeId"
    ]) && hex2(v.nonce) && validNativeSkill(v.record, v.owner) && v.recordDigest === nativeSkillDigest(v.record) && (v.expectedNativeId === null || typeof v.expectedNativeId === "string" && /^omoc-skill-[a-f0-9]{64}$/u.test(v.expectedNativeId));
  if (method === "removeOwned")
    valid = closed2(v, [
      "nonce",
      "owner",
      "registration",
      "nativeId",
      "recordDigest"
    ]) && hex2(v.nonce) && validSkillOwner(v.owner) && validSkillOwner(v.registration) && ["workspaceId", "workspacePath", "sourceName"].every(
      (k) => v.owner[k] === v.registration[k]
    ) && v.nativeId === nativeSkillId(v.registration) && hex2(v.recordDigest);
  if (!valid) throw new Error("native_skill_invalid");
  return v;
}
function validateSkillRpcResult(method, value) {
  const invalid = () => {
    throw new Error("native_skill_invalid");
  };
  const unknown = () => closed2(value, ["status", "reason"]) && value.status === "unknown" && ["reload_failed", "verification_failed"].includes(value.reason);
  if (method === "observe") {
    if (closed2(value, ["status", "reason"]) && value.status === "unavailable" && [
      "identity_conflict",
      "retained_limit",
      "runtime_error",
      "invalid_context"
    ].includes(value.reason))
      return value;
    if (!closed2(value, [
      "status",
      "version",
      "workspaceId",
      "workspacePath",
      "rows",
      "native"
    ]) || value.status !== "ready" || value.version !== 1 || !identifier(value.workspaceId) || !root(value.workspacePath) || !Array.isArray(value.rows) || value.rows.length > NATIVE_SKILL_LIMITS.owned || !Array.isArray(value.native) || value.native.length > NATIVE_SKILL_LIMITS.native || value.native.some((record) => !validObservedNativeSkill(record)) || new Set(value.native.map((record) => record.id)).size !== value.native.length)
      invalid();
    const sources = /* @__PURE__ */ new Set();
    for (const row of value.rows) {
      if (!closed2(row, ["owner", "record", "recordDigest"]) || !validSkillOwner(row.owner) || row.owner.workspaceId !== value.workspaceId || row.owner.workspacePath !== value.workspacePath || !validNativeSkill(row.record, row.owner) || row.recordDigest !== nativeSkillDigest(row.record) || sources.has(row.owner.sourceName))
        invalid();
      const native = value.native.find((record) => record.id === row.record.id);
      if (!validNativeSkill(native, row.owner) || nativeSkillDigest(native) !== row.recordDigest)
        invalid();
      sources.add(row.owner.sourceName);
    }
    return value;
  }
  if (unknown() && ["registerDisabled", "removeOwned"].includes(method))
    return value;
  if (method === "registerDisabled") {
    if (!closed2(value, [
      "status",
      "owner",
      "record",
      "recordDigest",
      "previousNativeId"
    ]) || value.status !== "registered_disabled" || !validNativeSkill(value.record, value.owner) || value.recordDigest !== nativeSkillDigest(value.record) || !(value.previousNativeId === null || typeof value.previousNativeId === "string" && /^omoc-skill-[a-f0-9]{64}$/u.test(value.previousNativeId) && value.previousNativeId !== value.record.id))
      invalid();
    return value;
  }
  if (method === "removeOwned") {
    if (!closed2(value, [
      "status",
      "owner",
      "registration",
      "nativeId",
      "recordDigest"
    ]) || value.status !== "removed" || !validSkillOwner(value.owner) || !validSkillOwner(value.registration) || value.owner.workspaceId !== value.registration.workspaceId || value.owner.workspacePath !== value.registration.workspacePath || value.owner.sourceName !== value.registration.sourceName || value.nativeId !== nativeSkillId(value.registration) || !hex2(value.recordDigest))
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
      }
    }
  };
}
function freeze(v) {
  if (v && typeof v === "object") {
    for (const value of Object.values(v)) freeze(value);
    Object.freeze(v);
  }
  return v;
}
var denied = portable((value) => {
  if (!closed2(value, ["code"]) || ![
    "invalid_context",
    "nonce_mismatch",
    "identity_conflict",
    "retained_limit",
    "collision",
    "changed"
  ].includes(value.code))
    throw new Error("native_skill_invalid");
  return value;
});
var NATIVE_SKILLS_RPC = freeze({
  id: "omoc.workbench.skills.v1",
  events: {},
  methods: Object.fromEntries(
    ["observe", "registerDisabled", "removeOwned"].map((method) => [
      method,
      {
        input: portable((value) => validateSkillRpc(method, value)),
        output: portable((value) => validateSkillRpcResult(method, value)),
        errors: { denied }
      }
    ])
  )
});

// apps/desktop-app/src/host/workbench-skill-runtime-storage.mjs
var SKILL_RUNTIME_DISPATCH_FIELDS = Object.freeze([
  "sourceName",
  "nativeId",
  "digest",
  "nativeDigest",
  "registrationRuntimeEpoch",
  "registrationOperationId",
  "bodyDigest"
]);
var SKILL_RUNTIME_RESULT_FIELDS = Object.freeze({
  skill_registered: [
    ...SKILL_RUNTIME_DISPATCH_FIELDS,
    "version",
    "directoryVersion"
  ],
  skill_removed: SKILL_RUNTIME_DISPATCH_FIELDS.filter(
    (k) => k !== "bodyDigest"
  ),
  skill_applied: [
    ...SKILL_RUNTIME_DISPATCH_FIELDS,
    "sessionId",
    "nativeSessionId",
    "nativeMessageId"
  ]
});
var hex3 = (v) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
var id2 = (v) => typeof v === "string" && /^[\w.:-]{1,256}$/u.test(v);
var closed3 = (v, keys) => Boolean(
  v && Object.getPrototypeOf(v) === Object.prototype && keys.every((k) => Object.hasOwn(v, k)) && Reflect.ownKeys(v).every(
    (k) => typeof k === "string" && keys.includes(k) && Object.hasOwn(Object.getOwnPropertyDescriptor(v, k), "value")
  )
);
var need = (ok, code = "identity_conflict") => {
  if (!ok) throw Object.assign(new Error(code), { code });
};
var register = (type) => type === "configuration.skill.register";
var apply = (type) => type === "configuration.skill.apply";
var kind = (type) => ({
  "configuration.skill.register": "skill_registered",
  "configuration.skill.remove": "skill_removed",
  "configuration.skill.apply": "skill_applied"
})[type];
var registrationId = (identity, target) => nativeSkillRegistrationId({
  runtimeEpoch: target.registrationRuntimeEpoch,
  operationId: target.registrationOperationId,
  workspaceId: identity.workspaceId,
  sourceName: target.sourceName
});
function validateSkillRuntimeScope(identity) {
  if (!skillRuntimeStep(identity.type)) return;
  need(
    id2(identity.workspaceId) && (apply(identity.type) ? id2(identity.sessionId) : !Object.hasOwn(identity, "sessionId")),
    "invalid_record"
  );
}
function validateSkillRuntimeAdmission(value) {
  const { identity, skillRuntime } = value;
  if (!skillRuntimeStep(identity.type)) {
    need(!Object.hasOwn(value, "skillRuntime"), "invalid_record");
    return;
  }
  validateSkillRuntimeScope(identity);
  need(
    closed3(
      skillRuntime,
      register(identity.type) ? ["sourceName", "nativeId", "digest", "version", "directoryVersion"] : ["nativeId"]
    ),
    "invalid_record"
  );
  need(validSkillNativeId(skillRuntime.nativeId), "invalid_record");
  if (register(identity.type))
    need(
      validSkillSourceName(skillRuntime.sourceName) && ["digest", "version", "directoryVersion"].every(
        (k) => hex3(skillRuntime[k])
      ) && skillRuntime.nativeId === nativeSkillRegistrationId({
        ...identity,
        sourceName: skillRuntime.sourceName
      }),
      "invalid_record"
    );
}
function validateSkillRuntimeDispatchPayload(dispatch) {
  const isStep = [
    "native.skill.register",
    "native.skill.remove",
    "native.skill.apply"
  ].includes(dispatch.step);
  if (!isStep) {
    need(!Object.hasOwn(dispatch, "skillRuntime"), "invalid_record");
    return;
  }
  const t = dispatch.skillRuntime;
  need(
    closed3(t, SKILL_RUNTIME_DISPATCH_FIELDS) && validSkillSourceName(t.sourceName) && validSkillNativeId(t.nativeId) && ["digest", "nativeDigest", "bodyDigest"].every((k) => hex3(t[k])) && id2(t.registrationRuntimeEpoch) && id2(t.registrationOperationId) && (dispatch.step === "native.skill.apply" ? id2(dispatch.nativeSessionId) : !Object.hasOwn(dispatch, "nativeSessionId")) && !Object.hasOwn(dispatch, "nativeServerName"),
    "invalid_record"
  );
}
function validSkillRuntimeResult(record) {
  const r = record.result;
  if (!r || !skillRuntimeStep(record.type) || !closed3(r, [
    "kind",
    "workspaceId",
    ...SKILL_RUNTIME_RESULT_FIELDS[kind(record.type)]
  ]))
    return false;
  const { kind: _kind, workspaceId: _workspace, ...fields } = r;
  const status = {
    skill_registered: "registered_disabled",
    skill_removed: "removed",
    skill_applied: "applied"
  }[r.kind];
  try {
    validateSkillRuntimeScope({
      type: record.type,
      workspaceId: record.workspaceId,
      ...record.sessionId !== void 0 && { sessionId: record.sessionId }
    });
    return Boolean(
      r.kind === kind(record.type) && r.workspaceId === record.workspaceId && record.admission === "dispatched" && record.delivery === "accepted" && record.effect === "confirmed" && validSkillRuntimeMutation({
        requestId: record.operationId,
        status,
        ...fields
      }) && r.nativeId === registrationId(record, r) && (register(record.type) ? r.registrationRuntimeEpoch === record.runtimeEpoch && r.registrationOperationId === record.operationId : r.registrationRuntimeEpoch === record.runtimeEpoch) && (!apply(record.type) || r.sessionId === record.sessionId)
    );
  } catch {
    return false;
  }
}
function validateSkillRuntimeReceipt(receipt) {
  if (!skillRuntimeStep(receipt.type)) return;
  validateSkillRuntimeScope(receipt);
  if (receipt.effect === "confirmed")
    need(validSkillRuntimeResult(receipt), "invalid_record");
  else
    need(
      (receipt.result === void 0 || receipt.result.kind === "rejected" && receipt.admission === "rejected" && receipt.effect === "none") && !(receipt.delivery === "accepted" && receipt.effect === "none"),
      "invalid_record"
    );
}
function validateSkillRuntimeDispatch(operation, dispatch, sessions, operations) {
  const expected = skillRuntimeStep(operation.identity.type);
  if (!expected && !dispatch.step.startsWith("native.skill.") && !Object.hasOwn(dispatch, "skillRuntime"))
    return;
  validateSkillRuntimeDispatchPayload(dispatch);
  need(expected === dispatch.step);
  const { identity, skillRuntime: admitted } = operation;
  const target = dispatch.skillRuntime;
  need(
    admitted && target.nativeId === admitted.nativeId && target.nativeId === registrationId(identity, target)
  );
  if (register(identity.type)) {
    need(
      target.registrationRuntimeEpoch === identity.runtimeEpoch && target.registrationOperationId === identity.operationId && ["sourceName", "digest"].every((k) => target[k] === admitted[k])
    );
  } else {
    const original = operations.get(
      JSON.stringify([
        target.registrationRuntimeEpoch,
        target.registrationOperationId
      ])
    );
    need(
      target.registrationRuntimeEpoch === identity.runtimeEpoch && original?.terminal && original.identity.type === "configuration.skill.register" && original.identity.workspaceId === identity.workspaceId && validSkillRuntimeResult(original.receipt) && SKILL_RUNTIME_DISPATCH_FIELDS.every(
        (k) => target[k] === original.receipt.result[k]
      )
    );
  }
  if (apply(identity.type)) {
    const mapped = sessions.get(identity.sessionId);
    need(
      mapped?.workspaceId === identity.workspaceId && mapped.lifecycleState === "active" && mapped.nativeSessionId === dispatch.nativeSessionId && id2(dispatch.nativeSessionId)
    );
  }
}
function validateSkillRuntimeCompletion(operation, payload, features, sessions, operations) {
  if (!skillRuntimeStep(operation.identity.type)) return;
  need(features.includes(SKILL_RUNTIME_FEATURE), "unsupported_version");
  const { receipt, delta } = payload;
  need(
    !operation.reservation && !operation.reserved && delta.workspaces.length === 0 && delta.sessions.length === 0 && delta.tombstones.length === 0
  );
  validateSkillRuntimeReceipt(receipt);
  if (receipt.effect !== "confirmed") return;
  need(operation.dispatches.length === 1);
  const dispatch = operation.dispatches[0];
  validateSkillRuntimeDispatch(operation, dispatch, sessions, operations);
  need(
    SKILL_RUNTIME_DISPATCH_FIELDS.filter(
      (k) => receipt.result.kind !== "skill_removed" || k !== "bodyDigest"
    ).every((k) => receipt.result[k] === dispatch.skillRuntime[k])
  );
  if (register(operation.identity.type))
    need(
      ["version", "directoryVersion"].every(
        (k) => receipt.result[k] === operation.skillRuntime[k]
      )
    );
  if (apply(operation.identity.type))
    need(receipt.result.nativeSessionId === dispatch.nativeSessionId);
}

// apps/desktop-app/src/host/configuration-file-observation.mjs
import { createHash as createHash2 } from "node:crypto";
function configurationBackupId(runtimeEpoch, operationId, kind2) {
  if (![runtimeEpoch, operationId].every(
    (v) => typeof v === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(v)
  ) || !["instructions", "mcp", "skill"].includes(kind2))
    throw new Error("invalid_request");
  const key = createHash2("sha256").update(JSON.stringify([runtimeEpoch, operationId])).digest("hex");
  return `.omoc-configuration-${key}.${kind2}.backup`;
}

// apps/desktop-app/src/host/workbench-skill-storage.mjs
var SKILL_FEATURE = "configuration_skill_files_v1";
var isSkillSave = (type) => type === "configuration.skill.save";
var wireId = (value) => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
var resourceId = (value) => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,256}$/.test(value);
var skillBackupId = (runtimeEpoch, operationId) => configurationBackupId(runtimeEpoch, operationId, "skill");
function validSkillSavedResult(record, sourceName) {
  const result = record.result;
  return !!(isSkillSave(record.type) && wireId(record.runtimeEpoch) && wireId(record.operationId) && resourceId(record.workspaceId) && record.sessionId === void 0 && record.admission === "dispatched" && record.delivery === "accepted" && record.effect === "confirmed" && validSkillSourceName(sourceName) && result && Object.getPrototypeOf(result) === Object.prototype && ["kind", "workspaceId", "sourceName", "version"].every(
    (key) => Object.hasOwn(result, key)
  ) && Object.keys(result).every(
    (key) => ["kind", "workspaceId", "sourceName", "version", "backupId"].includes(
      key
    )
  ) && result.kind === "skill_file_saved" && result.workspaceId === record.workspaceId && result.sourceName === sourceName && typeof result.version === "string" && /^[a-f0-9]{64}$/.test(result.version) && (!Object.hasOwn(result, "backupId") || result.backupId === skillBackupId(record.runtimeEpoch, record.operationId)));
}

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

// apps/desktop-app/src/workbench-contract.mjs
var ERRORS = Object.freeze({
  SKILL_CHANGED: "The Native Skill observation changed.",
  SKILL_UNVERIFIED: "The Native Skill identity or history could not be verified.",
  SKILL_UNSUPPORTED: "The Skill file cannot be converted for Native registration.",
  SKILL_OWNERSHIP_CONFLICT: "The Native Skill is not owned by this runtime.",
  SKILL_ALREADY_APPLIED: "This Native Skill already has a record in the session.",
  MCP_CHANGED: "The MCP catalog changed after its observation.",
  MCP_UNVERIFIED: "The MCP status or ownership could not be verified.",
  MCP_UNSUPPORTED: "This MCP definition cannot be converted for runtime use.",
  MCP_OWNERSHIP_CONFLICT: "This MCP registration is not owned by the current runtime.",
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
  FILE_CHANGED: "The configuration file changed after its observation.",
  INSTRUCTIONS_CHANGED: "The session instruction registration changed after its observation.",
  INSTRUCTIONS_UNVERIFIED: "The session instruction ownership or state could not be verified.",
  FILE_DENIED: "This path cannot be accessed in the text preview.",
  FILE_UNSUPPORTED: "This file is not supported by the text preview.",
  FILE_TOO_LARGE: "This file exceeds the text preview limit.",
  RUNTIME_ERROR: "The runtime operation failed.",
  TOOL_ERROR: "A tool operation failed.",
  UNKNOWN_OUTCOME: "The operation outcome is unknown. It will not be resent automatically."
});
function validMcpSourceName(value) {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(value) && !["__proto__", "prototype", "constructor"].includes(value);
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
  "configuration.skill.runtime.read",
  "configuration.skill.list",
  "configuration.skill.read",
  "configuration.mcp.read",
  "configuration.instructions.read",
  "snapshot",
  "diagnostics.list",
  "catalog.list",
  "file.list",
  "file.read",
  "configuration.read",
  "operation.lookup"
]);
function validWireId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
}
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

// apps/desktop-app/src/host/workbench-mcp.mjs
import { createHash as createHash3 } from "node:crypto";
var MCP_FEATURE = "configuration_mcp_v1";
var MCP_STATUSES = Object.freeze([
  "connected",
  "pending",
  "disabled",
  "failed",
  "needs_auth"
]);
var mcpDigest = (value) => createHash3("sha256").update(value, "utf8").digest("hex");
var validMcpNativeName = (value) => typeof value === "string" && /^omoc-mcp-[a-f0-9]{40}$/.test(value);
function mcpNativeName(workspaceId, sourceName) {
  if (typeof workspaceId !== "string" || !/^[\w.:-]{1,256}$/.test(workspaceId) || !validMcpSourceName(sourceName))
    throw new Error("invalid_mcp_identity");
  return `omoc-mcp-${mcpDigest(JSON.stringify([workspaceId, sourceName])).slice(0, 40)}`;
}
function mcpStep(type) {
  const steps2 = {
    "configuration.mcp.register": "native.mcp.add",
    "configuration.mcp.connect": "native.mcp.connect",
    "configuration.mcp.disconnect": "native.mcp.disconnect",
    "configuration.mcp.remove": "native.mcp.remove"
  };
  return Object.hasOwn(steps2, type) ? steps2[type] : void 0;
}

// apps/desktop-app/src/host/storage-journal.mjs
import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import { createHash as createHash4 } from "node:crypto";
import { isAbsolute as isAbsolute2, join as join2, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

// apps/desktop-app/src/host/workbench-instructions.mjs
var INSTRUCTION_KEY = "omoc.project-instructions";
var INSTRUCTION_FEATURE = "configuration_instructions_v1";
var digest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
var id3 = (value) => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,256}$/.test(value);
function validInstructionRegistration(value) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || value.key !== INSTRUCTION_KEY)
    return false;
  if (value.state === "absent") return Object.keys(value).length === 2;
  if (value.state !== "registered" || !digest(value.digest) || !digest(value.sourceVersion))
    return false;
  const fields = ["state", "key", "digest", "sourceVersion", "origin"];
  if (value.origin === "fork") {
    if (!id3(value.inheritedFromSessionId)) return false;
    fields.push("inheritedFromSessionId");
  } else if (value.origin !== "direct") return false;
  return Object.keys(value).length === fields.length && fields.every((key) => Object.hasOwn(value, key));
}
function canonicalInstructionRegistration(value) {
  if (value === void 0) return null;
  if (!validInstructionRegistration(value))
    throw new Error("invalid_instruction_registration");
  if (value.state === "absent")
    return { state: "absent", key: INSTRUCTION_KEY };
  return {
    state: "registered",
    key: INSTRUCTION_KEY,
    digest: value.digest,
    sourceVersion: value.sourceVersion,
    origin: value.origin,
    ...value.origin === "fork" && {
      inheritedFromSessionId: value.inheritedFromSessionId
    }
  };
}

// apps/desktop-app/src/host/storage-journal.mjs
var STORAGE_LIMITS = Object.freeze({
  recordBytes: 4 * 1024 * 1024,
  operations: 2048,
  workspaces: 100,
  sessions: 200
});
var STORE_RECOVERY_REASONS2 = Object.freeze([
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
var RESOURCE_RECOVERY_REASONS2 = Object.freeze([
  "path_missing",
  "path_denied",
  "path_conflict",
  "native_mapping_unverified",
  "partial_native_mapping",
  "unresolved_operation"
]);
var mutations = /* @__PURE__ */ new Set([
  "configuration.skill.register",
  "configuration.skill.remove",
  "configuration.skill.apply",
  "configuration.mcp.register",
  "configuration.mcp.connect",
  "configuration.mcp.disconnect",
  "configuration.mcp.remove",
  "configuration.save",
  "configuration.skill.save",
  "configuration.instructions.apply",
  "configuration.instructions.remove",
  "session.rename",
  "session.pin",
  "session.archive",
  "session.fork",
  "session.remove",
  "workspace.import",
  "workspace.create",
  "workspace.remove",
  "session.create",
  "message.send",
  "session.interrupt",
  "permission.respond",
  "command.run"
]);
var DISPATCH_STEPS = Object.freeze([
  "native.skill.register",
  "native.skill.remove",
  "native.skill.apply",
  "native.mcp.add",
  "native.mcp.connect",
  "native.mcp.disconnect",
  "native.mcp.remove",
  "filesystem.configuration.stage",
  "filesystem.configuration.publish",
  "native.instructions.put",
  "native.instructions.remove",
  "native.create",
  "native.fork",
  "native.remove",
  "native.rename",
  "native.pin",
  "native.archive",
  "native.metadata",
  "native.send",
  "native.command",
  "native.interrupt",
  "native.permission",
  "native.policy",
  "native.policy.before_selection",
  "native.policy.after_selection",
  "native.agent",
  "native.model",
  "registry.metadata",
  "registry.unregister",
  "filesystem.managed_base",
  "filesystem.managed_folder"
]);
var zeroHash = "0".repeat(64);
var clone = (value) => JSON.parse(JSON.stringify(value));
var hash = (value) => createHash4("sha256").update(JSON.stringify(value)).digest("hex");
function storageError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
function need2(condition, code = "invalid_record") {
  if (!condition) throw storageError(code);
}
function closed4(value, required, optional = []) {
  need2(
    value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype
  );
  need2(
    required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every(
      (key) => [...required, ...optional].includes(key)
    )
  );
}
var integer = (value) => Number.isSafeInteger(value) && value >= 0;
var digest2 = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
var id4 = (value) => validWireId(value);
var resourceId2 = (value) => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,256}$/.test(value);
var displayText = (value) => ![...value].some(
  (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127
);
var path = (value) => typeof value === "string" && value.length <= 4096 && !value.includes("\0") && isAbsolute2(value) && resolve(value) === value;
function optionalIds(value, names) {
  for (const name of names)
    if (Object.hasOwn(value, name)) need2(resourceId2(value[name]));
}
function validateStorageIdentity(value) {
  closed4(
    value,
    ["runtimeEpoch", "operationId", "type", "digest"],
    ["workspaceId", "sessionId"]
  );
  need2(
    id4(value.runtimeEpoch) && id4(value.operationId) && mutations.has(value.type) && digest2(value.digest)
  );
  optionalIds(value, ["workspaceId", "sessionId"]);
  need2(!value.sessionId || value.workspaceId);
  if (isSkillSave(value.type))
    need2(value.workspaceId && !Object.hasOwn(value, "sessionId"));
  if (instructionStep(value.type)) need2(value.workspaceId && value.sessionId);
  if (mcpStep(value.type))
    need2(value.workspaceId && !Object.hasOwn(value, "sessionId"));
  validateSkillRuntimeScope(value);
  return clone(value);
}
function validateStorageReceipt(value) {
  closed4(
    value,
    [
      "runtimeEpoch",
      "operationId",
      "type",
      "admission",
      "delivery",
      "effect",
      "revision",
      "evidence"
    ],
    ["workspaceId", "sessionId", "result"]
  );
  need2(
    id4(value.runtimeEpoch) && id4(value.operationId) && mutations.has(value.type) && integer(value.revision)
  );
  optionalIds(value, ["workspaceId", "sessionId"]);
  need2(!value.sessionId || value.workspaceId);
  need2(["admitted", "dispatched", "rejected"].includes(value.admission));
  need2(
    ["pending", "accepted", "unknown"].includes(value.delivery) && ["none", "pending", "confirmed", "unknown"].includes(value.effect)
  );
  need2(Array.isArray(value.evidence) && value.evidence.length <= 8);
  for (const entry of value.evidence) {
    closed4(entry, ["kind"], ["id"]);
    need2(resourceId2(entry.kind));
    optionalIds(entry, ["id"]);
  }
  if (Object.hasOwn(value, "result")) {
    const result = value.result;
    need2(result !== null && typeof result === "object");
    const shapes = {
      created: [
        ["kind", "workspaceId"],
        ["sessionId", "nativeSessionId"]
      ],
      forked: [["kind", "workspaceId", "sessionId", "nativeSessionId"], []],
      removed: [
        ["kind", "workspaceId", "workspaceRemoved"],
        ["removedSessionIds"]
      ],
      metadata: [["kind", "workspaceId", "sessionId"], []],
      skill_file_saved: [
        ["kind", "workspaceId", "sourceName", "version"],
        ["backupId"]
      ],
      configuration_saved: [
        ["kind", "workspaceId", "configurationKind", "version"],
        ["backupId"]
      ],
      mcp_registered: [
        [
          "kind",
          "workspaceId",
          "sourceName",
          "nativeName",
          "digest",
          "sourceVersion",
          "status"
        ],
        []
      ],
      mcp_connection: [
        [
          "kind",
          "workspaceId",
          "sourceName",
          "nativeName",
          "action",
          "connectionStatus"
        ],
        []
      ],
      mcp_removed: [["kind", "workspaceId", "sourceName", "nativeName"], []],
      instruction_registered: [
        ["kind", "workspaceId", "sessionId", "digest", "sourceVersion"],
        []
      ],
      instruction_removed: [["kind", "workspaceId", "sessionId"], []],
      delivery: [
        ["kind", "status"],
        ["nativeInboxId", "nativeRequestId"]
      ],
      rejected: [["kind", "code"], []]
    };
    for (const [kind2, fields] of Object.entries(SKILL_RUNTIME_RESULT_FIELDS))
      shapes[kind2] = [["kind", "workspaceId", ...fields], []];
    need2(Object.hasOwn(shapes, result.kind));
    closed4(result, ...shapes[result.kind]);
    if (Object.hasOwn(SKILL_RUNTIME_RESULT_FIELDS, result.kind))
      need2(skillRuntimeStep(value.type));
    optionalIds(result, [
      "workspaceId",
      "sessionId",
      "nativeSessionId",
      "nativeInboxId",
      "nativeRequestId"
    ]);
    if (["mcp_registered", "mcp_connection", "mcp_removed"].includes(result.kind)) {
      need2(
        mcpStep(value.type) && value.workspaceId === result.workspaceId && !Object.hasOwn(value, "sessionId") && validMcpSourceName(result.sourceName) && validMcpNativeName(result.nativeName) && result.nativeName === mcpNativeName(value.workspaceId, result.sourceName) && value.delivery === "accepted" && (value.effect === "confirmed" && value.admission === "dispatched" || isMcpAbsentRemoval(value))
      );
      if (result.kind === "mcp_registered")
        need2(
          value.type === "configuration.mcp.register" && digest2(result.digest) && digest2(result.sourceVersion) && result.status === "disabled"
        );
      if (result.kind === "mcp_connection")
        need2(
          value.type === "configuration.mcp.connect" && result.action === "connect" && ["connected", "failed", "needs_auth"].includes(
            result.connectionStatus
          ) || value.type === "configuration.mcp.disconnect" && result.action === "disconnect" && result.connectionStatus === "disabled"
        );
      if (result.kind === "mcp_removed")
        need2(value.type === "configuration.mcp.remove");
    }
    if (result.kind === "skill_file_saved")
      need2(validSkillSavedResult(value, result.sourceName));
    if (result.kind === "configuration_saved")
      need2(
        value.type === "configuration.save" && value.workspaceId === result.workspaceId && value.effect === "confirmed" && ["instructions", "mcp"].includes(result.configurationKind) && digest2(result.version) && (result.backupId === void 0 || typeof result.backupId === "string" && new RegExp(
          `^\\.omoc-configuration-[a-f0-9]{64}\\.${result.configurationKind}\\.backup$`
        ).test(result.backupId))
      );
    if (["instruction_registered", "instruction_removed"].includes(result.kind)) {
      need2(
        value.type === (result.kind === "instruction_registered" ? "configuration.instructions.apply" : "configuration.instructions.remove") && value.workspaceId === result.workspaceId && value.sessionId === result.sessionId && value.admission === "dispatched" && value.delivery === "accepted" && value.effect === "confirmed"
      );
      if (result.kind === "instruction_registered")
        need2(digest2(result.digest) && digest2(result.sourceVersion));
    }
    if (result.kind === "removed") {
      need2(typeof result.workspaceRemoved === "boolean");
      if (Object.hasOwn(result, "removedSessionIds"))
        need2(
          Array.isArray(result.removedSessionIds) && result.removedSessionIds.length <= 200 && result.removedSessionIds.every(resourceId2) && new Set(result.removedSessionIds).size === result.removedSessionIds.length
        );
    }
    if (result.kind === "delivery")
      need2(["accepted", "stopping", "decided"].includes(result.status));
    if (result.kind === "rejected") need2(Object.hasOwn(ERRORS, result.code));
  }
  if (mcpStep(value.type)) {
    need2(value.workspaceId && !Object.hasOwn(value, "sessionId"));
    need2(
      value.result === void 0 || [
        "mcp_registered",
        "mcp_connection",
        "mcp_removed",
        "rejected"
      ].includes(value.result.kind)
    );
    if (value.effect === "confirmed")
      need2(value.result && value.result.kind !== "rejected");
    if (value.result?.kind === "rejected")
      need2(value.admission === "rejected" && value.effect === "none");
    if (value.effect === "none" && value.delivery === "accepted")
      need2(isMcpAbsentRemoval(value));
  }
  if (isSkillSave(value.type)) {
    need2(value.workspaceId && !Object.hasOwn(value, "sessionId"));
    if (value.effect === "confirmed")
      need2(validSkillSavedResult(value, value.result?.sourceName));
    else
      need2(
        value.result === void 0 || value.result.kind === "rejected" && value.admission === "rejected" && value.effect === "none"
      );
  }
  validateSkillRuntimeReceipt(value);
  return clone(value);
}
function validateRegistryDelta(value) {
  closed4(value, ["workspaces", "sessions", "tombstones"]);
  need2(
    Array.isArray(value.workspaces) && value.workspaces.length <= 100 && Array.isArray(value.sessions) && value.sessions.length <= 200 && Array.isArray(value.tombstones) && value.tombstones.length <= 300
  );
  for (const workspace of value.workspaces) {
    closed4(
      workspace,
      ["workspaceId", "ownership", "canonicalPath", "registrationState"],
      ["folderSessionId", "name", "trustRevision", "storageGeneration"]
    );
    need2(
      resourceId2(workspace.workspaceId) && ["managed", "imported", "legacy"].includes(workspace.ownership) && path(workspace.canonicalPath) && ["reserved", "registered", "unavailable"].includes(
        workspace.registrationState
      )
    );
    optionalIds(workspace, ["folderSessionId"]);
    if (workspace.ownership === "managed")
      need2(
        typeof workspace.folderSessionId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
          workspace.folderSessionId
        )
      );
    if (workspace.name !== void 0)
      need2(
        typeof workspace.name === "string" && workspace.name.length <= 256 && displayText(workspace.name)
      );
    for (const key of ["trustRevision", "storageGeneration"])
      if (workspace[key] !== void 0) need2(integer(workspace[key]));
  }
  for (const session of value.sessions) {
    closed4(
      session,
      ["appSessionId", "workspaceId", "lifecycleState", "pinned", "archived"],
      [
        "nativeSessionId",
        "parentSessionId",
        "title",
        "lastViewedAt",
        "recoveryReason",
        "instructionRegistration"
      ]
    );
    need2(
      resourceId2(session.appSessionId) && resourceId2(session.workspaceId) && ["reserved", "active", "unavailable"].includes(
        session.lifecycleState
      ) && typeof session.pinned === "boolean" && typeof session.archived === "boolean"
    );
    optionalIds(session, ["nativeSessionId", "parentSessionId"]);
    if (Object.hasOwn(session, "instructionRegistration"))
      need2(validInstructionRegistration(session.instructionRegistration));
    if (session.title !== void 0)
      need2(
        typeof session.title === "string" && session.title.length <= 256 && displayText(session.title)
      );
    if (session.lastViewedAt !== void 0) need2(integer(session.lastViewedAt));
    if (session.recoveryReason !== void 0)
      need2(
        session.lifecycleState === "unavailable" && RESOURCE_RECOVERY_REASONS2.includes(session.recoveryReason)
      );
  }
  for (const entry of value.tombstones) {
    closed4(entry, ["kind", "id"]);
    need2(["workspace", "session"].includes(entry.kind) && resourceId2(entry.id));
  }
  for (const [entries, key] of [
    [value.workspaces, "workspaceId"],
    [value.sessions, "appSessionId"]
  ])
    need2(
      new Set(entries.map((entry) => entry[key])).size === entries.length,
      "identity_conflict"
    );
  need2(
    new Set(
      value.tombstones.map((entry) => JSON.stringify([entry.kind, entry.id]))
    ).size === value.tombstones.length,
    "identity_conflict"
  );
  return clone(value);
}
function validateJournalPayload(value) {
  const common = ["kind", "revision"];
  need2(
    value && typeof value.kind === "string" && integer(value.revision) && value.revision > 0
  );
  switch (value.kind) {
    case "feature_gate":
      closed4(value, [...common, "feature"]);
      need2(
        [
          "configuration_save_v1",
          INSTRUCTION_FEATURE,
          MCP_FEATURE,
          SKILL_FEATURE,
          SKILL_RUNTIME_FEATURE
        ].includes(value.feature),
        "unsupported_version"
      );
      break;
    case "admission":
      closed4(
        value,
        [...common, "identity"],
        [
          "rejectionCode",
          "nativeServerName",
          "skillSourceName",
          "skillRuntime"
        ]
      );
      validateStorageIdentity(value.identity);
      validateMcpAdmission(value);
      validateSkillAdmission(value);
      validateSkillRuntimeAdmission(value);
      if (value.rejectionCode !== void 0)
        need2(Object.hasOwn(ERRORS, value.rejectionCode));
      break;
    case "reservation":
      closed4(
        value,
        [...common, "runtimeEpoch", "operationId", "workspace", "appSessionId"],
        ["plannedNativeSessionId"]
      );
      need2(
        id4(value.runtimeEpoch) && id4(value.operationId) && resourceId2(value.appSessionId)
      );
      optionalIds(value, ["plannedNativeSessionId"]);
      validateRegistryDelta({
        workspaces: [value.workspace],
        sessions: [],
        tombstones: []
      });
      need2(value.workspace.registrationState === "reserved");
      break;
    case "dispatch":
      closed4(
        value,
        [...common, "runtimeEpoch", "operationId", "step"],
        ["nativeSessionId", "nativeServerName", "skillRuntime"]
      );
      need2(
        id4(value.runtimeEpoch) && id4(value.operationId) && DISPATCH_STEPS.includes(value.step)
      );
      optionalIds(value, ["nativeSessionId"]);
      validateSkillRuntimeDispatchPayload(value);
      if (value.step.startsWith("native.mcp."))
        need2(
          validMcpNativeName(value.nativeServerName) && !Object.hasOwn(value, "nativeSessionId")
        );
      else need2(!Object.hasOwn(value, "nativeServerName"));
      if (value.step.startsWith("native.instructions."))
        need2(resourceId2(value.nativeSessionId));
      break;
    case "completion":
      closed4(value, [
        ...common,
        "runtimeEpoch",
        "operationId",
        "receipt",
        "delta"
      ]);
      need2(id4(value.runtimeEpoch) && id4(value.operationId));
      validateStorageReceipt(value.receipt);
      validateRegistryDelta(value.delta);
      need2(
        value.receipt.runtimeEpoch === value.runtimeEpoch && value.receipt.operationId === value.operationId && value.receipt.revision === value.revision
      );
      break;
    case "owner_intent":
      closed4(value, [...common, "ownerNonce", "phase"], ["childId"]);
      need2(
        id4(value.ownerNonce) && ["startup", "child_started", "shutdown"].includes(value.phase)
      );
      optionalIds(value, ["childId"]);
      break;
    case "migration_phase":
      closed4(value, [
        ...common,
        "migrationId",
        "sourceStoreId",
        "destinationStoreId",
        "phase",
        "inventoryHash"
      ]);
      need2(
        id4(value.migrationId) && id4(value.sourceStoreId) && id4(value.destinationStoreId) && value.sourceStoreId !== value.destinationStoreId && [
          "retained",
          "quiesced",
          "copied",
          "verified",
          "cutover",
          "rollback"
        ].includes(value.phase) && digest2(value.inventoryHash)
      );
      break;
    case "recovery_decision":
      closed4(value, [...common, "action", "throughSequence", "throughHash"]);
      need2(
        value.action === "adopt_validated_tail" && integer(value.throughSequence) && digest2(value.throughHash)
      );
      break;
    default:
      throw storageError("unsupported_version");
  }
  return clone(value);
}
var operationKey = (value) => JSON.stringify([value.runtimeEpoch, value.operationId]);
function instructionStep(type) {
  if (type === "configuration.instructions.apply")
    return "native.instructions.put";
  if (type === "configuration.instructions.remove")
    return "native.instructions.remove";
  return void 0;
}
function validateInstructionDispatch(identity, dispatch, sessions) {
  const expected = instructionStep(identity.type);
  if (!expected && !dispatch.step.startsWith("native.instructions.")) return;
  const target = sessions.get(identity.sessionId);
  need2(
    expected === dispatch.step && target?.workspaceId === identity.workspaceId && target.lifecycleState === "active" && target.nativeSessionId && target.nativeSessionId === dispatch.nativeSessionId,
    "identity_conflict"
  );
}
function validateInstructionCompletion(operation, payload, sessions, features) {
  const { identity, reservation, dispatches } = operation;
  const { receipt, delta } = payload;
  const step = instructionStep(identity.type);
  const confirmed = receipt.effect === "confirmed";
  if (delta.sessions.some(
    (session) => Object.hasOwn(session, "instructionRegistration")
  ))
    need2(features.includes(INSTRUCTION_FEATURE), "unsupported_version");
  if (step) {
    if (!confirmed) {
      need2(
        delta.sessions.length === 0 && delta.workspaces.length === 0 && delta.tombstones.length === 0 && (receipt.result === void 0 || receipt.admission === "rejected" && receipt.effect === "none" && receipt.result.kind === "rejected"),
        "identity_conflict"
      );
      return;
    }
    const target = sessions.get(identity.sessionId);
    const session = delta.sessions[0] ?? target;
    const result = receipt.result;
    need2(
      target && target.workspaceId === identity.workspaceId && target.lifecycleState === "active" && target.nativeSessionId && dispatches.some(
        (entry) => entry.step === step && entry.nativeSessionId === target.nativeSessionId
      ) && receipt.admission === "dispatched" && receipt.delivery === "accepted" && delta.workspaces.length === 0 && delta.tombstones.length === 0 && delta.sessions.length <= 1 && session.appSessionId === identity.sessionId && session.workspaceId === identity.workspaceId && session.nativeSessionId === target.nativeSessionId && session.lifecycleState === "active" && result?.workspaceId === identity.workspaceId && result?.sessionId === identity.sessionId,
      "identity_conflict"
    );
    const expected = step === "native.instructions.put" ? {
      state: "registered",
      key: INSTRUCTION_KEY,
      digest: result.digest,
      sourceVersion: result.sourceVersion,
      origin: "direct"
    } : { state: "absent", key: INSTRUCTION_KEY };
    need2(
      result.kind === (step === "native.instructions.put" ? "instruction_registered" : "instruction_removed") && isDeepStrictEqual(
        canonicalInstructionRegistration(session.instructionRegistration),
        expected
      ),
      "identity_conflict"
    );
    const {
      instructionRegistration: _before,
      revision: _revision,
      ...before
    } = target;
    const {
      instructionRegistration: _after,
      revision: _afterRevision,
      ...after
    } = session;
    need2(isDeepStrictEqual(before, after), "identity_conflict");
  }
  for (const session of delta.sessions) {
    if (step) continue;
    const existing = sessions.get(session.appSessionId);
    let expected = canonicalInstructionRegistration(
      existing?.instructionRegistration
    );
    if (identity.type === "session.fork" && session.appSessionId === reservation?.appSessionId && confirmed) {
      const parent = sessions.get(identity.sessionId);
      const registration2 = parent?.instructionRegistration;
      if (registration2 !== void 0) {
        need2(
          parent.workspaceId === identity.workspaceId && session.parentSessionId === identity.sessionId && session.lifecycleState === "active" && session.nativeSessionId && dispatches.some((entry) => entry.step === "native.fork") && receipt.admission === "dispatched" && receipt.delivery === "accepted" && receipt.result?.kind === "forked" && receipt.result.workspaceId === session.workspaceId && receipt.result.sessionId === session.appSessionId && receipt.result.nativeSessionId === session.nativeSessionId && receipt.evidence.some(
            (entry) => entry.kind === "native_session_verified" && entry.id === session.nativeSessionId
          ),
          "identity_conflict"
        );
        expected = registration2.state === "registered" ? {
          state: "registered",
          key: INSTRUCTION_KEY,
          digest: registration2.digest,
          sourceVersion: registration2.sourceVersion,
          origin: "fork",
          inheritedFromSessionId: identity.sessionId
        } : canonicalInstructionRegistration(registration2);
      }
    }
    need2(
      isDeepStrictEqual(
        canonicalInstructionRegistration(session.instructionRegistration),
        expected
      ),
      "identity_conflict"
    );
  }
}
function validateMcpAdmission(value) {
  need2(
    mcpStep(value.identity.type) ? validMcpNativeName(value.nativeServerName) : !Object.hasOwn(value, "nativeServerName")
  );
}
function validateMcpDispatch(operation, dispatch) {
  need2(typeof dispatch.step === "string");
  const expected = mcpStep(operation.identity.type);
  if (!expected && !dispatch.step.startsWith("native.mcp.") && !Object.hasOwn(dispatch, "nativeServerName"))
    return;
  need2(
    expected === dispatch.step && operation.identity.workspaceId && !Object.hasOwn(operation.identity, "sessionId") && !Object.hasOwn(dispatch, "nativeSessionId") && validMcpNativeName(dispatch.nativeServerName) && dispatch.nativeServerName === operation.nativeServerName,
    "identity_conflict"
  );
}
function isMcpAbsentRemoval(receipt) {
  return receipt.type === "configuration.mcp.remove" && receipt.admission === "admitted" && receipt.delivery === "accepted" && receipt.effect === "none" && receipt.result?.kind === "mcp_removed";
}
function validateMcpCompletion(operation, payload, features) {
  const { identity, dispatches } = operation;
  const { receipt, delta } = payload;
  if (!mcpStep(identity.type)) return;
  need2(features.includes(MCP_FEATURE), "unsupported_version");
  need2(
    delta.workspaces.length === 0 && delta.sessions.length === 0 && delta.tombstones.length === 0,
    "identity_conflict"
  );
  const successful = receipt.effect === "confirmed" || isMcpAbsentRemoval(receipt);
  if (!successful) {
    need2(
      receipt.result === void 0 || receipt.admission === "rejected" && receipt.effect === "none" && receipt.result.kind === "rejected",
      "identity_conflict"
    );
    return;
  }
  need2(
    receipt.result?.nativeName === operation.nativeServerName && receipt.result?.workspaceId === identity.workspaceId && receipt.result.nativeName === mcpNativeName(identity.workspaceId, receipt.result.sourceName) && (isMcpAbsentRemoval(receipt) ? dispatches.length === 0 : dispatches.length === 1 && dispatches[0].step === mcpStep(identity.type) && dispatches[0].nativeServerName === operation.nativeServerName),
    "identity_conflict"
  );
}
function validateSkillAdmission(value) {
  need2(
    isSkillSave(value.identity.type) ? validSkillSourceName(value.skillSourceName) : !Object.hasOwn(value, "skillSourceName")
  );
}
function validateSkillDispatch(operation, dispatch) {
  if (!isSkillSave(operation.identity.type)) return;
  need2(
    [
      "filesystem.configuration.stage",
      "filesystem.configuration.publish"
    ].includes(dispatch.step) && !Object.hasOwn(dispatch, "nativeSessionId") && !Object.hasOwn(dispatch, "nativeServerName") && (dispatch.step !== "filesystem.configuration.publish" || operation.dispatches.some(
      (entry) => entry.step === "filesystem.configuration.stage"
    )),
    "identity_conflict"
  );
}
function validateSkillCompletion(operation, payload, features) {
  if (!isSkillSave(operation.identity.type)) return;
  need2(features.includes(SKILL_FEATURE), "unsupported_version");
  const { receipt, delta } = payload;
  need2(
    !operation.reservation && !operation.reserved && delta.workspaces.length === 0 && delta.sessions.length === 0 && delta.tombstones.length === 0,
    "identity_conflict"
  );
  if (receipt.effect === "confirmed") {
    need2(
      validSkillSavedResult(receipt, operation.skillSourceName) && operation.dispatches.length === 2 && operation.dispatches[0].step === "filesystem.configuration.stage" && operation.dispatches[1].step === "filesystem.configuration.publish",
      "identity_conflict"
    );
  } else
    need2(
      receipt.result === void 0 || receipt.result.kind === "rejected" && receipt.admission === "rejected" && receipt.effect === "none" && operation.dispatches.length === 0,
      "identity_conflict"
    );
}
function historyValidator() {
  const operations = /* @__PURE__ */ new Map();
  const migrations = /* @__PURE__ */ new Map();
  const sessions = /* @__PURE__ */ new Map();
  const features = /* @__PURE__ */ new Set();
  let revision = 0;
  return (payload) => {
    need2(payload.revision === revision + 1, "identity_conflict");
    const key = operationKey(payload.identity ?? payload);
    const prior = operations.get(key);
    if (payload.kind === "feature_gate") {
      need2(!features.has(payload.feature), "identity_conflict");
      features.add(payload.feature);
    } else if (payload.kind === "admission") {
      need2(
        payload.identity.type !== "configuration.save" || features.has("configuration_save_v1"),
        "unsupported_version"
      );
      need2(
        !instructionStep(payload.identity.type) || features.has(INSTRUCTION_FEATURE),
        "unsupported_version"
      );
      need2(
        !mcpStep(payload.identity.type) || features.has(MCP_FEATURE),
        "unsupported_version"
      );
      need2(
        !skillRuntimeStep(payload.identity.type) || features.has(SKILL_RUNTIME_FEATURE),
        "unsupported_version"
      );
      need2(
        !isSkillSave(payload.identity.type) || features.has(SKILL_FEATURE),
        "unsupported_version"
      );
      if (payload.identity.type === "session.fork" && sessions.get(payload.identity.sessionId)?.instructionRegistration !== void 0)
        need2(features.has(INSTRUCTION_FEATURE), "unsupported_version");
      need2(!prior, "identity_conflict");
      need2(operations.size < STORAGE_LIMITS.operations, "retained_limit");
      operations.set(key, {
        identity: payload.identity,
        ...skillRuntimeStep(payload.identity.type) && {
          skillRuntime: payload.skillRuntime
        },
        ...isSkillSave(payload.identity.type) && {
          skillSourceName: payload.skillSourceName
        },
        ...mcpStep(payload.identity.type) && {
          nativeServerName: payload.nativeServerName
        },
        terminal: !!payload.rejectionCode,
        reserved: false,
        steps: /* @__PURE__ */ new Set(),
        dispatches: []
      });
    } else if (["reservation", "dispatch", "completion"].includes(payload.kind)) {
      need2(prior && !prior.terminal, "identity_conflict");
      if (payload.kind === "reservation") {
        need2(
          !skillRuntimeStep(prior.identity.type) && !isSkillSave(prior.identity.type) && !instructionStep(prior.identity.type) && !mcpStep(prior.identity.type) && !prior.reserved,
          "identity_conflict"
        );
        prior.reserved = true;
        prior.reservation = payload;
      }
      if (payload.kind === "dispatch") {
        validateInstructionDispatch(prior.identity, payload, sessions);
        validateMcpDispatch(prior, payload);
        validateSkillDispatch(prior, payload);
        validateSkillRuntimeDispatch(prior, payload, sessions, operations);
        need2(
          ["configuration.save", "configuration.skill.save"].includes(
            prior.identity.type
          ) === payload.step.startsWith("filesystem.configuration."),
          "identity_conflict"
        );
        if (payload.step === "filesystem.configuration.publish")
          need2(
            prior.steps.has("filesystem.configuration.stage"),
            "identity_conflict"
          );
        need2(!prior.steps.has(payload.step), "identity_conflict");
        prior.steps.add(payload.step);
        prior.dispatches.push(payload);
      }
      if (payload.kind === "completion") {
        for (const field of [
          "runtimeEpoch",
          "operationId",
          "type",
          "workspaceId",
          "sessionId"
        ])
          need2(
            payload.receipt[field] === prior.identity[field],
            "identity_conflict"
          );
        need2(
          payload.receipt.effect !== "confirmed" || prior.steps.size > 0,
          "identity_conflict"
        );
        need2(
          payload.receipt.effect !== "none" || prior.steps.size === 0,
          "identity_conflict"
        );
        need2(
          payload.receipt.admission !== "rejected" || payload.receipt.effect === "none",
          "identity_conflict"
        );
        if (prior.identity.type === "configuration.save" && payload.receipt.effect === "confirmed")
          need2(
            prior.steps.has("filesystem.configuration.stage") && prior.steps.has("filesystem.configuration.publish") && payload.receipt.result?.kind === "configuration_saved" && payload.delta.workspaces.length === 0 && payload.delta.sessions.length === 0 && payload.delta.tombstones.length === 0,
            "identity_conflict"
          );
        validateInstructionCompletion(prior, payload, sessions, [...features]);
        validateMcpCompletion(prior, payload, [...features]);
        validateSkillCompletion(prior, payload, [...features]);
        validateSkillRuntimeCompletion(
          prior,
          payload,
          [...features],
          sessions,
          operations
        );
        prior.receipt = payload.receipt;
        for (const session of payload.delta.sessions)
          sessions.set(session.appSessionId, session);
        for (const tombstone of payload.delta.tombstones)
          if (tombstone.kind === "session") sessions.delete(tombstone.id);
        prior.terminal = payload.receipt.effect === "confirmed" || isMcpAbsentRemoval(payload.receipt) || payload.receipt.admission === "rejected";
      }
    } else if (payload.kind === "migration_phase") {
      const priorMigration = migrations.get(payload.migrationId);
      if (priorMigration)
        need2(
          priorMigration.sourceStoreId === payload.sourceStoreId && priorMigration.destinationStoreId === payload.destinationStoreId && priorMigration.phase !== "rollback",
          "identity_conflict"
        );
      const transitions = {
        retained: ["quiesced", "rollback"],
        quiesced: ["copied", "rollback"],
        copied: ["verified", "rollback"],
        verified: ["cutover", "rollback"],
        cutover: ["rollback"]
      };
      need2(
        priorMigration ? transitions[priorMigration.phase]?.includes(payload.phase) : payload.phase === "retained",
        "identity_conflict"
      );
      migrations.set(payload.migrationId, payload);
    }
    revision = payload.revision;
  };
}
async function openStorageJournal({
  directory,
  storeId,
  io = {},
  recoveryReason
} = {}) {
  need2(path(directory) && id4(storeId));
  if (recoveryReason !== void 0)
    need2(STORE_RECOVERY_REASONS2.includes(recoveryReason));
  const adapter = {
    write: (file, bytes) => file.writeFile(bytes),
    syncFile: (file) => file.sync(),
    syncDirectory: async (directory2) => {
      const handle2 = await fs.open(directory2, constants.O_RDONLY);
      try {
        await handle2.sync();
      } finally {
        await handle2.close();
      }
    },
    rename: fs.rename,
    unlink: fs.unlink,
    ...io
  };
  const filename = join2(directory, "journal.jsonl");
  const current = join2(directory, "checkpoint.json");
  const previous = join2(directory, "checkpoint.previous.json");
  const pending = join2(directory, "checkpoint.pending.json");
  const temp = join2(directory, "checkpoint.tmp.json");
  let handle;
  let reason = recoveryReason;
  let closedWriter = false;
  let queue = Promise.resolve();
  let records = [];
  let committed = [];
  let checkpointGeneration = 0;
  let checkpointValue;
  let lastHash = zeroHash;
  let uncertainCheckpoint = false;
  try {
    const stat = await fs.lstat(directory);
    need2(stat.isDirectory() && !stat.isSymbolicLink(), "storage_denied");
    need2(await fs.realpath(directory) === directory, "storage_denied");
    for (const entry of [filename, current, previous, pending, temp]) {
      try {
        const stat2 = await fs.lstat(entry);
        need2(
          stat2.isFile() && !stat2.isSymbolicLink() && stat2.nlink === 1,
          "storage_denied"
        );
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    let bytes;
    try {
      bytes = await fs.readFile(filename);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      bytes = Buffer.alloc(0);
    }
    const validateHistory = historyValidator();
    let offset = 0;
    while (offset < bytes.length) {
      const end = bytes.indexOf(10, offset);
      try {
        need2(
          end !== -1 && end - offset + 1 <= STORAGE_LIMITS.recordBytes,
          "corrupt_journal"
        );
        const line = bytes.subarray(offset, end);
        const decoded = line.toString("utf8");
        need2(Buffer.from(decoded).equals(line), "corrupt_journal");
        const record = JSON.parse(decoded);
        closed4(record, [
          "schemaVersion",
          "storeId",
          "sequence",
          "previousHash",
          "payload",
          "checksum"
        ]);
        need2(record.schemaVersion === 1, "unsupported_version");
        need2(
          record.storeId === storeId && record.sequence === records.length + 1 && record.previousHash === lastHash,
          "identity_conflict"
        );
        const { checksum, ...body } = record;
        need2(digest2(checksum) && hash(body) === checksum, "corrupt_journal");
        validateJournalPayload(record.payload);
        if (record.payload.kind === "recovery_decision")
          need2(
            record.payload.throughSequence === records.length && record.payload.throughHash === lastHash,
            "identity_conflict"
          );
        validateHistory(record.payload);
        records.push(record);
        lastHash = checksum;
        offset = end + 1;
      } catch (error) {
        reason = [
          "unsupported_version",
          "identity_conflict",
          "retained_limit"
        ].includes(error.code) ? error.code : "corrupt_journal";
        break;
      }
    }
    let ceiling = Infinity;
    try {
      const marker = JSON.parse(await fs.readFile(pending, "utf8"));
      closed4(marker, ["schemaVersion", "storeId", "baseGeneration"]);
      need2(
        marker.schemaVersion === 1 && marker.storeId === storeId && integer(marker.baseGeneration)
      );
      ceiling = marker.baseGeneration;
      uncertainCheckpoint = true;
    } catch (error) {
      if (error.code !== "ENOENT") {
        ceiling = 0;
        uncertainCheckpoint = true;
        reason ??= "corrupt_journal";
      }
    }
    const checkpoints = [];
    for (const entry of [current, previous]) {
      try {
        const candidate = JSON.parse(await fs.readFile(entry, "utf8"));
        closed4(candidate, [
          "schemaVersion",
          "storeId",
          "generation",
          "sequence",
          "hash",
          "checksum"
        ]);
        need2(candidate.schemaVersion === 1, "unsupported_version");
        const { checksum, ...body } = candidate;
        need2(
          candidate.storeId === storeId && integer(candidate.generation) && candidate.generation > 0 && integer(candidate.sequence) && candidate.sequence <= records.length && candidate.hash === (candidate.sequence ? records[candidate.sequence - 1].checksum : zeroHash) && checksum === hash(body),
          "corrupt_journal"
        );
        if (candidate.generation <= ceiling) checkpoints.push(candidate);
      } catch (error) {
        if (error.code !== "ENOENT")
          reason ??= error.code === "unsupported_version" ? "unsupported_version" : "corrupt_journal";
      }
    }
    checkpoints.sort((a, b) => b.generation - a.generation);
    checkpointValue = checkpoints[0];
    checkpointGeneration = checkpointValue?.generation ?? 0;
    committed = records.slice(0, checkpointValue?.sequence ?? 0);
    if (records.length > committed.length || uncertainCheckpoint)
      reason ??= "unconfirmed_tail";
    if (!reason) {
      handle = await fs.open(
        filename,
        constants.O_CREAT | constants.O_APPEND | constants.O_WRONLY | constants.O_NOFOLLOW,
        384
      );
      await adapter.syncFile(handle, "open");
      await adapter.syncDirectory(directory, "open");
    }
  } catch (error) {
    reason = error.code === "storage_denied" ? error.code : "storage_denied";
    if (handle) {
      await handle.close();
      handle = void 0;
    }
  }
  const status = () => ({
    state: reason ? "recovery_required" : "ready",
    ...reason && { reason },
    sequence: records.length,
    hash: lastHash,
    checkpointGeneration,
    checkpointSequence: checkpointValue?.sequence ?? 0,
    directoryFlush: "required; platform failures block writes; power-loss durability unverified",
    closed: closedWriter
  });
  const assertWritable = () => {
    if (closedWriter) throw storageError("closed");
    if (reason) throw storageError(reason);
  };
  const serialized = (fn) => {
    const task = queue.then(fn);
    queue = task.catch(() => {
    });
    return task;
  };
  const poison = () => {
    reason = "writer_poisoned";
  };
  async function appendInternal(payload) {
    assertWritable();
    const validated = validateJournalPayload(payload);
    if (validated.kind === "recovery_decision")
      need2(
        validated.throughSequence === records.length && validated.throughHash === lastHash,
        "identity_conflict"
      );
    const validateHistory = historyValidator();
    for (const record2 of records) validateHistory(record2.payload);
    validateHistory(validated);
    const body = {
      schemaVersion: 1,
      storeId,
      sequence: records.length + 1,
      previousHash: lastHash,
      payload: validated
    };
    const record = { ...body, checksum: hash(body) };
    const bytes = Buffer.from(JSON.stringify(record) + "\n");
    need2(bytes.length <= STORAGE_LIMITS.recordBytes);
    try {
      await adapter.write(handle, bytes, "append");
      await adapter.syncFile(handle, `append:${payload.kind}`);
      await adapter.syncDirectory(directory, "append");
    } catch {
      poison();
      throw storageError(reason);
    }
    records.push(record);
    lastHash = record.checksum;
    return clone(record);
  }
  async function writeFlushed(filename2, value, context, exclusive = false) {
    const file = await fs.open(
      filename2,
      constants.O_WRONLY | constants.O_CREAT | (exclusive ? constants.O_EXCL : constants.O_TRUNC) | constants.O_NOFOLLOW,
      384
    );
    try {
      await adapter.write(
        file,
        Buffer.from(JSON.stringify(value) + "\n"),
        context
      );
      await adapter.syncFile(file, context);
    } finally {
      await file.close();
    }
  }
  async function checkpointInternal() {
    assertWritable();
    const body = {
      schemaVersion: 1,
      storeId,
      generation: checkpointGeneration + 1,
      sequence: records.length,
      hash: lastHash
    };
    const candidate = { ...body, checksum: hash(body) };
    try {
      await writeFlushed(
        pending,
        { schemaVersion: 1, storeId, baseGeneration: checkpointGeneration },
        "checkpoint:pending",
        !uncertainCheckpoint
      );
      await adapter.syncDirectory(directory, "checkpoint:pending");
      if (checkpointValue)
        await writeFlushed(previous, checkpointValue, "checkpoint:previous");
      await writeFlushed(temp, candidate, "checkpoint:file");
      await adapter.rename(temp, current);
      await adapter.syncDirectory(directory, "checkpoint:publish");
      await adapter.unlink(pending);
    } catch {
      poison();
      throw storageError(reason);
    }
    checkpointValue = candidate;
    checkpointGeneration = candidate.generation;
    committed = records.slice();
    uncertainCheckpoint = false;
    return clone(candidate);
  }
  return {
    status,
    readRecords: () => clone({
      committed,
      uncertain: records.slice(committed.length),
      validated: records
    }),
    append: (payload) => {
      const copy = validateJournalPayload(payload);
      return serialized(() => appendInternal(copy));
    },
    checkpoint: () => serialized(checkpointInternal),
    // Only a trusted local host recovery decision may adopt a complete validated tail.
    recover: (decision) => serialized(async () => {
      closed4(decision, [
        "action",
        "expectedSequence",
        "expectedHash",
        "ownerVerified",
        "preflightVerified"
      ]);
      need2(
        decision.action === "adopt_validated_tail" && decision.ownerVerified === true && decision.preflightVerified === true && decision.expectedSequence === records.length && decision.expectedHash === lastHash,
        "recovery_denied"
      );
      need2(
        reason === "unconfirmed_tail" && !uncertainCheckpoint,
        "recovery_denied"
      );
      reason = void 0;
      try {
        handle = await fs.open(
          filename,
          constants.O_APPEND | constants.O_WRONLY | constants.O_NOFOLLOW
        );
        await appendInternal({
          kind: "recovery_decision",
          revision: (records.at(-1)?.payload.revision ?? 0) + 1,
          action: decision.action,
          throughSequence: decision.expectedSequence,
          throughHash: decision.expectedHash
        });
        await checkpointInternal();
        return status();
      } catch {
        poison();
        throw storageError(reason);
      }
    }),
    close: () => serialized(async () => {
      if (closedWriter) return;
      closedWriter = true;
      if (handle) {
        await handle.close();
        handle = void 0;
      }
    })
  };
}
export {
  DISPATCH_STEPS,
  RESOURCE_RECOVERY_REASONS2 as RESOURCE_RECOVERY_REASONS,
  STORAGE_LIMITS,
  STORE_RECOVERY_REASONS2 as STORE_RECOVERY_REASONS,
  instructionStep,
  isMcpAbsentRemoval,
  openStorageJournal,
  storageError,
  validateInstructionCompletion,
  validateInstructionDispatch,
  validateJournalPayload,
  validateMcpAdmission,
  validateMcpCompletion,
  validateMcpDispatch,
  validateRegistryDelta,
  validateSkillAdmission,
  validateSkillCompletion,
  validateSkillDispatch,
  validateStorageIdentity,
  validateStorageReceipt
};
