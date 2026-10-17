import { directorySyncSupported, renameReplacing } from "../platform-paths.mjs";
import {
  TASK_FEATURE,
  isTaskRecord,
  validateTaskRecord,
  applyTaskRecord,
  PERMISSION_RECONCILIATION_FEATURE,
  validatePermissionReconciliationRecord,
  applyPermissionReconciliation,
  bootstrapReconciliationCompletion,
  bootstrapNoEffectProven,
} from "./workbench-task-storage.mjs";
import {
  PERMISSION_FEATURE,
  PERMISSION_TYPES,
  PERMISSION_STEPS,
  PERMISSION_RESULT_FIELDS,
  isPermissionControl,
  validatePermissionScope,
  validatePermissionControl,
  validatePermissionAdmission,
  validatePermissionDispatchPayload,
  validatePermissionDispatch,
  validatePermissionProgressPayload,
  validatePermissionProgress,
  validatePermissionReceipt,
  validatePermissionCompletion,
} from "./workbench-permission-storage.mjs";
import {
  BEFORE_BRANCH_FEATURE,
  validateBeforeBranchAdmission,
  validateBeforeBranchDispatchPayload,
  validateBeforeBranchDispatch,
  validateBeforeBranchCompletion,
} from "./conversation-context-branch-storage.mjs";
import {
  INBOX_CANCEL_FEATURE,
  INBOX_CANCEL_STEP,
  INBOX_CANCEL_RESULT_FIELDS,
  isInboxCancel,
  validateInboxCancelScope,
  validateInboxCancelAdmission,
  validateInboxCancelDispatchPayload,
  validateInboxCancelDispatch,
  validateInboxCancelReceipt,
  validateInboxCancelCompletion,
} from "./conversation-context-storage.mjs";
import {
  GIT_BRANCH_RESTORE_FEATURE,
  isGitBranchRestoreApply,
  validateGitBranchRestoreAdmission,
  validateGitBranchRestoreDispatchPayload,
  validateGitBranchRestoreDispatch,
  validateGitBranchRestoreCompletion,
  validateGitBranchRestoreReceipt,
  validateGitBranchRestoreScope,
  GIT_BRANCH_RESTORE_RESULT_FIELDS,
  GIT_BRANCH_RESTORE_STEPS,
} from "./workbench-git-branch-restore-storage.mjs";
import {
  GIT_INDEX_FEATURE,
  isGitIndexApply,
  validateGitIndexAdmission,
  validateGitIndexDispatchPayload,
  validateGitIndexDispatch,
  validateGitIndexCompletion,
  validateGitIndexReceipt,
  validateGitIndexScope,
  GIT_INDEX_RESULT_FIELDS,
  GIT_INDEX_STEPS,
} from "./workbench-git-index-storage.mjs";
import {
  GIT_COMMIT_FEATURE,
  isGitCommitApply,
  validateGitCommitAdmission,
  validateGitCommitDispatchPayload,
  validateGitCommitDispatch,
  validateGitCommitCompletion,
  validateGitCommitReceipt,
  validateGitCommitScope,
  GIT_COMMIT_RESULT_FIELDS,
  GIT_COMMIT_STEPS,
} from "./workbench-git-commit-storage.mjs";
import {
  FILE_FEATURE,
  isFileSave,
  validateFileScope,
  validateFileAdmission,
  validateFileDispatchPayload,
  validateFileDispatch,
  validateFileCompletion,
  validateFileReceipt,
} from "./workbench-file-storage.mjs";
import {
  AGENT_FEATURE,
  isAgentSave,
  validAgentSavedResult,
  AGENT_RUNTIME_RESULT_FIELDS,
  validateAgentRuntimeScope,
  validateAgentRuntimeAdmission,
  validateAgentRuntimeDispatchPayload,
  validateAgentRuntimeDispatch,
  validateAgentRuntimeCompletion,
  validateAgentRuntimeReceipt,
} from "./workbench-agent-storage.mjs";
import { agentRuntimeStep } from "../renderer/shared/configuration-draft/agent-runtime.mjs";
import { validAgentSourceName } from "../renderer/shared/configuration-draft/agent.mjs";
import {
  SKILL_RUNTIME_FEATURE,
  skillRuntimeStep,
  validateSkillRuntimeScope,
  validateSkillRuntimeAdmission,
  validateSkillRuntimeDispatchPayload,
  validateSkillRuntimeDispatch,
  validateSkillRuntimeCompletion,
  validateSkillRuntimeReceipt,
  SKILL_RUNTIME_RESULT_FIELDS,
} from "./workbench-skill-runtime-storage.mjs";
import {
  SKILL_FEATURE,
  isSkillSave,
  validSkillSavedResult,
} from "./workbench-skill-storage.mjs";
import { validSkillSourceName } from "../renderer/shared/configuration-draft/skill.mjs";
import {
  MCP_FEATURE,
  mcpNativeName,
  mcpStep,
  validMcpNativeName,
  validMcpSourceName,
} from "./workbench-mcp.mjs";
import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  INSTRUCTION_FEATURE,
  INSTRUCTION_KEY,
  validInstructionRegistration,
  canonicalInstructionRegistration,
  PENDING,
  verifiedInheritance,
} from "./workbench-instructions.mjs";
import { validWireId, ERRORS } from "../workbench-contract.mjs";

export const STORAGE_LIMITS = Object.freeze({
  recordBytes: 4 * 1024 * 1024,
  operations: 2048,
  workspaces: 100,
  sessions: 200,
});
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
const mutations = new Set([
  ...PERMISSION_TYPES,
  "git.branch.apply",
  "git.restore.apply",
  "git.commit.apply",
  "git.index.apply",
  "file.save",
  "configuration.agent.save",
  "configuration.agent.register",
  "configuration.agent.remove",
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
  "permission.mode.set",
  "session.archive",
  "session.fork",
  "session.remove",
  "session.revert",
  "session.revert.clear",
  "workspace.import",
  "workspace.create",
  "workspace.remove",
  "session.create",
  "message.send",
  "session.inbox.cancel",
  "session.interrupt",
  "permission.respond",
  "command.run",
]);
export const DISPATCH_STEPS = Object.freeze([
  ...PERMISSION_STEPS,
  INBOX_CANCEL_STEP,
  ...Object.values(GIT_BRANCH_RESTORE_STEPS),
  ...Object.values(GIT_COMMIT_STEPS),
  ...Object.values(GIT_INDEX_STEPS),
  "native.agent.register",
  "native.agent.remove",
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
  "native.revert.stage",
  "native.revert.clear",
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
  "filesystem.managed_folder",
]);
const zeroHash = "0".repeat(64);
const clone = (value) => JSON.parse(JSON.stringify(value));
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function storageError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
function need(condition, code = "invalid_record") {
  if (!condition) throw storageError(code);
}
const dataObject = (value) =>
  Boolean(
    value &&
      Object.getPrototypeOf(value) === Object.prototype &&
      Reflect.ownKeys(value).every(
        (key) =>
          typeof key === "string" &&
          Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value"),
      ),
  );
const denseArray = (value) =>
  Array.isArray(value) &&
  Object.getPrototypeOf(value) === Array.prototype &&
  Reflect.ownKeys(value).length === value.length + 1 &&
  Array.from({ length: value.length }, (_, i) => i).every((i) =>
    Object.hasOwn(
      Object.getOwnPropertyDescriptor(value, String(i)) ?? {},
      "value",
    ),
  );
function closed(value, required, optional = []) {
  need(
    value !== null &&
      typeof value === "object" &&
      Object.getPrototypeOf(value) === Object.prototype,
  );
  need(
    required.every((key) => Object.hasOwn(value, key)) &&
      Reflect.ownKeys(value).every(
        (key) =>
          typeof key === "string" &&
          [...required, ...optional].includes(key) &&
          Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value"),
      ),
  );
}
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const digest = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const id = (value) => validWireId(value);
const resourceId = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_.:-]{1,256}$/.test(value);
const displayText = (value) =>
  ![...value].some(
    (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
  );
const path = (value) =>
  typeof value === "string" &&
  value.length <= 4096 &&
  !value.includes("\0") &&
  isAbsolute(value) &&
  resolve(value) === value;
function optionalIds(value, names) {
  for (const name of names)
    if (Object.hasOwn(value, name)) need(resourceId(value[name]));
}
export function validateStorageIdentity(value) {
  closed(
    value,
    ["runtimeEpoch", "operationId", "type", "digest"],
    ["workspaceId", "sessionId"],
  );
  need(
    id(value.runtimeEpoch) &&
      id(value.operationId) &&
      mutations.has(value.type) &&
      digest(value.digest),
  );
  optionalIds(value, ["workspaceId", "sessionId"]);
  need(!value.sessionId || value.workspaceId);
  if (isSkillSave(value.type) || isAgentSave(value.type))
    need(value.workspaceId && !Object.hasOwn(value, "sessionId"));
  if (instructionStep(value.type)) need(value.workspaceId && value.sessionId);
  if (mcpStep(value.type))
    need(value.workspaceId && !Object.hasOwn(value, "sessionId"));
  validatePermissionScope(value);
  validateInboxCancelScope(value);
  validateFileScope(value);
  validateGitIndexScope(value);
  validateGitCommitScope(value);
  validateGitBranchRestoreScope(value);
  validateSkillRuntimeScope(value);
  validateAgentRuntimeScope(value);
  return clone(value);
}
export function validateStorageReceipt(value) {
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
      "evidence",
    ],
    ["workspaceId", "sessionId", "result"],
  );
  need(
    id(value.runtimeEpoch) &&
      id(value.operationId) &&
      mutations.has(value.type) &&
      integer(value.revision),
  );
  optionalIds(value, ["workspaceId", "sessionId"]);
  need(!value.sessionId || value.workspaceId);
  need(["admitted", "dispatched", "rejected"].includes(value.admission));
  need(
    ["pending", "accepted", "unknown"].includes(value.delivery) &&
      ["none", "pending", "confirmed", "unknown"].includes(value.effect),
  );
  need(
    Array.isArray(value.evidence) &&
      value.evidence.length <= 8 &&
      denseArray(value.evidence),
  );
  for (const entry of value.evidence) {
    closed(entry, ["kind"], ["id"]);
    need(resourceId(entry.kind));
    optionalIds(entry, ["id"]);
  }
  if (Object.hasOwn(value, "result")) {
    const result = value.result;
    need(dataObject(result));
    const shapes = {
      inbox_cancel_requested: [INBOX_CANCEL_RESULT_FIELDS, []],
      git_branch_restore_applied: [GIT_BRANCH_RESTORE_RESULT_FIELDS, []],
      git_commit_created: [GIT_COMMIT_RESULT_FIELDS, []],
      git_index_updated: [GIT_INDEX_RESULT_FIELDS, []],
      created: [
        ["kind", "workspaceId"],
        ["sessionId", "nativeSessionId"],
      ],
      forked: [["kind", "workspaceId", "sessionId", "nativeSessionId"], []],
      removed: [
        ["kind", "workspaceId", "workspaceRemoved"],
        ["removedSessionIds"],
      ],
      metadata: [["kind", "workspaceId", "sessionId"], []],
      agent_file_saved: [
        ["kind", "workspaceId", "sourceName", "version"],
        ["backupId"],
      ],
      skill_file_saved: [
        ["kind", "workspaceId", "sourceName", "version"],
        ["backupId"],
      ],
      file_saved: [
        ["kind", "workspaceId", "path", "version", "digest", "backupId"],
        [],
      ],
      configuration_saved: [
        ["kind", "workspaceId", "configurationKind", "version"],
        ["backupId"],
      ],
      mcp_registered: [
        [
          "kind",
          "workspaceId",
          "sourceName",
          "nativeName",
          "digest",
          "sourceVersion",
          "status",
        ],
        [],
      ],
      mcp_connection: [
        [
          "kind",
          "workspaceId",
          "sourceName",
          "nativeName",
          "action",
          "connectionStatus",
        ],
        [],
      ],
      mcp_removed: [["kind", "workspaceId", "sourceName", "nativeName"], []],
      instruction_registered: [
        ["kind", "workspaceId", "sessionId", "digest", "sourceVersion"],
        [],
      ],
      instruction_removed: [["kind", "workspaceId", "sessionId"], []],
      delivery: [
        ["kind", "status"],
        ["nativeInboxId", "nativeRequestId"],
      ],
      rejected: [["kind", "code"], []],
    };
    for (const [kind, fields] of Object.entries(SKILL_RUNTIME_RESULT_FIELDS))
      shapes[kind] = [["kind", "workspaceId", ...fields], []];
    for (const [kind, fields] of Object.entries(AGENT_RUNTIME_RESULT_FIELDS))
      shapes[kind] = [["kind", "workspaceId", ...fields], []];
    for (const [kind, fields] of Object.entries(PERMISSION_RESULT_FIELDS))
      shapes[kind] = [fields, []];
    need(Object.hasOwn(shapes, result.kind));
    closed(result, ...shapes[result.kind]);
    if (Object.hasOwn(SKILL_RUNTIME_RESULT_FIELDS, result.kind))
      need(skillRuntimeStep(value.type));
    if (Object.hasOwn(AGENT_RUNTIME_RESULT_FIELDS, result.kind))
      need(agentRuntimeStep(value.type));
    if (result.kind === "agent_file_saved")
      need(validAgentSavedResult(value, result.sourceName));
    optionalIds(result, [
      "workspaceId",
      "sessionId",
      "nativeSessionId",
      "nativeInboxId",
      "nativeRequestId",
    ]);
    if (
      ["mcp_registered", "mcp_connection", "mcp_removed"].includes(result.kind)
    ) {
      need(
        mcpStep(value.type) &&
          value.workspaceId === result.workspaceId &&
          !Object.hasOwn(value, "sessionId") &&
          validMcpSourceName(result.sourceName) &&
          validMcpNativeName(result.nativeName) &&
          result.nativeName ===
            mcpNativeName(value.workspaceId, result.sourceName) &&
          value.delivery === "accepted" &&
          ((value.effect === "confirmed" && value.admission === "dispatched") ||
            isMcpAbsentRemoval(value)),
      );
      if (result.kind === "mcp_registered")
        need(
          value.type === "configuration.mcp.register" &&
            digest(result.digest) &&
            digest(result.sourceVersion) &&
            result.status === "disabled",
        );
      if (result.kind === "mcp_connection")
        need(
          (value.type === "configuration.mcp.connect" &&
            result.action === "connect" &&
            ["connected", "failed", "needs_auth"].includes(
              result.connectionStatus,
            )) ||
            (value.type === "configuration.mcp.disconnect" &&
              result.action === "disconnect" &&
              result.connectionStatus === "disabled"),
        );
      if (result.kind === "mcp_removed")
        need(value.type === "configuration.mcp.remove");
    }
    if (result.kind === "skill_file_saved")
      need(validSkillSavedResult(value, result.sourceName));
    if (result.kind === "configuration_saved")
      need(
        value.type === "configuration.save" &&
          value.workspaceId === result.workspaceId &&
          value.effect === "confirmed" &&
          ["instructions", "mcp"].includes(result.configurationKind) &&
          digest(result.version) &&
          (result.backupId === undefined ||
            (typeof result.backupId === "string" &&
              new RegExp(
                `^\\.omoc-configuration-[a-f0-9]{64}\\.${result.configurationKind}\\.backup$`,
              ).test(result.backupId))),
      );
    if (
      ["instruction_registered", "instruction_removed"].includes(result.kind)
    ) {
      need(
        value.type ===
          (result.kind === "instruction_registered"
            ? "configuration.instructions.apply"
            : "configuration.instructions.remove") &&
          value.workspaceId === result.workspaceId &&
          value.sessionId === result.sessionId &&
          value.admission === "dispatched" &&
          value.delivery === "accepted" &&
          value.effect === "confirmed",
      );
      if (result.kind === "instruction_registered")
        need(digest(result.digest) && digest(result.sourceVersion));
    }
    if (result.kind === "removed") {
      need(typeof result.workspaceRemoved === "boolean");
      if (Object.hasOwn(result, "removedSessionIds"))
        need(
          Array.isArray(result.removedSessionIds) &&
            result.removedSessionIds.length <= 200 &&
            result.removedSessionIds.every(resourceId) &&
            new Set(result.removedSessionIds).size ===
              result.removedSessionIds.length,
        );
    }
    if (result.kind === "delivery")
      need(["accepted", "stopping", "decided"].includes(result.status));
    if (result.kind === "rejected") need(Object.hasOwn(ERRORS, result.code));
  }
  if (mcpStep(value.type)) {
    need(value.workspaceId && !Object.hasOwn(value, "sessionId"));
    need(
      value.result === undefined ||
        [
          "mcp_registered",
          "mcp_connection",
          "mcp_removed",
          "rejected",
        ].includes(value.result.kind),
    );
    if (value.effect === "confirmed")
      need(value.result && value.result.kind !== "rejected");
    if (value.result?.kind === "rejected")
      need(value.admission === "rejected" && value.effect === "none");
    if (value.effect === "none" && value.delivery === "accepted")
      need(isMcpAbsentRemoval(value));
  }
  if (isSkillSave(value.type)) {
    need(value.workspaceId && !Object.hasOwn(value, "sessionId"));
    if (value.effect === "confirmed")
      need(validSkillSavedResult(value, value.result?.sourceName));
    else
      need(
        value.result === undefined ||
          (value.result.kind === "rejected" &&
            value.admission === "rejected" &&
            value.effect === "none"),
      );
  }
  if (isAgentSave(value.type)) {
    need(value.workspaceId && !Object.hasOwn(value, "sessionId"));
    if (value.effect === "confirmed")
      need(validAgentSavedResult(value, value.result?.sourceName));
    else
      need(
        (value.result === undefined ||
          (value.result.kind === "rejected" &&
            value.admission === "rejected" &&
            value.effect === "none")) &&
          !(value.delivery === "accepted" && value.effect === "none"),
      );
  }
  validatePermissionReceipt(value);
  validateInboxCancelReceipt(value);
  validateFileReceipt(value);
  validateGitIndexReceipt(value);
  validateGitCommitReceipt(value);
  validateGitBranchRestoreReceipt(value);
  validateSkillRuntimeReceipt(value);
  validateAgentRuntimeReceipt(value);
  return clone(value);
}
export function validateRegistryDelta(value) {
  closed(value, ["workspaces", "sessions", "tombstones"]);
  need(
    Array.isArray(value.workspaces) &&
      value.workspaces.length <= 100 &&
      Array.isArray(value.sessions) &&
      value.sessions.length <= 200 &&
      Array.isArray(value.tombstones) &&
      value.tombstones.length <= 300 &&
      [value.workspaces, value.sessions, value.tombstones].every(denseArray),
  );
  for (const workspace of value.workspaces) {
    closed(
      workspace,
      ["workspaceId", "ownership", "canonicalPath", "registrationState"],
      ["folderSessionId", "name", "trustRevision", "storageGeneration"],
    );
    need(
      resourceId(workspace.workspaceId) &&
        ["managed", "imported", "legacy"].includes(workspace.ownership) &&
        path(workspace.canonicalPath) &&
        ["reserved", "registered", "unavailable"].includes(
          workspace.registrationState,
        ),
    );
    optionalIds(workspace, ["folderSessionId"]);
    if (workspace.ownership === "managed")
      need(
        typeof workspace.folderSessionId === "string" &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
            workspace.folderSessionId,
          ),
      );
    if (workspace.name !== undefined)
      need(
        typeof workspace.name === "string" &&
          workspace.name.length <= 256 &&
          displayText(workspace.name),
      );
    for (const key of ["trustRevision", "storageGeneration"])
      if (workspace[key] !== undefined) need(integer(workspace[key]));
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
        "instructionRegistration",
        "permissionControl",
        "permissionMode",
      ],
    );
    if (Object.hasOwn(session, "permissionMode"))
      need(
        ["ask", "scoped_edit", "read_plan"].includes(session.permissionMode),
      );
    need(
      resourceId(session.appSessionId) &&
        resourceId(session.workspaceId) &&
        ["reserved", "active", "unavailable"].includes(
          session.lifecycleState,
        ) &&
        typeof session.pinned === "boolean" &&
        typeof session.archived === "boolean",
    );
    optionalIds(session, ["nativeSessionId", "parentSessionId"]);
    if (Object.hasOwn(session, "permissionControl"))
      validatePermissionControl(session.permissionControl);
    if (Object.hasOwn(session, "instructionRegistration"))
      need(validInstructionRegistration(session.instructionRegistration));
    if (session.title !== undefined)
      need(
        typeof session.title === "string" &&
          session.title.length <= 256 &&
          displayText(session.title),
      );
    if (session.lastViewedAt !== undefined) need(integer(session.lastViewedAt));
    if (session.recoveryReason !== undefined)
      need(
        session.lifecycleState === "unavailable" &&
          RESOURCE_RECOVERY_REASONS.includes(session.recoveryReason),
      );
  }
  for (const entry of value.tombstones) {
    closed(entry, ["kind", "id"]);
    need(["workspace", "session"].includes(entry.kind) && resourceId(entry.id));
  }
  for (const [entries, key] of [
    [value.workspaces, "workspaceId"],
    [value.sessions, "appSessionId"],
  ])
    need(
      new Set(entries.map((entry) => entry[key])).size === entries.length,
      "identity_conflict",
    );
  need(
    new Set(
      value.tombstones.map((entry) => JSON.stringify([entry.kind, entry.id])),
    ).size === value.tombstones.length,
    "identity_conflict",
  );
  return clone(value);
}
export function validateJournalPayload(value) {
  need(dataObject(value));
  if (isTaskRecord(value.kind)) return validateTaskRecord(value);
  if (value.kind === "permission_reconciled")
    return validatePermissionReconciliationRecord(value);
  if (value.kind === "permission_progress")
    return validatePermissionProgressPayload(value);
  const common = ["kind", "revision"];
  need(
    value &&
      typeof value.kind === "string" &&
      integer(value.revision) &&
      value.revision > 0,
  );
  switch (value.kind) {
    case "feature_gate":
      closed(value, [...common, "feature"]);
      need(
        [
          PERMISSION_FEATURE,
          TASK_FEATURE,
          PERMISSION_RECONCILIATION_FEATURE,
          BEFORE_BRANCH_FEATURE,
          INBOX_CANCEL_FEATURE,
          FILE_FEATURE,
          GIT_BRANCH_RESTORE_FEATURE,
          GIT_COMMIT_FEATURE,
          GIT_INDEX_FEATURE,
          "configuration_save_v1",
          INSTRUCTION_FEATURE,
          PERMISSION_MODE_FEATURE,
          MCP_FEATURE,
          SKILL_FEATURE,
          SKILL_RUNTIME_FEATURE,
          AGENT_FEATURE,
        ].includes(value.feature),
        "unsupported_version",
      );
      break;
    case "admission":
      closed(
        value,
        [...common, "identity"],
        [
          "rejectionCode",
          "nativeServerName",
          "skillSourceName",
          "agentSourceName",
          "agentRuntime",
          "skillRuntime",
          "inboxTarget",
          "forkTarget",
          "fileTarget",
          "expectedRevision",
          "gitBranchRestoreTarget",
          "gitCommitTarget",
          "gitIndexTarget",
          "permissionTarget",
        ],
      );
      validateStorageIdentity(value.identity);
      validatePermissionAdmission(value);
      validateBeforeBranchAdmission(value);
      validateInboxCancelAdmission(value);
      validateFileAdmission(value);
      validateGitIndexAdmission(value);
      validateGitCommitAdmission(
        isGitBranchRestoreApply(value.identity.type)
          ? (({ expectedRevision: _revision, ...rest }) => rest)(value)
          : value,
      );
      validateGitBranchRestoreAdmission(value);
      validateMcpAdmission(value);
      validateSkillAdmission(value);
      validateAgentFileAdmission(value);
      validateAgentRuntimeAdmission(value);
      validateSkillRuntimeAdmission(value);
      if (value.rejectionCode !== undefined)
        need(Object.hasOwn(ERRORS, value.rejectionCode));
      break;
    case "reservation":
      closed(
        value,
        [...common, "runtimeEpoch", "operationId", "workspace", "appSessionId"],
        ["plannedNativeSessionId"],
      );
      need(
        id(value.runtimeEpoch) &&
          id(value.operationId) &&
          resourceId(value.appSessionId),
      );
      optionalIds(value, ["plannedNativeSessionId"]);
      validateRegistryDelta({
        workspaces: [value.workspace],
        sessions: [],
        tombstones: [],
      });
      need(value.workspace.registrationState === "reserved");
      break;
    case "dispatch":
      closed(
        value,
        [...common, "runtimeEpoch", "operationId", "step"],
        [
          "nativeSessionId",
          "nativeServerName",
          "skillRuntime",
          "agentRuntime",
          "inboxTarget",
          "forkTarget",
          "fileTarget",
          "gitBranchRestoreTarget",
          "gitCommitTarget",
          "gitIndexTarget",
          "permissionEffect",
        ],
      );
      need(
        id(value.runtimeEpoch) &&
          id(value.operationId) &&
          DISPATCH_STEPS.includes(value.step),
      );
      optionalIds(value, ["nativeSessionId"]);
      validatePermissionDispatchPayload(value);
      validateBeforeBranchDispatchPayload(value);
      validateInboxCancelDispatchPayload(value);
      validateFileDispatchPayload(value);
      validateGitIndexDispatchPayload(value);
      validateGitCommitDispatchPayload(value);
      validateGitBranchRestoreDispatchPayload(value);
      validateSkillRuntimeDispatchPayload(value);
      validateAgentRuntimeDispatchPayload(value);
      if (value.step.startsWith("native.mcp."))
        need(
          validMcpNativeName(value.nativeServerName) &&
            !Object.hasOwn(value, "nativeSessionId"),
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
        "delta",
      ]);
      need(id(value.runtimeEpoch) && id(value.operationId));
      validateStorageReceipt(value.receipt);
      validateRegistryDelta(value.delta);
      need(
        value.receipt.runtimeEpoch === value.runtimeEpoch &&
          value.receipt.operationId === value.operationId &&
          value.receipt.revision === value.revision,
      );
      break;
    case "owner_intent":
      closed(value, [...common, "ownerNonce", "phase"], ["childId"]);
      need(
        id(value.ownerNonce) &&
          ["startup", "child_started", "shutdown"].includes(value.phase),
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
        "inventoryHash",
      ]);
      need(
        id(value.migrationId) &&
          id(value.sourceStoreId) &&
          id(value.destinationStoreId) &&
          value.sourceStoreId !== value.destinationStoreId &&
          [
            "retained",
            "quiesced",
            "copied",
            "verified",
            "cutover",
            "rollback",
          ].includes(value.phase) &&
          digest(value.inventoryHash),
      );
      break;
    case "recovery_decision":
      if (value.action === RETAIN_TAIL_AS_UNKNOWN) {
        closed(value, [
          ...common,
          "action",
          "fromSequence",
          "throughSequence",
          "throughHash",
          "operations",
        ]);
        need(
          integer(value.fromSequence) &&
            integer(value.throughSequence) &&
            value.fromSequence <= value.throughSequence &&
            digest(value.throughHash) &&
            Array.isArray(value.operations) &&
            value.operations.length <= STORAGE_LIMITS.operations,
        );
        for (const operation of value.operations) {
          closed(operation, ["runtimeEpoch", "operationId"]);
          need(id(operation.runtimeEpoch) && id(operation.operationId));
        }
        need(
          new Set(value.operations.map(operationKey)).size ===
            value.operations.length,
        );
        break;
      }
      closed(value, [...common, "action", "throughSequence", "throughHash"]);
      need(
        value.action === "adopt_validated_tail" &&
          integer(value.throughSequence) &&
          digest(value.throughHash),
      );
      break;
    default:
      throw storageError("unsupported_version");
  }
  return clone(value);
}
const operationKey = (value) =>
  JSON.stringify([value.runtimeEpoch, value.operationId]);
export function instructionStep(type) {
  if (type === "configuration.instructions.apply")
    return "native.instructions.put";
  if (type === "configuration.instructions.remove")
    return "native.instructions.remove";
  return undefined;
}
export const PERMISSION_MODE_FEATURE = "permission_mode_v1";
// mode.set writes the parent, its Native subagent children and any restore of
// the previous mode: several native.policy dispatches, one per Native session.
export const isModePolicyWrite = (type, dispatch) =>
  type === "permission.mode.set" &&
  dispatch.step === "native.policy" &&
  typeof dispatch.nativeSessionId === "string";
export function validatePermissionModeCompletion(payload, features) {
  if (
    payload.delta.sessions.some((session) =>
      Object.hasOwn(session, "permissionMode"),
    )
  )
    need(features.includes(PERMISSION_MODE_FEATURE), "unsupported_version");
}
export function validateInstructionDispatch(identity, dispatch, sessions) {
  const expected = instructionStep(identity.type);
  if (!expected && !dispatch.step.startsWith("native.instructions.")) return;
  const target = sessions.get(identity.sessionId);
  need(
    expected === dispatch.step &&
      target?.workspaceId === identity.workspaceId &&
      target.lifecycleState === "active" &&
      target.nativeSessionId &&
      target.nativeSessionId === dispatch.nativeSessionId,
    "identity_conflict",
  );
}
export function validateInstructionCompletion(
  operation,
  payload,
  sessions,
  features,
) {
  const { identity, reservation, dispatches } = operation;
  const { receipt, delta } = payload;
  const step = instructionStep(identity.type);
  const confirmed = receipt.effect === "confirmed";
  if (
    delta.sessions.some((session) =>
      Object.hasOwn(session, "instructionRegistration"),
    )
  )
    need(features.includes(INSTRUCTION_FEATURE), "unsupported_version");
  if (step) {
    if (!confirmed) {
      need(
        delta.sessions.length === 0 &&
          delta.workspaces.length === 0 &&
          delta.tombstones.length === 0 &&
          (receipt.result === undefined ||
            (receipt.admission === "rejected" &&
              receipt.effect === "none" &&
              receipt.result.kind === "rejected")),
        "identity_conflict",
      );
      return;
    }
    const target = sessions.get(identity.sessionId);
    const session = delta.sessions[0] ?? target;
    const result = receipt.result;
    need(
      target &&
        target.workspaceId === identity.workspaceId &&
        target.lifecycleState === "active" &&
        target.nativeSessionId &&
        dispatches.some(
          (entry) =>
            entry.step === step &&
            entry.nativeSessionId === target.nativeSessionId,
        ) &&
        receipt.admission === "dispatched" &&
        receipt.delivery === "accepted" &&
        delta.workspaces.length === 0 &&
        delta.tombstones.length === 0 &&
        delta.sessions.length <= 1 &&
        session.appSessionId === identity.sessionId &&
        session.workspaceId === identity.workspaceId &&
        session.nativeSessionId === target.nativeSessionId &&
        session.lifecycleState === "active" &&
        result?.workspaceId === identity.workspaceId &&
        result?.sessionId === identity.sessionId,
      "identity_conflict",
    );
    const expected =
      step === "native.instructions.put"
        ? {
            state: "registered",
            key: INSTRUCTION_KEY,
            digest: result.digest,
            sourceVersion: result.sourceVersion,
            origin: "direct",
          }
        : { state: "absent", key: INSTRUCTION_KEY };
    need(
      result.kind ===
        (step === "native.instructions.put"
          ? "instruction_registered"
          : "instruction_removed") &&
        isDeepStrictEqual(
          canonicalInstructionRegistration(session.instructionRegistration),
          expected,
        ),
      "identity_conflict",
    );
    // Instruction effects cannot alter independent session fields.
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
      existing?.instructionRegistration,
    );
    if (
      identity.type === "session.fork" &&
      session.appSessionId === reservation?.appSessionId &&
      confirmed
    ) {
      const parent = sessions.get(identity.sessionId);
      const registration = parent?.instructionRegistration;
      // Legacy forks with no registration keep their original completion contract.
      if (registration !== undefined) {
        need(
          parent.workspaceId === identity.workspaceId &&
            session.parentSessionId === identity.sessionId &&
            session.lifecycleState === "active" &&
            session.nativeSessionId &&
            dispatches.some((entry) => entry.step === "native.fork") &&
            receipt.admission === "dispatched" &&
            receipt.delivery === "accepted" &&
            receipt.result?.kind === "forked" &&
            receipt.result.workspaceId === session.workspaceId &&
            receipt.result.sessionId === session.appSessionId &&
            receipt.result.nativeSessionId === session.nativeSessionId &&
            receipt.evidence.some(
              (entry) =>
                entry.kind === "native_session_verified" &&
                entry.id === session.nativeSessionId,
            ),
          "identity_conflict",
        );
        expected =
          registration.state === "registered" || registration.state === PENDING
            ? {
                // A pending parent forks a pending (reconciled) or promoted
                // (live) child; both are covered by the checks below.
                state: registration.state,
                key: INSTRUCTION_KEY,
                digest: registration.digest,
                sourceVersion: registration.sourceVersion,
                origin: "fork",
                inheritedFromSessionId: identity.sessionId,
              }
            : canonicalInstructionRegistration(registration);
      }
    }
    const actual = canonicalInstructionRegistration(
      session.instructionRegistration,
    );
    // Unverified inheritance (startup reconciliation) is the same claim held
    // back; a later verified promotion of a pending row is the same claim again.
    const pending = (value) =>
      value?.state === "registered" && value.origin === "fork"
        ? { ...value, state: PENDING }
        : value;
    need(
      isDeepStrictEqual(actual, expected) ||
        (identity.type === "session.fork" &&
          confirmed &&
          session.appSessionId === reservation?.appSessionId &&
          isDeepStrictEqual(actual, pending(expected))) ||
        // Accepted gap: pending->registered promotion is not tied to a receipt
        // observation record; every instruction observation re-hashes against
        // the Native entry, so a wrong promotion is detected on first read.
        (expected?.state === PENDING &&
          isDeepStrictEqual(actual, verifiedInheritance(expected))),
      "identity_conflict",
    );
  }
}
export function validateMcpAdmission(value) {
  need(
    mcpStep(value.identity.type)
      ? validMcpNativeName(value.nativeServerName)
      : !Object.hasOwn(value, "nativeServerName"),
  );
}
export function validateMcpDispatch(operation, dispatch) {
  need(typeof dispatch.step === "string");
  const expected = mcpStep(operation.identity.type);
  if (
    !expected &&
    !dispatch.step.startsWith("native.mcp.") &&
    !Object.hasOwn(dispatch, "nativeServerName")
  )
    return;
  need(
    expected === dispatch.step &&
      operation.identity.workspaceId &&
      !Object.hasOwn(operation.identity, "sessionId") &&
      !Object.hasOwn(dispatch, "nativeSessionId") &&
      validMcpNativeName(dispatch.nativeServerName) &&
      dispatch.nativeServerName === operation.nativeServerName,
    "identity_conflict",
  );
}
export function isMcpAbsentRemoval(receipt) {
  return (
    receipt.type === "configuration.mcp.remove" &&
    receipt.admission === "admitted" &&
    receipt.delivery === "accepted" &&
    receipt.effect === "none" &&
    receipt.result?.kind === "mcp_removed"
  );
}
export function validateMcpCompletion(operation, payload, features) {
  const { identity, dispatches } = operation;
  const { receipt, delta } = payload;
  if (!mcpStep(identity.type)) return;
  need(features.includes(MCP_FEATURE), "unsupported_version");
  need(
    delta.workspaces.length === 0 &&
      delta.sessions.length === 0 &&
      delta.tombstones.length === 0,
    "identity_conflict",
  );
  const successful =
    receipt.effect === "confirmed" || isMcpAbsentRemoval(receipt);
  if (!successful) {
    need(
      receipt.result === undefined ||
        (receipt.admission === "rejected" &&
          receipt.effect === "none" &&
          receipt.result.kind === "rejected"),
      "identity_conflict",
    );
    return;
  }
  need(
    receipt.result?.nativeName === operation.nativeServerName &&
      receipt.result?.workspaceId === identity.workspaceId &&
      receipt.result.nativeName ===
        mcpNativeName(identity.workspaceId, receipt.result.sourceName) &&
      (isMcpAbsentRemoval(receipt)
        ? dispatches.length === 0
        : dispatches.length === 1 &&
          dispatches[0].step === mcpStep(identity.type) &&
          dispatches[0].nativeServerName === operation.nativeServerName),
    "identity_conflict",
  );
}
export function validateSkillAdmission(value) {
  need(
    isSkillSave(value.identity.type)
      ? validSkillSourceName(value.skillSourceName)
      : !Object.hasOwn(value, "skillSourceName"),
  );
}
export function validateSkillDispatch(operation, dispatch) {
  if (!isSkillSave(operation.identity.type)) return;
  need(
    [
      "filesystem.configuration.stage",
      "filesystem.configuration.publish",
    ].includes(dispatch.step) &&
      !Object.hasOwn(dispatch, "nativeSessionId") &&
      !Object.hasOwn(dispatch, "nativeServerName") &&
      (dispatch.step !== "filesystem.configuration.publish" ||
        operation.dispatches.some(
          (entry) => entry.step === "filesystem.configuration.stage",
        )),
    "identity_conflict",
  );
}
export function validateSkillCompletion(operation, payload, features) {
  if (!isSkillSave(operation.identity.type)) return;
  need(features.includes(SKILL_FEATURE), "unsupported_version");
  const { receipt, delta } = payload;
  need(
    !operation.reservation &&
      !operation.reserved &&
      delta.workspaces.length === 0 &&
      delta.sessions.length === 0 &&
      delta.tombstones.length === 0,
    "identity_conflict",
  );
  if (receipt.effect === "confirmed") {
    need(
      validSkillSavedResult(receipt, operation.skillSourceName) &&
        operation.dispatches.length === 2 &&
        operation.dispatches[0].step === "filesystem.configuration.stage" &&
        operation.dispatches[1].step === "filesystem.configuration.publish",
      "identity_conflict",
    );
  } else
    need(
      receipt.result === undefined ||
        (receipt.result.kind === "rejected" &&
          receipt.admission === "rejected" &&
          receipt.effect === "none" &&
          operation.dispatches.length === 0),
      "identity_conflict",
    );
}
export function validateAgentFileAdmission(value) {
  need(
    isAgentSave(value.identity.type)
      ? validAgentSourceName(value.agentSourceName)
      : !Object.hasOwn(value, "agentSourceName"),
  );
}
export function validateAgentFileDispatch(operation, dispatch) {
  if (!isAgentSave(operation.identity.type)) return;
  need(
    [
      "filesystem.configuration.stage",
      "filesystem.configuration.publish",
    ].includes(dispatch.step) &&
      !Object.hasOwn(dispatch, "nativeSessionId") &&
      !Object.hasOwn(dispatch, "nativeServerName") &&
      (dispatch.step !== "filesystem.configuration.publish" ||
        operation.dispatches.some(
          (entry) => entry.step === "filesystem.configuration.stage",
        )),
    "identity_conflict",
  );
}
export function validateAgentFileCompletion(operation, payload, features) {
  if (!isAgentSave(operation.identity.type)) return;
  need(features.includes(AGENT_FEATURE), "unsupported_version");
  const { receipt, delta } = payload;
  need(
    !operation.reservation &&
      !operation.reserved &&
      delta.workspaces.length === 0 &&
      delta.sessions.length === 0 &&
      delta.tombstones.length === 0,
    "identity_conflict",
  );
  if (receipt.effect === "confirmed") {
    need(
      validAgentSavedResult(receipt, operation.agentSourceName) &&
        operation.dispatches.length === 2 &&
        operation.dispatches[0].step === "filesystem.configuration.stage" &&
        operation.dispatches[1].step === "filesystem.configuration.publish",
      "identity_conflict",
    );
  } else
    need(
      receipt.result === undefined ||
        (receipt.result.kind === "rejected" &&
          receipt.admission === "rejected" &&
          receipt.effect === "none" &&
          operation.dispatches.length === 0),
      "identity_conflict",
    );
}
// Crash recovery without authority: a decision may only cover records of
// operations that carry no task, permission or execution authority. Their
// outcomes become UNKNOWN; nothing is replayed. Anything else stays held.
export const RETAIN_TAIL_AS_UNKNOWN = "retain_tail_as_unknown";
export const RETAINABLE_OPERATION_TYPES = Object.freeze([
  "session.rename",
  "session.pin",
  "session.archive",
  "configuration.save",
]);
const RETAINABLE_STEPS = new Set([
  "native.rename",
  "registry.metadata",
  "filesystem.configuration.stage",
  "filesystem.configuration.publish",
]);
const RETAINABLE_ADMISSION_FIELDS = new Set([
  "kind",
  "revision",
  "identity",
  "rejectionCode",
]);
const RETAINABLE_DISPATCH_FIELDS = new Set([
  "kind",
  "revision",
  "runtimeEpoch",
  "operationId",
  "step",
  "nativeSessionId",
]);
// records: full validated journal; [fromSequence, records.length) is covered.
export function retainableTail(records, fromSequence, operations) {
  const listed = new Set(operations.map(operationKey));
  if (listed.size !== operations.length) return false;
  const admissions = new Map();
  for (const { payload } of records)
    if (payload.kind === "admission")
      admissions.set(operationKey(payload.identity), payload);
  const retainableOp = (key) =>
    RETAINABLE_OPERATION_TYPES.includes(admissions.get(key)?.identity.type);
  const allowed = (payload) => {
    if (payload.kind === "owner_intent") return true;
    if (payload.kind === "feature_gate")
      return payload.feature === "configuration_save_v1";
    if (payload.kind === "admission")
      return (
        retainableOp(operationKey(payload.identity)) &&
        Object.keys(payload).every((field) =>
          RETAINABLE_ADMISSION_FIELDS.has(field),
        )
      );
    if (payload.kind === "dispatch")
      return (
        retainableOp(operationKey(payload)) &&
        RETAINABLE_STEPS.has(payload.step) &&
        Object.keys(payload).every((field) =>
          RETAINABLE_DISPATCH_FIELDS.has(field),
        )
      );
    if (payload.kind === "completion")
      return retainableOp(operationKey(payload));
    // Task, permission, reservation, migration and decision records never.
    return false;
  };
  // Exactly the operations the confirmed prefix leaves open must be listed,
  // and it may leave no task unsettled.
  const prefix = historyValidator();
  try {
    for (const { payload } of records.slice(0, fromSequence)) prefix(payload);
  } catch {
    return false;
  }
  for (const [key, operation] of prefix.state.operations)
    if (!operation.terminal && !listed.has(key)) return false;
  for (const task of prefix.state.tasks.values())
    if (task.phase !== "settled") return false;
  for (const { payload } of records.slice(fromSequence)) {
    if (!allowed(payload)) return false;
    if (
      payload.kind === "admission" &&
      !listed.has(operationKey(payload.identity))
    )
      return false;
  }
  for (const key of listed) {
    if (!retainableOp(key)) return false;
    for (const [index, { payload }] of records.entries()) {
      const recordKey =
        payload.kind === "admission"
          ? operationKey(payload.identity)
          : isTaskRecord(payload.kind) ||
              payload.kind === "dispatch" ||
              payload.kind === "completion" ||
              payload.kind === "reservation" ||
              payload.kind === "permission_progress"
            ? operationKey(payload)
            : payload.kind === "permission_reconciled"
              ? operationKey(payload.original)
              : undefined;
      if (recordKey !== key) continue;
      if (!allowed(payload)) return false;
      // A confirmed prefix outcome is already terminal: never rewrite it.
      if (payload.kind === "completion" && index < fromSequence) return false;
    }
  }
  return true;
}
function historyValidator() {
  const operations = new Map();
  const tasks = new Map();
  const workspaces = new Map();
  const migrations = new Map();
  const sessions = new Map();
  const features = new Set();
  let revision = 0;
  const validate = (payload) => {
    if (payload.kind === "permission_reconciled") {
      need(
        features.has(PERMISSION_RECONCILIATION_FEATURE),
        "unsupported_version",
      );
      const operation = operations.get(operationKey(payload.original));
      need(
        operation && isPermissionControl(operation.identity.type),
        "identity_conflict",
      );
      applyPermissionReconciliation(operation, payload);
      return;
    }
    if (payload.kind === "permission_progress") {
      const op = operations.get(operationKey(payload));
      need(
        op && !op.terminal && features.has(PERMISSION_FEATURE),
        "identity_conflict",
      );
      validatePermissionProgress(op, payload);
      op.permissionProgress.push(payload);
      return;
    }
    need(payload.revision === revision + 1, "identity_conflict");
    const key = operationKey(
      isTaskRecord(payload.kind) ? payload : (payload.identity ?? payload),
    );
    const prior = operations.get(key);
    if (isTaskRecord(payload.kind)) {
      need(features.has(TASK_FEATURE), "unsupported_version");
      applyTaskRecord(tasks, prior, payload, sessions, workspaces);
      // A bootstrap reconciliation resolves the operation in the same record;
      // replay derives the identical completion the registry applied.
      if (payload.kind === "task_reconciled" && payload.bootstrap) {
        const completion = bootstrapReconciliationCompletion(
          prior,
          { workspaces, sessions },
          payload,
        );
        need(completion, "identity_conflict");
        revision = payload.revision - 1;
        validate(completion);
      }
    } else if (payload.kind === "feature_gate") {
      need(!features.has(payload.feature), "identity_conflict");
      features.add(payload.feature);
    } else if (payload.kind === "admission") {
      if (isPermissionControl(payload.identity.type)) {
        need(features.has(PERMISSION_FEATURE), "unsupported_version");
        validatePermissionAdmission(payload, sessions);
      }
      need(
        !Object.hasOwn(payload, "forkTarget") ||
          features.has(BEFORE_BRANCH_FEATURE),
        "unsupported_version",
      );
      need(
        !isInboxCancel(payload.identity.type) ||
          features.has(INBOX_CANCEL_FEATURE),
        "unsupported_version",
      );
      need(
        !isGitBranchRestoreApply(payload.identity.type) ||
          features.has(GIT_BRANCH_RESTORE_FEATURE),
        "unsupported_version",
      );
      need(
        !isGitCommitApply(payload.identity.type) ||
          features.has(GIT_COMMIT_FEATURE),
        "unsupported_version",
      );
      need(
        !isGitIndexApply(payload.identity.type) ||
          features.has(GIT_INDEX_FEATURE),
        "unsupported_version",
      );
      need(
        !isFileSave(payload.identity.type) || features.has(FILE_FEATURE),
        "unsupported_version",
      );
      need(
        payload.identity.type !== "configuration.save" ||
          features.has("configuration_save_v1"),
        "unsupported_version",
      );
      need(
        !instructionStep(payload.identity.type) ||
          features.has(INSTRUCTION_FEATURE),
        "unsupported_version",
      );
      need(
        payload.identity.type !== "permission.mode.set" ||
          features.has(PERMISSION_MODE_FEATURE),
        "unsupported_version",
      );
      need(
        !mcpStep(payload.identity.type) || features.has(MCP_FEATURE),
        "unsupported_version",
      );
      need(
        !skillRuntimeStep(payload.identity.type) ||
          features.has(SKILL_RUNTIME_FEATURE),
        "unsupported_version",
      );
      need(
        !isSkillSave(payload.identity.type) || features.has(SKILL_FEATURE),
        "unsupported_version",
      );
      need(
        !(
          isAgentSave(payload.identity.type) ||
          agentRuntimeStep(payload.identity.type)
        ) || features.has(AGENT_FEATURE),
        "unsupported_version",
      );
      if (
        payload.identity.type === "session.fork" &&
        sessions.get(payload.identity.sessionId)?.instructionRegistration !==
          undefined
      )
        need(features.has(INSTRUCTION_FEATURE), "unsupported_version");
      need(!prior, "identity_conflict");
      need(operations.size < STORAGE_LIMITS.operations, "retained_limit");
      operations.set(key, {
        identity: payload.identity,
        ...(isPermissionControl(payload.identity.type) && {
          permissionTarget: payload.permissionTarget,
          permissionProgress: [],
        }),
        ...(Object.hasOwn(payload, "forkTarget") && {
          forkTarget: payload.forkTarget,
        }),
        ...(isGitBranchRestoreApply(payload.identity.type) && {
          gitBranchRestoreTarget: payload.gitBranchRestoreTarget,
          expectedRevision: payload.expectedRevision,
        }),
        ...(isGitCommitApply(payload.identity.type) && {
          gitCommitTarget: payload.gitCommitTarget,
          expectedRevision: payload.expectedRevision,
        }),
        ...(isGitIndexApply(payload.identity.type) && {
          gitIndexTarget: payload.gitIndexTarget,
        }),
        ...(isInboxCancel(payload.identity.type) && {
          inboxTarget: payload.inboxTarget,
        }),
        ...(isFileSave(payload.identity.type) && {
          fileTarget: payload.fileTarget,
        }),
        ...(isAgentSave(payload.identity.type) && {
          agentSourceName: payload.agentSourceName,
        }),
        ...(agentRuntimeStep(payload.identity.type) && {
          agentRuntime: payload.agentRuntime,
        }),
        ...(skillRuntimeStep(payload.identity.type) && {
          skillRuntime: payload.skillRuntime,
        }),
        ...(isSkillSave(payload.identity.type) && {
          skillSourceName: payload.skillSourceName,
        }),
        ...(mcpStep(payload.identity.type) && {
          nativeServerName: payload.nativeServerName,
        }),
        terminal: !!payload.rejectionCode,
        reserved: false,
        steps: new Set(),
        dispatches: [],
      });
    } else if (
      ["reservation", "dispatch", "completion"].includes(payload.kind)
    ) {
      need(prior && !prior.terminal, "identity_conflict");
      if (payload.kind === "reservation") {
        need(
          !isPermissionControl(prior.identity.type) &&
            !isInboxCancel(prior.identity.type) &&
            !isGitBranchRestoreApply(prior.identity.type) &&
            !isGitCommitApply(prior.identity.type) &&
            !isGitIndexApply(prior.identity.type) &&
            !isFileSave(prior.identity.type) &&
            !agentRuntimeStep(prior.identity.type) &&
            !isAgentSave(prior.identity.type) &&
            !skillRuntimeStep(prior.identity.type) &&
            !isSkillSave(prior.identity.type) &&
            !instructionStep(prior.identity.type) &&
            !mcpStep(prior.identity.type) &&
            !prior.reserved,
          "identity_conflict",
        );
        prior.reserved = true;
        prior.reservation = payload;
        if (!workspaces.has(payload.workspace.workspaceId))
          workspaces.set(payload.workspace.workspaceId, payload.workspace);
      }
      if (payload.kind === "dispatch") {
        validatePermissionDispatch(prior, payload);
        validateInstructionDispatch(prior.identity, payload, sessions);
        validateBeforeBranchDispatch(prior, payload);
        validateInboxCancelDispatch(prior, payload);
        validateFileDispatch(prior, payload);
        validateGitIndexDispatch(prior, payload);
        validateGitCommitDispatch(prior, payload);
        validateGitBranchRestoreDispatch(prior, payload);
        validateMcpDispatch(prior, payload);
        validateSkillDispatch(prior, payload);
        validateAgentFileDispatch(prior, payload);
        validateAgentRuntimeDispatch(prior, payload, sessions, operations);
        validateSkillRuntimeDispatch(prior, payload, sessions, operations);
        need(
          [
            "file.save",
            "configuration.save",
            "configuration.skill.save",
            "configuration.agent.save",
          ].includes(prior.identity.type) ===
            payload.step.startsWith("filesystem.configuration."),
          "identity_conflict",
        );
        if (payload.step === "filesystem.configuration.publish")
          need(
            prior.steps.has("filesystem.configuration.stage"),
            "identity_conflict",
          );
        need(
          isPermissionControl(prior.identity.type) ||
            isModePolicyWrite(prior.identity.type, payload) ||
            !prior.steps.has(payload.step),
          "identity_conflict",
        );
        prior.steps.add(payload.step);
        prior.dispatches.push(payload);
      }
      if (payload.kind === "completion") {
        for (const field of [
          "runtimeEpoch",
          "operationId",
          "type",
          "workspaceId",
          "sessionId",
        ])
          need(
            payload.receipt[field] === prior.identity[field],
            "identity_conflict",
          );
        need(
          payload.receipt.effect !== "confirmed" || prior.steps.size > 0,
          "identity_conflict",
        );
        need(
          payload.receipt.effect !== "none" ||
            prior.steps.size === 0 ||
            (payload.receipt.admission === "rejected" &&
              (bootstrapNoEffectProven(prior, tasks.get(key)) ||
                // Typed Native empty_session rejection proves no fork effect.
                (prior.identity.type === "session.fork" &&
                  payload.receipt.evidence.some(
                    (entry) => entry.kind === "native-rejected-empty",
                  )))),
          "identity_conflict",
        );
        need(
          payload.receipt.admission !== "rejected" ||
            payload.receipt.effect === "none",
          "identity_conflict",
        );
        if (
          prior.identity.type === "configuration.save" &&
          payload.receipt.effect === "confirmed"
        )
          need(
            prior.steps.has("filesystem.configuration.stage") &&
              prior.steps.has("filesystem.configuration.publish") &&
              payload.receipt.result?.kind === "configuration_saved" &&
              payload.delta.workspaces.length === 0 &&
              payload.delta.sessions.length === 0 &&
              payload.delta.tombstones.length === 0,
            "identity_conflict",
          );
        validatePermissionCompletion(prior, payload, sessions);
        validateInstructionCompletion(prior, payload, sessions, [...features]);
        validatePermissionModeCompletion(payload, [...features]);
        validateBeforeBranchCompletion(prior, payload, [...features]);
        validateInboxCancelCompletion(prior, payload, [...features]);
        validateFileCompletion(prior, payload, [...features]);
        validateGitIndexCompletion(prior, payload, [...features]);
        validateGitCommitCompletion(prior, payload, [...features]);
        validateGitBranchRestoreCompletion(prior, payload, [...features]);
        validateMcpCompletion(prior, payload, [...features]);
        validateSkillCompletion(prior, payload, [...features]);
        validateAgentFileCompletion(prior, payload, [...features]);
        validateAgentRuntimeCompletion(
          prior,
          payload,
          [...features],
          sessions,
          operations,
        );
        validateSkillRuntimeCompletion(
          prior,
          payload,
          [...features],
          sessions,
          operations,
        );
        need(
          !(
            (isGitBranchRestoreApply(prior.identity.type) ||
              isGitIndexApply(prior.identity.type) ||
              isGitCommitApply(prior.identity.type)) &&
            prior.completedDelta &&
            payload.receipt.effect === "confirmed"
          ),
          "identity_conflict",
        );
        prior.receipt = payload.receipt;
        if (
          isPermissionControl(prior.identity.type) ||
          Object.hasOwn(prior, "forkTarget") ||
          isInboxCancel(prior.identity.type) ||
          isGitBranchRestoreApply(prior.identity.type) ||
          isGitIndexApply(prior.identity.type) ||
          isGitCommitApply(prior.identity.type)
        )
          prior.completedDelta = payload.delta;
        for (const workspace of payload.delta.workspaces)
          workspaces.set(workspace.workspaceId, workspace);
        for (const session of payload.delta.sessions)
          sessions.set(session.appSessionId, session);
        for (const tombstone of payload.delta.tombstones) {
          if (tombstone.kind === "session") sessions.delete(tombstone.id);
          if (tombstone.kind === "workspace") workspaces.delete(tombstone.id);
        }
        prior.terminal =
          payload.receipt.effect === "confirmed" ||
          isMcpAbsentRemoval(payload.receipt) ||
          payload.receipt.admission === "rejected";
      }
    } else if (
      payload.kind === "recovery_decision" &&
      payload.action === RETAIN_TAIL_AS_UNKNOWN
    ) {
      // A tail completion already applied here stays applied: this is
      // structural history only; the registry replays the range conservatively.
      for (const entry of payload.operations) {
        const retained = operations.get(operationKey(entry));
        need(retained, "identity_conflict");
        retained.terminal = true;
      }
    } else if (payload.kind === "migration_phase") {
      const priorMigration = migrations.get(payload.migrationId);
      if (priorMigration)
        need(
          priorMigration.sourceStoreId === payload.sourceStoreId &&
            priorMigration.destinationStoreId === payload.destinationStoreId &&
            priorMigration.phase !== "rollback",
          "identity_conflict",
        );
      const transitions = {
        retained: ["quiesced", "rollback"],
        quiesced: ["copied", "rollback"],
        copied: ["verified", "rollback"],
        verified: ["cutover", "rollback"],
        cutover: ["rollback"],
      };
      need(
        priorMigration
          ? transitions[priorMigration.phase]?.includes(payload.phase)
          : payload.phase === "retained",
        "identity_conflict",
      );
      migrations.set(payload.migrationId, payload);
    }
    revision = payload.revision;
  };
  validate.state = { operations, tasks };
  return validate;
}

// The caller must acquire the exclusive store owner before invoking this API.
// io overrides are per-instance test dependencies, never process-wide fault hooks.
export async function openStorageJournal({
  directory,
  storeId,
  io = {},
  recoveryReason,
  // Awaited before an open finishes a retain decision's checkpoint (Main: the
  // owner fence); a rejection leaves the tail unconfirmed instead.
  checkpointFence = async () => {},
} = {}) {
  need(path(directory) && id(storeId));
  if (recoveryReason !== undefined)
    need(STORE_RECOVERY_REASONS.includes(recoveryReason));
  const adapter = {
    write: (file, bytes) => file.writeFile(bytes),
    syncFile: (file) => file.sync(),
    syncDirectory: async (directory) => {
      if (!directorySyncSupported()) return;
      const handle = await fs.open(directory, constants.O_RDONLY);
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    },
    rename: (from, to) => renameReplacing(from, to),
    unlink: fs.unlink,
    ...io,
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
  let pendingRetainCheckpoint = false;
  try {
    const stat = await fs.lstat(directory);
    need(stat.isDirectory() && !stat.isSymbolicLink(), "storage_denied");
    need((await fs.realpath(directory)) === directory, "storage_denied");
    for (const entry of [filename, current, previous, pending, temp]) {
      try {
        const stat = await fs.lstat(entry);
        need(
          stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1,
          "storage_denied",
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
          "corrupt_journal",
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
          "checksum",
        ]);
        need(record.schemaVersion === 1, "unsupported_version");
        need(
          record.storeId === storeId &&
            record.sequence === records.length + 1 &&
            record.previousHash === lastHash,
          "identity_conflict",
        );
        const { checksum, ...body } = record;
        need(digest(checksum) && hash(body) === checksum, "corrupt_journal");
        validateJournalPayload(record.payload);
        if (record.payload.kind === "recovery_decision")
          need(
            record.payload.throughSequence === records.length &&
              record.payload.throughHash === lastHash,
            "identity_conflict",
          );
        validateHistory(record.payload);
        records.push(record);
        lastHash = checksum;
        offset = end + 1;
      } catch (error) {
        reason = [
          "unsupported_version",
          "identity_conflict",
          "retained_limit",
        ].includes(error.code)
          ? error.code
          : "corrupt_journal";
        break;
      }
    }
    let ceiling = Infinity;
    try {
      const marker = JSON.parse(await fs.readFile(pending, "utf8"));
      closed(marker, ["schemaVersion", "storeId", "baseGeneration"]);
      need(
        marker.schemaVersion === 1 &&
          marker.storeId === storeId &&
          integer(marker.baseGeneration),
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
          "checksum",
        ]);
        need(
          candidate.schemaVersion === 1 || candidate.schemaVersion === 2,
          "unsupported_version",
        );
        const requiresTasks = records
          .slice(0, candidate.sequence)
          .some(
            (record) =>
              record.payload.kind === "feature_gate" &&
              [TASK_FEATURE, PERMISSION_RECONCILIATION_FEATURE].includes(
                record.payload.feature,
              ),
          );
        need(
          candidate.schemaVersion === (requiresTasks ? 2 : 1),
          "unsupported_version",
        );
        const { checksum, ...body } = candidate;
        need(
          candidate.storeId === storeId &&
            integer(candidate.generation) &&
            candidate.generation > 0 &&
            integer(candidate.sequence) &&
            candidate.sequence <= records.length &&
            candidate.hash ===
              (candidate.sequence
                ? records[candidate.sequence - 1].checksum
                : zeroHash) &&
            checksum === hash(body),
          "corrupt_journal",
        );
        if (candidate.generation <= ceiling) checkpoints.push(candidate);
      } catch (error) {
        if (error.code !== "ENOENT")
          reason ??=
            error.code === "unsupported_version"
              ? "unsupported_version"
              : "corrupt_journal";
      }
    }
    checkpoints.sort((a, b) => b.generation - a.generation);
    checkpointValue = checkpoints[0];
    checkpointGeneration = checkpointValue?.generation ?? 0;
    committed = records.slice(0, checkpointValue?.sequence ?? 0);
    // A crash between writing a retain decision and its checkpoint leaves the
    // decision as the last record of the tail. It was written by a verified
    // owner over exactly that tail; re-check it and finish it (no re-prompt).
    const last = records.at(-1)?.payload;
    if (
      !reason &&
      !uncertainCheckpoint &&
      last?.kind === "recovery_decision" &&
      last.action === RETAIN_TAIL_AS_UNKNOWN &&
      last.fromSequence === committed.length &&
      last.throughSequence === records.length - 1 &&
      retainableTail(records.slice(0, -1), last.fromSequence, last.operations)
    )
      try {
        await checkpointFence();
        pendingRetainCheckpoint = true;
      } catch {
        /* unfenced: the tail stays unconfirmed */
      }
    if (
      !pendingRetainCheckpoint &&
      (records.length > committed.length || uncertainCheckpoint)
    )
      reason ??= "unconfirmed_tail";
    if (!reason) {
      handle = await fs.open(
        filename,
        constants.O_CREAT |
          constants.O_APPEND |
          constants.O_WRONLY |
          constants.O_NOFOLLOW,
        0o600,
      );
      await adapter.syncFile(handle, "open");
      await adapter.syncDirectory(directory, "open");
    }
  } catch (error) {
    reason = error.code === "storage_denied" ? error.code : "storage_denied";
    if (handle) {
      await handle.close();
      handle = undefined;
    }
  }
  const status = () => ({
    state: reason ? "recovery_required" : "ready",
    ...(reason && { reason }),
    sequence: records.length,
    hash: lastHash,
    checkpointGeneration,
    checkpointSequence: checkpointValue?.sequence ?? 0,
    directoryFlush:
      "required; platform failures block writes; power-loss durability unverified",
    closed: closedWriter,
  });
  const assertWritable = () => {
    if (closedWriter) throw storageError("closed");
    if (reason) throw storageError(reason);
  };
  const serialized = (fn) => {
    const task = queue.then(fn);
    queue = task.catch(() => {});
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
        validated.throughSequence === records.length &&
          validated.throughHash === lastHash,
        "identity_conflict",
      );
    const validateHistory = historyValidator();
    for (const record of records) validateHistory(record.payload);
    validateHistory(validated);
    const body = {
      schemaVersion: 1,
      storeId,
      sequence: records.length + 1,
      previousHash: lastHash,
      payload: validated,
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
  async function writeFlushed(filename, value, context, exclusive = false) {
    const file = await fs.open(
      filename,
      constants.O_WRONLY |
        constants.O_CREAT |
        (exclusive ? constants.O_EXCL : constants.O_TRUNC) |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await adapter.write(
        file,
        Buffer.from(JSON.stringify(value) + "\n"),
        context,
      );
      await adapter.syncFile(file, context);
    } finally {
      await file.close();
    }
  }
  async function checkpointInternal() {
    assertWritable();
    const body = {
      schemaVersion: records.some(
        (record) =>
          record.payload.kind === "feature_gate" &&
          [TASK_FEATURE, PERMISSION_RECONCILIATION_FEATURE].includes(
            record.payload.feature,
          ),
      )
        ? 2
        : 1,
      storeId,
      generation: checkpointGeneration + 1,
      sequence: records.length,
      hash: lastHash,
    };
    const candidate = { ...body, checksum: hash(body) };
    try {
      // Persist the last established generation before any checkpoint replacement.
      // A failed checkpoint can never authorize its new generation on reopen.
      await writeFlushed(
        pending,
        { schemaVersion: 1, storeId, baseGeneration: checkpointGeneration },
        "checkpoint:pending",
        !uncertainCheckpoint,
      );
      await adapter.syncDirectory(directory, "checkpoint:pending");
      if (checkpointValue)
        await writeFlushed(previous, checkpointValue, "checkpoint:previous");
      await writeFlushed(temp, candidate, "checkpoint:file");
      await adapter.rename(temp, current);
      await adapter.syncDirectory(directory, "checkpoint:publish");
      // Last fallible step. Removal is intentionally not a power-loss durability claim:
      // a resurrected marker after power loss causes conservative recovery.
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
  if (pendingRetainCheckpoint && !reason)
    try {
      await checkpointInternal();
    } catch {
      /* checkpointInternal poisoned the writer: recovery_required */
    }
  return {
    status,
    readRecords: () =>
      clone({
        committed,
        uncertain: records.slice(committed.length),
        validated: records,
      }),
    append: (payload) => {
      const copy = validateJournalPayload(payload);
      return serialized(() => appendInternal(copy));
    },
    checkpoint: () => serialized(checkpointInternal),
    // Whether a retain decision over the current tail (from the confirmed
    // prefix) for exactly these operations would be accepted.
    retainable: (operations) =>
      clone({
        ok:
          !closedWriter &&
          !uncertainCheckpoint &&
          (reason === undefined || reason === "unconfirmed_tail") &&
          retainableTail(records, committed.length, operations),
        uncertainCheckpoint,
      }),
    // Owner-verified crash recovery for non-authority operations only: the
    // covered range is replayed conservatively by the registry and the listed
    // operations become terminal with an UNKNOWN outcome.
    retainTailAsUnknown: (decision) =>
      serialized(async () => {
        closed(decision, [
          "expectedSequence",
          "expectedHash",
          "ownerVerified",
          "operations",
        ]);
        need(
          !closedWriter &&
            decision.ownerVerified === true &&
            decision.expectedSequence === records.length &&
            decision.expectedHash === lastHash &&
            Array.isArray(decision.operations),
          "recovery_denied",
        );
        need(
          !uncertainCheckpoint &&
            (reason === undefined || reason === "unconfirmed_tail"),
          "recovery_denied",
        );
        const operations = decision.operations.map((operation) => {
          closed(operation, ["runtimeEpoch", "operationId"]);
          return {
            runtimeEpoch: operation.runtimeEpoch,
            operationId: operation.operationId,
          };
        });
        need(
          retainableTail(records, committed.length, operations),
          "recovery_denied",
        );
        const fromSequence = committed.length;
        const tail = reason === "unconfirmed_tail";
        reason = undefined;
        try {
          if (tail)
            handle = await fs.open(
              filename,
              constants.O_APPEND | constants.O_WRONLY | constants.O_NOFOLLOW,
            );
          const record = await appendInternal({
            kind: "recovery_decision",
            revision:
              (records.findLast((entry) => entry.payload.revision !== undefined)
                ?.payload.revision ?? 0) + 1,
            action: RETAIN_TAIL_AS_UNKNOWN,
            fromSequence,
            throughSequence: decision.expectedSequence,
            throughHash: decision.expectedHash,
            operations,
          });
          await checkpointInternal();
          return clone(record);
        } catch {
          poison();
          throw storageError(reason);
        }
      }),
    // Only a trusted local host recovery decision may adopt a complete validated tail.
    recover: (decision) =>
      serialized(async () => {
        closed(decision, [
          "action",
          "expectedSequence",
          "expectedHash",
          "ownerVerified",
          "preflightVerified",
        ]);
        need(
          decision.action === "adopt_validated_tail" &&
            decision.ownerVerified === true &&
            decision.preflightVerified === true &&
            decision.expectedSequence === records.length &&
            decision.expectedHash === lastHash,
          "recovery_denied",
        );
        need(
          reason === "unconfirmed_tail" && !uncertainCheckpoint,
          "recovery_denied",
        );
        // A generic tail decision is not a TaskRecoveryTicket. Unconfirmed
        // task history/proof cannot become eligibility for authority release.
        need(
          !records
            .slice(committed.length)
            .some(
              ({ payload }) =>
                isTaskRecord(payload.kind) ||
                payload.kind === "permission_reconciled",
            ),
          "recovery_denied",
        );
        const beforeBranchKeys = new Set(
          records
            .filter(
              ({ payload }) =>
                payload.kind === "admission" &&
                Object.hasOwn(payload, "forkTarget"),
            )
            .map(({ payload }) => operationKey(payload.identity)),
        );
        // An uncheckpointed Git or exact-boundary fork success is unknown on reopen.
        // Tail adoption cannot turn that retained outcome into publication proof.
        need(
          !records
            .slice(committed.length)
            .some(
              ({ payload }) =>
                payload.kind === "completion" &&
                (isPermissionControl(payload.receipt.type) ||
                  beforeBranchKeys.has(operationKey(payload)) ||
                  isGitBranchRestoreApply(payload.receipt.type) ||
                  isGitCommitApply(payload.receipt.type)) &&
                payload.receipt.effect === "confirmed",
            ),
          "recovery_denied",
        );
        reason = undefined;
        try {
          handle = await fs.open(
            filename,
            constants.O_APPEND | constants.O_WRONLY | constants.O_NOFOLLOW,
          );
          await appendInternal({
            kind: "recovery_decision",
            revision:
              (records.findLast(
                (record) => record.payload.revision !== undefined,
              )?.payload.revision ?? 0) + 1,
            action: decision.action,
            throughSequence: decision.expectedSequence,
            throughHash: decision.expectedHash,
          });
          await checkpointInternal();
          return status();
        } catch {
          poison();
          throw storageError(reason);
        }
      }),
    close: () =>
      serialized(async () => {
        if (closedWriter) return;
        closedWriter = true;
        if (handle) {
          await handle.close();
          handle = undefined;
        }
      }),
  };
}
