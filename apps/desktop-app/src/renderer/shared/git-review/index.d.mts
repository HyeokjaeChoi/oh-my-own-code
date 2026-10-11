export const GIT_REVIEW_LIMITS: Readonly<{
  candidates: 4096;
  files: 512;
  branches: 128;
  branchBytes: 512;
  sourceBytes: 65536;
  patchBytes: 65536;
  patchLines: 2048;
  patchHunks: 128;
  dtoBytes: 196608;
  envelopeBytes: 262144;
  indexBytes: 16777216;
  metadataBytes: 1048576;
  objectBytes: 134217728;
  objectFiles: 16384;
  refs: 4096;
  refDepth: 32;
  copyChunkBytes: 1048576;
  stdoutBytes: 16777216;
  childStdoutBytes: 8388608;
  stderrBytes: 8192;
  deadlineMs: 8000;
  childMs: 2000;
  termMs: 250;
  exitMs: 1500;
  observationsPerWorkspace: 4;
  observations: 256;
  observationMs: 30000;
}>;
export type GitReviewReason =
  | "not_repository"
  | "not_repository_root"
  | "platform_unavailable"
  | "git_unavailable"
  | "unsupported_repository"
  | "unsupported_configuration"
  | "path_denied"
  | "path_changed"
  | "metadata_changed"
  | "too_large"
  | "read_failed"
  | "process_unverified";
export type GitDiffReason =
  | GitReviewReason
  | "protected_source"
  | "binary"
  | "missing_file"
  | "conflict"
  | "not_staged"
  | "expired_observation"
  | "stale_observation";
export type GitDiffMode = "staged" | "unstaged" | "base";
export type GitFileState =
  | "none"
  | "added"
  | "modified"
  | "deleted"
  | "type_changed"
  | "unmerged";
export const GIT_REVIEW_REASONS: readonly GitReviewReason[];
export const GIT_DIFF_REASONS: readonly GitDiffReason[];
export const GIT_DIFF_MODES: readonly GitDiffMode[];
export const GIT_FILE_STATES: readonly GitFileState[];
export type GitReviewRequest = { type: "git.review.read"; workspaceId: string };
export type GitDiffRequest = {
  type: "git.diff.read";
  workspaceId: string;
  observationId: string;
  path: string;
} & (
  | { mode: "staged" | "unstaged"; baseRef?: never }
  | { mode: "base"; baseRef: string }
);
export type GitRepository = {
  worktreePath: string;
  gitDirectory: string;
  commonDirectory: string;
  objectFormat: "sha1" | "sha256";
  head: string | null;
  branch: string | null;
};
export type GitBranch = { name: string; oid: string };
export type GitFile = {
  path: string;
  index: GitFileState;
  worktree: GitFileState;
  kind: "tracked" | "untracked" | "conflict";
};
export type GitReadScope = {
  runtimeEpoch: string;
  revision: number;
  workspaceId: string;
  workspacePath: string;
};
export type WorkbenchGitReview = GitReadScope &
  (
    | {
        status: "available";
        observationId: string;
        repository: GitRepository;
        branches: GitBranch[];
        files: GitFile[];
        contentDigest?: string;
      }
    | { status: "unavailable"; reason: GitReviewReason }
  );
export type WorkbenchGitDiff = GitReadScope & {
  observationId: string;
  path: string;
} & (
    | { mode: "staged" | "unstaged"; baseRef?: never; baseOid?: never }
    | { mode: "base"; baseRef: string; baseOid: string }
  ) &
  (
    | { status: "available"; patch: string; sourceDigest: string }
    | { status: "unavailable"; reason: GitDiffReason }
  );
export function validGitDigest(value: unknown): value is string;
export function validGitOid(
  value: unknown,
  format?: "sha1" | "sha256",
): value is string;
export function validGitBranch(value: unknown): value is string;
export function validateGitReviewRequest(
  value: unknown,
): GitReviewRequest | GitDiffRequest;
export function validateGitReviewObservation(
  value: unknown,
): WorkbenchGitReview;
export function validateGitDiffObservation(value: unknown): WorkbenchGitDiff;
