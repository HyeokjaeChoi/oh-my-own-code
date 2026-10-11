import type { GitIndexReason, GitIndexEntry } from "../git-index/index.mjs";
import type { GitCommitAuthor } from "../git-commit/index.mjs";
export type GitBranchRestoreReason =
  | GitIndexReason
  | "unsupported_branch_restore_state"
  | "unsupported_branch_restore"
  | "branch_occupied"
  | "branch_conflict"
  | "identity_changed";
export type GitBranchRestoreAction = "create" | "select" | "restore";
export type GitBranchRestoreSource = "index" | "head";
export type GitBranchRestoreMetadataRole =
  | "index"
  | "head_log"
  | "head_ref"
  | "branch_log"
  | "branch_ref";
export type GitBranchRestoreFileState = {
  bytes: number;
  digest: string;
  mode: number;
};
export type GitBranchRestoreByteState = { bytes: number; digest: string };
export type GitBranchRestorePath = {
  path: string;
  before: GitBranchRestoreFileState | null;
  after: GitBranchRestoreFileState | null;
  beforeEntry: GitIndexEntry | null;
  afterEntry: GitIndexEntry | null;
  ident: boolean;
};
export type GitBranchRestoreMetadata = {
  role: GitBranchRestoreMetadataRole;
  before: GitBranchRestoreByteState | null;
  after: GitBranchRestoreByteState;
};
export type GitBranchRestoreTarget = {
  action: GitBranchRestoreAction;
  objectFormat: "sha1" | "sha256";
  previewDigest: string;
  occupancyDigest: string;
  branch: string | null;
  source: GitBranchRestoreSource | null;
  currentBranch: string | null;
  headOid: string;
  nextHeadOid: string;
  treeOid: string;
  headDigest: string;
  indexExists: boolean;
  indexDigest: string;
  identityDigest: string | null;
  timestamp: number | null;
  paths: GitBranchRestorePath[];
  metadata: GitBranchRestoreMetadata[];
};
export type GitBranchPreviewRequest = {
  type: "git.branch.preview.read";
  workspaceId: string;
  observationId: string;
  action: "create" | "select";
  branch: string;
  author: GitCommitAuthor;
};
export type GitRestorePreviewRequest = {
  type: "git.restore.preview.read";
  workspaceId: string;
  observationId: string;
  source: GitBranchRestoreSource;
  paths: string[];
};
export type GitBranchApplyRequest = GitBranchRestoreTarget & {
  type: "git.branch.apply";
  workspaceId: string;
  requestId: string;
  previewId: string;
};
export type GitRestoreApplyRequest = GitBranchRestoreTarget & {
  type: "git.restore.apply";
  workspaceId: string;
  requestId: string;
  previewId: string;
};
export type WorkbenchGitBranchRestorePreview = {
  runtimeEpoch: string;
  revision: number;
  workspaceId: string;
  workspacePath: string;
} & (
  | { status: "unavailable"; reason: GitBranchRestoreReason }
  | (GitBranchRestoreTarget & {
      status: "available";
      previewId: string;
      author: GitCommitAuthor | null;
    })
);
export type GitBranchRestoreBackup = {
  role: "worktree" | GitBranchRestoreMetadataRole;
  path: string | null;
  backupId: string | null;
};
export type GitBranchRestoreCompleted = {
  action: GitBranchRestoreAction;
  previewDigest: string;
  paths: { path: string; after: GitBranchRestoreFileState | null }[];
  metadata: { role: GitBranchRestoreMetadataRole; digest: string }[];
  backups: GitBranchRestoreBackup[];
};
export type WorkbenchGitBranchRestoreApply = { requestId: string } & (
  | { status: "unknown" }
  | ({ status: "applied" } & GitBranchRestoreCompleted)
);
export type GitBranchRestoreReceiptResult = GitBranchRestoreCompleted & {
  kind: "git_branch_restore_applied";
  workspaceId: string;
  digest: string;
};
export const GIT_BRANCH_RESTORE_FEATURE: "git_branch_restore_mutation_v1";
export const GIT_BRANCH_RESTORE_STEPS: Readonly<{
  stage: "filesystem.git.branch_restore.stage";
  publish: "filesystem.git.branch_restore.publish";
}>;
export const GIT_BRANCH_RESTORE_LIMITS: Readonly<{
  paths: 128;
  pathBytes: 32768;
  fileBytes: 16777216;
  affectedBytes: 16777216;
  dtoBytes: 196608;
  previewsPerWorkspace: 16;
  previews: 64;
  previewMs: 60000;
  treeEntries: 4096;
}>;
export const GIT_BRANCH_RESTORE_REASONS: readonly GitBranchRestoreReason[];
export const GIT_BRANCH_RESTORE_METADATA_ROLES: readonly GitBranchRestoreMetadataRole[];
export const GIT_BRANCH_RESTORE_TARGET_FIELDS: readonly (keyof GitBranchRestoreTarget)[];
export function gitBranchRestoreMode(
  oldMode: number | null,
  executable: boolean,
): number;
export function validGitBranchRestorePaths(v: unknown): v is string[];
export function validGitBranchRestoreTarget(
  v: unknown,
): v is GitBranchRestoreTarget;
export function validateGitBranchRestoreRequest(
  v: unknown,
):
  | GitBranchPreviewRequest
  | GitRestorePreviewRequest
  | GitBranchApplyRequest
  | GitRestoreApplyRequest;
export function gitBranchRestoreTargetFromApply(
  v: unknown,
): GitBranchRestoreTarget;
export function validateGitBranchRestorePreview(
  v: unknown,
): WorkbenchGitBranchRestorePreview;
export function validGitBranchRestoreBackupId(v: unknown): v is string;
export function gitBranchRestoreBackupRoles(v: GitBranchRestoreTarget): {
  role: "worktree" | GitBranchRestoreMetadataRole;
  path: string | null;
  exists: boolean;
}[];
export function validateGitBranchRestoreMutationResult(
  v: unknown,
): WorkbenchGitBranchRestoreApply;
export function validateGitBranchRestoreReceiptResult(
  v: unknown,
  expected: {
    workspaceId: string;
    target: GitBranchRestoreTarget;
    digest: string;
    backups: GitBranchRestoreBackup[];
  },
): GitBranchRestoreReceiptResult;
