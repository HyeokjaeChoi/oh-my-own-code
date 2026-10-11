import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { NATIVE_PERMISSION_OVERLAY_RECIPE as recipe } from "./native-permission-overlay-contract.mjs";
const root = new URL(
  "../runtime-event-host/.generated/install/",
  import.meta.url,
);
const chunks = [
  "config-reg6q42h.js",
  "config-6pc27hjz.js",
  "config-rqzxc8xy.js",
  "config-y6mhz57t.js",
];
test("existing8 sources export private fixed hook declaration and publication API", async () => {
  for (const chunk of chunks) {
    const path = `node_modules/@opencode/core/dist/chunks/${chunk}`;
    let source = await readFile(new URL(path, root), "utf8");
    for (const edit of recipe.files.find((file) => file.path === path)?.edits ??
      [])
      source = source.replace(edit.find, () => edit.replace);
    assert.match(
      source,
      /export var isFixedHookDeclaration2 =/,
      `${chunk}: missing declaration API`,
    );
    assert.match(
      source,
      /export var getFixedHookPublication2 =/,
      `${chunk}: missing publication API`,
    );
  }
});

// Evaluate only selected inert declarations. No original module is imported.
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const eslintRequire = createRequire(require.resolve("eslint"));
const parse = eslintRequire("espree").parse;
const eslintScope = eslintRequire("eslint-scope");
const ast = (source) =>
  parse(source, { ecmaVersion: "latest", sourceType: "module", range: true });
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const receipt = JSON.parse(
  await readFile(new URL("../receipt.json", root), "utf8"),
);
async function pinned(path) {
  const source = await readFile(new URL(path, root), "utf8");
  assert.equal(
    hash(source),
    receipt.installEntries.find((entry) => entry.path === path)?.sha256,
    path,
  );
  return source;
}
function nodes(source) {
  return ast(source)
    .body.map((node) =>
      node.type === "ExportNamedDeclaration" ? node.declaration : node,
    )
    .filter(Boolean);
}
function selected(source, names) {
  const found = nodes(source).filter((node) =>
    node.type === "FunctionDeclaration"
      ? names.includes(node.id.name)
      : node.type === "VariableDeclaration" &&
        node.declarations.every((declaration) =>
          names.includes(declaration.id.name),
        ),
  );
  assert.equal(
    found.flatMap((node) =>
      node.type === "FunctionDeclaration"
        ? [node.id.name]
        : node.declarations.map((declaration) => declaration.id.name),
    ).length,
    names.length,
  );
  return found.map((node) => source.slice(...node.range)).join("\n");
}
function walk(node, visit) {
  if (!node || typeof node !== "object") return;
  if (typeof node.type === "string") visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === "range") continue;
    if (Array.isArray(value)) value.forEach((child) => walk(child, visit));
    else if (value && typeof value === "object") walk(value, visit);
  }
}
function callbackSources(source) {
  const found = [];
  walk(ast(source), (node) => {
    if (
      node.type === "ArrowFunctionExpression" &&
      node.params[0]?.name === "event"
    )
      found.push(source.slice(...node.range));
  });
  return found;
}
const specs = [
  {
    chunk: chunks[0],
    ids: ["opencode.tool.input.repair"],
    vars: ["Plugin31"],
    domain: "tool",
    hooks: ["execute.before"],
    names: [
      "decodeJson",
      "maxDepth",
      "Plugin31",
      "repair",
      "repairObject",
      "repairArray",
    ],
  },
  {
    chunk: chunks[1],
    ids: [
      "opencode.prompt.openai",
      "opencode.prompt.anthropic",
      "opencode.prompt.kimi",
      "opencode.prompt.arcee",
      "opencode.prompt.meta",
    ],
    vars: [
      "OpenAIPlugin2",
      "AnthropicPlugin2",
      "KimiPlugin2",
      "ArceePlugin2",
      "MetaPlugin2",
    ],
    domain: "session",
    hooks: ["context", "compaction", "generate"],
    names: [
      "gpt_default",
      "gpt_astra_default",
      "kimi_default",
      "anthropic_default",
      "trinity_default",
      "meta_default",
      "OpenAIPlugin2",
      "AnthropicPlugin2",
      "OpenAIToolsPlugin2",
      "AnthropicToolsPlugin2",
      "KimiPlugin2",
      "ArceePlugin2",
      "MetaPlugin2",
      "Plugins2",
      "make",
    ],
  },
  {
    chunk: chunks[2],
    ids: ["opencode.prompt.verbosity"],
    vars: ["Plugin29"],
    domain: "session",
    hooks: ["context", "compaction", "generate", "title"],
    names: [
      "direct",
      "gateways",
      "Plugin29",
      "supportsVerbosity",
      "openAIModelID",
    ],
  },
  {
    chunk: chunks[3],
    ids: ["opencode.prompt.identity"],
    vars: ["Plugin32"],
    domain: "session",
    hooks: ["context", "compaction", "generate"],
    names: ["identity2", "Plugin32"],
  },
];
const privateNames = [
  "fixedHookDeclarations2",
  "fixedHookPublications2",
  "isFixedHookDeclaration2",
  "getFixedHookPublication2",
  "fixedHookBundle2",
  "fixedHookDeclaration2",
];
const E = await import(
  "../runtime-event-host/.generated/install/node_modules/effect/dist/index.js"
);
const { Effect } = E;
const defineSource = selected(
  await pinned("node_modules/@opencode/plugin/dist/effect/plugin.js"),
  ["define"],
);
const renderSource = selected(
  await pinned("node_modules/@opencode/core/dist/chunks/config-drwq78ky.js"),
  ["render3"],
);
const aisdkSource = selected(
  await pinned("node_modules/@opencode/core/dist/chunks/config-zrq68ahz.js"),
  ["AISDK_PREFIX2", "isAISDK2", "aisdk2"],
);
const modelSource = await pinned("node_modules/@opencode/schema/dist/model.js");
const defaults = [];
walk(ast(modelSource), (node) => {
  if (
    node.type === "Property" &&
    node.key.name === "default" &&
    node.value.type === "ArrowFunctionExpression"
  )
    defaults.push(node.value);
});
const defaultInfo = defaults.find(
  (node) => node.params.map((param) => param.name).join() === "providerID,id",
);
const defaultCapabilities = defaults.find((node) => node.params.length === 0);
assert.ok(defaultInfo && defaultCapabilities);
const Model = new Function(
  `const Capabilities = {default: ${modelSource.slice(...defaultCapabilities.range)}}; return {Info: {default: ${modelSource.slice(...defaultInfo.range)}}};`,
)();
const systemSource = await pinned(
  "node_modules/@opencode/ai/dist/schema/messages.js",
);
const SystemPart = new Function(
  `${selected(systemSource, ["makeSystemPart"])};return {make:makeSystemPart};`,
)();
const Service68 = E.Context.Service("scripted/hook-models");
const deps = {
  Effect,
  Option: E.Option,
  Predicate: E.Predicate,
  Schema: E.Schema,
  Model,
  SystemPart,
  Service68,
  definition2: (tool) => tool.definition,
};
function load(source, spec, patched) {
  const code = [
    defineSource,
    renderSource,
    aisdkSource,
    selected(source, [...spec.names, ...(patched ? privateNames : [])]),
  ].join("\n");
  const globals = [
    ...new Set(
      eslintScope
        .analyze(ast(code), { ecmaVersion: 2024, sourceType: "module" })
        .globalScope.through.map((reference) => reference.identifier.name),
    ),
  ].sort();
  const allowed = [
    "Object",
    "WeakMap",
    "Set",
    "Array",
    "Number",
    "undefined",
    ...Object.keys(deps),
  ];
  assert.deepEqual(
    globals.filter((name) => !allowed.includes(name)),
    [],
    "extracted closure cannot reach unapproved modules or IO",
  );
  return new Function(
    ...Object.keys(deps),
    `${code};return {plugins:[${spec.vars.join(",")}], ${spec.chunk === chunks[1] ? "tools:[OpenAIToolsPlugin2,AnthropicToolsPlugin2]," : ""}${patched ? "make:fixedHookDeclaration2,accepts:isFixedHookDeclaration2,lookup:getFixedHookPublication2" : ""}};`,
  )(...Object.values(deps));
}
async function sources(spec) {
  const path = `node_modules/@opencode/core/dist/chunks/${spec.chunk}`;
  const before = await pinned(path);
  const entry = recipe.files.find((file) => file.path === path);
  assert.ok(entry);
  assert.equal(hash(before), entry.beforeSha256);
  let after = before;
  for (const edit of entry.edits) {
    assert.equal(after.split(edit.find).length - 1, 1);
    after = after.replace(edit.find, () => edit.replace);
  }
  assert.equal(hash(after), entry.afterSha256);
  ast(after);
  let restored = after;
  for (const edit of [...entry.edits].reverse()) {
    assert.equal(restored.split(edit.replace).length - 1, 1);
    restored = restored.replace(edit.replace, () => edit.find);
  }
  assert.equal(restored, before);
  return { before, after };
}
function trap() {
  return new Proxy(function () {}, {
    get() {
      throw Error("factory touched context");
    },
    apply() {
      throw Error("factory called context");
    },
  });
}
function scripted(
  spec,
  { model, tool, error = false, agentSystem = false } = {},
) {
  const log = [],
    rows = [];
  const failOr = (value) =>
    error
      ? Effect.fail(new Error("scripted lookup failure"))
      : Effect.succeed(value);
  const ctx = {
    model: {
      list: () => {
        log.push("model.list");
        return failOr({ data: model ? [model] : [] });
      },
    },
    agent: {
      get: () => {
        log.push("agent.get");
        return failOr({ data: { system: agentSystem } });
      },
    },
    tool: {
      list: () => {
        log.push("tool.list");
        return failOr(tool ? [tool] : []);
      },
    },
    session: {},
  };
  ctx[spec.domain].hook = (...args) => {
    log.push(`construct:${args[0]}`);
    return Effect.acquireRelease(
      Effect.sync(() => {
        log.push(`register:${args[0]}`);
        rows.push(args);
      }),
      () => Effect.sync(() => log.push(`release:${args[0]}`)),
    );
  };
  const models = {
    get: (...args) => {
      log.push(["models.get", ...args]);
      return failOr(model);
    },
  };
  return { ctx, rows, log, models };
}
function activate(plugin, fixture, body = () => Effect.void) {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const bundle = yield* plugin.effect(fixture.ctx);
        yield* body(bundle);
        return bundle;
      }).pipe(Effect.provideService(Service68, fixture.models)),
    ),
  );
}
for (const spec of specs) {
  test(`${spec.chunk}: exact original callback closures, private ID binding, inert factory, ordered activation/result/disposal`, async () => {
    const { before, after } = await sources(spec);
    const originalCallbacks = callbackSources(before);
    const newCallbacks = callbackSources(after);
    for (const callback of newCallbacks)
      assert.ok(originalCallbacks.includes(callback), "callback body changed");
    for (const callback of originalCallbacks)
      assert.ok(newCallbacks.includes(callback), "callback body removed");
    if (spec.chunk === chunks[1]) {
      assert.equal(
        newCallbacks.length,
        2,
        "fixed factory and untouched original tools closure",
      );
      assert.equal(
        selected(after, ["make"]).endsWith(
          selected(before, ["make"]).slice(
            'function make(id, optimize, mode = "override") {'.length,
          ),
        ),
        true,
      );
    } else assert.equal(newCallbacks.length, 1);
    const current = load(after, spec, true);
    const foreign = load(after, spec, true);
    const old = load(before, spec, false);
    const inert = trap();
    for (let index = 0; index < spec.ids.length; index++) {
      const id = spec.ids[index],
        plugin = current.plugins[index];
      assert.equal(plugin.id, id);
      assert.ok(Object.isFrozen(plugin));
      // The factory can create closures, but cannot read services or run callbacks.
      const bundle =
        spec.chunk === chunks[1]
          ? current.make(inert, id, inert, "override")
          : current.make(inert);
      assert.ok(current.accepts(bundle, id));
      assert.equal(foreign.accepts(bundle, id), false);
      assert.ok(Object.isFrozen(bundle));
      assert.deepEqual(Reflect.ownKeys(bundle), ["hooks"]);
      assert.ok(Object.isFrozen(bundle.hooks));
      assert.deepEqual(
        bundle.hooks.map(({ domain, name }) => [domain, name]),
        spec.hooks.map((name) => [spec.domain, name]),
      );
      for (const row of bundle.hooks) {
        assert.ok(Object.isFrozen(row));
        assert.deepEqual(Reflect.ownKeys(row), [
          "domain",
          "name",
          "callback",
          "options",
        ]);
        assert.equal(row.options, undefined);
        assert.equal(typeof row.callback, "function");
        assert.equal(current.lookup(row.callback, id), bundle);
        for (const wrong of [
          undefined,
          null,
          "",
          "foreign",
          ...specs.flatMap((s) => s.ids).filter((value) => value !== id),
        ]) {
          assert.equal(current.accepts(bundle, wrong), false);
          assert.equal(current.lookup(row.callback, wrong), undefined);
        }
        assert.equal(foreign.lookup(row.callback, id), undefined);
        assert.equal(current.lookup(row.callback.bind(null), id), undefined);
      }
      const proxy = new Proxy(
        {},
        {
          get() {
            throw Error("lookup must not read properties");
          },
        },
      );
      for (const value of [
        undefined,
        null,
        1,
        "",
        {},
        { ...bundle },
        Object.freeze({ hooks: bundle.hooks }),
        proxy,
        () => {},
      ]) {
        assert.equal(current.accepts(value, id), false);
        assert.equal(current.lookup(value, id), undefined);
      }
      const fixture = scripted(spec);
      // Service acquisition still precedes declaration construction and registration.
      const modelsEffect = Effect.sync(() => {
        fixture.log.push("acquire:models");
        return fixture.models;
      });
      const returned = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            return yield* plugin
              .effect(fixture.ctx)
              .pipe(Effect.provideServiceEffect(Service68, modelsEffect));
          }),
        ),
      );
      assert.equal(current.accepts(returned, id), true);
      assert.notEqual(returned, bundle);
      assert.deepEqual(
        fixture.rows.map((args) => [spec.domain, args[0]]),
        spec.hooks.map((name) => [spec.domain, name]),
      );
      fixture.rows.forEach((args, i) => {
        assert.equal(
          args.length,
          2,
          "original absent options argument must remain absent",
        );
        assert.equal(args[1], returned.hooks[i].callback);
        assert.equal(
          current.lookup(args[1], id),
          returned,
          "actual effect returns the registered bundle",
        );
      });
      assert.deepEqual(fixture.log, [
        "acquire:models",
        ...spec.hooks.flatMap((name) => [
          `construct:${name}`,
          `register:${name}`,
        ]),
        ...spec.hooks.toReversed().map((name) => `release:${name}`),
      ]);
      assert.equal(
        fixture.log.some(
          (item) =>
            typeof item !== "string" ||
            item.endsWith(".list") ||
            item.endsWith(".get"),
        ),
        false,
      );
      const baseline = scripted(spec);
      await activate(old.plugins[index], baseline);
      assert.deepEqual(
        fixture.rows.map((args) => args[0]),
        baseline.rows.map((args) => args[0]),
      );
      assert.deepEqual(fixture.log.slice(1), baseline.log);
      const second = scripted(spec);
      const secondBundle = await activate(plugin, second);
      assert.notEqual(secondBundle, returned);
      assert.notEqual(
        secondBundle.hooks[0].callback,
        returned.hooks[0].callback,
      );
      assert.equal(current.lookup(returned.hooks[0].callback, id), returned);
    }
    if (spec.chunk === chunks[1]) {
      for (let i = 0; i < current.tools.length; i++) {
        const fixture = scripted(spec);
        assert.equal(await activate(current.tools[i], fixture), undefined);
        assert.equal(
          current.accepts(fixture.rows[0][1], current.tools[i].id),
          false,
        );
        assert.equal(
          current.lookup(fixture.rows[0][1], current.tools[i].id),
          undefined,
        );
        assert.equal(
          Object.isFrozen(current.tools[i]),
          false,
          "unowned tools descriptor stays original",
        );
      }
    }
  });
}

const baseModel = (id) => ({
  id,
  modelID: id,
  providerID: "provider",
  name: "Scripted Model",
  variants: [],
  package: "@opencode/ai/providers/openai",
});
const eventFor = (id) => ({
  model: { providerID: "provider", id },
  agent: "agent",
  tools: { shell: {}, write: {}, edit: {}, grep: {}, glob: {} },
  system: [
    { type: "text", text: "Original system", cache: { type: "ephemeral" } },
  ],
  options: {},
});
for (const spec of specs) {
  test(`${spec.chunk}: original callback behavior matches with scripted model/schema/agent inputs only`, async () => {
    const { before, after } = await sources(spec);
    const current = load(after, spec, true),
      old = load(before, spec, false);
    for (let index = 0; index < spec.ids.length; index++) {
      const id = spec.ids[index];
      const modelID = {
        "opencode.prompt.openai": "gpt-6-astra",
        "opencode.prompt.anthropic": "claude-scripted",
        "opencode.prompt.kimi": "kimi-scripted",
        "opencode.prompt.arcee": "trinity-scripted",
        "opencode.prompt.meta": "muse-scripted",
        "opencode.prompt.verbosity": "gpt-6",
        "opencode.prompt.identity": "scripted-model",
      }[id];
      const cases =
        spec.domain === "tool"
          ? [
              { event: { tool: "execute", input: { count: "2" } } },
              { event: { tool: "missing", input: { count: "2" } } },
              {
                tool: {
                  id: "sample",
                  definition: {
                    inputSchema: {
                      type: "object",
                      properties: {
                        count: { type: "integer" },
                        enabled: { type: "boolean" },
                      },
                      additionalProperties: false,
                    },
                  },
                },
                event: {
                  tool: "sample",
                  input: '{"count":"2","enabled":"true","extra":1}',
                },
              },
              {
                tool: {
                  id: "sample",
                  definition: {
                    inputSchema: {
                      type: "object",
                      properties: {
                        count: { type: "integer" },
                        enabled: { type: "boolean" },
                      },
                      additionalProperties: false,
                    },
                  },
                },
                event: {
                  tool: "sample",
                  input: { count: "2", enabled: "true", extra: 1 },
                },
              },
              {
                tool: {
                  id: "sample",
                  definition: {
                    inputSchema: { type: "array", items: { type: "integer" } },
                  },
                },
                event: { tool: "sample", input: ["2"] },
              },
            ]
          : [
              { model: baseModel(modelID), event: eventFor(modelID) },
              { event: eventFor(modelID) }, // Original Model.Info.default, or missing Verbosity model.
              { model: baseModel("unmatched"), event: eventFor("unmatched") },
              {
                model: baseModel(modelID),
                agentSystem: true,
                event: eventFor(modelID),
              },
              {
                model: baseModel(modelID),
                event: { ...eventFor(modelID), system: [] },
              },
              {
                model: baseModel(modelID),
                error: true,
                event: eventFor(modelID),
              },
              ...(id === "opencode.prompt.openai"
                ? [{ model: baseModel("gpt-5"), event: eventFor("gpt-5") }]
                : []),
              ...(id === "opencode.prompt.verbosity"
                ? [
                    { model: baseModel("gpt-5.4"), event: eventFor("gpt-5.4") },
                    {
                      model: baseModel("gpt-5-chat"),
                      event: eventFor("gpt-5-chat"),
                    },
                    {
                      model: {
                        ...baseModel("gpt-6"),
                        settings: { textVerbosity: "high" },
                      },
                      event: eventFor("gpt-6"),
                    },
                    {
                      model: {
                        ...baseModel("gpt-6"),
                        variants: [
                          { id: "v", settings: { textVerbosity: "high" } },
                        ],
                      },
                      event: {
                        ...eventFor("gpt-6"),
                        model: {
                          providerID: "provider",
                          id: "gpt-6",
                          variant: "v",
                        },
                      },
                    },
                    {
                      model: baseModel("gpt-6"),
                      event: {
                        ...eventFor("gpt-6"),
                        options: { textVerbosity: "medium" },
                      },
                    },
                    {
                      model: {
                        ...baseModel("gpt-6"),
                        modelID: "openai/gpt-6",
                        package: "aisdk:@ai-sdk/gateway",
                      },
                      event: eventFor("gpt-6"),
                    },
                    {
                      model: {
                        ...baseModel("gpt-6"),
                        modelID: "openai.gpt-6",
                        package:
                          "@opencode/ai/providers/amazon-bedrock/mantle/responses",
                      },
                      event: eventFor("gpt-6"),
                    },
                  ]
                : []),
            ];
      for (const item of cases) {
        for (const hookIndex of spec.hooks.keys()) {
          const outputs = [];
          for (const implementation of [
            old.plugins[index],
            current.plugins[index],
          ]) {
            const fixture = scripted(spec, globalThis.structuredClone(item));
            const event = globalThis.structuredClone(item.event);
            let result;
            await activate(implementation, fixture, () =>
              fixture.rows[hookIndex][1](event).pipe(
                Effect.match({
                  onSuccess: () => {
                    result = "success";
                  },
                  onFailure: (error) => {
                    result = error.message;
                  },
                }),
              ),
            );
            outputs.push({ event, result, log: fixture.log });
          }
          assert.deepEqual(
            outputs[1],
            outputs[0],
            `${id}/${spec.hooks[hookIndex]}: changed callback behavior`,
          );
          if (item === cases[0] && spec.domain === "session") {
            if (id === "opencode.prompt.verbosity")
              assert.equal(outputs[1].event.options.textVerbosity, "low");
            else if (id === "opencode.prompt.identity")
              assert.equal(
                outputs[1].event.system[1].text,
                "# Your Model\n- Name: Scripted Model\n- Provider ID: provider\n- Model ID: scripted-model",
              );
            else {
              assert.notEqual(
                outputs[1].event.system[0].text,
                "Original system",
              );
              assert.equal(
                outputs[1].event.system[0].text.startsWith(
                  "Original system\n\n",
                ),
                id === "opencode.prompt.anthropic",
              );
              if (id === "opencode.prompt.meta")
                assert.ok(
                  outputs[1].event.system[0].text.includes("Scripted Model"),
                );
            }
          }
          if (spec.domain === "tool" && item === cases[3])
            assert.deepEqual(outputs[1].event.input, {
              count: 2,
              enabled: true,
            });
        }
      }
    }
  });
}

test("Verbosity failed original service acquisition registers nothing; live activation stays in original Scope", async () => {
  const spec = specs[2],
    { before, after } = await sources(spec);
  const original = load(before, spec, false).plugins[0],
    current = load(after, spec, true).plugins[0];
  const acquisition = "    const models = yield* Service68;";
  assert.equal(before.split(acquisition).length - 1, 1);
  assert.equal(after.split(acquisition).length - 1, 1);
  assert.ok(
    after.indexOf(acquisition) <
      after.indexOf("const declaration = fixedHookDeclaration2(models);"),
  );
  for (const plugin of [original, current]) {
    const fixture = scripted(spec);
    const outcome = await Effect.runPromise(
      Effect.scoped(
        plugin.effect(fixture.ctx).pipe(
          Effect.provideServiceEffect(
            Service68,
            Effect.fail("scripted-acquisition-failed"),
          ),
          Effect.match({
            onSuccess: () => "unexpected",
            onFailure: (error) => error,
          }),
        ),
      ),
    );
    assert.equal(outcome, "scripted-acquisition-failed");
    assert.deepEqual(fixture.rows, []);
    assert.deepEqual(fixture.log, []);
  }
  const fixture = scripted(spec);
  await activate(current, fixture, (bundle) =>
    Effect.sync(() => {
      assert.equal(
        fixture.log.some((entry) => entry.startsWith("release:")),
        false,
      );
      assert.equal(bundle.hooks.length, 4);
      assert.throws(() => {
        bundle.hooks[0].name = "other";
      }, TypeError);
      assert.throws(() => {
        bundle.hooks.push({});
      }, TypeError);
    }),
  );
  assert.equal(
    fixture.log.filter((entry) => entry.startsWith("release:")).length,
    4,
  );
});

test("existing forty recipe entries retain all original edits and Browser baseline bytes", async () => {
  const baseline = await import(
    "../../../docs/runs/permission-task-lifetime-integration/prechange/hook-source-before-r1/apps/desktop-app/src/native-permission-overlay-contract.mjs"
  );
  assert.equal(
    baseline.NATIVE_PERMISSION_OVERLAY_RECEIPT.recipeSha256,
    "e583c8fbf6864284ad21e3575e22a41f0cb28b6949be4e72372acec2286ac7c3",
  );
  assert.deepEqual(
    recipe.files.slice(0, 40),
    baseline.NATIVE_PERMISSION_OVERLAY_RECIPE.files,
  );
  assert.equal(recipe.files.length, 44);
  assert.equal(new Set(recipe.files.map((file) => file.path)).size, 44);
  assert.equal(
    specs.reduce(
      (count, spec) => count + spec.ids.length * spec.hooks.length,
      0,
    ),
    23,
  );
});
