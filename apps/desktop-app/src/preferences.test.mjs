import assert from "node:assert/strict";
import test from "node:test";

const {
  applyPreferences,
  DEFAULT_PREFERENCES,
  loadPreferences,
  parsePreferences,
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

test("load/save round-trip and tolerate blocked storage", () => {
  const data = new Map();
  const storage = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, v),
  };
  const next = { theme: "light", fontSize: "large", density: "compact" };
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
  assert.equal(style["--omoc-semantic-type-size-body"], "18.4px");
});

test("shortcut help lists the help key", () => {
  assert.ok(SHORTCUTS.some((s) => s.keys === "?"));
  assert.ok(SHORTCUTS.some((s) => s.keys === "Cmd/Ctrl+K"));
});
