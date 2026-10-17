import { isFreeModel } from "../runtime-options/index.mjs";

// Pure provider-settings helpers. The API key is only ever the argument of a
// connect request; nothing here keeps, returns or formats it.
export const DEFAULT_MODEL_STORAGE_KEY = "omoc.defaultModel.v1";
export const RECENT_MODELS_STORAGE_KEY = "omoc.recentModels.v1";
export const FREE_ONLY_STORAGE_KEY = "omoc.modelFreeOnly.v1";
export const UNAVAILABLE_MODELS_STORAGE_KEY = "omoc.unavailableModels.v2";
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

// First run: the catalog's own free router is the model a fresh key lands on.
export const FREE_ROUTER = Object.freeze({
  providerId: "openrouter",
  modelId: "openrouter/free",
});
export const findFreeRouter = (catalogModels) =>
  catalogModels?.status === "available"
    ? catalogModels.entries.find(
        (entry) =>
          entry.providerId === FREE_ROUTER.providerId &&
          entry.modelId === FREE_ROUTER.modelId,
      )
    : undefined;
// The first-run card shows on an empty conversation only once the provider
// list is known and nothing is connected (an unknown list never shows it).
export const showFirstRun = (list, messageCount) =>
  Boolean(list) &&
  messageCount === 0 &&
  !list.providers.some((provider) => provider.connected);

// A failed turn on a free model: 404 = no longer served for free, 429 = rate
// limit. Decided from the structured HTTP status only, never from message text,
// and a paid model never gets the free-model advice.
export function freeFailure(entries, model, status) {
  const kind = status === 404 ? "unavailable" : status === 429 ? "limit" : "";
  if (!kind || !model) return undefined;
  const entry = entries.find(
    (e) => e.providerId === model.providerId && e.modelId === model.id,
  );
  const free = entry
    ? entry.free === true
    : isFreeModel({ providerID: model.providerId, id: model.id });
  return free ? { kind, ...(entry ? { id: entry.id } : {}) } : undefined;
}

// Models that answered "not available for free", remembered per profile in the
// same renderer storage as the picker memory (catalog ids only). A mark expires
// after a day (free availability comes and goes) and a successful turn clears it.
export const UNAVAILABLE_TTL_MS = 24 * 60 * 60 * 1000;
function readUnavailable(storage, now) {
  try {
    const list = JSON.parse(
      storage?.getItem(UNAVAILABLE_MODELS_STORAGE_KEY) ?? "[]",
    );
    return Array.isArray(list)
      ? list
          .filter(
            (entry) =>
              typeof entry?.id === "string" &&
              /^[a-f0-9]{64}$/u.test(entry.id) &&
              Number.isFinite(entry.at) &&
              now - entry.at < UNAVAILABLE_TTL_MS,
          )
          .slice(0, 50)
      : [];
  } catch {
    return [];
  }
}
function writeUnavailable(list, storage) {
  try {
    storage?.setItem(UNAVAILABLE_MODELS_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Blocked storage: the mark lasts for this session only.
  }
}
export const loadUnavailableModels = (
  storage = globalThis.localStorage,
  now = Date.now(),
) => readUnavailable(storage, now).map((entry) => entry.id);
export function markModelUnavailable(
  id,
  storage = globalThis.localStorage,
  now = Date.now(),
) {
  const rest = readUnavailable(storage, now).filter((entry) => entry.id !== id);
  writeUnavailable([{ id, at: now }, ...rest].slice(0, 50), storage);
  return loadUnavailableModels(storage, now);
}
export function clearModelUnavailable(
  id,
  storage = globalThis.localStorage,
  now = Date.now(),
) {
  const rest = readUnavailable(storage, now).filter((entry) => entry.id !== id);
  writeUnavailable(rest, storage);
  return rest.map((entry) => entry.id);
}

// The prompt a failed free-model turn may be resent as: only plain text. A
// message with attachments, a slash command or text clipped at the 32000 limit
// would not be the same request when resent as bare text.
export const retryablePrompt = (userMessage) =>
  userMessage?.role === "user" &&
  !userMessage.context &&
  typeof userMessage.text === "string" &&
  userMessage.text.trim() !== "" &&
  !userMessage.text.trimStart().startsWith("/") &&
  userMessage.text.length < 32000
    ? userMessage.text
    : undefined;
