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

// Extract the actual factory unchanged except for dynamic module resolution.
// Resource verification and unrelated Native graph nodes are inert here. Control,
// its configured Layer, graph compiler and Effect runtime are the pinned real ones.
// No Native core, server, Bun or second Control runtime is started.
async function actualFactory(t) {
  const { copyFile, mkdtemp, readFile, rm, symlink } = await import(
    "node:fs/promises"
  );
  const { tmpdir } = await import("node:os");
  const { isAbsolute, join, normalize } = await import("node:path");
  const { fileURLToPath, pathToFileURL } = await import("node:url");
  const { types } = await import("node:util");
  const { initialization, taskPreparation } = await import(
    "./native-permission-control-input.mjs"
  );
  const root = await mkdtemp(join(tmpdir(), "omoc-graph-control-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await symlink(
    fileURLToPath(
      new URL(
        "../runtime-event-host/.generated/install/node_modules",
        import.meta.url,
      ),
    ),
    join(root, "node_modules"),
    "dir",
  );
  for (const name of [
    "native-permission-control.mjs",
    "native-permission-control-input.mjs",
    "wire-id.mjs",
    "native-permission-leases.mjs",
    "native-permission-origin-scopes.mjs",
    "permission-control-canonical.mjs",
    "native-permission-task-observer.mjs",
  ]) {
    await copyFile(new URL(`./${name}`, import.meta.url), join(root, name));
  }
  const control = await import(
    pathToFileURL(join(root, "native-permission-control.mjs")).href
  );
  const library = await import(
    pathToFileURL(join(root, "node_modules/effect/dist/index.js")).href
  );
  const compiler = await import(
    pathToFileURL(
      join(root, "node_modules/@opencode/util/dist/effect/layer-node.js"),
    ).href
  );
  const { makeGlobalNode } = await import(
    pathToFileURL(
      join(root, "node_modules/@opencode/util/dist/effect/app-node.js"),
    ).href
  );
  const { Context, Layer } = library;
  const modules = { "effect/dist/index.js": library };
  for (const [file, name] of [
    ["config.js", "Config"],
    ["wellknown.js", "WellKnown"],
    ["config/plugin/source.js", "ConfigPluginSource"],
    ["plugin/sdk.js", "SdkPlugins"],
    ["plugin/instance.js", "InstancePlugins"],
  ]) {
    const Service = Context.Service(`graph-fixture/${name}`);
    const empty = Layer.succeed(Service, {});
    modules[`@opencode/core/dist/${file}`] = {
      [name]: {
        Service,
        node: makeGlobalNode({ service: Service, layer: empty, deps: [] }),
        configured: () => empty,
        bound: () => empty,
      },
    };
  }
  const source = await readFile(
    new URL("./native-permission-graph.mjs", import.meta.url),
    "utf8",
  );
  assert.equal(
    (
      source.match(/export async function createNativePermissionGraph\(/gu) ??
      []
    ).length,
    1,
  );
  const body = source
    .slice(source.indexOf("function options(input)"))
    .replace(
      "export async function createNativePermissionGraph",
      "async function createNativePermissionGraph",
    )
    .replace(/\bimport\(/gu, "load(");
  const loads = [];
  const load = async (url) => {
    loads.push(url);
    if (
      url ===
      pathToFileURL(join(validOptions().root, "native-permission-control.mjs"))
        .href
    )
      return control;
    const prefix =
      pathToFileURL(join(validOptions().root, "node_modules")).href + "/";
    assert.ok(url.startsWith(prefix), `unexpected module: ${url}`);
    const module = modules[url.slice(prefix.length)];
    assert.ok(module, `unexpected pinned module: ${url}`);
    return module;
  };
  const create = new Function(
    "isAbsolute",
    "join",
    "normalize",
    "pathToFileURL",
    "types",
    "initialization",
    "taskPreparation",
    "verifyEventHostResources",
    "nativeSkillsConfig",
    "load",
    `${body}\nreturn createNativePermissionGraph;`,
  )(
    isAbsolute,
    join,
    normalize,
    pathToFileURL,
    types,
    initialization,
    taskPreparation,
    async () => {},
    () => ({}),
    load,
  );
  const result = await create(validOptions());
  assert.equal(loads.length, 7);
  assert.equal(result.overrides.length, 6);
  assert.deepEqual(Object.keys(result).sort(), ["overrides", "taskControl"]);
  assert.deepEqual(Object.keys(result.taskControl).sort(), [
    "close",
    "prepare",
  ]);
  assert.ok(Object.isFrozen(result.taskControl));
  return { ...library, compiler, control, result };
}
const prepareRequest = () => ({
  originKind: "prompt",
  origin: {
    runtimeEpoch: "test_epoch-1",
    operationId: "operation:1",
    type: "message.send",
    digest: "a".repeat(64),
  },
  workspaceId: "workspace",
  appSessionId: "app.session",
  nativeSessionId: "ses_native",
  inputDigest: "b".repeat(64),
});
const unavailable = { status: "held", reason: "runtime_unavailable" };

test("actual graph facade binds the same acquired Control once and observes its invalidation", async (t) => {
  const { Effect, control, compiler, result } = await actualFactory(t);
  const facade = result.taskControl;
  const beforeAcquisition = facade.prepare(prepareRequest());
  assert.deepEqual(await Effect.runPromise(beforeAcquisition), unavailable);
  const layer = compiler.compile(control.node, {
    replacements: result.overrides,
  });
  await Effect.runPromise(
    Effect.provide(
      Effect.gen(function* () {
        const actual = yield* control.Service;
        assert.equal(actual, yield* control.Service);
        // An entry made before acquisition cannot acquire authority retroactively.
        assert.deepEqual(yield* beforeAcquisition, unavailable);
        const input = prepareRequest();
        const pending = facade.prepare(input);
        input.origin.runtimeEpoch = "changed";
        input.inputDigest = undefined;
        assert.deepEqual(yield* pending, {
          status: "held",
          reason: "inventory_unverified",
        });
        assert.deepEqual(
          yield* facade.prepare({
            ...prepareRequest(),
            origin: { ...prepareRequest().origin, runtimeEpoch: "old_epoch" },
          }),
          unavailable,
        );
        const waiting = facade.prepare(prepareRequest());
        // Invalidate the graph-acquired service directly. A replacement/dummy Control
        // or second kernel in the facade would incorrectly return inventory_unverified.
        yield* actual.invalidate("generation_lost");
        assert.deepEqual(yield* waiting, unavailable);
        assert.deepEqual(yield* facade.prepare(prepareRequest()), unavailable);
        const state = yield* actual.transaction(["project"], (tx) =>
          actual.inspect(tx, "project"),
        );
        assert.equal(state.runtimeHeld, true);
        assert.equal(state.generation, 0);
      }),
      layer,
    ).pipe(Effect.timeout("5 seconds")),
  );
  // Reacquiring the same graph must fail rather than replace its captured service.
  await assert.rejects(
    Effect.runPromise(Effect.provide(control.Service, layer)),
    /native_permission_runtime_unavailable/,
  );
});

test("graph close revokes synchronously even with deferred invalidation and pending prepare", async (t) => {
  const { Effect, control, compiler, result } = await actualFactory(t);
  const layer = compiler.compile(control.node, {
    replacements: result.overrides,
  });
  await Effect.runPromise(
    Effect.provide(
      Effect.gen(function* () {
        const actual = yield* control.Service;
        const pending = result.taskControl.prepare(prepareRequest());
        const invalidation = result.taskControl.close("owner_lost");
        const inspect = () =>
          actual.transaction(["project"], (tx) =>
            actual.inspect(tx, "project"),
          );
        assert.equal((yield* inspect()).runtimeHeld, false);
        assert.deepEqual(yield* pending, unavailable);
        assert.deepEqual(
          yield* result.taskControl.prepare(prepareRequest()),
          unavailable,
        );
        assert.equal((yield* inspect()).runtimeHeld, false);
        yield* invalidation;
        // Closing the facade invalidates the actual Service obtained from the graph.
        assert.equal((yield* inspect()).runtimeHeld, true);
        assert.deepEqual(
          yield* actual.prepareTask(prepareRequest()),
          unavailable,
        );
        const malformed = yield* Effect.exit(
          result.taskControl.prepare({
            ...prepareRequest(),
            text: "forbidden",
          }),
        );
        assert.equal(malformed._tag, "Failure");
      }),
      layer,
    ).pipe(Effect.timeout("5 seconds")),
  );
});

test("closing before acquisition refuses later acquisition of that graph", async (t) => {
  const { Effect, control, compiler, result } = await actualFactory(t);
  const deferred = result.taskControl.close("stopped");
  assert.deepEqual(
    await Effect.runPromise(result.taskControl.prepare(prepareRequest())),
    unavailable,
  );
  const layer = compiler.compile(control.node, {
    replacements: result.overrides,
  });
  await assert.rejects(
    Effect.runPromise(Effect.provide(control.Service, layer)),
    /native_permission_runtime_unavailable/,
  );
  await Effect.runPromise(deferred);
});
