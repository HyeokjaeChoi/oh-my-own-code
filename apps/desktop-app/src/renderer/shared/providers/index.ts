export {
  DEFAULT_MODEL_STORAGE_KEY,
  PROVIDER_ERRORS,
  providerErrorText,
  sourceText,
  parseProviderList,
  loadDefaultModel,
  saveDefaultModel,
  usableDefaultModel,
  keepAutoModel,
  loadRecentModels,
  pushRecentModel,
  loadFreeOnly,
  saveFreeOnly,
  FREE_ROUTER,
  findFreeRouter,
  showFirstRun,
  freeFailure,
  loadUnavailableModels,
  markModelUnavailable,
} from "./index.mjs";
export type { ProviderRow, ProviderList } from "./index.mjs";
export type ProviderRequest =
  | { type: "provider.list" }
  | { type: "provider.connect"; id: string; key: string }
  | { type: "provider.remove"; id: string }
  | { type: "provider.local"; baseUrl: string };
export async function callProvider<T>(
  request: ProviderRequest,
): Promise<{ ok: true; value: T } | { ok: false; code: string }> {
  try {
    return (await window.desktopBridge.provider(request)) as {
      ok: true;
      value: T;
    };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}
