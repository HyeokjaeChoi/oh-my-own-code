// Node/extracted Effect metadata only. Synthetic producer identity is not Native authority.
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtemp, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { copyPermissionControlSources } from "../scripts/native-permission-test-fixture.mjs";
import { BUILTIN_PLUGIN_ORDER } from "./native-permission-inventory.mjs";
const install = fileURLToPath(
  new URL("../runtime-event-host/.generated/install/", import.meta.url),
);
const root = await mkdtemp(join(tmpdir(), "omoc-read-metadata-"));
after(() => rm(root, { recursive: true, force: true }));
await symlink(join(install, "node_modules"), join(root, "node_modules"));
await copyPermissionControlSources(root);
const Control = await import(
  pathToFileURL(join(root, "native-permission-control.mjs"))
);
const awaitLibrary = await import(
  pathToFileURL(join(install, "node_modules/effect/dist/index.js"))
);
const { Effect, Exit } = awaitLibrary;
const run = (body) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const control = yield* Control.Service;
      const handle = yield* control.locationBegin({
        directory: "/read-metadata",
      });
      yield* control.locationBind(handle, {
        directory: "/read-metadata",
        project: { id: "project" },
      });
      yield* control.locationReady(handle);
      return yield* body(control, handle);
    }).pipe(
      Effect.provide(
        Control.configured({ runtimeEpoch: "read-metadata", bootHolds: [] }),
      ),
    ),
  );
const snapshot = (control) =>
  control.transaction(["project"], (tx) =>
    control.inventorySnapshot(tx, "project"),
  );
const refused = (effect) =>
  Effect.gen(function* () {
    assert.ok(Exit.isFailure(yield* Effect.exit(effect)));
  });
function producer() {
  const values = new WeakSet();
  const plugin = Object.freeze({
    id: "opencode.tool.read",
    effect: () => Effect.void,
  });
  const accepts = (value) => values.has(value);
  const declaration = () => {
    const value = new Proxy(
      {},
      {
        get() {
          throw Error("metadata must not read declaration fields");
        },
      },
    );
    values.add(value);
    return value;
  };
  return { plugin, accepts, declaration };
}
function* setup(control, handle, source) {
  control.inventoryReadSource(source.plugin, source.accepts);
  yield* control.inventoryPlan(
    handle,
    BUILTIN_PLUGIN_ORDER.pre.map((id) => ({ id })),
    BUILTIN_PLUGIN_ORDER.post.map((id) => ({ id })),
    [{}],
  );
  const resolved = Object.freeze({
    id: source.plugin.id,
    effect: () => Effect.void,
  });
  yield* control.inventoryReadResolve(handle, source.plugin, resolved);
  const copied = Object.freeze({
    ...resolved,
    revision: "internal",
    source: Object.freeze({ type: "builtin" }),
  });
  control.inventoryReadCopy(handle, resolved, copied);
  return copied;
}
test("actual Control retains only unsupported metadata from the same source/activation and clears it on dispose", async () =>
  run((control, handle) =>
    Effect.gen(function* () {
      const source = producer();
      const descriptor = yield* setup(control, handle, source);
      const token = yield* control.inventoryBegin(
        handle,
        "plugin",
        "opencode.tool.read",
      );
      const scope = {};
      const result = source.declaration();
      yield* control.inventoryReadActivation(token, descriptor, scope);
      yield* control.inventoryReadResult(handle, descriptor, result, scope);
      yield* control.inventoryReadDeclaration(token, descriptor, result);
      yield* control.inventoryRegistered(token);
      yield* control.inventoryTools(handle, [], 0);
      const value = yield* snapshot(control);
      assert.equal(value.complete, false);
      assert.deepEqual(value.capabilities, []);
      assert.deepEqual(value.locations[0].tools, [
        {
          toolId: "read",
          action: "read",
          support: "unsupported",
          resource: null,
          adapterId: null,
        },
      ]);
      assert.equal(JSON.stringify(value).includes("execute"), false);
      yield* control.inventoryEnd(token, "disposed");
      assert.deepEqual((yield* snapshot(control)).locations[0].tools, []);
    }),
  ));
test("source-like IDs, undeclared copies, changed effects and reused activation results cannot mint metadata", async () =>
  run((control, handle) =>
    Effect.gen(function* () {
      const source = producer();
      const descriptor = yield* setup(control, handle, source);
      const token = yield* control.inventoryBegin(
        handle,
        "plugin",
        "opencode.tool.read",
      );
      yield* refused(
        control.inventoryReadDeclaration(
          token,
          { ...descriptor },
          source.declaration(),
        ),
      );
      yield* refused(control.inventoryReadDeclaration(token, descriptor, {}));
      const result = source.declaration();
      const scope = {};
      yield* control.inventoryReadActivation(token, descriptor, scope);
      yield* refused(
        control.inventoryReadResult(handle, descriptor, result, {}),
      );
      yield* control.inventoryReadResult(handle, descriptor, result, scope);
      yield* control.inventoryReadDeclaration(token, descriptor, result);
      yield* refused(
        control.inventoryReadDeclaration(token, descriptor, result),
      );
      assert.throws(() =>
        control.inventoryReadCopy(
          handle,
          descriptor,
          Object.freeze({
            ...descriptor,
            effect: () => Effect.void,
          }),
        ),
      );
      yield* refused(
        control.inventoryReadResolve(handle, { ...source.plugin }, descriptor),
      );
    }),
  ));
test("read metadata cannot cross Location incarnation or survive reload", async () =>
  run((control, handle) =>
    Effect.gen(function* () {
      const source = producer();
      const descriptor = yield* setup(control, handle, source);
      const other = yield* control.locationBegin({ directory: "/other-read" });
      yield* control.locationBind(other, {
        directory: "/other-read",
        project: { id: "project" },
      });
      yield* control.locationReady(other);
      const alien = yield* control.inventoryBegin(other, "tool");
      yield* refused(
        control.inventoryReadDeclaration(
          alien,
          descriptor,
          source.declaration(),
        ),
      );
      const token = yield* control.inventoryBegin(
        handle,
        "plugin",
        "opencode.tool.read",
      );
      const scope = {};
      const result = source.declaration();
      yield* control.inventoryReadActivation(token, descriptor, scope);
      yield* control.inventoryReadResult(handle, descriptor, result, scope);
      yield* control.inventoryReadDeclaration(token, descriptor, result);
      yield* control.inventoryRegistered(token);
      yield* control.inventoryChanged(handle, "plugin_reload");
      assert.deepEqual((yield* snapshot(control)).locations[0].tools, []);
      yield* refused(
        control.inventoryReadDeclaration(
          token,
          descriptor,
          source.declaration(),
        ),
      );
    }),
  ));

test("actual Read → PluginInternal → supervisor copies → loader retains inert metadata on the original activation Scope", async (t) => {
  const { readFile } = await import("node:fs/promises");
  const { NATIVE_PERMISSION_OVERLAY_RECIPE: recipe } = await import(
    "./native-permission-overlay-contract.mjs"
  );
  const { planNativePermissionOverlay } = await import(
    "../scripts/native-permission-overlay.mjs"
  );
  const outputs = planNativePermissionOverlay(
    recipe,
    await Promise.all(
      recipe.files.map(async ({ path }) => ({
        path,
        content: await readFile(join(install, path)),
      })),
    ),
  ).files;
  const source = (name) =>
    outputs.find((row) => row.path.endsWith("/" + name)).content.toString();
  const library = await import(
    pathToFileURL(join(install, "node_modules/effect/dist/index.js"))
  );
  const { Context, Scope, Logger, References, Cause, Fiber, Deferred } =
    library;
  const tags = Object.fromEntries(
    ["Service7", "Service21", "Service12", "Service80", "FileSystem"].map(
      (name) => [name, Context.Service("actual-read-metadata/" + name)],
    ),
  );
  let callbacks = 0;
  const poison = new Proxy(
    {},
    {
      get() {
        callbacks++;
        throw Error("unexpected service/schema/IO callback");
      },
    },
  );
  const text = source("config-kcmnw9z9.js");
  const read = new Function(
    "name2",
    "Input2",
    "Output",
    "Effect",
    ...Object.keys(tags),
    "FSUtil",
    text.slice(
      text.indexOf("var readDeclarations2 ="),
      text.indexOf("var toModelContent2 ="),
    ) + "\nreturn {Plugin37,isReadDeclaration2,getReadPublication2};",
  )("read", poison, poison, Effect, ...Object.values(tags), {
    Service: tags.FileSystem,
  });
  const internal = source("config-8t2s61hj.js");
  const list = new Function(
    "Effect",
    "Context",
    "Scope",
    "WorkbenchControl",
    "LocationBuildScope",
    "services",
    "pre",
    "post",
    "Plugin37",
    internal.slice(
      internal.indexOf("var list2 ="),
      internal.indexOf("export {"),
    ) + "\nreturn list2;",
  )(
    Effect,
    Context,
    Scope,
    Control.Service,
    Control.LocationBuildScope,
    Object.values(tags),
    [read.Plugin37],
    [],
    read.Plugin37,
  );
  const state = await readFile(
    join(install, "node_modules/@opencode/core/dist/chunks/config-rdw6cm16.js"),
    "utf8",
  );
  const { group, create } = new Function(
    "Cause",
    "Context",
    "Effect",
    "Exit",
    "Fiber",
    "Scope",
    state.slice(state.indexOf("var CurrentGroup"), state.indexOf("export {")) +
      "\nreturn {group:group2,create:create3};",
  )(Cause, Context, Effect, Exit, Fiber, Scope);
  for (const saturated of [false, true])
    await t.test(
      saturated
        ? "32 queued writers during actual loader disposal"
        : "ordinary actual loader disposal",
      async () =>
        run((control, handle) =>
          Effect.gen(function* () {
            control.inventoryToolSource(
              read.Plugin37,
              read.isReadDeclaration2,
              undefined,
              read.getReadPublication2,
            );
            yield* control.inventoryPlan(
              handle,
              BUILTIN_PLUGIN_ORDER.pre.map((id) => ({ id })),
              BUILTIN_PLUGIN_ORDER.post.map((id) => ({ id })),
              [{}],
            );
            let listing = list().pipe(
              Effect.provideService(Control.Service, control),
              Effect.provideService(Control.LocationBuildScope, handle),
            );
            for (const tag of Object.values(tags))
              listing = listing.pipe(Effect.provideService(tag, poison));
            const resolved = yield* listing;
            const supervisor = source("config-j7k7jnd5.js");
            const mapped = new Function(
              "internal",
              "sdk",
              "instance",
              "control",
              "handle",
              supervisor.slice(
                supervisor.indexOf("    const pre = ["),
                supervisor.indexOf("    const operations ="),
              ) + "\nreturn {pre,post};",
            )(resolved, { all: () => [] }, { all: () => [] }, control, handle);
            let published;
            const applyStart = supervisor.indexOf("    const apply = "),
              applyEnd = supervisor.indexOf(
                "    yield* apply(immediate);",
                applyStart,
              );
            const apply = new Function(
              "registry",
              "source",
              "control",
              "handle",
              supervisor.slice(applyStart, applyEnd) + "\nreturn apply;",
            )(
              {
                activate: (plugins) =>
                  Effect.sync(() => {
                    published = plugins;
                  }),
              },
              (value) => value,
              control,
              handle,
            );
            yield* apply({ plugins: mapped.pre, failures: [] });
            const loader = source("config-48y8hbvk.js");
            const definitions = new Function(
              "plugins",
              "control",
              "handle",
              "Plugin",
              loader.slice(
                loader.indexOf("    const definitions = "),
                loader.indexOf("    const ids = "),
              ) + "\nreturn definitions;",
            )(published, control, handle, { ID: { make: (value) => value } });
            const scope = yield* Scope.make();
            // Original State/editor copy; schema validation is separately tested.
            const { observeRegistration } = yield* Effect.promise(
              () => import("./native-permission-inventory.mjs"),
            );
            const toolText = source("config-yw6qsgb4.js");
            const editorText = toolText.slice(
              toolText.indexOf("    editor: (editor) => ({") +
                "    editor: ".length,
              toolText.indexOf("    notify: (value) =>"),
            );
            const editor = new Function(
              "registrationError",
              "namespaceError",
              "effectiveName2",
              "control",
              "inventoryHandle",
              "return (" + editorText.trim().replace(/,$/u, "") + ");",
            )(
              () => undefined,
              () => undefined,
              (tool) => tool.name,
              control,
              handle,
            );
            const toolState = create({
              initial: () => ({
                tools: new Map(),
                namespaces: new Map(),
                errors: [],
              }),
              editor,
              notify: (value) =>
                control.inventoryTools(
                  handle,
                  Array.from(value.tools.values()),
                  value.errors.length,
                ),
            });
            const deps = {
              Effect,
              Scope,
              Exit,
              Context,
              Logger,
              References,
              control,
              handle,
              scope,
              inherit2: () => Effect.succeed((effect) => effect),
              group2: group,
              host: {
                tool: {
                  transform: observeRegistration(
                    Effect,
                    Scope,
                    control,
                    handle,
                    "tool",
                    toolState.transform,
                  ),
                },
              },
              storage2: () => ({}),
              kv: {},
              Queue: library.Queue,
              pendingFailures: undefined,
              holdUnsafe: () => Effect.void,
              Cause,
            };
            const load = new Function(
              ...Object.keys(deps),
              loader.slice(
                loader.indexOf("  const load = Effect.fnUntraced"),
                loader.indexOf("  const activate ="),
              ) + "\nreturn load;",
            )(...Object.values(deps));
            const loaded = yield* load(definitions[0]);
            assert.ok(loaded.activation);
            assert.equal(loaded.error, undefined);
            const value = yield* snapshot(control);
            assert.deepEqual(value.locations[0].tools, [
              {
                toolId: "read",
                action: "read",
                support: "unsupported",
                resource: null,
                adapterId: null,
              },
            ]);
            assert.equal(value.complete, false);
            assert.deepEqual(value.capabilities, []);
            assert.equal(callbacks, 0);
            if (saturated) {
              const entered = yield* Deferred.make(),
                release = yield* Deferred.make();
              const holder = yield* Effect.forkChild(
                control.transaction(["project"], () =>
                  Deferred.succeed(entered, undefined).pipe(
                    Effect.andThen(Deferred.await(release)),
                  ),
                ),
              );
              yield* Deferred.await(entered);
              const writers = [];
              for (let i = 0; i < 32; i++) {
                writers.push(
                  yield* Effect.forkChild(
                    control.inventoryTools(handle, [], 0),
                  ),
                );
                for (let j = 0; j < 64; j++) yield* Effect.yieldNow;
              }
              const closing = yield* Effect.forkChild(
                Effect.exit(Scope.close(loaded.activation.scope, Exit.void)),
              );
              for (let j = 0; j < 64; j++) yield* Effect.yieldNow;
              yield* Deferred.succeed(release, undefined);
              yield* Fiber.join(holder);
              yield* Fiber.joinAll(writers);
              const exit = yield* Fiber.join(closing);
              assert.ok(
                Exit.isSuccess(exit),
                "actual Scope finalizer must not fail busy at full metadata admission",
              );
            } else yield* Scope.close(loaded.activation.scope, Exit.void);
            assert.deepEqual((yield* snapshot(control)).locations[0].tools, []);
            yield* Scope.close(scope, Exit.void);
            assert.equal(callbacks, 0);
          }),
        ),
    );
});

test("graph-owned Read source rejects getters, proxies, asynchronous verifier and reconfiguration before callbacks", async () =>
  run((control) =>
    Effect.sync(() => {
      let calls = 0;
      const invalid = Object.freeze({
        id: "opencode.tool.read",
        get effect() {
          calls++;
          throw Error("getter invoked");
        },
      });
      assert.throws(() => control.inventoryReadSource(invalid, () => true));
      const source = producer();
      assert.throws(() =>
        control.inventoryReadSource(
          new Proxy(source.plugin, {
            get() {
              calls++;
              throw Error("proxy invoked");
            },
          }),
          source.accepts,
        ),
      );
      assert.throws(() =>
        control.inventoryReadSource(source.plugin, async () => {
          calls++;
          return true;
        }),
      );
      control.inventoryReadSource(source.plugin, source.accepts);
      assert.throws(() =>
        control.inventoryReadSource(source.plugin, source.accepts),
      );
      assert.equal(calls, 0);
    }),
  ));

test("terminal cleanup joins duplicates once at saturation and does not open ordinary admission", async () =>
  run((control, handle) =>
    Effect.gen(function* () {
      const { Deferred, Fiber } = awaitLibrary;
      const source = producer(),
        descriptor = yield* setup(control, handle, source);
      const token = yield* control.inventoryBegin(
        handle,
        "plugin",
        "opencode.tool.read",
      );
      const scope = {},
        result = source.declaration();
      yield* control.inventoryReadActivation(token, descriptor, scope);
      yield* control.inventoryReadResult(handle, descriptor, result, scope);
      yield* control.inventoryReadDeclaration(token, descriptor, result);
      yield* control.inventoryRegistered(token);
      const before = yield* snapshot(control);
      const entered = yield* Deferred.make(),
        release = yield* Deferred.make();
      const holder = yield* Effect.forkChild(
        control.transaction(["project"], () =>
          Deferred.succeed(entered, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
          ),
        ),
      );
      yield* Deferred.await(entered);
      const writers = [];
      for (let i = 0; i < 32; i++) {
        writers.push(
          yield* Effect.forkChild(control.inventoryTools(handle, [], 0)),
        );
        for (let j = 0; j < 64; j++) yield* Effect.yieldNow;
      }
      const cleanups = [];
      for (let i = 0; i < 64; i++)
        cleanups.push(
          yield* Effect.forkChild(control.inventoryEnd(token, "disposed")),
        );
      for (let j = 0; j < 64; j++) yield* Effect.yieldNow;
      yield* refused(control.inventoryTools(handle, [], 0));
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(holder);
      yield* Fiber.joinAll(writers);
      yield* Fiber.joinAll(cleanups);
      const after = yield* snapshot(control);
      assert.deepEqual(after.locations[0].tools, []);
      assert.equal(
        after.generation - before.generation,
        33,
        "32 ordinary updates plus one terminal update",
      );
    }),
  ));
test("reentrant terminal cleanup cannot cache a failure or deadlock later actual disposal", async () =>
  run((control, handle) =>
    Effect.gen(function* () {
      const source = producer(),
        descriptor = yield* setup(control, handle, source);
      const token = yield* control.inventoryBegin(
        handle,
        "plugin",
        "opencode.tool.read",
      );
      const scope = {},
        result = source.declaration();
      yield* control.inventoryReadActivation(token, descriptor, scope);
      yield* control.inventoryReadResult(handle, descriptor, result, scope);
      yield* control.inventoryReadDeclaration(token, descriptor, result);
      yield* control.inventoryRegistered(token);
      yield* control.transaction(["project"], () =>
        refused(control.inventoryEnd(token, "disposed")),
      );
      assert.equal((yield* snapshot(control)).locations[0].tools.length, 1);
      yield* control.inventoryEnd(token, "disposed");
      assert.deepEqual((yield* snapshot(control)).locations[0].tools, []);
    }),
  ));
