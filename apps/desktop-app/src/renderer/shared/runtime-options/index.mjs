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
const USAGE_MAX = 1e12;
const USAGE_KEYS = ["input", "output", "reasoning", "cacheRead", "cacheWrite"];
const count = (v) => Number.isSafeInteger(v) && v >= 0 && v <= USAGE_MAX;
// Per-turn usage: integer token counts plus optional cost (USD). Absent, never 0, when unknown.
export function validUsage(value) {
  return (
    closed(value, USAGE_KEYS, ["cost"]) &&
    USAGE_KEYS.every((k) => count(value[k])) &&
    (!own(value, "cost") ||
      (Number.isFinite(value.cost) &&
        value.cost >= 0 &&
        value.cost <= USAGE_MAX))
  );
}
export function projectUsage(message) {
  // In-flight assistant messages carry partial counts: unknown, not usage.
  if (!Number.isFinite(message?.time?.completed)) return undefined;
  const t = message?.tokens;
  if (!t || typeof t !== "object" || !t.cache || typeof t.cache !== "object")
    return undefined;
  const tokens = {
    input: t.input,
    output: t.output,
    reasoning: t.reasoning,
    cacheRead: t.cache.read,
    cacheWrite: t.cache.write,
  };
  const usage = {
    ...tokens,
    ...(own(message, "cost") ? { cost: message.cost } : {}),
  };
  // An invalid cost drops only the cost, not the token counts.
  return validUsage(usage) ? usage : validUsage(tokens) ? tokens : undefined;
}
export function sumUsage(usages) {
  const list = [...usages];
  const known = list.filter(validUsage);
  const total = {
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
  };
  let costKnown = known.length > 0;
  for (const u of known) {
    for (const k of USAGE_KEYS) total[k] += u[k];
    if (own(u, "cost")) total.cost += u.cost;
    else costKnown = false;
  }
  if (!costKnown) delete total.cost;
  return {
    total: known.length ? total : undefined,
    unknown: list.length - known.length,
  };
}
const compact = (n) =>
  n >= 1e6
    ? `${+(n / 1e6).toFixed(1)}M`
    : n >= 1e3
      ? `${+(n / 1e3).toFixed(1)}k`
      : String(n);
export function formatUsage(usage) {
  if (!validUsage(usage)) return "확인 불가";
  const parts = [
    `입력 ${compact(usage.input)}`,
    `출력 ${compact(usage.output)}`,
  ];
  if (usage.reasoning > 0) parts.push(`추론 ${compact(usage.reasoning)}`);
  if (usage.cacheRead + usage.cacheWrite > 0)
    parts.push(`캐시 ${compact(usage.cacheRead + usage.cacheWrite)}`);
  if (usage.cost > 0)
    parts.push(`$${usage.cost.toFixed(usage.cost < 0.01 ? 4 : 2)}`);
  return parts.join(" · ");
}
export function validAssistantRuntime(value) {
  return (
    closed(value, ["agent", "model"], ["usage"]) &&
    validRuntimeText(value.agent) &&
    validRuntimeModel(value.model) &&
    (!own(value, "usage") || validUsage(value.usage))
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
  const usage = projectUsage(message);
  return model && validRuntimeText(message.agent)
    ? { agent: message.agent, model, ...(usage ? { usage } : {}) }
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
// No explicit model on the draft: the runtime sends what the session reports.
// The chip and the picker's default row both say so, with that same name.
export const defaultModelText = (reportedName) => {
  const name = reportedName && modelDisplayName(reportedName);
  return {
    chip: name ? `기본 · ${name}` : "기본 모델",
    hint: name ? `지금: ${name}` : "런타임이 정합니다",
  };
};
