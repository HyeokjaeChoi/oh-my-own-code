import {
  GIT_BRANCH_RESTORE_FEATURE,
  isGitBranchRestoreApply,
  validateGitBranchRestoreAdmission,
  validateGitBranchRestoreDispatchPayload,
  validateGitBranchRestoreDispatch,
  validateGitBranchRestoreCompletion,
} from "./workbench-git-branch-restore-storage.mjs";
import {
  GIT_INDEX_FEATURE,
  isGitIndexApply,
  validateGitIndexAdmission,
  validateGitIndexDispatchPayload,
  validateGitIndexDispatch,
  validateGitIndexCompletion,
} from "./workbench-git-index-storage.mjs";
import {
  GIT_COMMIT_FEATURE,
  isGitCommitApply,
  validateGitCommitAdmission,
  validateGitCommitDispatchPayload,
  validateGitCommitDispatch,
  validateGitCommitCompletion,
} from "./workbench-git-commit-storage.mjs";
import {
  FILE_FEATURE,
  isFileSave,
  validateFileAdmission,
  validateFileDispatch,
  validateFileDispatchPayload,
  validateFileCompletion,
} from "./workbench-file-storage.mjs";
import {
  AGENT_FEATURE,
  isAgentSave,
  validateAgentRuntimeAdmission,
  validateAgentRuntimeDispatch,
  validateAgentRuntimeCompletion,
} from "./workbench-agent-storage.mjs";
import { agentRuntimeStep } from "../renderer/shared/configuration-draft/agent-runtime.mjs";
import {
  SKILL_RUNTIME_FEATURE,
  skillRuntimeStep,
  validateSkillRuntimeAdmission,
  validateSkillRuntimeDispatch,
  validateSkillRuntimeCompletion,
} from "./workbench-skill-runtime-storage.mjs";
import { SKILL_FEATURE, isSkillSave } from "./workbench-skill-storage.mjs";
import { MCP_FEATURE, mcpStep } from "./workbench-mcp.mjs";
import { INSTRUCTION_FEATURE } from "./workbench-instructions.mjs";
import { configurationBackupId } from "./configuration-file-observation.mjs";
import * as fs from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import { isAbsolute, join, resolve, parse, relative, sep } from "node:path";
import { redactReceipt } from "./workbench-receipts.mjs";
import { validWireId, ERRORS } from "../workbench-contract.mjs";
import {
  openStorageJournal,
  storageError,
  STORAGE_LIMITS,
  STORE_RECOVERY_REASONS,
  validateStorageIdentity,
  validateSkillAdmission,
  validateAgentFileAdmission,
  validateAgentFileDispatch,
  validateAgentFileCompletion,
  validateSkillDispatch,
  validateSkillCompletion,
  validateStorageReceipt,
  validateRegistryDelta,
  instructionStep,
  validateInstructionDispatch,
  validateInstructionCompletion,
  validateMcpAdmission,
  validateMcpDispatch,
  validateMcpCompletion,
  isMcpAbsentRemoval,
} from "./storage-journal.mjs";

const copy = (value) => JSON.parse(JSON.stringify(value));
const key = (value) => JSON.stringify([value.runtimeEpoch, value.operationId]);
function need(condition, code = "invalid_record") {
  if (!condition) throw storageError(code);
}
function closed(value, required, optional = []) {
  need(
    value &&
      Object.getPrototypeOf(value) === Object.prototype &&
      required.every((field) => Object.hasOwn(value, field)) &&
      Reflect.ownKeys(value).every(
        (field) =>
          typeof field === "string" &&
          [...required, ...optional].includes(field) &&
          Object.hasOwn(Object.getOwnPropertyDescriptor(value, field), "value"),
      ),
  );
}
function operationKey(value) {
  closed(value, ["runtimeEpoch", "operationId"]);
  need(validWireId(value.runtimeEpoch) && validWireId(value.operationId));
  return key(value);
}
function emptyRoot() {
  return {
    revision: 0,
    features: [],
    operations: new Map(),
    workspaces: new Map(),
    sessions: new Map(),
    tombstones: new Map(),
    ownerIntent: undefined,
    migrations: new Map(),
  };
}
function cloneRoot(root) {
  return {
    revision: root.revision,
    features: [...root.features],
    ...Object.fromEntries(
      ["operations", "workspaces", "sessions", "tombstones", "migrations"].map(
        (table) => [
          table,
          new Map([...root[table]].map(([id, value]) => [id, copy(value)])),
        ],
      ),
    ),
    ownerIntent: root.ownerIntent && copy(root.ownerIntent),
  };
}
const retained = (operation) => !operation.terminal;
function sessionSlots(root, appSessionId) {
  const slots = new Set(root.sessions.keys());
  slots.add(appSessionId);
  for (const operation of root.operations.values())
    if (retained(operation) && operation.reservation)
      slots.add(operation.reservation.appSessionId);
  return slots.size;
}
function initialReceipt(identity, revision, rejectionCode) {
  const { digest: _digest, ...scope } = identity;
  return {
    ...scope,
    revision,
    evidence: [],
    admission: rejectionCode ? "rejected" : "admitted",
    delivery: "pending",
    effect: "none",
    ...(rejectionCode && { result: { kind: "rejected", code: rejectionCode } }),
  };
}
function sameWorkspace(a, b) {
  return ["workspaceId", "ownership", "canonicalPath", "folderSessionId"].every(
    (field) => a[field] === b[field],
  );
}
function canUseManagedFirstSession(root, workspace) {
  if (
    workspace.ownership !== "managed" ||
    workspace.registrationState !== "registered" ||
    root.sessions.has(workspace.folderSessionId) ||
    root.tombstones.has(`session:${workspace.folderSessionId}`) ||
    [...root.sessions.values()].some(
      (session) => session.workspaceId === workspace.workspaceId,
    )
  )
    return false;
  const reservations = [...root.operations.values()].filter(
    (entry) =>
      entry.reservation &&
      (entry.reservation.appSessionId === workspace.folderSessionId ||
        entry.reservation.workspace.workspaceId === workspace.workspaceId),
  );
  const creators = reservations.filter(
    (entry) => entry.identity.type === "workspace.create",
  );
  if (creators.length !== 1) return false;
  const creator = creators[0];
  return (
    creator.terminal &&
    creator.receipt.effect === "confirmed" &&
    creator.identity.type === "workspace.create" &&
    !creator.identity.workspaceId &&
    !creator.identity.sessionId &&
    creator.reservation.appSessionId === workspace.folderSessionId &&
    sameWorkspace(creator.reservation.workspace, workspace) &&
    creator.completedDelta?.sessions.length === 0 &&
    creator.completedDelta.workspaces.some(
      (entry) =>
        entry.registrationState === "registered" &&
        sameWorkspace(entry, workspace),
    ) &&
    // Re-import only confirms the existing registration. It must not consume
    // the first managed session identity or create a Native session.
    reservations.every(
      (entry) =>
        entry === creator ||
        (entry.terminal &&
          entry.identity.type === "workspace.import" &&
          sameWorkspace(entry.reservation.workspace, workspace) &&
          entry.receipt.effect === "confirmed" &&
          entry.receipt.result?.kind === "created" &&
          entry.receipt.result.workspaceId === workspace.workspaceId &&
          !entry.receipt.result.sessionId &&
          !entry.receipt.result.nativeSessionId &&
          entry.dispatches.length === 1 &&
          entry.dispatches[0].step === "registry.metadata" &&
          entry.completedDelta?.workspaces.length === 0 &&
          entry.completedDelta.sessions.length === 0 &&
          entry.completedDelta.tombstones.length === 0) ||
        (entry.terminal &&
          entry.identity.type === "session.create" &&
          entry.identity.workspaceId === workspace.workspaceId &&
          !entry.identity.sessionId &&
          entry.reservation.appSessionId === workspace.folderSessionId &&
          sameWorkspace(entry.reservation.workspace, workspace) &&
          entry.receipt.admission === "rejected" &&
          entry.receipt.effect === "none" &&
          entry.dispatches.length === 0 &&
          entry.completedDelta?.workspaces.length === 0 &&
          entry.completedDelta.sessions.length === 0 &&
          entry.completedDelta.tombstones.length === 0),
    )
  );
}
function apply(root, payload, conservative = false, validatedFirstSessions) {
  const next = cloneRoot(root);
  const opKey = key(payload.identity ?? payload);
  const operation = next.operations.get(opKey);
  if (payload.kind === "feature_gate") {
    if (conservative) return root;
    need(
      [
        FILE_FEATURE,
        GIT_BRANCH_RESTORE_FEATURE,
        GIT_COMMIT_FEATURE,
        GIT_INDEX_FEATURE,
        "configuration_save_v1",
        INSTRUCTION_FEATURE,
        MCP_FEATURE,
        SKILL_FEATURE,
        SKILL_RUNTIME_FEATURE,
        AGENT_FEATURE,
      ].includes(payload.feature) && !next.features.includes(payload.feature),
      "identity_conflict",
    );
    next.features.push(payload.feature);
  } else if (payload.kind === "admission") {
    need(
      !isGitBranchRestoreApply(payload.identity.type) ||
        next.features.includes(GIT_BRANCH_RESTORE_FEATURE) ||
        conservative,
      "unsupported_version",
    );
    need(
      !isGitCommitApply(payload.identity.type) ||
        next.features.includes(GIT_COMMIT_FEATURE) ||
        conservative,
      "unsupported_version",
    );
    need(
      !isGitIndexApply(payload.identity.type) ||
        next.features.includes(GIT_INDEX_FEATURE) ||
        conservative,
      "unsupported_version",
    );
    validateGitIndexAdmission(payload);
    validateGitCommitAdmission(
      isGitBranchRestoreApply(payload.identity.type)
        ? (({ expectedRevision: _revision, ...rest }) => rest)(payload)
        : payload,
    );
    validateGitBranchRestoreAdmission(payload);
    need(
      !isFileSave(payload.identity.type) ||
        next.features.includes(FILE_FEATURE) ||
        conservative,
      "unsupported_version",
    );
    validateFileAdmission(payload);
    need(
      next.features.includes("configuration_save_v1") ||
        payload.identity.type !== "configuration.save" ||
        conservative,
      "unsupported_version",
    );
    need(
      !instructionStep(payload.identity.type) ||
        next.features.includes(INSTRUCTION_FEATURE) ||
        conservative,
      "unsupported_version",
    );
    need(
      !mcpStep(payload.identity.type) ||
        next.features.includes(MCP_FEATURE) ||
        conservative,
      "unsupported_version",
    );
    validateStorageIdentity(payload.identity);
    validateSkillAdmission(payload);
    validateAgentFileAdmission(payload);
    validateAgentRuntimeAdmission(payload);
    need(
      !(
        isAgentSave(payload.identity.type) ||
        agentRuntimeStep(payload.identity.type)
      ) ||
        next.features.includes(AGENT_FEATURE) ||
        conservative,
      "unsupported_version",
    );
    validateSkillRuntimeAdmission(payload);
    need(
      !skillRuntimeStep(payload.identity.type) ||
        next.features.includes(SKILL_RUNTIME_FEATURE) ||
        conservative,
      "unsupported_version",
    );
    need(
      !isSkillSave(payload.identity.type) ||
        next.features.includes(SKILL_FEATURE) ||
        conservative,
      "unsupported_version",
    );
    if (
      payload.identity.type === "session.fork" &&
      next.sessions.get(payload.identity.sessionId)?.instructionRegistration !==
        undefined
    )
      need(
        next.features.includes(INSTRUCTION_FEATURE) || conservative,
        "unsupported_version",
      );
    need(!operation, "identity_conflict");
    need(next.operations.size < STORAGE_LIMITS.operations, "retained_limit");
    const receipt = initialReceipt(
      payload.identity,
      conservative ? root.revision : payload.revision,
      conservative ? undefined : payload.rejectionCode,
    );
    if (conservative) {
      receipt.effect = "unknown";
      receipt.delivery = "unknown";
    }
    next.operations.set(opKey, {
      identity: payload.identity,
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
      receipt,
      dispatches: [],
      terminal: !conservative && !!payload.rejectionCode,
    });
  } else if (payload.kind === "reservation") {
    need(
      operation &&
        !operation.terminal &&
        !operation.reservation &&
        !isGitBranchRestoreApply(operation.identity.type) &&
        !isGitCommitApply(operation.identity.type) &&
        !isGitIndexApply(operation.identity.type) &&
        !isFileSave(operation.identity.type) &&
        !agentRuntimeStep(operation.identity.type) &&
        !isAgentSave(operation.identity.type) &&
        !skillRuntimeStep(operation.identity.type) &&
        !isSkillSave(operation.identity.type) &&
        !instructionStep(operation.identity.type) &&
        !mcpStep(operation.identity.type),
      "identity_conflict",
    );
    const workspace = next.workspaces.get(payload.workspace.workspaceId);
    need(
      !next.tombstones.has(`workspace:${payload.workspace.workspaceId}`) &&
        !next.tombstones.has(`session:${payload.appSessionId}`) &&
        !next.sessions.has(payload.appSessionId),
      "identity_conflict",
    );
    need(
      !workspace || sameWorkspace(workspace, payload.workspace),
      "identity_conflict",
    );
    need(
      ![...next.operations.values()].some(
        (entry) => entry.reservation?.appSessionId === payload.appSessionId,
      ) ||
        (operation.identity.type === "session.create" &&
          operation.identity.workspaceId === workspace?.workspaceId &&
          !operation.identity.sessionId &&
          payload.appSessionId === workspace?.folderSessionId &&
          (canUseManagedFirstSession(next, workspace) ||
            (conservative && validatedFirstSessions?.has(opKey)))),
      "identity_conflict",
    );
    need(
      sessionSlots(next, payload.appSessionId) <= STORAGE_LIMITS.sessions,
      "retained_limit",
    );
    if (!workspace) {
      need(
        ![...next.workspaces.values()].some(
          (entry) => entry.canonicalPath === payload.workspace.canonicalPath,
        ),
        "identity_conflict",
      );
      need(next.workspaces.size < STORAGE_LIMITS.workspaces, "retained_limit");
      next.workspaces.set(payload.workspace.workspaceId, {
        ...payload.workspace,
        revision: payload.revision,
      });
    }
    operation.reservation = payload;
    operation.receipt.revision = conservative
      ? root.revision
      : payload.revision;
  } else if (payload.kind === "dispatch") {
    need(
      operation &&
        !operation.terminal &&
        !operation.dispatches.some((step) => step.step === payload.step),
      "identity_conflict",
    );
    need(
      [
        "file.save",
        "configuration.save",
        "configuration.skill.save",
        "configuration.agent.save",
      ].includes(operation.identity.type) ===
        payload.step.startsWith("filesystem.configuration."),
      "identity_conflict",
    );
    if (payload.step === "filesystem.configuration.publish")
      need(
        operation.dispatches.some(
          (entry) => entry.step === "filesystem.configuration.stage",
        ),
        "identity_conflict",
      );
    if (!conservative)
      validateInstructionDispatch(operation.identity, payload, next.sessions);
    validateFileDispatch(operation, payload);
    validateGitIndexDispatch(operation, payload);
    validateGitCommitDispatch(operation, payload);
    validateGitBranchRestoreDispatch(operation, payload);
    validateMcpDispatch(operation, payload);
    validateSkillDispatch(operation, payload);
    validateAgentFileDispatch(operation, payload);
    if (!conservative)
      validateAgentRuntimeDispatch(
        operation,
        payload,
        next.sessions,
        next.operations,
      );
    if (!conservative)
      validateSkillRuntimeDispatch(
        operation,
        payload,
        next.sessions,
        next.operations,
      );
    operation.dispatches.push(payload);
    operation.receipt.admission = "dispatched";
    operation.receipt.effect = "unknown";
    operation.receipt.delivery = "unknown";
    operation.receipt.revision = conservative
      ? root.revision
      : payload.revision;
  } else if (payload.kind === "completion") {
    need(operation && !operation.terminal, "identity_conflict");
    for (const field of [
      "runtimeEpoch",
      "operationId",
      "type",
      "workspaceId",
      "sessionId",
    ])
      need(
        payload.receipt[field] === operation.identity[field],
        "identity_conflict",
      );
    if (conservative) return root; // Never mint success, mappings or tombstones from a surviving unconfirmed tail.
    validateInstructionCompletion(
      operation,
      payload,
      next.sessions,
      next.features,
    );
    validateFileCompletion(operation, payload, next.features);
    validateGitIndexCompletion(operation, payload, next.features);
    validateGitCommitCompletion(operation, payload, next.features);
    validateGitBranchRestoreCompletion(operation, payload, next.features);
    validateMcpCompletion(operation, payload, next.features);
    validateSkillCompletion(operation, payload, next.features);
    validateAgentFileCompletion(operation, payload, next.features);
    validateAgentRuntimeCompletion(
      operation,
      payload,
      next.features,
      next.sessions,
      next.operations,
    );
    validateSkillRuntimeCompletion(
      operation,
      payload,
      next.features,
      next.sessions,
      next.operations,
    );
    const delta = payload.delta;
    const receipt = payload.receipt;
    const allowedWorkspaces = new Set(
      [
        operation.identity.workspaceId,
        operation.reservation?.workspace.workspaceId,
      ].filter(Boolean),
    );
    for (const workspace of delta.workspaces)
      need(allowedWorkspaces.has(workspace.workspaceId), "identity_conflict");
    for (const session of delta.sessions) {
      need(allowedWorkspaces.has(session.workspaceId), "identity_conflict");
      // A reserved child remains the same target after a partial mapping has
      // been committed. Fork's admitted sessionId still identifies its parent.
      if (session.appSessionId === operation.reservation?.appSessionId)
        need(
          [
            "workspace.create",
            "workspace.import",
            "session.create",
            "session.fork",
          ].includes(operation.identity.type) &&
            (operation.identity.type !== "session.fork" ||
              (operation.identity.sessionId &&
                session.parentSessionId === operation.identity.sessionId)),
          "identity_conflict",
        );
      else
        need(
          next.sessions.has(session.appSessionId) &&
            (operation.identity.type === "workspace.remove" ||
              session.appSessionId === operation.identity.sessionId),
          "identity_conflict",
        );
    }
    for (const tombstone of delta.tombstones) {
      if (tombstone.kind === "workspace")
        need(
          operation.identity.type === "workspace.remove" &&
            allowedWorkspaces.has(tombstone.id),
          "identity_conflict",
        );
      else
        need(
          ["session.remove", "workspace.remove"].includes(
            operation.identity.type,
          ) &&
            allowedWorkspaces.has(
              next.sessions.get(tombstone.id)?.workspaceId,
            ) &&
            (operation.identity.type === "workspace.remove" ||
              tombstone.id === operation.identity.sessionId),
          "identity_conflict",
        );
    }
    const terminal =
      receipt.effect === "confirmed" ||
      isMcpAbsentRemoval(receipt) ||
      receipt.admission === "rejected";
    need(
      receipt.effect !== "confirmed" || operation.dispatches.length > 0,
      "identity_conflict",
    );
    need(
      receipt.effect !== "none" || operation.dispatches.length === 0,
      "identity_conflict",
    );
    need(
      receipt.admission !== "rejected" || receipt.effect === "none",
      "identity_conflict",
    );
    if (
      delta.workspaces.length ||
      delta.sessions.length ||
      delta.tombstones.length
    )
      need(
        receipt.effect === "confirmed" || receipt.effect === "unknown",
        "identity_conflict",
      );
    if (operation.identity.type === "configuration.save") {
      need(
        delta.workspaces.length === 0 &&
          delta.sessions.length === 0 &&
          delta.tombstones.length === 0,
        "identity_conflict",
      );
      if (receipt.effect === "confirmed") {
        need(
          receipt.result?.kind === "configuration_saved" &&
            receipt.result.workspaceId === operation.identity.workspaceId &&
            operation.dispatches.some(
              (entry) => entry.step === "filesystem.configuration.stage",
            ) &&
            operation.dispatches.some(
              (entry) => entry.step === "filesystem.configuration.publish",
            ),
          "identity_conflict",
        );
        if (receipt.result.backupId !== undefined)
          need(
            receipt.result.backupId ===
              configurationBackupId(
                operation.identity.runtimeEpoch,
                operation.identity.operationId,
                receipt.result.configurationKind,
              ),
            "identity_conflict",
          );
      }
    }
    const sessionDeletes = new Set(
      delta.tombstones
        .filter((entry) => entry.kind === "session")
        .map((entry) => entry.id),
    );
    const workspaceDeletes = new Set(
      delta.tombstones
        .filter((entry) => entry.kind === "workspace")
        .map((entry) => entry.id),
    );
    need(
      delta.tombstones.length === 0 || receipt.effect === "confirmed",
      "identity_conflict",
    );
    for (const workspace of delta.workspaces) {
      const existing = next.workspaces.get(workspace.workspaceId);
      need(
        existing &&
          sameWorkspace(existing, workspace) &&
          !workspaceDeletes.has(workspace.workspaceId),
        "identity_conflict",
      );
      need(
        workspace.registrationState !== "registered" ||
          receipt.effect === "confirmed",
        "identity_conflict",
      );
      next.workspaces.set(workspace.workspaceId, {
        ...workspace,
        revision: payload.revision,
      });
    }
    for (const session of delta.sessions) {
      const workspace = next.workspaces.get(session.workspaceId);
      const existing = next.sessions.get(session.appSessionId);
      need(
        workspace &&
          !workspaceDeletes.has(session.workspaceId) &&
          !sessionDeletes.has(session.appSessionId) &&
          !next.tombstones.has(`session:${session.appSessionId}`),
        "identity_conflict",
      );
      if (existing)
        need(
          existing.workspaceId === session.workspaceId &&
            existing.nativeSessionId === session.nativeSessionId &&
            existing.parentSessionId === session.parentSessionId,
          "identity_conflict",
        );
      else
        need(
          operation.reservation?.appSessionId === session.appSessionId &&
            operation.reservation.workspace.workspaceId === session.workspaceId,
          "identity_conflict",
        );
      if (session.parentSessionId)
        need(
          next.sessions.get(session.parentSessionId)?.workspaceId ===
            session.workspaceId,
          "identity_conflict",
        );
      if (!existing && session.nativeSessionId) {
        need(
          receipt.evidence.some(
            (entry) =>
              entry.kind === "native_session_verified" &&
              entry.id === session.nativeSessionId,
          ),
          "identity_conflict",
        );
        if (operation.reservation?.plannedNativeSessionId)
          need(
            operation.reservation.plannedNativeSessionId ===
              session.nativeSessionId,
            "identity_conflict",
          );
        need(
          ![...next.sessions.values()].some(
            (entry) => entry.nativeSessionId === session.nativeSessionId,
          ),
          "identity_conflict",
        );
      }
      if (receipt.effect === "unknown")
        need(
          session.lifecycleState === "unavailable" &&
            session.recoveryReason === "partial_native_mapping",
          "identity_conflict",
        );
      if (session.lifecycleState === "active")
        need(
          receipt.effect === "confirmed" &&
            session.nativeSessionId &&
            workspace.registrationState === "registered",
          "identity_conflict",
        );
      next.sessions.set(session.appSessionId, {
        ...session,
        revision: payload.revision,
      });
    }
    for (const tombstone of delta.tombstones) {
      need(
        !next.tombstones.has(`${tombstone.kind}:${tombstone.id}`),
        "identity_conflict",
      );
      if (tombstone.kind === "session") {
        need(next.sessions.has(tombstone.id), "identity_conflict");
        need(
          ![...next.sessions.values()].some(
            (session) =>
              session.parentSessionId === tombstone.id &&
              !sessionDeletes.has(session.appSessionId),
          ),
          "identity_conflict",
        );
        next.sessions.delete(tombstone.id);
      } else {
        need(next.workspaces.has(tombstone.id), "identity_conflict");
        need(
          ![...next.sessions.values()].some(
            (session) =>
              session.workspaceId === tombstone.id &&
              !sessionDeletes.has(session.appSessionId),
          ),
          "identity_conflict",
        );
        next.workspaces.delete(tombstone.id);
      }
      next.tombstones.set(`${tombstone.kind}:${tombstone.id}`, {
        ...tombstone,
        runtimeEpoch: payload.runtimeEpoch,
        operationId: payload.operationId,
        revision: payload.revision,
      });
    }
    need(
      next.sessions.size <= STORAGE_LIMITS.sessions &&
        next.tombstones.size <= STORAGE_LIMITS.operations * 300,
      "retained_limit",
    );
    operation.receipt = receipt;
    operation.terminal = terminal;
    operation.completedDelta = delta;
  } else if (payload.kind === "owner_intent") next.ownerIntent = payload;
  else if (payload.kind === "migration_phase")
    next.migrations.set(payload.migrationId, payload);
  next.revision = conservative ? root.revision : payload.revision;
  return next;
}
function recoveryResources(root) {
  const resources = new Map();
  const put = (workspaceId, sessionId, reason) => {
    if (
      !root.workspaces.has(workspaceId) ||
      (sessionId && !root.sessions.has(sessionId))
    )
      return;
    const identity = JSON.stringify([workspaceId, sessionId]);
    if (!resources.has(identity))
      resources.set(identity, {
        workspaceId,
        ...(sessionId && { sessionId }),
        state: "unavailable",
        reason,
      });
  };
  for (const session of root.sessions.values())
    if (session.lifecycleState === "unavailable")
      put(
        session.workspaceId,
        session.appSessionId,
        session.recoveryReason ?? "native_mapping_unverified",
      );
  for (const workspace of root.workspaces.values())
    if (workspace.registrationState !== "registered")
      put(
        workspace.workspaceId,
        undefined,
        workspace.registrationState === "reserved"
          ? "unresolved_operation"
          : "path_missing",
      );
  for (const operation of root.operations.values())
    if (retained(operation)) {
      const workspaceId =
        operation.identity.workspaceId ??
        operation.reservation?.workspace.workspaceId;
      put(workspaceId, operation.identity.sessionId, "unresolved_operation");
    }
  return [...resources.values()];
}
function pathReason(error) {
  return error.code === "ENOENT"
    ? "path_missing"
    : ["EACCES", "EPERM"].includes(error.code)
      ? "path_denied"
      : "path_conflict";
}
async function canonicalDirectory(path, io, rejectSymlinks = false) {
  need(
    typeof path === "string" && isAbsolute(path) && !path.includes("\0"),
    "path_conflict",
  );
  path = resolve(path);
  if (rejectSymlinks) {
    const root = parse(path).root;
    let walked = root;
    for (const component of relative(root, path).split(sep).filter(Boolean)) {
      walked = join(walked, component);
      const stat = await io.lstat(walked);
      need(stat.isDirectory() && !stat.isSymbolicLink(), "path_conflict");
    }
  }
  const canonical = await io.realpath(path);
  need((await io.stat(canonical)).isDirectory(), "path_conflict");
  return canonical;
}

// Host-local metadata API. Acquire exclusive store ownership first. Nothing here
// calls native, restores permissions, removes project content or persists prompts.
export async function openWorkspaceRegistry({
  directory,
  storeId,
  documentsPath,
  runtimeEpoch,
  io = {},
  pathIO = {},
  recoveryReason,
} = {}) {
  need(validWireId(runtimeEpoch));
  if (recoveryReason !== undefined)
    need(STORE_RECOVERY_REASONS.includes(recoveryReason));
  const paths = {
    lstat: fs.lstat,
    stat: fs.stat,
    realpath: fs.realpath,
    mkdir: fs.mkdir,
    ...pathIO,
  };
  // Owner conflict/unverified must not open another owner's journal at all.
  const journal = ["owner_conflict", "owner_unverified"].includes(
    recoveryReason,
  )
    ? undefined
    : await openStorageJournal({ directory, storeId, io, recoveryReason });
  let root = emptyRoot();
  let validatedAdmissionKeys = new Set();
  // Only this live admission may dispatch. Reopen/tail adoption never permits replay.
  const liveFileAdmissions = new Set();
  const liveGitIndexAdmissions = new Set();
  const liveGitBranchRestoreAdmissions = new Set();
  const liveGitCommitAdmissions = new Set();
  let localReason = recoveryReason;
  let queue = Promise.resolve();
  let closedRegistry = false;
  let observationSequence = 0;
  const unavailablePaths = new Map();
  if (journal) {
    const { committed, uncertain } = journal.readRecords();
    try {
      for (const record of committed) root = apply(root, record.payload);
    } catch (error) {
      localReason =
        error.code === "retained_limit" ? error.code : "identity_conflict";
      root = emptyRoot();
    }
    validatedAdmissionKeys = new Set(root.operations.keys());
    // Validate the entire surviving tail against a private candidate before
    // taking ANY conservative identities from it. Invalid suffix stays blocked.
    if (
      !localReason &&
      ["ready", "unconfirmed_tail"].includes(
        journal.status().reason ?? journal.status().state,
      )
    ) {
      try {
        let validated = root;
        const validatedFirstSessions = new Set();
        for (const record of uncertain) {
          const payload = record.payload;
          if (payload.kind === "reservation") {
            const workspace = validated.workspaces.get(
              payload.workspace.workspaceId,
            );
            if (
              workspace &&
              payload.appSessionId === workspace.folderSessionId &&
              canUseManagedFirstSession(validated, workspace)
            )
              validatedFirstSessions.add(key(payload));
          }
          validated = apply(validated, record.payload);
        }
        // Conservative replay does not publish the creator's completion. Carry
        // only the first-session reuse proof from the fully validated tail.
        for (const record of uncertain)
          root = apply(root, record.payload, true, validatedFirstSessions);
      } catch (error) {
        localReason =
          error.code === "retained_limit" ? error.code : "identity_conflict";
      }
    } else if (!localReason && journal.status().reason !== "retained_limit") {
      try {
        for (const record of uncertain)
          root = apply(root, record.payload, true);
      } catch (error) {
        localReason =
          error.code === "retained_limit" ? error.code : "identity_conflict";
      }
    }
  }
  // Validate recorded locations without creating, moving or repairing them.
  for (const workspace of root.workspaces.values()) {
    if (workspace.registrationState === "reserved") continue;
    try {
      need(
        (await canonicalDirectory(
          workspace.canonicalPath,
          paths,
          workspace.ownership === "managed",
        )) === workspace.canonicalPath,
        "path_conflict",
      );
    } catch (error) {
      unavailablePaths.set(workspace.workspaceId, pathReason(error));
    }
  }
  function storeReason() {
    return localReason ?? journal?.status().reason;
  }
  function status() {
    const reason = storeReason();
    return {
      state: reason ? "recovery_required" : "ready",
      ...(reason && { reason }),
      revision: root.revision,
      closed: closedRegistry,
      ...(journal && { journal: journal.status() }),
    };
  }
  function checkWritable() {
    need(!closedRegistry, "closed");
    const reason = storeReason();
    if (reason) throw storageError(reason);
  }
  const serialized = (fn) => {
    const task = queue.then(fn);
    queue = task.catch(() => {});
    return task;
  };
  function getOperation(request) {
    const operation = root.operations.get(operationKey(request));
    need(operation && !operation.terminal, "identity_conflict");
    return operation;
  }
  function resources() {
    const result = recoveryResources(root);
    for (const [workspaceId, reason] of unavailablePaths) {
      if (!root.workspaces.has(workspaceId)) continue;
      const existing = result.find(
        (entry) => entry.workspaceId === workspaceId && !entry.sessionId,
      );
      if (existing) existing.reason = reason;
      else result.push({ workspaceId, state: "unavailable", reason });
    }
    return result;
  }
  function scopeBlocked(identity, excludeKey) {
    const targets = new Set([identity.workspaceId].filter(Boolean));
    const session = identity.sessionId && root.sessions.get(identity.sessionId);
    if (identity.sessionId)
      need(session?.workspaceId === identity.workspaceId, "identity_conflict");
    if (identity.workspaceId)
      need(root.workspaces.has(identity.workspaceId), "identity_conflict");
    for (const resource of resources()) {
      if (!targets.has(resource.workspaceId)) continue;
      // Own unresolved reservation/dispatch is allowed to finish. Path/mapping
      // blocks and OTHER unresolved operations cannot be bypassed.
      if (resource.reason !== "unresolved_operation") return true;
    }
    for (const [otherKey, operation] of root.operations)
      if (otherKey !== excludeKey && retained(operation)) {
        if (
          targets.has(
            operation.identity.workspaceId ??
              operation.reservation?.workspace.workspaceId,
          )
        )
          return true;
      }
    return false;
  }
  async function commit(payload) {
    // Apply a delta to the LATEST root under the same queue that serializes all
    // admissions and completions. No stale whole-root candidates are accepted.
    if (
      payload.kind === "completion" &&
      payload.delta.tombstones.some((entry) => entry.kind === "workspace")
    ) {
      const operation = root.operations.get(key(payload));
      need(operation, "identity_conflict");
      // Live authority comes from this registry epoch, never a caller's old key.
      validateAgentRuntimeCompletion(
        { ...operation, identity: { ...operation.identity, runtimeEpoch } },
        payload,
        root.features,
        root.sessions,
        root.operations,
      );
    }
    const candidate = apply(root, payload);
    await journal.append(payload);
    root = candidate; // No await, user callback or fallible work after flush.
    if (payload.kind === "admission")
      validatedAdmissionKeys.add(key(payload.identity));
  }
  function readView() {
    need(!closedRegistry, "closed");
    need(observationSequence < Number.MAX_SAFE_INTEGER, "observation_limit");
    observationSequence++;
    const reason = storeReason();
    const blocked = resources();
    const retainedOperations = [...root.operations.values()]
      .filter(retained)
      .map(({ identity }) => {
        const { digest: _digest, ...retainedKey } = identity;
        return retainedKey;
      });
    need(
      retainedOperations.length <= STORAGE_LIMITS.operations,
      "retained_limit",
    );
    return copy({
      runtimeEpoch,
      revision: root.revision,
      observationSequence,
      temporary: false,
      state: reason || blocked.length ? "unavailable" : "ready",
      recovery: {
        store: reason
          ? { state: "recovery_required", reason }
          : { state: "ready" },
        resources: blocked,
      },
      retainedOperations,
      workspaces: [...root.workspaces.values()].map((workspace) => ({
        ...workspace,
        temporary: false,
      })),
      sessions: [...root.sessions.values()].map((session) => ({
        ...session,
        status:
          reason ||
          blocked.some(
            (entry) =>
              entry.workspaceId === session.workspaceId &&
              (!entry.sessionId || entry.sessionId === session.appSessionId),
          )
            ? "unavailable"
            : session.lifecycleState === "active"
              ? "idle"
              : "unavailable",
      })),
      tombstones: [...root.tombstones.values()],
      messages: [],
      permissions: [],
    });
  }
  function lookup(request) {
    const operation = root.operations.get(operationKey(request));
    if (operation)
      return copy({ ...request, status: "found", receipt: operation.receipt });
    const knownEpoch =
      [...root.operations.values()].some(
        (entry) => entry.identity.runtimeEpoch === request.runtimeEpoch,
      ) || request.runtimeEpoch === runtimeEpoch;
    return {
      ...request,
      status: knownEpoch ? "missing" : "wrong_epoch",
      effect: "unknown",
    };
  }
  // Host-only digest correlation. Conservative tail holds are lookup-visible,
  // but their identities are not authoritative until explicit tail adoption.
  function lookupIdentity(request) {
    const opKey = operationKey(request);
    if (!validatedAdmissionKeys.has(opKey)) return undefined;
    const operation = root.operations.get(opKey);
    return operation && copy(operation.identity);
  }
  // Fork inherits its parent's native metadata. Recover the child's original
  // admission from the committed reservation and receipt, never from that
  // inherited key or a surviving conservative tail.
  function lookupForkIdentity(request) {
    need(!closedRegistry, "closed");
    closed(request, ["appSessionId"]);
    need(validWireId(request.appSessionId));
    const session = root.sessions.get(request.appSessionId);
    if (!session?.parentSessionId || !session.nativeSessionId) return undefined;
    const matches = [...root.operations.entries()].filter(
      ([opKey, operation]) =>
        validatedAdmissionKeys.has(opKey) &&
        operation.terminal &&
        operation.identity.type === "session.fork" &&
        operation.identity.workspaceId === session.workspaceId &&
        operation.identity.sessionId === session.parentSessionId &&
        operation.reservation?.appSessionId === session.appSessionId &&
        operation.receipt.effect === "confirmed" &&
        operation.receipt.result?.kind === "forked" &&
        operation.receipt.result.sessionId === session.appSessionId &&
        operation.receipt.result.workspaceId === session.workspaceId &&
        operation.receipt.result.nativeSessionId === session.nativeSessionId,
    );
    need(matches.length <= 1, "identity_conflict");
    return matches.length ? copy(matches[0][1].identity) : undefined;
  }
  function begin(input) {
    closed(
      input,
      ["runtimeEpoch", "operationId", "type", "digest"],
      [
        "workspaceId",
        "sessionId",
        "expectedRevision",
        "rejectionCode",
        "nativeServerName",
        "skillSourceName",
        "agentSourceName",
        "agentRuntime",
        "skillRuntime",
        "fileTarget",
        "gitBranchRestoreTarget",
        "gitCommitTarget",
        "gitIndexTarget",
      ],
    );
    const {
      expectedRevision,
      rejectionCode,
      nativeServerName,
      skillSourceName,
      skillRuntime,
      agentSourceName,
      agentRuntime,
      fileTarget,
      gitBranchRestoreTarget,
      gitCommitTarget,
      gitIndexTarget,
      ...identity
    } = input;
    validateStorageIdentity(identity);
    validateFileAdmission({
      identity,
      ...(Object.hasOwn(input, "fileTarget") && { fileTarget }),
    });
    validateGitIndexAdmission({
      identity,
      ...(Object.hasOwn(input, "gitIndexTarget") && { gitIndexTarget }),
    });
    validateGitCommitAdmission({
      identity,
      ...(isGitCommitApply(identity.type) && { expectedRevision }),
      ...(Object.hasOwn(input, "gitCommitTarget") && { gitCommitTarget }),
      ...Object.fromEntries(
        [
          "nativeServerName",
          "agentSourceName",
          "skillSourceName",
          "agentRuntime",
          "skillRuntime",
          "fileTarget",
          "gitIndexTarget",
        ]
          .filter((k) => Object.hasOwn(input, k))
          .map((k) => [k, input[k]]),
      ),
    });
    if (isGitIndexApply(identity.type))
      need(
        Object.hasOwn(input, "expectedRevision") &&
          Number.isSafeInteger(expectedRevision) &&
          expectedRevision >= 0,
      );
    validateGitBranchRestoreAdmission({
      identity,
      ...(isGitBranchRestoreApply(identity.type) && { expectedRevision }),
      ...Object.fromEntries(
        [
          "gitBranchRestoreTarget",
          "nativeServerName",
          "skillSourceName",
          "agentSourceName",
          "agentRuntime",
          "skillRuntime",
          "fileTarget",
          "gitCommitTarget",
          "gitIndexTarget",
        ]
          .filter((k) => Object.hasOwn(input, k))
          .map((k) => [k, input[k]]),
      ),
    });
    const gitBranchRestoreTargetCopy =
      gitBranchRestoreTarget && copy(gitBranchRestoreTarget);
    const gitCommitTargetCopy = gitCommitTarget && copy(gitCommitTarget);
    const gitIndexTargetCopy = gitIndexTarget && copy(gitIndexTarget);
    const fileTargetCopy = fileTarget && copy(fileTarget);
    validateMcpAdmission({
      identity,
      ...(Object.hasOwn(input, "nativeServerName") && { nativeServerName }),
    });
    validateSkillAdmission({
      identity,
      ...(Object.hasOwn(input, "skillSourceName") && { skillSourceName }),
    });
    validateSkillRuntimeAdmission({
      identity,
      ...(Object.hasOwn(input, "skillRuntime") && { skillRuntime }),
    });
    validateAgentFileAdmission({
      identity,
      ...(Object.hasOwn(input, "agentSourceName") && { agentSourceName }),
    });
    validateAgentRuntimeAdmission({
      identity,
      ...(Object.hasOwn(input, "agentRuntime") && { agentRuntime }),
    });
    const agentTarget = agentRuntime && copy(agentRuntime);
    const runtimeTarget = skillRuntime && copy(skillRuntime);
    if (expectedRevision !== undefined)
      need(Number.isSafeInteger(expectedRevision) && expectedRevision >= 0);
    if (rejectionCode !== undefined) need(Object.hasOwn(ERRORS, rejectionCode));
    const immutable = copy(identity);
    return serialized(async () => {
      checkWritable();
      const prior = root.operations.get(key(immutable));
      if (prior) {
        need(
          isDeepStrictEqual(prior.identity, immutable) &&
            isDeepStrictEqual(prior.fileTarget, fileTargetCopy) &&
            isDeepStrictEqual(prior.gitIndexTarget, gitIndexTargetCopy) &&
            isDeepStrictEqual(
              prior.gitBranchRestoreTarget,
              gitBranchRestoreTargetCopy,
            ) &&
            (!isGitBranchRestoreApply(immutable.type) ||
              prior.expectedRevision === expectedRevision) &&
            isDeepStrictEqual(prior.gitCommitTarget, gitCommitTargetCopy) &&
            (!isGitCommitApply(immutable.type) ||
              prior.expectedRevision === expectedRevision) &&
            prior.nativeServerName === nativeServerName &&
            prior.agentSourceName === agentSourceName &&
            isDeepStrictEqual(prior.agentRuntime, agentTarget) &&
            prior.skillSourceName === skillSourceName &&
            isDeepStrictEqual(prior.skillRuntime, runtimeTarget),
          "DUPLICATE_CONFLICT",
        );
        return { status: "duplicate", receipt: copy(prior.receipt) };
      }
      need(root.operations.size < STORAGE_LIMITS.operations, "LIMIT_REACHED");
      const code =
        rejectionCode ??
        (expectedRevision !== undefined && expectedRevision !== root.revision
          ? "STALE_REVISION"
          : scopeBlocked(immutable)
            ? "UNAVAILABLE"
            : undefined);
      if (
        isGitBranchRestoreApply(immutable.type) &&
        !root.features.includes(GIT_BRANCH_RESTORE_FEATURE)
      )
        await commit({
          kind: "feature_gate",
          feature: GIT_BRANCH_RESTORE_FEATURE,
          revision: root.revision + 1,
        });
      if (
        isGitCommitApply(immutable.type) &&
        !root.features.includes(GIT_COMMIT_FEATURE)
      )
        await commit({
          kind: "feature_gate",
          feature: GIT_COMMIT_FEATURE,
          revision: root.revision + 1,
        });
      if (
        isGitIndexApply(immutable.type) &&
        !root.features.includes(GIT_INDEX_FEATURE)
      )
        await commit({
          kind: "feature_gate",
          feature: GIT_INDEX_FEATURE,
          revision: root.revision + 1,
        });
      if (isFileSave(immutable.type) && !root.features.includes(FILE_FEATURE))
        await commit({
          kind: "feature_gate",
          feature: FILE_FEATURE,
          revision: root.revision + 1,
        });
      if (
        (isAgentSave(immutable.type) || agentRuntimeStep(immutable.type)) &&
        !root.features.includes(AGENT_FEATURE)
      )
        await commit({
          kind: "feature_gate",
          feature: AGENT_FEATURE,
          revision: root.revision + 1,
        });
      if (
        skillRuntimeStep(immutable.type) &&
        !root.features.includes(SKILL_RUNTIME_FEATURE)
      )
        await commit({
          kind: "feature_gate",
          feature: SKILL_RUNTIME_FEATURE,
          revision: root.revision + 1,
        });
      if (isSkillSave(immutable.type) && !root.features.includes(SKILL_FEATURE))
        await commit({
          kind: "feature_gate",
          feature: SKILL_FEATURE,
          revision: root.revision + 1,
        });
      if (
        immutable.type === "configuration.save" &&
        !root.features.includes("configuration_save_v1")
      )
        await commit({
          kind: "feature_gate",
          feature: "configuration_save_v1",
          revision: root.revision + 1,
        });
      if (
        (instructionStep(immutable.type) ||
          (immutable.type === "session.fork" &&
            root.sessions.get(immutable.sessionId)?.instructionRegistration !==
              undefined)) &&
        !root.features.includes(INSTRUCTION_FEATURE)
      )
        await commit({
          kind: "feature_gate",
          feature: INSTRUCTION_FEATURE,
          revision: root.revision + 1,
        });
      if (mcpStep(immutable.type) && !root.features.includes(MCP_FEATURE))
        await commit({
          kind: "feature_gate",
          feature: MCP_FEATURE,
          revision: root.revision + 1,
        });
      await commit({
        kind: "admission",
        ...(isFileSave(immutable.type) && { fileTarget: fileTargetCopy }),
        ...(isGitBranchRestoreApply(immutable.type) && {
          gitBranchRestoreTarget: gitBranchRestoreTargetCopy,
          expectedRevision,
        }),
        ...(isGitCommitApply(immutable.type) && {
          gitCommitTarget: gitCommitTargetCopy,
          expectedRevision,
        }),
        ...(isGitIndexApply(immutable.type) && {
          gitIndexTarget: gitIndexTargetCopy,
        }),
        ...(mcpStep(immutable.type) && { nativeServerName }),
        ...(isSkillSave(immutable.type) && { skillSourceName }),
        ...(isAgentSave(immutable.type) && { agentSourceName }),
        ...(agentRuntimeStep(immutable.type) && { agentRuntime: agentTarget }),
        ...(skillRuntimeStep(immutable.type) && {
          skillRuntime: runtimeTarget,
        }),
        identity: immutable,
        revision: root.revision + 1,
        ...(code && { rejectionCode: code }),
      });
      if (isGitBranchRestoreApply(immutable.type) && !code)
        liveGitBranchRestoreAdmissions.add(key(immutable));
      if (isGitCommitApply(immutable.type) && !code)
        liveGitCommitAdmissions.add(key(immutable));
      if (isGitIndexApply(immutable.type) && !code)
        liveGitIndexAdmissions.add(key(immutable));
      if (isFileSave(immutable.type) && !code)
        liveFileAdmissions.add(key(immutable));
      return {
        status: code ? "rejected" : "admitted",
        receipt: copy(root.operations.get(key(immutable)).receipt),
      };
    });
  }
  function reserve(input) {
    closed(
      input,
      ["runtimeEpoch", "operationId"],
      [
        "ownership",
        "canonicalPath",
        "workspaceId",
        "name",
        "plannedNativeSessionId",
      ],
    );
    const request = copy(input);
    return serialized(async () => {
      checkWritable();
      const operation = getOperation({
        runtimeEpoch: request.runtimeEpoch,
        operationId: request.operationId,
      });
      need(
        !isGitBranchRestoreApply(operation.identity.type) &&
          !isGitCommitApply(operation.identity.type) &&
          !isGitIndexApply(operation.identity.type) &&
          !isFileSave(operation.identity.type) &&
          !agentRuntimeStep(operation.identity.type) &&
          !isAgentSave(operation.identity.type) &&
          !skillRuntimeStep(operation.identity.type) &&
          !isSkillSave(operation.identity.type),
        "identity_conflict",
      );
      if (operation.reservation) {
        const prior = operation.reservation;
        need(
          request.plannedNativeSessionId === prior.plannedNativeSessionId,
          "DUPLICATE_CONFLICT",
        );
        need(
          request.workspaceId
            ? request.workspaceId === operation.identity.workspaceId &&
                request.workspaceId === prior.workspace.workspaceId
            : !operation.identity.workspaceId &&
                (request.ownership === prior.workspace.ownership ||
                  (operation.identity.type === "workspace.import" &&
                    request.ownership === "imported" &&
                    request.canonicalPath !== undefined)),
          "DUPLICATE_CONFLICT",
        );
        if (request.name !== undefined)
          need(request.name === prior.workspace.name, "DUPLICATE_CONFLICT");
        if (request.canonicalPath !== undefined)
          need(
            (await canonicalDirectory(request.canonicalPath, paths)) ===
              prior.workspace.canonicalPath,
            "DUPLICATE_CONFLICT",
          );
        return {
          status: "duplicate",
          workspace: copy(prior.workspace),
          appSessionId: prior.appSessionId,
          ...(prior.plannedNativeSessionId && {
            plannedNativeSessionId: prior.plannedNativeSessionId,
          }),
        };
      }
      need(
        !scopeBlocked(operation.identity, key(operation.identity)),
        "UNAVAILABLE",
      );
      let appSessionId = randomUUID();
      let workspace;
      if (request.workspaceId) {
        const existing = root.workspaces.get(request.workspaceId);
        need(
          existing && existing.workspaceId === operation.identity.workspaceId,
          "identity_conflict",
        );
        need(
          request.ownership === undefined &&
            request.canonicalPath === undefined &&
            request.name === undefined,
        );
        if (
          operation.identity.type === "session.create" &&
          !operation.identity.sessionId &&
          canUseManagedFirstSession(root, existing)
        )
          appSessionId = existing.folderSessionId;
        workspace = { ...existing, registrationState: "reserved" };
        delete workspace.revision;
      } else {
        need(
          ["workspace.create", "workspace.import"].includes(
            operation.identity.type,
          ),
        );
        need(
          request.ownership ===
            (operation.identity.type === "workspace.create"
              ? "managed"
              : "imported"),
        );
        let canonicalPath;
        try {
          if (request.ownership === "managed") {
            need(request.canonicalPath === undefined);
            const documents = await canonicalDirectory(
              documentsPath,
              paths,
              true,
            );
            canonicalPath = join(documents, "OhMyOwnCode", appSessionId);
          } else
            canonicalPath = await canonicalDirectory(
              request.canonicalPath,
              paths,
            );
        } catch (error) {
          throw storageError(pathReason(error));
        }
        const existing = [...root.workspaces.values()].find(
          (entry) => entry.canonicalPath === canonicalPath,
        );
        if (existing) {
          need(
            operation.identity.type === "workspace.import",
            "identity_conflict",
          );
          need(existing.registrationState === "registered", "UNAVAILABLE");
          need(
            !scopeBlocked(
              { workspaceId: existing.workspaceId },
              key(operation.identity),
            ),
            "UNAVAILABLE",
          );
          workspace = { ...existing, registrationState: "reserved" };
          delete workspace.revision;
        } else {
          workspace = {
            workspaceId: randomUUID(),
            ownership: request.ownership,
            canonicalPath,
            registrationState: "reserved",
            ...(request.ownership === "managed" && {
              folderSessionId: appSessionId,
            }),
            ...(request.name !== undefined && { name: request.name }),
          };
        }
      }
      const payload = {
        kind: "reservation",
        revision: root.revision + 1,
        runtimeEpoch: request.runtimeEpoch,
        operationId: request.operationId,
        workspace,
        appSessionId,
        ...(request.plannedNativeSessionId && {
          plannedNativeSessionId: request.plannedNativeSessionId,
        }),
      };
      await commit(payload);
      return {
        status: "reserved",
        workspace: copy(workspace),
        appSessionId,
        ...(request.plannedNativeSessionId && {
          plannedNativeSessionId: request.plannedNativeSessionId,
        }),
      };
    });
  }
  function dispatch(input) {
    closed(
      input,
      ["runtimeEpoch", "operationId", "step"],
      [
        "nativeSessionId",
        "nativeServerName",
        "skillRuntime",
        "agentRuntime",
        "fileTarget",
        "gitBranchRestoreTarget",
        "gitCommitTarget",
        "gitIndexTarget",
      ],
    );
    validateFileDispatchPayload(input);
    validateGitIndexDispatchPayload(input);
    validateGitCommitDispatchPayload(input);
    validateGitBranchRestoreDispatchPayload(input);
    const request = copy(input);
    return serialized(async () => {
      checkWritable();
      const operation = getOperation({
        runtimeEpoch: request.runtimeEpoch,
        operationId: request.operationId,
      });
      need(
        !scopeBlocked(operation.identity, key(operation.identity)),
        "UNAVAILABLE",
      );
      if (isGitBranchRestoreApply(operation.identity.type)) {
        need(
          liveGitBranchRestoreAdmissions.has(key(operation.identity)),
          "UNAVAILABLE",
        );
        validateGitBranchRestoreDispatch(operation, request);
      }
      if (isGitCommitApply(operation.identity.type)) {
        need(
          liveGitCommitAdmissions.has(key(operation.identity)),
          "UNAVAILABLE",
        );
        validateGitCommitDispatch(operation, request);
      }
      if (isGitIndexApply(operation.identity.type)) {
        need(
          liveGitIndexAdmissions.has(key(operation.identity)),
          "UNAVAILABLE",
        );
        validateGitIndexDispatch(operation, request);
      }
      if (isFileSave(operation.identity.type))
        need(liveFileAdmissions.has(key(operation.identity)), "UNAVAILABLE");
      const prior = operation.dispatches.find(
        (entry) => entry.step === request.step,
      );
      if (prior) {
        need(
          isDeepStrictEqual(prior.fileTarget, request.fileTarget) &&
            prior.nativeSessionId === request.nativeSessionId &&
            prior.nativeServerName === request.nativeServerName &&
            isDeepStrictEqual(prior.skillRuntime, request.skillRuntime) &&
            isDeepStrictEqual(prior.agentRuntime, request.agentRuntime),
          "DUPLICATE_CONFLICT",
        );
        validateFileDispatch(operation, request);
        validateGitIndexDispatch(operation, request);
        validateGitCommitDispatch(operation, request);
        validateGitBranchRestoreDispatch(operation, request);
        validateMcpDispatch(operation, request);
        validateAgentRuntimeDispatch(
          operation,
          request,
          root.sessions,
          root.operations,
        );
        validateSkillRuntimeDispatch(
          operation,
          request,
          root.sessions,
          root.operations,
        );
        return { status: "duplicate" };
      }
      validateFileDispatch(operation, request);
      validateGitIndexDispatch(operation, request);
      validateGitCommitDispatch(operation, request);
      validateGitBranchRestoreDispatch(operation, request);
      validateMcpDispatch(operation, request);
      validateAgentRuntimeDispatch(
        operation,
        request,
        root.sessions,
        root.operations,
      );
      validateSkillRuntimeDispatch(
        operation,
        request,
        root.sessions,
        root.operations,
      );
      if (
        [
          "workspace.create",
          "workspace.import",
          "session.create",
          "session.fork",
        ].includes(operation.identity.type)
      )
        need(operation.reservation, "identity_conflict");
      await commit({
        kind: "dispatch",
        ...request,
        revision: root.revision + 1,
      });
      return {
        status: "dispatched",
        receipt: copy(root.operations.get(key(request)).receipt),
      };
    });
  }
  function complete(input) {
    closed(
      input,
      ["runtimeEpoch", "operationId", "receipt", "delta"],
      ["verifiedNativeSessionIds"],
    );
    need(
      input.receipt &&
        Object.getPrototypeOf(input.receipt) === Object.prototype &&
        Reflect.ownKeys(input.receipt).every(
          (k) =>
            typeof k === "string" &&
            Object.hasOwn(
              Object.getOwnPropertyDescriptor(input.receipt, k),
              "value",
            ),
        ),
    );
    if (
      isFileSave(input.receipt.type) ||
      isGitIndexApply(input.receipt.type) ||
      isGitBranchRestoreApply(input.receipt.type) ||
      isGitCommitApply(input.receipt.type)
    )
      validateStorageReceipt(input.receipt);
    // Copy/redact before queueing, so callers cannot mutate an in-flight delta.
    const request = copy({
      runtimeEpoch: input.runtimeEpoch,
      operationId: input.operationId,
      receipt:
        isGitBranchRestoreApply(input.receipt.type) ||
        isGitCommitApply(input.receipt.type) ||
        isGitIndexApply(input.receipt.type) ||
        isFileSave(input.receipt.type) ||
        isAgentSave(input.receipt.type) ||
        agentRuntimeStep(input.receipt.type) ||
        isSkillSave(input.receipt.type) ||
        skillRuntimeStep(input.receipt.type)
          ? copy(input.receipt)
          : redactReceipt(input.receipt),
      delta: validateRegistryDelta(input.delta),
      verifiedNativeSessionIds: input.verifiedNativeSessionIds ?? [],
    });
    need(
      Array.isArray(request.verifiedNativeSessionIds) &&
        request.verifiedNativeSessionIds.length <= 200 &&
        new Set(request.verifiedNativeSessionIds).size ===
          request.verifiedNativeSessionIds.length,
    );
    return serialized(async () => {
      checkWritable();
      const operation = root.operations.get(
        operationKey({
          runtimeEpoch: request.runtimeEpoch,
          operationId: request.operationId,
        }),
      );
      need(operation, "identity_conflict");
      if (isGitBranchRestoreApply(operation.identity.type)) {
        if (request.receipt.effect === "confirmed" && !operation.terminal)
          need(
            liveGitBranchRestoreAdmissions.has(key(operation.identity)),
            "UNAVAILABLE",
          );
        validateStorageReceipt(request.receipt);
        validateGitBranchRestoreCompletion(operation, request, root.features);
      }
      if (isGitCommitApply(operation.identity.type)) {
        if (request.receipt.effect === "confirmed" && !operation.terminal)
          need(
            liveGitCommitAdmissions.has(key(operation.identity)),
            "UNAVAILABLE",
          );
        validateStorageReceipt(request.receipt);
        validateGitCommitCompletion(operation, request, root.features);
      }
      if (isGitIndexApply(operation.identity.type)) {
        if (request.receipt.effect === "confirmed" && !operation.terminal)
          need(
            liveGitIndexAdmissions.has(key(operation.identity)),
            "UNAVAILABLE",
          );
        validateStorageReceipt(request.receipt);
        validateGitIndexCompletion(operation, request, root.features);
      }
      if (isFileSave(operation.identity.type)) {
        if (request.receipt.effect === "confirmed" && !operation.terminal)
          need(liveFileAdmissions.has(key(operation.identity)), "UNAVAILABLE");
        validateStorageReceipt(request.receipt);
        validateFileCompletion(operation, request, root.features);
      }
      if (
        isAgentSave(operation.identity.type) ||
        agentRuntimeStep(operation.identity.type)
      ) {
        validateStorageReceipt(request.receipt);
        validateAgentFileCompletion(operation, request, root.features);
        validateAgentRuntimeCompletion(
          operation,
          request,
          root.features,
          root.sessions,
          root.operations,
        );
      }
      if (isSkillSave(operation.identity.type)) {
        validateStorageReceipt(request.receipt);
        validateSkillCompletion(operation, request, root.features);
      }
      if (skillRuntimeStep(operation.identity.type)) {
        validateStorageReceipt(request.receipt);
        validateSkillRuntimeCompletion(
          operation,
          request,
          root.features,
          root.sessions,
          root.operations,
        );
      }
      const receipt = {
        ...(isGitBranchRestoreApply(operation.identity.type)
          ? redactReceipt({
              ...request.receipt,
              gitBranchRestoreTarget: operation.gitBranchRestoreTarget,
              digest: operation.identity.digest,
            })
          : isGitCommitApply(operation.identity.type)
            ? redactReceipt({
                ...request.receipt,
                gitCommitTarget: operation.gitCommitTarget,
                digest: operation.identity.digest,
              })
            : isGitIndexApply(operation.identity.type)
              ? redactReceipt({
                  ...request.receipt,
                  gitIndexTarget: operation.gitIndexTarget,
                  digest: operation.identity.digest,
                })
              : isFileSave(operation.identity.type)
                ? redactReceipt({
                    ...request.receipt,
                    fileTarget: operation.fileTarget,
                    digest: operation.identity.digest,
                  })
                : isAgentSave(operation.identity.type)
                  ? redactReceipt({
                      ...request.receipt,
                      agentSourceName: operation.agentSourceName,
                    })
                  : isSkillSave(operation.identity.type)
                    ? redactReceipt({
                        ...request.receipt,
                        skillSourceName: operation.skillSourceName,
                      })
                    : request.receipt),
        revision: root.revision + 1,
      };
      for (const session of request.delta.sessions)
        if (session.nativeSessionId) {
          if (!root.sessions.has(session.appSessionId))
            need(
              request.verifiedNativeSessionIds.includes(
                session.nativeSessionId,
              ),
              "native_mapping_unverified",
            );
          if (
            request.verifiedNativeSessionIds.includes(
              session.nativeSessionId,
            ) &&
            !receipt.evidence.some(
              (entry) =>
                entry.kind === "native_session_verified" &&
                entry.id === session.nativeSessionId,
            )
          )
            receipt.evidence.push({
              kind: "native_session_verified",
              id: session.nativeSessionId,
            });
        }
      validateStorageReceipt(receipt);
      if (operation.completedDelta) {
        const { revision: _revision, ...oldReceipt } = operation.receipt;
        const { revision: _newRevision, ...newReceipt } = receipt;
        const identical =
          isDeepStrictEqual(oldReceipt, newReceipt) &&
          isDeepStrictEqual(operation.completedDelta, request.delta);
        if (identical)
          return { status: "duplicate", receipt: copy(operation.receipt) };
        need(!operation.terminal, "DUPLICATE_CONFLICT");
      } else need(!operation.terminal, "DUPLICATE_CONFLICT");
      const registeredPaths = new Map(
        request.delta.workspaces
          .filter((workspace) => workspace.registrationState === "registered")
          .map((workspace) => [workspace.workspaceId, workspace]),
      );
      for (const session of request.delta.sessions)
        if (session.lifecycleState === "active")
          registeredPaths.set(
            session.workspaceId,
            root.workspaces.get(session.workspaceId),
          );
      for (const workspace of registeredPaths.values()) {
        need(workspace, "identity_conflict");
        try {
          need(
            (await canonicalDirectory(
              workspace.canonicalPath,
              paths,
              workspace.ownership === "managed",
            )) === workspace.canonicalPath,
            "path_conflict",
          );
        } catch (error) {
          const reason = pathReason(error);
          unavailablePaths.set(workspace.workspaceId, reason);
          throw storageError(reason);
        }
      }
      await commit({
        kind: "completion",
        runtimeEpoch: request.runtimeEpoch,
        operationId: request.operationId,
        receipt,
        delta: request.delta,
        revision: root.revision + 1,
      });
      if (isGitBranchRestoreApply(operation.identity.type))
        liveGitBranchRestoreAdmissions.delete(key(operation.identity));
      if (isGitCommitApply(operation.identity.type))
        liveGitCommitAdmissions.delete(key(operation.identity));
      if (isGitIndexApply(operation.identity.type))
        liveGitIndexAdmissions.delete(key(operation.identity));
      if (isFileSave(operation.identity.type))
        liveFileAdmissions.delete(key(operation.identity));
      return {
        status: "completed",
        receipt: copy(root.operations.get(key(request)).receipt),
      };
    });
  }
  // This performs ONLY the reserved managed-folder effects. Each creation has
  // its own flushed intent. Duplicate intent NEVER replays an effect.
  function materializeManaged(request) {
    const opKey = operationKey(request);
    return serialized(async () => {
      checkWritable();
      const operation = root.operations.get(opKey);
      need(operation?.reservation && !operation.terminal, "identity_conflict");
      const workspace = operation.reservation.workspace;
      need(
        workspace.ownership === "managed" &&
          workspace.folderSessionId === operation.reservation.appSessionId,
        "identity_conflict",
      );
      need(!scopeBlocked(operation.identity, opKey), "UNAVAILABLE");
      const base = resolve(workspace.canonicalPath, "..");
      const documents = resolve(base, "..");
      try {
        need(
          (await canonicalDirectory(documents, paths, true)) === documents,
          "path_conflict",
        );
        let baseExists = true;
        try {
          await canonicalDirectory(base, paths, true);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
          baseExists = false;
        }
        for (const [target, step, create] of [
          [base, "filesystem.managed_base", !baseExists],
          [workspace.canonicalPath, "filesystem.managed_folder", true],
        ]) {
          if (!create) continue;
          need(
            !operation.dispatches.some((entry) => entry.step === step),
            "unresolved_operation",
          );
          try {
            await paths.lstat(target);
            throw storageError("path_conflict");
          } catch (error) {
            if (error.code !== "ENOENT") throw error;
          }
          await commit({
            kind: "dispatch",
            ...request,
            step,
            revision: root.revision + 1,
          });
          // Revalidate the parent after flush; a substituted symlink is refused.
          await canonicalDirectory(resolve(target, ".."), paths, true);
          await paths.mkdir(target, { mode: 0o700 });
          await canonicalDirectory(target, paths, true);
        }
        return { canonicalPath: workspace.canonicalPath };
      } catch (error) {
        if (storeReason()) throw storageError(storeReason());
        const reason = pathReason(error);
        unavailablePaths.set(workspace.workspaceId, reason);
        throw storageError(reason);
      }
    });
  }
  return {
    begin,
    reserve,
    dispatch,
    complete,
    readView,
    lookup,
    lookupIdentity,
    lookupForkIdentity,
    status,
    materializeManaged,
    checkpoint: () =>
      serialized(async () => {
        checkWritable();
        return journal.checkpoint();
      }),
    recordOwnerIntent: (input) => {
      const request = copy(input);
      return serialized(async () => {
        checkWritable();
        await commit({
          ...request,
          kind: "owner_intent",
          revision: root.revision + 1,
        });
      });
    },
    recordMigrationPhase: (input) => {
      const request = copy(input);
      return serialized(async () => {
        checkWritable();
        await commit({
          ...request,
          kind: "migration_phase",
          revision: root.revision + 1,
        });
      });
    },
    recover: (decision) =>
      serialized(async () => {
        need(journal && !localReason, "recovery_denied");
        let candidate = emptyRoot();
        for (const record of journal.readRecords().validated)
          candidate = apply(candidate, record.payload);
        await journal.recover(decision);
        candidate.revision =
          journal.readRecords().committed.at(-1)?.payload.revision ?? 0;
        root = candidate;
        validatedAdmissionKeys = new Set(root.operations.keys());
        return status();
      }),
    close: () =>
      serialized(async () => {
        if (closedRegistry) return;
        closedRegistry = true;
        if (journal) await journal.close();
      }),
  };
}
