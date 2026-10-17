// Pure provider-settings helpers. The API key is only ever the argument of a
// connect request; nothing here keeps, returns or formats it.
export const DEFAULT_MODEL_STORAGE_KEY = "omoc.defaultModel.v1";
export const RECENT_MODELS_STORAGE_KEY = "omoc.recentModels.v1";
export const FREE_ONLY_STORAGE_KEY = "omoc.modelFreeOnly.v1";
export const PROVIDER_ERRORS = Object.freeze({
  INVALID_KEY: "API 키가 올바르지 않습니다. 키를 다시 확인해 주세요.",
  INVALID_REQUEST: "입력값이 올바르지 않습니다.",
  NOT_FOUND: "알 수 없는 제공자입니다.",
  UNAVAILABLE: "런타임에 연결할 수 없습니다. 네트워크 상태를 확인해 주세요.",
});
export const providerErrorText = (code) =>
  PROVIDER_ERRORS[code] ?? PROVIDER_ERRORS.UNAVAILABLE;
export const sourceText = (provider) =>
  !provider.connected
    ? "연결 안 됨"
    : provider.source === "env"
      ? "환경 변수로 연결됨"
      : "설정됨";

// Reply of provider.list -> rows. Unknown shapes yield an empty list.
export function parseProviderList(value) {
  const list = Array.isArray(value?.providers) ? value.providers : [];
  return {
    providers: list.filter(
      (p) => typeof p?.id === "string" && typeof p.name === "string",
    ),
    local: {
      baseUrl:
        typeof value?.local?.baseUrl === "string" ? value.local.baseUrl : "",
    },
  };
}

export function loadDefaultModel(storage = globalThis.localStorage) {
  try {
    const value = storage?.getItem(DEFAULT_MODEL_STORAGE_KEY);
    return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)
      ? value
      : "";
  } catch {
    return "";
  }
}
export function saveDefaultModel(id, storage = globalThis.localStorage) {
  try {
    if (id) storage?.setItem(DEFAULT_MODEL_STORAGE_KEY, id);
    else storage?.removeItem(DEFAULT_MODEL_STORAGE_KEY);
  } catch {
    // Blocked storage: the default lasts for this session only.
  }
}

// The stored default applies only while the catalog still offers it. With no
// usable stored default, a catalog that offers only free models (a fresh
// profile) starts on the first one, in the order the runtime lists them.
export function usableDefaultModel(catalogModels, id) {
  if (catalogModels?.status !== "available") return "";
  const { entries } = catalogModels;
  if (entries.some((entry) => entry.id === id)) return id;
  return entries.length && entries.every((entry) => entry.free === true)
    ? entries[0].id
    : "";
}

// Model picker memory, kept per profile in the same renderer storage as the
// default model: the last 3 chosen model ids and the "무료만" choice.
export function loadRecentModels(storage = globalThis.localStorage) {
  try {
    const list = JSON.parse(
      storage?.getItem(RECENT_MODELS_STORAGE_KEY) ?? "[]",
    );
    return Array.isArray(list)
      ? list
          .filter((id) => typeof id === "string" && /^[a-f0-9]{64}$/u.test(id))
          .slice(0, 3)
      : [];
  } catch {
    return [];
  }
}
// Saving also prunes ids the catalog no longer offers (validIds, when given).
export function pushRecentModel(
  id,
  storage = globalThis.localStorage,
  validIds,
) {
  const next = [id, ...loadRecentModels(storage).filter((x) => x !== id)]
    .filter((x) => !validIds || validIds.includes(x))
    .slice(0, 3);
  try {
    storage?.setItem(RECENT_MODELS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Blocked storage: recents last for this session only.
  }
  return next;
}
export function loadFreeOnly(storage = globalThis.localStorage) {
  try {
    const value = storage?.getItem(FREE_ONLY_STORAGE_KEY);
    return value === "1" ? true : value === "0" ? false : undefined;
  } catch {
    return undefined;
  }
}
export function saveFreeOnly(value, storage = globalThis.localStorage) {
  try {
    storage?.setItem(FREE_ONLY_STORAGE_KEY, value ? "1" : "0");
  } catch {
    // Blocked storage: the choice lasts for this session only.
  }
}

// An auto-picked model stays while the catalog offers it, and while the catalog
// is unknown. Only its removal replaces it: a newly added paid key must never
// clear or swap what the user is already on.
export const keepAutoModel = (catalogModels, id) =>
  catalogModels?.status !== "available" ||
  catalogModels.entries.some((entry) => entry.id === id);
