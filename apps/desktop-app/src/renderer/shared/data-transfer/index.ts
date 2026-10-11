export {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  RETENTION_OPTIONS,
  WIPE_WORD,
  DATA_LIMITS,
  redactText,
  buildExport,
  parseImport,
  retentionCandidates,
  validateDataRequest,
} from "./index.mjs";
export type {
  ExportDoc,
  ExportSession,
  ExportMessage,
  ExportTool,
  ExportSummary,
  ExportInput,
  ArchiveInfo,
  DataRequest,
  DataResult,
} from "./index.mjs";
export async function callData<T>(
  request: import("./index.mjs").DataRequest,
): Promise<import("./index.mjs").DataResult<T>> {
  try {
    return (await window.desktopBridge.data(
      request,
    )) as import("./index.mjs").DataResult<T>;
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}
