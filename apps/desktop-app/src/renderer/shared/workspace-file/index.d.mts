export const WORKSPACE_FILE_FEATURE: "workspace_file_save_v1";
export const WORKSPACE_FILE_LIMITS: Readonly<{
  bytes: 65536;
  pathBytes: 2048;
  rootBytes: 4096;
  components: 32;
  componentBytes: 255;
}>;
export type WorkspaceFileIssue = "too_large" | "unsupported_content";
export type WorkspaceFileValidation = {
  status: "valid" | "invalid";
  issues: WorkspaceFileIssue[];
};
export type WorkbenchFileObservation = {
  runtimeEpoch: string;
  revision: number;
  workspaceId: string;
  workspacePath: string;
  path: string;
  targetPath: string;
} & (
  | {
      status: "available";
      content: string;
      version: string;
      directoryVersion: string;
    }
  | {
      status: "unavailable";
      reason: "missing_file" | "path_missing" | "path_denied" | "file_changed";
    }
  | {
      status: "unsupported";
      reason: "protected_source" | "too_large" | "unsupported_content";
    }
);
export type WorkbenchFileSave = { requestId: string } & (
  | { status: "saved"; version: string; backupId: string }
  | { status: "unknown" }
);
export function validWorkspaceFilePath(value: unknown): value is string;
export function validWorkspaceFileRoot(value: unknown): value is string;
export function workspaceFilePathReason(
  value: unknown,
): "invalid_path" | "protected_source" | undefined;
export function workspaceFileTargetPath(
  root: unknown,
  path: unknown,
): string | undefined;
export function workspaceFileContentFits(text: unknown): text is string;
export function workspaceFileWriteFits(text: unknown): text is string;
export const workspaceFileIssueMessages: Readonly<
  Record<WorkspaceFileIssue, string>
>;
export function validateWorkspaceFileText(
  text: unknown,
): WorkspaceFileValidation;
export function validateWorkspaceFileObservation(
  value: unknown,
): WorkbenchFileObservation;
export function validateWorkspaceFileSave(value: unknown): WorkbenchFileSave;
