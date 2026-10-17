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
  assert.match(providerErrorText("whatever"), /런타임/u);
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
  // No usable stored default: a free-only catalog starts on its first entry.
  const freeOnly = {
    status: "available",
    entries: [
      { id: "first", free: true },
      { id: "second", free: true },
    ],
  };
  assert.equal(usableDefaultModel(freeOnly, ""), "first");
  assert.equal(usableDefaultModel(freeOnly, "second"), "second");
  assert.equal(
    usableDefaultModel(
      {
        status: "available",
        entries: [{ id: "paid" }, { id: "f", free: true }],
      },
      "",
    ),
    "",
  );
  assert.equal(
    usableDefaultModel({ status: "available", entries: [] }, ""),
    "",
  );
  saveDefaultModel("", s);
  assert.equal(s.getItem(DEFAULT_MODEL_STORAGE_KEY), null);
});

test("recent models keep the last 3 distinct ids; free-only choice persists", async () => {
  const { loadRecentModels, pushRecentModel, loadFreeOnly, saveFreeOnly } =
    await import("./renderer/shared/providers/index.mjs");
  const store = new Map();
  const s = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
  };
  const id = (c) => c.repeat(64);
  assert.deepEqual(loadRecentModels(s), []);
  for (const c of ["a", "b", "c", "a", "d"]) pushRecentModel(id(c), s);
  assert.deepEqual(loadRecentModels(s), [id("d"), id("a"), id("c")]);
  // Saving prunes ids the catalog dropped.
  pushRecentModel(id("e"), s, [id("e"), id("a")]);
  assert.deepEqual(loadRecentModels(s), [id("e"), id("a")]);
  store.set("omoc.recentModels.v1", JSON.stringify(["x", id("b"), 3]));
  assert.deepEqual(loadRecentModels(s), [id("b")]);
  store.set("omoc.recentModels.v1", "{bad");
  assert.deepEqual(loadRecentModels(s), []);
  assert.equal(loadFreeOnly(s), undefined);
  saveFreeOnly(false, s);
  assert.equal(loadFreeOnly(s), false);
  saveFreeOnly(true, s);
  assert.equal(loadFreeOnly(s), true);
});

test("an auto-picked model survives catalog growth and goes only when removed", async () => {
  const { keepAutoModel } = await import(
    "./renderer/shared/providers/index.mjs"
  );
  const free = { id: "free", free: true };
  assert.equal(
    keepAutoModel({ status: "available", entries: [free] }, "free"),
    true,
  );
  // A paid key adds models: the free pick stays.
  assert.equal(
    keepAutoModel(
      { status: "available", entries: [free, { id: "paid" }] },
      "free",
    ),
    true,
  );
  assert.equal(keepAutoModel({ status: "unavailable" }, "free"), true);
  assert.equal(
    keepAutoModel({ status: "available", entries: [{ id: "paid" }] }, "free"),
    false,
  );
});

test("free-model failures classify by structured status and never touch paid models", async () => {
  const { freeFailure } = await import("./renderer/shared/providers/index.mjs");
  const entries = [
    {
      id: "f".repeat(64),
      providerId: "openrouter",
      modelId: "x/y:free",
      free: true,
    },
    { id: "p".repeat(64), providerId: "openrouter", modelId: "x/paid" },
  ];
  const free = { providerId: "openrouter", id: "x/y:free" };
  assert.deepEqual(freeFailure(entries, free, 404), {
    kind: "unavailable",
    id: "f".repeat(64),
  });
  assert.deepEqual(freeFailure(entries, free, 429), {
    kind: "limit",
    id: "f".repeat(64),
  });
  // Paid model, other status, unknown model: no free-model fallback.
  assert.equal(
    freeFailure(entries, { providerId: "openrouter", id: "x/paid" }, 404),
    undefined,
  );
  assert.equal(freeFailure(entries, free, 500), undefined);
  assert.equal(freeFailure(entries, undefined, 404), undefined);
  // Not in the catalog (yet): the OpenRouter free naming still counts.
  assert.equal(
    freeFailure([], { providerId: "openrouter", id: "a/b:free" }, 429)?.kind,
    "limit",
  );
  assert.equal(
    freeFailure([], { providerId: "openai", id: "a/b:free" }, 429),
    undefined,
  );
});

test("unavailable models persist per profile, bounded, catalog ids only", async () => {
  const { loadUnavailableModels, markModelUnavailable } = await import(
    "./renderer/shared/providers/index.mjs"
  );
  const s = storage();
  assert.deepEqual(loadUnavailableModels(s), []);
  markModelUnavailable(ID, s);
  markModelUnavailable(ID, s);
  assert.deepEqual(loadUnavailableModels(s), [ID]);
  s.setItem("omoc.unavailableModels.v1", JSON.stringify([ID, "not-an-id"]));
  assert.deepEqual(loadUnavailableModels(s), [ID]);
  s.setItem("omoc.unavailableModels.v1", "{");
  assert.deepEqual(loadUnavailableModels(s), []);
});

test("first-run card shows only for an empty conversation with a known, unconnected provider list", async () => {
  const { showFirstRun, findFreeRouter } = await import(
    "./renderer/shared/providers/index.mjs"
  );
  const none = parseProviderList({
    providers: [{ id: "openrouter", name: "OpenRouter", connected: false }],
  });
  const some = parseProviderList({
    providers: [{ id: "openrouter", name: "OpenRouter", connected: true }],
  });
  assert.equal(showFirstRun(none, 0), true);
  assert.equal(showFirstRun(some, 0), false);
  assert.equal(showFirstRun(none, 1), false);
  assert.equal(showFirstRun(undefined, 0), false);
  const router = {
    id: "r".repeat(64),
    providerId: "openrouter",
    modelId: "openrouter/free",
  };
  assert.equal(
    findFreeRouter({ status: "available", entries: [{ id: "x" }, router] }),
    router,
  );
  assert.equal(findFreeRouter({ status: "unavailable" }), undefined);
});
