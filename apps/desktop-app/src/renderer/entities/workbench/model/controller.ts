import {
  validatePermissionPolicyObservation,
  type WorkbenchPermissionPolicyObservation,
} from "../../../shared/api/index.js";
import {
  canObservePermissionPolicy,
  currentPermissionPolicyScope,
  type PermissionPolicyIdentity,
  type PermissionPolicy,
} from "./store.js";
import {
  validContextSelection,
  type ContextSelection,
  type ContextObservation,
  type InboxObservation,
} from "../../../shared/api/index.js";
import {
  contextEffectsReady,
  contextRequestReady,
  revertRequestReady,
  selectedContextDraft,
  validContextBranchSnapshot,
  type ContextReadIdentity,
} from "./store.js";
function freezeContextBody<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeContextBody(child);
    Object.freeze(value);
  }
  return value;
}
import {
  GIT_BRANCH_RESTORE_TARGET_FIELDS,
  GIT_BRANCH_RESTORE_LIMITS,
  gitBranchRestoreTargetFromApply,
  gitBranchRestoreBackupRoles,
  validateGitBranchRestoreMutationResult,
  validateGitBranchRestoreReceiptResult,
  type GitBranchPreviewRequest,
  type GitRestorePreviewRequest,
  type GitBranchApplyRequest,
  type GitRestoreApplyRequest,
  type GitBranchRestoreBackup,
} from "../../../shared/api/index.js";
import {
  canPreviewGitBranchRestore,
  canApplyGitBranchRestore,
  currentGitBranchRestoreScope,
  currentGitBranchRestorePreview,
  gitBranchRestoreDispatchReady,
  gitRestoreDraftPaths,
  selectedGitBranchRestoreDraftKey,
  selectedGitBranchRestoreDraft,
  type GitBranchRestoreDraft,
  type GitBranchRestoreIdentity,
  type GitBranchRestoreMutationIdentity,
} from "./store.js";
import {
  GIT_COMMIT_TARGET_FIELDS,
  GIT_COMMIT_LIMITS,
  gitCommitTargetFromApply,
  validateGitCommitMutationResult,
  validateGitCommitReceiptResult,
  type GitCommitPreviewRequest,
  type GitCommitApplyRequest,
  type GitCommitBackup,
} from "../../../shared/api/index.js";
import {
  canPreviewGitCommit,
  canApplyGitCommit,
  currentGitCommitScope,
  currentGitCommitPreview,
  gitCommitDispatchReady,
  selectedGitCommitDraftKey,
  type GitCommitDraft,
  type GitCommitIdentity,
  type GitCommitMutationIdentity,
} from "./store.js";
import {
  gitIndexTargetFromApply,
  validateGitIndexMutationResult,
  validateGitIndexReceiptResult,
  type GitIndexAction,
  type GitIndexPreviewRequest,
  type GitIndexApplyRequest,
} from "../../../shared/api/index.js";
import {
  canPreviewGitIndex,
  canApplyGitIndex,
  currentGitIndexScope,
  currentGitIndexPreview,
  gitIndexDispatchReady,
  type GitIndexIdentity,
  type GitIndexMutationIdentity,
  type Intent,
} from "./store.js";
/* eslint-disable no-unused-vars -- Type parameter names describe callbacks; TypeScript unused checks remain enabled. */
import type {
  WorkbenchExtensionsObservation,
  WorkbenchSnapshot,
  WorkbenchCatalog,
  OperationLookup,
  WorkbenchDiagnostics,
  WorkbenchFileList,
  WorkbenchFileRead,
  WorkbenchFileSearch,
  WorkbenchResult,
  WorkbenchConfigurationFile,
  WorkbenchSkillFiles,
  WorkbenchAgentFiles,
  WorkbenchSkillFile,
  WorkbenchAgentFile,
  WorkbenchSkillRuntimeObservation,
  WorkbenchAgentRuntimeObservation,
  WorkbenchSkillRuntimeMutation,
  WorkbenchAgentRuntimeMutation,
  RedactedReceipt,
  WorkbenchConfigurationSave,
  WorkbenchMcpObservation,
  WorkbenchMcpMutation,
  WorkbenchInstructionObservation,
  WorkbenchInstructionMutation,
} from "../../../shared/api/index.js";
import {
  validateExtensionsObservation,
  validSkillRuntimeObservation,
  validAgentRuntimeObservation,
  validSkillRuntimeMutation,
  validAgentRuntimeMutation,
  skillRuntimeIdPayload,
  agentRuntimeIdPayload,
  skillRuntimeStep,
  agentRuntimeStep,
} from "../../../shared/api/index.js";
import {
  createTransport,
  type Bridge,
  type Clock,
  type MutationRequest,
  type ReadRequest,
} from "../../../shared/transport/index.js";
import { selectionKey } from "../../../shared/projection/index.js";
import { loadDefaultModel } from "../../../shared/providers/index.js";
import {
  parseAgentFile,
  BASELINE_POLICY,
  skillDraftKey,
  agentDraftKey,
  configurationDraftKey,
  emptyConfigurationDraft,
  type ConfigurationDraft,
  type ConfigurationDraftKind,
  type ConfigurationLoadIdentity,
} from "../../../shared/configuration-draft/index.js";
import {
  canObserveExtensions,
  currentExtensionScope,
  type ExtensionIdentity,
  type ExtensionError,
  canReadSkillFiles,
  canReadWorkspaceFile,
  canSaveWorkspaceFile,
  currentWorkspaceFileScope,
  workspaceFileDispatchReady,
  type WorkspaceFileIdentity,
  type WorkspaceFileSaveIdentity,
  canReadAgentFiles,
  canSaveSkillFile,
  canSaveAgentFile,
  currentSkillScope,
  currentAgentScope,
  type SkillIdentity,
  type AgentIdentity,
  type SkillSaveIdentity,
  type AgentSaveIdentity,
  canObserveSkillRuntime,
  canObserveAgentRuntime,
  canRegisterSkill,
  canRegisterAgent,
  canRemoveSkill,
  canRemoveAgent,
  canApplySkill,
  currentSkillRuntimeScope,
  currentAgentRuntimeScope,
  currentSkillRuntimeObservation,
  currentAgentRuntimeObservation,
  type SkillRuntimeIdentity,
  type AgentRuntimeIdentity,
  type SkillRuntimeMutationIdentity,
  type AgentRuntimeMutationIdentity,
  type SkillRuntimeRequest,
  type AgentRuntimeRequest,
  createWorkbenchStore,
  emptyDraft,
  scopeOf,
  selectors,
  operationKey,
  mutationDisabled,
  requestOptionsInvalid,
  currentRuntimeRequestScope,
  canSaveConfigurationDraft,
  canObserveMcp,
  canRegisterMcp,
  canConnectMcp,
  canDisconnectMcp,
  canRemoveMcp,
  sameMcpDraft,
  type McpIdentity,
  type McpMutationIdentity,
  type McpRequest,
  canObserveInstructions,
  canApplyInstructions,
  canRemoveInstructions,
  type InstructionIdentity,
  type InstructionMutationIdentity,
  type LineFeedbackEdit,
  type Scope,
  type Panel,
  type DiagnosticsIdentity,
} from "./store.js";

import {
  validateWorkspaceFileSave,
  validWorkspaceFilePath,
  type WorkbenchFileObservation,
  type WorkbenchFileSave,
} from "../../../shared/workspace-file/index.js";

import {
  type GitReviewIdentity,
  type GitDiffIdentity,
  currentGitReviewScope,
  currentGitDiffScope,
  canObserveGitReview,
  canReadGitDiff,
  currentGitReviewObservation,
  gitReviewHeld,
  unknownOperationHeld,
} from "./store.js";
import type {
  GitDiffMode,
  GitDiffRequest,
} from "../../../shared/git-review/index.js";

const plainData = (value: unknown) =>
  Boolean(
    value &&
      typeof value === "object" &&
      Object.getPrototypeOf(value) === Object.prototype &&
      Reflect.ownKeys(value).every(
        (key) =>
          typeof key === "string" &&
          Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value"),
      ),
  );

export function createWindowWorkbench(
  bridge: Bridge,
  {
    wide = true,
    timeoutMs = 10000,
    clock = globalThis,
    id = () => crypto.randomUUID(),
    visible = () => true,
    onVisibility = (_listener: () => void) => () => {},
    onRefocus = (_listener: () => void) => () => {},
  }: {
    wide?: boolean;
    timeoutMs?: number;
    clock?: Clock;
    id?: () => string;
    visible?: () => boolean;
    onVisibility?: (_listener: () => void) => () => void;
    onRefocus?: (_listener: () => void) => () => void;
  } = {},
) {
  const store = createWorkbenchStore(wide),
    transport = createTransport(
      {
        ...bridge,
        async workbench(envelope) {
          const type = envelope.operation.type;
          const conversationDispatchCurrent = () => {
            const state = store.getState();
            if (type === "context.observe" || type === "session.inbox") {
              const f = contextFlight;
              const view = {
                ...state,
                configurationIO: {
                  ...state.configurationIO,
                  reads: Math.max(
                    0,
                    state.configurationIO.reads - (contextIOActive ? 1 : 0),
                  ),
                },
                conversationContext: {
                  ...state.conversationContext,
                  request: undefined,
                  inboxRequest: undefined,
                },
              };
              return Boolean(
                !disposed &&
                  f &&
                  !f.abort.signal.aborted &&
                  f.operation === envelope.operation &&
                  currentRuntimeRequestScope(state, f.identity.scope) &&
                  contextEffectsReady(view) &&
                  (f.inbox
                    ? state.conversationContext.inboxRequest
                    : state.conversationContext.request) === f.identity,
              );
            }
            if (!("operationId" in envelope)) return true;
            const intent =
              state.operations[
                operationKey(envelope.runtimeEpoch!, envelope.operationId!)
              ];
            if (!intent?.conversation)
              return !(
                type === "session.inbox.cancel" ||
                (envelope.operation.type === "session.fork" &&
                  Object.hasOwn(envelope.operation, "before")) ||
                (envelope.operation.type === "message.send" &&
                  (Object.hasOwn(envelope.operation, "attachments") ||
                    Object.hasOwn(envelope.operation, "delivery")))
              );
            const operations = { ...state.operations };
            delete operations[operationKey(intent.epoch, intent.id)];
            const view = { ...state, operations };
            return (
              !disposed &&
              !intent.lookupOnly &&
              intent.status === "pending" &&
              intent.operation === envelope.operation &&
              envelope.expectedRevision ===
                intent.conversation.scope.revision &&
              currentRuntimeRequestScope(state, intent.conversation.scope) &&
              contextRequestReady(view, intent.operation)
            );
          };
          if (!conversationDispatchCurrent())
            return { ok: false, code: "CANCELLED", message: "CANCELLED" };
          if (type === "message.send" && "operationId" in envelope) {
            const state = store.getState();
            const intent =
              store.getState().operations[
                operationKey(envelope.runtimeEpoch!, envelope.operationId!)
              ];
            if (
              !intent?.runtimeScope ||
              !currentRuntimeRequestScope(state, intent.runtimeScope) ||
              mutationDisabled(state, envelope.operation) ||
              state.connection !== "connected"
            )
              return {
                ok: false,
                code: "STALE_REVISION",
                message: "STALE_REVISION",
              };
            if (requestOptionsInvalid(state, envelope.operation))
              return {
                ok: false,
                code: "INVALID_REQUEST",
                message: "INVALID_REQUEST",
              };
          }
          // Recheck immediately before the real bridge call, including reentrant
          // admission subscribers. A cancelled queued read must not perform IO.
          const fileDispatchCurrent = () => {
            const state = store.getState();
            if (type === "git.review.read" || type === "git.diff.read") {
              const flight =
                type === "git.review.read" ? gitReviewFlight : gitDiffFlight;
              return (
                !disposed &&
                Boolean(
                  flight &&
                    !flight.abort.signal.aborted &&
                    flight.operation === envelope.operation &&
                    !gitReviewHeld(state) &&
                    state.connection === "connected" &&
                    (type === "git.review.read"
                      ? currentGitReviewScope(state, flight.identity) &&
                        state.gitReview.request === flight.identity
                      : currentGitDiffScope(
                          state,
                          flight.identity as GitDiffIdentity,
                        ) && state.gitReview.detailRequest === flight.identity),
                )
              );
            }
            if (
              ["git.branch.preview.read", "git.restore.preview.read"].includes(
                type,
              )
            ) {
              const f = gitBranchRestoreFlight;
              return (
                !disposed &&
                Boolean(
                  f &&
                    !f.abort.signal.aborted &&
                    f.operation === envelope.operation &&
                    state.gitBranchRestore.request === f.identity &&
                    currentGitBranchRestoreScope(state, f.identity),
                )
              );
            }
            if (["git.branch.apply", "git.restore.apply"].includes(type)) {
              const i =
                "operationId" in envelope && "runtimeEpoch" in envelope
                  ? state.operations[
                      operationKey(
                        envelope.runtimeEpoch!,
                        envelope.operationId!,
                      )
                    ]
                  : undefined;
              return (
                !disposed &&
                Boolean(
                  i?.gitBranchRestoreMutation &&
                    i.operation === envelope.operation &&
                    envelope.expectedRevision ===
                      i.gitBranchRestoreMutation.preview.revision &&
                    gitBranchRestoreDispatchReady(
                      state,
                      i.gitBranchRestoreMutation,
                    ),
                )
              );
            }
            if (type === "git.commit.preview.read") {
              const f = gitCommitFlight;
              return (
                !disposed &&
                Boolean(
                  f &&
                    !f.abort.signal.aborted &&
                    f.operation === envelope.operation &&
                    state.gitCommit.request === f.identity &&
                    currentGitCommitScope(state, f.identity),
                )
              );
            }
            if (type === "git.commit.apply") {
              const i =
                "operationId" in envelope && "runtimeEpoch" in envelope
                  ? state.operations[
                      operationKey(
                        envelope.runtimeEpoch!,
                        envelope.operationId!,
                      )
                    ]
                  : undefined;
              return (
                !disposed &&
                Boolean(
                  i?.gitCommitMutation &&
                    i.operation === envelope.operation &&
                    envelope.expectedRevision ===
                      i.gitCommitMutation.preview.revision &&
                    gitCommitDispatchReady(state, i.gitCommitMutation),
                )
              );
            }
            if (type === "git.index.preview.read") {
              const f = gitIndexFlight;
              return (
                !disposed &&
                Boolean(
                  f &&
                    !f.abort.signal.aborted &&
                    f.operation === envelope.operation &&
                    state.gitIndex.request === f.identity &&
                    currentGitIndexScope(state, f.identity),
                )
              );
            }
            if (type === "git.index.apply") {
              const i =
                "operationId" in envelope && "runtimeEpoch" in envelope
                  ? state.operations[
                      operationKey(
                        envelope.runtimeEpoch!,
                        envelope.operationId!,
                      )
                    ]
                  : undefined;
              return (
                !disposed &&
                Boolean(
                  i?.gitIndexMutation &&
                    i.operation === envelope.operation &&
                    envelope.expectedRevision ===
                      i.gitIndexMutation.preview.revision &&
                    gitIndexDispatchReady(state, i.gitIndexMutation),
                )
              );
            }
            if (type === "file.save") {
              const intent =
                "operationId" in envelope && "runtimeEpoch" in envelope
                  ? state.operations[
                      operationKey(
                        envelope.runtimeEpoch!,
                        envelope.operationId!,
                      )
                    ]
                  : undefined;
              return (
                !disposed &&
                Boolean(
                  intent?.workspaceFileSave &&
                    intent.operation === envelope.operation &&
                    workspaceFileDispatchReady(state, intent.workspaceFileSave),
                )
              );
            }
            if (type === "file.edit.read") {
              const flight = workspaceFileFlight;
              return (
                !disposed &&
                Boolean(
                  flight &&
                    !flight.abort.signal.aborted &&
                    flight.operation === envelope.operation &&
                    currentWorkspaceFileScope(state, flight.identity) &&
                    selectors.workspaceFileDraft(state).request ===
                      flight.identity,
                )
              );
            }
            return true;
          };
          if (!fileDispatchCurrent())
            return { ok: false, code: "CANCELLED", message: "CANCELLED" };
          const lane =
            type === "file.save" ||
            type === "configuration.save" ||
            type === "configuration.skill.save" ||
            type === "configuration.agent.save" ||
            Boolean(agentRuntimeStep(type)) ||
            Boolean(skillRuntimeStep(type)) ||
            type === "configuration.instructions.apply" ||
            type === "configuration.instructions.remove" ||
            (type.startsWith("configuration.mcp.") &&
              type !== "configuration.mcp.read")
              ? "saves"
              : [
                    "git.commit.preview.read",
                    "git.branch.preview.read",
                    "git.restore.preview.read",
                    "git.index.preview.read",
                    "git.review.read",
                    "git.diff.read",
                    "configuration.extensions.read",
                    "configuration.read",
                    "configuration.skill.list",
                    "configuration.skill.read",
                    "configuration.skill.runtime.read",
                    "configuration.agent.list",
                    "configuration.agent.read",
                    "configuration.agent.runtime.read",
                    "configuration.instructions.read",
                    "configuration.mcp.read",
                    "file.edit.read",
                    "context.observe",
                    "session.inbox",
                    "file.read",
                    "file.list",
                  ].includes(type)
                ? "reads"
                : undefined;
          if (type === "context.observe" || type === "session.inbox")
            contextIOActive = true;
          if (lane) dispatch({ type: "configuration.io", lane, delta: 1 });
          const fileIOIdentity =
            type === "file.save" &&
            "operationId" in envelope &&
            "runtimeEpoch" in envelope
              ? store.getState().operations[
                  operationKey(envelope.runtimeEpoch!, envelope.operationId!)
                ]?.workspaceFileSave
              : undefined;
          if (fileIOIdentity)
            dispatch({
              type: "workspace.file.io",
              identity: fileIOIdentity,
              active: true,
            });
          const gitIndexIOIdentity =
            type === "git.index.apply" &&
            "operationId" in envelope &&
            "runtimeEpoch" in envelope
              ? store.getState().operations[
                  operationKey(envelope.runtimeEpoch!, envelope.operationId!)
                ]?.gitIndexMutation
              : undefined;
          if (gitIndexIOIdentity)
            dispatch({
              type: "git.index.io",
              identity: gitIndexIOIdentity,
              active: true,
            });
          const gitBranchRestoreIOIdentity =
            ["git.branch.apply", "git.restore.apply"].includes(type) &&
            "operationId" in envelope &&
            "runtimeEpoch" in envelope
              ? store.getState().operations[
                  operationKey(envelope.runtimeEpoch!, envelope.operationId!)
                ]?.gitBranchRestoreMutation
              : undefined;
          if (gitBranchRestoreIOIdentity)
            dispatch({
              type: "git.branchRestore.io",
              identity: gitBranchRestoreIOIdentity,
              active: true,
            });
          const gitCommitIOIdentity =
            type === "git.commit.apply" &&
            "operationId" in envelope &&
            "runtimeEpoch" in envelope
              ? store.getState().operations[
                  operationKey(envelope.runtimeEpoch!, envelope.operationId!)
                ]?.gitCommitMutation
              : undefined;
          if (gitCommitIOIdentity)
            dispatch({
              type: "git.commit.io",
              identity: gitCommitIOIdentity,
              active: true,
            });
          try {
            if (!fileDispatchCurrent() || !conversationDispatchCurrent())
              return { ok: false, code: "CANCELLED", message: "CANCELLED" };
            return await bridge.workbench(envelope);
          } finally {
            if (gitBranchRestoreIOIdentity)
              dispatch({
                type: "git.branchRestore.io",
                identity: gitBranchRestoreIOIdentity,
                active: false,
              });
            if (gitCommitIOIdentity)
              dispatch({
                type: "git.commit.io",
                identity: gitCommitIOIdentity,
                active: false,
              });
            if (gitIndexIOIdentity)
              dispatch({
                type: "git.index.io",
                identity: gitIndexIOIdentity,
                active: false,
              });
            if (fileIOIdentity)
              dispatch({
                type: "workspace.file.io",
                identity: fileIOIdentity,
                active: false,
              });
            if (type === "context.observe" || type === "session.inbox")
              contextIOActive = false;
            if (lane) dispatch({ type: "configuration.io", lane, delta: -1 });
          }
        },
      },
      { timeoutMs, clock, id },
    );
  let disposed = false,
    started = false;
  let contextIOActive = false;
  let contextFlight:
    | {
        identity: ContextReadIdentity;
        operation: Extract<
          ReadRequest,
          { type: "context.observe" | "session.inbox" }
        >;
        inbox: boolean;
        abort: AbortController;
      }
    | undefined;
  let contextExpiryTimer: ReturnType<typeof setTimeout> | undefined;
  let contextExpiryScope: import("./store.js").Scope | undefined;
  function cancelContextObservation() {
    const f = contextFlight;
    if (!f) return;
    contextFlight = undefined;
    f.abort.abort();
    dispatch({
      type: "context.observed",
      identity: f.identity,
      inbox: f.inbox,
      error: "CANCELLED",
    });
  }
  const unsubscribeContext = store.subscribe((next, previous) => {
    const f = contextFlight;
    if (
      f &&
      (!currentRuntimeRequestScope(next, f.identity.scope) ||
        (f.inbox
          ? next.conversationContext.inboxRequest
          : next.conversationContext.request) !== f.identity)
    )
      cancelContextObservation();
    const d = selectedContextDraft(next),
      old = selectedContextDraft(previous);
    if (d.authority !== old.authority) {
      contextExpiryScope = d.authority;
      // Keep the earliest deadline. Observing another file cannot extend an
      // older capability's lifetime; the Host remains the final cache authority.
      if (
        old.authority &&
        d.authority &&
        currentRuntimeRequestScope(next, old.authority)
      )
        return;
      clock.clearTimeout(contextExpiryTimer);
      if (d.authority)
        contextExpiryTimer = clock.setTimeout(() => {
          if (contextExpiryScope)
            dispatch({ type: "context.expire", scope: contextExpiryScope });
        }, 600000);
    }
  });
  async function observeConversation(
    path?: string,
    selection?: ContextSelection,
  ): Promise<boolean> {
    const state = store.getState(),
      inbox = path === undefined;
    if (
      disposed ||
      contextFlight ||
      !contextEffectsReady(state) ||
      (inbox && !state.selection.sessionId)
    )
      return false;
    if (
      selection &&
      (!validContextSelection(selection) ||
        state.conversationContext.preview?.descriptor.source !== "file" ||
        state.conversationContext.preview.descriptor.path !== path ||
        state.conversationContext.preview.value.kind !== "text" ||
        state.conversationContext.preview.descriptor.version !==
          selection.version ||
        !currentRuntimeRequestScope(
          state,
          state.conversationContext.preview.scope,
        ) ||
        selection.end > state.conversationContext.preview.value.text.length)
    )
      return false;
    if (path !== undefined && !validWorkspaceFilePath(path)) return false;
    const identity: ContextReadIdentity = freezeContextBody({
      scope: scopeOf(state),
      token: state.conversationContext.generation + 1,
      ...(path !== undefined ? { path } : {}),
      ...(selection ? { selection: structuredClone(selection) } : {}),
    });
    const operation = freezeContextBody(
      inbox
        ? {
            type: "session.inbox" as const,
            workspaceId: state.selection.workspaceId!,
            sessionId: state.selection.sessionId!,
          }
        : {
            type: "context.observe" as const,
            workspaceId: state.selection.workspaceId!,
            path: path!,
            ...(selection ? { selection: identity.selection! } : {}),
          },
    );
    const flight = { identity, operation, inbox, abort: new AbortController() };
    contextFlight = flight;
    dispatch({ type: "context.request", identity, inbox });
    if (
      (inbox
        ? store.getState().conversationContext.inboxRequest
        : store.getState().conversationContext.request) !== identity
    ) {
      cancelContextObservation();
      return false;
    }
    const result = await transport.read<ContextObservation | InboxObservation>(
      operation,
      state.epoch,
      flight.abort.signal,
    );
    if (disposed || contextFlight !== flight) return false;
    contextFlight = undefined;
    dispatch({
      type: "context.observed",
      identity,
      inbox,
      ...(result.ok ? { value: result.value } : { error: result.code }),
    });
    const added =
      result.ok &&
      currentRuntimeRequestScope(store.getState(), identity.scope) &&
      !store.getState().conversationContext.error;
    if (added && !inbox) pinReportedModel();
    return added;
  }
  // Attachments need an explicit model: with the session default selected,
  // pin the model the session reports (when the catalog lists it).
  function pinReportedModel() {
    const state = store.getState();
    if (selectors.draft(state).model) return;
    // The session's own report, else what the latest reply ran on.
    const reported =
      selectors.currentSessionSetting(state)?.model ??
      (state.snapshot?.selectedSessionId === state.selection.sessionId
        ? state.snapshot?.messages.filter((m) => m.role === "assistant").at(-1)
            ?.runtime?.model
        : undefined);
    const entries =
      state.catalog?.models.status === "available"
        ? state.catalog.models.entries
        : [];
    const entry =
      reported &&
      entries.find(
        (e) =>
          e.providerId === reported.providerId && e.modelId === reported.id,
      );
    if (entry)
      dispatch({
        type: "draft",
        key: selectionKey(
          state.selection.workspaceId,
          state.selection.sessionId,
        ),
        model: entry.id,
      });
  }
  type ContextPaths =
    | { ok: true; files: string[]; folders: string[]; refused: number }
    | { ok: false; code: string };
  // Pickers and drag-and-drop only suggest workspace-relative paths (main did
  // the containment); attaching still goes through observeContext.
  async function readContextPaths(
    operation: Extract<
      ReadRequest,
      { type: "context.pick" | "context.resolve" }
    >,
    state = store.getState(),
  ): Promise<ContextPaths> {
    if (
      disposed ||
      !state.epoch ||
      !state.selection.workspaceId ||
      !contextEffectsReady(state)
    )
      return { ok: false, code: "UNAVAILABLE" };
    const { workspaceId } = state.selection,
      { epoch } = state;
    const result = await transport.read<{
      files: string[];
      folders: string[];
      refused: number;
    }>({ ...operation, workspaceId }, epoch);
    // The dialog can outlive the scope it was opened for: drop a stale result.
    const now = store.getState();
    if (
      disposed ||
      now.epoch !== epoch ||
      now.selection.workspaceId !== workspaceId
    )
      return { ok: false, code: "CANCELLED" };
    if (!result.ok) return { ok: false, code: result.code };
    const { files, folders, refused } = result.value ?? {};
    return Array.isArray(files) &&
      Array.isArray(folders) &&
      Number.isSafeInteger(refused) &&
      files.length <= 16 &&
      folders.length <= 16 &&
      files.every((p) => validWorkspaceFilePath(p)) &&
      folders.every((p) => p === "" || validWorkspaceFilePath(p))
      ? { ok: true, files, folders, refused }
      : { ok: false, code: "FILE_DENIED" };
  }
  const pickContextPaths = (kind: "file" | "folder") =>
    readContextPaths({ type: "context.pick", kind, workspaceId: "" });
  function resolveDroppedFiles(files: File[]): Promise<ContextPaths> {
    const paths = files
      .slice(0, 16)
      .map((file) => bridge.getPathForFile?.(file) ?? "")
      .filter((path) => path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path));
    return paths.length
      ? readContextPaths({ type: "context.resolve", workspaceId: "", paths })
      : Promise.resolve({ ok: false, code: "FILE_DENIED" });
  }
  // Observes each path in turn; returns how many were added.
  async function attachContextFiles(paths: string[]): Promise<number> {
    let added = 0;
    for (const path of paths) if (await observeConversation(path)) added++;
    return added;
  }
  let mentionAbort: AbortController | undefined;
  // `@` mention search: files plus the folders that contain a match.
  async function searchMentions(
    query: string,
  ): Promise<{ files: string[]; folders: string[] } | undefined> {
    const state = store.getState();
    if (
      disposed ||
      !state.epoch ||
      !state.selection.workspaceId ||
      !query.trim()
    )
      return undefined;
    mentionAbort?.abort();
    const abort = (mentionAbort = new AbortController());
    for (let attempt = 0; attempt < 20; attempt++) {
      const result = await transport.read<WorkbenchFileSearch>(
        {
          type: "file.search",
          workspaceId: state.selection.workspaceId,
          query: query.trim(),
          mode: "name",
        },
        state.epoch,
        abort.signal,
      );
      if (abort.signal.aborted) return undefined;
      if (!result.ok && result.code === "READ_BUSY") {
        await new Promise((resolve) => clock.setTimeout(resolve, 100));
        continue;
      }
      if (!result.ok) return undefined;
      const needle = query.trim().toLowerCase();
      const files = result.value.results
        .map((r) => r.path)
        .filter((p) => validWorkspaceFilePath(p));
      const folders = new Set<string>();
      for (const file of files) {
        const parts = file.split("/").slice(0, -1);
        for (let i = 1; i <= parts.length; i++) {
          const dir = parts.slice(0, i).join("/");
          if (dir.toLowerCase().includes(needle)) folders.add(dir);
        }
      }
      return { files: files.slice(0, 15), folders: [...folders].slice(0, 5) };
    }
    return undefined;
  }
  function sendContextMessage(
    text = selectors.draft(store.getState()).text,
  ): Promise<boolean> {
    const state = store.getState(),
      draft = selectors.draft(state),
      context = selectedContextDraft(state);
    if (
      !contextRequestReady(state, {
        type: "message.send",
        workspaceId: state.selection.workspaceId!,
        sessionId: state.selection.sessionId!,
        requestId: "validation",
        text,
        ...(draft.model ? { model: draft.model } : {}),
        ...(draft.agent ? { agent: draft.agent } : {}),
        ...(draft.variant ? { variant: draft.variant } : {}),
        ...(context.items.length ? { attachments: [...context.items] } : {}),
      })
    )
      return Promise.resolve(false);
    return submitMutation(
      {
        type: "message.send",
        workspaceId: state.selection.workspaceId!,
        sessionId: state.selection.sessionId!,
        requestId: id(),
        text,
        ...(draft.agent ? { agent: draft.agent } : {}),
        ...(draft.model ? { model: draft.model } : {}),
        ...(draft.variant ? { variant: draft.variant } : {}),
        ...(context.items.length
          ? { attachments: structuredClone([...context.items]) }
          : {}),
      },
      false,
      text,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true,
    );
  }
  // Sends to an explicit session: never the current selection, never the
  // composer's model options or staged attachments (delegation, plan execution).
  function sendMessageToSession(
    workspaceId: string,
    sessionId: string,
    text: string,
  ): Promise<boolean> {
    return submitMutation({
      type: "message.send",
      workspaceId,
      sessionId,
      requestId: id(),
      text,
    });
  }
  // Resends one prompt for the selected session (the runtime default model
  // when none is given; a variant needs a model). It never reads or clears the
  // composer draft or its staged attachments.
  function resendMessage(
    text: string,
    model?: string,
    agent?: string,
    variant?: string,
  ): Promise<boolean> {
    const state = store.getState();
    return submitMutation({
      type: "message.send",
      workspaceId: state.selection.workspaceId!,
      sessionId: state.selection.sessionId!,
      requestId: id(),
      text,
      ...(model ? { model } : {}),
      ...(agent ? { agent } : {}),
      ...(model && variant ? { variant } : {}),
    });
  }
  function deliverContextMessage(
    delivery: "steer" | "queue",
  ): Promise<boolean> {
    const state = store.getState(),
      text = selectors.draft(state).text;
    return submitMutation(
      {
        type: "message.send",
        workspaceId: state.selection.workspaceId!,
        sessionId: state.selection.sessionId!,
        requestId: id(),
        text,
        delivery,
      },
      false,
      text,
    );
  }
  function confirmContextBranch(): Promise<boolean> {
    const state = store.getState(),
      branch = state.conversationContext.branch;
    if (!branch) return Promise.resolve(false);
    return submitMutation(
      {
        type: "session.fork",
        workspaceId: state.selection.workspaceId!,
        sessionId: state.selection.sessionId!,
        requestId: id(),
        before: branch.before,
      },
      true,
    );
  }
  // Revert hides the message and everything after it; the message text goes
  // back into the composer (only if it is empty: typed input is never lost).
  async function revertToMessage(messageId: string): Promise<boolean> {
    const state = store.getState(),
      workspaceId = state.selection.workspaceId,
      sessionId = state.selection.sessionId,
      text = state.snapshot?.messages.find(
        (m) => m.id === messageId && m.role === "user",
      )?.text;
    if (!workspaceId || !sessionId) return false;
    const accepted = await submitMutation({
      type: "session.revert",
      workspaceId,
      sessionId,
      requestId: id(),
      messageId,
    });
    const now = store.getState();
    if (
      !accepted ||
      disposed ||
      !text ||
      now.selection.workspaceId !== workspaceId ||
      now.selection.sessionId !== sessionId
    )
      return accepted;
    const key = selectionKey(workspaceId, sessionId);
    if (!(now.drafts[key] ?? emptyDraft).text)
      dispatch({ type: "draft", key, text });
    return accepted;
  }
  function reapplyRevert(): Promise<boolean> {
    const state = store.getState(),
      revert = selectors.revert(state);
    if (!revert) return Promise.resolve(false);
    return submitMutation({
      type: "session.revert.clear",
      workspaceId: state.selection.workspaceId!,
      sessionId: state.selection.sessionId!,
      requestId: id(),
      messageId: revert.messageId,
    });
  }
  function cancelInbox(inboxId: string): Promise<boolean> {
    const state = store.getState();
    return submitMutation({
      type: "session.inbox.cancel",
      workspaceId: state.selection.workspaceId!,
      sessionId: state.selection.sessionId!,
      requestId: id(),
      inboxId,
    });
  }
  let pollTimer: ReturnType<typeof setTimeout> | undefined,
    fileTimer: ReturnType<typeof setTimeout> | undefined,
    lookupTimer: ReturnType<typeof setTimeout> | undefined,
    catalogTimer: ReturnType<typeof setTimeout> | undefined,
    diagnosticsTimer: ReturnType<typeof setTimeout> | undefined;
  let snapshotAbort: AbortController | undefined,
    catalogAbort: AbortController | undefined,
    filesAbort: AbortController | undefined,
    diagnosticsAbort: AbortController | undefined;
  let snapshotBackoff = 0,
    catalogRetries = 0,
    snapshotFlight = false,
    fileFlight = false,
    lookupFlight = false;
  let lookupCursor = 0;
  let gitReviewFlight:
    | {
        identity: GitReviewIdentity;
        abort: AbortController;
        operation: Extract<ReadRequest, { type: "git.review.read" }>;
      }
    | undefined;
  let gitDiffFlight:
    | {
        identity: GitDiffIdentity;
        abort: AbortController;
        operation: GitDiffRequest;
      }
    | undefined;
  let gitRetryTimer: ReturnType<typeof setTimeout> | undefined,
    gitDiffRetryTimer: ReturnType<typeof setTimeout> | undefined;
  function cancelGitReview() {
    const flight = gitReviewFlight;
    if (!flight) return;
    gitReviewFlight = undefined;
    flight.abort.abort();
    dispatch({
      type: "git.observed",
      identity: flight.identity,
      error: "CANCELLED",
    });
  }
  function cancelGitDiff() {
    const flight = gitDiffFlight;
    if (!flight) return;
    gitDiffFlight = undefined;
    flight.abort.abort();
    dispatch({
      type: "git.diff.observed",
      identity: flight.identity,
      error: "CANCELLED",
    });
  }
  const unsubscribeGit = store.subscribe((next) => {
    if (
      gitReviewFlight &&
      (!currentGitReviewScope(next, gitReviewFlight.identity) ||
        next.gitReview.request !== gitReviewFlight.identity)
    )
      cancelGitReview();
    if (
      gitDiffFlight &&
      (!currentGitDiffScope(next, gitDiffFlight.identity) ||
        next.gitReview.detailRequest !== gitDiffFlight.identity)
    )
      cancelGitDiff();
  });
  function gitIdentity(): GitReviewIdentity {
    const state = store.getState(),
      workspace = state.lists.workspaces.find(
        (w) => w.id === state.selection.workspaceId,
      )!;
    return Object.freeze({
      epoch: state.epoch!,
      workspaceId: workspace.id,
      workspacePath: workspace.path,
      trusted: workspace.trusted,
      trustRevision: workspace.trustRevision,
      floor: state.revision,
      generation: state.gitReview.generation,
    });
  }
  async function observeGitReview(): Promise<boolean> {
    if (disposed) return false;
    cancelGitDiff();
    cancelGitReview();
    if (!canObserveGitReview(store.getState())) return false;
    const identity = Object.freeze({
      ...gitIdentity(),
      generation: store.getState().gitReview.generation + 1,
    });
    dispatch({ type: "git.read", identity });
    if (store.getState().gitReview.request !== identity) return false;
    const abort = new AbortController();
    const operation = Object.freeze({
      type: "git.review.read" as const,
      workspaceId: identity.workspaceId,
    });
    gitReviewFlight = { identity, abort, operation };
    const result = await transport.read<unknown>(
      operation,
      identity.epoch,
      abort.signal,
    );
    if (
      disposed ||
      abort.signal.aborted ||
      gitReviewFlight?.identity !== identity
    )
      return false;
    gitReviewFlight = undefined;
    dispatch(
      result.ok
        ? { type: "git.observed", identity, value: result.value }
        : { type: "git.observed", identity, error: result.code },
    );
    if (!result.ok && result.code === "READ_BUSY") {
      clock.clearTimeout(gitRetryTimer);
      gitRetryTimer = clock.setTimeout(
        () => dispatch({ type: "git.retry", generation: identity.generation }),
        400,
      );
    }
    return store.getState().gitReview.observationIdentity === identity;
  }
  async function readGitDiff(): Promise<boolean> {
    if (disposed) return false;
    cancelGitDiff();
    const state = store.getState(),
      observation = currentGitReviewObservation(state);
    if (!canReadGitDiff(state) || observation?.status !== "available")
      return false;
    const identity: GitDiffIdentity = Object.freeze({
      ...gitIdentity(),
      detailGeneration: state.gitReview.detailGeneration + 1,
      observationId: observation.observationId,
      mode: state.gitReview.mode,
      path: state.gitReview.path,
      baseRef: state.gitReview.baseRef,
    });
    dispatch({ type: "git.diff.read", identity });
    if (store.getState().gitReview.detailRequest !== identity) return false;
    const abort = new AbortController();
    const operation: GitDiffRequest = Object.freeze({
      type: "git.diff.read",
      workspaceId: identity.workspaceId,
      observationId: identity.observationId,
      path: identity.path,
      ...(identity.mode === "base"
        ? { mode: "base", baseRef: identity.baseRef }
        : { mode: identity.mode }),
    });
    gitDiffFlight = { identity, abort, operation };
    const result = await transport.read<unknown>(
      operation,
      identity.epoch,
      abort.signal,
    );
    if (
      disposed ||
      abort.signal.aborted ||
      gitDiffFlight?.identity !== identity
    )
      return false;
    gitDiffFlight = undefined;
    dispatch(
      result.ok
        ? { type: "git.diff.observed", identity, value: result.value }
        : { type: "git.diff.observed", identity, error: result.code },
    );
    if (!result.ok && result.code === "READ_BUSY") {
      clock.clearTimeout(gitDiffRetryTimer);
      gitDiffRetryTimer = clock.setTimeout(
        () =>
          dispatch({
            type: "git.retry",
            generation: identity.generation,
            detailGeneration: identity.detailGeneration,
          }),
        400,
      );
    }
    return store.getState().gitReview.detailIdentity === identity;
  }
  let gitBranchRestoreFlight:
    | {
        identity: GitBranchRestoreIdentity;
        abort: AbortController;
        operation: GitBranchPreviewRequest | GitRestorePreviewRequest;
      }
    | undefined;
  let gitBranchRestoreExpiryTimer: ReturnType<typeof setTimeout> | undefined;
  function cancelGitBranchRestorePreview() {
    const flight = gitBranchRestoreFlight;
    if (!flight) return;
    gitBranchRestoreFlight = undefined;
    flight.abort.abort();
    dispatch({ type: "git.branchRestore.cancel", identity: flight.identity });
  }
  const unsubscribeGitBranchRestore = store.subscribe((next) => {
    if (
      gitBranchRestoreFlight &&
      (next.gitBranchRestore.request !== gitBranchRestoreFlight.identity ||
        !currentGitBranchRestoreScope(next, gitBranchRestoreFlight.identity))
    )
      cancelGitBranchRestorePreview();
  });
  async function previewGitBranchRestore(): Promise<boolean> {
    if (disposed) return false;
    cancelGitBranchRestorePreview();
    const state = store.getState(),
      review = currentGitReviewObservation(state);
    if (!canPreviewGitBranchRestore(state) || review?.status !== "available")
      return false;
    const draftKey = selectedGitBranchRestoreDraftKey(state)!;
    const draft = state.gitBranchRestoreDrafts[draftKey]!;
    const identity: GitBranchRestoreIdentity = Object.freeze({
      ...state.gitReview.observationIdentity!,
      selectionGeneration: state.selection.generation,
      branchRestoreGeneration: state.gitBranchRestore.generation,
      review,
      draftKey,
      draft,
    });
    dispatch({ type: "git.branchRestore.read", identity });
    if (store.getState().gitBranchRestore.request !== identity) return false;
    const abort = new AbortController();
    const operation: GitBranchPreviewRequest | GitRestorePreviewRequest =
      Object.freeze(
        draft.action === "restore"
          ? {
              type: "git.restore.preview.read" as const,
              workspaceId: identity.workspaceId,
              observationId: review.observationId,
              source: draft.source as "index" | "head",
              paths: Object.freeze(
                gitRestoreDraftPaths(draft.paths),
              ) as unknown as string[],
            }
          : {
              type: "git.branch.preview.read" as const,
              workspaceId: identity.workspaceId,
              observationId: review.observationId,
              action: draft.action,
              branch: draft.branch,
              author: Object.freeze({ name: draft.name, email: draft.email }),
            },
      );
    gitBranchRestoreFlight = { identity, abort, operation };
    const result = await transport.read<unknown>(
      operation,
      identity.epoch,
      abort.signal,
    );
    if (
      disposed ||
      abort.signal.aborted ||
      gitBranchRestoreFlight?.identity !== identity
    )
      return false;
    gitBranchRestoreFlight = undefined;
    dispatch(
      result.ok
        ? { type: "git.branchRestore.observed", identity, value: result.value }
        : { type: "git.branchRestore.observed", identity, error: result.code },
    );
    const accepted =
      store.getState().gitBranchRestore.previewIdentity === identity;
    if (accepted) {
      clock.clearTimeout(gitBranchRestoreExpiryTimer);
      gitBranchRestoreExpiryTimer = clock.setTimeout(
        () => dispatch({ type: "git.branchRestore.expire", identity }),
        GIT_BRANCH_RESTORE_LIMITS.previewMs,
      );
    }
    return accepted;
  }
  async function applyGitBranchRestore(): Promise<boolean> {
    const state = store.getState(),
      preview = currentGitBranchRestorePreview(state),
      source = state.gitBranchRestore.previewIdentity;
    if (
      disposed ||
      !canApplyGitBranchRestore(state) ||
      !source ||
      preview?.status !== "available"
    )
      return false;
    const operationId = id();
    const target = Object.fromEntries(
      GIT_BRANCH_RESTORE_TARGET_FIELDS.map((k) => [
        k,
        structuredClone(preview[k]),
      ]),
    ) as ReturnType<typeof gitBranchRestoreTargetFromApply>;
    target.paths.forEach((x) => {
      if (x.before) Object.freeze(x.before);
      if (x.after) Object.freeze(x.after);
      if (x.beforeEntry) Object.freeze(x.beforeEntry);
      if (x.afterEntry) Object.freeze(x.afterEntry);
      Object.freeze(x);
    });
    target.metadata.forEach((x) => {
      if (x.before) Object.freeze(x.before);
      Object.freeze(x.after);
      Object.freeze(x);
    });
    Object.freeze(target.paths);
    Object.freeze(target.metadata);
    const request: GitBranchApplyRequest | GitRestoreApplyRequest =
      Object.freeze({
        type:
          target.action === "restore"
            ? "git.restore.apply"
            : "git.branch.apply",
        workspaceId: source.workspaceId,
        requestId: operationId,
        previewId: preview.previewId,
        ...target,
      });
    let digest: string, backups: GitBranchRestoreBackup[];
    try {
      const roles = gitBranchRestoreBackupRoles(target);
      backups = await Promise.all(
        roles.map(async (x) =>
          Object.freeze({
            role: x.role,
            path: x.path,
            backupId: x.exists
              ? `.omoc-git-branch-restore-${await sha256(JSON.stringify([source.epoch, operationId, x.role, x.path]))}.backup`
              : null,
          }),
        ),
      );
      Object.freeze(backups);
      const admitted = { ...request, expectedRevision: preview.revision };
      digest = await sha256(
        JSON.stringify(
          Object.keys(admitted)
            .sort()
            .map((k) => [k, admitted[k as keyof typeof admitted]]),
        ),
      );
    } catch {
      return false;
    }
    const current = store.getState();
    if (
      disposed ||
      !canApplyGitBranchRestore(current) ||
      current.gitBranchRestore.preview !== preview ||
      current.gitBranchRestore.previewIdentity !== source ||
      !currentGitBranchRestoreScope(current, source)
    )
      return false;
    const identity: GitBranchRestoreMutationIdentity = Object.freeze({
      ...source,
      operationId,
      request,
      preview,
      digest,
      backups,
    });
    const key = operationKey(identity.epoch, operationId);
    const intent: Intent = {
      id: operationId,
      epoch: identity.epoch,
      origin: current.selection,
      key: selectionKey(identity.workspaceId),
      navigate: false,
      status: "pending",
      operation: request,
      gitBranchRestoreMutation: identity,
    };
    dispatch({ type: "intent", intent });
    if (!gitBranchRestoreDispatchReady(store.getState(), identity)) {
      if (store.getState().operations[key]?.status === "pending")
        dispatch({ type: "refused", id: key, code: "CANCELLED" });
      return false;
    }
    const result = await transport.mutate<unknown>(
      request,
      identity.epoch,
      operationId,
      preview.revision,
    );
    if (disposed) return false;
    let correlated = false;
    if (result.ok)
      try {
        const value = validateGitBranchRestoreMutationResult(result.value);
        if (value.requestId === operationId) {
          if (
            value.status === "applied" &&
            value.action === request.action &&
            value.previewDigest === request.previewDigest &&
            JSON.stringify(value.paths) ===
              JSON.stringify(
                request.paths.map((x) => ({ path: x.path, after: x.after })),
              ) &&
            JSON.stringify(value.metadata) ===
              JSON.stringify(
                request.metadata.map((x) => ({
                  role: x.role,
                  digest: x.after.digest,
                })),
              ) &&
            JSON.stringify(value.backups) === JSON.stringify(backups) &&
            result.receipt?.effect === "confirmed"
          ) {
            validateGitBranchRestoreReceiptResult(result.receipt.result, {
              workspaceId: identity.workspaceId,
              target: gitBranchRestoreTargetFromApply(request),
              digest,
              backups,
            });
            correlated = true;
          } else if (
            value.status === "unknown" &&
            result.receipt?.effect !== "confirmed"
          )
            correlated = true;
        }
      } catch {
        correlated = false;
      }
    else
      correlated = Boolean(
        result.receipt?.effect === "none" &&
          result.receipt.admission === "rejected" &&
          result.receipt.result?.kind === "rejected" &&
          result.receipt.result.code === result.code,
      );
    if (correlated && result.receipt)
      dispatch({ type: "receipt", id: key, receipt: result.receipt });
    if (store.getState().operations[key]?.status === "pending") {
      if (
        !result.ok &&
        !result.receipt &&
        [
          "STALE_EPOCH",
          "STALE_REVISION",
          "INVALID_REQUEST",
          "BUSY",
          "CANCELLED",
          "LIMIT_REACHED",
          "DUPLICATE_CONFLICT",
        ].includes(result.code)
      )
        dispatch({ type: "refused", id: key, code: result.code });
      else dispatch({ type: "unknown", id: key });
    }
    if (store.getState().operations[key]?.status === "unknown") void lookup();
    return store.getState().operations[key]?.status === "accepted";
  }
  let gitCommitFlight:
    | {
        identity: GitCommitIdentity;
        abort: AbortController;
        operation: GitCommitPreviewRequest;
      }
    | undefined;
  let gitCommitExpiryTimer: ReturnType<typeof setTimeout> | undefined;
  function cancelGitCommitPreview() {
    const flight = gitCommitFlight;
    if (!flight) return;
    gitCommitFlight = undefined;
    flight.abort.abort();
    dispatch({ type: "git.commit.cancel", identity: flight.identity });
  }
  const unsubscribeGitCommit = store.subscribe((next) => {
    if (
      gitCommitFlight &&
      (next.gitCommit.request !== gitCommitFlight.identity ||
        !currentGitCommitScope(next, gitCommitFlight.identity))
    )
      cancelGitCommitPreview();
  });
  async function previewGitCommit(): Promise<boolean> {
    if (disposed) return false;
    cancelGitCommitPreview();
    const state = store.getState(),
      review = currentGitReviewObservation(state);
    if (!canPreviewGitCommit(state) || review?.status !== "available")
      return false;
    const draftKey = selectedGitCommitDraftKey(state)!;
    const draft = state.gitCommitDrafts[draftKey]!;
    const identity: GitCommitIdentity = Object.freeze({
      ...state.gitReview.observationIdentity!,
      selectionGeneration: state.selection.generation,
      commitGeneration: state.gitCommit.generation,
      review,
      draftKey,
      draft,
    });
    dispatch({ type: "git.commit.read", identity });
    if (store.getState().gitCommit.request !== identity) return false;
    const abort = new AbortController();
    const operation: GitCommitPreviewRequest = Object.freeze({
      type: "git.commit.preview.read",
      workspaceId: identity.workspaceId,
      observationId: review.observationId,
      author: Object.freeze({ name: draft.name, email: draft.email }),
      message: draft.message,
    });
    gitCommitFlight = { identity, abort, operation };
    const result = await transport.read<unknown>(
      operation,
      identity.epoch,
      abort.signal,
    );
    if (
      disposed ||
      abort.signal.aborted ||
      gitCommitFlight?.identity !== identity
    )
      return false;
    gitCommitFlight = undefined;
    dispatch(
      result.ok
        ? { type: "git.commit.observed", identity, value: result.value }
        : { type: "git.commit.observed", identity, error: result.code },
    );
    const accepted = store.getState().gitCommit.previewIdentity === identity;
    if (accepted) {
      clock.clearTimeout(gitCommitExpiryTimer);
      gitCommitExpiryTimer = clock.setTimeout(
        () => dispatch({ type: "git.commit.expire", identity }),
        GIT_COMMIT_LIMITS.previewMs,
      );
    }
    return accepted;
  }
  async function applyGitCommit(): Promise<boolean> {
    const state = store.getState(),
      preview = currentGitCommitPreview(state),
      source = state.gitCommit.previewIdentity;
    if (
      disposed ||
      !canApplyGitCommit(state) ||
      !source ||
      preview?.status !== "available"
    )
      return false;
    const operationId = id();
    const target = Object.fromEntries(
      GIT_COMMIT_TARGET_FIELDS.map((k) => [k, structuredClone(preview[k])]),
    ) as ReturnType<typeof gitCommitTargetFromApply>;
    Object.freeze(target.reference);
    target.logs.forEach(Object.freeze);
    Object.freeze(target.logs);
    const request: GitCommitApplyRequest = Object.freeze({
      type: "git.commit.apply",
      workspaceId: source.workspaceId,
      requestId: operationId,
      previewId: preview.previewId,
      ...target,
    });
    let digest: string, backups: GitCommitBackup[];
    try {
      const roles = [
        ...target.logs,
        {
          role:
            target.reference.kind === "head"
              ? ("head_ref" as const)
              : ("branch_ref" as const),
          exists: target.reference.exists,
        },
      ];
      backups = await Promise.all(
        roles.map(async (x) =>
          Object.freeze({
            role: x.role,
            backupId: x.exists
              ? `.omoc-git-commit-${await sha256(JSON.stringify([source.epoch, operationId, x.role]))}.backup`
              : null,
          }),
        ),
      );
      Object.freeze(backups);
      const admitted = { ...request, expectedRevision: preview.revision };
      digest = await sha256(
        JSON.stringify(
          Object.keys(admitted)
            .sort()
            .map((k) => [k, admitted[k as keyof typeof admitted]]),
        ),
      );
    } catch {
      return false;
    }
    const current = store.getState();
    if (
      disposed ||
      !canApplyGitCommit(current) ||
      current.gitCommit.preview !== preview ||
      current.gitCommit.previewIdentity !== source ||
      !currentGitCommitScope(current, source)
    )
      return false;
    const identity: GitCommitMutationIdentity = Object.freeze({
      ...source,
      operationId,
      request,
      preview,
      digest,
      backups,
    });
    const key = operationKey(identity.epoch, operationId);
    const intent: Intent = {
      id: operationId,
      epoch: identity.epoch,
      origin: current.selection,
      key: selectionKey(identity.workspaceId),
      navigate: false,
      status: "pending",
      operation: request,
      gitCommitMutation: identity,
    };
    dispatch({ type: "intent", intent });
    if (!gitCommitDispatchReady(store.getState(), identity)) {
      if (store.getState().operations[key]?.status === "pending")
        dispatch({ type: "refused", id: key, code: "CANCELLED" });
      return false;
    }
    const result = await transport.mutate<unknown>(
      request,
      identity.epoch,
      operationId,
      preview.revision,
    );
    if (disposed) return false;
    let correlated = false;
    if (result.ok)
      try {
        const value = validateGitCommitMutationResult(result.value);
        if (value.requestId === operationId) {
          if (
            value.status === "committed" &&
            value.commitOid === request.commitOid &&
            value.treeOid === request.treeOid &&
            value.referenceDigest === request.reference.nextDigest &&
            JSON.stringify(value.logDigests) ===
              JSON.stringify(
                request.logs.map((x) => ({
                  role: x.role,
                  digest: x.nextDigest,
                })),
              ) &&
            JSON.stringify(value.backups) === JSON.stringify(backups) &&
            result.receipt?.effect === "confirmed"
          ) {
            validateGitCommitReceiptResult(result.receipt.result, {
              workspaceId: identity.workspaceId,
              target: gitCommitTargetFromApply(request),
              digest,
              backups,
            });
            correlated = true;
          } else if (
            value.status === "unknown" &&
            result.receipt?.effect !== "confirmed"
          )
            correlated = true;
        }
      } catch {
        correlated = false;
      }
    else
      correlated = Boolean(
        result.receipt?.effect === "none" &&
          result.receipt.admission === "rejected" &&
          result.receipt.result?.kind === "rejected" &&
          result.receipt.result.code === result.code,
      );
    if (correlated && result.receipt)
      dispatch({ type: "receipt", id: key, receipt: result.receipt });
    if (store.getState().operations[key]?.status === "pending") {
      if (
        !result.ok &&
        !result.receipt &&
        [
          "STALE_EPOCH",
          "STALE_REVISION",
          "INVALID_REQUEST",
          "BUSY",
          "CANCELLED",
          "LIMIT_REACHED",
          "DUPLICATE_CONFLICT",
        ].includes(result.code)
      )
        dispatch({ type: "refused", id: key, code: result.code });
      else dispatch({ type: "unknown", id: key });
    }
    if (store.getState().operations[key]?.status === "unknown") void lookup();
    return store.getState().operations[key]?.status === "accepted";
  }
  let gitIndexFlight:
    | {
        identity: GitIndexIdentity;
        abort: AbortController;
        operation: GitIndexPreviewRequest;
      }
    | undefined;
  function cancelGitIndexPreview() {
    const flight = gitIndexFlight;
    if (!flight) return;
    gitIndexFlight = undefined;
    flight.abort.abort();
    dispatch({ type: "git.index.cancel", identity: flight.identity });
  }
  const unsubscribeGitIndex = store.subscribe((next) => {
    if (
      gitIndexFlight &&
      (next.gitIndex.request !== gitIndexFlight.identity ||
        !currentGitIndexScope(next, gitIndexFlight.identity))
    )
      cancelGitIndexPreview();
  });
  async function previewGitIndex(): Promise<boolean> {
    if (disposed) return false;
    cancelGitIndexPreview();
    const state = store.getState(),
      review = currentGitReviewObservation(state);
    if (!canPreviewGitIndex(state) || review?.status !== "available")
      return false;
    const paths = [...state.gitIndex.paths];
    Object.freeze(paths);
    const identity: GitIndexIdentity = Object.freeze({
      ...state.gitReview.observationIdentity!,
      selectionGeneration: state.selection.generation,
      indexGeneration: state.gitIndex.generation,
      review,
      action: state.gitIndex.action,
      paths,
    });
    dispatch({ type: "git.index.read", identity });
    if (store.getState().gitIndex.request !== identity) return false;
    const abort = new AbortController();
    const operation: GitIndexPreviewRequest = Object.freeze({
      type: "git.index.preview.read",
      workspaceId: identity.workspaceId,
      observationId: review.observationId,
      action: identity.action,
      paths: identity.paths,
    });
    gitIndexFlight = { identity, abort, operation };
    const result = await transport.read<unknown>(
      operation,
      identity.epoch,
      abort.signal,
    );
    if (
      disposed ||
      abort.signal.aborted ||
      gitIndexFlight?.identity !== identity
    )
      return false;
    gitIndexFlight = undefined;
    dispatch(
      result.ok
        ? { type: "git.index.observed", identity, value: result.value }
        : { type: "git.index.observed", identity, error: result.code },
    );
    return store.getState().gitIndex.previewIdentity === identity;
  }
  async function applyGitIndex(): Promise<boolean> {
    const state = store.getState(),
      preview = currentGitIndexPreview(state),
      source = state.gitIndex.previewIdentity;
    if (
      disposed ||
      !canApplyGitIndex(state) ||
      !source ||
      preview?.status !== "available"
    )
      return false;
    const operationId = id();
    const paths = [...preview.paths];
    Object.freeze(paths);
    const request: GitIndexApplyRequest = Object.freeze({
      type: "git.index.apply",
      workspaceId: source.workspaceId,
      requestId: operationId,
      previewId: preview.previewId,
      action: preview.action,
      paths,
      previewDigest: preview.previewDigest,
      headOid: preview.headOid,
      indexExists: preview.indexExists,
      indexDigest: preview.indexDigest,
      nextIndexDigest: preview.nextIndexDigest,
      objectFormat: preview.objectFormat,
    });
    let digest: string, backupId: string | null;
    try {
      backupId = preview.indexExists
        ? `.omoc-git-index-${await sha256(operationKey(source.epoch, operationId))}.backup`
        : null;
      const admitted = { ...request, expectedRevision: preview.revision };
      digest = await sha256(
        JSON.stringify(
          Object.keys(admitted)
            .sort()
            .map((k) => [k, admitted[k as keyof typeof admitted]]),
        ),
      );
    } catch {
      return false;
    }
    const current = store.getState();
    if (
      disposed ||
      !canApplyGitIndex(current) ||
      current.gitIndex.preview !== preview ||
      current.gitIndex.previewIdentity !== source ||
      !currentGitIndexScope(current, source)
    )
      return false;
    const identity: GitIndexMutationIdentity = Object.freeze({
      ...source,
      operationId,
      request,
      preview,
      digest,
      backupId,
    });
    const key = operationKey(identity.epoch, operationId);
    const intent: Intent = {
      id: operationId,
      epoch: identity.epoch,
      origin: current.selection,
      key: selectionKey(identity.workspaceId),
      navigate: false,
      status: "pending",
      operation: request,
      gitIndexMutation: identity,
    };
    dispatch({ type: "intent", intent });
    if (!gitIndexDispatchReady(store.getState(), identity)) {
      if (store.getState().operations[key]?.status === "pending")
        dispatch({ type: "refused", id: key, code: "CANCELLED" });
      return false;
    }
    const result = await transport.mutate<unknown>(
      request,
      identity.epoch,
      operationId,
      preview.revision,
    );
    if (disposed) return false;
    let correlated = false;
    if (result.ok)
      try {
        const value = validateGitIndexMutationResult(result.value);
        if (value.requestId === operationId) {
          if (
            value.status === "applied" &&
            value.indexDigest === request.nextIndexDigest &&
            value.backupId === backupId &&
            result.receipt?.effect === "confirmed"
          ) {
            validateGitIndexReceiptResult(result.receipt.result, {
              workspaceId: identity.workspaceId,
              target: gitIndexTargetFromApply(request),
              digest,
              backupId,
            });
            correlated = true;
          } else if (
            value.status === "unknown" &&
            result.receipt?.effect !== "confirmed"
          )
            correlated = true;
        }
      } catch {
        correlated = false;
      }
    else
      correlated = Boolean(
        result.receipt?.effect === "none" &&
          result.receipt.admission === "rejected" &&
          result.receipt.result?.kind === "rejected" &&
          result.receipt.result.code === result.code,
      );
    if (correlated && result.receipt)
      dispatch({ type: "receipt", id: key, receipt: result.receipt });
    if (store.getState().operations[key]?.status === "pending") {
      if (
        !result.ok &&
        !result.receipt &&
        [
          "STALE_EPOCH",
          "STALE_REVISION",
          "INVALID_REQUEST",
          "BUSY",
          "CANCELLED",
          "LIMIT_REACHED",
          "DUPLICATE_CONFLICT",
        ].includes(result.code)
      )
        dispatch({ type: "refused", id: key, code: result.code });
      else dispatch({ type: "unknown", id: key });
    }
    if (store.getState().operations[key]?.status === "unknown") void lookup();
    return store.getState().operations[key]?.status === "accepted";
  }
  let workspaceFileFlight:
    | {
        identity: WorkspaceFileIdentity;
        abort: AbortController;
        operation: Extract<ReadRequest, { type: "file.edit.read" }>;
      }
    | undefined;
  function cancelWorkspaceFileRead() {
    const flight = workspaceFileFlight;
    if (!flight) return;
    workspaceFileFlight = undefined;
    flight.abort.abort();
    dispatch({ type: "workspace.file.cancel", identity: flight.identity });
  }
  const unsubscribeWorkspaceFile = store.subscribe((next) => {
    const flight = workspaceFileFlight;
    if (
      flight &&
      (!currentWorkspaceFileScope(next, flight.identity) ||
        selectors.workspaceFileDraft(next).request !== flight.identity)
    )
      cancelWorkspaceFileRead();
  });
  async function readWorkspaceFile(path: string): Promise<boolean> {
    if (disposed || !validWorkspaceFilePath(path)) return false;
    cancelWorkspaceFileRead();
    dispatch({ type: "workspace.file.select", path });
    const state = store.getState();
    if (!canReadWorkspaceFile(state)) return false;
    const workspace = state.lists.workspaces.find(
      (w) => w.id === state.selection.workspaceId,
    )!;
    const identity: WorkspaceFileIdentity = Object.freeze({
      epoch: state.epoch!,
      workspaceId: workspace.id,
      workspacePath: workspace.path,
      path,
      trustRevision: workspace.trustRevision,
      floor: state.revision,
      generation: state.workspaceFile.generation,
      selectionGeneration: state.selection.generation,
      draft: selectors.workspaceFileDraft(state),
    });
    dispatch({ type: "workspace.file.read", identity });
    if (selectors.workspaceFileDraft(store.getState()).request !== identity)
      return false;
    const abort = new AbortController();
    const operation = Object.freeze({
      type: "file.edit.read" as const,
      workspaceId: workspace.id,
      path,
    });
    workspaceFileFlight = { identity, abort, operation };
    const result = await transport.read<WorkbenchFileObservation>(
      operation,
      identity.epoch,
      abort.signal,
    );
    if (
      disposed ||
      abort.signal.aborted ||
      workspaceFileFlight?.identity !== identity
    )
      return false;
    workspaceFileFlight = undefined;
    dispatch(
      result.ok
        ? { type: "workspace.file.loaded", identity, value: result.value }
        : { type: "workspace.file.loaded", identity, error: result.code },
    );
    return (
      selectors.workspaceFileDraft(store.getState()).observation === identity
    );
  }
  async function saveWorkspaceFile(): Promise<boolean> {
    const state = store.getState();
    if (disposed || !canSaveWorkspaceFile(state)) return false;
    const draft = selectors.workspaceFileDraft(state),
      observation = draft.observation!,
      read = draft.read!;
    if (read.status !== "available") return false;
    const operationId = id();
    const request = Object.freeze({
      type: "file.save" as const,
      workspaceId: observation.workspaceId,
      path: observation.path,
      requestId: operationId,
      expectation: "version" as const,
      version: read.version,
      directoryVersion: read.directoryVersion,
      text: draft.text,
    });
    let backupId: string, digest: string;
    try {
      backupId = `.omoc-configuration-${await sha256(operationKey(state.epoch!, operationId))}.file.backup`;
      const admitted = { ...request, expectedRevision: observation.floor };
      digest = await sha256(
        JSON.stringify(
          Object.keys(admitted)
            .sort()
            .map((key) => [key, admitted[key as keyof typeof admitted]]),
        ),
      );
    } catch {
      return false;
    }
    const current = store.getState();
    if (
      disposed ||
      !currentWorkspaceFileScope(current, observation) ||
      selectors.workspaceFileDraft(current) !== draft ||
      !canSaveWorkspaceFile(current)
    )
      return false;
    const identity: WorkspaceFileSaveIdentity = Object.freeze({
      ...observation,
      draft,
      operationId,
      request,
      backupId,
      digest,
    });
    return submitMutation(
      request,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      identity,
    );
  }
  let configurationFlight:
    | { identity: ConfigurationLoadIdentity; abort: AbortController }
    | undefined;
  function cancelConfigurationLoad(kind?: ConfigurationDraftKind) {
    const flight = configurationFlight;
    if (!flight || (kind && kind !== flight.identity.kind)) return;
    configurationFlight = undefined;
    flight.abort.abort();
    dispatch({ type: "configuration.cancel", identity: flight.identity });
  }
  // Explicit content reads never subscribe to polling/refocus. This listener
  // only cancels an already requested read when its exact draft identity ends.
  const unsubscribeConfiguration = store.subscribe((next) => {
    const flight = configurationFlight;
    if (!flight) return;
    const { identity } = flight;
    const workspace = next.lists.workspaces.find(
      (w) => w.id === next.selection.workspaceId,
    );
    const draft =
      next.configurationDrafts[
        configurationDraftKey(
          identity.workspaceId,
          identity.path,
          identity.kind,
        )
      ];
    if (
      next.epoch !== identity.epoch ||
      workspace?.id !== identity.workspaceId ||
      workspace.path !== identity.path ||
      draft?.fileRequest !== identity ||
      draft.revision !== identity.revision
    )
      cancelConfigurationLoad();
  });
  async function loadConfigurationDraft(kind: ConfigurationDraftKind) {
    const initial = store.getState();
    if (
      disposed ||
      !["instructions", "mcp"].includes(kind) ||
      initial.configurationIO.saves > 0 ||
      Boolean(selectors.extensions(initial).request) ||
      Boolean(initial.skillRuntime.request) ||
      Boolean(initial.agentRuntime.request) ||
      Boolean(initial.agentFiles.request) ||
      Object.values(initial.agentDrafts).some((d) => d.request) ||
      Object.values(initial.operations).some(
        (i) =>
          (i.operation.type.startsWith("configuration.mcp.") ||
            i.operation.type === "configuration.save" ||
            i.operation.type === "configuration.instructions.apply" ||
            i.operation.type === "configuration.instructions.remove") &&
          (i.status === "pending" ||
            ((unknownOperationHeld(i) || i.hostHeld) &&
              (!i.operation.workspaceId ||
                i.operation.workspaceId === initial.selection.workspaceId))),
      )
    )
      return false;
    cancelConfigurationLoad();
    const state = store.getState();
    const workspace = state.lists.workspaces.find(
      (w) => w.id === state.selection.workspaceId,
    );
    if (!workspace || !state.epoch) return false;
    const draft =
      state.configurationDrafts[
        configurationDraftKey(workspace.id, workspace.path, kind)
      ] ?? emptyConfigurationDraft;
    const identity: ConfigurationLoadIdentity = Object.freeze({
      id: id(),
      epoch: state.epoch,
      workspaceId: workspace.id,
      path: workspace.path,
      kind,
      revision: draft.revision,
    });
    const abort = new AbortController();
    dispatch({ type: "configuration.load", identity });
    if (
      store.getState().configurationDrafts[
        configurationDraftKey(workspace.id, workspace.path, kind)
      ]?.fileRequest !== identity
    )
      return false;
    configurationFlight = { identity, abort };
    const result = await transport.read<WorkbenchConfigurationFile>(
      { type: "configuration.read", workspaceId: workspace.id, kind },
      identity.epoch,
      abort.signal,
    );
    if (
      disposed ||
      abort.signal.aborted ||
      configurationFlight?.identity !== identity
    )
      return false;
    configurationFlight = undefined;
    dispatch(
      result.ok
        ? { type: "configuration.loaded", identity, value: result.value }
        : { type: "configuration.loaded", identity, error: result.code },
    );
    const loaded =
      store.getState().configurationDrafts[
        configurationDraftKey(workspace.id, workspace.path, kind)
      ];
    return Boolean(
      result.ok &&
        result.value?.status === "available" &&
        loaded?.revision === identity.revision + 1 &&
        loaded.baselineFile?.version === result.value.version &&
        loaded.text === result.value.content,
    );
  }
  async function saveConfigurationDraft(
    kind: ConfigurationDraftKind,
  ): Promise<boolean> {
    const state = store.getState();
    if (disposed || !canSaveConfigurationDraft(state, kind)) return false;
    const workspace = state.lists.workspaces.find(
      (w) => w.id === state.selection.workspaceId,
    )!;
    const key = configurationDraftKey(workspace.id, workspace.path, kind);
    const draft = state.configurationDrafts[key]!;
    const operationId = id();
    const request = Object.freeze({
      type: "configuration.save" as const,
      workspaceId: workspace.id,
      requestId: id(),
      kind,
      text: draft.text,
      ...(draft.fileRead?.status === "missing"
        ? { expectation: "missing" as const }
        : {
            expectation: "version" as const,
            version: draft.baselineFile!.version,
          }),
    });
    let backupId: string | undefined;
    if (request.expectation === "version") {
      try {
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(operationKey(state.epoch!, operationId)),
        );
        backupId = `.omoc-configuration-${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")}.${kind}.backup`;
      } catch {
        return false;
      }
    }
    // Hashing does not reserve a lane. Recheck the exact draft after that await.
    const current = store.getState();
    if (
      disposed ||
      current.epoch !== state.epoch ||
      current.selection.generation !== state.selection.generation ||
      current.selection.workspaceId !== workspace.id ||
      current.configurationDrafts[key] !== draft ||
      !canSaveConfigurationDraft(current, kind)
    )
      return false;
    const identity = Object.freeze({
      operationId,
      epoch: state.epoch!,
      workspaceId: workspace.id,
      path: workspace.path,
      kind,
      revision: draft.revision,
      floor: current.revision,
      ...(backupId ? { backupId } : {}),
      request,
    });
    return submitMutation(request, false, undefined, identity);
  }
  let skillFlight:
    | { identity: SkillIdentity; abort: AbortController; list: boolean }
    | undefined;
  function cancelSkillRead() {
    const flight = skillFlight;
    if (!flight) return;
    skillFlight = undefined;
    flight.abort.abort();
    dispatch({
      type: flight.list ? "skill.listed" : "skill.loaded",
      identity: flight.identity,
      error: "CANCELLED",
    });
  }
  const unsubscribeSkills = store.subscribe((next) => {
    const flight = skillFlight;
    if (!flight) return;
    const identity = flight.identity;
    const request = flight.list
      ? next.skillFiles.request
      : identity.sourceName
        ? next.skillDrafts[
            skillDraftKey(
              identity.workspaceId,
              identity.path,
              identity.sourceName,
            )
          ]?.request
        : undefined;
    if (!currentSkillScope(next, identity) || request !== identity)
      cancelSkillRead();
  });
  async function readSkill(list: boolean): Promise<boolean> {
    const state = store.getState();
    if (disposed || !canReadSkillFiles(state)) return false;
    const workspace = state.lists.workspaces.find(
      (w) => w.id === state.selection.workspaceId,
    )!;
    const sourceName = state.skillFiles.sourceName;
    if (!list && !sourceName) return false;
    const identity: SkillIdentity = Object.freeze({
      epoch: state.epoch!,
      workspaceId: workspace.id,
      path: workspace.path,
      generation: state.skillFiles.generation,
      selectionGeneration: state.selection.generation,
      trustRevision: workspace.trustRevision,
      floor: state.revision,
      ...(!list ? { sourceName, draft: selectors.skillDraft(state) } : {}),
    });
    dispatch({ type: list ? "skill.list" : "skill.read", identity });
    const request = list
      ? store.getState().skillFiles.request
      : selectors.skillDraft(store.getState()).request;
    if (request !== identity) return false;
    const abort = new AbortController();
    skillFlight = { identity, abort, list };
    if (list) {
      const result = await transport.read<WorkbenchSkillFiles>(
        { type: "configuration.skill.list", workspaceId: workspace.id },
        identity.epoch,
        abort.signal,
      );
      if (
        disposed ||
        abort.signal.aborted ||
        skillFlight?.identity !== identity
      )
        return false;
      skillFlight = undefined;
      dispatch(
        result.ok
          ? { type: "skill.listed", identity, value: result.value }
          : { type: "skill.listed", identity, error: result.code },
      );
      return (
        !store.getState().skillFiles.error &&
        store.getState().skillFiles.listingIdentity === identity
      );
    }
    const result = await transport.read<WorkbenchSkillFile>(
      {
        type: "configuration.skill.read",
        workspaceId: workspace.id,
        sourceName: sourceName!,
      },
      identity.epoch,
      abort.signal,
    );
    if (disposed || abort.signal.aborted || skillFlight?.identity !== identity)
      return false;
    skillFlight = undefined;
    dispatch(
      result.ok
        ? { type: "skill.loaded", identity, value: result.value }
        : { type: "skill.loaded", identity, error: result.code },
    );
    return selectors.skillDraft(store.getState()).observation === identity;
  }
  async function saveSkillFile(): Promise<boolean> {
    const state = store.getState();
    if (disposed || !canSaveSkillFile(state)) return false;
    const draft = selectors.skillDraft(state),
      observation = draft.observation!,
      read = draft.read!;
    if (read.status !== "available" && read.status !== "missing") return false;
    const operationId = id();
    const request = Object.freeze({
      type: "configuration.skill.save" as const,
      workspaceId: observation.workspaceId,
      sourceName: observation.sourceName!,
      requestId: id(),
      text: draft.text,
      directoryVersion: read.directoryVersion,
      ...(read.status === "available"
        ? { expectation: "version" as const, version: read.version }
        : { expectation: "missing" as const }),
    });
    let backupId: string | undefined;
    if (request.expectation === "version") {
      try {
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(operationKey(state.epoch!, operationId)),
        );
        backupId = `.omoc-configuration-${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")}.skill.backup`;
      } catch {
        return false;
      }
    }
    const current = store.getState();
    if (
      disposed ||
      !currentSkillScope(current, observation) ||
      selectors.skillDraft(current) !== draft ||
      !canSaveSkillFile(current)
    )
      return false;
    const identity: SkillSaveIdentity = Object.freeze({
      ...observation,
      sourceName: request.sourceName,
      draft,
      operationId,
      request,
      ...(backupId ? { backupId } : {}),
    });
    return submitMutation(
      request,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      identity,
    );
  }
  let agentFlight:
    | { identity: AgentIdentity; abort: AbortController; list: boolean }
    | undefined;
  function cancelAgentRead() {
    const flight = agentFlight;
    if (!flight) return;
    agentFlight = undefined;
    flight.abort.abort();
    dispatch({
      type: flight.list ? "agent.listed" : "agent.loaded",
      identity: flight.identity,
      error: "CANCELLED",
    });
  }
  const unsubscribeAgents = store.subscribe((next) => {
    const flight = agentFlight;
    if (!flight) return;
    const identity = flight.identity;
    const request = flight.list
      ? next.agentFiles.request
      : identity.sourceName
        ? next.agentDrafts[
            agentDraftKey(
              identity.workspaceId,
              identity.path,
              identity.sourceName,
            )
          ]?.request
        : undefined;
    if (!currentAgentScope(next, identity) || request !== identity)
      cancelAgentRead();
  });
  async function readAgent(list: boolean): Promise<boolean> {
    const state = store.getState();
    if (disposed || !canReadAgentFiles(state)) return false;
    const workspace = state.lists.workspaces.find(
      (w) => w.id === state.selection.workspaceId,
    )!;
    const sourceName = state.agentFiles.sourceName;
    if (!list && !sourceName) return false;
    const identity: AgentIdentity = Object.freeze({
      epoch: state.epoch!,
      workspaceId: workspace.id,
      path: workspace.path,
      generation: state.agentFiles.generation,
      selectionGeneration: state.selection.generation,
      trustRevision: workspace.trustRevision,
      floor: state.revision,
      ...(!list ? { sourceName, draft: selectors.agentDraft(state) } : {}),
    });
    dispatch({ type: list ? "agent.list" : "agent.read", identity });
    const request = list
      ? store.getState().agentFiles.request
      : selectors.agentDraft(store.getState()).request;
    if (request !== identity) return false;
    const abort = new AbortController();
    agentFlight = { identity, abort, list };
    if (list) {
      const result = await transport.read<WorkbenchAgentFiles>(
        { type: "configuration.agent.list", workspaceId: workspace.id },
        identity.epoch,
        abort.signal,
      );
      if (
        disposed ||
        abort.signal.aborted ||
        agentFlight?.identity !== identity
      )
        return false;
      agentFlight = undefined;
      dispatch(
        result.ok
          ? { type: "agent.listed", identity, value: result.value }
          : { type: "agent.listed", identity, error: result.code },
      );
      return (
        !store.getState().agentFiles.error &&
        store.getState().agentFiles.listingIdentity === identity
      );
    }
    const result = await transport.read<WorkbenchAgentFile>(
      {
        type: "configuration.agent.read",
        workspaceId: workspace.id,
        sourceName: sourceName!,
      },
      identity.epoch,
      abort.signal,
    );
    if (disposed || abort.signal.aborted || agentFlight?.identity !== identity)
      return false;
    agentFlight = undefined;
    dispatch(
      result.ok
        ? { type: "agent.loaded", identity, value: result.value }
        : { type: "agent.loaded", identity, error: result.code },
    );
    return selectors.agentDraft(store.getState()).observation === identity;
  }
  async function saveAgentFile(): Promise<boolean> {
    const state = store.getState();
    if (disposed || !canSaveAgentFile(state)) return false;
    const draft = selectors.agentDraft(state),
      observation = draft.observation!,
      read = draft.read!;
    if (read.status !== "available" && read.status !== "missing") return false;
    const operationId = id();
    const request = Object.freeze({
      type: "configuration.agent.save" as const,
      workspaceId: observation.workspaceId,
      sourceName: observation.sourceName!,
      requestId: operationId,
      text: draft.text,
      directoryVersion: read.directoryVersion,
      ...(read.status === "available"
        ? { expectation: "version" as const, version: read.version }
        : { expectation: "missing" as const }),
    });
    let backupId: string | undefined;
    if (request.expectation === "version") {
      try {
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(operationKey(state.epoch!, operationId)),
        );
        backupId = `.omoc-configuration-${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")}.agent.backup`;
      } catch {
        return false;
      }
    }
    const current = store.getState();
    if (
      disposed ||
      !currentAgentScope(current, observation) ||
      selectors.agentDraft(current) !== draft ||
      !canSaveAgentFile(current)
    )
      return false;
    const identity: AgentSaveIdentity = Object.freeze({
      ...observation,
      sourceName: request.sourceName,
      draft,
      operationId,
      request,
      ...(backupId ? { backupId } : {}),
    });
    return submitMutation(
      request,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      identity,
    );
  }
  const sha256 = async (text: string) =>
    Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
      ),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
  const nativeIdFor = async (
    runtimeEpoch: string,
    workspaceId: string,
    sourceName: string,
    operationId: string,
  ) =>
    `omoc-skill-${await sha256(skillRuntimeIdPayload({ runtimeEpoch, workspaceId, sourceName, operationId }))}`;
  async function verifiedSkillReceipt(
    receipt: RedactedReceipt,
  ): Promise<boolean> {
    if (!skillRuntimeStep(receipt.type) || receipt.effect !== "confirmed")
      return true;
    try {
      const result = receipt.result;
      if (
        !result ||
        !["skill_registered", "skill_removed", "skill_applied"].includes(
          result.kind,
        ) ||
        !("registrationRuntimeEpoch" in result) ||
        !("workspaceId" in result)
      )
        return false;
      return (
        result.nativeId ===
        (await nativeIdFor(
          result.registrationRuntimeEpoch,
          result.workspaceId,
          result.sourceName,
          result.registrationOperationId,
        ))
      );
    } catch {
      return false;
    }
  }
  const agentNativeIdFor = async (
    runtimeEpoch: string,
    workspaceId: string,
    sourceName: string,
    operationId: string,
  ) =>
    `omoc-agent-${await sha256(agentRuntimeIdPayload({ runtimeEpoch, workspaceId, sourceName, operationId }))}`;
  async function verifiedAgentReceipt(
    receipt: RedactedReceipt,
  ): Promise<boolean> {
    if (!agentRuntimeStep(receipt.type) || receipt.effect !== "confirmed")
      return true;
    try {
      const result = receipt.result;
      if (
        !result ||
        !["agent_registered", "agent_removed"].includes(result.kind) ||
        !("registrationRuntimeEpoch" in result) ||
        !("workspaceId" in result)
      )
        return false;
      return (
        result.nativeId ===
        (await agentNativeIdFor(
          result.registrationRuntimeEpoch,
          result.workspaceId,
          result.sourceName,
          result.registrationOperationId,
        ))
      );
    } catch {
      return false;
    }
  }
  let skillRuntimeFlight:
    | { identity: SkillRuntimeIdentity; abort: AbortController }
    | undefined;
  function cancelSkillRuntimeObservation() {
    const flight = skillRuntimeFlight;
    if (!flight) return;
    skillRuntimeFlight = undefined;
    flight.abort.abort();
    dispatch({
      type: "skill.runtime.observed",
      identity: flight.identity,
      error: "CANCELLED",
    });
  }
  const unsubscribeSkillRuntime = store.subscribe((next) => {
    const flight = skillRuntimeFlight;
    if (
      flight &&
      (!currentSkillRuntimeScope(next, flight.identity) ||
        next.skillRuntime.request !== flight.identity)
    )
      cancelSkillRuntimeObservation();
  });
  function skillRuntimeIdentity(): SkillRuntimeIdentity {
    const state = store.getState(),
      workspace = state.lists.workspaces.find(
        (w) => w.id === state.selection.workspaceId,
      )!;
    return Object.freeze({
      epoch: state.epoch!,
      workspaceId: workspace.id,
      path: workspace.path,
      trustRevision: workspace.trustRevision,
      generation: state.skillFiles.generation,
      selectionGeneration: state.selection.generation,
      floor: state.revision,
      draft: selectors.skillDraft(state),
      ...(state.selection.sessionId
        ? { sessionId: state.selection.sessionId }
        : {}),
      ...(state.skillFiles.sourceName
        ? { sourceName: state.skillFiles.sourceName }
        : {}),
    });
  }
  async function observeSkillRuntime(): Promise<boolean> {
    if (disposed || !canObserveSkillRuntime(store.getState())) return false;
    const identity = skillRuntimeIdentity(),
      abort = new AbortController();
    dispatch({ type: "skill.runtime.read", identity });
    if (store.getState().skillRuntime.request !== identity) return false;
    skillRuntimeFlight = { identity, abort };
    const result = await transport.read<WorkbenchSkillRuntimeObservation>(
      {
        type: "configuration.skill.runtime.read",
        workspaceId: identity.workspaceId,
        ...(identity.sessionId ? { sessionId: identity.sessionId } : {}),
        ...(identity.sourceName ? { sourceName: identity.sourceName } : {}),
      },
      identity.epoch,
      abort.signal,
    );
    if (
      disposed ||
      abort.signal.aborted ||
      skillRuntimeFlight?.identity !== identity
    )
      return false;
    let value: WorkbenchSkillRuntimeObservation | undefined,
      error: string | undefined;
    let digest: string | undefined;
    try {
      if (!result.ok) error = result.code;
      else if (!validSkillRuntimeObservation(result.value))
        error = "SKILL_UNVERIFIED";
      else {
        // Clone before asynchronous hashing so transport callers cannot change the disclosure.
        value = structuredClone(result.value);
        if (value.status === "observed") {
          for (const row of value.owned) {
            if (
              row.nativeId !==
                (await nativeIdFor(
                  row.registrationRuntimeEpoch,
                  value.workspaceId,
                  row.sourceName,
                  row.registrationOperationId,
                )) ||
              row.bodyDigest !== (await sha256(row.content)) ||
              row.nativeDigest !==
                (await sha256(
                  JSON.stringify([
                    row.nativeId,
                    row.name,
                    row.description ?? null,
                    false,
                    row.path,
                    row.content,
                  ]),
                ))
            )
              throw new Error("SKILL_UNVERIFIED");
          }
          if (identity.draft?.read?.status === "available")
            digest = await sha256(identity.draft.text);
        }
      }
    } catch {
      value = undefined;
      error = "SKILL_UNVERIFIED";
    }
    if (
      disposed ||
      abort.signal.aborted ||
      skillRuntimeFlight?.identity !== identity ||
      !currentSkillRuntimeScope(store.getState(), identity)
    )
      return false;
    skillRuntimeFlight = undefined;
    // The digest is proof of the exact captured file, never an editable request payload.
    if (value)
      dispatch({
        type: "skill.runtime.observed",
        identity,
        value,
        ...(digest ? { digest } : {}),
      });
    else
      dispatch({
        type: "skill.runtime.observed",
        identity,
        error: error ?? "SKILL_UNVERIFIED",
      });
    return Boolean(
      store.getState().skillRuntime.observationIdentity &&
        !store.getState().skillRuntime.error,
    );
  }

  async function mutateSkillRuntime(
    action: "register" | "remove" | "apply",
    nativeId?: string,
  ): Promise<boolean> {
    const allowed = () =>
      action === "register"
        ? canRegisterSkill(store.getState())
        : action === "remove"
          ? canRemoveSkill(store.getState(), nativeId)
          : canApplySkill(store.getState(), nativeId);
    if (disposed || !allowed()) return false;
    const state = store.getState(),
      captured = skillRuntimeIdentity(),
      entry = state.skillRuntime,
      observation = currentSkillRuntimeObservation(state);
    if (observation?.status !== "observed") return false;
    const operationId = id();
    let target: SkillRuntimeMutationIdentity["target"],
      version: string | undefined,
      directoryVersion: string | undefined;
    try {
      if (action === "register") {
        const file = observation.file;
        if (file?.status !== "available") return false;
        let content = captured.draft!.text.replace(/^\uFEFF/u, ""),
          name = file.sourceName,
          description: string | undefined;
        if (content.startsWith("---")) {
          const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(content);
          if (!match) return false;
          for (const line of match[1]!.split(/\r?\n/u)) {
            if (line.startsWith("name: ")) name = JSON.parse(line.slice(6));
            if (line.startsWith("description: "))
              description = JSON.parse(line.slice(13));
          }
          content = content.slice(match[0].length);
        }
        const allocated = await nativeIdFor(
          captured.epoch,
          captured.workspaceId,
          file.sourceName,
          operationId,
        );
        target = Object.freeze({
          sourceName: file.sourceName,
          nativeId: allocated,
          digest: file.digest,
          registrationRuntimeEpoch: captured.epoch,
          registrationOperationId: operationId,
          bodyDigest: await sha256(content),
          nativeDigest: await sha256(
            JSON.stringify([
              allocated,
              name,
              description ?? null,
              false,
              `${captured.path}/.opencode/skills/${file.sourceName}/SKILL.md`,
              content,
            ]),
          ),
        });
        version = file.version;
        directoryVersion = file.directoryVersion;
      } else {
        const row = observation.owned.find((row) => row.nativeId === nativeId)!;
        // Retain only immutable proof fields, not Native content or an executable request.
        target = Object.freeze({
          sourceName: row.sourceName,
          nativeId: row.nativeId,
          digest: row.digest,
          nativeDigest: row.nativeDigest,
          registrationRuntimeEpoch: row.registrationRuntimeEpoch,
          registrationOperationId: row.registrationOperationId,
          bodyDigest: row.bodyDigest,
        });
      }
    } catch {
      return false;
    }
    if (
      disposed ||
      !currentSkillRuntimeScope(store.getState(), captured) ||
      store.getState().skillRuntime !== entry ||
      !allowed()
    )
      return false;
    const common = {
      workspaceId: captured.workspaceId,
      requestId: operationId,
      observationId: observation.observationId,
    };
    const request: SkillRuntimeRequest = Object.freeze(
      action === "register"
        ? {
            type: "configuration.skill.register",
            ...common,
            sourceName: target.sourceName,
            digest: target.digest,
            version: version!,
            directoryVersion: directoryVersion!,
          }
        : action === "remove"
          ? {
              type: "configuration.skill.remove",
              ...common,
              nativeId: target.nativeId,
            }
          : {
              type: "configuration.skill.apply",
              ...common,
              nativeId: target.nativeId,
              sessionId: captured.sessionId!,
            },
    );
    const identity: SkillRuntimeMutationIdentity = Object.freeze({
      ...captured,
      operationId,
      type: request.type,
      observationId: observation.observationId,
      target,
      ...(version ? { version, directoryVersion: directoryVersion! } : {}),
    });
    return submitMutation(
      request,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      identity,
    );
  }
  const agentNativeDigest = (
    nativeId: string,
    sourceName: string,
    row: { system: string; description?: string; color?: string },
  ) =>
    sha256(
      JSON.stringify([
        nativeId,
        sourceName,
        row.system,
        row.description ?? null,
        row.color ?? null,
        "primary",
        false,
        {},
        {},
        {},
        BASELINE_POLICY.map((r) => [r.action, r.resource, r.effect]),
      ]),
    );
  let permissionPolicyFlight:
    | { identity: PermissionPolicyIdentity; abort: AbortController }
    | undefined;
  function cancelPermissionPolicyObservation(
    error: PermissionPolicy["error"] = "CANCELLED",
  ) {
    const flight = permissionPolicyFlight;
    if (!flight) return;
    permissionPolicyFlight = undefined;
    flight.abort.abort();
    dispatch({
      type: "permission.policy.observed",
      identity: flight.identity,
      error,
    });
  }
  const unsubscribePermissionPolicy = store.subscribe((next) => {
    const flight = permissionPolicyFlight;
    if (
      flight &&
      (!currentPermissionPolicyScope(next, flight.identity) ||
        next.permissionPolicy.request !== flight.identity)
    )
      cancelPermissionPolicyObservation("STALE");
  });
  async function observePermissionPolicy(): Promise<boolean> {
    const state = store.getState();
    if (disposed || !canObservePermissionPolicy(state)) return false;
    const workspace = state.lists.workspaces.find(
      (w) => w.id === state.selection.workspaceId,
    )!;
    const identity: PermissionPolicyIdentity = Object.freeze({
      epoch: state.epoch!,
      workspaceId: workspace.id,
      workspacePath: workspace.path,
      sessionId: state.selection.sessionId!,
      trustRevision: workspace.trustRevision,
      selectionGeneration: state.selection.generation,
      generation: state.permissionPolicy.generation,
      floor: state.revision,
    });
    const abort = new AbortController();
    dispatch({ type: "permission.policy.read", identity });
    if (store.getState().permissionPolicy.request !== identity) return false;
    permissionPolicyFlight = { identity, abort };
    const result = await transport.read<WorkbenchPermissionPolicyObservation>(
      {
        type: "permission.policy.read",
        workspaceId: identity.workspaceId,
        sessionId: identity.sessionId,
      },
      identity.epoch,
      abort.signal,
    );
    if (
      disposed ||
      abort.signal.aborted ||
      permissionPolicyFlight?.identity !== identity
    )
      return false;
    let value: WorkbenchPermissionPolicyObservation | undefined,
      error: PermissionPolicy["error"];
    try {
      if (result.ok)
        value = structuredClone(
          validatePermissionPolicyObservation(result.value),
        );
      else
        error =
          result.code === "READ_TIMEOUT" || result.code === "READ_BUSY"
            ? result.code
            : "UNAVAILABLE";
    } catch {
      error = "POLICY_UNVERIFIED";
    }
    permissionPolicyFlight = undefined;
    dispatch({
      type: "permission.policy.observed",
      identity,
      ...(value ? { value } : { error: error ?? "POLICY_UNVERIFIED" }),
    });
    return (
      selectors.currentPermissionPolicyObservation(store.getState()) !==
      undefined
    );
  }
  let extensionFlight:
    | { identity: ExtensionIdentity; abort: AbortController }
    | undefined;
  function cancelExtensionObservation(error: ExtensionError = "CANCELLED") {
    const flight = extensionFlight;
    if (!flight) return;
    extensionFlight = undefined;
    flight.abort.abort();
    dispatch({ type: "extensions.observed", identity: flight.identity, error });
  }
  const unsubscribeExtensions = store.subscribe((next) => {
    const flight = extensionFlight;
    if (
      flight &&
      (!currentExtensionScope(next, flight.identity) ||
        next.extensions[flight.identity.workspaceId]?.request !==
          flight.identity)
    )
      cancelExtensionObservation("STALE");
  });
  async function observeExtensions(): Promise<boolean> {
    const state = store.getState();
    if (disposed || !canObserveExtensions(state)) return false;
    const workspace = state.lists.workspaces.find(
      (w) => w.id === state.selection.workspaceId,
    )!;
    const identity: ExtensionIdentity = Object.freeze({
      epoch: state.epoch!,
      workspaceId: workspace.id,
      path: workspace.path,
      trustRevision: workspace.trustRevision,
      selectionGeneration: state.selection.generation,
      generation: state.extensionsGeneration,
      floor: state.revision,
    });
    const abort = new AbortController();
    dispatch({ type: "extensions.read", identity });
    if (store.getState().extensions[identity.workspaceId]?.request !== identity)
      return false;
    extensionFlight = { identity, abort };
    const result = await transport.read<WorkbenchExtensionsObservation>(
      {
        type: "configuration.extensions.read",
        workspaceId: identity.workspaceId,
      },
      identity.epoch,
      abort.signal,
    );
    if (
      disposed ||
      abort.signal.aborted ||
      extensionFlight?.identity !== identity
    )
      return false;
    let value: WorkbenchExtensionsObservation | undefined,
      error: ExtensionError | undefined;
    try {
      if (result.ok)
        value = structuredClone(validateExtensionsObservation(result.value));
      else
        error =
          result.code === "READ_TIMEOUT" || result.code === "READ_BUSY"
            ? result.code
            : "UNAVAILABLE";
    } catch {
      error = "EXTENSIONS_UNVERIFIED";
    }
    extensionFlight = undefined;
    dispatch({
      type: "extensions.observed",
      identity,
      ...(value ? { value } : { error: error ?? "EXTENSIONS_UNVERIFIED" }),
    });
    return (
      selectors.currentExtensionObservation(store.getState()) !== undefined
    );
  }
  let agentRuntimeFlight:
    | { identity: AgentRuntimeIdentity; abort: AbortController }
    | undefined;
  function cancelAgentRuntimeObservation() {
    const flight = agentRuntimeFlight;
    if (!flight) return;
    agentRuntimeFlight = undefined;
    flight.abort.abort();
    dispatch({
      type: "agent.runtime.observed",
      identity: flight.identity,
      error: "CANCELLED",
    });
  }
  const unsubscribeAgentRuntime = store.subscribe((next) => {
    const flight = agentRuntimeFlight;
    if (
      flight &&
      (!currentAgentRuntimeScope(next, flight.identity) ||
        next.agentRuntime.request !== flight.identity)
    )
      cancelAgentRuntimeObservation();
  });
  function agentRuntimeIdentity(): AgentRuntimeIdentity {
    const state = store.getState(),
      workspace = state.lists.workspaces.find(
        (w) => w.id === state.selection.workspaceId,
      )!;
    return Object.freeze({
      epoch: state.epoch!,
      workspaceId: workspace.id,
      path: workspace.path,
      trustRevision: workspace.trustRevision,
      generation: state.agentFiles.generation,
      selectionGeneration: state.selection.generation,
      floor: state.revision,
      draft: selectors.agentDraft(state),
      ...(state.agentFiles.sourceName
        ? { sourceName: state.agentFiles.sourceName }
        : {}),
    });
  }
  async function observeAgentRuntime(): Promise<boolean> {
    if (disposed || !canObserveAgentRuntime(store.getState())) return false;
    const identity = agentRuntimeIdentity(),
      abort = new AbortController();
    dispatch({ type: "agent.runtime.read", identity });
    if (store.getState().agentRuntime.request !== identity) return false;
    agentRuntimeFlight = { identity, abort };
    const result = await transport.read<WorkbenchAgentRuntimeObservation>(
      {
        type: "configuration.agent.runtime.read",
        workspaceId: identity.workspaceId,
        ...(identity.sourceName ? { sourceName: identity.sourceName } : {}),
      },
      identity.epoch,
      abort.signal,
    );
    if (
      disposed ||
      abort.signal.aborted ||
      agentRuntimeFlight?.identity !== identity
    )
      return false;
    let value: WorkbenchAgentRuntimeObservation | undefined,
      error: string | undefined;
    let digest: string | undefined;
    try {
      if (!result.ok) error = result.code;
      else if (!validAgentRuntimeObservation(result.value))
        error = "AGENT_UNVERIFIED";
      else {
        // Clone before asynchronous hashing so transport callers cannot change the disclosure.
        value = structuredClone(result.value);
        if (value.status === "observed") {
          for (const row of value.owned) {
            if (
              row.nativeId !==
                (await agentNativeIdFor(
                  row.registrationRuntimeEpoch,
                  value.workspaceId,
                  row.sourceName,
                  row.registrationOperationId,
                )) ||
              row.systemDigest !== (await sha256(row.system)) ||
              row.nativeDigest !==
                (await agentNativeDigest(row.nativeId, row.sourceName, row))
            )
              throw new Error("AGENT_UNVERIFIED");
          }
          if (identity.draft?.read?.status === "available")
            digest = await sha256(identity.draft.text);
        }
      }
    } catch {
      value = undefined;
      error = "AGENT_UNVERIFIED";
    }
    if (
      disposed ||
      abort.signal.aborted ||
      agentRuntimeFlight?.identity !== identity ||
      !currentAgentRuntimeScope(store.getState(), identity)
    )
      return false;
    agentRuntimeFlight = undefined;
    // The digest is proof of the exact captured file, never an editable request payload.
    if (value)
      dispatch({
        type: "agent.runtime.observed",
        identity,
        value,
        ...(digest ? { digest } : {}),
      });
    else
      dispatch({
        type: "agent.runtime.observed",
        identity,
        error: error ?? "AGENT_UNVERIFIED",
      });
    return Boolean(
      store.getState().agentRuntime.observationIdentity &&
        !store.getState().agentRuntime.error,
    );
  }

  async function mutateAgentRuntime(
    action: "register" | "remove",
    nativeId?: string,
  ): Promise<boolean> {
    const allowed = () =>
      action === "register"
        ? canRegisterAgent(store.getState())
        : canRemoveAgent(store.getState(), nativeId);
    if (disposed || !allowed()) return false;
    const state = store.getState(),
      captured = agentRuntimeIdentity(),
      entry = state.agentRuntime,
      observation = currentAgentRuntimeObservation(state);
    if (observation?.status !== "observed") return false;
    const operationId = id();
    let target: AgentRuntimeMutationIdentity["target"],
      version: string | undefined,
      directoryVersion: string | undefined;
    try {
      if (action === "register") {
        const file = observation.file;
        if (file?.status !== "available") return false;
        const parsed = parseAgentFile(captured.draft!.text);
        if (!parsed) return false;
        const allocated = await agentNativeIdFor(
          captured.epoch,
          captured.workspaceId,
          file.sourceName,
          operationId,
        );
        target = Object.freeze({
          sourceName: file.sourceName,
          nativeId: allocated,
          digest: file.digest,
          registrationRuntimeEpoch: captured.epoch,
          registrationOperationId: operationId,
          systemDigest: await sha256(parsed.system),
          nativeDigest: await agentNativeDigest(
            allocated,
            file.sourceName,
            parsed,
          ),
        });
        version = file.version;
        directoryVersion = file.directoryVersion;
      } else {
        const row = observation.owned.find((row) => row.nativeId === nativeId)!;
        // Retain only immutable proof fields, not Native content or an executable request.
        target = Object.freeze({
          sourceName: row.sourceName,
          nativeId: row.nativeId,
          digest: row.digest,
          nativeDigest: row.nativeDigest,
          registrationRuntimeEpoch: row.registrationRuntimeEpoch,
          registrationOperationId: row.registrationOperationId,
          systemDigest: row.systemDigest,
        });
      }
    } catch {
      return false;
    }
    if (
      disposed ||
      !currentAgentRuntimeScope(store.getState(), captured) ||
      store.getState().agentRuntime !== entry ||
      !allowed()
    )
      return false;
    const common = {
      workspaceId: captured.workspaceId,
      requestId: operationId,
      observationId: observation.observationId,
    };
    const request: AgentRuntimeRequest = Object.freeze(
      action === "register"
        ? {
            type: "configuration.agent.register",
            ...common,
            sourceName: target.sourceName,
            digest: target.digest,
            version: version!,
            directoryVersion: directoryVersion!,
          }
        : {
            type: "configuration.agent.remove",
            ...common,
            nativeId: target.nativeId,
          },
    );
    const identity: AgentRuntimeMutationIdentity = Object.freeze({
      ...captured,
      operationId,
      type: request.type,
      observationId: observation.observationId,
      target,
      defaultAgentId: observation.defaultAgentId!,
      ...(version ? { version, directoryVersion: directoryVersion! } : {}),
    });
    return submitMutation(
      request,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      identity,
    );
  }
  let instructionsFlight:
    | { identity: InstructionIdentity; abort: AbortController }
    | undefined;
  function cancelInstructionObservation() {
    const flight = instructionsFlight;
    if (!flight) return;
    instructionsFlight = undefined;
    flight.abort.abort();
    dispatch({
      type: "instructions.observed",
      identity: flight.identity,
      error: "CANCELLED",
    });
  }
  const unsubscribeInstructions = store.subscribe((next) => {
    const flight = instructionsFlight;
    if (!flight) return;
    const identity = flight.identity;
    if (
      next.epoch !== identity.epoch ||
      next.selection.generation !== identity.generation ||
      selectors.instructions(next).request !== identity ||
      !next.lists.workspaces.some(
        (w) =>
          w.id === identity.workspaceId &&
          w.path === identity.path &&
          w.trustRevision === identity.trustRevision,
      )
    )
      cancelInstructionObservation();
  });
  function instructionIdentity(): InstructionIdentity {
    const state = store.getState();
    const workspace = state.lists.workspaces.find(
      (w) => w.id === state.selection.workspaceId,
    )!;
    return Object.freeze({
      epoch: state.epoch!,
      workspaceId: workspace.id,
      sessionId: state.selection.sessionId!,
      path: workspace.path,
      trustRevision: workspace.trustRevision,
      generation: state.selection.generation,
      floor: state.revision,
      draft:
        state.configurationDrafts[
          configurationDraftKey(workspace.id, workspace.path, "instructions")
        ],
    });
  }
  async function observeInstructions(): Promise<boolean> {
    if (disposed || !canObserveInstructions(store.getState())) return false;
    const identity = instructionIdentity();
    const abort = new AbortController();
    dispatch({ type: "instructions.read", identity });
    if (selectors.instructions(store.getState()).request !== identity)
      return false;
    instructionsFlight = { identity, abort };
    const result = await transport.read<WorkbenchInstructionObservation>(
      {
        type: "configuration.instructions.read",
        workspaceId: identity.workspaceId,
        sessionId: identity.sessionId,
      },
      identity.epoch,
      abort.signal,
    );
    if (
      disposed ||
      abort.signal.aborted ||
      instructionsFlight?.identity !== identity
    )
      return false;
    instructionsFlight = undefined;
    dispatch(
      result.ok
        ? { type: "instructions.observed", identity, value: result.value }
        : { type: "instructions.observed", identity, error: result.code },
    );
    return (
      selectors.instructions(store.getState()).observationIdentity === identity
    );
  }
  async function mutateInstructions(apply: boolean): Promise<boolean> {
    const state = store.getState();
    if (
      disposed ||
      !(apply ? canApplyInstructions(state) : canRemoveInstructions(state))
    )
      return false;
    const captured = instructionIdentity();
    const entry = selectors.instructions(state);
    const observation = entry.observation!;
    if (observation.status === "unavailable") return false;
    const draft = captured.draft;
    const operationId = id(),
      requestId = id();
    const request = Object.freeze(
      apply
        ? {
            type: "configuration.instructions.apply" as const,
            workspaceId: captured.workspaceId,
            sessionId: captured.sessionId,
            requestId,
            text: draft!.text,
            fileVersion: draft!.baselineFile!.version,
            expectedRegistrationVersion: observation.version,
          }
        : {
            type: "configuration.instructions.remove" as const,
            workspaceId: captured.workspaceId,
            sessionId: captured.sessionId,
            requestId,
            expectedRegistrationVersion: observation.version,
          },
    );
    let digest: string | undefined;
    if (apply) {
      try {
        const bytes = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(draft!.text),
        );
        digest = Array.from(new Uint8Array(bytes), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join("");
      } catch {
        return false;
      }
    }
    const current = store.getState();
    if (
      disposed ||
      current.epoch !== captured.epoch ||
      current.selection.generation !== captured.generation ||
      current.revision !== captured.floor ||
      selectors.instructions(current) !== entry ||
      current.configurationDrafts[
        configurationDraftKey(
          captured.workspaceId,
          captured.path,
          "instructions",
        )
      ] !== draft ||
      !(apply ? canApplyInstructions(current) : canRemoveInstructions(current))
    )
      return false;
    const identity: InstructionMutationIdentity = Object.freeze({
      ...captured,
      operationId,
      request,
      observation,
      ...(digest ? { digest } : {}),
    });
    return submitMutation(request, false, undefined, undefined, identity);
  }
  let mcpFlight: { identity: McpIdentity; abort: AbortController } | undefined;
  function cancelMcpObservation() {
    const flight = mcpFlight;
    if (!flight) return;
    mcpFlight = undefined;
    flight.abort.abort();
    dispatch({
      type: "mcp.observed",
      identity: flight.identity,
      error: "CANCELLED",
    });
  }
  const unsubscribeMcp = store.subscribe((next) => {
    const flight = mcpFlight;
    if (!flight) return;
    const identity = flight.identity;
    if (
      next.epoch !== identity.epoch ||
      next.selection.generation !== identity.generation ||
      next.selection.workspaceId !== identity.workspaceId ||
      selectors.mcp(next).request !== identity ||
      !next.lists.workspaces.some(
        (w) =>
          w.id === identity.workspaceId &&
          w.path === identity.path &&
          w.trustRevision === identity.trustRevision &&
          w.trusted,
      )
    )
      cancelMcpObservation();
  });
  function mcpIdentity(): McpIdentity {
    const state = store.getState(),
      workspace = state.lists.workspaces.find(
        (w) => w.id === state.selection.workspaceId,
      )!;
    return Object.freeze({
      epoch: state.epoch!,
      workspaceId: workspace.id,
      path: workspace.path,
      trustRevision: workspace.trustRevision,
      generation: state.selection.generation,
      floor: state.revision,
      draft:
        state.configurationDrafts[
          configurationDraftKey(workspace.id, workspace.path, "mcp")
        ],
    });
  }
  async function observeMcp(): Promise<boolean> {
    if (disposed || !canObserveMcp(store.getState())) return false;
    const identity = mcpIdentity(),
      abort = new AbortController();
    dispatch({ type: "mcp.read", identity });
    if (selectors.mcp(store.getState()).request !== identity) return false;
    mcpFlight = { identity, abort };
    const result = await transport.read<WorkbenchMcpObservation>(
      { type: "configuration.mcp.read", workspaceId: identity.workspaceId },
      identity.epoch,
      abort.signal,
    );
    if (disposed || abort.signal.aborted || mcpFlight?.identity !== identity)
      return false;
    mcpFlight = undefined;
    dispatch(
      result.ok
        ? { type: "mcp.observed", identity, value: result.value }
        : { type: "mcp.observed", identity, error: result.code },
    );
    return selectors.mcp(store.getState()).observationIdentity === identity;
  }
  async function mutateMcp(
    action: "register" | "connect" | "disconnect" | "remove",
    sourceName: string,
  ): Promise<boolean> {
    const allowed = {
      register: canRegisterMcp,
      connect: canConnectMcp,
      disconnect: canDisconnectMcp,
      remove: canRemoveMcp,
    }[action];
    const state = store.getState();
    if (disposed || !allowed(state, sourceName)) return false;
    const captured = mcpIdentity(),
      entry = selectors.mcp(state),
      observation = entry.observation;
    if (observation?.status !== "observed") return false;
    let nativeName: string;
    try {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(
          JSON.stringify([captured.workspaceId, sourceName]),
        ),
      );
      nativeName =
        "omoc-mcp-" +
        Array.from(new Uint8Array(digest), (b) =>
          b.toString(16).padStart(2, "0"),
        )
          .join("")
          .slice(0, 40);
    } catch {
      return false;
    }
    const current = store.getState();
    if (
      disposed ||
      current.epoch !== captured.epoch ||
      current.selection.generation !== captured.generation ||
      current.revision !== captured.floor ||
      selectors.mcp(current) !== entry ||
      !sameMcpDraft(
        current.configurationDrafts[
          configurationDraftKey(captured.workspaceId, captured.path, "mcp")
        ],
        captured.draft,
      ) ||
      !allowed(current, sourceName)
    )
      return false;
    // An owned catalog entry must have the host's deterministic target identity.
    if (
      action !== "register" &&
      !observation.servers.some(
        (row) =>
          row.ownership === "current_runtime" &&
          row.sourceName === sourceName &&
          row.nativeName === nativeName,
      )
    )
      return false;
    const operationId = id(),
      requestId = id();
    const target = {
      workspaceId: captured.workspaceId,
      requestId,
      sourceName,
      expectedObservationVersion: observation.version,
    };
    const request: Readonly<McpRequest> = Object.freeze(
      action === "register"
        ? {
            type: "configuration.mcp.register",
            ...target,
            text: captured.draft!.text,
            fileVersion: captured.draft!.baselineFile!.version,
          }
        : { type: `configuration.mcp.${action}`, ...target },
    );
    const identity: McpMutationIdentity = Object.freeze({
      ...captured,
      operationId,
      request,
      nativeName,
      observation,
    });
    return submitMutation(
      request,
      false,
      undefined,
      undefined,
      undefined,
      identity,
    );
  }
  let removeVisibility = () => {},
    removeRefocus = () => {},
    unsubscribe = () => {};
  const dispatch: typeof store.dispatch = (event) => {
    return !disposed && store.dispatch(event);
  };
  async function snapshot(bootstrap = false) {
    if (disposed || snapshotFlight || !visible()) return;
    snapshotFlight = true;
    const abort = new AbortController();
    snapshotAbort = abort;
    const scope: Scope = {
      ...scopeOf(store.getState()),
      ...(bootstrap ? { bootstrap: true } : {}),
    };
    const result = await transport.read<WorkbenchSnapshot>(
      {
        type: "snapshot",
        ...(!bootstrap && scope.workspaceId
          ? { workspaceId: scope.workspaceId }
          : {}),
        ...(!bootstrap && scope.sessionId
          ? { sessionId: scope.sessionId }
          : {}),
      },
      bootstrap ? undefined : scope.epoch,
      abort.signal,
    );
    snapshotFlight = false;
    if (disposed || abort.signal.aborted) return;
    if (result.ok) {
      dispatch({ type: "snapshot", scope, value: result.value });
      if (
        !lookupTimer &&
        Object.values(store.getState().operations).some(
          (i) => i.status === "unknown" || i.hostHeld,
        )
      )
        void lookup();
    } else if (result.code === "STALE_EPOCH" && !bootstrap) {
      void snapshot(true);
      return;
    } else if (result.code !== "READ_BUSY")
      dispatch({ type: "health", scope, code: result.code });
    clock.clearTimeout(pollTimer);
    if (!visible()) return;
    if (!result.ok && result.code === "READ_BUSY")
      pollTimer = clock.setTimeout(() => void snapshot(bootstrap), 400);
    else if (store.getState().connection === "connected") {
      snapshotBackoff = 0;
      pollTimer = clock.setTimeout(() => void snapshot(), 1200);
    } else
      // Sidecar startup can outlast one read timeout (health => disconnected).
      // Never go quiet while non-connected: re-poll with 1s..5s capped backoff.
      pollTimer = clock.setTimeout(
        () => void snapshot(),
        store.getState().connection === "unavailable"
          ? 5000
          : Math.min(5000, 1000 * 2 ** snapshotBackoff++),
      );
  }
  async function catalog() {
    clock.clearTimeout(catalogTimer);
    catalogAbort?.abort();
    const abort = new AbortController();
    catalogAbort = abort;
    dispatch({ type: "catalog.check" });
    const scope = scopeOf(store.getState());
    if (!scope.epoch || !scope.workspaceId) return;
    // Keep the selected and the saved default model listed past the display cap.
    const pinModels = [
      ...new Set(
        [
          store.getState().drafts[
            selectionKey(scope.workspaceId, scope.sessionId)
          ]?.model,
          loadDefaultModel(),
        ].filter((id): id is string => /^[a-f0-9]{64}$/u.test(id ?? "")),
      ),
    ];
    const result = await transport.read<WorkbenchCatalog>(
      {
        type: "catalog.list",
        workspaceId: scope.workspaceId,
        ...(scope.sessionId ? { sessionId: scope.sessionId } : {}),
        ...(pinModels.length ? { pinModels } : {}),
      },
      scope.epoch,
      abort.signal,
    );
    if (abort.signal.aborted || disposed) return;
    if (!result.ok && result.code === "READ_BUSY") {
      catalogTimer = clock.setTimeout(() => void catalog(), 400);
      return;
    }
    const before = store.getState();
    dispatch(
      result.ok
        ? { type: "catalog", scope, value: result.value }
        : { type: "catalog", scope, error: result.code },
    );
    // Nothing else re-reads the catalog until the selection changes, so a
    // read that failed (the first one can time out while the runtime is still
    // loading a large provider catalog at startup) or was dropped as stale
    // retries with backoff while connected (recovery reads stay quiet).
    const dropped = store.getState() === before;
    if (
      (dropped || !result.ok) &&
      store.getState().connection === "connected" &&
      catalogRetries < 6
    ) {
      catalogTimer = clock.setTimeout(
        () => void catalog(),
        dropped ? 400 : 1000 * 2 ** catalogRetries,
      );
      catalogRetries++;
    } else catalogRetries = 0;
  }
  function armFiles() {
    clock.clearTimeout(fileTimer);
    const s = store.getState();
    if (
      started &&
      !disposed &&
      visible() &&
      s.files.visible &&
      s.connection === "connected"
    )
      fileTimer = clock.setTimeout(() => {
        void files();
      }, 5000);
  }
  let searchAbort: AbortController | undefined;
  async function files() {
    const state = store.getState(),
      identity = state.files.identity;
    if (
      disposed ||
      fileFlight ||
      Boolean(selectors.extensions(state).request) ||
      !visible() ||
      !state.files.visible ||
      state.connection !== "connected" ||
      !identity
    ) {
      armFiles();
      return;
    }
    fileFlight = true;
    const abort = new AbortController();
    filesAbort = abort;
    dispatch({ type: "files.check" });
    const listing = await transport.read<WorkbenchFileList>(
      {
        type: "file.list",
        workspaceId: identity.workspaceId,
        ...(state.files.directory ? { path: state.files.directory } : {}),
      },
      identity.epoch,
      abort.signal,
    );
    if (!disposed && !abort.signal.aborted) {
      if (listing.ok)
        dispatch({ type: "files.list", identity, value: listing.value });
      else dispatch({ type: "files.error", identity, code: listing.code });
      if (identity.kind === "file" && listing.ok) {
        const preview = await transport.read<WorkbenchFileRead>(
          {
            type: "file.read",
            workspaceId: identity.workspaceId,
            path: identity.path,
          },
          identity.epoch,
          abort.signal,
        );
        if (!abort.signal.aborted)
          dispatch(
            preview.ok
              ? { type: "files.read", identity, value: preview.value }
              : { type: "files.error", identity, code: preview.code },
          );
      }
      dispatch({ type: "files.done", identity });
    }
    fileFlight = false;
    if (
      !disposed &&
      identity !== store.getState().files.identity &&
      store.getState().files.visible
    )
      void files();
    else armFiles();
  }
  async function lookup() {
    if (disposed || lookupFlight || !store.getState().epoch) return;
    clock.clearTimeout(lookupTimer);
    lookupTimer = undefined;
    lookupFlight = true;
    // Bounded fair rounds; restored identities are reads, never mutation payloads.
    const intents = Object.values(store.getState().operations).filter(
      (i) => i.status === "unknown" || i.hostHeld,
    );
    const batch = Math.min(32, intents.length);
    let busy = false,
      completed = 0;
    for (let n = 0; n < batch; n++) {
      if (disposed) break;
      const intent = intents[(lookupCursor + n) % intents.length]!;
      const epoch = store.getState().epoch;
      if (!epoch) break;
      const result = await transport.read<OperationLookup>(
        {
          type: "operation.lookup",
          runtimeEpoch: intent.epoch,
          operationId: intent.id,
        },
        epoch,
      );
      if (disposed) break;
      if (!result.ok && result.code === "READ_BUSY") {
        busy = true;
        break;
      }
      completed++;
      if (
        result.ok &&
        result.value.status === "found" &&
        result.value.runtimeEpoch === intent.epoch &&
        result.value.operationId === intent.id
      ) {
        const key = operationKey(intent.epoch, intent.id);
        const before = store.getState().operations[key];
        if (
          (skillRuntimeStep(intent.operation.type) ||
            agentRuntimeStep(intent.operation.type)) &&
          result.value.receipt.effect === "confirmed"
        ) {
          const verified = agentRuntimeStep(intent.operation.type)
            ? await verifiedAgentReceipt(result.value.receipt)
            : await verifiedSkillReceipt(result.value.receipt);
          if (disposed) break;
          if (verified)
            dispatch({
              type: "receipt",
              id: key,
              receipt: result.value.receipt,
            });
        } else if (
          intent.operation.type === "file.save" &&
          result.value.receipt.effect === "confirmed"
        ) {
          // Retained identities contain no body or path. Derive only the backup
          // for the original key; never invent a draft or replay its payload.
          let fileBackupProof: string;
          try {
            fileBackupProof =
              intent.workspaceFileSave?.backupId ??
              `.omoc-configuration-${await sha256(operationKey(intent.epoch, intent.id))}.file.backup`;
          } catch {
            continue;
          }
          if (disposed) break;
          if (
            result.value.receipt.result?.kind === "file_saved" &&
            result.value.receipt.result.backupId === fileBackupProof
          )
            dispatch({
              type: "receipt",
              id: key,
              receipt: result.value.receipt,
              fileBackupProof,
            });
        } else
          dispatch({ type: "receipt", id: key, receipt: result.value.receipt });
        const after = store.getState().operations[key];
        if (
          after !== before &&
          after?.status !== "unknown" &&
          intent.operation.type !== "git.index.apply" &&
          intent.operation.type !== "git.commit.apply" &&
          intent.operation.type !== "git.branch.apply" &&
          intent.operation.type !== "git.restore.apply" &&
          intent.operation.type !== "configuration.save" &&
          intent.operation.type !== "configuration.skill.save" &&
          intent.operation.type !== "configuration.instructions.apply" &&
          intent.operation.type !== "configuration.instructions.remove" &&
          !skillRuntimeStep(intent.operation.type) &&
          !agentRuntimeStep(intent.operation.type) &&
          intent.operation.type !== "configuration.agent.save" &&
          intent.operation.type !== "file.save" &&
          !intent.operation.type.startsWith("configuration.mcp.")
        )
          refresh();
      }
    }
    lookupCursor = intents.length
      ? (lookupCursor + completed) % intents.length
      : 0;
    lookupFlight = false;
    clock.clearTimeout(lookupTimer);
    if (
      !disposed &&
      Object.values(store.getState().operations).some(
        (i) => i.status === "unknown" || i.hostHeld,
      )
    )
      lookupTimer = clock.setTimeout(() => void lookup(), busy ? 400 : 5000);
  }
  async function submitMutation(
    operation: MutationRequest,
    navigate = false,
    submittedText?: string,
    configurationSave?: NonNullable<ConfigurationDraft["fileSave"]>["identity"],
    instructionMutation?: InstructionMutationIdentity,
    mcpMutation?: McpMutationIdentity,
    skillSave?: SkillSaveIdentity,
    skillRuntimeMutation?: SkillRuntimeMutationIdentity,
    agentSave?: AgentSaveIdentity,
    agentRuntimeMutation?: AgentRuntimeMutationIdentity,
    workspaceFileSave?: WorkspaceFileSaveIdentity,
    conversationMessage = false,
  ): Promise<boolean> {
    const state = store.getState();
    if (
      mutationDisabled(state, operation) ||
      ((operation.type === "session.revert" ||
        operation.type === "session.revert.clear") &&
        !revertRequestReady(state, operation)) ||
      (operation.type === "message.send" &&
        requestOptionsInvalid(state, operation)) ||
      (operation.type === "file.save" && !workspaceFileSave) ||
      Object.values(state.workspaceFileDrafts).some((d) => d.request) ||
      (operation.type.startsWith("configuration.mcp.") && !mcpMutation) ||
      (operation.type === "configuration.save" && !configurationSave) ||
      (operation.type === "configuration.skill.save" && !skillSave) ||
      (operation.type === "configuration.agent.save" && !agentSave) ||
      (Boolean(agentRuntimeStep(operation.type)) && !agentRuntimeMutation) ||
      (Boolean(skillRuntimeStep(operation.type)) && !skillRuntimeMutation) ||
      Boolean(state.skillRuntime.request) ||
      Boolean(state.agentRuntime.request) ||
      ((operation.type === "configuration.instructions.apply" ||
        operation.type === "configuration.instructions.remove") &&
        !instructionMutation) ||
      Object.values(state.configurationDrafts).some((d) => d.fileRequest) ||
      Boolean(state.skillFiles.request) ||
      Boolean(state.agentFiles.request) ||
      Object.values(state.agentDrafts).some((d) => d.request) ||
      Object.values(state.skillDrafts).some((d) => d.request) ||
      Boolean(selectors.extensions(state).request) ||
      state.files.busy ||
      state.configurationIO.reads > 0 ||
      state.configurationIO.saves > 0
    )
      return false;
    const isConversation =
      conversationMessage ||
      operation.type === "session.inbox.cancel" ||
      (operation.type === "session.fork" &&
        Object.hasOwn(operation, "before")) ||
      (operation.type === "message.send" &&
        (Object.hasOwn(operation, "attachments") ||
          Object.hasOwn(operation, "delivery")));
    // Legacy callers keep the existing F06 path; context actions bind the floor.
    if (isConversation && !contextRequestReady(state, operation)) return false;
    let conversation: import("./store.js").Intent["conversation"];
    if (isConversation) {
      operation = freezeContextBody(structuredClone(operation));
      const scope = Object.freeze(scopeOf(state)),
        draftRevision = selectedContextDraft(state).revision,
        branch = state.conversationContext.branch;
      const digestInput = { ...operation, expectedRevision: state.revision };
      let digest: string;
      try {
        digest = await sha256(
          JSON.stringify(
            Object.keys(digestInput)
              .sort()
              .map((k) => [k, digestInput[k as keyof typeof digestInput]]),
          ),
        );
      } catch {
        return false;
      }
      if (
        disposed ||
        !currentRuntimeRequestScope(store.getState(), scope) ||
        selectedContextDraft(store.getState()).revision !== draftRevision ||
        (operation.type === "session.fork" &&
          store.getState().conversationContext.branch !== branch) ||
        !contextRequestReady(store.getState(), operation)
      )
        return false;
      conversation = freezeContextBody({
        scope,
        digest,
        draftRevision,
        ...(operation.type === "session.inbox.cancel"
          ? { inboxId: operation.inboxId }
          : {}),
        ...(operation.type === "session.fork" && branch
          ? { branch: structuredClone(branch) }
          : {}),
      });
    }
    const interrupt = operation.type === "session.interrupt";
    if (interrupt && operation.type === "session.interrupt") {
      const current = state.snapshot;
      // Safety interruption requires an active-target snapshot at the confirmed floor.
      if (
        state.connection !== "connected" ||
        !current ||
        current.state !== "connected" ||
        current.runtimeEpoch !== state.epoch ||
        current.revision < state.revision ||
        operation.workspaceId !== state.selection.workspaceId ||
        operation.sessionId !== state.selection.sessionId ||
        current.selectedWorkspaceId !== operation.workspaceId ||
        current.selectedSessionId !== operation.sessionId ||
        !current.workspaces.some((w) => w.id === operation.workspaceId) ||
        !current.sessions.some(
          (s) =>
            s.workspaceId === operation.workspaceId &&
            s.id === operation.sessionId &&
            s.status === "running" &&
            !s.archived,
        )
      )
        return false;
    }
    const key = selectionKey(
      "workspaceId" in operation
        ? operation.workspaceId
        : state.selection.workspaceId,
      mcpMutation ||
        workspaceFileSave ||
        agentSave ||
        agentRuntimeMutation ||
        skillSave ||
        (skillRuntimeMutation && operation.type !== "configuration.skill.apply")
        ? undefined
        : "sessionId" in operation
          ? operation.sessionId
          : state.selection.sessionId,
    );
    if (
      disposed ||
      !state.epoch ||
      selectors.pending(state) ||
      (!interrupt &&
        Object.values(state.operations).some(
          (i) => i.key === key && unknownOperationHeld(i),
        )) ||
      Object.keys(state.operations).length >= 2048
    )
      return false;
    const draft = state.drafts[key] ?? emptyDraft;
    const intent = {
      id:
        workspaceFileSave?.operationId ??
        agentRuntimeMutation?.operationId ??
        agentSave?.operationId ??
        skillRuntimeMutation?.operationId ??
        skillSave?.operationId ??
        mcpMutation?.operationId ??
        instructionMutation?.operationId ??
        configurationSave?.operationId ??
        (conversation && "requestId" in operation ? operation.requestId : id()),
      epoch: state.epoch,
      operation: workspaceFileSave
        ? workspaceFileSave.request
        : agentSave
          ? agentSave.request
          : skillSave
            ? skillSave.request
            : mcpMutation
              ? mcpMutation.request
              : instructionMutation
                ? instructionMutation.request
                : configurationSave
                  ? configurationSave.request
                  : conversation
                    ? operation
                    : operation.type === "message.send"
                      ? Object.freeze(structuredClone(operation))
                      : structuredClone(operation),
      ...(skillRuntimeMutation ? { skillRuntimeMutation } : {}),
      ...(agentRuntimeMutation ? { agentRuntimeMutation } : {}),
      ...(workspaceFileSave ? { workspaceFileSave } : {}),
      ...(agentSave ? { agentSave } : {}),
      ...(skillSave ? { skillSave } : {}),
      ...(mcpMutation ? { mcpMutation } : {}),
      ...(configurationSave ? { configurationSave } : {}),
      ...(instructionMutation ? { instructionMutation } : {}),
      origin: state.selection,
      ...(conversation ? { conversation } : {}),
      ...(operation.type === "message.send" || conversation
        ? { runtimeScope: Object.freeze(scopeOf(state)) }
        : {}),
      key,
      navigate,
      status: "pending" as const,
      ...(submittedText !== undefined
        ? {
            submitted: Object.freeze({
              ...draft,
              ...(operation.type === "message.send" && !operation.delivery
                ? {
                    agent: operation.agent ?? "",
                    model: operation.model ?? "",
                    variant: operation.variant ?? "",
                  }
                : {}),
              text: submittedText,
              revision:
                draft.text === submittedText &&
                (operation.type !== "message.send" ||
                  Boolean(operation.delivery) ||
                  (draft.agent === (operation.agent ?? "") &&
                    draft.model === (operation.model ?? "") &&
                    draft.variant === (operation.variant ?? "")))
                  ? draft.revision
                  : null,
            }),
          }
        : {}),
    };
    const identity = operationKey(intent.epoch, intent.id);
    if (state.operations[identity]) return false;
    dispatch({ type: "intent", intent });
    if (!store.getState().operations[identity]) return false;
    const result = await transport.mutate<
      | WorkbenchSnapshot
      | { status: string }
      | WorkbenchConfigurationSave
      | WorkbenchFileSave
      | WorkbenchInstructionMutation
      | WorkbenchMcpMutation
      | WorkbenchSkillRuntimeMutation
      | WorkbenchAgentRuntimeMutation
    >(
      intent.operation,
      intent.epoch,
      intent.id,
      workspaceFileSave?.floor ??
        agentRuntimeMutation?.floor ??
        agentSave?.floor ??
        skillRuntimeMutation?.floor ??
        skillSave?.floor ??
        mcpMutation?.floor ??
        instructionMutation?.floor ??
        (configurationSave
          ? configurationSave.floor
          : conversation?.scope.revision),
    );
    if (disposed) return false;
    let correlated = true;
    if (skillRuntimeMutation) {
      const r = result.receipt;
      if (result.ok) {
        const value = result.value as WorkbenchSkillRuntimeMutation;
        correlated = Boolean(
          validSkillRuntimeMutation(value) &&
            value.requestId === intent.id &&
            (value.status === "unknown"
              ? !r || ["pending", "unknown"].includes(r.effect)
              : r?.effect === "confirmed" &&
                r.result &&
                JSON.stringify(
                  Object.entries(value)
                    .filter(([key]) => key !== "requestId" && key !== "status")
                    .sort(),
                ) ===
                  JSON.stringify(
                    Object.entries(r.result)
                      .filter(
                        ([key]) => key !== "kind" && key !== "workspaceId",
                      )
                      .sort(),
                  )),
        );
      } else if (r)
        correlated =
          ["none", "pending", "unknown"].includes(r.effect) &&
          (r.effect !== "none" ||
            (r.result?.kind === "rejected" && r.result.code === result.code));
      if (r && correlated) correlated = await verifiedSkillReceipt(r);
    }
    if (agentRuntimeMutation) {
      const r = result.receipt;
      if (result.ok) {
        const value = result.value as WorkbenchAgentRuntimeMutation;
        correlated = Boolean(
          validAgentRuntimeMutation(value) &&
            value.requestId === intent.id &&
            (value.status === "unknown"
              ? !r || ["pending", "unknown"].includes(r.effect)
              : r?.effect === "confirmed" &&
                r.result &&
                JSON.stringify(
                  Object.entries(value)
                    .filter(([key]) => key !== "requestId" && key !== "status")
                    .sort(),
                ) ===
                  JSON.stringify(
                    Object.entries(r.result)
                      .filter(
                        ([key]) => key !== "kind" && key !== "workspaceId",
                      )
                      .sort(),
                  )),
        );
      } else if (r)
        correlated =
          ["none", "pending", "unknown"].includes(r.effect) &&
          (r.effect !== "none" ||
            (r.result?.kind === "rejected" && r.result.code === result.code));
      if (r && correlated) correlated = await verifiedAgentReceipt(r);
    }
    if (configurationSave && result.ok) {
      const value = result.value as WorkbenchConfigurationSave;
      const safe = plainData(value);
      const fields =
        safe && value.status === "saved"
          ? ["requestId", "status", "version", "backupId"]
          : ["requestId", "status"];
      const receipt = result.receipt;
      correlated = Boolean(
        safe &&
          Reflect.ownKeys(value).every(
            (k) => typeof k === "string" && fields.includes(k),
          ) &&
          value.requestId === configurationSave.request.requestId &&
          ((value.status === "saved" &&
            typeof value.version === "string" &&
            /^[a-f0-9]{64}$/.test(value.version) &&
            Object.hasOwn(value, "backupId") ===
              (configurationSave.backupId !== undefined) &&
            value.backupId === configurationSave.backupId &&
            plainData(receipt) &&
            receipt?.effect === "confirmed" &&
            plainData(receipt.result) &&
            receipt.result?.kind === "configuration_saved" &&
            receipt.result.version === value.version &&
            receipt.result.backupId === value.backupId) ||
            (value.status === "unknown" &&
              (!receipt ||
                (plainData(receipt) && receipt.effect !== "confirmed")))),
      );
    }
    if (workspaceFileSave) {
      const r = result.receipt;
      if (
        r &&
        (!plainData(r) || (r.result !== undefined && !plainData(r.result)))
      )
        correlated = false;
      else if (result.ok) {
        try {
          const value = validateWorkspaceFileSave(result.value);
          correlated =
            value.requestId === intent.id &&
            (value.status === "unknown"
              ? !r || ["pending", "unknown"].includes(r.effect)
              : r?.effect === "confirmed" &&
                r.result?.kind === "file_saved" &&
                r.result.workspaceId === workspaceFileSave.workspaceId &&
                r.result.path === workspaceFileSave.path &&
                r.result.version === value.version &&
                r.result.digest === workspaceFileSave.digest &&
                value.backupId === workspaceFileSave.backupId &&
                r.result.backupId === value.backupId);
        } catch {
          correlated = false;
        }
      } else if (r)
        correlated = Boolean(
          plainData(r) &&
            ["none", "pending", "unknown"].includes(r.effect) &&
            (r.effect !== "none" ||
              (r.result?.kind === "rejected" && r.result.code === result.code)),
        );
    }
    if (skillSave) {
      const r = result.receipt;
      if (result.ok) {
        const value = result.value as WorkbenchConfigurationSave;
        const safe = plainData(value),
          fields =
            safe && value.status === "saved"
              ? ["requestId", "status", "version", "backupId"]
              : ["requestId", "status"];
        correlated = Boolean(
          safe &&
            Reflect.ownKeys(value).every(
              (k) => typeof k === "string" && fields.includes(k),
            ) &&
            value.requestId === skillSave.request.requestId &&
            (value.status === "unknown"
              ? !r ||
                (plainData(r) && ["pending", "unknown"].includes(r.effect))
              : value.status === "saved" &&
                typeof value.version === "string" &&
                /^[a-f0-9]{64}$/.test(value.version) &&
                Object.hasOwn(value, "backupId") ===
                  (skillSave.backupId !== undefined) &&
                value.backupId === skillSave.backupId &&
                plainData(r) &&
                r?.effect === "confirmed" &&
                plainData(r.result) &&
                r.result?.kind === "skill_file_saved" &&
                r.result.version === value.version &&
                r.result.backupId === value.backupId),
        );
      } else if (r)
        correlated = Boolean(
          plainData(r) &&
            ["none", "pending", "unknown"].includes(r.effect) &&
            (r.effect !== "none" ||
              (plainData(r.result) &&
                r.result?.kind === "rejected" &&
                r.result.code === result.code)),
        );
    }
    if (agentSave) {
      const r = result.receipt;
      if (result.ok) {
        const value = result.value as WorkbenchConfigurationSave;
        const safe = plainData(value),
          fields =
            safe && value.status === "saved"
              ? ["requestId", "status", "version", "backupId"]
              : ["requestId", "status"];
        correlated = Boolean(
          safe &&
            Reflect.ownKeys(value).every(
              (k) => typeof k === "string" && fields.includes(k),
            ) &&
            value.requestId === agentSave.request.requestId &&
            (value.status === "unknown"
              ? !r ||
                (plainData(r) && ["pending", "unknown"].includes(r.effect))
              : value.status === "saved" &&
                typeof value.version === "string" &&
                /^[a-f0-9]{64}$/.test(value.version) &&
                Object.hasOwn(value, "backupId") ===
                  (agentSave.backupId !== undefined) &&
                value.backupId === agentSave.backupId &&
                plainData(r) &&
                r?.effect === "confirmed" &&
                plainData(r.result) &&
                r.result?.kind === "agent_file_saved" &&
                r.result.version === value.version &&
                r.result.backupId === value.backupId),
        );
      } else if (r)
        correlated = Boolean(
          plainData(r) &&
            ["none", "pending", "unknown"].includes(r.effect) &&
            (r.effect !== "none" ||
              (plainData(r.result) &&
                r.result?.kind === "rejected" &&
                r.result.code === result.code)),
        );
    }
    if (instructionMutation) {
      const r = result.receipt;
      if (result.ok) {
        const value = result.value as WorkbenchInstructionMutation;
        const apply =
          instructionMutation.request.type ===
          "configuration.instructions.apply";
        const fields =
          apply && value?.status === "registered"
            ? ["requestId", "status", "digest", "sourceVersion"]
            : ["requestId", "status"];
        correlated = Boolean(
          plainData(value) &&
            Reflect.ownKeys(value).every(
              (k) => typeof k === "string" && fields.includes(k),
            ) &&
            value.requestId === instructionMutation.request.requestId &&
            ((value.status === "unknown" &&
              (!r ||
                (plainData(r) &&
                  r.effect !== "confirmed" &&
                  r.effect !== "none"))) ||
              (plainData(r) &&
                r?.effect === "confirmed" &&
                plainData(r.result) &&
                (apply
                  ? value.status === "registered" &&
                    r.result?.kind === "instruction_registered" &&
                    value.digest === instructionMutation.digest &&
                    value.sourceVersion ===
                      instructionMutation.request.fileVersion &&
                    r.result.digest === value.digest &&
                    r.result.sourceVersion === value.sourceVersion
                  : value.status === "removed" &&
                    r.result?.kind === "instruction_removed"))),
        );
      } else if (r) {
        correlated = Boolean(
          plainData(r) &&
            r.effect !== "confirmed" &&
            (r.effect !== "none" ||
              (plainData(r.result) &&
                r.result?.kind === "rejected" &&
                r.result.code === result.code)),
        );
      }
    }
    if (mcpMutation) {
      const r = result.receipt;
      if (result.ok) {
        const value = result.value as WorkbenchMcpMutation;
        const base = ["requestId", "status", "sourceName", "nativeName"];
        const fields =
          value?.status === "registered_disabled"
            ? [...base, "digest", "sourceVersion"]
            : value?.status === "connection_status"
              ? [...base, "action", "connectionStatus"]
              : value?.status === "removed"
                ? base
                : ["requestId", "status"];
        const rr = r?.result;
        correlated = Boolean(
          plainData(value) &&
            Reflect.ownKeys(value).every(
              (k) => typeof k === "string" && fields.includes(k),
            ) &&
            value.requestId === mcpMutation.request.requestId &&
            (value.status === "unknown"
              ? !r ||
                (plainData(r) && ["pending", "unknown"].includes(r.effect))
              : plainData(r) &&
                (r?.effect === "confirmed" ||
                  (value.status === "removed" &&
                    r?.effect === "none" &&
                    r.admission === "admitted")) &&
                plainData(rr) &&
                "sourceName" in value &&
                value.sourceName === mcpMutation.request.sourceName &&
                value.nativeName === mcpMutation.nativeName &&
                rr &&
                (rr.kind === "mcp_registered" ||
                  rr.kind === "mcp_removed" ||
                  rr.kind === "mcp_connection") &&
                rr.sourceName === value.sourceName &&
                rr.nativeName === value.nativeName &&
                (value.status === "registered_disabled"
                  ? mcpMutation.request.type === "configuration.mcp.register" &&
                    rr.kind === "mcp_registered" &&
                    value.sourceVersion === mcpMutation.request.fileVersion &&
                    rr.sourceVersion === value.sourceVersion &&
                    rr.digest === value.digest
                  : value.status === "removed"
                    ? mcpMutation.request.type === "configuration.mcp.remove" &&
                      rr.kind === "mcp_removed"
                    : value.status === "connection_status" &&
                      rr.kind === "mcp_connection" &&
                      rr.action === value.action &&
                      rr.connectionStatus === value.connectionStatus)),
        );
      } else if (r)
        correlated = Boolean(
          plainData(r) &&
            ["none", "pending", "unknown"].includes(r.effect) &&
            (r.effect !== "none" ||
              (plainData(r.result) &&
                r.result?.kind === "rejected" &&
                r.result.code === result.code)),
        );
    }
    if (conversation && intent.operation.type === "session.fork" && result.ok)
      correlated = validContextBranchSnapshot(
        result.value as WorkbenchSnapshot,
        intent,
        result.receipt,
      );
    if (disposed) return false;
    if (result.receipt && correlated)
      dispatch({ type: "receipt", id: identity, receipt: result.receipt });
    const resolved = store.getState().operations[identity]!;
    if (resolved.status === "pending") {
      if (
        !result.ok &&
        [
          "STALE_EPOCH",
          "STALE_REVISION",
          "INVALID_REQUEST",
          "BUSY",
          "CANCELLED",
          "LIMIT_REACHED",
          "DUPLICATE_CONFLICT",
        ].includes(result.code) &&
        ((!configurationSave &&
          !instructionMutation &&
          !mcpMutation &&
          !skillSave &&
          !skillRuntimeMutation &&
          !agentRuntimeMutation &&
          !agentSave &&
          !workspaceFileSave) ||
          !result.receipt)
      )
        dispatch({ type: "refused", id: identity, code: result.code });
      else dispatch({ type: "unknown", id: identity });
    }
    const accepted =
      store.getState().operations[identity]?.status === "accepted";
    const current = store.getState();
    if (
      accepted &&
      intent.operation.type !== "message.send" &&
      result.ok &&
      "revision" in result.value &&
      current.epoch === intent.epoch &&
      (current.selection.generation === intent.origin.generation ||
        (conversation &&
          intent.operation.type === "session.fork" &&
          current.selection.generation === intent.origin.generation + 1 &&
          result.receipt?.result?.kind === "forked" &&
          current.selection.sessionId === result.receipt.result.sessionId))
    ) {
      if (navigate && current.selection.generation === intent.origin.generation)
        dispatch({
          type: "select",
          ...(result.value.selectedWorkspaceId
            ? { workspaceId: result.value.selectedWorkspaceId }
            : {}),
          ...(result.value.selectedSessionId
            ? { sessionId: result.value.selectedSessionId }
            : {}),
        });
      dispatch({
        type: "snapshot",
        scope: scopeOf(store.getState()),
        value: result.value,
      });
    }
    if (
      !accepted &&
      store.getState().operations[identity]?.status === "unknown"
    )
      void lookup();
    else if (
      !configurationSave &&
      !instructionMutation &&
      !mcpMutation &&
      !skillSave &&
      !skillRuntimeMutation &&
      !agentRuntimeMutation &&
      !agentSave &&
      !workspaceFileSave
    )
      refresh();
    return accepted;
  }
  function refresh() {
    clock.clearTimeout(pollTimer);
    snapshotBackoff = 0;
    void snapshot();
    void catalog();
    if (store.getState().files.visible) void files();
  }
  async function readDiagnostics(identity: DiagnosticsIdentity) {
    if (
      disposed ||
      diagnosticsAbort ||
      !identity.epoch ||
      store.getState().diagnosticsIdentity !== identity
    )
      return;
    clock.clearTimeout(diagnosticsTimer);
    const abort = new AbortController();
    diagnosticsAbort = abort;
    const result = await transport.read<WorkbenchDiagnostics>(
      {
        type: "diagnostics.list",
        ...(identity.filtered && identity.workspaceId && identity.sessionId
          ? { workspaceId: identity.workspaceId, sessionId: identity.sessionId }
          : {}),
      },
      identity.epoch,
      abort.signal,
    );
    if (diagnosticsAbort === abort) diagnosticsAbort = undefined;
    if (
      disposed ||
      abort.signal.aborted ||
      store.getState().diagnosticsIdentity !== identity
    )
      return;
    if (result.ok || result.code !== "READ_BUSY")
      dispatch(
        result.ok
          ? { type: "diagnostics", identity, value: result.value }
          : { type: "diagnostics", identity, error: result.code },
      );
    if (disposed || store.getState().diagnosticsIdentity !== identity) return;
    diagnosticsTimer = clock.setTimeout(
      () => void readDiagnostics(identity),
      !result.ok && result.code === "READ_BUSY" ? 400 : 3000,
    );
  }
  // The store owns filter/generation identity; only this controller schedules reads.
  const unsubscribeDiagnostics = store.subscribe((next, previous) => {
    if (next.diagnosticsIdentity !== previous.diagnosticsIdentity) {
      clock.clearTimeout(diagnosticsTimer);
      diagnosticsAbort?.abort();
      diagnosticsAbort = undefined;
      if (next.diagnosticsIdentity)
        void readDiagnostics(next.diagnosticsIdentity);
    } else if (
      next.diagnosticsIdentity &&
      (next.epoch !== previous.epoch ||
        next.selection.generation !== previous.selection.generation)
    ) {
      dispatch({
        type: "diagnostics.open",
        filtered: next.diagnosticsIdentity.filtered,
      });
    }
  });
  const actions = {
    observePermissionPolicy,
    cancelPermissionPolicyObservation: () =>
      cancelPermissionPolicyObservation(),
    observeContext: (path: string, selection?: ContextSelection) =>
      observeConversation(path, selection),
    pickContextPaths,
    resolveDroppedFiles,
    attachContextFiles,
    searchMentions,
    cancelContextObservation,
    removeContext: (capabilityId: string) =>
      dispatch({ type: "context.remove", capabilityId }),
    closeContextPreview: () => dispatch({ type: "context.preview.close" }),
    clearNotice: () => dispatch({ type: "notice.clear" }),
    clearError: () => dispatch({ type: "error.clear" }),
    clearContextNotice: () => dispatch({ type: "context.notice.clear" }),
    sendContextMessage,
    sendMessageToSession,
    resendMessage,
    deliverContextMessage,
    observeInbox: () => observeConversation(),
    cancelInbox,
    previewContextBranch: (before: string) =>
      dispatch({ type: "context.branch.preview", before }),
    editContextBranch: (text: string) =>
      dispatch({ type: "context.branch.edit", text }),
    closeContextBranch: () => dispatch({ type: "context.branch.close" }),
    confirmContextBranch,
    revertToMessage,
    reapplyRevert,
    selectLineFeedbackSource: (kind: "file" | "git") => {
      if (disposed) return false;
      dispatch({ type: "line.feedback.select", kind });
      const state = store.getState(),
        d = selectors.lineFeedbackDraft(state);
      return Boolean(d && d.source.kind === kind && !state.lineFeedback.notice);
    },
    resumeLineFeedback: (id: string) =>
      dispatch({ type: "line.feedback.resume", id }),
    editLineFeedback: (value: LineFeedbackEdit) =>
      dispatch({ type: "line.feedback.edit", value }),
    discardLineFeedback: () => dispatch({ type: "line.feedback.discard" }),
    appendLineFeedback: (): boolean => {
      if (disposed) return false;
      const state = store.getState(),
        draft = selectors.lineFeedbackDraft(state);
      if (!draft) return false;
      return dispatch({
        type: "line.feedback.append",
        draft,
        key: selectionKey(
          state.selection.workspaceId,
          state.selection.sessionId,
        ),
        composer: selectors.draft(state),
      });
    },
    toggleGitRestorePath: (path: string) => {
      const draft = selectedGitBranchRestoreDraft(store.getState());
      const paths = draft.paths.includes(path)
        ? draft.paths.filter((p) => p !== path)
        : [...draft.paths, path];
      dispatch({ type: "git.branchRestore.edit", value: { paths } });
    },
    editGitBranchRestore: (
      value: Partial<
        Pick<
          GitBranchRestoreDraft,
          "name" | "email" | "action" | "branch" | "source" | "paths"
        >
      >,
    ) => dispatch({ type: "git.branchRestore.edit", value }),
    selectGitBranchRestoreDraft: (key?: string) =>
      dispatch({ type: "git.branchRestore.selectDraft", key }),
    previewGitBranchRestore,
    cancelGitBranchRestorePreview,
    applyGitBranchRestore,
    editGitCommit: (
      value: Partial<Pick<GitCommitDraft, "name" | "email" | "message">>,
    ) => dispatch({ type: "git.commit.edit", value }),
    selectGitCommitDraft: (key?: string) =>
      dispatch({ type: "git.commit.selectDraft", key }),
    previewGitCommit,
    cancelGitCommitPreview,
    applyGitCommit,
    toggleGitIndexPath: (path: string) =>
      dispatch({ type: "git.index.select", path }),
    selectGitIndexAction: (action: GitIndexAction) =>
      dispatch({ type: "git.index.action", action }),
    previewGitIndex,
    cancelGitIndexPreview,
    applyGitIndex,
    observeGitReview,
    cancelGitReview,
    selectGitPath: (path: string) =>
      dispatch({ type: "git.select", field: "path", value: path }),
    selectGitMode: (mode: GitDiffMode) =>
      dispatch({ type: "git.select", field: "mode", value: mode }),
    selectGitBase: (baseRef: string) =>
      dispatch({ type: "git.select", field: "baseRef", value: baseRef }),
    readGitDiff,
    cancelGitDiff,
    readWorkspaceFile,
    saveWorkspaceFile,
    cancelWorkspaceFileRead,
    selectWorkspaceFile: (path: string) =>
      dispatch({ type: "workspace.file.select", path }),
    selectWorkspaceFileDraft: (key: string) =>
      dispatch({ type: "workspace.file.selectDraft", key }),
    editWorkspaceFile: (text: string) =>
      dispatch({ type: "workspace.file.draft", action: "edit", text }),
    validateWorkspaceFile: () =>
      dispatch({ type: "workspace.file.draft", action: "validate" }),
    discardWorkspaceFile: () =>
      dispatch({ type: "workspace.file.draft", action: "discard" }),
    observeExtensions,
    cancelExtensionObservation: () => cancelExtensionObservation(),
    listSkillFiles: () => readSkill(true),
    selectSkillFile: (sourceName: string) =>
      dispatch({ type: "skill.select", sourceName }),
    readSkillFile: () => readSkill(false),
    editSkillFile: (text: string) =>
      dispatch({ type: "skill.draft", action: "edit", text }),
    validateSkillFile: () =>
      dispatch({ type: "skill.draft", action: "validate" }),
    discardSkillFile: () =>
      dispatch({ type: "skill.draft", action: "discard" }),
    cancelSkillRead,
    saveSkillFile,
    observeSkillRuntime,
    cancelSkillRuntimeObservation,
    registerSkill: () => mutateSkillRuntime("register"),
    removeSkill: (nativeId: string) => mutateSkillRuntime("remove", nativeId),
    listAgentFiles: () => readAgent(true),
    selectAgentFile: (sourceName: string) =>
      dispatch({ type: "agent.select", sourceName }),
    readAgentFile: () => readAgent(false),
    editAgentFile: (text: string) =>
      dispatch({ type: "agent.draft", action: "edit", text }),
    validateAgentFile: () =>
      dispatch({ type: "agent.draft", action: "validate" }),
    discardAgentFile: () =>
      dispatch({ type: "agent.draft", action: "discard" }),
    cancelAgentRead,
    saveAgentFile,
    observeAgentRuntime,
    cancelAgentRuntimeObservation,
    registerAgent: () => mutateAgentRuntime("register"),
    removeAgent: (nativeId: string) => mutateAgentRuntime("remove", nativeId),
    applySkill: (nativeId: string) => mutateSkillRuntime("apply", nativeId),
    observeMcp,
    cancelMcpObservation,
    registerMcp: (sourceName: string) => mutateMcp("register", sourceName),
    connectMcp: (sourceName: string) => mutateMcp("connect", sourceName),
    disconnectMcp: (sourceName: string) => mutateMcp("disconnect", sourceName),
    removeMcp: (sourceName: string) => mutateMcp("remove", sourceName),
    observeInstructions,
    cancelInstructionObservation,
    applyInstructions: () => mutateInstructions(true),
    removeInstructions: () => mutateInstructions(false),
    saveConfigurationDraft,
    canSaveConfigurationDraft: (kind: ConfigurationDraftKind) =>
      !disposed && canSaveConfigurationDraft(store.getState(), kind),
    loadConfigurationDraft,
    cancelConfigurationLoad,
    select(workspaceId?: string, sessionId?: string) {
      dispatch({
        type: "select",
        ...(workspaceId ? { workspaceId } : {}),
        ...(sessionId ? { sessionId } : {}),
      });
    },
    refresh,
    mutate: (
      operation: MutationRequest,
      navigate = false,
      submittedText?: string,
    ) => submitMutation(operation, navigate, submittedText),
    draft(
      text: string,
      key = selectionKey(
        store.getState().selection.workspaceId,
        store.getState().selection.sessionId,
      ),
    ) {
      dispatch({ type: "draft", key, text });
    },
    options(value: { agent?: string; model?: string; variant?: string }) {
      dispatch({
        type: "draft",
        key: selectionKey(
          store.getState().selection.workspaceId,
          store.getState().selection.sessionId,
        ),
        ...value,
      });
    },
    editConfigurationDraft(kind: ConfigurationDraftKind, text: string) {
      const state = store.getState(),
        workspace = state.lists.workspaces.find(
          (w) => w.id === state.selection.workspaceId,
        );
      if (workspace)
        dispatch({
          type: "configuration.draft",
          workspaceId: workspace.id,
          path: workspace.path,
          kind,
          action: "edit",
          text,
        });
    },
    validateConfigurationDraft(kind: ConfigurationDraftKind) {
      const state = store.getState(),
        workspace = state.lists.workspaces.find(
          (w) => w.id === state.selection.workspaceId,
        );
      if (workspace)
        dispatch({
          type: "configuration.draft",
          workspaceId: workspace.id,
          path: workspace.path,
          kind,
          action: "validate",
        });
    },
    baselineConfigurationDraft(kind: ConfigurationDraftKind) {
      const state = store.getState(),
        workspace = state.lists.workspaces.find(
          (w) => w.id === state.selection.workspaceId,
        );
      if (workspace)
        dispatch({
          type: "configuration.draft",
          workspaceId: workspace.id,
          path: workspace.path,
          kind,
          action: "baseline",
        });
    },
    discardConfigurationDraft(kind: ConfigurationDraftKind) {
      const state = store.getState(),
        workspace = state.lists.workspaces.find(
          (w) => w.id === state.selection.workspaceId,
        );
      if (workspace)
        dispatch({
          type: "configuration.draft",
          workspaceId: workspace.id,
          path: workspace.path,
          kind,
          action: "discard",
        });
    },
    layout(value: Partial<ReturnType<typeof store.getState>["layout"]>) {
      dispatch({ type: "layout", value });
    },
    openPanel(panel: Panel) {
      const { layout } = store.getState();
      dispatch({
        type: "layout",
        value: {
          panel,
          navigationBeforePanel: layout.panel
            ? layout.navigationBeforePanel
            : layout.navigation,
          ...(layout.wide &&
          layout.navigation &&
          globalThis.window?.matchMedia("(max-width: 1199px)").matches
            ? { navigation: false }
            : {}),
        },
      });
    },
    closePanel() {
      const { layout } = store.getState();
      dispatch({
        type: "layout",
        value: {
          panel: null,
          ...(layout.wide ? { navigation: layout.navigationBeforePanel } : {}),
        },
      });
    },
    openFiles(path = "", kind: "file" | "directory" = "directory") {
      dispatch({ type: "files.open", path, kind });
      if (!started) void files();
    },
    closeFiles() {
      dispatch({ type: "files.close" });
      searchAbort?.abort();
    },
    async searchFiles(
      query: string,
      mode: "name" | "content",
      caseSensitive = false,
    ): Promise<WorkbenchResult<WorkbenchFileSearch>> {
      const identity = store.getState().files.identity;
      if (!identity) return { ok: false, code: "UNAVAILABLE", message: "" };
      // The host cancels the superseded search; retry while its lane frees.
      searchAbort?.abort();
      const abort = (searchAbort = new AbortController());
      for (let attempt = 0; ; attempt++) {
        const result = await transport.read<WorkbenchFileSearch>(
          {
            type: "file.search",
            workspaceId: identity.workspaceId,
            query,
            mode,
            ...(caseSensitive ? { caseSensitive } : {}),
          },
          identity.epoch,
          abort.signal,
        );
        if (result.ok || result.code !== "READ_BUSY" || attempt >= 20)
          return result;
        await new Promise((resolve) => clock.setTimeout(resolve, 100));
        if (abort.signal.aborted)
          return { ok: false, code: "CANCELLED", message: "CANCELLED" };
      }
    },
    refreshFiles: files,
    diagnostics(
      filtered = store.getState().diagnosticsIdentity?.filtered ?? false,
    ) {
      dispatch({ type: "diagnostics.open", filtered });
    },
    closeDiagnostics() {
      dispatch({ type: "diagnostics.close" });
    },
    refreshDiagnostics() {
      clock.clearTimeout(diagnosticsTimer);
      const identity = store.getState().diagnosticsIdentity;
      if (identity) void readDiagnostics(identity);
    },
  };
  return {
    store,
    actions,
    start() {
      if (disposed || started) return;
      started = true;
      unsubscribe = store.subscribe((next, previous) => {
        if (
          next.selection.generation !== previous.selection.generation ||
          next.epoch !== previous.epoch
        ) {
          snapshotAbort?.abort();
          clock.clearTimeout(pollTimer);
          // Cancelling settles the old logical wait before the next scheduled read.
          void Promise.resolve().then(() => {
            if (!disposed) void snapshot();
          });
          void catalog();
        } else if (
          // The first catalog read races runtime startup and can time out
          // while the connection is still unavailable; re-read once it is up.
          (next.connection === "connected" &&
            previous.connection !== "connected") ||
          next.lists.workspaces.find((w) => w.id === next.selection.workspaceId)
            ?.trustRevision !==
            previous.lists.workspaces.find(
              (w) => w.id === previous.selection.workspaceId,
            )?.trustRevision
        )
          void catalog();
        if (
          next.files.identity !== previous.files.identity ||
          next.files.visible !== previous.files.visible
        ) {
          filesAbort?.abort();
          if (next.files.visible) void files();
          else clock.clearTimeout(fileTimer);
        }
        if (next.connection !== previous.connection) {
          if (next.connection !== "connected") {
            filesAbort?.abort();
            dispatch({ type: "files.pause" });
          } else if (next.files.visible) void files();
          armFiles();
        }
      });
      const revalidate = () => {
        armFiles();
        if (visible()) {
          void files();
          refresh();
        } else {
          clock.clearTimeout(pollTimer);
          filesAbort?.abort();
          dispatch({ type: "files.pause" });
        }
      };
      removeVisibility = onVisibility(revalidate);
      removeRefocus = onRefocus(revalidate);
      void snapshot();
    },
    dispose() {
      cancelPermissionPolicyObservation();
      unsubscribePermissionPolicy();
      cancelContextObservation();
      unsubscribeContext();
      clock.clearTimeout(contextExpiryTimer);
      dispatch({ type: "context.preview.close" });
      cancelGitBranchRestorePreview();
      unsubscribeGitBranchRestore();
      clock.clearTimeout(gitBranchRestoreExpiryTimer);
      cancelGitCommitPreview();
      unsubscribeGitCommit();
      clock.clearTimeout(gitCommitExpiryTimer);
      cancelGitIndexPreview();
      unsubscribeGitIndex();
      cancelGitReview();
      cancelGitDiff();
      unsubscribeGit();
      clock.clearTimeout(gitRetryTimer);
      clock.clearTimeout(gitDiffRetryTimer);
      cancelWorkspaceFileRead();
      unsubscribeWorkspaceFile();
      cancelExtensionObservation();
      unsubscribeExtensions();
      cancelSkillRead();
      unsubscribeSkills();
      cancelSkillRuntimeObservation();
      unsubscribeSkillRuntime();
      cancelAgentRead();
      unsubscribeAgents();
      cancelAgentRuntimeObservation();
      unsubscribeAgentRuntime();
      cancelConfigurationLoad();
      cancelInstructionObservation();
      cancelMcpObservation();
      unsubscribeMcp();
      unsubscribeInstructions();
      unsubscribeConfiguration();
      dispatch({ type: "diagnostics.close" });
      disposed = true;
      unsubscribe();
      unsubscribeDiagnostics();
      removeVisibility();
      removeRefocus();
      clock.clearTimeout(pollTimer);
      clock.clearTimeout(fileTimer);
      clock.clearTimeout(lookupTimer);
      clock.clearTimeout(catalogTimer);
      clock.clearTimeout(diagnosticsTimer);
      snapshotAbort?.abort();
      catalogAbort?.abort();
      filesAbort?.abort();
      diagnosticsAbort?.abort();
      transport.dispose();
    },
  };
}
export type WindowWorkbench = ReturnType<typeof createWindowWorkbench>;
