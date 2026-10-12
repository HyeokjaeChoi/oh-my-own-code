import {
  matchesOrderedPermissionRules,
  matchesAuthenticatedFloor,
} from "./permission-policy-compiler.mjs";
import { compileModeRules, legacyModeRules } from "./permission-mode.mjs";
import {
  bootstrapHandoffProof,
  bootstrapMetadataDigest,
  bootstrapBaselinePermissions,
  bootstrapParentDigest,
  bootstrapStageDigest,
  bootstrapTaskProof,
} from "./native-permission-bootstrap-digest.mjs";
import { projectPermissionPolicy } from "./renderer/shared/configuration-draft/permission-policy.mjs";
import { createConversationContextIO } from "./host/conversation-context-io.mjs";
import {
  projectContextInbox,
  validContextPromptReceipt,
} from "./host/conversation-context-native.mjs";
import {
  contextModelSupports,
  validateContextObservation,
} from "./renderer/shared/conversation-context/index.mjs";
import {
  projectModelOptions,
  projectAssistantRuntime,
  projectSessionSelection,
} from "./renderer/shared/runtime-options/index.mjs";
import {
  validateGitBranchRestorePreview,
  validateGitBranchRestoreMutationResult,
  gitBranchRestoreTargetFromApply,
  GIT_BRANCH_RESTORE_STEPS,
} from "./renderer/shared/git-branch-restore/index.mjs";
import { gitBranchRestoreExpectedBackups } from "./host/git-branch-restore-contract.mjs";
import {
  validateGitCommitPreview,
  validateGitCommitMutationResult,
  gitCommitTargetFromApply,
  GIT_COMMIT_STEPS,
} from "./renderer/shared/git-commit/index.mjs";
import { gitCommitExpectedBackups } from "./host/git-commit-contract.mjs";
import {
  validateGitIndexPreview,
  validateGitIndexMutationResult,
  gitIndexTargetFromApply,
  GIT_INDEX_STEPS,
} from "./renderer/shared/git-index/index.mjs";
import { gitIndexBackupId } from "./host/workbench-git-index-storage.mjs";
import { readWorkspaceFile } from "./host/workbench-file-edit.mjs";
import {
  GIT_REVIEW_LIMITS,
  validateGitReviewObservation,
  validateGitDiffObservation,
} from "./renderer/shared/git-review/index.mjs";
import { fileTargetAdmission } from "./host/workbench-file-storage.mjs";
import {
  validateWorkspaceFileObservation,
  validateWorkspaceFileSave,
} from "./renderer/shared/workspace-file/index.mjs";
import { randomUUID, createHash } from "node:crypto";
import {
  createHostAdmission,
  currentScope,
  waitForReady,
} from "./host/workbench-admission.mjs";
import { performance } from "node:perf_hooks";
import { basename, isAbsolute } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { redactReceipt } from "./host/workbench-receipts.mjs";
import {
  BASELINE_POLICY,
  ERRORS,
  fail,
  failure,
  policyMatches,
  portableName,
  validateRequest,
  validateSnapshot,
} from "./workbench-contract.mjs";
import { searchFiles } from "./host/workbench-file-search.mjs";
import {
  canonicalDirectory,
  createFolder,
  listFiles,
  readFilePreview,
} from "./host/workbench-files.mjs";
import {
  discoverConfiguration,
  skillProvenance,
} from "./host/workbench-configuration.mjs";
import { configurationBackupId } from "./host/configuration-file-observation.mjs";
import { readConfigurationFile } from "./host/workbench-configuration-files.mjs";
import { listSkillFiles, readSkillFile } from "./host/workbench-skills.mjs";
import {
  INSTRUCTION_KEY,
  instructionDigest,
  observeInstructions,
  PENDING,
  verifiedInheritance,
} from "./host/workbench-instructions.mjs";

import {
  mcpStep,
  mcpNativeName,
  normalizeMcpDefinition,
  observeMcpCatalog,
  validateMcpLocalCwd,
} from "./host/workbench-mcp.mjs";

import {
  skillRuntimeStep,
  validSkillRuntimeObservation,
} from "./renderer/shared/configuration-draft/skill-runtime.mjs";
import {
  validateSkillRpcResult,
  nativeSkillDigest,
} from "./native-skills-protocol.mjs";
import {
  parseSkillRuntimeRecord,
  projectNativeSkillRows,
  skillRuntimeDigest,
  skillRuntimeIdentity,
  skillRuntimeDispatchProof,
  scanNativeSkillHistory,
} from "./host/workbench-native-skills.mjs";

import { listAgentFiles, readAgentFile } from "./host/workbench-agents.mjs";
import {
  validateExtensionsInventory,
  validateExtensionsObservation,
} from "./renderer/shared/configuration-draft/extensions.mjs";
import {
  agentRuntimeStep,
  validAgentRuntimeObservation,
} from "./renderer/shared/configuration-draft/agent-runtime.mjs";
import {
  validateAgentRpcResult,
  nativeAgentDigest,
} from "./native-agents-protocol.mjs";
import {
  parseAgentRuntimeRecord,
  projectNativeAgentRows,
  agentRuntimeDigest,
  agentRuntimeIdentity,
  agentRuntimeDispatchProof,
  readNativeAgentSessions,
} from "./host/workbench-native-agents.mjs";

const lifecycleTypes = new Set([
  "permission.mode.set",
  "session.rename",
  "session.pin",
  "session.archive",
  "session.fork",
  "session.remove",
]);
const mutationTypes = new Set([
  "git.branch.apply",
  "git.restore.apply",
  "git.commit.apply",
  "git.index.apply",
  "file.save",
  "configuration.agent.register",
  "configuration.agent.remove",
  "configuration.agent.save",
  "configuration.skill.register",
  "configuration.skill.remove",
  "configuration.skill.apply",
  "configuration.skill.save",
  "configuration.mcp.register",
  "configuration.mcp.connect",
  "configuration.mcp.disconnect",
  "configuration.mcp.remove",
  "configuration.instructions.apply",
  "configuration.instructions.remove",
  "configuration.save",
  ...lifecycleTypes,
  "workspace.import",
  "workspace.create",
  "workspace.remove",
  "session.create",
  "message.send",
  "command.run",
  "session.interrupt",
  "session.inbox.cancel",
  "permission.respond",
]);
// Operations whose workspace check requires every session's Native rules to
// match its recorded mode; drift is repaired by a separate mode.set first.
const policySyncTypes = new Set(
  [...mutationTypes].filter((type) =>
    /^(git\.|file\.save$|configuration\.)/.test(type),
  ),
);
const clip = (value, size = 8000) =>
  typeof value === "string" ? value.slice(0, size) : "";
const opaque = (value) =>
  typeof value === "string" && value.length > 0 && value.length <= 256;
const available = (entries) => ({ status: "available", entries });
const unavailable = () => ({ status: "unavailable", entries: [] });
const emptyCatalog = () =>
  Object.fromEntries(
    ["commands", "skills", "mcp", "agents", "models"].map((key) => [
      key,
      unavailable(),
    ]),
  );
const fingerprint = (request) =>
  createHash("sha256")
    .update(
      JSON.stringify(
        Object.keys(request)
          .sort()
          .map((key) => [key, request[key]]),
      ),
    )
    .digest("hex");
function structuredError(error) {
  return error?.status === 401 ||
    error?.status === 403 ||
    error?.type === "ProviderAuthError"
    ? "AUTH_REQUIRED"
    : "RUNTIME_ERROR";
}
export function projectMessages(data) {
  if (!Array.isArray(data)) fail("RUNTIME_ERROR");
  return data
    .slice(-100)
    .filter(
      (message) =>
        opaque(message.id) && ["user", "assistant"].includes(message.type),
    )
    .map((message) => ({
      id: message.id,
      role: message.type,
      ...(message.type === "user" &&
        Object.hasOwn(message, "files") &&
        (!Array.isArray(message.files) || message.files.length > 0) && {
          context: {
            status: "unavailable",
            ...(Array.isArray(message.files) &&
              message.files.length <= 8 && { count: message.files.length }),
          },
        }),
      ...(projectAssistantRuntime(message)
        ? { runtime: projectAssistantRuntime(message) }
        : {}),
      text:
        message.type === "user"
          ? clip(message.text, 32000)
          : clip(
              (message.content ?? [])
                .filter((part) => part.type === "text")
                .map((part) => clip(part.text, 32000))
                .join(""),
              32000,
            ),
      tools:
        message.type === "assistant"
          ? (message.content ?? [])
              .filter((part) => part.type === "tool" && opaque(part.id))
              .slice(0, 40)
              .map((part) => ({
                id: part.id,
                name: clip(part.name, 128),
                status:
                  part.state?.status === "streaming"
                    ? "pending"
                    : ["running", "completed", "error"].includes(
                          part.state?.status,
                        )
                      ? part.state.status
                      : "error",
                input: clip(
                  typeof part.state?.input === "string"
                    ? part.state.input
                    : JSON.stringify(part.state?.input ?? {}),
                ),
                output: !["streaming", "running", "completed"].includes(
                  part.state?.status,
                )
                  ? ERRORS.TOOL_ERROR
                  : clip(
                      (part.state?.content ?? [])
                        .filter((item) => item.type === "text")
                        .map((item) => clip(item.text))
                        .join("\n"),
                    ),
              }))
          : [],
    }));
}

export function createWorkbenchService({
  runtime,
  pickDirectory,
  probeWorkspace,
  confirmTrust,
  confirmSessionRemoval = async () => false,
  confirmConfigurationSave = async () => false,
  confirmInstructions = async () => false,
  confirmMcp = async () => false,
  confirmSkillRuntime = async () => false,
  confirmAgentRuntime = async () => false,
  deadlineMs = 10000,
  trustedTestAdapter = false,
  registry: registryInput,
  runtimeReady,
  runtimeEpoch,
  recoveryReason,
  bootstrap = false,
  recoverRetained = false,
  gitReader: gitReaderInput,
  gitIndexManager: gitIndexInput,
  gitCommitManager: gitCommitInput,
  gitBranchRestoreManager: gitBranchRestoreInput,
  confirmGitBranchRestore = async () => false,
  confirmGitCommit = async () => false,
  confirmGitIndex = async () => false,
  contextIO: contextIOInput,
}) {
  const contextIO = contextIOInput ?? createConversationContextIO();
  if (
    !contextIO ||
    !["observe", "acquire", "closeSender", "close"].every(
      (k) => typeof contextIO[k] === "function",
    )
  )
    fail("INVALID_REQUEST");
  if (typeof confirmAgentRuntime !== "function") fail("INVALID_REQUEST");
  if (
    gitReaderInput !== undefined &&
    (!gitReaderInput ||
      !["review", "diff", "closeSender", "close"].every(
        (name) => typeof gitReaderInput[name] === "function",
      ))
  )
    fail("INVALID_REQUEST");
  if (
    typeof confirmGitIndex !== "function" ||
    (gitIndexInput !== undefined &&
      (!gitIndexInput ||
        !["preview", "previewForApply", "apply", "closeSender", "close"].every(
          (name) => typeof gitIndexInput[name] === "function",
        )))
  )
    fail("INVALID_REQUEST");
  if (
    typeof confirmGitCommit !== "function" ||
    (gitCommitInput !== undefined &&
      (!gitCommitInput ||
        !["preview", "previewForApply", "apply", "closeSender", "close"].every(
          (name) => typeof gitCommitInput[name] === "function",
        )))
  )
    fail("INVALID_REQUEST");
  if (
    typeof confirmGitBranchRestore !== "function" ||
    (gitBranchRestoreInput !== undefined &&
      (!gitBranchRestoreInput ||
        !["preview", "previewForApply", "apply", "closeSender", "close"].every(
          (name) => typeof gitBranchRestoreInput[name] === "function",
        )))
  )
    fail("INVALID_REQUEST");
  let gitBranchRestoreManager = gitBranchRestoreInput;
  let gitCommitManager = gitCommitInput;
  let gitIndexManager = gitIndexInput;
  let gitReader = gitReaderInput;
  let gitReaderReady;
  let gitReaderClosing;
  function closeGitReader() {
    if (gitReader && !gitReaderClosing) {
      gitReaderClosing = Promise.allSettled([
        gitReader.close(),
        gitIndexManager?.close(),
        gitCommitManager?.close(),
        gitBranchRestoreManager?.close(),
      ]);
      gitReaderClosing.catch(() => {});
    }
  }
  let committed = { workspaces: new Map(), sessions: new Map() };
  const liveMcp = new Map();
  const skillObservations = new Map();
  const agentObservations = new Map();
  const nativeProjections = new Map();
  const resourceGenerations = new Map();
  function tables() {
    return currentScope()?.candidate ?? committed;
  }
  function cloneTables() {
    return {
      workspaces: new Map(
        [...committed.workspaces].map(([id, w]) => [id, { ...w }]),
      ),
      sessions: new Map(
        [...committed.sessions].map(([id, s]) => [
          id,
          {
            ...s,
            status: nativeProjections.get(id)?.status ?? s.status,
            awaiting: nativeProjections.get(id)?.awaiting ?? s.awaiting,
            receipts: new Map(s.receipts),
            invalidPermissions: new Set(s.invalidPermissions),
          },
        ]),
      ),
    };
  }
  let registry;
  let localRecovery = recoveryReason;
  let observationSequence = 0;
  let initializing = true;
  const storageReady = Promise.resolve(registryInput).then((value) => {
    registry = value;
  });
  storageReady.catch((error) => {
    localRecovery = error?.storageReason ?? "storage_denied";
  });
  const reads = new Map();
  const lifecycleReceipts = new Map();
  // Persisted on the session record; legacy records and forks are "ask".
  const modeOf = (s) => s?.permissionMode ?? "ask";
  const policyOk = (s, rules) =>
    matchesOrderedPermissionRules(compileModeRules(modeOf(s)), rules) ||
    matchesOrderedPermissionRules(legacyModeRules(modeOf(s)), rules);
  const diagnostics = {
    startedAt: Date.now(),
    observedOperations: 0,
    errors: 0,
    unknownOutcomes: 0,
    droppedEvents: 0,
    events: [],
  };
  function observe(request, result, started, owned) {
    const unknown =
      result.code === "UNKNOWN_OUTCOME" || result.value?.status === "unknown";
    const code = unknown
      ? "UNKNOWN_OUTCOME"
      : Object.hasOwn(ERRORS, result.code)
        ? result.code
        : undefined;
    const status = unknown
      ? "unknown"
      : result.ok
        ? "ok"
        : code === "CANCELLED"
          ? "cancelled"
          : "error";
    const elapsed = performance.now() - started;
    diagnostics.observedOperations++;
    if (status === "error") diagnostics.errors++;
    if (unknown) diagnostics.unknownOutcomes++;
    diagnostics.events.push({
      id: randomUUID(),
      timestamp: Date.now(),
      operation: request.type,
      ...owned,
      status,
      durationMs: Number.isFinite(elapsed)
        ? Math.max(0, Math.min(elapsed, 86400000))
        : 0,
      ...(code && { code }),
    });
    if (diagnostics.events.length > 500) {
      diagnostics.events.shift();
      diagnostics.droppedEvents++;
    }
  }
  const controller = new AbortController();
  let revision = 0;
  let defaultWorkspace;
  let defaultSession;
  let context = runtime?.workbenchContext?.();
  let client = context?.client;
  let ready;
  const host = createHostAdmission({
    execute: handleRequest,
    ready: () => ready,
    revision: () => registry?.status().revision ?? revision,
    registry: registryInput !== undefined ? () => registry : undefined,
    runtimeEpoch,
    mutationAllowed: () =>
      !localRecovery && (registryInput === undefined || !initializing),
    preflight: (operation, sender) => policySync(operation, sender),
    projectReceipt,
    deadlineMs,
  });
  let effectMethods = new Set(
    [
      client?.session?.update,
      client?.session?.create,
      client?.session?.fork,
      client?.session?.remove,
      client?.session?.switchAgent,
      client?.session?.switchModel,
      client?.session?.prompt,
      client?.session?.command,
      client?.session?.interrupt,
      client?.session?.inbox?.cancel,
      client?.permission?.reply,
    ].filter(Boolean),
  );
  function checkLive() {
    currentScope()?.check();
    if (controller.signal.aborted) fail("UNAVAILABLE");
  }
  function storageCheck() {
    if (
      localRecovery ||
      (registryInput !== undefined &&
        (!registry || registry.status().state !== "ready"))
    )
      fail("UNAVAILABLE");
  }
  async function markEffect(step = "registry.metadata", payload = {}) {
    checkLive();
    if (registry) {
      storageCheck();
      const owner = currentScope();
      if (!owner?.record) fail("UNAVAILABLE");
      const result = await registry.dispatch({
        ...operationKey(owner.record),
        step,
        ...payload,
      });
      if (result.status !== "dispatched") fail("UNKNOWN_OUTCOME");
    }
    currentScope()?.markEffect();
  }
  const operationKey = (record) => ({
    runtimeEpoch: record.runtimeEpoch,
    operationId: record.operationId,
  });
  function methodStep(fn, args) {
    if (fn === context?.nativeAgents?.register) return "native.agent.register";
    if (fn === context?.nativeAgents?.remove) return "native.agent.remove";
    if (fn === context?.nativeSkills?.registerDisabled)
      return "native.skill.register";
    if (fn === context?.nativeSkills?.removeOwned) return "native.skill.remove";
    if (fn === client.session?.skill) return "native.skill.apply";
    if (fn === client.mcp?.add) return "native.mcp.add";
    if (fn === client.mcp?.connect) return "native.mcp.connect";
    if (fn === client.mcp?.disconnect) return "native.mcp.disconnect";
    if (fn === client.mcp?.remove) return "native.mcp.remove";
    if (fn === client.session.instructions?.entry?.put)
      return "native.instructions.put";
    if (fn === client.session.instructions?.entry?.remove)
      return "native.instructions.remove";
    if (fn === client.session.create) return "native.create";
    if (fn === client.session.fork) return "native.fork";
    if (fn === client.session.remove) return "native.remove";
    if (fn === client.session.update)
      return Object.hasOwn(args[0], "title")
        ? "native.rename"
        : (currentScope().policyStep ?? "native.policy");
    if (fn === client.session.switchAgent) return "native.agent";
    if (fn === client.session.switchModel) return "native.model";
    if (fn === client.session.prompt) return "native.send";
    if (fn === client.session.command) return "native.command";
    if (fn === client.session.inbox?.cancel) return "native.inbox.cancel";
    if (fn === client.session.interrupt) return "native.interrupt";
    if (fn === client.permission.reply) return "native.permission";
    fail("UNAVAILABLE");
  }
  // Native create/fork authority. The bootstrap task is the durable original
  // operation the effect is bound to; nothing here ever re-issues an effect.
  function checkBootstrapTaskAuthority() {
    const tasks = context?.nativeTasks;
    if (!tasks) return;
    if (
      !registry ||
      ["prepare", "arm", "revoke", "verify"].some(
        (name) => typeof tasks[name] !== "function",
      )
    )
      fail("POLICY_UNVERIFIED");
  }
  // A refusal raised before any dispatch flush: a clean `effect: none` outcome.
  function bootstrapRefusal() {
    try {
      fail("POLICY_UNVERIFIED");
    } catch (error) {
      error.bootstrapRefused = true;
      throw error;
    }
  }
  const bootstrapHandoff = (bt, state) => ({
    handoffId: bt.handoffId,
    step: bt.step,
    stageArgumentDigest: bt.stageArgumentDigest,
    state,
    proofDigest: bootstrapHandoffProof({
      handoffId: bt.handoffId,
      step: bt.step,
      stageArgumentDigest: bt.stageArgumentDigest,
      state,
    }),
  });
  async function recordBootstrap(bt, kind, fields) {
    const result = await registry.recordTask({
      kind,
      runtimeEpoch: bt.identity.origin.runtimeEpoch,
      operationId: bt.identity.origin.operationId,
      taskScopeId: bt.identity.taskScopeId,
      ...fields,
    });
    if (result.status !== "recorded") fail("UNKNOWN_OUTCOME");
  }
  // Step 1: the child's prepared identity, before any dispatch or Native effect.
  async function prepareBootstrap(owner, step, args) {
    const { record, reservation } = owner;
    const create = step === "native.create";
    const parent = create ? undefined : owner.bootstrapParent;
    if (!reservation || !owner.nativeMetadata || (!create && !parent))
      bootstrapRefusal();
    let request, stageArgumentDigest;
    try {
      stageArgumentDigest = bootstrapStageDigest(step, args);
      const reservationDigest = registry.reservationDigest(
        operationKey(record),
      );
      if (
        !reservationDigest ||
        (create && args.id !== reservation.plannedNativeSessionId)
      )
        throw new Error("bootstrap_unverified");
      request = {
        originKind: "bootstrap",
        origin: {
          runtimeEpoch: record.runtimeEpoch,
          operationId: record.operationId,
          type: record.type,
          digest: record.digest,
        },
        workspaceId: reservation.workspace.workspaceId,
        workspacePath: create ? args.location.directory : parent.workspacePath,
        appSessionId: reservation.appSessionId,
        metadataDigest: bootstrapMetadataDigest(owner.nativeMetadata),
        reservation: {
          kind: "bootstrap",
          step,
          reservationDigest,
          parentIdentityDigest: create
            ? null
            : bootstrapParentDigest(parent.identity),
        },
        ...(create
          ? { plannedNativeSessionId: args.id }
          : { parentNativeSessionId: args.sessionID }),
      };
    } catch {
      bootstrapRefusal();
    }
    const handoffId = randomUUID();
    let prepared;
    try {
      prepared = await context.nativeTasks.prepare(request, {
        handoffId,
        stageArgumentDigest,
      });
    } catch {
      bootstrapRefusal();
    }
    if (prepared?.status !== "prepared") bootstrapRefusal();
    owner.bootstrapTask = {
      step,
      request,
      handoffId,
      stageArgumentDigest,
      launchId: prepared.launchId,
      binding: request.reservation,
      identity: {
        taskScopeId: prepared.taskScopeId,
        origin: request.origin,
        workspaceId: request.workspaceId,
        projectId: prepared.projectId,
        locationId: prepared.locationId,
        modeGeneration: prepared.modeGeneration,
        inventoryGeneration: prepared.inventoryGeneration,
        originKind: "bootstrap",
      },
      journaled: { prepared: false, armed: false },
      completed: false,
    };
  }
  // Steps 3-4 (after dispatch flushed): durable original intent, then arm.
  async function armBootstrap(owner) {
    const bt = owner.bootstrapTask;
    try {
      await recordBootstrap(bt, "task.prepare", {
        identity: bt.identity,
        binding: bt.binding,
      });
      bt.journaled.prepared = true;
      await recordBootstrap(bt, "task.observe", {
        phase: "bound",
        launchId: bt.launchId,
      });
      await recordBootstrap(bt, "task.handoff", {
        ...bootstrapHandoff(bt, "armed"),
        armedAt: Date.now(),
      });
      bt.journaled.armed = true;
      // Durable before Native may be told to create: after a hard kill the
      // trail up to "armed" is a confirmed prefix the startup reconciler can
      // resolve, instead of an unconfirmed tail that nothing may interpret.
      if (typeof registry.checkpoint === "function")
        await registry.checkpoint();
      await context.nativeTasks.arm({
        handoffId: bt.handoffId,
        taskScopeId: bt.identity.taskScopeId,
        originalKey: {
          runtimeEpoch: bt.identity.origin.runtimeEpoch,
          operationId: bt.identity.origin.operationId,
        },
        originalDigest: bt.identity.origin.digest,
        step: bt.step,
        stageArgumentDigest: bt.stageArgumentDigest,
        targetIdentity: bt.identity,
        currentLaunchIdentity: bt.launchId,
      });
    } catch (error) {
      await abortBootstrap(bt);
      throw error;
    }
  }
  // Step 7: failure before the Native call. Best effort only: any gap leaves the
  // task unsettled (held), never a silent replay or a guessed outcome.
  async function abortBootstrap(bt) {
    try {
      await context.nativeTasks.revoke(bt.handoffId);
      if (!bt.journaled.prepared) return;
      if (bt.journaled.armed)
        await recordBootstrap(
          bt,
          "task.handoff",
          bootstrapHandoff(bt, "revoked"),
        );
      const proofDigest = bootstrapTaskProof({
        outcome: "no_effect",
        taskScopeId: bt.identity.taskScopeId,
      });
      const proof = { proofDigest, outcome: "no_effect" };
      await recordBootstrap(bt, "task_proof", proof);
      await recordBootstrap(bt, "task.settle", proof);
    } catch {
      /* unknown stays unknown */
    }
  }
  // Step 6a: Native returned. The result must be exactly the planned session.
  async function completeBootstrap(bt, owner, info) {
    const create = bt.step === "native.create";
    if (
      !info ||
      typeof info.id !== "string" ||
      (create && info.id !== bt.request.plannedNativeSessionId)
    )
      fail("UNKNOWN_OUTCOME");
    await recordBootstrap(bt, "task.handoff", bootstrapHandoff(bt, "consumed"));
    await recordBootstrap(
      bt,
      "task.handoff",
      bootstrapHandoff(bt, "completed"),
    );
    let metadataDigest;
    try {
      metadataDigest = bootstrapMetadataDigest(info.metadata);
    } catch {
      // Only a fork may lack metadata of its own (it inherits its parent's).
      if (create) fail("UNKNOWN_OUTCOME");
      metadataDigest = bootstrapMetadataDigest(owner.nativeMetadata);
    }
    await recordBootstrap(bt, "task.bootstrap-binding", {
      appSessionId: bt.request.appSessionId,
      nativeSessionId: info.id,
      metadataDigest,
    });
    bt.completed = true;
    bt.nativeSessionId = info.id;
  }
  // Step 6b: only after the policy readback.
  async function settleBootstrap() {
    const bt = currentScope()?.bootstrapTask;
    if (!bt) return;
    if (!bt.completed) fail("UNKNOWN_OUTCOME");
    const proofDigest = bootstrapTaskProof({
      outcome: "settled",
      taskScopeId: bt.identity.taskScopeId,
      appSessionId: bt.request.appSessionId,
      nativeSessionId: bt.nativeSessionId,
    });
    const proof = { proofDigest, outcome: "settled" };
    await recordBootstrap(bt, "task_proof", proof);
    await recordBootstrap(bt, "task.settle", proof);
  }
  async function bootstrapParentIdentity(w, s) {
    const info = await call(client.session.get, { sessionID: s.sdkId });
    const directory = info?.location?.directory;
    if (
      info?.id !== s.sdkId ||
      typeof info.projectID !== "string" ||
      typeof directory !== "string"
    )
      fail("POLICY_UNVERIFIED");
    // A fork inherits its parent's rules and its permission setter is held, so
    // only an "ask" parent carrying exactly the baseline can ever settle.
    if (modeOf(s) !== "ask" || !bootstrapBaselinePermissions(info.permissions))
      fail("POLICY_UNVERIFIED");
    return {
      identity: { id: info.id, projectID: info.projectID, directory },
      workspacePath: w.path,
    };
  }
  // Native's session.import is closed by the overlay, but a session that is
  // already recorded under the planned id must still never be adopted as this
  // create's result: refuse before any dispatch unless it is provably absent.
  async function refuseRecordedSession(sessionID) {
    if (!context?.nativeTasks) return;
    try {
      await call(client.session.get, { sessionID });
    } catch (error) {
      if (error?._tag === "SessionNotFoundError") return;
      throw error;
    }
    fail("POLICY_UNVERIFIED");
  }
  async function call(fn, ...args) {
    checkLive();
    if (!client || runtime.snapshot().state !== "connected")
      fail("UNAVAILABLE");
    // Prompt preparation cannot authorize pre-session creation or fork. Keep
    // these effects held until an actual bootstrap task and method handoff are
    // durably bound; neither a held reply nor a caller token can stand in for it.
    if (
      typeof fn === "function" &&
      (fn === client.session?.create || fn === client.session?.fork)
    )
      checkBootstrapTaskAuthority();
    const primary =
      [
        context?.nativeAgents?.register,
        context?.nativeAgents?.remove,
        context?.nativeSkills?.registerDisabled,
        context?.nativeSkills?.removeOwned,
        client.session?.skill,
        client.mcp?.add,
        client.mcp?.connect,
        client.mcp?.disconnect,
        client.mcp?.remove,
        client.session?.create,
        client.session?.fork,
        client.session?.remove,
        client.session?.prompt,
        client.session?.command,
        client.session?.interrupt,
        client.session?.inbox?.cancel,
        client.permission?.reply,
        client.session.instructions?.entry?.put,
        client.session.instructions?.entry?.remove,
      ].includes(fn) ||
      (fn === client.session?.update && Object.hasOwn(args[0] ?? {}, "title"));
    const owner = currentScope();
    owner.beforeEffect = async (effectFn, effectArgs) => {
      if (!registry) return;
      storageCheck();
      if (!owner.record) fail("UNAVAILABLE");
      const step = methodStep(effectFn, effectArgs);
      const nativeServerName = step.startsWith("native.mcp.")
        ? effectArgs[0]?.server
        : undefined;
      if (
        step.startsWith("native.mcp.") &&
        nativeServerName !== owner.record.nativeServerName
      )
        fail("MCP_UNVERIFIED");
      // Step 1 (before dispatch): a held/failed preparation is a clean refusal.
      const bootstrapTask =
        context?.nativeTasks && ["native.create", "native.fork"].includes(step);
      if (bootstrapTask) await prepareBootstrap(owner, step, effectArgs[0]);
      const result = await registry
        .dispatch({
          ...operationKey(owner.record),
          step,
          ...(step.startsWith("native.skill.") && {
            skillRuntime: owner.skillRuntimeProof,
          }),
          ...(step.startsWith("native.agent.") && {
            agentRuntime: owner.agentRuntimeProof,
          }),
          ...(nativeServerName && { nativeServerName }),
          ...(step === "native.inbox.cancel" && {
            inboxTarget: { inboxId: effectArgs[0]?.inboxID },
          }),
          ...(step === "native.fork" &&
            owner.record.forkTarget && {
              forkTarget: { ...owner.record.forkTarget },
            }),
          ...(owner.record.type !== "session.inbox.cancel" &&
            effectArgs[0]?.sessionID && {
              nativeSessionId: effectArgs[0].sessionID,
            }),
        })
        .catch(async (error) => {
          // Nothing was flushed for this key: drop the child's prepared entry.
          if (bootstrapTask)
            await context.nativeTasks
              .revoke(owner.bootstrapTask.handoffId)
              .catch(() => {});
          throw error;
        });
      if (result.status !== "dispatched") fail("UNKNOWN_OUTCOME");
      // Flushed intent is itself conservative uncertainty even if the host
      // expires before invoking the native function.
      owner.effectStarted = true;
      if (bootstrapTask) await armBootstrap(owner);
    };
    const effect =
      effectMethods.has(fn) ||
      [
        context?.nativeAgents?.register,
        context?.nativeAgents?.remove,
        context?.nativeSkills?.registerDisabled,
        context?.nativeSkills?.removeOwned,
        client.session?.skill,
        client.mcp?.add,
        client.mcp?.connect,
        client.mcp?.disconnect,
        client.mcp?.remove,
        client.session?.create,
        client.session?.fork,
        client.session?.update,
        client.session?.remove,
        client.session?.switchAgent,
        client.session?.switchModel,
        client.session?.prompt,
        client.session?.command,
        client.session?.interrupt,
        client.session?.inbox?.cancel,
        client.permission?.reply,
        client.session.instructions?.entry?.put,
        client.session.instructions?.entry?.remove,
      ].includes(fn);
    const result = await host.sdk(fn, args, effect, primary);
    if (
      owner.bootstrapTask &&
      (fn === client.session?.create || fn === client.session?.fork)
    )
      await completeBootstrap(owner.bootstrapTask, owner, result);
    return result;
  }
  function projectReceiptFields(record, request, response, effected) {
    record.revision = revision;
    const value = response.value;
    if (!registry && !response.ok && record.verifiedNone) {
      record.admission = "rejected";
      record.delivery = "pending";
      record.effect = "none";
      record.result = { kind: "rejected", code: response.code };
      return;
    }
    if (!response.ok || value?.status === "unknown") {
      record.delivery = effected ? "unknown" : "pending";
      record.effect = effected ? "unknown" : "none";
      if (!effected) {
        record.admission = "rejected";
        record.result = { kind: "rejected", code: response.code };
      }
      return;
    }
    const w = value?.selectedWorkspaceId ?? request.workspaceId;
    const sid = value?.selectedSessionId ?? request.sessionId;
    if (
      ["workspace.import", "workspace.create", "session.create"].includes(
        request.type,
      )
    ) {
      record.result = {
        kind: "created",
        workspaceId: w,
        ...(sid && {
          sessionId: sid,
          nativeSessionId: tables().sessions.get(sid)?.sdkId,
        }),
      };
    } else if (request.type === "configuration.instructions.apply") {
      record.result = {
        kind: "instruction_registered",
        workspaceId: request.workspaceId,
        sessionId: request.sessionId,
        digest: value.digest,
        sourceVersion: value.sourceVersion,
      };
    } else if (request.type === "configuration.instructions.remove") {
      record.result = {
        kind: "instruction_removed",
        workspaceId: request.workspaceId,
        sessionId: request.sessionId,
      };
    } else if (mcpStep(request.type)) {
      const common = {
        workspaceId: request.workspaceId,
        sourceName: request.sourceName,
        nativeName: value.nativeName,
      };
      record.result =
        request.type === "configuration.mcp.register"
          ? {
              kind: "mcp_registered",
              ...common,
              digest: value.digest,
              sourceVersion: value.sourceVersion,
              status: "disabled",
            }
          : request.type === "configuration.mcp.remove"
            ? { kind: "mcp_removed", ...common }
            : {
                kind: "mcp_connection",
                ...common,
                action: value.action,
                connectionStatus: value.connectionStatus,
              };
    } else if (agentRuntimeStep(request.type)) {
      const { requestId: _requestId, status: _status, ...proof } = value;
      record.result = {
        kind:
          request.type === "configuration.agent.register"
            ? "agent_registered"
            : "agent_removed",
        workspaceId: request.workspaceId,
        ...proof,
      };
    } else if (skillRuntimeStep(request.type)) {
      const { requestId: _requestId, status: _status, ...proof } = value;
      void _requestId;
      void _status;
      record.result = {
        kind:
          request.type === "configuration.skill.register"
            ? "skill_registered"
            : request.type === "configuration.skill.remove"
              ? "skill_removed"
              : "skill_applied",
        workspaceId: request.workspaceId,
        ...proof,
      };
    } else if (
      ["configuration.skill.save", "configuration.agent.save"].includes(
        request.type,
      )
    ) {
      record.result = {
        kind:
          request.type === "configuration.agent.save"
            ? "agent_file_saved"
            : "skill_file_saved",
        workspaceId: request.workspaceId,
        sourceName: request.sourceName,
        version: value.version,
        ...(value.backupId && { backupId: value.backupId }),
      };
    } else if (
      ["git.branch.apply", "git.restore.apply"].includes(request.type)
    ) {
      record.result = {
        kind: "git_branch_restore_applied",
        workspaceId: request.workspaceId,
        action: request.action,
        previewDigest: request.previewDigest,
        paths: value.paths,
        metadata: value.metadata,
        backups: value.backups,
        digest: record.digest,
      };
    } else if (request.type === "git.commit.apply") {
      record.result = {
        kind: "git_commit_created",
        workspaceId: request.workspaceId,
        commitOid: value.commitOid,
        treeOid: value.treeOid,
        parentOid: request.headOid,
        referenceDigest: value.referenceDigest,
        logDigests: value.logDigests,
        previewDigest: request.previewDigest,
        backups: value.backups,
        digest: record.digest,
      };
    } else if (request.type === "git.index.apply") {
      record.result = {
        kind: "git_index_updated",
        workspaceId: request.workspaceId,
        action: request.action,
        paths: [...request.paths],
        indexDigest: value.indexDigest,
        previewDigest: request.previewDigest,
        backupId: value.backupId,
        digest: record.digest,
      };
    } else if (request.type === "file.save") {
      record.result = {
        kind: "file_saved",
        workspaceId: request.workspaceId,
        path: request.path,
        version: value.version,
        digest: record.digest,
        backupId: value.backupId,
      };
    } else if (request.type === "configuration.save") {
      record.result = {
        kind: "configuration_saved",
        workspaceId: request.workspaceId,
        configurationKind: request.kind,
        version: value.version,
        ...(value.backupId && { backupId: value.backupId }),
      };
    } else if (request.type === "session.inbox.cancel") {
      record.result = {
        kind: "inbox_cancel_requested",
        workspaceId: request.workspaceId,
        sessionId: request.sessionId,
        inboxId: request.inboxId,
        digest: record.digest,
      };
    } else if (request.type === "session.fork") {
      record.result = {
        kind: "forked",
        workspaceId: w,
        sessionId: sid,
        nativeSessionId: tables().sessions.get(sid)?.sdkId,
      };
    } else if (["workspace.remove", "session.remove"].includes(request.type)) {
      record.result = {
        kind: "removed",
        workspaceId: request.workspaceId,
        workspaceRemoved: request.type === "workspace.remove",
        removedSessionIds:
          record.removedSessionIds ?? [request.sessionId].filter(Boolean),
      };
    } else if (
      [
        "session.rename",
        "session.pin",
        "session.archive",
        "permission.mode.set",
      ].includes(request.type)
    ) {
      record.result = {
        kind: "metadata",
        workspaceId: request.workspaceId,
        sessionId: request.sessionId,
      };
    } else {
      const receipt = tables()
        .sessions.get(request.sessionId)
        ?.receipts.get(record.operationId);
      record.result = {
        kind: "delivery",
        status: value.status,
        ...(receipt?.inboxId && { nativeInboxId: receipt.inboxId }),
        ...(request.type === "permission.respond" && {
          nativeRequestId: request.requestId,
        }),
      };
      record.delivery = "accepted";
      // A correlated Native User ACK proves this request was admitted to its
      // inbox. It does not prove provider/tool execution or final delivery.
      // Other void/uncorrelated effect ACKs keep the existing pending hold.
      // A successful permission reply, command call or interrupt is itself
      // the plain Native effect (errors map to unknown above).
      record.effect =
        (request.type === "message.send" && receipt?.inboxId) ||
        (request.type === "permission.respond" && value.status === "decided") ||
        (request.type === "command.run" && value.status === "accepted") ||
        (request.type === "session.interrupt" && value.status === "stopping")
          ? "confirmed"
          : "pending";
      record.evidence = [
        {
          kind: "native-ack",
          ...(receipt?.inboxId
            ? { id: receipt.inboxId }
            : request.type === "permission.respond"
              ? { id: request.requestId }
              : {}),
        },
      ];
      return;
    }
    record.admission =
      request.type === "configuration.mcp.remove" && !effected
        ? "admitted"
        : "dispatched";
    record.delivery = "accepted";
    record.effect =
      request.type === "configuration.mcp.remove" && !effected
        ? "none"
        : "confirmed";
    record.evidence = [
      {
        kind: "host-registry",
        id: record.result.sessionId ?? record.result.workspaceId,
      },
    ];
  }
  function workspaceRecord(w, state = "registered") {
    return {
      workspaceId: w.id,
      ownership: w.ownership ?? (w.temporary ? "legacy" : "imported"),
      canonicalPath: w.path,
      registrationState: state,
      ...(w.folderSessionId && { folderSessionId: w.folderSessionId }),
      name: w.name,
      trustRevision: w.trustRevision,
    };
  }
  function sessionRecord(s, partial = false) {
    return {
      appSessionId: s.id,
      workspaceId: s.workspaceId,
      nativeSessionId: s.sdkId,
      lifecycleState: partial ? "unavailable" : "active",
      pinned: !!s.pinned,
      archived: !!s.archived,
      title: s.title,
      ...(s.parentSessionId && { parentSessionId: s.parentSessionId }),
      ...(s.instructionRegistration && {
        instructionRegistration: s.instructionRegistration,
      }),
      ...(s.permissionControl && { permissionControl: s.permissionControl }),
      ...(s.permissionMode && { permissionMode: s.permissionMode }),
      ...(partial && { recoveryReason: "partial_native_mapping" }),
    };
  }
  async function projectReceipt(record, request, response, effected) {
    projectReceiptFields(record, request, response, effected);
    const owner = currentScope();
    const candidate = owner?.candidate;
    if (!candidate) return;
    if (registry) {
      storageCheck();
      const delta = { workspaces: [], sessions: [], tombstones: [] };
      const partial = !response.ok || response.value?.status === "unknown";
      if (!partial) {
        for (const [id, w] of candidate.workspaces) {
          const old = committed.workspaces.get(id);
          if (
            !old ||
            !isDeepStrictEqual(workspaceRecord(old), workspaceRecord(w))
          )
            delta.workspaces.push(workspaceRecord(w));
        }
        for (const [id, s] of candidate.sessions) {
          const old = committed.sessions.get(id);
          if (!old || !isDeepStrictEqual(sessionRecord(old), sessionRecord(s)))
            delta.sessions.push(sessionRecord(s));
        }
        for (const id of committed.sessions.keys())
          if (!candidate.sessions.has(id))
            delta.tombstones.push({ kind: "session", id });
        for (const id of committed.workspaces.keys())
          if (!candidate.workspaces.has(id))
            delta.tombstones.push({ kind: "workspace", id });
      } else {
        // Only exact identity/location/correlation checks in addSession can
        // authorize an unavailable partial mapping after later policy failure.
        for (const [id, s] of candidate.sessions)
          if (
            !committed.sessions.has(id) &&
            owner.verifiedNativeIds?.has(s.sdkId)
          ) {
            delta.sessions.push(sessionRecord(s, true));
            s.status = "unavailable";
            s.unknown = true;
            s.unavailable = true;
            const w = candidate.workspaces.get(s.workspaceId);
            if (!committed.workspaces.has(w.id))
              delta.workspaces.push(workspaceRecord(w, "unavailable"));
          }
      }
      const completed = await registry.complete({
        ...operationKey(record),
        receipt: redactReceipt(record),
        delta,
        verifiedNativeSessionIds: [...(owner.verifiedNativeIds ?? [])],
      });
      Object.assign(record, completed.receipt);
      if (partial) hydrateRegistry(true);
      else {
        committed = candidate;
        if (owner.mcpChange) {
          const { nativeName, registration } = owner.mcpChange;
          if (registration) liveMcp.set(nativeName, registration);
          else liveMcp.delete(nativeName);
        }
        for (const [name, registration] of liveMcp)
          if (!committed.workspaces.has(registration.workspaceId))
            liveMcp.delete(name);
      }
    } else {
      committed = candidate;
      revision++;
      record.revision = revision;
    }
    for (const id of candidate.sessions.keys()) nativeProjections.delete(id);
    owner.candidate = undefined;
    if (response.ok && response.value?.runtimeEpoch) {
      const wid = response.value.selectedWorkspaceId;
      const sid = response.value.selectedSessionId;
      response.value = base(
        committed.workspaces.get(wid),
        committed.sessions.get(sid),
      );
    }
  }
  function hydrateRegistry(preserveLive = false) {
    if (!registry) return;
    if (!preserveLive) {
      liveMcp.clear();
      skillObservations.clear();
      agentObservations.clear();
    }
    const view = registry.readView();
    committed = {
      workspaces: new Map(
        view.workspaces.map((w) => [
          w.workspaceId,
          {
            id: w.workspaceId,
            path: w.canonicalPath,
            name: w.name ?? basename(w.canonicalPath),
            ownership: w.ownership,
            folderSessionId: w.folderSessionId,
            kind: "folder",
            // Trust persists in the record: the app-managed workspace, or a
            // dialog grant (trustRevision 1 at creation, bumped on grant).
            trusted: preserveLive
              ? (committed.workspaces.get(w.workspaceId)?.trusted ?? false)
              : w.ownership === "managed" || (w.trustRevision ?? 0) > 1,
            trustRevision: w.trustRevision ?? 0,
            temporary: false,
            lock: false,
          },
        ]),
      ),
      sessions: new Map(
        view.sessions.map((s) => [
          s.appSessionId,
          {
            id: s.appSessionId,
            workspaceId: s.workspaceId,
            sdkId: s.nativeSessionId,
            title: s.title ?? "Untitled session",
            status: s.status,
            pinned: s.pinned,
            archived: s.archived,
            parentSessionId: s.parentSessionId,
            instructionRegistration: s.instructionRegistration,
            permissionControl: s.permissionControl,
            permissionMode: s.permissionMode,
            unavailable: s.status === "unavailable",
            unknown: s.status === "unavailable",
            lock: false,
            receipts: new Map(
              preserveLive
                ? committed.sessions.get(s.appSessionId)?.receipts
                : undefined,
            ),
            invalidPermissions: new Set(
              preserveLive
                ? committed.sessions.get(s.appSessionId)?.invalidPermissions
                : undefined,
            ),
            messages: [],
            permissions: [],
            generation: 0,
          },
        ]),
      ),
    };
    defaultWorkspace = committed.workspaces.keys().next().value;
    defaultSession = committed.sessions.keys().next().value;
  }
  function workspace(id) {
    checkLive();
    const value = tables().workspaces.get(id);
    if (!value) fail("NOT_FOUND");
    return value;
  }
  function session(wid, sid) {
    const value = tables().sessions.get(sid);
    if (!value || value.workspaceId !== wid || !tables().workspaces.has(wid))
      fail("NOT_FOUND");
    return value;
  }
  async function recheck(w) {
    const generation = resourceGenerations.get(w.id) ?? 0;
    const matches = () => {
      const current = tables().workspaces.get(w.id);
      return (
        current &&
        current.path === w.path &&
        current.trustRevision === w.trustRevision &&
        current.trusted === w.trusted &&
        (resourceGenerations.get(w.id) ?? 0) === generation
      );
    };
    if (
      !matches() ||
      (await canonicalDirectory(w.path)) !== w.path ||
      !matches()
    )
      fail("FILE_DENIED");
    checkLive();
  }
  function fileAuthority(w, mutation = false) {
    if (!registry) fail("UNAVAILABLE");
    const original = {
      epoch: host.epoch,
      path: w.path,
      trusted: w.trusted,
      trustRevision: w.trustRevision,
      generation: resourceGenerations.get(w.id) ?? 0,
    };
    let expectedRevision = registry.status().revision;
    const key = mutation ? operationKey(currentScope().record) : undefined;
    const verify = (ownDispatch = false) => {
      checkLive();
      storageCheck();
      const current = tables().workspaces.get(w.id);
      if (
        current !== w ||
        host.epoch !== original.epoch ||
        current.path !== original.path ||
        current.trusted !== original.trusted ||
        current.trustRevision !== original.trustRevision ||
        (resourceGenerations.get(w.id) ?? 0) !== original.generation
      )
        fail("UNAVAILABLE");
      if (!current.trusted) fail("INVALID_SELECTION");
      if (!mutation && current.lock) fail("BUSY");
      if (ownDispatch) {
        const own = registry.lookup(key),
          now = registry.status().revision;
        if (
          own.status !== "found" ||
          own.receipt.type !== currentScope().record.type ||
          own.receipt.workspaceId !== w.id ||
          own.receipt.admission !== "dispatched" ||
          own.receipt.revision !== now
        )
          fail("UNKNOWN_OUTCOME");
        expectedRevision = now;
      }
      if (registry.status().revision !== expectedRevision) fail("UNAVAILABLE");
      const view = registry.readView();
      const otherHold = view.retainedOperations.some(
        (r) =>
          r.authorityHold !== false &&
          r.workspaceId === w.id &&
          !(
            key &&
            r.runtimeEpoch === key.runtimeEpoch &&
            r.operationId === key.operationId
          ),
      );
      if (
        otherHold ||
        view.recovery.resources.some(
          (r) =>
            r.workspaceId === w.id &&
            !(mutation && r.reason === "unresolved_operation"),
        )
      )
        fail("UNAVAILABLE");
    };
    verify();
    return {
      verify,
      afterDispatch: () => verify(true),
      epoch: original.epoch,
      revision: () => expectedRevision,
    };
  }
  async function observeGit(request, w) {
    if (!registry) fail("UNAVAILABLE");
    const original = {
      epoch: host.epoch,
      revision: registry.status().revision,
      path: w.path,
      trustRevision: w.trustRevision,
      trusted: w.trusted,
      generation: resourceGenerations.get(w.id) ?? 0,
      sender: currentScope()?.sender,
    };
    if (typeof original.sender !== "string") fail("INVALID_REQUEST");
    const verify = () => {
      checkLive();
      storageCheck();
      const current = tables().workspaces.get(w.id);
      if (
        current !== w ||
        host.epoch !== original.epoch ||
        current.path !== original.path ||
        current.trustRevision !== original.trustRevision ||
        current.trusted !== original.trusted ||
        (resourceGenerations.get(w.id) ?? 0) !== original.generation ||
        registry.status().revision !== original.revision
      )
        fail("UNAVAILABLE");
      if (host.mutationActive() || current.lock) fail("BUSY");
      const view = registry.readView();
      if (
        view.retainedOperations.some(
          (operation) =>
            operation.authorityHold !== false && operation.workspaceId === w.id,
        ) ||
        view.recovery.resources.some(
          (resource) => resource.workspaceId === w.id,
        )
      )
        fail("UNAVAILABLE");
    };
    verify();
    await recheck(w);
    verify();
    // Load the app-owned reader only after durable workspace authority is known.
    if (!gitReader) {
      gitReaderReady ??= import("./host/workbench-git.mjs").then(
        ({ createWorkbenchGitAccess }) => {
          const access = createWorkbenchGitAccess();
          gitReader = access.reader;
          gitIndexManager ??= access.indexManager;
          gitCommitManager ??= access.commitManager;
          gitBranchRestoreManager ??= access.branchRestoreManager;
          if (controller.signal.aborted) closeGitReader();
          return gitReader;
        },
      );
      await gitReaderReady;
    }
    verify();
    const options = {
      runtimeEpoch: original.epoch,
      sender: original.sender,
      trusted: original.trusted,
      trustRevision: original.trustRevision,
      signal: currentScope().signal,
      check: verify,
      revision: original.revision,
    };
    const workspace = { id: w.id, path: original.path };
    if (request.type === "git.commit.preview.read" && !gitCommitManager)
      fail("UNAVAILABLE");
    if (request.type === "git.index.preview.read" && !gitIndexManager)
      fail("UNAVAILABLE");
    const branchRestoreRead = [
      "git.branch.preview.read",
      "git.restore.preview.read",
    ].includes(request.type);
    if (branchRestoreRead && !gitBranchRestoreManager) fail("UNAVAILABLE");
    const observed = branchRestoreRead
      ? await gitBranchRestoreManager.preview(workspace, request, options)
      : request.type === "git.commit.preview.read"
        ? await gitCommitManager.preview(workspace, request, options)
        : request.type === "git.index.preview.read"
          ? await gitIndexManager.preview(workspace, request, options)
          : request.type === "git.review.read"
            ? await gitReader.review(workspace, options)
            : await gitReader.diff(workspace, request, options);
    await recheck(w);
    verify();
    try {
      const value = {
        ...observed,
        runtimeEpoch: original.epoch,
        revision: original.revision,
      };
      (branchRestoreRead
        ? validateGitBranchRestorePreview
        : request.type === "git.commit.preview.read"
          ? validateGitCommitPreview
          : request.type === "git.index.preview.read"
            ? validateGitIndexPreview
            : request.type === "git.review.read"
              ? validateGitReviewObservation
              : validateGitDiffObservation)(value);
      if (
        (branchRestoreRead &&
          value.status === "available" &&
          (request.type === "git.branch.preview.read"
            ? value.action !== request.action ||
              value.branch !== request.branch ||
              !isDeepStrictEqual(value.author, request.author)
            : value.action !== "restore" ||
              value.source !== request.source ||
              value.paths.some((x) => !request.paths.includes(x.path)))) ||
        value.workspaceId !== w.id ||
        value.workspacePath !== original.path ||
        (request.type === "git.index.preview.read" &&
          value.status === "available" &&
          (value.action !== request.action ||
            !isDeepStrictEqual(value.paths, request.paths))) ||
        (request.type === "git.diff.read" &&
          (value.observationId !== request.observationId ||
            value.path !== request.path ||
            value.mode !== request.mode ||
            value.baseRef !== request.baseRef)) ||
        Buffer.byteLength(JSON.stringify({ ok: true, value }), "utf8") >
          GIT_REVIEW_LIMITS.envelopeBytes
      )
        fail("INVALID_REQUEST");
      return value;
    } catch {
      fail("UNAVAILABLE");
    }
  }
  async function applyGitIndex(request, w) {
    const adapter = context?.gitIndex;
    if (
      !registry ||
      !gitIndexManager ||
      !adapter ||
      !["prepare", "publish", "abort"].every(
        (name) => typeof adapter[name] === "function",
      )
    )
      fail("UNAVAILABLE");
    const published = committed.workspaces.get(w.id);
    if (w.lock || published?.lock) fail("BUSY");
    const authority = fileAuthority(w, true),
      owner = currentScope(),
      record = owner.record;
    const workspace = { id: w.id, path: w.path };
    const scope = {
      runtimeEpoch: host.epoch,
      sender: owner.sender,
      trusted: w.trusted,
      trustRevision: w.trustRevision,
      revision: record.expectedRevision,
      operationDigest: record.digest,
      signal: owner.signal,
      check: authority.verify,
    };
    const target = Object.freeze(gitIndexTargetFromApply(request));
    if (!isDeepStrictEqual(target, record.gitIndexTarget))
      fail("INVALID_REQUEST");
    let token;
    w.lock = true;
    if (published) published.lock = true;
    async function idle() {
      authority.verify();
      await workspaceIdleIdentity(w, "FILE_DENIED");
      authority.verify();
      await recheck(w);
      authority.verify();
    }
    try {
      await idle();
      const preview = gitIndexManager.previewForApply(
        workspace,
        request,
        scope,
      );
      if (
        !(await confirmGitIndex(
          Object.freeze({
            workspaceId: w.id,
            workspacePath: w.path,
            action: request.action,
            paths: Object.freeze([...request.paths]),
            entries: preview.entries,
            indexExists: request.indexExists,
            backupId: request.indexExists
              ? gitIndexBackupId(record.runtimeEpoch, record.operationId)
              : null,
          }),
        ))
      )
        fail("CANCELLED");
      await idle();
      gitIndexManager.previewForApply(workspace, request, scope);
      const value = await gitIndexManager.apply(
        workspace,
        request,
        scope,
        async (operation) => {
          await idle();
          await markEffect(GIT_INDEX_STEPS.stage, { gitIndexTarget: target });
          authority.afterDispatch();
          const prepared = await adapter.prepare(operation);
          if (
            prepared?.status === "prepared" &&
            typeof prepared.token === "string" &&
            /^[a-f0-9]{64}$/u.test(prepared.token)
          )
            token = prepared.token;
          authority.verify();
          if (!token) return { status: "unknown", reason: "io_failed" };
          // Kernel owns the original index lock; Native status checks cannot publish it.
          await idle();
          await markEffect(GIT_INDEX_STEPS.publish, { gitIndexTarget: target });
          authority.afterDispatch();
          const result = await adapter.publish({ token });
          token = undefined;
          authority.verify();
          return result;
        },
      );
      authority.verify();
      return validateGitIndexMutationResult(value);
    } finally {
      if (token) {
        try {
          await adapter.abort({ token });
        } catch {
          /* Original key retains uncertainty. */
        }
      }
      w.lock = false;
      if (published) published.lock = false;
    }
  }
  async function applyGitCommit(request, w) {
    const adapter = context?.gitCommit;
    if (
      !registry ||
      !gitCommitManager ||
      !adapter ||
      !["prepare", "publish", "abort"].every(
        (name) => typeof adapter[name] === "function",
      )
    )
      fail("UNAVAILABLE");
    const published = committed.workspaces.get(w.id);
    if (w.lock || published?.lock) fail("BUSY");
    const authority = fileAuthority(w, true),
      owner = currentScope(),
      record = owner.record;
    const workspace = { id: w.id, path: w.path };
    const scope = {
      runtimeEpoch: host.epoch,
      sender: owner.sender,
      trusted: w.trusted,
      trustRevision: w.trustRevision,
      revision: record.expectedRevision,
      operationDigest: record.digest,
      signal: owner.signal,
      check: authority.verify,
    };
    const target = Object.freeze(gitCommitTargetFromApply(request));
    if (!isDeepStrictEqual(target, record.gitCommitTarget))
      fail("INVALID_REQUEST");
    let token;
    w.lock = true;
    if (published) published.lock = true;
    async function idle() {
      authority.verify();
      await workspaceIdleIdentity(w, "FILE_DENIED");
      authority.verify();
      await recheck(w);
      authority.verify();
    }
    try {
      await idle();
      const preview = gitCommitManager.previewForApply(
        workspace,
        request,
        scope,
      );
      if (
        !(await confirmGitCommit(
          Object.freeze({
            workspaceId: w.id,
            workspacePath: w.path,
            author: preview.author,
            timestamp: preview.timestamp,
            canonicalMessage: preview.canonicalMessage,
            entries: preview.entries,
            headOid: preview.headOid,
            treeOid: preview.treeOid,
            commitOid: preview.commitOid,
            reference: preview.reference,
            logs: preview.logs,
            backups: gitCommitExpectedBackups(
              target,
              record.runtimeEpoch,
              record.operationId,
            ),
          }),
        ))
      )
        fail("CANCELLED");
      await idle();
      gitCommitManager.previewForApply(workspace, request, scope);
      const value = await gitCommitManager.apply(
        workspace,
        request,
        scope,
        async (operation) => {
          await idle();
          await markEffect(GIT_COMMIT_STEPS.stage, { gitCommitTarget: target });
          authority.afterDispatch();
          const prepared = await adapter.prepare(operation);
          if (
            prepared?.status === "prepared" &&
            typeof prepared.token === "string" &&
            /^[a-f0-9]{64}$/u.test(prepared.token)
          )
            token = prepared.token;
          authority.verify();
          if (!token) return { status: "unknown", reason: "io_failed" };
          // Shared metadata kernel owns its locks; only this typed publisher can finish.
          await idle();
          await markEffect(GIT_COMMIT_STEPS.publish, {
            gitCommitTarget: target,
          });
          authority.afterDispatch();
          const result = await adapter.publish({ token });
          token = undefined;
          authority.verify();
          return result;
        },
      );
      authority.verify();
      return validateGitCommitMutationResult(value);
    } finally {
      if (token) {
        try {
          await adapter.abort({ token });
        } catch {
          /* Original key retains uncertainty. */
        }
      }
      w.lock = false;
      if (published) published.lock = false;
    }
  }
  async function applyGitBranchRestore(request, w) {
    const adapter = context?.gitBranchRestore;
    if (
      !registry ||
      !gitBranchRestoreManager ||
      !adapter ||
      !["prepare", "publish", "abort"].every(
        (name) => typeof adapter[name] === "function",
      )
    )
      fail("UNAVAILABLE");
    const published = committed.workspaces.get(w.id);
    if (w.lock || published?.lock) fail("BUSY");
    const authority = fileAuthority(w, true),
      owner = currentScope(),
      record = owner.record;
    const workspace = { id: w.id, path: w.path };
    const scope = {
      runtimeEpoch: host.epoch,
      sender: owner.sender,
      trusted: w.trusted,
      trustRevision: w.trustRevision,
      revision: record.expectedRevision,
      operationDigest: record.digest,
      signal: owner.signal,
      check: authority.verify,
    };
    const target = Object.freeze(gitBranchRestoreTargetFromApply(request));
    if (!isDeepStrictEqual(target, record.gitBranchRestoreTarget))
      fail("INVALID_REQUEST");
    let token;
    w.lock = true;
    if (published) published.lock = true;
    async function idle() {
      authority.verify();
      await workspaceIdleIdentity(w, "FILE_DENIED");
      authority.verify();
      await recheck(w);
      authority.verify();
    }
    try {
      await idle();
      const preview = gitBranchRestoreManager.previewForApply(
        workspace,
        request,
        scope,
      );
      if (
        !(await confirmGitBranchRestore(
          Object.freeze({
            workspaceId: w.id,
            workspacePath: w.path,
            action: preview.action,
            branch: preview.branch,
            source: preview.source,
            currentBranch: preview.currentBranch,
            headOid: preview.headOid,
            nextHeadOid: preview.nextHeadOid,
            treeOid: preview.treeOid,
            author: preview.author,
            timestamp: preview.timestamp,
            paths: preview.paths,
            metadata: preview.metadata,
            backups: gitBranchRestoreExpectedBackups(
              target,
              record.runtimeEpoch,
              record.operationId,
            ),
          }),
        ))
      )
        fail("CANCELLED");
      await idle();
      gitBranchRestoreManager.previewForApply(workspace, request, scope);
      const value = await gitBranchRestoreManager.apply(
        workspace,
        request,
        scope,
        async (operation) => {
          await idle();
          await markEffect(GIT_BRANCH_RESTORE_STEPS.stage, {
            gitBranchRestoreTarget: target,
          });
          authority.afterDispatch();
          const prepared = await adapter.prepare(operation);
          if (
            prepared?.status === "prepared" &&
            typeof prepared.token === "string" &&
            /^[a-f0-9]{64}$/u.test(prepared.token)
          )
            token = prepared.token;
          authority.verify();
          if (!token) return { status: "unknown", reason: "io_failed" };
          // Shared metadata kernel owns its locks; only this typed publisher can finish.
          await idle();
          await markEffect(GIT_BRANCH_RESTORE_STEPS.publish, {
            gitBranchRestoreTarget: target,
          });
          authority.afterDispatch();
          const result = await adapter.publish({ token });
          token = undefined;
          authority.verify();
          return result;
        },
      );
      authority.verify();
      return validateGitBranchRestoreMutationResult(value);
    } finally {
      if (token) {
        try {
          await adapter.abort({ token });
        } catch {
          /* Original key retains uncertainty. */
        }
      }
      w.lock = false;
      if (published) published.lock = false;
    }
  }
  async function observeWorkspaceFile(request, w) {
    const authority = fileAuthority(w);
    await recheck(w);
    authority.verify();
    const observed = await readWorkspaceFile(w, request.path, {
      check: authority.verify,
    });
    await recheck(w);
    authority.verify();
    try {
      return validateWorkspaceFileObservation({
        ...observed,
        runtimeEpoch: authority.epoch,
        revision: authority.revision(),
      });
    } catch {
      fail("FILE_DENIED");
    }
  }
  async function saveWorkspaceFile(request, w) {
    const adapter = context?.configurationSave;
    if (
      !registry ||
      !adapter ||
      !["prepare", "publish", "abort"].every(
        (name) => typeof adapter[name] === "function",
      )
    )
      fail("UNAVAILABLE");
    const publishedWorkspace = committed.workspaces.get(w.id);
    if (w.lock || publishedWorkspace?.lock) fail("BUSY");
    const authority = fileAuthority(w, true),
      key = operationKey(currentScope().record);
    const fileTarget = Object.freeze(fileTargetAdmission(request));
    const backupId = configurationBackupId(
      key.runtimeEpoch,
      key.operationId,
      "file",
    );
    const unknown = () => ({ requestId: request.requestId, status: "unknown" });
    async function observeExpected() {
      authority.verify();
      await recheck(w);
      authority.verify();
      const o = await readWorkspaceFile(w, request.path, {
        check: authority.verify,
      });
      authority.verify();
      await recheck(w);
      authority.verify();
      if (o.status === "unsupported")
        fail(
          o.reason === "too_large"
            ? "FILE_TOO_LARGE"
            : o.reason === "protected_source"
              ? "FILE_DENIED"
              : "FILE_UNSUPPORTED",
        );
      if (o.status !== "available")
        fail(
          ["file_changed", "missing_file", "path_missing"].includes(o.reason)
            ? "FILE_CHANGED"
            : "FILE_DENIED",
        );
      if (
        o.version !== request.version ||
        o.directoryVersion !== request.directoryVersion
      )
        fail("FILE_CHANGED");
      return o;
    }
    async function idle() {
      authority.verify();
      await workspaceIdleIdentity(w, "FILE_DENIED");
      authority.verify();
    }
    let token;
    w.lock = true;
    // Locks are ephemeral, and must also fence baseline reads using the published view.
    if (publishedWorkspace) publishedWorkspace.lock = true;
    try {
      await idle();
      const observed = await observeExpected();
      if (
        !(await confirmConfigurationSave(
          Object.freeze({
            workspaceId: w.id,
            kind: "file",
            targetPath: observed.targetPath,
            previousText: observed.content,
            expectation: "version",
            text: request.text,
            textDigest: createHash("sha256").update(request.text).digest("hex"),
            backupId,
          }),
        ))
      )
        fail("CANCELLED");
      authority.verify();
      await idle();
      await observeExpected();
      await markEffect("filesystem.configuration.stage", { fileTarget });
      authority.afterDispatch();
      const staged = await adapter.prepare({
        ...key,
        workspaceId: w.id,
        workspacePath: w.path,
        kind: "file",
        path: request.path,
        text: request.text,
        expectation: "version",
        version: request.version,
        directoryVersion: request.directoryVersion,
      });
      if (
        staged?.status === "staged" &&
        typeof staged.token === "string" &&
        /^[a-f0-9]{64}$/u.test(staged.token)
      )
        token = staged.token;
      // Retain a valid token before checking authority so finally can settle it.
      authority.verify();
      if (!token) return unknown();
      await idle();
      // The kernel holds and rechecks original descriptors; stage changes directory metadata.
      authority.verify();
      await recheck(w);
      authority.verify();
      await markEffect("filesystem.configuration.publish", { fileTarget });
      authority.afterDispatch();
      const saved = await adapter.publish({ token });
      token = undefined;
      authority.verify();
      if (
        saved?.status !== "saved" ||
        saved.backupId !== backupId ||
        typeof saved.version !== "string" ||
        !/^[a-f0-9]{64}$/u.test(saved.version)
      )
        return unknown();
      await idle();
      const final = await readWorkspaceFile(w, request.path, {
        check: authority.verify,
      });
      await recheck(w);
      authority.verify();
      if (
        final.status !== "available" ||
        final.content !== request.text ||
        final.version !== saved.version ||
        final.directoryVersion !== request.directoryVersion
      )
        return unknown();
      return validateWorkspaceFileSave({
        requestId: request.requestId,
        status: "saved",
        version: final.version,
        backupId,
      });
    } finally {
      if (token) {
        try {
          await adapter.abort({ token });
        } catch {
          /* Original durable key retains uncertainty. */
        }
      }
      w.lock = false;
      if (publishedWorkspace) publishedWorkspace.lock = false;
    }
  }
  async function observeExtensions(w) {
    const original = {
      epoch: host.epoch,
      path: w.path,
      trusted: w.trusted,
      trustRevision: w.trustRevision,
      generation: resourceGenerations.get(w.id) ?? 0,
      revision: registry?.status().revision ?? revision,
    };
    const verify = () => {
      checkLive();
      storageCheck();
      const current = tables().workspaces.get(w.id);
      if (
        !current ||
        host.epoch !== original.epoch ||
        current.path !== original.path ||
        current.trusted !== original.trusted ||
        current.trustRevision !== original.trustRevision ||
        (resourceGenerations.get(w.id) ?? 0) !== original.generation ||
        (registry?.status().revision ?? revision) !== original.revision
      )
        fail("UNAVAILABLE");
      if (!current.trusted) fail("INVALID_SELECTION");
      if (current.lock) fail("BUSY");
    };
    verify();
    await recheck(w);
    verify();
    if (typeof context?.nativeExtensions?.observe !== "function")
      fail("UNAVAILABLE");
    const result = await call(context.nativeExtensions.observe, {
      workspaceId: w.id,
      workspacePath: original.path,
    });
    verify();
    await recheck(w);
    verify();
    try {
      validateExtensionsInventory(result);
      if (result.workspaceId !== w.id || result.workspacePath !== original.path)
        fail("UNAVAILABLE");
      return validateExtensionsObservation({
        ...globalThis.structuredClone(result),
        runtimeEpoch: original.epoch,
        revision: original.revision,
      });
    } catch {
      fail("UNAVAILABLE");
    }
  }
  function addWorkspace(path, trusted, temporary = false, reservation) {
    checkLive();
    const old = [...tables().workspaces.values()].find((w) => w.path === path);
    if (old) return old;
    if (tables().workspaces.size >= 100) fail("LIMIT_REACHED");
    const w = {
      id: reservation?.workspace.workspaceId ?? randomUUID(),
      name: reservation?.workspace.name ?? basename(path),
      ownership: reservation?.workspace.ownership,
      folderSessionId: reservation?.workspace.folderSessionId,
      path,
      kind: "folder",
      trusted,
      trustRevision: 1,
      temporary,
      lock: false,
    };
    tables().workspaces.set(w.id, w);
    if (!currentScope()?.candidate) revision++;
    return w;
  }
  async function addSession(w, info) {
    const owner = currentScope();
    const reservation = owner?.reservation;
    if (
      !opaque(info?.id) ||
      (await canonicalDirectory(info.location?.directory)) !== w.path ||
      [...tables().sessions.values()].some((s) => s.sdkId === info.id)
    )
      fail("RUNTIME_ERROR");
    if (registry && owner.record?.type === "session.fork") {
      const parent = tables().sessions.get(owner.record.sessionId);
      if (
        !parent ||
        (info?.parentID !== parent.sdkId &&
          info?.fork?.sessionID !== parent.sdkId)
      )
        fail("UNKNOWN_OUTCOME");
    }
    if (
      registry &&
      (!reservation ||
        (reservation.plannedNativeSessionId &&
          info.id !== reservation.plannedNativeSessionId) ||
        (reservation.plannedNativeSessionId &&
          !isDeepStrictEqual(info.metadata, owner.nativeMetadata)))
    )
      fail("UNKNOWN_OUTCOME");
    if (registry) {
      owner.verifiedNativeIds ??= new Set();
      owner.verifiedNativeIds.add(info.id);
    }
    checkLive();
    if (tables().workspaces.get(w.id) !== w) fail("NOT_FOUND");
    const s = {
      id: reservation?.appSessionId ?? randomUUID(),
      workspaceId: w.id,
      sdkId: info.id,
      title: clip(info.title, 256) || "Untitled session",
      status: "idle",
      lock: false,
      unknown: false,
      pinned: false,
      archived: false,
      receipts: new Map(),
      invalidPermissions: new Set(),
      messages: [],
      permissions: [],
      generation: 0,
    };
    tables().sessions.set(s.id, s);
    const record = currentScope()?.record;
    if (record && ["session.create", "session.fork"].includes(record.type)) {
      record.result = {
        kind: record.type === "session.fork" ? "forked" : "created",
        workspaceId: w.id,
        sessionId: s.id,
        nativeSessionId: s.sdkId,
      };
      record.evidence = [{ kind: "native-session", id: s.sdkId }];
    }
    if (!currentScope()?.candidate) revision++;
    return s;
  }
  async function reserveSession(w, ownership, path, name, fork = false) {
    if (!registry) return;
    storageCheck();
    const owner = currentScope();
    const plannedNativeSessionId = fork
      ? undefined
      : `ses_${randomUUID().replaceAll("-", "")}`;
    owner.reservation = await registry.reserve({
      ...operationKey(owner.record),
      ...(w
        ? { workspaceId: w.id }
        : {
            ownership,
            ...(path && { canonicalPath: path }),
            ...(name && { name }),
          }),
      ...(plannedNativeSessionId && { plannedNativeSessionId }),
    });
    owner.nativeMetadata = {
      operationId: owner.record.operationId,
      originalRuntimeEpoch: owner.record.runtimeEpoch,
      appSessionId: owner.reservation.appSessionId,
      workspaceId: owner.reservation.workspace.workspaceId,
      digest: owner.record.digest,
    };
    return owner.reservation;
  }
  // Native-owned subagent descendants of a tracked session (depth-bounded;
  // Native keeps finished children, so the count is not capped).
  // App-tracked sessions and forks (also parented to their source session by
  // Native) are excluded: they follow their own mode through their own policy.
  async function nativeDescendants(parentSdkId, code) {
    if (typeof client?.session?.list !== "function") return [];
    const tracked = new Set(
      [...tables().sessions.values()].map((x) => x.sdkId),
    );
    const out = [];
    let frontier = [parentSdkId];
    const done = new Set(frontier);
    for (let depth = 0; depth < 4 && frontier.length; depth++) {
      const next = [];
      for (const id of frontier)
        await scanSessions(
          { parentID: id },
          (data) => {
            for (const child of data)
              if (
                child.parentID === id &&
                !done.has(child.id) &&
                !child.fork &&
                !tracked.has(child.id)
              ) {
                done.add(child.id);
                next.push(child.id);
                out.push({ id: child.id, title: child.title });
              }
          },
          code,
        );
      frontier = next;
    }
    return out;
  }
  // Native copies the parent's session permissions into a subagent child only
  // at creation, so a later mode change would leave children broader. Rewrite
  // every Native-owned descendant to the parent's compiled ruleset; any failure
  // fails the policy write closed.
  async function propagateToChildren(parentSdkId, expected) {
    for (const { id } of await nativeDescendants(
      parentSdkId,
      "POLICY_UNVERIFIED",
    )) {
      let info = await call(client.session.get, { sessionID: id });
      if (!matchesOrderedPermissionRules(expected, info?.permissions)) {
        await call(client.session.update, {
          sessionID: id,
          permissions: expected.map((rule) => ({ ...rule })),
        });
        info = await call(client.session.get, { sessionID: id });
      }
      if (!matchesOrderedPermissionRules(expected, info?.permissions))
        fail("POLICY_UNVERIFIED");
    }
  }
  // `verifyOnly`: a bootstrap session already carries exactly this ruleset from
  // its create input (and a fork of an "ask" session inherits it). Native's
  // permission setter stays held until execution is admitted, so the redundant
  // write is skipped; the exact-readback verification below is unchanged and a
  // mismatch still fails closed. Never used for a mode change.
  async function policy(s, step = "native.policy", verifyOnly = false) {
    try {
      // A persisted mode needs its exact compiler inputs and generation readback.
      // Until that producer is connected, the legacy baseline cannot replace it.
      if (s.permissionControl) fail("POLICY_UNVERIFIED");
      const expected = compileModeRules(modeOf(s));
      currentScope().policyStep = step;
      if (!verifyOnly)
        await call(client.session.update, {
          sessionID: s.sdkId,
          permissions: expected.map((rule) => ({ ...rule })),
        });
      const info = await call(client.session.get, { sessionID: s.sdkId });
      if (
        info?.id !== s.sdkId ||
        (await canonicalDirectory(info.location?.directory)) !==
          workspace(s.workspaceId).path ||
        !matchesAuthenticatedFloor(info.permissions) ||
        !matchesOrderedPermissionRules(expected, info.permissions)
      )
        fail("POLICY_UNVERIFIED");
      await propagateToChildren(s.sdkId, expected);
      s.policyError = false;
      return info;
    } catch {
      checkLive();
      s.policyError = true;
      fail("POLICY_UNVERIFIED");
    }
  }
  function savedSessionCorrelation(existing, admitted, kind) {
    if (!admitted) return false;
    const key = operationKey(admitted);
    if (!isDeepStrictEqual(registry.lookupIdentity(key), admitted))
      return false;
    const correlation = registry.lookup(key);
    const receipt = correlation?.receipt;
    return (
      correlation?.status === "found" &&
      receipt?.effect === "confirmed" &&
      ["runtimeEpoch", "operationId", "type", "workspaceId", "sessionId"].every(
        (field) => receipt[field] === admitted[field],
      ) &&
      receipt.result?.kind === kind &&
      receipt.result.workspaceId === existing.workspaceId &&
      receipt.result.sessionId === existing.id &&
      receipt.result.nativeSessionId === existing.sdkId
    );
  }
  async function verifySavedSession(existing, verified, visiting) {
    if (!existing || existing.unavailable || visiting.has(existing.id))
      return undefined;
    if (verified.has(existing.id)) return verified.get(existing.id);
    visiting.add(existing.id);
    try {
      const w = committed.workspaces.get(existing.workspaceId);
      if (!w || !opaque(existing.sdkId)) return undefined;
      const info = await call(client?.session?.get, {
        sessionID: existing.sdkId,
      });
      if (
        info?.id !== existing.sdkId ||
        (await canonicalDirectory(info?.location?.directory)) !== w.path
      )
        return undefined;
      if (existing.parentSessionId) {
        const parent = committed.sessions.get(existing.parentSessionId);
        const admitted = registry.lookupForkIdentity({
          appSessionId: existing.id,
        });
        if (
          !parent ||
          parent.workspaceId !== existing.workspaceId ||
          parent.sdkId === existing.sdkId ||
          info.fork?.sessionID !== parent.sdkId ||
          admitted?.type !== "session.fork" ||
          admitted.workspaceId !== existing.workspaceId ||
          admitted.sessionId !== parent.id ||
          !savedSessionCorrelation(existing, admitted, "forked")
        )
          return undefined;
        const boundary = registry.lookupForkBoundary?.({
          appSessionId: existing.id,
        });
        if (
          boundary
            ? info.parentID !== parent.sdkId ||
              info.fork?.boundary?.type !== "before" ||
              info.fork?.boundary?.messageID !== boundary.beforeMessageId
            : info.fork?.boundary?.type === "before"
        )
          return undefined;
        // Native projectFork inherits metadata, including through nested forks.
        // Verify each parent's own receipt and lineage before using its metadata.
        const parentInfo = await verifySavedSession(parent, verified, visiting);
        if (
          !parentInfo ||
          !isDeepStrictEqual(info.metadata, parentInfo.metadata)
        )
          return undefined;
      } else {
        const metadata = info.metadata;
        const admitted =
          metadata &&
          registry.lookupIdentity({
            runtimeEpoch: metadata.originalRuntimeEpoch,
            operationId: metadata.operationId,
          });
        if (
          info.fork != null ||
          !admitted ||
          !["workspace.create", "workspace.import", "session.create"].includes(
            admitted.type,
          ) ||
          (admitted.workspaceId &&
            admitted.workspaceId !== existing.workspaceId) ||
          !isDeepStrictEqual(metadata, {
            operationId: admitted.operationId,
            originalRuntimeEpoch: admitted.runtimeEpoch,
            appSessionId: existing.id,
            workspaceId: existing.workspaceId,
            digest: admitted.digest,
          }) ||
          !savedSessionCorrelation(existing, admitted, "created")
        )
          return undefined;
      }
      verified.set(existing.id, info);
      return info;
    } catch {
      return undefined;
    } finally {
      visiting.delete(existing.id);
    }
  }
  const registryLoaded = storageReady
    .then(() => hydrateRegistry())
    .catch((error) => {
      localRecovery = error?.storageReason ?? "storage_denied";
    });
  // Default-workspace bootstrap is a durable multi-step effect. It runs in its
  // own startup scope: the whole-read deadline of the first scope also covers
  // the wait for the sidecar and would otherwise expire mid-journal.
  async function bootstrapDefaultWorkspace() {
    checkBootstrapTaskAuthority();
    const owner = currentScope();
    const operation = { type: "workspace.create", name: "Workbench" };
    const record = {
      runtimeEpoch: host.epoch,
      operationId: randomUUID(),
      type: operation.type,
      digest: fingerprint(operation),
      admission: "admitted",
      delivery: "pending",
      effect: "none",
      revision: registry.status().revision,
      evidence: [],
    };
    await registry.begin({
      runtimeEpoch: record.runtimeEpoch,
      operationId: record.operationId,
      type: record.type,
      digest: record.digest,
    });
    owner.record = record;
    owner.candidate = cloneTables();
    const reservation = await reserveSession(
      undefined,
      "managed",
      undefined,
      "Workbench",
    );
    await registry.materializeManaged(operationKey(record));
    owner.effectStarted = true;
    const w = addWorkspace(
      reservation.workspace.canonicalPath,
      true,
      false,
      reservation,
    );
    await refuseRecordedSession(reservation.plannedNativeSessionId);
    const info = await call(client.session.create, {
      id: reservation.plannedNativeSessionId,
      metadata: owner.nativeMetadata,
      title: "Workbench",
      location: { directory: w.path },
      permissions: BASELINE_POLICY.map((rule) => ({ ...rule })),
    });
    const checked = await call(client.session.get, {
      sessionID: info.id,
    });
    const s = await addSession(w, checked);
    defaultWorkspace = w.id;
    defaultSession = s.id;
    let result;
    try {
      await policy(s, undefined, Boolean(context?.nativeTasks));
      await settleBootstrap();
      result = { ok: true, value: base(w, s) };
    } catch {
      result = failure("POLICY_UNVERIFIED");
    }
    await projectReceipt(record, operation, result, true);
  }
  let needsDefaultBootstrap = false;
  let needsSavedVerify = false;
  // Saved-session verification runs in its own startup scope: the first scope's
  // whole-read deadline also covers the (slow) sidecar wait and would expire,
  // misreporting identity_conflict on a healthy relaunch.
  async function verifySavedSessions() {
    const verified = new Map();
    for (const existing of committed.sessions.values()) {
      if (existing.unavailable) continue;
      if (!(await verifySavedSession(existing, verified, new Set()))) {
        localRecovery = "identity_conflict";
        return;
      }
    }
    needsDefaultBootstrap = bootstrap && committed.workspaces.size === 0;
  }
  ready = host
    .startup(async () => {
      await registryLoaded;
      if (registryInput !== undefined) storageCheck();
      // Main's startup may reconcile unsettled bootstrap creates before it
      // resolves `runtimeReady`; only then are retained operations judged.
      const retainedAtStart = Boolean(
        registry?.readView().retainedOperations.length,
      );
      if (retainedAtStart && !(recoverRetained && runtimeReady)) {
        localRecovery = "native_startup_unverified";
        return;
      }
      if (runtimeReady) {
        runtime = await waitForReady(runtimeReady, controller.signal);
        context = runtime?.workbenchContext?.();
        client = context?.client;
        if (retainedAtStart) hydrateRegistry();
      }
      if (registry) {
        const view = registry.readView();
        if (view.retainedOperations.length) {
          localRecovery = "native_startup_unverified";
          return;
        }
        needsSavedVerify = true;
        return;
      }
      if (!client || !context?.session) return;
      const path = await canonicalDirectory(runtime.workspace);
      const w = addWorkspace(path, true, true);
      const s = await addSession(w, context.session);
      defaultWorkspace = w.id;
      defaultSession = s.id;
      try {
        await policy(s);
      } catch {
        checkLive();
      }
    })
    .then(() =>
      needsSavedVerify ? host.startup(verifySavedSessions) : undefined,
    )
    .then(() =>
      needsDefaultBootstrap
        ? host.startup(bootstrapDefaultWorkspace)
        : undefined,
    )
    .catch((error) => {
      if (registryInput !== undefined && !localRecovery)
        localRecovery =
          registry?.status().reason ??
          error?.storageReason ??
          "native_startup_unverified";
    })
    .finally(() => {
      initializing = false;
    });
  // Rejected native startup leaves this same facade and transport epoch alive.
  ready.catch(() => {});
  runtimeReady?.catch(() => {});
  function recoveryDTO() {
    const view = registry?.readView();
    return {
      store: localRecovery
        ? { state: "recovery_required", reason: localRecovery }
        : (view?.recovery.store ?? { state: "ready" }),
      resources: view?.recovery.resources ?? [],
    };
  }
  const workspaceMeta = new Map();
  const workspaceMetaAt = new Map();
  // Short TTL and a per-path timeout keep snapshots from re-probing slow or hung paths every time.
  async function refreshWorkspaceMeta() {
    if (!probeWorkspace) return;
    const paths = new Set([
      ...(registry?.readView().workspaces.map((e) => e.canonicalPath) ?? []),
      ...[...tables().workspaces.values()].map((e) => e.path),
    ]);
    await Promise.all(
      [...paths].slice(0, 100).map(async (path) => {
        if (Date.now() - (workspaceMetaAt.get(path) ?? -Infinity) < 10000)
          return;
        workspaceMetaAt.set(path, Date.now());
        let timer;
        try {
          workspaceMeta.set(
            path,
            (await Promise.race([
              probeWorkspace(path),
              new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error("timeout")), 1500);
              }),
            ])) ?? {},
          );
        } catch {
          workspaceMeta.delete(path);
        } finally {
          clearTimeout(timer);
        }
      }),
    );
  }
  function base(w, s, projection) {
    checkLive();
    if (currentScope()?.candidate)
      return {
        runtimeEpoch: host.epoch,
        ...(w && { selectedWorkspaceId: w.id }),
        ...(s && { selectedSessionId: s.id }),
      };
    const view = registry?.readView();
    const publishedWorkspaces = view
      ? view.workspaces.map((entry) => ({
          id: entry.workspaceId,
          name: entry.name ?? basename(entry.canonicalPath),
          path: entry.canonicalPath,
          kind: "folder",
          trusted:
            committed.workspaces.get(entry.workspaceId)?.trusted ?? false,
          trustRevision: entry.trustRevision ?? 0,
          temporary: false,
        }))
      : [...committed.workspaces.values()];
    const publishedSessions = view
      ? view.sessions.map((entry) => ({
          id: entry.appSessionId,
          workspaceId: entry.workspaceId,
          title: entry.title ?? "Untitled session",
          status: entry.status,
          pinned: entry.pinned,
          archived: entry.archived,
          permissionMode: entry.permissionMode,
          ...(entry.parentSessionId && {
            parentSessionId: entry.parentSessionId,
          }),
        }))
      : [...committed.sessions.values()];
    if (w && !publishedWorkspaces.some((entry) => entry.id === w.id))
      w = undefined;
    if (
      s &&
      (!w ||
        !publishedSessions.some(
          (entry) => entry.id === s.id && entry.workspaceId === w.id,
        ))
    )
      s = undefined;
    if (observationSequence >= Number.MAX_SAFE_INTEGER) fail("UNAVAILABLE");
    const recovery = recoveryDTO();
    const blocked = recovery.store.state !== "ready";
    const selectedBlocked = recovery.resources.some(
      (resource) =>
        resource.workspaceId === w?.id &&
        (!resource.sessionId || resource.sessionId === s?.id),
    );
    const projected = projection ?? nativeProjections.get(s?.id) ?? s;
    return validateSnapshot({
      runtimeEpoch: host.epoch,
      revision: registry?.status().revision ?? revision,
      observationSequence: ++observationSequence,
      recovery,
      retainedOperations: registry?.readView().retainedOperations ?? [],
      state:
        blocked || initializing || selectedBlocked
          ? "unavailable"
          : (runtime?.snapshot().state ?? "unavailable"),
      temporary: registry ? false : true,
      workspaces: publishedWorkspaces.map(
        ({ id, name, path, kind, trusted, trustRevision, temporary }) => ({
          id,
          name,
          path,
          kind,
          trusted,
          trustRevision,
          temporary,
          ...workspaceMeta.get(path),
        }),
      ),
      sessions: publishedSessions.map(
        ({
          id,
          workspaceId,
          title,
          status,
          pinned,
          archived,
          parentSessionId,
          permissionMode,
        }) => ({
          id,
          workspaceId,
          permissionMode: modeOf({ permissionMode }),
          title,
          status:
            blocked ||
            recovery.resources.some(
              (r) =>
                r.workspaceId === workspaceId &&
                (!r.sessionId || r.sessionId === id),
            )
              ? "unavailable"
              : (nativeProjections.get(id)?.status ?? status),
          pinned,
          archived,
          ...(parentSessionId && { parentSessionId }),
        }),
      ),
      ...(w && { selectedWorkspaceId: w.id }),
      ...(s && { selectedSessionId: s.id }),
      messages:
        blocked || initializing || selectedBlocked || s?.unavailable
          ? []
          : (projected?.messages ?? []),
      ...(!blocked &&
      !initializing &&
      !selectedBlocked &&
      !s?.unavailable &&
      w?.trusted &&
      runtime?.snapshot().state === "connected" &&
      projection?.sessionSelection
        ? { sessionSelection: projection.sessionSelection }
        : {}),
      permissions:
        blocked || initializing || selectedBlocked || s?.unavailable
          ? []
          : (projected?.permissions ?? []),
      ...(projected?.error
        ? { error: projected.error }
        : s?.policyError
          ? {
              error: {
                code: "POLICY_UNVERIFIED",
                message: ERRORS.POLICY_UNVERIFIED,
              },
            }
          : {}),
    });
  }
  async function refresh(original) {
    const s = {
      ...original,
      receipts: new Map(original.receipts),
      invalidPermissions: new Set(original.invalidPermissions),
    };
    if (reads.has(s.id)) return reads.get(s.id);
    const generation = resourceGenerations.get(s.workspaceId) ?? 0;
    const currentResourceMatches = () => {
      const current = committed.sessions.get(s.id);
      return (
        current &&
        current.sdkId === original.sdkId &&
        current.workspaceId === original.workspaceId &&
        (resourceGenerations.get(s.workspaceId) ?? 0) === generation &&
        current.generation === original.generation
      );
    };
    const read = (async () => {
      try {
        const info = await call(client.session.get, { sessionID: s.sdkId });
        const active = await call(client.session.active);
        const inbox = await call(client.session.inbox.list, {
          sessionID: s.sdkId,
        });
        const messages = await call(client.message.list, {
          sessionID: s.sdkId,
          limit: 100,
          order: "desc",
        });
        // Permission state is read per location. If it cannot be read, the
        // transcript stays readable but nothing may act on permissions: the
        // session is marked permissions-unavailable (send/reply refuse) and is
        // not a runtime error by itself.
        let pending = [];
        let subagentPending = [];
        let permissionsUnavailable = false;
        try {
          pending = await call(client.permission.list, {
            sessionID: s.sdkId,
          });
          if (!Array.isArray(pending)) fail("RUNTIME_ERROR");
          for (const child of await nativeDescendants(
            s.sdkId,
            "RUNTIME_ERROR",
          )) {
            const list = await call(client.permission.list, {
              sessionID: child.id,
            });
            if (!Array.isArray(list)) fail("RUNTIME_ERROR");
            for (const p of list)
              if (p?.sessionID === child.id)
                subagentPending.push({ ...p, childTitle: child.title });
          }
        } catch {
          checkLive();
          pending = [];
          subagentPending = [];
          permissionsUnavailable = true;
        }
        if (
          info?.id !== s.sdkId ||
          (await canonicalDirectory(info.location?.directory)) !==
            workspace(s.workspaceId).path ||
          !active ||
          typeof active !== "object" ||
          !Array.isArray(inbox) ||
          !Array.isArray(messages?.data) ||
          !Array.isArray(pending)
        )
          fail("RUNTIME_ERROR");
        checkLive();
        if (
          (resourceGenerations.get(s.workspaceId) ?? 0) !== generation ||
          original.lock ||
          !currentResourceMatches()
        )
          fail("READ_BUSY");
        s.permissionsUnavailable = permissionsUnavailable;
        s.sessionSelection = projectSessionSelection(info, s.id);
        s.messages = projectMessages([...messages.data].reverse());
        s.permissions = [
          ...pending.filter((p) => p.sessionID === s.sdkId),
          ...subagentPending,
        ]
          .filter((p) => opaque(p.id) && !s.invalidPermissions.has(p.id))
          .slice(0, 100)
          .map((p) => ({
            id: p.id,
            sessionId: s.id,
            ...(p.childTitle !== undefined && {
              childTitle: clip(p.childTitle, 128) || "Subagent",
            }),
            title: clip(p.action, 128),
            ...(p.source?.type === "tool" && opaque(p.source.id)
              ? { toolId: p.source.id }
              : {}),
            detail: clip(
              Array.isArray(p.resources)
                ? p.resources.filter((x) => typeof x === "string").join("\n")
                : "",
              2000,
            ),
          }));
        const running =
          active[s.sdkId]?.type === "running" ||
          inbox.some((item) => item.sessionID === s.sdkId);
        const observedReceipt = [...s.receipts.values()].some(
          (r) =>
            r.inboxId &&
            (inbox.some((i) => i.id === r.inboxId) ||
              messages.data.some((m) => m.id === r.inboxId)),
        );
        if (running)
          s.status = s.status === "stopping" ? "stopping" : "running";
        else if (
          !s.unknown &&
          (!s.awaiting ||
            observedReceipt ||
            (typeof info.time?.idle === "number" &&
              info.time.idle >= s.awaiting))
        ) {
          s.status = "idle";
          s.awaiting = undefined;
        } else s.status = s.unknown ? "unknown" : s.status;
        // Native title observation never commits authoritative metadata.
        const latest = messages.data.find((m) => m.type === "assistant");
        const failed = latest?.error ? latest : undefined;
        const code = s.unknown
          ? "UNKNOWN_OUTCOME"
          : failed
            ? structuredError(failed.error)
            : info.outcome === "failed"
              ? "RUNTIME_ERROR"
              : undefined;
        s.error = code
          ? { code, message: ERRORS[code] }
          : permissionsUnavailable
            ? { code: "UNAVAILABLE", message: ERRORS.UNAVAILABLE }
            : undefined;
      } catch {
        delete s.sessionSelection;
        delete s.permissionsUnavailable;
        checkLive();
        if (
          (resourceGenerations.get(s.workspaceId) ?? 0) !== generation ||
          original.lock ||
          !currentResourceMatches()
        )
          fail("READ_BUSY");
        if (!s.lock) {
          s.status = "unknown";
          s.error = { code: "RUNTIME_ERROR", message: ERRORS.RUNTIME_ERROR };
        }
      }
      checkLive();
      if (
        !currentResourceMatches() ||
        (resourceGenerations.get(s.workspaceId) ?? 0) !== generation
      )
        fail("READ_BUSY");
      nativeProjections.set(s.id, s);
      return s;
    })().finally(() => reads.delete(s.id));
    reads.set(s.id, read);
    return read;
  }
  async function catalog(w, provenance = false) {
    if (!w.trusted && !provenance)
      return { dto: emptyCatalog(), models: new Map() };
    await recheck(w);
    const configuration = provenance
      ? await discoverConfiguration(w.path, checkLive)
      : undefined;
    if (provenance) await recheck(w);
    if (!w.trusted)
      return {
        dto: {
          ...emptyCatalog(),
          configuration: { ...configuration, reason: "untrusted_workspace" },
        },
        models: new Map(),
      };
    const location = { location: { directory: w.path } };
    const group = async (fn, cap = 300) => {
      try {
        const result = await call(fn, location);
        if (!Array.isArray(result?.data)) throw new Error();
        return result.data.slice(0, cap);
      } catch {
        checkLive();
        return null;
      }
    };
    const commands = await group(client.command?.list);
    const skills = await group(client.skill?.list);
    const mcp = await group(client.mcp?.list);
    const agents = await group(client.agent?.list);
    // Uncapped: a large cloud catalog (OpenRouter) must not hide local models.
    // The cap is applied after filtering, with local providers first (below).
    const models = await group(client.model?.list, Infinity);
    const providers = await group(client.provider?.list);
    const integrations = await group(client.integration?.list);
    const simple = (items, key = "id", includeProvenance = false) =>
      items === null
        ? unavailable()
        : available(
            items
              .filter((i) => opaque(i[key]) && typeof i.name === "string")
              .map((i) => ({
                id: i[key],
                name: clip(i.name, 256),
                ...(typeof i.description === "string"
                  ? { description: clip(i.description, 1000) }
                  : {}),
                ...(includeProvenance ? skillProvenance(w.path, i) : {}),
              })),
          );
    const isLocalModel = (m) => {
      const p = providers?.find((x) => x.id === m.providerID);
      return p?.activation === "enabled" && !p.integrationID;
    };
    const modelMap = new Map();
    const seenModels = new Set();
    for (const model of models ?? []) {
      if (!opaque(model?.id) || !opaque(model?.providerID)) continue;
      const id = createHash("sha256")
        .update(JSON.stringify([model.providerID, model.id]))
        .digest("hex");
      if (seenModels.has(id)) {
        modelMap.delete(id);
        continue;
      }
      seenModels.add(id);
      const provider = providers?.find(
        (p) => p.id === model.providerID && p.activation !== "disabled",
      );
      const integration = integrations?.find(
        (i) => i.id === provider?.integrationID,
      );
      // A provider with no integration that Native itself activated (a local
      // endpoint such as LM Studio) needs no credential.
      const authenticated =
        integration?.connections?.some(
          (c) => c.type === "credential" || c.type === "env",
        ) ||
        (provider?.activation === "enabled" && !provider.integrationID);
      if (
        model.enabled === true &&
        opaque(model.id) &&
        opaque(model.providerID) &&
        provider &&
        authenticated
      ) {
        modelMap.set(id, model);
      }
    }
    if (provenance) await recheck(w);
    return {
      models: modelMap,
      dto: {
        commands: simple(commands, "name"),
        skills: simple(skills, "id", provenance),
        ...(provenance && { configuration }),
        agents: simple(
          agents?.filter(
            (a) => !a.hidden && ["primary", "all"].includes(a.mode),
          ) ?? null,
        ),
        mcp:
          mcp === null
            ? unavailable()
            : available(
                mcp
                  .filter((i) => opaque(i.name))
                  .map((i) => ({
                    id: i.name,
                    name: clip(i.name, 256),
                    status: [
                      "connected",
                      "pending",
                      "disabled",
                      "failed",
                      "needs_auth",
                    ].includes(i.status?.status)
                      ? i.status.status
                      : "unavailable",
                  })),
              ),
        models:
          models === null || providers === null || integrations === null
            ? unavailable()
            : available(
                [...modelMap]
                  // Local providers (Native-activated, no integration) first so
                  // the cap never drops them; sort is stable otherwise.
                  .sort(
                    ([, a], [, b]) =>
                      Number(isLocalModel(b)) - Number(isLocalModel(a)),
                  )
                  .slice(0, 300)
                  .map(([id, m]) => ({
                    id,
                    name: clip(m.name, 256),
                    status: clip(m.status, 32),
                    ...projectModelOptions(m),
                  })),
              ),
      },
    };
  }
  async function send(request, w, s) {
    const currentRun = Object.hasOwn(request, "delivery");
    if (s.archived) fail("ARCHIVED_SESSION");
    if (nativeProjections.get(s.id)?.permissionsUnavailable)
      fail("UNAVAILABLE");
    const hash = fingerprint(request);
    const receiptKey = currentScope()?.record?.operationId ?? request.requestId;
    const previous = s.receipts.get(receiptKey);
    if (previous) {
      if (previous.hash !== hash) fail("DUPLICATE_CONFLICT");
      return previous.result?.ok === false
        ? previous.result
        : {
            ok: true,
            value: {
              requestId: request.requestId,
              status: previous.unknown ? "unknown" : "duplicate",
            },
          };
    }
    if (
      w.lock ||
      s.lock ||
      (currentRun
        ? !["idle", "running"].includes(s.status)
        : s.status !== "idle") ||
      s.unknown
    )
      fail("BUSY");
    // Never evict old IDs then silently replay them. A full bounded registry fails closed.
    if (s.receipts.size >= 256) fail("LIMIT_REACHED");
    const receipt = { hash };
    s.receipts.set(receiptKey, receipt);
    s.lock = true;
    w.lock = true;
    s.generation++;
    let dispatched = false;
    let switching = false;
    let acquired;
    try {
      await recheck(w);
      if (!w.trusted) fail("INVALID_SELECTION");
      await verifyInstructionBaseline(w, s, currentRun);
      let active, inbox;
      // A just-finished reply can still show as active for a moment; wait
      // briefly for idle before rejecting (bounded, ~3s).
      for (let attempt = 0; ; attempt++) {
        active = await call(client.session.active);
        inbox = await call(client.session.inbox.list, {
          sessionID: s.sdkId,
        });
        if (!active || typeof active !== "object" || !Array.isArray(inbox))
          fail("RUNTIME_ERROR");
        if (
          currentRun ||
          attempt >= 15 ||
          !(active[s.sdkId] || inbox.some((item) => item.sessionID === s.sdkId))
        )
          break;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      if (
        currentRun
          ? active[s.sdkId]?.type !== "running"
          : active[s.sdkId] || inbox.some((item) => item.sessionID === s.sdkId)
      ) {
        s.status = "running";
        fail("BUSY");
      }
      const inventory = currentRun ? undefined : await catalog(w);
      if (!currentRun && !inventory.models.size) fail("AUTH_REQUIRED");
      if (
        request.agent &&
        !inventory.dto.agents.entries.some((a) => a.id === request.agent)
      )
        fail("INVALID_SELECTION");
      if (request.model && !inventory.models.has(request.model))
        fail("INVALID_SELECTION");
      if (
        request.type === "command.run" &&
        !inventory.dto.commands.entries.some((c) => c.id === request.name)
      )
        fail("INVALID_SELECTION");
      if (
        request.variant &&
        (!request.model ||
          !projectModelOptions(
            inventory.models.get(request.model),
          ).variants.ids.includes(request.variant))
      )
        fail("INVALID_SELECTION");
      if (request.attachments) {
        if (
          !request.model ||
          !contextModelSupports(
            projectModelOptions(inventory.models.get(request.model)),
            request.attachments,
          )
        )
          fail("INVALID_SELECTION");
        acquired = contextIO.acquire(
          request.attachments,
          { id: w.id, path: w.path },
          {
            runtimeEpoch: host.epoch,
            sender: currentScope()?.sender,
            check: checkLive,
          },
        );
      }
      // Acquire and validate the exact cached bytes before any Native mutation.
      // Both baseline policy stages still bracket agent/model selection.
      await policy(s, "native.policy.before_selection");
      switching = true;
      if (request.agent)
        await call(client.session.switchAgent, {
          sessionID: s.sdkId,
          agent: request.agent,
        });
      // An omitted selection means the runtime's own resolution, including any
      // session/agent defaults and variant. Catalog order is never a default.
      if (request.model) {
        const selected = inventory.models.get(request.model);
        await call(client.session.switchModel, {
          sessionID: s.sdkId,
          model: {
            id: selected.id,
            providerID: selected.providerID,
            ...(Object.hasOwn(request, "variant")
              ? { variant: request.variant }
              : {}),
          },
        });
      }
      await policy(s, "native.policy.after_selection");
      switching = false;
      await recheck(w);
      await verifyInstructionBaseline(w, s, currentRun);
      s.status = "running";
      s.awaiting = Date.now();
      dispatched = true;
      if (request.type === "message.send") {
        const result = await call(client.session.prompt, {
          sessionID: s.sdkId,
          text: request.text,
          ...(currentRun && { delivery: request.delivery }),
          ...(acquired && { files: acquired.files }),
        });
        if (
          !validContextPromptReceipt(
            result,
            s.sdkId,
            request.text,
            currentRun ? request.delivery : undefined,
            acquired?.files,
          )
        )
          throw new Error("invalid_receipt");
        receipt.inboxId = result.id;
      } else
        await call(client.session.command, {
          sessionID: s.sdkId,
          name: request.name,
          text: request.arguments,
        });
      receipt.result = {
        ok: true,
        value: { requestId: request.requestId, status: "accepted" },
      };
    } catch (error) {
      if (dispatched) {
        s.unknown = true;
        s.status = "unknown";
        receipt.unknown = true;
        receipt.result = {
          ok: true,
          value: { requestId: request.requestId, status: "unknown" },
        };
      } else {
        if (switching && error.appCode !== "POLICY_UNVERIFIED") {
          s.unknown = true;
          s.status = "unknown";
        }
        receipt.result = failure(error.appCode ?? "RUNTIME_ERROR");
      }
    } finally {
      acquired?.release();
      s.lock = false;
      w.lock = false;
      s.generation++;
      if (!currentScope()?.candidate) revision++;
    }
    return receipt.result;
  }
  function contextReadAuthority(w) {
    const path = w.path,
      trust = w.trustRevision,
      generation = resourceGenerations.get(w.id) ?? 0,
      expected = registry?.status().revision ?? revision;
    const verify = () => {
      checkLive();
      storageCheck();
      const current = tables().workspaces.get(w.id);
      if (
        current !== w ||
        current.path !== path ||
        current.trustRevision !== trust ||
        !current.trusted ||
        (resourceGenerations.get(w.id) ?? 0) !== generation ||
        (registry?.status().revision ?? revision) !== expected
      )
        fail("UNAVAILABLE");
      if (current.lock) fail("BUSY");
    };
    verify();
    return { verify, revision: expected };
  }
  async function observeContext(request, w) {
    const authority = contextReadAuthority(w);
    await recheck(w);
    authority.verify();
    const value = await contextIO.observe(
      { id: w.id, path: w.path },
      request.path,
      {
        runtimeEpoch: host.epoch,
        sender: currentScope()?.sender,
        check: authority.verify,
        ...(request.selection && { selection: request.selection }),
      },
    );
    await recheck(w);
    authority.verify();
    return validateContextObservation({
      runtimeEpoch: host.epoch,
      revision: authority.revision,
      workspaceId: w.id,
      workspacePath: w.path,
      path: request.path,
      ...value,
    });
  }
  async function nativeInbox(w, s, verify = checkLive) {
    verify();
    await recheck(w);
    const info = await call(client.session.get, { sessionID: s.sdkId });
    if (
      info?.id !== s.sdkId ||
      (await canonicalDirectory(info.location?.directory)) !== w.path
    )
      fail("UNAVAILABLE");
    verify();
    const rows = await call(client.session.inbox.list, { sessionID: s.sdkId });
    verify();
    try {
      return projectContextInbox(rows, s.sdkId);
    } catch {
      fail("UNAVAILABLE");
    }
  }
  async function observePermissionPolicy(w, s) {
    const authority = contextReadAuthority(w);
    const generation = s.generation;
    const sdkId = s.sdkId;
    const verify = () => {
      authority.verify();
      if (runtime?.snapshot().state !== "connected") fail("UNAVAILABLE");
      if (
        tables().sessions.get(s.id) !== s ||
        s.workspaceId !== w.id ||
        s.sdkId !== sdkId ||
        s.generation !== generation ||
        s.unknown ||
        s.unavailable ||
        s.archived ||
        s.lock ||
        s.status === "stopping"
      )
        fail("UNAVAILABLE");
    };
    verify();
    await recheck(w);
    verify();
    const info = registry
      ? await verifySavedSession(s, new Map(), new Set())
      : await call(client.session.get, { sessionID: sdkId });
    verify();
    if (
      info?.id !== sdkId ||
      (await canonicalDirectory(info.location?.directory)) !== w.path
    )
      fail("UNAVAILABLE");
    verify();
    const observed = projectPermissionPolicy(
      {
        runtimeEpoch: host.epoch,
        revision: authority.revision,
        workspaceId: w.id,
        workspacePath: w.path,
        sessionId: s.id,
      },
      info,
    );
    await recheck(w);
    verify();
    return observed;
  }
  async function observeInbox(w, s) {
    const authority = contextReadAuthority(w);
    const generation = s.generation;
    const verify = () => {
      authority.verify();
      if (
        tables().sessions.get(s.id) !== s ||
        s.generation !== generation ||
        s.unknown ||
        s.archived
      )
        fail("UNAVAILABLE");
    };
    const rows = await nativeInbox(w, s, verify);
    verify();
    return {
      runtimeEpoch: host.epoch,
      revision: authority.revision,
      workspaceId: w.id,
      sessionId: s.id,
      ...rows,
    };
  }
  async function cancelInbox(request, w, s) {
    if (w.lock || s.lock || s.unknown || s.archived) fail("BUSY");
    w.lock = true;
    s.lock = true;
    s.generation++;
    let dispatched = false;
    try {
      await recheck(w);
      if (!w.trusted) fail("INVALID_SELECTION");
      await verifyInstructionBaseline(w, s, true);
      await policy(s, "native.policy.before_selection");
      const rows = await nativeInbox(w, s);
      if (!rows.entries.some((row) => row.id === request.inboxId))
        fail("INVALID_SELECTION");
      await policy(s, "native.policy.after_selection");
      await recheck(w);
      await verifyInstructionBaseline(w, s, true);
      dispatched = true;
      const result = await call(client.session.inbox.cancel, {
        sessionID: s.sdkId,
        inboxID: request.inboxId,
      });
      if (result !== undefined) fail("UNKNOWN_OUTCOME");
      return { requestId: request.requestId, status: "accepted" };
    } catch (error) {
      if (dispatched) {
        s.unknown = true;
        s.status = "unknown";
        return { requestId: request.requestId, status: "unknown" };
      }
      throw error;
    } finally {
      w.lock = false;
      s.lock = false;
      s.generation++;
    }
  }
  function successor(w) {
    return [...tables().sessions.values()].find(
      (item) => item.workspaceId === w.id && !item.archived,
    );
  }
  function safeSnapshot(w, preferred) {
    if (!w || tables().workspaces.get(w.id) !== w) return base();
    const selected =
      preferred &&
      tables().sessions.get(preferred.id) === preferred &&
      !preferred.archived
        ? preferred
        : successor(w);
    return base(w, selected);
  }
  async function nativeAgentState(w, sourceName) {
    await mcpIdentity(w);
    if (!context?.nativeAgents?.observe) fail("UNAVAILABLE");
    const observed = await call(context.nativeAgents.observe, {
      workspaceId: w.id,
      workspacePath: w.path,
    });
    const publicList = await call(client.agent.list, {
      location: { directory: w.path },
    });
    let references;
    try {
      references = await readNativeAgentSessions(client, {
        check: checkLive,
        signal: controller.signal,
      });
    } catch (error) {
      if (error.appCode) throw error;
      return { status: "unavailable", reason: "references_unverified" };
    }
    const state = projectNativeAgentRows(observed, publicList, references, {
      workspaceId: w.id,
      workspacePath: w.path,
      runtimeEpoch: host.epoch,
    });
    if (state.status !== "observed") return state;
    if (sourceName !== undefined) {
      const file = await readAgentFile(w, sourceName, { check: checkLive });
      state.file =
        file.status === "available"
          ? {
              sourceName,
              status: "available",
              version: file.version,
              directoryVersion: file.directoryVersion,
              digest: agentRuntimeDigest(file.content),
            }
          : { sourceName, status: file.status, reason: file.reason };
      if (file.status === "available") state.fileText = file.content;
    }
    await mcpIdentity(w);
    return state;
  }
  async function observeAgentRuntime(request, w) {
    if (w.lock) fail("BUSY");
    const state = await nativeAgentState(w, request.sourceName);
    const common = {
      workspaceId: w.id,
      workspacePath: w.path,
      runtimeEpoch: host.epoch,
    };
    if (state.status !== "observed") return { ...common, ...state };
    const { fileText, ...projection } = state;
    const value = { ...common, ...projection, observationId: randomUUID() };
    if (!validAgentRuntimeObservation(value)) fail("AGENT_UNVERIFIED");
    if (agentObservations.size >= 32)
      agentObservations.delete(agentObservations.keys().next().value);
    agentObservations.set(value.observationId, {
      value: globalThis.structuredClone(value),
      fileText,
      workspace: committed.workspaces.get(w.id),
      sourceName: request.sourceName,
      created: performance.now(),
    });
    return value;
  }
  async function mutateAgentRuntime(request, w) {
    if (!registry || !context?.nativeAgents) fail("UNAVAILABLE");
    if (w.lock) fail("BUSY");
    const saved = agentObservations.get(request.observationId);
    const registering = request.type === "configuration.agent.register";
    const expected = async () => {
      if (
        !saved ||
        saved.value.runtimeEpoch !== host.epoch ||
        saved.value.workspaceId !== w.id ||
        saved.value.workspacePath !== w.path ||
        saved.workspace !== committed.workspaces.get(w.id) ||
        performance.now() - saved.created > 300000 ||
        (registering && saved.sourceName !== request.sourceName)
      )
        fail("AGENT_CHANGED");
      const state = await nativeAgentState(
        w,
        registering ? request.sourceName : undefined,
      );
      if (
        state.status !== "observed" ||
        state.defaultAgentId === null ||
        state.defaultAgentId !== saved.value.defaultAgentId ||
        !isDeepStrictEqual(state.owned, saved.value.owned) ||
        !isDeepStrictEqual(state.unowned, saved.value.unowned)
      )
        fail("AGENT_CHANGED");
      if (
        registering &&
        (!state.file ||
          state.file.status !== "available" ||
          !isDeepStrictEqual(state.file, saved.value.file) ||
          state.fileText !== saved.fileText ||
          state.file.version !== request.version ||
          state.file.directoryVersion !== request.directoryVersion ||
          state.file.digest !== request.digest)
      )
        fail("FILE_CHANGED");
      const target = state.owned.find((row) =>
        registering
          ? row.sourceName === request.sourceName
          : row.nativeId === request.nativeId,
      );
      if (registering && target) fail("AGENT_OWNERSHIP_CONFLICT");
      if (!registering && !target) fail("AGENT_OWNERSHIP_CONFLICT");
      if (!registering && target.referenceCount !== 0) fail("AGENT_IN_USE");
      return { state, target };
    };
    w.lock = true;
    try {
      const before = await expected();
      const original = currentScope().record;
      if (!original) fail("UNAVAILABLE");
      const owner = registering
        ? {
            runtimeEpoch: original.runtimeEpoch,
            operationId: original.operationId,
            workspaceId: w.id,
            workspacePath: w.path,
            sourceName: request.sourceName,
            digest: request.digest,
          }
        : undefined;
      const nativeRecord = registering
        ? parseAgentRuntimeRecord(before.state.fileText, owner)
        : undefined;
      if (registering && !nativeRecord) fail("AGENT_UNSUPPORTED");
      const row = registering
        ? {
            sourceName: owner.sourceName,
            nativeId: nativeRecord.id,
            digest: owner.digest,
            nativeDigest: nativeAgentDigest(nativeRecord),
            registrationRuntimeEpoch: owner.runtimeEpoch,
            registrationOperationId: owner.operationId,
            name: nativeRecord.name,
            system: nativeRecord.system,
            systemDigest: agentRuntimeDigest(nativeRecord.system),
            path: `${w.path}/.opencode/agents/${owner.sourceName}.md`,
            mode: nativeRecord.mode,
            hidden: nativeRecord.hidden,
            permissions: nativeRecord.permissions,
            referenceCount: 0,
            ...(nativeRecord.description !== undefined && {
              description: nativeRecord.description,
            }),
            ...(nativeRecord.color !== undefined && {
              color: nativeRecord.color,
            }),
          }
        : before.target;
      if (
        registering &&
        [...before.state.owned, ...before.state.unowned].some(
          (item) => item.nativeId === row.nativeId,
        )
      )
        fail("AGENT_OWNERSHIP_CONFLICT");
      if (
        registering &&
        (before.state.owned.length >= 16 ||
          before.state.owned.length + before.state.unowned.length >= 64)
      )
        fail("LIMIT_REACHED");
      if (
        !(await confirmAgentRuntime(
          Object.freeze({
            action: registering ? "register" : "remove",
            workspaceId: w.id,
            workspacePath: w.path,
            ...globalThis.structuredClone(row),
            defaultAgentId: before.state.defaultAgentId,
            ...(registering && {
              version: request.version,
              directoryVersion: request.directoryVersion,
            }),
          }),
        ))
      )
        fail("CANCELLED");
      checkLive();
      const checked = await expected();
      if (!isDeepStrictEqual(checked, before)) fail("AGENT_CHANGED");
      currentScope().agentRuntimeProof = agentRuntimeDispatchProof(row);
      if (registering) {
        const result = await call(context.nativeAgents.register, {
          owner,
          record: nativeRecord,
          recordDigest: row.nativeDigest,
          expectedNativeId: null,
        });
        try {
          validateAgentRpcResult("register", result);
        } catch {
          fail("UNKNOWN_OUTCOME");
        }
        if (
          result.status !== "registered" ||
          !isDeepStrictEqual(result.owner, owner) ||
          !isDeepStrictEqual(result.record, nativeRecord) ||
          result.recordDigest !== row.nativeDigest ||
          result.defaultAgentId !== before.state.defaultAgentId
        )
          fail("UNKNOWN_OUTCOME");
      } else {
        const registration = {
          runtimeEpoch: row.registrationRuntimeEpoch,
          operationId: row.registrationOperationId,
          workspaceId: w.id,
          workspacePath: w.path,
          sourceName: row.sourceName,
          digest: row.digest,
        };
        const mutationOwner = {
          ...registration,
          runtimeEpoch: original.runtimeEpoch,
          operationId: original.operationId,
        };
        const result = await call(context.nativeAgents.remove, {
          owner: mutationOwner,
          registration,
          nativeId: row.nativeId,
          recordDigest: row.nativeDigest,
        });
        try {
          validateAgentRpcResult("remove", result);
        } catch {
          fail("UNKNOWN_OUTCOME");
        }
        if (
          result.status !== "removed" ||
          !isDeepStrictEqual(result.owner, mutationOwner) ||
          !isDeepStrictEqual(result.registration, registration) ||
          result.nativeId !== row.nativeId ||
          result.recordDigest !== row.nativeDigest ||
          result.defaultAgentId !== before.state.defaultAgentId
        )
          fail("UNKNOWN_OUTCOME");
      }
      const post = await nativeAgentState(
        w,
        registering ? request.sourceName : undefined,
      );
      if (
        post.status !== "observed" ||
        post.defaultAgentId !== before.state.defaultAgentId ||
        !isDeepStrictEqual(post.unowned, before.state.unowned)
      )
        fail("UNKNOWN_OUTCOME");
      const except = (rows) =>
        rows.filter((item) => item.sourceName !== row.sourceName);
      if (!isDeepStrictEqual(except(post.owned), except(before.state.owned)))
        fail("UNKNOWN_OUTCOME");
      const after = post.owned.find(
        (item) => item.sourceName === row.sourceName,
      );
      if (
        registering
          ? !isDeepStrictEqual(after, row) ||
            !isDeepStrictEqual(post.file, before.state.file) ||
            post.fileText !== before.state.fileText
          : Boolean(after)
      )
        fail("UNKNOWN_OUTCOME");
      return {
        requestId: request.requestId,
        status: registering ? "registered_primary" : "removed",
        ...agentRuntimeIdentity(row),
        systemDigest: row.systemDigest,
        defaultAgentId: post.defaultAgentId,
        ...(registering && {
          version: request.version,
          directoryVersion: request.directoryVersion,
        }),
      };
    } finally {
      w.lock = false;
      agentObservations.delete(request.observationId);
    }
  }
  async function nativeSkillState(w, s, sourceName) {
    await mcpIdentity(w);
    if (!context?.nativeSkills?.observe) fail("UNAVAILABLE");
    const observed = await call(context.nativeSkills.observe, {
      workspaceId: w.id,
      workspacePath: w.path,
    });
    const publicList = await call(client.skill.list, {
      location: { directory: w.path },
    });
    const state = projectNativeSkillRows(observed, publicList, {
      workspaceId: w.id,
      workspacePath: w.path,
      runtimeEpoch: host.epoch,
    });
    if (state.status !== "observed") return state;
    if (sourceName !== undefined) {
      const file = await readSkillFile(w, sourceName, { check: checkLive });
      state.file =
        file.status === "available"
          ? {
              sourceName,
              status: "available",
              version: file.version,
              directoryVersion: file.directoryVersion,
              digest: skillRuntimeDigest(file.content),
            }
          : { sourceName, status: file.status, reason: file.reason };
      if (file.status === "available") state.fileText = file.content;
    }
    if (s) {
      await idleIdentity(w, s);
      state.session = {
        sessionId: s.id,
        status: "observed",
        messages: await scanNativeSkillHistory(
          (input) => call(client.message.list, input),
          s.sdkId,
        ),
      };
      await idleIdentity(w, s);
    }
    await mcpIdentity(w);
    return state;
  }
  async function observeSkillRuntime(request, w, s) {
    const state = await nativeSkillState(w, s, request.sourceName);
    const common = {
      workspaceId: w.id,
      workspacePath: w.path,
      runtimeEpoch: host.epoch,
    };
    if (state.status !== "observed") return { ...common, ...state };
    const { fileText, ...projection } = state;
    const value = { ...common, ...projection, observationId: randomUUID() };
    if (!validSkillRuntimeObservation(value)) fail("SKILL_UNVERIFIED");
    if (skillObservations.size >= 32)
      skillObservations.delete(skillObservations.keys().next().value);
    skillObservations.set(value.observationId, {
      value: globalThis.structuredClone(value),
      fileText,
      workspace: committed.workspaces.get(w.id),
      session: s && committed.sessions.get(s.id),
      nativeSessionId: s?.sdkId,
      sourceName: request.sourceName,
      created: performance.now(),
    });
    return value;
  }
  async function mutateSkillRuntime(request, w, s) {
    if (!registry || !context?.nativeSkills) fail("UNAVAILABLE");
    if (w.lock) fail("BUSY");
    const saved = skillObservations.get(request.observationId);
    const registering = request.type === "configuration.skill.register",
      applying = request.type === "configuration.skill.apply";
    const expected = async () => {
      if (
        !saved ||
        saved.value.runtimeEpoch !== host.epoch ||
        saved.value.workspaceId !== w.id ||
        saved.value.workspacePath !== w.path ||
        saved.workspace !== committed.workspaces.get(w.id) ||
        performance.now() - saved.created > 300000 ||
        (applying &&
          (!s ||
            saved.value.session?.sessionId !== s.id ||
            saved.session !== committed.sessions.get(s.id) ||
            saved.nativeSessionId !== s.sdkId)) ||
        (registering && saved.sourceName !== request.sourceName)
      )
        fail("SKILL_CHANGED");
      const state = await nativeSkillState(
        w,
        applying ? s : undefined,
        registering ? request.sourceName : undefined,
      );
      if (
        state.status !== "observed" ||
        !isDeepStrictEqual(state.owned, saved.value.owned) ||
        !isDeepStrictEqual(state.unowned, saved.value.unowned)
      )
        fail("SKILL_CHANGED");
      if (applying && !isDeepStrictEqual(state.session, saved.value.session))
        fail("SKILL_CHANGED");
      if (
        registering &&
        (!state.file ||
          state.file.status !== "available" ||
          !isDeepStrictEqual(state.file, saved.value.file) ||
          state.fileText !== saved.fileText ||
          state.file.version !== request.version ||
          state.file.directoryVersion !== request.directoryVersion ||
          state.file.digest !== request.digest)
      )
        fail("FILE_CHANGED");
      const target = state.owned.find((row) =>
        registering
          ? row.sourceName === request.sourceName
          : row.nativeId === request.nativeId,
      );
      if (!registering && !target) fail("SKILL_OWNERSHIP_CONFLICT");
      if (
        applying &&
        state.session.messages.some((row) => row.nativeId === request.nativeId)
      )
        fail("SKILL_ALREADY_APPLIED");
      return { state, target };
    };
    w.lock = true;
    try {
      const before = await expected();
      const original = currentScope().record;
      if (!original) fail("UNAVAILABLE");
      const owner = registering
        ? {
            runtimeEpoch: original.runtimeEpoch,
            operationId: original.operationId,
            workspaceId: w.id,
            workspacePath: w.path,
            sourceName: request.sourceName,
            digest: request.digest,
          }
        : undefined;
      const nativeRecord = registering
        ? parseSkillRuntimeRecord(owner, before.state.fileText)
        : undefined;
      const row = registering
        ? {
            sourceName: owner.sourceName,
            nativeId: nativeRecord.id,
            digest: owner.digest,
            nativeDigest: nativeSkillDigest(nativeRecord),
            registrationRuntimeEpoch: owner.runtimeEpoch,
            registrationOperationId: owner.operationId,
            name: nativeRecord.name,
            ...(nativeRecord.description !== undefined && {
              description: nativeRecord.description,
            }),
            autoinvoke: false,
            path: nativeRecord.path,
            content: nativeRecord.content,
            bodyDigest: skillRuntimeDigest(nativeRecord.content),
          }
        : before.target;
      if (
        registering &&
        [...before.state.owned, ...before.state.unowned].some(
          (item) => item.nativeId === row.nativeId,
        )
      )
        fail("SKILL_OWNERSHIP_CONFLICT");
      if (
        registering &&
        !before.target &&
        (before.state.owned.length >= 16 ||
          before.state.owned.length + before.state.unowned.length >= 64)
      )
        fail("LIMIT_REACHED");
      const action = registering ? "register" : applying ? "apply" : "remove";
      if (
        !(await confirmSkillRuntime(
          Object.freeze({
            action,
            workspaceId: w.id,
            workspacePath: w.path,
            ...(applying && { sessionId: s.id, nativeSessionId: s.sdkId }),
            ...row,
            ...(registering && {
              version: request.version,
              directoryVersion: request.directoryVersion,
            }),
          }),
        ))
      )
        fail("CANCELLED");
      checkLive();
      const checked = await expected();
      if (!isDeepStrictEqual(checked, before)) fail("SKILL_CHANGED");
      currentScope().skillRuntimeProof = skillRuntimeDispatchProof(row);
      if (registering) {
        const result = await call(context.nativeSkills.registerDisabled, {
          owner,
          record: nativeRecord,
          recordDigest: row.nativeDigest,
          expectedNativeId: before.target?.nativeId ?? null,
        });
        try {
          validateSkillRpcResult("registerDisabled", result);
        } catch {
          fail("UNKNOWN_OUTCOME");
        }
        if (
          result.status !== "registered_disabled" ||
          !isDeepStrictEqual(result.owner, owner) ||
          !isDeepStrictEqual(result.record, nativeRecord) ||
          result.recordDigest !== row.nativeDigest ||
          result.previousNativeId !== (before.target?.nativeId ?? null)
        )
          fail("UNKNOWN_OUTCOME");
      } else if (applying) {
        await call(client.session.skill, {
          sessionID: s.sdkId,
          id: row.nativeId,
          resume: false,
        });
      } else {
        const registration = {
          runtimeEpoch: row.registrationRuntimeEpoch,
          operationId: row.registrationOperationId,
          workspaceId: w.id,
          workspacePath: w.path,
          sourceName: row.sourceName,
          digest: row.digest,
        };
        const result = await call(context.nativeSkills.removeOwned, {
          owner: {
            ...registration,
            runtimeEpoch: original.runtimeEpoch,
            operationId: original.operationId,
          },
          registration,
          nativeId: row.nativeId,
          recordDigest: row.nativeDigest,
        });
        try {
          validateSkillRpcResult("removeOwned", result);
        } catch {
          fail("UNKNOWN_OUTCOME");
        }
        if (
          result.status !== "removed" ||
          !isDeepStrictEqual(result.registration, registration) ||
          result.nativeId !== row.nativeId ||
          result.recordDigest !== row.nativeDigest
        )
          fail("UNKNOWN_OUTCOME");
      }
      const post = await nativeSkillState(
        w,
        applying ? s : undefined,
        registering ? request.sourceName : undefined,
      );
      if (
        post.status !== "observed" ||
        !isDeepStrictEqual(post.unowned, before.state.unowned)
      )
        fail("UNKNOWN_OUTCOME");
      const except = (rows) =>
        rows.filter((item) => item.sourceName !== row.sourceName);
      if (!isDeepStrictEqual(except(post.owned), except(before.state.owned)))
        fail("UNKNOWN_OUTCOME");
      const after = post.owned.find(
        (item) => item.sourceName === row.sourceName,
      );
      if (registering) {
        if (
          !isDeepStrictEqual(after, row) ||
          !isDeepStrictEqual(post.file, before.state.file) ||
          post.fileText !== before.state.fileText
        )
          fail("UNKNOWN_OUTCOME");
        return {
          requestId: request.requestId,
          status: "registered_disabled",
          ...skillRuntimeIdentity(row),
          version: request.version,
          directoryVersion: request.directoryVersion,
          bodyDigest: row.bodyDigest,
        };
      }
      if (!applying) {
        if (after) fail("UNKNOWN_OUTCOME");
        return {
          requestId: request.requestId,
          status: "removed",
          ...skillRuntimeIdentity(row),
        };
      }
      if (!isDeepStrictEqual(post.owned, before.state.owned))
        fail("UNKNOWN_OUTCOME");
      const prior = before.state.session.messages,
        messages = post.session.messages;
      if (
        prior.some(
          (old) => !messages.some((item) => isDeepStrictEqual(item, old)),
        )
      )
        fail("UNKNOWN_OUTCOME");
      const added = messages.filter(
        (item) => !prior.some((old) => old.messageId === item.messageId),
      );
      if (
        added.length !== 1 ||
        added[0].nativeId !== row.nativeId ||
        added[0].name !== row.name ||
        added[0].bodyDigest !== row.bodyDigest
      )
        fail("UNKNOWN_OUTCOME");
      return {
        requestId: request.requestId,
        status: "applied",
        ...skillRuntimeIdentity(row),
        sessionId: s.id,
        nativeSessionId: s.sdkId,
        nativeMessageId: added[0].messageId,
        bodyDigest: row.bodyDigest,
      };
    } finally {
      w.lock = false;
      skillObservations.delete(request.observationId);
    }
  }
  async function policySync(operation, sender) {
    if (!registry || !policySyncTypes.has(operation.type)) return undefined;
    const drifted = () =>
      host
        .startup(async () => {
          await ready;
          if (!client || runtime.snapshot().state !== "connected") return [];
          const out = [];
          const locked =
            committed.workspaces.get(operation.workspaceId)?.lock ||
            [...committed.sessions.values()].some(
              (item) => item.workspaceId === operation.workspaceId && item.lock,
            );
          for (const target of committed.sessions.values()) {
            // Skip what mode.set would refuse; the in-op policyOk check then
            // fails closed instead of an unrelated op being rejected here.
            if (
              target.workspaceId !== operation.workspaceId ||
              target.unavailable ||
              target.status !== "idle" ||
              target.unknown ||
              target.awaiting
            )
              continue;
            const info = await call(client.session.get, {
              sessionID: target.sdkId,
            });
            if (
              info?.id === target.sdkId &&
              !policyOk(target, info.permissions)
            )
              out.push(target);
          }
          // A lock is held only mid-dispatch: drift then is transient, so retryable BUSY.
          return locked && out.length ? "BUSY" : locked ? [] : out;
        })
        .catch(() => []);
    const targets = await drifted();
    if (targets === "BUSY") return "BUSY";
    for (const target of targets) {
      const result = await host.handle(
        {
          version: 2,
          runtimeEpoch: host.epoch,
          operationId: randomUUID(),
          operation: {
            type: "permission.mode.set",
            workspaceId: target.workspaceId,
            sessionId: target.id,
            mode: modeOf(target),
            requestId: randomUUID(),
          },
        },
        sender,
      );
      if (!result.ok)
        return result.code === "BUSY" ? "BUSY" : "POLICY_UNVERIFIED";
    }
    if (targets.length) {
      const left = await drifted();
      if (left === "BUSY") return "BUSY";
      if (left.length) return "POLICY_UNVERIFIED";
    }
    return undefined;
  }
  async function workspaceIdleIdentity(w, unverifiedCode) {
    if (!registry) fail("UNAVAILABLE");
    storageCheck();
    if (!w.trusted) fail("INVALID_SELECTION");
    await recheck(w);
    const targets = [...tables().sessions.values()].filter(
      (s) => s.workspaceId === w.id,
    );
    for (const target of targets) {
      if (target.lock || target.unavailable) fail("BUSY");
      // Drift is repaired beforehand by a separate journaled mode.set
      // (policySync); writing here would add an unjournaled-shape dispatch.
      const info = await idleIdentity(w, target);
      const correlated = await verifySavedSession(target, new Map(), new Set());
      if (
        !correlated ||
        !policyOk(target, info.permissions) ||
        !policyOk(target, correlated.permissions)
      )
        fail("POLICY_UNVERIFIED");
      const pending = await call(client.permission.list, {
        sessionID: target.sdkId,
      });
      if (!Array.isArray(pending)) fail(unverifiedCode);
      if (pending.length) fail("BUSY");
      await idleIdentity(w, target);
    }
    await recheck(w);
    if (!w.trusted || tables().workspaces.get(w.id) !== w)
      fail("INVALID_SELECTION");
  }
  const mcpIdentity = (w) => workspaceIdleIdentity(w, "MCP_UNVERIFIED");
  async function mcpObservation(w) {
    await mcpIdentity(w);
    const result = await call(client.mcp?.list, {
      location: { directory: w.path },
    });
    const observed = observeMcpCatalog(result, {
      workspaceId: w.id,
      path: w.path,
      runtimeEpoch: host.epoch,
      owned: liveMcp,
    });
    await mcpIdentity(w);
    return observed;
  }
  function liveMcpRegistration(w, nativeName) {
    const value = liveMcp.get(nativeName);
    return value?.workspaceId === w.id &&
      value.path === w.path &&
      value.runtimeEpoch === host.epoch
      ? value
      : undefined;
  }
  async function mutateMcp(request, w) {
    if (!registry) fail("UNAVAILABLE");
    if (w.lock) fail("BUSY");
    const action = request.type.slice("configuration.mcp.".length);
    const nativeName = mcpNativeName(w.id, request.sourceName);
    const registering = action === "register";
    const expected = async () => {
      const observed = await mcpObservation(w);
      if (observed.status !== "observed") fail("MCP_UNVERIFIED");
      if (observed.version !== request.expectedObservationVersion)
        fail("MCP_CHANGED");
      const registration = liveMcpRegistration(w, nativeName);
      const target = observed.servers.find(
        (row) => row.nativeName === nativeName,
      );
      let normalized;
      if (registering) {
        if (target || registration) fail("MCP_OWNERSHIP_CONFLICT");
        if (
          [...liveMcp.values()].filter((row) => row.workspaceId === w.id)
            .length >= 16
        )
          fail("LIMIT_REACHED");
        const file = await readConfigurationFile(w, "mcp", {
          check: checkLive,
        });
        if (
          file.status !== "available" ||
          file.version !== request.fileVersion ||
          file.content !== request.text
        )
          fail("FILE_CHANGED");
        normalized = await normalizeMcpDefinition(
          w.path,
          request.text,
          request.sourceName,
        );
      } else {
        if (!registration || target?.ownership !== "current_runtime")
          fail("MCP_OWNERSHIP_CONFLICT");
        if (target.status === "pending") fail("BUSY");
        if (action !== "remove" && target.status === "absent")
          fail("MCP_CHANGED");
        if (action === "connect" && target.status === "connected") fail("BUSY");
      }
      await mcpIdentity(w);
      if (action === "connect" && registration?.definition.type === "local")
        await validateMcpLocalCwd(w.path, registration.definition.cwd);
      checkLive();
      return { observed, target, registration, normalized };
    };
    w.lock = true;
    try {
      const before = await expected();
      const definition =
        before.normalized?.definition ?? before.registration?.definition;
      const digest = before.normalized?.digest ?? before.registration?.digest;
      const sourceVersion = registering
        ? request.fileVersion
        : before.registration?.sourceVersion;
      if (
        !(await confirmMcp(
          Object.freeze({
            action,
            workspaceId: w.id,
            workspacePath: w.path,
            sourceName: request.sourceName,
            nativeName,
            expectedObservationVersion: request.expectedObservationVersion,
            digest,
            sourceVersion,
            ...(["register", "connect"].includes(action) && { definition }),
          }),
        ))
      )
        fail("CANCELLED");
      checkLive();
      const checked = await expected();
      if (
        registering &&
        !isDeepStrictEqual(checked.normalized, before.normalized)
      )
        fail("FILE_CHANGED");
      const absent = action === "remove" && checked.target?.status === "absent";
      if (!absent)
        await call(client.mcp?.[action === "register" ? "add" : action], {
          server: nativeName,
          location: { directory: w.path },
          ...(registering && { config: checked.normalized.definition }),
        });
      const post = await mcpObservation(w);
      if (post.status !== "observed") fail("UNKNOWN_OUTCOME");
      const others = (rows) =>
        rows.filter((row) => row.nativeName !== nativeName);
      if (
        !isDeepStrictEqual(
          others(before.observed.servers),
          others(post.servers),
        )
      )
        fail("UNKNOWN_OUTCOME");
      const target = post.servers.find((row) => row.nativeName === nativeName);
      const status = target?.status;
      if (
        (registering && status !== "disabled") ||
        (action === "connect" &&
          !["connected", "failed", "needs_auth"].includes(status)) ||
        (action === "disconnect" && status !== "disabled") ||
        (action === "remove" && status !== "absent")
      )
        fail("UNKNOWN_OUTCOME");
      await mcpIdentity(w);
      if (registering) {
        currentScope().mcpChange = {
          nativeName,
          registration: Object.freeze({
            workspaceId: w.id,
            path: w.path,
            runtimeEpoch: host.epoch,
            sourceName: request.sourceName,
            digest,
            sourceVersion,
            definition,
          }),
        };
        return {
          requestId: request.requestId,
          status: "registered_disabled",
          sourceName: request.sourceName,
          nativeName,
          digest,
          sourceVersion,
        };
      }
      if (action === "remove") {
        currentScope().mcpChange = { nativeName };
        return {
          requestId: request.requestId,
          status: "removed",
          sourceName: request.sourceName,
          nativeName,
        };
      }
      return {
        requestId: request.requestId,
        status: "connection_status",
        action,
        sourceName: request.sourceName,
        nativeName,
        connectionStatus: status,
      };
    } finally {
      w.lock = false;
    }
  }
  async function instructionObservation(s, registration) {
    const entries = await call(client?.session?.instructions?.entry?.list, {
      sessionID: s.sdkId,
    });
    // A reconciled fork child's inheritance is verified here, on first use after
    // admission (the same check `session.fork` makes): promote on match, else
    // the session is unavailable. Until then it observes as changed.
    if (
      registration?.state === PENDING &&
      registration === s.instructionRegistration
    ) {
      const verified = verifiedInheritance(registration);
      const observed = observeInstructions(entries, verified);
      if (observed.status === "registered") {
        s.instructionRegistration = verified;
        return observed;
      }
      s.status = "unavailable";
      s.unavailable = true;
      s.unknown = true;
      return { status: "unavailable", reason: "inheritance_mismatch" };
    }
    return observeInstructions(entries, registration);
  }
  // repair: the caller's own journaled shape already includes native.policy
  // (send/fork/...); instruction/MCP ops must not write policy inside the op.
  async function instructionIdentity(
    w,
    s,
    allowPending = false,
    repair = false,
  ) {
    if (!registry) fail("UNAVAILABLE");
    storageCheck();
    if (!w.trusted) fail("INVALID_SELECTION");
    if (s.archived) fail("ARCHIVED_SESSION");
    const identity = async () => {
      if (!allowPending) return idleIdentity(w, s);
      await recheck(w);
      if (
        tables().sessions.get(s.id) !== s ||
        s.workspaceId !== w.id ||
        s.unknown ||
        s.unavailable ||
        s.status === "stopping"
      )
        fail("BUSY");
      const info = await call(client.session.get, { sessionID: s.sdkId });
      if (
        info?.id !== s.sdkId ||
        (await canonicalDirectory(info.location?.directory)) !== w.path
      )
        fail("UNAVAILABLE");
      await recheck(w);
      checkLive();
      return info;
    };
    let info = await identity();
    if (repair && !policyOk(s, info.permissions)) info = await policy(s);
    const correlated = await verifySavedSession(s, new Map(), new Set());
    if (
      !correlated ||
      !policyOk(s, info.permissions) ||
      !policyOk(s, correlated.permissions)
    )
      fail("POLICY_UNVERIFIED");
    const pending = await call(client.permission.list, { sessionID: s.sdkId });
    if (!Array.isArray(pending)) fail("RUNTIME_ERROR");
    if (pending.length) fail("BUSY");
    await identity();
  }
  async function verifyInstructionBaseline(w, s, allowPending = false) {
    // The legacy in-memory test lane has no instruction ownership capability.
    if (!registry) return;
    await instructionIdentity(w, s, allowPending, true);
    const observed = await instructionObservation(s, s.instructionRegistration);
    if (!["missing", "registered"].includes(observed.status))
      fail("INSTRUCTIONS_UNVERIFIED");
    await instructionIdentity(w, s, allowPending, true);
  }
  async function mutateInstructions(request, w, s) {
    if (!registry) fail("UNAVAILABLE");
    if (w.lock || s.lock || s.status !== "idle" || s.unknown) fail("BUSY");
    const apply = request.type === "configuration.instructions.apply";
    const observeExpected = async () => {
      await instructionIdentity(w, s);
      const observed = await instructionObservation(
        s,
        s.instructionRegistration,
      );
      if (observed.status === "unavailable") fail("INSTRUCTIONS_UNVERIFIED");
      if (observed.version !== request.expectedRegistrationVersion)
        fail("INSTRUCTIONS_CHANGED");
      let file;
      if (apply) {
        file = await readConfigurationFile(w, "instructions", {
          check: checkLive,
        });
        if (
          file.status !== "available" ||
          file.version !== request.fileVersion ||
          file.content !== request.text
        )
          fail("FILE_CHANGED");
      }
      await instructionIdentity(w, s);
      return file;
    };
    w.lock = true;
    s.lock = true;
    s.generation++;
    try {
      const file = await observeExpected();
      const digest = apply ? instructionDigest(request.text) : undefined;
      if (
        !(await confirmInstructions(
          Object.freeze({
            action: apply ? "apply" : "remove",
            workspaceId: w.id,
            sessionId: s.id,
            sessionTitle: s.title,
            workspacePath: w.path,
            expectedRegistrationVersion: request.expectedRegistrationVersion,
            ...(apply && {
              targetPath: file.path,
              digest,
              sourceVersion: request.fileVersion,
              empty: request.text.length === 0,
            }),
          }),
        ))
      )
        fail("CANCELLED");
      checkLive();
      await observeExpected();
      const registration = apply
        ? {
            state: "registered",
            key: INSTRUCTION_KEY,
            digest,
            sourceVersion: request.fileVersion,
            origin: "direct",
          }
        : { state: "absent", key: INSTRUCTION_KEY };
      const entry = client?.session?.instructions?.entry;
      await call(apply ? entry?.put : entry?.remove, {
        sessionID: s.sdkId,
        key: INSTRUCTION_KEY,
        ...(apply && { value: request.text }),
      });
      await instructionIdentity(w, s);
      const post = await instructionObservation(s, registration);
      if (post.status !== (apply ? "registered" : "missing"))
        fail("UNKNOWN_OUTCOME");
      await instructionIdentity(w, s);
      s.instructionRegistration = registration;
      return {
        requestId: request.requestId,
        status: apply ? "registered" : "removed",
        ...(apply && { digest, sourceVersion: request.fileVersion }),
      };
    } finally {
      w.lock = false;
      s.lock = false;
      s.generation++;
    }
  }
  async function idleIdentity(w, s) {
    await recheck(w);
    if (tables().sessions.get(s.id) !== s || s.workspaceId !== w.id)
      fail("NOT_FOUND");
    if (s.unknown || s.status !== "idle" || s.awaiting) fail("BUSY");
    const info = await call(client.session.get, { sessionID: s.sdkId });
    const active = await call(client.session.active);
    const inbox = await call(client.session.inbox.list, { sessionID: s.sdkId });
    if (
      info?.id !== s.sdkId ||
      (await canonicalDirectory(info.location?.directory)) !== w.path ||
      !active ||
      typeof active !== "object" ||
      Array.isArray(active) ||
      !Array.isArray(inbox)
    )
      fail("RUNTIME_ERROR");
    await recheck(w);
    if (tables().sessions.get(s.id) !== s) fail("NOT_FOUND");
    if (
      active[s.sdkId] ||
      inbox.length ||
      s.unknown ||
      s.status !== "idle" ||
      s.awaiting
    )
      fail("BUSY");
    return info;
  }
  // Exhaust the installed SDK's cursor contract, including empty intermediate pages.
  async function scanSessions(input, visit, code) {
    const seen = new Set();
    let cursor;
    try {
      for (let page = 0; page < 100; page++) {
        const result = await call(client.session.list, {
          ...input,
          limit: 100,
          ...(cursor && { cursor }),
        });
        if (
          !result ||
          !Array.isArray(result.data) ||
          result.data.length > 100 ||
          !result.cursor ||
          typeof result.cursor !== "object" ||
          Array.isArray(result.cursor) ||
          result.data.some((item) => !opaque(item?.id))
        )
          fail(code);
        const next = result.cursor.next;
        if (
          next !== undefined &&
          next !== null &&
          (typeof next !== "string" ||
            !next.length ||
            next.length > 8192 ||
            [...next].some(
              (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
            ) ||
            seen.has(next))
        )
          fail(code);
        visit(result.data);
        if (next === undefined || next === null) return;
        seen.add(next);
        cursor = next;
      }
      fail(code);
    } catch (error) {
      if (error.appCode === "HAS_DESCENDANTS") throw error;
      fail(code);
    }
  }
  async function noDescendants(s) {
    if (
      [...tables().sessions.values()].some(
        (item) => item.parentSessionId === s.id,
      )
    )
      fail("HAS_DESCENDANTS");
    await scanSessions(
      {},
      (data) => {
        for (const item of data) {
          if (
            (item.parentID != null && !opaque(item.parentID)) ||
            (item.fork != null &&
              (typeof item.fork !== "object" ||
                Array.isArray(item.fork) ||
                !opaque(item.fork.sessionID)))
          )
            fail("DESCENDANTS_UNVERIFIED");
          if (item.parentID === s.sdkId || item.fork?.sessionID === s.sdkId)
            fail("HAS_DESCENDANTS");
        }
      },
      "DESCENDANTS_UNVERIFIED",
    );
  }
  async function verifyRemoved(s) {
    // Only this exact typed SDK error proves absence; generic failures fall back to a complete scan.
    try {
      const info = await call(client.session.get, { sessionID: s.sdkId });
      if (info?.id === s.sdkId) fail("UNKNOWN_OUTCOME");
    } catch (error) {
      if (
        error?._tag === "SessionNotFoundError" &&
        error.sessionID === s.sdkId &&
        typeof error.message === "string"
      )
        return;
      if (error.appCode === "UNKNOWN_OUTCOME") throw error;
    }
    await scanSessions(
      {},
      (data) => {
        if (data.some((item) => item.id === s.sdkId)) fail("UNKNOWN_OUTCOME");
      },
      "UNKNOWN_OUTCOME",
    );
  }
  async function lifecycle(request) {
    const hash = fingerprint(request);
    const receiptKey = currentScope()?.record?.operationId ?? request.requestId;
    const prior = lifecycleReceipts.get(receiptKey);
    if (prior) {
      if (prior.hash !== hash) fail("DUPLICATE_CONFLICT");
      if (!prior.result) fail("BUSY");
      if (!prior.result.ok) return prior.result;
      return {
        ok: true,
        value: safeSnapshot(
          tables().workspaces.get(request.workspaceId),
          tables().sessions.get(prior.selectedSessionId),
        ),
      };
    }
    const w = workspace(request.workspaceId);
    const s = session(w.id, request.sessionId);
    if (lifecycleReceipts.size >= 2048) fail("LIMIT_REACHED");
    const receipt = { hash };
    lifecycleReceipts.set(receiptKey, receipt);
    const started = performance.now();
    let locked = false;
    let dispatched = false;
    let child;
    try {
      if (
        w.lock ||
        s.lock ||
        s.status !== "idle" ||
        s.unknown ||
        s.awaiting ||
        [...tables().sessions.values()].some(
          (item) => item.workspaceId === w.id && item.lock,
        )
      )
        fail("BUSY");
      w.lock = true;
      s.lock = true;
      locked = true;
      s.generation++;
      await idleIdentity(w, s);
      if (request.type === "session.rename") {
        dispatched = true;
        await call(client.session.update, {
          sessionID: s.sdkId,
          title: request.title,
        });
        const updated = await idleIdentity(w, s);
        if (updated.title !== request.title) fail("UNKNOWN_OUTCOME");
        s.title = request.title;
      } else if (request.type === "permission.mode.set") {
        // Takes effect via policy() before the next send; never replies to
        // or approves requests that are already pending.
        await markEffect();
        const previousMode = modeOf(s);
        s.permissionMode = request.mode;
        // Native may now hold the new ruleset on the parent even if
        // propagation/readback fails: report UNKNOWN_OUTCOME and re-apply the
        // recorded previous mode (modes are not totally ordered, so never
        // pick "the narrower").
        dispatched = true;
        try {
          // Write + verify the new ruleset now (also narrows running subagent
          // children); the session is idle, so this cannot race a run.
          await policy(s);
        } catch (error) {
          s.permissionMode = previousMode;
          await policy(s).catch(() => {});
          throw error;
        }
      } else if (request.type === "session.pin") {
        await markEffect();
        s.pinned = request.pinned;
      } else if (request.type === "session.archive") {
        await markEffect();
        s.archived = request.archived;
      } else if (request.type === "session.fork") {
        checkBootstrapTaskAuthority();
        if (s.permissionControl) fail("POLICY_UNVERIFIED");
        if (!w.trusted) fail("INVALID_SELECTION");
        await verifyInstructionBaseline(w, s);
        if (tables().sessions.size >= 200) fail("LIMIT_REACHED");
        if (request.before) {
          const target = await call(client.session.message?.get, {
            sessionID: s.sdkId,
            messageID: request.before,
          });
          if (
            target?.id !== request.before ||
            target.sessionID !== s.sdkId ||
            target.type !== "user"
          )
            fail("INVALID_SELECTION");
          await idleIdentity(w, s);
        }
        if (context?.nativeTasks)
          currentScope().bootstrapParent = await bootstrapParentIdentity(w, s);
        await reserveSession(w, undefined, undefined, undefined, true);
        dispatched = true;
        let forked;
        try {
          forked = await call(client.session.fork, {
            sessionID: s.sdkId,
            ...(request.before && { before: request.before }),
          });
        } catch (error) {
          // Refused before any dispatch flush: nothing happened to the parent.
          if (error?.bootstrapRefused) dispatched = false;
          // Only this typed SDK rejection proves the fork had no effect.
          if (
            error?._tag === "InvalidRequestError" &&
            error.kind === "empty_session"
          ) {
            dispatched = false;
            const record = currentScope()?.record;
            if (record) {
              record.verifiedNone = true;
              record.evidence = [
                { kind: "native-rejected-empty", id: s.sdkId },
              ];
            }
            fail("EMPTY_SESSION");
          }
          throw error;
        }
        if (
          request.before &&
          (forked?.parentID !== s.sdkId ||
            forked?.fork?.sessionID !== s.sdkId ||
            forked?.fork?.boundary?.type !== "before" ||
            forked?.fork?.boundary?.messageID !== request.before)
        )
          fail("UNKNOWN_OUTCOME");
        child = await addSession(w, forked);
        child.parentSessionId = s.id;
        child.archived = true;
        child.unknown = true;
        child.status = "unknown";
        await policy(child, undefined, Boolean(context?.nativeTasks));
        if (request.title)
          await call(client.session.update, {
            sessionID: child.sdkId,
            title: request.title,
          });
        const checked = await call(client.session.get, {
          sessionID: child.sdkId,
        });
        if (
          (request.before &&
            (checked?.parentID !== s.sdkId ||
              checked?.fork?.sessionID !== s.sdkId ||
              checked?.fork?.boundary?.type !== "before" ||
              checked?.fork?.boundary?.messageID !== request.before)) ||
          checked?.id !== child.sdkId ||
          (await canonicalDirectory(checked.location?.directory)) !== w.path ||
          !policyMatches(checked.permissions) ||
          (request.title && checked.title !== request.title)
        )
          fail("UNKNOWN_OUTCOME");
        if (registry) {
          const registration = s.instructionRegistration;
          const inherited =
            registration?.state === "registered"
              ? {
                  ...registration,
                  origin: "fork",
                  inheritedFromSessionId: s.id,
                }
              : registration;
          const observed = await instructionObservation(child, inherited);
          if (
            observed.status !==
            (registration?.state === "registered" ? "registered" : "missing")
          )
            fail("UNKNOWN_OUTCOME");
          await verifyInstructionBaseline(w, s);
          child.instructionRegistration = inherited;
        }
        await idleIdentity(w, s);
        await settleBootstrap();
        child.title = clip(checked.title, 256) || child.title;
        child.archived = false;
        child.unknown = false;
        child.status = "idle";
      } else if (request.type === "session.remove") {
        await noDescendants(s);
        const info = await idleIdentity(w, s);
        if (!registry) await markEffect();
        if (
          !(await confirmSessionRemoval({
            title: clip(info.title, 256) || s.title,
            workspaceName: w.name,
            path: w.path,
          }))
        )
          fail("CANCELLED");
        await idleIdentity(w, s);
        await noDescendants(s);
        await idleIdentity(w, s);
        dispatched = true;
        await call(client.session.remove, { sessionID: s.sdkId });
        await verifyRemoved(s);
        tables().sessions.delete(s.id);
      }
      const selected =
        child ??
        (tables().sessions.has(s.id) && !s.archived ? s : successor(w));
      defaultWorkspace = w.id;
      defaultSession = selected?.id;
      receipt.selectedSessionId = selected?.id;
      receipt.result = { ok: true, value: safeSnapshot(w, selected) };
    } catch (error) {
      if (dispatched) {
        s.unknown = true;
        s.status = "unknown";
        if (child) {
          child.unknown = true;
          child.status = "unknown";
          child.archived = true;
        }
        receipt.result = failure("UNKNOWN_OUTCOME");
      } else
        receipt.result = failure(
          Object.hasOwn(ERRORS, error.appCode)
            ? error.appCode
            : "RUNTIME_ERROR",
        );
    } finally {
      if (locked) {
        w.lock = false;
        s.lock = false;
        s.generation++;
      }
      // Keep only the outcome, never a stale snapshot containing conversation text.
      const result = receipt.result;
      observe(request, result, started, { workspaceId: w.id, sessionId: s.id });
      if (result.ok) receipt.result = { ok: true };
    }
    return receipt.result.ok
      ? {
          ok: true,
          value: safeSnapshot(
            w,
            tables().sessions.get(receipt.selectedSessionId),
          ),
        }
      : receipt.result;
  }
  const fileSearches = new Map();
  async function execute(request) {
    if (
      request.type === "snapshot" &&
      registryInput !== undefined &&
      (initializing ||
        localRecovery ||
        registry?.status().state === "recovery_required")
    ) {
      await registryLoaded;
      const w = request.workspaceId
        ? workspace(request.workspaceId)
        : committed.workspaces.get(defaultWorkspace);
      const s = request.sessionId
        ? session(request.workspaceId, request.sessionId)
        : committed.sessions.get(defaultSession);
      return base(w, s);
    }
    if (request.type !== "diagnostics.list")
      await waitForReady(ready, currentScope().signal);
    checkLive();
    if (
      request.type !== "snapshot" &&
      request.type !== "diagnostics.list" &&
      registry
    ) {
      storageCheck();
      if (
        recoveryDTO().resources.some(
          (r) =>
            r.workspaceId === request.workspaceId &&
            (r.reason !== "unresolved_operation" ||
              !mutationTypes.has(request.type)),
        )
      )
        fail("UNAVAILABLE");
    }
    if (lifecycleTypes.has(request.type)) return lifecycle(request);
    const w = request.workspaceId ? workspace(request.workspaceId) : undefined;
    const s = request.sessionId
      ? session(request.workspaceId, request.sessionId)
      : undefined;
    if (
      [
        "git.review.read",
        "git.diff.read",
        "git.index.preview.read",
        "git.commit.preview.read",
        "git.branch.preview.read",
        "git.restore.preview.read",
      ].includes(request.type)
    )
      return observeGit(request, w);
    if (request.type === "context.observe") return observeContext(request, w);
    if (request.type === "permission.policy.read")
      return observePermissionPolicy(w, s);
    if (request.type === "session.inbox") return observeInbox(w, s);
    if (request.type === "session.inbox.cancel")
      return cancelInbox(request, w, s);
    if (request.type === "file.edit.read")
      return observeWorkspaceFile(request, w);
    if (["git.branch.apply", "git.restore.apply"].includes(request.type))
      return applyGitBranchRestore(request, w);
    if (request.type === "git.index.apply") return applyGitIndex(request, w);
    if (request.type === "git.commit.apply") return applyGitCommit(request, w);
    if (request.type === "file.save") return saveWorkspaceFile(request, w);
    if (request.type === "configuration.extensions.read")
      return observeExtensions(w);
    if (request.type === "configuration.agent.runtime.read")
      return observeAgentRuntime(request, w);
    if (agentRuntimeStep(request.type)) return mutateAgentRuntime(request, w);
    if (request.type === "configuration.skill.runtime.read")
      return observeSkillRuntime(request, w, s);
    if (skillRuntimeStep(request.type))
      return mutateSkillRuntime(request, w, s);
    if (request.type === "configuration.mcp.read") {
      if (w.lock) fail("BUSY");
      return mcpObservation(w);
    }
    if (mcpStep(request.type)) return mutateMcp(request, w);
    if (request.type === "configuration.instructions.read") {
      if (!registry) fail("UNAVAILABLE");
      if (w.lock || s.lock) fail("BUSY");
      await instructionIdentity(w, s);
      const observed = await instructionObservation(
        s,
        s.instructionRegistration,
      );
      await instructionIdentity(w, s);
      return { workspaceId: w.id, sessionId: s.id, ...observed };
    }
    if (
      [
        "configuration.instructions.apply",
        "configuration.instructions.remove",
      ].includes(request.type)
    )
      return mutateInstructions(request, w, s);
    if (request.type === "diagnostics.list")
      return {
        ...diagnostics,
        events: diagnostics.events
          .filter(
            (event) =>
              (!w || event.workspaceId === w.id) &&
              (!s || event.sessionId === s.id),
          )
          .map((event) => ({ ...event })),
      };
    if (request.type === "snapshot") {
      await refreshWorkspaceMeta();
      const selectedW = w ?? tables().workspaces.get(defaultWorkspace);
      const selectedS =
        s ??
        (w
          ? [...tables().sessions.values()].find(
              (item) => item.workspaceId === w.id && !item.archived,
            )
          : tables().sessions.get(defaultSession));
      const projection =
        selectedS &&
        !selectedS.unavailable &&
        !recoveryDTO().resources.some(
          (r) => r.workspaceId === selectedS.workspaceId,
        )
          ? await refresh(selectedS)
          : undefined;
      return base(selectedW, selectedS, projection);
    }
    if (
      request.type === "workspace.import" ||
      request.type === "workspace.create"
    ) {
      if (
        request.type === "workspace.create" &&
        tables().workspaces.size >= 100
      )
        fail("LIMIT_REACHED");
      if (request.name?.trim() && !portableName(request.name))
        fail("INVALID_REQUEST");
      if (registry && request.type === "workspace.create") {
        const reservation = await reserveSession(
          undefined,
          "managed",
          undefined,
          request.name,
        );
        await registry.materializeManaged(operationKey(currentScope().record));
        currentScope().effectStarted = true;
        const created = addWorkspace(
          reservation.workspace.canonicalPath,
          false,
          false,
          reservation,
        );
        return base(created);
      }
      if (!registry) await markEffect();
      // A typed path takes the same canonicalization, limit and native trust path as a picked one.
      if (
        request.path !== undefined &&
        (request.type !== "workspace.import" ||
          !isAbsolute(request.path) ||
          request.path.length === 0)
      )
        fail("INVALID_REQUEST");
      const picked = request.path ?? (await pickDirectory());
      checkLive();
      if (!picked) fail("CANCELLED");
      if (!registry) await markEffect();
      const path =
        request.type === "workspace.create"
          ? await createFolder(picked, request.name)
          : await canonicalDirectory(picked);
      if (
        tables().workspaces.size >= 100 &&
        ![...tables().workspaces.values()].some(
          (existing) => existing.path === path,
        )
      )
        fail("LIMIT_REACHED");
      // Both ordinary new directories and imports require native trust before SDK activation.
      const reservation = registry
        ? await reserveSession(undefined, "imported", path)
        : undefined;
      if (registry) await markEffect();
      const added = addWorkspace(path, false, false, reservation);
      await refreshWorkspaceMeta();
      return base(added);
    }
    if (request.type === "workspace.remove") {
      // Do not discard the sole live authority while its Native registration
      // may still supply tools or own a transport. Explicit MCP removal comes first.
      if (context?.nativeAgents && w.trusted) {
        const state = await nativeAgentState(w);
        if (state.status !== "observed" || state.owned.length) fail("BUSY");
      }
      if (context?.nativeSkills && w.trusted) {
        const state = await nativeSkillState(w);
        if (state.status !== "observed" || state.owned.length) fail("BUSY");
      }
      if (
        [...liveMcp.values()].some(
          (registration) => registration.workspaceId === w.id,
        ) ||
        w.lock ||
        [...tables().sessions.values()].some(
          (item) =>
            item.workspaceId === w.id &&
            (item.lock || item.status !== "idle" || item.unknown),
        )
      )
        fail("BUSY");
      await markEffect("registry.unregister");
      const record = currentScope()?.record;
      if (record)
        record.removedSessionIds = [...tables().sessions.values()]
          .filter((item) => item.workspaceId === w.id)
          .map((item) => item.id);
      for (const item of tables().sessions.values())
        if (item.workspaceId === w.id) {
          tables().sessions.delete(item.id);
          item.generation++;
        }
      tables().workspaces.delete(w.id);
      return base();
    }
    if (request.type === "session.create") {
      checkBootstrapTaskAuthority();
      if (w.lock) fail("BUSY");
      if (tables().sessions.size >= 200) fail("LIMIT_REACHED");
      w.lock = true;
      try {
        await reserveSession(w);
        await recheck(w);
        if (!w.trusted) {
          if (!registry) await markEffect();
          if (!(await confirmTrust(w.path))) fail("CANCELLED");
          await recheck(w);
          if (!registry) await markEffect();
          w.trusted = true;
          w.trustRevision++;
        }
        if (registry)
          await refuseRecordedSession(
            currentScope().reservation.plannedNativeSessionId,
          );
        const info = await call(client.session.create, {
          ...(registry && {
            id: currentScope().reservation.plannedNativeSessionId,
            metadata: currentScope().nativeMetadata,
          }),
          title: request.title || "Untitled session",
          location: { directory: w.path },
          permissions: BASELINE_POLICY.map((rule) => ({ ...rule })),
        });
        const checked = registry
          ? await call(client.session.get, { sessionID: info.id })
          : info;
        const created = await addSession(w, checked);
        await policy(created, undefined, Boolean(context?.nativeTasks));
        await settleBootstrap();
        return base(w, created);
      } finally {
        w.lock = false;
      }
    }
    if (
      [
        "configuration.skill.list",
        "configuration.skill.read",
        "configuration.agent.list",
        "configuration.agent.read",
      ].includes(request.type)
    ) {
      if (!w.trusted) fail("INVALID_SELECTION");
      if (w.lock) fail("BUSY");
      await recheck(w);
      const result =
        request.type === "configuration.agent.list"
          ? await listAgentFiles(w, { check: checkLive })
          : request.type === "configuration.agent.read"
            ? await readAgentFile(w, request.sourceName, { check: checkLive })
            : request.type === "configuration.skill.list"
              ? await listSkillFiles(w, { check: checkLive })
              : await readSkillFile(w, request.sourceName, {
                  check: checkLive,
                });
      await recheck(w);
      return result;
    }
    if (
      [
        "configuration.save",
        "configuration.skill.save",
        "configuration.agent.save",
      ].includes(request.type)
    ) {
      const agent = request.type === "configuration.agent.save";
      const skill = request.type === "configuration.skill.save" || agent;
      const readSourceFile = agent ? readAgentFile : readSkillFile;
      const kind = agent ? "agent" : skill ? "skill" : request.kind;
      if (skill && !w.trusted) fail("INVALID_SELECTION");
      const adapter = context?.configurationSave;
      if (
        !registry ||
        !adapter ||
        !["prepare", "publish", "abort"].every(
          (name) => typeof adapter[name] === "function",
        )
      )
        fail("UNAVAILABLE");
      if (w.lock) fail("BUSY");
      const record = currentScope().record;
      const key = operationKey(record);
      const expectedBackup =
        request.expectation === "version"
          ? configurationBackupId(key.runtimeEpoch, key.operationId, kind)
          : undefined;
      const observeExpected = async () => {
        await recheck(w);
        const observed = skill
          ? await readSourceFile(w, request.sourceName, { check: checkLive })
          : await readConfigurationFile(w, kind, { check: checkLive });
        await recheck(w);
        if (observed.status === "unsupported") fail("FILE_UNSUPPORTED");
        if (observed.status === "unavailable") fail("FILE_DENIED");
        if (skill && observed.directoryVersion !== request.directoryVersion)
          fail("FILE_CHANGED");
        if (
          request.expectation === "version"
            ? observed.status !== "available" ||
              observed.version !== request.version
            : observed.status !== "missing"
        )
          fail("FILE_CHANGED");
        return observed;
      };
      let token;
      w.lock = true;
      try {
        const observed = await observeExpected();
        if (
          !(await confirmConfigurationSave(
            Object.freeze({
              workspaceId: w.id,
              kind,
              ...(skill && {
                sourceName: request.sourceName,
                directoryVersion: request.directoryVersion,
              }),
              targetPath: observed.path,
              expectation: request.expectation,
              text: request.text,
              textDigest: createHash("sha256")
                .update(request.text)
                .digest("hex"),
              ...(expectedBackup && { backupId: expectedBackup }),
            }),
          ))
        )
          fail("CANCELLED");
        checkLive();
        await observeExpected();
        await markEffect("filesystem.configuration.stage");
        checkLive();
        const staged = await adapter.prepare({
          ...key,
          workspaceId: w.id,
          workspacePath: w.path,
          kind,
          ...(skill && {
            sourceName: request.sourceName,
            directoryVersion: request.directoryVersion,
          }),
          text: request.text,
          expectation: request.expectation,
          ...(request.version && { version: request.version }),
        });
        checkLive();
        if (
          staged?.status !== "staged" ||
          typeof staged.token !== "string" ||
          !/^[a-f0-9]{64}$/.test(staged.token)
        )
          return { requestId: request.requestId, status: "unknown" };
        token = staged.token;
        await recheck(w);
        await markEffect("filesystem.configuration.publish");
        checkLive();
        const saved = await adapter.publish({ token });
        token = undefined; // Publication consumes/settles the kernel token.
        checkLive();
        if (
          saved?.status !== "saved" ||
          saved.backupId !== expectedBackup ||
          typeof saved.version !== "string" ||
          !/^[a-f0-9]{64}$/.test(saved.version)
        )
          return { requestId: request.requestId, status: "unknown" };
        await recheck(w);
        const final = skill
          ? await readSourceFile(w, request.sourceName, { check: checkLive })
          : await readConfigurationFile(w, kind, { check: checkLive });
        await recheck(w);
        if (
          final.status !== "available" ||
          final.content !== request.text ||
          final.version !== saved.version ||
          (skill && final.directoryVersion !== request.directoryVersion)
        )
          return { requestId: request.requestId, status: "unknown" };
        return {
          requestId: request.requestId,
          status: "saved",
          version: final.version,
          ...(expectedBackup && { backupId: expectedBackup }),
        };
      } finally {
        // An expired caller never cancels cleanup or a previously dispatched effect.
        if (token) {
          try {
            await adapter.abort({ token });
          } catch {
            /* Existing original key holds uncertainty. */
          }
        }
        w.lock = false;
      }
    }
    if (request.type === "configuration.read") {
      await recheck(w);
      const result = await readConfigurationFile(w, request.kind, {
        check: checkLive,
      });
      await recheck(w);
      return result;
    }
    if (request.type === "catalog.list") return (await catalog(w, true)).dto;
    if (request.type === "file.search") {
      await recheck(w);
      // A newer search for the same workspace cancels the previous one.
      fileSearches.get(w.id)?.abort();
      const search = new AbortController();
      fileSearches.set(w.id, search);
      try {
        return await searchFiles(w.path, request, search.signal);
      } catch (error) {
        fail(error.appCode ?? "FILE_DENIED");
      } finally {
        if (fileSearches.get(w.id) === search) fileSearches.delete(w.id);
      }
    }
    if (request.type === "file.list" || request.type === "file.read") {
      await recheck(w);
      try {
        return request.type === "file.list"
          ? await listFiles(w.path, request.path)
          : await readFilePreview(w.path, request.path);
      } catch (error) {
        fail(error.appCode ?? "FILE_DENIED");
      }
    }
    if (request.type === "message.send" || request.type === "command.run")
      return send(request, w, s);
    if (request.type === "session.interrupt") {
      if (w.lock || s.lock) fail("BUSY");
      w.lock = true;
      s.lock = true;
      s.generation++;
      try {
        const acknowledgement = await call(client.session.interrupt, {
          sessionID: s.sdkId,
        });
        if (acknowledgement?.interrupted !== true) fail("UNKNOWN_OUTCOME");
        s.status = "stopping";
        return { status: "stopping" };
      } catch {
        s.unknown = true;
        s.status = "unknown";
        return { status: "unknown" };
      } finally {
        w.lock = false;
        s.lock = false;
        s.generation++;
      }
    }
    if (request.type === "permission.respond") {
      if (nativeProjections.get(s.id)?.permissionsUnavailable)
        fail("UNAVAILABLE");
      if (w.lock || s.lock) fail("BUSY");
      w.lock = true;
      s.lock = true;
      s.generation++;
      try {
        // The request may belong to a Native subagent child of this session.
        let ownerId = s.sdkId;
        let pending = await call(client.permission.list, {
          sessionID: s.sdkId,
        });
        if (
          Array.isArray(pending) &&
          !pending.some(
            (p) => p.id === request.requestId && p.sessionID === s.sdkId,
          )
        )
          for (const child of await nativeDescendants(
            s.sdkId,
            "RUNTIME_ERROR",
          )) {
            const list = await call(client.permission.list, {
              sessionID: child.id,
            });
            if (
              Array.isArray(list) &&
              list.some(
                (p) => p.id === request.requestId && p.sessionID === child.id,
              )
            ) {
              ownerId = child.id;
              pending = list;
              break;
            }
          }
        if (
          !Array.isArray(pending) ||
          s.invalidPermissions.has(request.requestId) ||
          !pending.some(
            (p) => p.id === request.requestId && p.sessionID === ownerId,
          )
        )
          fail("STALE_PERMISSION");
        if (s.invalidPermissions.size + pending.length > 2048)
          fail("LIMIT_REACHED");
        await markEffect();
        for (const p of pending)
          if (
            p.sessionID === ownerId &&
            (request.decision === "reject" || p.id === request.requestId)
          )
            s.invalidPermissions.add(p.id);
        s.permissions = [];
        try {
          await call(client.permission.reply, {
            sessionID: ownerId,
            requestID: request.requestId,
            decision: request.decision,
          });
          return { requestId: request.requestId, status: "decided" };
        } catch {
          s.unknown = true;
          s.status = "unknown";
          return { requestId: request.requestId, status: "unknown" };
        }
      } finally {
        w.lock = false;
        s.lock = false;
        s.generation++;
      }
    }
    fail("INVALID_REQUEST");
  }
  async function handleRequest(value) {
    let request;
    let owned;
    let result;
    const started = performance.now();
    try {
      request = validateRequest(value);
      if (request.type !== "snapshot" && request.type !== "diagnostics.list")
        await waitForReady(ready, currentScope().signal);
      if (mutationTypes.has(request.type)) {
        storageCheck();
        if (currentScope().kind !== "trusted")
          currentScope().candidate = cloneTables();
        if (request.workspaceId)
          resourceGenerations.set(
            request.workspaceId,
            (resourceGenerations.get(request.workspaceId) ?? 0) + 1,
          );
      }
      checkLive();
      const w = tables().workspaces.get(request.workspaceId);
      const s = tables().sessions.get(request.sessionId);
      if (
        (!request.workspaceId || w) &&
        (!request.sessionId || (s && s.workspaceId === w?.id))
      )
        owned = {
          ...(w && { workspaceId: w.id }),
          ...(s && { sessionId: s.id }),
        };
      const executed = await execute(request);
      result =
        lifecycleTypes.has(request.type) ||
        request.type === "message.send" ||
        request.type === "command.run"
          ? executed
          : { ok: true, value: executed };
    } catch (error) {
      result = failure(
        Object.hasOwn(ERRORS, error.appCode) ? error.appCode : "RUNTIME_ERROR",
      );
    }
    if (
      owned &&
      mutationTypes.has(request?.type) &&
      !lifecycleTypes.has(request.type) &&
      result.value?.status !== "duplicate"
    )
      observe(request, result, started, owned);
    return result;
  }
  return {
    handle(value, sender) {
      if (
        trustedTestAdapter &&
        sender === undefined &&
        registryInput !== undefined
      )
        return Promise.resolve(failure("INVALID_REQUEST"));
      if (trustedTestAdapter && sender === undefined)
        return host.trusted(async () => {
          const result = await handleRequest(value);
          if (currentScope().candidate) {
            committed = currentScope().candidate;
            currentScope().candidate = undefined;
          }
          return result;
        });
      return host.handle(value, sender);
    },
    async drain() {
      await host.drain();
      await gitReaderClosing;
      await contextIO.close();
    },
    cancelRead: (value, sender) => host.cancel(value, sender),
    // Terminal authority: only a trusted, currently registered workspace root.
    terminalRoot(id) {
      const w = committed.workspaces.get(id);
      return w?.trusted ? w.path : undefined;
    },
    // Physical-delete authority: registered workspace path and how it was created.
    workspaceInfo(id) {
      const w = committed.workspaces.get(id);
      return w && { path: w.path, ownership: w.ownership ?? "imported" };
    },
    closeSender(sender) {
      contextIO.closeSender(sender);
      gitReader?.closeSender(sender);
      gitIndexManager?.closeSender(sender);
      gitCommitManager?.closeSender(sender);
      gitBranchRestoreManager?.closeSender(sender);
      host.closeSender(sender);
    },
    close() {
      contextIO.close();
      closeGitReader();
      liveMcp.clear();
      skillObservations.clear();
      agentObservations.clear();
      controller.abort();
      host.close();
    },
  };
}
