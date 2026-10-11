import { createStore } from "zustand/vanilla";
import type {
  WorkbenchExtensionsObservation,
  WorkbenchSnapshot,
  WorkbenchCatalog,
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
  WorkbenchSkillRuntimeRow,
  WorkbenchAgentRuntimeRow,
  WorkbenchSkillRuntimeMutation,
  WorkbenchAgentRuntimeMutation,
  WorkbenchMcpObservation,
  WorkbenchInstructionObservation,
  RedactedReceipt,
  WorkbenchRecovery,
  RetainedOperationKey,
  StoreRecoveryReason,
  ResourceRecoveryReason,
} from "../../../shared/api/index.js";
import {
  validateExtensionsObservation,
  validSkillRuntimeObservation,
  validAgentRuntimeObservation,
  validSkillRuntimeMutation,
  validAgentRuntimeMutation,
  skillRuntimeStep,
  agentRuntimeStep,
} from "../../../shared/api/index.js";
import type { MutationRequest } from "../../../shared/transport/index.js";
import { selectionKey } from "../../../shared/projection/index.js";
import {
  SKILL_LIMITS,
  AGENT_LIMITS,
  validSkillSourceName,
  validAgentSourceName,
  skillDraftKey,
  agentDraftKey,
  skillFileContentFits,
  agentFileContentFits,
  skillFileWriteFits,
  agentFileWriteFits,
  validateSkillFile,
  validateAgentFile,
  type SkillValidation,
  type AgentValidation,
  CONFIGURATION_DRAFT_LIMITS,
  configurationDraftKey,
  configurationDraftFits,
  configurationFileContentFits,
  configurationFileWriteFits,
  configurationTargetPath,
  emptyConfigurationDraft,
  validateConfigurationDraft,
  type ConfigurationDraft,
  type ConfigurationDraftKind,
  type ConfigurationLoadIdentity,
} from "../../../shared/configuration-draft/index.js";
import {
  validWorkspaceFilePath,
  workspaceFilePathReason,
  workspaceFileTargetPath,
  validateWorkspaceFileText,
  validateWorkspaceFileObservation,
  workspaceFileWriteFits,
  type WorkbenchFileObservation,
  type WorkspaceFileValidation,
} from "../../../shared/workspace-file/index.js";

export type WorkspaceFileDraft = {
  text: string;
  baseline?: string;
  revision: number;
  request?: WorkspaceFileIdentity | undefined;
  observation?: WorkspaceFileIdentity | undefined;
  read?: WorkbenchFileObservation;
  error?: string | undefined;
  validation?: WorkspaceFileValidation & { revision: number };
  save?: {
    identity: WorkspaceFileSaveIdentity;
    status: "pending" | "unknown" | "saved" | "conflict" | "denied";
    current: boolean;
    version?: string;
    backupId?: string;
    code?: string;
  };
};
export type WorkspaceFileIdentity = Readonly<{
  epoch: string;
  workspaceId: string;
  workspacePath: string;
  path: string;
  trustRevision: number;
  floor: number;
  generation: number;
  selectionGeneration: number;
  draft: WorkspaceFileDraft;
}>;
export type WorkspaceFileSaveIdentity = WorkspaceFileIdentity &
  Readonly<{
    operationId: string;
    digest: string;
    backupId: string;
    request: Readonly<Extract<MutationRequest, { type: "file.save" }>>;
  }>;
const emptyWorkspaceFileDraft: WorkspaceFileDraft = Object.freeze({
  text: "",
  revision: 0,
});
export const workspaceFileDraftKey = (
  epoch: string,
  workspaceId: string,
  root: string,
  path: string,
) => JSON.stringify([epoch, workspaceId, root, path]);
const workspaceFileWorkspace = (s: State) =>
  s.lists.workspaces.find((w) => w.id === s.selection.workspaceId);
function selectedWorkspaceFileKey(s: State): string | undefined {
  const w = workspaceFileWorkspace(s),
    path = s.workspaceFile.path;
  if (!w || !path || !s.epoch) return undefined;
  const retained = s.workspaceFile.draftKey;
  if (retained && s.workspaceFileDrafts[retained]) {
    const [, workspaceId] = JSON.parse(retained) as string[];
    if (workspaceId === w.id) return retained;
  }
  return workspaceFileDraftKey(s.epoch, w.id, w.path, path);
}
export function selectedWorkspaceFileDraft(s: State): WorkspaceFileDraft {
  const key = selectedWorkspaceFileKey(s);
  return key
    ? (s.workspaceFileDrafts[key] ?? emptyWorkspaceFileDraft)
    : emptyWorkspaceFileDraft;
}
function workspaceFileSelectionCurrent(s: State): boolean {
  const w = workspaceFileWorkspace(s),
    path = s.workspaceFile.path;
  return Boolean(
    s.epoch &&
      w &&
      path &&
      selectedWorkspaceFileKey(s) ===
        workspaceFileDraftKey(s.epoch, w.id, w.path, path),
  );
}
export function currentWorkspaceFileScope(
  s: State,
  i: WorkspaceFileIdentity,
): boolean {
  const w = workspaceFileWorkspace(s);
  return Boolean(
    workspaceFileSelectionCurrent(s) &&
      w?.trusted &&
      s.epoch === i.epoch &&
      w.id === i.workspaceId &&
      w.path === i.workspacePath &&
      w.trustRevision === i.trustRevision &&
      s.revision === i.floor &&
      s.selection.generation === i.selectionGeneration &&
      s.workspaceFile.generation === i.generation &&
      s.workspaceFile.path === i.path,
  );
}
function workspaceFileAuthority(s: State): boolean {
  return (
    mcpTargetReady(s) && !resourceMutationDisabled(s, s.selection.workspaceId)
  );
}
export function canReadWorkspaceFile(s: State): boolean {
  return (
    workspaceFileSelectionCurrent(s) &&
    workspaceFileAuthority(s) &&
    !s.files.busy &&
    s.configurationIO.reads === 0 &&
    !Object.values(s.workspaceFileIO).includes(s.selection.workspaceId ?? "") &&
    !Object.values(s.operations).some(
      (i) =>
        i.status === "pending" &&
        (!i.operation.workspaceId ||
          i.operation.workspaceId === s.selection.workspaceId),
    ) &&
    !Object.values(s.workspaceFileDrafts).some((d) => d.request) &&
    !selectedExtensions(s).request &&
    !s.agentRuntime.request &&
    !s.skillRuntime.request &&
    !s.agentFiles.request &&
    !s.skillFiles.request &&
    !Object.values(s.configurationDrafts).some((d) => d.fileRequest) &&
    !Object.values(s.agentDrafts).some((d) => d.request) &&
    !Object.values(s.skillDrafts).some((d) => d.request) &&
    selectedWorkspaceFileDraft(s).save?.status !== "pending" &&
    selectedWorkspaceFileDraft(s).save?.status !== "unknown"
  );
}
export function canSaveWorkspaceFile(s: State): boolean {
  const d = selectedWorkspaceFileDraft(s);
  return Boolean(
    canReadWorkspaceFile(s) &&
      !selectors.pending(s) &&
      s.configurationIO.saves === 0 &&
      d.observation &&
      currentWorkspaceFileScope(s, d.observation) &&
      d.read?.status === "available" &&
      d.text !== d.baseline &&
      workspaceFileWriteFits(d.text) &&
      d.validation?.revision === d.revision &&
      d.validation.status === "valid" &&
      Object.keys(s.operations).length < 2048,
  );
}
export function workspaceFileDispatchReady(
  s: State,
  i: WorkspaceFileSaveIdentity,
): boolean {
  const d = selectedWorkspaceFileDraft(s),
    key = operationKey(i.epoch, i.operationId);
  const operations = { ...s.operations };
  delete operations[key];
  return Boolean(
    currentWorkspaceFileScope(s, i) &&
      workspaceFileAuthority({ ...s, operations }) &&
      s.operations[key]?.status === "pending" &&
      d.save?.identity === i &&
      d.revision === i.draft.revision &&
      d.text === i.request.text &&
      d.validation === i.draft.validation,
  );
}
function workspaceFileSaveState(
  s: State,
  intent: Intent,
  status: NonNullable<WorkspaceFileDraft["save"]>["status"],
  result?: Extract<
    NonNullable<RedactedReceipt["result"]>,
    { kind: "file_saved" }
  >,
  code?: string,
): State {
  const i = intent.workspaceFileSave;
  if (!i) return s;
  const key = workspaceFileDraftKey(
      i.epoch,
      i.workspaceId,
      i.workspacePath,
      i.path,
    ),
    d = s.workspaceFileDrafts[key];
  if (!d || d.save?.identity !== i) return s;
  const next = {
    ...d,
    save: {
      identity: i,
      status,
      current: d.revision === i.draft.revision && d.text === i.request.text,
      ...(result ? { version: result.version, backupId: result.backupId } : {}),
      ...(code ? { code } : {}),
    },
  };
  if (status !== "pending") {
    delete next.observation;
    delete next.request;
  }
  return {
    ...s,
    workspaceFileDrafts: { ...s.workspaceFileDrafts, [key]: next },
  };
}

export type Selection = {
  workspaceId?: string;
  sessionId?: string;
  generation: number;
};
export type Scope = Selection & {
  epoch: string | undefined;
  bootstrap?: boolean;
  revision?: number;
  observationSequence?: number;
  catalogGeneration?: number;
  trustRevision?: number | undefined;
};
export type Draft = {
  text: string;
  revision: number;
  agent: string;
  model: string;
};
export const emptyDraft: Draft = Object.freeze({
  text: "",
  revision: 0,
  agent: "",
  model: "",
});
export type OperationIdentity = Pick<
  RetainedOperationKey,
  "type" | "workspaceId" | "sessionId"
>;
export const operationKey = (epoch: string, id: string) =>
  JSON.stringify([epoch, id]);
export type Intent = {
  id: string;
  epoch: string;
  observationSequence?: number;
  hostHeld?: boolean;
  origin: Selection;
  key: string;
  submitted?: Omit<Draft, "revision"> & { revision: number | null };
  navigate: boolean;
  status: "pending" | "unknown" | "accepted" | "failed";
  receipt?: RedactedReceipt;
  mcpMutation?: McpMutationIdentity;
  instructionMutation?: InstructionMutationIdentity;
  skillSave?: SkillSaveIdentity;
  agentSave?: AgentSaveIdentity;
  workspaceFileSave?: WorkspaceFileSaveIdentity;
  skillRuntimeMutation?: SkillRuntimeMutationIdentity;
  agentRuntimeMutation?: AgentRuntimeMutationIdentity;
  configurationSave?: NonNullable<ConfigurationDraft["fileSave"]>["identity"];
} & (
  | { lookupOnly?: false; operation: MutationRequest & OperationIdentity }
  | { lookupOnly: true; operation: OperationIdentity }
);
export type ExtensionIdentity = Readonly<{
  epoch: string;
  workspaceId: string;
  path: string;
  trustRevision: number;
  selectionGeneration: number;
  generation: number;
  floor: number;
}>;
export type ExtensionError =
  | "CANCELLED"
  | "STALE"
  | "EXTENSIONS_UNVERIFIED"
  | "READ_TIMEOUT"
  | "READ_BUSY"
  | "UNAVAILABLE";
export type Extensions = {
  request?: ExtensionIdentity | undefined;
  observationIdentity?: ExtensionIdentity;
  observation?: WorkbenchExtensionsObservation;
  error?: ExtensionError | undefined;
};
const emptyExtensions: Extensions = Object.freeze({});
export type McpIdentity = Readonly<{
  epoch: string;
  workspaceId: string;
  path: string;
  generation: number;
  trustRevision: number;
  floor: number;
  draft: ConfigurationDraft | undefined;
}>;
export type McpRequest = Extract<
  MutationRequest,
  { type: `configuration.mcp.${string}` }
>;
export type McpMutationIdentity = McpIdentity &
  Readonly<{
    operationId: string;
    request: Readonly<McpRequest>;
    nativeName: string;
    observation: Extract<WorkbenchMcpObservation, { status: "observed" }>;
  }>;
export type Mcp = {
  request?: McpIdentity;
  observationIdentity?: McpIdentity;
  observation?: WorkbenchMcpObservation;
  error?: string;
  action?: {
    identity: McpMutationIdentity;
    status:
      | "pending"
      | "registered_disabled"
      | "connected"
      | "disconnected"
      | "failed"
      | "needs_auth"
      | "removed"
      | "denied"
      | "changed"
      | "unknown";
    current: boolean;
    code?: string;
  };
};
const emptyMcp: Mcp = Object.freeze({});
export type InstructionIdentity = Readonly<{
  epoch: string;
  workspaceId: string;
  sessionId: string;
  path: string;
  generation: number;
  trustRevision: number;
  floor: number;
  draft: ConfigurationDraft | undefined;
}>;
export type InstructionMutationIdentity = InstructionIdentity &
  Readonly<{
    operationId: string;
    request: Readonly<
      Extract<
        MutationRequest,
        {
          type:
            | "configuration.instructions.apply"
            | "configuration.instructions.remove";
        }
      >
    >;
    observation: WorkbenchInstructionObservation;
    digest?: string;
  }>;
export type Instructions = {
  request?: InstructionIdentity;
  observationIdentity?: InstructionIdentity;
  observation?: WorkbenchInstructionObservation;
  error?: string;
  action?: {
    identity: InstructionMutationIdentity;
    status:
      | "pending"
      | "registered"
      | "removed"
      | "denied"
      | "changed"
      | "unknown";
    current: boolean;
    code?: string;
  };
};
const emptyInstructions: Instructions = Object.freeze({});
export type SkillDraft = {
  text: string;
  revision: number;
  baseline: string;
  validation?: SkillValidation & { revision: number };
  request?: SkillIdentity | undefined;
  observation?: SkillIdentity | undefined;
  read?: WorkbenchSkillFile;
  error?: string | undefined;
  save?: {
    identity: SkillSaveIdentity;
    status: "pending" | "saved" | "conflict" | "denied" | "unknown";
    current: boolean;
    version?: string;
    backupId?: string;
    code?: string;
  };
};
export type SkillIdentity = Readonly<{
  epoch: string;
  workspaceId: string;
  path: string;
  sourceName?: string;
  generation: number;
  selectionGeneration: number;
  trustRevision: number;
  floor: number;
  draft?: SkillDraft;
}>;
export type SkillSaveIdentity = SkillIdentity &
  Readonly<{
    sourceName: string;
    operationId: string;
    request: Readonly<
      Extract<MutationRequest, { type: "configuration.skill.save" }>
    >;
    backupId?: string;
  }>;
export type SkillFiles = {
  sourceName?: string;
  generation: number;
  request?: SkillIdentity | undefined;
  listingIdentity?: SkillIdentity | undefined;
  listing?: WorkbenchSkillFiles | undefined;
  error?: string | undefined;
};
const emptySkillDraft: SkillDraft = Object.freeze({
  text: "",
  baseline: "",
  revision: 0,
});
export type SkillRuntimeIdentity = SkillIdentity &
  Readonly<{
    sessionId?: string;
    digest?: string;
  }>;
export type SkillRuntimeRequest = Extract<
  MutationRequest,
  {
    type:
      | "configuration.skill.register"
      | "configuration.skill.remove"
      | "configuration.skill.apply";
  }
>;
export type SkillRuntimeMutationIdentity = SkillRuntimeIdentity &
  Readonly<{
    operationId: string;
    type: SkillRuntimeRequest["type"];
    observationId: string;
    target: Readonly<
      Pick<
        WorkbenchSkillRuntimeRow,
        | "sourceName"
        | "nativeId"
        | "digest"
        | "registrationRuntimeEpoch"
        | "registrationOperationId"
        | "bodyDigest"
        | "nativeDigest"
      >
    >;
    version?: string;
    directoryVersion?: string;
  }>;
export type SkillRuntime = {
  request?: SkillRuntimeIdentity;
  observationIdentity?: SkillRuntimeIdentity;
  observation?: WorkbenchSkillRuntimeObservation;
  error?: string;
  action?: {
    identity: SkillRuntimeMutationIdentity;
    status:
      | "pending"
      | "registered_disabled"
      | "removed"
      | "applied"
      | "denied"
      | "unknown";
    current: boolean;
    code?: string;
  };
};
export type AgentDraft = {
  text: string;
  revision: number;
  baseline: string;
  validation?: AgentValidation & { revision: number };
  request?: AgentIdentity | undefined;
  observation?: AgentIdentity | undefined;
  read?: WorkbenchAgentFile;
  error?: string | undefined;
  save?: {
    identity: AgentSaveIdentity;
    status: "pending" | "saved" | "conflict" | "denied" | "unknown";
    current: boolean;
    version?: string;
    backupId?: string;
    code?: string;
  };
};
export type AgentIdentity = Readonly<{
  epoch: string;
  workspaceId: string;
  path: string;
  sourceName?: string;
  generation: number;
  selectionGeneration: number;
  trustRevision: number;
  floor: number;
  draft?: AgentDraft;
}>;
export type AgentSaveIdentity = AgentIdentity &
  Readonly<{
    sourceName: string;
    operationId: string;
    request: Readonly<
      Extract<MutationRequest, { type: "configuration.agent.save" }>
    >;
    backupId?: string;
  }>;
export type AgentFiles = {
  sourceName?: string;
  generation: number;
  request?: AgentIdentity | undefined;
  listingIdentity?: AgentIdentity | undefined;
  listing?: WorkbenchAgentFiles | undefined;
  error?: string | undefined;
};
const emptyAgentDraft: AgentDraft = Object.freeze({
  text: "",
  baseline: "",
  revision: 0,
});
export type AgentRuntimeIdentity = AgentIdentity &
  Readonly<{
    digest?: string;
  }>;
export type AgentRuntimeRequest = Extract<
  MutationRequest,
  {
    type: "configuration.agent.register" | "configuration.agent.remove";
  }
>;
export type AgentRuntimeMutationIdentity = AgentRuntimeIdentity &
  Readonly<{
    operationId: string;
    type: AgentRuntimeRequest["type"];
    observationId: string;
    target: Readonly<
      Pick<
        WorkbenchAgentRuntimeRow,
        | "sourceName"
        | "nativeId"
        | "digest"
        | "registrationRuntimeEpoch"
        | "registrationOperationId"
        | "systemDigest"
        | "nativeDigest"
      >
    >;
    version?: string;
    directoryVersion?: string;
    defaultAgentId: string;
  }>;
export type AgentRuntime = {
  request?: AgentRuntimeIdentity;
  observationIdentity?: AgentRuntimeIdentity;
  observation?: WorkbenchAgentRuntimeObservation;
  error?: string;
  action?: {
    identity: AgentRuntimeMutationIdentity;
    status: "pending" | "registered_primary" | "removed" | "denied" | "unknown";
    current: boolean;
    code?: string;
  };
};
export type FileIdentity = {
  epoch: string;
  workspaceId: string;
  trustRevision: number;
  path: string;
  kind: "file" | "directory";
  generation: number;
};
export type Files = {
  visible: boolean;
  identity: FileIdentity | null;
  generation: number;
  directory: string;
  listing: WorkbenchFileList | null;
  preview: WorkbenchFileRead | null;
  status: "empty" | "checking" | "observed" | "stale" | "missing";
  busy: boolean;
  error: string;
};
export type DiagnosticsIdentity = Scope & {
  filtered: boolean;
  requestGeneration: number;
};
export type Panel = "files" | "catalog" | "activity";
export type State = {
  epoch: string | undefined;
  retiredEpochs: string[];
  revision: number;
  observationSequence: number;
  recovery: WorkbenchRecovery | null;
  selection: Selection;
  snapshot: WorkbenchSnapshot | null;
  lists: Pick<WorkbenchSnapshot, "workspaces" | "sessions">;
  connection: string;
  error: string;
  notice: string;
  interruptNotice: {
    operationId: string;
    scope: Scope;
    revision: number;
  } | null;
  catalog: WorkbenchCatalog | null;
  catalogError: string;
  catalogGeneration: number;
  drafts: Record<string, Draft>;
  configurationDrafts: Record<string, ConfigurationDraft>;
  skillFiles: SkillFiles;
  skillRuntime: SkillRuntime;
  skillDrafts: Record<string, SkillDraft>;
  agentFiles: AgentFiles;
  agentRuntime: AgentRuntime;
  agentDrafts: Record<string, AgentDraft>;
  extensions: Record<string, Extensions>;
  extensionsGeneration: number;
  mcp: Record<string, Mcp>;
  instructions: Record<string, Instructions>;
  configurationNotice: string;
  configurationIO: { reads: number; saves: number };
  operations: Record<string, Intent>;
  workspaceFile: { path?: string; draftKey?: string; generation: number };
  workspaceFileDrafts: Record<string, WorkspaceFileDraft>;
  workspaceFileIO: Record<string, string>;
  files: Files;
  diagnostics: WorkbenchDiagnostics | null;
  diagnosticsError: string;
  diagnosticsIdentity: DiagnosticsIdentity | null;
  diagnosticsGeneration: number;
  layout: {
    wide: boolean;
    navigation: boolean;
    panel: Panel | null;
    panelWidth: number;
    navigationBeforePanel: boolean;
  };
};
const initialFiles = (): Files => ({
  visible: false,
  identity: null,
  generation: 0,
  directory: "",
  listing: null,
  preview: null,
  status: "empty",
  busy: false,
  error: "",
});
export const scopeOf = (state: State): Scope => ({
  ...state.selection,
  epoch: state.epoch,
  revision: state.revision,
  observationSequence: state.observationSequence,
  catalogGeneration: state.catalogGeneration,
  trustRevision: state.lists.workspaces.find(
    (w) => w.id === state.selection.workspaceId,
  )?.trustRevision,
});
const sameScope = (state: State, scope: Scope) =>
  state.epoch === scope.epoch &&
  state.selection.generation === scope.generation &&
  state.selection.workspaceId === scope.workspaceId &&
  state.selection.sessionId === scope.sessionId;
const currentIntent = (state: State, intent: Intent) =>
  sameScope(state, { ...intent.origin, epoch: intent.epoch }) &&
  (!("workspaceId" in intent.operation) ||
    intent.operation.workspaceId === state.selection.workspaceId) &&
  (!("sessionId" in intent.operation) ||
    intent.operation.sessionId === state.selection.sessionId);
const observedIdle = (
  snapshot: WorkbenchSnapshot | null,
  scope: Scope,
  revision: number,
  observationSequence: number,
) =>
  Boolean(
    snapshot &&
      snapshot.state === "connected" &&
      snapshot.runtimeEpoch === scope.epoch &&
      snapshot.revision >= revision &&
      snapshot.observationSequence > observationSequence &&
      snapshot.selectedWorkspaceId === scope.workspaceId &&
      snapshot.selectedSessionId === scope.sessionId &&
      snapshot.sessions.some(
        (session) =>
          session.workspaceId === scope.workspaceId &&
          session.id === scope.sessionId &&
          session.status === "idle",
      ),
  );
const sameFile = (a: FileIdentity | null, b: FileIdentity) =>
  Boolean(
    a &&
      a.epoch === b.epoch &&
      a.workspaceId === b.workspaceId &&
      a.trustRevision === b.trustRevision &&
      a.path === b.path &&
      a.kind === b.kind &&
      a.generation === b.generation,
  );
export const recoveryMessages: Record<
  StoreRecoveryReason | ResourceRecoveryReason,
  string
> = {
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
};
const storeReasons: StoreRecoveryReason[] = [
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
];
const resourceReasons: ResourceRecoveryReason[] = [
  "path_missing",
  "path_denied",
  "path_conflict",
  "native_mapping_unverified",
  "partial_native_mapping",
  "unresolved_operation",
];
const mutationTypes: OperationIdentity["type"][] = [
  "workspace.import",
  "workspace.create",
  "workspace.remove",
  "session.create",
  "session.rename",
  "session.pin",
  "session.archive",
  "session.fork",
  "session.remove",
  "session.interrupt",
  "message.send",
  "command.run",
  "permission.respond",
  "file.save",
  "configuration.save",
  "configuration.skill.save",
  "configuration.skill.register",
  "configuration.skill.remove",
  "configuration.skill.apply",
  "configuration.agent.save",
  "configuration.agent.register",
  "configuration.agent.remove",
  "configuration.mcp.register",
  "configuration.mcp.connect",
  "configuration.mcp.disconnect",
  "configuration.mcp.remove",
  "configuration.instructions.apply",
  "configuration.instructions.remove",
];
const closed = (
  value: unknown,
  required: string[],
  optional: string[] = [],
) => {
  if (
    !value ||
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return false;
  const object = value as Record<string, unknown>;
  return (
    required.every((k) => Object.hasOwn(object, k)) &&
    Reflect.ownKeys(object).every(
      (k) =>
        typeof k === "string" &&
        [...required, ...optional].includes(k) &&
        Object.hasOwn(Object.getOwnPropertyDescriptor(object, k)!, "value"),
    )
  );
};
const wireId = (id: unknown, max = 128) =>
  typeof id === "string" && id.length <= max && /^[A-Za-z0-9_.:-]+$/.test(id);
const validClock = (n: number) => Number.isSafeInteger(n) && n >= 0;
function validProjection(next: WorkbenchSnapshot): boolean {
  if (
    !closed(
      next,
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
      ["selectedWorkspaceId", "selectedSessionId", "error"],
    ) ||
    !wireId(next.runtimeEpoch) ||
    !validClock(next.revision) ||
    !validClock(next.observationSequence) ||
    next.observationSequence === 0 ||
    typeof next.temporary !== "boolean" ||
    !["connected", "disconnected", "unavailable"].includes(next.state)
  )
    return false;
  for (const [entries, limit] of [
    [next.workspaces, 100],
    [next.sessions, 200],
    [next.messages, 100],
    [next.permissions, 100],
    [next.retainedOperations, 2048],
  ] as const)
    if (!Array.isArray(entries) || entries.length > limit) return false;
  const workspaces = new Set<string>(),
    sessions = new Map<string, string>();
  for (const w of next.workspaces) {
    if (
      !closed(w, [
        "id",
        "name",
        "path",
        "kind",
        "trusted",
        "trustRevision",
        "temporary",
      ]) ||
      !wireId(w.id, 256) ||
      workspaces.has(w.id) ||
      !validClock(w.trustRevision) ||
      typeof w.temporary !== "boolean" ||
      typeof w.trusted !== "boolean" ||
      typeof w.name !== "string" ||
      typeof w.path !== "string" ||
      !["folder", "repository", "worktree"].includes(w.kind)
    )
      return false;
    workspaces.add(w.id);
  }
  for (const s of next.sessions) {
    if (
      !closed(
        s,
        ["id", "workspaceId", "title", "status"],
        ["pinned", "archived", "parentSessionId"],
      ) ||
      !wireId(s.id, 256) ||
      !workspaces.has(s.workspaceId) ||
      sessions.has(s.id) ||
      !["idle", "running", "stopping", "unknown", "unavailable"].includes(
        s.status,
      )
    )
      return false;
    sessions.set(s.id, s.workspaceId);
  }
  if (
    (next.selectedWorkspaceId && !workspaces.has(next.selectedWorkspaceId)) ||
    (next.selectedSessionId &&
      sessions.get(next.selectedSessionId) !== next.selectedWorkspaceId)
  )
    return false;
  if (!closed(next.recovery, ["store", "resources"])) return false;
  const recovery = next.recovery.store;
  if (
    !closed(
      recovery,
      ["state"],
      recovery?.state === "recovery_required" ? ["reason"] : [],
    ) ||
    !(
      recovery.state === "ready" ||
      (recovery.state === "recovery_required" &&
        storeReasons.includes(recovery.reason))
    ) ||
    !Array.isArray(next.recovery.resources) ||
    next.recovery.resources.length > 300
  )
    return false;
  const resources = new Set<string>();
  for (const r of next.recovery.resources) {
    const key = selectionKey(r?.workspaceId, r?.sessionId);
    if (
      !closed(r, ["workspaceId", "state", "reason"], ["sessionId"]) ||
      !workspaces.has(r.workspaceId) ||
      r.state !== "unavailable" ||
      !resourceReasons.includes(r.reason) ||
      (Object.hasOwn(r, "sessionId") &&
        sessions.get(r.sessionId!) !== r.workspaceId) ||
      resources.has(key)
    )
      return false;
    resources.add(key);
  }
  const retained = new Set<string>();
  for (const k of next.retainedOperations) {
    if (
      !closed(
        k,
        ["runtimeEpoch", "operationId", "type"],
        ["workspaceId", "sessionId"],
      ) ||
      !wireId(k.runtimeEpoch) ||
      !wireId(k.operationId) ||
      !mutationTypes.includes(k.type) ||
      (["workspaceId", "sessionId"] as const).some(
        (field) => Object.hasOwn(k, field) && !wireId(k[field], 256),
      ) ||
      (k.sessionId && !k.workspaceId) ||
      ((k.type.startsWith("configuration.mcp.") ||
        k.type === "configuration.skill.save" ||
        k.type === "configuration.skill.register" ||
        k.type === "configuration.skill.remove" ||
        k.type === "configuration.agent.save" ||
        k.type === "file.save" ||
        Boolean(agentRuntimeStep(k.type))) &&
        (!k.workspaceId || k.sessionId !== undefined)) ||
      (k.type === "configuration.skill.apply" &&
        (!k.workspaceId || !k.sessionId))
    )
      return false;
    const key = operationKey(k.runtimeEpoch, k.operationId);
    if (retained.has(key)) return false;
    retained.add(key);
  }
  return (
    recovery.state !== "recovery_required" ||
    (next.state === "unavailable" &&
      !next.messages.length &&
      !next.permissions.length)
  );
}
const sameOperation = (a: OperationIdentity, b: OperationIdentity) =>
  a.type === b.type &&
  a.workspaceId === b.workspaceId &&
  a.sessionId === b.sessionId;
function retainedProjection(
  state: State,
  next: WorkbenchSnapshot,
): State["operations"] | null {
  const incoming = new Map(
    next.retainedOperations.map((k) => [
      operationKey(k.runtimeEpoch, k.operationId),
      k,
    ]),
  );
  let operations = state.operations;
  const write = (key: string, intent: Intent) => {
    if (operations === state.operations) operations = { ...operations };
    operations[key] = intent;
  };
  for (const [key, intent] of Object.entries(state.operations)) {
    const retained = incoming.get(key);
    if (retained && !sameOperation(intent.operation, retained)) return null;
    if (Boolean(intent.hostHeld) !== Boolean(retained))
      write(key, { ...intent, hostHeld: Boolean(retained) });
  }
  for (const [key, retained] of incoming) {
    if (operations[key]) continue;
    const { runtimeEpoch, operationId, ...operation } = retained;
    write(key, {
      id: operationId,
      epoch: runtimeEpoch,
      operation,
      lookupOnly: true,
      hostHeld: true,
      origin: { generation: -1 },
      key: selectionKey(operation.workspaceId, operation.sessionId),
      navigate: false,
      status: "unknown",
    });
  }
  return Object.keys(operations).length <= 2048 ? operations : null;
}
// Unknown local outcomes remain held. Host-held keys need accepted host reconciliation,
// even if their lookup receipt reports a confirmed effect.
export const globalMutationDisabled = (state: State) =>
  !state.recovery || state.recovery.store.state !== "ready";
export function resourceMutationDisabled(
  state: State,
  workspaceId?: string,
): boolean {
  return (
    globalMutationDisabled(state) ||
    Boolean(
      workspaceId &&
        (state.recovery!.resources.some((r) => r.workspaceId === workspaceId) ||
          state.lists.sessions.some(
            (s) => s.workspaceId === workspaceId && s.status === "unavailable",
          )),
    ) ||
    Object.values(state.operations).some(
      (i) =>
        (i.hostHeld ||
          (i.lookupOnly && i.status === "unknown") ||
          ((i.operation.type.startsWith("configuration.mcp.") ||
            i.operation.type === "configuration.skill.save" ||
            i.operation.type === "configuration.agent.save" ||
            i.operation.type === "file.save" ||
            Boolean(agentRuntimeStep(i.operation.type)) ||
            Boolean(skillRuntimeStep(i.operation.type))) &&
            i.status === "pending")) &&
        (!i.operation.workspaceId ||
          i.operation.workspaceId === workspaceId ||
          (!workspaceId &&
            (i.operation.type.startsWith("configuration.mcp.") ||
              i.operation.type === "configuration.skill.save" ||
              i.operation.type === "configuration.agent.save" ||
              i.operation.type === "file.save" ||
              Boolean(agentRuntimeStep(i.operation.type)) ||
              Boolean(skillRuntimeStep(i.operation.type))))),
    )
  );
}
export function mutationDisabled(
  state: State,
  operation: OperationIdentity,
): boolean {
  return resourceMutationDisabled(state, operation.workspaceId);
}
// A disk observation belongs to this epoch and registered root. Inert comparison
// baselines and failed reads never grant permission to overwrite a file.
export function canSaveConfigurationDraft(
  state: State,
  kind: ConfigurationDraftKind,
): boolean {
  const workspace = state.lists.workspaces.find(
    (w) => w.id === state.selection.workspaceId,
  );
  if (
    !workspace ||
    !state.epoch ||
    state.connection !== "connected" ||
    resourceMutationDisabled(state, workspace.id) ||
    selectors.pending(state) ||
    Object.values(state.operations).some(
      (i) =>
        i.status === "unknown" &&
        i.key === selectionKey(workspace.id, state.selection.sessionId),
    ) ||
    Boolean(selectedExtensions(state).request) ||
    state.files.busy ||
    state.configurationIO.reads > 0 ||
    state.configurationIO.saves > 0 ||
    Object.keys(state.operations).length >= 2048 ||
    Object.values(state.configurationDrafts).some((d) => d.fileRequest) ||
    Boolean(state.skillFiles.request) ||
    Boolean(state.agentFiles.request) ||
    Object.values(state.agentDrafts).some((d) => d.request) ||
    Object.values(state.skillDrafts).some((d) => d.request)
  )
    return false;
  const draft =
    state.configurationDrafts[
      configurationDraftKey(workspace.id, workspace.path, kind)
    ];
  const observation = draft?.fileObservation;
  if (
    !draft ||
    !observation ||
    observation.epoch !== state.epoch ||
    observation.workspaceId !== workspace.id ||
    observation.path !== workspace.path ||
    observation.kind !== kind ||
    draft.fileSave?.status === "pending" ||
    draft.fileSave?.status === "unknown" ||
    !configurationFileWriteFits(kind, draft.text)
  )
    return false;
  const target = configurationTargetPath(workspace.path, kind);
  return (
    draft.fileRead?.path === target &&
    ((draft.fileRead.status === "available" &&
      draft.baselineFile?.path === target &&
      /^[a-f0-9]{64}$/.test(draft.baselineFile.version) &&
      draft.text !== draft.baseline) ||
      (draft.fileRead.status === "missing" &&
        draft.fileRead.reason === "missing_file"))
  );
}
const hex64 = (value: unknown) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const mcpSourceName = (name: unknown): name is string =>
  typeof name === "string" &&
  /^[A-Za-z0-9_.-]{1,80}$/.test(name) &&
  !["__proto__", "prototype", "constructor"].includes(name);
const mcpNativeName = (name: unknown): name is string =>
  typeof name === "string" && /^omoc-mcp-[a-f0-9]{40}$/.test(name);
export function validMcpObservation(value: WorkbenchMcpObservation): boolean {
  if (
    !closed(
      value,
      ["workspaceId", "status"],
      ["version", "servers", "reason"],
    ) ||
    !wireId(value.workspaceId, 256)
  )
    return false;
  if (value.status === "unavailable")
    return (
      closed(value, ["workspaceId", "status", "reason"]) &&
      ["unsupported_catalog", "scope_mismatch"].includes(value.reason)
    );
  if (
    value.status !== "observed" ||
    !closed(value, ["workspaceId", "status", "version", "servers"]) ||
    !hex64(value.version) ||
    !Array.isArray(value.servers) ||
    value.servers.length > 300
  )
    return false;
  const names = new Set<string>(),
    sources = new Set<string>();
  let owned = 0;
  for (const row of value.servers) {
    if (
      !closed(
        row,
        ["nativeName", "status", "ownership"],
        ["sourceName", "submittedDefinitionDigest", "sourceVersion"],
      ) ||
      typeof row.nativeName !== "string" ||
      !row.nativeName.length ||
      row.nativeName.length > 256 ||
      [...row.nativeName].some(
        (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
      ) ||
      names.has(row.nativeName)
    )
      return false;
    names.add(row.nativeName);
    if (row.ownership === "current_runtime") {
      if (
        !closed(row, [
          "nativeName",
          "status",
          "ownership",
          "sourceName",
          "submittedDefinitionDigest",
          "sourceVersion",
        ]) ||
        !mcpNativeName(row.nativeName) ||
        !mcpSourceName(row.sourceName) ||
        sources.has(row.sourceName) ||
        !hex64(row.submittedDefinitionDigest) ||
        !hex64(row.sourceVersion) ||
        ++owned > 16
      )
        return false;
      sources.add(row.sourceName);
    } else if (
      row.ownership !== "unowned" ||
      !closed(row, ["nativeName", "status", "ownership"]) ||
      (row as { status: string }).status === "absent"
    )
      return false;
    if (
      ![
        "connected",
        "pending",
        "disabled",
        "failed",
        "needs_auth",
        "absent",
      ].includes(row.status)
    )
      return false;
  }
  return true;
}
function currentMcpScope(state: State, identity: McpIdentity) {
  return (
    state.epoch === identity.epoch &&
    state.selection.workspaceId === identity.workspaceId &&
    state.selection.generation === identity.generation &&
    state.lists.workspaces.some(
      (w) =>
        w.id === identity.workspaceId &&
        w.path === identity.path &&
        w.trusted &&
        w.trustRevision === identity.trustRevision,
    )
  );
}
export const selectedMcp = (state: State): Mcp =>
  state.mcp[state.selection.workspaceId ?? ""] ?? emptyMcp;
function mcpTargetReady(state: State): boolean {
  const snapshot = state.snapshot,
    workspaceId = state.selection.workspaceId;
  return Boolean(
    workspaceId &&
      state.epoch &&
      state.connection === "connected" &&
      snapshot?.runtimeEpoch === state.epoch &&
      snapshot.state === "connected" &&
      snapshot.revision >= state.revision &&
      snapshot.selectedWorkspaceId === workspaceId &&
      state.lists.workspaces.some((w) => w.id === workspaceId && w.trusted) &&
      snapshot.sessions
        .filter((s) => s.workspaceId === workspaceId)
        .every((s) => s.status === "idle") &&
      !snapshot.permissions.length,
  );
}
export const selectedExtensions = (state: State): Extensions => {
  const key = state.selection.workspaceId ?? "";
  return Object.hasOwn(state.extensions, key)
    ? state.extensions[key]!
    : emptyExtensions;
};
export function extensionsHeld(state: State): boolean {
  return (
    resourceMutationDisabled(state, state.selection.workspaceId) ||
    Object.values(state.operations).some(
      (i) =>
        (i.status === "pending" || i.status === "unknown" || i.hostHeld) &&
        (!i.operation.workspaceId ||
          i.operation.workspaceId === state.selection.workspaceId),
    )
  );
}
function extensionTargetReady(state: State): boolean {
  return mcpTargetReady(state) && !extensionsHeld(state);
}
export function currentExtensionScope(
  state: State,
  identity: ExtensionIdentity,
): boolean {
  return (
    state.epoch === identity.epoch &&
    state.selection.workspaceId === identity.workspaceId &&
    state.selection.generation === identity.selectionGeneration &&
    state.extensionsGeneration === identity.generation &&
    state.revision === identity.floor &&
    state.lists.workspaces.some(
      (w) =>
        w.id === identity.workspaceId &&
        w.path === identity.path &&
        w.trusted &&
        w.trustRevision === identity.trustRevision,
    )
  );
}
export function currentExtensionObservation(
  state: State,
): WorkbenchExtensionsObservation | undefined {
  const entry = selectedExtensions(state);
  return !entry.request &&
    !entry.error &&
    extensionTargetReady(state) &&
    entry.observationIdentity &&
    currentExtensionScope(state, entry.observationIdentity)
    ? entry.observation
    : undefined;
}
export function extensionReadBlockReason(
  state: State,
):
  | "no_workspace"
  | "untrusted"
  | "held"
  | "disconnected"
  | "snapshot_required"
  | "busy"
  | undefined {
  const workspace = state.lists.workspaces.find(
    (w) => w.id === state.selection.workspaceId,
  );
  if (!workspace) return "no_workspace";
  if (!workspace.trusted) return "untrusted";
  if (extensionsHeld(state)) return "held";
  if (state.connection !== "connected") return "disconnected";
  if (!mcpTargetReady(state)) return "snapshot_required";
  if (!canObserveExtensions(state) && !selectedExtensions(state).request)
    return "busy";
  return undefined;
}
export function canObserveExtensions(state: State): boolean {
  return (
    extensionTargetReady(state) &&
    !selectedExtensions(state).request &&
    state.configurationIO.reads === 0 &&
    state.configurationIO.saves === 0 &&
    !state.files.busy &&
    !state.skillRuntime.request &&
    !state.agentRuntime.request &&
    !state.skillFiles.request &&
    !state.agentFiles.request &&
    !Object.values(state.mcp).some((entry) => entry.request) &&
    !Object.values(state.instructions).some((entry) => entry.request) &&
    !Object.values(state.skillDrafts).some((draft) => draft.request) &&
    !Object.values(state.agentDrafts).some((draft) => draft.request) &&
    !Object.values(state.configurationDrafts).some((draft) => draft.fileRequest)
  );
}
export function currentMcpObservation(
  state: State,
): WorkbenchMcpObservation | undefined {
  const entry = selectedMcp(state);
  return mcpTargetReady(state) &&
    !resourceMutationDisabled(state, state.selection.workspaceId) &&
    entry.observationIdentity &&
    currentMcpScope(state, entry.observationIdentity) &&
    entry.observationIdentity.floor === state.revision
    ? entry.observation
    : undefined;
}
export function canObserveMcp(state: State): boolean {
  return (
    mcpTargetReady(state) &&
    !selectedMcp(state).request &&
    !selectors.pending(state) &&
    !resourceMutationDisabled(state, state.selection.workspaceId) &&
    state.configurationIO.reads === 0 &&
    state.configurationIO.saves === 0 &&
    !selectedExtensions(state).request &&
    !state.files.busy &&
    !(
      Object.values(state.configurationDrafts).some((d) => d.fileRequest) ||
      Boolean(state.skillRuntime.request) ||
      Boolean(state.agentRuntime.request) ||
      Boolean(state.skillFiles.request) ||
      Boolean(state.agentFiles.request) ||
      Object.values(state.agentDrafts).some((d) => d.request) ||
      Object.values(state.skillDrafts).some((d) => d.request)
    )
  );
}
function canMutateMcp(state: State): boolean {
  return (
    canObserveMcp(state) &&
    Object.keys(state.operations).length < 2048 &&
    currentMcpObservation(state)?.status === "observed"
  );
}
export type McpDefinition =
  | { type: "local"; command: string[]; cwd?: string; disabled?: boolean }
  | { type: "remote"; url: string; oauth?: false; disabled?: boolean };
// The existing inert file validator accepts omitted oauth. Execution has the
// narrower explicit-oauth contract. Canonical cwd remains host confirmation data.
export function mcpDefinitions(text: string): Record<string, McpDefinition> {
  if (!configurationFileWriteFits("mcp", text)) return {};
  try {
    return JSON.parse(text.replace(/^\uFEFF/, "")).mcp.servers;
  } catch {
    return {};
  }
}
export function canRegisterMcp(state: State, sourceName?: string): boolean {
  if (!sourceName || !mcpSourceName(sourceName) || !canMutateMcp(state))
    return false;
  const workspace = state.lists.workspaces.find(
    (w) => w.id === state.selection.workspaceId,
  )!;
  const draft =
    state.configurationDrafts[
      configurationDraftKey(workspace.id, workspace.path, "mcp")
    ];
  const observationIdentity = selectedMcp(state).observationIdentity;
  const target = configurationTargetPath(workspace.path, "mcp");
  const definition = draft && mcpDefinitions(draft.text)[sourceName];
  const observation = currentMcpObservation(state);
  return Boolean(
    draft &&
      observationIdentity &&
      sameMcpDraft(draft, observationIdentity.draft) &&
      draft.fileObservation?.epoch === state.epoch &&
      draft.fileObservation?.workspaceId === workspace.id &&
      draft.fileObservation?.path === workspace.path &&
      draft.fileRead?.status === "available" &&
      draft.fileRead.path === target &&
      draft.baselineFile?.path === target &&
      hex64(draft.baselineFile.version) &&
      draft.text === draft.baseline &&
      draft.fileSave?.status !== "pending" &&
      draft.fileSave?.status !== "unknown" &&
      definition &&
      (definition.type === "local" || definition.oauth === false) &&
      observation?.status === "observed" &&
      !observation.servers.some(
        (row) =>
          row.ownership === "current_runtime" &&
          row.sourceName === sourceName &&
          row.status !== "absent",
      ),
  );
}
function ownedMcp(state: State, sourceName?: string) {
  const observation = currentMcpObservation(state);
  return sourceName && observation?.status === "observed"
    ? observation.servers.find(
        (row) =>
          row.ownership === "current_runtime" && row.sourceName === sourceName,
      )
    : undefined;
}
export const canConnectMcp = (state: State, sourceName?: string) => {
  const row = ownedMcp(state, sourceName);
  return (
    canMutateMcp(state) &&
    Boolean(row && ["disabled", "failed", "needs_auth"].includes(row.status))
  );
};
export const canDisconnectMcp = (state: State, sourceName?: string) => {
  const row = ownedMcp(state, sourceName);
  return (
    canMutateMcp(state) &&
    Boolean(
      row &&
        ["connected", "pending", "failed", "needs_auth"].includes(row.status),
    )
  );
};
export const canRemoveMcp = (state: State, sourceName?: string) =>
  canMutateMcp(state) && Boolean(ownedMcp(state, sourceName));
export function sameMcpDraft(
  a: ConfigurationDraft | undefined,
  b: ConfigurationDraft | undefined,
) {
  return (
    a === b ||
    Boolean(
      a &&
        b &&
        a.revision === b.revision &&
        a.text === b.text &&
        a.baseline === b.baseline &&
        a.baselineFile === b.baselineFile &&
        a.fileObservation === b.fileObservation,
    )
  );
}
function mcpActionState(
  state: State,
  intent: Intent,
  status: NonNullable<Mcp["action"]>["status"],
  code?: string,
): State {
  const identity = intent.mcpMutation;
  if (
    !identity ||
    !currentMcpScope(state, identity) ||
    state.mcp[identity.workspaceId]?.action?.identity !== identity
  )
    return state;
  const draftKey = configurationDraftKey(
    identity.workspaceId,
    identity.path,
    "mcp",
  );
  const draft = state.configurationDrafts[draftKey];
  const invalidateFile =
    draft &&
    identity.draft &&
    draft.fileObservation === identity.draft.fileObservation &&
    draft.baselineFile === identity.draft.baselineFile &&
    code &&
    [
      "FILE_CHANGED",
      "FILE_DENIED",
      "FILE_UNSUPPORTED",
      "FILE_TOO_LARGE",
    ].includes(code);
  const invalidatedDraft = invalidateFile ? { ...draft } : undefined;
  if (invalidatedDraft) delete invalidatedDraft.fileObservation;
  return {
    ...state,
    ...(invalidatedDraft
      ? {
          configurationDrafts: {
            ...state.configurationDrafts,
            [draftKey]: invalidatedDraft,
          },
        }
      : {}),
    mcp: {
      ...state.mcp,
      [identity.workspaceId]: {
        action: {
          identity,
          status,
          current:
            identity.request.type !== "configuration.mcp.register" ||
            sameMcpDraft(draft, identity.draft),
          ...(code ? { code } : {}),
        },
      },
    },
  };
}
function validMcpReceipt(receipt: RedactedReceipt, intent: Intent): boolean {
  const identity = intent.mcpMutation;
  if (
    !closed(
      receipt,
      [
        "runtimeEpoch",
        "operationId",
        "type",
        "workspaceId",
        "admission",
        "delivery",
        "effect",
        "revision",
        "evidence",
      ],
      ["result"],
    ) ||
    receipt.workspaceId !== intent.operation.workspaceId ||
    !Array.isArray(receipt.evidence) ||
    receipt.evidence.length > 8 ||
    !receipt.evidence.every(
      (e) =>
        closed(e, ["kind"], ["id"]) &&
        wireId(e.kind, 256) &&
        (!Object.hasOwn(e, "id") || wireId(e.id, 256)),
    ) ||
    (identity && receipt.revision < identity.floor) ||
    (intent.receipt?.admission === "dispatched" &&
      receipt.admission !== "dispatched")
  )
    return false;
  const result = receipt.result;
  const absentRemoval =
    receipt.type === "configuration.mcp.remove" &&
    receipt.effect === "none" &&
    receipt.admission === "admitted" &&
    receipt.delivery === "accepted" &&
    result?.kind === "mcp_removed";
  if (receipt.effect === "none" && !absentRemoval)
    return (
      receipt.admission === "rejected" &&
      receipt.delivery === "pending" &&
      !receipt.evidence.length &&
      (!identity || receipt.revision > identity.floor) &&
      closed(result, ["kind", "code"]) &&
      result?.kind === "rejected" &&
      [
        ...instructionErrorCodes,
        "MCP_CHANGED",
        "MCP_UNVERIFIED",
        "MCP_UNSUPPORTED",
        "MCP_OWNERSHIP_CONFLICT",
      ].includes(result.code)
    );
  if (receipt.effect !== "confirmed" && !absentRemoval)
    return (
      receipt.admission !== "rejected" &&
      ["pending", "unknown"].includes(receipt.effect) &&
      result === undefined
    );
  if (
    receipt.delivery !== "accepted" ||
    (!absentRemoval && !receipt.evidence.length) ||
    (identity && receipt.revision <= identity.floor) ||
    !result ||
    !("workspaceId" in result) ||
    result.workspaceId !== receipt.workspaceId ||
    !("nativeName" in result) ||
    !mcpNativeName(result.nativeName) ||
    !mcpSourceName(result.sourceName) ||
    (identity &&
      (result.nativeName !== identity.nativeName ||
        result.sourceName !== identity.request.sourceName))
  )
    return false;
  const common = ["kind", "workspaceId", "sourceName", "nativeName"];
  if (intent.operation.type === "configuration.mcp.remove")
    return (
      result.kind === "mcp_removed" &&
      closed(result, common) &&
      (absentRemoval || receipt.admission === "dispatched")
    );
  if (receipt.admission !== "dispatched") return false;
  if (intent.operation.type === "configuration.mcp.register")
    return (
      result.kind === "mcp_registered" &&
      closed(result, [...common, "digest", "sourceVersion", "status"]) &&
      result.status === "disabled" &&
      hex64(result.digest) &&
      hex64(result.sourceVersion) &&
      (!identity ||
        (identity.request.type === "configuration.mcp.register" &&
          result.sourceVersion === identity.request.fileVersion))
    );
  return (
    result.kind === "mcp_connection" &&
    closed(result, [...common, "action", "connectionStatus"]) &&
    result.action ===
      (intent.operation.type === "configuration.mcp.connect"
        ? "connect"
        : "disconnect") &&
    (result.action === "disconnect"
      ? result.connectionStatus === "disabled"
      : ["connected", "failed", "needs_auth"].includes(result.connectionStatus))
  );
}
export function validInstructionObservation(
  value: WorkbenchInstructionObservation,
): boolean {
  if (
    !closed(
      value,
      ["workspaceId", "sessionId", "status"],
      [
        "version",
        "digest",
        "sourceVersion",
        "origin",
        "inheritedFromSessionId",
        "reason",
      ],
    ) ||
    !wireId(value.workspaceId, 256) ||
    !wireId(value.sessionId, 256)
  )
    return false;
  const scope = ["workspaceId", "sessionId", "status"];
  switch (value.status) {
    case "missing":
      return closed(value, [...scope, "version"]) && hex64(value.version);
    case "changed":
      return (
        closed(value, [...scope, "version"], ["digest"]) &&
        hex64(value.version) &&
        (!Object.hasOwn(value, "digest") || hex64(value.digest))
      );
    case "registered":
      return (
        closed(value, [
          ...scope,
          "version",
          "digest",
          "sourceVersion",
          "origin",
          ...(value.origin === "fork" ? ["inheritedFromSessionId"] : []),
        ]) &&
        hex64(value.version) &&
        hex64(value.digest) &&
        hex64(value.sourceVersion) &&
        (value.origin === "direct" ||
          (value.origin === "fork" &&
            wireId(value.inheritedFromSessionId, 256) &&
            value.inheritedFromSessionId !== value.sessionId))
      );
    case "unavailable":
      return (
        closed(value, [...scope, "reason"]) &&
        ["ownership_conflict", "unsupported_entries"].includes(value.reason)
      );
    default:
      return false;
  }
}
function currentInstructionScope(state: State, identity: InstructionIdentity) {
  return (
    sameScope(state, identity) &&
    state.lists.workspaces.some(
      (w) =>
        w.id === identity.workspaceId &&
        w.path === identity.path &&
        w.trustRevision === identity.trustRevision,
    )
  );
}
export function selectedInstructions(state: State): Instructions {
  return (
    state.instructions[
      selectionKey(state.selection.workspaceId, state.selection.sessionId)
    ] ?? emptyInstructions
  );
}
export function currentInstructionObservation(
  state: State,
): WorkbenchInstructionObservation | undefined {
  const entry = selectedInstructions(state);
  return instructionTargetReady(state) &&
    !resourceMutationDisabled(state, state.selection.workspaceId) &&
    entry.observationIdentity &&
    currentInstructionScope(state, entry.observationIdentity) &&
    entry.observationIdentity.floor === state.revision
    ? entry.observation
    : undefined;
}
function instructionTargetReady(state: State): boolean {
  const snapshot = state.snapshot;
  return Boolean(
    state.epoch &&
      state.connection === "connected" &&
      snapshot?.runtimeEpoch === state.epoch &&
      snapshot.state === "connected" &&
      snapshot.revision >= state.revision &&
      snapshot.selectedWorkspaceId === state.selection.workspaceId &&
      snapshot.selectedSessionId === state.selection.sessionId &&
      state.lists.workspaces.some(
        (w) => w.id === state.selection.workspaceId && w.trusted,
      ) &&
      snapshot.sessions.some(
        (s) =>
          s.id === state.selection.sessionId &&
          s.workspaceId === state.selection.workspaceId &&
          !s.archived &&
          s.status === "idle",
      ) &&
      !snapshot.permissions.length,
  );
}
export function canObserveInstructions(state: State): boolean {
  return (
    instructionTargetReady(state) &&
    !selectedInstructions(state).request &&
    !selectors.pending(state) &&
    !resourceMutationDisabled(state, state.selection.workspaceId) &&
    state.configurationIO.reads === 0 &&
    state.configurationIO.saves === 0 &&
    !selectedExtensions(state).request &&
    !state.files.busy &&
    !(
      Object.values(state.configurationDrafts).some((d) => d.fileRequest) ||
      Boolean(state.skillRuntime.request) ||
      Boolean(state.agentRuntime.request) ||
      Boolean(state.skillFiles.request) ||
      Boolean(state.agentFiles.request) ||
      Object.values(state.agentDrafts).some((d) => d.request) ||
      Object.values(state.skillDrafts).some((d) => d.request)
    )
  );
}
function canMutateInstructions(state: State): boolean {
  const entry = selectedInstructions(state);
  return (
    canObserveInstructions(state) &&
    Object.keys(state.operations).length < 2048 &&
    !Object.values(state.operations).some(
      (i) =>
        i.status === "unknown" &&
        i.key ===
          selectionKey(state.selection.workspaceId, state.selection.sessionId),
    ) &&
    Boolean(
      entry.observation &&
        entry.observation.status !== "unavailable" &&
        entry.observationIdentity &&
        currentInstructionScope(state, entry.observationIdentity) &&
        entry.observationIdentity.floor === state.revision,
    )
  );
}
export function canApplyInstructions(state: State): boolean {
  if (!canMutateInstructions(state)) return false;
  const workspace = state.lists.workspaces.find(
    (w) => w.id === state.selection.workspaceId,
  )!;
  const draft =
    state.configurationDrafts[
      configurationDraftKey(workspace.id, workspace.path, "instructions")
    ];
  const target = configurationTargetPath(workspace.path, "instructions");
  return Boolean(
    draft &&
      draft.fileObservation &&
      draft.fileObservation.epoch === state.epoch &&
      draft.fileObservation.workspaceId === workspace.id &&
      draft.fileObservation.path === workspace.path &&
      draft.fileRead?.status === "available" &&
      draft.fileRead.path === target &&
      draft.baselineFile?.path === target &&
      hex64(draft.baselineFile.version) &&
      draft.text === draft.baseline &&
      configurationFileWriteFits("instructions", draft.text) &&
      draft.fileSave?.status !== "pending" &&
      draft.fileSave?.status !== "unknown",
  );
}
export const canRemoveInstructions = (state: State) =>
  canMutateInstructions(state);
function instructionActionState(
  state: State,
  intent: Intent,
  status: NonNullable<Instructions["action"]>["status"],
  code?: string,
): State {
  const identity = intent.instructionMutation;
  if (!identity || !currentInstructionScope(state, identity)) return state;
  const key = selectionKey(identity.workspaceId, identity.sessionId);
  const entry = state.instructions[key];
  if (entry?.action?.identity !== identity) return state;
  const draft =
    state.configurationDrafts[
      configurationDraftKey(identity.workspaceId, identity.path, "instructions")
    ];
  const invalidateFile =
    draft &&
    code &&
    [
      "FILE_CHANGED",
      "FILE_DENIED",
      "FILE_UNSUPPORTED",
      "FILE_TOO_LARGE",
    ].includes(code);
  const invalidatedDraft = invalidateFile ? { ...draft } : undefined;
  if (invalidatedDraft) delete invalidatedDraft.fileObservation;
  return {
    ...state,
    ...(invalidatedDraft
      ? {
          configurationDrafts: {
            ...state.configurationDrafts,
            [configurationDraftKey(
              identity.workspaceId,
              identity.path,
              "instructions",
            )]: invalidatedDraft,
          },
        }
      : {}),
    instructions: {
      ...state.instructions,
      [key]: {
        action: {
          identity,
          status,
          current:
            draft === identity.draft ||
            Boolean(
              draft &&
                identity.draft &&
                draft.revision === identity.draft.revision &&
                draft.text === identity.draft.text &&
                draft.baseline === identity.draft.baseline &&
                draft.baselineFile === identity.draft.baselineFile &&
                draft.fileObservation === identity.draft.fileObservation,
            ),
          ...(code ? { code } : {}),
        },
      },
    },
  };
}
function instructionLookupOnly(intent: Intent): Intent {
  return {
    ...intent,
    lookupOnly: true,
    operation: {
      type: intent.operation.type,
      ...(intent.operation.workspaceId
        ? { workspaceId: intent.operation.workspaceId }
        : {}),
      ...(intent.operation.sessionId
        ? { sessionId: intent.operation.sessionId }
        : {}),
    },
  };
}
const instructionErrorCodes = [
  "INSTRUCTIONS_CHANGED",
  "INSTRUCTIONS_UNVERIFIED",
  "READ_BUSY",
  "READ_TIMEOUT",
  "STALE_EPOCH",
  "STALE_REVISION",
  "ARCHIVED_SESSION",
  "EMPTY_SESSION",
  "HAS_DESCENDANTS",
  "DESCENDANTS_UNVERIFIED",
  "INVALID_REQUEST",
  "NOT_FOUND",
  "BUSY",
  "CANCELLED",
  "UNAVAILABLE",
  "AUTH_REQUIRED",
  "POLICY_UNVERIFIED",
  "INVALID_SELECTION",
  "STALE_PERMISSION",
  "DUPLICATE_CONFLICT",
  "LIMIT_REACHED",
  "FILE_CHANGED",
  "FILE_DENIED",
  "FILE_UNSUPPORTED",
  "FILE_TOO_LARGE",
  "RUNTIME_ERROR",
  "TOOL_ERROR",
  "UNKNOWN_OUTCOME",
];
function validInstructionReceipt(
  receipt: RedactedReceipt,
  intent: Intent,
): boolean {
  if (
    !closed(
      receipt,
      [
        "runtimeEpoch",
        "operationId",
        "type",
        "workspaceId",
        "sessionId",
        "admission",
        "delivery",
        "effect",
        "revision",
        "evidence",
      ],
      ["result"],
    ) ||
    receipt.workspaceId !== intent.operation.workspaceId ||
    receipt.sessionId !== intent.operation.sessionId ||
    !Array.isArray(receipt.evidence) ||
    receipt.evidence.length > 8 ||
    !receipt.evidence.every(
      (e) =>
        closed(e, ["kind"], ["id"]) &&
        wireId(e.kind, 256) &&
        (!Object.hasOwn(e, "id") || wireId(e.id, 256)),
    )
  )
    return false;
  const identity = intent.instructionMutation;
  if (identity && receipt.revision < identity.floor) return false;
  if (
    intent.receipt?.admission === "dispatched" &&
    receipt.admission !== "dispatched"
  )
    return false;
  const result = receipt.result;
  if (receipt.effect === "confirmed") {
    if (
      receipt.admission !== "dispatched" ||
      receipt.delivery !== "accepted" ||
      (identity && receipt.revision <= identity.floor) ||
      !receipt.evidence.length ||
      !result ||
      !("workspaceId" in result) ||
      result.workspaceId !== receipt.workspaceId ||
      !("sessionId" in result) ||
      result.sessionId !== receipt.sessionId
    )
      return false;
    if (intent.operation.type === "configuration.instructions.remove")
      return (
        closed(result, ["kind", "workspaceId", "sessionId"]) &&
        result.kind === "instruction_removed"
      );
    return (
      closed(result, [
        "kind",
        "workspaceId",
        "sessionId",
        "digest",
        "sourceVersion",
      ]) &&
      result.kind === "instruction_registered" &&
      hex64(result.digest) &&
      hex64(result.sourceVersion) &&
      (!identity ||
        (identity.request.type === "configuration.instructions.apply" &&
          result.digest === identity.digest &&
          result.sourceVersion === identity.request.fileVersion))
    );
  }
  if (receipt.effect === "none")
    return (
      receipt.admission === "rejected" &&
      receipt.delivery === "pending" &&
      !receipt.evidence.length &&
      (!identity || receipt.revision > identity.floor) &&
      closed(result, ["kind", "code"]) &&
      result?.kind === "rejected" &&
      instructionErrorCodes.includes(result.code)
    );
  return (
    receipt.admission !== "rejected" &&
    ["pending", "unknown"].includes(receipt.effect) &&
    result === undefined
  );
}
function configurationSaveState(
  state: State,
  intent: Intent,
  status: NonNullable<ConfigurationDraft["fileSave"]>["status"],
  result?: Extract<
    NonNullable<RedactedReceipt["result"]>,
    { kind: "configuration_saved" }
  >,
  code?: string,
): State {
  const identity = intent.configurationSave;
  if (
    !identity ||
    state.epoch !== identity.epoch ||
    state.selection.workspaceId !== identity.workspaceId ||
    !state.lists.workspaces.some(
      (w) => w.id === identity.workspaceId && w.path === identity.path,
    )
  )
    return state;
  const key = configurationDraftKey(
    identity.workspaceId,
    identity.path,
    identity.kind,
  );
  const draft = state.configurationDrafts[key];
  if (!draft || draft.fileSave?.identity !== identity) return state;
  const next: ConfigurationDraft = {
    ...draft,
    fileSave: {
      identity,
      status,
      current:
        draft.revision === identity.revision &&
        draft.text === identity.request.text,
      ...(code ? { code } : {}),
      ...(result
        ? {
            version: result.version,
            ...(result.backupId ? { backupId: result.backupId } : {}),
          }
        : {}),
    },
  };
  if (status === "saved" && result) {
    // Baseline is the captured bytes; a newer edit keeps its text/revision.
    next.baseline = identity.request.text;
    next.baselineFile = {
      path: configurationTargetPath(identity.path, identity.kind),
      version: result.version,
    };
    next.fileRead = { status: "available", path: next.baselineFile.path };
  } else if (status === "conflict" || status === "denied") {
    // Require a fresh explicit observation after refusal or changed source.
    delete next.fileObservation;
  }
  return {
    ...state,
    configurationDrafts: { ...state.configurationDrafts, [key]: next },
  };
}
function validConfigurationReceipt(
  receipt: RedactedReceipt,
  intent: Intent,
  fileBackupProof?: string,
): boolean {
  if (
    !closed(
      receipt,
      [
        "runtimeEpoch",
        "operationId",
        "type",
        "workspaceId",
        "admission",
        "delivery",
        "effect",
        "revision",
        "evidence",
      ],
      ["result"],
    ) ||
    receipt.workspaceId !== intent.operation.workspaceId ||
    !Array.isArray(receipt.evidence) ||
    receipt.evidence.length > 8 ||
    !receipt.evidence.every(
      (e) =>
        closed(e, ["kind"], ["id"]) &&
        wireId(e.kind, 256) &&
        (!Object.hasOwn(e, "id") || wireId(e.id, 256)),
    )
  )
    return false;
  const identity =
    intent.workspaceFileSave ??
    intent.agentSave ??
    intent.skillSave ??
    intent.configurationSave;
  if (identity && receipt.revision < identity.floor) return false;
  if (
    intent.receipt?.admission === "dispatched" &&
    receipt.admission !== "dispatched"
  )
    return false;
  const result = receipt.result;
  if (receipt.effect === "confirmed" && intent.operation.type === "file.save") {
    const file = intent.workspaceFileSave;
    return Boolean(
      receipt.admission === "dispatched" &&
        receipt.delivery === "accepted" &&
        (!file || receipt.revision > file.floor) &&
        receipt.evidence.some(
          (e) => e.kind === "host-registry" && e.id === receipt.workspaceId,
        ) &&
        closed(result, [
          "kind",
          "workspaceId",
          "path",
          "version",
          "digest",
          "backupId",
        ]) &&
        result?.kind === "file_saved" &&
        result.workspaceId === receipt.workspaceId &&
        validWorkspaceFilePath(result.path) &&
        !workspaceFilePathReason(result.path) &&
        hex64(result.version) &&
        hex64(result.digest) &&
        /^\.omoc-configuration-[a-f0-9]{64}\.file\.backup$/.test(
          result.backupId,
        ) &&
        result.backupId === (file?.backupId ?? fileBackupProof) &&
        (!file ||
          (result.path === file.path &&
            result.digest === file.digest &&
            result.backupId === file.backupId)),
    );
  }
  if (
    receipt.effect === "confirmed" &&
    intent.operation.type === "configuration.skill.save"
  ) {
    const skill = intent.skillSave;
    return Boolean(
      receipt.admission === "dispatched" &&
        receipt.delivery === "accepted" &&
        (!skill || receipt.revision > skill.floor) &&
        receipt.evidence.some(
          (e) => e.kind === "host-registry" && e.id === receipt.workspaceId,
        ) &&
        closed(
          result,
          ["kind", "workspaceId", "sourceName", "version"],
          ["backupId"],
        ) &&
        result?.kind === "skill_file_saved" &&
        result.workspaceId === receipt.workspaceId &&
        validSkillSourceName(result.sourceName) &&
        hex64(result.version) &&
        (!Object.hasOwn(result, "backupId") ||
          (typeof result.backupId === "string" &&
            /^\.omoc-configuration-[a-f0-9]{64}\.skill\.backup$/.test(
              result.backupId,
            ))) &&
        (!skill ||
          (result.sourceName === skill.sourceName &&
            result.backupId === skill.backupId)),
    );
  }
  if (
    receipt.effect === "confirmed" &&
    intent.operation.type === "configuration.agent.save"
  ) {
    const agent = intent.agentSave;
    return Boolean(
      receipt.admission === "dispatched" &&
        receipt.delivery === "accepted" &&
        (!agent || receipt.revision > agent.floor) &&
        receipt.evidence.some(
          (e) => e.kind === "host-registry" && e.id === receipt.workspaceId,
        ) &&
        closed(
          result,
          ["kind", "workspaceId", "sourceName", "version"],
          ["backupId"],
        ) &&
        result?.kind === "agent_file_saved" &&
        result.workspaceId === receipt.workspaceId &&
        validAgentSourceName(result.sourceName) &&
        hex64(result.version) &&
        (!Object.hasOwn(result, "backupId") ||
          (typeof result.backupId === "string" &&
            /^\.omoc-configuration-[a-f0-9]{64}\.agent\.backup$/.test(
              result.backupId,
            ))) &&
        (!agent ||
          (result.sourceName === agent.sourceName &&
            result.backupId === agent.backupId)),
    );
  }
  if (receipt.effect === "confirmed") {
    const identity = intent.configurationSave;
    return (
      receipt.admission === "dispatched" &&
      receipt.delivery === "accepted" &&
      (!identity || receipt.revision > identity.floor) &&
      receipt.evidence.some(
        (e) => e.kind === "host-registry" && e.id === receipt.workspaceId,
      ) &&
      closed(
        result,
        ["kind", "workspaceId", "configurationKind", "version"],
        ["backupId"],
      ) &&
      result?.kind === "configuration_saved" &&
      result.workspaceId === receipt.workspaceId &&
      ["instructions", "mcp"].includes(result.configurationKind) &&
      typeof result.version === "string" &&
      /^[a-f0-9]{64}$/.test(result.version) &&
      (!Object.hasOwn(result, "backupId") ||
        (typeof result.backupId === "string" &&
          new RegExp(
            `^\\.omoc-configuration-[a-f0-9]{64}\\.${result.configurationKind}\\.backup$`,
          ).test(result.backupId))) &&
      (!identity ||
        (result.configurationKind === identity.kind &&
          result.backupId === identity.backupId))
    );
  }
  if (
    result !== undefined &&
    !(
      closed(result, ["kind", "code"]) &&
      result.kind === "rejected" &&
      wireId(result.code) &&
      receipt.effect === "none" &&
      receipt.admission === "rejected"
    )
  )
    return false;
  if (receipt.effect === "none")
    return (
      receipt.admission === "rejected" &&
      receipt.delivery === "pending" &&
      receipt.evidence.length === 0 &&
      (!identity || receipt.revision > identity.floor) &&
      result?.kind === "rejected" &&
      [
        "READ_BUSY",
        "READ_TIMEOUT",
        "STALE_EPOCH",
        "STALE_REVISION",
        "ARCHIVED_SESSION",
        "EMPTY_SESSION",
        "HAS_DESCENDANTS",
        "DESCENDANTS_UNVERIFIED",
        "INVALID_REQUEST",
        "NOT_FOUND",
        "BUSY",
        "CANCELLED",
        "UNAVAILABLE",
        "AUTH_REQUIRED",
        "POLICY_UNVERIFIED",
        "INVALID_SELECTION",
        "STALE_PERMISSION",
        "DUPLICATE_CONFLICT",
        "LIMIT_REACHED",
        "FILE_CHANGED",
        "FILE_DENIED",
        "FILE_UNSUPPORTED",
        "FILE_TOO_LARGE",
        "RUNTIME_ERROR",
        "TOOL_ERROR",
        "UNKNOWN_OUTCOME",
      ].includes(result.code)
    );
  return (
    ["pending", "unknown"].includes(receipt.effect) &&
    receipt.admission !== "rejected"
  );
}
const findIntentKey = (state: State, id: string) => {
  if (state.operations[id]) return id;
  const keys = Object.keys(state.operations).filter(
    (k) => state.operations[k]!.id === id,
  );
  return keys.length === 1 ? keys[0] : undefined;
};
function skillWorkspace(state: State) {
  return state.lists.workspaces.find(
    (w) => w.id === state.selection.workspaceId,
  );
}
export function selectedSkillDraft(state: State): SkillDraft {
  const workspace = skillWorkspace(state),
    sourceName = state.skillFiles.sourceName;
  return workspace && sourceName
    ? (state.skillDrafts[
        skillDraftKey(workspace.id, workspace.path, sourceName)
      ] ?? emptySkillDraft)
    : emptySkillDraft;
}
export function currentSkillScope(
  state: State,
  identity: SkillIdentity,
): boolean {
  const workspace = skillWorkspace(state);
  return Boolean(
    workspace?.trusted &&
      state.epoch === identity.epoch &&
      workspace.id === identity.workspaceId &&
      workspace.path === identity.path &&
      workspace.trustRevision === identity.trustRevision &&
      state.selection.generation === identity.selectionGeneration &&
      state.skillFiles.generation === identity.generation &&
      (!identity.sourceName ||
        state.skillFiles.sourceName === identity.sourceName) &&
      state.revision === identity.floor,
  );
}
export function canReadSkillFiles(state: State): boolean {
  return (
    mcpTargetReady(state) &&
    !resourceMutationDisabled(state, state.selection.workspaceId) &&
    !selectors.pending(state) &&
    !selectedExtensions(state).request &&
    !state.files.busy &&
    state.configurationIO.reads === 0 &&
    state.configurationIO.saves === 0 &&
    !state.skillRuntime.request &&
    !state.agentRuntime.request &&
    !state.agentFiles.request &&
    !Object.values(state.agentDrafts).some((d) => d.request) &&
    !state.skillFiles.request &&
    !Object.values(state.skillDrafts).some((d) => d.request) &&
    !Object.values(state.configurationDrafts).some((d) => d.fileRequest)
  );
}
export function canSaveSkillFile(state: State): boolean {
  const draft = selectedSkillDraft(state),
    read = draft.read;
  return Boolean(
    canReadSkillFiles(state) &&
      Object.keys(state.operations).length < 2048 &&
      draft.observation &&
      currentSkillScope(state, draft.observation) &&
      draft.validation?.revision === draft.revision &&
      draft.validation.status === "valid" &&
      skillFileWriteFits(draft.text) &&
      read &&
      (read.status === "missing" ||
        (read.status === "available" && draft.text !== draft.baseline)) &&
      hex64(read.directoryVersion) &&
      draft.save?.status !== "pending" &&
      draft.save?.status !== "unknown",
  );
}
export function currentSkillRuntimeScope(
  state: State,
  identity: SkillRuntimeIdentity,
): boolean {
  return (
    currentSkillScope(state, identity) &&
    state.selection.sessionId === identity.sessionId &&
    selectedSkillDraft(state) === identity.draft
  );
}
export function currentSkillRuntimeObservation(
  state: State,
): WorkbenchSkillRuntimeObservation | undefined {
  const entry = state.skillRuntime;
  return mcpTargetReady(state) &&
    !resourceMutationDisabled(state, state.selection.workspaceId) &&
    entry.observationIdentity &&
    currentSkillRuntimeScope(state, entry.observationIdentity)
    ? entry.observation
    : undefined;
}
export const canObserveSkillRuntime = (state: State) =>
  canReadSkillFiles(state) && !state.skillRuntime.request;
export function canRegisterSkill(state: State): boolean {
  const observation = currentSkillRuntimeObservation(state),
    draft = selectedSkillDraft(state),
    read = draft.read;
  const file =
    observation?.status === "observed" ? observation.file : undefined;
  return Boolean(
    canObserveSkillRuntime(state) &&
      Object.keys(state.operations).length < 2048 &&
      observation?.status === "observed" &&
      file?.status === "available" &&
      file.sourceName === state.skillFiles.sourceName &&
      !observation.owned.some((row) => row.sourceName === file.sourceName) &&
      draft.observation &&
      currentSkillScope(state, draft.observation) &&
      read?.status === "available" &&
      draft.text === draft.baseline &&
      skillFileWriteFits(draft.text) &&
      file.version === read.version &&
      file.directoryVersion === read.directoryVersion &&
      file.digest === state.skillRuntime.observationIdentity?.digest &&
      draft.save?.status !== "pending" &&
      draft.save?.status !== "unknown",
  );
}
export function canRemoveSkill(state: State, nativeId?: string): boolean {
  const observation = currentSkillRuntimeObservation(state);
  return Boolean(
    canObserveSkillRuntime(state) &&
      Object.keys(state.operations).length < 2048 &&
      observation?.status === "observed" &&
      observation.owned.some((row) => row.nativeId === nativeId),
  );
}
export function canApplySkill(state: State, nativeId?: string): boolean {
  const observation = currentSkillRuntimeObservation(state);
  return Boolean(
    canRemoveSkill(state, nativeId) &&
      instructionTargetReady(state) &&
      observation?.status === "observed" &&
      observation.session?.status === "observed" &&
      observation.session.sessionId === state.selection.sessionId &&
      !observation.session.messages.some(
        (message) => message.nativeId === nativeId,
      ),
  );
}
function skillRuntimeActionState(
  state: State,
  intent: Intent,
  status: NonNullable<SkillRuntime["action"]>["status"],
  code?: string,
): State {
  const identity = intent.skillRuntimeMutation;
  if (!identity || state.skillRuntime.action?.identity !== identity)
    return state;
  // Receipt remains original-operation evidence even when the selected draft changes.
  return {
    ...state,
    skillRuntime: {
      action: {
        identity,
        status,
        current:
          state.skillRuntime.action.current &&
          currentSkillRuntimeScope(
            { ...state, revision: identity.floor },
            identity,
          ),
        ...(code ? { code } : {}),
      },
    },
  };
}
export function validSkillRuntimeReceipt(
  receipt: RedactedReceipt,
  intent: Intent,
): boolean {
  const identity = intent.skillRuntimeMutation;
  if (
    !closed(
      receipt,
      [
        "runtimeEpoch",
        "operationId",
        "type",
        "workspaceId",
        "admission",
        "delivery",
        "effect",
        "revision",
        "evidence",
      ],
      ["sessionId", "result"],
    ) ||
    receipt.workspaceId !== intent.operation.workspaceId ||
    receipt.sessionId !== intent.operation.sessionId ||
    (identity && receipt.revision < identity.floor) ||
    !Array.isArray(receipt.evidence) ||
    receipt.evidence.length > 8 ||
    !receipt.evidence.every(
      (e) =>
        closed(e, ["kind"], ["id"]) &&
        wireId(e.kind, 256) &&
        (!Object.hasOwn(e, "id") || wireId(e.id, 256)),
    )
  )
    return false;
  if (
    intent.receipt?.admission === "dispatched" &&
    receipt.admission !== "dispatched"
  )
    return false;
  if (receipt.effect === "confirmed") {
    const result = receipt.result;
    if (
      receipt.admission !== "dispatched" ||
      receipt.delivery !== "accepted" ||
      !result ||
      !("workspaceId" in result) ||
      result.workspaceId !== receipt.workspaceId ||
      (identity && receipt.revision <= identity.floor) ||
      !receipt.evidence.length
    )
      return false;
    const kind = result.kind;
    const proof = Object.fromEntries(
      Object.entries(result).filter(
        ([key]) => key !== "kind" && key !== "workspaceId",
      ),
    );
    const status =
      receipt.type === "configuration.skill.register"
        ? "registered_disabled"
        : receipt.type === "configuration.skill.remove"
          ? "removed"
          : "applied";
    if (
      kind !==
        (status === "registered_disabled"
          ? "skill_registered"
          : status === "removed"
            ? "skill_removed"
            : "skill_applied") ||
      !validSkillRuntimeMutation({
        requestId: receipt.operationId,
        status,
        ...proof,
      })
    )
      return false;
    const value = proof as Omit<
      Extract<WorkbenchSkillRuntimeMutation, { status: "registered_disabled" }>,
      "requestId" | "status"
    >;
    if (value.registrationRuntimeEpoch !== receipt.runtimeEpoch) return false;
    if (
      identity &&
      (value.sourceName !== identity.target.sourceName ||
        value.nativeId !== identity.target.nativeId ||
        value.digest !== identity.target.digest ||
        value.registrationRuntimeEpoch !==
          identity.target.registrationRuntimeEpoch ||
        value.registrationOperationId !==
          identity.target.registrationOperationId ||
        value.nativeDigest !== identity.target.nativeDigest)
    )
      return false;
    if (status === "registered_disabled")
      return (
        value.registrationOperationId === receipt.operationId &&
        (!identity ||
          (value.version === identity.version &&
            value.directoryVersion === identity.directoryVersion &&
            value.bodyDigest === identity.target.bodyDigest))
      );
    if (status === "applied")
      return (
        "sessionId" in proof &&
        proof.sessionId === receipt.sessionId &&
        (!identity ||
          ("bodyDigest" in proof &&
            proof.bodyDigest === identity.target.bodyDigest))
      );
    return true;
  }
  if (receipt.effect === "none")
    return (
      receipt.admission === "rejected" &&
      receipt.delivery === "pending" &&
      receipt.evidence.length === 0 &&
      closed(receipt.result, ["kind", "code"]) &&
      receipt.result?.kind === "rejected" &&
      wireId(receipt.result.code, 256)
    );
  return (
    receipt.admission !== "rejected" &&
    ["pending", "unknown"].includes(receipt.effect) &&
    receipt.result === undefined
  );
}
const skillTarget = (root: string, sourceName?: string) => {
  const prefix = configurationTargetPath(root, "instructions").slice(
    0,
    -"AGENTS.md".length,
  );
  const separator = prefix.slice(-1);
  return `${prefix}.opencode${separator}skills${sourceName ? `${separator}${sourceName}${separator}SKILL.md` : ""}`;
};
export function skillTargetPath(root: string, sourceName?: string): string {
  return skillTarget(root, sourceName);
}
function denseSkillRows(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    Object.getPrototypeOf(value) === Array.prototype &&
    value.length <= SKILL_LIMITS.entries &&
    Reflect.ownKeys(value).length === value.length + 1 &&
    Array.from({ length: value.length }, (_, index) => index).every((index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      return descriptor && Object.hasOwn(descriptor, "value");
    })
  );
}
function skillListingSnapshot(value: WorkbenchSkillFiles): WorkbenchSkillFiles {
  return value.status === "available"
    ? Object.freeze({
        ...value,
        entries: value.entries.map((row) => Object.freeze({ ...row })),
      })
    : Object.freeze({ ...value });
}
function validSkillList(
  value: WorkbenchSkillFiles,
  identity: SkillIdentity,
): boolean {
  if (
    !closed(
      value,
      ["workspaceId", "workspacePath", "path", "status"],
      ["entries", "truncated", "reason"],
    ) ||
    value.workspaceId !== identity.workspaceId ||
    value.workspacePath !== identity.path ||
    value.path !== skillTarget(identity.path)
  )
    return false;
  if (value.status === "available")
    return (
      closed(value, [
        "workspaceId",
        "workspacePath",
        "path",
        "status",
        "entries",
        "truncated",
      ]) &&
      typeof value.truncated === "boolean" &&
      denseSkillRows(value.entries) &&
      value.entries.every(
        (row) =>
          closed(row, ["sourceName", "path"]) &&
          validSkillSourceName(row.sourceName) &&
          row.path === skillTarget(identity.path, row.sourceName),
      ) &&
      new Set(value.entries.map((row) => row.sourceName)).size ===
        value.entries.length
    );
  return (
    closed(value, [
      "workspaceId",
      "workspacePath",
      "path",
      "status",
      "reason",
    ]) &&
    ((value.status === "missing" && value.reason === "path_missing") ||
      (value.status === "unavailable" &&
        ["path_missing", "path_denied", "file_changed"].includes(value.reason)))
  );
}
function validSkillRead(
  value: WorkbenchSkillFile,
  identity: SkillIdentity,
): boolean {
  const common = [
    "workspaceId",
    "workspacePath",
    "sourceName",
    "path",
    "status",
  ];
  if (
    !closed(value, common, [
      "content",
      "version",
      "directoryVersion",
      "reason",
    ]) ||
    value.workspaceId !== identity.workspaceId ||
    value.workspacePath !== identity.path ||
    value.sourceName !== identity.sourceName ||
    value.path !== skillTarget(identity.path, identity.sourceName)
  )
    return false;
  if (value.status === "available")
    return (
      closed(value, [...common, "content", "version", "directoryVersion"]) &&
      skillFileContentFits(value.content) &&
      hex64(value.version) &&
      hex64(value.directoryVersion)
    );
  if (value.status === "missing")
    return (
      closed(value, [...common, "reason", "directoryVersion"]) &&
      value.reason === "missing_file" &&
      hex64(value.directoryVersion)
    );
  return (
    closed(value, [...common, "reason"]) &&
    ((value.status === "unsupported" &&
      value.reason === "unsupported_content") ||
      (value.status === "unavailable" &&
        ["path_missing", "path_denied", "file_changed", "too_large"].includes(
          value.reason,
        )))
  );
}
function skillSaveState(
  state: State,
  intent: Intent,
  status: NonNullable<SkillDraft["save"]>["status"],
  result?: Extract<
    NonNullable<RedactedReceipt["result"]>,
    { kind: "skill_file_saved" }
  >,
  code?: string,
): State {
  const identity = intent.skillSave;
  if (
    !identity ||
    !currentSkillScope({ ...state, revision: identity.floor }, identity)
  )
    return state;
  const key = skillDraftKey(
      identity.workspaceId,
      identity.path,
      identity.sourceName,
    ),
    draft = state.skillDrafts[key];
  if (!draft || draft.save?.identity !== identity) return state;
  const next = {
    ...draft,
    save: {
      identity,
      status,
      current:
        draft.revision === identity.draft?.revision &&
        draft.text === identity.request.text,
      ...(result
        ? {
            version: result.version,
            ...(result.backupId ? { backupId: result.backupId } : {}),
          }
        : {}),
      ...(code ? { code } : {}),
    },
  };
  // Receipts prove an operation, never a fresh file observation or executable content.
  if (status !== "pending") delete next.observation;
  return { ...state, skillDrafts: { ...state.skillDrafts, [key]: next } };
}
function agentWorkspace(state: State) {
  return state.lists.workspaces.find(
    (w) => w.id === state.selection.workspaceId,
  );
}
export function selectedAgentDraft(state: State): AgentDraft {
  const workspace = agentWorkspace(state),
    sourceName = state.agentFiles.sourceName;
  return workspace && sourceName
    ? (state.agentDrafts[
        agentDraftKey(workspace.id, workspace.path, sourceName)
      ] ?? emptyAgentDraft)
    : emptyAgentDraft;
}
export function currentAgentScope(
  state: State,
  identity: AgentIdentity,
): boolean {
  const workspace = agentWorkspace(state);
  return Boolean(
    workspace?.trusted &&
      state.epoch === identity.epoch &&
      workspace.id === identity.workspaceId &&
      workspace.path === identity.path &&
      workspace.trustRevision === identity.trustRevision &&
      state.selection.generation === identity.selectionGeneration &&
      state.agentFiles.generation === identity.generation &&
      (!identity.sourceName ||
        state.agentFiles.sourceName === identity.sourceName) &&
      state.revision === identity.floor,
  );
}
export function canReadAgentFiles(state: State): boolean {
  return (
    mcpTargetReady(state) &&
    !resourceMutationDisabled(state, state.selection.workspaceId) &&
    !selectors.pending(state) &&
    !selectedExtensions(state).request &&
    !state.files.busy &&
    state.configurationIO.reads === 0 &&
    state.configurationIO.saves === 0 &&
    !state.agentRuntime.request &&
    !state.skillRuntime.request &&
    !state.skillFiles.request &&
    !Object.values(state.skillDrafts).some((d) => d.request) &&
    !state.agentFiles.request &&
    !Object.values(state.agentDrafts).some((d) => d.request) &&
    !Object.values(state.configurationDrafts).some((d) => d.fileRequest)
  );
}
export function canSaveAgentFile(state: State): boolean {
  const draft = selectedAgentDraft(state),
    read = draft.read;
  return Boolean(
    canReadAgentFiles(state) &&
      Object.keys(state.operations).length < 2048 &&
      draft.observation &&
      currentAgentScope(state, draft.observation) &&
      draft.validation?.revision === draft.revision &&
      draft.validation.status === "valid" &&
      agentFileWriteFits(draft.text) &&
      read &&
      (read.status === "missing" ||
        (read.status === "available" && draft.text !== draft.baseline)) &&
      hex64(read.directoryVersion) &&
      draft.save?.status !== "pending" &&
      draft.save?.status !== "unknown",
  );
}
export function currentAgentRuntimeScope(
  state: State,
  identity: AgentRuntimeIdentity,
): boolean {
  return (
    currentAgentScope(state, identity) &&
    selectedAgentDraft(state) === identity.draft
  );
}
export function currentAgentRuntimeObservation(
  state: State,
): WorkbenchAgentRuntimeObservation | undefined {
  const entry = state.agentRuntime;
  return mcpTargetReady(state) &&
    !resourceMutationDisabled(state, state.selection.workspaceId) &&
    entry.observationIdentity &&
    currentAgentRuntimeScope(state, entry.observationIdentity)
    ? entry.observation
    : undefined;
}
export const canObserveAgentRuntime = (state: State) =>
  canReadAgentFiles(state) && !state.agentRuntime.request;
export function canRegisterAgent(state: State): boolean {
  const observation = currentAgentRuntimeObservation(state),
    draft = selectedAgentDraft(state),
    read = draft.read;
  const file =
    observation?.status === "observed" ? observation.file : undefined;
  return Boolean(
    canObserveAgentRuntime(state) &&
      Object.keys(state.operations).length < 2048 &&
      observation?.status === "observed" &&
      observation.defaultAgentId !== null &&
      file?.status === "available" &&
      file.sourceName === state.agentFiles.sourceName &&
      !observation.owned.some((row) => row.sourceName === file.sourceName) &&
      draft.observation &&
      currentAgentScope(state, draft.observation) &&
      read?.status === "available" &&
      draft.text === draft.baseline &&
      agentFileWriteFits(draft.text) &&
      file.version === read.version &&
      file.directoryVersion === read.directoryVersion &&
      file.digest === state.agentRuntime.observationIdentity?.digest &&
      draft.save?.status !== "pending" &&
      draft.save?.status !== "unknown",
  );
}
export function canRemoveAgent(state: State, nativeId?: string): boolean {
  const observation = currentAgentRuntimeObservation(state);
  return Boolean(
    canObserveAgentRuntime(state) &&
      Object.keys(state.operations).length < 2048 &&
      observation?.status === "observed" &&
      observation.owned.some(
        (row) => row.nativeId === nativeId && row.referenceCount === 0,
      ),
  );
}
function agentRuntimeActionState(
  state: State,
  intent: Intent,
  status: NonNullable<AgentRuntime["action"]>["status"],
  code?: string,
): State {
  const identity = intent.agentRuntimeMutation;
  if (!identity || state.agentRuntime.action?.identity !== identity)
    return state;
  // Receipt remains original-operation evidence even when the selected draft changes.
  return {
    ...state,
    agentRuntime: {
      action: {
        identity,
        status,
        current:
          state.agentRuntime.action.current &&
          currentAgentRuntimeScope(
            { ...state, revision: identity.floor },
            identity,
          ),
        ...(code ? { code } : {}),
      },
    },
  };
}
export function validAgentRuntimeReceipt(
  receipt: RedactedReceipt,
  intent: Intent,
): boolean {
  const identity = intent.agentRuntimeMutation;
  if (
    !closed(
      receipt,
      [
        "runtimeEpoch",
        "operationId",
        "type",
        "workspaceId",
        "admission",
        "delivery",
        "effect",
        "revision",
        "evidence",
      ],
      ["result"],
    ) ||
    receipt.workspaceId !== intent.operation.workspaceId ||
    (identity && receipt.revision < identity.floor) ||
    !Array.isArray(receipt.evidence) ||
    receipt.evidence.length > 8 ||
    !receipt.evidence.every(
      (e) =>
        closed(e, ["kind"], ["id"]) &&
        wireId(e.kind, 256) &&
        (!Object.hasOwn(e, "id") || wireId(e.id, 256)),
    )
  )
    return false;
  if (
    intent.receipt?.admission === "dispatched" &&
    receipt.admission !== "dispatched"
  )
    return false;
  if (receipt.effect === "confirmed") {
    const result = receipt.result;
    if (
      receipt.admission !== "dispatched" ||
      receipt.delivery !== "accepted" ||
      !result ||
      !("workspaceId" in result) ||
      result.workspaceId !== receipt.workspaceId ||
      (identity && receipt.revision <= identity.floor) ||
      !receipt.evidence.length
    )
      return false;
    const kind = result.kind;
    const proof = Object.fromEntries(
      Object.entries(result).filter(
        ([key]) => key !== "kind" && key !== "workspaceId",
      ),
    );
    const status =
      receipt.type === "configuration.agent.register"
        ? "registered_primary"
        : "removed";
    if (
      kind !==
        (status === "registered_primary"
          ? "agent_registered"
          : "agent_removed") ||
      !validAgentRuntimeMutation({
        requestId: receipt.operationId,
        status,
        ...proof,
      })
    )
      return false;
    const value = proof as Omit<
      Extract<WorkbenchAgentRuntimeMutation, { status: "registered_primary" }>,
      "requestId" | "status"
    >;
    if (value.registrationRuntimeEpoch !== receipt.runtimeEpoch) return false;
    if (
      identity &&
      (value.sourceName !== identity.target.sourceName ||
        value.nativeId !== identity.target.nativeId ||
        value.digest !== identity.target.digest ||
        value.registrationRuntimeEpoch !==
          identity.target.registrationRuntimeEpoch ||
        value.registrationOperationId !==
          identity.target.registrationOperationId ||
        value.nativeDigest !== identity.target.nativeDigest ||
        value.systemDigest !== identity.target.systemDigest ||
        value.defaultAgentId !== identity.defaultAgentId)
    )
      return false;
    if (status === "registered_primary")
      return (
        value.registrationOperationId === receipt.operationId &&
        (!identity ||
          (value.version === identity.version &&
            value.directoryVersion === identity.directoryVersion &&
            value.systemDigest === identity.target.systemDigest))
      );
    return true;
  }
  if (receipt.effect === "none")
    return (
      receipt.admission === "rejected" &&
      receipt.delivery === "pending" &&
      receipt.evidence.length === 0 &&
      closed(receipt.result, ["kind", "code"]) &&
      receipt.result?.kind === "rejected" &&
      wireId(receipt.result.code, 256)
    );
  return (
    receipt.admission !== "rejected" &&
    ["pending", "unknown"].includes(receipt.effect) &&
    receipt.result === undefined
  );
}
const agentTarget = (root: string, sourceName?: string) => {
  const prefix = configurationTargetPath(root, "instructions").slice(
    0,
    -"AGENTS.md".length,
  );
  const separator = prefix.slice(-1);
  return `${prefix}.opencode${separator}agents${sourceName ? `${separator}${sourceName}.md` : ""}`;
};
export function agentTargetPath(root: string, sourceName?: string): string {
  return agentTarget(root, sourceName);
}
function denseAgentRows(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    Object.getPrototypeOf(value) === Array.prototype &&
    value.length <= AGENT_LIMITS.entries &&
    Reflect.ownKeys(value).length === value.length + 1 &&
    Array.from({ length: value.length }, (_, index) => index).every((index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      return descriptor && Object.hasOwn(descriptor, "value");
    })
  );
}
function agentListingSnapshot(value: WorkbenchAgentFiles): WorkbenchAgentFiles {
  return value.status === "available"
    ? Object.freeze({
        ...value,
        entries: value.entries.map((row) => Object.freeze({ ...row })),
      })
    : Object.freeze({ ...value });
}
function validAgentList(
  value: WorkbenchAgentFiles,
  identity: AgentIdentity,
): boolean {
  if (
    !closed(
      value,
      ["workspaceId", "workspacePath", "path", "status"],
      ["entries", "truncated", "reason"],
    ) ||
    value.workspaceId !== identity.workspaceId ||
    value.workspacePath !== identity.path ||
    value.path !== agentTarget(identity.path)
  )
    return false;
  if (value.status === "available")
    return (
      closed(value, [
        "workspaceId",
        "workspacePath",
        "path",
        "status",
        "entries",
        "truncated",
      ]) &&
      typeof value.truncated === "boolean" &&
      denseAgentRows(value.entries) &&
      value.entries.every(
        (row) =>
          closed(row, ["sourceName", "path"]) &&
          validAgentSourceName(row.sourceName) &&
          row.path === agentTarget(identity.path, row.sourceName),
      ) &&
      new Set(value.entries.map((row) => row.sourceName)).size ===
        value.entries.length
    );
  return (
    closed(value, [
      "workspaceId",
      "workspacePath",
      "path",
      "status",
      "reason",
    ]) &&
    ((value.status === "missing" && value.reason === "path_missing") ||
      (value.status === "unavailable" &&
        ["path_missing", "path_denied", "file_changed"].includes(value.reason)))
  );
}
function validAgentRead(
  value: WorkbenchAgentFile,
  identity: AgentIdentity,
): boolean {
  const common = [
    "workspaceId",
    "workspacePath",
    "sourceName",
    "path",
    "status",
  ];
  if (
    !closed(value, common, [
      "content",
      "version",
      "directoryVersion",
      "reason",
    ]) ||
    value.workspaceId !== identity.workspaceId ||
    value.workspacePath !== identity.path ||
    value.sourceName !== identity.sourceName ||
    value.path !== agentTarget(identity.path, identity.sourceName)
  )
    return false;
  if (value.status === "available")
    return (
      closed(value, [...common, "content", "version", "directoryVersion"]) &&
      agentFileContentFits(value.content) &&
      hex64(value.version) &&
      hex64(value.directoryVersion)
    );
  if (value.status === "missing")
    return (
      closed(value, [...common, "reason", "directoryVersion"]) &&
      value.reason === "missing_file" &&
      hex64(value.directoryVersion)
    );
  return (
    closed(value, [...common, "reason"]) &&
    ((value.status === "unsupported" &&
      value.reason === "unsupported_content") ||
      (value.status === "unavailable" &&
        ["path_missing", "path_denied", "file_changed", "too_large"].includes(
          value.reason,
        )))
  );
}
function agentSaveState(
  state: State,
  intent: Intent,
  status: NonNullable<AgentDraft["save"]>["status"],
  result?: Extract<
    NonNullable<RedactedReceipt["result"]>,
    { kind: "agent_file_saved" }
  >,
  code?: string,
): State {
  const identity = intent.agentSave;
  if (
    !identity ||
    !currentAgentScope({ ...state, revision: identity.floor }, identity)
  )
    return state;
  const key = agentDraftKey(
      identity.workspaceId,
      identity.path,
      identity.sourceName,
    ),
    draft = state.agentDrafts[key];
  if (!draft || draft.save?.identity !== identity) return state;
  const next = {
    ...draft,
    save: {
      identity,
      status,
      current:
        draft.revision === identity.draft?.revision &&
        draft.text === identity.request.text,
      ...(result
        ? {
            version: result.version,
            ...(result.backupId ? { backupId: result.backupId } : {}),
          }
        : {}),
      ...(code ? { code } : {}),
    },
  };
  // Receipts prove an operation, never a fresh file observation or executable content.
  if (status !== "pending") delete next.observation;
  return { ...state, agentDrafts: { ...state.agentDrafts, [key]: next } };
}
export type Event =
  | { type: "workspace.file.select"; path: string }
  | { type: "workspace.file.selectDraft"; key: string }
  | {
      type: "workspace.file.io";
      identity: WorkspaceFileSaveIdentity;
      active: boolean;
    }
  | { type: "workspace.file.read"; identity: WorkspaceFileIdentity }
  | { type: "workspace.file.cancel"; identity: WorkspaceFileIdentity }
  | {
      type: "workspace.file.loaded";
      identity: WorkspaceFileIdentity;
      value?: WorkbenchFileObservation;
      error?: string;
    }
  | {
      type: "workspace.file.draft";
      action: "edit" | "validate" | "discard";
      text?: string;
    }
  | { type: "extensions.read"; identity: ExtensionIdentity }
  | {
      type: "extensions.observed";
      identity: ExtensionIdentity;
      value?: WorkbenchExtensionsObservation;
      error?: ExtensionError;
    }
  | { type: "agent.runtime.read"; identity: AgentRuntimeIdentity }
  | {
      type: "agent.runtime.observed";
      identity: AgentRuntimeIdentity;
      value?: WorkbenchAgentRuntimeObservation;
      error?: string;
      digest?: string;
    }
  | { type: "agent.select"; sourceName: string }
  | { type: "agent.list" | "agent.read"; identity: AgentIdentity }
  | {
      type: "agent.listed";
      identity: AgentIdentity;
      value?: WorkbenchAgentFiles;
      error?: string;
    }
  | {
      type: "agent.loaded";
      identity: AgentIdentity;
      value?: WorkbenchAgentFile;
      error?: string;
    }
  | {
      type: "agent.draft";
      action: "edit" | "validate" | "discard";
      text?: string;
    }
  | { type: "skill.runtime.read"; identity: SkillRuntimeIdentity }
  | {
      type: "skill.runtime.observed";
      identity: SkillRuntimeIdentity;
      value?: WorkbenchSkillRuntimeObservation;
      error?: string;
      digest?: string;
    }
  | { type: "skill.select"; sourceName: string }
  | { type: "skill.list" | "skill.read"; identity: SkillIdentity }
  | {
      type: "skill.listed";
      identity: SkillIdentity;
      value?: WorkbenchSkillFiles;
      error?: string;
    }
  | {
      type: "skill.loaded";
      identity: SkillIdentity;
      value?: WorkbenchSkillFile;
      error?: string;
    }
  | {
      type: "skill.draft";
      action: "edit" | "validate" | "discard";
      text?: string;
    }
  | { type: "mcp.read"; identity: McpIdentity }
  | {
      type: "mcp.observed";
      identity: McpIdentity;
      value?: WorkbenchMcpObservation;
      error?: string;
    }
  | { type: "instructions.read"; identity: InstructionIdentity }
  | {
      type: "instructions.observed";
      identity: InstructionIdentity;
      value?: WorkbenchInstructionObservation;
      error?: string;
    }
  | { type: "configuration.io"; lane: "reads" | "saves"; delta: 1 | -1 }
  | { type: "configuration.load"; identity: ConfigurationLoadIdentity }
  | { type: "configuration.cancel"; identity: ConfigurationLoadIdentity }
  | {
      type: "configuration.loaded";
      identity: ConfigurationLoadIdentity;
      value?: WorkbenchConfigurationFile;
      error?: string;
    }
  | { type: "select"; workspaceId?: string; sessionId?: string }
  | { type: "snapshot"; scope: Scope; value: WorkbenchSnapshot }
  | { type: "health"; scope: Scope; code: string }
  | { type: "catalog.check" }
  | { type: "catalog"; scope: Scope; value?: WorkbenchCatalog; error?: string }
  | {
      type: "configuration.draft";
      workspaceId: string;
      path: string;
      kind: ConfigurationDraftKind;
      action: "validate" | "baseline" | "discard";
    }
  | {
      type: "configuration.draft";
      workspaceId: string;
      path: string;
      kind: ConfigurationDraftKind;
      action: "edit";
      text: string;
    }
  | {
      type: "draft";
      key: string;
      text?: string;
      agent?: string;
      model?: string;
    }
  | { type: "intent"; intent: Intent }
  | { type: "unknown"; id: string }
  | {
      type: "receipt";
      id: string;
      receipt: RedactedReceipt;
      fileBackupProof?: string;
    }
  | { type: "refused"; id: string; code: string }
  | { type: "layout"; value: Partial<State["layout"]> }
  | { type: "files.open"; path?: string; kind?: "file" | "directory" }
  | { type: "files.close" }
  | { type: "files.check" }
  | { type: "files.pause" }
  | { type: "files.list"; identity: FileIdentity; value: WorkbenchFileList }
  | { type: "files.read"; identity: FileIdentity; value: WorkbenchFileRead }
  | { type: "files.error"; identity: FileIdentity; code: string }
  | { type: "files.done"; identity: FileIdentity }
  | { type: "diagnostics.open"; filtered: boolean }
  | { type: "diagnostics.close" }
  | {
      type: "diagnostics";
      identity: DiagnosticsIdentity;
      value?: WorkbenchDiagnostics;
      error?: string;
    };
function retireConfigurationBindings(
  drafts: State["configurationDrafts"],
  // eslint-disable-next-line no-unused-vars -- Type parameter name documents the callback.
  retire: (draft: ConfigurationDraft) => boolean,
) {
  let next = drafts;
  for (const [key, draft] of Object.entries(drafts)) {
    if (!retire(draft)) continue;
    if (next === drafts) next = { ...drafts };
    const invalidated = { ...draft };
    delete invalidated.fileSave;
    delete invalidated.fileObservation;
    next[key] = invalidated;
  }
  return next;
}
function select(state: State, workspaceId?: string, sessionId?: string): State {
  return {
    ...state,
    mcp: {},
    instructions: {},
    skillRuntime: {},
    skillFiles: { generation: state.skillFiles.generation + 1 },
    agentRuntime: {},
    agentFiles:
      state.selection.workspaceId === workspaceId
        ? {
            ...state.agentFiles,
            generation: state.agentFiles.generation + 1,
            request: undefined,
          }
        : { generation: state.agentFiles.generation + 1 },
    selection: {
      generation: state.selection.generation + 1,
      ...(workspaceId ? { workspaceId } : {}),
      ...(sessionId ? { sessionId } : {}),
    },
    configurationDrafts:
      state.selection.workspaceId !== workspaceId
        ? retireConfigurationBindings(state.configurationDrafts, (draft) =>
            Boolean(draft.fileSave),
          )
        : state.configurationDrafts,
    snapshot: null,
    catalog: null,
    catalogError: "",
    configurationNotice: "",
    diagnostics: null,
    error: "",
    notice: "",
    interruptNotice: null,
    files: { ...initialFiles(), generation: state.files.generation + 1 },
    connection: "loading",
  };
}
function fileOpen(
  state: State,
  path = "",
  kind: "file" | "directory" = "directory",
): State {
  const workspace = state.lists.workspaces.find(
    (w) => w.id === state.selection.workspaceId,
  );
  if (!state.epoch || !workspace) return state;
  const generation = state.files.generation + 1;
  const sameWorkspace = state.files.identity?.workspaceId === workspace.id;
  return {
    ...state,
    files: {
      visible: true,
      generation,
      identity: {
        epoch: state.epoch,
        workspaceId: workspace.id,
        trustRevision: workspace.trustRevision,
        path,
        kind,
        generation,
      },
      directory:
        kind === "directory"
          ? path
          : sameWorkspace
            ? state.files.directory
            : path.split("/").slice(0, -1).join("/"),
      listing: sameWorkspace && kind === "file" ? state.files.listing : null,
      preview: null,
      busy: false,
      status: "checking",
      error: "",
    },
  };
}
function reduceWorkbench(state: State, event: Event): State {
  switch (event.type) {
    case "workspace.file.io": {
      const i = event.identity,
        key = operationKey(i.epoch, i.operationId);
      if (event.active && state.operations[key]?.workspaceFileSave !== i)
        return state;
      const io = { ...state.workspaceFileIO };
      if (event.active) io[key] = i.workspaceId;
      else delete io[key];
      return { ...state, workspaceFileIO: io };
    }
    case "workspace.file.select": {
      if (
        !validWorkspaceFilePath(event.path) ||
        (event.path === state.workspaceFile.path &&
          !state.workspaceFile.draftKey)
      )
        return state;
      return {
        ...state,
        workspaceFile: {
          path: event.path,
          generation: state.workspaceFile.generation + 1,
        },
      };
    }
    case "workspace.file.selectDraft": {
      if (!state.workspaceFileDrafts[event.key]) return state;
      const [, workspaceId, , path] = JSON.parse(event.key) as string[];
      if (workspaceId !== state.selection.workspaceId || !path) return state;
      return {
        ...state,
        workspaceFile: {
          path,
          draftKey: event.key,
          generation: state.workspaceFile.generation + 1,
        },
      };
    }
    case "workspace.file.read": {
      const i = event.identity;
      if (
        !canReadWorkspaceFile(state) ||
        !currentWorkspaceFileScope(state, i) ||
        i.draft !== selectedWorkspaceFileDraft(state)
      )
        return state;
      const key = workspaceFileDraftKey(
        i.epoch,
        i.workspaceId,
        i.workspacePath,
        i.path,
      );
      if (
        !state.workspaceFileDrafts[key] &&
        Object.keys(state.workspaceFileDrafts).length >= 64
      )
        return state;
      return {
        ...state,
        workspaceFileDrafts: {
          ...state.workspaceFileDrafts,
          [key]: {
            ...i.draft,
            request: i,
            observation: undefined,
            error: undefined,
          },
        },
      };
    }
    case "workspace.file.cancel":
    case "workspace.file.loaded": {
      const i = event.identity,
        key = workspaceFileDraftKey(
          i.epoch,
          i.workspaceId,
          i.workspacePath,
          i.path,
        ),
        d = state.workspaceFileDrafts[key];
      if (d?.request !== i) return state;
      const next: WorkspaceFileDraft = {
        ...d,
        request: undefined,
        observation: undefined,
      };
      if (event.type === "workspace.file.cancel") next.error = "CANCELLED";
      else {
        let value: WorkbenchFileObservation | undefined;
        try {
          if (event.value)
            value = validateWorkspaceFileObservation(event.value);
        } catch {
          /* Invalid DTO has no authority. */
        }
        if (
          !currentWorkspaceFileScope(state, i) ||
          !workspaceFileAuthority(state) ||
          !value ||
          value.runtimeEpoch !== i.epoch ||
          value.workspaceId !== i.workspaceId ||
          value.workspacePath !== i.workspacePath ||
          value.path !== i.path ||
          value.revision !== i.floor ||
          d.revision !== i.draft.revision ||
          d.text !== i.draft.text
        )
          next.error = event.error ?? "INVALID_RESPONSE";
        else {
          next.read = Object.freeze({ ...value });
          delete next.error;
          if (value.status === "available") {
            // Explicit reread refreshes the comparison, but never destroys an unsaved draft.
            next.text =
              (d.baseline === undefined && d.revision === 0) ||
              d.text === d.baseline
                ? value.content
                : d.text;
            next.baseline = value.content;
            next.revision++;
            delete next.validation;
            next.observation = i;
            delete next.save;
          }
        }
      }
      return {
        ...state,
        workspaceFileDrafts: { ...state.workspaceFileDrafts, [key]: next },
      };
    }
    case "workspace.file.draft": {
      const w = workspaceFileWorkspace(state),
        path = state.workspaceFile.path;
      if (!state.epoch || !w || !path) return state;
      const key = selectedWorkspaceFileKey(state)!,
        d = selectedWorkspaceFileDraft(state);
      if (
        !state.workspaceFileDrafts[key] &&
        Object.keys(state.workspaceFileDrafts).length >= 64
      )
        return state;
      if (event.action === "discard") {
        if (d.save?.status === "pending" || d.save?.status === "unknown")
          return state;
        const drafts = { ...state.workspaceFileDrafts };
        delete drafts[key];
        return {
          ...state,
          workspaceFileDrafts: drafts,
          workspaceFile: {
            path,
            generation: state.workspaceFile.generation + 1,
          },
        };
      }
      const next = { ...d };
      if (event.action === "edit") {
        // Retain invalid text for correction; validation and authority stay separate.
        if (
          typeof event.text !== "string" ||
          event.text.length > 262144 ||
          event.text === d.text
        )
          return state;
        next.text = event.text;
        next.revision++;
        delete next.validation;
        delete next.request;
        if (next.save) next.save = { ...next.save, current: false };
      } else
        next.validation = {
          ...validateWorkspaceFileText(d.text),
          revision: d.revision,
        };
      return {
        ...state,
        workspaceFileDrafts: { ...state.workspaceFileDrafts, [key]: next },
      };
    }

    case "extensions.read": {
      if (
        !canObserveExtensions(state) ||
        !currentExtensionScope(state, event.identity)
      )
        return state;
      const key = event.identity.workspaceId;
      return {
        ...state,
        extensions: {
          // Keep at most the registered workspace inventory (bounded to 100).
          ...Object.fromEntries(
            Object.entries(state.extensions).filter(([id]) =>
              state.lists.workspaces.some((workspace) => workspace.id === id),
            ),
          ),
          [key]: {
            ...state.extensions[key],
            request: event.identity,
            error: undefined,
          },
        },
      };
    }
    case "extensions.observed": {
      const { identity } = event;
      const entry = state.extensions[identity.workspaceId];
      if (entry?.request !== identity) return state;
      let value: WorkbenchExtensionsObservation | undefined;
      try {
        // The shared exact-closed validator owns raw validation, before any field use.
        if (event.value) value = validateExtensionsObservation(event.value);
        if (
          !value ||
          !extensionTargetReady(state) ||
          !currentExtensionScope(state, identity) ||
          value.workspaceId !== identity.workspaceId ||
          value.workspacePath !== identity.path ||
          value.runtimeEpoch !== identity.epoch ||
          value.revision !== identity.floor
        )
          value = undefined;
        if (value) value = structuredClone(value);
      } catch {
        value = undefined;
      }
      return {
        ...state,
        extensions: {
          ...state.extensions,
          [identity.workspaceId]: value
            ? { observationIdentity: identity, observation: value }
            : {
                ...entry,
                request: undefined,
                error: event.error ?? "EXTENSIONS_UNVERIFIED",
              },
        },
      };
    }
    case "agent.runtime.read": {
      if (
        !canObserveAgentRuntime(state) ||
        !currentAgentRuntimeScope(state, event.identity)
      )
        return state;
      return { ...state, agentRuntime: { request: event.identity } };
    }
    case "agent.runtime.observed": {
      const { identity, value } = event;
      if (state.agentRuntime.request !== identity) return state;
      const valid =
        currentAgentRuntimeScope(state, identity) &&
        mcpTargetReady(state) &&
        !resourceMutationDisabled(state, identity.workspaceId) &&
        value &&
        validAgentRuntimeObservation(value) &&
        value.workspaceId === identity.workspaceId &&
        value.workspacePath === identity.path &&
        value.runtimeEpoch === identity.epoch &&
        (value.status !== "observed" ||
          value.file?.sourceName === identity.sourceName);
      return {
        ...state,
        agentRuntime: valid
          ? {
              observationIdentity: Object.freeze({
                ...identity,
                ...(event.digest ? { digest: event.digest } : {}),
              }),
              observation: structuredClone(value),
            }
          : { error: event.error ?? "AGENT_UNVERIFIED" },
      };
    }
    case "agent.select": {
      const sourceName = event.sourceName;
      if (
        !validAgentSourceName(sourceName) ||
        state.agentFiles.sourceName === sourceName ||
        state.agentFiles.listing?.status !== "available" ||
        !state.agentFiles.listing.entries.some(
          (row) => row.sourceName === sourceName,
        ) ||
        !state.agentFiles.listingIdentity ||
        agentWorkspace(state)?.id !==
          state.agentFiles.listingIdentity.workspaceId ||
        agentWorkspace(state)?.path !== state.agentFiles.listingIdentity.path
      )
        return state;
      return {
        ...state,
        agentFiles: {
          ...state.agentFiles,
          sourceName,
          request: undefined,
          generation: state.agentFiles.generation + 1,
        },
      };
    }
    case "agent.list":
    case "agent.read": {
      const identity = event.identity;
      if (!canReadAgentFiles(state) || !currentAgentScope(state, identity))
        return state;
      if (event.type === "agent.list")
        return {
          ...state,
          agentFiles: {
            ...state.agentFiles,
            request: identity,
            error: undefined,
          },
        };
      if (!identity.sourceName || !validAgentSourceName(identity.sourceName))
        return state;
      const key = agentDraftKey(
        identity.workspaceId,
        identity.path,
        identity.sourceName,
      );
      if (
        identity.draft !== selectedAgentDraft(state) ||
        (!state.agentDrafts[key] &&
          Object.keys(state.agentDrafts).length >=
            CONFIGURATION_DRAFT_LIMITS.entries)
      )
        return state;
      return {
        ...state,
        agentDrafts: {
          ...state.agentDrafts,
          [key]: {
            ...identity.draft!,
            request: identity,
            observation: undefined,
            error: undefined,
          },
        },
      };
    }
    case "agent.listed": {
      const { identity, value } = event;
      if (state.agentFiles.request !== identity) return state;
      const current = currentAgentScope(state, identity);
      return {
        ...state,
        agentFiles: {
          ...state.agentFiles,
          request: undefined,
          ...(current && value && validAgentList(value, identity)
            ? {
                listing: agentListingSnapshot(value),
                listingIdentity: identity,
                error: undefined,
              }
            : {
                listing: undefined,
                listingIdentity: undefined,
                error: event.error ?? "INVALID_RESPONSE",
              }),
        },
      };
    }
    case "agent.loaded": {
      const { identity, value } = event;
      if (!identity.sourceName) return state;
      const key = agentDraftKey(
          identity.workspaceId,
          identity.path,
          identity.sourceName,
        ),
        draft = state.agentDrafts[key];
      if (draft?.request !== identity) return state;
      const next = { ...draft };
      delete next.request;
      if (
        !currentAgentScope(state, identity) ||
        value === undefined ||
        !validAgentRead(value, identity)
      ) {
        delete next.observation;
        next.error = event.error ?? "INVALID_RESPONSE";
      } else {
        next.read = Object.freeze({ ...value });
        delete next.save;
        delete next.error;
        if (value.status === "available" || value.status === "missing") {
          next.observation = identity;
          next.baseline = value.status === "available" ? value.content : "";
          next.text = value.status === "available" ? value.content : draft.text;
          next.revision++;
          delete next.validation;
        } else delete next.observation;
      }
      return { ...state, agentDrafts: { ...state.agentDrafts, [key]: next } };
    }
    case "agent.draft": {
      const workspace = agentWorkspace(state),
        sourceName = state.agentFiles.sourceName;
      if (!workspace || !sourceName) return state;
      const key = agentDraftKey(workspace.id, workspace.path, sourceName),
        draft = selectedAgentDraft(state);
      if (event.action === "discard") {
        const drafts = { ...state.agentDrafts };
        delete drafts[key];
        return {
          ...state,
          agentDrafts: drafts,
          agentFiles: {
            ...state.agentFiles,
            generation: state.agentFiles.generation + 1,
          },
        };
      }
      if (
        !state.agentDrafts[key] &&
        Object.keys(state.agentDrafts).length >=
          CONFIGURATION_DRAFT_LIMITS.entries
      )
        return state;
      const next = { ...draft };
      if (event.action === "edit") {
        if (!agentFileContentFits(event.text) || event.text === draft.text)
          return state;
        next.text = event.text;
        next.revision++;
        delete next.validation;
        delete next.request;
        if (next.save) next.save = { ...next.save, current: false };
      } else
        next.validation = {
          ...validateAgentFile(next.text),
          revision: next.revision,
        };
      return { ...state, agentDrafts: { ...state.agentDrafts, [key]: next } };
    }

    case "skill.runtime.read": {
      if (
        !canObserveSkillRuntime(state) ||
        !currentSkillRuntimeScope(state, event.identity)
      )
        return state;
      return { ...state, skillRuntime: { request: event.identity } };
    }
    case "skill.runtime.observed": {
      const { identity, value } = event;
      if (state.skillRuntime.request !== identity) return state;
      const valid =
        currentSkillRuntimeScope(state, identity) &&
        mcpTargetReady(state) &&
        !resourceMutationDisabled(state, identity.workspaceId) &&
        value &&
        validSkillRuntimeObservation(value) &&
        value.workspaceId === identity.workspaceId &&
        value.workspacePath === identity.path &&
        value.runtimeEpoch === identity.epoch &&
        (value.status !== "observed" ||
          (value.file?.sourceName === identity.sourceName &&
            value.session?.sessionId === identity.sessionId));
      return {
        ...state,
        skillRuntime: valid
          ? {
              observationIdentity: Object.freeze({
                ...identity,
                ...(event.digest ? { digest: event.digest } : {}),
              }),
              observation: structuredClone(value),
            }
          : { error: event.error ?? "SKILL_UNVERIFIED" },
      };
    }
    case "skill.select": {
      const sourceName = event.sourceName;
      if (
        !validSkillSourceName(sourceName) ||
        state.skillFiles.sourceName === sourceName ||
        state.skillFiles.listing?.status !== "available" ||
        !state.skillFiles.listing.entries.some(
          (row) => row.sourceName === sourceName,
        ) ||
        !state.skillFiles.listingIdentity ||
        !currentSkillScope(state, {
          ...state.skillFiles.listingIdentity,
          generation: state.skillFiles.generation,
        })
      )
        return state;
      return {
        ...state,
        skillFiles: {
          ...state.skillFiles,
          sourceName,
          request: undefined,
          generation: state.skillFiles.generation + 1,
        },
      };
    }
    case "skill.list":
    case "skill.read": {
      const identity = event.identity;
      if (!canReadSkillFiles(state) || !currentSkillScope(state, identity))
        return state;
      if (event.type === "skill.list")
        return {
          ...state,
          skillFiles: {
            ...state.skillFiles,
            request: identity,
            error: undefined,
          },
        };
      if (!identity.sourceName || !validSkillSourceName(identity.sourceName))
        return state;
      const key = skillDraftKey(
        identity.workspaceId,
        identity.path,
        identity.sourceName,
      );
      if (
        identity.draft !== selectedSkillDraft(state) ||
        (!state.skillDrafts[key] &&
          Object.keys(state.skillDrafts).length >=
            CONFIGURATION_DRAFT_LIMITS.entries)
      )
        return state;
      return {
        ...state,
        skillDrafts: {
          ...state.skillDrafts,
          [key]: {
            ...identity.draft!,
            request: identity,
            observation: undefined,
            error: undefined,
          },
        },
      };
    }
    case "skill.listed": {
      const { identity, value } = event;
      if (state.skillFiles.request !== identity) return state;
      const current = currentSkillScope(state, identity);
      return {
        ...state,
        skillFiles: {
          ...state.skillFiles,
          request: undefined,
          ...(current && value && validSkillList(value, identity)
            ? {
                listing: skillListingSnapshot(value),
                listingIdentity: identity,
                error: undefined,
              }
            : {
                listing: undefined,
                listingIdentity: undefined,
                error: event.error ?? "INVALID_RESPONSE",
              }),
        },
      };
    }
    case "skill.loaded": {
      const { identity, value } = event;
      if (!identity.sourceName) return state;
      const key = skillDraftKey(
          identity.workspaceId,
          identity.path,
          identity.sourceName,
        ),
        draft = state.skillDrafts[key];
      if (draft?.request !== identity) return state;
      const next = { ...draft };
      delete next.request;
      if (
        !currentSkillScope(state, identity) ||
        value === undefined ||
        !validSkillRead(value, identity)
      ) {
        delete next.observation;
        next.error = event.error ?? "INVALID_RESPONSE";
      } else {
        next.read = Object.freeze({ ...value });
        delete next.save;
        delete next.error;
        if (value.status === "available" || value.status === "missing") {
          next.observation = identity;
          next.baseline = value.status === "available" ? value.content : "";
          next.text = value.status === "available" ? value.content : draft.text;
          next.revision++;
          delete next.validation;
        } else delete next.observation;
      }
      return { ...state, skillDrafts: { ...state.skillDrafts, [key]: next } };
    }
    case "skill.draft": {
      const workspace = skillWorkspace(state),
        sourceName = state.skillFiles.sourceName;
      if (!workspace || !sourceName) return state;
      const key = skillDraftKey(workspace.id, workspace.path, sourceName),
        draft = selectedSkillDraft(state);
      if (event.action === "discard") {
        const drafts = { ...state.skillDrafts };
        delete drafts[key];
        return {
          ...state,
          skillDrafts: drafts,
          skillFiles: {
            ...state.skillFiles,
            generation: state.skillFiles.generation + 1,
          },
        };
      }
      if (
        !state.skillDrafts[key] &&
        Object.keys(state.skillDrafts).length >=
          CONFIGURATION_DRAFT_LIMITS.entries
      )
        return state;
      const next = { ...draft };
      if (event.action === "edit") {
        if (!skillFileContentFits(event.text) || event.text === draft.text)
          return state;
        next.text = event.text;
        next.revision++;
        delete next.validation;
        delete next.request;
        if (next.save) next.save = { ...next.save, current: false };
      } else
        next.validation = {
          ...validateSkillFile(next.text),
          revision: next.revision,
        };
      return { ...state, skillDrafts: { ...state.skillDrafts, [key]: next } };
    }
    case "mcp.read": {
      const identity = event.identity;
      if (
        !canObserveMcp(state) ||
        !currentMcpScope(state, identity) ||
        identity.floor !== state.revision
      )
        return state;
      return {
        ...state,
        mcp: { ...state.mcp, [identity.workspaceId]: { request: identity } },
      };
    }
    case "mcp.observed": {
      const identity = event.identity;
      if (
        state.mcp[identity.workspaceId]?.request !== identity ||
        !currentMcpScope(state, identity)
      )
        return state;
      const value = event.value;
      const valid =
        identity.floor === state.revision &&
        mcpTargetReady(state) &&
        !resourceMutationDisabled(state, identity.workspaceId) &&
        value &&
        validMcpObservation(value) &&
        value.workspaceId === identity.workspaceId;
      const observation = valid && value ? structuredClone(value) : undefined;
      if (observation?.status === "observed") {
        observation.servers.forEach(Object.freeze);
        Object.freeze(observation.servers);
      }
      return {
        ...state,
        mcp: {
          ...state.mcp,
          [identity.workspaceId]: observation
            ? {
                observationIdentity: identity,
                observation: Object.freeze(observation),
              }
            : { error: event.error ?? "MCP_UNVERIFIED" },
        },
      };
    }
    case "instructions.read": {
      const identity = event.identity;
      if (
        !canObserveInstructions(state) ||
        !currentInstructionScope(state, identity) ||
        identity.floor !== state.revision
      )
        return state;
      const key = selectionKey(identity.workspaceId, identity.sessionId);
      return {
        ...state,
        instructions: { ...state.instructions, [key]: { request: identity } },
      };
    }
    case "instructions.observed": {
      const identity = event.identity;
      const key = selectionKey(identity.workspaceId, identity.sessionId);
      if (
        state.instructions[key]?.request !== identity ||
        !currentInstructionScope(state, identity)
      )
        return state;
      const value = event.value;
      const valid =
        identity.floor === state.revision &&
        instructionTargetReady(state) &&
        !resourceMutationDisabled(state, identity.workspaceId) &&
        value &&
        validInstructionObservation(value) &&
        value.workspaceId === identity.workspaceId &&
        value.sessionId === identity.sessionId;
      return {
        ...state,
        instructions: {
          ...state.instructions,
          [key]: valid
            ? {
                observationIdentity: identity,
                observation: Object.freeze({ ...value }),
              }
            : { error: event.error ?? "INSTRUCTIONS_UNVERIFIED" },
        },
      };
    }
    case "configuration.io":
      return {
        ...state,
        configurationIO: {
          ...state.configurationIO,
          [event.lane]: Math.max(
            0,
            state.configurationIO[event.lane] + event.delta,
          ),
        },
      };
    case "select":
      return select(state, event.workspaceId, event.sessionId);
    case "snapshot": {
      const next = event.value;
      if (!validProjection(next)) return state;
      if (
        !sameScope(state, event.scope) ||
        state.retiredEpochs.includes(next.runtimeEpoch)
      )
        return state;
      const changed = next.runtimeEpoch !== state.epoch;
      if (
        !(
          changed &&
          (event.scope.bootstrap || event.scope.epoch === undefined)
        ) &&
        ((event.scope.workspaceId &&
          next.selectedWorkspaceId !== event.scope.workspaceId) ||
          (event.scope.sessionId &&
            next.selectedSessionId !== event.scope.sessionId))
      )
        return state;
      if (
        !changed &&
        (next.revision < state.revision ||
          next.observationSequence <= state.observationSequence)
      )
        return state;
      // Only a bootstrap read may establish a different host identity.
      if (changed && event.scope.epoch !== undefined && !event.scope.bootstrap)
        return state;
      const operations = retainedProjection(state, next);
      if (!operations) return state;
      const selectionChanged =
        changed ||
        (!state.selection.workspaceId && next.selectedWorkspaceId) ||
        (!state.selection.sessionId && next.selectedSessionId);
      const selection = selectionChanged
        ? {
            generation: state.selection.generation + 1,
            ...(next.selectedWorkspaceId
              ? { workspaceId: next.selectedWorkspaceId }
              : {}),
            ...(next.selectedSessionId
              ? { sessionId: next.selectedSessionId }
              : {}),
          }
        : state.selection;
      const workspace = next.workspaces.find(
        (w) => w.id === selection.workspaceId,
      );
      const trustChanged =
        workspace?.trustRevision !==
        state.lists.workspaces.find((w) => w.id === state.selection.workspaceId)
          ?.trustRevision;
      const invalidate =
        changed ||
        selectionChanged ||
        (state.files.identity &&
          workspace?.trustRevision !== state.files.identity.trustRevision);
      const retireNotice =
        state.interruptNotice &&
        sameScope(state, state.interruptNotice.scope) &&
        event.scope.revision === state.revision &&
        observedIdle(
          next,
          state.interruptNotice.scope,
          Math.max(state.revision, state.interruptNotice.revision),
          state.interruptNotice.scope.observationSequence ?? 0,
        );
      const acceptedState: State = {
        ...state,
        epoch: next.runtimeEpoch,
        retiredEpochs:
          changed && state.epoch
            ? [...state.retiredEpochs, state.epoch]
            : state.retiredEpochs,
        revision: next.revision,
        observationSequence: next.observationSequence,
        recovery: next.recovery,
        operations,
        mcp:
          changed ||
          selectionChanged ||
          trustChanged ||
          workspace?.path !==
            state.lists.workspaces.find(
              (w) => w.id === state.selection.workspaceId,
            )?.path
            ? {}
            : state.mcp,
        instructions:
          changed ||
          selectionChanged ||
          trustChanged ||
          workspace?.path !==
            state.lists.workspaces.find(
              (w) => w.id === state.selection.workspaceId,
            )?.path
            ? {}
            : state.instructions,
        skillRuntime:
          changed ||
          selectionChanged ||
          trustChanged ||
          workspace?.path !== skillWorkspace(state)?.path
            ? {}
            : state.skillRuntime.action &&
                ["pending", "unknown"].includes(
                  state.skillRuntime.action.status,
                ) &&
                next.revision !== state.skillRuntime.action.identity.floor
              ? {
                  ...state.skillRuntime,
                  action: { ...state.skillRuntime.action, current: false },
                }
              : state.skillRuntime,
        skillFiles:
          changed ||
          selectionChanged ||
          trustChanged ||
          workspace?.path !== skillWorkspace(state)?.path
            ? { generation: state.skillFiles.generation + 1 }
            : state.skillFiles,
        agentRuntime:
          changed ||
          selectionChanged ||
          trustChanged ||
          workspace?.path !== agentWorkspace(state)?.path
            ? {}
            : state.agentRuntime.action &&
                ["pending", "unknown"].includes(
                  state.agentRuntime.action.status,
                ) &&
                next.revision !== state.agentRuntime.action.identity.floor
              ? {
                  ...state.agentRuntime,
                  action: { ...state.agentRuntime.action, current: false },
                }
              : state.agentRuntime,
        agentFiles:
          workspace?.id !== agentWorkspace(state)?.id ||
          workspace?.path !== agentWorkspace(state)?.path
            ? { generation: state.agentFiles.generation + 1 }
            : changed || selectionChanged || trustChanged
              ? {
                  ...state.agentFiles,
                  generation: state.agentFiles.generation + 1,
                  request: undefined,
                }
              : state.agentFiles,
        selection,
        snapshot: next,
        // Snapshot observation retires display only, never operation evidence.
        ...(retireNotice || (state.interruptNotice && selectionChanged)
          ? { notice: "", interruptNotice: null }
          : {}),
        configurationDrafts: retireConfigurationBindings(
          state.configurationDrafts,
          (draft) => {
            if (
              draft.fileSave &&
              selection.workspaceId !== state.selection.workspaceId
            )
              return true;
            const bound = draft.fileObservation ?? draft.fileSave?.identity;
            return Boolean(
              bound &&
                (bound.epoch !== next.runtimeEpoch ||
                  !next.workspaces.some(
                    (w) => w.id === bound.workspaceId && w.path === bound.path,
                  )),
            );
          },
        ),
        lists: { workspaces: next.workspaces, sessions: next.sessions },
        connection: next.state,
        error: "",
        catalog:
          changed || selectionChanged || trustChanged ? null : state.catalog,
        files:
          next.state !== "connected"
            ? {
                ...state.files,
                busy: false,
                status:
                  state.files.preview || state.files.listing
                    ? "stale"
                    : state.files.status,
              }
            : invalidate
              ? { ...initialFiles(), generation: state.files.generation + 1 }
              : state.files,
      };
      if (state.files.visible && invalidate && workspace)
        return fileOpen(
          acceptedState,
          changed || selectionChanged ? "" : (state.files.identity?.path ?? ""),
          changed || selectionChanged
            ? "directory"
            : (state.files.identity?.kind ?? "directory"),
        );
      return acceptedState;
    }
    case "health":
      return sameScope(state, event.scope) &&
        event.scope.revision === state.revision &&
        event.scope.observationSequence === state.observationSequence
        ? {
            ...state,
            connection: "disconnected",
            error: event.code,
            files: {
              ...state.files,
              busy: false,
              status: state.files.preview ? "stale" : state.files.status,
            },
          }
        : state;
    case "catalog.check":
      return { ...state, catalogGeneration: state.catalogGeneration + 1 };
    case "catalog":
      return sameScope(state, event.scope) &&
        event.scope.catalogGeneration === state.catalogGeneration &&
        event.scope.trustRevision ===
          state.lists.workspaces.find(
            (w) => w.id === state.selection.workspaceId,
          )?.trustRevision
        ? {
            ...state,
            catalog: event.value ?? null,
            catalogError: event.error ?? "",
          }
        : state;
    case "configuration.load":
    case "configuration.cancel":
    case "configuration.loaded": {
      const identity = event.identity;
      const key = configurationDraftKey(
        identity.workspaceId,
        identity.path,
        identity.kind,
      );
      if (event.type === "configuration.cancel") {
        const current = state.configurationDrafts[key];
        if (current?.fileRequest !== identity) return state;
        const next = { ...current };
        delete next.fileRequest;
        if (next.fileRead)
          next.fileRead = {
            ...next.fileRead,
            status: "error",
            reason: "CANCELLED",
          };
        return {
          ...state,
          configurationDrafts: { ...state.configurationDrafts, [key]: next },
        };
      }
      const workspace = state.lists.workspaces.find(
        (w) => w.id === state.selection.workspaceId,
      );
      if (
        !workspace ||
        workspace.id !== identity.workspaceId ||
        workspace.path !== identity.path ||
        state.epoch !== identity.epoch ||
        !["instructions", "mcp"].includes(identity.kind)
      )
        return state;
      const current = state.configurationDrafts[key];
      const draft = current ?? emptyConfigurationDraft;
      if (draft.revision !== identity.revision) return state;
      const target = configurationTargetPath(workspace.path, identity.kind);
      if (event.type === "configuration.load") {
        if (
          state.configurationIO.saves > 0 ||
          Boolean(state.agentRuntime.request) ||
          Boolean(state.agentFiles.request) ||
          Object.values(state.agentDrafts).some((d) => d.request) ||
          Object.values(state.operations).some(
            (i) =>
              (i.operation.type.startsWith("configuration.mcp.") ||
                i.operation.type === "configuration.save" ||
                i.operation.type === "configuration.instructions.apply" ||
                i.operation.type === "configuration.instructions.remove") &&
              (i.status === "pending" ||
                ((i.status === "unknown" || i.hostHeld) &&
                  (!i.operation.workspaceId ||
                    i.operation.workspaceId === workspace.id))),
          )
        )
          return state;
        if (
          !current &&
          Object.keys(state.configurationDrafts).length >=
            CONFIGURATION_DRAFT_LIMITS.entries
        )
          return {
            ...state,
            configurationNotice:
              "임시 초안은 최대 16개입니다. 사용하지 않는 초안을 먼저 버리세요.",
          };
        if (draft.revision === Number.MAX_SAFE_INTEGER) return state;
        return {
          ...state,
          configurationDrafts: {
            ...state.configurationDrafts,
            [key]: {
              ...draft,
              fileRequest: identity,
              fileRead: { status: "loading", path: target },
            },
          },
          configurationNotice: "",
        };
      }
      // Exact immutable request identity prevents discard/recreate revision ABA.
      if (!current || current.fileRequest !== identity) return state;
      const rest = { ...current };
      delete rest.fileRequest;
      delete rest.fileObservation;
      delete rest.fileSave;
      const value = event.value;
      const valid =
        value &&
        Object.getPrototypeOf(value) === Object.prototype &&
        Object.entries(Object.getOwnPropertyDescriptors(value)).every(
          ([name, descriptor]) =>
            [
              "workspaceId",
              "workspacePath",
              "kind",
              "path",
              "status",
              "content",
              "version",
              "reason",
            ].includes(name) && Object.hasOwn(descriptor, "value"),
        ) &&
        value.workspaceId === workspace.id &&
        value.workspacePath === workspace.path &&
        value.kind === identity.kind &&
        value.path === target &&
        (value.status === "available"
          ? typeof value.content === "string" &&
            configurationDraftFits(value.content) &&
            typeof value.version === "string" &&
            /^[a-f0-9]{64}$/.test(value.version) &&
            !Object.hasOwn(value, "reason") &&
            configurationFileContentFits(identity.kind, value.content)
          : ["missing", "unsupported", "unavailable"].includes(value.status) &&
            !Object.hasOwn(value, "content") &&
            !Object.hasOwn(value, "version") &&
            [
              "missing_file",
              "path_denied",
              "file_changed",
              "too_large",
              "unsupported_content",
            ].includes(value.reason));
      const next: ConfigurationDraft =
        valid && value.status === "available"
          ? {
              ...rest,
              text: value.content,
              baseline: value.content,
              revision: draft.revision + 1,
              validation: null,
              baselineFile: { path: value.path, version: value.version },
              fileObservation: identity,
              fileRead: { status: "available", path: target },
            }
          : {
              ...rest,
              ...(valid &&
              value.status === "missing" &&
              value.reason === "missing_file"
                ? { fileObservation: identity }
                : {}),
              fileRead: {
                status: valid
                  ? (value.status as "missing" | "unsupported" | "unavailable")
                  : "error",
                path: target,
                reason: valid
                  ? value.reason!
                  : (event.error ?? "INVALID_REQUEST"),
              },
            };
      return {
        ...state,
        configurationDrafts: { ...state.configurationDrafts, [key]: next },
      };
    }
    case "configuration.draft": {
      const workspace = state.lists.workspaces.find(
        (w) => w.id === state.selection.workspaceId,
      );
      if (
        !workspace ||
        event.workspaceId !== workspace.id ||
        event.path !== workspace.path ||
        !["instructions", "mcp"].includes(event.kind)
      )
        return state;
      const key = configurationDraftKey(
        workspace.id,
        workspace.path,
        event.kind,
      );
      const draft = state.configurationDrafts[key] ?? emptyConfigurationDraft;
      if (event.action === "discard") {
        const next = { ...state.configurationDrafts };
        delete next[key];
        return {
          ...state,
          configurationDrafts: next,
          configurationNotice: "",
          ...(event.kind === "instructions"
            ? { instructions: {} }
            : { mcp: { ...state.mcp, [workspace.id]: {} } }),
        };
      }
      if (
        !state.configurationDrafts[key] &&
        Object.keys(state.configurationDrafts).length >=
          CONFIGURATION_DRAFT_LIMITS.entries
      )
        return {
          ...state,
          configurationNotice:
            "임시 초안은 최대 16개입니다. 사용하지 않는 초안을 먼저 버리세요.",
        };
      let next: ConfigurationDraft;
      if (event.action === "edit") {
        if (!configurationDraftFits(event.text))
          return {
            ...state,
            configurationNotice:
              "초안은 UTF-8 기준 32KiB 이하여야 합니다. 이전 내용을 유지합니다.",
          };
        if (draft.text === event.text) return state;
        if (draft.revision === Number.MAX_SAFE_INTEGER)
          return {
            ...state,
            configurationNotice:
              "초안 버전 한도에 도달했습니다. 새 초안을 시작하세요.",
          };
        next = {
          ...draft,
          text: event.text,
          revision: draft.revision + 1,
          validation: null,
          ...(draft.fileSave
            ? { fileSave: { ...draft.fileSave, current: false } }
            : {}),
        };
        delete next.fileRequest;
        if (next.fileRead?.status === "loading")
          next.fileRead = {
            ...next.fileRead,
            status: "error",
            reason: "CANCELLED",
          };
      } else if (event.action === "validate")
        next = {
          ...draft,
          validation: {
            ...validateConfigurationDraft(event.kind, draft.text),
            revision: draft.revision,
          },
        };
      else {
        next = { ...draft, baseline: draft.text };
        delete next.baselineFile;
        delete next.fileObservation;
        delete next.fileSave;
        delete next.fileRequest;
        if (next.fileRead?.status === "loading")
          next.fileRead = {
            ...next.fileRead,
            status: "error",
            reason: "CANCELLED",
          };
      }
      return {
        ...state,
        configurationDrafts: { ...state.configurationDrafts, [key]: next },
        configurationNotice: "",
      };
    }
    case "draft": {
      const draft = state.drafts[event.key] ?? emptyDraft;
      const next = {
        text: event.text ?? draft.text,
        agent: event.agent ?? draft.agent,
        model: event.model ?? draft.model,
        revision: draft.revision + 1,
      };
      return next.text === draft.text &&
        next.agent === draft.agent &&
        next.model === draft.model
        ? state
        : { ...state, drafts: { ...state.drafts, [event.key]: next } };
    }
    case "intent": {
      const key = operationKey(event.intent.epoch, event.intent.id);
      if (state.operations[key]) return state;
      const runtime = event.intent.skillRuntimeMutation;
      if (skillRuntimeStep(event.intent.operation.type)) {
        const request = event.intent.operation as SkillRuntimeRequest;
        const observation = currentSkillRuntimeObservation(state);
        const allowed =
          request.type === "configuration.skill.register"
            ? canRegisterSkill(state)
            : request.type === "configuration.skill.remove"
              ? canRemoveSkill(state, request.nativeId)
              : canApplySkill(state, request.nativeId);
        if (
          !runtime ||
          !allowed ||
          !currentSkillRuntimeScope(state, runtime) ||
          runtime.floor !== state.revision ||
          runtime.epoch !== event.intent.epoch ||
          runtime.operationId !== event.intent.id ||
          request.requestId !== event.intent.id ||
          request.type !== runtime.type ||
          request.workspaceId !== runtime.workspaceId ||
          observation?.status !== "observed" ||
          request.observationId !== observation.observationId ||
          runtime.observationId !== observation.observationId ||
          (request.type === "configuration.skill.register"
            ? "sessionId" in request ||
              request.sourceName !== runtime.target.sourceName ||
              request.digest !== runtime.target.digest ||
              request.version !== runtime.version ||
              request.directoryVersion !== runtime.directoryVersion
            : request.nativeId !== runtime.target.nativeId ||
              (request.type === "configuration.skill.apply"
                ? request.sessionId !== runtime.sessionId
                : "sessionId" in request))
        )
          return state;
      }
      if (runtime) {
        const observation = currentSkillRuntimeObservation(state);
        if (
          observation?.status !== "observed" ||
          !hex64(runtime.target.bodyDigest) ||
          !hex64(runtime.target.nativeDigest)
        )
          return state;
        if (runtime.type === "configuration.skill.register") {
          if (
            runtime.target.registrationRuntimeEpoch !== runtime.epoch ||
            runtime.target.registrationOperationId !== runtime.operationId ||
            observation.file?.status !== "available" ||
            observation.file.digest !== runtime.target.digest
          )
            return state;
        } else if (
          !observation.owned.some((row) =>
            (
              [
                "sourceName",
                "nativeId",
                "digest",
                "nativeDigest",
                "registrationRuntimeEpoch",
                "registrationOperationId",
                "bodyDigest",
              ] as const
            ).every((field) => row[field] === runtime.target[field]),
          )
        )
          return state;
      }
      const agentRuntime = event.intent.agentRuntimeMutation;
      if (agentRuntimeStep(event.intent.operation.type)) {
        const request = event.intent.operation as AgentRuntimeRequest;
        const observation = currentAgentRuntimeObservation(state);
        const allowed =
          request.type === "configuration.agent.register"
            ? canRegisterAgent(state)
            : canRemoveAgent(state, request.nativeId);
        if (
          !agentRuntime ||
          !allowed ||
          !currentAgentRuntimeScope(state, agentRuntime) ||
          agentRuntime.floor !== state.revision ||
          agentRuntime.epoch !== event.intent.epoch ||
          agentRuntime.operationId !== event.intent.id ||
          request.requestId !== event.intent.id ||
          request.type !== agentRuntime.type ||
          request.workspaceId !== agentRuntime.workspaceId ||
          observation?.status !== "observed" ||
          request.observationId !== observation.observationId ||
          agentRuntime.observationId !== observation.observationId ||
          (request.type === "configuration.agent.register"
            ? "sessionId" in request ||
              request.sourceName !== agentRuntime.target.sourceName ||
              request.digest !== agentRuntime.target.digest ||
              request.version !== agentRuntime.version ||
              request.directoryVersion !== agentRuntime.directoryVersion
            : request.nativeId !== agentRuntime.target.nativeId ||
              "sessionId" in request)
        )
          return state;
      }
      if (agentRuntime) {
        const observation = currentAgentRuntimeObservation(state);
        if (
          observation?.status !== "observed" ||
          agentRuntime.defaultAgentId !== observation.defaultAgentId ||
          !hex64(agentRuntime.target.systemDigest) ||
          !hex64(agentRuntime.target.nativeDigest)
        )
          return state;
        if (agentRuntime.type === "configuration.agent.register") {
          if (
            agentRuntime.target.registrationRuntimeEpoch !==
              agentRuntime.epoch ||
            agentRuntime.target.registrationOperationId !==
              agentRuntime.operationId ||
            observation.file?.status !== "available" ||
            observation.file.digest !== agentRuntime.target.digest
          )
            return state;
        } else if (
          !observation.owned.some((row) =>
            (
              [
                "sourceName",
                "nativeId",
                "digest",
                "nativeDigest",
                "registrationRuntimeEpoch",
                "registrationOperationId",
                "systemDigest",
              ] as const
            ).every((field) => row[field] === agentRuntime.target[field]),
          )
        )
          return state;
      }
      const mcp = event.intent.mcpMutation;
      if (
        event.intent.operation.type.startsWith("configuration.mcp.") &&
        (!mcp ||
          !{
            "configuration.mcp.register": canRegisterMcp,
            "configuration.mcp.connect": canConnectMcp,
            "configuration.mcp.disconnect": canDisconnectMcp,
            "configuration.mcp.remove": canRemoveMcp,
          }[mcp.request.type](state, mcp.request.sourceName) ||
          mcp.request !== event.intent.operation ||
          mcp.epoch !== event.intent.epoch ||
          mcp.operationId !== event.intent.id ||
          !currentMcpScope(state, mcp) ||
          mcp.floor !== state.revision ||
          mcp.observation !== selectedMcp(state).observation ||
          mcp.request.expectedObservationVersion !== mcp.observation.version ||
          mcp.request.workspaceId !== mcp.workspaceId ||
          !mcpNativeName(mcp.nativeName) ||
          (mcp.request.type === "configuration.mcp.register" &&
            (mcp.request.text !== mcp.draft?.text ||
              mcp.request.fileVersion !== mcp.draft.baselineFile?.version ||
              !sameMcpDraft(
                mcp.draft,
                state.configurationDrafts[
                  configurationDraftKey(mcp.workspaceId, mcp.path, "mcp")
                ],
              ))))
      )
        return state;
      const instruction = event.intent.instructionMutation;
      const instructionType =
        event.intent.operation.type === "configuration.instructions.apply" ||
        event.intent.operation.type === "configuration.instructions.remove";
      if (
        instructionType &&
        (!instruction ||
          !(instruction.request.type === "configuration.instructions.apply"
            ? canApplyInstructions(state)
            : canRemoveInstructions(state)) ||
          instruction.request !== event.intent.operation ||
          instruction.epoch !== event.intent.epoch ||
          instruction.operationId !== event.intent.id ||
          !currentInstructionScope(state, instruction) ||
          instruction.floor !== state.revision ||
          instruction.observation !== selectedInstructions(state).observation ||
          instruction.request.expectedRegistrationVersion !==
            (instruction.observation.status !== "unavailable"
              ? instruction.observation.version
              : undefined) ||
          instruction.draft !==
            state.configurationDrafts[
              configurationDraftKey(
                instruction.workspaceId,
                instruction.path,
                "instructions",
              )
            ] ||
          instruction.request.workspaceId !== instruction.workspaceId ||
          instruction.request.sessionId !== instruction.sessionId ||
          (instruction.request.type === "configuration.instructions.apply" &&
            (instruction.request.text !== instruction.draft?.text ||
              instruction.request.fileVersion !==
                instruction.draft.baselineFile?.version ||
              !hex64(instruction.digest))))
      )
        return state;
      const skill = event.intent.skillSave;
      if (
        event.intent.operation.type === "configuration.skill.save" &&
        (!skill ||
          !canSaveSkillFile(state) ||
          !currentSkillScope(state, skill) ||
          skill.draft !== selectedSkillDraft(state) ||
          skill.operationId !== event.intent.id ||
          skill.epoch !== event.intent.epoch ||
          skill.request !== event.intent.operation ||
          skill.request.workspaceId !== skill.workspaceId ||
          skill.request.sourceName !== skill.sourceName ||
          skill.request.text !== skill.draft.text ||
          !skill.draft.read ||
          !("directoryVersion" in skill.draft.read) ||
          skill.request.directoryVersion !==
            skill.draft.read.directoryVersion ||
          (skill.request.expectation === "version"
            ? skill.draft.read.status !== "available" ||
              skill.request.version !== skill.draft.read.version
            : skill.draft.read.status !== "missing"))
      )
        return state;
      const file = event.intent.workspaceFileSave;
      if (
        event.intent.operation.type === "file.save" &&
        (!file ||
          !canSaveWorkspaceFile(state) ||
          !currentWorkspaceFileScope(state, file) ||
          file.draft !== selectedWorkspaceFileDraft(state) ||
          file.operationId !== event.intent.id ||
          file.request.requestId !== event.intent.id ||
          file.epoch !== event.intent.epoch ||
          file.request !== event.intent.operation ||
          file.request.workspaceId !== file.workspaceId ||
          file.request.path !== file.path ||
          file.request.text !== file.draft.text ||
          file.draft.read?.status !== "available" ||
          file.request.version !== file.draft.read.version ||
          file.request.directoryVersion !== file.draft.read.directoryVersion ||
          file.request.expectation !== "version" ||
          !hex64(file.digest))
      )
        return state;
      const agent = event.intent.agentSave;
      if (
        event.intent.operation.type === "configuration.agent.save" &&
        (!agent ||
          !canSaveAgentFile(state) ||
          !currentAgentScope(state, agent) ||
          agent.draft !== selectedAgentDraft(state) ||
          agent.operationId !== event.intent.id ||
          agent.epoch !== event.intent.epoch ||
          agent.request !== event.intent.operation ||
          agent.request.workspaceId !== agent.workspaceId ||
          agent.request.sourceName !== agent.sourceName ||
          agent.request.text !== agent.draft.text ||
          !agent.draft.read ||
          !("directoryVersion" in agent.draft.read) ||
          agent.request.directoryVersion !==
            agent.draft.read.directoryVersion ||
          (agent.request.expectation === "version"
            ? agent.draft.read.status !== "available" ||
              agent.request.version !== agent.draft.read.version
            : agent.draft.read.status !== "missing"))
      )
        return state;
      const save = event.intent.configurationSave;
      if (
        event.intent.operation.type === "configuration.save" &&
        (!save ||
          !canSaveConfigurationDraft(state, save.kind) ||
          save.request !== event.intent.operation ||
          save.epoch !== event.intent.epoch ||
          save.operationId !== event.intent.id)
      )
        return state;
      const draftKey = save
        ? configurationDraftKey(save.workspaceId, save.path, save.kind)
        : undefined;
      if (save && draftKey) {
        const draft = state.configurationDrafts[draftKey];
        if (
          !draft ||
          draft.revision !== save.revision ||
          draft.text !== save.request.text ||
          save.floor !== state.revision ||
          state.selection.workspaceId !== save.workspaceId ||
          !state.lists.workspaces.some(
            (w) => w.id === save.workspaceId && w.path === save.path,
          ) ||
          save.request.workspaceId !== save.workspaceId ||
          save.request.kind !== save.kind ||
          (save.request.expectation === "version"
            ? save.request.version !== draft.baselineFile?.version ||
              draft.fileRead?.status !== "available"
            : draft.fileRead?.status !== "missing")
        )
          return state;
      }
      return {
        ...state,
        ...(runtime
          ? {
              skillRuntime: {
                action: {
                  identity: runtime,
                  status: "pending" as const,
                  current: true,
                },
              },
            }
          : {}),
        ...(skill
          ? {
              skillDrafts: {
                ...state.skillDrafts,
                [skillDraftKey(
                  skill.workspaceId,
                  skill.path,
                  skill.sourceName,
                )]: {
                  ...skill.draft!,
                  save: { identity: skill, status: "pending", current: true },
                },
              },
            }
          : {}),
        ...(agentRuntime
          ? {
              agentRuntime: {
                action: {
                  identity: agentRuntime,
                  status: "pending" as const,
                  current: true,
                },
              },
            }
          : {}),
        ...(agent
          ? {
              agentDrafts: {
                ...state.agentDrafts,
                [agentDraftKey(
                  agent.workspaceId,
                  agent.path,
                  agent.sourceName,
                )]: {
                  ...agent.draft!,
                  save: { identity: agent, status: "pending", current: true },
                },
              },
            }
          : {}),
        ...(mcp
          ? {
              mcp: {
                ...state.mcp,
                [mcp.workspaceId]: {
                  action: { identity: mcp, status: "pending", current: true },
                },
              },
            }
          : {}),
        ...(instruction
          ? {
              instructions: {
                ...state.instructions,
                [selectionKey(instruction.workspaceId, instruction.sessionId)]:
                  {
                    action: {
                      identity: instruction,
                      status: "pending",
                      current: true,
                    },
                  },
              },
            }
          : {}),
        ...(save && draftKey
          ? {
              configurationDrafts: {
                ...state.configurationDrafts,
                [draftKey]: {
                  ...state.configurationDrafts[draftKey]!,
                  fileSave: {
                    status: "pending",
                    current: true,
                    identity: save,
                  },
                },
              },
            }
          : {}),
        operations: {
          ...state.operations,
          [key]: {
            ...event.intent,
            observationSequence: state.observationSequence,
          },
        },
        error: "",
        notice: "",
        interruptNotice: null,
      };
    }
    case "unknown": {
      const key = findIntentKey(state, event.id);
      const intent = key ? state.operations[key] : undefined;
      if (!intent || intent.status === "accepted" || intent.status === "failed")
        return state;
      let next = mcpActionState(
        instructionActionState(
          configurationSaveState(
            skillSaveState(state, intent, "unknown"),
            intent,
            "unknown",
          ),
          intent,
          "unknown",
        ),
        intent,
        "unknown",
      );
      next = skillRuntimeActionState(next, intent, "unknown");
      next = agentRuntimeActionState(next, intent, "unknown");
      next = agentSaveState(next, intent, "unknown");
      next = workspaceFileSaveState(next, intent, "unknown");
      return {
        ...next,
        operations: {
          ...state.operations,
          [key!]:
            intent.configurationSave ||
            intent.skillSave ||
            intent.agentSave ||
            intent.workspaceFileSave
              ? {
                  ...intent,
                  status: "unknown",
                  lookupOnly: true,
                  operation: {
                    type: intent.operation.type,
                    ...(intent.operation.workspaceId
                      ? { workspaceId: intent.operation.workspaceId }
                      : {}),
                  },
                }
              : intent.instructionMutation ||
                  intent.mcpMutation ||
                  intent.skillRuntimeMutation ||
                  intent.agentRuntimeMutation
                ? instructionLookupOnly({ ...intent, status: "unknown" })
                : { ...intent, status: "unknown" },
        },
        ...(currentIntent(state, intent)
          ? {
              notice:
                "요청 결과를 확인할 수 없습니다. 자동 재전송하지 않습니다.",
              interruptNotice: null,
            }
          : {}),
      };
    }
    case "refused": {
      const key = findIntentKey(state, event.id);
      const intent = key ? state.operations[key] : undefined;
      if (!intent) return state;
      if (
        (intent.configurationSave ||
          intent.skillSave ||
          intent.agentSave ||
          intent.workspaceFileSave ||
          intent.instructionMutation ||
          intent.mcpMutation ||
          intent.skillRuntimeMutation ||
          intent.agentRuntimeMutation) &&
        intent.status !== "pending"
      )
        return state;
      let next = configurationSaveState(
        instructionActionState(
          mcpActionState(
            skillSaveState(
              state,
              intent,
              event.code === "FILE_CHANGED" ? "conflict" : "denied",
              undefined,
              event.code,
            ),
            intent,
            event.code === "MCP_CHANGED" || event.code === "FILE_CHANGED"
              ? "changed"
              : "denied",
            event.code,
          ),
          intent,
          event.code === "INSTRUCTIONS_CHANGED" ? "changed" : "denied",
          event.code,
        ),
        intent,
        event.code === "FILE_CHANGED" ? "conflict" : "denied",
        undefined,
        event.code,
      );
      next = skillRuntimeActionState(next, intent, "denied", event.code);
      next = agentRuntimeActionState(next, intent, "denied", event.code);
      next = agentSaveState(
        next,
        intent,
        event.code === "FILE_CHANGED" ? "conflict" : "denied",
        undefined,
        event.code,
      );
      next = workspaceFileSaveState(
        next,
        intent,
        event.code === "FILE_CHANGED" ? "conflict" : "denied",
        undefined,
        event.code,
      );
      return {
        ...next,
        operations: {
          ...state.operations,
          [key!]: { ...intent, status: "failed" },
        },
        error: event.code,
      };
    }
    case "receipt": {
      const receipt = event.receipt;
      if (
        !closed(
          receipt,
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
        )
      )
        return state;
      const key = operationKey(receipt.runtimeEpoch, receipt.operationId);
      const intent = state.operations[key];
      if (
        !intent ||
        (event.id !== intent.id && event.id !== key) ||
        !validClock(receipt.revision) ||
        !["rejected", "admitted", "dispatched"].includes(receipt.admission) ||
        !["pending", "accepted", "unknown"].includes(receipt.delivery) ||
        !["none", "pending", "confirmed", "failed", "unknown"].includes(
          receipt.effect,
        ) ||
        !Array.isArray(receipt.evidence) ||
        receipt.evidence.length > 40 ||
        receipt.operationId !== intent.id ||
        receipt.runtimeEpoch !== intent.epoch ||
        receipt.type !== intent.operation.type ||
        (receipt.workspaceId !==
          ("workspaceId" in intent.operation
            ? intent.operation.workspaceId
            : undefined) &&
          receipt.workspaceId !== undefined) ||
        (receipt.sessionId !==
          ("sessionId" in intent.operation
            ? intent.operation.sessionId
            : undefined) &&
          receipt.sessionId !== undefined) ||
        (intent.receipt && receipt.revision < intent.receipt.revision)
      )
        return state;
      if (
        ([
          "configuration.save",
          "configuration.skill.save",
          "configuration.agent.save",
          "file.save",
        ].includes(intent.operation.type) &&
          (event.id !== key ||
            !validConfigurationReceipt(
              receipt,
              intent,
              event.fileBackupProof,
            ) ||
            intent.status === "accepted" ||
            intent.status === "failed")) ||
        (intent.operation.type !== "configuration.save" &&
          receipt.result?.kind === "configuration_saved") ||
        (intent.operation.type !== "configuration.skill.save" &&
          receipt.result?.kind === "skill_file_saved") ||
        (intent.operation.type !== "configuration.agent.save" &&
          receipt.result?.kind === "agent_file_saved")
      )
        return state;
      if (
        intent.operation.type !== "file.save" &&
        receipt.result?.kind === "file_saved"
      )
        return state;
      const runtimeType = Boolean(skillRuntimeStep(intent.operation.type));
      if (
        runtimeType
          ? event.id !== key ||
            !validSkillRuntimeReceipt(receipt, intent) ||
            intent.status === "accepted" ||
            intent.status === "failed"
          : ["skill_registered", "skill_removed", "skill_applied"].includes(
              receipt.result?.kind ?? "",
            )
      )
        return state;
      const agentRuntimeType = Boolean(agentRuntimeStep(intent.operation.type));
      if (
        agentRuntimeType
          ? event.id !== key ||
            !validAgentRuntimeReceipt(receipt, intent) ||
            intent.status === "accepted" ||
            intent.status === "failed"
          : ["agent_registered", "agent_removed"].includes(
              receipt.result?.kind ?? "",
            )
      )
        return state;
      const mcpType = intent.operation.type.startsWith("configuration.mcp.");
      if (
        mcpType
          ? event.id !== key ||
            !validMcpReceipt(receipt, intent) ||
            intent.status === "accepted" ||
            intent.status === "failed"
          : receipt.result?.kind.startsWith("mcp_")
      )
        return state;
      const instructionType =
        intent.operation.type === "configuration.instructions.apply" ||
        intent.operation.type === "configuration.instructions.remove";
      if (
        instructionType
          ? event.id !== key ||
            !validInstructionReceipt(receipt, intent) ||
            intent.status === "accepted" ||
            intent.status === "failed"
          : receipt.result?.kind === "instruction_registered" ||
            receipt.result?.kind === "instruction_removed"
      )
        return state;
      if (
        receipt.result?.kind === "removed" &&
        (!("workspaceId" in intent.operation) ||
          receipt.result.workspaceId !== intent.operation.workspaceId ||
          receipt.result.workspaceRemoved !==
            (intent.operation.type === "workspace.remove") ||
          (intent.operation.type === "session.remove" &&
            !receipt.result.removedSessionIds?.includes(
              intent.operation.sessionId!,
            )))
      )
        return state;
      const absentRemoval =
        mcpType &&
        receipt.effect === "none" &&
        receipt.admission === "admitted" &&
        receipt.delivery === "accepted" &&
        receipt.result?.kind === "mcp_removed";
      const confirmed =
        receipt.effect === "confirmed" && receipt.evidence.length > 0;
      const accepted =
        absentRemoval ||
        confirmed ||
        (receipt.delivery === "accepted" &&
          receipt.evidence.length > 0 &&
          receipt.result?.kind === "delivery");
      if (
        (intent.status === "accepted" && !accepted) ||
        JSON.stringify(intent.receipt) === JSON.stringify(receipt)
      )
        return state;
      const failed =
        (receipt.effect === "none" && receipt.admission === "rejected") ||
        receipt.effect === "failed";
      let next: State = {
        ...state,
        revision:
          (confirmed || absentRemoval) && receipt.runtimeEpoch === state.epoch
            ? Math.max(state.revision, receipt.revision)
            : state.revision,
        operations: {
          ...state.operations,
          [key]: {
            ...intent,
            receipt,
            status: accepted ? "accepted" : failed ? "failed" : "unknown",
          },
        },
      };
      if (runtimeType) {
        const code =
          receipt.result?.kind === "rejected" ? receipt.result.code : undefined;
        const status = confirmed
          ? receipt.result?.kind === "skill_registered"
            ? "registered_disabled"
            : receipt.result?.kind === "skill_removed"
              ? "removed"
              : "applied"
          : failed
            ? "denied"
            : "unknown";
        next = skillRuntimeActionState(next, intent, status, code);
        if (!accepted && !failed)
          next.operations[key] = instructionLookupOnly(next.operations[key]!);
        return next;
      }
      if (agentRuntimeType) {
        const code =
          receipt.result?.kind === "rejected" ? receipt.result.code : undefined;
        const status = confirmed
          ? receipt.result?.kind === "agent_registered"
            ? "registered_primary"
            : "removed"
          : failed
            ? "denied"
            : "unknown";
        next = agentRuntimeActionState(next, intent, status, code);
        if (!accepted && !failed)
          next.operations[key] = instructionLookupOnly(next.operations[key]!);
        return next;
      }
      if (mcpType) {
        const code =
          receipt.result?.kind === "rejected" ? receipt.result.code : undefined;
        const result = receipt.result;
        next = mcpActionState(
          next,
          intent,
          confirmed || absentRemoval
            ? result?.kind === "mcp_registered"
              ? "registered_disabled"
              : result?.kind === "mcp_removed"
                ? "removed"
                : result?.kind === "mcp_connection"
                  ? result.connectionStatus === "disabled"
                    ? "disconnected"
                    : result.connectionStatus
                  : "unknown"
            : failed
              ? code === "MCP_CHANGED" || code === "FILE_CHANGED"
                ? "changed"
                : "denied"
              : "unknown",
          code,
        );
        if (!accepted && !failed)
          next.operations[key] = instructionLookupOnly(next.operations[key]!);
        return next;
      }
      if (instructionType) {
        const code =
          receipt.result?.kind === "rejected" ? receipt.result.code : undefined;
        next = instructionActionState(
          next,
          intent,
          confirmed
            ? receipt.result?.kind === "instruction_registered"
              ? "registered"
              : "removed"
            : failed
              ? code === "INSTRUCTIONS_CHANGED"
                ? "changed"
                : "denied"
              : "unknown",
          code,
        );
        if (!accepted && !failed)
          next.operations[key] = instructionLookupOnly(next.operations[key]!);
        // A receipt is operation evidence; only an explicit read can refresh Native state.
        return next;
      }
      if (intent.operation.type === "file.save") {
        const code =
          receipt.result?.kind === "rejected" ? receipt.result.code : undefined;
        next = workspaceFileSaveState(
          next,
          intent,
          confirmed
            ? "saved"
            : failed
              ? code === "FILE_CHANGED"
                ? "conflict"
                : "denied"
              : "unknown",
          receipt.result?.kind === "file_saved" ? receipt.result : undefined,
          code,
        );
        if (!accepted && !failed)
          next.operations[key] = instructionLookupOnly(next.operations[key]!);
        return next;
      }
      if (intent.operation.type === "configuration.skill.save") {
        const code =
          receipt.result?.kind === "rejected" ? receipt.result.code : undefined;
        next = skillSaveState(
          next,
          intent,
          confirmed
            ? "saved"
            : failed
              ? code === "FILE_CHANGED"
                ? "conflict"
                : "denied"
              : "unknown",
          receipt.result?.kind === "skill_file_saved"
            ? receipt.result
            : undefined,
          code,
        );
        if (!accepted && !failed)
          next.operations[key] = instructionLookupOnly(next.operations[key]!);
        return next;
      }
      if (intent.operation.type === "configuration.agent.save") {
        const code =
          receipt.result?.kind === "rejected" ? receipt.result.code : undefined;
        next = agentSaveState(
          next,
          intent,
          confirmed
            ? "saved"
            : failed
              ? code === "FILE_CHANGED"
                ? "conflict"
                : "denied"
              : "unknown",
          receipt.result?.kind === "agent_file_saved"
            ? receipt.result
            : undefined,
          code,
        );
        if (!accepted && !failed)
          next.operations[key] = instructionLookupOnly(next.operations[key]!);
        return next;
      }
      if (intent.operation.type === "configuration.save") {
        const code =
          receipt.result?.kind === "rejected" ? receipt.result.code : undefined;
        next = configurationSaveState(
          next,
          intent,
          confirmed
            ? "saved"
            : failed
              ? code === "FILE_CHANGED"
                ? "conflict"
                : "denied"
              : "unknown",
          receipt.result?.kind === "configuration_saved"
            ? receipt.result
            : undefined,
          code,
        );
        if (!accepted && !failed)
          next.operations[key] = {
            ...next.operations[key]!,
            lookupOnly: true,
            operation: {
              type: intent.operation.type,
              ...(intent.operation.workspaceId
                ? { workspaceId: intent.operation.workspaceId }
                : {}),
            },
          };
        // Configuration saves do not reload previews, clear messages, or imply runtime activation.
        return next;
      }
      if (
        accepted &&
        !intent.lookupOnly &&
        intent.submitted &&
        next.drafts[intent.key]?.revision === intent.submitted.revision
      )
        next = {
          ...next,
          drafts: {
            ...next.drafts,
            [intent.key]: {
              ...next.drafts[intent.key]!,
              text: "",
              revision: intent.submitted.revision + 1,
            },
          },
        };
      if (
        confirmed &&
        !intent.lookupOnly &&
        intent.navigate &&
        next.epoch === intent.epoch &&
        next.selection.generation === intent.origin.generation &&
        (receipt.result?.kind === "created" ||
          receipt.result?.kind === "forked")
      ) {
        next = select(
          next,
          receipt.result.workspaceId,
          receipt.result.sessionId,
        );
      }
      if (
        confirmed &&
        !intent.lookupOnly &&
        receipt.result?.kind === "removed"
      ) {
        const result = receipt.result,
          ids = result.removedSessionIds ?? [];
        // Target effect identity is independent of the navigation generation.
        const drafts = { ...next.drafts };
        for (const key of Object.keys(drafts)) {
          const [w, s] = JSON.parse(key);
          if (
            w === result.workspaceId &&
            (result.workspaceRemoved || ids.includes(s))
          )
            delete drafts[key];
        }
        const workspaces = result.workspaceRemoved
          ? next.lists.workspaces.filter((w) => w.id !== result.workspaceId)
          : next.lists.workspaces;
        const sessions = next.lists.sessions.filter(
          (s) =>
            s.workspaceId !== result.workspaceId ||
            (!result.workspaceRemoved && !ids.includes(s.id)),
        );
        next = { ...next, drafts, lists: { workspaces, sessions } };
        if (
          next.selection.workspaceId === result.workspaceId &&
          (result.workspaceRemoved ||
            ids.includes(next.selection.sessionId ?? ""))
        ) {
          const workspaceId = result.workspaceRemoved
            ? workspaces[0]?.id
            : result.workspaceId;
          const successor = sessions
            .filter((s) => s.workspaceId === workspaceId && !s.archived)
            .sort(
              (a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)),
            )[0]?.id;
          next = select(next, workspaceId, successor);
        } else if (next.snapshot)
          next = {
            ...next,
            snapshot: { ...next.snapshot, workspaces, sessions },
          };
      }
      if (accepted && next.files.visible)
        next = {
          ...next,
          files: {
            ...next.files,
            status: "stale",
            generation: next.files.generation + 1,
            identity: next.files.identity
              ? {
                  ...next.files.identity,
                  generation: next.files.generation + 1,
                }
              : null,
            busy: false,
          },
        };
      if (accepted && !intent.lookupOnly && currentIntent(next, intent)) {
        const interrupt =
          intent.operation.type === "session.interrupt" &&
          receipt.result?.kind === "delivery" &&
          receipt.result.status === "stopping";
        const scope = scopeOf(next);
        // A late ACK must not recreate a wait already superseded by idle.
        if (
          interrupt &&
          observedIdle(
            next.snapshot,
            scope,
            Math.max(next.revision, receipt.revision),
            intent.observationSequence ?? 0,
          )
        )
          return next;
        next = {
          ...next,
          interruptNotice: interrupt
            ? {
                operationId: intent.id,
                scope,
                revision: Math.max(next.revision, receipt.revision),
              }
            : null,
          notice:
            receipt.result?.kind === "delivery" &&
            receipt.result.status === "stopping"
              ? "중단 요청을 접수했습니다. 실제 상태를 확인하고 있습니다."
              : receipt.result?.kind === "delivery" &&
                  receipt.result.status === "decided"
                ? "권한 결정을 전달했습니다. 도구 실행 완료를 뜻하지 않습니다."
                : "요청을 접수했습니다. 실행 결과는 대화에서 확인합니다.",
        };
      }
      return next;
    }
    case "layout": {
      const next = { ...state, layout: { ...state.layout, ...event.value } };
      return event.value.panel !== undefined && event.value.panel !== "activity"
        ? transition(next, { type: "diagnostics.close" })
        : next;
    }
    case "files.open":
      return fileOpen(state, event.path, event.kind);
    case "files.close":
      return {
        ...state,
        files: { ...initialFiles(), generation: state.files.generation + 1 },
      };
    case "files.pause":
      return {
        ...state,
        files: {
          ...state.files,
          busy: false,
          status:
            state.files.preview || state.files.listing
              ? "stale"
              : state.files.status,
        },
      };
    case "files.check":
      return state.files.visible && state.files.identity
        ? {
            ...state,
            files: {
              ...state.files,
              busy: true,
              error: "",
              status: "checking",
            },
          }
        : state;
    case "files.list":
      return sameFile(state.files.identity, event.identity)
        ? { ...state, files: { ...state.files, listing: event.value } }
        : state;
    case "files.read":
      return sameFile(state.files.identity, event.identity)
        ? { ...state, files: { ...state.files, preview: event.value } }
        : state;
    case "files.error":
      return sameFile(state.files.identity, event.identity)
        ? {
            ...state,
            files: {
              ...state.files,
              preview:
                event.code === "NOT_FOUND" || event.code === "FILE_DENIED"
                  ? null
                  : state.files.preview,
              status: event.code === "NOT_FOUND" ? "missing" : "stale",
              error: event.code,
            },
          }
        : state;
    case "files.done":
      return sameFile(state.files.identity, event.identity)
        ? {
            ...state,
            files: {
              ...state.files,
              busy: false,
              status: state.files.error ? state.files.status : "observed",
            },
          }
        : state;
    case "diagnostics.open": {
      const requestGeneration = state.diagnosticsGeneration + 1;
      return {
        ...state,
        diagnosticsGeneration: requestGeneration,
        diagnosticsIdentity: {
          ...scopeOf(state),
          filtered: event.filtered,
          requestGeneration,
        },
        diagnostics: null,
        diagnosticsError: "",
      };
    }
    case "diagnostics.close":
      return state.diagnosticsIdentity ||
        state.diagnostics ||
        state.diagnosticsError
        ? {
            ...state,
            diagnosticsIdentity: null,
            diagnostics: null,
            diagnosticsError: "",
          }
        : state;
    case "diagnostics":
      return state.diagnosticsIdentity === event.identity &&
        sameScope(state, event.identity)
        ? {
            ...state,
            diagnostics: event.value ?? null,
            diagnosticsError: event.error ?? "",
          }
        : state;
  }
}
export function transition(state: State, event: Event): State {
  let next = reduceWorkbench(state, event);
  if (
    next !== state &&
    event.type === "intent" &&
    event.intent.workspaceFileSave
  ) {
    const i = event.intent.workspaceFileSave,
      key = workspaceFileDraftKey(
        i.epoch,
        i.workspaceId,
        i.workspacePath,
        i.path,
      );
    next = {
      ...next,
      workspaceFileDrafts: {
        ...next.workspaceFileDrafts,
        [key]: {
          ...i.draft,
          save: { identity: i, status: "pending", current: true },
        },
      },
    };
  }
  if (
    next !== state &&
    event.type === "files.open" &&
    event.kind === "file" &&
    event.path &&
    validWorkspaceFilePath(event.path)
  )
    next = {
      ...next,
      workspaceFile: {
        path: event.path,
        generation: next.workspaceFile.generation + 1,
      },
    };
  let drafts = next.workspaceFileDrafts;
  for (const [key, d] of Object.entries(drafts)) {
    const i = d.request ?? d.observation;
    if (
      i &&
      (!currentWorkspaceFileScope(next, i) || !workspaceFileAuthority(next))
    ) {
      if (drafts === next.workspaceFileDrafts) drafts = { ...drafts };
      drafts[key] = { ...d, request: undefined, observation: undefined };
    }
  }
  if (drafts !== next.workspaceFileDrafts)
    next = { ...next, workspaceFileDrafts: drafts };
  if (next === state) return state;
  const entry = selectedExtensions(state);
  const identity = entry.request ?? entry.observationIdentity;
  if (
    !identity ||
    identity.generation !== state.extensionsGeneration ||
    (currentExtensionScope(next, identity) && extensionTargetReady(next))
  )
    return next;
  // Retire display and request identity on authority loss. Reconnect, root ABA or
  // clearing a hold can never revive historical evidence at the same revision.
  const extensions = { ...next.extensions };
  for (const [key, prior] of Object.entries(extensions)) {
    if (prior.request || key === identity.workspaceId)
      extensions[key] = {
        ...prior,
        request: undefined,
        error: "STALE",
      };
  }
  return {
    ...next,
    extensions,
    extensionsGeneration: state.extensionsGeneration + 1,
  };
}
export function createWorkbenchStore(wide = true) {
  const store = createStore<State>(() => ({
    epoch: undefined,
    retiredEpochs: [],
    revision: -1,
    observationSequence: 0,
    recovery: null,
    selection: { generation: 0 },
    snapshot: null,
    lists: { workspaces: [], sessions: [] },
    connection: "loading",
    error: "",
    notice: "",
    interruptNotice: null,
    catalog: null,
    catalogError: "",
    catalogGeneration: 0,
    drafts: {},
    configurationDrafts: {},
    skillRuntime: {},
    skillFiles: { generation: 0 },
    skillDrafts: {},
    agentRuntime: {},
    agentFiles: { generation: 0 },
    agentDrafts: {},
    extensions: {},
    extensionsGeneration: 0,
    mcp: {},
    instructions: {},
    configurationNotice: "",
    configurationIO: { reads: 0, saves: 0 },
    operations: {},
    workspaceFile: { generation: 0 },
    workspaceFileDrafts: {},
    workspaceFileIO: {},
    files: initialFiles(),
    diagnostics: null,
    diagnosticsError: "",
    diagnosticsIdentity: null,
    diagnosticsGeneration: 0,
    layout: {
      wide,
      navigation: wide,
      panel: null,
      panelWidth: 336,
      navigationBeforePanel: false,
    },
  }));
  return {
    getState: store.getState,
    getInitialState: store.getInitialState,
    subscribe: store.subscribe,
    dispatch(event: Event) {
      store.setState((state) => transition(state, event), true);
    },
  };
}
export type WorkbenchStore = ReturnType<typeof createWorkbenchStore>;
export const selectors = {
  workspaceFileDraft: selectedWorkspaceFileDraft,
  workspaceFileSave: (s: State) => selectedWorkspaceFileDraft(s).save,
  workspaceFile: (s: State) => s.workspaceFile,
  workspaceFileTargetPath: (s: State) => {
    const key = selectedWorkspaceFileKey(s);
    if (!key) return undefined;
    const [, , root, path] = JSON.parse(key) as string[];
    return workspaceFileTargetPath(root, path);
  },
  canReadWorkspaceFile,
  canSaveWorkspaceFile,
  extensions: selectedExtensions,
  extensionReadBlockReason,
  currentExtensionObservation,
  canObserveExtensions,
  extensionsHeld,
  skillRuntime: (s: State) => s.skillRuntime,
  skillRuntimeActionCurrent: (s: State) =>
    Boolean(
      s.skillRuntime.action?.current &&
        currentSkillRuntimeScope(
          { ...s, revision: s.skillRuntime.action.identity.floor },
          s.skillRuntime.action.identity,
        ),
    ),
  currentSkillRuntimeObservation,
  canObserveSkillRuntime,
  canRegisterSkill,
  canRemoveSkill,
  canApplySkill,
  skillFiles: (s: State) => s.skillFiles,
  skillListCurrent: (s: State) =>
    Boolean(
      s.skillFiles.listingIdentity &&
        currentSkillScope(s, {
          ...s.skillFiles.listingIdentity,
          generation: s.skillFiles.generation,
        }),
    ),
  skillReadCurrent: (s: State) =>
    Boolean(
      selectedSkillDraft(s).observation &&
        currentSkillScope(s, selectedSkillDraft(s).observation!) &&
        mcpTargetReady(s),
    ),
  skillSave: (s: State) => {
    const save = selectedSkillDraft(s).save;
    return save &&
      currentSkillScope({ ...s, revision: save.identity.floor }, save.identity)
      ? save
      : undefined;
  },
  skillDraft: selectedSkillDraft,
  canReadSkillFiles,
  canSaveSkillFile,
  agentRuntime: (s: State) => s.agentRuntime,
  agentRuntimeActionCurrent: (s: State) =>
    Boolean(
      s.agentRuntime.action?.current &&
        currentAgentRuntimeScope(
          { ...s, revision: s.agentRuntime.action.identity.floor },
          s.agentRuntime.action.identity,
        ),
    ),
  currentAgentRuntimeObservation,
  canObserveAgentRuntime,
  canRegisterAgent,
  canRemoveAgent,
  agentFiles: (s: State) => s.agentFiles,
  agentListCurrent: (s: State) =>
    Boolean(
      s.agentFiles.listingIdentity &&
        currentAgentScope(s, {
          ...s.agentFiles.listingIdentity,
          generation: s.agentFiles.generation,
        }),
    ),
  agentReadCurrent: (s: State) =>
    Boolean(
      selectedAgentDraft(s).observation &&
        currentAgentScope(s, selectedAgentDraft(s).observation!) &&
        mcpTargetReady(s),
    ),
  agentSave: (s: State) => {
    const save = selectedAgentDraft(s).save;
    return save &&
      currentAgentScope({ ...s, revision: save.identity.floor }, save.identity)
      ? save
      : undefined;
  },
  agentDraft: selectedAgentDraft,
  canReadAgentFiles,
  canSaveAgentFile,
  mcp: selectedMcp,
  currentMcpObservation,
  canObserveMcp,
  canRegisterMcp,
  canConnectMcp,
  canDisconnectMcp,
  canRemoveMcp,
  instructions: selectedInstructions,
  instructionObservation: currentInstructionObservation,
  canObserveInstructions,
  canApplyInstructions,
  canRemoveInstructions,
  canSaveConfigurationDraft: (kind: ConfigurationDraftKind) => (s: State) =>
    canSaveConfigurationDraft(s, kind),
  recovery: (s: State) => s.recovery,
  globalMutationDisabled,
  workspaceMutationDisabled: (s: State) => resourceMutationDisabled(s),
  executionAvailable: (s: State) =>
    Boolean(
      s.connection === "connected" &&
        s.snapshot &&
        s.snapshot.state === "connected" &&
        s.snapshot.runtimeEpoch === s.epoch &&
        s.snapshot.revision >= s.revision &&
        s.snapshot.selectedWorkspaceId === s.selection.workspaceId &&
        s.snapshot.selectedSessionId === s.selection.sessionId &&
        !resourceMutationDisabled(s, s.selection.workspaceId),
    ),
  mutationDisabled: (s: State) =>
    resourceMutationDisabled(s, s.selection.workspaceId),
  selection: (s: State) => s.selection,
  lists: (s: State) => s.lists,
  snapshot: (s: State) => s.snapshot,
  catalog: (s: State) => s.catalog,
  configurationNotice: (s: State) => s.configurationNotice,
  configurationDraft: (kind: ConfigurationDraftKind) => (s: State) => {
    const workspace = s.lists.workspaces.find(
      (w) => w.id === s.selection.workspaceId,
    );
    return workspace
      ? (s.configurationDrafts[
          configurationDraftKey(workspace.id, workspace.path, kind)
        ] ?? emptyConfigurationDraft)
      : emptyConfigurationDraft;
  },
  files: (s: State) => s.files,
  layout: (s: State) => s.layout,
  draft: (s: State) =>
    s.drafts[selectionKey(s.selection.workspaceId, s.selection.sessionId)] ??
    emptyDraft,
  pending: (s: State) =>
    Object.values(s.operations).some((i) => i.status === "pending"),
  unknown: (s: State) =>
    Object.values(s.operations).some(
      (i) =>
        ((i.hostHeld || (i.lookupOnly && i.status === "unknown")) &&
          (!i.operation.workspaceId ||
            i.operation.workspaceId === s.selection.workspaceId)) ||
        (i.key ===
          selectionKey(s.selection.workspaceId, s.selection.sessionId) &&
          i.status === "unknown"),
    ),
};
