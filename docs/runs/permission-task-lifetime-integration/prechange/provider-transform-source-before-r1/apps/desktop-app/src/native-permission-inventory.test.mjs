import { copyPermissionControlSources } from "../scripts/native-permission-test-fixture.mjs";
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  FIXED_PLUGIN_FILES,
  validateFixedPluginSource,
  BUILTIN_PLUGIN_ORDER,
} from "./native-permission-inventory.mjs";
import { NATIVE_PERMISSION_OVERLAY_RECIPE as recipe } from "./native-permission-overlay-contract.mjs";
import { planNativePermissionOverlay } from "../scripts/native-permission-overlay.mjs";

const install = fileURLToPath(
  new URL("../runtime-event-host/.generated/install/", import.meta.url),
);
const namespace = await mkdtemp(join(tmpdir(), "omoc-inventory-"));
after(() => rm(namespace, { recursive: true, force: true }));
await symlink(join(install, "node_modules"), join(namespace, "node_modules"));
await copyPermissionControlSources(namespace);
const { Effect, Layer, Scope, Context, Exit } = await import(
  pathToFileURL(join(install, "node_modules/effect/dist/index.js"))
);
const control = await import(
  pathToFileURL(join(namespace, "native-permission-control.mjs"))
);
const run = (body) =>
  Effect.runPromise(
    Effect.provide(
      Effect.gen(function* () {
        const service = yield* control.Service;
        const handle = yield* service.locationBegin({
          directory: "/inventory",
        });
        yield* service.locationBind(handle, {
          directory: "/inventory",
          project: { id: "project" },
        });
        yield* service.locationReady(handle);
        return yield* body(service, handle);
      }),
      control.configured({ runtimeEpoch: "inventory-test", bootHolds: [] }),
    ).pipe(Effect.timeout("5 seconds")),
  );
const snapshot = (service) =>
  service.transaction(["project"], (tx) =>
    service.inventorySnapshot(tx, "project"),
  );
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const prefix = "node_modules/@opencode/core/dist/chunks/";
const planned = planNativePermissionOverlay(
  recipe,
  await Promise.all(
    recipe.files.map(async ({ path }) => ({
      path,
      content: await readFile(join(install, path)),
    })),
  ),
);
async function source(name) {
  if (process.env.OMOC_INVENTORY_PRECHANGE === "1")
    return readFile(join(install, prefix + name), "utf8");
  return planned.files
    .find(({ path }) => path === prefix + name)
    .content.toString("utf8");
}
const reject = (effect) =>
  Effect.gen(function* () {
    assert.equal(Exit.isFailure(yield* Effect.exit(effect)), true);
  });

async function fixedRoot(t) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "omoc-inventory-fixed-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of Object.keys(FIXED_PLUGIN_FILES)) {
    const path = join(root, name);
    await mkdir(dirname(path), { recursive: true });
    await copyFile(new URL(`./${name}`, import.meta.url), path);
  }
  return root;
}
const nonce = "a".repeat(64);
const operation = (root) => ({
  type: "add",
  target: join(root, "builtins/workbench-skills"),
  options: { nonce },
});

test("fixed producer pins the actual complete relative module closure before load", async (t) => {
  const root = await fixedRoot(t);
  assert.equal(
    validateFixedPluginSource(root, nonce, operation(root)).pluginId,
    "omoc.workbench.skills",
  );
  for (const [name, digest] of Object.entries(FIXED_PLUGIN_FILES))
    assert.equal(
      hash(await readFile(new URL(`./${name}`, import.meta.url))),
      digest,
    );
  for (const invalid of [
    { ...operation(root), type: "remove" },
    { ...operation(root), target: "other" },
    { ...operation(root), options: { nonce, complete: true } },
    { ...operation(root), options: { nonce: "b".repeat(64) } },
    { ...operation(root), complete: true },
  ])
    assert.throws(() => validateFixedPluginSource(root, nonce, invalid));
  const changed = join(root, "renderer/shared/configuration-draft/policy.mjs");
  await writeFile(changed, "throw new Error('must never load');");
  assert.throws(
    () => validateFixedPluginSource(root, nonce, operation(root)),
    /inventory_unverified/,
  );
});

test("unknown source is refused by actual extracted PluginSupervisor.resolve BEFORE modules.load", async (t) => {
  const root = await fixedRoot(t);
  const text = await source("config-j7k7jnd5.js");
  const extracted = text.slice(
    text.indexOf('var resolve = Effect.fn("PluginSupervisor.resolve")'),
    text.indexOf("var layer3 ="),
  );
  const resolve = new Function(
    "Effect",
    "Cause",
    "ID2",
    "guarded2",
    "LoadError2",
    "pluginSource",
    extracted + "\nreturn resolve;",
  )(
    Effect,
    { squash: (x) => x },
    { make: (x) => x },
    new Set(),
    Error,
    (x) => ({ type: "local", path: x }),
  );
  let loads = 0;
  await run((service, handle) =>
    Effect.gen(function* () {
      service.inventoryConfigure(root, nonce);
      const modules = {
        load: () => {
          loads++;
          return Effect.succeed({ id: "untrusted", effect: () => Effect.void });
        },
      };
      yield* reject(
        resolve(
          modules,
          [],
          [],
          [{ ...operation(root), target: "untrusted-package" }],
          false,
          new Map(),
          service,
          handle,
        ),
      );
      assert.equal(loads, 0);
      const valid = yield* resolve(
        modules,
        [],
        [],
        [operation(root)],
        false,
        new Map(),
        service,
        handle,
      );
      assert.equal(valid.plugins.length, 1);
      assert.equal(loads, 1);
    }),
  );
});

test("actual extracted hook layer refuses unowned callback before original registration", async () => {
  const text = await source("config-5y480sgp.js");
  const { observeRegistration } = await import(
    "./native-permission-inventory.mjs"
  );
  const body = text.slice(
    text.indexOf("var eventProviderID"),
    text.indexOf("var node63"),
  );
  const layerFactory = new Function(
    "Context",
    "Effect",
    "Layer",
    "Scope",
    "WorkbenchControl",
    "LocationBuildScope",
    "observeRegistration",
    body + "\nreturn {layer, Service61};",
  )(
    Context,
    Effect,
    Layer,
    Scope,
    control.Service,
    control.LocationBuildScope,
    observeRegistration,
  );
  let callbacks = 0;
  await run((service, handle) =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const ctx = yield* Layer.buildWithScope(layerFactory.layer, scope).pipe(
        Effect.provideService(control.Service, service),
        Effect.provideService(control.LocationBuildScope, handle),
      );
      const hooks = Context.get(ctx, layerFactory.Service61);
      const before = yield* snapshot(service);
      yield* reject(
        hooks
          .register("permission", "evaluate", () =>
            Effect.sync(() => callbacks++),
          )
          .pipe(Effect.provideService(Scope.Scope, scope)),
      );
      const registered = yield* snapshot(service);
      assert.ok(registered.generation > before.generation);
      assert.equal(yield* hooks.has("permission", "evaluate"), false);
      yield* hooks.trigger("permission", "evaluate", {});
      assert.equal(callbacks, 0);
      assert.equal(registered.locations[0].registrations[0].state, "failed");
      yield* Scope.close(scope, Exit.void);
      assert.equal(
        (yield* snapshot(service)).generation,
        registered.generation,
      );
    }),
  );
});

test("actual pinned State refuses unverified tool transforms before effects on registration and replay", async () => {
  const text = await readFile(
    join(install, prefix + "config-rdw6cm16.js"),
    "utf8",
  );
  assert.equal(
    hash(text),
    "8627e8ffcac2bfc7225c3d4731b0d180c86dc1cf9b445e7f2f74fb436328288c",
  );
  const body = text.slice(
    text.indexOf("var CurrentGroup"),
    text.indexOf("export {"),
  );
  const create = new Function(
    "Cause",
    "Context",
    "Effect",
    "Exit",
    "Fiber",
    "Scope",
    body + "\nreturn create3;",
  )({}, Context, Effect, Exit, {}, Scope);
  const { observeRegistration } = await import(
    "./native-permission-inventory.mjs"
  );
  await run((service, handle) =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const state = create({
        initial: () => new Map(),
        editor: (map) => ({ add: (id) => map.set(id, id) }),
      });
      let transforms = 0;
      const registration = observeRegistration(
        Effect,
        Scope,
        service,
        handle,
        "tool",
        state.transform,
      )((editor) => {
        transforms++;
        editor.add("read");
      }).pipe(Effect.provideService(Scope.Scope, scope));
      yield* reject(registration);
      assert.deepEqual(
        [...state.get()],
        [],
        "rejected callback was never registered",
      );
      const before = yield* snapshot(service);
      yield* state.reload();
      const after = yield* snapshot(service);
      assert.equal(
        after.generation,
        before.generation,
        "empty replay has no registered callback",
      );
      assert.equal(
        transforms,
        0,
        "unverified callbacks cannot run after invalidation",
      );
      assert.equal(after.complete, false);
      assert.equal(after.locations[0].registrations[0].state, "failed");
      yield* Scope.close(scope, Exit.void);
      assert.equal(state.get().size, 0);
    }),
  );
});

test("ordered builtin plan rejects missing/duplicate/reordered plugins before activation", async () => {
  await run((service, handle) =>
    Effect.gen(function* () {
      const pre = BUILTIN_PLUGIN_ORDER.pre.map((id) => ({ id }));
      const post = BUILTIN_PLUGIN_ORDER.post.map((id) => ({ id }));
      yield* service.inventoryPlan(handle, pre, post, [operation("/fixed")]);
      yield* service.inventoryActivation(
        handle,
        [...pre, { id: "omoc.workbench.skills" }, ...post],
        [],
      );
      for (const wrong of [pre.slice(1), [...pre].reverse(), [...pre, pre[0]]])
        yield* reject(
          service.inventoryPlan(handle, wrong, post, [operation("/fixed")]),
        );
      yield* reject(service.inventoryActivation(handle, [...pre, ...post], []));
      assert.equal((yield* snapshot(service)).complete, false);
    }),
  );
});

test("actual extracted Tool layer refuses unverified metadata callbacks before publication", async () => {
  const stateText = await readFile(
    join(install, prefix + "config-rdw6cm16.js"),
    "utf8",
  );
  assert.equal(
    hash(stateText),
    "8627e8ffcac2bfc7225c3d4731b0d180c86dc1cf9b445e7f2f74fb436328288c",
  );
  const create = new Function(
    "Cause",
    "Context",
    "Effect",
    "Exit",
    "Fiber",
    "Scope",
    stateText.slice(
      stateText.indexOf("var CurrentGroup"),
      stateText.indexOf("export {"),
    ) + "\nreturn create3;",
  )({}, Context, Effect, Exit, {}, Scope);
  const toolText = await source("config-yw6qsgb4.js");
  const body = toolText.slice(
    toolText.indexOf("class Service59"),
    toolText.indexOf("var whollyDisabled"),
  );
  const { observeRegistration } = await import(
    "./native-permission-inventory.mjs"
  );
  const Service61 = Context.Service("test/Hooks");
  const Service60 = Context.Service("test/Image");
  const WorkbenchSessionStore = Context.Service("test/Store");
  const WorkbenchLocation = Context.Service("test/Location");
  const factory = new Function(
    "Context",
    "Effect",
    "Layer",
    "Scope",
    "WorkbenchControl",
    "WorkbenchSessionStore",
    "WorkbenchLocation",
    "LocationBuildScope",
    "Service61",
    "Service60",
    "create3",
    "observeRegistration",
    "registrationError",
    "namespaceError",
    "effectiveName2",
    "createCoordinatorAdmission",
    body + "\nreturn {layer, Service59};",
  )(
    Context,
    Effect,
    Layer,
    Scope,
    control.Service,
    WorkbenchSessionStore,
    WorkbenchLocation,
    control.LocationBuildScope,
    Service61,
    Service60,
    create,
    observeRegistration,
    () => undefined,
    () => undefined,
    (tool) => tool.name,
    () => () => Effect.fail(new Error("held")),
  );
  await run((service, handle) =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const context = yield* Layer.buildWithScope(factory.layer, scope).pipe(
        Effect.provideService(control.Service, service),
        Effect.provideService(control.LocationBuildScope, handle),
        Effect.provideService(WorkbenchSessionStore, {}),
        Effect.provideService(WorkbenchLocation, {
          project: { id: "project" },
        }),
        Effect.provideService(Service61, {}),
        Effect.provideService(Service60, {}),
      );
      const tools = Context.get(context, factory.Service59);
      let callbacks = 0;
      const registration = tools
        .transform((editor) => {
          callbacks++;
          editor.add({
            name: "read",
            options: { permission: "file.read" },
            execute: () => Effect.void,
          });
        })
        .pipe(Effect.provideService(Scope.Scope, scope));
      yield* reject(registration);
      assert.equal(callbacks, 0);
      const registered = yield* snapshot(service);
      assert.deepEqual(registered.locations[0].tools, []);
      assert.equal(registered.locations[0].registrations[0].state, "failed");
      assert.deepEqual(registered.capabilities, []);
      yield* reject(tools.snapshot([]));
      yield* tools.reload();
      assert.equal(callbacks, 0);
      yield* Scope.close(scope, Exit.void);
      assert.deepEqual((yield* snapshot(service)).locations[0].tools, []);
    }),
  );
});

test("actual extracted Plugin.load records successful registration and actual scope disposal on the same Control", async () => {
  const text = await source("config-48y8hbvk.js");
  const start = text.indexOf("  const load = Effect.fnUntraced");
  const end = text.indexOf("  const activate =", start);
  const stateText = await readFile(
    join(install, prefix + "config-rdw6cm16.js"),
    "utf8",
  );
  assert.equal(
    hash(stateText),
    "8627e8ffcac2bfc7225c3d4731b0d180c86dc1cf9b445e7f2f74fb436328288c",
  );
  const group = new Function(
    "Cause",
    "Context",
    "Effect",
    "Exit",
    "Fiber",
    "Scope",
    stateText.slice(
      stateText.indexOf("var CurrentGroup"),
      stateText.indexOf("export {"),
    ) + "\nreturn group2;",
  )({}, Context, Effect, Exit, {}, Scope);
  const { Logger, References } = await import(
    pathToFileURL(join(install, "node_modules/effect/dist/index.js"))
  );
  await run((service, handle) =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const pre = BUILTIN_PLUGIN_ORDER.pre.map((id) => ({ id })),
        post = BUILTIN_PLUGIN_ORDER.post.map((id) => ({ id }));
      yield* service.inventoryPlan(handle, pre, post, [operation("/fixed")]);
      const load = new Function(
        "Effect",
        "Scope",
        "Exit",
        "Context",
        "Logger",
        "References",
        "control",
        "handle",
        "scope",
        "inherit2",
        "group2",
        "host",
        "storage2",
        "kv",
        "Queue",
        "pendingFailures",
        "holdUnsafe",
        "Cause",
        text.slice(start, end) + "\nreturn load;",
      )(
        Effect,
        Scope,
        Exit,
        Context,
        Logger,
        References,
        service,
        handle,
        scope,
        () => Effect.succeed((effect) => effect),
        group,
        {},
        () => ({}),
        {},
        {},
        {},
        () => Effect.void,
        {},
      );
      let effects = 0;
      const loaded = yield* load({
        id: "opencode.warming",
        effect: () => Effect.sync(() => effects++),
      });
      assert.equal(effects, 1);
      assert.equal(
        (yield* snapshot(service)).locations[0].registrations[0].state,
        "registered",
      );
      yield* Scope.close(loaded.activation.scope, Exit.void);
      assert.equal(
        (yield* snapshot(service)).locations[0].registrations[0].state,
        "disposed",
      );
      yield* Scope.close(scope, Exit.void);
    }),
  );
});

test("inert owned tool declarations preserve exact unsupported actions without executing callbacks", async () => {
  await run((service, handle) =>
    Effect.gen(function* () {
      yield* service.inventoryTools(
        handle,
        [{ id: "read", options: { permission: "file.read" } }],
        0,
      );
      const observed = yield* snapshot(service);
      assert.deepEqual(observed.locations[0].tools, [
        {
          toolId: "read",
          action: "file.read",
          support: "unsupported",
          resource: null,
          adapterId: null,
        },
      ]);
      assert.deepEqual(observed.capabilities, []);
      assert.equal(observed.complete, false);
    }),
  );
});
