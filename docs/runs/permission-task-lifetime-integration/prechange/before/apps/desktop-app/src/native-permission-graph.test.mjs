import assert from "node:assert/strict";
import test from "node:test";
import * as graph from "./native-permission-graph.mjs";
test("graph factory refuses unverified resource roots before any Native import", async () => {
  assert.equal(typeof graph.createNativePermissionGraph, "function");
  for (const input of [
    undefined,
    {},
    { ...validOptions(), root: "/tmp" },
    { ...validOptions(), root: "relative" },
    { ...validOptions(), nonce: "bad" },
    { ...validOptions(), overrides: [] },
  ])
    await assert.rejects(() => graph.createNativePermissionGraph(input));
});
test("graph factory rejects accessor options without invoking authority getters", async () => {
  let calls = 0;
  await assert.rejects(() =>
    graph.createNativePermissionGraph({
      ...validOptions(),
      get root() {
        calls++;
        return "/tmp";
      },
      nonce: "a".repeat(64),
    }),
  );
  assert.equal(calls, 0);
});

test("legacy resource manifest is refused before loading its inert Native placeholders", async (t) => {
  const fs = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { syntheticEventHost } = await import(
    "../scripts/build-provenance-test-fixture.mjs"
  );
  const { eventHostForResources } = await import("./event-host-resources.mjs");
  const root = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "omoc-graph-legacy-")),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await syntheticEventHost(root);
  const descriptor = eventHostForResources(root, "darwin", "arm64");
  await assert.rejects(
    graph.createNativePermissionGraph({
      root: descriptor.root,
      nonce: "a".repeat(64),
      runtimeEpoch: "test_epoch-1",
      bootHolds: [],
    }),
    /required permission overlay missing/,
  );
});

test("closed options reject proxies, hidden properties, symbols and inherited authority", async () => {
  let traps = 0;
  const input = {
    root: "/tmp/opencode/event-host/darwin-arm64",
    nonce: "a".repeat(64),
    runtimeEpoch: "test_epoch-1",
    bootHolds: [],
  };
  await assert.rejects(
    graph.createNativePermissionGraph(
      new Proxy(input, {
        ownKeys() {
          traps++;
          return [];
        },
      }),
    ),
  );
  assert.equal(traps, 0);
  for (const value of [
    Object.assign(Object.create(null), input),
    Object.assign(Object.create({ inherited: true }), input),
    { ...input, [Symbol("authority")]: true },
    Object.defineProperty({ ...input }, "nonce", { enumerable: false }),
  ])
    await assert.rejects(
      graph.createNativePermissionGraph(value),
      /native_permission_graph_unverified/,
    );
});

const validOptions = () => ({
  root: "/missing-native-permission-test/opencode/event-host/darwin-arm64",
  nonce: "a".repeat(64),
  runtimeEpoch: "test_epoch-1",
  bootHolds: [],
});
const invalidInput = /native_permission_(?:graph_unverified|input)/u;

test("exact four initialization fields reach resource verification only when valid", async () => {
  for (const runtimeEpoch of ["a", "A_9-", "a".repeat(128)]) {
    await assert.rejects(
      graph.createNativePermissionGraph({ ...validOptions(), runtimeEpoch }),
      (error) => error.code === "ENOENT",
    );
  }
  for (const bootHolds of [
    [],
    [{ projectId: "project-1", originalOperationKey: "operation-1" }],
    Array.from({ length: 1024 }, (_, i) => ({
      projectId: `project-${i}`,
      originalOperationKey: `operation-${i}`,
    })),
  ]) {
    await assert.rejects(
      graph.createNativePermissionGraph({ ...validOptions(), bootHolds }),
      (error) => error.code === "ENOENT",
    );
  }
});

test("malformed initialization is refused before resource verification", async () => {
  const base = validOptions();
  const row = { projectId: "project-1", originalOperationKey: "operation-1" };
  for (const input of [
    { root: base.root, nonce: base.nonce },
    ...Object.keys(base).map((key) => {
      const value = { ...base };
      delete value[key];
      return value;
    }),
    { ...base, extra: true },
    ...[
      undefined,
      null,
      1,
      "",
      "a".repeat(129),
      "a b",
      "a.b",
      "a/b",
      "a\n",
      "é",
    ].map((runtimeEpoch) => ({ ...base, runtimeEpoch })),
    ...[
      undefined,
      null,
      {},
      new Array(1),
      Array(1025).fill(row),
      [null],
      [{}],
      [{ ...row, extra: true }],
      [{ projectId: "", originalOperationKey: "key" }],
      [{ projectId: "id", originalOperationKey: "" }],
      [{ projectId: "id", originalOperationKey: "key\n" }],
      [Object.assign(Object.create(null), row)],
      [Object.assign(Object.create({ inherited: true }), row)],
      [{ ...row, [Symbol("hidden")]: true }],
      [Object.defineProperty({ ...row }, "projectId", { enumerable: false })],
      Object.assign([], { extra: true }),
      Object.assign(Object.create(null), []),
      Object.setPrototypeOf([], {}),
      Object.defineProperty([row], "0", { enumerable: false }),
      Object.assign([row], { [Symbol("hidden")]: true }),
    ].map((bootHolds) => ({ ...base, bootHolds })),
  ])
    await assert.rejects(
      graph.createNativePermissionGraph(input),
      invalidInput,
    );
});

test("initialization rejects accessors and proxies without invoking their code", async () => {
  let calls = 0;
  const trap = () => {
    calls++;
    throw new Error("authority trap invoked");
  };
  const proxy = (value) =>
    new Proxy(value, {
      get: trap,
      getPrototypeOf: trap,
      ownKeys: trap,
      getOwnPropertyDescriptor: trap,
    });
  const row = { projectId: "project-1", originalOperationKey: "operation-1" };
  const getter = (value, key) =>
    Object.defineProperty(value, key, {
      enumerable: true,
      get: trap,
    });
  for (const input of [
    proxy(validOptions()),
    ...["root", "nonce", "runtimeEpoch", "bootHolds"].map((key) =>
      getter(validOptions(), key),
    ),
    { ...validOptions(), bootHolds: proxy([]) },
    { ...validOptions(), bootHolds: [proxy(row)] },
    { ...validOptions(), bootHolds: getter([row], "0") },
    ...["projectId", "originalOperationKey"].map((key) => ({
      ...validOptions(),
      bootHolds: [getter({ ...row }, key)],
    })),
  ])
    await assert.rejects(
      graph.createNativePermissionGraph(input),
      invalidInput,
    );
  assert.equal(calls, 0);
});
