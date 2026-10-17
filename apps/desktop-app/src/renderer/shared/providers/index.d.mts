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
