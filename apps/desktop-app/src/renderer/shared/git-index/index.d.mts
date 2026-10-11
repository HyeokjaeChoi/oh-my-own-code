import type { GitReviewReason } from "../git-review/index.mjs";

export type GitIndexAction = "stage" | "unstage";
export type GitIndexReason =
  | GitReviewReason
  | "protected_source"
  | "missing_file"
  | "conflict"
  | "expired_observation"
  | "stale_observation"
  | "expired_preview"
  | "stale_preview"
  | "lock_conflict"
  | "no_changes"
  | "busy"
  | "unsupported_index_mutation";
export type GitIndexTarget = {
  action: GitIndexAction;
  paths: string[];
  previewDigest: string;
  headOid: string | null;
  indexExists: boolean;
  indexDigest: string;
  nextIndexDigest: string;
  objectFormat: "sha1" | "sha256";
};
export type GitIndexPreviewRequest = {
  type: "git.index.preview.read";
  workspaceId: string;
  observationId: string;
  action: GitIndexAction;
  paths: string[];
};
export type GitIndexApplyRequest = GitIndexTarget & {
  type: "git.index.apply";
  workspaceId: string;
  requestId: string;
  previewId: string;
};
export type GitIndexEntry = { mode: 0o100644 | 0o100755; oid: string };
export type WorkbenchGitIndexPreview = {
  runtimeEpoch: string;
  revision: number;
  workspaceId: string;
  workspacePath: string;
} & (
  | (GitIndexTarget & {
      status: "available";
      previewId: string;
      entries: {
        path: string;
        before: GitIndexEntry | null;
        after: GitIndexEntry | null;
      }[];
    })
  | { status: "unavailable"; reason: GitIndexReason }
);
export type WorkbenchGitIndexApply =
  | {
      requestId: string;
      status: "applied";
      indexDigest: string;
      backupId: string | null;
    }
  | { requestId: string; status: "unknown" };
export type GitIndexReceiptResult = {
  kind: "git_index_updated";
  workspaceId: string;
  action: GitIndexAction;
  paths: string[];
  indexDigest: string;
  previewDigest: string;
  backupId: string | null;
  digest: string;
};
export const GIT_INDEX_FEATURE: "git_index_mutation_v1";
export const GIT_INDEX_STEPS: Readonly<{
  stage: "filesystem.git.index.stage";
  publish: "filesystem.git.index.publish";
}>;
export const GIT_ABSENT_INDEX_DIGEST: string;
export const GIT_INDEX_LIMITS: Readonly<{
  paths: 128;
  pathBytes: 32768;
  dtoBytes: 196608;
  previewsPerWorkspace: 16;
  previews: 64;
  previewMs: 60000;
}>;
export const GIT_INDEX_REASONS: readonly GitIndexReason[];
export const GIT_INDEX_TARGET_FIELDS: readonly (keyof GitIndexTarget)[];
export function validGitIndexPaths(value: unknown): value is string[];
export function validGitIndexTarget(value: unknown): value is GitIndexTarget;
export function validateGitIndexRequest(
  value: unknown,
): GitIndexPreviewRequest | GitIndexApplyRequest;
export function gitIndexTargetFromApply(value: unknown): GitIndexTarget;
export function validateGitIndexPreview(
  value: unknown,
): WorkbenchGitIndexPreview;
export function validGitIndexBackupId(value: unknown): value is string;
export function validateGitIndexMutationResult(
  value: unknown,
): WorkbenchGitIndexApply;
export function validateGitIndexReceiptResult(
  value: unknown,
  expected: {
    workspaceId: string;
    target: GitIndexTarget;
    digest: string;
    backupId: string | null;
  },
): GitIndexReceiptResult;
