import type { WorkbenchFileObservation } from "../workspace-file/index.mjs";
import type { WorkbenchGitDiff } from "../git-review/index.mjs";

export const LINE_FEEDBACK_LIMITS: Readonly<{
  lines: 200;
  excerptCharacters: 8192;
  excerptBytes: 32768;
  commentCharacters: 2000;
  draftCharacters: 32000;
}>;
export type LineFeedbackSource =
  | Readonly<{ kind: "file"; observation: WorkbenchFileObservation }>
  | Readonly<{ kind: "git"; observation: WorkbenchGitDiff }>;
export type LineFeedbackSelection = Readonly<{
  side: "file" | "old" | "new";
  start: number;
  end: number;
}>;
type CommonReference = Readonly<{
  runtimeEpoch: string;
  revision: number;
  workspaceId: string;
  workspacePath: string;
  path: string;
  start: number;
  end: number;
}>;
export type LineFeedbackReference = CommonReference &
  (
    | Readonly<{
        kind: "file";
        side: "file";
        targetPath: string;
        version: string;
        directoryVersion: string;
      }>
    | (Readonly<{
        kind: "git";
        side: "old" | "new";
        observationId: string;
        sourceDigest: string;
      }> &
        (
          | Readonly<{
              mode: "staged" | "unstaged";
              baseRef?: never;
              baseOid?: never;
            }>
          | Readonly<{ mode: "base"; baseRef: string; baseOid: string }>
        ))
  );
export type LineFeedback = Readonly<{
  reference: LineFeedbackReference;
  excerpt: string;
  comment: string;
  text: string;
}>;
export function formatLineFeedback(
  source: LineFeedbackSource,
  selection: LineFeedbackSelection,
  comment: string,
): LineFeedback;
export function appendLineFeedback(
  existingText: string,
  formattedText: string,
): string;
