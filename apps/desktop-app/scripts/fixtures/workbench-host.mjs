// Synthetic main only; production renderer/preload, no SDK or provider execution.
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import {
  mcpNativeName,
  mcpDigest,
  normalizeMcpDefinition,
  observeMcpCatalog,
} from "../../src/host/workbench-mcp.mjs";
import { configurationBackupId } from "../../src/host/configuration-file-observation.mjs";
import {
  INSTRUCTION_KEY,
  instructionDigest,
  observeInstructions,
} from "../../src/host/workbench-instructions.mjs";
import {
  configurationFileContentFits,
  configurationFileWriteFits,
} from "../../src/renderer/shared/configuration-draft/validation.mjs";
import {
  SKILL_LIMITS,
  skillFileContentFits,
  skillFileWriteFits,
} from "../../src/renderer/shared/configuration-draft/skill.mjs";
import {
  skillRuntimeIdPayload,
  skillRuntimeStep,
  validSkillRuntimeObservation,
  validSkillRuntimeMutation,
} from "../../src/renderer/shared/configuration-draft/skill-runtime.mjs";
import { nativeSkillDigest } from "../../src/native-skills-protocol.mjs";
import { validateSkillRuntimeReceipt } from "../../src/host/workbench-skill-runtime-storage.mjs";
import {
  AGENT_LIMITS,
  agentFileContentFits,
  agentFileWriteFits,
  parseAgentFile,
} from "../../src/renderer/shared/configuration-draft/agent.mjs";
import {
  agentRuntimeStep,
  validAgentRuntimeObservation,
  validAgentRuntimeMutation,
} from "../../src/renderer/shared/configuration-draft/agent-runtime.mjs";
import {
  WORKSPACE_FILE_LIMITS,
  workspaceFilePathReason,
  workspaceFileTargetPath,
  validateWorkspaceFileText,
  validateWorkspaceFileObservation,
  validateWorkspaceFileSave,
} from "../../src/renderer/shared/workspace-file/index.mjs";
import {
  fileBackupId,
  validateFileReceipt,
} from "../../src/host/workbench-file-storage.mjs";
import { BASELINE_POLICY } from "../../src/renderer/shared/configuration-draft/policy.mjs";
import {
  projectPermissionPolicy,
  validatePermissionPolicyObservation,
} from "../../src/renderer/shared/configuration-draft/permission-policy.mjs";
import {
  EXTENSIONS_LIMITS,
  projectNativePlugins,
  projectNativeTools,
  validateExtensionsObservation,
} from "../../src/renderer/shared/configuration-draft/extensions.mjs";
import {
  nativeAgentRegistrationId,
  nativeAgentDigest,
} from "../../src/native-agents-protocol.mjs";
import {
  agentBackupId,
  validAgentSavedResult,
  validateAgentRuntimeReceipt,
} from "../../src/host/workbench-agent-storage.mjs";
import { admitsRendererRequest } from "../../src/renderer-admission.mjs";
import { isDeepStrictEqual } from "node:util";
import {
  CONTEXT_LIMITS,
  validateContextObservation,
  validateInboxObservation,
  validInboxCancelResult,
  contextModelSupports,
} from "../../src/renderer/shared/conversation-context/index.mjs";
import { validInboxCancelRequestedResult } from "../../src/host/conversation-context-storage.mjs";
import { validContextPromptReceipt } from "../../src/host/conversation-context-native.mjs";
import { redactReceipt } from "../../src/host/workbench-receipts.mjs";
import {
  projectModelOptions,
  projectAssistantRuntime,
  projectSessionSelection,
  validModelOptions,
} from "../../src/renderer/shared/runtime-options/index.mjs";
import {
  failure,
  READ_TYPES,
  validateEnvelope,
  validateCancel,
  validateSnapshot,
} from "../../src/workbench-contract.mjs";

import {
  GIT_REVIEW_LIMITS,
  validateGitReviewRequest,
  validateGitReviewObservation,
  validateGitDiffObservation,
} from "../../src/renderer/shared/git-review/index.mjs";

import {
  GIT_INDEX_LIMITS,
  GIT_ABSENT_INDEX_DIGEST,
  gitIndexTargetFromApply,
  validateGitIndexRequest,
  validateGitIndexPreview,
  validateGitIndexMutationResult,
} from "../../src/renderer/shared/git-index/index.mjs";
import {
  gitIndexBackupId,
  validGitIndexUpdatedResult,
  validateGitIndexReceipt,
} from "../../src/host/workbench-git-index-storage.mjs";

import {
  GIT_COMMIT_LIMITS,
  GIT_COMMIT_ABSENT_DIGEST,
  canonicalGitCommitMessage,
  gitCommitTargetFromApply,
  validateGitCommitRequest,
  validateGitCommitPreview,
  validateGitCommitMutationResult,
} from "../../src/renderer/shared/git-commit/index.mjs";
import { gitCommitExpectedBackups } from "../../src/host/git-commit-contract.mjs";
import {
  validGitCommitCreatedResult,
  validateGitCommitReceipt,
} from "../../src/host/workbench-git-commit-storage.mjs";

import {
  GIT_BRANCH_RESTORE_LIMITS,
  gitBranchRestoreMode,
  gitBranchRestoreTargetFromApply,
  validateGitBranchRestoreRequest,
  validateGitBranchRestorePreview,
  validateGitBranchRestoreMutationResult,
} from "../../src/renderer/shared/git-branch-restore/index.mjs";
import {
  gitBranchRestoreExpectedBackups,
  gitBranchRestoreIdentityDigest,
  GIT_BRANCH_RESTORE_STATE_MARKERS,
} from "../../src/host/git-branch-restore-contract.mjs";
import {
  validGitBranchRestoreAppliedResult,
  validateGitBranchRestoreReceipt,
} from "../../src/host/workbench-git-branch-restore-storage.mjs";

export function createUiFixture() {
  const available = (entries) => ({ status: "available", entries });
  const fixture = {
    // Explicitly synthetic: no repository, executable or descriptor capability.
    gitReads: [],
    syntheticGitBranchRestores: new Map(),
    syntheticGitBranchRestoreBackups: new Map(),
    gitBranchRestorePreviews: new Map(),
    gitBranchRestoreReads: [],
    gitBranchRestoreEffects: [],
    pendingGitBranchRestoreWorkspaces: new Set(),
    pendingGitBranchRestoreReadWorkspaces: new Set(),
    heldGitBranchRestoreReads: [],
    heldGitBranchRestoreApplies: [],
    gitBranchRestoreCompletions: [],
    holdGitBranchRestorePreview: false,
    holdGitBranchRestoreApply: false,
    nextGitBranchRestoreApply: undefined,
    gitBranchRestoreState: undefined,
    // SYNTHETIC maps only; no original publication, files or native capability.
    syntheticGitCommits: new Map(),
    syntheticGitCommitBackups: new Map(),
    gitCommitPreviews: new Map(),
    gitCommitReads: [],
    gitCommitEffects: [],
    pendingGitCommitWorkspaces: new Set(),
    pendingGitCommitReadWorkspaces: new Set(),
    heldGitCommitReads: [],
    heldGitCommitApplies: [],
    gitCommitCompletions: [],
    holdGitCommitPreview: false,
    holdGitCommitApply: false,
    nextGitCommitApply: undefined,
    gitCommitState: undefined,
    // Memory-only index authority, deliberately labelled synthetic.
    syntheticGitIndexes: new Map(),
    syntheticGitIndexBackups: new Map(),
    gitIndexPreviews: new Map(),
    gitIndexReads: [],
    gitIndexEffects: [],
    pendingGitIndexWorkspaces: new Set(),
    pendingGitIndexReadWorkspaces: new Set(),
    heldGitIndexReads: [],
    heldGitIndexApplies: [],
    gitIndexCompletions: [],
    holdGitIndexPreview: false,
    holdGitIndexApply: false,
    nextGitIndexApply: undefined,
    gitIndexState: undefined,
    gitObservations: new Map(),
    gitSerial: 0,
    gitSenderSerial: 0,
    gitNow: 0,
    gitState: "ready",
    gitBusy: new Set(),
    gitAppMutationActive: false,
    heldGitReads: [],
    holdGitStatus: false,
    holdGitDiff: false,
    workspaceFiles: new Map(),
    workspaceFileDirectories: new Map(),
    workspaceFileBackups: new Map(),
    workspaceFileReadOutcomes: new Map(),
    workspaceFileReads: [],
    workspaceFilePreviews: [],
    holdWorkspaceFileReads: false,
    heldWorkspaceFileReads: [],
    holdWorkspaceFileSave: false,
    heldWorkspaceFileSaves: [],
    workspaceFileCompletions: [],
    pendingWorkspaceFiles: new Set(),
    retainedReceipts: new Map(),
    lookups: [],
    lookupEnvelopes: [],
    intents: [],
    requests: [],
    extensionReads: [],
    // Inert synthetic session maps, never actual Native enforcement evidence.
    syntheticPermissionPolicies: new Map(),
    permissionPolicyReads: [],
    permissionPolicyIO: [],
    heldPermissionPolicyReads: [],
    holdPermissionPolicyReads: false,
    permissionPolicyGeneration: 0,
    extensionGeneration: 0,
    holdExtensionReads: false,
    heldExtensionReads: [],
    diagnosticReads: [],
    configurationFiles: new Map(),
    configurationBackups: new Map(),
    // Virtual filesystem only. These bytes/identities never reach Native.
    skillFiles: new Map(),
    skillDirectories: new Map(),
    skillBackups: new Map(),
    skillReadOutcomes: new Map(),
    skillReads: [],
    skillRuntimeReads: [],
    holdSkillRuntimeReads: false,
    heldSkillRuntimeReads: [],
    skillRuntimeRegistrations: new Map(),
    skillRuntimeHistory: new Map(),
    skillRuntimeObservations: new Map(),
    skillRuntimeUnowned: [],
    skillRuntimeEffects: [],
    skillRuntimeSerial: 0,
    nextSkillRuntime: undefined,
    holdSkillRuntime: false,
    heldSkillRuntime: [],
    skillSnapshotReads: [],
    skillListOutcome: undefined,
    skillListTruncated: false,
    nextSkillSave: undefined,
    holdSkillSave: false,
    heldSkillSaves: [],
    pendingSkillWorkspaces: new Set(),
    agentFiles: new Map(),
    agentDirectories: new Map(),
    agentBackups: new Map(),
    agentReadOutcomes: new Map(),
    agentReads: [],
    agentSnapshotReads: [],
    agentRuntimeReads: [],
    agentRuntimeRegistrations: new Map(),
    agentRuntimeObservations: new Map(),
    agentRuntimeReferences: [],
    agentRuntimeUnowned: [
      {
        nativeId: "fixture-agent",
        name: "Test agent",
        mode: "primary",
        hidden: false,
      },
    ],
    agentRuntimeEffects: [],
    agentRuntimeSerial: 0,
    agentRuntimeDefaultId: "fixture-agent",
    holdAgentRuntimeReads: false,
    heldAgentRuntimeReads: [],
    holdAgentRuntime: false,
    heldAgentRuntime: [],
    holdAgentSave: false,
    heldAgentSaves: [],
    pendingAgentWorkspaces: new Set(),
    mcpCatalog: new Map(),
    mcpRegistrations: new Map(),
    mcpReads: [],
    nextMcp: undefined,
    holdMcp: false,
    heldMcp: [],
    pendingMcpWorkspaces: new Set(),
    instructionEntries: new Map(),
    instructionRegistrations: new Map(),
    nextInstructions: undefined,
    holdInstructions: false,
    heldInstructions: [],
    instructionReads: [],
    nextConfigurationSave: undefined,
    holdConfigurationSave: false,
    heldConfigurationSaves: [],
    heldDiagnostics: [],
    holdDiagnostics: false,
    diagnostics: {
      startedAt: Date.now(),
      observedOperations: 0,
      errors: 0,
      unknownOutcomes: 0,
      droppedEvents: 0,
      events: [],
    },
    nextSendUnknown: false,
    // Synthetic ACK delivery control; the accepted request remains observable.
    holdSendAck: false,
    heldSendAcks: [],
    gitPatchOverride: undefined,
    lastWorkspaceFileObservation: undefined,
    lastGitDiffObservation: undefined,
    snapshot: {
      runtimeEpoch: "fixture-runtime-v2",
      revision: 1,
      observationSequence: 1,
      recovery: { store: { state: "ready" }, resources: [] },
      retainedOperations: [],
      state: "connected",
      temporary: true,
      workspaces: [
        {
          id: "fixture-w",
          name: "UI test workspace",
          path: "/synthetic/workspace",
          kind: "folder",
          trusted: true,
          trustRevision: 1,
          temporary: true,
        },
      ],
      sessions: [
        {
          id: "fixture-s",
          workspaceId: "fixture-w",
          title: "도구와 권한 상태 검증",
          status: "idle",
        },
      ],
      selectedWorkspaceId: "fixture-w",
      selectedSessionId: "fixture-s",
      messages: [],
      permissions: [],
    },
    catalog: {
      commands: available([
        {
          id: "inspect",
          name: "inspect",
          description: "Synthetic command for UI testing",
        },
      ]),
      skills: available([
        { id: "review", name: "code-review", description: "Synthetic skill" },
      ]),
      mcp: available([
        { id: "fixture-mcp", name: "fixture-mcp", status: "disabled" },
      ]),
      agents: available([{ id: "fixture-agent", name: "Test agent" }]),
      models: available([
        {
          id: "fixture-model",
          name: "Test model",
          variants: { status: "unavailable", ids: [] },
        },
      ]),
    },
  };
  fixture.setGitState = (name) => applyGitReviewState(fixture, name);
  // Opt-in only. Original fixture matrices keep their existing behavior.
  fixture.setRuntimeOptionsState = (name) =>
    applyRuntimeOptionsState(fixture, name);
  fixture.setConversationContextState = (name) =>
    applyConversationContextState(fixture, name);
  fixture.setRuntimeSessionObservation = (
    sessionId,
    info,
    outcome = "current",
  ) => {
    if (!["current", "absent", "failed"].includes(outcome))
      throw new Error("Unknown synthetic runtime observation outcome");
    fixture.runtimeSessionObservations.set(sessionId, {
      outcome,
      info: clone(info),
    });
    fixture.snapshot.revision++;
    fixture.snapshot.observationSequence++;
  };
  fixture.releaseRuntimeReads = () => {
    fixture.holdRuntimeReads = false;
    for (const release of fixture.heldRuntimeReads.splice(0)) release();
  };
  fixture.removeRuntimeVariant = (id) => {
    if (!fixture.runtimeOptionsState)
      throw new Error("Runtime scenario required");
    const model = fixture.catalog.models.entries[0];
    model.variants.ids = model.variants.ids.filter((value) => value !== id);
  };
  fixture.releaseSendAcks = () => {
    fixture.holdSendAck = false;
    for (const release of fixture.heldSendAcks.splice(0)) release();
  };
  fixture.releaseGitReads = (kind) => {
    if (!kind || kind === "git.review.read") fixture.holdGitStatus = false;
    if (!kind || kind === "git.diff.read") fixture.holdGitDiff = false;
    const pending = fixture.heldGitReads.splice(0);
    for (const entry of pending) {
      if (!kind || entry.kind === kind) entry.release();
      else fixture.heldGitReads.push(entry);
    }
  };
  fixture.setGitBranchRestoreState = (name) =>
    applyGitBranchRestoreState(fixture, name);
  fixture.releaseGitBranchRestoreReads = () => {
    fixture.holdGitBranchRestorePreview = false;
    for (const release of fixture.heldGitBranchRestoreReads.splice(0))
      release();
  };
  fixture.confirmGitBranchRestoreApplies = () => {
    for (const complete of fixture.gitBranchRestoreCompletions.splice(0))
      complete();
  };
  fixture.releaseGitBranchRestoreApplies = () => {
    fixture.holdGitBranchRestoreApply = false;
    for (const release of fixture.heldGitBranchRestoreApplies.splice(0))
      release();
  };
  fixture.setGitCommitState = (name) => applyGitCommitState(fixture, name);
  fixture.releaseGitCommitReads = () => {
    fixture.holdGitCommitPreview = false;
    for (const release of fixture.heldGitCommitReads.splice(0)) release();
  };
  fixture.confirmGitCommitApplies = () => {
    for (const complete of fixture.gitCommitCompletions.splice(0)) complete();
  };
  fixture.releaseGitCommitApplies = () => {
    fixture.holdGitCommitApply = false;
    for (const release of fixture.heldGitCommitApplies.splice(0)) release();
  };
  fixture.setGitIndexState = (name) => applyGitIndexState(fixture, name);
  fixture.releaseGitIndexReads = () => {
    fixture.holdGitIndexPreview = false;
    for (const release of fixture.heldGitIndexReads.splice(0)) release();
  };
  fixture.confirmGitIndexApplies = () => {
    for (const complete of fixture.gitIndexCompletions.splice(0)) complete();
  };
  fixture.releaseGitIndexApplies = () => {
    fixture.holdGitIndexApply = false;
    for (const release of fixture.heldGitIndexApplies.splice(0)) release();
  };
  fixture.workspaceFileKey = (workspaceId, path) =>
    JSON.stringify([
      workspaceId,
      fixture.snapshot.workspaces.find((w) => w.id === workspaceId)?.path,
      path,
    ]);
  fixture.setWorkspaceFileState = (name) =>
    applyWorkspaceFileState(fixture, name);
  fixture.releaseWorkspaceFileReads = () => {
    fixture.holdWorkspaceFileReads = false;
    for (const release of fixture.heldWorkspaceFileReads.splice(0)) release();
  };
  fixture.confirmWorkspaceFileSaves = () => {
    for (const complete of fixture.workspaceFileCompletions.splice(0))
      complete();
  };
  fixture.releaseWorkspaceFileSaves = () => {
    fixture.holdWorkspaceFileSave = false;
    for (const release of fixture.heldWorkspaceFileSaves.splice(0)) release();
  };
  fixture.releaseConfigurationSaves = () => {
    fixture.holdConfigurationSave = false;
    for (const release of fixture.heldConfigurationSaves.splice(0)) release();
  };
  fixture.agentKey = (workspaceId, sourceName = null) =>
    JSON.stringify([
      workspaceId,
      fixture.snapshot.workspaces.find((w) => w.id === workspaceId)?.path,
      sourceName,
    ]);
  fixture.setAgentState = (name) => applyAgentState(fixture, name);
  fixture.setAgentRuntimeState = (name) =>
    applyAgentRuntimeState(fixture, name);
  fixture.releaseAgentSaves = () => {
    fixture.holdAgentSave = false;
    for (const release of fixture.heldAgentSaves.splice(0)) release();
  };
  fixture.releaseAgentRuntime = () => {
    fixture.holdAgentRuntime = false;
    for (const release of fixture.heldAgentRuntime.splice(0)) release();
  };
  fixture.releaseAgentRuntimeReads = () => {
    fixture.holdAgentRuntimeReads = false;
    for (const release of fixture.heldAgentRuntimeReads.splice(0)) release();
  };
  fixture.setMcpState = (name) => applyMcpState(fixture, name);
  fixture.setExtensionsState = (name) => applyExtensionsState(fixture, name);
  fixture.setPermissionPolicyState = (name) =>
    applyPermissionPolicyState(fixture, name);
  fixture.releasePermissionPolicyReads = () => {
    fixture.holdPermissionPolicyReads = false;
    for (const release of fixture.heldPermissionPolicyReads.splice(0))
      release();
  };
  fixture.releaseExtensionReads = () => {
    fixture.holdExtensionReads = false;
    for (const release of fixture.heldExtensionReads.splice(0)) release();
  };
  fixture.skillKey = (workspaceId, sourceName) =>
    JSON.stringify([
      workspaceId,
      fixture.snapshot.workspaces.find((w) => w.id === workspaceId)?.path,
      sourceName,
    ]);
  fixture.releaseSkillRuntimeReads = () => {
    fixture.holdSkillRuntimeReads = false;
    for (const release of fixture.heldSkillRuntimeReads.splice(0)) release();
  };
  fixture.setSkillRuntimeState = (name) =>
    applySkillRuntimeState(fixture, name);
  fixture.releaseSkillRuntime = () => {
    fixture.holdSkillRuntime = false;
    for (const release of fixture.heldSkillRuntime.splice(0)) release();
  };
  fixture.setSkillState = (name) => applySkillState(fixture, name);
  fixture.releaseSkillSaves = () => {
    fixture.holdSkillSave = false;
    for (const release of fixture.heldSkillSaves.splice(0)) release();
  };
  fixture.releaseMcp = () => {
    fixture.holdMcp = false;
    for (const release of fixture.heldMcp.splice(0)) release();
  };
  fixture.releaseInstructions = () => {
    fixture.holdInstructions = false;
    for (const release of fixture.heldInstructions.splice(0)) release();
  };
  fixture.setInstructionState = (name) => applyInstructionState(fixture, name);
  fixture.releaseDiagnostics = () => {
    fixture.holdDiagnostics = false;
    for (const release of fixture.heldDiagnostics.splice(0)) release();
  };
  // Opt-in only: the existing UI suite retains its single-session semantics.
  fixture.enablePerformanceSessions = () => {
    fixture.snapshot.sessions[0].title = "P6 Session A";
    fixture.snapshot.sessions.push({
      id: "fixture-p6-b",
      workspaceId: "fixture-w",
      title: "P6 Session B",
      status: "idle",
    });
    fixture.sessionMessages = new Map(
      ["fixture-s", "fixture-p6-b"].map((id, index) => [
        id,
        Array.from({ length: 24 }, (_, n) => ({
          id: `p6-${index}-${n}`,
          role: n % 2 ? "assistant" : "user",
          text: `P6_MARKER_${index ? "B" : "A"} synthetic row ${n}`,
          tools: [],
        })),
      ]),
    );
  };
  // Opt-in per-turn revert state (state only, no file IO). Hiding is by position
  // (the boundary and everything after it), like Native's seq order.
  // `fixture.nextRevert`: undefined | "denied" (native dialog refused) | "unknown".
  // `fixture.revertFilesRestored = false` simulates a non-git folder.
  fixture.enableRevert = () => {
    fixture.sessionRevert = new Map();
    fixture.revertFilesRestored = true;
    fixture.nextRevert = undefined;
    const rows = Array.from({ length: 6 }, (_, n) => ({
      id: `revert-m${n + 1}`,
      role: n % 2 ? "assistant" : "user",
      text:
        n % 2
          ? `SYNTHETIC revert answer ${n + 1}`
          : `SYNTHETIC revert prompt ${n + 1}`,
      tools: [],
    }));
    fixture.sessionMessages = new Map([["fixture-s", rows]]);
  };
  fixture.setStorageState = (name) => applyStorageState(fixture, name);
  fixture.setConfigurationState = (name) =>
    applyConfigurationState(fixture, name);
  validateSnapshot(fixture.snapshot);
  return fixture;
}

export const RUNTIME_OPTIONS_UI_STATES = Object.freeze([
  "supported",
  "missing",
  "malformed",
  "duplicate",
  "removed",
  "absent",
  "failed",
  "historical",
  "unknown",
  "running",
]);
export const RUNTIME_OPTIONS_RETAINED_KEY = Object.freeze({
  runtimeEpoch: "fixture-original-runtime-epoch",
  operationId: "fixture-original-runtime-send",
  type: "message.send",
  workspaceId: "fixture-w",
  sessionId: "fixture-s",
});

export function applyRuntimeOptionsState(fixture, name) {
  if (!RUNTIME_OPTIONS_UI_STATES.includes(name))
    throw new Error("Unknown closed runtime options fixture state");
  if (fixture.heldRuntimeReads?.length || fixture.heldSendAcks.length)
    throw new Error("Release synthetic runtime IO before changing scenario");
  fixture.runtimeOptionsState = name;
  fixture.holdRuntimeReads = false;
  fixture.heldRuntimeReads = [];
  fixture.runtimeReads = [];
  fixture.runtimeSessionObservations = new Map();
  const snapshot = fixture.snapshot;
  snapshot.selectedWorkspaceId = "fixture-w";
  snapshot.selectedSessionId = "fixture-s";
  snapshot.state = "connected";
  snapshot.recovery = { store: { state: "ready" }, resources: [] };
  snapshot.permissions = [];
  snapshot.retainedOperations = [];
  delete snapshot.sessionSelection;
  snapshot.workspaces = [
    {
      id: "fixture-w",
      name: "SYNTHETIC runtime workspace",
      path: "/synthetic/runtime-workspace",
      kind: "folder",
      trusted: true,
      trustRevision: 1,
      temporary: name !== "unknown",
    },
  ];
  snapshot.temporary = name !== "unknown";
  snapshot.sessions = [
    {
      id: "fixture-s",
      workspaceId: "fixture-w",
      title: "Runtime Session A",
      status: name === "running" ? "running" : "idle",
    },
    {
      id: "fixture-runtime-b",
      workspaceId: "fixture-w",
      title: "Runtime Session B",
      status: "idle",
    },
  ];
  const scope = {
    workspaceId: "fixture-w",
    sessionId: "fixture-s",
    agent: "request-agent",
    model: "fixture-request-model",
    variant: "custom/opaque:α + 7",
  };
  // SDK-shaped synthetic source. Actual frozen helper owns closed projection.
  const nativeModel = {
    variants: [
      { id: scope.variant, settings: { token: "PRIVATE_RUNTIME_CANARY" } },
      { id: "vendor.mode#2" },
    ],
    capabilities: {
      tools: true,
      input: ["text", "vendor/blob"],
      output: ["text"],
      private: "PRIVATE_RUNTIME_CANARY",
    },
    headers: { authorization: "PRIVATE_RUNTIME_CANARY" },
    body: { token: "PRIVATE_RUNTIME_CANARY" },
  };
  if (name === "missing") delete nativeModel.variants;
  if (name === "malformed") nativeModel.variants = [{ id: "invalid\nvariant" }];
  if (name === "duplicate")
    nativeModel.variants = [{ id: scope.variant }, { id: scope.variant }];
  if (name === "removed") nativeModel.variants = [{ id: "vendor.mode#2" }];
  fixture.catalog.agents = {
    status: "available",
    entries: [{ id: scope.agent, name: "SYNTHETIC request Agent" }],
  };
  fixture.catalog.models = {
    status: "available",
    entries: [
      {
        id: scope.model,
        name: "SYNTHETIC request model",
        ...projectModelOptions(nativeModel),
      },
      {
        id: "fixture-other-model",
        name: "SYNTHETIC other model",
        ...projectModelOptions({ variants: [{ id: "other.variant" }] }),
      },
    ],
  };
  fixture.setRuntimeSessionObservation(
    "fixture-s",
    {
      agent: "session-agent",
      model: {
        providerID: "synthetic",
        id: "session-model",
        variant: "session.variant",
        credentials: "PRIVATE_RUNTIME_CANARY",
      },
      settings: { token: "PRIVATE_RUNTIME_CANARY" },
    },
    ["absent", "failed"].includes(name) ? name : "current",
  );
  fixture.setRuntimeSessionObservation("fixture-runtime-b", {
    agent: "other-session-agent",
    model: { providerID: "synthetic", id: "other-session-model" },
  });
  const runtime = projectAssistantRuntime({
    type: "assistant",
    agent: "response-agent",
    model: {
      providerID: "synthetic",
      id: name === "historical" ? "removed-response-model" : "response-model",
      variant: "response.variant",
      headers: { token: "PRIVATE_RUNTIME_CANARY" },
    },
  });
  const message = {
    id: "runtime-response-a",
    role: "assistant",
    text: "SYNTHETIC runtime response A",
    tools: [],
    ...(name !== "absent" && { runtime }),
  };
  fixture.sessionMessages = new Map([
    ["fixture-s", [message]],
    [
      "fixture-runtime-b",
      [
        {
          id: "runtime-response-b",
          role: "assistant",
          text: "SYNTHETIC runtime response B",
          tools: [],
        },
      ],
    ],
  ]);
  snapshot.messages = clone(fixture.sessionMessages.get("fixture-s"));
  fixture.retainedReceipts.clear();
  if (name === "unknown") {
    snapshot.sessions[0].status = "unknown";
    const receipt = {
      ...RUNTIME_OPTIONS_RETAINED_KEY,
      admission: "dispatched",
      delivery: "unknown",
      effect: "unknown",
      revision: snapshot.revision,
      evidence: [],
    };
    fixture.retainedReceipts.set(
      JSON.stringify([receipt.runtimeEpoch, receipt.operationId]),
      { digest: "synthetic-original-no-payload", receipt },
    );
    snapshot.retainedOperations = [
      { ...RUNTIME_OPTIONS_RETAINED_KEY, authorityHold: true },
    ];
  }
  snapshot.revision++;
  snapshot.observationSequence++;
  validateSnapshot(snapshot);
  return clone(scope);
}

// Explicit memory-only producers. These maps prove neither checked OS byte IO
// nor registry flush/journal persistence, Native admission or provider execution.
export const CONVERSATION_CONTEXT_UI_STATES = Object.freeze([
  "ready",
  "selection",
  "image",
  "pdf",
  "expired",
  "missing",
  "denied",
  "protected",
  "oversized",
  "changed",
  "unsupported",
  "unsupported-model",
  "missing-capabilities",
  "running",
  "queued",
  "unknown",
  "pending-read",
  "pending-prompt",
  "pending-fork",
  "pending-cancel",
  "held",
  "global-held",
  "untrusted",
]);
export const CONTEXT_RETAINED_KEY = Object.freeze({
  runtimeEpoch: "fixture-original-context-epoch",
  operationId: "fixture-original-context-send",
  type: "message.send",
  workspaceId: "fixture-w",
  sessionId: "fixture-s",
});
const contextHash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function applyConversationContextState(fixture, name) {
  if (!CONVERSATION_CONTEXT_UI_STATES.includes(name))
    throw Error("Unknown closed Context fixture state");
  if (fixture.pendingContextIO?.size)
    throw Error("Release owned synthetic Context IO before changing scenario");
  const scope = fixture.setRuntimeOptionsState("supported");
  fixture.conversationContextState = name;
  fixture.contextGeneration = (fixture.contextGeneration ?? 0) + 1;
  fixture.contextSerial ??= 0;
  fixture.contextNow = 0;
  fixture.contextReads = [];
  fixture.inboxReads = [];
  fixture.contextEffects = [];
  fixture.contextPolicySteps = [];
  fixture.contextAcknowledgements = [];
  fixture.nextContextAck = undefined;
  fixture.contextForks = new Map();
  fixture.syntheticContextFiles = new Map();
  fixture.syntheticContextCapabilities = new Map();
  fixture.syntheticContextInbox = new Map();
  fixture.pendingContextIO = new Set();
  for (const kind of ["Read", "Prompt", "Fork", "Cancel"]) {
    fixture[`holdContext${kind}`] = name === `pending-${kind.toLowerCase()}`;
    fixture[`heldContext${kind}s`] = [];
    fixture[`context${kind}Completions`] = [];
    fixture[`confirmContext${kind}s`] = () => {
      for (const complete of fixture[`context${kind}Completions`].splice(0))
        complete();
    };
    fixture[`releaseContext${kind}s`] = () => {
      fixture[`holdContext${kind}`] = false;
      for (const release of fixture[`heldContext${kind}s`].splice(0)) release();
    };
  }
  fixture.advanceContextTime = (ms) => {
    if (!Number.isSafeInteger(ms) || ms < 0)
      throw Error("Invalid synthetic clock");
    fixture.contextNow += ms;
  };
  fixture.expireContextCapabilities = () =>
    fixture.advanceContextTime(CONTEXT_LIMITS.idleMs);
  fixture.nextContextOutcome = name === "unknown" ? "unknown" : undefined;
  const snapshot = fixture.snapshot;
  snapshot.temporary = false;
  snapshot.workspaces[0].temporary = false;
  snapshot.workspaces[0].path =
    "/synthetic/context-workspace/" + "selectable-source-root-".repeat(4);
  snapshot.workspaces[0].trusted = name !== "untrusted";
  snapshot.sessions[0].status = [
    "running",
    "queued",
    "pending-cancel",
  ].includes(name)
    ? "running"
    : "idle";
  const text = "\ufeffSYNTHETIC captured text\r\nSecond line.  \r\n";
  const mime =
    name === "image"
      ? "image/png"
      : name === "pdf"
        ? "application/pdf"
        : "text/plain";
  const path =
    name === "protected"
      ? "AGENTS.md"
      : `notes/SYNTHETIC-${"captured-source-".repeat(3)}${mime === "image/png" ? "image.png" : mime === "application/pdf" ? "document.pdf" : "text.txt"}`;
  // Known synthetic bytes and declared MIME; no production classifier claim.
  const bytes =
    mime === "image/png"
      ? Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
          "base64",
        )
      : Buffer.from(
          mime === "application/pdf"
            ? "%PDF-1.4\n% SYNTHETIC metadata only\n%%EOF\n"
            : text,
        );
  fixture.syntheticContextFiles.set(path, { syntheticOnly: true, bytes, mime });
  const otherPath = "notes/SYNTHETIC-other.txt";
  fixture.syntheticContextFiles.set(otherPath, {
    syntheticOnly: true,
    bytes: Buffer.from("SYNTHETIC other\n"),
    mime: "text/plain",
  });
  const reasons = {
    missing: "missing_file",
    denied: "path_denied",
    protected: "protected_source",
    oversized: "too_large",
    changed: "file_changed",
    unsupported: "unsupported_content",
  };
  fixture.syntheticContextFiles.get(path).reason = reasons[name];
  const options = fixture.catalog.models.entries[0];
  options.capabilities.input =
    name === "unsupported-model" ? [] : ["text/plain", "image/png", "pdf"];
  if (name === "missing-capabilities") delete options.capabilities;
  const userMessageId = "context-user";
  fixture.sessionMessages.set(scope.sessionId, [
    {
      id: userMessageId,
      role: "user",
      text: "SYNTHETIC historical user request",
      tools: [],
      context: { status: "unavailable", count: 1 },
    },
    {
      id: "context-response",
      role: "assistant",
      text: "SYNTHETIC response, no provider execution",
      tools: [],
    },
  ]);
  snapshot.messages = clone(fixture.sessionMessages.get(scope.sessionId));
  const inboxId = "fixture-context-inbox-original";
  fixture.syntheticContextInbox.set(
    scope.sessionId,
    ["queued", "pending-cancel"].includes(name)
      ? [
          {
            id: inboxId,
            delivery: "queue",
            textPreview: "SYNTHETIC queued instruction",
            textTruncated: false,
            attachmentCount: 0,
          },
        ]
      : [],
  );
  if (["unknown", "held"].includes(name)) {
    const receipt = {
      ...CONTEXT_RETAINED_KEY,
      admission: "dispatched",
      delivery: "unknown",
      effect: "unknown",
      revision: snapshot.revision,
      evidence: [],
    };
    fixture.retainedReceipts.set(
      JSON.stringify([receipt.runtimeEpoch, receipt.operationId]),
      { digest: contextHash("synthetic-original-no-replay"), receipt },
    );
    snapshot.retainedOperations = [
      { ...CONTEXT_RETAINED_KEY, authorityHold: true },
    ];
    snapshot.sessions[0].status = "unknown";
    if (name === "held")
      snapshot.recovery.resources = [
        {
          workspaceId: scope.workspaceId,
          state: "unavailable",
          reason: "unresolved_operation",
        },
      ];
  }
  if (name === "global-held") {
    snapshot.recovery.store = {
      state: "recovery_required",
      reason: "corrupt_journal",
    };
    snapshot.state = "unavailable";
    snapshot.messages = [];
    snapshot.permissions = [];
  }
  validateSnapshot(snapshot);
  return {
    ...scope,
    workspacePath: snapshot.workspaces[0].path,
    path,
    otherPath,
    text,
    userMessageId,
    inboxId,
    selection: { version: contextHash(bytes), start: 1, end: 24 },
  };
}
function contextAuthority(fixture, workspace, sender) {
  return {
    sender,
    runtimeEpoch: fixture.snapshot.runtimeEpoch,
    workspaceId: workspace.id,
    workspacePath: workspace.path,
    trustRevision: workspace.trustRevision,
    generation: fixture.contextGeneration,
  };
}
function contextBlocked(fixture, request) {
  const workspace = fixture.snapshot.workspaces.find(
    (w) => w.id === request.workspaceId,
  );
  if (!workspace) return "NOT_FOUND";
  if (!workspace.trusted) return "INVALID_SELECTION";
  if (
    fixture.snapshot.state !== "connected" ||
    fixture.snapshot.recovery.store.state !== "ready" ||
    fixture.snapshot.recovery.resources.some(
      (r) => r.workspaceId === workspace.id,
    )
  )
    return "UNAVAILABLE";
  if (
    fixture.pendingContextIO.size ||
    fixture.pendingWorkspaceFiles.size ||
    fixture.pendingGitIndexWorkspaces.size ||
    fixture.pendingGitCommitWorkspaces.size ||
    fixture.pendingGitBranchRestoreWorkspaces.size ||
    fixture.pendingAgentWorkspaces.size ||
    fixture.pendingMcpWorkspaces.size ||
    fixture.pendingSkillWorkspaces.size
  )
    return "BUSY";
  if (request.sessionId) {
    const session = fixture.snapshot.sessions.find(
      (s) => s.id === request.sessionId && s.workspaceId === workspace.id,
    );
    if (!session) return "NOT_FOUND";
    if (session.archived) return "ARCHIVED_SESSION";
    if (["unknown", "unavailable"].includes(session.status)) return "BUSY";
  }
}
function readContextFixture(fixture, request, sender) {
  if (!fixture.conversationContextState) return failure("UNAVAILABLE");
  const blocked = contextBlocked(fixture, request);
  if (blocked) return failure(blocked);
  const workspace = fixture.snapshot.workspaces.find(
    (w) => w.id === request.workspaceId,
  );
  const authority = contextAuthority(fixture, workspace, sender);
  const revision = fixture.snapshot.revision;
  let value;
  if (request.type === "session.inbox")
    value = validateInboxObservation({
      runtimeEpoch: authority.runtimeEpoch,
      revision,
      workspaceId: workspace.id,
      sessionId: request.sessionId,
      entries: clone(
        fixture.syntheticContextInbox.get(request.sessionId) ?? [],
      ),
      otherCount: 0,
    });
  else {
    const base = {
      runtimeEpoch: authority.runtimeEpoch,
      revision,
      workspaceId: workspace.id,
      workspacePath: workspace.path,
      path: request.path,
    };
    const source = fixture.syntheticContextFiles.get(request.path);
    const reason =
      workspaceFilePathReason(request.path) ??
      source?.reason ??
      (!source ? "missing_file" : undefined);
    let refused = reason;
    const bytes = source?.bytes;
    if (
      request.selection &&
      (!bytes ||
        request.selection.version !== contextHash(bytes) ||
        request.selection.end > bytes.toString("utf8").length)
    )
      refused = "selection_changed";
    if (refused)
      value = {
        ...base,
        status: [
          "protected_source",
          "too_large",
          "unsupported_content",
        ].includes(refused)
          ? "unsupported"
          : "unavailable",
        reason: refused,
      };
    else {
      if (
        fixture.syntheticContextCapabilities.size >=
          CONTEXT_LIMITS.cacheEntries ||
        [...fixture.syntheticContextCapabilities.values()].reduce(
          (n, c) => n + c.bytes.length,
          0,
        ) +
          bytes.length >
          CONTEXT_LIMITS.cacheBytes
      )
        value = { ...base, status: "unavailable", reason: "capacity_exceeded" };
      else {
        const captured = request.selection
          ? Buffer.from(
              bytes
                .toString("utf8")
                .slice(request.selection.start, request.selection.end),
            )
          : Buffer.from(bytes);
        const descriptor = {
          capabilityId: `synthetic-context-cap-${++fixture.contextSerial}`,
          workspaceId: workspace.id,
          workspacePath: workspace.path,
          path: request.path,
          name: request.path.split("/").at(-1),
          source: request.selection ? "selection" : "file",
          version: contextHash(bytes),
          digest: contextHash(captured),
          mime: source.mime,
          size: captured.length,
          ...(request.selection && {
            range: {
              start: request.selection.start,
              end: request.selection.end,
            },
          }),
        };
        const preview =
          source.mime === "text/plain"
            ? { kind: "text", text: captured.toString("utf8") }
            : source.mime === "application/pdf"
              ? { kind: "pdf" }
              : {
                  kind: "image",
                  dataUrl: `data:${source.mime};base64,${captured.toString("base64")}`,
                };
        value = validateContextObservation({
          ...base,
          status: "available",
          descriptor,
          preview,
        });
        fixture.syntheticContextCapabilities.set(descriptor.capabilityId, {
          syntheticOnly: true,
          authority,
          descriptor: clone(descriptor),
          bytes: captured,
          at: fixture.contextNow,
          pins: 0,
        });
        if (fixture.conversationContextState === "expired")
          fixture.expireContextCapabilities();
      }
    }
    value = validateContextObservation(value);
  }
  const finish = () => {
    const current = fixture.snapshot.workspaces.find(
      (w) => w.id === workspace.id,
    );
    return current &&
      current.trusted &&
      fixture.snapshot.state === "connected" &&
      fixture.snapshot.recovery.store.state === "ready" &&
      !fixture.snapshot.recovery.resources.some(
        (r) => r.workspaceId === workspace.id,
      ) &&
      isDeepStrictEqual(
        authority,
        contextAuthority(fixture, current, sender),
      ) &&
      fixture.snapshot.revision === revision
      ? { ok: true, value: clone(value) }
      : failure("STALE");
  };
  if (!fixture.holdContextRead) return finish();
  const token = {};
  fixture.pendingContextIO.add(token);
  return new Promise((resolve) =>
    fixture.heldContextReads.push(() => {
      fixture.pendingContextIO.delete(token);
      resolve(finish());
    }),
  );
}

function runtimeSnapshot(fixture, value) {
  if (!fixture.runtimeOptionsState) return value;
  delete value.sessionSelection;
  const observation = fixture.runtimeSessionObservations.get(
    value.selectedSessionId,
  );
  const selection =
    observation?.outcome === "current"
      ? projectSessionSelection(observation.info, value.selectedSessionId)
      : undefined;
  if (
    selection &&
    value.state === "connected" &&
    value.recovery.store.state === "ready" &&
    value.workspaces.some(
      (w) => w.id === value.selectedWorkspaceId && w.trusted,
    ) &&
    value.sessions.some(
      (s) => s.id === value.selectedSessionId && s.status !== "unavailable",
    ) &&
    !value.recovery.resources.some(
      (r) =>
        r.workspaceId === value.selectedWorkspaceId &&
        (!r.sessionId || r.sessionId === value.selectedSessionId),
    )
  )
    value.sessionSelection = selection;
  return value;
}

// Synthetic in-memory bytes and ancestry identities only. This does not model
// descriptor IO, publication, journal persistence or OS permission enforcement.
export const WORKSPACE_FILE_UI_STATES = Object.freeze([
  "ready",
  "blank",
  "limit",
  "missing",
  "denied",
  "unsupported",
  "oversize",
  "protected",
  "external-changed",
  "save-denied",
  "unknown",
  "pending-read",
  "pending-save",
  "held",
  "untrusted",
  "restored-original",
]);
export const WORKSPACE_FILE_RETAINED_KEY = Object.freeze({
  runtimeEpoch: "fixture-original-file-epoch",
  operationId: "fixture-original-file-save",
  type: "file.save",
  workspaceId: "fixture-w",
});
const workspaceFileHash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const workspaceFileAdmissionDigest = (request, floor) => {
  const admitted = { ...request, expectedRevision: floor ?? null };
  return workspaceFileHash(
    Object.keys(admitted)
      .sort()
      .map((k) => [k, admitted[k]]),
  );
};
export function applyWorkspaceFileState(fixture, name) {
  if (!WORKSPACE_FILE_UI_STATES.includes(name))
    throw new Error("Unknown closed workspace file fixture state");
  fixture.setConfigurationState("normal");
  fixture.extensionsState = fixture.agentState = fixture.skillState = undefined;
  fixture.workspaceFileState = name;
  fixture.requests = [];
  fixture.intents = [];
  fixture.lookups = [];
  fixture.lookupEnvelopes = [];
  fixture.workspaceFileReads = [];
  fixture.workspaceFilePreviews = [];
  for (const map of [
    fixture.workspaceFiles,
    fixture.workspaceFileDirectories,
    fixture.workspaceFileBackups,
    fixture.workspaceFileReadOutcomes,
  ])
    map.clear();
  fixture.pendingWorkspaceFiles.clear();
  fixture.holdWorkspaceFileReads = name === "pending-read";
  fixture.holdWorkspaceFileSave = name === "pending-save";
  fixture.heldWorkspaceFileReads = [];
  fixture.heldWorkspaceFileSaves = [];
  fixture.workspaceFileCompletions = [];
  fixture.nextWorkspaceFileSave = [
    "unknown",
    "external-changed",
    "save-denied",
  ].includes(name)
    ? name
    : undefined;
  const workspace = fixture.snapshot.workspaces[0];
  workspace.path =
    "/synthetic/workspace-file/" + "selectable-full-root-".repeat(6);
  workspace.trusted = name !== "untrusted";
  const path =
    name === "protected" ? "AGENTS.md" : "notes/SYNTHETIC-editor.txt";
  const otherPath = "notes/SYNTHETIC-other.txt";
  const text =
    name === "blank"
      ? ""
      : name === "limit"
        ? "x".repeat(WORKSPACE_FILE_LIMITS.bytes)
        : "\uFEFFSYNTHETIC TEXT\r\n\r\nExact whitespace.  \r\n";
  for (const [file, content] of [
    [path, text],
    [otherPath, "SYNTHETIC OTHER\n"],
    // The host refuses ":" paths for editing; the explorer still previews them.
    ["notes/odd:name.txt", "SYNTHETIC REFUSED PATH\n"],
  ]) {
    const key = fixture.workspaceFileKey(workspace.id, file);
    fixture.workspaceFiles.set(key, content);
    fixture.workspaceFileDirectories.set(
      key,
      "synthetic-root-and-all-parents-v1",
    );
  }
  const key = fixture.workspaceFileKey(workspace.id, path);
  if (name === "missing") fixture.workspaceFiles.delete(key);
  if (name === "denied")
    fixture.workspaceFileReadOutcomes.set(key, "path_denied");
  if (name === "unsupported")
    fixture.workspaceFiles.set(key, "SYNTHETIC\u0000BINARY");
  if (name === "oversize")
    fixture.workspaceFiles.set(
      key,
      "x".repeat(WORKSPACE_FILE_LIMITS.bytes + 1),
    );
  if (["held", "restored-original"].includes(name)) {
    const receipt = {
      ...WORKSPACE_FILE_RETAINED_KEY,
      admission: "dispatched",
      delivery: "unknown",
      effect: "unknown",
      revision: fixture.snapshot.revision,
      evidence: [],
    };
    fixture.retainedReceipts.set(
      JSON.stringify([receipt.runtimeEpoch, receipt.operationId]),
      { digest: "synthetic-unresendable-original", receipt },
    );
    fixture.snapshot.retainedOperations = [
      { ...WORKSPACE_FILE_RETAINED_KEY, authorityHold: true },
    ];
    fixture.snapshot.recovery.resources = [
      {
        workspaceId: workspace.id,
        state: "unavailable",
        reason: "unresolved_operation",
      },
    ];
  }
  validateSnapshot(fixture.snapshot);
  return {
    workspaceId: workspace.id,
    workspacePath: workspace.path,
    path,
    otherPath,
    text,
  };
}
function observeWorkspaceFile(fixture, workspace, path) {
  const base = {
    runtimeEpoch: fixture.snapshot.runtimeEpoch,
    revision: fixture.snapshot.revision,
    workspaceId: workspace.id,
    workspacePath: workspace.path,
    path,
    targetPath: workspaceFileTargetPath(workspace.path, path),
  };
  const key = fixture.workspaceFileKey(workspace.id, path);
  const content = fixture.workspaceFiles.get(key);
  const protectedSource = workspaceFilePathReason(path);
  const reason =
    protectedSource ??
    fixture.workspaceFileReadOutcomes.get(key) ??
    (!fixture.workspaceFileDirectories.has(key)
      ? "path_missing"
      : content === undefined
        ? "missing_file"
        : undefined);
  let value;
  if (reason)
    value = {
      ...base,
      status: protectedSource ? "unsupported" : "unavailable",
      reason,
    };
  else {
    const validation = validateWorkspaceFileText(content);
    if (validation.status === "invalid")
      value = { ...base, status: "unsupported", reason: validation.issues[0] };
    else {
      const directoryVersion = workspaceFileHash([
        workspace.id,
        workspace.path,
        path,
        fixture.workspaceFileDirectories.get(key),
      ]);
      value = {
        ...base,
        status: "available",
        content,
        directoryVersion,
        version: workspaceFileHash([key, directoryVersion, content]),
      };
    }
  }
  const observation = validateWorkspaceFileObservation(value);
  fixture.lastWorkspaceFileObservation = clone(observation);
  return observation;
}

// Producer conditions only. The renderer must start fresh and explicitly read;
// none of these states installs observations/errors in its window store.
export const EXTENSIONS_UI_STATES = Object.freeze([
  "not-observed",
  "populated",
  "empty",
  "plugins-unavailable",
  "tools-unavailable",
  "unavailable",
  "invalid-response",
  "limit-reached",
  "unsupported-source",
  "pending",
  "cancel",
  "escape",
  "late-workspace",
  "late-epoch",
  "late-floor",
  "stale",
  "held",
  "untrusted",
  "disconnected",
  "snapshot-required",
]);
export function applyExtensionsState(fixture, name) {
  if (!EXTENSIONS_UI_STATES.includes(name))
    throw new Error("Unknown closed Extensions fixture state");
  // Retire pending producer work before resetting its scope. Old replies can
  // settle their old transport slots, but cannot become a new state's reply.
  fixture.extensionGeneration++;
  fixture.releaseExtensionReads();
  const previous = fixture.snapshot.sessions.find((s) => s.id === "fixture-s");
  if (previous) delete previous.parentSessionId;
  fixture.snapshot.runtimeEpoch = "fixture-runtime-v2";
  fixture.setConfigurationState("normal");
  fixture.extensionsState = name;
  fixture.extensionReads = [];
  fixture.requests = [];
  fixture.intents = [];
  fixture.lookups = [];
  fixture.lookupEnvelopes = [];
  const snapshot = fixture.snapshot;
  const workspace = snapshot.workspaces[0];
  workspace.path = `/synthetic/extensions-workspace/${"selectable-full-path-".repeat(5)}`;
  workspace.trusted = name !== "untrusted";
  snapshot.state = name === "disconnected" ? "disconnected" : "connected";
  snapshot.sessions[0].status =
    name === "snapshot-required" ? "running" : "idle";
  // Keep discovered metadata distinct from Native-reported source metadata.
  fixture.catalog.configuration.entries[0].path = `${workspace.path}/AGENTS.md`;
  const plugins = [
    {
      id: "fixture-local-plugin",
      state: { status: "active" },
      source: {
        type: "local",
        path: `${workspace.path}/plugins/full-source.mjs`,
      },
      features: { server: true, rpc: true },
    },
    {
      id: "fixture-failed-package",
      state: {
        status: "failed",
        error: "SYNTHETIC_PRIVATE_FAILURE",
        ref: "SYNTHETIC_PRIVATE_REF",
      },
      source: { type: "package", target: "@fixture/observer@1.2.3" },
      features: {},
    },
    {
      id: "fixture-builtin-plugin",
      state: { status: "active" },
      source: { type: "builtin" },
      features: {},
    },
    {
      id: "fixture-sdk-plugin",
      state: { status: "active" },
      source: { type: "sdk" },
      features: {},
    },
  ];
  const tools = [
    {
      id: "fixture-registry-tool",
      name: "합성 등록 도구",
      input: { secret: "SYNTHETIC_PRIVATE_INPUT" },
      description: "SYNTHETIC_PRIVATE_DESCRIPTION",
    },
  ];
  if (name === "unsupported-source") {
    plugins[0].source.path = "relative/SYNTHETIC_PRIVATE_PATH";
    plugins[1].source.target =
      "https://user:SYNTHETIC_PRIVATE_TOKEN@example.invalid/plugin";
  }
  fixture.extensionRaw = {
    plugins:
      name === "empty"
        ? []
        : name === "invalid-response"
          ? [plugins[0], plugins[0]]
          : name === "limit-reached"
            ? Array.from({ length: EXTENSIONS_LIMITS.plugins + 1 }, (_, n) => ({
                ...plugins[0],
                id: `plugin-${n}`,
              }))
            : plugins,
    tools:
      name === "empty"
        ? []
        : name === "invalid-response"
          ? [{ name: "missing-id" }]
          : name === "limit-reached"
            ? Array.from({ length: EXTENSIONS_LIMITS.tools + 1 }, (_, n) => ({
                id: `tool-${n}`,
                name: "Bounded tool",
              }))
            : tools,
  };
  fixture.holdExtensionReads = [
    "pending",
    "cancel",
    "escape",
    "late-workspace",
    "late-epoch",
    "late-floor",
  ].includes(name);
  if (name === "late-workspace") {
    snapshot.workspaces.push({
      ...workspace,
      id: "fixture-extensions-other-w",
      name: "다른 확장 작업 공간",
      path: "/synthetic/extensions-other-workspace",
    });
    snapshot.sessions.push({
      id: "fixture-extensions-other-s",
      workspaceId: "fixture-extensions-other-w",
      title: "다른 작업 공간 세션",
      status: "idle",
    });
  }
  if (name === "held") {
    const receipt = {
      ...P7_RETAINED_KEY,
      admission: "dispatched",
      delivery: "unknown",
      effect: "unknown",
      revision: snapshot.revision,
      evidence: [],
    };
    fixture.retainedReceipts.set(
      JSON.stringify([receipt.runtimeEpoch, receipt.operationId]),
      { digest: "synthetic-retained-unresendable", receipt },
    );
    snapshot.retainedOperations = [{ ...P7_RETAINED_KEY, authorityHold: true }];
    snapshot.recovery.resources = [
      {
        workspaceId: workspace.id,
        state: "unavailable",
        reason: "unresolved_operation",
      },
    ];
  }
  fixture.sessionMessages = new Map(snapshot.sessions.map((s) => [s.id, []]));
  validateSnapshot(snapshot);
  return {
    workspaceId: workspace.id,
    workspacePath: workspace.path,
    pluginPath: `${workspace.path}/plugins/full-source.mjs`,
  };
}

function extensionFixtureHeld(fixture, workspaceId) {
  return (
    fixture.snapshot.recovery.store.state !== "ready" ||
    fixture.snapshot.recovery.resources.some(
      (r) => r.workspaceId === workspaceId,
    ) ||
    [...fixture.retainedReceipts.values()].some(
      ({ receipt }) =>
        ["pending", "unknown"].includes(receipt.effect) &&
        (!receipt.workspaceId || receipt.workspaceId === workspaceId),
    )
  );
}

export const PERMISSION_POLICY_UI_STATES = Object.freeze([
  "baseline",
  "absent",
  "empty",
  "mismatch",
  "ordered",
  "unavailable",
  "long-values",
  "pending",
  "held",
  "untrusted",
  "mapping-mismatch",
  "disconnected",
]);
function syntheticPolicyRecord(
  fixture,
  session,
  nativeSession = { permissions: clone(BASELINE_POLICY) },
) {
  const workspace = fixture.snapshot.workspaces.find(
    (w) => w.id === session.workspaceId,
  );
  return {
    syntheticOnly: true,
    runtimeEpoch: fixture.snapshot.runtimeEpoch,
    workspaceId: session.workspaceId,
    workspacePath: workspace?.path,
    sessionId: session.id,
    mapped: true,
    nativeSession,
  };
}
export function applyPermissionPolicyState(fixture, name) {
  if (!PERMISSION_POLICY_UI_STATES.includes(name))
    throw new Error("Unknown synthetic permission policy state");
  if (fixture.heldPermissionPolicyReads.length)
    throw new Error(
      "Release synthetic permission policy reads before resetting state",
    );
  // Restore only flags this setter owns. Keep current selection, roots and clocks.
  fixture.restorePermissionPolicyFlags?.();
  const snapshot = fixture.snapshot;
  const workspace = snapshot.workspaces.find(
    (w) => w.id === snapshot.selectedWorkspaceId,
  );
  const session = snapshot.sessions.find(
    (s) =>
      s.id === snapshot.selectedSessionId && s.workspaceId === workspace?.id,
  );
  if (!workspace || !session)
    throw new Error("Current synthetic selected scope required");
  const prior = {
    trusted: workspace.trusted,
    state: snapshot.state,
    recovery: clone(snapshot.recovery),
  };
  fixture.restorePermissionPolicyFlags = () => {
    workspace.trusted = prior.trusted;
    snapshot.state = prior.state;
    snapshot.recovery = clone(prior.recovery);
  };
  fixture.permissionPolicyGeneration++;
  fixture.permissionPolicyState = name;
  fixture.permissionPolicyReads = [];
  fixture.permissionPolicyIO = [];
  fixture.syntheticPermissionPolicies.clear();
  fixture.holdPermissionPolicyReads = name === "pending";
  let nativeSession = { permissions: clone(BASELINE_POLICY) };
  if (name === "absent") nativeSession = {};
  if (name === "empty") nativeSession = { permissions: [] };
  if (name === "unavailable")
    nativeSession = { permissions: "SYNTHETIC invalid rules" };
  if (name === "mismatch")
    nativeSession = {
      permissions: [
        { action: "SYNTHETIC.read", resource: "notes/*", effect: "ask" },
      ],
    };
  if (name === "ordered")
    nativeSession = {
      permissions: ["deny", "allow", "deny"].map((effect) => ({
        action: "SYNTHETIC.read",
        resource: "notes/*",
        effect,
      })),
    };
  if (name === "long-values")
    nativeSession = {
      permissions: [
        {
          action: "SYNTHETIC.action." + "a".repeat(111),
          resource: "SYNTHETIC/" + "r".repeat(2038),
          effect: "ask",
        },
      ],
    };
  for (const s of snapshot.sessions)
    fixture.syntheticPermissionPolicies.set(
      s.id,
      syntheticPolicyRecord(fixture, s, clone(nativeSession)),
    );
  if (name === "mapping-mismatch")
    fixture.syntheticPermissionPolicies.get(session.id).workspacePath +=
      "/wrong";
  if (name === "held")
    snapshot.recovery.resources.push({
      workspaceId: workspace.id,
      state: "unavailable",
      reason: "unresolved_operation",
    });
  if (name === "untrusted") workspace.trusted = false;
  if (name === "disconnected") snapshot.state = "disconnected";
  validateSnapshot(snapshot);
  return {
    workspaceId: workspace.id,
    workspacePath: workspace.path,
    sessionId: session.id,
  };
}
function readPermissionPolicyFixture(fixture, request) {
  const snapshot = fixture.snapshot;
  const workspace = snapshot.workspaces.find(
    (w) => w.id === request.workspaceId,
  );
  const session = snapshot.sessions.find(
    (s) => s.id === request.sessionId && s.workspaceId === workspace?.id,
  );
  if (!workspace || !session) return failure("NOT_FOUND");
  if (
    snapshot.state !== "connected" ||
    extensionFixtureHeld(fixture, workspace.id)
  )
    return failure("UNAVAILABLE");
  if (
    !workspace.trusted ||
    snapshot.selectedWorkspaceId !== workspace.id ||
    snapshot.selectedSessionId !== session.id
  )
    return failure("INVALID_SELECTION");
  let record = fixture.syntheticPermissionPolicies.get(session.id);
  if (!record && !fixture.permissionPolicyState) {
    record = syntheticPolicyRecord(fixture, session);
    fixture.syntheticPermissionPolicies.set(session.id, record);
  }
  const scope = {
    runtimeEpoch: snapshot.runtimeEpoch,
    revision: snapshot.revision,
    workspaceId: workspace.id,
    workspacePath: workspace.path,
    sessionId: session.id,
  };
  if (
    !record ||
    !record.syntheticOnly ||
    !record.mapped ||
    record.runtimeEpoch !== scope.runtimeEpoch ||
    record.workspaceId !== workspace.id ||
    record.workspacePath !== workspace.path ||
    record.sessionId !== session.id
  )
    return failure("INVALID_SELECTION");
  const generation = fixture.permissionPolicyGeneration;
  const trustRevision = workspace.trustRevision;
  fixture.permissionPolicyIO.push({ syntheticOnly: true, ...clone(scope) });
  const value = validatePermissionPolicyObservation(
    projectPermissionPolicy(scope, record.nativeSession),
  );
  const complete = () => {
    const current = fixture.snapshot.workspaces.find(
      (w) => w.id === scope.workspaceId,
    );
    return fixture.permissionPolicyGeneration === generation &&
      fixture.snapshot.runtimeEpoch === scope.runtimeEpoch &&
      fixture.snapshot.revision === scope.revision &&
      fixture.snapshot.state === "connected" &&
      current?.trusted &&
      current.trustRevision === trustRevision &&
      current.path === scope.workspacePath &&
      fixture.snapshot.selectedWorkspaceId === scope.workspaceId &&
      fixture.snapshot.selectedSessionId === scope.sessionId &&
      fixture.snapshot.sessions.some(
        (s) => s.id === scope.sessionId && s.workspaceId === scope.workspaceId,
      ) &&
      !extensionFixtureHeld(fixture, scope.workspaceId) &&
      fixture.syntheticPermissionPolicies.get(scope.sessionId) === record &&
      record.mapped &&
      record.workspacePath === scope.workspacePath
      ? { ok: true, value: clone(value) }
      : failure("UNAVAILABLE");
  };
  return fixture.holdPermissionPolicyReads
    ? new Promise((resolve) =>
        fixture.heldPermissionPolicyReads.push(() => resolve(complete())),
      )
    : complete();
}

function readExtensionFixture(fixture, request) {
  const snapshot = fixture.snapshot;
  const workspace = snapshot.workspaces.find(
    (w) => w.id === request.workspaceId,
  );
  if (!workspace) return failure("NOT_FOUND");
  if (!workspace.trusted) return failure("INVALID_SELECTION");
  if (
    snapshot.state !== "connected" ||
    extensionFixtureHeld(fixture, workspace.id)
  )
    return failure("UNAVAILABLE");
  const identity = {
    runtimeEpoch: snapshot.runtimeEpoch,
    revision: snapshot.revision,
    workspaceId: workspace.id,
    workspacePath: workspace.path,
    trustRevision: workspace.trustRevision,
    generation: fixture.extensionGeneration,
  };
  const raw = fixture.extensionRaw ?? { plugins: [], tools: [] };
  const unavailable = { status: "unavailable", reason: "runtime_unavailable" };
  const plugins = ["plugins-unavailable", "unavailable"].includes(
    fixture.extensionsState,
  )
    ? { ...unavailable }
    : projectNativePlugins(raw.plugins);
  const tools = ["tools-unavailable", "unavailable"].includes(
    fixture.extensionsState,
  )
    ? { ...unavailable }
    : projectNativeTools(raw.tools);
  const value = validateExtensionsObservation({
    runtimeEpoch: identity.runtimeEpoch,
    revision: identity.revision,
    workspaceId: identity.workspaceId,
    workspacePath: identity.workspacePath,
    status: ["unavailable", "partial", "available"][
      Number(plugins.status === "available") +
        Number(tools.status === "available")
    ],
    plugins,
    tools,
    hooks: { status: "not_reported", reason: "inventory_not_supported" },
  });
  const complete = () => {
    const current = fixture.snapshot.workspaces.find(
      (w) => w.id === identity.workspaceId,
    );
    return fixture.extensionGeneration === identity.generation &&
      fixture.snapshot.runtimeEpoch === identity.runtimeEpoch &&
      fixture.snapshot.revision === identity.revision &&
      fixture.snapshot.state === "connected" &&
      !extensionFixtureHeld(fixture, identity.workspaceId) &&
      current?.trusted &&
      current.path === identity.workspacePath &&
      current.trustRevision === identity.trustRevision
      ? { ok: true, value: clone(value) }
      : failure("UNAVAILABLE");
  };
  return fixture.holdExtensionReads
    ? new Promise((resolve) =>
        fixture.heldExtensionReads.push(() => resolve(complete())),
      )
    : complete();
}

// Agent producer states seed virtual files and transport outcomes only.
export const AGENT_UI_STATES = Object.freeze([
  "list-unread",
  "list-available",
  "list-truncated",
  "list-missingparent",
  "list-denied",
  "file-unread",
  "file-available",
  "file-supportedbom",
  "file-missingleaf",
  "file-rawunsupportedgrammar",
  "file-unsafeunsupported",
  "file-changed",
  "file-oversize",
  "dirtyvalid",
  "confirmed",
  "savecancel",
  "saveunknown",
  "restoredoldkey",
  "untrusted",
]);
export const AGENT_RETAINED_KEY = Object.freeze({
  runtimeEpoch: "fixture-Agent-original-epoch",
  operationId: "fixture-Agent-original-save",
  type: "configuration.agent.save",
  workspaceId: "fixture-w",
});
export const AGENT_RUNTIME_UI_STATES = Object.freeze([
  "notobserved",
  "currentregistered",
  "globalforeigninuse",
  "unowned",
  "unavailable",
  "references-unavailable",
  "confirmationcancel",
  "removed",
  "unknownheld",
  "pending",
  "restartuntrusted",
  "historicalreceipt",
  "restoredoldkey",
]);
export const AGENT_RUNTIME_RETAINED_KEY = Object.freeze({
  runtimeEpoch: "fixture-Agent-runtime-original-epoch",
  operationId: "fixture-Agent-runtime-original-register",
  type: "configuration.agent.register",
  workspaceId: "fixture-w",
});
const agentHash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const agentBytesDigest = (text) =>
  createHash("sha256").update(text).digest("hex");
export function applyAgentState(fixture, name) {
  if (!AGENT_UI_STATES.includes(name))
    throw new Error("Unknown closed Agent fixture state");
  const previous = fixture.snapshot.sessions.find((s) => s.id === "fixture-s");
  if (previous) delete previous.parentSessionId;
  fixture.setConfigurationState("normal");
  fixture.skillState = fixture.skillRuntimeState = undefined;
  fixture.requests = [];
  fixture.intents = [];
  fixture.lookups = [];
  fixture.lookupEnvelopes = [];
  for (const map of [
    fixture.agentFiles,
    fixture.agentDirectories,
    fixture.agentBackups,
    fixture.agentReadOutcomes,
    fixture.agentRuntimeRegistrations,
    fixture.agentRuntimeObservations,
  ])
    map.clear();
  fixture.agentState = name;
  fixture.agentRuntimeState = undefined;
  fixture.agentReads = [];
  fixture.agentSnapshotReads = [];
  fixture.agentRuntimeReads = [];
  fixture.agentRuntimeEffects = [];
  fixture.agentRuntimeReferences = [];
  fixture.agentRuntimeSerial = 0;
  fixture.agentRuntimeDefaultId = "fixture-agent";
  fixture.agentRuntimeUnowned = [
    {
      nativeId: "fixture-agent",
      name: "Test agent",
      mode: "primary",
      hidden: false,
    },
  ];
  fixture.nextAgentSave =
    name === "saveunknown"
      ? "unknown"
      : name === "savecancel"
        ? "denied"
        : undefined;
  fixture.nextAgentRuntime = undefined;
  fixture.agentListOutcome =
    name === "list-missingparent"
      ? "path_missing"
      : name === "list-denied"
        ? "path_denied"
        : undefined;
  fixture.agentListTruncated = name === "list-truncated";
  fixture.holdAgentSave =
    fixture.holdAgentRuntime =
    fixture.holdAgentRuntimeReads =
      false;
  fixture.heldAgentSaves = [];
  fixture.heldAgentRuntime = [];
  fixture.heldAgentRuntimeReads = [];
  fixture.pendingAgentWorkspaces.clear();
  const workspace = fixture.snapshot.workspaces[0];
  workspace.path =
    "/synthetic/agents-workspace/" + "selectable-long-path-".repeat(5);
  workspace.trusted = name !== "untrusted";
  const sourceName = "review-notes",
    otherSourceName = "release-guide";
  const text =
    name === "file-rawunsupportedgrammar"
      ? '---\nmodel: "UNSUPPORTED-MODEL"\n---\n# SYNTHETIC RAW AGENT\n'
      : '\uFEFF---\r\n{"description":"SYNTHETIC AGENT A","color":"#AABBCC"}\r\n---\r\n  # SYNTHETIC AGENT SYSTEM\r\n' +
        "Full selectable system line. ".repeat(18) +
        "\r\n";
  const names = [sourceName, otherSourceName, "long-" + "a".repeat(70)];
  if (fixture.agentListTruncated)
    while (names.length < AGENT_LIMITS.entries)
      names.push("bounded-" + names.length);
  fixture.agentDirectories.set(
    fixture.agentKey(workspace.id),
    "virtual-agents-directory",
  );
  for (const [n, source] of names.entries())
    fixture.agentFiles.set(
      fixture.agentKey(workspace.id, source),
      n === 0
        ? text
        : "# SYNTHETIC AGENT " + source + "\nDistinct file " + n + "\n",
    );
  // The listed leaf can disappear after enumeration; the parent remains available.
  fixture.agentListedSources = names;
  const key = fixture.agentKey(workspace.id, sourceName);
  if (name === "file-missingleaf") fixture.agentFiles.delete(key);
  if (name === "file-unsafeunsupported")
    fixture.agentFiles.set(key, "UNSAFE\u0000SYNTHETIC");
  if (name === "file-changed")
    fixture.agentReadOutcomes.set(key, "file_changed");
  if (name === "file-oversize")
    fixture.agentFiles.set(key, "a".repeat(AGENT_LIMITS.bytes + 1));
  if (name === "restoredoldkey") {
    const receipt = {
      ...AGENT_RETAINED_KEY,
      admission: "dispatched",
      delivery: "unknown",
      effect: "unknown",
      revision: fixture.snapshot.revision,
      evidence: [],
    };
    fixture.retainedReceipts.set(
      JSON.stringify([receipt.runtimeEpoch, receipt.operationId]),
      { digest: "synthetic-unresendable-original", receipt },
    );
    fixture.snapshot.retainedOperations = [
      { ...AGENT_RETAINED_KEY, authorityHold: true },
    ];
    fixture.snapshot.recovery.resources = [
      {
        workspaceId: workspace.id,
        state: "unavailable",
        reason: "unresolved_operation",
      },
    ];
  }
  validateSnapshot(fixture.snapshot);
  return {
    workspaceId: workspace.id,
    workspacePath: workspace.path,
    sourceName,
    otherSourceName,
    text,
  };
}
function observeAgentFile(fixture, workspace, sourceName) {
  const base = {
    workspaceId: workspace.id,
    workspacePath: workspace.path,
    sourceName,
    path: join(workspace.path, ".opencode", "agents", sourceName + ".md"),
  };
  const key = fixture.agentKey(workspace.id, sourceName),
    directoryKey = fixture.agentKey(workspace.id);
  const reason =
    fixture.agentListOutcome ??
    fixture.agentReadOutcomes.get(key) ??
    (!fixture.agentDirectories.has(directoryKey) ? "path_missing" : undefined);
  if (reason) return { ...base, status: "unavailable", reason };
  const directoryVersion = agentHash([
    directoryKey,
    fixture.agentDirectories.get(directoryKey),
  ]);
  const content = fixture.agentFiles.get(key);
  if (content === undefined)
    return {
      ...base,
      status: "missing",
      reason: "missing_file",
      directoryVersion,
    };
  if (Buffer.byteLength(content, "utf8") > AGENT_LIMITS.bytes)
    return { ...base, status: "unavailable", reason: "too_large" };
  if (!agentFileContentFits(content))
    return { ...base, status: "unsupported", reason: "unsupported_content" };
  return {
    ...base,
    status: "available",
    content,
    directoryVersion,
    version: agentHash([base, directoryVersion, content]),
  };
}
function fixtureAgentRow(
  fixture,
  workspace,
  sourceName,
  operationId,
  runtimeEpoch = fixture.snapshot.runtimeEpoch,
) {
  const file = observeAgentFile(fixture, workspace, sourceName),
    parsed = parseAgentFile(file.content);
  if (file.status !== "available" || !parsed)
    throw new Error("Unsupported synthetic Agent file");
  const nativeId = nativeAgentRegistrationId({
    runtimeEpoch,
    workspaceId: workspace.id,
    sourceName,
    operationId,
  });
  const { system, mode, ...metadata } = parsed;
  const native = {
    id: nativeId,
    name: sourceName,
    system,
    mode,
    hidden: false,
    request: { settings: {}, headers: {}, body: {} },
    permissions: clone(BASELINE_POLICY),
    ...metadata,
  };
  return {
    sourceName,
    nativeId,
    digest: agentBytesDigest(file.content),
    nativeDigest: nativeAgentDigest(native),
    registrationRuntimeEpoch: runtimeEpoch,
    registrationOperationId: operationId,
    name: sourceName,
    system,
    systemDigest: agentBytesDigest(system),
    path: file.path,
    mode,
    hidden: false,
    permissions: clone(BASELINE_POLICY),
    referenceCount: 0,
    ...metadata,
  };
}
export function applyAgentRuntimeState(fixture, name) {
  if (!AGENT_RUNTIME_UI_STATES.includes(name))
    throw new Error("Unknown closed Agent runtime fixture state");
  const scope = applyAgentState(
    fixture,
    name === "restartuntrusted" ? "untrusted" : "file-supportedbom",
  );
  fixture.agentRuntimeState = name;
  const workspace = fixture.snapshot.workspaces[0];
  const historical = [
    "historicalreceipt",
    "restartuntrusted",
    "restoredoldkey",
  ].includes(name);
  const row = fixtureAgentRow(
    fixture,
    workspace,
    scope.sourceName,
    historical
      ? AGENT_RUNTIME_RETAINED_KEY.operationId
      : "fixture-agent-seeded-register",
    historical
      ? AGENT_RUNTIME_RETAINED_KEY.runtimeEpoch
      : fixture.snapshot.runtimeEpoch,
  );
  scope.nativeId = row.nativeId;
  if (
    [
      "currentregistered",
      "globalforeigninuse",
      "references-unavailable",
    ].includes(name)
  )
    fixture.agentRuntimeRegistrations.set(row.nativeId, row);
  if (name === "globalforeigninuse")
    fixture.agentRuntimeReferences = [
      {
        nativeId: row.nativeId,
        sessionId: "foreign-archived",
        workspaceId: "foreign-workspace",
        archived: true,
      },
      {
        nativeId: row.nativeId,
        sessionId: "foreign-active",
        workspaceId: "foreign-workspace",
        archived: false,
      },
    ];
  if (["unowned", "historicalreceipt"].includes(name))
    fixture.agentRuntimeUnowned.push({
      nativeId: row.nativeId,
      name: row.name,
      mode: "primary",
      hidden: false,
    });
  fixture.nextAgentRuntime =
    name === "confirmationcancel"
      ? "denied"
      : name === "unknownheld"
        ? "unknown"
        : undefined;
  fixture.holdAgentRuntime = name === "pending";
  if (historical) {
    const unknown = name === "restoredoldkey";
    const fields = Object.fromEntries(
      [
        "sourceName",
        "nativeId",
        "digest",
        "nativeDigest",
        "registrationRuntimeEpoch",
        "registrationOperationId",
        "systemDigest",
      ].map((k) => [k, row[k]]),
    );
    const file = observeAgentFile(fixture, workspace, scope.sourceName);
    const receipt = {
      ...AGENT_RUNTIME_RETAINED_KEY,
      admission: "dispatched",
      delivery: unknown ? "unknown" : "accepted",
      effect: unknown ? "unknown" : "confirmed",
      revision: fixture.snapshot.revision,
      evidence: [],
      ...(!unknown && {
        result: {
          kind: "agent_registered",
          workspaceId: workspace.id,
          ...fields,
          version: file.version,
          directoryVersion: file.directoryVersion,
          defaultAgentId: fixture.agentRuntimeDefaultId,
        },
      }),
    };
    validateAgentRuntimeReceipt(receipt);
    fixture.retainedReceipts.set(
      JSON.stringify([receipt.runtimeEpoch, receipt.operationId]),
      { digest: "synthetic-unresendable-original", receipt },
    );
    if (unknown) {
      fixture.snapshot.retainedOperations = [
        { ...AGENT_RUNTIME_RETAINED_KEY, authorityHold: true },
      ];
      fixture.snapshot.recovery.resources = [
        {
          workspaceId: workspace.id,
          state: "unavailable",
          reason: "unresolved_operation",
        },
      ];
    }
  }
  validateSnapshot(fixture.snapshot);
  return scope;
}
function readAgentFixture(fixture, request, epoch) {
  const workspace = fixture.snapshot.workspaces.find(
    (w) => w.id === request.workspaceId,
  );
  if (!workspace) return failure("NOT_FOUND");
  if (!workspace.trusted) return failure("INVALID_SELECTION");
  if (fixture.snapshot.state !== "connected") return failure("UNAVAILABLE");
  if (request.type === "configuration.agent.read")
    return {
      ok: true,
      value: observeAgentFile(fixture, workspace, request.sourceName),
    };
  if (request.type === "configuration.agent.list") {
    const base = {
      workspaceId: workspace.id,
      workspacePath: workspace.path,
      path: join(workspace.path, ".opencode", "agents"),
    };
    const reason =
      fixture.agentListOutcome ??
      (!fixture.agentDirectories.has(fixture.agentKey(workspace.id))
        ? "path_missing"
        : undefined);
    return {
      ok: true,
      value: reason
        ? {
            ...base,
            status: reason === "path_missing" ? "missing" : "unavailable",
            reason,
          }
        : {
            ...base,
            status: "available",
            entries: fixture.agentListedSources
              .map((sourceName) => ({
                sourceName,
                path: join(base.path, sourceName + ".md"),
              }))
              .slice(0, AGENT_LIMITS.entries),
            truncated: fixture.agentListTruncated,
          },
    };
  }
  const base = {
    workspaceId: workspace.id,
    workspacePath: workspace.path,
    runtimeEpoch: epoch,
  };
  let value;
  if (
    ["unavailable", "references-unavailable"].includes(
      fixture.agentRuntimeState,
    )
  )
    value = {
      ...base,
      status: "unavailable",
      reason:
        fixture.agentRuntimeState === "unavailable"
          ? "runtime_error"
          : "references_unverified",
    };
  else {
    const file = request.sourceName
      ? observeAgentFile(fixture, workspace, request.sourceName)
      : undefined;
    const fileProjection = !file
      ? undefined
      : file.status === "available" && agentFileWriteFits(file.content)
        ? {
            sourceName: request.sourceName,
            status: "available",
            version: file.version,
            directoryVersion: file.directoryVersion,
            digest: agentBytesDigest(file.content),
          }
        : {
            sourceName: request.sourceName,
            status: file.status === "available" ? "unsupported" : file.status,
            reason:
              file.status === "available" ? "unsupported_content" : file.reason,
          };
    value = {
      ...base,
      status: "observed",
      observationId:
        "fixture-agent-observation-" + ++fixture.agentRuntimeSerial,
      defaultAgentId: fixture.agentRuntimeDefaultId,
      owned: [...fixture.agentRuntimeRegistrations.values()].map((row) => ({
        ...clone(row),
        referenceCount: fixture.agentRuntimeReferences.filter(
          (r) => r.nativeId === row.nativeId,
        ).length,
      })),
      unowned: clone(fixture.agentRuntimeUnowned),
      ...(fileProjection && { file: fileProjection }),
    };
    while (fixture.agentRuntimeObservations.size >= 32)
      fixture.agentRuntimeObservations.delete(
        fixture.agentRuntimeObservations.keys().next().value,
      );
    fixture.agentRuntimeObservations.set(value.observationId, {
      value: clone(value),
      revision: fixture.snapshot.revision,
      trustRevision: workspace.trustRevision,
    });
  }
  if (!validAgentRuntimeObservation(value))
    throw new Error("Invalid synthetic Agent observation");
  return { ok: true, value };
}

export const SKILL_UI_STATES = Object.freeze([
  "list-unread",
  "list-available",
  "list-truncated",
  "list-missingparent",
  "list-denied",
  "file-unread",
  "file-available",
  "file-missingleaf",
  "file-rawunsupportedgrammar",
  "file-unsafeunsupported",
  "file-changed",
  "file-oversize",
  "dirtyvalid",
  "confirmed",
  "unknown",
  "restoredoldkey",
  "untrusted",
]);
export const SKILL_RETAINED_KEY = Object.freeze({
  runtimeEpoch: "fixture-Skill-original-epoch",
  operationId: "fixture-Skill-original-save",
  type: "configuration.skill.save",
  workspaceId: "fixture-w",
});

// UI names seed virtual disk/transport conditions, never renderer state. Dirty,
// confirmed and unknown states must be reached through actual renderer actions.
export function applySkillState(fixture, name) {
  if (!SKILL_UI_STATES.includes(name))
    throw new Error("Unknown closed Skill fixture state");
  const previous = fixture.snapshot.sessions.find((s) => s.id === "fixture-s");
  if (previous) delete previous.parentSessionId;
  fixture.setConfigurationState("normal");
  fixture.requests = [];
  fixture.intents = [];
  fixture.skillFiles.clear();
  fixture.skillDirectories.clear();
  fixture.skillBackups.clear();
  fixture.skillReadOutcomes.clear();
  fixture.skillReads = [];
  fixture.skillSnapshotReads = [];
  fixture.skillState = name;
  fixture.skillRuntimeState = undefined;
  fixture.skillRuntimeReads = [];
  fixture.holdSkillRuntimeReads = false;
  fixture.heldSkillRuntimeReads = [];
  fixture.skillRuntimeRegistrations.clear();
  fixture.skillRuntimeHistory.clear();
  fixture.skillRuntimeObservations.clear();
  fixture.skillRuntimeUnowned = [];
  fixture.skillRuntimeEffects = [];
  fixture.skillRuntimeSerial = 0;
  fixture.nextSkillRuntime = undefined;
  fixture.holdSkillRuntime = false;
  fixture.heldSkillRuntime = [];
  fixture.skillListOutcome = undefined;
  fixture.skillListTruncated = name === "list-truncated";
  fixture.pendingSkillWorkspaces.clear();
  fixture.nextSkillSave = name === "unknown" ? "unknown" : undefined;
  fixture.holdSkillSave = false;
  const workspace = fixture.snapshot.workspaces[0];
  workspace.path = `/synthetic/skills-workspace/${"selectable-long-path-".repeat(5)}`;
  workspace.trusted = name !== "untrusted";
  const sourceName = "review-notes",
    otherSourceName = "release-guide";
  const text =
    name === "file-rawunsupportedgrammar"
      ? "---\nname: review-notes\ndescription: |\n  SYNTHETIC RAW UNSUPPORTED YAML\n---\n# Preserve exact raw bytes\n"
      : '---\nname: "Review notes"\ndescription: "SYNTHETIC FILE A"\nmetadata:\n  opencode/autoinvoke: false\n---\n# SYNTHETIC SKILL A\n';
  const names = [sourceName, otherSourceName, `long-${"s".repeat(59)}`];
  if (fixture.skillListTruncated)
    while (names.length < SKILL_LIMITS.entries)
      names.push(`bounded-${names.length}`);
  for (const [index, source] of names.entries()) {
    const key = fixture.skillKey(workspace.id, source);
    fixture.skillDirectories.set(key, `virtual-directory-${index}`);
    fixture.skillFiles.set(
      key,
      index === 0
        ? text
        : `# SYNTHETIC SKILL ${source}\nDistinct file ${index}\n`,
    );
  }
  const key = fixture.skillKey(workspace.id, sourceName);
  if (name === "file-missingleaf") fixture.skillFiles.delete(key);
  if (name === "list-missingparent") fixture.skillListOutcome = "path_missing";
  if (name === "list-denied") fixture.skillListOutcome = "path_denied";
  if (name === "file-unsafeunsupported")
    fixture.skillFiles.set(key, "UNSAFE\u0000SYNTHETIC");
  if (name === "file-changed")
    fixture.skillReadOutcomes.set(key, "file_changed");
  if (name === "file-oversize")
    fixture.skillFiles.set(key, "s".repeat(SKILL_LIMITS.bytes + 1));
  if (name === "restoredoldkey") {
    const receipt = {
      ...SKILL_RETAINED_KEY,
      admission: "dispatched",
      delivery: "unknown",
      effect: "unknown",
      revision: fixture.snapshot.revision,
      evidence: [],
    };
    fixture.retainedReceipts.set(
      JSON.stringify([receipt.runtimeEpoch, receipt.operationId]),
      {
        digest: "synthetic-original-unresendable",
        receipt,
      },
    );
    fixture.snapshot.retainedOperations = [
      { ...SKILL_RETAINED_KEY, authorityHold: true },
    ];
    fixture.snapshot.recovery.resources = [
      {
        workspaceId: workspace.id,
        state: "unavailable",
        reason: "unresolved_operation",
      },
    ];
  }
  validateSnapshot(fixture.snapshot);
  return {
    workspaceId: workspace.id,
    workspacePath: workspace.path,
    sourceName,
    otherSourceName,
    text,
  };
}

const skillHash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function observeSkillFile(fixture, workspace, sourceName) {
  const base = {
    workspaceId: workspace.id,
    workspacePath: workspace.path,
    sourceName,
    path: join(workspace.path, ".opencode", "skills", sourceName, "SKILL.md"),
  };
  const key = fixture.skillKey(workspace.id, sourceName);
  const reason =
    fixture.skillListOutcome ??
    fixture.skillReadOutcomes.get(key) ??
    (!fixture.skillDirectories.has(key) ? "path_missing" : undefined);
  if (reason) return { ...base, status: "unavailable", reason };
  const directoryVersion = skillHash([key, fixture.skillDirectories.get(key)]);
  const content = fixture.skillFiles.get(key);
  if (content === undefined)
    return {
      ...base,
      status: "missing",
      reason: "missing_file",
      directoryVersion,
    };
  if (Buffer.byteLength(content, "utf8") > SKILL_LIMITS.bytes)
    return { ...base, status: "unavailable", reason: "too_large" };
  if (!skillFileContentFits(content))
    return { ...base, status: "unsupported", reason: "unsupported_content" };
  return {
    ...base,
    status: "available",
    content,
    directoryVersion,
    version: skillHash([base, directoryVersion, content]),
  };
}

// Closed synthetic states seed the producer only; actions use the real bridge.
export const SKILL_RUNTIME_UI_STATES = Object.freeze([
  "empty",
  "owned",
  "already-present",
  "history-unavailable",
  "inherited",
  "foreign",
  "restart",
  "untrusted",
  "unknown",
  "denied",
  "changed",
  "unavailable",
  "pending",
  "restoredoldkey",
]);
export const SKILL_RUNTIME_RETAINED_KEY = Object.freeze({
  runtimeEpoch: "fixture-Skill-runtime-original-epoch",
  operationId: "fixture-Skill-runtime-original-register",
  type: "configuration.skill.register",
  workspaceId: "fixture-w",
});
const skillBytesDigest = (text) =>
  createHash("sha256").update(text).digest("hex");
function fixtureSkillRow(fixture, workspace, sourceName, operationId) {
  const file = observeSkillFile(fixture, workspace, sourceName);
  if (file.status !== "available" || !skillFileWriteFits(file.content))
    throw new Error("Unsupported synthetic Skill file");
  let content = file.content.replace(/^\uFEFF/u, ""),
    name = sourceName,
    description;
  if (content.startsWith("---")) {
    const front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(content);
    if (!front) throw new Error("Unsupported synthetic Skill frontmatter");
    for (const line of front[1].split(/\r?\n/u)) {
      if (line.startsWith("name: ")) name = JSON.parse(line.slice(6));
      if (line.startsWith("description: "))
        description = JSON.parse(line.slice(13));
    }
    content = content.slice(front[0].length);
  }
  const nativeId =
    "omoc-skill-" +
    skillBytesDigest(
      skillRuntimeIdPayload({
        runtimeEpoch: fixture.snapshot.runtimeEpoch,
        workspaceId: workspace.id,
        sourceName,
        operationId,
      }),
    );
  const native = {
    id: nativeId,
    name,
    autoinvoke: false,
    path: file.path,
    content,
    ...(description ? { description } : {}),
  };
  return {
    sourceName,
    nativeId,
    digest: skillBytesDigest(file.content),
    nativeDigest: nativeSkillDigest(native),
    registrationRuntimeEpoch: fixture.snapshot.runtimeEpoch,
    registrationOperationId: operationId,
    name,
    autoinvoke: false,
    path: file.path,
    content,
    bodyDigest: skillBytesDigest(content),
    ...(description ? { description } : {}),
  };
}
export function applySkillRuntimeState(fixture, name) {
  if (!SKILL_RUNTIME_UI_STATES.includes(name))
    throw new Error("Unknown closed Skill runtime fixture state");
  const scope = applySkillState(
    fixture,
    name === "untrusted" ? "untrusted" : "file-available",
  );
  fixture.skillRuntimeState = name;
  const workspace = fixture.snapshot.workspaces[0];
  const key = fixture.skillKey(workspace.id, scope.sourceName);
  // Deliberately true in file; Native row must always be inactive.
  fixture.skillFiles.set(
    key,
    scope.text.replace("autoinvoke: false", "autoinvoke: true"),
  );
  scope.text = fixture.skillFiles.get(key);
  const row = fixtureSkillRow(
    fixture,
    workspace,
    scope.sourceName,
    "fixture-runtime-seeded-register",
  );
  if (name === "restart") {
    // Historical ID belongs to the previous registration epoch; prefix never owns it.
    row.nativeId =
      "omoc-skill-" +
      skillBytesDigest(
        skillRuntimeIdPayload({
          runtimeEpoch: "fixture-Skill-previous-epoch",
          workspaceId: workspace.id,
          sourceName: scope.sourceName,
          operationId: "fixture-runtime-seeded-register",
        }),
      );
  }
  scope.nativeId = row.nativeId;
  scope.sessionId = "fixture-s";
  if (
    [
      "owned",
      "already-present",
      "history-unavailable",
      "inherited",
      "restart",
    ].includes(name)
  ) {
    if (name !== "restart")
      fixture.skillRuntimeRegistrations.set(row.nativeId, row);
    if (["already-present", "inherited", "restart"].includes(name))
      fixture.skillRuntimeHistory.set(scope.sessionId, [
        {
          nativeId: row.nativeId,
          messageId: "fixture-recorded-skill",
          name: row.name,
          bodyDigest: row.bodyDigest,
        },
      ]);
  }
  if (["foreign", "restart"].includes(name))
    fixture.skillRuntimeUnowned = [
      { nativeId: row.nativeId, name: row.name, autoinvoke: false },
    ];
  if (name === "inherited") {
    fixture.snapshot.sessions.push({
      id: "fixture-runtime-parent",
      workspaceId: workspace.id,
      title: "SYNTHETIC parent",
      status: "idle",
    });
    fixture.snapshot.sessions[0].parentSessionId = "fixture-runtime-parent";
  }
  if (["unknown", "denied", "changed"].includes(name))
    fixture.nextSkillRuntime = name;
  if (name === "pending") fixture.holdSkillRuntime = true;
  if (name === "restoredoldkey") {
    const receipt = {
      ...SKILL_RUNTIME_RETAINED_KEY,
      admission: "dispatched",
      delivery: "unknown",
      effect: "unknown",
      revision: fixture.snapshot.revision,
      evidence: [],
    };
    validateSkillRuntimeReceipt(receipt);
    fixture.retainedReceipts.set(
      JSON.stringify([receipt.runtimeEpoch, receipt.operationId]),
      { digest: "synthetic-unresendable-original", receipt },
    );
    fixture.snapshot.retainedOperations = [
      { ...SKILL_RUNTIME_RETAINED_KEY, authorityHold: true },
    ];
    fixture.snapshot.recovery.resources = [
      {
        workspaceId: workspace.id,
        state: "unavailable",
        reason: "unresolved_operation",
      },
    ];
  }
  validateSnapshot(fixture.snapshot);
  return scope;
}

// Synthetic renderer states only. Actual Native evidence uses the owner host.
export function applyInstructionState(fixture, name) {
  if (
    ![
      "missing",
      "registered",
      "direct",
      "inherited",
      "removed",
      "drift",
      "ownership-conflict",
      "denied",
      "unknown",
      "late-selection",
      "untrusted",
    ].includes(name)
  )
    throw new Error("Unknown closed instruction fixture state");
  // The base reset keeps fixture-s and discards synthetic parent sessions.
  // Clear its previous lineage before that reset validates the closed DTO.
  const previous = fixture.snapshot.sessions.find((s) => s.id === "fixture-s");
  if (previous) delete previous.parentSessionId;
  fixture.setConfigurationState("normal");
  fixture.instructionEntries.clear();
  fixture.instructionRegistrations.clear();
  fixture.nextInstructions = undefined;
  fixture.holdInstructions = false;
  fixture.instructionReads = [];
  const sessionId = "fixture-s";
  const text = "# SYNTHETIC SESSION INSTRUCTIONS\n";
  const workspace = fixture.snapshot.workspaces[0];
  workspace.trusted = name !== "untrusted";
  fixture.configurationFiles.set(
    JSON.stringify([workspace.id, "instructions"]),
    text,
  );
  const base = {
    workspaceId: workspace.id,
    workspacePath: workspace.path,
    kind: "instructions",
    path: join(workspace.path, "AGENTS.md"),
  };
  const sourceVersion = instructionDigest(JSON.stringify([base, text]));
  const registration = {
    state: "registered",
    key: INSTRUCTION_KEY,
    digest: instructionDigest(text),
    sourceVersion,
    origin: name === "inherited" ? "fork" : "direct",
    ...(name === "inherited" && {
      inheritedFromSessionId: "fixture-instruction-parent",
    }),
  };
  if (
    ["registered", "direct", "inherited", "drift", "untrusted"].includes(name)
  )
    fixture.instructionRegistrations.set(sessionId, registration);
  if (name === "removed")
    fixture.instructionRegistrations.set(sessionId, {
      state: "absent",
      key: INSTRUCTION_KEY,
    });
  if (
    [
      "registered",
      "direct",
      "inherited",
      "drift",
      "ownership-conflict",
      "untrusted",
    ].includes(name)
  )
    fixture.instructionEntries.set(sessionId, [
      {
        key: INSTRUCTION_KEY,
        value: name === "drift" ? "SYNTHETIC EXTERNAL DRIFT" : text,
      },
    ]);
  if (name === "inherited") {
    fixture.snapshot.sessions[0].parentSessionId = "fixture-instruction-parent";
    fixture.snapshot.sessions.push({
      id: "fixture-instruction-parent",
      workspaceId: workspace.id,
      title: "합성 부모 세션",
      status: "idle",
    });
  } else delete fixture.snapshot.sessions[0].parentSessionId;
  if (name === "late-selection") {
    fixture.snapshot.sessions.push({
      id: "fixture-instruction-other",
      workspaceId: workspace.id,
      title: "합성 다른 세션",
      status: "idle",
    });
    fixture.holdInstructions = true;
  }
  if (["denied", "unknown"].includes(name)) fixture.nextInstructions = name;
  fixture.sessionMessages = new Map(
    fixture.snapshot.sessions.map((s) => [s.id, []]),
  );
  validateSnapshot(fixture.snapshot);
  return { workspaceId: workspace.id, sessionId, text, sourceVersion };
}

export const MCP_UI_STATES = Object.freeze([
  "missing",
  "currentdisabled",
  "connected",
  "failed",
  "needs_auth",
  "unowned",
  "collision",
  "changed",
  "denied",
  "unknown",
  "lateworkspace",
  "untrusted",
  "restart",
]);
// Pure synthetic catalog states using the production projection. No SDK process.
export function applyMcpState(fixture, name) {
  if (!MCP_UI_STATES.includes(name))
    throw new Error("Unknown closed MCP fixture state");
  const previous = fixture.snapshot.sessions.find((s) => s.id === "fixture-s");
  if (previous) delete previous.parentSessionId;
  fixture.setConfigurationState("normal");
  fixture.requests = [];
  fixture.intents = [];
  fixture.mcpCatalog.clear();
  fixture.mcpRegistrations.clear();
  fixture.mcpReads = [];
  fixture.pendingMcpWorkspaces.clear();
  fixture.nextMcp = undefined;
  fixture.holdMcp = false;
  const workspace = fixture.snapshot.workspaces[0];
  workspace.trusted = name !== "untrusted";
  const text =
    JSON.stringify(
      {
        mcp: {
          servers: {
            demo: {
              type: "local",
              command: ["node", "synthetic-mcp-fixture"],
              cwd: ".",
              disabled: false,
            },
          },
        },
      },
      null,
      2,
    ) + "\n";
  fixture.configurationFiles.set(JSON.stringify([workspace.id, "mcp"]), text);
  const base = {
    workspaceId: workspace.id,
    workspacePath: workspace.path,
    kind: "mcp",
    path: join(workspace.path, "opencode.json"),
  };
  const sourceVersion = mcpDigest(JSON.stringify([base, text]));
  const nativeName = mcpNativeName(workspace.id, "demo");
  const definition = Object.freeze({
    type: "local",
    command: Object.freeze(["node", "synthetic-mcp-fixture"]),
    cwd: workspace.path,
    disabled: true,
  });
  const registration = {
    workspaceId: workspace.id,
    path: workspace.path,
    runtimeEpoch: fixture.snapshot.runtimeEpoch,
    sourceName: "demo",
    digest: mcpDigest(JSON.stringify(definition)),
    sourceVersion,
    definition,
  };
  const statuses = {
    currentdisabled: "disabled",
    connected: "connected",
    failed: "failed",
    needs_auth: "needs_auth",
    unowned: "connected",
    collision: "disabled",
    untrusted: "disabled",
    restart: "disabled",
  };
  const rows = new Map();
  if (statuses[name]) rows.set(nativeName, statuses[name]);
  fixture.mcpCatalog.set(workspace.id, rows);
  if (
    [
      "currentdisabled",
      "connected",
      "failed",
      "needs_auth",
      "untrusted",
      "restart",
    ].includes(name)
  )
    fixture.mcpRegistrations.set(nativeName, registration);
  if (name === "restart") {
    registration.runtimeEpoch = "fixture-MCP-original-epoch";
    const receipt = {
      runtimeEpoch: registration.runtimeEpoch,
      operationId: "fixture-MCP-original-register",
      type: "configuration.mcp.register",
      workspaceId: workspace.id,
      admission: "dispatched",
      delivery: "accepted",
      effect: "confirmed",
      revision: fixture.snapshot.revision,
      evidence: [{ kind: "host-registry", id: workspace.id }],
      result: {
        kind: "mcp_registered",
        workspaceId: workspace.id,
        sourceName: "demo",
        nativeName,
        digest: registration.digest,
        sourceVersion,
        status: "disabled",
      },
    };
    fixture.retainedReceipts.set(
      JSON.stringify([receipt.runtimeEpoch, receipt.operationId]),
      { digest: "historical-only", receipt },
    );
  }
  const observed = observeMcpCatalog(
    {
      location: { directory: workspace.path },
      data: [...rows].map(([name, status]) => ({ name, status: { status } })),
    },
    {
      workspaceId: workspace.id,
      path: workspace.path,
      runtimeEpoch: fixture.snapshot.runtimeEpoch,
      owned: fixture.mcpRegistrations,
    },
  );
  if (["changed", "denied", "unknown"].includes(name)) fixture.nextMcp = name;
  if (name === "lateworkspace") {
    fixture.snapshot.workspaces.push({
      ...workspace,
      id: "fixture-mcp-other-w",
      name: "다른 합성 작업 공간",
      path: "/synthetic/mcp-other-workspace",
    });
    fixture.snapshot.sessions.push({
      id: "fixture-mcp-other-s",
      workspaceId: "fixture-mcp-other-w",
      title: "다른 작업 공간 세션",
      status: "idle",
    });
    fixture.holdMcp = true;
  }
  fixture.sessionMessages = new Map(
    fixture.snapshot.sessions.map((s) => [s.id, []]),
  );
  validateSnapshot(fixture.snapshot);
  return {
    workspaceId: workspace.id,
    text,
    sourceVersion,
    nativeName,
    observationVersion: observed.version,
  };
}

export function applyConfigurationState(fixture, name) {
  if (typeof name === "string" && name.startsWith("extensions-"))
    return fixture.setExtensionsState(name.slice("extensions-".length));
  if (
    !["normal", "untrusted", "partial", "missing", "long-path"].includes(name)
  )
    throw new Error("Unknown closed configuration fixture state");
  applyStorageState(fixture, "durable-documents");
  const workspace = fixture.snapshot.workspaces[0];
  workspace.path = "/synthetic/configuration-workspace";
  workspace.trusted = name !== "untrusted";
  workspace.trustRevision++;
  fixture.snapshot.permissions = [];
  fixture.catalog = createUiFixture().catalog;
  const path =
    name === "long-path"
      ? `${workspace.path}/${"선택할 수 있는 긴 작업 공간 경로/".repeat(12)}AGENTS.md`
      : `${workspace.path}/AGENTS.md`;
  fixture.catalog.configuration = {
    status: name === "partial" ? "partial" : "available",
    runtimeStatus: "not_reported",
    ...(name === "untrusted" && { reason: "untrusted_workspace" }),
    entries: [
      {
        id: "configuration-instructions",
        kind: "instructions",
        source: "workspace",
        path,
        scope: "workspace",
        state: "discovered",
      },
      ...(name === "partial"
        ? [
            {
              id: "configuration-denied",
              kind: "configuration",
              source: "workspace",
              path: `${workspace.path}/.opencode`,
              scope: "workspace",
              state: "unavailable",
              reason: "path_denied",
            },
          ]
        : []),
    ],
  };
  if (name === "missing") delete fixture.catalog.configuration;
  fixture.catalog.skills.entries = [
    {
      id: "configuration-review",
      name: "출처 확인 Skill",
      description: "합성 읽기 전용 목록",
      source: "runtime",
      path: `${workspace.path}/.agents/skills/review/SKILL.md`,
      scope: "workspace",
    },
  ];
  fixture.catalog.mcp.entries = [
    {
      id: "configuration-auth",
      name: "합성 인증 대기 MCP",
      status: "needs_auth",
    },
    {
      id: "configuration-connected",
      name: "합성 관측 MCP",
      status: "connected",
    },
  ];
  if (name === "untrusted")
    for (const group of ["commands", "skills", "mcp", "agents", "models"])
      fixture.catalog[group] = { status: "unavailable", entries: [] };
  return clone(fixture.catalog);
}

export const P7_RECOVERY_TEXT = Object.freeze({
  owner_conflict: "다른 앱이 저장소를 사용 중입니다. 변경할 수 없습니다.",
  owner_unverified:
    "저장소를 사용하는 앱을 확인할 수 없습니다. 변경을 막았습니다.",
  corrupt_journal: "저장 기록이 손상되었습니다. 복구가 필요합니다.",
  unsupported_version:
    "이 저장소 버전을 사용할 수 없습니다. 변경을 막았습니다.",
  identity_conflict: "저장된 작업 정보가 일치하지 않습니다. 복구가 필요합니다.",
  unconfirmed_tail: "마지막 저장 결과를 확인할 수 없습니다. 복구가 필요합니다.",
  writer_poisoned: "저장을 완료하지 못했습니다. 추가 변경을 막았습니다.",
  pending_inbox:
    "처리 중이던 요청이 남아 있습니다. 자동으로 실행하지 않습니다.",
  native_startup_unverified:
    "안전한 실행 시작을 확인하지 못했습니다. 변경을 막았습니다.",
  storage_denied: "저장소에 접근할 수 없습니다. 변경을 막았습니다.",
  retained_limit: "확인할 요청이 너무 많습니다. 복구가 필요합니다.",
  path_missing: "작업 공간 폴더를 찾을 수 없습니다. 변경할 수 없습니다.",
  path_denied: "작업 공간 폴더에 접근할 수 없습니다. 변경할 수 없습니다.",
  path_conflict: "작업 공간 위치가 일치하지 않습니다. 변경할 수 없습니다.",
  native_mapping_unverified:
    "세션 연결을 확인하지 못했습니다. 사용할 수 없습니다.",
  partial_native_mapping:
    "세션 연결을 완료하지 못했습니다. 사용할 수 없습니다.",
  unresolved_operation:
    "이 작업의 결과를 확인하지 못했습니다. 추가 변경을 막았습니다.",
});
export const P7_UI_STATES = Object.freeze({
  "durable-documents": {
    path: "/synthetic/Documents/OhMyOwnCode/11111111-1111-4111-8111-111111111111",
  },
  imported: { path: "/synthetic/imported-project" },
  "missing-path": { resource: "path_missing" },
  "denied-path": { resource: "path_denied" },
  "corrupt-journal": { store: "corrupt_journal" },
  "owner-conflict": { store: "owner_conflict" },
  "pending-inbox": { store: "pending_inbox", retained: true },
  "unconfirmed-tail": { store: "unconfirmed_tail", retained: true },
  "partial-mapping": { resource: "partial_native_mapping", retained: true },
});
export const P7_RETAINED_KEY = Object.freeze({
  runtimeEpoch: "fixture-original-epoch",
  operationId: "fixture-original-send",
  type: "message.send",
  workspaceId: "fixture-w",
  sessionId: "fixture-s",
});
export function applyStorageState(fixture, name) {
  if (!Object.hasOwn(P7_UI_STATES, name))
    throw new Error("Unknown closed P7 fixture state");
  const state = P7_UI_STATES[name];
  const snapshot = fixture.snapshot;
  snapshot.workspaces = [snapshot.workspaces.find((w) => w.id === "fixture-w")];
  snapshot.sessions = [snapshot.sessions.find((s) => s.id === "fixture-s")];
  snapshot.selectedWorkspaceId = "fixture-w";
  snapshot.selectedSessionId = "fixture-s";
  snapshot.temporary = false;
  snapshot.revision++;
  snapshot.observationSequence++;
  snapshot.state = state.store ? "unavailable" : "connected";
  snapshot.messages = [];
  snapshot.permissions = [];
  snapshot.recovery = {
    store: state.store
      ? { state: "recovery_required", reason: state.store }
      : { state: "ready" },
    resources: state.resource
      ? [
          {
            workspaceId: "fixture-w",
            state: "unavailable",
            reason: state.resource,
            ...(state.resource === "partial_native_mapping" && {
              sessionId: "fixture-s",
            }),
          },
        ]
      : [],
  };
  snapshot.workspaces[0].temporary = false;
  snapshot.workspaces[0].path =
    state.path ?? P7_UI_STATES["durable-documents"].path;
  snapshot.sessions[0].status =
    state.resource || state.store ? "unavailable" : "idle";
  snapshot.sessions[0].archived = false;
  snapshot.retainedOperations = state.retained
    ? [{ ...P7_RETAINED_KEY, authorityHold: true }]
    : [];
  fixture.retainedReceipts.clear();
  if (state.retained) {
    const receipt = {
      ...P7_RETAINED_KEY,
      admission: "dispatched",
      delivery: "unknown",
      effect: "unknown",
      revision: snapshot.revision,
      evidence: [],
    };
    fixture.retainedReceipts.set(
      JSON.stringify([receipt.runtimeEpoch, receipt.operationId]),
      { digest: "synthetic-retained-unresendable", receipt },
    );
  }
  validateSnapshot(snapshot);
  return snapshot;
}

const clone = (value) => globalThis.structuredClone(value);
const digest = (operation) =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(operation).sort(([a], [b]) => a.localeCompare(b)),
    ),
  );

// This synthetic adapter exercises the frozen wire. It is not a production
// capacity/service implementation. Reads never enter the business-effect log.
export function createFixtureTransport(
  fixture,
  { webContents, allowedUrl, read } = {},
) {
  const receipts = fixture.retainedReceipts;
  const receiptKey = (epoch, id) => JSON.stringify([epoch, id]);
  const reads = new Map();
  // Separate from read metrics: observe attempts even when no effect is admitted.
  const mutationCounts = { attempted: 0, dispatched: 0, rejected: 0 };
  let closed = false;
  const counts = {
    requests: 0,
    active: 0,
    pending: 0,
    admitted: 0,
    max: 0,
    settled: 0,
    deduplicated: 0,
    cancelled: 0,
  };
  const epoch = fixture.snapshot.runtimeEpoch;
  const gitSender = ++fixture.gitSenderSerial;
  const admitted = (event, args) =>
    !closed &&
    args.length === 1 &&
    admitsRendererRequest(event, webContents, allowedUrl);
  function readResult(request) {
    if (request.type === "permission.policy.read")
      return readPermissionPolicyFixture(fixture, request);
    if (["context.observe", "session.inbox"].includes(request.type))
      return readContextFixture(fixture, request, gitSender);
    if (
      ["git.branch.preview.read", "git.restore.preview.read"].includes(
        request.type,
      )
    )
      return readGitBranchRestoreFixture(fixture, request, gitSender);
    if (request.type === "git.commit.preview.read")
      return readGitCommitFixture(fixture, request, gitSender);
    if (request.type === "git.index.preview.read")
      return readGitIndexFixture(fixture, request, gitSender);
    if (["git.review.read", "git.diff.read"].includes(request.type))
      return readGitFixture(fixture, request, gitSender);
    if (request.type === "operation.lookup") {
      fixture.lookups.push(clone(request));
      const receipt = receipts.get(
        receiptKey(request.runtimeEpoch, request.operationId),
      )?.receipt;
      return {
        ok: true,
        value:
          request.runtimeEpoch !== epoch && !receipt
            ? {
                status: "wrong_epoch",
                runtimeEpoch: request.runtimeEpoch,
                operationId: request.operationId,
                effect: "unknown",
              }
            : receipt
              ? {
                  status: "found",
                  runtimeEpoch: request.runtimeEpoch,
                  operationId: request.operationId,
                  receipt: clone(receipt),
                }
              : {
                  status: "missing",
                  runtimeEpoch: request.runtimeEpoch,
                  operationId: request.operationId,
                  effect: "unknown",
                },
      };
    }
    if (request.type === "snapshot") {
      validateSnapshot(fixture.snapshot);
      fixture.snapshot.observationSequence++;
      if (fixture.agentState)
        fixture.agentSnapshotReads.push({
          revision: fixture.snapshot.revision,
          observationSequence: fixture.snapshot.observationSequence,
        });
      if (fixture.skillState)
        fixture.skillSnapshotReads.push({
          revision: fixture.snapshot.revision,
          observationSequence: fixture.snapshot.observationSequence,
        });
      // P6 is the disposable memory-only service analogue (no durable ledger).
      // P7 durable producers expose every unresolved retained fixture receipt.
      // Explicit synthetic task/reconciliation projection metadata is separate
      // from receipt identity and executable lookup requests. ACK is not release.
      const retainedKeys = fixture.snapshot.retainedOperations;
      const priorHolds = new Map(
        retainedKeys.map((k) => [
          receiptKey(k.runtimeEpoch, k.operationId),
          k.authorityHold,
        ]),
      );
      fixture.snapshot.retainedOperations = fixture.snapshot.temporary
        ? []
        : [...receipts.values()]
            .filter(({ receipt }) =>
              ["pending", "unknown"].includes(receipt.effect),
            )
            .map(
              ({
                receipt: {
                  runtimeEpoch,
                  operationId,
                  type,
                  workspaceId,
                  sessionId,
                },
              }) => ({
                runtimeEpoch,
                operationId,
                type,
                authorityHold:
                  priorHolds.get(receiptKey(runtimeEpoch, operationId)) ?? true,
                ...(workspaceId && { workspaceId }),
                ...(sessionId && { sessionId }),
              }),
            );
      // Preserve explicitly projected holds (including confirmed ACKs) and
      // deliberately released unknown rows until the synthetic owner removes them.
      // This map is not IO, journal, Native settlement or recovery-ticket proof.
      for (const k of retainedKeys)
        if (
          !fixture.snapshot.retainedOperations.some(
            (x) =>
              x.runtimeEpoch === k.runtimeEpoch &&
              x.operationId === k.operationId,
          )
        )
          fixture.snapshot.retainedOperations.push(clone(k));
      if (!fixture.sessionMessages)
        return {
          ok: true,
          value: validateSnapshot(
            runtimeSnapshot(fixture, clone(fixture.snapshot)),
          ),
        };
      const workspaceId =
        request.workspaceId ?? fixture.snapshot.selectedWorkspaceId;
      const sessionId = request.sessionId ?? fixture.snapshot.selectedSessionId;
      if (
        !fixture.snapshot.sessions.some(
          (s) => s.id === sessionId && s.workspaceId === workspaceId,
        )
      )
        return failure("NOT_FOUND");
      return { ok: true, value: selectedSnapshot(workspaceId, sessionId) };
    }
    if (
      fixture.workspaceFileState &&
      ["file.list", "file.read"].includes(request.type)
    ) {
      const workspace = fixture.snapshot.workspaces.find(
        (w) => w.id === request.workspaceId,
      );
      if (!workspace) return failure("NOT_FOUND");
      if (request.type === "file.list")
        return {
          ok: true,
          value: {
            path: request.path ?? "",
            entries: [
              "notes/SYNTHETIC-editor.txt",
              "notes/SYNTHETIC-other.txt",
              "notes/odd:name.txt",
              "AGENTS.md",
            ].map((path) => ({ name: path, path, type: "file" })),
          },
        };
      fixture.workspaceFilePreviews.push(clone(request));
      const content = fixture.workspaceFiles.get(
        fixture.workspaceFileKey(workspace.id, request.path),
      );
      return content === undefined
        ? failure("NOT_FOUND")
        : {
            ok: true,
            value: { path: request.path, content, truncated: false },
          };
    }
    if (
      [
        "catalog.list",
        "file.list",
        "file.read",
        "file.edit.read",
        "configuration.read",
        "configuration.instructions.read",
        "configuration.mcp.read",
        "configuration.extensions.read",
        "configuration.agent.list",
        "configuration.agent.read",
        "configuration.agent.runtime.read",
        "configuration.skill.list",
        "configuration.skill.read",
        "configuration.skill.runtime.read",
      ].includes(request.type) &&
      (fixture.snapshot.recovery.store.state !== "ready" ||
        fixture.snapshot.recovery.resources.some(
          (r) => r.workspaceId === request.workspaceId,
        ))
    )
      return failure("UNAVAILABLE");
    if (request.type === "file.edit.read") {
      if (fixture.pendingWorkspaceFiles.has(request.workspaceId))
        return failure("BUSY");
      const workspace = fixture.snapshot.workspaces.find(
        (w) => w.id === request.workspaceId,
      );
      if (!workspace) return failure("NOT_FOUND");
      if (!workspace.trusted) return failure("INVALID_SELECTION");
      const value = clone(
        observeWorkspaceFile(fixture, workspace, request.path),
      );
      if (fixture.holdWorkspaceFileReads)
        return new Promise((resolve) =>
          fixture.heldWorkspaceFileReads.push(() =>
            resolve({ ok: true, value }),
          ),
        );
      return { ok: true, value };
    }
    if (request.type === "configuration.extensions.read")
      return readExtensionFixture(fixture, request);
    if (request.type.startsWith("configuration.agent.")) {
      if (
        request.type === "configuration.agent.runtime.read" &&
        fixture.holdAgentRuntimeReads
      )
        return new Promise((resolve) =>
          fixture.heldAgentRuntimeReads.push(() =>
            resolve(readResult(request)),
          ),
        );
      return readAgentFixture(fixture, request, epoch);
    }
    if (request.type === "configuration.skill.runtime.read") {
      if (fixture.holdSkillRuntimeReads)
        return new Promise((resolve) =>
          fixture.heldSkillRuntimeReads.push(() =>
            resolve(readResult(request)),
          ),
        );
      const workspace = fixture.snapshot.workspaces.find(
        (w) => w.id === request.workspaceId,
      );
      if (!workspace) return failure("NOT_FOUND");
      if (!workspace.trusted) return failure("INVALID_SELECTION");
      if (fixture.snapshot.state !== "connected") return failure("UNAVAILABLE");
      const base = {
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        runtimeEpoch: epoch,
      };
      if (fixture.skillRuntimeState === "unavailable")
        return {
          ok: true,
          value: { ...base, status: "unavailable", reason: "runtime_error" },
        };
      if (
        request.sessionId &&
        !fixture.snapshot.sessions.some(
          (s) => s.id === request.sessionId && s.workspaceId === workspace.id,
        )
      )
        return failure("INVALID_SELECTION");
      let file;
      if (request.sourceName) {
        const read = observeSkillFile(fixture, workspace, request.sourceName);
        file =
          read.status === "available" && !skillFileWriteFits(read.content)
            ? {
                sourceName: request.sourceName,
                status: "unsupported",
                reason: "unsupported_content",
              }
            : read.status === "available"
              ? {
                  sourceName: request.sourceName,
                  status: "available",
                  version: read.version,
                  directoryVersion: read.directoryVersion,
                  digest: skillBytesDigest(read.content),
                }
              : {
                  sourceName: request.sourceName,
                  status: read.status,
                  reason: read.reason,
                };
      }
      const value = {
        ...base,
        status: "observed",
        observationId: `fixture-skill-observation-${++fixture.skillRuntimeSerial}`,
        owned: clone([...fixture.skillRuntimeRegistrations.values()]),
        unowned: clone(fixture.skillRuntimeUnowned),
        ...(file ? { file } : {}),
        ...(request.sessionId
          ? {
              session:
                fixture.skillRuntimeState === "history-unavailable"
                  ? {
                      sessionId: request.sessionId,
                      status: "unavailable",
                      reason: "history_truncated",
                    }
                  : {
                      sessionId: request.sessionId,
                      status: "observed",
                      messages: clone(
                        fixture.skillRuntimeHistory.get(request.sessionId) ??
                          [],
                      ),
                    },
            }
          : {}),
      };
      if (!validSkillRuntimeObservation(value))
        throw new Error("Invalid synthetic Skill observation");
      // Bound held observation authority just as the production owner does.
      while (fixture.skillRuntimeObservations.size >= 32)
        fixture.skillRuntimeObservations.delete(
          fixture.skillRuntimeObservations.keys().next().value,
        );
      fixture.skillRuntimeObservations.set(value.observationId, {
        value: clone(value),
        revision: fixture.snapshot.revision,
        trustRevision: workspace.trustRevision,
      });
      return { ok: true, value };
    }
    if (
      ["configuration.skill.list", "configuration.skill.read"].includes(
        request.type,
      )
    ) {
      const workspace = fixture.snapshot.workspaces.find(
        (w) => w.id === request.workspaceId,
      );
      if (!workspace) return failure("NOT_FOUND");
      if (!workspace.trusted) return failure("INVALID_SELECTION");
      if (fixture.snapshot.state !== "connected") return failure("UNAVAILABLE");
      if (request.type === "configuration.skill.read")
        return {
          ok: true,
          value: observeSkillFile(fixture, workspace, request.sourceName),
        };
      const base = {
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        path: join(workspace.path, ".opencode", "skills"),
      };
      if (fixture.skillListOutcome)
        return {
          ok: true,
          value: {
            ...base,
            status:
              fixture.skillListOutcome === "path_missing"
                ? "missing"
                : "unavailable",
            reason: fixture.skillListOutcome,
          },
        };
      const entries = [...fixture.skillDirectories.keys()]
        .map((key) => JSON.parse(key))
        .filter(([id, path]) => id === workspace.id && path === workspace.path)
        .map(([, , sourceName]) => ({
          sourceName,
          path: join(base.path, sourceName, "SKILL.md"),
        }))
        .slice(0, SKILL_LIMITS.entries);
      return {
        ok: true,
        value: {
          ...base,
          status: "available",
          entries,
          truncated: fixture.skillListTruncated,
        },
      };
    }
    if (request.type === "configuration.mcp.read") {
      const workspace = fixture.snapshot.workspaces.find(
        (w) => w.id === request.workspaceId,
      );
      if (!workspace) return failure("NOT_FOUND");
      if (!workspace.trusted) return failure("INVALID_SELECTION");
      if (fixture.snapshot.state !== "connected") return failure("UNAVAILABLE");
      const rows = fixture.mcpCatalog.get(workspace.id) ?? new Map();
      return {
        ok: true,
        value: observeMcpCatalog(
          {
            location: { directory: workspace.path },
            data: [...rows].map(([name, status]) => ({
              name,
              status: { status },
            })),
          },
          {
            workspaceId: workspace.id,
            path: workspace.path,
            runtimeEpoch: epoch,
            owned: fixture.mcpRegistrations,
          },
        ),
      };
    }
    if (request.type === "configuration.instructions.read") {
      const workspace = fixture.snapshot.workspaces.find(
        (w) => w.id === request.workspaceId,
      );
      const session = fixture.snapshot.sessions.find(
        (s) =>
          s.id === request.sessionId && s.workspaceId === request.workspaceId,
      );
      if (!workspace || !session) return failure("NOT_FOUND");
      if (!workspace.trusted) return failure("INVALID_SELECTION");
      return {
        ok: true,
        value: {
          workspaceId: workspace.id,
          sessionId: session.id,
          ...observeInstructions(
            fixture.instructionEntries.get(session.id) ?? [],
            fixture.instructionRegistrations.get(session.id),
          ),
        },
      };
    }
    if (request.type === "configuration.read") {
      const workspace = fixture.snapshot.workspaces.find(
        (w) => w.id === request.workspaceId,
      );
      if (!workspace) return failure("NOT_FOUND");
      const base = {
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        kind: request.kind,
        path: join(
          workspace.path,
          request.kind === "instructions" ? "AGENTS.md" : "opencode.json",
        ),
      };
      const content = fixture.configurationFiles.get(
        JSON.stringify([workspace.id, request.kind]),
      );
      if (content === undefined)
        return {
          ok: true,
          value: { ...base, status: "missing", reason: "missing_file" },
        };
      if (!configurationFileContentFits(request.kind, content))
        return {
          ok: true,
          value: {
            ...base,
            status: "unsupported",
            reason: "unsupported_content",
          },
        };
      return {
        ok: true,
        value: {
          ...base,
          status: "available",
          content,
          version: createHash("sha256")
            .update(JSON.stringify([base, content]))
            .digest("hex"),
        },
      };
    }
    if (request.type === "catalog.list")
      return { ok: true, value: clone(fixture.catalog) };
    if (request.type === "diagnostics.list") {
      fixture.diagnosticReads.push(clone(request));
      const value = clone(fixture.diagnostics);
      value.events = value.events.filter(
        (event) =>
          (!request.workspaceId || event.workspaceId === request.workspaceId) &&
          (!request.sessionId || event.sessionId === request.sessionId),
      );
      const result = { ok: true, value };
      if (fixture.holdDiagnostics && !request.sessionId)
        return new Promise((resolve) =>
          fixture.heldDiagnostics.push(() => resolve(result)),
        );
      return result;
    }
    if (request.type === "file.list")
      return { ok: true, value: { path: request.path ?? "", entries: [] } };
    return failure("INVALID_REQUEST");
  }
  async function mutateMcp(envelope, input) {
    const request = envelope.operation,
      action = request.type.slice("configuration.mcp.".length);
    const receipt = {
      runtimeEpoch: epoch,
      operationId: envelope.operationId,
      type: request.type,
      workspaceId: request.workspaceId,
      admission: "admitted",
      delivery: "pending",
      effect: "none",
      revision: fixture.snapshot.revision,
      evidence: [],
    };
    receipts.set(receiptKey(epoch, envelope.operationId), {
      digest: input,
      receipt,
    });
    const workspace = fixture.snapshot.workspaces.find(
      (w) => w.id === request.workspaceId,
    );
    const observed = readResult({
      type: "configuration.mcp.read",
      workspaceId: request.workspaceId,
    });
    const nativeName = mcpNativeName(request.workspaceId, request.sourceName);
    const target = observed.value?.servers?.find(
      (row) => row.nativeName === nativeName,
    );
    let refused, normalized, sourceVersion;
    if (!observed.ok) refused = observed.code;
    else if (
      fixture.pendingMcpWorkspaces.has(workspace.id) ||
      fixture.snapshot.sessions.some(
        (s) =>
          s.workspaceId === workspace.id &&
          (s.status !== "idle" ||
            fixture.snapshot.permissions.some((p) => p.sessionId === s.id)),
      )
    )
      refused = "BUSY";
    else if (observed.value.status !== "observed") refused = "MCP_UNVERIFIED";
    else if (
      fixture.nextMcp === "changed" ||
      observed.value.version !== request.expectedObservationVersion
    )
      refused = "MCP_CHANGED";
    else if (action === "register") {
      if (target) refused = "MCP_OWNERSHIP_CONFLICT";
      else {
        const file = readResult({
          type: "configuration.read",
          workspaceId: workspace.id,
          kind: "mcp",
        });
        if (
          !file.ok ||
          file.value.status !== "available" ||
          file.value.content !== request.text ||
          file.value.version !== request.fileVersion
        )
          refused = "FILE_CHANGED";
        else
          try {
            normalized = await normalizeMcpDefinition(
              workspace.path,
              request.text,
              request.sourceName,
              {
                io: {
                  realpath: async (path) => path,
                  lstat: async () => ({
                    isDirectory: () => true,
                    isSymbolicLink: () => false,
                  }),
                },
              },
            );
            sourceVersion = file.value.version;
          } catch {
            refused = "MCP_UNSUPPORTED";
          }
      }
    } else if (target?.ownership !== "current_runtime")
      refused = "MCP_OWNERSHIP_CONFLICT";
    else if (
      target.status === "pending" ||
      (action === "connect" && target.status === "connected")
    )
      refused = "BUSY";
    else if (action !== "remove" && target.status === "absent")
      refused = "MCP_CHANGED";
    if (!refused && fixture.nextMcp === "denied") refused = "CANCELLED";
    const outcome = fixture.nextMcp;
    fixture.nextMcp = undefined;
    if (refused) {
      mutationCounts.rejected++;
      receipt.admission = "rejected";
      receipt.result = { kind: "rejected", code: refused };
      receipt.revision = ++fixture.snapshot.revision;
      return { ...failure(refused), receipt: clone(receipt) };
    }
    fixture.pendingMcpWorkspaces.add(workspace.id);
    fixture.requests.push(clone(request));
    mutationCounts.dispatched++;
    fixture.intents.push({
      runtimeEpoch: epoch,
      operationId: envelope.operationId,
      type: request.type,
      requestId: request.requestId,
    });
    receipt.admission = "dispatched";
    const finish = () => {
      fixture.pendingMcpWorkspaces.delete(workspace.id);
      let value;
      if (outcome === "unknown") {
        receipt.delivery = "unknown";
        receipt.effect = "unknown";
        fixture.snapshot.recovery.resources.push({
          workspaceId: workspace.id,
          state: "unavailable",
          reason: "unresolved_operation",
        });
        value = { requestId: request.requestId, status: "unknown" };
      } else {
        const rows = fixture.mcpCatalog.get(workspace.id) ?? new Map();
        fixture.mcpCatalog.set(workspace.id, rows);
        receipt.delivery = "accepted";
        receipt.effect = "confirmed";
        // Synthetic projection of the production receipt's required proof.
        receipt.evidence = [{ kind: "host-registry", id: workspace.id }];
        if (action === "register") {
          rows.set(nativeName, "disabled");
          fixture.mcpRegistrations.set(nativeName, {
            workspaceId: workspace.id,
            path: workspace.path,
            runtimeEpoch: epoch,
            sourceName: request.sourceName,
            digest: normalized.digest,
            sourceVersion,
            definition: normalized.definition,
          });
          receipt.result = {
            kind: "mcp_registered",
            workspaceId: workspace.id,
            sourceName: request.sourceName,
            nativeName,
            digest: normalized.digest,
            sourceVersion,
            status: "disabled",
          };
          value = {
            requestId: request.requestId,
            status: "registered_disabled",
            sourceName: request.sourceName,
            nativeName,
            digest: normalized.digest,
            sourceVersion,
          };
        } else if (action === "remove") {
          rows.delete(nativeName);
          fixture.mcpRegistrations.delete(nativeName);
          receipt.result = {
            kind: "mcp_removed",
            workspaceId: workspace.id,
            sourceName: request.sourceName,
            nativeName,
          };
          value = {
            requestId: request.requestId,
            status: "removed",
            sourceName: request.sourceName,
            nativeName,
          };
        } else {
          const status =
            action === "disconnect"
              ? "disabled"
              : ["failed", "needs_auth"].includes(outcome)
                ? outcome
                : "connected";
          rows.set(nativeName, status);
          receipt.result = {
            kind: "mcp_connection",
            workspaceId: workspace.id,
            sourceName: request.sourceName,
            nativeName,
            action,
            connectionStatus: status,
          };
          value = {
            requestId: request.requestId,
            status: "connection_status",
            sourceName: request.sourceName,
            nativeName,
            action,
            connectionStatus: status,
          };
        }
      }
      receipt.revision = ++fixture.snapshot.revision;
      return { ok: true, value, receipt: clone(receipt) };
    };
    if (fixture.holdMcp)
      return new Promise((resolve) =>
        fixture.heldMcp.push(() => resolve(finish())),
      );
    return finish();
  }
  function mutateSkillRuntime(envelope, input) {
    const request = envelope.operation,
      action = request.type.slice("configuration.skill.".length);
    const workspace = fixture.snapshot.workspaces.find(
      (w) => w.id === request.workspaceId,
    );
    const captured = fixture.skillRuntimeObservations.get(
      request.observationId,
    );
    const observed = captured?.value;
    const outcome = fixture.nextSkillRuntime;
    fixture.nextSkillRuntime = undefined;
    const receipt = {
      runtimeEpoch: epoch,
      operationId: envelope.operationId,
      type: request.type,
      workspaceId: request.workspaceId,
      ...(request.sessionId ? { sessionId: request.sessionId } : {}),
      admission: "admitted",
      delivery: "pending",
      effect: "none",
      revision: fixture.snapshot.revision,
      evidence: [],
    };
    receipts.set(receiptKey(epoch, envelope.operationId), {
      digest: input,
      receipt,
    });
    let row;
    const refuse = () => {
      if (!workspace) return "NOT_FOUND";
      if (!workspace.trusted) return "INVALID_SELECTION";
      if (fixture.snapshot.state !== "connected") return "UNAVAILABLE";
      if (
        fixture.snapshot.sessions.some(
          (s) => s.workspaceId === workspace.id && s.status !== "idle",
        ) ||
        fixture.snapshot.permissions.some((p) => p.workspaceId === workspace.id)
      )
        return "BUSY";
      if (
        !observed ||
        observed.workspaceId !== workspace.id ||
        observed.workspacePath !== workspace.path ||
        observed.runtimeEpoch !== epoch ||
        captured.revision !== fixture.snapshot.revision ||
        captured.trustRevision !== workspace.trustRevision ||
        outcome === "changed"
      )
        return "SKILL_CHANGED";
      if (action === "register") {
        const file = observeSkillFile(fixture, workspace, request.sourceName);
        if (file.status !== "available" || !skillFileWriteFits(file.content))
          return "SKILL_UNSUPPORTED";
        if (
          observed.file?.status !== "available" ||
          observed.file.sourceName !== request.sourceName ||
          request.version !== file.version ||
          request.directoryVersion !== file.directoryVersion ||
          request.digest !== skillBytesDigest(file.content) ||
          ["version", "directoryVersion", "digest"].some(
            (k) => observed.file[k] !== request[k],
          )
        )
          return "FILE_CHANGED";
        if (
          [...fixture.skillRuntimeRegistrations.values()].some(
            (r) => r.sourceName === request.sourceName,
          )
        )
          return "SKILL_OWNERSHIP_CONFLICT";
        row = fixtureSkillRow(
          fixture,
          workspace,
          request.sourceName,
          envelope.operationId,
        );
        if (
          fixture.skillRuntimeUnowned.some((r) => r.nativeId === row.nativeId)
        )
          return "SKILL_OWNERSHIP_CONFLICT";
      } else {
        row = fixture.skillRuntimeRegistrations.get(request.nativeId);
        if (
          !row ||
          row.registrationRuntimeEpoch !== epoch ||
          !observed.owned.some((r) => JSON.stringify(r) === JSON.stringify(row))
        )
          return "SKILL_OWNERSHIP_CONFLICT";
        if (action === "apply") {
          const session = fixture.snapshot.sessions.find(
            (s) => s.id === request.sessionId && s.workspaceId === workspace.id,
          );
          if (!session) return "INVALID_SELECTION";
          if (
            observed.session?.status !== "observed" ||
            observed.session.sessionId !== request.sessionId
          )
            return "SKILL_UNVERIFIED";
          if (
            (fixture.skillRuntimeHistory.get(request.sessionId) ?? []).some(
              (m) => m.nativeId === row.nativeId,
            )
          )
            return "SKILL_ALREADY_APPLIED";
        }
      }
      if (outcome === "denied") return "CANCELLED";
    };
    const reject = (code) => {
      mutationCounts.rejected++;
      receipt.admission = "rejected";
      receipt.result = { kind: "rejected", code };
      receipt.revision = ++fixture.snapshot.revision;
      validateSkillRuntimeReceipt(receipt);
      return { ...failure(code), receipt: clone(receipt) };
    };
    const refused = refuse();
    if (refused) return reject(refused);
    fixture.pendingSkillWorkspaces.add(workspace.id);
    const finish = () => {
      fixture.pendingSkillWorkspaces.delete(workspace.id);
      const changed = refuse();
      if (changed) return reject(changed);
      mutationCounts.dispatched++;
      fixture.requests.push(clone(request));
      fixture.intents.push({
        runtimeEpoch: epoch,
        operationId: envelope.operationId,
        type: request.type,
        requestId: request.requestId,
        step: skillRuntimeStep(request.type),
      });
      fixture.skillRuntimeEffects.push({
        action,
        nativeId: row.nativeId,
        operationId: envelope.operationId,
        ...(action === "apply"
          ? { sessionId: request.sessionId, resume: false }
          : {}),
      });
      receipt.admission = "dispatched";
      let value;
      if (outcome === "unknown") {
        receipt.delivery = "unknown";
        receipt.effect = "unknown";
        fixture.snapshot.recovery.resources.push({
          workspaceId: workspace.id,
          state: "unavailable",
          reason: "unresolved_operation",
        });
        value = { requestId: request.requestId, status: "unknown" };
      } else {
        const identity = Object.fromEntries(
          [
            "sourceName",
            "nativeId",
            "digest",
            "nativeDigest",
            "registrationRuntimeEpoch",
            "registrationOperationId",
          ].map((k) => [k, row[k]]),
        );
        let extra = {};
        if (action === "register") {
          fixture.skillRuntimeRegistrations.set(row.nativeId, clone(row));
          extra = {
            version: request.version,
            directoryVersion: request.directoryVersion,
            bodyDigest: row.bodyDigest,
          };
        } else if (action === "remove")
          fixture.skillRuntimeRegistrations.delete(row.nativeId);
        else {
          const nativeMessageId = `fixture-skill-message-${++fixture.skillRuntimeSerial}`;
          const messages =
            fixture.skillRuntimeHistory.get(request.sessionId) ?? [];
          fixture.skillRuntimeHistory.set(request.sessionId, [
            ...messages,
            {
              nativeId: row.nativeId,
              messageId: nativeMessageId,
              name: row.name,
              bodyDigest: row.bodyDigest,
            },
          ]);
          extra = {
            sessionId: request.sessionId,
            nativeSessionId: `native-${request.sessionId}`,
            nativeMessageId,
            bodyDigest: row.bodyDigest,
          };
        }
        value = {
          requestId: request.requestId,
          status: {
            register: "registered_disabled",
            remove: "removed",
            apply: "applied",
          }[action],
          ...identity,
          ...extra,
        };
        receipt.delivery = "accepted";
        receipt.effect = "confirmed";
        receipt.evidence = [{ kind: "host-registry", id: workspace.id }];
        receipt.result = {
          kind: {
            register: "skill_registered",
            remove: "skill_removed",
            apply: "skill_applied",
          }[action],
          workspaceId: workspace.id,
          ...identity,
          ...extra,
        };
      }
      fixture.skillRuntimeObservations.clear();
      receipt.revision = ++fixture.snapshot.revision;
      if (!validSkillRuntimeMutation(value))
        throw new Error("Invalid synthetic Skill mutation");
      validateSkillRuntimeReceipt(receipt);
      return { ok: true, value, receipt: clone(receipt) };
    };
    if (fixture.holdSkillRuntime)
      return new Promise((resolve) =>
        fixture.heldSkillRuntime.push(() => resolve(finish())),
      );
    return finish();
  }
  function mutateSkill(envelope, input) {
    const request = envelope.operation;
    const workspace = fixture.snapshot.workspaces.find(
      (w) => w.id === request.workspaceId,
    );
    const receipt = {
      runtimeEpoch: epoch,
      operationId: envelope.operationId,
      type: request.type,
      workspaceId: request.workspaceId,
      admission: "admitted",
      delivery: "pending",
      effect: "none",
      revision: fixture.snapshot.revision,
      evidence: [],
    };
    receipts.set(receiptKey(epoch, envelope.operationId), {
      digest: input,
      receipt,
    });
    const outcome = fixture.nextSkillSave;
    fixture.nextSkillSave = undefined;
    function refusal() {
      if (!workspace) return "NOT_FOUND";
      if (!workspace.trusted) return "INVALID_SELECTION";
      if (fixture.snapshot.state !== "connected") return "UNAVAILABLE";
      if (
        fixture.snapshot.sessions.some(
          (s) => s.workspaceId === workspace.id && s.status !== "idle",
        ) ||
        fixture.snapshot.permissions.some((p) => p.workspaceId === workspace.id)
      )
        return "BUSY";
      if (!skillFileWriteFits(request.text)) return "FILE_UNSUPPORTED";
      if (outcome === "denied") return "CANCELLED";
      const file = observeSkillFile(fixture, workspace, request.sourceName);
      if (
        request.directoryVersion !== file.directoryVersion ||
        (request.expectation === "version"
          ? file.status !== "available" || request.version !== file.version
          : file.status !== "missing")
      )
        return "FILE_CHANGED";
    }
    function reject(code) {
      mutationCounts.rejected++;
      receipt.admission = "rejected";
      receipt.result = { kind: "rejected", code };
      receipt.revision = ++fixture.snapshot.revision;
      return { ...failure(code), receipt: clone(receipt) };
    }
    const refused = refusal();
    if (refused) return reject(refused);
    fixture.pendingSkillWorkspaces.add(workspace.id);
    fixture.requests.push(clone(request));
    fixture.intents.push({
      runtimeEpoch: epoch,
      operationId: envelope.operationId,
      type: request.type,
      requestId: request.requestId,
    });
    mutationCounts.dispatched++;
    receipt.admission = "dispatched";
    const finish = () => {
      fixture.pendingSkillWorkspaces.delete(workspace.id);
      const changed = refusal();
      if (changed) return reject(changed);
      let value;
      if (outcome === "unknown") {
        receipt.delivery = "unknown";
        receipt.effect = "unknown";
        fixture.snapshot.recovery.resources.push({
          workspaceId: workspace.id,
          state: "unavailable",
          reason: "unresolved_operation",
        });
        value = { requestId: request.requestId, status: "unknown" };
      } else {
        const key = fixture.skillKey(workspace.id, request.sourceName);
        const prior = fixture.skillFiles.get(key);
        const backupId =
          prior === undefined
            ? undefined
            : configurationBackupId(epoch, envelope.operationId, "skill");
        if (backupId) fixture.skillBackups.set(backupId, prior);
        fixture.skillFiles.set(key, request.text);
        const file = observeSkillFile(fixture, workspace, request.sourceName);
        receipt.delivery = "accepted";
        receipt.effect = "confirmed";
        receipt.evidence = [{ kind: "host-registry", id: workspace.id }];
        receipt.result = {
          kind: "skill_file_saved",
          workspaceId: workspace.id,
          sourceName: request.sourceName,
          version: file.version,
          ...(backupId && { backupId }),
        };
        value = {
          requestId: request.requestId,
          status: "saved",
          version: file.version,
          ...(backupId && { backupId }),
        };
      }
      receipt.revision = ++fixture.snapshot.revision;
      return { ok: true, value, receipt: clone(receipt) };
    };
    if (fixture.holdSkillSave)
      return new Promise((resolve) =>
        fixture.heldSkillSaves.push(() => resolve(finish())),
      );
    return finish();
  }
  function mutateAgent(envelope, input) {
    const request = envelope.operation,
      runtime = Boolean(agentRuntimeStep(request.type));
    const register = request.type === "configuration.agent.register";
    const workspace = fixture.snapshot.workspaces.find(
      (w) => w.id === request.workspaceId,
    );
    const captured = fixture.agentRuntimeObservations.get(
      request.observationId,
    );
    const observed = captured?.value;
    const outcome = runtime ? fixture.nextAgentRuntime : fixture.nextAgentSave;
    if (runtime) fixture.nextAgentRuntime = undefined;
    else fixture.nextAgentSave = undefined;
    const receipt = {
      runtimeEpoch: epoch,
      operationId: envelope.operationId,
      type: request.type,
      workspaceId: request.workspaceId,
      admission: "admitted",
      delivery: "pending",
      effect: "none",
      revision: fixture.snapshot.revision,
      evidence: [],
    };
    receipts.set(receiptKey(epoch, envelope.operationId), {
      digest: input,
      receipt,
    });
    let row;
    const refuse = () => {
      if (!workspace) return "NOT_FOUND";
      if (!workspace.trusted) return "INVALID_SELECTION";
      if (fixture.snapshot.state !== "connected") return "UNAVAILABLE";
      if (
        fixture.snapshot.sessions.some(
          (s) => s.workspaceId === workspace.id && s.status !== "idle",
        ) ||
        fixture.snapshot.permissions.some((p) => p.workspaceId === workspace.id)
      )
        return "BUSY";
      if (outcome === "denied") return "CANCELLED";
      if (!runtime) {
        if (!agentFileWriteFits(request.text)) return "FILE_UNSUPPORTED";
        const file = observeAgentFile(fixture, workspace, request.sourceName);
        if (
          request.directoryVersion !== file.directoryVersion ||
          (request.expectation === "version"
            ? file.status !== "available" || request.version !== file.version
            : file.status !== "missing")
        )
          return "FILE_CHANGED";
        return;
      }
      if (fixture.agentRuntimeState === "references-unavailable")
        return "AGENT_UNVERIFIED";
      if (
        !observed ||
        observed.status !== "observed" ||
        observed.workspaceId !== workspace.id ||
        observed.workspacePath !== workspace.path ||
        observed.runtimeEpoch !== epoch ||
        captured.revision !== fixture.snapshot.revision ||
        captured.trustRevision !== workspace.trustRevision ||
        observed.defaultAgentId !== fixture.agentRuntimeDefaultId
      )
        return "AGENT_CHANGED";
      if (register) {
        const file = observeAgentFile(fixture, workspace, request.sourceName);
        if (file.status !== "available" || !agentFileWriteFits(file.content))
          return "AGENT_UNSUPPORTED";
        if (
          observed.file?.status !== "available" ||
          observed.file.sourceName !== request.sourceName ||
          request.version !== file.version ||
          request.directoryVersion !== file.directoryVersion ||
          request.digest !== agentBytesDigest(file.content) ||
          ["version", "directoryVersion", "digest"].some(
            (k) => observed.file[k] !== request[k],
          )
        )
          return "FILE_CHANGED";
        if (
          [...fixture.agentRuntimeRegistrations.values()].some(
            (r) => r.sourceName === request.sourceName,
          )
        )
          return "AGENT_OWNERSHIP_CONFLICT";
        row = fixtureAgentRow(
          fixture,
          workspace,
          request.sourceName,
          envelope.operationId,
        );
        if (
          fixture.agentRuntimeUnowned.some((r) => r.nativeId === row.nativeId)
        )
          return "AGENT_OWNERSHIP_CONFLICT";
      } else {
        row = fixture.agentRuntimeRegistrations.get(request.nativeId);
        if (
          !row ||
          row.registrationRuntimeEpoch !== epoch ||
          !observed.owned.some((r) =>
            Object.keys(row)
              .filter((k) => k !== "referenceCount")
              .every((k) => JSON.stringify(r[k]) === JSON.stringify(row[k])),
          )
        )
          return "AGENT_OWNERSHIP_CONFLICT";
        // All virtual Native sessions count, including archived and foreign ones.
        if (
          fixture.agentRuntimeReferences.some(
            (r) => r.nativeId === row.nativeId,
          )
        )
          return "AGENT_IN_USE";
      }
    };
    const reject = (code) => {
      mutationCounts.rejected++;
      receipt.admission = "rejected";
      receipt.result = { kind: "rejected", code };
      receipt.revision = ++fixture.snapshot.revision;
      validateAgentRuntimeReceipt(receipt);
      return { ...failure(code), receipt: clone(receipt) };
    };
    const refused = refuse();
    if (refused) return reject(refused);
    fixture.pendingAgentWorkspaces.add(workspace.id);
    const finish = () => {
      fixture.pendingAgentWorkspaces.delete(workspace.id);
      const changed = refuse();
      if (changed) return reject(changed);
      mutationCounts.dispatched++;
      fixture.requests.push(clone(request));
      fixture.intents.push({
        runtimeEpoch: epoch,
        operationId: envelope.operationId,
        requestId: request.requestId,
        type: request.type,
        ...(runtime && { step: agentRuntimeStep(request.type) }),
      });
      receipt.admission = "dispatched";
      if (runtime)
        fixture.agentRuntimeEffects.push({
          action: register ? "register" : "remove",
          nativeId: row.nativeId,
          operationId: envelope.operationId,
          ...(register && {
            request: { settings: {}, headers: {}, body: {} },
            permissions: clone(BASELINE_POLICY),
            mode: "primary",
            hidden: false,
          }),
        });
      let value;
      if (outcome === "unknown") {
        receipt.delivery = "unknown";
        receipt.effect = "unknown";
        fixture.snapshot.recovery.resources.push({
          workspaceId: workspace.id,
          state: "unavailable",
          reason: "unresolved_operation",
        });
        value = { requestId: request.requestId, status: "unknown" };
      } else {
        receipt.delivery = "accepted";
        receipt.effect = "confirmed";
        receipt.evidence = [{ kind: "host-registry", id: workspace.id }];
        if (runtime) {
          if (register)
            fixture.agentRuntimeRegistrations.set(row.nativeId, clone(row));
          else fixture.agentRuntimeRegistrations.delete(row.nativeId);
          const fields = Object.fromEntries(
            [
              "sourceName",
              "nativeId",
              "digest",
              "nativeDigest",
              "registrationRuntimeEpoch",
              "registrationOperationId",
              "systemDigest",
            ].map((k) => [k, row[k]]),
          );
          const extra = {
            defaultAgentId: fixture.agentRuntimeDefaultId,
            ...(register && {
              version: request.version,
              directoryVersion: request.directoryVersion,
            }),
          };
          value = {
            requestId: request.requestId,
            status: register ? "registered_primary" : "removed",
            ...fields,
            ...extra,
          };
          receipt.result = {
            kind: register ? "agent_registered" : "agent_removed",
            workspaceId: workspace.id,
            ...fields,
            ...extra,
          };
        } else {
          const key = fixture.agentKey(workspace.id, request.sourceName),
            prior = fixture.agentFiles.get(key);
          const backupId =
            prior === undefined
              ? undefined
              : agentBackupId(epoch, envelope.operationId);
          if (backupId) fixture.agentBackups.set(backupId, prior);
          fixture.agentFiles.set(key, request.text);
          const file = observeAgentFile(fixture, workspace, request.sourceName);
          value = {
            requestId: request.requestId,
            status: "saved",
            version: file.version,
            ...(backupId && { backupId }),
          };
          receipt.result = {
            kind: "agent_file_saved",
            workspaceId: workspace.id,
            sourceName: request.sourceName,
            version: file.version,
            ...(backupId && { backupId }),
          };
        }
      }
      fixture.agentRuntimeObservations.clear();
      receipt.revision = ++fixture.snapshot.revision;
      if (runtime && !validAgentRuntimeMutation(value))
        throw new Error("Invalid synthetic Agent mutation");
      if (
        !runtime &&
        receipt.effect === "confirmed" &&
        !validAgentSavedResult(receipt, request.sourceName)
      )
        throw new Error("Invalid synthetic Agent save receipt");
      validateAgentRuntimeReceipt(receipt);
      return { ok: true, value, receipt: clone(receipt) };
    };
    if (runtime ? fixture.holdAgentRuntime : fixture.holdAgentSave)
      return new Promise((resolve) =>
        (runtime ? fixture.heldAgentRuntime : fixture.heldAgentSaves).push(() =>
          resolve(finish()),
        ),
      );
    return finish();
  }
  function mutateWorkspaceFile(envelope) {
    const request = envelope.operation,
      originalEpoch = envelope.runtimeEpoch;
    const input = workspaceFileAdmissionDigest(
      request,
      envelope.expectedRevision,
    );
    const key = receiptKey(originalEpoch, envelope.operationId),
      existing = receipts.get(key);
    if (existing)
      return existing.digest === input
        ? {
            ok: true,
            value: { status: "duplicate" },
            receipt: clone(existing.receipt),
          }
        : failure("DUPLICATE_CONFLICT");
    if (envelope.expectedRevision !== fixture.snapshot.revision)
      return failure("STALE_REVISION");
    const workspace = fixture.snapshot.workspaces.find(
      (w) => w.id === request.workspaceId,
    );
    const outcome = fixture.nextWorkspaceFileSave;
    fixture.nextWorkspaceFileSave = undefined;
    const receipt = {
      runtimeEpoch: originalEpoch,
      operationId: envelope.operationId,
      type: request.type,
      workspaceId: request.workspaceId,
      admission: "admitted",
      delivery: "pending",
      effect: "none",
      revision: fixture.snapshot.revision,
      evidence: [],
    };
    const blocked = () =>
      fixture.snapshot.recovery.store.state !== "ready" ||
      fixture.snapshot.recovery.resources.some(
        (r) => r.workspaceId === request.workspaceId,
      );
    const refusal = () => {
      if (!workspace) return "NOT_FOUND";
      if (!workspace.trusted) return "INVALID_SELECTION";
      if (outcome === "save-denied") return "FILE_DENIED";
      const current = observeWorkspaceFile(fixture, workspace, request.path);
      if (current.status !== "available")
        return current.reason === "path_denied"
          ? "FILE_DENIED"
          : ["missing_file", "path_missing", "file_changed"].includes(
                current.reason,
              )
            ? "FILE_CHANGED"
            : current.reason === "too_large"
              ? "FILE_TOO_LARGE"
              : "FILE_UNSUPPORTED";
      if (
        current.version !== request.version ||
        current.directoryVersion !== request.directoryVersion
      )
        return "FILE_CHANGED";
    };
    const reject = (code) => {
      mutationCounts.rejected++;
      receipt.admission = "rejected";
      receipt.delivery = "pending";
      receipt.result = { kind: "rejected", code };
      receipt.revision = ++fixture.snapshot.revision;
      validateFileReceipt(receipt);
      return { ...failure(code), receipt: clone(receipt) };
    };
    if (blocked()) return failure("UNAVAILABLE");
    if (
      fixture.pendingWorkspaceFiles.has(request.workspaceId) ||
      fixture.snapshot.sessions.some(
        (s) => s.workspaceId === request.workspaceId && s.status !== "idle",
      ) ||
      fixture.snapshot.permissions.some(
        (p) =>
          p.workspaceId === request.workspaceId ||
          fixture.snapshot.sessions.some(
            (s) =>
              s.id === p.sessionId && s.workspaceId === request.workspaceId,
          ),
      )
    )
      return failure("BUSY");
    receipts.set(key, { digest: input, receipt });
    if (outcome === "external-changed")
      fixture.workspaceFiles.set(
        fixture.workspaceFileKey(workspace.id, request.path),
        "SYNTHETIC EXTERNAL CHANGE\n",
      );
    const refused = refusal();
    if (refused) return reject(refused);
    fixture.pendingWorkspaceFiles.add(workspace.id);
    fixture.requests.push(clone(request));
    // Identity-only retained intent. Never store the text or full root here.
    fixture.intents.push({
      runtimeEpoch: originalEpoch,
      operationId: envelope.operationId,
      type: request.type,
      workspaceId: workspace.id,
      path: request.path,
    });
    mutationCounts.dispatched++;
    receipt.admission = "dispatched";
    const finish = () => {
      fixture.pendingWorkspaceFiles.delete(workspace.id);
      let value;
      if (
        outcome === "unknown" ||
        blocked() ||
        refusal() ||
        fixture.snapshot.runtimeEpoch !== originalEpoch ||
        workspace.path !== originalRoot
      ) {
        receipt.delivery = "unknown";
        receipt.effect = "unknown";
        if (
          !fixture.snapshot.recovery.resources.some(
            (r) => r.workspaceId === workspace.id,
          )
        )
          fixture.snapshot.recovery.resources.push({
            workspaceId: workspace.id,
            state: "unavailable",
            reason: "unresolved_operation",
          });
        value = { requestId: request.requestId, status: "unknown" };
      } else {
        const fileKey = fixture.workspaceFileKey(workspace.id, request.path);
        const backupId = fileBackupId(originalEpoch, envelope.operationId);
        fixture.workspaceFileBackups.set(
          backupId,
          fixture.workspaceFiles.get(fileKey),
        );
        fixture.workspaceFiles.set(fileKey, request.text);
        const observed = observeWorkspaceFile(fixture, workspace, request.path);
        receipt.delivery = "accepted";
        receipt.effect = "confirmed";
        receipt.evidence = [{ kind: "host-registry", id: workspace.id }];
        receipt.result = {
          kind: "file_saved",
          workspaceId: workspace.id,
          path: request.path,
          version: observed.version,
          digest: input,
          backupId,
        };
        value = {
          requestId: request.requestId,
          status: "saved",
          version: observed.version,
          backupId,
        };
      }
      receipt.revision = ++fixture.snapshot.revision;
      validateFileReceipt(receipt);
      return {
        ok: true,
        value: validateWorkspaceFileSave(value),
        receipt: clone(receipt),
      };
    };
    const originalRoot = workspace.path;
    if (fixture.holdWorkspaceFileSave)
      return new Promise((resolve) => {
        let result;
        const complete = () => {
          result ??= finish();
        };
        fixture.workspaceFileCompletions.push(complete);
        fixture.heldWorkspaceFileSaves.push(() => {
          const index = fixture.workspaceFileCompletions.indexOf(complete);
          if (index >= 0) fixture.workspaceFileCompletions.splice(index, 1);
          complete();
          resolve(result);
        });
      });
    return finish();
  }
  function mutateGitCommit(envelope) {
    const request = validateGitCommitRequest(envelope.operation);
    const originalEpoch = envelope.runtimeEpoch;
    const originalDigest = workspaceFileAdmissionDigest(
      request,
      envelope.expectedRevision,
    );
    const key = receiptKey(originalEpoch, envelope.operationId);
    const existing = receipts.get(key);
    if (existing)
      return existing.digest === originalDigest
        ? {
            ok: true,
            value: { status: "duplicate" },
            receipt: clone(existing.receipt),
          }
        : failure("DUPLICATE_CONFLICT");
    if (envelope.expectedRevision !== fixture.snapshot.revision)
      return failure("STALE_REVISION");
    const workspace = fixture.snapshot.workspaces.find(
      (w) => w.id === request.workspaceId,
    );
    if (!workspace) return failure("NOT_FOUND");
    if (
      gitHeld(fixture, workspace.id) ||
      fixture.pendingGitCommitReadWorkspaces.size
    )
      return failure("UNAVAILABLE");
    const target = gitCommitTargetFromApply(request);
    const record = fixture.gitCommitPreviews.get(request.previewId);
    const scope = gitScope(fixture, workspace);
    const original = fixture.syntheticGitCommits.get(workspace.id);
    const receipt = {
      runtimeEpoch: originalEpoch,
      operationId: envelope.operationId,
      type: request.type,
      workspaceId: workspace.id,
      admission: "admitted",
      delivery: "pending",
      effect: "none",
      revision: fixture.snapshot.revision,
      evidence: [],
    };
    const outcome = fixture.nextGitCommitApply;
    fixture.nextGitCommitApply = undefined;
    const reject = (code) => {
      mutationCounts.rejected++;
      receipt.admission = "rejected";
      receipt.result = { kind: "rejected", code };
      receipt.revision = ++fixture.snapshot.revision;
      receipts.set(key, { digest: originalDigest, receipt });
      validateGitCommitReceipt(receipt);
      return { ...failure(code), receipt: clone(receipt) };
    };
    if (!workspace.trusted) return reject("INVALID_SELECTION");
    if (
      fixture.snapshot.sessions.some(
        (s) => s.workspaceId === workspace.id && s.status !== "idle",
      )
    )
      return reject("BUSY");
    if (
      !record ||
      record.sender !== gitSender ||
      JSON.stringify(record.scope) !== JSON.stringify(scope) ||
      record.trustRevision !== workspace.trustRevision ||
      JSON.stringify(record.target) !== JSON.stringify(target) ||
      record.sourceDigest !== original?.digest
    )
      return reject("FILE_CHANGED");
    if (outcome === "denied") return reject("CANCELLED");
    if (
      fixture.gitNow - record.at >= GIT_COMMIT_LIMITS.previewMs ||
      ["expired_preview", "stale_preview"].includes(outcome)
    )
      return reject("FILE_CHANGED");
    if (original.marker || outcome === "unsupported_commit_state")
      return reject("FILE_UNSUPPORTED");
    if (outcome === "lock_conflict") return reject("BUSY");
    fixture.gitCommitPreviews.delete(request.previewId);
    fixture.pendingGitCommitWorkspaces.add(workspace.id);
    // Byte-free key projection holds the original invocation independently of
    // receipt settlement. This is synthetic lifecycle state, not durable proof.
    fixture.snapshot.retainedOperations.push({
      authorityHold: true,
      runtimeEpoch: originalEpoch,
      operationId: envelope.operationId,
      type: request.type,
      workspaceId: workspace.id,
    });
    fixture.requests.push(clone(request));
    fixture.intents.push({
      runtimeEpoch: originalEpoch,
      operationId: envelope.operationId,
      type: request.type,
      workspaceId: workspace.id,
      gitCommitTarget: clone(target),
      digest: originalDigest,
    });
    mutationCounts.dispatched++;
    receipt.admission = "dispatched";
    receipts.set(key, { digest: originalDigest, receipt });
    let result;
    const complete = () => {
      if (result) return;
      let value;
      if (
        outcome === "unknown" ||
        fixture.snapshot.runtimeEpoch !== originalEpoch ||
        workspace.path !== scope.workspacePath ||
        !workspace.trusted ||
        workspace.trustRevision !== record.trustRevision ||
        fixture.snapshot.state !== "connected" ||
        fixture.snapshot.recovery.store.state !== "ready" ||
        fixture.snapshot.recovery.resources.some(
          (r) => r.workspaceId === workspace.id,
        ) ||
        original.marker ||
        fixture.syntheticGitCommits.get(workspace.id)?.digest !==
          record.sourceDigest ||
        fixture.snapshot.sessions.some(
          (s) => s.workspaceId === workspace.id && s.status !== "idle",
        )
      ) {
        receipt.delivery = receipt.effect = "unknown";
        if (
          !fixture.snapshot.recovery.resources.some(
            (r) => r.workspaceId === workspace.id,
          )
        )
          fixture.snapshot.recovery.resources.push({
            workspaceId: workspace.id,
            state: "unavailable",
            reason: "unresolved_operation",
          });
        value = { requestId: request.requestId, status: "unknown" };
      } else {
        const backups = gitCommitExpectedBackups(
          target,
          originalEpoch,
          envelope.operationId,
        );
        for (const b of backups)
          if (b.backupId)
            fixture.syntheticGitCommitBackups.set(b.backupId, {
              syntheticOnly: true,
              role: b.role,
              digest: record.sourceDigest,
            });
        fixture.syntheticGitCommits.set(workspace.id, {
          ...clone(original),
          headOid: target.commitOid,
          digest: target.previewDigest,
          changes: {},
        });
        fixture.gitCommitEffects.push({
          syntheticOnly: true,
          workspaceId: workspace.id,
          operationId: envelope.operationId,
          target: clone(target),
        });
        receipt.delivery = "accepted";
        receipt.effect = "confirmed";
        receipt.evidence = [{ kind: "host-registry", id: workspace.id }];
        receipt.result = {
          kind: "git_commit_created",
          workspaceId: workspace.id,
          commitOid: target.commitOid,
          treeOid: target.treeOid,
          parentOid: target.headOid,
          referenceDigest: target.reference.nextDigest,
          logDigests: target.logs.map((x) => ({
            role: x.role,
            digest: x.nextDigest,
          })),
          previewDigest: target.previewDigest,
          backups,
          digest: originalDigest,
        };
        if (!validGitCommitCreatedResult(receipt, target, originalDigest))
          throw new Error("Invalid synthetic commit receipt binding");
        value = {
          requestId: request.requestId,
          status: "committed",
          commitOid: target.commitOid,
          treeOid: target.treeOid,
          referenceDigest: target.reference.nextDigest,
          logDigests: clone(receipt.result.logDigests),
          backups: clone(backups),
        };
      }
      receipt.revision = ++fixture.snapshot.revision;
      validateGitCommitReceipt(receipt);
      result = {
        ok: true,
        value: validateGitCommitMutationResult(value),
        receipt: clone(receipt),
      };
    };
    const finish = () => {
      try {
        complete();
        return result;
      } finally {
        fixture.pendingGitCommitWorkspaces.delete(workspace.id);
        if (receipt.effect === "confirmed")
          fixture.snapshot.retainedOperations =
            fixture.snapshot.retainedOperations.filter(
              (k) =>
                k.runtimeEpoch !== originalEpoch ||
                k.operationId !== envelope.operationId,
            );
      }
    };
    if (fixture.holdGitCommitApply)
      return new Promise((resolve) => {
        fixture.gitCommitCompletions.push(complete);
        fixture.heldGitCommitApplies.push(() => {
          const i = fixture.gitCommitCompletions.indexOf(complete);
          if (i >= 0) fixture.gitCommitCompletions.splice(i, 1);
          resolve(finish());
        });
      });
    return finish();
  }
  function mutateGitBranchRestore(envelope) {
    const request = validateGitBranchRestoreRequest(envelope.operation);
    const originalEpoch = envelope.runtimeEpoch;
    const originalDigest = workspaceFileAdmissionDigest(
      request,
      envelope.expectedRevision,
    );
    const key = receiptKey(originalEpoch, envelope.operationId);
    const existing = receipts.get(key);
    if (existing)
      return existing.digest === originalDigest
        ? {
            ok: true,
            value: { status: "duplicate" },
            receipt: clone(existing.receipt),
          }
        : failure("DUPLICATE_CONFLICT");
    if (envelope.expectedRevision !== fixture.snapshot.revision)
      return failure("STALE_REVISION");
    const workspace = fixture.snapshot.workspaces.find(
      (w) => w.id === request.workspaceId,
    );
    if (!workspace) return failure("NOT_FOUND");
    if (
      gitHeld(fixture, workspace.id) ||
      fixture.pendingGitBranchRestoreReadWorkspaces.size
    )
      return failure("UNAVAILABLE");
    const target = gitBranchRestoreTargetFromApply(request);
    const record = fixture.gitBranchRestorePreviews.get(request.previewId);
    const scope = gitScope(fixture, workspace);
    const original = fixture.syntheticGitBranchRestores.get(workspace.id);
    const receipt = {
      runtimeEpoch: originalEpoch,
      operationId: envelope.operationId,
      type: request.type,
      workspaceId: workspace.id,
      admission: "admitted",
      delivery: "pending",
      effect: "none",
      revision: fixture.snapshot.revision,
      evidence: [],
    };
    const outcome = fixture.nextGitBranchRestoreApply;
    fixture.nextGitBranchRestoreApply = undefined;
    const reject = (code) => {
      mutationCounts.rejected++;
      receipt.admission = "rejected";
      receipt.result = { kind: "rejected", code };
      receipt.revision = ++fixture.snapshot.revision;
      receipts.set(key, { digest: originalDigest, receipt });
      validateGitBranchRestoreReceipt(receipt);
      return { ...failure(code), receipt: clone(receipt) };
    };
    if (!workspace.trusted) return reject("INVALID_SELECTION");
    if (
      fixture.snapshot.sessions.some(
        (s) => s.workspaceId === workspace.id && s.status !== "idle",
      )
    )
      return reject("BUSY");
    if (
      !record ||
      record.sender !== gitSender ||
      JSON.stringify(record.scope) !== JSON.stringify(scope) ||
      record.trustRevision !== workspace.trustRevision ||
      JSON.stringify(record.target) !== JSON.stringify(target) ||
      record.sourceDigest !== original?.digest
    )
      return reject("FILE_CHANGED");
    if (record.value.revision !== envelope.expectedRevision)
      return reject("FILE_CHANGED");
    if (branchRestoreRefusal(original, record.request))
      return reject("FILE_UNSUPPORTED");
    if (outcome === "denied") return reject("CANCELLED");
    if (
      fixture.gitNow - record.at >= GIT_BRANCH_RESTORE_LIMITS.previewMs ||
      ["expired_preview", "stale_preview"].includes(outcome)
    )
      return reject("FILE_CHANGED");
    if (
      original.markers.length ||
      outcome === "unsupported_branch_restore_state"
    )
      return reject("FILE_UNSUPPORTED");
    if (outcome === "lock_conflict") return reject("BUSY");
    fixture.gitBranchRestorePreviews.delete(request.previewId);
    fixture.pendingGitBranchRestoreWorkspaces.add(workspace.id);
    // Byte-free key projection holds the original invocation independently of
    // receipt settlement. This is synthetic lifecycle state, not durable proof.
    fixture.snapshot.retainedOperations.push({
      authorityHold: true,
      runtimeEpoch: originalEpoch,
      operationId: envelope.operationId,
      type: request.type,
      workspaceId: workspace.id,
    });
    fixture.requests.push(clone(request));
    fixture.intents.push({
      runtimeEpoch: originalEpoch,
      operationId: envelope.operationId,
      type: request.type,
      workspaceId: workspace.id,
      gitBranchRestoreTarget: clone(target),
      digest: originalDigest,
    });
    mutationCounts.dispatched++;
    receipt.admission = "dispatched";
    receipts.set(key, { digest: originalDigest, receipt });
    let result;
    const complete = () => {
      if (result) return;
      let value;
      if (
        outcome === "unknown" ||
        fixture.snapshot.runtimeEpoch !== originalEpoch ||
        workspace.path !== scope.workspacePath ||
        !workspace.trusted ||
        workspace.trustRevision !== record.trustRevision ||
        fixture.snapshot.state !== "connected" ||
        fixture.snapshot.recovery.store.state !== "ready" ||
        fixture.snapshot.recovery.resources.some(
          (r) => r.workspaceId === workspace.id,
        ) ||
        branchRestoreRefusal(original, record.request) ||
        fixture.syntheticGitBranchRestores.get(workspace.id)?.digest !==
          record.sourceDigest ||
        fixture.snapshot.sessions.some(
          (s) => s.workspaceId === workspace.id && s.status !== "idle",
        )
      ) {
        receipt.delivery = receipt.effect = "unknown";
        if (
          !fixture.snapshot.recovery.resources.some(
            (r) => r.workspaceId === workspace.id,
          )
        )
          fixture.snapshot.recovery.resources.push({
            workspaceId: workspace.id,
            state: "unavailable",
            reason: "unresolved_operation",
          });
        value = { requestId: request.requestId, status: "unknown" };
      } else {
        const backups = gitBranchRestoreExpectedBackups(
          target,
          originalEpoch,
          envelope.operationId,
        );
        for (const b of backups)
          if (b.backupId)
            fixture.syntheticGitBranchRestoreBackups.set(b.backupId, {
              syntheticOnly: true,
              role: b.role,
              path: b.path,
              original: clone(
                b.role === "worktree"
                  ? target.paths.find((p) => p.path === b.path).before
                  : target.metadata.find((m) => m.role === b.role).before,
              ),
            });
        const next = clone(original);
        for (const p of target.paths) {
          if (p.after === null) delete next.worktree[p.path];
          else next.worktree[p.path] = clone(p.after);
        }
        for (const p of target.metadata) {
          if (p.role === "index") next.indexDigest = p.after.digest;
          else if (["head_log", "branch_log"].includes(p.role))
            next.logs[p.role] = clone(p.after);
          else if (p.role === "head_ref") next.headDigest = p.after.digest;
        }
        if (target.action === "create")
          next.branches[target.branch] = target.headOid;
        if (target.action === "select") {
          next.indexEntries = clone(next.targetEntries);
          next.headEntries = clone(next.targetEntries);
          next.dirty = false;
          next.currentBranch = target.branch;
          next.headOid = target.nextHeadOid;
        }
        next.digest = target.previewDigest;
        fixture.syntheticGitBranchRestores.set(workspace.id, next);
        fixture.gitBranchRestoreEffects.push({
          syntheticOnly: true,
          workspaceId: workspace.id,
          operationId: envelope.operationId,
          target: clone(target),
        });
        receipt.delivery = "accepted";
        receipt.effect = "confirmed";
        receipt.evidence = [{ kind: "host-registry", id: workspace.id }];
        const completed = {
          action: target.action,
          previewDigest: target.previewDigest,
          paths: target.paths.map((p) => ({
            path: p.path,
            after: clone(p.after),
          })),
          metadata: target.metadata.map((p) => ({
            role: p.role,
            digest: p.after.digest,
          })),
          backups,
        };
        receipt.result = {
          kind: "git_branch_restore_applied",
          workspaceId: workspace.id,
          ...completed,
          digest: originalDigest,
        };
        if (
          !validGitBranchRestoreAppliedResult(receipt, target, originalDigest)
        )
          throw new Error("Invalid synthetic branch/restore receipt binding");
        value = {
          requestId: request.requestId,
          status: "applied",
          ...clone(completed),
        };
      }
      receipt.revision = ++fixture.snapshot.revision;
      validateGitBranchRestoreReceipt(receipt);
      result = {
        ok: true,
        value: validateGitBranchRestoreMutationResult(value),
        receipt: clone(receipt),
      };
    };
    const finish = () => {
      try {
        complete();
        return result;
      } finally {
        fixture.pendingGitBranchRestoreWorkspaces.delete(workspace.id);
        if (receipt.effect === "confirmed")
          fixture.snapshot.retainedOperations =
            fixture.snapshot.retainedOperations.filter(
              (k) =>
                k.runtimeEpoch !== originalEpoch ||
                k.operationId !== envelope.operationId,
            );
      }
    };
    if (fixture.holdGitBranchRestoreApply)
      return new Promise((resolve) => {
        fixture.gitBranchRestoreCompletions.push(complete);
        fixture.heldGitBranchRestoreApplies.push(() => {
          const i = fixture.gitBranchRestoreCompletions.indexOf(complete);
          if (i >= 0) fixture.gitBranchRestoreCompletions.splice(i, 1);
          resolve(finish());
        });
      });
    return finish();
  }
  function mutateGitIndex(envelope) {
    const request = validateGitIndexRequest(envelope.operation);
    const originalEpoch = envelope.runtimeEpoch;
    const originalDigest = workspaceFileAdmissionDigest(
      request,
      envelope.expectedRevision,
    );
    const key = receiptKey(originalEpoch, envelope.operationId);
    const existing = receipts.get(key);
    if (existing)
      return existing.digest === originalDigest
        ? {
            ok: true,
            value: { status: "duplicate" },
            receipt: clone(existing.receipt),
          }
        : failure("DUPLICATE_CONFLICT");
    if (envelope.expectedRevision !== fixture.snapshot.revision)
      return failure("STALE_REVISION");
    const workspace = fixture.snapshot.workspaces.find(
      (w) => w.id === request.workspaceId,
    );
    if (!workspace) return failure("NOT_FOUND");
    if (gitHeld(fixture, workspace.id)) return failure("UNAVAILABLE");
    const target = gitIndexTargetFromApply(request);
    const record = fixture.gitIndexPreviews.get(request.previewId);
    const receipt = {
      runtimeEpoch: originalEpoch,
      operationId: envelope.operationId,
      type: request.type,
      workspaceId: workspace.id,
      admission: "admitted",
      delivery: "pending",
      effect: "none",
      revision: fixture.snapshot.revision,
      evidence: [],
    };
    const outcome = fixture.nextGitIndexApply;
    fixture.nextGitIndexApply = undefined;
    const scope = gitScope(fixture, workspace);
    const reject = (code) => {
      mutationCounts.rejected++;
      receipt.admission = "rejected";
      receipt.result = { kind: "rejected", code };
      receipt.revision = ++fixture.snapshot.revision;
      receipts.set(key, { digest: originalDigest, receipt });
      validateGitIndexReceipt(receipt);
      return { ...failure(code), receipt: clone(receipt) };
    };
    if (!workspace.trusted) return reject("INVALID_SELECTION");
    if (
      !record ||
      record.sender !== gitSender ||
      JSON.stringify(record.scope) !== JSON.stringify(scope) ||
      record.trustRevision !== workspace.trustRevision ||
      JSON.stringify(record.target) !== JSON.stringify(target)
    )
      return reject("FILE_CHANGED");
    if (outcome === "denied") return reject("CANCELLED");
    if (
      fixture.gitNow - record.at >= GIT_INDEX_LIMITS.previewMs ||
      outcome === "expired_preview"
    )
      return reject("FILE_CHANGED");
    const refusal = {
      stale_preview: "FILE_CHANGED",
      lock_conflict: "BUSY",
      unsupported_index_mutation: "FILE_UNSUPPORTED",
    }[outcome];
    if (refusal) return reject(refusal);
    if (
      fixture.syntheticGitIndexes.get(workspace.id)?.digest !==
      target.indexDigest
    )
      return reject("FILE_CHANGED");
    fixture.gitIndexPreviews.delete(request.previewId);
    fixture.pendingGitIndexWorkspaces.add(workspace.id);
    fixture.requests.push(clone(request));
    fixture.intents.push({
      runtimeEpoch: originalEpoch,
      operationId: envelope.operationId,
      type: request.type,
      workspaceId: workspace.id,
      gitIndexTarget: clone(target),
      digest: originalDigest,
    });
    mutationCounts.dispatched++;
    receipt.admission = "dispatched";
    receipts.set(key, { digest: originalDigest, receipt });
    let result;
    const complete = () => {
      if (result) return;
      let value;
      if (
        outcome === "unknown" ||
        fixture.snapshot.runtimeEpoch !== originalEpoch ||
        workspace.path !== scope.workspacePath ||
        !workspace.trusted ||
        workspace.trustRevision !== record.trustRevision ||
        fixture.snapshot.recovery.store.state !== "ready" ||
        fixture.snapshot.recovery.resources.some(
          (r) => r.workspaceId === workspace.id,
        ) ||
        fixture.syntheticGitIndexes.get(workspace.id)?.digest !==
          target.indexDigest
      ) {
        receipt.delivery = receipt.effect = "unknown";
        if (
          !fixture.snapshot.recovery.resources.some(
            (r) => r.workspaceId === workspace.id,
          )
        )
          fixture.snapshot.recovery.resources.push({
            workspaceId: workspace.id,
            state: "unavailable",
            reason: "unresolved_operation",
          });
        value = { requestId: request.requestId, status: "unknown" };
      } else {
        const original = fixture.syntheticGitIndexes.get(workspace.id);
        const backupId = target.indexExists
          ? gitIndexBackupId(originalEpoch, envelope.operationId)
          : null;
        if (backupId)
          fixture.syntheticGitIndexBackups.set(backupId, clone(original));
        const next = clone(original);
        for (const row of record.value.entries)
          next.entries[row.path] = clone(row.after);
        next.exists = true;
        next.digest = target.nextIndexDigest;
        fixture.syntheticGitIndexes.set(workspace.id, next);
        fixture.gitIndexEffects.push({
          syntheticOnly: true,
          workspaceId: workspace.id,
          operationId: envelope.operationId,
          target: clone(target),
        });
        receipt.delivery = "accepted";
        receipt.effect = "confirmed";
        receipt.evidence = [{ kind: "host-registry", id: workspace.id }];
        receipt.result = {
          kind: "git_index_updated",
          workspaceId: workspace.id,
          action: target.action,
          paths: [...target.paths],
          indexDigest: target.nextIndexDigest,
          previewDigest: target.previewDigest,
          backupId,
          digest: originalDigest,
        };
        if (!validGitIndexUpdatedResult(receipt, target, originalDigest))
          throw new Error("Invalid synthetic Git index receipt binding");
        value = {
          requestId: request.requestId,
          status: "applied",
          indexDigest: target.nextIndexDigest,
          backupId,
        };
      }
      receipt.revision = ++fixture.snapshot.revision;
      validateGitIndexReceipt(receipt);
      result = {
        ok: true,
        value: validateGitIndexMutationResult(value),
        receipt: clone(receipt),
      };
    };
    const finish = () => {
      try {
        complete();
        return result;
      } finally {
        fixture.pendingGitIndexWorkspaces.delete(workspace.id);
      }
    };
    if (fixture.holdGitIndexApply)
      return new Promise((resolve) => {
        fixture.gitIndexCompletions.push(complete);
        fixture.heldGitIndexApplies.push(() => {
          const i = fixture.gitIndexCompletions.indexOf(complete);
          if (i >= 0) fixture.gitIndexCompletions.splice(i, 1);
          resolve(finish());
        });
      });
    return finish();
  }
  // Selected-session snapshot from per-session messages, hiding a staged revert
  // (boundary and later messages) the way the real projection does.
  function selectedSnapshot(workspaceId, sessionId) {
    const ready = fixture.snapshot.recovery.store.state === "ready";
    const staged = fixture.sessionRevert?.get(sessionId);
    const rows = fixture.sessionMessages.get(sessionId) ?? [];
    return validateSnapshot(
      runtimeSnapshot(fixture, {
        ...clone(fixture.snapshot),
        selectedWorkspaceId: workspaceId,
        selectedSessionId: sessionId,
        messages: ready
          ? clone(
              staged
                ? rows.slice(
                    0,
                    rows.findIndex((m) => m.id === staged.messageId),
                  )
                : rows,
            )
          : [],
        ...(ready &&
          staged && {
            revert: {
              messageId: staged.messageId,
              fileCount: staged.files.length,
              files: clone(staged.files.slice(0, 50)),
              filesRestored: fixture.revertFilesRestored !== false,
            },
          }),
        permissions: ready
          ? clone(
              fixture.snapshot.permissions.filter(
                (p) => p.sessionId === sessionId,
              ),
            )
          : [],
      }),
    );
  }
  // A send makes Native commit a staged revert: boundary and later messages go.
  function commitRevert(sessionId) {
    const staged = fixture.sessionRevert?.get(sessionId);
    if (!staged) return;
    fixture.sessionMessages.set(
      sessionId,
      fixture.sessionMessages.get(sessionId).slice(
        0,
        fixture.sessionMessages
          .get(sessionId)
          .findIndex((m) => m.id === staged.messageId),
      ),
    );
    fixture.sessionRevert.delete(sessionId);
  }
  function mutateContext(envelope) {
    const request = clone(envelope.operation);
    const originalEpoch = envelope.runtimeEpoch;
    const originalDigest = workspaceFileAdmissionDigest(
      request,
      envelope.expectedRevision,
    );
    const key = receiptKey(originalEpoch, envelope.operationId);
    const existing = receipts.get(key);
    if (existing)
      return existing.digest === originalDigest
        ? {
            ok: true,
            value: { status: "duplicate" },
            receipt: clone(existing.receipt),
          }
        : failure("DUPLICATE_CONFLICT");
    if (
      envelope.expectedRevision !== undefined &&
      envelope.expectedRevision !== fixture.snapshot.revision
    )
      return failure("STALE_REVISION");
    const blocked = contextBlocked(fixture, request);
    if (blocked) return failure(blocked);
    if (request.requestId !== envelope.operationId)
      return failure("INVALID_REQUEST");
    if (receipts.size >= 2048) return failure("LIMIT_REACHED");
    const workspace = fixture.snapshot.workspaces.find(
      (w) => w.id === request.workspaceId,
    );
    const session = fixture.snapshot.sessions.find(
      (s) => s.id === request.sessionId && s.workspaceId === workspace.id,
    );
    const authority = contextAuthority(fixture, workspace, gitSender);
    const receipt = {
      runtimeEpoch: originalEpoch,
      operationId: envelope.operationId,
      type: request.type,
      workspaceId: workspace.id,
      sessionId: session.id,
      admission: "admitted",
      delivery: "pending",
      effect: "none",
      revision: fixture.snapshot.revision,
      evidence: [],
    };
    const reject = (code) => {
      mutationCounts.rejected++;
      receipt.admission = "rejected";
      receipt.result = { kind: "rejected", code };
      receipts.set(key, { digest: originalDigest, receipt });
      return {
        ok: true,
        value: { requestId: request.requestId, status: "rejected" },
        receipt: clone(receipt),
      };
    };
    const acquired = [];
    let boundary;
    if (request.type === "message.send") {
      if (
        request.delivery
          ? session.status !== "running"
          : session.status !== "idle"
      )
        return reject("BUSY");
      const model = fixture.catalog.models.entries.find(
        (m) => m.id === request.model,
      );
      if (request.model && !model) return reject("INVALID_SELECTION");
      if (
        request.agent &&
        !fixture.catalog.agents.entries.some((a) => a.id === request.agent)
      )
        return reject("INVALID_SELECTION");
      if (request.variant && !model?.variants.ids.includes(request.variant))
        return reject("INVALID_SELECTION");
      if (request.attachments) {
        if (
          !model ||
          !contextModelSupports(
            {
              variants: model.variants,
              ...(model.capabilities && { capabilities: model.capabilities }),
            },
            request.attachments,
          )
        )
          return reject("INVALID_SELECTION");
        for (const d of request.attachments) {
          const cap = fixture.syntheticContextCapabilities.get(d.capabilityId);
          if (
            !cap ||
            !isDeepStrictEqual(cap.descriptor, d) ||
            !isDeepStrictEqual(cap.authority, authority) ||
            fixture.contextNow - cap.at >= CONTEXT_LIMITS.idleMs
          )
            return reject("FILE_CHANGED");
          acquired.push(cap);
        }
      }
    } else if (request.type === "session.fork") {
      if (session.status !== "idle") return reject("BUSY");
      const messages = fixture.sessionMessages.get(session.id) ?? [];
      const index = messages.findIndex(
        (m) => m.id === request.before && m.role === "user",
      );
      if (index < 0) return reject("INVALID_SELECTION");
      boundary = { type: "before", messageID: request.before };
    } else if (
      !(fixture.syntheticContextInbox.get(session.id) ?? []).some(
        (r) => r.id === request.inboxId,
      )
    )
      return reject("INVALID_SELECTION");
    const kind =
      request.type === "message.send"
        ? "Prompt"
        : request.type === "session.fork"
          ? "Fork"
          : "Cancel";
    const outcome = fixture.nextContextOutcome;
    fixture.nextContextOutcome = undefined;
    fixture.requests.push(clone(request));
    fixture.intents.push({
      runtimeEpoch: originalEpoch,
      operationId: envelope.operationId,
      type: request.type,
      workspaceId: workspace.id,
      sessionId: session.id,
      digest: originalDigest,
    });
    // Simulated policy/effect ordering only; production flush evidence is separate.
    fixture.contextPolicySteps.push({
      syntheticOnly: true,
      operationId: envelope.operationId,
      steps: [
        "native.policy.before_selection",
        "native.policy.after_selection",
      ],
    });
    const effect = {
      syntheticOnly: true,
      type: request.type,
      workspaceId: workspace.id,
      sessionId: session.id,
      operationId: envelope.operationId,
      ...(request.type === "message.send" && {
        text: request.text,
        ...(request.delivery && { delivery: request.delivery }),
        ...(acquired.length && {
          files: acquired.map((c) => ({
            name: c.descriptor.name,
            uri: `data:${c.descriptor.mime};base64,${c.bytes.toString("base64")}`,
          })),
        }),
      }),
      ...(boundary && { boundary }),
      ...(request.inboxId && { inboxId: request.inboxId }),
    };
    fixture.contextEffects.push(effect);
    for (const c of acquired) {
      c.pins++;
      c.at = fixture.contextNow;
    }
    mutationCounts.dispatched++;
    receipt.admission = "dispatched";
    receipt.effect = "pending";
    receipts.set(key, { digest: originalDigest, receipt });
    const token = {};
    fixture.pendingContextIO.add(token);
    const inboxId = `synthetic-context-inbox-${++fixture.contextSerial}`;
    const ack =
      kind === "Prompt"
        ? {
            id: inboxId,
            sessionID: session.id,
            type: "user",
            ...(request.delivery && { delivery: request.delivery }),
            payload: {
              text: request.text,
              ...(acquired.length && {
                files: acquired.map((c) => ({
                  name: c.descriptor.name,
                  mime: c.descriptor.mime,
                  data: c.bytes.toString("base64"),
                  source: { type: "inline" },
                })),
              }),
            },
            ...clone(fixture.nextContextAck ?? {}),
          }
        : undefined;
    fixture.nextContextAck = undefined;
    let completed;
    const complete = () => {
      if (completed) return completed;
      let value;
      const current = fixture.snapshot.workspaces.find(
        (w) => w.id === workspace.id,
      );
      if (
        closed ||
        outcome !== undefined ||
        (kind === "Prompt" &&
          !validContextPromptReceipt(
            ack,
            session.id,
            request.text,
            request.delivery,
            effect.files,
          )) ||
        !current ||
        !isDeepStrictEqual(
          authority,
          contextAuthority(fixture, current, gitSender),
        ) ||
        !fixture.snapshot.sessions.includes(session) ||
        !current.trusted ||
        fixture.snapshot.state !== "connected" ||
        fixture.snapshot.revision !== receipt.revision ||
        fixture.snapshot.recovery.store.state !== "ready" ||
        fixture.snapshot.recovery.resources.some(
          (r) => r.workspaceId === workspace.id,
        )
      ) {
        receipt.delivery = receipt.effect = "unknown";
        if (fixture.snapshot.runtimeEpoch === originalEpoch)
          session.status = "unknown";
        value = { requestId: request.requestId, status: "unknown" };
      } else if (kind === "Cancel") {
        receipt.delivery = "accepted";
        receipt.effect = "confirmed";
        receipt.evidence = [{ kind: "native-ack" }];
        receipt.result = {
          kind: "inbox_cancel_requested",
          workspaceId: workspace.id,
          sessionId: session.id,
          inboxId: request.inboxId,
          digest: originalDigest,
        };
        if (
          !validInboxCancelResult(receipt.result) ||
          !validInboxCancelRequestedResult(
            receipt,
            { inboxId: request.inboxId },
            originalDigest,
          )
        )
          throw Error("Invalid synthetic inbox ACK correlation");
        value = { requestId: request.requestId, status: "accepted" };
        // Keep observed row: accepted cancellation is not nonexecution proof.
      } else if (kind === "Fork") {
        const id = `synthetic-context-branch-${++fixture.contextSerial}`;
        const child = {
          id,
          workspaceId: workspace.id,
          title: request.title ?? "SYNTHETIC before-user branch",
          status: "idle",
          parentSessionId: session.id,
        };
        const messages = fixture.sessionMessages.get(session.id);
        fixture.sessionMessages.set(
          id,
          clone(
            messages.slice(
              0,
              messages.findIndex((m) => m.id === request.before),
            ),
          ),
        );
        fixture.contextForks.set(id, {
          syntheticOnly: true,
          parentSessionId: session.id,
          boundary: clone(boundary),
        });
        fixture.snapshot.sessions.push(child);
        fixture.snapshot.selectedSessionId = id;
        fixture.snapshot.messages = clone(fixture.sessionMessages.get(id));
        receipt.delivery = "accepted";
        receipt.effect = "confirmed";
        receipt.result = {
          kind: "forked",
          workspaceId: workspace.id,
          sessionId: id,
          nativeSessionId: `synthetic-native-${id}`,
        };
        receipt.evidence = [{ kind: "host-registry", id }];
        value = clone(fixture.snapshot);
      } else {
        session.status = "running";
        fixture.contextAcknowledgements.push({
          syntheticOnly: true,
          value: clone(ack),
        });
        if (request.delivery) {
          const rows = fixture.syntheticContextInbox.get(session.id) ?? [];
          rows.push({
            id: inboxId,
            delivery: request.delivery,
            textPreview: request.text.slice(0, 2000),
            textTruncated: request.text.length > 2000,
            attachmentCount: 0,
          });
          fixture.syntheticContextInbox.set(session.id, rows);
        } else {
          commitRevert(session.id);
          const messages = fixture.sessionMessages.get(session.id);
          messages.push({
            id: `synthetic-context-sent-${fixture.contextSerial}`,
            role: "user",
            text: request.text,
            tools: [],
            ...(acquired.length && {
              context: { status: "unavailable", count: acquired.length },
            }),
          });
          if (fixture.snapshot.selectedSessionId === session.id)
            fixture.snapshot.messages = clone(messages);
        }
        receipt.delivery = "accepted";
        // Strict synthetic request/inbox admission only. No provider, tool,
        // final delivery or nonexecution claim follows this ACK.
        receipt.effect = "confirmed";
        receipt.evidence = [{ kind: "native-ack", id: inboxId }];
        receipt.result = {
          kind: "delivery",
          status: "accepted",
          nativeInboxId: inboxId,
        };
        value = { requestId: request.requestId, status: "accepted" };
      }
      receipt.revision = ++fixture.snapshot.revision;
      if (kind === "Fork" && receipt.effect === "confirmed")
        value = clone(fixture.snapshot);
      const projected = redactReceipt({
        ...clone(receipt),
        digest: originalDigest,
        ...(kind === "Cancel" && {
          inboxTarget: { inboxId: request.inboxId },
        }),
      });
      if (
        kind === "Cancel" &&
        receipt.effect === "confirmed" &&
        !validInboxCancelResult(projected.result)
      )
        throw Error("Synthetic inbox ACK was dropped by actual redaction");
      completed = { ok: true, value, receipt: projected };
      return completed;
    };
    const finish = () => {
      try {
        return complete();
      } finally {
        fixture.pendingContextIO.delete(token);
        for (const c of acquired) c.pins--;
      }
    };
    if (fixture[`holdContext${kind}`]) {
      fixture[`context${kind}Completions`].push(complete);
      return new Promise((resolve) =>
        fixture[`heldContext${kind}s`].push(() => {
          const index = fixture[`context${kind}Completions`].indexOf(complete);
          if (index >= 0) fixture[`context${kind}Completions`].splice(index, 1);
          resolve(finish());
        }),
      );
    }
    return finish();
  }
  function mutate(envelope) {
    const request = envelope.operation;
    if (
      fixture.conversationContextState &&
      (request.type === "message.send" ||
        request.type === "session.inbox.cancel" ||
        (request.type === "session.fork" && request.before))
    )
      return mutateContext(envelope);
    if (["git.branch.apply", "git.restore.apply"].includes(request.type))
      return mutateGitBranchRestore(envelope);
    if (request.type === "git.commit.apply") return mutateGitCommit(envelope);
    if (request.type === "git.index.apply") return mutateGitIndex(envelope);
    if (request.type === "file.save") return mutateWorkspaceFile(envelope);
    const input = digest(request);
    const existing = receipts.get(receiptKey(epoch, envelope.operationId));
    if (existing)
      return existing.digest === input
        ? {
            ok: true,
            value: { status: "duplicate" },
            receipt: clone(existing.receipt),
          }
        : failure("DUPLICATE_CONFLICT");
    if (
      envelope.expectedRevision !== undefined &&
      envelope.expectedRevision !== fixture.snapshot.revision
    )
      return failure("STALE_REVISION");
    const scopeBlocked =
      fixture.snapshot.recovery.store.state !== "ready" ||
      fixture.snapshot.recovery.resources.some(
        (resource) => resource.workspaceId === request.workspaceId,
      );
    if (scopeBlocked) {
      mutationCounts.rejected++;
      return failure("UNAVAILABLE");
    }
    if (fixture.pendingMcpWorkspaces.has(request.workspaceId))
      return failure("BUSY");
    if (fixture.pendingAgentWorkspaces.has(request.workspaceId))
      return failure("BUSY");
    if (fixture.pendingSkillWorkspaces.has(request.workspaceId))
      return failure("BUSY");
    if (receipts.size >= 2048) return failure("LIMIT_REACHED");
    if (request.type.startsWith("configuration.agent."))
      return mutateAgent(envelope, input);
    if (request.type.startsWith("configuration.mcp."))
      return mutateMcp(envelope, input);
    if (skillRuntimeStep(request.type))
      return mutateSkillRuntime(envelope, input);
    if (request.type === "configuration.skill.save")
      return mutateSkill(envelope, input);
    const receipt = {
      runtimeEpoch: epoch,
      operationId: envelope.operationId,
      type: request.type,
      ...(request.workspaceId && { workspaceId: request.workspaceId }),
      ...(request.sessionId && { sessionId: request.sessionId }),
      admission: "admitted",
      delivery: "pending",
      effect: "none",
      revision: fixture.snapshot.revision,
      evidence: [],
    };
    receipts.set(receiptKey(epoch, envelope.operationId), {
      digest: input,
      receipt,
    });
    const session = fixture.snapshot.sessions.find(
      (s) =>
        s.id === request.sessionId && s.workspaceId === request.workspaceId,
    );
    const permission = fixture.snapshot.permissions.find(
      (p) => p.id === request.requestId && p.sessionId === request.sessionId,
    );
    let refused;
    if (
      ![
        "message.send",
        "command.run",
        "session.interrupt",
        "permission.respond",
        "configuration.save",
        "configuration.instructions.apply",
        "configuration.instructions.remove",
        ...(fixture.sessionRevert
          ? ["session.revert", "session.revert.clear"]
          : []),
      ].includes(request.type)
    )
      refused = "INVALID_REQUEST";
    else if (request.type.startsWith("configuration.instructions.")) {
      const observed = readResult({
        type: "configuration.instructions.read",
        workspaceId: request.workspaceId,
        sessionId: request.sessionId,
      });
      if (!observed.ok) refused = observed.code;
      else if (fixture.snapshot.state !== "connected") refused = "UNAVAILABLE";
      else if (session.archived) refused = "ARCHIVED_SESSION";
      else if (
        session.status !== "idle" ||
        fixture.snapshot.permissions.some((p) => p.sessionId === session.id)
      )
        refused = "BUSY";
      else if (observed.value.status === "unavailable")
        refused = "INSTRUCTIONS_UNVERIFIED";
      else if (observed.value.version !== request.expectedRegistrationVersion)
        refused = "INSTRUCTIONS_CHANGED";
      else if (request.type === "configuration.instructions.apply") {
        const file = readResult({
          type: "configuration.read",
          workspaceId: request.workspaceId,
          kind: "instructions",
        });
        if (
          !file.ok ||
          file.value.status !== "available" ||
          file.value.content !== request.text ||
          file.value.version !== request.fileVersion
        )
          refused = "FILE_CHANGED";
      }
      if (!refused && fixture.nextInstructions === "denied")
        refused = "CANCELLED";
      if (refused) fixture.nextInstructions = undefined;
    } else if (request.type === "configuration.save") {
      const observation = readResult({
        type: "configuration.read",
        workspaceId: request.workspaceId,
        kind: request.kind,
      });
      if (fixture.snapshot.state !== "connected") refused = "UNAVAILABLE";
      else if (!observation.ok) refused = observation.code;
      else if (!configurationFileWriteFits(request.kind, request.text))
        refused = "FILE_UNSUPPORTED";
      else if (fixture.nextConfigurationSave === "denied")
        refused = "CANCELLED";
      else if (
        fixture.nextConfigurationSave === "conflict" ||
        (request.expectation === "version"
          ? observation.value.status !== "available" ||
            observation.value.version !== request.version
          : observation.value.status !== "missing")
      )
        refused = "FILE_CHANGED";
      fixture.nextConfigurationSave = refused
        ? undefined
        : fixture.nextConfigurationSave;
    } else if (!session) refused = "NOT_FOUND";
    else if (fixture.snapshot.state !== "connected") refused = "UNAVAILABLE";
    else if (session.archived) refused = "ARCHIVED_SESSION";
    else if (request.type === "permission.respond" && !permission)
      refused = "STALE_PERMISSION";
    else if (request.type.startsWith("session.revert")) {
      const staged = fixture.sessionRevert.get(session.id);
      const target = (fixture.sessionMessages.get(session.id) ?? []).find(
        (m) => m.id === request.messageId,
      );
      if (
        !fixture.snapshot.workspaces.find((w) => w.id === request.workspaceId)
          ?.trusted
      )
        refused = "INVALID_SELECTION";
      else if (session.status !== "idle") refused = "BUSY";
      else if (request.type === "session.revert.clear")
        refused =
          staged?.messageId === request.messageId
            ? undefined
            : "INVALID_SELECTION";
      else if (
        target?.role !== "user" ||
        (staged &&
          (fixture.sessionMessages.get(session.id) ?? []).findIndex(
            (m) => m.id === request.messageId,
          ) >=
            (fixture.sessionMessages.get(session.id) ?? []).findIndex(
              (m) => m.id === staged.messageId,
            ))
      )
        refused = "INVALID_SELECTION";
      if (!refused && fixture.nextRevert === "denied") {
        fixture.nextRevert = undefined;
        refused = "CANCELLED";
      }
    }
    if (
      !refused &&
      fixture.runtimeOptionsState &&
      request.type === "message.send"
    ) {
      const model = fixture.catalog.models.entries.find(
        (row) => row.id === request.model,
      );
      if (session.status !== "idle") refused = "BUSY";
      else if (
        !fixture.snapshot.workspaces.find((w) => w.id === request.workspaceId)
          ?.trusted
      )
        refused = "INVALID_SELECTION";
      else if (
        request.agent &&
        !fixture.catalog.agents.entries.some((row) => row.id === request.agent)
      )
        refused = "INVALID_SELECTION";
      else if (
        request.model &&
        (fixture.catalog.models.status !== "available" || !model)
      )
        refused = "INVALID_SELECTION";
      else if (
        Object.hasOwn(request, "variant") &&
        (!model ||
          !validModelOptions({
            variants: model.variants,
            ...(model.capabilities && { capabilities: model.capabilities }),
          }) ||
          model.variants.status !== "available" ||
          !model.variants.ids.includes(request.variant))
      )
        refused = "INVALID_SELECTION";
    }
    if (refused) {
      mutationCounts.rejected++;
      receipt.admission = "rejected";
      receipt.result = { kind: "rejected", code: refused };
      // Durable save admission/refusal is a later observation than the submitted floor.
      if (
        request.type === "configuration.save" ||
        request.type.startsWith("configuration.instructions.")
      )
        receipt.revision = ++fixture.snapshot.revision;
      return { ...failure(refused), receipt: clone(receipt) };
    }
    // Identity is registered before any fixture effect. IDs/logs stay private
    // to the test main; receipts contain only correlated evidence.
    fixture.requests.push(clone(request));
    mutationCounts.dispatched++;
    fixture.intents.push({
      runtimeEpoch: epoch,
      operationId: envelope.operationId,
      type: request.type,
      requestId: request.requestId,
    });
    receipt.admission = "dispatched";
    let value;
    let revertSnapshot = false;
    if (request.type.startsWith("configuration.instructions.")) {
      const outcome = fixture.nextInstructions;
      fixture.nextInstructions = undefined;
      const finish = () => {
        if (outcome === "unknown") {
          receipt.delivery = "unknown";
          receipt.effect = "unknown";
          fixture.snapshot.recovery.resources.push({
            workspaceId: request.workspaceId,
            sessionId: request.sessionId,
            state: "unavailable",
            reason: "unresolved_operation",
          });
          value = { requestId: request.requestId, status: "unknown" };
        } else {
          const apply = request.type === "configuration.instructions.apply";
          const prior = fixture.instructionEntries.get(request.sessionId) ?? [];
          fixture.instructionEntries.set(request.sessionId, [
            ...prior.filter((entry) => entry.key !== INSTRUCTION_KEY),
            ...(apply ? [{ key: INSTRUCTION_KEY, value: request.text }] : []),
          ]);
          const registration = apply
            ? {
                state: "registered",
                key: INSTRUCTION_KEY,
                digest: instructionDigest(request.text),
                sourceVersion: request.fileVersion,
                origin: "direct",
              }
            : { state: "absent", key: INSTRUCTION_KEY };
          fixture.instructionRegistrations.set(request.sessionId, registration);
          receipt.delivery = "accepted";
          receipt.effect = "confirmed";
          receipt.evidence = [{ kind: "host-registry", id: request.sessionId }];
          receipt.result = {
            kind: apply ? "instruction_registered" : "instruction_removed",
            workspaceId: request.workspaceId,
            sessionId: request.sessionId,
            ...(apply && {
              digest: registration.digest,
              sourceVersion: registration.sourceVersion,
            }),
          };
          value = {
            requestId: request.requestId,
            status: apply ? "registered" : "removed",
            ...(apply && {
              digest: registration.digest,
              sourceVersion: registration.sourceVersion,
            }),
          };
        }
        receipt.revision = ++fixture.snapshot.revision;
        return { ok: true, value, receipt: clone(receipt) };
      };
      if (fixture.holdInstructions)
        return new Promise((resolve) =>
          fixture.heldInstructions.push(() => resolve(finish())),
        );
      return finish();
    }
    if (request.type === "configuration.save") {
      const outcome = fixture.nextConfigurationSave;
      fixture.nextConfigurationSave = undefined;
      const finish = () => {
        if (outcome === "unknown") {
          receipt.delivery = "unknown";
          receipt.effect = "unknown";
          fixture.snapshot.recovery.resources.push({
            workspaceId: request.workspaceId,
            state: "unavailable",
            reason: "unresolved_operation",
          });
          value = { requestId: request.requestId, status: "unknown" };
        } else {
          const key = JSON.stringify([request.workspaceId, request.kind]);
          const prior = fixture.configurationFiles.get(key);
          const backupId =
            prior === undefined
              ? undefined
              : configurationBackupId(
                  epoch,
                  envelope.operationId,
                  request.kind,
                );
          if (backupId) fixture.configurationBackups.set(backupId, prior);
          fixture.configurationFiles.set(key, request.text);
          const observation = readResult({
            type: "configuration.read",
            workspaceId: request.workspaceId,
            kind: request.kind,
          }).value;
          receipt.delivery = "accepted";
          receipt.effect = "confirmed";
          receipt.evidence = [
            { kind: "host-registry", id: request.workspaceId },
          ];
          receipt.result = {
            kind: "configuration_saved",
            workspaceId: request.workspaceId,
            configurationKind: request.kind,
            version: observation.version,
            ...(backupId && { backupId }),
          };
          value = {
            requestId: request.requestId,
            status: "saved",
            version: observation.version,
            ...(backupId && { backupId }),
          };
        }
        receipt.revision = ++fixture.snapshot.revision;
        return { ok: true, value, receipt: clone(receipt) };
      };
      if (fixture.holdConfigurationSave)
        return new Promise((resolve) =>
          fixture.heldConfigurationSaves.push(() => resolve(finish())),
        );
      return finish();
    }
    if (["message.send", "command.run"].includes(request.type)) {
      if (fixture.nextSendUnknown) {
        fixture.nextSendUnknown = false;
        session.status = "unknown";
        receipt.delivery = "unknown";
        receipt.effect = "unknown";
        value = { requestId: request.requestId, status: "unknown" };
      } else {
        session.status = "running";
        commitRevert(request.sessionId);
        (
          fixture.sessionMessages?.get(request.sessionId) ??
          fixture.snapshot.messages
        ).push({
          id: `sent-${fixture.requests.length}`,
          role: "user",
          text: request.text ?? `/${request.name} ${request.arguments}`,
          tools: [],
        });
        receipt.delivery = "accepted";
        // Native inbox acceptance does not establish tool/execution completion.
        receipt.effect = "pending";
        const inboxId = `fixture-inbox-${fixture.requests.length}`;
        receipt.evidence = [{ kind: "native_inbox", id: inboxId }];
        receipt.result = {
          kind: "delivery",
          status: "accepted",
          nativeInboxId: inboxId,
        };
        value = { requestId: request.requestId, status: "accepted" };
      }
    } else if (request.type.startsWith("session.revert")) {
      if (fixture.nextRevert === "unknown") {
        // Partial restore: outcome unknown, session locked like Native's.
        fixture.nextRevert = undefined;
        session.status = "unknown";
        receipt.delivery = "unknown";
        receipt.effect = "unknown";
        value = { requestId: request.requestId, status: "unknown" };
      } else {
        if (request.type === "session.revert")
          fixture.sessionRevert.set(session.id, {
            messageId: request.messageId,
            files: clone(fixture.revertFiles ?? ["src/synthetic.txt"]),
          });
        else fixture.sessionRevert.delete(session.id);
        receipt.delivery = "accepted";
        receipt.effect = "confirmed";
        receipt.evidence = [{ kind: "host-registry", id: session.id }];
        receipt.result = {
          kind: "metadata",
          workspaceId: request.workspaceId,
          sessionId: request.sessionId,
        };
        revertSnapshot = true;
      }
    } else if (request.type === "session.interrupt") {
      session.status = "stopping";
      receipt.delivery = "accepted";
      receipt.effect = "pending";
      receipt.evidence = [{ kind: "interrupt_ack" }];
      receipt.result = { kind: "delivery", status: "stopping" };
      value = { status: "stopping" };
    } else {
      fixture.snapshot.permissions =
        request.decision === "reject"
          ? fixture.snapshot.permissions.filter(
              (p) => p.sessionId !== request.sessionId,
            )
          : fixture.snapshot.permissions.filter(
              (p) =>
                p.id !== request.requestId || p.sessionId !== request.sessionId,
            );
      receipt.delivery = "accepted";
      receipt.effect = "pending";
      receipt.evidence = [{ kind: "permission_reply", id: request.requestId }];
      receipt.result = {
        kind: "delivery",
        status: "decided",
        nativeRequestId: request.requestId,
      };
      value = { requestId: request.requestId, status: "decided" };
    }
    receipt.revision = ++fixture.snapshot.revision;
    if (revertSnapshot)
      value = selectedSnapshot(request.workspaceId, request.sessionId);
    if (request.type === "message.send" && fixture.holdSendAck) {
      const result = { ok: true, value, receipt: clone(receipt) };
      return new Promise((resolve) =>
        fixture.heldSendAcks.push(() => resolve(result)),
      );
    }
    return { ok: true, value, receipt: clone(receipt) };
  }
  function detach(record, result) {
    if (reads.get(record.id) !== record) return;
    reads.delete(record.id);
    counts.active = counts.pending = reads.size;
    counts.settled++;
    if (result?.code === "CANCELLED") counts.cancelled++;
    record.controller.abort();
    record.resolve(result);
  }
  return {
    metrics() {
      return { ...counts };
    },
    mutationMetrics() {
      return { ...mutationCounts };
    },
    handle(event, ...args) {
      counts.requests++;
      if (!admitted(event, args)) return failure("INVALID_REQUEST");
      let envelope;
      try {
        envelope = validateEnvelope(args[0]);
      } catch {
        return failure("INVALID_REQUEST");
      }
      if (
        envelope.runtimeEpoch !== undefined &&
        envelope.runtimeEpoch !==
          (fixture.conversationContextState ||
          fixture.runtimeOptionsState ||
          fixture.extensionsState ||
          fixture.permissionPolicyState ||
          fixture.workspaceFileState ||
          fixture.gitActivated
            ? fixture.snapshot.runtimeEpoch
            : epoch)
      )
        return failure("STALE_EPOCH");
      if (!READ_TYPES.includes(envelope.operation.type)) {
        if (
          (["git.branch.apply", "git.restore.apply"].includes(
            envelope.operation.type,
          ) ||
            envelope.operation.type === "git.commit.apply" ||
            envelope.operation.type === "git.index.apply" ||
            envelope.operation.type === "file.save" ||
            skillRuntimeStep(envelope.operation.type) ||
            envelope.operation.type.startsWith("configuration.agent.")) &&
          envelope.operation.requestId !== envelope.operationId
        )
          return failure("INVALID_REQUEST");
        mutationCounts.attempted++;
        return mutate(envelope);
      }
      if (envelope.operation.type === "file.edit.read")
        fixture.workspaceFileReads.push(clone(envelope));
      if (
        fixture.conversationContextState &&
        envelope.operation.type === "context.observe"
      )
        fixture.contextReads.push(clone(envelope));
      if (
        fixture.conversationContextState &&
        envelope.operation.type === "session.inbox"
      )
        fixture.inboxReads.push(clone(envelope));
      if (envelope.operation.type === "operation.lookup")
        fixture.lookupEnvelopes.push(clone(envelope));
      const scope = digest(envelope.operation);
      const existing = reads.get(envelope.readId);
      if (existing) {
        if (existing.scope !== scope) return failure("INVALID_REQUEST");
        counts.deduplicated++;
        return existing.promise;
      }
      const gitRead = [
        "git.review.read",
        "git.diff.read",
        "git.index.preview.read",
        "git.commit.preview.read",
        "git.branch.preview.read",
        "git.restore.preview.read",
      ].includes(envelope.operation.type);
      if (gitRead) {
        if (
          ["git.branch.preview.read", "git.restore.preview.read"].includes(
            envelope.operation.type,
          )
        )
          fixture.gitBranchRestoreReads.push(clone(envelope));
        else if (envelope.operation.type === "git.commit.preview.read")
          fixture.gitCommitReads.push(clone(envelope));
        else if (envelope.operation.type === "git.index.preview.read")
          fixture.gitIndexReads.push(clone(envelope));
        else fixture.gitReads.push(clone(envelope));
        if (
          fixture.gitBusy.has(envelope.operation.type) ||
          fixture.pendingGitBranchRestoreReadWorkspaces.has(
            envelope.operation.workspaceId,
          ) ||
          fixture.pendingGitCommitReadWorkspaces.has(
            envelope.operation.workspaceId,
          ) ||
          fixture.pendingGitIndexReadWorkspaces.has(
            envelope.operation.workspaceId,
          ) ||
          [...reads.values()].some(
            (r) => r.gitWorkspace === envelope.operation.workspaceId,
          ) ||
          [...reads.values()].filter((r) => r.gitWorkspace).length >= 2
        )
          return failure("READ_BUSY");
      }
      const record = {
        ...(gitRead && { gitWorkspace: envelope.operation.workspaceId }),
        id: envelope.readId,
        scope,
        controller: new AbortController(),
      };
      record.promise = new Promise((resolve) => {
        record.resolve = resolve;
      });
      reads.set(record.id, record);
      if (envelope.operation.type === "configuration.extensions.read")
        fixture.extensionReads.push(clone(envelope));
      if (envelope.operation.type === "permission.policy.read")
        fixture.permissionPolicyReads.push(clone(envelope));
      if (envelope.operation.type === "configuration.agent.runtime.read")
        fixture.agentRuntimeReads.push(clone(envelope));
      if (
        ["configuration.agent.list", "configuration.agent.read"].includes(
          envelope.operation.type,
        )
      )
        fixture.agentReads.push(clone(envelope));
      if (envelope.operation.type === "configuration.skill.runtime.read")
        fixture.skillRuntimeReads.push(clone(envelope));
      if (envelope.operation.type === "configuration.mcp.read")
        fixture.mcpReads.push(clone(envelope));
      if (envelope.operation.type === "configuration.instructions.read")
        fixture.instructionReads.push(clone(envelope));
      if (
        ["configuration.skill.list", "configuration.skill.read"].includes(
          envelope.operation.type,
        )
      )
        fixture.skillReads.push(clone(envelope));
      counts.admitted++;
      counts.active = counts.pending = reads.size;
      counts.max = Math.max(counts.max, reads.size);
      try {
        let result =
          envelope.operation.type === "operation.lookup" || !read
            ? readResult(envelope.operation)
            : read(envelope.operation, record.controller.signal);
        if (
          fixture.runtimeOptionsState &&
          ["snapshot", "catalog.list"].includes(envelope.operation.type)
        ) {
          fixture.runtimeReads.push(clone(envelope));
          if (fixture.holdRuntimeReads) {
            const captured = result;
            result = new Promise((resolve) =>
              fixture.heldRuntimeReads.push(() => resolve(captured)),
            );
          }
        }
        const branchRestoreRead = [
          "git.branch.preview.read",
          "git.restore.preview.read",
        ].includes(envelope.operation.type);
        if (branchRestoreRead)
          fixture.pendingGitBranchRestoreReadWorkspaces.add(
            envelope.operation.workspaceId,
          );
        const commitRead =
          envelope.operation.type === "git.commit.preview.read";
        if (commitRead)
          fixture.pendingGitCommitReadWorkspaces.add(
            envelope.operation.workspaceId,
          );
        const indexRead = envelope.operation.type === "git.index.preview.read";
        if (indexRead)
          fixture.pendingGitIndexReadWorkspaces.add(
            envelope.operation.workspaceId,
          );
        const releaseIndexRead = () => {
          if (branchRestoreRead)
            fixture.pendingGitBranchRestoreReadWorkspaces.delete(
              envelope.operation.workspaceId,
            );
          if (commitRead)
            fixture.pendingGitCommitReadWorkspaces.delete(
              envelope.operation.workspaceId,
            );
          if (indexRead)
            fixture.pendingGitIndexReadWorkspaces.delete(
              envelope.operation.workspaceId,
            );
        };
        Promise.resolve(result).then(
          (value) => {
            releaseIndexRead();
            detach(record, value);
          },
          (error) => {
            releaseIndexRead();
            detach(record, failure(error?.appCode ?? "RUNTIME_ERROR"));
          },
        );
      } catch (error) {
        detach(record, failure(error.appCode ?? "RUNTIME_ERROR"));
      }
      return record.promise;
    },
    cancel(event, ...args) {
      if (!admitted(event, args)) return failure("INVALID_REQUEST");
      let request;
      try {
        request = validateCancel(args[0]);
      } catch {
        return failure("INVALID_REQUEST");
      }
      if (
        request.runtimeEpoch !==
        (fixture.extensionsState ||
        fixture.permissionPolicyState ||
        fixture.workspaceFileState ||
        fixture.gitActivated
          ? fixture.snapshot.runtimeEpoch
          : epoch)
      )
        return failure("STALE_EPOCH");
      const record = reads.get(request.readId);
      if (!record) return { ok: true, value: { status: "missing" } };
      detach(record, failure("CANCELLED"));
      return { ok: true, value: { status: "cancelled" } };
    },
    senderClosed() {
      closed = true;
      if (fixture.conversationContextState)
        for (const [id, cap] of fixture.syntheticContextCapabilities)
          if (cap.authority.sender === gitSender)
            fixture.syntheticContextCapabilities.delete(id);
      for (const record of reads.values()) detach(record, failure("CANCELLED"));
    },
    close() {
      this.senderClosed();
    },
  };
}

// Git fixture appendix. It exercises DTO/lifecycle consumers, never actual G2.
export const GIT_REVIEW_UI_STATES = Object.freeze([
  "ready",
  "clean",
  "untracked",
  "conflict",
  "protected",
  "binary",
  "unborn",
  "detached",
  "unsupported",
  "configuration",
  "unavailable",
  "expired",
  "stale",
  "diverged-base",
  "base-only-equal",
  "base-only-different",
  "pending-status",
  "pending-diff",
  "busy-status",
  "busy-diff",
  "held",
  "global-held",
  "app-mutation",
  "untrusted",
]);
export function applyGitReviewState(fixture, name) {
  if (!GIT_REVIEW_UI_STATES.includes(name))
    throw new Error("Unknown closed synthetic Git fixture state");
  const scope = fixture.setWorkspaceFileState(
    name === "held" ? "held" : "ready",
  );
  fixture.gitActivated = true;
  fixture.gitState = name;
  fixture.gitPatchOverride = undefined;
  fixture.gitReads = [];
  fixture.gitObservations.clear();
  fixture.gitNow = 0;
  fixture.gitBusy.clear();
  fixture.gitAppMutationActive = name === "app-mutation";
  fixture.holdGitStatus = name === "pending-status";
  fixture.holdGitDiff = name === "pending-diff";
  // Never drop pending callbacks: a later release must still test retired IO.
  if (name === "busy-status") fixture.gitBusy.add("git.review.read");
  if (name === "busy-diff") fixture.gitBusy.add("git.diff.read");
  if (name === "global-held") {
    fixture.snapshot.recovery.store = {
      state: "recovery_required",
      reason: "corrupt_journal",
    };
    fixture.snapshot.state = "unavailable";
    fixture.snapshot.messages = [];
    fixture.snapshot.permissions = [];
  }
  if (name === "untrusted") {
    fixture.snapshot.workspaces[0].trusted = false;
    fixture.snapshot.workspaces[0].trustRevision++;
  }
  validateSnapshot(fixture.snapshot);
  return scope;
}
const gitHash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const gitScope = (fixture, workspace) => ({
  runtimeEpoch: fixture.snapshot.runtimeEpoch,
  revision: fixture.snapshot.revision,
  workspaceId: workspace.id,
  workspacePath: workspace.path,
});
function gitHeld(fixture, workspaceId) {
  return (
    fixture.snapshot.state !== "connected" ||
    fixture.snapshot.recovery.store.state !== "ready" ||
    fixture.snapshot.recovery.resources.some(
      (r) => r.workspaceId === workspaceId,
    ) ||
    fixture.gitAppMutationActive ||
    fixture.pendingGitBranchRestoreWorkspaces.size > 0 ||
    fixture.pendingGitCommitWorkspaces.size > 0 ||
    fixture.pendingGitIndexWorkspaces.has(workspaceId) ||
    fixture.pendingWorkspaceFiles.size > 0 ||
    fixture.holdConfigurationSave ||
    fixture.pendingAgentWorkspaces.size > 0 ||
    fixture.pendingMcpWorkspaces.size > 0 ||
    fixture.pendingSkillWorkspaces?.size > 0
  );
}
function readGitFixture(fixture, raw, sender) {
  const request = validateGitReviewRequest(raw);
  const workspace = fixture.snapshot.workspaces.find(
    (w) => w.id === request.workspaceId,
  );
  if (!workspace) return failure("NOT_FOUND");
  if (gitHeld(fixture, workspace.id)) return failure("UNAVAILABLE");
  const scope = gitScope(fixture, workspace);
  const trusted = workspace.trusted,
    trustRevision = workspace.trustRevision;
  const name = fixture.gitState;
  let value;
  if (request.type === "git.review.read") {
    const reason = {
      unsupported: "unsupported_repository",
      configuration: "unsupported_configuration",
      unavailable: "git_unavailable",
    }[name];
    if (reason) value = { ...scope, status: "unavailable", reason };
    else {
      const objectFormat =
        fixture.gitBranchRestoreState === "sha256" ||
        fixture.gitIndexState === "sha256" ||
        fixture.gitCommitState === "sha256"
          ? "sha256"
          : "sha1";
      const oidLength = objectFormat === "sha256" ? 64 : 40;
      const head = fixture.gitBranchRestoreState
        ? fixture.syntheticGitBranchRestores.get(workspace.id).headOid
        : fixture.gitCommitState
          ? fixture.syntheticGitCommits.get(workspace.id).headOid
          : name === "unborn" ||
              ["absent", "unborn-existing"].includes(fixture.gitIndexState)
            ? null
            : "1".repeat(oidLength);
      const branches = fixture.gitBranchRestoreState
        ? Object.entries(
            fixture.syntheticGitBranchRestores.get(workspace.id).branches,
          ).map(([ref, oid]) => ({ name: ref.slice(11), oid }))
        : [
            ...(head === null ? [] : [{ name: "main", oid: head }]),
            { name: "review/diverged-local-tip", oid: "2".repeat(oidLength) },
          ];
      const path = "notes/SYNTHETIC-editor.txt";
      const files = [
        { path, index: "modified", worktree: "modified", kind: "tracked" },
        {
          path: "notes/SYNTHETIC-other.txt",
          index: "added",
          worktree: "none",
          kind: "tracked",
        },
        {
          path: "notes/SYNTHETIC-untracked.txt",
          index: "none",
          worktree: "none",
          kind: "untracked",
        },
        {
          path: "notes/SYNTHETIC-conflict.txt",
          index: "unmerged",
          worktree: "unmerged",
          kind: "conflict",
        },
        {
          path: "AGENTS.md",
          index: "none",
          worktree: "modified",
          kind: "tracked",
        },
        {
          path: "assets/SYNTHETIC-binary.bin",
          index: "none",
          worktree: "modified",
          kind: "tracked",
        },
      ];
      if (name === "unborn") files[0].index = "added";
      if (["base-only-equal", "base-only-different"].includes(name))
        files[0] = { path, index: "none", worktree: "none", kind: "untracked" };
      const observationId = gitHash([
        "SYNTHETIC-NOT-G2",
        sender,
        scope,
        workspace.trusted,
        workspace.trustRevision,
        ++fixture.gitSerial,
      ]);
      value = {
        ...scope,
        status: "available",
        observationId,
        repository: {
          worktreePath: workspace.path,
          gitDirectory:
            "/synthetic/git-common/.git/worktrees/selectable-linked-worktree",
          commonDirectory: "/synthetic/git-common/.git",
          objectFormat,
          head,
          branch: fixture.gitBranchRestoreState
            ? (fixture.syntheticGitBranchRestores
                .get(workspace.id)
                .currentBranch?.slice(11) ?? null)
            : name === "detached" || fixture.gitCommitState === "detached"
              ? null
              : "main",
        },
        branches,
        files: fixture.gitBranchRestoreState
          ? fixture.syntheticGitBranchRestores.get(workspace.id).dirty
            ? Object.keys(
                fixture.syntheticGitBranchRestores.get(workspace.id)
                  .indexEntries,
              ).map((path) => ({
                path,
                index: "none",
                worktree: "modified",
                kind: "tracked",
              }))
            : []
          : fixture.gitCommitState
            ? fixture.syntheticGitCommits
                .get(workspace.id)
                .worktreePaths.map((path) => {
                  const e = fixture.syntheticGitCommits.get(workspace.id)
                    .changes[path];
                  return {
                    path,
                    index: !e
                      ? "none"
                      : e.after === null
                        ? "deleted"
                        : e.before === null
                          ? "added"
                          : "modified",
                    worktree: "modified",
                    kind: "tracked",
                  };
                })
            : name === "clean"
              ? []
              : files,
      };
      validateGitReviewObservation(value);
      fixture.gitObservations.set(observationId, {
        value: clone(value),
        sender,
        at: fixture.gitNow,
        trusted: workspace.trusted,
        trustRevision: workspace.trustRevision,
      });
      const same = [...fixture.gitObservations].filter(
        ([, r]) => r.value.workspaceId === workspace.id,
      );
      for (const [key] of same.slice(
        0,
        -GIT_REVIEW_LIMITS.observationsPerWorkspace,
      ))
        fixture.gitObservations.delete(key);
      while (fixture.gitObservations.size > GIT_REVIEW_LIMITS.observations)
        fixture.gitObservations.delete(
          fixture.gitObservations.keys().next().value,
        );
    }
    validateGitReviewObservation(value);
  } else {
    const record = fixture.gitObservations.get(request.observationId);
    if (
      !record ||
      record.sender !== sender ||
      record.value.workspaceId !== workspace.id ||
      record.value.workspacePath !== workspace.path ||
      record.value.runtimeEpoch !== scope.runtimeEpoch ||
      record.trusted !== workspace.trusted ||
      record.trustRevision !== workspace.trustRevision
    )
      return failure("NOT_FOUND");
    const row = record.value.files.find((f) => f.path === request.path);
    const branch = record.value.branches.find(
      (b) => b.name === request.baseRef,
    );
    if (!row || (request.mode === "base" && !branch))
      return failure("INVALID_SELECTION");
    const reason =
      name === "expired" ||
      fixture.gitNow - record.at >= GIT_REVIEW_LIMITS.observationMs
        ? "expired_observation"
        : name === "stale" || record.value.revision !== scope.revision
          ? "stale_observation"
          : row.path === "AGENTS.md"
            ? "protected_source"
            : row.path.endsWith(".bin")
              ? "binary"
              : row.kind === "conflict"
                ? "conflict"
                : row.kind === "untracked" && request.mode === "staged"
                  ? "not_staged"
                  : undefined;
    // One-line synthetic source model. Empty sides must stay empty: untracked
    // unstaged and unborn staged are additions, and unchanged index/worktree
    // bytes produce an empty patch. This is not a replacement Git diff engine.
    const before =
      request.mode === "base"
        ? "SYNTHETIC DIVERGED LOCAL TIP"
        : request.mode === "staged"
          ? record.value.repository.head === null || row.index === "added"
            ? null
            : "SYNTHETIC HEAD"
          : row.kind === "untracked"
            ? null
            : "SYNTHETIC INDEX";
    const after =
      request.mode === "staged"
        ? row.index === "deleted"
          ? null
          : "SYNTHETIC INDEX"
        : request.mode === "base" && name === "base-only-equal"
          ? before
          : request.mode === "unstaged" &&
              row.worktree === "none" &&
              row.kind !== "untracked"
            ? before
            : row.worktree === "deleted"
              ? null
              : "<script>SYNTHETIC INERT TEXT</script>";
    const patch =
      before === after
        ? ""
        : `diff --git a/${row.path} b/${row.path}\n--- ${before === null ? "/dev/null" : `a/${row.path}`}\n+++ ${after === null ? "/dev/null" : `b/${row.path}`}\n@@ -${before === null ? "0,0" : "1"} +${after === null ? "0,0" : "1"} @@\n${before === null ? "" : `-${before}\n`}${after === null ? "" : `+${after}\n`}`;
    value = {
      ...scope,
      observationId: request.observationId,
      path: request.path,
      mode: request.mode,
      ...(request.mode === "base" && {
        baseRef: request.baseRef,
        baseOid: branch.oid,
      }),
      ...(reason
        ? { status: "unavailable", reason }
        : {
            status: "available",
            patch: fixture.gitPatchOverride ?? patch,
            sourceDigest: gitHash([
              "SYNTHETIC",
              request,
              before,
              after,
              ...(fixture.gitPatchOverride === undefined
                ? []
                : [fixture.gitPatchOverride]),
            ]),
          }),
    };
    validateGitDiffObservation(value);
    fixture.lastGitDiffObservation = clone(value);
  }
  const result = { ok: true, value: clone(value) };
  if (
    (fixture.holdGitStatus && request.type === "git.review.read") ||
    (fixture.holdGitDiff && request.type === "git.diff.read")
  )
    return new Promise((resolve) =>
      fixture.heldGitReads.push({
        kind: request.type,
        release() {
          const current = fixture.snapshot.workspaces.find(
            (w) => w.id === scope.workspaceId,
          );
          resolve(
            !current ||
              JSON.stringify(gitScope(fixture, current)) !==
                JSON.stringify(scope) ||
              current.trusted !== trusted ||
              current.trustRevision !== trustRevision ||
              gitHeld(fixture, workspace.id)
              ? failure("STALE")
              : result,
          );
        },
      }),
    );
  return result;
}

// Selected index simulation. Maps are not original filesystem/native authority.
export const GIT_INDEX_UI_STATES = Object.freeze([
  "ready",
  "sha256",
  "absent",
  "unborn-existing",
  "no_changes",
  "stale_observation",
  "expired_observation",
  "lock_conflict",
  "unsupported_index_mutation",
  "pending-preview",
  "denied",
  "unknown",
  "retained",
  "held",
  "global-held",
  "untrusted",
]);
export function applyGitIndexState(fixture, name) {
  if (!GIT_INDEX_UI_STATES.includes(name))
    throw new Error("Unknown synthetic index state");
  if (fixture.pendingGitIndexWorkspaces.size)
    throw new Error(
      "Release owned synthetic index calls before resetting state",
    );
  const scope = fixture.setGitState(
    ["held", "global-held", "untrusted"].includes(name) ? name : "ready",
  );
  fixture.gitIndexState = name;
  fixture.gitIndexPreviews.clear();
  fixture.gitIndexReads = [];
  fixture.gitIndexEffects = [];
  fixture.syntheticGitIndexes.clear();
  fixture.syntheticGitIndexBackups.clear();
  fixture.holdGitIndexPreview = name === "pending-preview";
  fixture.nextGitIndexApply = ["denied", "unknown"].includes(name)
    ? name
    : undefined;
  fixture.snapshot.workspaces.push({
    ...clone(fixture.snapshot.workspaces[0]),
    id: "synthetic-index-other-w",
    name: "SYNTHETIC independent index workspace",
    path: "/synthetic/independent-index-workspace",
    trusted: true,
  });
  fixture.snapshot.sessions.push({
    ...clone(fixture.snapshot.sessions[0]),
    id: "synthetic-index-other-s",
    workspaceId: "synthetic-index-other-w",
    title: "SYNTHETIC selectable other draft",
    status: "idle",
  });
  const format = name === "sha256" ? "sha256" : "sha1";
  const length = format === "sha256" ? 64 : 40;
  for (const workspace of fixture.snapshot.workspaces) {
    const exists = name !== "absent";
    const entries = exists
      ? {
          "notes/SYNTHETIC-editor.txt": {
            mode: 0o100644,
            oid: "3".repeat(length),
          },
          "notes/SYNTHETIC-other.txt": {
            mode: 0o100755,
            oid: "4".repeat(length),
          },
        }
      : {};
    fixture.syntheticGitIndexes.set(workspace.id, {
      syntheticOnly: true,
      exists,
      entries,
      digest: exists
        ? gitHash(["SYNTHETIC-index", workspace.id, entries])
        : GIT_ABSENT_INDEX_DIGEST,
    });
  }
  fixture.gitIndexRetainedKey = undefined;
  if (name === "retained") {
    const key = {
      runtimeEpoch: "synthetic-original-index-epoch",
      operationId: "synthetic-retained-index",
    };
    fixture.gitIndexRetainedKey = key;
    fixture.retainedReceipts.set(
      JSON.stringify([key.runtimeEpoch, key.operationId]),
      {
        digest: "synthetic-retained-no-resend-authority",
        receipt: {
          ...key,
          type: "git.index.apply",
          workspaceId: scope.workspaceId,
          admission: "dispatched",
          delivery: "unknown",
          effect: "unknown",
          revision: fixture.snapshot.revision,
          evidence: [],
        },
      },
    );
    fixture.snapshot.recovery.resources.push({
      workspaceId: scope.workspaceId,
      state: "unavailable",
      reason: "unresolved_operation",
    });
    fixture.snapshot.retainedOperations = [
      {
        ...key,
        type: "git.index.apply",
        workspaceId: scope.workspaceId,
        authorityHold: true,
      },
    ];
  }
  validateSnapshot(fixture.snapshot);
  return scope;
}
function readGitIndexFixture(fixture, raw, sender) {
  const request = validateGitIndexRequest(raw);
  const workspace = fixture.snapshot.workspaces.find(
    (w) => w.id === request.workspaceId,
  );
  if (!workspace) return failure("NOT_FOUND");
  if (gitHeld(fixture, workspace.id)) return failure("UNAVAILABLE");
  if (!workspace.trusted) return failure("INVALID_SELECTION");
  const scope = gitScope(fixture, workspace);
  const observed = fixture.gitObservations.get(request.observationId);
  if (
    !observed ||
    observed.sender !== sender ||
    observed.value.workspaceId !== workspace.id ||
    observed.value.workspacePath !== workspace.path ||
    observed.value.runtimeEpoch !== scope.runtimeEpoch ||
    observed.trustRevision !== workspace.trustRevision
  )
    return failure("NOT_FOUND");
  const index = fixture.syntheticGitIndexes.get(workspace.id);
  if (!index) return failure("UNAVAILABLE");
  const format = observed.value.repository.objectFormat;
  const length = format === "sha256" ? 64 : 40;
  let reason = [
    "no_changes",
    "stale_observation",
    "expired_observation",
    "lock_conflict",
    "unsupported_index_mutation",
  ].includes(fixture.gitIndexState)
    ? fixture.gitIndexState
    : undefined;
  if (fixture.gitNow - observed.at >= GIT_REVIEW_LIMITS.observationMs)
    reason = "expired_observation";
  else if (observed.value.revision !== scope.revision)
    reason = "stale_observation";
  const entries = request.paths.map((path) => {
    const row = observed.value.files.find((f) => f.path === path);
    if (!row) reason = "stale_observation";
    else if (row.path === "AGENTS.md") reason = "protected_source";
    else if (row.kind === "conflict") reason = "conflict";
    else if (row.path.endsWith(".bin")) reason = "binary";
    return {
      path,
      before: index.entries[path] ?? null,
      after:
        request.action === "stage"
          ? { mode: 0o100644, oid: "5".repeat(length) }
          : observed.value.repository.head === null
            ? null
            : { mode: 0o100644, oid: "1".repeat(length) },
    };
  });
  if (
    !reason &&
    entries.every((r) => JSON.stringify(r.before) === JSON.stringify(r.after))
  )
    reason = "no_changes";
  let value;
  if (reason) value = { ...scope, status: "unavailable", reason };
  else {
    const nextEntries = clone(index.entries);
    for (const row of entries) nextEntries[row.path] = row.after;
    const target = {
      action: request.action,
      paths: [...request.paths],
      previewDigest: gitHash([
        "SYNTHETIC-preview",
        scope,
        request,
        entries,
        index.digest,
      ]),
      headOid: observed.value.repository.head,
      indexExists: index.exists,
      indexDigest: index.digest,
      nextIndexDigest: gitHash(["SYNTHETIC-index", workspace.id, nextEntries]),
      objectFormat: format,
    };
    value = {
      ...scope,
      status: "available",
      previewId: gitHash([
        "SYNTHETIC-preview-id",
        sender,
        ++fixture.gitSerial,
        target,
      ]),
      ...target,
      entries,
    };
    fixture.gitIndexPreviews.set(value.previewId, {
      sender,
      scope: clone(scope),
      target: clone(target),
      value: clone(value),
      trustRevision: workspace.trustRevision,
      at: fixture.gitNow,
    });
    const own = [...fixture.gitIndexPreviews].filter(
      ([, r]) => r.scope.workspaceId === workspace.id,
    );
    for (const [id] of own.slice(0, -GIT_INDEX_LIMITS.previewsPerWorkspace))
      fixture.gitIndexPreviews.delete(id);
    while (fixture.gitIndexPreviews.size > GIT_INDEX_LIMITS.previews)
      fixture.gitIndexPreviews.delete(
        fixture.gitIndexPreviews.keys().next().value,
      );
  }
  validateGitIndexPreview(value);
  const result = { ok: true, value: clone(value) };
  if (fixture.holdGitIndexPreview)
    return new Promise((resolve) =>
      fixture.heldGitIndexReads.push(() => {
        resolve(
          JSON.stringify(gitScope(fixture, workspace)) ===
            JSON.stringify(scope) &&
            workspace.trusted &&
            workspace.trustRevision === observed.trustRevision &&
            !gitHeld(fixture, workspace.id)
            ? result
            : failure("STALE"),
        );
      }),
    );
  return result;
}

// Commit simulation is intentionally not filesystem publication evidence.
export const GIT_COMMIT_UI_STATES = Object.freeze([
  "ready",
  "sha256",
  "unborn",
  "detached",
  "packed",
  "disabled-existing-logs",
  "absent-logs",
  "new-logs",
  "full-staged-deletion",
  "no_changes",
  "unsupported_commit_state",
  "pending-preview",
  "denied",
  "unknown",
  "retained",
  "held",
  "global-held",
  "untrusted",
]);
export function applyGitCommitState(fixture, name) {
  if (!GIT_COMMIT_UI_STATES.includes(name))
    throw new Error("Unknown synthetic commit state");
  if (fixture.pendingGitCommitWorkspaces.size)
    throw new Error(
      "Release owned synthetic commit calls before resetting state",
    );
  const scope = fixture.setGitIndexState(
    ["held", "global-held", "untrusted"].includes(name)
      ? name
      : name === "sha256"
        ? "sha256"
        : name === "unborn"
          ? "unborn-existing"
          : "ready",
  );
  fixture.gitCommitState = name;
  fixture.gitCommitPreviews.clear();
  fixture.gitCommitReads = [];
  fixture.gitCommitEffects = [];
  fixture.syntheticGitCommits.clear();
  fixture.syntheticGitCommitBackups.clear();
  fixture.holdGitCommitPreview = name === "pending-preview";
  fixture.nextGitCommitApply = ["denied", "unknown"].includes(name)
    ? name
    : undefined;
  fixture.holdGitCommitApply = false;
  for (const workspace of fixture.snapshot.workspaces) {
    const length = name === "sha256" ? 64 : 40;
    const unborn = name === "unborn",
      detached = name === "detached";
    const paths = ["notes/SYNTHETIC-editor.txt", "notes/SYNTHETIC-other.txt"];
    const changes = Object.fromEntries(
      paths.map((path, i) => [
        path,
        {
          before: unborn
            ? null
            : { mode: 0o100644, oid: String(i + 1).repeat(length) },
          after:
            name === "full-staged-deletion"
              ? null
              : {
                  mode: i ? 0o100755 : 0o100644,
                  oid: String(i + 3).repeat(length),
                },
        },
      ]),
    );
    const index = fixture.syntheticGitIndexes.get(workspace.id);
    index.entries = Object.fromEntries(
      Object.entries(changes)
        .filter(([, e]) => e.after)
        .map(([path, e]) => [path, clone(e.after)]),
    );
    index.digest = gitHash([
      "SYNTHETIC-current-staged-index",
      workspace.id,
      index.entries,
    ]);
    fixture.syntheticGitCommits.set(workspace.id, {
      syntheticOnly: true,
      objectFormat: name === "sha256" ? "sha256" : "sha1",
      headOid: unborn ? null : "1".repeat(length),
      referenceKind: detached ? "head" : "branch",
      referenceName: detached ? null : "refs/heads/main",
      referenceExists: !unborn && name !== "packed",
      logRoles:
        name === "absent-logs"
          ? []
          : detached
            ? ["head_log"]
            : ["head_log", "branch_log"],
      logExists: !unborn && name !== "new-logs",
      changes,
      worktreePaths: [...paths],
      logAllRefUpdates: !["disabled-existing-logs", "absent-logs"].includes(
        name,
      ),
      marker: name === "unsupported_commit_state",
      noChanges: name === "no_changes",
      digest: gitHash([
        "SYNTHETIC-COMMIT-SOURCE",
        scope,
        workspace.id,
        name,
        changes,
      ]),
    });
  }
  fixture.gitCommitRetainedKey = undefined;
  if (name === "retained") {
    const key = {
      runtimeEpoch: "synthetic-original-commit-epoch",
      operationId: "synthetic-retained-commit",
    };
    fixture.gitCommitRetainedKey = key;
    fixture.retainedReceipts.set(
      JSON.stringify([key.runtimeEpoch, key.operationId]),
      {
        digest: "synthetic-retained-no-resend-authority",
        receipt: {
          ...key,
          type: "git.commit.apply",
          workspaceId: scope.workspaceId,
          admission: "dispatched",
          delivery: "unknown",
          effect: "unknown",
          revision: fixture.snapshot.revision,
          evidence: [],
        },
      },
    );
    fixture.snapshot.recovery.resources.push({
      workspaceId: scope.workspaceId,
      state: "unavailable",
      reason: "unresolved_operation",
    });
    fixture.snapshot.retainedOperations = [
      {
        ...key,
        type: "git.commit.apply",
        workspaceId: scope.workspaceId,
        authorityHold: true,
      },
    ];
  }
  validateSnapshot(fixture.snapshot);
  return scope;
}
function readGitCommitFixture(fixture, raw, sender) {
  const request = validateGitCommitRequest(raw);
  const workspace = fixture.snapshot.workspaces.find(
    (w) => w.id === request.workspaceId,
  );
  if (!workspace) return failure("NOT_FOUND");
  if (gitHeld(fixture, workspace.id)) return failure("UNAVAILABLE");
  if (!workspace.trusted) return failure("INVALID_SELECTION");
  if (
    fixture.snapshot.sessions.some(
      (s) => s.workspaceId === workspace.id && s.status !== "idle",
    )
  )
    return failure("BUSY");
  const scope = gitScope(fixture, workspace),
    observed = fixture.gitObservations.get(request.observationId);
  if (
    !observed ||
    observed.sender !== sender ||
    observed.value.workspaceId !== workspace.id ||
    observed.value.workspacePath !== workspace.path ||
    observed.value.runtimeEpoch !== scope.runtimeEpoch ||
    observed.trustRevision !== workspace.trustRevision
  )
    return failure("NOT_FOUND");
  const source = fixture.syntheticGitCommits.get(workspace.id);
  if (!source) return failure("UNAVAILABLE");
  let reason = source.marker
    ? "unsupported_commit_state"
    : source.noChanges || !Object.keys(source.changes).length
      ? "no_changes"
      : undefined;
  if (fixture.gitNow - observed.at >= GIT_REVIEW_LIMITS.observationMs)
    reason = "expired_observation";
  else if (observed.value.revision !== scope.revision)
    reason = "stale_observation";
  let value;
  if (reason) value = { ...scope, status: "unavailable", reason };
  else {
    const canonicalMessage = canonicalGitCommitMessage(request.message),
      length = source.objectFormat === "sha256" ? 64 : 40;
    const entries = Object.entries(source.changes)
      .sort(([a], [b]) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
      .map(([path, e]) => ({ path, ...clone(e) }));
    const target = {
      objectFormat: source.objectFormat,
      previewDigest: gitHash([
        "SYNTHETIC-commit-preview",
        scope,
        source.digest,
        request,
      ]),
      indexDigest: fixture.syntheticGitIndexes.get(workspace.id).digest,
      headOid: source.headOid,
      treeOid: "7".repeat(length),
      treeDigest: gitHash(
        entries
          .filter((e) => e.after)
          .map((e) => [e.path, e.after.mode, e.after.oid]),
      ),
      commitOid: "8".repeat(length),
      commitBodyDigest: gitHash([
        "SYNTHETIC-commit-body",
        request.author,
        canonicalMessage,
      ]),
      reference: {
        kind: source.referenceKind,
        name: source.referenceName,
        exists: source.referenceExists,
        digest: source.referenceExists
          ? gitHash(["SYNTHETIC-reference", source.headOid])
          : GIT_COMMIT_ABSENT_DIGEST,
        nextDigest: gitHash(["SYNTHETIC-next-reference", "8".repeat(length)]),
      },
      logs: source.logRoles.map((role) => ({
        role,
        exists: source.logExists,
        digest: source.logExists
          ? gitHash(["SYNTHETIC-original-log", role])
          : GIT_COMMIT_ABSENT_DIGEST,
        nextDigest: gitHash(["SYNTHETIC-next-log", role, source.digest]),
        nextBytes: 256,
      })),
    };
    value = {
      ...scope,
      status: "available",
      previewId: gitHash([
        "SYNTHETIC-commit-id",
        sender,
        ++fixture.gitSerial,
        target,
      ]),
      ...target,
      author: clone(request.author),
      timestamp: 1791460800,
      canonicalMessage,
      entries,
    };
    fixture.gitCommitPreviews.set(value.previewId, {
      sender,
      scope: clone(scope),
      target: clone(target),
      value: clone(value),
      trustRevision: workspace.trustRevision,
      sourceDigest: source.digest,
      at: fixture.gitNow,
    });
    const own = [...fixture.gitCommitPreviews].filter(
      ([, r]) => r.scope.workspaceId === workspace.id,
    );
    for (const [id] of own.slice(0, -GIT_COMMIT_LIMITS.previewsPerWorkspace))
      fixture.gitCommitPreviews.delete(id);
    while (fixture.gitCommitPreviews.size > GIT_COMMIT_LIMITS.previews)
      fixture.gitCommitPreviews.delete(
        fixture.gitCommitPreviews.keys().next().value,
      );
  }
  const sourceDigest = source.digest;
  validateGitCommitPreview(value);
  const result = { ok: true, value: clone(value) };
  if (fixture.holdGitCommitPreview)
    return new Promise((resolve) =>
      fixture.heldGitCommitReads.push(() => {
        resolve(
          JSON.stringify(gitScope(fixture, workspace)) ===
            JSON.stringify(scope) &&
            workspace.trusted &&
            workspace.trustRevision === observed.trustRevision &&
            !gitHeld(fixture, workspace.id) &&
            fixture.syntheticGitCommits.get(workspace.id)?.digest ===
              sourceDigest
            ? result
            : failure("STALE"),
        );
      }),
    );
  return result;
}

// Explicit synthetic branch/restore state. No disk, Git, kernel or journal proof.
export const GIT_BRANCH_RESTORE_UI_STATES = Object.freeze([
  "ready",
  "restore-changes",
  "sha256",
  "detached",
  "packed",
  "new-logs",
  "absent-logs",
  "disabled-existing-logs",
  "dirty",
  "unborn",
  "branch_occupied",
  "branch_conflict",
  "protected_source",
  "unsupported_configuration",
  "unsupported_branch_restore_state",
  "pending-preview",
  "denied",
  "unknown",
  "held",
  "global-held",
  "untrusted",
  "retained",
]);
const syntheticBranchPaths = [
  "notes/SYNTHETIC-editor.txt",
  "notes/SYNTHETIC-mode.sh",
  "notes/SYNTHETIC-other.txt",
];
const syntheticByteState = (label) => ({
  bytes: 64,
  digest: gitHash(["SYNTHETIC-bytes", label]),
});
export function applyGitBranchRestoreState(fixture, name) {
  if (!GIT_BRANCH_RESTORE_UI_STATES.includes(name))
    throw new Error("Unknown synthetic branch/restore state");
  if (
    fixture.pendingGitBranchRestoreWorkspaces.size ||
    fixture.pendingGitBranchRestoreReadWorkspaces.size
  )
    throw new Error(
      "Release owned synthetic branch/restore calls before resetting state",
    );
  const scope = fixture.setGitIndexState(
    ["held", "global-held", "untrusted", "sha256"].includes(name)
      ? name
      : "ready",
  );
  fixture.gitBranchRestoreState = name;
  fixture.gitBranchRestorePreviews.clear();
  fixture.gitBranchRestoreReads = [];
  fixture.gitBranchRestoreEffects = [];
  fixture.syntheticGitBranchRestores.clear();
  fixture.syntheticGitBranchRestoreBackups.clear();
  fixture.holdGitBranchRestorePreview = name === "pending-preview";
  fixture.holdGitBranchRestoreApply = false;
  fixture.nextGitBranchRestoreApply = ["denied", "unknown"].includes(name)
    ? name
    : undefined;
  for (const w of fixture.snapshot.workspaces) {
    const length = name === "sha256" ? 64 : 40;
    const indexEntries = Object.fromEntries(
      syntheticBranchPaths.map((p, i) => [
        p,
        { mode: 0o100644, oid: String(i + 3).repeat(length) },
      ]),
    );
    const headEntries = Object.fromEntries(
      syntheticBranchPaths
        .filter((p) => !p.endsWith("other.txt"))
        .map((p, i) => [
          p,
          {
            mode: p.endsWith(".sh") ? 0o100755 : 0o100644,
            oid: String(i + 6).repeat(length),
          },
        ]),
    );
    const changed = ["restore-changes", "dirty"].includes(name);
    const worktree = Object.fromEntries(
      syntheticBranchPaths
        .filter((_, i) => !changed || i !== 0)
        .map((p) => [
          p,
          {
            ...syntheticByteState(
              changed
                ? [w.id, p, "original"]
                : ["chosen-source", indexEntries[p].oid, p],
            ),
            mode: 0o640,
          },
        ]),
    );
    fixture.syntheticGitBranchRestores.set(w.id, {
      syntheticOnly: true,
      objectFormat: name === "sha256" ? "sha256" : "sha1",
      headOid: name === "unborn" ? null : "1".repeat(length),
      currentBranch: name === "detached" ? null : "refs/heads/main",
      branches: {
        "refs/heads/main": "1".repeat(length),
        "refs/heads/review/diverged-local-tip": "2".repeat(length),
      },
      headDigest: gitHash(["SYNTHETIC-head", w.id]),
      indexDigest: fixture.syntheticGitIndexes.get(w.id).digest,
      indexEntries,
      headEntries: changed ? headEntries : clone(indexEntries),
      targetEntries: headEntries,
      worktree,
      logs:
        name === "new-logs" || name === "absent-logs"
          ? {}
          : {
              head_log: syntheticByteState("head-log"),
              branch_log: syntheticByteState("branch-log"),
            },
      logEnabled: !["absent-logs", "disabled-existing-logs"].includes(name),
      markers:
        name === "unsupported_branch_restore_state" ? ["MERGE_HEAD"] : [],
      occupied: name === "branch_occupied",
      collision: name === "branch_conflict",
      dirty: ["dirty", "restore-changes"].includes(name),
      protected: name === "protected_source",
      normalization: name === "unsupported_configuration",
      untracked: {
        "notes/SYNTHETIC-untracked.txt": syntheticByteState("untracked"),
      },
      ignored: { "cache/SYNTHETIC-ignored.txt": syntheticByteState("ignored") },
      emptyDirectories: ["SYNTHETIC-empty"],
      digest: gitHash(["SYNTHETIC-branch-restore-source", scope, w.id, name]),
    });
  }
  fixture.gitBranchRestoreRetainedKey = undefined;
  if (name === "retained") {
    const key = {
      runtimeEpoch: "synthetic-original-branch-restore-epoch",
      operationId: "synthetic-retained-branch-restore",
    };
    fixture.gitBranchRestoreRetainedKey = key;
    fixture.retainedReceipts.set(
      JSON.stringify([key.runtimeEpoch, key.operationId]),
      {
        digest: "synthetic-retained-no-resend-authority",
        receipt: {
          ...key,
          type: "git.restore.apply",
          workspaceId: scope.workspaceId,
          admission: "dispatched",
          delivery: "unknown",
          effect: "unknown",
          revision: fixture.snapshot.revision,
          evidence: [],
        },
      },
    );
    fixture.snapshot.recovery.resources.push({
      workspaceId: scope.workspaceId,
      state: "unavailable",
      reason: "unresolved_operation",
    });
    fixture.snapshot.retainedOperations = [
      {
        ...key,
        type: "git.restore.apply",
        workspaceId: scope.workspaceId,
        authorityHold: true,
      },
    ];
  }
  validateSnapshot(fixture.snapshot);
  return { ...scope, paths: [...syntheticBranchPaths] };
}
function branchRestoreRefusal(source, request) {
  if (source.markers.some((m) => GIT_BRANCH_RESTORE_STATE_MARKERS.includes(m)))
    return "unsupported_branch_restore_state";
  if (source.headOid === null) return "unsupported_branch_restore";
  if (source.protected) return "protected_source";
  if (source.normalization) return "unsupported_configuration";
  if (
    request.action === "create" &&
    (source.branches[request.branch] || source.occupied)
  )
    return "branch_conflict";
  if (request.action === "select") {
    if (source.occupied) return "branch_occupied";
    if (source.collision) return "branch_conflict";
    if (source.dirty) return "conflict";
    if (!source.branches[request.branch]) return "branch_conflict";
    if (source.currentBranch === request.branch) return "no_changes";
  }
  if (
    request.type === "git.restore.preview.read" &&
    request.paths.some((p) =>
      request.source === "index"
        ? !source.indexEntries[p]
        : !source.indexEntries[p] && !source.headEntries[p],
    )
  )
    return "missing_file";
}
function readGitBranchRestoreFixture(fixture, raw, sender) {
  const request = validateGitBranchRestoreRequest(raw);
  const workspace = fixture.snapshot.workspaces.find(
    (w) => w.id === request.workspaceId,
  );
  if (!workspace) return failure("NOT_FOUND");
  if (gitHeld(fixture, workspace.id)) return failure("UNAVAILABLE");
  if (!workspace.trusted) return failure("INVALID_SELECTION");
  if (
    fixture.snapshot.sessions.some(
      (s) => s.workspaceId === workspace.id && s.status !== "idle",
    )
  )
    return failure("BUSY");
  const scope = gitScope(fixture, workspace),
    observed = fixture.gitObservations.get(request.observationId);
  if (
    !observed ||
    observed.sender !== sender ||
    observed.value.workspaceId !== workspace.id ||
    observed.value.workspacePath !== workspace.path ||
    observed.value.runtimeEpoch !== scope.runtimeEpoch ||
    observed.trustRevision !== workspace.trustRevision
  )
    return failure("NOT_FOUND");
  const source = fixture.syntheticGitBranchRestores.get(workspace.id);
  if (!source) return failure("UNAVAILABLE");
  let reason = branchRestoreRefusal(source, request);
  if (fixture.gitNow - observed.at >= GIT_REVIEW_LIMITS.observationMs)
    reason = "expired_observation";
  else if (observed.value.revision !== scope.revision)
    reason = "stale_observation";
  let value;
  if (reason) value = { ...scope, status: "unavailable", reason };
  else {
    const action =
      request.type === "git.restore.preview.read" ? "restore" : request.action;
    const length = source.objectFormat === "sha256" ? 64 : 40;
    const paths = (
      action === "create"
        ? []
        : action === "restore"
          ? request.paths
          : syntheticBranchPaths
    )
      .map((path) => {
        const before = clone(source.worktree[path] ?? null),
          beforeEntry = clone(source.indexEntries[path] ?? null);
        const afterEntry = clone(
          action === "restore" && request.source === "index"
            ? beforeEntry
            : ((action === "select"
                ? source.targetEntries
                : source.headEntries)[path] ?? null),
        );
        const after = afterEntry
          ? {
              ...syntheticByteState(["chosen-source", afterEntry.oid, path]),
              mode: gitBranchRestoreMode(
                before?.mode ?? null,
                afterEntry.mode === 0o100755,
              ),
            }
          : null;
        return { path, before, after, beforeEntry, afterEntry, ident: false };
      })
      .filter((p) => JSON.stringify(p.before) !== JSON.stringify(p.after));
    const metadata = [];
    const add = (role, before) =>
      metadata.push({
        role,
        before: clone(before),
        after: syntheticByteState([role, request, source.digest]),
      });
    if (action === "select") {
      add("index", { bytes: 64, digest: source.indexDigest });
      if (source.logEnabled || source.logs.head_log)
        add("head_log", source.logs.head_log ?? null);
      add("head_ref", { bytes: 64, digest: source.headDigest });
    } else if (action === "create") {
      if (source.logEnabled || source.logs.branch_log)
        add("branch_log", source.logs.branch_log ?? null);
      add("branch_ref", null);
    }
    const timestamp = action === "restore" ? null : 1791460800;
    const target = {
      action,
      objectFormat: source.objectFormat,
      previewDigest: gitHash([
        "SYNTHETIC-preview",
        scope,
        source.digest,
        request,
      ]),
      occupancyDigest: gitHash(["SYNTHETIC-occupancy", source.occupied]),
      branch: action === "restore" ? null : request.branch,
      source: action === "restore" ? request.source : null,
      currentBranch: source.currentBranch,
      headOid: source.headOid,
      nextHeadOid:
        action === "select" ? source.branches[request.branch] : source.headOid,
      treeOid: "7".repeat(length),
      headDigest: source.headDigest,
      indexExists: true,
      indexDigest: source.indexDigest,
      identityDigest:
        action === "restore"
          ? null
          : gitBranchRestoreIdentityDigest(request.author, timestamp),
      timestamp,
      paths,
      metadata,
    };
    if (action === "restore" && !paths.length)
      value = { ...scope, status: "unavailable", reason: "no_changes" };
    else {
      value = {
        ...scope,
        status: "available",
        previewId: gitHash([
          "SYNTHETIC-id",
          sender,
          ++fixture.gitSerial,
          target,
        ]),
        ...target,
        author: action === "restore" ? null : clone(request.author),
      };
      fixture.gitBranchRestorePreviews.set(value.previewId, {
        sender,
        scope: clone(scope),
        target: clone(target),
        value: clone(value),
        request: clone(request),
        trustRevision: workspace.trustRevision,
        sourceDigest: source.digest,
        at: fixture.gitNow,
      });
      const own = [...fixture.gitBranchRestorePreviews].filter(
        ([, r]) => r.scope.workspaceId === workspace.id,
      );
      for (const [id] of own.slice(
        0,
        -GIT_BRANCH_RESTORE_LIMITS.previewsPerWorkspace,
      ))
        fixture.gitBranchRestorePreviews.delete(id);
      while (
        fixture.gitBranchRestorePreviews.size >
        GIT_BRANCH_RESTORE_LIMITS.previews
      )
        fixture.gitBranchRestorePreviews.delete(
          fixture.gitBranchRestorePreviews.keys().next().value,
        );
    }
  }
  validateGitBranchRestorePreview(value);
  const result = { ok: true, value: clone(value) },
    sourceDigest = source.digest;
  if (fixture.holdGitBranchRestorePreview)
    return new Promise((resolve) =>
      fixture.heldGitBranchRestoreReads.push(() =>
        resolve(
          JSON.stringify(gitScope(fixture, workspace)) ===
            JSON.stringify(scope) &&
            workspace.trusted &&
            workspace.trustRevision === observed.trustRevision &&
            !gitHeld(fixture, workspace.id) &&
            fixture.syntheticGitBranchRestores.get(workspace.id)?.digest ===
              sourceDigest &&
            !branchRestoreRefusal(source, request)
            ? result
            : failure("STALE"),
        ),
      ),
    );
  return result;
}

async function startHiddenHost() {
  const { app, BrowserWindow, ipcMain } = await import("electron");
  const testRoot = process.env.OMOC_UI_TEST_ROOT;
  if (!testRoot) throw new Error("An owned UI test root is required");
  const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const renderer = join(desktop, "dist/app/renderer/index.html");
  for (const name of ["profile", "session", "logs", "crashes"])
    mkdirSync(join(testRoot, name), { recursive: true, mode: 0o700 });
  app.setPath("userData", join(testRoot, "profile"));
  app.setPath("sessionData", join(testRoot, "session"));
  app.setPath("logs", join(testRoot, "logs"));
  app.setPath("crashDumps", join(testRoot, "crashes"));
  const fixture = createUiFixture();
  if (process.env.OMOC_P6_PERFORMANCE === "1")
    fixture.enablePerformanceSessions();
  globalThis.__omocUiFixture = fixture;
  if (process.platform === "darwin") app.setActivationPolicy("prohibited");
  // Do not await readiness while Electron evaluates its ESM entry.
  app
    .whenReady()
    .then(async () => {
      const mainWindow = new BrowserWindow({
        width: 1180,
        height: 820,
        show: false,
        focusable: false,
        webPreferences: {
          backgroundThrottling: false,
          preload: join(desktop, "dist/app/preload.cjs"),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true,
          webviewTag: false,
        },
      });
      const allowedUrl = (url) => url === pathToFileURL(renderer).href;
      const transport = createFixtureTransport(fixture, {
        webContents: mainWindow.webContents,
        allowedUrl,
      });
      globalThis.__omocUiMetrics = () => transport.metrics();
      globalThis.__omocUiMutationMetrics = () => transport.mutationMetrics();
      mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      mainWindow.webContents.on("will-navigate", (event, url) => {
        if (!allowedUrl(url)) event.preventDefault();
      });
      mainWindow.webContents.once("destroyed", () => transport.senderClosed());
      app.once("before-quit", () => transport.close());
      ipcMain.handle("desktop:v2:workbench", (event, ...args) =>
        transport.handle(event, ...args),
      );
      ipcMain.handle("desktop:v2:cancel-read", (event, ...args) =>
        transport.cancel(event, ...args),
      );
      await mainWindow.loadFile(renderer);
      app.on("window-all-closed", () => app.quit());
    })
    .catch((error) => {
      console.error("Synthetic UI host startup failed:", String(error));
      app.exit(1);
    });
}

// Importing this module in node:test never imports or launches Electron.
// Electron's debugging switches precede the entry path under Playwright.
// Node imports in unit tests do not contain this module as a CLI entry.
if (
  process.argv.some(
    (argument) => resolve(argument) === fileURLToPath(import.meta.url),
  )
)
  await startHiddenHost();
