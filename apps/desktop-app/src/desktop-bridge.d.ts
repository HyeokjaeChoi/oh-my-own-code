import type { WorkbenchPermissionPolicyObservation } from "./renderer/shared/configuration-draft/index.js";
export type { WorkbenchPermissionPolicyObservation } from "./renderer/shared/configuration-draft/index.js";
import type {
  ContextSelection,
  ContextDescriptor,
  ContextObservation,
  HistoricalContext,
} from "./renderer/shared/conversation-context/index.mjs";
import type {
  AssistantRuntime,
  SessionSelection,
  ModelOptions,
} from "./renderer/shared/runtime-options/index.js";
export type {
  RuntimeModel,
  AssistantRuntime,
  SessionSelection,
  ModelOptions,
} from "./renderer/shared/runtime-options/index.js";
import type {
  GitBranchPreviewRequest,
  GitRestorePreviewRequest,
  GitBranchApplyRequest,
  GitRestoreApplyRequest,
  WorkbenchGitBranchRestorePreview,
  WorkbenchGitBranchRestoreApply,
  GitBranchRestoreReceiptResult,
} from "./renderer/shared/git-branch-restore/index.mjs";
export type {
  GitBranchRestoreReason,
  GitBranchRestoreAction,
  GitBranchRestoreSource,
  GitBranchRestoreMetadataRole,
  GitBranchRestoreFileState,
  GitBranchRestoreByteState,
  GitBranchRestorePath,
  GitBranchRestoreMetadata,
  GitBranchRestoreTarget,
  GitBranchPreviewRequest,
  GitRestorePreviewRequest,
  GitBranchApplyRequest,
  GitRestoreApplyRequest,
  WorkbenchGitBranchRestorePreview,
  GitBranchRestoreBackup,
  GitBranchRestoreCompleted,
  WorkbenchGitBranchRestoreApply,
  GitBranchRestoreReceiptResult,
} from "./renderer/shared/git-branch-restore/index.mjs";
import type {
  GitCommitPreviewRequest,
  GitCommitApplyRequest,
  WorkbenchGitCommitPreview,
  WorkbenchGitCommitApply,
  GitCommitReceiptResult,
} from "./renderer/shared/git-commit/index.mjs";
export type {
  GitCommitReason,
  GitCommitAuthor,
  GitCommitLogRole,
  GitCommitBackupRole,
  GitCommitBackup,
  GitCommitLogDigest,
  GitCommitTarget,
  GitCommitPreviewRequest,
  GitCommitApplyRequest,
  WorkbenchGitCommitPreview,
  WorkbenchGitCommitApply,
  GitCommitReceiptResult,
} from "./renderer/shared/git-commit/index.mjs";
import type {
  GitIndexPreviewRequest,
  GitIndexApplyRequest,
  WorkbenchGitIndexPreview,
  WorkbenchGitIndexApply,
  GitIndexReceiptResult,
} from "./renderer/shared/git-index/index.mjs";
export type {
  GitIndexAction,
  GitIndexReason,
  GitIndexTarget,
  GitIndexEntry,
  GitIndexPreviewRequest,
  GitIndexApplyRequest,
  WorkbenchGitIndexPreview,
  WorkbenchGitIndexApply,
  GitIndexReceiptResult,
} from "./renderer/shared/git-index/index.mjs";
import type {
  GitReviewRequest,
  GitDiffRequest,
  WorkbenchGitReview,
  WorkbenchGitDiff,
} from "./renderer/shared/git-review/index.mjs";
export type {
  GitReviewRequest,
  GitDiffRequest,
  WorkbenchGitReview,
  WorkbenchGitDiff,
} from "./renderer/shared/git-review/index.mjs";
import type {
  WorkbenchFileObservation,
  WorkbenchFileSave,
} from "./renderer/shared/workspace-file/index.mjs";
export type {
  WorkbenchFileObservation,
  WorkbenchFileSave,
} from "./renderer/shared/workspace-file/index.mjs";
import type { WorkbenchExtensionsObservation } from "./renderer/shared/configuration-draft/index.js";
export type {
  WorkbenchExtensionUnavailableReason,
  WorkbenchExtensionSource,
  WorkbenchExtensionPlugin,
  WorkbenchExtensionTool,
  WorkbenchExtensionsGroup,
  WorkbenchExtensionsInventory,
  WorkbenchExtensionsObservation,
} from "./renderer/shared/configuration-draft/index.js";

export type {
  ContextSelection,
  ContextDescriptor,
  ContextObservation,
  ContextPreview,
  InboxObservation,
} from "./renderer/shared/conversation-context/index.mjs";
export type WorkbenchResult<T> =
  | { ok: true; value: T; receipt?: RedactedReceipt }
  | { ok: false; code: string; message: string; receipt?: RedactedReceipt };
export interface WorkbenchWorkspace {
  id: string;
  name: string;
  path: string;
  kind: "folder" | "repository" | "worktree";
  trusted: boolean;
  trustRevision: number;
  temporary: boolean;
}
export interface WorkbenchSession {
  id: string;
  workspaceId: string;
  title: string;
  status: "idle" | "running" | "stopping" | "unknown" | "unavailable";
  pinned?: boolean;
  archived?: boolean;
  parentSessionId?: string;
}
export interface WorkbenchDiagnostics {
  startedAt: number;
  observedOperations: number;
  errors: number;
  unknownOutcomes: number;
  droppedEvents: number;
  events: {
    id: string;
    timestamp: number;
    operation: string;
    workspaceId?: string;
    sessionId?: string;
    status: "ok" | "error" | "unknown" | "cancelled";
    durationMs: number;
    code?: string;
  }[];
}
export interface WorkbenchTool {
  id: string;
  name: string;
  status: "pending" | "running" | "completed" | "error";
  input: string;
  output: string;
}
export interface WorkbenchMessage {
  context?: HistoricalContext;
  runtime?: AssistantRuntime;
  id: string;
  role: "user" | "assistant";
  text: string;
  tools: WorkbenchTool[];
}
export interface WorkbenchPermission {
  id: string;
  sessionId: string;
  title: string;
  detail: string;
}
export interface WorkbenchSnapshot {
  runtimeEpoch: string;
  revision: number;
  observationSequence: number;
  recovery: WorkbenchRecovery;
  retainedOperations: RetainedOperationKey[];
  state: "connected" | "disconnected" | "unavailable";
  temporary: boolean;
  workspaces: WorkbenchWorkspace[];
  sessions: WorkbenchSession[];
  selectedWorkspaceId?: string;
  selectedSessionId?: string;
  sessionSelection?: SessionSelection;
  messages: WorkbenchMessage[];
  permissions: WorkbenchPermission[];
  error?: { code: string; message: string };
}
export interface WorkbenchCatalogEntry {
  id: string;
  name: string;
  description?: string;
  status?: string;
  source?: "runtime";
  path?: string;
  scope?: "workspace" | "external" | "runtime";
}
export interface WorkbenchCatalogGroup {
  status: "available" | "unavailable";
  entries: WorkbenchCatalogEntry[];
}
export interface WorkbenchModelEntry
  extends WorkbenchCatalogEntry,
    ModelOptions {}
export interface WorkbenchModelCatalogGroup {
  status: "available" | "unavailable";
  entries: WorkbenchModelEntry[];
}
export interface WorkbenchCatalog {
  commands: WorkbenchCatalogGroup;
  skills: WorkbenchCatalogGroup;
  mcp: WorkbenchCatalogGroup;
  agents: WorkbenchCatalogGroup;
  models: WorkbenchModelCatalogGroup;
  configuration?: WorkbenchConfiguration;
}
export interface WorkbenchConfiguration {
  status: "available" | "partial" | "unavailable";
  runtimeStatus: "not_reported";
  reason?:
    | "untrusted_workspace"
    | "runtime_unavailable"
    | "path_denied"
    | "limit_reached";
  entries: {
    id: string;
    kind:
      | "instructions"
      | "skills"
      | "agents"
      | "hooks"
      | "tools"
      | "mcp"
      | "plugins"
      | "configuration";
    source: "workspace" | "runtime";
    path?: string;
    scope: "workspace" | "external" | "runtime";
    state: "discovered" | "reported" | "unavailable";
    count?: number;
    reason?: "path_denied" | "unsupported_format" | "not_reported";
  }[];
}
export type WorkbenchConfigurationFile = {
  workspaceId: string;
  workspacePath: string;
  kind: "instructions" | "mcp";
  path: string;
} & (
  | { status: "available"; content: string; version: string; reason?: never }
  | {
      status: "missing" | "unsupported" | "unavailable";
      reason:
        | "missing_file"
        | "path_denied"
        | "file_changed"
        | "too_large"
        | "unsupported_content";
      content?: never;
      version?: never;
    }
);
export type WorkbenchSkillFileReason =
  | "missing_file"
  | "path_missing"
  | "path_denied"
  | "file_changed"
  | "too_large"
  | "unsupported_content";
export type WorkbenchSkillFiles = {
  workspaceId: string;
  workspacePath: string;
  path: string;
} & (
  | {
      status: "available";
      entries: { sourceName: string; path: string }[];
      truncated: boolean;
    }
  | { status: "missing"; reason: "path_missing" }
  | {
      status: "unavailable";
      reason: "path_missing" | "path_denied" | "file_changed";
    }
);
export type WorkbenchSkillFile = {
  workspaceId: string;
  workspacePath: string;
  sourceName: string;
  path: string;
} & (
  | {
      status: "available";
      content: string;
      version: string;
      directoryVersion: string;
    }
  | { status: "missing"; reason: "missing_file"; directoryVersion: string }
  | { status: "unsupported"; reason: "unsupported_content" }
  | {
      status: "unavailable";
      reason: "path_missing" | "path_denied" | "file_changed" | "too_large";
    }
);
export type WorkbenchAgentFiles = WorkbenchSkillFiles;
export type WorkbenchAgentFile = WorkbenchSkillFile;
export type WorkbenchAgentRuntimeIdentity = {
  sourceName: string;
  nativeId: string;
  digest: string;
  nativeDigest: string;
  registrationRuntimeEpoch: string;
  registrationOperationId: string;
};
export type WorkbenchAgentRuntimeRow = WorkbenchAgentRuntimeIdentity & {
  name: string;
  system: string;
  systemDigest: string;
  path: string;
  mode: "primary";
  hidden: false;
  referenceCount: number;
  permissions: [
    { action: "*"; resource: "*"; effect: "ask" },
    { action: "external_directory"; resource: "*"; effect: "deny" },
    { action: "subagent"; resource: "*"; effect: "deny" },
  ];
  description?: string;
  color?: string;
};
export type WorkbenchAgentRuntimeObservation = {
  workspaceId: string;
  workspacePath: string;
  runtimeEpoch: string;
} & (
  | {
      status: "observed";
      observationId: string;
      defaultAgentId: string | null;
      owned: WorkbenchAgentRuntimeRow[];
      unowned: {
        nativeId: string;
        name: string;
        mode: "primary" | "subagent" | "all";
        hidden: boolean;
      }[];
      file?: { sourceName: string } & (
        | {
            status: "available";
            version: string;
            directoryVersion: string;
            digest: string;
          }
        | { status: "missing"; reason: "missing_file" }
        | { status: "unsupported"; reason: "unsupported_content" }
        | {
            status: "unavailable";
            reason:
              | "path_missing"
              | "path_denied"
              | "file_changed"
              | "too_large";
          }
      );
    }
  | {
      status: "unavailable";
      reason:
        | "runtime_error"
        | "identity_conflict"
        | "retained_limit"
        | "invalid_context"
        | "references_unverified";
    }
);
export type WorkbenchAgentRuntimeMutation =
  | ({
      requestId: string;
      status: "registered_primary";
      version: string;
      directoryVersion: string;
      systemDigest: string;
      defaultAgentId: string;
    } & WorkbenchAgentRuntimeIdentity)
  | ({
      requestId: string;
      status: "removed";
      systemDigest: string;
      defaultAgentId: string;
    } & WorkbenchAgentRuntimeIdentity)
  | { requestId: string; status: "unknown" };
export interface WorkbenchFileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
}
export type WorkbenchSkillRuntimeIdentity = {
  sourceName: string;
  nativeId: string;
  digest: string;
  nativeDigest: string;
  registrationRuntimeEpoch: string;
  registrationOperationId: string;
};
export type WorkbenchSkillRuntimeRow = WorkbenchSkillRuntimeIdentity & {
  name: string;
  description?: string;
  autoinvoke: false;
  path: string;
  content: string;
  bodyDigest: string;
};
export type WorkbenchSkillRuntimeObservation = {
  workspaceId: string;
  workspacePath: string;
  runtimeEpoch: string;
} & (
  | {
      status: "observed";
      observationId: string;
      owned: WorkbenchSkillRuntimeRow[];
      unowned: { nativeId: string; name: string; autoinvoke?: boolean }[];
      file?: { sourceName: string } & (
        | {
            status: "available";
            version: string;
            directoryVersion: string;
            digest: string;
          }
        | { status: "missing"; reason: "missing_file" }
        | { status: "unsupported"; reason: "unsupported_content" }
        | {
            status: "unavailable";
            reason:
              | "path_missing"
              | "path_denied"
              | "file_changed"
              | "too_large";
          }
      );
      session?: { sessionId: string } & (
        | {
            status: "observed";
            messages: {
              nativeId: string;
              messageId: string;
              name: string;
              bodyDigest: string;
            }[];
          }
        | {
            status: "unavailable";
            reason:
              | "history_unverified"
              | "history_truncated"
              | "scope_mismatch";
          }
      );
    }
  | {
      status: "unavailable";
      reason:
        | "runtime_error"
        | "identity_conflict"
        | "retained_limit"
        | "invalid_context"
        | "history_unverified";
    }
);
export type WorkbenchSkillRuntimeMutation =
  | ({
      requestId: string;
      status: "registered_disabled";
      version: string;
      directoryVersion: string;
      bodyDigest: string;
    } & WorkbenchSkillRuntimeIdentity)
  | ({ requestId: string; status: "removed" } & WorkbenchSkillRuntimeIdentity)
  | ({
      requestId: string;
      status: "applied";
      sessionId: string;
      nativeSessionId: string;
      nativeMessageId: string;
      bodyDigest: string;
    } & WorkbenchSkillRuntimeIdentity)
  | { requestId: string; status: "unknown" };
export type WorkbenchMcpNativeStatus =
  | "connected"
  | "pending"
  | "disabled"
  | "failed"
  | "needs_auth";
export type WorkbenchMcpServer = { nativeName: string } & (
  | {
      status: WorkbenchMcpNativeStatus | "absent";
      ownership: "current_runtime";
      sourceName: string;
      submittedDefinitionDigest: string;
      sourceVersion: string;
    }
  | {
      status: WorkbenchMcpNativeStatus;
      ownership: "unowned";
      sourceName?: never;
      submittedDefinitionDigest?: never;
      sourceVersion?: never;
    }
);
export type WorkbenchMcpObservation = { workspaceId: string } & (
  | { status: "observed"; version: string; servers: WorkbenchMcpServer[] }
  | { status: "unavailable"; reason: "unsupported_catalog" | "scope_mismatch" }
);
export type WorkbenchMcpMutation = { requestId: string } & (
  | {
      status: "registered_disabled";
      sourceName: string;
      nativeName: string;
      digest: string;
      sourceVersion: string;
    }
  | {
      status: "connection_status";
      action: "connect" | "disconnect";
      sourceName: string;
      nativeName: string;
      connectionStatus: "connected" | "failed" | "needs_auth" | "disabled";
    }
  | { status: "removed"; sourceName: string; nativeName: string }
  | { status: "unknown" }
);
type WorkspaceMcpTarget = {
  workspaceId: string;
  requestId: string;
  sourceName: string;
  expectedObservationVersion: string;
};
export type WorkbenchInstructionObservation = {
  workspaceId: string;
  sessionId: string;
} & (
  | { status: "missing"; version: string }
  | { status: "changed"; version: string; digest?: string }
  | ({
      status: "registered";
      version: string;
      digest: string;
      sourceVersion: string;
    } & (
      | { origin: "direct"; inheritedFromSessionId?: never }
      | { origin: "fork"; inheritedFromSessionId: string }
    ))
  | {
      status: "unavailable";
      reason: "ownership_conflict" | "unsupported_entries";
    }
);
export type WorkbenchInstructionMutation =
  | {
      requestId: string;
      status: "registered";
      digest: string;
      sourceVersion: string;
    }
  | { requestId: string; status: "removed" }
  | { requestId: string; status: "unknown" };
export interface WorkbenchFileList {
  path: string;
  entries: WorkbenchFileEntry[];
}
export interface WorkbenchFileSearch {
  query: string;
  mode: "name" | "content";
  results: { path: string; line?: number; snippet?: string }[];
  truncated: boolean;
}
export interface WorkbenchFileRead {
  path: string;
  content: string;
  truncated: boolean;
}
export interface WorkbenchReceipt {
  requestId?: string;
  status: "accepted" | "duplicate" | "stopping" | "decided" | "unknown";
}
type SessionLifecycleTarget = {
  workspaceId: string;
  sessionId: string;
  requestId: string;
};
export type WorkbenchRequest =
  | GitBranchPreviewRequest
  | GitRestorePreviewRequest
  | GitBranchApplyRequest
  | GitRestoreApplyRequest
  | GitCommitPreviewRequest
  | GitCommitApplyRequest
  | GitIndexPreviewRequest
  | GitIndexApplyRequest
  | GitReviewRequest
  | GitDiffRequest
  | { type: "file.edit.read"; workspaceId: string; path: string }
  | {
      type: "file.save";
      workspaceId: string;
      path: string;
      requestId: string;
      expectation: "version";
      version: string;
      directoryVersion: string;
      text: string;
    }
  | { type: "configuration.extensions.read"; workspaceId: string }
  | { type: "configuration.agent.list"; workspaceId: string }
  | {
      type: "configuration.agent.read";
      workspaceId: string;
      sourceName: string;
    }
  | {
      type: "configuration.agent.runtime.read";
      workspaceId: string;
      sourceName?: string;
    }
  | {
      type: "configuration.agent.register";
      workspaceId: string;
      requestId: string;
      sourceName: string;
      observationId: string;
      version: string;
      directoryVersion: string;
      digest: string;
    }
  | {
      type: "configuration.agent.remove";
      workspaceId: string;
      requestId: string;
      nativeId: string;
      observationId: string;
    }
  | ({
      type: "configuration.agent.save";
      workspaceId: string;
      requestId: string;
      sourceName: string;
      text: string;
      directoryVersion: string;
    } & (
      | { expectation: "version"; version: string }
      | { expectation: "missing"; version?: never }
    ))
  | {
      type: "configuration.skill.runtime.read";
      workspaceId: string;
      sessionId?: string;
      sourceName?: string;
    }
  | {
      type: "configuration.skill.register";
      workspaceId: string;
      requestId: string;
      sourceName: string;
      observationId: string;
      version: string;
      directoryVersion: string;
      digest: string;
    }
  | {
      type: "configuration.skill.remove";
      workspaceId: string;
      requestId: string;
      nativeId: string;
      observationId: string;
    }
  | {
      type: "configuration.skill.apply";
      workspaceId: string;
      sessionId: string;
      requestId: string;
      nativeId: string;
      observationId: string;
    }
  | { type: "configuration.skill.list"; workspaceId: string }
  | {
      type: "configuration.skill.read";
      workspaceId: string;
      sourceName: string;
    }
  | ({
      type: "configuration.skill.save";
      workspaceId: string;
      sourceName: string;
      requestId: string;
      text: string;
      directoryVersion: string;
    } & (
      | { expectation: "version"; version: string }
      | { expectation: "missing"; version?: never }
    ))
  | { type: "permission.policy.read"; workspaceId: string; sessionId: string }
  | { type: "configuration.mcp.read"; workspaceId: string }
  | ({
      type: "configuration.mcp.register";
      text: string;
      fileVersion: string;
    } & WorkspaceMcpTarget)
  | ({
      type:
        | "configuration.mcp.connect"
        | "configuration.mcp.disconnect"
        | "configuration.mcp.remove";
    } & WorkspaceMcpTarget)
  | {
      type: "configuration.instructions.read";
      workspaceId: string;
      sessionId: string;
    }
  | ({
      type: "configuration.instructions.apply";
      text: string;
      fileVersion: string;
      expectedRegistrationVersion: string;
    } & SessionLifecycleTarget)
  | ({
      type: "configuration.instructions.remove";
      expectedRegistrationVersion: string;
    } & SessionLifecycleTarget)
  | { type: "operation.lookup"; runtimeEpoch: string; operationId: string }
  | ({ type: "session.rename"; title: string } & SessionLifecycleTarget)
  | ({ type: "session.pin"; pinned: boolean } & SessionLifecycleTarget)
  | ({ type: "session.archive"; archived: boolean } & SessionLifecycleTarget)
  | ({
      type: "session.fork";
      title?: string;
      before?: string;
    } & SessionLifecycleTarget)
  | ({ type: "session.remove" } & SessionLifecycleTarget)
  | {
      type: "context.observe";
      workspaceId: string;
      path: string;
      selection?: ContextSelection;
    }
  | { type: "session.inbox"; workspaceId: string; sessionId: string }
  | ({ type: "session.inbox.cancel"; inboxId: string } & SessionLifecycleTarget)
  | { type: "diagnostics.list"; workspaceId?: string; sessionId?: string }
  | { type: "snapshot"; workspaceId?: string; sessionId?: string }
  | { type: "workspace.import" }
  | { type: "workspace.create"; name?: string }
  | { type: "workspace.remove"; workspaceId: string }
  | { type: "session.create"; workspaceId: string; title?: string }
  | {
      type: "message.send";
      workspaceId: string;
      sessionId: string;
      requestId: string;
      text: string;
      agent?: string;
      model?: string;
      variant?: string;
      attachments?: ContextDescriptor[];
      delivery?: "steer" | "queue";
    }
  | { type: "session.interrupt"; workspaceId: string; sessionId: string }
  | {
      type: "permission.respond";
      workspaceId: string;
      sessionId: string;
      requestId: string;
      decision: "once" | "reject";
    }
  | { type: "catalog.list"; workspaceId: string; sessionId?: string }
  | {
      type: "command.run";
      workspaceId: string;
      sessionId: string;
      requestId: string;
      name: string;
      arguments: string;
    }
  | { type: "file.list"; workspaceId: string; path?: string }
  | {
      type: "configuration.read";
      workspaceId: string;
      kind: "instructions" | "mcp";
    }
  | ({
      type: "configuration.save";
      workspaceId: string;
      requestId: string;
      kind: "instructions" | "mcp";
      text: string;
    } & (
      | { expectation: "version"; version: string }
      | { expectation: "missing"; version?: never }
    ))
  | { type: "file.read"; workspaceId: string; path: string }
  | {
      type: "file.search";
      workspaceId: string;
      query: string;
      mode: "name" | "content";
      caseSensitive?: boolean;
    };
export type WorkbenchConfigurationSave =
  | { requestId: string; status: "saved"; version: string; backupId?: string }
  | { requestId: string; status: "unknown" };

export interface WorkbenchInbox {
  runtimeEpoch: string;
  revision: number;
  workspaceId: string;
  sessionId: string;
  entries: {
    id: string;
    delivery: "steer" | "queue";
    textPreview: string;
    textTruncated: boolean;
    attachmentCount: number;
  }[];
  otherCount: number;
}
export type WorkbenchResponse<R extends WorkbenchRequest> = R extends {
  type: "permission.policy.read";
}
  ? WorkbenchPermissionPolicyObservation
  : R extends {
        type: "context.observe";
      }
    ? ContextObservation
    : R extends { type: "session.inbox" }
      ? WorkbenchInbox
      : R extends { type: "session.inbox.cancel" }
        ? WorkbenchReceipt
        : R extends {
              type: "git.branch.preview.read" | "git.restore.preview.read";
            }
          ? WorkbenchGitBranchRestorePreview
          : R extends { type: "git.branch.apply" | "git.restore.apply" }
            ? WorkbenchGitBranchRestoreApply
            : R extends {
                  type: "git.commit.preview.read";
                }
              ? WorkbenchGitCommitPreview
              : R extends { type: "git.commit.apply" }
                ? WorkbenchGitCommitApply
                : R extends {
                      type: "git.index.preview.read";
                    }
                  ? WorkbenchGitIndexPreview
                  : R extends { type: "git.index.apply" }
                    ? WorkbenchGitIndexApply
                    : R extends {
                          type: "git.review.read";
                        }
                      ? WorkbenchGitReview
                      : R extends { type: "git.diff.read" }
                        ? WorkbenchGitDiff
                        : R extends {
                              type: "file.edit.read";
                            }
                          ? WorkbenchFileObservation
                          : R extends { type: "file.save" }
                            ? WorkbenchFileSave
                            : R extends {
                                  type: "configuration.extensions.read";
                                }
                              ? WorkbenchExtensionsObservation
                              : R extends {
                                    type: "configuration.agent.runtime.read";
                                  }
                                ? WorkbenchAgentRuntimeObservation
                                : R extends {
                                      type:
                                        | "configuration.agent.register"
                                        | "configuration.agent.remove";
                                    }
                                  ? WorkbenchAgentRuntimeMutation
                                  : R extends {
                                        type: "configuration.agent.list";
                                      }
                                    ? WorkbenchAgentFiles
                                    : R extends {
                                          type: "configuration.agent.read";
                                        }
                                      ? WorkbenchAgentFile
                                      : R extends {
                                            type: "configuration.agent.save";
                                          }
                                        ? WorkbenchConfigurationSave
                                        : R extends {
                                              type: "configuration.skill.runtime.read";
                                            }
                                          ? WorkbenchSkillRuntimeObservation
                                          : R extends {
                                                type:
                                                  | "configuration.skill.register"
                                                  | "configuration.skill.remove"
                                                  | "configuration.skill.apply";
                                              }
                                            ? WorkbenchSkillRuntimeMutation
                                            : R extends {
                                                  type: "operation.lookup";
                                                }
                                              ? OperationLookup
                                              : R extends {
                                                    type: "catalog.list";
                                                  }
                                                ? WorkbenchCatalog
                                                : R extends {
                                                      type: "configuration.mcp.read";
                                                    }
                                                  ? WorkbenchMcpObservation
                                                  : R extends {
                                                        type:
                                                          | "configuration.mcp.register"
                                                          | "configuration.mcp.connect"
                                                          | "configuration.mcp.disconnect"
                                                          | "configuration.mcp.remove";
                                                      }
                                                    ? WorkbenchMcpMutation
                                                    : R extends {
                                                          type: "configuration.instructions.read";
                                                        }
                                                      ? WorkbenchInstructionObservation
                                                      : R extends {
                                                            type:
                                                              | "configuration.instructions.apply"
                                                              | "configuration.instructions.remove";
                                                          }
                                                        ? WorkbenchInstructionMutation
                                                        : R extends {
                                                              type: "configuration.skill.list";
                                                            }
                                                          ? WorkbenchSkillFiles
                                                          : R extends {
                                                                type: "configuration.skill.read";
                                                              }
                                                            ? WorkbenchSkillFile
                                                            : R extends {
                                                                  type: "configuration.skill.save";
                                                                }
                                                              ? WorkbenchConfigurationSave
                                                              : R extends {
                                                                    type: "configuration.read";
                                                                  }
                                                                ? WorkbenchConfigurationFile
                                                                : R extends {
                                                                      type: "configuration.save";
                                                                    }
                                                                  ? WorkbenchConfigurationSave
                                                                  : R extends {
                                                                        type: "diagnostics.list";
                                                                      }
                                                                    ? WorkbenchDiagnostics
                                                                    : R extends {
                                                                          type: "file.list";
                                                                        }
                                                                      ? WorkbenchFileList
                                                                      : R extends {
                                                                            type: "file.read";
                                                                          }
                                                                        ? WorkbenchFileRead
                                                                        : R extends {
                                                                              type: "file.search";
                                                                            }
                                                                          ? WorkbenchFileSearch
                                                                          : R extends {
                                                                                type:
                                                                                  | "message.send"
                                                                                  | "session.interrupt"
                                                                                  | "permission.respond"
                                                                                  | "command.run";
                                                                              }
                                                                            ? WorkbenchReceipt
                                                                            : WorkbenchSnapshot;
declare global {
  interface Window {
    desktopBridge: {
      runtimeSnapshot(): Promise<{
        state: "connected" | "disconnected" | "unavailable";
        serverVersion?: string;
        sessionTitle?: string;
        sessionId?: string;
      }>;
      workbench<R extends WorkbenchRequest>(
        // eslint-disable-next-line no-unused-vars
        _request: WorkbenchEnvelope<R>,
      ): Promise<
        WorkbenchResult<WorkbenchResponse<R> | { status: "duplicate" }>
      >;
      cancelRead(
        // eslint-disable-next-line no-unused-vars
        _request: WorkbenchCancel,
      ): Promise<WorkbenchResult<{ status: "cancelled" | "missing" }>>;
    };
  }
}

export type ReadType =
  | "permission.policy.read"
  | "context.observe"
  | "session.inbox"
  | "git.commit.preview.read"
  | "git.branch.preview.read"
  | "git.restore.preview.read"
  | "git.index.preview.read"
  | "git.review.read"
  | "git.diff.read"
  | "file.edit.read"
  | "configuration.extensions.read"
  | "configuration.agent.runtime.read"
  | "configuration.agent.list"
  | "configuration.agent.read"
  | "configuration.skill.runtime.read"
  | "configuration.skill.list"
  | "configuration.skill.read"
  | "configuration.mcp.read"
  | "configuration.instructions.read"
  | "snapshot"
  | "diagnostics.list"
  | "catalog.list"
  | "file.list"
  | "file.read"
  | "file.search"
  | "configuration.read"
  | "operation.lookup";
export type WorkbenchEnvelope<R extends WorkbenchRequest = WorkbenchRequest> =
  R extends WorkbenchRequest
    ? R extends { type: ReadType }
      ? {
          version: 2;
          operation: R;
          readId: string;
          operationId?: never;
          expectedRevision?: never;
        } & (R extends { type: "snapshot" }
          ? { runtimeEpoch?: string }
          : { runtimeEpoch: string })
      : {
          version: 2;
          operation: R;
          operationId: string;
          runtimeEpoch: string;
          expectedRevision?: number;
          readId?: never;
        }
    : never;
export interface WorkbenchCancel {
  version: 2;
  runtimeEpoch: string;
  readId: string;
}
export type ReceiptResult =
  | GitCommitReceiptResult
  | GitBranchRestoreReceiptResult
  | GitIndexReceiptResult
  | ({ kind: "agent_registered"; workspaceId: string } & Omit<
      Extract<WorkbenchAgentRuntimeMutation, { status: "registered_primary" }>,
      "requestId" | "status"
    >)
  | ({ kind: "agent_removed"; workspaceId: string } & Omit<
      Extract<WorkbenchAgentRuntimeMutation, { status: "removed" }>,
      "requestId" | "status"
    >)
  | {
      kind: "agent_file_saved";
      workspaceId: string;
      sourceName: string;
      version: string;
      backupId?: string;
    }
  | ({ kind: "skill_registered"; workspaceId: string } & Omit<
      Extract<WorkbenchSkillRuntimeMutation, { status: "registered_disabled" }>,
      "requestId" | "status"
    >)
  | ({ kind: "skill_removed"; workspaceId: string } & Omit<
      Extract<WorkbenchSkillRuntimeMutation, { status: "removed" }>,
      "requestId" | "status"
    >)
  | ({ kind: "skill_applied"; workspaceId: string } & Omit<
      Extract<WorkbenchSkillRuntimeMutation, { status: "applied" }>,
      "requestId" | "status"
    >)
  | {
      kind: "skill_file_saved";
      workspaceId: string;
      sourceName: string;
      version: string;
      backupId?: string;
    }
  | {
      kind: "mcp_registered";
      workspaceId: string;
      sourceName: string;
      nativeName: string;
      digest: string;
      sourceVersion: string;
      status: "disabled";
    }
  | {
      kind: "mcp_connection";
      workspaceId: string;
      sourceName: string;
      nativeName: string;
      action: "connect" | "disconnect";
      connectionStatus: "connected" | "failed" | "needs_auth" | "disabled";
    }
  | {
      kind: "mcp_removed";
      workspaceId: string;
      sourceName: string;
      nativeName: string;
    }
  | {
      kind: "instruction_registered";
      workspaceId: string;
      sessionId: string;
      digest: string;
      sourceVersion: string;
    }
  | { kind: "instruction_removed"; workspaceId: string; sessionId: string }
  | {
      kind: "created";
      workspaceId: string;
      sessionId?: string;
      nativeSessionId?: string;
    }
  | {
      kind: "forked";
      workspaceId: string;
      sessionId: string;
      nativeSessionId: string;
    }
  | {
      kind: "removed";
      workspaceId: string;
      removedSessionIds?: string[];
      workspaceRemoved: boolean;
    }
  | {
      kind: "file_saved";
      workspaceId: string;
      path: string;
      version: string;
      digest: string;
      backupId: string;
    }
  | {
      kind: "configuration_saved";
      workspaceId: string;
      configurationKind: "instructions" | "mcp";
      version: string;
      backupId?: string;
    }
  | { kind: "metadata"; workspaceId: string; sessionId: string }
  | {
      kind: "inbox_cancel_requested";
      workspaceId: string;
      sessionId: string;
      inboxId: string;
      digest: string;
    }
  | {
      kind: "delivery";
      nativeInboxId?: string;
      nativeRequestId?: string;
      status: "accepted" | "stopping" | "decided";
    }
  | { kind: "rejected"; code: WorkbenchErrorCode };
export type WorkbenchErrorCode =
  | "SKILL_CHANGED"
  | "SKILL_UNVERIFIED"
  | "SKILL_UNSUPPORTED"
  | "SKILL_OWNERSHIP_CONFLICT"
  | "SKILL_ALREADY_APPLIED"
  | "MCP_CHANGED"
  | "MCP_UNVERIFIED"
  | "MCP_UNSUPPORTED"
  | "MCP_OWNERSHIP_CONFLICT"
  | "INSTRUCTIONS_CHANGED"
  | "INSTRUCTIONS_UNVERIFIED"
  | "READ_BUSY"
  | "READ_TIMEOUT"
  | "STALE_EPOCH"
  | "STALE_REVISION"
  | "ARCHIVED_SESSION"
  | "EMPTY_SESSION"
  | "HAS_DESCENDANTS"
  | "DESCENDANTS_UNVERIFIED"
  | "INVALID_REQUEST"
  | "NOT_FOUND"
  | "BUSY"
  | "CANCELLED"
  | "UNAVAILABLE"
  | "AUTH_REQUIRED"
  | "POLICY_UNVERIFIED"
  | "INVALID_SELECTION"
  | "STALE_PERMISSION"
  | "DUPLICATE_CONFLICT"
  | "LIMIT_REACHED"
  | "FILE_CHANGED"
  | "FILE_DENIED"
  | "FILE_UNSUPPORTED"
  | "FILE_TOO_LARGE"
  | "RUNTIME_ERROR"
  | "TOOL_ERROR"
  | "UNKNOWN_OUTCOME";
export interface RedactedReceipt {
  runtimeEpoch: string;
  operationId: string;
  type: Exclude<WorkbenchRequest["type"], ReadType>;
  workspaceId?: string;
  sessionId?: string;
  admission: "rejected" | "admitted" | "dispatched";
  delivery: "pending" | "accepted" | "unknown";
  effect: "none" | "pending" | "confirmed" | "failed" | "unknown";
  revision: number;
  evidence: { kind: string; id?: string }[];
  result?: ReceiptResult;
}
export type OperationLookup =
  | {
      status: "found";
      runtimeEpoch: string;
      operationId: string;
      receipt: RedactedReceipt;
    }
  | {
      status: "missing" | "wrong_epoch";
      runtimeEpoch: string;
      operationId: string;
      effect: "unknown";
    };

export type StoreRecoveryReason =
  | "owner_conflict"
  | "owner_unverified"
  | "corrupt_journal"
  | "unsupported_version"
  | "identity_conflict"
  | "unconfirmed_tail"
  | "writer_poisoned"
  | "pending_inbox"
  | "native_startup_unverified"
  | "storage_denied"
  | "retained_limit";
export type ResourceRecoveryReason =
  | "path_missing"
  | "path_denied"
  | "path_conflict"
  | "native_mapping_unverified"
  | "partial_native_mapping"
  | "unresolved_operation";
export type RecoveryResource = {
  workspaceId: string;
  sessionId?: string;
  state: "unavailable";
  reason: ResourceRecoveryReason;
};
export type WorkbenchRecovery = {
  store:
    | { state: "ready" }
    | { state: "recovery_required"; reason: StoreRecoveryReason };
  resources: RecoveryResource[];
};
export type RetainedOperationKey = {
  /** Host-authoritative unresolved effect/task hold; lookup success cannot release it. */
  authorityHold: boolean;
  runtimeEpoch: string;
  operationId: string;
  type: Exclude<WorkbenchRequest["type"], ReadType>;
  workspaceId?: string;
  sessionId?: string;
};
