import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MODEL_STORAGE_KEY,
  loadDefaultModel,
  parseProviderList,
  providerErrorText,
  saveDefaultModel,
  sourceText,
  usableDefaultModel,
} from "./renderer/shared/providers/index.mjs";

const ID = "a".repeat(64);
const storage = () => {
  const map = new Map();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
};

test("provider list parsing is closed and error text is generic", () => {
  assert.deepEqual(parseProviderList(null), {
    providers: [],
    local: { baseUrl: "" },
  });
  const parsed = parseProviderList({
    providers: [
      { id: "openai", name: "OpenAI", connected: true, source: "credential" },
      { id: 1 },
    ],
    local: { baseUrl: "http://h/v1" },
  });
  assert.equal(parsed.providers.length, 1);
  assert.equal(sourceText(parsed.providers[0]), "설정됨");
  assert.equal(sourceText({ connected: false }), "연결 안 됨");
  assert.match(providerErrorText("INVALID_KEY"), /키/u);
  assert.match(providerErrorText("whatever"), /Native/u);
});

test("default model persists and applies only while the catalog offers it", () => {
  const s = storage();
  assert.equal(loadDefaultModel(s), "");
  saveDefaultModel(ID, s);
  assert.equal(s.getItem(DEFAULT_MODEL_STORAGE_KEY), ID);
  assert.equal(loadDefaultModel(s), ID);
  s.setItem(DEFAULT_MODEL_STORAGE_KEY, "not-an-id");
  assert.equal(loadDefaultModel(s), "");
  const models = { status: "available", entries: [{ id: ID }] };
  assert.equal(usableDefaultModel(models, ID), ID);
  assert.equal(usableDefaultModel(models, "b".repeat(64)), "");
  assert.equal(usableDefaultModel({ status: "unavailable" }, ID), "");
  saveDefaultModel("", s);
  assert.equal(s.getItem(DEFAULT_MODEL_STORAGE_KEY), null);
});
