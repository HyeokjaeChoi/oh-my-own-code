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
import { NATIVE_PERMISSION_OVERLAY_RECEIPT } from "./native-permission-overlay-contract.mjs";
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
async function actualFactory(t, changeManifest = () => {}, onLoad = () => {}) {
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
  modules["@opencode/core/dist/chunks/config-11jgdds2.js"] = {
    isAgentMetadataListener2: () => false,
  };
  const originalRead = () => {
    throw Error("Native consumer must not run");
  };
  const createNativeReadEffects = () => {
    throw Error("Read effects must not construct");
  };
  modules["@opencode/core/dist/chunks/config-119mbqs2.js"] = {
    read2: originalRead,
  };

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
    ["opencode.provider.cerebras", "wc3fc9cn", "CerebrasPlugin2"],
    ["opencode.provider.kilo", "qg3g05ea", "KiloPlugin2"],
    ["opencode.provider.nvidia", "24dcb14g", "NvidiaPlugin2"],
    ["opencode.provider.openrouter", "s72nwfj1", "OpenRouterPlugin2"],
    ["opencode.provider.prompt-cache-key", "k35dwc4g", "PromptCacheKeyPlugin2"],
    ["opencode.provider.zenmux", "jjkms2e6", "ZenmuxPlugin2"],
    ["opencode.provider.cohere", "z0bkrqjs", "CoherePlugin2"],
    ["opencode.provider.gateway", "669tq793", "GatewayPlugin2"],
    ["opencode.provider.perplexity", "veqvce7d", "PerplexityPlugin2"],
    ["opencode.provider.venice", "yrhqyw5v", "VenicePlugin2"],
    ["opencode.provider.amazon.bedrock", "7nwbzwwg", "AmazonBedrockPlugin2"],
    ["opencode.provider.google.vertex", "8pbmndb6", "GoogleVertexPlugin2"],
    ["opencode.provider.vercel", "pezzyds3", "VercelPlugin2"],
    ["opencode.agent", "az9r17tx", "Plugin34"],
    ["opencode.mcp.codemode.defaults", "0xqyf95c", "Plugin26"],
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
  const sdkOwners = new WeakMap(),
    sdkPublications = new WeakMap();
  for (const [id, chunk, symbol] of hookDefinitions.filter(([id]) =>
    [
      "opencode.provider.cohere",
      "opencode.provider.gateway",
      "opencode.provider.perplexity",
      "opencode.provider.venice",
    ].includes(id),
  )) {
    const owner =
      modules[`@opencode/core/dist/chunks/config-${chunk}.js`][symbol];
    const value = hookDeclarations.get(id);
    sdkOwners.set(value, owner);
    for (const row of value.hooks)
      sdkPublications.set(row.callback, { owner, value });
  }
  modules["@opencode/core/dist/chunks/config-ym463w8f.js"] = {
    isFixedHookDeclaration2: (value, owner) => sdkOwners.get(value) === owner,
    getFixedHookPublication2: (callback, owner) =>
      sdkPublications.get(callback)?.owner === owner
        ? sdkPublications.get(callback).value
        : undefined,
  };
  files.push({
    path: "node_modules/@opencode/core/dist/chunks/config-ym463w8f.js",
    beforeSha256: "0".repeat(64),
    afterSha256: "d".repeat(64),
  });
  // Decoy entries ensure matching uses the full exact transformed path.
  files.unshift({
    path: "decoy/config-kcmnw9z9.js",
    afterSha256: "f".repeat(64),
  });
  files.push({
    path: "node_modules/@opencode/core/dist/chunks/config-119mbqs2.js",
    beforeSha256:
      "80ddf77b814ec271b0a169c58eb80999867a110dfe7a554838b594ecdfbe0c84",
    afterSha256: "c".repeat(64),
  });
  for (const [chunk, beforeSha256] of [
    [
      "gh5tebn4",
      "3fd56d8e579c116c8e766b080295d35dc0af3ac04a276834fa4649b7bfe29cef",
    ],
    [
      "vaz5h5qv",
      "61e70c3fbcb62f304a6e930404e6f306a36385c5e93d58ef8ae5da2bc87aac2e",
    ],
    [
      "znr04804",
      "5d3cbf85696f24f6e07fc226754ca19544d15a19abd82eaf01dfbbbb49c7107d",
    ],
    [
      "g4xer9vd",
      "0b78f3dbd0899a168d980f6946490c7763b37005fe6d3bd9518cc161f1c97029",
    ],
    [
      "hbtt76ya",
      "8afa7591a9f6c71e2c3169b0b55a2429ad578705ca32a67b35fe992dc8b76198",
    ],
    [
      "11jgdds2",
      "ca0f6134bc21197f76ca12fede197b08f41eb4ad736db99bf3beed4eed03f992",
    ],
    [
      "vhejgqwc",
      "d1c57ce84aa8014e8e2f2ba09fae01912941dc2ef614821556bd6e2b7726ccc4",
    ],
  ])
    files.push({
      path: `node_modules/@opencode/core/dist/chunks/config-${chunk}.js`,
      beforeSha256,
      afterSha256: "e".repeat(64),
    });
  const manifest = {
    permissionOverlay: { files },
    entries: [
      ...[
        [
          "node_modules/@opencode/core/dist/chunks/config-gd4qta3r.js",
          "89c5db7b2a8dac6d7383745186270354317edab7c3771410532923cd32422982",
        ],
        [
          "node_modules/@opencode/core/dist/chunks/config-ec1grn59.js",
          "ae641a78a0362b12cd9f11593c12e115d4f896bee5dbafbe5052a314d88b4f82",
        ],
        [
          "node_modules/@opencode/schema/dist/event.js",
          "71d91c9726dee6df55f9a2472c034fa1941ec0c2b2b89469a40bb78231ad1e03",
        ],
        [
          "node_modules/@opencode/schema/dist/schema.js",
          "f5ca3a5da2eda8726ddfd3003203589eb20487158976beddf3f65ba602acf6c6",
        ],

        [
          "node_modules/@opencode/core/dist/chunks/config-tats7t1r.js",
          "30003b4f011a368aa4e3f9a8c86e95e6994b1f889b21a70a531297b6c79cad64",
        ],
        [
          "node_modules/@opencode/core/dist/chunks/config-rdw6cm16.js",
          "8627e8ffcac2bfc7225c3d4731b0d180c86dc1cf9b445e7f2f74fb436328288c",
        ],
        [
          "node_modules/@opencode/schema/dist/agent.js",
          "c18ebdc0462ffb0625c286b6ab8a1f6f25081f395ca06b53553ba3d3147dd25e",
        ],
        [
          "node_modules/@opencode/schema/dist/session-event.js",
          "f1e5e1652c97ebdde3fd945bca43bf7bc77ff77e949b36307ca1d9af850ff07c",
        ],
        [
          "node_modules/@opencode/core/dist/chunks/config-skwjfd4r.js",
          "26b0675f239f11bb5053567ad0ce8f3d32aa2e559d8158947db4ea69e4b34ffc",
        ],
        [
          "node_modules/@opencode/core/dist/chunks/config-gk30pdy3.js",
          "3e6a9601868a860703d8fb99a2b10558a4450f9046077ce70d904d3c8c37e1ca",
        ],
      ].map(([path, sha256]) => ({ path, type: "file", sha256 })),
      {
        path: "node_modules/@opencode/core/dist/chunks/config-yds56wag.js",
        type: "file",
        sha256:
          "694e68cfbc64c520478a98074c0b7e53a5a60f555a5ada934f08635c37e6f9ee",
      },
      {
        path: "node_modules/@opencode/core/dist/chunks/config-ppzgkaaq.js",
        type: "file",
        sha256:
          "070409f56769cf4bd845dc6adc94c51a51f4818947a6b821809b21e367c5acc5",
      },
      {
        path: "native-permission-read-effect.mjs",
        type: "file",
        sha256: "d".repeat(64),
      },
      {
        path: "node_modules/@opencode/core/dist/chunks/config-s4enseaf.js",
        type: "file",
        sha256:
          "164d7b54c26bec17fc4291f61569c602598b63f66c90052650ac80be2d079cdf",
      },
      {
        path: "node_modules/@opencode/core/dist/chunks/config-z0bkrqjs.js",
        type: "file",
        sha256:
          "e544e70da4832b6ab29e08bb416dfeed915987b22522b72a4fe288e1bd442aa2",
      },
      {
        path: "node_modules/@opencode/core/dist/chunks/config-669tq793.js",
        type: "file",
        sha256:
          "74217f50ff12c4ea378921d557f4dbf7a148902febefee639c086f0881c5377a",
      },
      {
        path: "node_modules/@opencode/core/dist/chunks/config-veqvce7d.js",
        type: "file",
        sha256:
          "4e4af94467e4568d02c5ad9fb069cc88950a7da8778615f9b0d8e2bda4769ad7",
      },
      {
        path: "node_modules/@opencode/core/dist/chunks/config-yrhqyw5v.js",
        type: "file",
        sha256:
          "33f6a5f99d298e3b01aa1d1e18827e326ba71b50660e01f44c5304fd524881d4",
      },
      {
        path: "node_modules/@opencode/core/dist/chunks/config-3w5fmr99.js",
        type: "file",
        sha256:
          "2b374f48f4be331e06419fb43f30dfab5b2fa72d45b1cc8500d633ab3e6f0a6b",
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
    onLoad(url);
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
              bindNativeReadRuntime(binding) {
                assert.equal(binding.read, originalRead);
                assert.equal(binding.effects, createNativeReadEffects);
                assert.equal(binding.consumerSha256, "c".repeat(64));
                assert.equal(binding.effectsSha256, "d".repeat(64));
                return service.bindNativeReadRuntime(binding);
              },
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
    if (
      url ===
      pathToFileURL(
        join(validOptions().root, "native-permission-read-effect.mjs"),
      ).href
    )
      return { createNativeReadEffects };
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
    "NATIVE_PERMISSION_OVERLAY_RECEIPT",
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
    NATIVE_PERMISSION_OVERLAY_RECEIPT,
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
    // Cover the complete closed source set. Count changes alone are not a
    // reason to repair unrelated assertions after adding a verified producer.
    assert.deepEqual(
      hookDefinitions.map(([id]) => id).sort(),
      Object.keys(FIXED_HOOK_DECLARATIONS).sort(),
    );
    assert.equal(hookSources.length, hookDefinitions.length);
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
            `node_modules/@opencode/core/dist/chunks/config-${["z0bkrqjs", "669tq793", "veqvce7d", "yrhqyw5v"].includes(chunk) ? "ym463w8f" : chunk}.js`,
        ).afterSha256,
      );
      hookRows += value.hooks.length;
    }
    assert.equal(
      hookRows,
      Object.values(FIXED_HOOK_DECLARATIONS).flat().length,
    );
    const expectedImports = [
      ...Object.keys(modules).map(
        (path) =>
          pathToFileURL(join(validOptions().root, "node_modules", path)).href,
      ),
      ...[
        "native-permission-control.mjs",
        "native-permission-read-effect.mjs",
      ].map((path) => pathToFileURL(join(validOptions().root, path)).href),
    ];
    assert.deepEqual([...loads].sort(), expectedImports.sort());
    assert.equal(new Set(loads).size, loads.length);
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
      manifest.entries.find((entry) =>
        entry.path.endsWith("config-3w5fmr99.js"),
      ).sha256 = "f".repeat(64);
    },
  ])
    await assert.rejects(
      () => actualFactory(t, change),
      /native_permission_graph_unverified/,
    );
});

test("Database acquisition requires exact original source before any module import", async (t) => {
  for (const alteration of ["missing", "digest", "type"]) {
    let loads = 0;
    await assert.rejects(
      () =>
        actualFactory(
          t,
          (manifest) => {
            const path =
              "node_modules/@opencode/core/dist/chunks/config-yds56wag.js";
            const entry = manifest.entries.find((row) => row.path === path);
            if (alteration === "missing")
              manifest.entries = manifest.entries.filter(
                (row) => row !== entry,
              );
            else if (alteration === "digest") entry.sha256 = "f".repeat(64);
            else entry.type = "directory";
          },
          () => loads++,
        ),
      /native_permission_graph_unverified/,
    );
    assert.equal(loads, 0, alteration);
  }
});

test("SDK metadata registration requires exact original source before any module import", async (t) => {
  for (const alteration of ["missing", "digest", "type"]) {
    let loads = 0;
    await assert.rejects(
      () =>
        actualFactory(
          t,
          (manifest) => {
            const path =
              "node_modules/@opencode/core/dist/chunks/config-ppzgkaaq.js";
            const entry = manifest.entries.find((row) => row.path === path);
            if (alteration === "missing")
              manifest.entries = manifest.entries.filter(
                (row) => row !== entry,
              );
            else if (alteration === "digest") entry.sha256 = "f".repeat(64);
            else entry.type = "directory";
          },
          () => loads++,
        ),
      /native_permission_graph_unverified/,
    );
    assert.equal(loads, 0, alteration);
  }
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

test("each fixed Provider source requires its own exact transformed manifest entry", async (t) => {
  for (const chunk of [
    "wc3fc9cn",
    "qg3g05ea",
    "24dcb14g",
    "s72nwfj1",
    "k35dwc4g",
    "jjkms2e6",
  ]) {
    const { Effect, control, compiler, result } = await actualFactory(
      t,
      (manifest) => {
        manifest.permissionOverlay.files =
          manifest.permissionOverlay.files.filter(
            (file) => !file.path.endsWith(`chunks/config-${chunk}.js`),
          );
      },
    );
    const layer = compiler.compile(control.node, {
      replacements: result.overrides,
    });
    await assert.rejects(
      Effect.runPromise(Effect.provide(control.Service, layer)),
      /native_permission_graph_unverified/,
    );
    assert.deepEqual(
      await Effect.runPromise(result.taskControl.prepare(prepareRequest())),
      unavailable,
    );
  }
});

test("shared SDK factory callers require exact original source hashes before pinned imports", async (t) => {
  for (const chunk of ["z0bkrqjs", "669tq793", "veqvce7d", "yrhqyw5v"]) {
    for (const change of [
      (manifest) => {
        manifest.entries = manifest.entries.filter(
          (entry) => !entry.path.endsWith(`config-${chunk}.js`),
        );
      },
      (manifest) => {
        manifest.entries.find((entry) =>
          entry.path.endsWith(`config-${chunk}.js`),
        ).sha256 = "f".repeat(64);
      },
    ])
      await assert.rejects(
        () => actualFactory(t, change),
        /native_permission_graph_unverified/,
      );
  }
});

test("literal config consumer must match inspected source before Native imports", async (t) => {
  for (const alteration of ["missing", "digest", "type"]) {
    let loads = 0;
    await assert.rejects(
      () =>
        actualFactory(
          t,
          (manifest) => {
            const index = manifest.entries.findIndex((entry) =>
              entry.path.endsWith("config-s4enseaf.js"),
            );
            if (alteration === "missing") manifest.entries.splice(index, 1);
            else if (alteration === "digest")
              manifest.entries[index].sha256 = "f".repeat(64);
            else manifest.entries[index].type = "directory";
          },
          () => loads++,
        ),
      /native_permission_graph_unverified/,
    );
    assert.equal(loads, 0);
  }
});

test("Read consumer and effects provenance must both exist before any Native service import", async (t) => {
  for (const change of [
    (manifest) => {
      manifest.permissionOverlay.files =
        manifest.permissionOverlay.files.filter(
          (entry) => !entry.path.endsWith("config-119mbqs2.js"),
        );
    },
    (manifest) => {
      manifest.permissionOverlay.files.find((entry) =>
        entry.path.endsWith("config-119mbqs2.js"),
      ).beforeSha256 = "f".repeat(64);
    },
    (manifest) => {
      manifest.permissionOverlay.files.find((entry) =>
        entry.path.endsWith("config-119mbqs2.js"),
      ).afterSha256 = "bad";
    },
    (manifest) => {
      manifest.entries = manifest.entries.filter(
        (entry) => entry.path !== "native-permission-read-effect.mjs",
      );
    },
    (manifest) => {
      manifest.entries.find(
        (entry) => entry.path === "native-permission-read-effect.mjs",
      ).sha256 = "bad";
    },
  ])
    await assert.rejects(
      () => actualFactory(t, change),
      /native_permission_graph_unverified/,
    );
});

test("Agent and MCP defaults require their own exact transformed source in the same graph", async (t) => {
  for (const chunk of ["az9r17tx", "0xqyf95c"])
    for (const alteration of ["missing", "invalid"]) {
      const { Effect, control, compiler, result } = await actualFactory(
        t,
        (manifest) => {
          const path = `node_modules/@opencode/core/dist/chunks/config-${chunk}.js`;
          if (alteration === "missing")
            manifest.permissionOverlay.files =
              manifest.permissionOverlay.files.filter(
                (entry) => entry.path !== path,
              );
          else
            manifest.permissionOverlay.files.find(
              (entry) => entry.path === path,
            ).afterSha256 = "bad";
        },
      );
      const layer = compiler.compile(control.node, {
        replacements: result.overrides,
      });
      await assert.rejects(
        Effect.runPromise(Effect.provide(control.Service, layer)),
        /native_permission_(?:graph|inventory)_unverified/,
      );
    }
});

test("Agent notification closure requires exact original and transformed source identities before any Native import", async (t) => {
  for (const suffix of [
    "config-ec1grn59.js",
    "schema/dist/event.js",
    "schema/dist/schema.js",
    "config-tats7t1r.js",
    "config-rdw6cm16.js",
    "schema/dist/agent.js",
    "schema/dist/session-event.js",
    "config-11jgdds2.js",
    "config-vhejgqwc.js",
  ]) {
    for (const alteration of ["missing", "digest", "type"]) {
      let loads = 0;
      await assert.rejects(
        () =>
          actualFactory(
            t,
            (manifest) => {
              const overlay = [
                "config-11jgdds2.js",
                "config-vhejgqwc.js",
              ].includes(suffix);
              const rows = overlay
                ? manifest.permissionOverlay.files
                : manifest.entries;
              const row = rows.find((entry) => entry.path.endsWith(suffix));
              if (alteration === "missing") rows.splice(rows.indexOf(row), 1);
              else if (overlay)
                row[alteration === "digest" ? "beforeSha256" : "afterSha256"] =
                  alteration === "digest" ? "f".repeat(64) : undefined;
              else
                row[alteration === "digest" ? "sha256" : "type"] =
                  alteration === "digest" ? "f".repeat(64) : "directory";
            },
            () => loads++,
          ),
        /native_permission_graph_unverified/u,
      );
      assert.equal(loads, 0, `${suffix}/${alteration}`);
    }
  }
});

test("startup maintenance source closure is required before Native imports", async (t) => {
  for (const suffix of [
    "config-g4xer9vd.js",
    "config-hbtt76ya.js",
    "config-gd4qta3r.js",
  ]) {
    for (const alteration of ["missing", "digest", "type"]) {
      let loads = 0;
      await assert.rejects(
        () =>
          actualFactory(
            t,
            (manifest) => {
              const overlay = suffix !== "config-gd4qta3r.js";
              const rows = overlay
                ? manifest.permissionOverlay.files
                : manifest.entries;
              const row = rows.find((entry) => entry.path.endsWith(suffix));
              if (alteration === "missing") rows.splice(rows.indexOf(row), 1);
              else if (overlay)
                row[alteration === "digest" ? "beforeSha256" : "afterSha256"] =
                  alteration === "digest" ? "f".repeat(64) : undefined;
              else
                row[alteration === "digest" ? "sha256" : "type"] =
                  alteration === "digest" ? "f".repeat(64) : "directory";
            },
            () => loads++,
          ),
        /native_permission_graph_unverified/u,
      );
      assert.equal(loads, 0, `${suffix}/${alteration}`);
    }
  }
});

test("metadata startup source closure is required before Native imports", async (t) => {
  for (const suffix of [
    "config-vaz5h5qv.js",
    "config-znr04804.js",
    "config-gh5tebn4.js",
  ]) {
    for (const alteration of ["missing", "digest", "type"]) {
      let loads = 0;
      await assert.rejects(
        () =>
          actualFactory(
            t,
            (manifest) => {
              const overlay = suffix !== "config-gd4qta3r.js";
              const rows = overlay
                ? manifest.permissionOverlay.files
                : manifest.entries;
              const row = rows.find((entry) => entry.path.endsWith(suffix));
              if (alteration === "missing") rows.splice(rows.indexOf(row), 1);
              else if (overlay)
                row[alteration === "digest" ? "beforeSha256" : "afterSha256"] =
                  alteration === "digest" ? "f".repeat(64) : undefined;
              else
                row[alteration === "digest" ? "sha256" : "type"] =
                  alteration === "digest" ? "f".repeat(64) : "directory";
            },
            () => loads++,
          ),
        /native_permission_graph_unverified/u,
      );
      assert.equal(loads, 0, `${suffix}/${alteration}`);
    }
  }
});

test("Worktree direct registration sources require exact originals before any Native import", async (t) => {
  for (const chunk of ["skwjfd4r", "gk30pdy3"]) {
    for (const alteration of ["missing", "digest", "type"]) {
      let loads = 0;
      await assert.rejects(
        () =>
          actualFactory(
            t,
            (manifest) => {
              const path = `node_modules/@opencode/core/dist/chunks/config-${chunk}.js`;
              const entry = manifest.entries.find((row) => row.path === path);
              if (alteration === "missing")
                manifest.entries = manifest.entries.filter(
                  (row) => row !== entry,
                );
              else if (alteration === "digest") entry.sha256 = "f".repeat(64);
              else entry.type = "directory";
            },
            () => loads++,
          ),
        /native_permission_graph_unverified/,
      );
      assert.equal(loads, 0, `${chunk}:${alteration}`);
    }
  }
});
