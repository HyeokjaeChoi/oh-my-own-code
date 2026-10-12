// Pure provider-settings helpers. The API key is only ever the argument of a
// connect request; nothing here keeps, returns or formats it.
export const DEFAULT_MODEL_STORAGE_KEY = "omoc.defaultModel.v1";
export const PROVIDER_ERRORS = Object.freeze({
  INVALID_KEY: "API 키가 올바르지 않습니다. 키를 다시 확인해 주세요.",
  INVALID_REQUEST: "입력값이 올바르지 않습니다.",
  NOT_FOUND: "알 수 없는 제공자입니다.",
  UNAVAILABLE:
    "Native에 연결할 수 없습니다. 네트워크 또는 런타임 상태를 확인해 주세요.",
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

// The stored default applies only while the catalog still offers it.
export const usableDefaultModel = (catalogModels, id) =>
  catalogModels?.status === "available" &&
  catalogModels.entries.some((entry) => entry.id === id)
    ? id
    : "";
