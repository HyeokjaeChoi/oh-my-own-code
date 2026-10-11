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
import { createHash } from "node:crypto";
var MCP_FEATURE = "configuration_mcp_v1";
var MCP_STATUSES = Object.freeze([
  "connected",
  "pending",
  "disabled",
  "failed",
  "needs_auth"
]);
var mcpDigest = (value) => createHash("sha256").update(value, "utf8").digest("hex");
var validMcpNativeName = (value) => typeof value === "string" && /^omoc-mcp-[a-f0-9]{40}$/.test(value);
function mcpNativeName(workspaceId, sourceName) {
  if (typeof workspaceId !== "string" || !/^[\w.:-]{1,256}$/.test(workspaceId) || !validMcpSourceName(sourceName))
    throw new Error("invalid_mcp_identity");
  return `omoc-mcp-${mcpDigest(JSON.stringify([workspaceId, sourceName])).slice(0, 40)}`;
}
function mcpStep(type) {
  const steps = {
    "configuration.mcp.register": "native.mcp.add",
    "configuration.mcp.connect": "native.mcp.connect",
    "configuration.mcp.disconnect": "native.mcp.disconnect",
    "configuration.mcp.remove": "native.mcp.remove"
  };
  return Object.hasOwn(steps, type) ? steps[type] : void 0;
}

// apps/desktop-app/src/host/storage-journal.mjs
import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import { createHash as createHash2 } from "node:crypto";
import { isAbsolute, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

// apps/desktop-app/src/host/workbench-instructions.mjs
var INSTRUCTION_KEY = "omoc.project-instructions";
var INSTRUCTION_FEATURE = "configuration_instructions_v1";
var digest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
var id = (value) => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,256}$/.test(value);
function validInstructionRegistration(value) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || value.key !== INSTRUCTION_KEY)
    return false;
  if (value.state === "absent") return Object.keys(value).length === 2;
  if (value.state !== "registered" || !digest(value.digest) || !digest(value.sourceVersion))
    return false;
  const fields = ["state", "key", "digest", "sourceVersion", "origin"];
  if (value.origin === "fork") {
    if (!id(value.inheritedFromSessionId)) return false;
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
  "configuration.mcp.register",
  "configuration.mcp.connect",
  "configuration.mcp.disconnect",
  "configuration.mcp.remove",
  "configuration.save",
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
var hash = (value) => createHash2("sha256").update(JSON.stringify(value)).digest("hex");
function storageError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
function need(condition, code = "invalid_record") {
  if (!condition) throw storageError(code);
}
function closed(value, required, optional = []) {
  need(
    value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype
  );
  need(
    required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every(
      (key) => [...required, ...optional].includes(key)
    )
  );
}
var integer = (value) => Number.isSafeInteger(value) && value >= 0;
var digest2 = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
var id2 = (value) => validWireId(value);
var resourceId = (value) => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,256}$/.test(value);
var displayText = (value) => ![...value].some(
  (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127
);
var path = (value) => typeof value === "string" && value.length <= 4096 && !value.includes("\0") && isAbsolute(value) && resolve(value) === value;
function optionalIds(value, names) {
  for (const name of names)
    if (Object.hasOwn(value, name)) need(resourceId(value[name]));
}
function validateStorageIdentity(value) {
  closed(
    value,
    ["runtimeEpoch", "operationId", "type", "digest"],
    ["workspaceId", "sessionId"]
  );
  need(
    id2(value.runtimeEpoch) && id2(value.operationId) && mutations.has(value.type) && digest2(value.digest)
  );
  optionalIds(value, ["workspaceId", "sessionId"]);
  need(!value.sessionId || value.workspaceId);
  if (instructionStep(value.type)) need(value.workspaceId && value.sessionId);
  if (mcpStep(value.type))
    need(value.workspaceId && !Object.hasOwn(value, "sessionId"));
  return clone(value);
}
function validateStorageReceipt(value) {
  closed(
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
  need(
    id2(value.runtimeEpoch) && id2(value.operationId) && mutations.has(value.type) && integer(value.revision)
  );
  optionalIds(value, ["workspaceId", "sessionId"]);
  need(!value.sessionId || value.workspaceId);
  need(["admitted", "dispatched", "rejected"].includes(value.admission));
  need(
    ["pending", "accepted", "unknown"].includes(value.delivery) && ["none", "pending", "confirmed", "unknown"].includes(value.effect)
  );
  need(Array.isArray(value.evidence) && value.evidence.length <= 8);
  for (const entry of value.evidence) {
    closed(entry, ["kind"], ["id"]);
    need(resourceId(entry.kind));
    optionalIds(entry, ["id"]);
  }
  if (Object.hasOwn(value, "result")) {
    const result = value.result;
    need(result !== null && typeof result === "object");
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
    need(Object.hasOwn(shapes, result.kind));
    closed(result, ...shapes[result.kind]);
    optionalIds(result, [
      "workspaceId",
      "sessionId",
      "nativeSessionId",
      "nativeInboxId",
      "nativeRequestId"
    ]);
    if (["mcp_registered", "mcp_connection", "mcp_removed"].includes(result.kind)) {
      need(
        mcpStep(value.type) && value.workspaceId === result.workspaceId && !Object.hasOwn(value, "sessionId") && validMcpSourceName(result.sourceName) && validMcpNativeName(result.nativeName) && result.nativeName === mcpNativeName(value.workspaceId, result.sourceName) && value.delivery === "accepted" && (value.effect === "confirmed" && value.admission === "dispatched" || isMcpAbsentRemoval(value))
      );
      if (result.kind === "mcp_registered")
        need(
          value.type === "configuration.mcp.register" && digest2(result.digest) && digest2(result.sourceVersion) && result.status === "disabled"
        );
      if (result.kind === "mcp_connection")
        need(
          value.type === "configuration.mcp.connect" && result.action === "connect" && ["connected", "failed", "needs_auth"].includes(
            result.connectionStatus
          ) || value.type === "configuration.mcp.disconnect" && result.action === "disconnect" && result.connectionStatus === "disabled"
        );
      if (result.kind === "mcp_removed")
        need(value.type === "configuration.mcp.remove");
    }
    if (result.kind === "configuration_saved")
      need(
        value.type === "configuration.save" && value.workspaceId === result.workspaceId && value.effect === "confirmed" && ["instructions", "mcp"].includes(result.configurationKind) && digest2(result.version) && (result.backupId === void 0 || typeof result.backupId === "string" && new RegExp(
          `^\\.omoc-configuration-[a-f0-9]{64}\\.${result.configurationKind}\\.backup$`
        ).test(result.backupId))
      );
    if (["instruction_registered", "instruction_removed"].includes(result.kind)) {
      need(
        value.type === (result.kind === "instruction_registered" ? "configuration.instructions.apply" : "configuration.instructions.remove") && value.workspaceId === result.workspaceId && value.sessionId === result.sessionId && value.admission === "dispatched" && value.delivery === "accepted" && value.effect === "confirmed"
      );
      if (result.kind === "instruction_registered")
        need(digest2(result.digest) && digest2(result.sourceVersion));
    }
    if (result.kind === "removed") {
      need(typeof result.workspaceRemoved === "boolean");
      if (Object.hasOwn(result, "removedSessionIds"))
        need(
          Array.isArray(result.removedSessionIds) && result.removedSessionIds.length <= 200 && result.removedSessionIds.every(resourceId) && new Set(result.removedSessionIds).size === result.removedSessionIds.length
        );
    }
    if (result.kind === "delivery")
      need(["accepted", "stopping", "decided"].includes(result.status));
    if (result.kind === "rejected") need(Object.hasOwn(ERRORS, result.code));
  }
  if (mcpStep(value.type)) {
    need(value.workspaceId && !Object.hasOwn(value, "sessionId"));
    need(
      value.result === void 0 || [
        "mcp_registered",
        "mcp_connection",
        "mcp_removed",
        "rejected"
      ].includes(value.result.kind)
    );
    if (value.effect === "confirmed")
      need(value.result && value.result.kind !== "rejected");
    if (value.result?.kind === "rejected")
      need(value.admission === "rejected" && value.effect === "none");
    if (value.effect === "none" && value.delivery === "accepted")
      need(isMcpAbsentRemoval(value));
  }
  return clone(value);
}
function validateRegistryDelta(value) {
  closed(value, ["workspaces", "sessions", "tombstones"]);
  need(
    Array.isArray(value.workspaces) && value.workspaces.length <= 100 && Array.isArray(value.sessions) && value.sessions.length <= 200 && Array.isArray(value.tombstones) && value.tombstones.length <= 300
  );
  for (const workspace of value.workspaces) {
    closed(
      workspace,
      ["workspaceId", "ownership", "canonicalPath", "registrationState"],
      ["folderSessionId", "name", "trustRevision", "storageGeneration"]
    );
    need(
      resourceId(workspace.workspaceId) && ["managed", "imported", "legacy"].includes(workspace.ownership) && path(workspace.canonicalPath) && ["reserved", "registered", "unavailable"].includes(
        workspace.registrationState
      )
    );
    optionalIds(workspace, ["folderSessionId"]);
    if (workspace.ownership === "managed")
      need(
        typeof workspace.folderSessionId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
          workspace.folderSessionId
        )
      );
    if (workspace.name !== void 0)
      need(
        typeof workspace.name === "string" && workspace.name.length <= 256 && displayText(workspace.name)
      );
    for (const key of ["trustRevision", "storageGeneration"])
      if (workspace[key] !== void 0) need(integer(workspace[key]));
  }
  for (const session of value.sessions) {
    closed(
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
    need(
      resourceId(session.appSessionId) && resourceId(session.workspaceId) && ["reserved", "active", "unavailable"].includes(
        session.lifecycleState
      ) && typeof session.pinned === "boolean" && typeof session.archived === "boolean"
    );
    optionalIds(session, ["nativeSessionId", "parentSessionId"]);
    if (Object.hasOwn(session, "instructionRegistration"))
      need(validInstructionRegistration(session.instructionRegistration));
    if (session.title !== void 0)
      need(
        typeof session.title === "string" && session.title.length <= 256 && displayText(session.title)
      );
    if (session.lastViewedAt !== void 0) need(integer(session.lastViewedAt));
    if (session.recoveryReason !== void 0)
      need(
        session.lifecycleState === "unavailable" && RESOURCE_RECOVERY_REASONS2.includes(session.recoveryReason)
      );
  }
  for (const entry of value.tombstones) {
    closed(entry, ["kind", "id"]);
    need(["workspace", "session"].includes(entry.kind) && resourceId(entry.id));
  }
  for (const [entries, key] of [
    [value.workspaces, "workspaceId"],
    [value.sessions, "appSessionId"]
  ])
    need(
      new Set(entries.map((entry) => entry[key])).size === entries.length,
      "identity_conflict"
    );
  need(
    new Set(
      value.tombstones.map((entry) => JSON.stringify([entry.kind, entry.id]))
    ).size === value.tombstones.length,
    "identity_conflict"
  );
  return clone(value);
}
function validateJournalPayload(value) {
  const common = ["kind", "revision"];
  need(
    value && typeof value.kind === "string" && integer(value.revision) && value.revision > 0
  );
  switch (value.kind) {
    case "feature_gate":
      closed(value, [...common, "feature"]);
      need(
        ["configuration_save_v1", INSTRUCTION_FEATURE, MCP_FEATURE].includes(
          value.feature
        ),
        "unsupported_version"
      );
      break;
    case "admission":
      closed(
        value,
        [...common, "identity"],
        ["rejectionCode", "nativeServerName"]
      );
      validateStorageIdentity(value.identity);
      validateMcpAdmission(value);
      if (value.rejectionCode !== void 0)
        need(Object.hasOwn(ERRORS, value.rejectionCode));
      break;
    case "reservation":
      closed(
        value,
        [...common, "runtimeEpoch", "operationId", "workspace", "appSessionId"],
        ["plannedNativeSessionId"]
      );
      need(
        id2(value.runtimeEpoch) && id2(value.operationId) && resourceId(value.appSessionId)
      );
      optionalIds(value, ["plannedNativeSessionId"]);
      validateRegistryDelta({
        workspaces: [value.workspace],
        sessions: [],
        tombstones: []
      });
      need(value.workspace.registrationState === "reserved");
      break;
    case "dispatch":
      closed(
        value,
        [...common, "runtimeEpoch", "operationId", "step"],
        ["nativeSessionId", "nativeServerName"]
      );
      need(
        id2(value.runtimeEpoch) && id2(value.operationId) && DISPATCH_STEPS.includes(value.step)
      );
      optionalIds(value, ["nativeSessionId"]);
      if (value.step.startsWith("native.mcp."))
        need(
          validMcpNativeName(value.nativeServerName) && !Object.hasOwn(value, "nativeSessionId")
        );
      else need(!Object.hasOwn(value, "nativeServerName"));
      if (value.step.startsWith("native.instructions."))
        need(resourceId(value.nativeSessionId));
      break;
    case "completion":
      closed(value, [
        ...common,
        "runtimeEpoch",
        "operationId",
        "receipt",
        "delta"
      ]);
      need(id2(value.runtimeEpoch) && id2(value.operationId));
      validateStorageReceipt(value.receipt);
      validateRegistryDelta(value.delta);
      need(
        value.receipt.runtimeEpoch === value.runtimeEpoch && value.receipt.operationId === value.operationId && value.receipt.revision === value.revision
      );
      break;
    case "owner_intent":
      closed(value, [...common, "ownerNonce", "phase"], ["childId"]);
      need(
        id2(value.ownerNonce) && ["startup", "child_started", "shutdown"].includes(value.phase)
      );
      optionalIds(value, ["childId"]);
      break;
    case "migration_phase":
      closed(value, [
        ...common,
        "migrationId",
        "sourceStoreId",
        "destinationStoreId",
        "phase",
        "inventoryHash"
      ]);
      need(
        id2(value.migrationId) && id2(value.sourceStoreId) && id2(value.destinationStoreId) && value.sourceStoreId !== value.destinationStoreId && [
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
      closed(value, [...common, "action", "throughSequence", "throughHash"]);
      need(
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
  need(
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
    need(features.includes(INSTRUCTION_FEATURE), "unsupported_version");
  if (step) {
    if (!confirmed) {
      need(
        delta.sessions.length === 0 && delta.workspaces.length === 0 && delta.tombstones.length === 0 && (receipt.result === void 0 || receipt.admission === "rejected" && receipt.effect === "none" && receipt.result.kind === "rejected"),
        "identity_conflict"
      );
      return;
    }
    const target = sessions.get(identity.sessionId);
    const session = delta.sessions[0] ?? target;
    const result = receipt.result;
    need(
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
    need(
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
    need(isDeepStrictEqual(before, after), "identity_conflict");
  }
  for (const session of delta.sessions) {
    if (step) continue;
    const existing = sessions.get(session.appSessionId);
    let expected = canonicalInstructionRegistration(
      existing?.instructionRegistration
    );
    if (identity.type === "session.fork" && session.appSessionId === reservation?.appSessionId && confirmed) {
      const parent = sessions.get(identity.sessionId);
      const registration = parent?.instructionRegistration;
      if (registration !== void 0) {
        need(
          parent.workspaceId === identity.workspaceId && session.parentSessionId === identity.sessionId && session.lifecycleState === "active" && session.nativeSessionId && dispatches.some((entry) => entry.step === "native.fork") && receipt.admission === "dispatched" && receipt.delivery === "accepted" && receipt.result?.kind === "forked" && receipt.result.workspaceId === session.workspaceId && receipt.result.sessionId === session.appSessionId && receipt.result.nativeSessionId === session.nativeSessionId && receipt.evidence.some(
            (entry) => entry.kind === "native_session_verified" && entry.id === session.nativeSessionId
          ),
          "identity_conflict"
        );
        expected = registration.state === "registered" ? {
          state: "registered",
          key: INSTRUCTION_KEY,
          digest: registration.digest,
          sourceVersion: registration.sourceVersion,
          origin: "fork",
          inheritedFromSessionId: identity.sessionId
        } : canonicalInstructionRegistration(registration);
      }
    }
    need(
      isDeepStrictEqual(
        canonicalInstructionRegistration(session.instructionRegistration),
        expected
      ),
      "identity_conflict"
    );
  }
}
function validateMcpAdmission(value) {
  need(
    mcpStep(value.identity.type) ? validMcpNativeName(value.nativeServerName) : !Object.hasOwn(value, "nativeServerName")
  );
}
function validateMcpDispatch(operation, dispatch) {
  need(typeof dispatch.step === "string");
  const expected = mcpStep(operation.identity.type);
  if (!expected && !dispatch.step.startsWith("native.mcp.") && !Object.hasOwn(dispatch, "nativeServerName"))
    return;
  need(
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
  need(features.includes(MCP_FEATURE), "unsupported_version");
  need(
    delta.workspaces.length === 0 && delta.sessions.length === 0 && delta.tombstones.length === 0,
    "identity_conflict"
  );
  const successful = receipt.effect === "confirmed" || isMcpAbsentRemoval(receipt);
  if (!successful) {
    need(
      receipt.result === void 0 || receipt.admission === "rejected" && receipt.effect === "none" && receipt.result.kind === "rejected",
      "identity_conflict"
    );
    return;
  }
  need(
    receipt.result?.nativeName === operation.nativeServerName && receipt.result?.workspaceId === identity.workspaceId && receipt.result.nativeName === mcpNativeName(identity.workspaceId, receipt.result.sourceName) && (isMcpAbsentRemoval(receipt) ? dispatches.length === 0 : dispatches.length === 1 && dispatches[0].step === mcpStep(identity.type) && dispatches[0].nativeServerName === operation.nativeServerName),
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
    need(payload.revision === revision + 1, "identity_conflict");
    const key = operationKey(payload.identity ?? payload);
    const prior = operations.get(key);
    if (payload.kind === "feature_gate") {
      need(!features.has(payload.feature), "identity_conflict");
      features.add(payload.feature);
    } else if (payload.kind === "admission") {
      need(
        payload.identity.type !== "configuration.save" || features.has("configuration_save_v1"),
        "unsupported_version"
      );
      need(
        !instructionStep(payload.identity.type) || features.has(INSTRUCTION_FEATURE),
        "unsupported_version"
      );
      need(
        !mcpStep(payload.identity.type) || features.has(MCP_FEATURE),
        "unsupported_version"
      );
      if (payload.identity.type === "session.fork" && sessions.get(payload.identity.sessionId)?.instructionRegistration !== void 0)
        need(features.has(INSTRUCTION_FEATURE), "unsupported_version");
      need(!prior, "identity_conflict");
      need(operations.size < STORAGE_LIMITS.operations, "retained_limit");
      operations.set(key, {
        identity: payload.identity,
        ...mcpStep(payload.identity.type) && {
          nativeServerName: payload.nativeServerName
        },
        terminal: !!payload.rejectionCode,
        reserved: false,
        steps: /* @__PURE__ */ new Set(),
        dispatches: []
      });
    } else if (["reservation", "dispatch", "completion"].includes(payload.kind)) {
      need(prior && !prior.terminal, "identity_conflict");
      if (payload.kind === "reservation") {
        need(
          !instructionStep(prior.identity.type) && !mcpStep(prior.identity.type) && !prior.reserved,
          "identity_conflict"
        );
        prior.reserved = true;
        prior.reservation = payload;
      }
      if (payload.kind === "dispatch") {
        validateInstructionDispatch(prior.identity, payload, sessions);
        validateMcpDispatch(prior, payload);
        need(
          prior.identity.type === "configuration.save" === payload.step.startsWith("filesystem.configuration."),
          "identity_conflict"
        );
        if (payload.step === "filesystem.configuration.publish")
          need(
            prior.steps.has("filesystem.configuration.stage"),
            "identity_conflict"
          );
        need(!prior.steps.has(payload.step), "identity_conflict");
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
          need(
            payload.receipt[field] === prior.identity[field],
            "identity_conflict"
          );
        need(
          payload.receipt.effect !== "confirmed" || prior.steps.size > 0,
          "identity_conflict"
        );
        need(
          payload.receipt.effect !== "none" || prior.steps.size === 0,
          "identity_conflict"
        );
        need(
          payload.receipt.admission !== "rejected" || payload.receipt.effect === "none",
          "identity_conflict"
        );
        if (prior.identity.type === "configuration.save" && payload.receipt.effect === "confirmed")
          need(
            prior.steps.has("filesystem.configuration.stage") && prior.steps.has("filesystem.configuration.publish") && payload.receipt.result?.kind === "configuration_saved" && payload.delta.workspaces.length === 0 && payload.delta.sessions.length === 0 && payload.delta.tombstones.length === 0,
            "identity_conflict"
          );
        validateInstructionCompletion(prior, payload, sessions, [...features]);
        validateMcpCompletion(prior, payload, [...features]);
        for (const session of payload.delta.sessions)
          sessions.set(session.appSessionId, session);
        for (const tombstone of payload.delta.tombstones)
          if (tombstone.kind === "session") sessions.delete(tombstone.id);
        prior.terminal = payload.receipt.effect === "confirmed" || isMcpAbsentRemoval(payload.receipt) || payload.receipt.admission === "rejected";
      }
    } else if (payload.kind === "migration_phase") {
      const priorMigration = migrations.get(payload.migrationId);
      if (priorMigration)
        need(
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
      need(
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
  need(path(directory) && id2(storeId));
  if (recoveryReason !== void 0)
    need(STORE_RECOVERY_REASONS2.includes(recoveryReason));
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
  const filename = join(directory, "journal.jsonl");
  const current = join(directory, "checkpoint.json");
  const previous = join(directory, "checkpoint.previous.json");
  const pending = join(directory, "checkpoint.pending.json");
  const temp = join(directory, "checkpoint.tmp.json");
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
    need(stat.isDirectory() && !stat.isSymbolicLink(), "storage_denied");
    need(await fs.realpath(directory) === directory, "storage_denied");
    for (const entry of [filename, current, previous, pending, temp]) {
      try {
        const stat2 = await fs.lstat(entry);
        need(
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
        need(
          end !== -1 && end - offset + 1 <= STORAGE_LIMITS.recordBytes,
          "corrupt_journal"
        );
        const line = bytes.subarray(offset, end);
        const decoded = line.toString("utf8");
        need(Buffer.from(decoded).equals(line), "corrupt_journal");
        const record = JSON.parse(decoded);
        closed(record, [
          "schemaVersion",
          "storeId",
          "sequence",
          "previousHash",
          "payload",
          "checksum"
        ]);
        need(record.schemaVersion === 1, "unsupported_version");
        need(
          record.storeId === storeId && record.sequence === records.length + 1 && record.previousHash === lastHash,
          "identity_conflict"
        );
        const { checksum, ...body } = record;
        need(digest2(checksum) && hash(body) === checksum, "corrupt_journal");
        validateJournalPayload(record.payload);
        if (record.payload.kind === "recovery_decision")
          need(
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
      closed(marker, ["schemaVersion", "storeId", "baseGeneration"]);
      need(
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
        closed(candidate, [
          "schemaVersion",
          "storeId",
          "generation",
          "sequence",
          "hash",
          "checksum"
        ]);
        need(candidate.schemaVersion === 1, "unsupported_version");
        const { checksum, ...body } = candidate;
        need(
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
      need(
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
    need(bytes.length <= STORAGE_LIMITS.recordBytes);
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
      closed(decision, [
        "action",
        "expectedSequence",
        "expectedHash",
        "ownerVerified",
        "preflightVerified"
      ]);
      need(
        decision.action === "adopt_validated_tail" && decision.ownerVerified === true && decision.preflightVerified === true && decision.expectedSequence === records.length && decision.expectedHash === lastHash,
        "recovery_denied"
      );
      need(
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
  validateStorageIdentity,
  validateStorageReceipt
};
