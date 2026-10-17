export interface ContextSelection {
  version: string;
  start: number;
  end: number;
}
export interface ContextDescriptor {
  capabilityId: string;
  workspaceId: string;
  workspacePath: string;
  path: string;
  name: string;
  source: "file" | "selection";
  version: string;
  digest: string;
  mime:
    | "text/plain"
    | "image/png"
    | "image/jpeg"
    | "image/gif"
    | "image/webp"
    | "application/pdf";
  size: number;
  range?: { start: number; end: number };
}
export type ContextPreview =
  | { kind: "text"; text: string }
  | { kind: "image"; dataUrl: string }
  | { kind: "pdf" };
export type ContextObservation = {
  runtimeEpoch: string;
  revision: number;
  workspaceId: string;
  workspacePath: string;
  path: string;
} & (
  | {
      status: "available";
      descriptor: ContextDescriptor;
      preview: ContextPreview;
    }
  | {
      status: "unavailable" | "unsupported";
      reason:
        | "missing_file"
        | "path_missing"
        | "path_denied"
        | "file_changed"
        | "protected_source"
        | "too_large"
        | "unsupported_content"
        | "selection_changed"
        | "capacity_exceeded";
    }
);
export const CONTEXT_LIMITS: Readonly<{
  textBytes: 65536;
  fileBytes: 8388608;
  sendBytes: 16777216;
  items: 8;
  cacheBytes: 67108864;
  cacheEntries: 64;
  idleMs: 600000;
}>;
export function validContextSelection(
  value: unknown,
): value is ContextSelection;
export function validContextDescriptor(
  value: unknown,
): value is ContextDescriptor;
export function validContextList(value: unknown): value is ContextDescriptor[];
export function contextModelSupports(
  options: unknown,
  descriptors: unknown,
): boolean;
export function validateContextObservation(value: unknown): ContextObservation;
export interface InboxObservation {
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
export function validateInboxObservation(value: unknown): InboxObservation;
export interface InboxCancelResult {
  kind: "inbox_cancel_requested";
  workspaceId: string;
  sessionId: string;
  inboxId: string;
  digest: string;
}
export interface HistoricalContext {
  status: "unavailable";
  count?: number;
}
export function validInboxCancelResult(
  value: unknown,
): value is InboxCancelResult;
export function validHistoricalContext(
  value: unknown,
): value is HistoricalContext;
export function revertFilesText(revert: {
  fileCount: number;
  filesRestored: boolean;
}): string;
