export const EXPORT_FORMAT: "omoc-session-export";
export const EXPORT_VERSION: 1;
export const RETENTION_OPTIONS: readonly [0, 30, 90, 365];
export const WIPE_WORD: "삭제";
export const DATA_LIMITS: Readonly<Record<string, number>>;
export type ExportTool = {
  id: string;
  name: string;
  status: "pending" | "running" | "completed" | "error";
  input: string;
  output?: string;
};
export type ExportMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  tools?: ExportTool[];
};
export type ExportSession = {
  meta: {
    id: string;
    title: string;
    messageCount: number;
    toolOutputsIncluded: boolean;
  };
  messages: ExportMessage[];
};
export type ExportDoc = {
  format: typeof EXPORT_FORMAT;
  version: 1;
  exportedAt: string;
  app: { name: string; version: string };
  sessions: ExportSession[];
};
export type ExportSummary = {
  sessions: number;
  messages: number;
  tools: number;
  toolOutputsIncluded: boolean;
  toolOutputs: number;
  redactions: { secrets: number; home: number; envOutputs: number };
};
export type ExportInput = {
  session: { id: string; title: string };
  messages: readonly unknown[];
  includeToolOutputs: boolean;
};
export type ArchiveInfo = {
  id: string;
  importedAt: string;
  exportedAt: string;
  sessions: number;
  messages: number;
  title: string;
};
export type DataRequest =
  | ({ type: "export.preview" | "export.save" } & ExportInput)
  | {
      type: "import.open" | "archives.list" | "retention.get" | "wipe.info";
    }
  | { type: "archives.get" | "archives.remove"; id: string }
  | { type: "retention.preview" | "retention.set"; days: number }
  | { type: "wipe.run"; word: string };
export type DataResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: string };
export function redactText(
  value: unknown,
  options?: { home?: string },
): { text: string; counts: { secrets: number; home: number } };
export function buildExport(input: {
  session: { id: string; title: string };
  messages: readonly unknown[];
  includeToolOutputs?: boolean;
  now: string;
  home?: string;
  appVersion?: string;
}): { doc: ExportDoc; summary: ExportSummary };
export function parseImport(
  text: unknown,
): { doc: ExportDoc } | { error: string };
export function retentionCandidates<T extends { at: string }>(
  rows: readonly T[],
  days: number,
  now: string,
): T[];
export function validateDataRequest(value: unknown): DataRequest | undefined;
