import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

const {
  applyPreferences,
  DEFAULT_LAYOUT,
  DEFAULT_PREFERENCES,
  loadLayout,
  loadPreferences,
  PANEL_WIDTH_MAX,
  PANEL_WIDTH_MIN,
  parseLayout,
  parsePreferences,
  saveLayout,
  savePreferences,
  SHORTCUTS,
} = await import("./renderer/shared/preferences/index.mjs");

test("parsePreferences defaults invalid input per field", () => {
  assert.deepEqual(parsePreferences(null), DEFAULT_PREFERENCES);
  assert.deepEqual(parsePreferences("{bad"), DEFAULT_PREFERENCES);
  assert.deepEqual(parsePreferences({ theme: "dark", fontSize: "huge" }), {
    ...DEFAULT_PREFERENCES,
    theme: "dark",
  });
});

test("terminalScreenReader is a closed opt-in boolean (default off)", () => {
  assert.equal(DEFAULT_PREFERENCES.terminalScreenReader, false);
  for (const bad of ["true", 1, null, {}])
    assert.equal(
      parsePreferences({ terminalScreenReader: bad }).terminalScreenReader,
      false,
    );
  assert.equal(
    parsePreferences({ terminalScreenReader: true }).terminalScreenReader,
    true,
  );
  const attrs = {};
  const root = {
    setAttribute: (k, v) => (attrs[k] = v),
    style: { setProperty() {}, removeProperty() {} },
  };
  applyPreferences(root, DEFAULT_PREFERENCES, false);
  assert.equal(attrs["data-terminal-screen-reader"], "false");
  applyPreferences(
    root,
    { ...DEFAULT_PREFERENCES, terminalScreenReader: true },
    false,
  );
  assert.equal(attrs["data-terminal-screen-reader"], "true");
});

test("load/save round-trip and tolerate blocked storage", () => {
  const data = new Map();
  const storage = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, v),
  };
  const next = {
    theme: "light",
    fontSize: "large",
    density: "compact",
    osNotifications: true,
    terminalScreenReader: true,
  };
  savePreferences(next, storage);
  assert.deepEqual(loadPreferences(storage), next);
  const broken = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };
  assert.deepEqual(loadPreferences(broken), DEFAULT_PREFERENCES);
  savePreferences(next, broken);
});

test("applyPreferences resolves system theme, density and font scale", () => {
  const attrs = {};
  const style = {};
  const root = {
    setAttribute: (k, v) => (attrs[k] = v),
    style: {
      setProperty: (k, v) => (style[k] = v),
      removeProperty: (k) => delete style[k],
    },
  };
  applyPreferences(root, DEFAULT_PREFERENCES, true);
  assert.equal(attrs["data-theme"], "dark");
  assert.equal(attrs["data-density"], "comfortable");
  assert.deepEqual(style, {});
  applyPreferences(
    root,
    { theme: "light", fontSize: "large", density: "compact" },
    true,
  );
  assert.equal(attrs["data-theme"], "light");
  assert.equal(style["--omoc-primitive-font-size-md"], "14px");
  assert.equal(style["--omoc-primitive-font-size-base"], "15px");
  assert.equal(style["--omoc-primitive-size-conversation-size"], "15px");
  applyPreferences(root, { ...DEFAULT_PREFERENCES, fontSize: "small" }, false);
  assert.equal(style["--omoc-primitive-font-size-md"], "12px");
  assert.equal(style["--omoc-primitive-font-size-base"], "13px");
  assert.equal(style["--omoc-primitive-size-conversation-size"], "13px");
  applyPreferences(root, DEFAULT_PREFERENCES, false);
  assert.deepEqual(style, {});
});

test("font scale base values match tokens.css", () => {
  const css = readFileSync(
    new URL("../../../docs/design/tokens/tokens.css", import.meta.url),
    "utf8",
  );
  const style = {};
  const root = {
    setAttribute() {},
    style: { setProperty: (k, v) => (style[k] = v), removeProperty() {} },
  };
  applyPreferences(root, { ...DEFAULT_PREFERENCES, fontSize: "large" }, false);
  for (const [property, value] of Object.entries(style)) {
    const base = css.match(new RegExp(`${property}: (\\d+)px`))?.[1];
    assert.equal(Number(base) + 1, parseFloat(value), property);
  }
  assert.equal(Object.keys(style).length, 3);
});

test("shortcut help lists the help key", () => {
  assert.ok(SHORTCUTS.some((s) => s.keys === "?"));
  assert.ok(SHORTCUTS.some((s) => s.keys === "Cmd/Ctrl+K"));
});

test("layout panelWidth parses, clamps and defaults", () => {
  assert.deepEqual(parseLayout(null), DEFAULT_LAYOUT);
  assert.deepEqual(parseLayout("{bad"), DEFAULT_LAYOUT);
  assert.deepEqual(parseLayout({ layout: "x" }), DEFAULT_LAYOUT);
  for (const bad of ["500", NaN, Infinity, null, {}])
    assert.equal(parseLayout({ layout: { panelWidth: bad } }).panelWidth, 420);
  assert.equal(
    parseLayout({ layout: { panelWidth: 10 } }).panelWidth,
    PANEL_WIDTH_MIN,
  );
  assert.equal(
    parseLayout({ layout: { panelWidth: 1e9 } }).panelWidth,
    PANEL_WIDTH_MAX,
  );
  assert.equal(
    parseLayout(JSON.stringify({ layout: { panelWidth: 512.6 } })).panelWidth,
    513,
  );
  // Layout never leaks into the appearance preferences.
  assert.deepEqual(
    parsePreferences({ layout: { panelWidth: 600 } }),
    DEFAULT_PREFERENCES,
  );
});

test("layout and preferences share one blob without clobbering each other", () => {
  const data = new Map();
  const storage = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, v),
  };
  saveLayout({ panelWidth: 640 }, storage);
  savePreferences({ ...DEFAULT_PREFERENCES, theme: "dark" }, storage);
  assert.equal(loadLayout(storage).panelWidth, 640);
  assert.equal(loadPreferences(storage).theme, "dark");
  saveLayout({ panelWidth: 99999 }, storage);
  assert.equal(loadLayout(storage).panelWidth, PANEL_WIDTH_MAX);
  assert.equal(loadPreferences(storage).theme, "dark");
  // Reset path: saving the default restores the default width.
  saveLayout(DEFAULT_LAYOUT, storage);
  assert.equal(loadLayout(storage).panelWidth, 420);
  const broken = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };
  assert.deepEqual(loadLayout(broken), DEFAULT_LAYOUT);
  saveLayout({ panelWidth: 500 }, broken);
});
