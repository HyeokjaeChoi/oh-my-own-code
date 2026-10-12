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
    | { status: string; entries?: readonly { id: string }[] }
    | undefined,
  id: string,
): string;
