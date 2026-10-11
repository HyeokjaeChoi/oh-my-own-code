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
  status: "idle" | "running" | "stopping" | "unknown";
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
  state: "connected" | "disconnected" | "unavailable";
  temporary: true;
  workspaces: WorkbenchWorkspace[];
  sessions: WorkbenchSession[];
  selectedWorkspaceId?: string;
  selectedSessionId?: string;
  messages: WorkbenchMessage[];
  permissions: WorkbenchPermission[];
  error?: { code: string; message: string };
}
export interface WorkbenchCatalogEntry {
  id: string;
  name: string;
  description?: string;
  status?: string;
}
export interface WorkbenchCatalogGroup {
  status: "available" | "unavailable";
  entries: WorkbenchCatalogEntry[];
}
export interface WorkbenchCatalog {
  commands: WorkbenchCatalogGroup;
  skills: WorkbenchCatalogGroup;
  mcp: WorkbenchCatalogGroup;
  agents: WorkbenchCatalogGroup;
  models: WorkbenchCatalogGroup;
}
export interface WorkbenchFileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
}
export interface WorkbenchFileList {
  path: string;
  entries: WorkbenchFileEntry[];
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
  | { type: "operation.lookup"; runtimeEpoch: string; operationId: string }
  | ({ type: "session.rename"; title: string } & SessionLifecycleTarget)
  | ({ type: "session.pin"; pinned: boolean } & SessionLifecycleTarget)
  | ({ type: "session.archive"; archived: boolean } & SessionLifecycleTarget)
  | ({ type: "session.fork"; title?: string } & SessionLifecycleTarget)
  | ({ type: "session.remove" } & SessionLifecycleTarget)
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
  | { type: "file.read"; workspaceId: string; path: string };
export type WorkbenchResponse<R extends WorkbenchRequest> = R extends {
  type: "operation.lookup";
}
  ? OperationLookup
  : R extends {
        type: "catalog.list";
      }
    ? WorkbenchCatalog
    : R extends { type: "diagnostics.list" }
      ? WorkbenchDiagnostics
      : R extends { type: "file.list" }
        ? WorkbenchFileList
        : R extends { type: "file.read" }
          ? WorkbenchFileRead
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
  | "snapshot"
  | "diagnostics.list"
  | "catalog.list"
  | "file.list"
  | "file.read"
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
  | { kind: "metadata"; workspaceId: string; sessionId: string }
  | {
      kind: "delivery";
      nativeInboxId?: string;
      nativeRequestId?: string;
      status: "accepted" | "stopping" | "decided";
    }
  | { kind: "rejected"; code: WorkbenchErrorCode };
export type WorkbenchErrorCode =
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
