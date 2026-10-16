import {
  validatePermissionPolicyObservation,
  type WorkbenchPermissionPolicyObservation,
} from "../../../shared/api/index.js";
import {
  validContextList,
  validateContextObservation,
  validateInboxObservation,
  contextModelSupports,
  validInboxCancelResult,
  validHistoricalContext,
  type ContextDescriptor,
  type ContextPreview,
  type ContextSelection,
  type InboxObservation,
} from "../../../shared/api/index.js";
import {
  validRuntimeText,
  validAssistantRuntime,
  validSessionSelection,
  validModelOptions,
  type SessionSelection,
} from "../../../shared/api/index.js";
import {
  GIT_BRANCH_RESTORE_TARGET_FIELDS,
  validateGitBranchRestoreRequest,
  gitBranchRestoreTargetFromApply,
  validateGitBranchRestorePreview,
  validateGitBranchRestoreReceiptResult,
  type GitBranchRestoreAction,
  type GitBranchRestoreSource,
  type GitBranchApplyRequest,
  type GitRestoreApplyRequest,
  type GitBranchRestoreBackup,
  type WorkbenchGitBranchRestorePreview,
} from "../../../shared/api/index.js";
import {
  GIT_COMMIT_TARGET_FIELDS,
  validGitCommitAuthor,
  validGitCommitMessage,
  canonicalGitCommitMessage,
  gitCommitTargetFromApply,
  validateGitCommitPreview,
  validateGitCommitReceiptResult,
  type GitCommitApplyRequest,
  type GitCommitBackup,
  type WorkbenchGitCommitPreview,
} from "../../../shared/api/index.js";
import {
  validGitIndexPaths,
  validateGitIndexPreview,
  validateGitIndexReceiptResult,
  gitIndexTargetFromApply,
  type GitIndexAction,
  type GitIndexApplyRequest,
  type WorkbenchGitIndexPreview,
} from "../../../shared/api/index.js";
import {
  formatLineFeedback,
  appendLineFeedback as appendFeedbackText,
  LINE_FEEDBACK_LIMITS,
  type LineFeedbackSource,
  type LineFeedbackSelection,
  type LineFeedback,
} from "../../../shared/api/index.js";
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

import {
  validateGitReviewObservation,
  validateGitDiffObservation,
  validGitBranch,
  type GitDiffMode,
  type WorkbenchGitReview,
  type WorkbenchGitDiff,
} from "../../../shared/git-review/index.js";

export type GitReviewIdentity = Readonly<{
  epoch: string;
  workspaceId: string;
  workspacePath: string;
  trusted: boolean;
  trustRevision: number;
  floor: number;
  generation: number;
}>;
export type GitDiffIdentity = GitReviewIdentity &
  Readonly<{
    detailGeneration: number;
    observationId: string;
    mode: GitDiffMode;
    path: string;
    baseRef: string;
  }>;
export type GitReview = {
  generation: number;
  detailGeneration: number;
  mode: GitDiffMode;
  path: string;
  baseRef: string;
  request?: GitReviewIdentity | undefined;
  observationIdentity?: GitReviewIdentity | undefined;
  observation?: WorkbenchGitReview | undefined;
  error?: string | undefined;
  retryReady: boolean;
  detailRequest?: GitDiffIdentity | undefined;
  detailIdentity?: GitDiffIdentity | undefined;
  detail?: WorkbenchGitDiff | undefined;
  detailError?: string | undefined;
  detailRetryReady: boolean;
};
const initialGitReview = (): GitReview => ({
  generation: 0,
  detailGeneration: 0,
  mode: "unstaged",
  path: "",
  baseRef: "",
  retryReady: true,
  detailRetryReady: true,
});
const gitWorkspace = (s: State) =>
  s.lists.workspaces.find((w) => w.id === s.selection.workspaceId);
export function gitReviewHeld(s: State): boolean {
  return (
    globalMutationDisabled(s) ||
    Boolean(
      s.recovery?.resources.some(
        (r) => r.workspaceId === s.selection.workspaceId,
      ),
    ) ||
    s.configurationIO.saves > 0 ||
    Object.values(s.gitIndexIO).includes(s.selection.workspaceId ?? "") ||
    Object.values(s.gitBranchRestoreIO).includes(
      s.selection.workspaceId ?? "",
    ) ||
    Object.values(s.gitCommitIO).includes(s.selection.workspaceId ?? "") ||
    Object.values(s.operations).some(
      (i) =>
        (![
          "git.index.apply",
          "git.commit.apply",
          "git.branch.apply",
          "git.restore.apply",
        ].includes(i.operation.type) ||
          !i.operation.workspaceId ||
          i.operation.workspaceId === s.selection.workspaceId) &&
        (i.hostHeld || i.status === "pending" || unknownOperationHeld(i)),
    )
  );
}
function gitTargetReady(s: State): boolean {
  const w = gitWorkspace(s),
    snapshot = s.snapshot;
  return Boolean(
    w &&
      s.epoch &&
      s.connection === "connected" &&
      snapshot?.runtimeEpoch === s.epoch &&
      snapshot.state === "connected" &&
      snapshot.revision >= s.revision &&
      snapshot.selectedWorkspaceId === w.id &&
      !gitReviewHeld(s),
  );
}
export function currentGitReviewScope(s: State, i: GitReviewIdentity): boolean {
  const w = gitWorkspace(s);
  return Boolean(
    w &&
      s.epoch === i.epoch &&
      w.id === i.workspaceId &&
      w.path === i.workspacePath &&
      w.trusted === i.trusted &&
      w.trustRevision === i.trustRevision &&
      s.revision === i.floor &&
      s.gitReview.generation === i.generation,
  );
}
export function currentGitReviewObservation(
  s: State,
): WorkbenchGitReview | undefined {
  const g = s.gitReview;
  return !g.request &&
    !g.error &&
    g.observationIdentity &&
    currentGitReviewScope(s, g.observationIdentity) &&
    gitTargetReady(s)
    ? g.observation
    : undefined;
}
export function currentGitDiffScope(s: State, i: GitDiffIdentity): boolean {
  const g = s.gitReview,
    observation = currentGitReviewObservation(s);
  return (
    currentGitReviewScope(s, i) &&
    observation?.status === "available" &&
    observation.observationId === i.observationId &&
    g.detailGeneration === i.detailGeneration &&
    g.mode === i.mode &&
    g.path === i.path &&
    g.baseRef === i.baseRef
  );
}
export function currentGitDiffObservation(
  s: State,
): WorkbenchGitDiff | undefined {
  const g = s.gitReview;
  return !g.detailRequest &&
    !g.detailError &&
    g.detailIdentity &&
    currentGitDiffScope(s, g.detailIdentity)
    ? g.detail
    : undefined;
}
export function canObserveGitReview(s: State): boolean {
  return (
    gitTargetReady(s) &&
    !s.gitReview.request &&
    !s.gitReview.detailRequest &&
    !s.gitIndex.request &&
    !s.gitCommit.request &&
    !s.gitBranchRestore.request &&
    s.gitReview.retryReady &&
    s.configurationIO.reads === 0 &&
    !s.files.busy
  );
}
export function canReadGitDiff(s: State): boolean {
  const g = s.gitReview,
    observation = currentGitReviewObservation(s);
  return (
    canObserveGitReview(s) &&
    g.detailRetryReady &&
    observation?.status === "available" &&
    observation.files.some((f) => f.path === g.path) &&
    (g.mode !== "base" ||
      observation.branches.some((b) => b.name === g.baseRef))
  );
}
function retireGitDetail(g: GitReview, keepLast = false): GitReview {
  return {
    ...g,
    detailGeneration: g.detailGeneration + 1,
    detailRequest: undefined,
    detailIdentity: undefined,
    detail: keepLast ? g.detail : undefined,
    detailError: undefined,
    detailRetryReady: true,
  };
}
function gitObservationMatches(
  s: State,
  i: GitReviewIdentity,
  v: WorkbenchGitReview | WorkbenchGitDiff,
): boolean {
  return (
    currentGitReviewScope(s, i) &&
    gitTargetReady(s) &&
    v.runtimeEpoch === i.epoch &&
    v.workspaceId === i.workspaceId &&
    v.workspacePath === i.workspacePath &&
    v.revision >= i.floor
  );
}

export type GitIndexIdentity = GitReviewIdentity &
  Readonly<{
    selectionGeneration: number;
    indexGeneration: number;
    review: Extract<WorkbenchGitReview, { status: "available" }>;
    action: GitIndexAction;
    paths: string[];
  }>;
export type GitIndexMutationIdentity = GitIndexIdentity &
  Readonly<{
    operationId: string;
    request: GitIndexApplyRequest;
    preview: Extract<WorkbenchGitIndexPreview, { status: "available" }>;
    digest: string;
    backupId: string | null;
  }>;
export type GitIndex = {
  generation: number;
  paths: string[];
  action: GitIndexAction;
  selectionIdentity?:
    | (GitReviewIdentity & { selectionGeneration: number })
    | undefined;
  request?: GitIndexIdentity | undefined;
  previewIdentity?: GitIndexIdentity | undefined;
  preview?: WorkbenchGitIndexPreview | undefined;
  error?: string | undefined;
  mutation?: {
    identity: GitIndexMutationIdentity;
    status: "pending" | "unknown" | "applied" | "denied";
    code?: string | undefined;
  };
};
function gitIndexReadReady(s: State): boolean {
  return Boolean(
    gitTargetReady(s) &&
      mcpTargetReady(s) &&
      !resourceMutationDisabled(s, s.selection.workspaceId),
  );
}
export function canSelectGitIndexPaths(s: State): boolean {
  return (
    gitIndexReadReady(s) &&
    currentGitReviewObservation(s)?.status === "available"
  );
}
export function currentGitIndexScope(s: State, i: GitIndexIdentity): boolean {
  return (
    currentGitReviewScope(s, i) &&
    s.selection.generation === i.selectionGeneration &&
    s.gitIndex.generation === i.indexGeneration &&
    s.gitIndex.action === i.action &&
    JSON.stringify(s.gitIndex.paths) === JSON.stringify(i.paths) &&
    currentGitReviewObservation(s) === i.review &&
    gitIndexReadReady(s)
  );
}
export function canPreviewGitIndex(s: State): boolean {
  return (
    canSelectGitIndexPaths(s) &&
    validGitIndexPaths(s.gitIndex.paths) &&
    !s.gitIndex.request &&
    !s.gitCommit.request &&
    !s.gitBranchRestore.request &&
    !s.gitReview.request &&
    !s.gitReview.detailRequest &&
    s.configurationIO.reads === 0 &&
    !s.files.busy
  );
}
export function currentGitIndexPreview(
  s: State,
): WorkbenchGitIndexPreview | undefined {
  const g = s.gitIndex;
  return !g.request &&
    !g.error &&
    g.previewIdentity &&
    currentGitIndexScope(s, g.previewIdentity)
    ? g.preview
    : undefined;
}
export function canApplyGitIndex(s: State): boolean {
  return (
    canPreviewGitIndex(s) &&
    currentGitIndexPreview(s)?.status === "available" &&
    Object.keys(s.operations).length < 2048
  );
}
function withoutGitIndexCall(s: State, key: string): State {
  const operations = { ...s.operations },
    gitIndexIO = { ...s.gitIndexIO };
  delete operations[key];
  delete gitIndexIO[key];
  return { ...s, operations, gitIndexIO };
}
// Keep original preview evidence during admission; never grant public authority
// while pending. Actual bridge admission checks a view excluding only itself.
function gitIndexAdmissionView(s: State): State {
  let view = s;
  for (const [key, intent] of Object.entries(s.operations))
    if (intent.gitIndexMutation && intent.status === "pending")
      view = withoutGitIndexCall(view, key);
  return view;
}
function gitIndexRequestMatches(i: GitIndexMutationIdentity): boolean {
  try {
    const r = i.request,
      p = i.preview;
    return (
      r.workspaceId === i.workspaceId &&
      r.requestId === i.operationId &&
      r.previewId === p.previewId &&
      p.revision === i.floor &&
      r.action === p.action &&
      JSON.stringify(r.paths) === JSON.stringify(p.paths) &&
      r.headOid === p.headOid &&
      r.indexExists === p.indexExists &&
      r.indexDigest === p.indexDigest &&
      r.nextIndexDigest === p.nextIndexDigest &&
      r.objectFormat === p.objectFormat &&
      r.previewDigest === p.previewDigest &&
      Boolean(gitIndexTargetFromApply(r))
    );
  } catch {
    return false;
  }
}
function gitIndexLookupOnly(intent: Intent): Intent {
  return {
    ...intent,
    lookupOnly: true,
    operation: {
      type: intent.operation.type,
      ...(intent.operation.workspaceId
        ? { workspaceId: intent.operation.workspaceId }
        : {}),
    },
  };
}
export function gitIndexDispatchReady(
  s: State,
  i: GitIndexMutationIdentity,
): boolean {
  const key = operationKey(i.epoch, i.operationId),
    intent = s.operations[key];
  const view = withoutGitIndexCall(s, key);
  return Boolean(
    intent?.status === "pending" &&
      intent.gitIndexMutation === i &&
      canApplyGitIndex(view) &&
      currentGitIndexScope(view, i) &&
      view.gitIndex.preview === i.preview &&
      view.gitIndex.mutation?.identity === i &&
      i.request.requestId === i.operationId &&
      gitIndexRequestMatches(i),
  );
}
function gitIndexMutationState(
  s: State,
  intent: Intent,
  status: "pending" | "unknown" | "applied" | "denied",
  code?: string,
): State {
  if (
    !intent.gitIndexMutation ||
    s.gitIndex.mutation?.identity !== intent.gitIndexMutation
  )
    return s;
  return {
    ...s,
    gitIndex: {
      ...s.gitIndex,
      mutation: {
        identity: intent.gitIndexMutation,
        status,
        ...(code ? { code } : {}),
      },
    },
  };
}
function validGitIndexReceipt(r: RedactedReceipt, intent: Intent): boolean {
  const i = intent.gitIndexMutation;
  if (
    !closed(
      r,
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
    r.workspaceId !== intent.operation.workspaceId ||
    (i && r.revision < i.floor) ||
    !Array.isArray(r.evidence) ||
    r.evidence.length > 8 ||
    !r.evidence.every(
      (e) =>
        closed(e, ["kind"], ["id"]) &&
        wireId(e.kind, 256) &&
        (e.id === undefined || wireId(e.id, 256)),
    ) ||
    (intent.receipt?.admission === "dispatched" && r.admission !== "dispatched")
  )
    return false;
  if (r.effect === "confirmed") {
    if (
      !i ||
      r.revision <= i.floor ||
      r.admission !== "dispatched" ||
      r.delivery !== "accepted" ||
      !r.evidence.some(
        (e) => e.kind === "host-registry" && e.id === i.workspaceId,
      )
    )
      return false;
    try {
      validateGitIndexReceiptResult(r.result, {
        workspaceId: i.workspaceId,
        target: gitIndexTargetFromApply(i.request),
        digest: i.digest,
        backupId: i.backupId,
      });
      return true;
    } catch {
      return false;
    }
  }
  if (r.effect === "none")
    return (
      r.admission === "rejected" &&
      r.delivery === "pending" &&
      !r.evidence.length &&
      closed(r.result, ["kind", "code"]) &&
      r.result?.kind === "rejected" &&
      wireId(r.result.code, 256)
    );
  return (
    r.admission !== "rejected" &&
    ["pending", "unknown"].includes(r.effect) &&
    r.result === undefined
  );
}

export type GitCommitDraft = {
  epoch: string;
  workspaceId: string;
  workspacePath: string;
  name: string;
  email: string;
  message: string;
  revision: number;
};
const emptyCommitFields = Object.freeze({
  name: "",
  email: "",
  message: "",
  revision: 0,
});
export function currentGitCommitDraftKey(s: State): string | undefined {
  const w = gitWorkspace(s);
  return s.epoch && w ? JSON.stringify([s.epoch, w.id, w.path]) : undefined;
}
export function selectedGitCommitDraftKey(s: State): string | undefined {
  return s.gitCommit.draftKey ?? currentGitCommitDraftKey(s);
}
export function selectedGitCommitDraft(
  s: State,
): Readonly<Pick<GitCommitDraft, "name" | "email" | "message" | "revision">> {
  const key = selectedGitCommitDraftKey(s);
  return (key && s.gitCommitDrafts[key]) || emptyCommitFields;
}
export type GitCommitIdentity = GitReviewIdentity &
  Readonly<{
    selectionGeneration: number;
    commitGeneration: number;
    review: Extract<WorkbenchGitReview, { status: "available" }>;
    draftKey: string;
    draft: GitCommitDraft;
  }>;
export type GitCommitMutationIdentity = GitCommitIdentity &
  Readonly<{
    operationId: string;
    request: GitCommitApplyRequest;
    preview: Extract<WorkbenchGitCommitPreview, { status: "available" }>;
    digest: string;
    backups: GitCommitBackup[];
  }>;
export type GitCommit = {
  generation: number;
  draftKey?: string | undefined;
  request?: GitCommitIdentity | undefined;
  previewIdentity?: GitCommitIdentity | undefined;
  preview?: WorkbenchGitCommitPreview | undefined;
  error?: string | undefined;
  mutation?: {
    identity: GitCommitMutationIdentity;
    status: "pending" | "unknown" | "committed" | "denied";
    code?: string | undefined;
  };
};
export function currentGitCommitScope(s: State, i: GitCommitIdentity): boolean {
  return (
    currentGitReviewScope(s, i) &&
    s.selection.generation === i.selectionGeneration &&
    s.gitCommit.generation === i.commitGeneration &&
    currentGitCommitDraftKey(s) === i.draftKey &&
    selectedGitCommitDraftKey(s) === i.draftKey &&
    s.gitCommitDrafts[i.draftKey] === i.draft &&
    currentGitReviewObservation(s) === i.review &&
    gitIndexReadReady(s)
  );
}
export function gitCommitDisabledReason(s: State): string | undefined {
  if (selectedGitCommitDraftKey(s) !== currentGitCommitDraftKey(s))
    return "HISTORICAL";
  if (!gitWorkspace(s)) return "NO_WORKSPACE";
  if (!gitWorkspace(s)?.trusted) return "UNTRUSTED";
  if (gitReviewHeld(s) || resourceMutationDisabled(s, s.selection.workspaceId))
    return "HELD";
  if (!gitIndexReadReady(s)) return "NOT_READY";
  if (currentGitReviewObservation(s)?.status !== "available")
    return "READ_REQUIRED";
  const d = selectedGitCommitDraft(s);
  if (!validGitCommitAuthor({ name: d.name, email: d.email }))
    return "AUTHOR_REQUIRED";
  if (!validGitCommitMessage(d.message)) return "MESSAGE_REQUIRED";
  if (
    s.gitCommit.request ||
    s.gitBranchRestore.request ||
    s.gitIndex.request ||
    s.gitReview.request ||
    s.gitReview.detailRequest ||
    s.configurationIO.reads > 0 ||
    s.files.busy
  )
    return "READ_BUSY";
  return undefined;
}
export const canPreviewGitCommit = (s: State): boolean =>
  !gitCommitDisabledReason(s);
export function currentGitCommitPreview(
  s: State,
): WorkbenchGitCommitPreview | undefined {
  const g = s.gitCommit;
  return !g.request &&
    !g.error &&
    g.previewIdentity &&
    currentGitCommitScope(s, g.previewIdentity)
    ? g.preview
    : undefined;
}
export const canApplyGitCommit = (s: State): boolean =>
  canPreviewGitCommit(s) &&
  currentGitCommitPreview(s)?.status === "available" &&
  Object.keys(s.operations).length < 2048;
function withoutGitCommitCall(s: State, key: string): State {
  const operations = { ...s.operations },
    gitCommitIO = { ...s.gitCommitIO };
  delete operations[key];
  delete gitCommitIO[key];
  return { ...s, operations, gitCommitIO };
}
function gitCommitAdmissionView(s: State): State {
  let view = s;
  for (const [key, intent] of Object.entries(s.operations))
    if (intent.gitCommitMutation && intent.status === "pending")
      view = withoutGitCommitCall(view, key);
  return view;
}
function gitCommitRequestMatches(i: GitCommitMutationIdentity): boolean {
  try {
    return (
      i.request.workspaceId === i.workspaceId &&
      i.request.requestId === i.operationId &&
      i.request.previewId === i.preview.previewId &&
      i.preview.revision === i.floor &&
      JSON.stringify(gitCommitTargetFromApply(i.request)) ===
        JSON.stringify(
          Object.fromEntries(
            GIT_COMMIT_TARGET_FIELDS.map((k) => [k, i.preview[k]]),
          ),
        )
    );
  } catch {
    return false;
  }
}
export function gitCommitDispatchReady(
  s: State,
  i: GitCommitMutationIdentity,
): boolean {
  const key = operationKey(i.epoch, i.operationId),
    intent = s.operations[key],
    view = withoutGitCommitCall(s, key);
  return Boolean(
    intent?.status === "pending" &&
      intent.gitCommitMutation === i &&
      canApplyGitCommit(view) &&
      currentGitCommitScope(view, i) &&
      view.gitCommit.preview === i.preview &&
      view.gitCommit.mutation?.identity === i &&
      gitCommitRequestMatches(i),
  );
}
function gitCommitMutationState(
  s: State,
  intent: Intent,
  status: "pending" | "unknown" | "committed" | "denied",
  code?: string,
): State {
  if (
    !intent.gitCommitMutation ||
    s.gitCommit.mutation?.identity !== intent.gitCommitMutation
  )
    return s;
  return {
    ...s,
    gitCommit: {
      ...s.gitCommit,
      mutation: {
        identity: intent.gitCommitMutation,
        status,
        ...(code ? { code } : {}),
      },
    },
  };
}
function validGitCommitReceipt(r: RedactedReceipt, intent: Intent): boolean {
  const i = intent.gitCommitMutation;
  if (
    !closed(
      r,
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
    r.workspaceId !== intent.operation.workspaceId ||
    (i && r.revision < i.floor) ||
    !Array.isArray(r.evidence) ||
    r.evidence.length > 8 ||
    !r.evidence.every(
      (e) =>
        closed(e, ["kind"], ["id"]) &&
        wireId(e.kind, 256) &&
        (e.id === undefined || wireId(e.id, 256)),
    ) ||
    (intent.receipt?.admission === "dispatched" && r.admission !== "dispatched")
  )
    return false;
  if (r.effect === "confirmed") {
    if (
      !i ||
      r.revision <= i.floor ||
      r.admission !== "dispatched" ||
      r.delivery !== "accepted" ||
      !r.evidence.some(
        (e) => e.kind === "host-registry" && e.id === i.workspaceId,
      )
    )
      return false;
    try {
      validateGitCommitReceiptResult(r.result, {
        workspaceId: i.workspaceId,
        target: gitCommitTargetFromApply(i.request),
        digest: i.digest,
        backups: i.backups,
      });
      return true;
    } catch {
      return false;
    }
  }
  if (r.effect === "none")
    return (
      r.admission === "rejected" &&
      r.delivery === "pending" &&
      !r.evidence.length &&
      closed(r.result, ["kind", "code"]) &&
      r.result?.kind === "rejected" &&
      wireId(r.result.code, 256)
    );
  return (
    r.admission !== "rejected" &&
    ["pending", "unknown"].includes(r.effect) &&
    r.result === undefined
  );
}

function immutableBranchRestore<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(immutableBranchRestore);
    Object.freeze(value);
  }
  return value;
}
export function gitRestoreDraftPaths(paths: readonly string[]): string[] {
  const encoder = new TextEncoder();
  return [...new Set(paths)].sort((a, b) => {
    const left = encoder.encode(a),
      right = encoder.encode(b);
    for (let n = 0; n < Math.min(left.length, right.length); n++) {
      if (left[n] !== right[n]) return left[n]! - right[n]!;
    }
    return left.length - right.length;
  });
}
export type GitBranchRestoreDraft = {
  epoch: string;
  workspaceId: string;
  workspacePath: string;
  name: string;
  email: string;
  action: GitBranchRestoreAction;
  branch: string;
  source: GitBranchRestoreSource | "";
  paths: string[];
  revision: number;
};
const emptyBranchRestoreFields = Object.freeze({
  name: "",
  email: "",
  action: "create" as const,
  branch: "",
  source: "" as const,
  paths: [] as string[],
  revision: 0,
});
export function currentGitBranchRestoreDraftKey(s: State): string | undefined {
  const w = gitWorkspace(s);
  return s.epoch && w ? JSON.stringify([s.epoch, w.id, w.path]) : undefined;
}
export function selectedGitBranchRestoreDraftKey(s: State): string | undefined {
  return s.gitBranchRestore.draftKey ?? currentGitBranchRestoreDraftKey(s);
}
export function selectedGitBranchRestoreDraft(
  s: State,
): Readonly<
  Pick<
    GitBranchRestoreDraft,
    "name" | "email" | "action" | "branch" | "source" | "paths" | "revision"
  >
> {
  const key = selectedGitBranchRestoreDraftKey(s);
  return (key && s.gitBranchRestoreDrafts[key]) || emptyBranchRestoreFields;
}
export type GitBranchRestoreIdentity = GitReviewIdentity &
  Readonly<{
    selectionGeneration: number;
    branchRestoreGeneration: number;
    review: Extract<WorkbenchGitReview, { status: "available" }>;
    draftKey: string;
    draft: GitBranchRestoreDraft;
  }>;
export type GitBranchRestoreMutationIdentity = GitBranchRestoreIdentity &
  Readonly<{
    operationId: string;
    request: GitBranchApplyRequest | GitRestoreApplyRequest;
    preview: Extract<WorkbenchGitBranchRestorePreview, { status: "available" }>;
    digest: string;
    backups: GitBranchRestoreBackup[];
  }>;
export type GitBranchRestore = {
  generation: number;
  draftKey?: string | undefined;
  request?: GitBranchRestoreIdentity | undefined;
  previewIdentity?: GitBranchRestoreIdentity | undefined;
  preview?: WorkbenchGitBranchRestorePreview | undefined;
  previewPaths?: readonly string[];
  error?: string | undefined;
  mutation?: {
    identity: GitBranchRestoreMutationIdentity;
    status: "pending" | "unknown" | "applied" | "denied";
    code?: string | undefined;
  };
};
export function currentGitBranchRestoreScope(
  s: State,
  i: GitBranchRestoreIdentity,
): boolean {
  return (
    currentGitReviewScope(s, i) &&
    s.selection.generation === i.selectionGeneration &&
    s.gitBranchRestore.generation === i.branchRestoreGeneration &&
    currentGitBranchRestoreDraftKey(s) === i.draftKey &&
    selectedGitBranchRestoreDraftKey(s) === i.draftKey &&
    s.gitBranchRestoreDrafts[i.draftKey] === i.draft &&
    currentGitReviewObservation(s) === i.review &&
    gitIndexReadReady(s)
  );
}
export function gitBranchRestoreDisabledReason(s: State): string | undefined {
  if (
    selectedGitBranchRestoreDraftKey(s) !== currentGitBranchRestoreDraftKey(s)
  )
    return "HISTORICAL";
  if (!gitWorkspace(s)) return "NO_WORKSPACE";
  if (!gitWorkspace(s)?.trusted) return "UNTRUSTED";
  if (gitReviewHeld(s) || resourceMutationDisabled(s, s.selection.workspaceId))
    return "HELD";
  if (!gitIndexReadReady(s)) return "NOT_READY";
  if (currentGitReviewObservation(s)?.status !== "available")
    return "READ_REQUIRED";
  const d = selectedGitBranchRestoreDraft(s);
  try {
    const review = currentGitReviewObservation(s) as Extract<
      WorkbenchGitReview,
      { status: "available" }
    >;
    validateGitBranchRestoreRequest(
      d.action === "restore"
        ? {
            type: "git.restore.preview.read",
            workspaceId: s.selection.workspaceId,
            observationId: review.observationId,
            source: d.source,
            paths: gitRestoreDraftPaths(d.paths),
          }
        : {
            type: "git.branch.preview.read",
            workspaceId: s.selection.workspaceId,
            observationId: review.observationId,
            action: d.action,
            branch: d.branch,
            author: { name: d.name, email: d.email },
          },
    );
    if (
      d.action === "select" &&
      !review.branches.some((b) => `refs/heads/${b.name}` === d.branch)
    )
      return "BRANCH_REQUIRED";
  } catch {
    return d.action === "restore"
      ? "SOURCE_PATHS_REQUIRED"
      : "BRANCH_AUTHOR_REQUIRED";
  }
  if (
    s.gitBranchRestore.request ||
    s.gitCommit.request ||
    s.gitIndex.request ||
    s.gitReview.request ||
    s.gitReview.detailRequest ||
    s.configurationIO.reads > 0 ||
    s.files.busy
  )
    return "READ_BUSY";
  return undefined;
}
export const canPreviewGitBranchRestore = (s: State): boolean =>
  !gitBranchRestoreDisabledReason(s);
export function currentGitBranchRestorePreview(
  s: State,
): WorkbenchGitBranchRestorePreview | undefined {
  const g = s.gitBranchRestore;
  return !g.request &&
    !g.error &&
    g.previewIdentity &&
    currentGitBranchRestoreScope(s, g.previewIdentity)
    ? g.preview
    : undefined;
}
export const canApplyGitBranchRestore = (s: State): boolean =>
  canPreviewGitBranchRestore(s) &&
  currentGitBranchRestorePreview(s)?.status === "available" &&
  Object.keys(s.operations).length < 2048;
function withoutGitBranchRestoreCall(s: State, key: string): State {
  const operations = { ...s.operations },
    gitBranchRestoreIO = { ...s.gitBranchRestoreIO };
  delete operations[key];
  delete gitBranchRestoreIO[key];
  return { ...s, operations, gitBranchRestoreIO };
}
function gitBranchRestoreAdmissionView(s: State): State {
  let view = s;
  for (const [key, intent] of Object.entries(s.operations))
    if (intent.gitBranchRestoreMutation && intent.status === "pending")
      view = withoutGitBranchRestoreCall(view, key);
  return view;
}
function gitBranchRestoreRequestMatches(
  i: GitBranchRestoreMutationIdentity,
): boolean {
  try {
    return (
      i.request.workspaceId === i.workspaceId &&
      i.request.requestId === i.operationId &&
      i.request.previewId === i.preview.previewId &&
      i.preview.revision === i.floor &&
      JSON.stringify(gitBranchRestoreTargetFromApply(i.request)) ===
        JSON.stringify(
          Object.fromEntries(
            GIT_BRANCH_RESTORE_TARGET_FIELDS.map((k) => [k, i.preview[k]]),
          ),
        )
    );
  } catch {
    return false;
  }
}
export function gitBranchRestoreDispatchReady(
  s: State,
  i: GitBranchRestoreMutationIdentity,
): boolean {
  const key = operationKey(i.epoch, i.operationId),
    intent = s.operations[key],
    view = withoutGitBranchRestoreCall(s, key);
  return Boolean(
    intent?.status === "pending" &&
      intent.gitBranchRestoreMutation === i &&
      canApplyGitBranchRestore(view) &&
      currentGitBranchRestoreScope(view, i) &&
      view.gitBranchRestore.preview === i.preview &&
      view.gitBranchRestore.mutation?.identity === i &&
      gitBranchRestoreRequestMatches(i),
  );
}
function gitBranchRestoreMutationState(
  s: State,
  intent: Intent,
  status: "pending" | "unknown" | "applied" | "denied",
  code?: string,
): State {
  if (
    !intent.gitBranchRestoreMutation ||
    s.gitBranchRestore.mutation?.identity !== intent.gitBranchRestoreMutation
  )
    return s;
  return {
    ...s,
    gitBranchRestore: {
      ...s.gitBranchRestore,
      mutation: {
        identity: intent.gitBranchRestoreMutation,
        status,
        ...(code ? { code } : {}),
      },
    },
  };
}
function validGitBranchRestoreReceipt(
  r: RedactedReceipt,
  intent: Intent,
): boolean {
  const i = intent.gitBranchRestoreMutation;
  if (
    !closed(
      r,
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
    r.workspaceId !== intent.operation.workspaceId ||
    (i && r.revision < i.floor) ||
    !Array.isArray(r.evidence) ||
    r.evidence.length > 8 ||
    !r.evidence.every(
      (e) =>
        closed(e, ["kind"], ["id"]) &&
        wireId(e.kind, 256) &&
        (e.id === undefined || wireId(e.id, 256)),
    ) ||
    (intent.receipt?.admission === "dispatched" && r.admission !== "dispatched")
  )
    return false;
  if (r.effect === "confirmed") {
    if (
      !i ||
      r.revision <= i.floor ||
      r.admission !== "dispatched" ||
      r.delivery !== "accepted" ||
      !r.evidence.some(
        (e) => e.kind === "host-registry" && e.id === i.workspaceId,
      )
    )
      return false;
    try {
      validateGitBranchRestoreReceiptResult(r.result, {
        workspaceId: i.workspaceId,
        target: gitBranchRestoreTargetFromApply(i.request),
        digest: i.digest,
        backups: i.backups,
      });
      return true;
    } catch {
      return false;
    }
  }
  if (r.effect === "none")
    return (
      r.admission === "rejected" &&
      r.delivery === "pending" &&
      !r.evidence.length &&
      closed(r.result, ["kind", "code"]) &&
      r.result?.kind === "rejected" &&
      wireId(r.result.code, 256)
    );
  return (
    r.admission !== "rejected" &&
    ["pending", "unknown"].includes(r.effect) &&
    r.result === undefined
  );
}

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

// A retained reference is historical context. Only its original source object
// and complete captured scope can authorize an explicit current append.
export type LineFeedbackDraft = {
  id: string;
  source: LineFeedbackSource;
  scope: Scope;
  root: string;
  trusted: boolean;
  sourceGeneration: number;
  detailGeneration: number;
  selection: LineFeedbackSelection;
  comment: string;
};
export type LineFeedbackEdit = Partial<LineFeedbackSelection> & {
  comment?: string;
};
export type LineFeedbackState = {
  active?: string | undefined;
  sequence: number;
  drafts: Record<string, LineFeedbackDraft>;
  notice: string;
};
const LINE_FEEDBACK_CACHE_LIMIT = 16;
// Only local feedback validation uses this view. A known pending Send in the
// selected session does not invalidate already-read context. Keep real operations
// intact so read/mutation predicates still block IO, unknown and retained holds.
function lineFeedbackObservationState(s: State): State {
  const operations = Object.fromEntries(
    Object.entries(s.operations).filter(
      ([, i]) =>
        !(
          i.status === "pending" &&
          !i.hostHeld &&
          !i.lookupOnly &&
          i.epoch === s.epoch &&
          i.operation.type === "message.send" &&
          i.operation.workspaceId === s.selection.workspaceId &&
          i.operation.sessionId === s.selection.sessionId
        ),
    ),
  );
  return { ...s, operations };
}
export function currentLineFeedbackSource(
  s: State,
  kind: "file" | "git",
): LineFeedbackSource | undefined {
  s = lineFeedbackObservationState(s);
  if (kind === "git") {
    const observation = currentGitDiffObservation(s);
    return observation?.status === "available"
      ? { kind, observation }
      : undefined;
  }
  const d = selectedWorkspaceFileDraft(s);
  return canReadWorkspaceFile(s) &&
    d.observation &&
    !d.request &&
    !d.error &&
    currentWorkspaceFileScope(s, d.observation) &&
    d.read?.status === "available"
    ? { kind, observation: d.read }
    : undefined;
}
export function selectedLineFeedbackDraft(
  s: State,
): LineFeedbackDraft | undefined {
  return s.lineFeedback.active
    ? s.lineFeedback.drafts[s.lineFeedback.active]
    : undefined;
}
export function lineFeedbackReason(
  s: State,
  d = selectedLineFeedbackDraft(s),
): string {
  if (!d) return "MISSING_SOURCE";
  const w = gitWorkspace(s);
  if (!w?.trusted) return "UNTRUSTED";
  if (gitReviewHeld(lineFeedbackObservationState(s))) return "HELD";
  if (
    !sameScope(s, d.scope) ||
    w.path !== d.root ||
    w.trusted !== d.trusted ||
    w.trustRevision !== d.scope.trustRevision ||
    s.revision !== d.scope.revision ||
    (d.source.kind === "file" &&
      s.workspaceFile.generation !== d.sourceGeneration) ||
    (d.source.kind === "git" &&
      (s.gitReview.generation !== d.sourceGeneration ||
        s.gitReview.detailGeneration !== d.detailGeneration)) ||
    currentLineFeedbackSource(s, d.source.kind)?.observation !==
      d.source.observation
  )
    return "STALE_SOURCE";
  if (
    !s.selection.sessionId ||
    !s.lists.sessions.some(
      (session) =>
        session.id === s.selection.sessionId && session.workspaceId === w.id,
    ) ||
    s.snapshot?.selectedSessionId !== s.selection.sessionId
  )
    return "MISSING_SESSION";
  const composer = selectors.draft(s);
  if (
    !Number.isSafeInteger(composer.revision) ||
    composer.revision >= Number.MAX_SAFE_INTEGER
  )
    return "DRAFT_TOO_LARGE";
  try {
    const formatted = formatLineFeedback(d.source, d.selection, d.comment);
    appendFeedbackText(composer.text, formatted.text);
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : "INVALID_FEEDBACK_SOURCE";
  }
}
export function lineFeedbackPreview(s: State): LineFeedback | undefined {
  const d = selectedLineFeedbackDraft(s);
  if (!d) return undefined;
  try {
    return formatLineFeedback(
      d.source,
      d.selection,
      d.comment.trim() ? d.comment : "(의견 입력 전)",
    );
  } catch {
    return undefined;
  }
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
  workspacePath?: string | undefined;
  trusted?: boolean | undefined;
  runtimeGeneration?: number;
};
export type Draft = {
  text: string;
  revision: number;
  agent: string;
  model: string;
  variant: string;
  variantCleared: boolean;
};
export const emptyDraft: Draft = Object.freeze({
  text: "",
  revision: 0,
  agent: "",
  model: "",
  variant: "",
  variantCleared: false,
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
  // Only an accepted host snapshot can release unknown authority. Keep this
  // metadata separate from the executable operation and the actual-call lanes.
  authorityHold?: boolean;
  origin: Selection;
  runtimeScope?: Scope;
  key: string;
  submitted?: Omit<Draft, "revision"> & { revision: number | null };
  conversation?: Readonly<{
    scope: Scope;
    digest: string;
    draftRevision: number;
    inboxId?: string;
    branch?: ContextBranch;
  }>;
  navigate: boolean;
  status: "pending" | "unknown" | "accepted" | "failed";
  receipt?: RedactedReceipt;
  mcpMutation?: McpMutationIdentity;
  instructionMutation?: InstructionMutationIdentity;
  skillSave?: SkillSaveIdentity;
  agentSave?: AgentSaveIdentity;
  workspaceFileSave?: WorkspaceFileSaveIdentity;
  gitIndexMutation?: GitIndexMutationIdentity;
  gitBranchRestoreMutation?: GitBranchRestoreMutationIdentity;
  gitCommitMutation?: GitCommitMutationIdentity;
  skillRuntimeMutation?: SkillRuntimeMutationIdentity;
  agentRuntimeMutation?: AgentRuntimeMutationIdentity;
  configurationSave?: NonNullable<ConfigurationDraft["fileSave"]>["identity"];
} & (
  | { lookupOnly?: false; operation: MutationRequest & OperationIdentity }
  | { lookupOnly: true; operation: OperationIdentity }
);
export type PermissionPolicyIdentity = Readonly<{
  epoch: string;
  workspaceId: string;
  sessionId: string;
  workspacePath: string;
  trustRevision: number;
  selectionGeneration: number;
  generation: number;
  floor: number;
}>;
export type PermissionPolicy = {
  generation: number;
  request?: PermissionPolicyIdentity | undefined;
  observationIdentity?: PermissionPolicyIdentity;
  observation?: WorkbenchPermissionPolicyObservation;
  error?:
    | "CANCELLED"
    | "STALE"
    | "POLICY_UNVERIFIED"
    | "READ_TIMEOUT"
    | "READ_BUSY"
    | "UNAVAILABLE"
    | undefined;
};
function permissionPolicyTargetReady(state: State): boolean {
  return instructionTargetReady(state) && !extensionsHeld(state);
}
export function currentPermissionPolicyScope(
  state: State,
  identity: PermissionPolicyIdentity,
): boolean {
  return (
    state.epoch === identity.epoch &&
    state.selection.workspaceId === identity.workspaceId &&
    state.selection.sessionId === identity.sessionId &&
    state.selection.generation === identity.selectionGeneration &&
    state.permissionPolicy.generation === identity.generation &&
    state.revision === identity.floor &&
    state.lists.workspaces.some(
      (w) =>
        w.id === identity.workspaceId &&
        w.path === identity.workspacePath &&
        w.trusted &&
        w.trustRevision === identity.trustRevision,
    )
  );
}
export function currentPermissionPolicyObservation(
  state: State,
): WorkbenchPermissionPolicyObservation | undefined {
  const entry = state.permissionPolicy;
  return !entry.request &&
    !entry.error &&
    entry.observationIdentity &&
    permissionPolicyTargetReady(state) &&
    currentPermissionPolicyScope(state, entry.observationIdentity)
    ? entry.observation
    : undefined;
}
export function canObservePermissionPolicy(state: State): boolean {
  return permissionPolicyTargetReady(state) && !state.permissionPolicy.request;
}
function retirePermissionPolicy(state: State, next: State): State {
  if (state === next) return next;
  const entry = next.permissionPolicy,
    identity = entry.request ?? entry.observationIdentity;
  if (
    !identity ||
    identity.generation !== entry.generation ||
    (currentPermissionPolicyScope(next, identity) &&
      permissionPolicyTargetReady(next))
  )
    return next;
  // Keep one inert historical projection. Returning to an old scope cannot revive it.
  return {
    ...next,
    permissionPolicy: {
      ...entry,
      generation: entry.generation + 1,
      request: undefined,
      error: "STALE",
    },
  };
}
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
export type Panel = "files" | "activity" | "terminal" | "preview" | "plans";
export type ContextDraft = {
  items: readonly ContextDescriptor[];
  verifiedIds: readonly string[];
  revision: number;
  authority?: Scope | undefined;
};
export type ContextReadIdentity = Readonly<{
  scope: Scope;
  token: number;
  path?: string;
  selection?: ContextSelection;
}>;
export type ContextBranch = Readonly<{
  scope: Scope;
  before: string;
  text: string;
  originalText: string;
  historical: boolean;
}>;
export type ConversationContext = {
  generation: number;
  drafts: Record<string, ContextDraft>;
  request?: ContextReadIdentity | undefined;
  preview?:
    | { descriptor: ContextDescriptor; value: ContextPreview; scope: Scope }
    | undefined;
  error: string;
  inboxRequest?: ContextReadIdentity | undefined;
  inbox?: InboxObservation | undefined;
  inboxScope?: Scope | undefined;
  branch?: ContextBranch | undefined;
  notice: string;
};
export const emptyContextDraft: ContextDraft = Object.freeze({
  items: Object.freeze([]),
  verifiedIds: Object.freeze([]),
  revision: 0,
});
export function selectedContextDraft(s: State): ContextDraft {
  return (
    s.conversationContext.drafts[
      selectionKey(s.selection.workspaceId, s.selection.sessionId)
    ] ?? emptyContextDraft
  );
}
// Read authority stays separate from editable descriptors and NEXT choices.
export function contextEffectsReady(s: State): boolean {
  return (
    selectors.executionAvailable(s) &&
    Boolean(scopeOf(s).trusted) &&
    !selectors.pending(s) &&
    !selectors.unknown(s) &&
    !s.files.busy &&
    s.configurationIO.reads === 0 &&
    s.configurationIO.saves === 0 &&
    Object.keys(s.workspaceFileIO).length === 0 &&
    !s.conversationContext.request &&
    !s.conversationContext.inboxRequest &&
    !s.skillFiles.request &&
    !s.agentFiles.request &&
    !s.skillRuntime.request &&
    !s.agentRuntime.request &&
    !Object.values(s.workspaceFileDrafts).some((d) => d.request) &&
    !Object.values(s.configurationDrafts).some((d) => d.fileRequest)
  );
}
export function contextAttachmentsReady(
  s: State,
  descriptors: readonly ContextDescriptor[],
  model?: string,
): boolean {
  if (!validContextList(descriptors)) return false;
  const d = selectedContextDraft(s);
  return (
    !descriptors.length ||
    Boolean(
      validContextList(descriptors) &&
        d.authority &&
        currentRuntimeRequestScope(s, d.authority) &&
        descriptors.every(
          (x) =>
            d.verifiedIds.includes(x.capabilityId) &&
            d.items.some((item) => JSON.stringify(item) === JSON.stringify(x)),
        ) &&
        s.catalog?.models.status === "available" &&
        model &&
        s.catalog.models.entries.some(
          (e) =>
            e.id === model &&
            contextModelSupports(
              {
                variants: e.variants,
                ...(e.capabilities ? { capabilities: e.capabilities } : {}),
              },
              descriptors,
            ),
        ),
    )
  );
}
export function contextRequestReady(
  s: State,
  operation: MutationRequest,
): boolean {
  if (
    !("workspaceId" in operation) ||
    !("sessionId" in operation) ||
    !contextEffectsReady(s) ||
    operation.workspaceId !== s.selection.workspaceId ||
    operation.sessionId !== s.selection.sessionId
  )
    return false;
  const session = s.lists.sessions.find((x) => x.id === s.selection.sessionId);
  if (!session || session.archived) return false;
  if (operation.type === "message.send") {
    if (
      !closed(
        operation,
        ["type", "workspaceId", "sessionId", "requestId", "text"],
        ["agent", "model", "variant", "attachments", "delivery"],
      ) ||
      typeof operation.text !== "string" ||
      !operation.text.trim() ||
      operation.text.length > 32000 ||
      (Object.hasOwn(operation, "attachments") &&
        !validContextList(operation.attachments))
    )
      return false;
    if (Object.hasOwn(operation, "delivery"))
      return (
        ["steer", "queue"].includes(operation.delivery ?? "") &&
        session.status === "running" &&
        !["agent", "model", "variant", "attachments"].some((k) =>
          Object.hasOwn(operation, k),
        )
      );
    return (
      session.status === "idle" &&
      !requestOptionsInvalid(s, operation) &&
      contextAttachmentsReady(s, operation.attachments ?? [], operation.model)
    );
  }
  if (operation.type === "session.fork")
    return (
      closed(
        operation,
        ["type", "workspaceId", "sessionId", "requestId", "before"],
        ["title"],
      ) &&
      session.status === "idle" &&
      Boolean(
        operation.before &&
          s.conversationContext.branch?.before === operation.before &&
          currentRuntimeRequestScope(s, s.conversationContext.branch.scope) &&
          s.snapshot?.messages.some(
            (m) => m.id === operation.before && m.role === "user",
          ),
      )
    );
  if (operation.type === "session.inbox.cancel")
    return Boolean(
      closed(operation, [
        "type",
        "workspaceId",
        "sessionId",
        "requestId",
        "inboxId",
      ]) &&
        s.conversationContext.inboxScope &&
        currentRuntimeRequestScope(s, s.conversationContext.inboxScope) &&
        s.conversationContext.inbox?.entries.some(
          (e) => e.id === operation.inboxId,
        ),
    );
  return false;
}
export type State = {
  conversationContext: ConversationContext;
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
  // Operation type behind `error`, so the UI can show it near where the user acted.
  errorOp?: string | undefined;
  notice: string;
  interruptNotice: {
    operationId: string;
    scope: Scope;
    revision: number;
  } | null;
  catalog: WorkbenchCatalog | null;
  catalogError: string;
  catalogGeneration: number;
  runtimeGeneration: number;
  drafts: Record<string, Draft>;
  configurationDrafts: Record<string, ConfigurationDraft>;
  skillFiles: SkillFiles;
  skillRuntime: SkillRuntime;
  skillDrafts: Record<string, SkillDraft>;
  agentFiles: AgentFiles;
  agentRuntime: AgentRuntime;
  agentDrafts: Record<string, AgentDraft>;
  permissionPolicy: PermissionPolicy;
  extensions: Record<string, Extensions>;
  extensionsGeneration: number;
  mcp: Record<string, Mcp>;
  instructions: Record<string, Instructions>;
  configurationNotice: string;
  configurationIO: { reads: number; saves: number };
  operations: Record<string, Intent>;
  lineFeedback: LineFeedbackState;
  gitReview: GitReview;
  gitIndex: GitIndex;
  gitIndexIO: Record<string, string>;
  gitBranchRestore: GitBranchRestore;
  gitBranchRestoreIO: Record<string, string>;
  gitBranchRestoreDrafts: Record<string, GitBranchRestoreDraft>;
  gitCommit: GitCommit;
  gitCommitIO: Record<string, string>;
  gitCommitDrafts: Record<string, GitCommitDraft>;
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
  runtimeGeneration: state.runtimeGeneration,
  trusted: state.lists.workspaces.find(
    (w) => w.id === state.selection.workspaceId,
  )?.trusted,
  workspacePath: state.lists.workspaces.find(
    (w) => w.id === state.selection.workspaceId,
  )?.path,
  trustRevision: state.lists.workspaces.find(
    (w) => w.id === state.selection.workspaceId,
  )?.trustRevision,
});
const sameScope = (state: State, scope: Scope) =>
  state.epoch === scope.epoch &&
  state.selection.generation === scope.generation &&
  state.selection.workspaceId === scope.workspaceId &&
  state.selection.sessionId === scope.sessionId;
export function currentRuntimeRequestScope(
  state: State,
  scope: Scope,
  floor = true,
): boolean {
  const current = scopeOf(state);
  return (
    sameScope(state, scope) &&
    current.runtimeGeneration === scope.runtimeGeneration &&
    current.workspacePath === scope.workspacePath &&
    current.trustRevision === scope.trustRevision &&
    current.trusted === scope.trusted &&
    (!floor || current.revision === scope.revision)
  );
}
const currentIntent = (state: State, intent: Intent) =>
  sameScope(state, { ...intent.origin, epoch: intent.epoch }) &&
  (!intent.runtimeScope ||
    currentRuntimeRequestScope(state, intent.runtimeScope, false)) &&
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
  "git.branch.apply",
  "git.restore.apply",
  "git.commit.apply",
  "git.index.apply",
  "workspace.import",
  "workspace.create",
  "workspace.remove",
  "session.create",
  "session.rename",
  "session.pin",
  "permission.mode.set",
  "session.archive",
  "session.fork",
  "session.inbox.cancel",
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
      ["selectedWorkspaceId", "selectedSessionId", "sessionSelection", "error"],
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
      !closed(
        w,
        ["id", "name", "path", "kind", "trusted", "trustRevision", "temporary"],
        // Read-only probe metadata the host contract already allows.
        ["branch", "writable"],
      ) ||
      (Object.hasOwn(w, "branch") && typeof w.branch !== "string") ||
      (Object.hasOwn(w, "writable") && typeof w.writable !== "boolean") ||
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
        ["pinned", "archived", "parentSessionId", "permissionMode"],
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
  if (
    Object.hasOwn(next, "sessionSelection") &&
    !(
      validSessionSelection(next.sessionSelection) &&
      next.sessionSelection.sessionId === next.selectedSessionId &&
      next.state === "connected" &&
      recovery.state === "ready" &&
      next.workspaces.some(
        (w) => w.id === next.selectedWorkspaceId && w.trusted,
      ) &&
      next.sessions.some(
        (s) => s.id === next.selectedSessionId && s.status !== "unavailable",
      ) &&
      !next.recovery.resources.some(
        (r) =>
          r.workspaceId === next.selectedWorkspaceId &&
          (!r.sessionId || r.sessionId === next.selectedSessionId),
      )
    )
  )
    return false;
  for (const message of next.messages) {
    if (
      !closed(
        message,
        ["id", "role", "text", "tools"],
        ["runtime", "context"],
      ) ||
      !validRuntimeText(message.id) ||
      !["user", "assistant"].includes(message.role) ||
      typeof message.text !== "string" ||
      message.text.length > 32000 ||
      !Array.isArray(message.tools) ||
      message.tools.length > 40 ||
      (Object.hasOwn(message, "context") &&
        (message.role !== "user" ||
          !validHistoricalContext(message.context))) ||
      (Object.hasOwn(message, "runtime") &&
        (message.role !== "assistant" ||
          !validAssistantRuntime(message.runtime)))
    )
      return false;
    for (const tool of message.tools) {
      if (
        !closed(tool, ["id", "name", "status", "input", "output"]) ||
        !validRuntimeText(tool.id) ||
        typeof tool.name !== "string" ||
        tool.name.length > 128 ||
        !["pending", "running", "completed", "error"].includes(tool.status) ||
        typeof tool.input !== "string" ||
        tool.input.length > 8000 ||
        typeof tool.output !== "string" ||
        tool.output.length > 8000
      )
        return false;
    }
  }
  const retained = new Set<string>();
  for (const k of next.retainedOperations) {
    if (
      !closed(
        k,
        ["runtimeEpoch", "operationId", "type", "authorityHold"],
        ["workspaceId", "sessionId"],
      ) ||
      !wireId(k.runtimeEpoch) ||
      !wireId(k.operationId) ||
      typeof k.authorityHold !== "boolean" ||
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
        k.type === "git.index.apply" ||
        k.type === "git.commit.apply" ||
        k.type === "git.branch.apply" ||
        k.type === "git.restore.apply" ||
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
function validRuntimeCatalog(value: WorkbenchCatalog): boolean {
  const groups = ["commands", "skills", "mcp", "agents", "models"] as const;
  if (!closed(value, [...groups], ["configuration"])) return false;
  for (const name of groups) {
    const group = value[name];
    if (
      !closed(group, ["status", "entries"]) ||
      !["available", "unavailable"].includes(group.status) ||
      !Array.isArray(group.entries) ||
      group.entries.length > 300 ||
      (group.status === "unavailable" && group.entries.length > 0)
    )
      return false;
    const ids = new Set<string>();
    for (const entry of group.entries) {
      if (
        !closed(
          entry,
          ["id", "name", ...(name === "models" ? ["variants"] : [])],
          [
            "description",
            "status",
            "source",
            "path",
            "scope",
            ...(name === "models" ? ["capabilities"] : []),
          ],
        ) ||
        !validRuntimeText(entry.id) ||
        ids.has(entry.id) ||
        typeof entry.name !== "string" ||
        entry.name.length > 256 ||
        (Object.hasOwn(entry, "description") &&
          (typeof entry.description !== "string" ||
            entry.description.length > 1000)) ||
        (Object.hasOwn(entry, "status") && !validRuntimeText(entry.status)) ||
        (Object.hasOwn(entry, "source") && entry.source !== "runtime") ||
        (Object.hasOwn(entry, "path") &&
          (typeof entry.path !== "string" || entry.path.length > 4096)) ||
        (Object.hasOwn(entry, "scope") &&
          !["workspace", "external", "runtime"].includes(entry.scope!))
      )
        return false;
      if (name === "models") {
        const model = entry as WorkbenchCatalog["models"]["entries"][number];
        if (
          !validModelOptions({
            variants: model.variants,
            ...(Object.hasOwn(model, "capabilities")
              ? { capabilities: model.capabilities }
              : {}),
          })
        )
          return false;
      }
      ids.add(entry.id);
    }
  }
  if (Object.hasOwn(value, "configuration")) {
    const configuration = value.configuration!;
    if (
      !closed(
        configuration,
        ["status", "runtimeStatus", "entries"],
        ["reason"],
      ) ||
      !["available", "partial", "unavailable"].includes(configuration.status) ||
      configuration.runtimeStatus !== "not_reported" ||
      !Array.isArray(configuration.entries) ||
      configuration.entries.length > 300 ||
      (Object.hasOwn(configuration, "reason") &&
        ![
          "untrusted_workspace",
          "runtime_unavailable",
          "path_denied",
          "limit_reached",
        ].includes(configuration.reason!))
    )
      return false;
    for (const entry of configuration.entries) {
      if (
        !closed(
          entry,
          ["id", "kind", "source", "scope", "state"],
          ["path", "count", "reason"],
        ) ||
        !validRuntimeText(entry.id) ||
        ![
          "instructions",
          "skills",
          "agents",
          "hooks",
          "tools",
          "mcp",
          "plugins",
          "configuration",
        ].includes(entry.kind) ||
        !["workspace", "runtime"].includes(entry.source) ||
        !["workspace", "external", "runtime"].includes(entry.scope) ||
        !["discovered", "reported", "unavailable"].includes(entry.state) ||
        (Object.hasOwn(entry, "path") &&
          (typeof entry.path !== "string" || entry.path.length > 4096)) ||
        (Object.hasOwn(entry, "count") && !validClock(entry.count!)) ||
        (Object.hasOwn(entry, "reason") &&
          !["path_denied", "unsupported_format", "not_reported"].includes(
            entry.reason!,
          ))
      )
        return false;
    }
  }
  return true;
}
export function requestOptionsInvalid(
  state: State,
  request: {
    agent?: string;
    model?: string;
    variant?: string;
  } = selectors.draft(state),
): boolean {
  const { agent, model, variant } = request;
  if (
    [agent, model, variant].some(
      (v) => v !== undefined && v !== "" && !validRuntimeText(v),
    )
  )
    return true;
  const inventory = state.catalog;
  if (
    agent &&
    (inventory?.agents.status !== "available" ||
      !inventory.agents.entries.some((e) => e.id === agent))
  )
    return true;
  const selected =
    inventory?.models.status === "available"
      ? inventory.models.entries.find((e) => e.id === model)
      : undefined;
  return Boolean(
    (model && !selected) ||
      (variant &&
        (!model ||
          !selected ||
          selected.variants.status !== "available" ||
          !selected.variants.ids.includes(variant))),
  );
}
export function currentSessionSetting(
  state: State,
): SessionSelection | undefined {
  const snapshot = state.snapshot;
  return state.connection === "connected" &&
    snapshot?.state === "connected" &&
    snapshot.runtimeEpoch === state.epoch &&
    snapshot.revision >= state.revision &&
    snapshot.selectedWorkspaceId === state.selection.workspaceId &&
    snapshot.selectedSessionId === state.selection.sessionId &&
    !resourceMutationDisabled(state, state.selection.workspaceId)
    ? snapshot.sessionSelection
    : undefined;
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
    if (retained) {
      if (
        intent.authorityHold !== retained.authorityHold ||
        intent.hostHeld !== retained.authorityHold
      )
        write(key, {
          ...intent,
          authorityHold: retained.authorityHold,
          hostHeld: retained.authorityHold,
        });
    } else if (
      intent.hostHeld &&
      (intent.status === "accepted" || intent.status === "failed")
    ) {
      // Host removal reconciles terminal rows only. Absence cannot settle an
      // unknown original or its authority, nor an outstanding local call.
      const terminal = { ...intent, hostHeld: false };
      delete terminal.authorityHold;
      write(key, terminal);
    }
  }
  for (const [key, retained] of incoming) {
    if (operations[key]) continue;
    const {
      runtimeEpoch,
      operationId,
      authorityHold,
      type,
      workspaceId,
      sessionId,
    } = retained;
    const operation = {
      type,
      ...(workspaceId ? { workspaceId } : {}),
      ...(sessionId ? { sessionId } : {}),
    };
    write(key, {
      id: operationId,
      epoch: runtimeEpoch,
      operation,
      lookupOnly: true,
      hostHeld: authorityHold,
      authorityHold,
      origin: { generation: -1 },
      key: selectionKey(operation.workspaceId, operation.sessionId),
      navigate: false,
      status: "unknown",
    });
  }
  return Object.keys(operations).length <= 2048 ? operations : null;
}
// Local unknowns stay held until explicit host release. Lookup remains available
// for released unknowns, but their status alone cannot reacquire authority.
export const unknownOperationHeld = (intent: Intent): boolean =>
  intent.status === "unknown" && intent.authorityHold !== false;
export const globalMutationDisabled = (state: State) =>
  !state.recovery || state.recovery.store.state !== "ready";
export function resourceMutationDisabled(
  state: State,
  workspaceId?: string,
): boolean {
  return (
    globalMutationDisabled(state) ||
    Object.values(state.gitBranchRestoreIO).some(
      (w) => !workspaceId || w === workspaceId,
    ) ||
    Object.values(state.gitCommitIO).some(
      (w) => !workspaceId || w === workspaceId,
    ) ||
    Object.values(state.gitIndexIO).some(
      (w) => !workspaceId || w === workspaceId,
    ) ||
    Object.values(state.operations).some(
      (i) =>
        [
          "git.index.apply",
          "git.commit.apply",
          "git.branch.apply",
          "git.restore.apply",
        ].includes(i.operation.type) &&
        (i.hostHeld || i.status === "pending" || unknownOperationHeld(i)) &&
        (!workspaceId ||
          !i.operation.workspaceId ||
          i.operation.workspaceId === workspaceId),
    ) ||
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
          (i.lookupOnly && unknownOperationHeld(i)) ||
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
// Interrupt only reduces effects; a held message.send receipt must not block it.
function interruptMutationDisabled(state: State, workspaceId?: string) {
  return resourceMutationDisabled(
    {
      ...state,
      operations: Object.fromEntries(
        Object.entries(state.operations).filter(
          ([, i]) => i.operation.type !== "message.send",
        ),
      ),
    },
    workspaceId,
  );
}
function executionAvailableFor(s: State, interrupt: boolean): boolean {
  const ws = s.selection.workspaceId;
  return Boolean(
    s.connection === "connected" &&
      s.snapshot &&
      s.snapshot.state === "connected" &&
      s.snapshot.runtimeEpoch === s.epoch &&
      s.snapshot.revision >= s.revision &&
      s.snapshot.selectedWorkspaceId === ws &&
      s.snapshot.selectedSessionId === s.selection.sessionId &&
      !(interrupt
        ? interruptMutationDisabled(s, ws)
        : resourceMutationDisabled(s, ws)),
  );
}
export function mutationDisabled(
  state: State,
  operation: OperationIdentity,
): boolean {
  if (operation.type === "session.interrupt")
    return interruptMutationDisabled(state, operation.workspaceId);
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
        unknownOperationHeld(i) &&
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
        (i.status === "pending" || unknownOperationHeld(i) || i.hostHeld) &&
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
        unknownOperationHeld(i) &&
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
  | { type: "context.request"; identity: ContextReadIdentity; inbox?: boolean }
  | {
      type: "context.observed";
      identity: ContextReadIdentity;
      value?: unknown;
      error?: string;
      inbox?: boolean;
    }
  | { type: "context.remove"; capabilityId: string }
  | { type: "context.preview.close" }
  | { type: "context.expire"; scope: Scope }
  | { type: "context.branch.preview"; before: string }
  | { type: "context.branch.edit"; text: string }
  | { type: "context.branch.close" }
  | { type: "context.notice"; text: string }
  | { type: "notice.clear" }
  | { type: "error.clear" }
  | { type: "context.notice.clear" }
  | {
      type: "git.branchRestore.edit";
      value: Partial<
        Pick<
          GitBranchRestoreDraft,
          "name" | "email" | "action" | "branch" | "source" | "paths"
        >
      >;
    }
  | { type: "git.branchRestore.selectDraft"; key?: string | undefined }
  | { type: "git.branchRestore.expire"; identity: GitBranchRestoreIdentity }
  | { type: "git.branchRestore.cancel"; identity: GitBranchRestoreIdentity }
  | { type: "git.branchRestore.read"; identity: GitBranchRestoreIdentity }
  | {
      type: "git.branchRestore.observed";
      identity: GitBranchRestoreIdentity;
      value?: unknown;
      error?: string;
    }
  | {
      type: "git.branchRestore.io";
      identity: GitBranchRestoreMutationIdentity;
      active: boolean;
    }
  | {
      type: "git.commit.edit";
      value: Partial<Pick<GitCommitDraft, "name" | "email" | "message">>;
    }
  | { type: "git.commit.selectDraft"; key?: string | undefined }
  | { type: "git.commit.expire"; identity: GitCommitIdentity }
  | { type: "git.commit.cancel"; identity: GitCommitIdentity }
  | { type: "git.commit.read"; identity: GitCommitIdentity }
  | {
      type: "git.commit.observed";
      identity: GitCommitIdentity;
      value?: unknown;
      error?: string;
    }
  | {
      type: "git.commit.io";
      identity: GitCommitMutationIdentity;
      active: boolean;
    }
  | { type: "git.index.select"; path: string }
  | { type: "git.index.action"; action: GitIndexAction }
  | { type: "git.index.cancel"; identity: GitIndexIdentity }
  | { type: "git.index.read"; identity: GitIndexIdentity }
  | {
      type: "git.index.observed";
      identity: GitIndexIdentity;
      value?: unknown;
      error?: string;
    }
  | {
      type: "git.index.io";
      identity: GitIndexMutationIdentity;
      active: boolean;
    }
  | { type: "git.select"; field: "path" | "mode" | "baseRef"; value: string }
  | { type: "git.read"; identity: GitReviewIdentity }
  | {
      type: "git.observed";
      identity: GitReviewIdentity;
      value?: unknown;
      error?: string;
    }
  | { type: "git.diff.read"; identity: GitDiffIdentity }
  | {
      type: "git.diff.observed";
      identity: GitDiffIdentity;
      value?: unknown;
      error?: string;
    }
  | { type: "line.feedback.select"; kind: "file" | "git" }
  | { type: "line.feedback.resume"; id: string }
  | { type: "line.feedback.edit"; value: LineFeedbackEdit }
  | { type: "line.feedback.discard" }
  | {
      type: "line.feedback.append";
      draft: LineFeedbackDraft;
      key: string;
      composer: Draft;
    }
  | { type: "git.retry"; generation: number; detailGeneration?: number }
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
  | { type: "permission.policy.read"; identity: PermissionPolicyIdentity }
  | {
      type: "permission.policy.observed";
      identity: PermissionPolicyIdentity;
      value?: WorkbenchPermissionPolicyObservation;
      error?: PermissionPolicy["error"];
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
      variant?: string;
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
    errorOp: undefined,
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
function immutableContext<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) immutableContext(child);
    Object.freeze(value);
  }
  return value;
}
export function validContextBranchSnapshot(
  value: WorkbenchSnapshot,
  intent: Intent,
  receipt?: RedactedReceipt,
): boolean {
  return Boolean(
    receipt?.effect === "confirmed" &&
      receipt.delivery === "accepted" &&
      receipt.result?.kind === "forked" &&
      closed(receipt.result, [
        "kind",
        "workspaceId",
        "sessionId",
        "nativeSessionId",
      ]) &&
      wireId(receipt.result.nativeSessionId, 256) &&
      validProjection(value) &&
      value.state === "connected" &&
      value.recovery.store.state === "ready" &&
      value.workspaces.some(
        (w) =>
          w.id === intent.conversation?.scope.workspaceId &&
          w.path === intent.conversation.scope.workspacePath &&
          w.trusted === intent.conversation.scope.trusted &&
          w.trustRevision === intent.conversation.scope.trustRevision,
      ) &&
      value.runtimeEpoch === intent.epoch &&
      value.revision >= receipt.revision &&
      value.selectedWorkspaceId === intent.operation.workspaceId &&
      value.selectedSessionId === receipt.result.sessionId &&
      value.sessions.some(
        (x) =>
          x.id === value.selectedSessionId &&
          x.workspaceId === value.selectedWorkspaceId &&
          x.parentSessionId === intent.operation.sessionId &&
          x.status === "idle" &&
          !x.archived,
      ),
  );
}
function reduceConversationContext(state: State, event: Event): State {
  const c = state.conversationContext,
    key = selectionKey(state.selection.workspaceId, state.selection.sessionId),
    draft = selectedContextDraft(state);
  switch (event.type) {
    case "context.request":
      if (
        !contextEffectsReady(state) ||
        !currentRuntimeRequestScope(state, event.identity.scope)
      )
        return state;
      return {
        ...state,
        conversationContext: {
          ...c,
          generation: event.identity.token,
          ...(event.inbox
            ? {
                inboxRequest: event.identity,
                inbox: undefined,
                inboxScope: undefined,
              }
            : { request: event.identity, preview: undefined }),
          error: "",
          notice: "",
        },
      };
    case "context.observed": {
      if (
        (event.inbox ? c.inboxRequest : c.request) !== event.identity ||
        !currentRuntimeRequestScope(state, event.identity.scope)
      )
        return state;
      const next = {
        ...c,
        ...(event.inbox ? { inboxRequest: undefined } : { request: undefined }),
        error: event.error ?? "",
      };
      if (!event.value) return { ...state, conversationContext: next };
      try {
        if (event.inbox) {
          const value = validateInboxObservation(event.value);
          if (
            value.runtimeEpoch !== state.epoch ||
            value.revision !== state.revision ||
            value.workspaceId !== state.selection.workspaceId ||
            value.sessionId !== state.selection.sessionId
          )
            throw Error("STALE");
          next.inbox = immutableContext(structuredClone(value));
          next.inboxScope = event.identity.scope;
        } else {
          const value = validateContextObservation(event.value);
          if (
            value.runtimeEpoch !== state.epoch ||
            value.revision !== state.revision ||
            value.workspaceId !== state.selection.workspaceId ||
            value.workspacePath !== event.identity.scope.workspacePath ||
            value.path !== event.identity.path
          )
            throw Error("STALE");
          if (value.status !== "available") next.error = value.reason;
          else {
            const d = immutableContext(structuredClone(value.descriptor));
            const selection = event.identity.selection;
            if (
              selection
                ? d.source !== "selection" ||
                  d.version !== selection.version ||
                  d.range?.start !== selection.start ||
                  d.range.end !== selection.end
                : d.source !== "file"
            )
              throw Error("STALE");
            const items = [
              ...draft.items.filter(
                (x) => x.path !== d.path || x.source !== d.source,
              ),
              d,
            ];
            if (!validContextList(items)) throw Error("capacity_exceeded");
            next.drafts = {
              ...c.drafts,
              [key]: immutableContext({
                items,
                verifiedIds: [
                  ...(draft.authority &&
                  currentRuntimeRequestScope(state, draft.authority)
                    ? draft.verifiedIds.filter((id) =>
                        items.some((x) => x.capabilityId === id),
                      )
                    : []),
                  d.capabilityId,
                ],
                revision: draft.revision + 1,
                authority: event.identity.scope,
              }),
            };
            next.preview = {
              descriptor: d,
              value: immutableContext(structuredClone(value.preview)),
              scope: event.identity.scope,
            };
          }
        }
      } catch {
        next.error = "CONTEXT_UNVERIFIED";
      }
      return { ...state, conversationContext: next };
    }
    case "context.remove":
      return {
        ...state,
        conversationContext: {
          ...c,
          drafts: {
            ...c.drafts,
            [key]: {
              ...draft,
              items: immutableContext(
                draft.items.filter(
                  (x) => x.capabilityId !== event.capabilityId,
                ),
              ),
              verifiedIds: immutableContext(
                draft.verifiedIds.filter((id) => id !== event.capabilityId),
              ),
              revision: draft.revision + 1,
            },
          },
          preview:
            c.preview?.descriptor.capabilityId === event.capabilityId
              ? undefined
              : c.preview,
        },
      };
    case "context.preview.close":
      return c.preview
        ? { ...state, conversationContext: { ...c, preview: undefined } }
        : state;
    case "context.expire":
      if (!draft.authority || draft.authority !== event.scope) return state;
      return {
        ...state,
        conversationContext: {
          ...c,
          preview: undefined,
          drafts: {
            ...c.drafts,
            [key]: { ...draft, authority: undefined, verifiedIds: [] },
          },
          error: "CONTEXT_EXPIRED",
        },
      };
    case "context.branch.preview": {
      const m = state.snapshot?.messages.find(
        (x) => x.id === event.before && x.role === "user",
      );
      if (
        !m ||
        !contextEffectsReady(state) ||
        state.lists.sessions.find((x) => x.id === state.selection.sessionId)
          ?.status !== "idle"
      )
        return state;
      return {
        ...state,
        conversationContext: {
          ...c,
          branch: Object.freeze({
            scope: Object.freeze(scopeOf(state)),
            before: m.id,
            text: m.text,
            originalText: m.text,
            historical: Boolean(m.context),
          }),
          notice: "",
        },
      };
    }
    case "context.branch.edit":
      return c.branch && event.text.length <= 32000
        ? {
            ...state,
            conversationContext: {
              ...c,
              branch: Object.freeze({ ...c.branch, text: event.text }),
            },
          }
        : state;
    case "context.branch.close":
      return { ...state, conversationContext: { ...c, branch: undefined } };
    case "context.notice":
      return { ...state, conversationContext: { ...c, notice: event.text } };
    case "notice.clear":
      return state.notice ? { ...state, notice: "" } : state;
    case "context.notice.clear":
      return c.notice
        ? { ...state, conversationContext: { ...c, notice: "" } }
        : state;
    default:
      return state;
  }
}
function retireConversationContext(previous: State, next: State): State {
  const c = next.conversationContext;
  const valid = (scope?: Scope) =>
    Boolean(
      scope &&
        currentRuntimeRequestScope(next, scope) &&
        next.connection === "connected" &&
        !globalMutationDisabled(next),
    );
  let drafts = c.drafts;
  for (const [key, draft] of Object.entries(drafts)) {
    if (draft.authority && !valid(draft.authority)) {
      if (drafts === c.drafts) drafts = { ...drafts };
      drafts[key] = { ...draft, authority: undefined, verifiedIds: [] };
    }
  }
  const request = c.request && valid(c.request.scope) ? c.request : undefined,
    preview = c.preview && valid(c.preview.scope) ? c.preview : undefined,
    inboxRequest =
      c.inboxRequest && valid(c.inboxRequest.scope)
        ? c.inboxRequest
        : undefined,
    inboxScope = valid(c.inboxScope) ? c.inboxScope : undefined,
    branch = c.branch && valid(c.branch.scope) ? c.branch : undefined;
  if (
    drafts === c.drafts &&
    request === c.request &&
    preview === c.preview &&
    inboxRequest === c.inboxRequest &&
    inboxScope === c.inboxScope &&
    branch === c.branch
  )
    return next;
  return {
    ...next,
    conversationContext: {
      ...c,
      drafts,
      request,
      preview,
      inboxRequest,
      inboxScope,
      inbox: inboxScope ? c.inbox : undefined,
      branch,
      generation:
        Math.max(c.generation, previous.conversationContext.generation) + 1,
    },
  };
}
function reduceWorkbench(state: State, event: Event): State {
  if (event.type.startsWith("context.") || event.type === "notice.clear")
    return reduceConversationContext(state, event);
  switch (event.type) {
    case "error.clear":
      return state.error ? { ...state, error: "", errorOp: undefined } : state;
    case "line.feedback.select": {
      if (!["file", "git"].includes(event.kind)) return state;
      const source = currentLineFeedbackSource(state, event.kind),
        w = gitWorkspace(state);
      if (!source || !w)
        return {
          ...state,
          lineFeedback: { ...state.lineFeedback, notice: "MISSING_SOURCE" },
        };
      const existing = Object.values(state.lineFeedback.drafts).find(
        (d) =>
          d.source.observation === source.observation &&
          sameScope(state, d.scope) &&
          d.scope.revision === state.revision &&
          d.scope.trustRevision === w.trustRevision &&
          d.root === w.path &&
          d.sourceGeneration ===
            (event.kind === "file"
              ? state.workspaceFile.generation
              : state.gitReview.generation) &&
          (event.kind === "file" ||
            d.detailGeneration === state.gitReview.detailGeneration),
      );
      if (existing)
        return {
          ...state,
          lineFeedback: {
            ...state.lineFeedback,
            active: existing.id,
            notice: "",
          },
        };
      if (
        Object.keys(state.lineFeedback.drafts).length >=
          LINE_FEEDBACK_CACHE_LIMIT ||
        state.lineFeedback.sequence >= Number.MAX_SAFE_INTEGER
      )
        return {
          ...state,
          lineFeedback: { ...state.lineFeedback, notice: "CACHE_FULL" },
        };
      const sequence = state.lineFeedback.sequence + 1,
        id = String(sequence);
      const draft: LineFeedbackDraft = {
        id,
        source,
        scope: scopeOf(state),
        root: w.path,
        trusted: w.trusted,
        sourceGeneration:
          event.kind === "file"
            ? state.workspaceFile.generation
            : state.gitReview.generation,
        detailGeneration: state.gitReview.detailGeneration,
        selection: {
          side: event.kind === "file" ? "file" : "new",
          start: 1,
          end: 1,
        },
        comment: "",
      };
      return {
        ...state,
        lineFeedback: {
          sequence,
          active: id,
          drafts: { ...state.lineFeedback.drafts, [id]: draft },
          notice: "",
        },
      };
    }
    case "line.feedback.resume":
      return Object.hasOwn(state.lineFeedback.drafts, event.id)
        ? {
            ...state,
            lineFeedback: {
              ...state.lineFeedback,
              active: event.id,
              notice: "",
            },
          }
        : state;
    case "line.feedback.edit": {
      const d = selectedLineFeedbackDraft(state);
      if (!d) return state;
      const v = event.value;
      if (
        v.comment !== undefined &&
        (typeof v.comment !== "string" ||
          v.comment.length > LINE_FEEDBACK_LIMITS.commentCharacters)
      )
        return {
          ...state,
          lineFeedback: { ...state.lineFeedback, notice: "FEEDBACK_TOO_LARGE" },
        };
      const next = {
        ...d,
        selection: {
          side: v.side ?? d.selection.side,
          start: v.start ?? d.selection.start,
          end: v.end ?? d.selection.end,
        },
        comment: v.comment ?? d.comment,
      };
      return {
        ...state,
        lineFeedback: {
          ...state.lineFeedback,
          drafts: { ...state.lineFeedback.drafts, [d.id]: next },
          notice: "",
        },
      };
    }
    case "line.feedback.discard": {
      const d = selectedLineFeedbackDraft(state);
      if (!d) return state;
      const drafts = { ...state.lineFeedback.drafts };
      delete drafts[d.id];
      return {
        ...state,
        lineFeedback: {
          ...state.lineFeedback,
          drafts,
          active: undefined,
          notice: "DISCARDED",
        },
      };
    }
    case "line.feedback.append": {
      const d = selectedLineFeedbackDraft(state);
      const key = selectionKey(
        state.selection.workspaceId,
        state.selection.sessionId,
      );
      const composer = state.drafts[key] ?? emptyDraft;
      const reason =
        d !== event.draft || key !== event.key || composer !== event.composer
          ? "STALE_TARGET"
          : lineFeedbackReason(state, d);
      if (reason || !d)
        return {
          ...state,
          lineFeedback: {
            ...state.lineFeedback,
            notice: reason || "MISSING_SOURCE",
          },
        };
      // No notifications or IO before this atomic source/target/revision check.
      const text = appendFeedbackText(
        composer.text,
        formatLineFeedback(d.source, d.selection, d.comment).text,
      );
      return {
        ...state,
        drafts: {
          ...state.drafts,
          [key]: { ...composer, text, revision: composer.revision + 1 },
        },
        lineFeedback: { ...state.lineFeedback, notice: "ADDED" },
      };
    }
    case "git.branchRestore.edit": {
      const key = selectedGitBranchRestoreDraftKey(state),
        w = gitWorkspace(state);
      if (!key) return state;
      const d =
        state.gitBranchRestoreDrafts[key] ??
        (state.epoch && w
          ? {
              epoch: state.epoch,
              workspaceId: w.id,
              workspacePath: w.path,
              ...emptyBranchRestoreFields,
            }
          : undefined);
      if (!d) return state;
      if (
        Object.entries(event.value).some(
          ([k, v]) =>
            !["name", "email", "action", "branch", "source", "paths"].includes(
              k,
            ) ||
            (k === "paths"
              ? !Array.isArray(v) || !v.every((p) => typeof p === "string")
              : typeof v !== "string"),
        )
      )
        return state;
      if (
        Object.entries(event.value).every(
          ([k, v]) =>
            JSON.stringify(d[k as keyof GitBranchRestoreDraft]) ===
            JSON.stringify(v),
        )
      )
        return state;
      return {
        ...state,
        gitBranchRestoreDrafts: {
          ...state.gitBranchRestoreDrafts,
          [key]: immutableBranchRestore({
            ...d,
            ...event.value,
            paths: [...(event.value.paths ?? d.paths)],
            revision: d.revision + 1,
          }),
        },
        gitBranchRestore: {
          ...state.gitBranchRestore,
          generation: state.gitBranchRestore.generation + 1,
          request: undefined,
          previewIdentity: undefined,
          error: state.gitBranchRestore.preview ? "STALE" : undefined,
        },
      };
    }
    case "git.branchRestore.selectDraft": {
      if (event.key && !state.gitBranchRestoreDrafts[event.key]) return state;
      return {
        ...state,
        gitBranchRestore: {
          ...state.gitBranchRestore,
          draftKey: event.key,
          generation: state.gitBranchRestore.generation + 1,
          request: undefined,
          previewIdentity: undefined,
          error: state.gitBranchRestore.preview ? "STALE" : undefined,
        },
      };
    }
    case "git.branchRestore.io": {
      const io = { ...state.gitBranchRestoreIO },
        i = event.identity,
        key = operationKey(i.epoch, i.operationId);
      if (event.active) io[key] = i.workspaceId;
      else delete io[key];
      return { ...state, gitBranchRestoreIO: io };
    }
    case "git.branchRestore.cancel":
    case "git.branchRestore.expire": {
      const g = state.gitBranchRestore;
      if (
        (event.type === "git.branchRestore.cancel"
          ? g.request
          : g.previewIdentity) !== event.identity
      )
        return state;
      return {
        ...state,
        gitBranchRestore: {
          ...g,
          request: undefined,
          previewIdentity: undefined,
          error:
            event.type === "git.branchRestore.expire" ? "EXPIRED" : "CANCELLED",
        },
      };
    }
    case "git.branchRestore.read": {
      if (
        !canPreviewGitBranchRestore(state) ||
        !currentGitBranchRestoreScope(state, event.identity)
      )
        return state;
      return {
        ...state,
        gitBranchRestore: {
          ...state.gitBranchRestore,
          request: event.identity,
          previewIdentity: undefined,
          error: undefined,
        },
      };
    }
    case "git.branchRestore.observed": {
      const i = event.identity,
        g = state.gitBranchRestore;
      if (g.request !== i || !currentGitBranchRestoreScope(state, i))
        return state;
      let value: WorkbenchGitBranchRestorePreview | undefined,
        error = event.error;
      if (!error)
        try {
          value = validateGitBranchRestorePreview(event.value);
          if (
            value.runtimeEpoch !== i.epoch ||
            value.revision !== i.floor ||
            value.workspaceId !== i.workspaceId ||
            value.workspacePath !== i.workspacePath ||
            (value.status === "available" &&
              (value.headOid !== i.review.repository.head ||
                value.objectFormat !== i.review.repository.objectFormat ||
                value.currentBranch !==
                  (i.review.repository.branch === null
                    ? null
                    : `refs/heads/${i.review.repository.branch}`) ||
                value.action !== i.draft.action ||
                (i.draft.action === "restore"
                  ? value.source !== i.draft.source ||
                    value.paths.some((p) => !i.draft.paths.includes(p.path))
                  : value.branch !== i.draft.branch ||
                    value.author?.name !== i.draft.name ||
                    value.author?.email !== i.draft.email ||
                    (i.draft.action === "select" &&
                      value.nextHeadOid !==
                        i.review.branches.find(
                          (b) => `refs/heads/${b.name}` === i.draft.branch,
                        )?.oid))))
          ) {
            value = undefined;
            error = "STALE";
          }
        } catch {
          error = "GIT_BRANCH_RESTORE_UNVERIFIED";
        }
      return {
        ...state,
        ...(value?.status === "unavailable" &&
        [
          "expired_observation",
          "stale_observation",
          "metadata_changed",
          "path_changed",
          "process_unverified",
        ].includes(value.reason)
          ? {
              gitReview: {
                ...retireGitDetail(state.gitReview, true),
                generation: state.gitReview.generation + 1,
                request: undefined,
                observationIdentity: undefined,
                error: "STALE",
              },
            }
          : {}),
        gitBranchRestore: {
          ...g,
          request: undefined,
          preview: value
            ? immutableBranchRestore(structuredClone(value))
            : g.preview,
          previewIdentity: value ? i : undefined,
          ...(value
            ? {
                previewPaths: Object.freeze(
                  gitRestoreDraftPaths(i.draft.paths),
                ),
              }
            : {}),
          error,
        },
      };
    }
    case "git.commit.edit": {
      const key = selectedGitCommitDraftKey(state),
        w = gitWorkspace(state);
      if (!key) return state;
      const d =
        state.gitCommitDrafts[key] ??
        (state.epoch && w
          ? {
              epoch: state.epoch,
              workspaceId: w.id,
              workspacePath: w.path,
              ...emptyCommitFields,
            }
          : undefined);
      if (!d) return state;
      if (
        Object.entries(event.value).some(
          ([k, v]) =>
            !["name", "email", "message"].includes(k) || typeof v !== "string",
        )
      )
        return state;
      if (
        Object.entries(event.value).every(
          ([k, v]) => d[k as "name" | "email" | "message"] === v,
        )
      )
        return state;
      return {
        ...state,
        gitCommitDrafts: {
          ...state.gitCommitDrafts,
          [key]: { ...d, ...event.value, revision: d.revision + 1 },
        },
        gitCommit: {
          ...state.gitCommit,
          generation: state.gitCommit.generation + 1,
          request: undefined,
          previewIdentity: undefined,
          error: state.gitCommit.preview ? "STALE" : undefined,
        },
      };
    }
    case "git.commit.selectDraft": {
      if (event.key && !state.gitCommitDrafts[event.key]) return state;
      return {
        ...state,
        gitCommit: {
          ...state.gitCommit,
          draftKey: event.key,
          generation: state.gitCommit.generation + 1,
          request: undefined,
          previewIdentity: undefined,
          error: state.gitCommit.preview ? "STALE" : undefined,
        },
      };
    }
    case "git.commit.io": {
      const io = { ...state.gitCommitIO },
        i = event.identity,
        key = operationKey(i.epoch, i.operationId);
      if (event.active) io[key] = i.workspaceId;
      else delete io[key];
      return { ...state, gitCommitIO: io };
    }
    case "git.commit.cancel":
    case "git.commit.expire": {
      const g = state.gitCommit;
      if (
        (event.type === "git.commit.cancel" ? g.request : g.previewIdentity) !==
        event.identity
      )
        return state;
      return {
        ...state,
        gitCommit: {
          ...g,
          request: undefined,
          previewIdentity: undefined,
          error: event.type === "git.commit.expire" ? "EXPIRED" : "CANCELLED",
        },
      };
    }
    case "git.commit.read": {
      if (
        !canPreviewGitCommit(state) ||
        !currentGitCommitScope(state, event.identity)
      )
        return state;
      return {
        ...state,
        gitCommit: {
          ...state.gitCommit,
          request: event.identity,
          previewIdentity: undefined,
          error: undefined,
        },
      };
    }
    case "git.commit.observed": {
      const i = event.identity,
        g = state.gitCommit;
      if (g.request !== i || !currentGitCommitScope(state, i)) return state;
      let value: WorkbenchGitCommitPreview | undefined,
        error = event.error;
      if (!error)
        try {
          value = validateGitCommitPreview(event.value);
          if (
            value.runtimeEpoch !== i.epoch ||
            value.revision !== i.floor ||
            value.workspaceId !== i.workspaceId ||
            value.workspacePath !== i.workspacePath ||
            (value.status === "available" &&
              (value.headOid !== i.review.repository.head ||
                value.objectFormat !== i.review.repository.objectFormat ||
                (i.review.repository.branch === null
                  ? value.reference.kind !== "head"
                  : value.reference.kind !== "branch" ||
                    value.reference.name !==
                      `refs/heads/${i.review.repository.branch}`) ||
                value.entries.length !==
                  i.review.files.filter((f) => f.index !== "none").length ||
                value.entries.some(
                  (entry) =>
                    !i.review.files.some(
                      (f) => f.path === entry.path && f.index !== "none",
                    ),
                ) ||
                value.author.name !== i.draft.name ||
                value.author.email !== i.draft.email ||
                value.canonicalMessage !==
                  canonicalGitCommitMessage(i.draft.message)))
          ) {
            value = undefined;
            error = "STALE";
          }
        } catch {
          error = "GIT_COMMIT_UNVERIFIED";
        }
      return {
        ...state,
        ...(value?.status === "unavailable" &&
        [
          "expired_observation",
          "stale_observation",
          "metadata_changed",
          "path_changed",
          "process_unverified",
        ].includes(value.reason)
          ? {
              gitReview: {
                ...retireGitDetail(state.gitReview, true),
                generation: state.gitReview.generation + 1,
                request: undefined,
                observationIdentity: undefined,
                error: "STALE",
              },
            }
          : {}),
        gitCommit: {
          ...g,
          request: undefined,
          preview: value ? structuredClone(value) : g.preview,
          previewIdentity: value ? i : undefined,
          error,
        },
      };
    }
    case "git.index.io": {
      const io = { ...state.gitIndexIO },
        i = event.identity,
        key = operationKey(i.epoch, i.operationId);
      if (event.active) io[key] = i.workspaceId;
      else delete io[key];
      return { ...state, gitIndexIO: io };
    }
    case "git.index.select": {
      if (!canSelectGitIndexPaths(state) || !validGitIndexPaths([event.path]))
        return state;
      const review = currentGitReviewObservation(state);
      if (
        review?.status !== "available" ||
        !review.files.some(
          (f) => f.path === event.path && f.kind !== "conflict",
        )
      )
        return state;
      const paths = state.gitIndex.paths.includes(event.path)
        ? state.gitIndex.paths.filter((p) => p !== event.path)
        : [...state.gitIndex.paths, event.path].sort();
      if (paths.length && !validGitIndexPaths(paths)) return state;
      return {
        ...state,
        gitIndex: {
          ...state.gitIndex,
          paths,
          generation: state.gitIndex.generation + 1,
          selectionIdentity: {
            ...state.gitReview.observationIdentity!,
            selectionGeneration: state.selection.generation,
          },
          request: undefined,
          previewIdentity: undefined,
          error: undefined,
        },
      };
    }
    case "git.index.action": {
      if (
        !["stage", "unstage"].includes(event.action) ||
        state.gitIndex.action === event.action ||
        !canSelectGitIndexPaths(state)
      )
        return state;
      return {
        ...state,
        gitIndex: {
          ...state.gitIndex,
          action: event.action,
          generation: state.gitIndex.generation + 1,
          request: undefined,
          previewIdentity: undefined,
          error: undefined,
        },
      };
    }
    case "git.index.cancel":
      return state.gitIndex.request !== event.identity
        ? state
        : {
            ...state,
            gitIndex: {
              ...state.gitIndex,
              request: undefined,
              previewIdentity: undefined,
              error: "CANCELLED",
            },
          };
    case "git.index.read": {
      if (
        !canPreviewGitIndex(state) ||
        !currentGitIndexScope(state, event.identity)
      )
        return state;
      return {
        ...state,
        gitIndex: {
          ...state.gitIndex,
          request: event.identity,
          previewIdentity: undefined,
          error: undefined,
        },
      };
    }
    case "git.index.observed": {
      const i = event.identity,
        g = state.gitIndex;
      if (g.request !== i || !currentGitIndexScope(state, i)) return state;
      let value: WorkbenchGitIndexPreview | undefined,
        error = event.error;
      if (!error)
        try {
          value = validateGitIndexPreview(event.value);
          if (
            value.runtimeEpoch !== i.epoch ||
            value.revision !== i.floor ||
            value.workspaceId !== i.workspaceId ||
            value.workspacePath !== i.workspacePath ||
            (value.status === "available" &&
              (value.action !== i.action ||
                JSON.stringify(value.paths) !== JSON.stringify(i.paths) ||
                value.headOid !== i.review.repository.head ||
                value.objectFormat !== i.review.repository.objectFormat))
          ) {
            value = undefined;
            error = "STALE";
          }
        } catch {
          error = "GIT_INDEX_UNVERIFIED";
        }
      return {
        ...state,
        ...(value?.status === "unavailable" &&
        [
          "expired_observation",
          "stale_observation",
          "metadata_changed",
          "path_changed",
          "process_unverified",
        ].includes(value.reason)
          ? {
              gitReview: {
                ...retireGitDetail(state.gitReview, true),
                generation: state.gitReview.generation + 1,
                request: undefined,
                observationIdentity: undefined,
                error: "STALE",
              },
            }
          : {}),
        gitIndex: {
          ...g,
          request: undefined,
          preview: value ? structuredClone(value) : g.preview,
          previewIdentity: value ? i : undefined,
          error,
        },
      };
    }
    case "git.select": {
      const g = state.gitReview;
      if (
        event.field === "mode" &&
        !["staged", "unstaged", "base"].includes(event.value)
      )
        return state;
      if (
        event.field === "path" &&
        event.value &&
        !validWorkspaceFilePath(event.value)
      )
        return state;
      if (
        event.field === "baseRef" &&
        event.value &&
        !validGitBranch(event.value)
      )
        return state;
      if (g[event.field] === event.value) return state;
      return {
        ...state,
        gitReview: { ...retireGitDetail(g), [event.field]: event.value },
      };
    }
    case "git.read": {
      const i = event.identity;
      if (
        !canObserveGitReview(state) ||
        i.generation !== state.gitReview.generation + 1 ||
        !currentGitReviewScope(
          {
            ...state,
            gitReview: { ...state.gitReview, generation: i.generation },
          },
          i,
        )
      )
        return state;
      return {
        ...state,
        gitReview: {
          ...retireGitDetail(state.gitReview, true),
          generation: i.generation,
          request: i,
          observationIdentity: undefined,
          error: undefined,
          retryReady: true,
        },
      };
    }
    case "git.observed": {
      const i = event.identity,
        g = state.gitReview;
      if (
        g.request !== i ||
        !currentGitReviewScope(state, i) ||
        !gitTargetReady(state)
      )
        return state;
      let value: WorkbenchGitReview | undefined,
        error = event.error;
      if (!error) {
        try {
          value = validateGitReviewObservation(event.value);
          if (!gitObservationMatches(state, i, value)) {
            value = undefined;
            error = "STALE";
          }
        } catch {
          error = "GIT_UNVERIFIED";
        }
      }
      // Clone validated data so the bridge caller cannot later mutate accepted evidence.
      const observation = value ? structuredClone(value) : g.observation;
      return {
        ...state,
        gitReview: {
          ...g,
          request: undefined,
          observation,
          observationIdentity: value ? i : undefined,
          error,
          retryReady: error !== "READ_BUSY",
          path: value ? "" : g.path,
          baseRef: value ? "" : g.baseRef,
        },
      };
    }
    case "git.diff.read": {
      const i = event.identity;
      if (
        !canReadGitDiff(state) ||
        i.detailGeneration !== state.gitReview.detailGeneration + 1 ||
        !currentGitDiffScope(
          {
            ...state,
            gitReview: {
              ...state.gitReview,
              detailGeneration: i.detailGeneration,
            },
          },
          i,
        )
      )
        return state;
      return {
        ...state,
        gitReview: {
          ...state.gitReview,
          detailGeneration: i.detailGeneration,
          detailRequest: i,
          detailIdentity: undefined,
          detailError: undefined,
          detailRetryReady: true,
        },
      };
    }
    case "git.diff.observed": {
      const i = event.identity,
        g = state.gitReview;
      if (g.detailRequest !== i || !currentGitDiffScope(state, i)) return state;
      let value: WorkbenchGitDiff | undefined,
        error = event.error;
      if (!error) {
        try {
          value = validateGitDiffObservation(event.value);
          const observation = currentGitReviewObservation(state);
          if (
            !gitObservationMatches(state, i, value) ||
            value.observationId !== i.observationId ||
            value.mode !== i.mode ||
            value.path !== i.path ||
            (value.mode === "base" &&
              (value.baseRef !== i.baseRef ||
                observation?.status !== "available" ||
                observation.branches.find((b) => b.name === i.baseRef)?.oid !==
                  value.baseOid))
          ) {
            value = undefined;
            error = "STALE";
          }
        } catch {
          error = "GIT_UNVERIFIED";
        }
      }
      return {
        ...state,
        gitReview: {
          ...g,
          detailRequest: undefined,
          detail: value ? structuredClone(value) : g.detail,
          detailIdentity: value ? i : undefined,
          detailError: error,
          detailRetryReady: error !== "READ_BUSY",
          ...(value?.status === "unavailable" &&
          [
            "expired_observation",
            "stale_observation",
            "metadata_changed",
            "path_changed",
            "process_unverified",
          ].includes(value.reason)
            ? { observationIdentity: undefined, error: "STALE" }
            : {}),
        },
      };
    }
    case "git.retry": {
      const g = state.gitReview;
      if (
        g.generation !== event.generation ||
        (event.detailGeneration !== undefined &&
          g.detailGeneration !== event.detailGeneration)
      )
        return state;
      return {
        ...state,
        gitReview: {
          ...g,
          ...(event.detailGeneration === undefined
            ? { retryReady: true }
            : { detailRetryReady: true }),
        },
      };
    }

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

    case "permission.policy.read": {
      if (
        !canObservePermissionPolicy(state) ||
        !currentPermissionPolicyScope(state, event.identity)
      )
        return state;
      return {
        ...state,
        permissionPolicy: {
          generation: state.permissionPolicy.generation,
          request: event.identity,
        },
      };
    }
    case "permission.policy.observed": {
      const { identity } = event;
      if (state.permissionPolicy.request !== identity) return state;
      let value: WorkbenchPermissionPolicyObservation | undefined;
      try {
        if (event.value)
          value = validatePermissionPolicyObservation(event.value);
        if (
          !value ||
          !permissionPolicyTargetReady(state) ||
          !currentPermissionPolicyScope(state, identity) ||
          value.runtimeEpoch !== identity.epoch ||
          value.workspaceId !== identity.workspaceId ||
          value.workspacePath !== identity.workspacePath ||
          value.sessionId !== identity.sessionId ||
          value.revision !== identity.floor
        )
          value = undefined;
        if (value) value = structuredClone(value);
      } catch {
        value = undefined;
      }
      return {
        ...state,
        permissionPolicy: value
          ? {
              generation: state.permissionPolicy.generation,
              observationIdentity: identity,
              observation: value,
            }
          : {
              generation: state.permissionPolicy.generation + 1,
              error: event.error ?? "POLICY_UNVERIFIED",
            },
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
        !changed &&
        (event.scope.revision !== state.revision ||
          event.scope.workspacePath !== scopeOf(state).workspacePath ||
          event.scope.trustRevision !== scopeOf(state).trustRevision ||
          event.scope.trusted !== scopeOf(state).trusted ||
          event.scope.runtimeGeneration !== state.runtimeGeneration)
      )
        return state;
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
      const runtimeChanged =
        workspace?.path !== scopeOf(state).workspacePath ||
        workspace?.trusted !== scopeOf(state).trusted ||
        trustChanged;
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
        runtimeGeneration:
          state.runtimeGeneration + (runtimeChanged || changed ? 1 : 0),
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
        // A rejection stays until dismissed, retried or the selection changes.
        ...(selectionChanged ? { error: "", errorOp: undefined } : {}),
        catalog:
          changed || selectionChanged || runtimeChanged ? null : state.catalog,
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
    case "catalog": {
      if (
        !(
          sameScope(state, event.scope) &&
          event.scope.catalogGeneration === state.catalogGeneration &&
          event.scope.revision === state.revision &&
          event.scope.workspacePath === scopeOf(state).workspacePath &&
          event.scope.runtimeGeneration === state.runtimeGeneration &&
          event.scope.trusted === scopeOf(state).trusted &&
          event.scope.trustRevision === scopeOf(state).trustRevision
        )
      )
        return state;
      const valid = event.value && validRuntimeCatalog(event.value);
      return {
        ...state,
        catalog: valid ? event.value! : null,
        catalogError:
          event.value && !valid ? "CATALOG_UNVERIFIED" : (event.error ?? ""),
      };
    }
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
                ((unknownOperationHeld(i) || i.hostHeld) &&
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
      if (
        [event.agent, event.model, event.variant].some(
          (v) => v !== undefined && v !== "" && !validRuntimeText(v),
        )
      )
        return state;
      const modelChanged =
        event.model !== undefined && event.model !== draft.model;
      const next = {
        text: event.text ?? draft.text,
        agent: event.agent ?? draft.agent,
        model: event.model ?? draft.model,
        variant: event.variant ?? (modelChanged ? "" : draft.variant),
        variantCleared:
          event.variant !== undefined
            ? false
            : modelChanged
              ? Boolean(draft.variant)
              : draft.variantCleared,
        revision: draft.revision + 1,
      };
      return next.text === draft.text &&
        next.agent === draft.agent &&
        next.model === draft.model &&
        next.variant === draft.variant &&
        next.variantCleared === draft.variantCleared
        ? state
        : {
            ...state,
            drafts: { ...state.drafts, [event.key]: next },
            ...(state.errorOp === "message.send" && next.text !== draft.text
              ? { error: "", errorOp: undefined }
              : {}),
          };
    }
    case "intent": {
      const key = operationKey(event.intent.epoch, event.intent.id);
      if (state.operations[key]) return state;
      if (
        ["git.branch.apply", "git.restore.apply"].includes(
          event.intent.operation.type,
        )
      ) {
        const i = event.intent.gitBranchRestoreMutation;
        if (
          !i ||
          !gitBranchRestoreRequestMatches(i) ||
          !canApplyGitBranchRestore(state) ||
          !currentGitBranchRestoreScope(state, i) ||
          state.gitBranchRestore.preview !== i.preview ||
          event.intent.operation !== i.request ||
          i.operationId !== event.intent.id ||
          i.epoch !== event.intent.epoch
        )
          return state;
      }
      if (event.intent.operation.type === "git.commit.apply") {
        const i = event.intent.gitCommitMutation;
        if (
          !i ||
          !gitCommitRequestMatches(i) ||
          !canApplyGitCommit(state) ||
          !currentGitCommitScope(state, i) ||
          state.gitCommit.preview !== i.preview ||
          event.intent.operation !== i.request ||
          i.operationId !== event.intent.id ||
          i.epoch !== event.intent.epoch
        )
          return state;
      }
      if (event.intent.operation.type === "git.index.apply") {
        const i = event.intent.gitIndexMutation;
        if (
          !i ||
          !gitIndexRequestMatches(i) ||
          !canApplyGitIndex(state) ||
          !currentGitIndexScope(state, i) ||
          state.gitIndex.preview !== i.preview ||
          event.intent.operation !== i.request ||
          i.operationId !== event.intent.id ||
          i.epoch !== event.intent.epoch
        )
          return state;
      }
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
        ...(event.intent.gitBranchRestoreMutation
          ? {
              gitBranchRestore: {
                ...state.gitBranchRestore,
                mutation: {
                  identity: event.intent.gitBranchRestoreMutation,
                  status: "pending" as const,
                },
              },
            }
          : {}),
        ...(event.intent.gitCommitMutation
          ? {
              gitCommit: {
                ...state.gitCommit,
                mutation: {
                  identity: event.intent.gitCommitMutation,
                  status: "pending" as const,
                },
              },
            }
          : {}),
        ...(event.intent.gitIndexMutation
          ? {
              gitIndex: {
                ...state.gitIndex,
                mutation: {
                  identity: event.intent.gitIndexMutation,
                  status: "pending" as const,
                },
              },
            }
          : {}),
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
        errorOp: undefined,
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
      next = gitIndexMutationState(next, intent, "unknown");
      next = gitCommitMutationState(next, intent, "unknown");
      next = gitBranchRestoreMutationState(next, intent, "unknown");
      return {
        ...next,
        operations: {
          ...state.operations,
          [key!]:
            intent.configurationSave ||
            intent.skillSave ||
            intent.agentSave ||
            intent.workspaceFileSave ||
            intent.gitIndexMutation ||
            intent.gitCommitMutation ||
            intent.gitBranchRestoreMutation
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
          intent.gitIndexMutation ||
          intent.gitBranchRestoreMutation ||
          intent.gitCommitMutation ||
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
        errorOp: intent.operation.type,
        gitBranchRestore: gitBranchRestoreMutationState(
          next,
          intent,
          "denied",
          event.code,
        ).gitBranchRestore,
        gitCommit: gitCommitMutationState(next, intent, "denied", event.code)
          .gitCommit,
        gitIndex: gitIndexMutationState(next, intent, "denied", event.code)
          .gitIndex,
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
      if (
        intent.operation.type === "git.commit.apply"
          ? event.id !== key ||
            intent.status === "accepted" ||
            intent.status === "failed" ||
            !validGitCommitReceipt(receipt, intent)
          : receipt.result?.kind === "git_commit_created"
      )
        return state;
      if (
        intent.operation.type === "git.index.apply"
          ? event.id !== key ||
            intent.status === "accepted" ||
            intent.status === "failed" ||
            !validGitIndexReceipt(receipt, intent)
          : receipt.result?.kind === "git_index_updated"
      )
        return state;
      if (
        ["git.branch.apply", "git.restore.apply"].includes(
          intent.operation.type,
        )
          ? event.id !== key ||
            intent.status === "accepted" ||
            intent.status === "failed" ||
            !validGitBranchRestoreReceipt(receipt, intent)
          : receipt.result?.kind === "git_branch_restore_applied"
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
      if (intent.conversation && receipt.effect !== "none") {
        if (
          receipt.workspaceId !== intent.operation.workspaceId ||
          receipt.sessionId !== intent.operation.sessionId ||
          receipt.revision < (intent.conversation.scope.revision ?? 0)
        )
          return state;
        if (
          receipt.effect === "confirmed" &&
          (receipt.admission !== "dispatched" ||
            receipt.delivery !== "accepted")
        )
          return state;
        if (
          receipt.effect === "confirmed" &&
          intent.operation.type === "message.send" &&
          (receipt.result?.kind !== "delivery" ||
            receipt.result.status !== "accepted" ||
            !wireId(receipt.result.nativeInboxId, 256) ||
            (!intent.lookupOnly &&
              receipt.result.nativeRequestId !== undefined &&
              receipt.result.nativeRequestId !== intent.operation.requestId))
        )
          return state;
        if (
          intent.operation.type === "session.inbox.cancel" &&
          (!validInboxCancelResult(receipt.result) ||
            receipt.result.workspaceId !== intent.operation.workspaceId ||
            receipt.result.sessionId !== intent.operation.sessionId ||
            receipt.result.inboxId !== intent.conversation.inboxId ||
            receipt.result.digest !== intent.conversation.digest)
        )
          return state;
        if (
          intent.operation.type === "session.fork" &&
          (receipt.result?.kind !== "forked" ||
            receipt.result.workspaceId !== intent.operation.workspaceId ||
            receipt.result.sessionId === intent.operation.sessionId)
        )
          return state;
      }
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
      const runtimeCurrent =
        !intent.runtimeScope ||
        currentRuntimeRequestScope(state, intent.runtimeScope);
      let next: State = {
        ...state,
        revision:
          runtimeCurrent &&
          (confirmed || absentRemoval) &&
          receipt.runtimeEpoch === state.epoch
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
      if (
        ["git.branch.apply", "git.restore.apply"].includes(
          intent.operation.type,
        )
      ) {
        if (!accepted && !failed)
          next.operations[key] = gitIndexLookupOnly(next.operations[key]!);
        next = gitBranchRestoreMutationState(
          next,
          intent,
          confirmed ? "applied" : failed ? "denied" : "unknown",
          receipt.result?.kind === "rejected" ? receipt.result.code : undefined,
        );
        return next;
      }
      if (intent.operation.type === "git.commit.apply") {
        if (!accepted && !failed)
          next.operations[key] = gitIndexLookupOnly(next.operations[key]!);
        next = gitCommitMutationState(
          next,
          intent,
          confirmed ? "committed" : failed ? "denied" : "unknown",
          receipt.result?.kind === "rejected" ? receipt.result.code : undefined,
        );
        return next;
      }
      if (intent.operation.type === "git.index.apply") {
        if (!accepted && !failed)
          next.operations[key] = gitIndexLookupOnly(next.operations[key]!);
        next = gitIndexMutationState(
          next,
          intent,
          confirmed ? "applied" : failed ? "denied" : "unknown",
          receipt.result?.kind === "rejected" ? receipt.result.code : undefined,
        );
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
      if (intent.conversation && runtimeCurrent && !intent.lookupOnly) {
        const c = next.conversationContext;
        if (accepted && intent.operation.type === "message.send") {
          const d = c.drafts[intent.key];
          next = {
            ...next,
            conversationContext: {
              ...c,
              ...(d &&
              d.revision === intent.conversation.draftRevision &&
              "attachments" in intent.operation
                ? {
                    drafts: {
                      ...c.drafts,
                      [intent.key]: {
                        items: [],
                        verifiedIds: [],
                        revision: d.revision + 1,
                      },
                    },
                    preview: undefined,
                  }
                : {}),
              notice: "전송됨",
            },
          };
        }
        if (accepted && intent.operation.type === "session.inbox.cancel")
          next = {
            ...next,
            conversationContext: {
              ...c,
              inbox: undefined,
              inboxScope: undefined,
              notice: "취소를 요청했습니다 · 아직 취소 여부는 알 수 없습니다",
            },
          };
        if (
          confirmed &&
          intent.conversation.branch &&
          receipt.result?.kind === "forked"
        ) {
          const branch = intent.conversation.branch,
            newKey = selectionKey(
              receipt.result.workspaceId,
              receipt.result.sessionId,
            );
          next = {
            ...next,
            drafts: {
              ...next.drafts,
              [newKey]: { ...emptyDraft, text: branch.text, revision: 1 },
            },
            conversationContext: {
              ...c,
              branch: undefined,
              preview: undefined,
              notice: branch.historical
                ? "새 분기에 입력을 준비했습니다. 이전 첨부는 다시 선택하고 별도로 전송하세요."
                : "새 분기에 입력을 준비했습니다. 별도로 전송하세요.",
            },
          };
        }
      }
      if (
        accepted &&
        !intent.lookupOnly &&
        intent.submitted &&
        runtimeCurrent &&
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
        (!intent.conversation || runtimeCurrent) &&
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
      if (
        failed &&
        runtimeCurrent &&
        !intent.lookupOnly &&
        currentIntent(next, intent)
      )
        next = {
          ...next,
          error:
            receipt.result?.kind === "rejected"
              ? receipt.result.code
              : "RUNTIME_ERROR",
          errorOp: intent.operation.type,
        };
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
      if (
        accepted &&
        runtimeCurrent &&
        !intent.lookupOnly &&
        currentIntent(next, intent)
      ) {
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
              ? "중단을 요청했습니다 · 상태 확인 중"
              : receipt.result?.kind === "delivery" &&
                  receipt.result.status === "decided"
                ? "권한 응답 전달됨"
                : receipt.result?.kind === "delivery" &&
                    intent.operation.type !== "message.send"
                  ? "전송됨"
                  : "",
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
  return state;
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
  const gitIdentity =
    state.gitReview.request ?? state.gitReview.observationIdentity;
  if (
    event.type !== "git.read" &&
    gitIdentity &&
    (!currentGitReviewScope(next, gitIdentity) ||
      !gitTargetReady(
        gitBranchRestoreAdmissionView(
          gitCommitAdmissionView(gitIndexAdmissionView(next)),
        ),
      ))
  ) {
    next = {
      ...next,
      gitReview: {
        ...retireGitDetail(next.gitReview, true),
        generation: next.gitReview.generation + 1,
        request: undefined,
        observationIdentity: undefined,
        error: "STALE",
        retryReady: true,
        path: "",
        baseRef: "",
      },
    };
  }
  const gi = next.gitIndex,
    scope = gi.selectionIdentity;
  const view = gitBranchRestoreAdmissionView(
    gitCommitAdmissionView(gitIndexAdmissionView(next)),
  );
  if (
    scope &&
    (!currentGitReviewScope(view, scope) ||
      view.selection.generation !== scope.selectionGeneration ||
      !gitIndexReadReady(view))
  )
    next = {
      ...next,
      gitIndex: {
        ...gi,
        paths: [],
        selectionIdentity: undefined,
        generation: gi.generation + 1,
        request: undefined,
        previewIdentity: undefined,
        error: gi.preview ? "STALE" : gi.error,
      },
    };
  else if (
    gi.previewIdentity &&
    !currentGitIndexScope(view, gi.previewIdentity)
  )
    next = {
      ...next,
      gitIndex: {
        ...gi,
        request: undefined,
        previewIdentity: undefined,
        error: "STALE",
      },
    };
  const gc = next.gitCommit,
    ci = gc.request ?? gc.previewIdentity;
  if (ci && !currentGitCommitScope(view, ci))
    next = {
      ...next,
      gitCommit: {
        ...gc,
        request: undefined,
        previewIdentity: undefined,
        error: "STALE",
      },
    };
  const br = next.gitBranchRestore,
    bi = br.request ?? br.previewIdentity;
  if (bi && !currentGitBranchRestoreScope(view, bi))
    next = {
      ...next,
      gitBranchRestore: {
        ...br,
        request: undefined,
        previewIdentity: undefined,
        error: "STALE",
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
  if (
    (event.type === "unknown" || event.type === "receipt") &&
    next !== state
  ) {
    const id =
      event.type === "unknown"
        ? event.id
        : operationKey(event.receipt.runtimeEpoch, event.receipt.operationId);
    const intent = next.operations[id];
    if (
      intent?.conversation &&
      intent.status === "unknown" &&
      !intent.lookupOnly
    ) {
      const operation = {
        type: intent.operation.type,
        ...(intent.operation.workspaceId
          ? { workspaceId: intent.operation.workspaceId }
          : {}),
        ...(intent.operation.sessionId
          ? { sessionId: intent.operation.sessionId }
          : {}),
      };
      const inert = { ...intent };
      delete inert.submitted;
      next = {
        ...next,
        operations: {
          ...next.operations,
          [id]: {
            ...inert,
            lookupOnly: true,
            operation,
            conversation: {
              scope: intent.conversation.scope,
              digest: intent.conversation.digest,
              draftRevision: intent.conversation.draftRevision,
              ...(intent.conversation.inboxId
                ? { inboxId: intent.conversation.inboxId }
                : {}),
            },
          },
        },
      };
    }
  }
  next = retireConversationContext(state, next);
  next = retirePermissionPolicy(state, next);
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
    conversationContext: { generation: 0, drafts: {}, error: "", notice: "" },
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
    runtimeGeneration: 0,
    drafts: {},
    configurationDrafts: {},
    skillRuntime: {},
    skillFiles: { generation: 0 },
    skillDrafts: {},
    agentRuntime: {},
    agentFiles: { generation: 0 },
    agentDrafts: {},
    permissionPolicy: { generation: 0 },
    extensions: {},
    extensionsGeneration: 0,
    mcp: {},
    instructions: {},
    configurationNotice: "",
    configurationIO: { reads: 0, saves: 0 },
    operations: {},
    lineFeedback: { sequence: 0, drafts: {}, notice: "" },
    gitReview: initialGitReview(),
    gitIndex: { generation: 0, paths: [], action: "stage" },
    gitIndexIO: {},
    gitBranchRestore: { generation: 0 },
    gitBranchRestoreIO: {},
    gitBranchRestoreDrafts: {},
    gitCommit: { generation: 0 },
    gitCommitIO: {},
    gitCommitDrafts: {},
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
      let changed = false;
      store.setState((state) => {
        const next = transition(state, event);
        changed =
          event.type === "line.feedback.append"
            ? next.drafts[event.key] !== state.drafts[event.key]
            : next !== state;
        return next;
      }, true);
      return changed;
    },
  };
}
export type WorkbenchStore = ReturnType<typeof createWorkbenchStore>;
export const selectors = {
  conversationContext: (s: State) => s.conversationContext,
  contextDraft: selectedContextDraft,
  contextEffectsReady,
  contextSendReady: (s: State) =>
    contextEffectsReady(s) &&
    contextAttachmentsReady(
      s,
      selectedContextDraft(s).items,
      selectors.draft(s).model,
    ),
  requestOptionsInvalid,
  currentSessionSetting,
  gitBranchRestore: (s: State) => s.gitBranchRestore,
  gitBranchRestoreDraft: selectedGitBranchRestoreDraft,
  currentGitBranchRestoreDraftKey,
  selectedGitBranchRestoreDraftKey,
  canPreviewGitBranchRestore,
  canApplyGitBranchRestore,
  currentGitBranchRestorePreview,
  gitBranchRestoreDisabledReason,

  lineFeedback: (s: State) => s.lineFeedback,
  lineFeedbackDraft: selectedLineFeedbackDraft,
  lineFeedbackReason,
  lineFeedbackPreview,
  canAppendLineFeedback: (s: State) => !lineFeedbackReason(s),
  currentLineFeedbackSource,
  gitCommit: (s: State) => s.gitCommit,
  gitCommitDraft: selectedGitCommitDraft,
  gitCommitDraftKey: selectedGitCommitDraftKey,
  currentGitCommitDraftKey,
  gitCommitDisabledReason,
  canPreviewGitCommit,
  currentGitCommitPreview,
  canApplyGitCommit,
  gitIndex: (s: State) => s.gitIndex,
  canSelectGitIndexPaths,
  canPreviewGitIndex,
  currentGitIndexPreview,
  canApplyGitIndex,
  gitReview: (s: State) => s.gitReview,
  currentGitReviewObservation,
  currentGitDiffObservation,
  canObserveGitReview,
  canReadGitDiff,
  gitReviewHeld,
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
  permissionPolicy: (s: State) => s.permissionPolicy,
  currentPermissionPolicyObservation,
  canObservePermissionPolicy,
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
  executionAvailable: (s: State) => executionAvailableFor(s, false),
  // Stop stays available while a held message.send receipt blocks other mutations.
  interruptAvailable: (s: State) => executionAvailableFor(s, true),
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
        ((i.hostHeld || (i.lookupOnly && unknownOperationHeld(i))) &&
          (!i.operation.workspaceId ||
            i.operation.workspaceId === s.selection.workspaceId)) ||
        (i.key ===
          selectionKey(s.selection.workspaceId, s.selection.sessionId) &&
          unknownOperationHeld(i)),
    ),
};
