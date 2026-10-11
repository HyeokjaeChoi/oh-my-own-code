import type { GitIndexReason, GitIndexEntry } from "../git-index/index.mjs";
export type GitCommitReason =
  | GitIndexReason
  | "unsupported_commit_state"
  | "unsupported_commit"
  | "identity_changed";
export type GitCommitAuthor = { name: string; email: string };
export type GitCommitLogRole = "head_log" | "branch_log";
export type GitCommitBackupRole = GitCommitLogRole | "head_ref" | "branch_ref";
export type GitCommitBackup = {
  role: GitCommitBackupRole;
  backupId: string | null;
};
export type GitCommitLogDigest = { role: GitCommitLogRole; digest: string };
export type GitCommitTarget = {
  objectFormat: "sha1" | "sha256";
  previewDigest: string;
  indexDigest: string;
  headOid: string | null;
  treeOid: string;
  treeDigest: string;
  commitOid: string;
  commitBodyDigest: string;
  reference: {
    kind: "branch" | "head";
    name: string | null;
    exists: boolean;
    digest: string;
    nextDigest: string;
  };
  logs: {
    role: GitCommitLogRole;
    exists: boolean;
    digest: string;
    nextDigest: string;
    nextBytes: number;
  }[];
};
export type GitCommitPreviewRequest = {
  type: "git.commit.preview.read";
  workspaceId: string;
  observationId: string;
  author: GitCommitAuthor;
  message: string;
};
export type GitCommitApplyRequest = GitCommitTarget & {
  type: "git.commit.apply";
  workspaceId: string;
  requestId: string;
  previewId: string;
};
export type WorkbenchGitCommitPreview = {
  runtimeEpoch: string;
  revision: number;
  workspaceId: string;
  workspacePath: string;
} & (
  | (GitCommitTarget & {
      status: "available";
      previewId: string;
      author: GitCommitAuthor;
      timestamp: number;
      canonicalMessage: string;
      entries: {
        path: string;
        before: GitIndexEntry | null;
        after: GitIndexEntry | null;
      }[];
    })
  | { status: "unavailable"; reason: GitCommitReason }
);
export type WorkbenchGitCommitApply =
  | { requestId: string; status: "unknown" }
  | {
      requestId: string;
      status: "committed";
      commitOid: string;
      treeOid: string;
      referenceDigest: string;
      logDigests: GitCommitLogDigest[];
      backups: GitCommitBackup[];
    };
export type GitCommitReceiptResult = {
  kind: "git_commit_created";
  workspaceId: string;
  commitOid: string;
  treeOid: string;
  parentOid: string | null;
  referenceDigest: string;
  logDigests: GitCommitLogDigest[];
  previewDigest: string;
  backups: GitCommitBackup[];
  digest: string;
};
export const GIT_COMMIT_FEATURE: "git_commit_mutation_v1";
export const GIT_COMMIT_STEPS: Readonly<{
  stage: "filesystem.git.commit.stage";
  publish: "filesystem.git.commit.publish";
}>;
export const GIT_COMMIT_LIMITS: Readonly<{
  paths: 128;
  pathBytes: 32768;
  identityBytes: 256;
  messageBytes: 65536;
  dtoBytes: 196608;
  previewsPerWorkspace: 16;
  previews: 64;
  previewMs: 60000;
  treeEntries: 4096;
}>;
export const GIT_COMMIT_REASONS: readonly GitCommitReason[];
export const GIT_COMMIT_REFLOG_REASON: "commit: explicit local app commit";
export const GIT_COMMIT_ABSENT_DIGEST: string;
export const GIT_COMMIT_TARGET_FIELDS: readonly (keyof GitCommitTarget)[];
export const GIT_COMMIT_LOG_ROLES: readonly GitCommitLogRole[];
export const GIT_COMMIT_BACKUP_ROLES: readonly GitCommitBackupRole[];
export function validGitCommitAuthor(v: unknown): v is GitCommitAuthor;
export function validGitCommitMessage(v: unknown): v is string;
export function canonicalGitCommitMessage(v: unknown): string;
export function validGitCommitBranch(v: unknown): v is string;
export function validGitCommitTarget(v: unknown): v is GitCommitTarget;
export function validateGitCommitRequest(
  v: unknown,
): GitCommitPreviewRequest | GitCommitApplyRequest;
export function gitCommitTargetFromApply(v: unknown): GitCommitTarget;
export function validateGitCommitPreview(v: unknown): WorkbenchGitCommitPreview;
export function validGitCommitBackupId(v: unknown): v is string;
export function validateGitCommitMutationResult(
  v: unknown,
): WorkbenchGitCommitApply;
export function validateGitCommitReceiptResult(
  v: unknown,
  expected: {
    workspaceId: string;
    target: GitCommitTarget;
    digest: string;
    backups: GitCommitBackup[];
  },
): GitCommitReceiptResult;
