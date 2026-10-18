export interface ProviderRow {
  id: string;
  name: string;
  connected: boolean;
  source: "credential" | "env" | "none";
}
export interface ProviderList {
  providers: ProviderRow[];
  local: { baseUrl: string };
}
export const DEFAULT_MODEL_STORAGE_KEY: string;
export const RECENT_MODELS_STORAGE_KEY: string;
export const FREE_ONLY_STORAGE_KEY: string;
export const PROVIDER_ERRORS: Readonly<Record<string, string>>;
export function providerErrorText(code: string): string;
export function sourceText(provider: ProviderRow): string;
export function parseProviderList(value: unknown): ProviderList;
export function loadDefaultModel(storage?: Pick<Storage, "getItem">): string;
export function saveDefaultModel(
  id: string,
  storage?: Pick<Storage, "setItem" | "removeItem">,
): void;
export function usableDefaultModel(
  catalogModels:
    | { status: string; entries?: readonly { id: string; free?: boolean }[] }
    | undefined,
  id: string,
): string;
export function loadRecentModels(storage?: Pick<Storage, "getItem">): string[];
export function pushRecentModel(
  id: string,
  storage?: Pick<Storage, "getItem" | "setItem">,
  validIds?: readonly string[],
): string[];
export function loadFreeOnly(
  storage?: Pick<Storage, "getItem">,
): boolean | undefined;
export function saveFreeOnly(
  value: boolean,
  storage?: Pick<Storage, "setItem">,
): void;
export function keepAutoModel(
  catalogModels:
    | { status: string; entries?: readonly { id: string }[] }
    | undefined,
  id: string,
): boolean;
export const UNAVAILABLE_MODELS_STORAGE_KEY: string;
export const FREE_ROUTER: Readonly<{ providerId: string; modelId: string }>;
interface RouterEntry {
  id: string;
  providerId?: string;
  modelId?: string;
  free?: boolean;
}
export function findFreeRouter<T extends RouterEntry>(
  catalogModels: { status: string; entries?: readonly T[] } | undefined,
): T | undefined;
export function showFirstRun(
  list: ProviderList | undefined,
  messageCount: number,
): boolean;
export function freeFailure(
  entries: readonly RouterEntry[],
  model: { providerId: string; id: string } | undefined,
  status: number | undefined,
): { kind: "unavailable" | "limit"; id?: string } | undefined;
export function turnFailure(
  entries: readonly RouterEntry[],
  model: { providerId: string; id: string } | undefined,
  failure: { status?: number; kind?: "auth" | "network" } | undefined,
):
  | {
      kind: "unavailable" | "limit" | "auth" | "refused" | "server";
      id?: string;
    }
  | undefined;
export function inlineExplained(
  kind: string | undefined,
  errorCode: string | undefined,
): boolean;
export const UNAVAILABLE_TTL_MS: number;
export function loadUnavailableModels(
  storage?: Pick<Storage, "getItem">,
  now?: number,
): string[];
export function markModelUnavailable(
  id: string,
  storage?: Pick<Storage, "getItem" | "setItem">,
  now?: number,
): string[];
export function clearModelUnavailable(
  id: string,
  storage?: Pick<Storage, "getItem" | "setItem">,
  now?: number,
): string[];
export function retryablePrompt(
  userMessage: { role: string; text?: string; context?: unknown } | undefined,
): string | undefined;
