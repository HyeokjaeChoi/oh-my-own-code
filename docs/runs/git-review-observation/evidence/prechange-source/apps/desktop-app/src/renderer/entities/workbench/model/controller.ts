/* eslint-disable no-unused-vars -- Type parameter names describe callbacks; TypeScript unused checks remain enabled. */
import type {
  WorkbenchExtensionsObservation,
  WorkbenchSnapshot,
  WorkbenchCatalog,
  OperationLookup,
  WorkbenchDiagnostics,
  WorkbenchFileList,
  WorkbenchFileRead,
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
          // Recheck immediately before the real bridge call, including reentrant
          // admission subscribers. A cancelled queued read must not perform IO.
          const fileDispatchCurrent = () => {
            const state = store.getState();
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
                    "file.read",
                    "file.list",
                  ].includes(type)
                ? "reads"
                : undefined;
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
          try {
            if (!fileDispatchCurrent())
              return { ok: false, code: "CANCELLED", message: "CANCELLED" };
            return await bridge.workbench(envelope);
          } finally {
            if (fileIOIdentity)
              dispatch({
                type: "workspace.file.io",
                identity: fileIOIdentity,
                active: false,
              });
            if (lane) dispatch({ type: "configuration.io", lane, delta: -1 });
          }
        },
      },
      { timeoutMs, clock, id },
    );
  let disposed = false,
    started = false;
  let pollTimer: ReturnType<typeof setTimeout> | undefined,
    fileTimer: ReturnType<typeof setTimeout> | undefined,
    lookupTimer: ReturnType<typeof setTimeout> | undefined,
    catalogTimer: ReturnType<typeof setTimeout> | undefined,
    diagnosticsTimer: ReturnType<typeof setTimeout> | undefined;
  let snapshotAbort: AbortController | undefined,
    catalogAbort: AbortController | undefined,
    filesAbort: AbortController | undefined,
    diagnosticsAbort: AbortController | undefined;
  let snapshotFlight = false,
    fileFlight = false,
    lookupFlight = false;
  let lookupCursor = 0;
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
            ((i.status === "unknown" || i.hostHeld) &&
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
    if (!disposed) store.dispatch(event);
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
    else if (store.getState().connection === "connected")
      pollTimer = clock.setTimeout(() => void snapshot(), 1200);
    else if (store.getState().connection === "unavailable")
      // Metadata can arrive before native ready. Retry reads only, in the current
      // scope, with one in-flight snapshot and a bounded five-second cadence.
      pollTimer = clock.setTimeout(() => void snapshot(), 5000);
  }
  async function catalog() {
    clock.clearTimeout(catalogTimer);
    catalogAbort?.abort();
    const abort = new AbortController();
    catalogAbort = abort;
    dispatch({ type: "catalog.check" });
    const scope = scopeOf(store.getState());
    if (!scope.epoch || !scope.workspaceId) return;
    const result = await transport.read<WorkbenchCatalog>(
      {
        type: "catalog.list",
        workspaceId: scope.workspaceId,
        ...(scope.sessionId ? { sessionId: scope.sessionId } : {}),
      },
      scope.epoch,
      abort.signal,
    );
    if (abort.signal.aborted || disposed) return;
    if (!result.ok && result.code === "READ_BUSY") {
      catalogTimer = clock.setTimeout(() => void catalog(), 400);
      return;
    }
    dispatch(
      result.ok
        ? { type: "catalog", scope, value: result.value }
        : { type: "catalog", scope, error: result.code },
    );
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
  ): Promise<boolean> {
    const state = store.getState();
    if (
      mutationDisabled(state, operation) ||
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
    const interrupt = operation.type === "session.interrupt";
    if (interrupt) {
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
          (i) => i.key === key && i.status === "unknown",
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
        id(),
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
      key,
      navigate,
      status: "pending" as const,
      ...(submittedText !== undefined
        ? {
            submitted: {
              ...draft,
              text: submittedText,
              revision: draft.text === submittedText ? draft.revision : null,
            },
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
        (configurationSave ? configurationSave.floor : undefined),
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
      result.ok &&
      "revision" in result.value &&
      current.epoch === intent.epoch &&
      current.selection.generation === intent.origin.generation
    ) {
      if (navigate)
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
    options(value: { agent?: string; model?: string }) {
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
