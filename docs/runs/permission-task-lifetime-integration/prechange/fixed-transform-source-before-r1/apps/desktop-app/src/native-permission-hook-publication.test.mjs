// Actual pinned Effect and original hook registry; private producer is scripted.
// This is metadata/Scope evidence. Callback execution authority stays held.
import assert from "node:assert/strict";
import ts from "typescript";
import test, { after } from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, symlink, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { NATIVE_PERMISSION_OVERLAY_RECIPE as recipe } from "./native-permission-overlay-contract.mjs";
import { copyPermissionControlSources } from "../scripts/native-permission-test-fixture.mjs";
import {
  BUILTIN_PLUGIN_ORDER,
  observeRegistration,
} from "./native-permission-inventory.mjs";
const install = fileURLToPath(
  new URL("../runtime-event-host/.generated/install/", import.meta.url),
);
const root = await mkdtemp(join(tmpdir(), "omoc-hook-publication-"));
after(() => rm(root, { recursive: true, force: true }));
await symlink(join(install, "node_modules"), join(root, "node_modules"));
await copyPermissionControlSources(root);
const Control = await import(
  pathToFileURL(join(root, "native-permission-control.mjs"))
);
const E = await import(
  pathToFileURL(join(install, "node_modules/effect/dist/index.js"))
);
const { Effect, Scope, Exit } = E;
const path = "node_modules/@opencode/core/dist/chunks/config-5y480sgp.js";
const original = await readFile(join(install, path), "utf8");
const receipt = JSON.parse(
  await readFile(join(install, "../receipt.json"), "utf8"),
);
assert.equal(
  createHash("sha256").update(original).digest("hex"),
  receipt.installEntries.find((r) => r.path === path).sha256,
);
const Hooks = new Function(
  "Context",
  "Effect",
  "Layer",
  "Scope",
  original.slice(
    original.indexOf("var eventProviderID ="),
    original.indexOf("var node63 ="),
  ) + "return {Service61,layer};",
)(E.Context, E.Effect, E.Layer, E.Scope);
const refused = (effect) =>
  Effect.gen(function* () {
    assert.ok(Exit.isFailure(yield* Effect.exit(effect)));
  });
const snapshot = (c) =>
  c.transaction(["project"], (tx) => c.inventorySnapshot(tx, "project"));
function producer(
  id = "opencode.prompt.openai",
  rows = [
    ["session", "context"],
    ["session", "compaction"],
    ["session", "generate"],
  ],
) {
  const brands = new WeakSet(),
    callbacks = new WeakMap();
  let effects = 0;
  const plugin = Object.freeze({
    id,
    effect: () => Effect.void,
  });
  const make = () => {
    const callback = () =>
      Effect.sync(() => {
        effects++;
      });
    const value = Object.freeze({
      hooks: Object.freeze(
        rows.map(([domain, name]) =>
          Object.freeze({
            domain,
            name,
            callback,
            options: undefined,
          }),
        ),
      ),
    });
    brands.add(value);
    callbacks.set(callback, value);
    return value;
  };
  return {
    plugin,
    make,
    accepts: (v) => brands.has(v),
    publication: (cb) => callbacks.get(cb),
    effects: () => effects,
  };
}
const run = (body, makeProducer = producer) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const c = yield* Control.Service,
          hooks = yield* Hooks.Service61;
        const h = yield* c.locationBegin({ directory: "/hook-publication" });
        yield* c.locationBind(h, {
          directory: "/hook-publication",
          project: { id: "project" },
        });
        yield* c.locationReady(h);
        yield* c.inventoryPlan(
          h,
          BUILTIN_PLUGIN_ORDER.pre.map((id) => ({ id })),
          BUILTIN_PLUGIN_ORDER.post.map((id) => ({ id })),
          [{}],
        );
        const p = makeProducer();
        c.inventoryHookSource(
          p.plugin,
          p.accepts,
          p.publication,
          "a".repeat(64),
        );
        const d = Object.freeze({ id: p.plugin.id, effect: () => Effect.void });
        yield* c.inventoryToolResolve(h, p.plugin, d);
        const parent = yield* c.inventoryBegin(h, "plugin", p.plugin.id),
          scope = yield* Scope.make();
        yield* c.inventoryToolActivation(parent, d, scope);
        const reg = observeRegistration(
          Effect,
          Scope,
          c,
          h,
          "hook",
          hooks.register,
        );
        return yield* body({ c, h, p, d, parent, scope, reg, hooks });
      }).pipe(
        Effect.provide(
          Control.configured({
            runtimeEpoch: "hook-publication",
            bootHolds: [],
          }),
        ),
        Effect.provide(Hooks.layer),
      ),
    ),
  );
const publish = (f, value) =>
  Effect.gen(function* () {
    const results = [];
    for (const row of value.hooks)
      results.push(
        yield* f
          .reg(row.domain, row.name, row.callback, row.options)
          .pipe(Effect.provideService(Scope.Scope, f.scope)),
      );
    yield* f.c.inventoryToolResult(f.h, f.d, value, f.scope);
    yield* f.c.inventoryToolDeclaration(f.parent, f.d, value);
    yield* f.c.inventoryRegistered(f.parent);
    return results;
  });
test("source-owned hook API records original three registrations without invoking callback", () =>
  run((f) =>
    Effect.gen(function* () {
      const value = f.p.make();
      yield* publish(f, value);
      const s = yield* snapshot(f.c);
      assert.equal(s.complete, false);
      assert.deepEqual(s.capabilities, []);
      assert.deepEqual(
        s.locations[0].hooks.map(({ domain, name }) => [domain, name]),
        value.hooks.map(({ domain, name }) => [domain, name]),
      );
      assert.ok(
        s.locations[0].hooks.every(
          (row) => row.sourceSha256 === "a".repeat(64),
        ),
      );
      assert.equal(f.p.effects(), 0);
      yield* refused(f.hooks.trigger("session", "context", {}));
      assert.equal(f.p.effects(), 0);
      yield* Scope.close(f.scope, Exit.void);
      assert.deepEqual((yield* snapshot(f.c)).locations[0].hooks, []);
    }),
  ));
test("unknown hook callback refuses BEFORE original registry installs it", () =>
  run((f) =>
    Effect.gen(function* () {
      let called = 0;
      yield* refused(
        f
          .reg("session", "context", () => Effect.sync(() => called++))
          .pipe(Effect.provideService(Scope.Scope, f.scope)),
      );
      assert.equal(yield* f.hooks.has("session", "context"), false);
      assert.equal(called, 0);
    }),
  ));
test("known callback cannot register a different event or add options", () =>
  run((f) =>
    Effect.gen(function* () {
      const v = f.p.make(),
        cb = v.hooks[0].callback;
      yield* refused(
        f
          .reg("session", "title", cb)
          .pipe(Effect.provideService(Scope.Scope, f.scope)),
      );
      yield* refused(
        f
          .reg("session", "context", cb, { providerID: "forged" })
          .pipe(Effect.provideService(Scope.Scope, f.scope)),
      );
      assert.equal(yield* f.hooks.has("session", "context"), false);
    }),
  ));
test("same callback from another Scope cannot publish into original activation", () =>
  run((f) =>
    Effect.gen(function* () {
      const v = f.p.make(),
        other = yield* Scope.make();
      yield* refused(
        f
          .reg("session", "context", v.hooks[0].callback)
          .pipe(Effect.provideService(Scope.Scope, other)),
      );
      assert.equal(yield* f.hooks.has("session", "context"), false);
      yield* Scope.close(other, Exit.void);
    }),
  ));
test("duplicate hook row refuses and incomplete publication cannot complete", () =>
  run((f) =>
    Effect.gen(function* () {
      const v = f.p.make(),
        r = v.hooks[0];
      yield* f
        .reg(r.domain, r.name, r.callback, r.options)
        .pipe(Effect.provideService(Scope.Scope, f.scope));
      yield* refused(
        f
          .reg(r.domain, r.name, r.callback, r.options)
          .pipe(Effect.provideService(Scope.Scope, f.scope)),
      );
      yield* refused(f.c.inventoryToolResult(f.h, f.d, v, f.scope));
    }),
  ));
test("foreign same-shape declaration cannot replace actual published bundle", () =>
  run((f) =>
    Effect.gen(function* () {
      const v = f.p.make();
      for (const r of v.hooks)
        yield* f
          .reg(r.domain, r.name, r.callback, r.options)
          .pipe(Effect.provideService(Scope.Scope, f.scope));
      yield* refused(f.c.inventoryToolResult(f.h, f.d, { ...v }, f.scope));
      yield* refused(f.c.inventoryToolResult(f.h, f.d, f.p.make(), f.scope));
    }),
  ));
test("disposed hook row retires parent metadata before registry cleanup", () =>
  run((f) =>
    Effect.gen(function* () {
      const v = f.p.make(),
        results = yield* publish(f, v);
      yield* results[0].dispose;
      assert.deepEqual((yield* snapshot(f.c)).locations[0].hooks, []);
      assert.equal(yield* f.hooks.has("session", "context"), false);
      yield* refused(f.hooks.trigger("session", "compaction", {}));
      assert.equal(f.p.effects(), 0);
    }),
  ));

test("closed original activation refuses retained callback before original registry", () =>
  run((f) =>
    Effect.gen(function* () {
      const v = f.p.make();
      yield* Scope.close(f.scope, Exit.void);
      yield* f.c.inventoryEnd(f.parent, "disposed");
      yield* refused(
        f
          .reg("session", "context", v.hooks[0].callback)
          .pipe(Effect.provideService(Scope.Scope, f.scope)),
      );
      assert.equal(yield* f.hooks.has("session", "context"), false);
    }),
  ));

test("extra option refusal stays failed after later valid rows", () =>
  run((f) =>
    Effect.gen(function* () {
      const v = f.p.make();
      yield* refused(
        f
          .reg("session", "context", v.hooks[0].callback, {
            providerID: "other",
          })
          .pipe(Effect.provideService(Scope.Scope, f.scope)),
      );
      for (const r of v.hooks)
        yield* f
          .reg(r.domain, r.name, r.callback, r.options)
          .pipe(Effect.provideService(Scope.Scope, f.scope));
      yield* refused(f.c.inventoryToolResult(f.h, f.d, v, f.scope));
      assert.deepEqual((yield* snapshot(f.c)).locations[0].hooks, []);
    }),
  ));

test("published hook identity requires trusted frozen source and exact descriptor copy", () =>
  run((f) =>
    Effect.gen(function* () {
      assert.throws(() =>
        f.c.inventoryHookSource(
          f.p.plugin,
          f.p.accepts,
          f.p.publication,
          "a".repeat(64),
        ),
      );
      const clone = Object.freeze({ ...f.d });
      const scope = yield* Scope.make();
      const token = yield* f.c.inventoryBegin(f.h, "plugin", f.p.plugin.id);
      yield* refused(f.c.inventoryToolActivation(token, clone, scope));
      yield* Scope.close(scope, Exit.void);
    }),
  ));

// Exact transformed original repair factory -> same Control -> original registry.
// The define helper and forbidden IO dependencies are scripted, never imported.
test("actual original repair producer publishes its branded callback through original hook registry", async () => {
  const path = "node_modules/@opencode/core/dist/chunks/config-reg6q42h.js";
  let source = await readFile(join(install, path), "utf8");
  const entry = recipe.files.find((row) => row.path === path);
  assert.equal(
    createHash("sha256").update(source).digest("hex"),
    entry.beforeSha256,
  );
  for (const edit of entry.edits) {
    assert.equal(source.split(edit.find).length - 1, 1);
    source = source.replace(edit.find, () => edit.replace);
  }
  assert.equal(
    createHash("sha256").update(source).digest("hex"),
    entry.afterSha256,
  );
  const start = source.indexOf("var fixedHookDeclarations2 ="),
    end = source.indexOf("function repair(", start);
  assert.ok(start >= 0 && end > start);
  let io = 0;
  const forbidden = () => {
    io++;
    throw Error("forbidden original callback effect");
  };
  const actual = new Function(
    "Effect",
    "define",
    "definition2",
    "repair",
    source.slice(start, end).replaceAll("export var ", "var ") +
      "return {plugin:Plugin31,accepts:isFixedHookDeclaration2,publication:getFixedHookPublication2};",
  )(Effect, (value) => value, forbidden, forbidden);
  await run(
    (f) =>
      Effect.gen(function* () {
        const ctx = {
          tool: {
            hook: (name, callback) => f.reg("tool", name, callback),
            list: forbidden,
          },
        };
        const value = yield* f.p.plugin
          .effect(ctx)
          .pipe(Effect.provideService(Scope.Scope, f.scope));
        yield* f.c.inventoryToolResult(f.h, f.d, value, f.scope);
        yield* f.c.inventoryToolDeclaration(f.parent, f.d, value);
        yield* f.c.inventoryRegistered(f.parent);
        const rows = (yield* snapshot(f.c)).locations[0].hooks;
        assert.deepEqual(
          rows.map(({ domain, name }) => [domain, name]),
          [["tool", "execute.before"]],
        );
        yield* refused(
          f.hooks.trigger("tool", "execute.before", { tool: "read" }),
        );
        assert.equal(io, 0);
        yield* Scope.close(f.scope, Exit.void);
        assert.deepEqual((yield* snapshot(f.c)).locations[0].hooks, []);
      }),
    () => ({
      plugin: actual.plugin,
      accepts: (value) => actual.accepts(value, actual.plugin.id),
      publication: (cb) => actual.publication(cb, actual.plugin.id),
    }),
  );
});

// These explicit source rows model only publication. The original registry and
// Control are real; no callback execution or provider setup is authorized.
for (const [family, domains] of [
  ["cerebras", ["provider"]],
  ["kilo", ["provider"]],
  ["nvidia", ["provider"]],
  ["openrouter", ["provider", "model"]],
  ["prompt-cache-key", ["model"]],
  ["zenmux", ["provider"]],
]) {
  test(`provider ${family} original registry publication remains held and retires on Scope close`, () =>
    run(
      (f) =>
        Effect.gen(function* () {
          const value = f.p.make();
          yield* publish(f, value);
          const before = yield* snapshot(f.c);
          assert.equal(before.complete, false);
          assert.deepEqual(before.capabilities, []);
          assert.deepEqual(
            before.locations[0].hooks.map(({ domain, name }) => [domain, name]),
            domains.map((domain) => [domain, "transform"]),
          );
          for (const domain of domains) {
            assert.equal(yield* f.hooks.has(domain, "transform"), true);
            yield* refused(f.hooks.trigger(domain, "transform", {}));
          }
          assert.equal(f.p.effects(), 0);
          yield* Scope.close(f.scope, Exit.void);
          assert.deepEqual((yield* snapshot(f.c)).locations[0].hooks, []);
          for (const domain of domains)
            assert.equal(yield* f.hooks.has(domain, "transform"), false);
        }),
      () =>
        producer(
          `opencode.provider.${family}`,
          domains.map((domain) => [domain, "transform"]),
        ),
    ));
}

// Evaluate only transformed local declarations under real pinned Effect.
// Original imports are NEVER executed; callback-only dependencies are refusal
// canaries. Bodies remain unchanged and must never run through held registry.
for (const [chunk, symbol, domains] of [
  ["wc3fc9cn", "CerebrasPlugin2", ["provider"]],
  ["qg3g05ea", "KiloPlugin2", ["provider"]],
  ["24dcb14g", "NvidiaPlugin2", ["provider"]],
  ["s72nwfj1", "OpenRouterPlugin2", ["provider", "model"]],
  ["k35dwc4g", "PromptCacheKeyPlugin2", ["model"]],
  ["jjkms2e6", "ZenmuxPlugin2", ["provider"]],
]) {
  test(`actual original ${symbol} source publishes into same Control and original registry without callback effects`, async () => {
    const path = `node_modules/@opencode/core/dist/chunks/config-${chunk}.js`;
    let source = await readFile(join(install, path), "utf8");
    const entry = recipe.files.find((row) => row.path === path);
    assert.ok(entry, "producer recipe checkpoint required");
    assert.equal(
      createHash("sha256").update(source).digest("hex"),
      entry.beforeSha256,
    );
    for (const edit of entry.edits) {
      assert.equal(source.split(edit.find).length - 1, 1);
      source = source.replace(edit.find, () => edit.replace);
    }
    assert.equal(
      createHash("sha256").update(source).digest("hex"),
      entry.afterSha256,
    );
    const parsed = ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    );
    assert.equal(parsed.parseDiagnostics.length, 0);
    const inert = parsed.statements
      .filter(
        (node) =>
          !ts.isImportDeclaration(node) && !ts.isExportDeclaration(node),
      )
      .map((node) => node.getText(parsed).replace(/^export /u, ""))
      .join("\n");
    let effects = 0;
    const forbidden = () => {
      effects++;
      throw Error("forbidden provider callback dependency");
    };
    const actual = new Function(
      "Effect",
      "define",
      "ID11",
      "ID12",
      inert +
        `\nreturn {plugin:${symbol},accepts:isFixedHookDeclaration2,publication:getFixedHookPublication2};`,
    )(Effect, (value) => value, { make: forbidden }, { make: forbidden });
    await run(
      (f) =>
        Effect.gen(function* () {
          const ctx = Object.fromEntries(
            domains.map((domain) => [
              domain,
              { transform: (callback) => f.reg(domain, "transform", callback) },
            ]),
          );
          const value = yield* f.p.plugin
            .effect(ctx)
            .pipe(Effect.provideService(Scope.Scope, f.scope));
          yield* f.c.inventoryToolResult(f.h, f.d, value, f.scope);
          yield* f.c.inventoryToolDeclaration(f.parent, f.d, value);
          yield* f.c.inventoryRegistered(f.parent);
          const current = yield* snapshot(f.c);
          assert.equal(current.complete, false);
          assert.deepEqual(current.capabilities, []);
          assert.deepEqual(
            current.locations[0].hooks.map(({ domain, name }) => [
              domain,
              name,
            ]),
            domains.map((domain) => [domain, "transform"]),
          );
          for (const domain of domains)
            yield* refused(
              f.hooks.trigger(domain, "transform", { list: forbidden }),
            );
          assert.equal(effects, 0);
          yield* Scope.close(f.scope, Exit.void);
          assert.deepEqual((yield* snapshot(f.c)).locations[0].hooks, []);
        }),
      () => ({
        plugin: actual.plugin,
        accepts: (value) => actual.accepts(value, actual.plugin.id),
        publication: (callback) =>
          actual.publication(callback, actual.plugin.id),
      }),
    );
  });
}

async function inertProviderSource(chunk, transformed = true) {
  const path = `node_modules/@opencode/core/dist/chunks/config-${chunk}.js`;
  let source = await readFile(join(install, path), "utf8");
  assert.equal(
    createHash("sha256").update(source).digest("hex"),
    receipt.installEntries.find((row) => row.path === path).sha256,
  );
  if (transformed) {
    const entry = recipe.files.find((row) => row.path === path);
    assert.ok(entry, "producer checkpoint required");
    for (const edit of entry.edits) {
      assert.equal(source.split(edit.find).length - 1, 1);
      source = source.replace(edit.find, () => edit.replace);
    }
    assert.equal(
      createHash("sha256").update(source).digest("hex"),
      entry.afterSha256,
    );
  }
  const parsed = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  assert.equal(parsed.parseDiagnostics.length, 0);
  return parsed.statements
    .filter(
      (node) => !ts.isImportDeclaration(node) && !ts.isExportDeclaration(node),
    )
    .map((node) => node.getText(parsed).replace(/^export /u, ""))
    .join("\n");
}
async function heldActualProvider(actual, rows, calls) {
  await run(
    (f) =>
      Effect.gen(function* () {
        const ctx = {};
        for (const [domain, name] of rows) {
          ctx[domain] ??= {};
          if (name === "transform")
            ctx[domain].transform = (callback) => f.reg(domain, name, callback);
          else
            ctx[domain].hook = (event, callback) =>
              f.reg(domain, event, callback);
        }
        const value = yield* f.p.plugin
          .effect(ctx)
          .pipe(Effect.provideService(Scope.Scope, f.scope));
        yield* f.c.inventoryToolResult(f.h, f.d, value, f.scope);
        yield* f.c.inventoryToolDeclaration(f.parent, f.d, value);
        yield* f.c.inventoryRegistered(f.parent);
        const current = yield* snapshot(f.c);
        assert.equal(current.complete, false);
        assert.deepEqual(current.capabilities, []);
        assert.deepEqual(
          current.locations[0].hooks.map(({ domain, name }) => [domain, name]),
          rows,
        );
        for (const [domain, name] of rows)
          yield* refused(f.hooks.trigger(domain, name, {}));
        assert.equal(calls.count, 0);
        yield* Scope.close(f.scope, Exit.void);
        assert.deepEqual((yield* snapshot(f.c)).locations[0].hooks, []);
      }),
    () => actual,
  );
}
for (const [chunk, symbol] of [
  ["z0bkrqjs", "CoherePlugin2"],
  ["669tq793", "GatewayPlugin2"],
  ["veqvce7d", "PerplexityPlugin2"],
  ["yrhqyw5v", "VenicePlugin2"],
]) {
  test(`actual ${symbol} shared factory is owner-bound through same original registry and held before SDK construction`, async () => {
    const calls = { count: 0 };
    const forbidden = () => {
      calls.count++;
      throw Error("SDK construction forbidden");
    };
    // This override is a refusal canary, NEVER an SDK/network stand-in.
    const effect = { ...Effect, promise: forbidden };
    const factory = new Function(
      "Effect",
      "define",
      (await inertProviderSource("ym463w8f")) +
        "\nreturn {createProviderPlugin2,isFixedHookDeclaration2,getFixedHookPublication2};",
    )(effect, (value) => value);
    const plugin = new Function(
      "createProviderPlugin2",
      (await inertProviderSource(chunk, false)) + `\nreturn ${symbol};`,
    )(factory.createProviderPlugin2);
    await heldActualProvider(
      {
        plugin,
        accepts: (value) => factory.isFixedHookDeclaration2(value, plugin),
        publication: (callback) =>
          factory.getFixedHookPublication2(callback, plugin),
      },
      [["aisdk", "sdk"]],
      calls,
    );
  });
}
for (const [chunk, symbol, rows] of [
  [
    "7nwbzwwg",
    "AmazonBedrockPlugin2",
    [
      ["integration", "transform"],
      ["provider", "transform"],
    ],
  ],
  [
    "8pbmndb6",
    "GoogleVertexPlugin2",
    [
      ["provider", "transform"],
      ["model", "transform"],
      ["aisdk", "language"],
    ],
  ],
  [
    "pezzyds3",
    "VercelPlugin2",
    [
      ["provider", "transform"],
      ["aisdk", "sdk"],
    ],
  ],
]) {
  test(`actual ${symbol} held callbacks cannot reach env, SDK or loader canaries`, async () => {
    const calls = { count: 0 };
    const forbidden = () => {
      calls.count++;
      throw Error("Provider effect forbidden");
    };
    const env = new Proxy({}, { get: forbidden });
    const actual = new Function(
      "Effect",
      "define",
      "ID12",
      "isAISDK2",
      "packageName2",
      "process",
      (await inertProviderSource(chunk)) +
        `\nreturn {plugin:${symbol},accepts:isFixedHookDeclaration2,publication:getFixedHookPublication2};`,
    )(
      { ...Effect, promise: forbidden },
      (value) => value,
      { amazonBedrock: "bedrock", googleVertex: "vertex" },
      forbidden,
      forbidden,
      { env },
    );
    await heldActualProvider(
      {
        plugin: actual.plugin,
        accepts: (value) => actual.accepts(value, actual.plugin.id),
        publication: (callback) =>
          actual.publication(callback, actual.plugin.id),
      },
      rows,
      calls,
    );
  });
}
