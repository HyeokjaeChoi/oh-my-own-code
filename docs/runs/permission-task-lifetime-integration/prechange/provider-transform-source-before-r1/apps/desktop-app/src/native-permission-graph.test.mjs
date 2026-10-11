import { copyPermissionControlSources } from "../scripts/native-permission-test-fixture.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createBuiltinDeclarationProjector } from "./native-permission-tool-data.mjs";
import {
  FIXED_TOOL_DECLARATIONS,
  FIXED_HOOK_DECLARATIONS,
} from "./native-permission-inventory.mjs";
import { EVENT_HOST_CODE_ASSETS } from "./event-host-resources.mjs";
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
async function actualFactory(t, changeManifest = () => {}) {
  const { mkdtemp, readFile, rm, symlink } = await import("node:fs/promises");
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
  await copyPermissionControlSources(root);
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
  let modelDependencies = 0,
    modelNetwork = 0;
  const ModelDependency = Context.Service("graph-fixture/models-dependency");
  const ModelsService = Context.Service("graph-fixture/models");
  const modelDependency = makeGlobalNode({
    service: ModelDependency,
    layer: Layer.effect(
      ModelDependency,
      library.Effect.sync(() => {
        modelDependencies++;
        return {};
      }),
    ),
    deps: [],
  });
  const modelsLayer = (options = {}) =>
    Layer.effect(
      ModelsService,
      library.Effect.gen(function* () {
        yield* ModelDependency;
        if (options.fetch !== false) modelNetwork++;
        return { options };
      }),
    );
  const modelsNode = makeGlobalNode({
    service: ModelsService,
    layer: modelsLayer(),
    deps: [modelDependency],
  });
  modules["@opencode/core/dist/chunks/config-2synrjax.js"] = {
    exports_models_dev: {
      Service: ModelsService,
      node: modelsNode,
      layer: modelsLayer,
    },
  };
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
  // Scripted private brands and converter only. Never import Native core modules.
  const declarations = new Map();
  const brands = new WeakSet();
  let conversions = 0;
  const definition2 = (tool) => {
    conversions++;
    return {
      type: "tool",
      name: tool.name,
      description: tool.description,
      inputSchema: tool.input,
    };
  };
  modules["@opencode/core/dist/chunks/config-3w5fmr99.js"] = { definition2 };
  const files = [];
  for (const [family, chunk, plugin] of [
    ["read", "kcmnw9z9", "Plugin37"],
    ["question", "fcxyj98j", "Plugin51"],
    ["glob", "ec87pa6m", "Plugin38"],
    ["grep", "e661jwrm", "Plugin50"],
    ["skill", "ym52mge9", "Plugin44"],
    ["webfetch", "4xsr0mw7", "Plugin43"],
    ["edit", "04zc2vp5", "Plugin39"],
    ["write", "5m3ds5v3", "Plugin42"],
    ["patch", "8f36rj9w", "Plugin46"],
    ["shell", "2et2b5t1", "Plugin41"],
    ["subagent", "191v1wnc", "Plugin49"],
    ["websearch", "9tndjada", "Plugin45"],
    ["opencodeTools", "kb6gw2zp", "Plugin47"],
    ["mcpResources", "e2skv07x", "Plugin48"],
    ["browser", "browser", "default"],
  ]) {
    const id =
      family === "browser"
        ? "opencode.browser"
        : family === "opencodeTools"
          ? "opencode.tools"
          : family === "mcpResources"
            ? "opencode.tools.mcp-resources"
            : `opencode.tool.${family}`;
    const tools = FIXED_TOOL_DECLARATIONS[id].map(({ toolId }) =>
      Object.freeze({
        name: toolId,
        description: "inert declaration",
        input: { type: "number", minimum: -1.5 },
        options: Object.freeze({ fixture: true }),
        execute() {
          assert.fail("tool execution is forbidden");
        },
      }),
    );
    const result =
      tools.length === 1
        ? tools[0]
        : Object.freeze({
            namespace: Object.freeze({ name: "fixture" }),
            declarations: Object.freeze(tools),
          });
    brands.add(result);
    declarations.set(id, result);
    const path =
      family === "browser"
        ? "node_modules/@opencode/plugin-browser/dist/tools.js"
        : `node_modules/@opencode/core/dist/chunks/config-${chunk}.js`;
    files.push({
      path,
      beforeSha256: "0".repeat(64),
      afterSha256: createHash("sha256")
        .update(`scripted transformed ${chunk}`)
        .digest("hex"),
    });
    modules[path.slice("node_modules/".length)] = {
      [plugin]: Object.freeze({ id, effect: () => library.Effect.void }),
      [`get${family[0].toUpperCase() + family.slice(1)}Publication2`]: () =>
        undefined,
      [`is${family[0].toUpperCase() + family.slice(1)}Declaration2`]: (value) =>
        brands.has(value) && value === result,
    };
  }
  modules["@opencode/plugin-browser/dist/index.js"] = {
    default: modules["@opencode/plugin-browser/dist/tools.js"].default,
  };
  const hookDefinitions = [
    ["opencode.tool.input.repair", "reg6q42h", "Plugin31"],
    ["opencode.prompt.openai", "6pc27hjz", "OpenAIPlugin2"],
    ["opencode.prompt.anthropic", "6pc27hjz", "AnthropicPlugin2"],
    ["opencode.prompt.kimi", "6pc27hjz", "KimiPlugin2"],
    ["opencode.prompt.arcee", "6pc27hjz", "ArceePlugin2"],
    ["opencode.prompt.meta", "6pc27hjz", "MetaPlugin2"],
    ["opencode.prompt.verbosity", "rqzxc8xy", "Plugin29"],
    ["opencode.prompt.identity", "y6mhz57t", "Plugin32"],
  ];
  const hookDeclarations = new Map(),
    hookCallbacks = new WeakMap();
  for (const [id, chunk, plugin] of hookDefinitions) {
    const key = `@opencode/core/dist/chunks/config-${chunk}.js`;
    if (!modules[key]) {
      files.push({
        path: `node_modules/${key}`,
        beforeSha256: "0".repeat(64),
        afterSha256: createHash("sha256")
          .update(`scripted transformed ${chunk}`)
          .digest("hex"),
      });
      modules[key] = {
        isFixedHookDeclaration2: (value, pluginId) =>
          hookDeclarations.get(pluginId) === value,
        getFixedHookPublication2: (callback, pluginId) =>
          hookCallbacks.get(callback)?.id === pluginId
            ? hookCallbacks.get(callback).value
            : undefined,
      };
    }
    const callback = () => {
      assert.fail("hook execution is forbidden");
    };
    const value = Object.freeze({
      hooks: Object.freeze(
        FIXED_HOOK_DECLARATIONS[id].map((row) =>
          Object.freeze({ ...row, callback, options: undefined }),
        ),
      ),
    });
    hookDeclarations.set(id, value);
    hookCallbacks.set(callback, { id, value });
    modules[key][plugin] = Object.freeze({
      id,
      effect: () => library.Effect.void,
    });
  }
  // Decoy entries ensure matching uses the full exact transformed path.
  files.unshift({
    path: "decoy/config-kcmnw9z9.js",
    afterSha256: "f".repeat(64),
  });
  const manifest = {
    permissionOverlay: { files },
    entries: [
      {
        path: "node_modules/@opencode/core/dist/chunks/config-3w5fmr99.js",
        type: "file",
        sha256:
          "28f8e167d496e3469ce4d1532b003b6adbc03c6641734be66a9e7b02fad1584d",
      },
      {
        path: "node_modules/@opencode/core/dist/chunks/config-2synrjax.js",
        type: "file",
        sha256:
          "768f6a969bbd880e29e67cf4f28a5395d6a9e18d58dea4c9f19f43366208f999",
      },
    ],
  };
  changeManifest(manifest);
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
  const sources = [],
    hookSources = [];
  let verified = false;
  const loads = [];
  const load = async (url) => {
    assert.equal(
      verified,
      true,
      "resource verification must precede every module load",
    );
    loads.push(url);
    if (
      url ===
      pathToFileURL(join(validOptions().root, "native-permission-control.mjs"))
        .href
    )
      return {
        ...control,
        configured: (options, acquire) =>
          control.configured(options, (service) => {
            acquire({
              ...service,
              inventoryHookSource(plugin, accepts, publication, sourceSha256) {
                hookSources.push([plugin, accepts, publication, sourceSha256]);
                return service.inventoryHookSource(
                  plugin,
                  accepts,
                  publication,
                  sourceSha256,
                );
              },
              inventoryToolSource(plugin, accepts, project, publication) {
                sources.push([plugin, accepts, project, publication]);
                return service.inventoryToolSource(
                  plugin,
                  accepts,
                  project,
                  publication,
                );
              },
            });
          }),
      };
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
    "createBuiltinDeclarationProjector",
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
    async () => {
      verified = true;
      return manifest;
    },
    () => ({}),
    createBuiltinDeclarationProjector,
    load,
  );
  const result = await create(validOptions());
  assert.equal(result.overrides.length, 7);
  assert.deepEqual(Object.keys(result).sort(), ["overrides", "taskControl"]);
  assert.deepEqual(Object.keys(result.taskControl).sort(), [
    "close",
    "prepare",
  ]);
  assert.ok(Object.isFrozen(result.taskControl));
  const assertSources = () => {
    const expected = [
      ["kcmnw9z9", "Plugin37", "isReadDeclaration2"],
      ["fcxyj98j", "Plugin51", "isQuestionDeclaration2"],
      ["ec87pa6m", "Plugin38", "isGlobDeclaration2"],
      ["e661jwrm", "Plugin50", "isGrepDeclaration2"],
      ["ym52mge9", "Plugin44", "isSkillDeclaration2"],
      ["4xsr0mw7", "Plugin43", "isWebfetchDeclaration2"],
      ["04zc2vp5", "Plugin39", "isEditDeclaration2"],
      ["5m3ds5v3", "Plugin42", "isWriteDeclaration2"],
      ["8f36rj9w", "Plugin46", "isPatchDeclaration2"],
      ["2et2b5t1", "Plugin41", "isShellDeclaration2"],
      ["191v1wnc", "Plugin49", "isSubagentDeclaration2"],
      ["9tndjada", "Plugin45", "isWebsearchDeclaration2"],
      ["kb6gw2zp", "Plugin47", "isOpencodeToolsDeclaration2"],
      ["e2skv07x", "Plugin48", "isMcpResourcesDeclaration2"],
      ["browser", "default", "isBrowserDeclaration2"],
    ];
    assert.equal(sources.length, expected.length);
    assert.equal(conversions, 0, "binding must not convert schemas");
    let projected = 0;
    for (const [index, [chunk, plugin, predicate]] of expected.entries()) {
      const sourcePath =
        chunk === "browser"
          ? "node_modules/@opencode/plugin-browser/dist/tools.js"
          : `node_modules/@opencode/core/dist/chunks/config-${chunk}.js`;
      const module = modules[sourcePath.slice("node_modules/".length)];
      assert.equal(sources[index][0], module[plugin]);
      assert.equal(sources[index][1], module[predicate]);
      assert.equal(typeof sources[index][3], "function");
      assert.equal(
        sources[index][3],
        module[
          predicate
            .replace(/^is/u, "get")
            .replace("Declaration2", "Publication2")
        ],
      );
      assert.ok(Object.isFrozen(sources[index][0]));
      const project = sources[index][2];
      assert.equal(typeof project, "function");
      const before = conversions;
      assert.throws(
        () =>
          project(
            Object.freeze({
              get input() {
                throw new Error("unbranded schema read");
              },
            }),
          ),
        /native_permission_declaration_unverified/,
      );
      assert.equal(conversions, before);
      const rows = project(declarations.get(module[plugin].id));
      const sourceSha256 = files.find(
        (file) => file.path === sourcePath,
      ).afterSha256;
      assert.deepEqual(
        rows.map((row) => row.toolId),
        FIXED_TOOL_DECLARATIONS[module[plugin].id].map((row) => row.toolId),
      );
      assert.ok(Object.isFrozen(rows));
      for (const row of rows) {
        assert.ok(Object.isFrozen(row));
        assert.equal(row.sourceSha256, sourceSha256);
        const digest = (domain, value) =>
          createHash("sha256")
            .update(`omoc.permission.tool.${domain}.v1\n`)
            .update(JSON.stringify(value))
            .digest("hex");
        assert.equal(
          row.schemaDigest,
          digest("schema", {
            description: "inert declaration",
            inputSchema: { minimum: -1.5, type: "number" },
            name: row.toolId,
            type: "tool",
          }),
        );
        assert.equal(
          row.optionsDigest,
          digest("options", {
            namespace: rows.length === 1 ? null : { name: "fixture" },
            options: { fixture: true },
          }),
        );
        projected++;
      }
    }
    assert.equal(hookSources.length, 8);
    let hookRows = 0;
    for (const [index, [id, chunk, plugin]] of hookDefinitions.entries()) {
      const module = modules[`@opencode/core/dist/chunks/config-${chunk}.js`],
        binding = hookSources[index],
        value = hookDeclarations.get(id);
      assert.equal(binding[0], module[plugin]);
      assert.equal(binding[1](value), true);
      assert.equal(binding[1]({ ...value }), false);
      assert.equal(binding[2](value.hooks[0].callback), value);
      assert.equal(
        binding[2](() => {}),
        undefined,
      );
      assert.equal(
        binding[3],
        files.find(
          (f) =>
            f.path ===
            `node_modules/@opencode/core/dist/chunks/config-${chunk}.js`,
        ).afterSha256,
      );
      hookRows += value.hooks.length;
    }
    assert.equal(hookRows, 23);
    assert.equal(loads.length, 29);
    assert.equal(projected, 62);
    assert.equal(conversions, 62);
  };
  return {
    ...library,
    compiler,
    control,
    result,
    assertSources,
    models: {
      Service: ModelsService,
      node: modelsNode,
      counts: () => ({
        dependencies: modelDependencies,
        network: modelNetwork,
      }),
    },
  };
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

test("graph disables automatic model discovery with original layer and preserves dependency acquisition", async (t) => {
  const { Effect, compiler, result, models } = await actualFactory(t);
  const layer = compiler.compile(models.node, {
    replacements: result.overrides,
  });
  const value = await Effect.runPromise(Effect.provide(models.Service, layer));
  assert.deepEqual(value.options, { fetch: false, snapshot: true });
  assert.deepEqual(models.counts(), { dependencies: 1, network: 0 });
});

test("actual graph facade binds the same acquired Control once and observes its invalidation", async (t) => {
  const { Effect, control, compiler, result, assertSources } =
    await actualFactory(t);
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
        assertSources();
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
        const inventory = yield* actual.transaction(["project"], (tx) =>
          actual.inventorySnapshot(tx, "project"),
        );
        assert.equal(inventory.complete, false);
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

test("staged graph closure includes its declaration projector", () => {
  assert.ok(EVENT_HOST_CODE_ASSETS.includes("native-permission-tool-data.mjs"));
});

test("unapproved original schema converter hash refuses before any pinned import", async (t) => {
  for (const change of [
    (manifest) => {
      manifest.entries = [];
    },
    (manifest) => {
      manifest.entries[0].sha256 = "f".repeat(64);
    },
  ])
    await assert.rejects(
      () => actualFactory(t, change),
      /native_permission_graph_unverified/,
    );
});

test("unapproved ModelsDev source refuses before pinned service import", async (t) => {
  for (const change of [
    (manifest) => {
      manifest.entries = manifest.entries.filter(
        (entry) => !entry.path.endsWith("config-2synrjax.js"),
      );
    },
    (manifest) => {
      manifest.entries.find((entry) =>
        entry.path.endsWith("config-2synrjax.js"),
      ).sha256 = "f".repeat(64);
    },
  ])
    await assert.rejects(
      () => actualFactory(t, change),
      /native_permission_graph_unverified/,
    );
});

test("graph refuses missing or invalid exact transformed source hashes", async (t) => {
  for (const change of [
    (manifest) => {
      manifest.permissionOverlay.files =
        manifest.permissionOverlay.files.filter(
          (file) => !file.path.endsWith("chunks/config-kcmnw9z9.js"),
        );
    },
    (manifest) => {
      manifest.permissionOverlay.files.find((file) =>
        file.path.endsWith("chunks/config-kcmnw9z9.js"),
      ).afterSha256 = undefined;
    },
    (manifest) => {
      manifest.permissionOverlay.files.find((file) =>
        file.path.endsWith("chunks/config-kcmnw9z9.js"),
      ).afterSha256 = "bad";
    },
  ]) {
    const { Effect, control, compiler, result } = await actualFactory(
      t,
      change,
    );
    const layer = compiler.compile(control.node, {
      replacements: result.overrides,
    });
    await assert.rejects(
      Effect.runPromise(Effect.provide(control.Service, layer)),
      /native_permission_(?:graph|declaration)_unverified/,
    );
    assert.deepEqual(
      await Effect.runPromise(result.taskControl.prepare(prepareRequest())),
      unavailable,
    );
  }
});
