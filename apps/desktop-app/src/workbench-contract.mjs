import { validWireId } from "./wire-id.mjs";
export { validWireId } from "./wire-id.mjs";
import {
  validContextList,
  validContextSelection,
  validHistoricalContext,
} from "./renderer/shared/conversation-context/index.mjs";
import {
  validRuntimeText,
  validAssistantRuntime,
  validSessionSelection,
} from "./renderer/shared/runtime-options/index.mjs";
import { validateGitBranchRestoreRequest } from "./renderer/shared/git-branch-restore/index.mjs";
import { validateGitCommitRequest } from "./renderer/shared/git-commit/index.mjs";
import { validateGitReviewRequest } from "./renderer/shared/git-review/index.mjs";
import { validateGitIndexRequest } from "./renderer/shared/git-index/index.mjs";
import {
  validWorkspaceFilePath,
  workspaceFilePathReason,
  workspaceFileWriteFits,
} from "./renderer/shared/workspace-file/index.mjs";
import { validAgentNativeId } from "./renderer/shared/configuration-draft/agent-runtime.mjs";
import {
  validAgentSourceName,
  agentFileWriteFits,
} from "./renderer/shared/configuration-draft/agent.mjs";
import { validSkillNativeId } from "./renderer/shared/configuration-draft/skill-runtime.mjs";
import { configurationFileWriteFits } from "./renderer/shared/configuration-draft/validation.mjs";
import {
  validSkillSourceName,
  skillFileWriteFits,
} from "./renderer/shared/configuration-draft/skill.mjs";
import { ERRORS, fail } from "./workbench-errors.mjs";
export { ERRORS, fail, failure } from "./workbench-errors.mjs";
export function validMcpSourceName(value) {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9_.-]{1,80}$/.test(value) &&
    !["__proto__", "prototype", "constructor"].includes(value)
  );
}
const schemas = {
  "file.edit.read": [["workspaceId", "path"], []],
  "file.save": [
    [
      "workspaceId",
      "path",
      "requestId",
      "expectation",
      "version",
      "directoryVersion",
      "text",
    ],
    [],
  ],
  "configuration.extensions.read": [["workspaceId"], []],
  "configuration.agent.list": [["workspaceId"], []],
  "configuration.agent.read": [["workspaceId", "sourceName"], []],
  "configuration.agent.runtime.read": [["workspaceId"], ["sourceName"]],
  "configuration.agent.register": [
    [
      "workspaceId",
      "requestId",
      "sourceName",
      "observationId",
      "version",
      "directoryVersion",
      "digest",
    ],
    [],
  ],
  "configuration.agent.remove": [
    ["workspaceId", "requestId", "nativeId", "observationId"],
    [],
  ],
  "configuration.agent.save": [
    [
      "workspaceId",
      "sourceName",
      "requestId",
      "text",
      "directoryVersion",
      "expectation",
    ],
    ["version"],
  ],
  "configuration.skill.runtime.read": [
    ["workspaceId"],
    ["sessionId", "sourceName"],
  ],
  "configuration.skill.register": [
    [
      "workspaceId",
      "requestId",
      "sourceName",
      "observationId",
      "version",
      "directoryVersion",
      "digest",
    ],
    [],
  ],
  "configuration.skill.remove": [
    ["workspaceId", "requestId", "nativeId", "observationId"],
    [],
  ],
  "configuration.skill.apply": [
    ["workspaceId", "sessionId", "requestId", "nativeId", "observationId"],
    [],
  ],
  "configuration.skill.list": [["workspaceId"], []],
  "configuration.skill.read": [["workspaceId", "sourceName"], []],
  "configuration.skill.save": [
    [
      "workspaceId",
      "sourceName",
      "requestId",
      "text",
      "directoryVersion",
      "expectation",
    ],
    ["version"],
  ],
  "configuration.mcp.read": [["workspaceId"], []],
  "configuration.mcp.register": [
    [
      "workspaceId",
      "requestId",
      "sourceName",
      "text",
      "fileVersion",
      "expectedObservationVersion",
    ],
    [],
  ],
  "configuration.mcp.connect": [
    ["workspaceId", "requestId", "sourceName", "expectedObservationVersion"],
    [],
  ],
  "configuration.mcp.disconnect": [
    ["workspaceId", "requestId", "sourceName", "expectedObservationVersion"],
    [],
  ],
  "configuration.mcp.remove": [
    ["workspaceId", "requestId", "sourceName", "expectedObservationVersion"],
    [],
  ],
  "operation.lookup": [["runtimeEpoch", "operationId"], []],
  snapshot: [[], ["workspaceId", "sessionId"]],
  "diagnostics.list": [[], ["workspaceId", "sessionId"]],
  "session.rename": [["workspaceId", "sessionId", "requestId", "title"], []],
  "session.pin": [["workspaceId", "sessionId", "requestId", "pinned"], []],
  "session.archive": [
    ["workspaceId", "sessionId", "requestId", "archived"],
    [],
  ],
  "session.fork": [
    ["workspaceId", "sessionId", "requestId"],
    ["title", "before"],
  ],
  "context.observe": [["workspaceId", "path"], ["selection"]],
  "session.inbox": [["workspaceId", "sessionId"], []],
  "session.inbox.cancel": [
    ["workspaceId", "sessionId", "requestId", "inboxId"],
    [],
  ],
  "session.remove": [["workspaceId", "sessionId", "requestId"], []],
  "workspace.import": [[], ["path"]],
  "workspace.create": [[], ["name"]],
  "workspace.remove": [["workspaceId"], []],
  "session.create": [["workspaceId"], ["title"]],
  "message.send": [
    ["workspaceId", "sessionId", "requestId", "text"],
    ["agent", "model", "variant", "attachments", "delivery"],
  ],
  "session.interrupt": [["workspaceId", "sessionId"], []],
  "permission.policy.read": [["workspaceId", "sessionId"], []],
  "permission.mode.set": [
    ["workspaceId", "sessionId", "requestId", "mode"],
    [],
  ],
  "permission.respond": [
    ["workspaceId", "sessionId", "requestId", "decision"],
    [],
  ],
  "catalog.list": [["workspaceId"], ["sessionId"]],
  "command.run": [
    ["workspaceId", "sessionId", "requestId", "name", "arguments"],
    [],
  ],
  "file.list": [["workspaceId"], ["path"]],
  "file.read": [["workspaceId", "path"], []],
  "file.search": [["workspaceId", "query", "mode"], ["caseSensitive"]],
  "configuration.read": [["workspaceId", "kind"], []],
  "configuration.instructions.read": [["workspaceId", "sessionId"], []],
  "configuration.instructions.apply": [
    [
      "workspaceId",
      "sessionId",
      "requestId",
      "text",
      "fileVersion",
      "expectedRegistrationVersion",
    ],
    [],
  ],
  "configuration.instructions.remove": [
    ["workspaceId", "sessionId", "requestId", "expectedRegistrationVersion"],
    [],
  ],
  "configuration.save": [
    ["workspaceId", "requestId", "kind", "text", "expectation"],
    ["version"],
  ],
};
export function validateRequest(value) {
  assertPlain(value);
  if (
    [
      "git.branch.preview.read",
      "git.branch.apply",
      "git.restore.preview.read",
      "git.restore.apply",
    ].includes(value.type)
  )
    return validateGitBranchRestoreRequest(value);
  if (
    value.type === "git.commit.preview.read" ||
    value.type === "git.commit.apply"
  )
    return validateGitCommitRequest(value);
  if (
    value.type === "git.index.preview.read" ||
    value.type === "git.index.apply"
  )
    return validateGitIndexRequest(value);
  if (value.type === "git.review.read" || value.type === "git.diff.read")
    return validateGitReviewRequest(value);
  const schema = Object.hasOwn(schemas, value.type) && schemas[value.type];
  if (!schema) fail("INVALID_REQUEST");
  const [required, optional] = schema;
  const allowed = new Set(["type", ...required, ...optional]);
  if (
    Reflect.ownKeys(value).some((key) => !allowed.has(key)) ||
    required.some((key) => !Object.hasOwn(value, key))
  )
    fail("INVALID_REQUEST");
  for (const [key, entry] of Object.entries(value)) {
    if (key === "attachments") {
      if (!validContextList(entry) || entry.length === 0)
        fail("INVALID_REQUEST");
      continue;
    }
    if (key === "selection") {
      if (!validContextSelection(entry)) fail("INVALID_REQUEST");
      continue;
    }
    if (["pinned", "archived", "caseSensitive"].includes(key)) {
      if (typeof entry !== "boolean") fail("INVALID_REQUEST");
      continue;
    }
    if (["runtimeEpoch", "operationId"].includes(key) && !validWireId(entry))
      fail("INVALID_REQUEST");
    if (key === "requestId" && typeof entry === "string" && entry.length > 128)
      fail("INVALID_REQUEST");
    const max =
      value.type === "file.save" && key === "text"
        ? 65536
        : [
              "configuration.save",
              "configuration.agent.save",
              "configuration.skill.save",
              "configuration.instructions.apply",
              "configuration.mcp.register",
            ].includes(value.type) && key === "text"
          ? 32768
          : ["text", "arguments"].includes(key)
            ? 32000
            : key === "path"
              ? 2048
              : 256;
    if (typeof entry !== "string" || entry.length > max || entry.includes("\0"))
      fail("INVALID_REQUEST");
    if (
      (key.endsWith("Id") || ["agent", "model"].includes(key)) &&
      !/^[\w.:-]{1,256}$/.test(entry)
    )
      fail("INVALID_REQUEST");
  }
  if (
    [
      "configuration.skill.runtime.read",
      "configuration.skill.register",
    ].includes(value.type) &&
    Object.hasOwn(value, "sourceName") &&
    !validSkillSourceName(value.sourceName)
  )
    fail("INVALID_REQUEST");
  if (
    value.type === "configuration.skill.register" &&
    ![value.version, value.directoryVersion, value.digest].every((v) =>
      /^[a-f0-9]{64}$/u.test(v),
    )
  )
    fail("INVALID_REQUEST");
  if (
    ["configuration.skill.remove", "configuration.skill.apply"].includes(
      value.type,
    ) &&
    !validSkillNativeId(value.nativeId)
  )
    fail("INVALID_REQUEST");
  if (
    value.type.startsWith("configuration.agent.") &&
    Object.hasOwn(value, "sourceName") &&
    !validAgentSourceName(value.sourceName)
  )
    fail("INVALID_REQUEST");
  if (
    value.type === "configuration.agent.register" &&
    ![value.version, value.directoryVersion, value.digest].every((v) =>
      /^[a-f0-9]{64}$/u.test(v),
    )
  )
    fail("INVALID_REQUEST");
  if (
    value.type === "configuration.agent.remove" &&
    !validAgentNativeId(value.nativeId)
  )
    fail("INVALID_REQUEST");
  if (
    value.type === "configuration.agent.save" &&
    (!agentFileWriteFits(value.text) ||
      !/^[a-f0-9]{64}$/u.test(value.directoryVersion) ||
      !["missing", "version"].includes(value.expectation) ||
      (value.expectation === "version"
        ? typeof value.version !== "string" ||
          !/^[a-f0-9]{64}$/u.test(value.version)
        : Object.hasOwn(value, "version")))
  )
    fail("INVALID_REQUEST");
  if (
    ["file.edit.read", "file.save"].includes(value.type) &&
    !validWorkspaceFilePath(value.path)
  )
    fail("INVALID_REQUEST");
  if (
    value.type === "file.save" &&
    (workspaceFilePathReason(value.path) ||
      !workspaceFileWriteFits(value.text) ||
      value.expectation !== "version" ||
      ![value.version, value.directoryVersion].every((v) =>
        /^[a-f0-9]{64}$/u.test(v),
      ))
  )
    fail("INVALID_REQUEST");
  if (value.sessionId && !value.workspaceId) fail("INVALID_REQUEST");
  if (
    value.type === "configuration.skill.read" &&
    !validSkillSourceName(value.sourceName)
  )
    fail("INVALID_REQUEST");
  if (
    value.type === "configuration.skill.save" &&
    (!validSkillSourceName(value.sourceName) ||
      !skillFileWriteFits(value.text) ||
      !/^[a-f0-9]{64}$/.test(value.directoryVersion) ||
      !["version", "missing"].includes(value.expectation) ||
      (value.expectation === "version"
        ? typeof value.version !== "string" ||
          !/^[a-f0-9]{64}$/.test(value.version)
        : Object.hasOwn(value, "version")))
  )
    fail("INVALID_REQUEST");
  if (
    value.type.startsWith("configuration.mcp.") &&
    value.type !== "configuration.mcp.read" &&
    (!validMcpSourceName(value.sourceName) ||
      !/^[a-f0-9]{64}$/.test(value.expectedObservationVersion))
  )
    fail("INVALID_REQUEST");
  if (
    value.type === "configuration.mcp.register" &&
    (!configurationFileWriteFits("mcp", value.text) ||
      !/^[a-f0-9]{64}$/.test(value.fileVersion))
  )
    fail("INVALID_REQUEST");
  if (
    value.type === "configuration.instructions.apply" &&
    (!configurationFileWriteFits("instructions", value.text) ||
      !/^[a-f0-9]{64}$/.test(value.fileVersion))
  )
    fail("INVALID_REQUEST");
  if (
    [
      "configuration.instructions.apply",
      "configuration.instructions.remove",
    ].includes(value.type) &&
    !/^[a-f0-9]{64}$/.test(value.expectedRegistrationVersion)
  )
    fail("INVALID_REQUEST");
  if (
    value.type === "configuration.read" &&
    !["instructions", "mcp"].includes(value.kind)
  )
    fail("INVALID_REQUEST");
  if (
    value.type === "configuration.save" &&
    (!configurationFileWriteFits(value.kind, value.text) ||
      !["version", "missing"].includes(value.expectation) ||
      (value.expectation === "version"
        ? typeof value.version !== "string" ||
          !/^[a-f0-9]{64}$/.test(value.version)
        : Object.hasOwn(value, "version")))
  )
    fail("INVALID_REQUEST");
  if (
    value.type === "message.send" &&
    Object.hasOwn(value, "variant") &&
    (!Object.hasOwn(value, "model") || !validRuntimeText(value.variant))
  )
    fail("INVALID_REQUEST");
  if (
    value.type === "session.fork" &&
    Object.hasOwn(value, "before") &&
    !validWireId(value.before)
  )
    fail("INVALID_REQUEST");
  if (
    value.type === "file.search" &&
    (!["name", "content"].includes(value.mode) ||
      !value.query.trim() ||
      value.query.length > 200)
  )
    fail("INVALID_REQUEST");
  if (
    value.type === "context.observe" &&
    workspaceFilePathReason(value.path) === "invalid_path"
  )
    fail("INVALID_REQUEST");
  if (
    value.type === "message.send" &&
    ((Object.hasOwn(value, "attachments") && !Object.hasOwn(value, "model")) ||
      (Object.hasOwn(value, "delivery") &&
        (!["steer", "queue"].includes(value.delivery) ||
          ["agent", "model", "variant", "attachments"].some((k) =>
            Object.hasOwn(value, k),
          ))))
  )
    fail("INVALID_REQUEST");
  if (value.type === "message.send" && !value.text.trim())
    fail("INVALID_REQUEST");
  if (
    value.type === "permission.mode.set" &&
    !["ask", "scoped_edit", "read_plan"].includes(value.mode)
  )
    fail("INVALID_REQUEST");
  if (
    value.type === "permission.respond" &&
    !["once", "reject"].includes(value.decision)
  )
    fail("INVALID_REQUEST");
  if (
    ["session.rename", "session.fork"].includes(value.type) &&
    Object.hasOwn(value, "title")
  ) {
    if (
      !value.title.trim() ||
      value.title.trim().length > 120 ||
      [...value.title].some(
        (char) =>
          char.charCodeAt(0) < 32 ||
          (char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159),
      )
    )
      fail("INVALID_REQUEST");
    return { ...value, title: value.title.trim() };
  }
  return { ...value };
}
export {
  BASELINE_POLICY,
  policyMatches,
} from "./renderer/shared/configuration-draft/policy.mjs";
export function portableName(name) {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    name.length <= 100 &&
    !/[<>:"/\\|?*]/.test(name) &&
    ![...name].some(
      (char) =>
        char.charCodeAt(0) < 32 ||
        (char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159),
    ) &&
    !/[. ]$/.test(name) &&
    name === name.trim() &&
    !/^\.{1,2}$/.test(name) &&
    !/^(con|prn|aux|nul|clock\$|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(
      name,
    )
  );
}

// Frozen v2 wire schema. Sender identity comes only from main-process admission.
export const READ_TYPES = Object.freeze([
  "permission.policy.read",
  "context.observe",
  "session.inbox",
  "git.commit.preview.read",
  "git.branch.preview.read",
  "git.restore.preview.read",
  "git.index.preview.read",
  "git.review.read",
  "git.diff.read",
  "file.edit.read",
  "configuration.extensions.read",
  "configuration.agent.runtime.read",
  "configuration.agent.list",
  "configuration.agent.read",
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
  "file.search",
  "configuration.read",
  "operation.lookup",
]);
function assertPlain(value) {
  if (
    !value ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Reflect.ownKeys(value).some(
      (key) =>
        typeof key !== "string" ||
        !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value"),
    )
  )
    fail("INVALID_REQUEST");
}
function closed(value, allowed) {
  assertPlain(value);
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    fail("INVALID_REQUEST");
}
export function validateEnvelope(value) {
  closed(value, [
    "version",
    "runtimeEpoch",
    "readId",
    "operationId",
    "expectedRevision",
    "operation",
  ]);
  if (value.version !== 2) fail("INVALID_REQUEST");
  const operation = validateRequest(value.operation);
  const read = READ_TYPES.includes(operation.type);
  const bootstrap = operation.type === "snapshot";
  if (read) {
    if (
      !validWireId(value.readId) ||
      Object.hasOwn(value, "operationId") ||
      Object.hasOwn(value, "expectedRevision")
    )
      fail("INVALID_REQUEST");
    if (
      (!bootstrap || Object.hasOwn(value, "runtimeEpoch")) &&
      !validWireId(value.runtimeEpoch)
    )
      fail("INVALID_REQUEST");
  } else if (
    !validWireId(value.operationId) ||
    !validWireId(value.runtimeEpoch) ||
    Object.hasOwn(value, "readId")
  )
    fail("INVALID_REQUEST");
  if (
    Object.hasOwn(value, "expectedRevision") &&
    (!Number.isSafeInteger(value.expectedRevision) ||
      value.expectedRevision < 0)
  )
    fail("INVALID_REQUEST");
  if (
    [
      "git.index.apply",
      "git.commit.apply",
      "git.branch.apply",
      "git.restore.apply",
    ].includes(operation.type) &&
    (operation.requestId !== value.operationId ||
      !Object.hasOwn(value, "expectedRevision"))
  )
    fail("INVALID_REQUEST");
  return { ...value, operation };
}
export function validateCancel(value) {
  closed(value, ["version", "runtimeEpoch", "readId"]);
  if (
    value.version !== 2 ||
    !validWireId(value.runtimeEpoch) ||
    !validWireId(value.readId)
  )
    fail("INVALID_REQUEST");
  return { ...value };
}

export const STORE_RECOVERY_REASONS = Object.freeze([
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
  "retained_limit",
]);
export const RESOURCE_RECOVERY_REASONS = Object.freeze([
  "path_missing",
  "path_denied",
  "path_conflict",
  "native_mapping_unverified",
  "partial_native_mapping",
  "unresolved_operation",
]);
const resourceId = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_.:-]{1,256}$/.test(value);
function requiredObject(value, required, optional = []) {
  closed(value, [...required, ...optional]);
  if (!required.every((key) => Object.hasOwn(value, key)))
    fail("INVALID_REQUEST");
}
function needDTO(condition) {
  if (!condition) fail("INVALID_REQUEST");
}
const nonnegativeClock = (value) => Number.isSafeInteger(value) && value >= 0;
const boundedText = (value, max) =>
  typeof value === "string" && value.length <= max;
function unique(entries, key) {
  needDTO(new Set(entries.map(key)).size === entries.length);
}
// Closed v5 producer validator. No default clocks, recovery or retained keys.
// Validate the entire projection before its caller publishes any part of it.
export function validateSnapshot(value) {
  requiredObject(
    value,
    [
      "runtimeEpoch",
      "revision",
      "observationSequence",
      "state",
      "temporary",
      "recovery",
      "retainedOperations",
      "workspaces",
      "sessions",
      "messages",
      "permissions",
    ],
    ["selectedWorkspaceId", "selectedSessionId", "sessionSelection", "error"],
  );
  needDTO(
    validWireId(value.runtimeEpoch) &&
      nonnegativeClock(value.revision) &&
      Number.isSafeInteger(value.observationSequence) &&
      value.observationSequence > 0,
  );
  needDTO(
    ["connected", "disconnected", "unavailable"].includes(value.state) &&
      typeof value.temporary === "boolean",
  );
  for (const [name, limit] of [
    ["workspaces", 100],
    ["sessions", 200],
    ["messages", 100],
    ["permissions", 100],
    ["retainedOperations", 2048],
  ])
    needDTO(Array.isArray(value[name]) && value[name].length <= limit);
  for (const w of value.workspaces) {
    requiredObject(
      w,
      ["id", "name", "path", "kind", "trusted", "trustRevision", "temporary"],
      ["branch", "writable"],
    );
    needDTO(
      (w.branch === undefined || boundedText(w.branch, 256)) &&
        (w.writable === undefined || typeof w.writable === "boolean") &&
        resourceId(w.id) &&
        boundedText(w.name, 256) &&
        boundedText(w.path, 4096) &&
        ["folder", "repository", "worktree"].includes(w.kind) &&
        typeof w.trusted === "boolean" &&
        nonnegativeClock(w.trustRevision) &&
        typeof w.temporary === "boolean",
    );
  }
  unique(value.workspaces, (w) => w.id);
  const workspaces = new Set(value.workspaces.map((w) => w.id));
  for (const s of value.sessions) {
    requiredObject(
      s,
      ["id", "workspaceId", "title", "status"],
      ["pinned", "archived", "parentSessionId", "permissionMode"],
    );
    needDTO(
      resourceId(s.id) &&
        workspaces.has(s.workspaceId) &&
        boundedText(s.title, 256) &&
        ["idle", "running", "stopping", "unknown", "unavailable"].includes(
          s.status,
        ),
    );
    for (const flag of ["pinned", "archived"])
      if (Object.hasOwn(s, flag)) needDTO(typeof s[flag] === "boolean");
    if (Object.hasOwn(s, "permissionMode"))
      needDTO(["ask", "scoped_edit", "read_plan"].includes(s.permissionMode));
    if (Object.hasOwn(s, "parentSessionId"))
      needDTO(resourceId(s.parentSessionId));
  }
  unique(value.sessions, (s) => s.id);
  const sessions = new Map(value.sessions.map((s) => [s.id, s.workspaceId]));
  for (const s of value.sessions)
    if (s.parentSessionId)
      needDTO(
        sessions.get(s.parentSessionId) === s.workspaceId &&
          s.parentSessionId !== s.id,
      );
  if (Object.hasOwn(value, "selectedWorkspaceId"))
    needDTO(workspaces.has(value.selectedWorkspaceId));
  if (Object.hasOwn(value, "selectedSessionId"))
    needDTO(
      sessions.has(value.selectedSessionId) &&
        sessions.get(value.selectedSessionId) === value.selectedWorkspaceId,
    );
  requiredObject(value.recovery, ["store", "resources"]);
  const store = value.recovery.store;
  requiredObject(
    store,
    ["state"],
    store?.state === "recovery_required" ? ["reason"] : [],
  );
  needDTO(
    store.state === "ready" ||
      (store.state === "recovery_required" &&
        STORE_RECOVERY_REASONS.includes(store.reason)),
  );
  needDTO(
    Array.isArray(value.recovery.resources) &&
      value.recovery.resources.length <= 300,
  );
  for (const r of value.recovery.resources) {
    requiredObject(r, ["workspaceId", "state", "reason"], ["sessionId"]);
    needDTO(
      workspaces.has(r.workspaceId) &&
        r.state === "unavailable" &&
        RESOURCE_RECOVERY_REASONS.includes(r.reason),
    );
    if (Object.hasOwn(r, "sessionId"))
      needDTO(sessions.get(r.sessionId) === r.workspaceId);
  }
  unique(value.recovery.resources, (r) =>
    JSON.stringify([r.workspaceId, r.sessionId]),
  );
  for (const k of value.retainedOperations) {
    requiredObject(
      k,
      ["runtimeEpoch", "operationId", "type", "authorityHold"],
      ["workspaceId", "sessionId"],
    );
    needDTO(
      validWireId(k.runtimeEpoch) &&
        validWireId(k.operationId) &&
        typeof k.authorityHold === "boolean" &&
        (Object.hasOwn(schemas, k.type) ||
          [
            "git.index.apply",
            "git.commit.apply",
            "git.branch.apply",
            "git.restore.apply",
          ].includes(k.type)) &&
        !READ_TYPES.includes(k.type),
    );
    for (const field of ["workspaceId", "sessionId"])
      if (Object.hasOwn(k, field)) needDTO(resourceId(k[field]));
    needDTO(!k.sessionId || !!k.workspaceId);
  }
  unique(value.retainedOperations, (k) =>
    JSON.stringify([k.runtimeEpoch, k.operationId]),
  );
  for (const m of value.messages) {
    requiredObject(m, ["id", "role", "text", "tools"], ["runtime", "context"]);
    if (Object.hasOwn(m, "context"))
      needDTO(m.role === "user" && validHistoricalContext(m.context));
    if (Object.hasOwn(m, "runtime"))
      needDTO(m.role === "assistant" && validAssistantRuntime(m.runtime));
    needDTO(
      boundedText(m.id, 256) &&
        m.id.length > 0 &&
        ["user", "assistant"].includes(m.role) &&
        boundedText(m.text, 32000) &&
        Array.isArray(m.tools) &&
        m.tools.length <= 40,
    );
    for (const t of m.tools) {
      requiredObject(t, ["id", "name", "status", "input", "output"]);
      needDTO(
        boundedText(t.id, 256) &&
          t.id.length > 0 &&
          boundedText(t.name, 128) &&
          ["pending", "running", "completed", "error"].includes(t.status) &&
          boundedText(t.input, 8000) &&
          boundedText(t.output, 8000),
      );
    }
  }
  if (Object.hasOwn(value, "sessionSelection")) {
    needDTO(
      validSessionSelection(value.sessionSelection) &&
        value.sessionSelection.sessionId === value.selectedSessionId &&
        value.sessions.some(
          (s) => s.id === value.selectedSessionId && s.status !== "unavailable",
        ) &&
        value.state === "connected" &&
        value.recovery.store.state === "ready" &&
        !value.recovery.resources.some(
          (r) =>
            r.workspaceId === value.selectedWorkspaceId &&
            (!r.sessionId || r.sessionId === value.selectedSessionId),
        ) &&
        value.workspaces.some(
          (w) => w.id === value.selectedWorkspaceId && w.trusted,
        ),
    );
  }
  for (const p of value.permissions) {
    requiredObject(p, ["id", "sessionId", "title", "detail"]);
    needDTO(
      boundedText(p.id, 256) &&
        p.id.length > 0 &&
        sessions.has(p.sessionId) &&
        boundedText(p.title, 128) &&
        boundedText(p.detail, 2000),
    );
  }
  if (Object.hasOwn(value, "error")) {
    requiredObject(value.error, ["code", "message"]);
    needDTO(
      Object.hasOwn(ERRORS, value.error.code) &&
        value.error.message === ERRORS[value.error.code],
    );
  }
  if (store.state === "recovery_required")
    needDTO(
      value.state === "unavailable" &&
        !value.messages.length &&
        !value.permissions.length,
    );
  return value;
}
