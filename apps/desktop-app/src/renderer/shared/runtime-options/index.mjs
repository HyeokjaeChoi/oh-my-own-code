// Public metadata only. Provider overlays never belong to these projections.
export const RUNTIME_OPTIONS_LIMITS = Object.freeze({
  text: 256,
  variants: 64,
  capabilities: 32,
  capabilityText: 64,
});
export const validRuntimeText = (value, limit = RUNTIME_OPTIONS_LIMITS.text) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= limit &&
  value.isWellFormed() &&
  Array.from(value).every((char) => {
    const code = char.charCodeAt(0);
    return code >= 32 && (code < 127 || code > 159);
  });
const own = (value, key) => Object.hasOwn(value, key);
function closed(value, required, optional = []) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    return false;
  const keys = Reflect.ownKeys(value);
  return (
    required.every((key) => own(value, key)) &&
    keys.every(
      (key) =>
        [...required, ...optional].includes(key) &&
        Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value"),
    )
  );
}
const textList = (value, limit, size) =>
  Array.isArray(value) &&
  value.length <= limit &&
  value.every((entry) => validRuntimeText(entry, size)) &&
  new Set(value).size === value.length;
export function validRuntimeModel(value) {
  return (
    closed(value, ["providerId", "id"], ["variant"]) &&
    validRuntimeText(value.providerId) &&
    validRuntimeText(value.id) &&
    (!own(value, "variant") || validRuntimeText(value.variant))
  );
}
export function validAssistantRuntime(value) {
  return (
    closed(value, ["agent", "model"]) &&
    validRuntimeText(value.agent) &&
    validRuntimeModel(value.model)
  );
}
export function validSessionSelection(value) {
  return (
    closed(value, ["sessionId"], ["agent", "model"]) &&
    validRuntimeText(value.sessionId) &&
    (own(value, "agent") || own(value, "model")) &&
    (!own(value, "agent") || validRuntimeText(value.agent)) &&
    (!own(value, "model") || validRuntimeModel(value.model))
  );
}
function validCapabilities(value) {
  return (
    closed(value, ["tools", "input", "output"]) &&
    typeof value.tools === "boolean" &&
    [value.input, value.output].every((list) =>
      textList(
        list,
        RUNTIME_OPTIONS_LIMITS.capabilities,
        RUNTIME_OPTIONS_LIMITS.capabilityText,
      ),
    )
  );
}
export function validModelOptions(value) {
  return (
    closed(value, ["variants"], ["capabilities"]) &&
    closed(value.variants, ["status", "ids"]) &&
    ["available", "unavailable"].includes(value.variants.status) &&
    textList(
      value.variants.ids,
      RUNTIME_OPTIONS_LIMITS.variants,
      RUNTIME_OPTIONS_LIMITS.text,
    ) &&
    (value.variants.status !== "unavailable" ||
      value.variants.ids.length === 0) &&
    (!own(value, "capabilities") || validCapabilities(value.capabilities))
  );
}
export function projectModelOptions(model) {
  const variants = model?.variants;
  const ids =
    Array.isArray(variants) &&
    variants.length <= RUNTIME_OPTIONS_LIMITS.variants
      ? variants.map((v) => v?.id)
      : undefined;
  const capabilities = model?.capabilities;
  const projected = capabilities && {
    tools: capabilities.tools,
    input: capabilities.input,
    output: capabilities.output,
  };
  return {
    variants: textList(
      ids,
      RUNTIME_OPTIONS_LIMITS.variants,
      RUNTIME_OPTIONS_LIMITS.text,
    )
      ? { status: "available", ids: [...ids] }
      : { status: "unavailable", ids: [] },
    ...(validCapabilities(projected)
      ? {
          capabilities: {
            tools: projected.tools,
            input: [...projected.input],
            output: [...projected.output],
          },
        }
      : {}),
  };
}
function projectNativeModel(value) {
  if (!value || typeof value !== "object") return undefined;
  const model = {
    providerId: value.providerID,
    id: value.id,
    ...(own(value, "variant") ? { variant: value.variant } : {}),
  };
  return validRuntimeModel(model) ? model : undefined;
}
export function projectAssistantRuntime(message) {
  if (message?.type !== "assistant") return undefined;
  const model = projectNativeModel(message.model);
  return model && validRuntimeText(message.agent)
    ? { agent: message.agent, model }
    : undefined;
}
export function projectSessionSelection(info, sessionId) {
  if (!info || typeof info !== "object") return undefined;
  const value = {
    sessionId,
    ...(own(info, "agent") ? { agent: info.agent } : {}),
    ...(own(info, "model") ? { model: projectNativeModel(info.model) } : {}),
  };
  return validSessionSelection(value) ? value : undefined;
}

// Free = every cost tier of the model is priced 0 for input and output, or
// the model is an OpenRouter free variant (only under that provider) (":free" suffix, the free router).
// A missing or malformed cost never counts as free by itself.
export const isFreeModel = (model) =>
  (Array.isArray(model?.cost) &&
    model.cost.length > 0 &&
    model.cost.every((tier) => tier?.input === 0 && tier?.output === 0)) ||
  (model?.providerID === "openrouter" &&
    typeof model.id === "string" &&
    (model.id.endsWith(":free") || model.id === "openrouter/free"));

// The variant a draft may keep after its model changes: only one the new model
// itself lists. Otherwise "" (no request), so a stale variant is never sent.
export const variantForModel = (variant, model) =>
  variant &&
  model?.variants?.status === "available" &&
  model.variants.ids.includes(variant)
    ? variant
    : "";

// "무료만" starts on only while every connected provider is OpenRouter (the
// only source of free models here); the user's own choice always wins.
export const defaultFreeOnly = (entries, stored) =>
  typeof stored === "boolean"
    ? stored
    : entries.length > 0 &&
      entries.every((entry) => entry.providerId === "openrouter");

// Picker rows: "최근" (up to 3, only without a search), then one group per
// provider in catalog order. Free models lead each provider (stable, so the
// pinned router the catalog lists first stays first). The free filter never
// hides the selected model; a search matches name and provider.
export function groupModels(entries, { query, freeOnly, recent, selectedId }) {
  const q = query.trim().toLowerCase();
  const shown = entries.filter(
    (entry) =>
      (!freeOnly || entry.free === true || entry.id === selectedId) &&
      (!q || `${entry.name} ${entry.provider ?? ""}`.toLowerCase().includes(q)),
  );
  const recents = q
    ? []
    : recent
        .map((id) => shown.find((entry) => entry.id === id))
        .filter(Boolean)
        .slice(0, 3);
  const groups = recents.length
    ? [{ key: "recent", label: "최근", items: recents }]
    : [];
  const byProvider = new Map();
  for (const entry of shown) {
    if (recents.includes(entry)) continue;
    const key = entry.providerId ?? "";
    if (!byProvider.has(key))
      byProvider.set(key, {
        key,
        label: entry.provider || key || "기타",
        items: [],
      });
    byProvider.get(key).items.push(entry);
  }
  for (const group of byProvider.values()) {
    group.items = [
      ...group.items.filter((entry) => entry.free === true),
      ...group.items.filter((entry) => entry.free !== true),
    ];
    groups.push(group);
  }
  return groups;
}

const VARIANT_LABELS = {
  minimal: "최소",
  low: "낮음",
  medium: "보통",
  high: "높음",
  max: "최대",
};
// Reasoning levels read in Korean when known; any other id shows as reported.
export const variantLabel = (id) =>
  Object.hasOwn(VARIANT_LABELS, id) ? VARIANT_LABELS[id] : id;
// The 무료 badge says it; a "(free)" suffix in the name would repeat it.
export const modelDisplayName = (name) =>
  name.replace(/\s*\(free\)\s*$/iu, "") || name;
