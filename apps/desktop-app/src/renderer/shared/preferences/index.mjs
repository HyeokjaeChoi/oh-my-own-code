export const THEMES = Object.freeze(["system", "light", "dark"]);
export const FONT_SIZES = Object.freeze(["small", "medium", "large"]);
export const DENSITIES = Object.freeze(["comfortable", "compact"]);
export const DEFAULT_PREFERENCES = Object.freeze({
  theme: "system",
  fontSize: "medium",
  density: "comfortable",
});
export const PREFERENCES_STORAGE_KEY = "omoc.preferences.v1";
const FONT_SCALE = { small: 0.9, medium: 1, large: 1.15 };
const SIZE_TOKENS = {
  body: 16,
  caption: 13,
  label: 16,
  heading: 22,
  code: 13,
  compact: 14,
};
const pick = (allowed, value, fallback) =>
  allowed.includes(value) ? value : fallback;

// Unknown or malformed input falls back per field to the defaults.
export function parsePreferences(raw) {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      value = null;
    }
  }
  const r = value && typeof value === "object" ? value : {};
  return {
    theme: pick(THEMES, r.theme, DEFAULT_PREFERENCES.theme),
    fontSize: pick(FONT_SIZES, r.fontSize, DEFAULT_PREFERENCES.fontSize),
    density: pick(DENSITIES, r.density, DEFAULT_PREFERENCES.density),
  };
}

// ponytail: renderer localStorage; main has no app-preferences store or IPC yet.
// Move behind the closed workbench contract once a durable settings store exists.
export function loadPreferences(storage = globalThis.localStorage) {
  try {
    return parsePreferences(storage?.getItem(PREFERENCES_STORAGE_KEY) ?? null);
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}
export function savePreferences(
  preferences,
  storage = globalThis.localStorage,
) {
  try {
    storage?.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Blocked storage: preferences last for this session only.
  }
}

// Maps preferences onto existing design tokens ([data-theme="dark"], type-size tokens).
export function applyPreferences(root, preferences, systemDark) {
  const dark =
    preferences.theme === "dark" ||
    (preferences.theme === "system" && systemDark);
  root.setAttribute("data-theme", dark ? "dark" : "light");
  root.setAttribute("data-density", preferences.density);
  const scale = FONT_SCALE[preferences.fontSize];
  for (const [name, px] of Object.entries(SIZE_TOKENS)) {
    const property = `--omoc-semantic-type-size-${name}`;
    if (scale === 1) root.style.removeProperty(property);
    else
      root.style.setProperty(property, `${Math.round(px * scale * 10) / 10}px`);
  }
}

// Only shortcuts that exist in the renderer today.
export const SHORTCUTS = Object.freeze([
  { keys: "?", action: "설정·단축키 열기" },
  { keys: "Esc", action: "열린 메뉴·시트·편집 닫기" },
  { keys: "/", action: "빈 입력창에서 명령 메뉴 열기" },
  { keys: "↑ ↓", action: "명령 메뉴 항목 이동" },
  { keys: "Home End", action: "메뉴 처음·끝 항목으로 이동" },
]);
