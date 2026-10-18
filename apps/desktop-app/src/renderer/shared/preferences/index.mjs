export const THEMES = Object.freeze(["system", "light", "dark"]);
export const FONT_SIZES = Object.freeze(["small", "medium", "large"]);
export const DENSITIES = Object.freeze(["comfortable", "compact"]);
export const DEFAULT_PREFERENCES = Object.freeze({
  theme: "system",
  fontSize: "medium",
  density: "comfortable",
  osNotifications: false,
  terminalScreenReader: false,
});
export const PREFERENCES_STORAGE_KEY = "omoc.preferences.v1";
// 레이아웃: detail/side panel width in px. Stored under `layout` in the same blob;
// the live value is owned by the workbench store, this only persists it.
export const PANEL_WIDTH_MIN = 320;
export const PANEL_WIDTH_MAX = 4000;
export const DEFAULT_LAYOUT = Object.freeze({ panelWidth: 420 });
// 글자 크기: shifts the md/base steps (and the conversation size) of the one type scale.
const FONT_DELTA = { small: -1, medium: 0, large: 1 };
const FONT_STEPS = {
  "--omoc-primitive-font-size-md": 13,
  "--omoc-primitive-font-size-base": 14,
  "--omoc-primitive-size-conversation-size": 14,
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
    osNotifications: r.osNotifications === true,
    terminalScreenReader: r.terminalScreenReader === true,
  };
}

const parseBlob = (raw) => {
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
};

// Out-of-range numbers clamp; non-numbers fall back to the default.
export function parseLayout(raw) {
  const layout = parseBlob(raw).layout;
  const width = layout && typeof layout === "object" ? layout.panelWidth : null;
  return {
    panelWidth:
      typeof width === "number" && Number.isFinite(width)
        ? Math.min(
            PANEL_WIDTH_MAX,
            Math.max(PANEL_WIDTH_MIN, Math.round(width)),
          )
        : DEFAULT_LAYOUT.panelWidth,
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
export function loadLayout(storage = globalThis.localStorage) {
  try {
    return parseLayout(storage?.getItem(PREFERENCES_STORAGE_KEY) ?? null);
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}
// Writes preserve the stored layout (and vice versa) so each owner can save alone.
function writeBlob(patch, storage) {
  try {
    const current = parseBlob(
      storage?.getItem(PREFERENCES_STORAGE_KEY) ?? null,
    );
    storage?.setItem(
      PREFERENCES_STORAGE_KEY,
      JSON.stringify({ ...current, ...patch }),
    );
  } catch {
    // Blocked storage: preferences last for this session only.
  }
}
export function savePreferences(
  preferences,
  storage = globalThis.localStorage,
) {
  const { layout: _ignored, ...rest } = preferences;
  writeBlob(rest, storage);
}
export function saveLayout(layout, storage = globalThis.localStorage) {
  writeBlob({ layout: parseLayout({ layout }) }, storage);
}

// Maps preferences onto existing design tokens ([data-theme="dark"], type-scale primitives).
export function applyPreferences(root, preferences, systemDark) {
  const dark =
    preferences.theme === "dark" ||
    (preferences.theme === "system" && systemDark);
  root.setAttribute("data-theme", dark ? "dark" : "light");
  root.setAttribute("data-density", preferences.density);
  // xterm's screenReaderMode costs performance, so it follows an explicit opt-in.
  root.setAttribute(
    "data-terminal-screen-reader",
    String(preferences.terminalScreenReader),
  );
  const delta = FONT_DELTA[preferences.fontSize];
  for (const [property, px] of Object.entries(FONT_STEPS)) {
    if (delta === 0) root.style.removeProperty(property);
    else root.style.setProperty(property, `${px + delta}px`);
  }
}

// Only shortcuts that exist in the renderer today.
export const SHORTCUTS = Object.freeze([
  { keys: "Cmd/Ctrl+K", action: "명령 팔레트 열기" },
  { keys: "?", action: "설정·단축키 열기" },
  { keys: "Esc", action: "열린 메뉴·대화 상자·편집 닫기" },
  { keys: "/", action: "빈 입력창에서 명령 메뉴 열기" },
  { keys: "↑ ↓", action: "명령 메뉴 항목 이동" },
  { keys: "Home End", action: "메뉴 처음·끝 항목으로 이동" },
]);
