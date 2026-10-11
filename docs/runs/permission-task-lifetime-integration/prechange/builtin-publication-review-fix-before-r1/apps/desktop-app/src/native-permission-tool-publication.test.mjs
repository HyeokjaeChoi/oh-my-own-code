// Actual pinned Effect + original State/editor replay. Schema validation is
// scripted here; this is publication/lifetime evidence, never execution proof.
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtemp, symlink, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { copyPermissionControlSources } from "../scripts/native-permission-test-fixture.mjs";
import {
  BUILTIN_PLUGIN_ORDER,
  observeRegistration,
} from "./native-permission-inventory.mjs";
const install = fileURLToPath(
  new URL("../runtime-event-host/.generated/install/", import.meta.url),
);
const root = await mkdtemp(join(tmpdir(), "omoc-tool-publication-"));
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
const original = await readFile(
  join(install, "node_modules/@opencode/core/dist/chunks/config-rdw6cm16.js"),
  "utf8",
);
const createState = new Function(
  ...Object.keys(E),
  original.slice(
    original.indexOf("var CurrentGroup ="),
    original.indexOf("\nexport {"),
  ) + "\nreturn create3;",
)(...Object.values(E));
const toolSource = await readFile(
  join(install, "node_modules/@opencode/core/dist/chunks/config-yw6qsgb4.js"),
  "utf8",
);
const editorSource = toolSource.slice(
  toolSource.indexOf("    editor: (editor) => ({") + "    editor: ".length,
  toolSource.indexOf("    notify: (value) =>"),
);
const editor = new Function(
  "registrationError",
  "namespaceError",
  "effectiveName2",
  "return (" + editorSource.trim().replace(/,$/u, "") + ");",
)(
  () => undefined,
  () => undefined,
  (t) => (t.options?.namespace ? t.options.namespace + "_" + t.name : t.name),
);
function producer() {
  const values = new WeakSet(),
    callbacks = new WeakMap();
  const plugin = Object.freeze({
    id: "opencode.tool.read",
    effect: () => Effect.void,
  });
  const declaration = () => {
    const d = Object.freeze({
      name: "read",
      options: Object.freeze({ codemode: false }),
      execute: () => {
        throw Error("must not execute");
      },
    });
    values.add(d);
    return d;
  };
  const publish = (d) => {
    const cb = (e) => e.add(d);
    callbacks.set(cb, d);
    return cb;
  };
  return {
    plugin,
    declaration,
    publish,
    accepts: (d) => values.has(d),
    publication: (cb) => callbacks.get(cb),
  };
}
const run = (body, makeProducer = producer) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const c = yield* Control.Service;
        const h = yield* c.locationBegin({ directory: "/tool-publication" });
        yield* c.locationBind(h, {
          directory: "/tool-publication",
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
        c.inventoryToolSource(p.plugin, p.accepts, undefined, p.publication);
        const d = Object.freeze({ id: p.plugin.id, effect: () => Effect.void });
        yield* c.inventoryToolResolve(h, p.plugin, d);
        const parent = yield* c.inventoryBegin(h, "plugin", p.plugin.id),
          scope = yield* Scope.make();
        yield* c.inventoryToolActivation(parent, d, scope);
        const state = createState({
          initial: () => ({
            tools: new Map(),
            namespaces: new Map(),
            errors: [],
          }),
          editor,
          notify: (value) =>
            c.inventoryTools(
              h,
              Array.from(value.tools.values()),
              value.errors.length,
            ),
        });
        const reg = observeRegistration(
          Effect,
          Scope,
          c,
          h,
          "tool",
          state.transform,
        );
        return yield* body({ c, h, p, d, parent, scope, state, reg });
      }).pipe(
        Effect.provide(
          Control.configured({ runtimeEpoch: "publication", bootHolds: [] }),
        ),
      ),
    ),
  );
const snapshot = (c) =>
  c.transaction(["project"], (tx) => c.inventorySnapshot(tx, "project"));
const refused = (effect) =>
  Effect.gen(function* () {
    assert.ok(Exit.isFailure(yield* Effect.exit(effect)));
  });
test("source-owned publication API exists before original State registration", () =>
  run(({ c }) =>
    Effect.sync(() => {
      assert.equal(typeof c.inventoryToolPublication, "function");
      assert.equal(typeof c.inventoryToolReplay, "function");
    }),
  ));
test("original State/editor publishes exact declaration, replays and retires original Scope", () =>
  run((f) =>
    Effect.gen(function* () {
      const { c, h, p, d, parent, scope, state, reg } = f,
        value = p.declaration();
      const result = yield* reg(p.publish(value)).pipe(
        Effect.provideService(Scope.Scope, scope),
      );
      assert.equal(state.get().tools.size, 1);
      assert.equal(state.get().tools.get("read").execute, value.execute);
      assert.notEqual(state.get().tools.get("read"), value);
      yield* c.inventoryToolResult(h, d, value, scope);
      yield* c.inventoryToolDeclaration(parent, d, value);
      yield* c.inventoryRegistered(parent);
      const before = yield* snapshot(c);
      assert.equal(before.locations[0].tools.length, 1);
      assert.equal(before.complete, false);
      yield* state.reload();
      const later = yield* snapshot(c);
      assert.ok(later.generation > before.generation);
      yield* result.dispose;
      assert.equal(state.get().tools.size, 0);
      assert.deepEqual((yield* snapshot(c)).locations[0].tools, []);
      yield* Scope.close(scope, Exit.void);
    }),
  ));
test("unowned callback is refused before original registration or callback effects", () =>
  run((f) =>
    Effect.gen(function* () {
      let registered = 0,
        called = 0;
      const reg = observeRegistration(Effect, Scope, f.c, f.h, "tool", () =>
        Effect.sync(() => {
          registered++;
          return { dispose: Effect.void };
        }),
      );
      yield* refused(
        reg(() => {
          called++;
        }).pipe(Effect.provideService(Scope.Scope, f.scope)),
      );
      assert.equal(registered, 0);
      assert.equal(called, 0);
    }),
  ));
test("different activation Scope is refused before publication", () =>
  run((f) =>
    Effect.gen(function* () {
      const other = yield* Scope.make();
      yield* refused(
        f
          .reg(f.p.publish(f.p.declaration()))
          .pipe(Effect.provideService(Scope.Scope, other)),
      );
      assert.equal(f.state.get().tools.size, 0);
      yield* Scope.close(other, Exit.void);
    }),
  ));
test("returned declaration must be the exact originally published value", () =>
  run((f) =>
    Effect.gen(function* () {
      const value = f.p.declaration();
      yield* f
        .reg(f.p.publish(value))
        .pipe(Effect.provideService(Scope.Scope, f.scope));
      yield* refused(
        f.c.inventoryToolResult(f.h, f.d, f.p.declaration(), f.scope),
      );
    }),
  ));
test("one original plugin activation cannot publish a second declaration", () =>
  run((f) =>
    Effect.gen(function* () {
      yield* f
        .reg(f.p.publish(f.p.declaration()))
        .pipe(Effect.provideService(Scope.Scope, f.scope));
      yield* refused(
        f
          .reg(f.p.publish(f.p.declaration()))
          .pipe(Effect.provideService(Scope.Scope, f.scope)),
      );
      assert.equal(f.state.get().tools.size, 1);
    }),
  ));
test("disposed publication callback cannot replay even when retained", () =>
  run((f) =>
    Effect.gen(function* () {
      let retained;
      const reg = observeRegistration(Effect, Scope, f.c, f.h, "tool", (cb) => {
        retained = cb;
        return f.state.transform(cb);
      });
      const r = yield* reg(f.p.publish(f.p.declaration())).pipe(
        Effect.provideService(Scope.Scope, f.scope),
      );
      yield* r.dispose;
      assert.throws(() =>
        retained(
          editor({ tools: new Map(), namespaces: new Map(), errors: [] }),
        ),
      );
    }),
  ));
test("closed original activation Scope cannot admit a late declaration result", () =>
  run((f) =>
    Effect.gen(function* () {
      const value = f.p.declaration();
      yield* f
        .reg(f.p.publish(value))
        .pipe(Effect.provideService(Scope.Scope, f.scope));
      yield* Scope.close(f.scope, Exit.void);
      yield* refused(f.c.inventoryToolResult(f.h, f.d, value, f.scope));
    }),
  ));
test("failed underlying registration revokes its captured publisher before replay", () =>
  run((f) =>
    Effect.gen(function* () {
      let retained;
      const reg = observeRegistration(Effect, Scope, f.c, f.h, "tool", (cb) => {
        retained = cb;
        return Effect.fail(Error("registration failed"));
      });
      yield* refused(
        reg(f.p.publish(f.p.declaration())).pipe(
          Effect.provideService(Scope.Scope, f.scope),
        ),
      );
      assert.throws(() =>
        retained(
          editor({ tools: new Map(), namespaces: new Map(), errors: [] }),
        ),
      );
    }),
  ));
test("closing plugin owner revokes publisher even before original tool dispose", () =>
  run((f) =>
    Effect.gen(function* () {
      let retained;
      const reg = observeRegistration(Effect, Scope, f.c, f.h, "tool", (cb) => {
        retained = cb;
        return f.state.transform(cb);
      });
      const result = yield* reg(f.p.publish(f.p.declaration())).pipe(
        Effect.provideService(Scope.Scope, f.scope),
      );
      yield* f.c.inventoryEnd(f.parent, "disposed");
      assert.throws(() =>
        retained(
          editor({ tools: new Map(), namespaces: new Map(), errors: [] }),
        ),
      );
      yield* result.dispose;
    }),
  ));
test("actual published list joins source metadata once and refuses same-ID replacement", () =>
  run((f) =>
    Effect.gen(function* () {
      const value = f.p.declaration();
      yield* f
        .reg(f.p.publish(value))
        .pipe(Effect.provideService(Scope.Scope, f.scope));
      yield* f.c.inventoryTools(
        f.h,
        Array.from(f.state.get().tools.values()),
        0,
      );
      yield* f.c.inventoryToolResult(f.h, f.d, value, f.scope);
      yield* f.c.inventoryToolDeclaration(f.parent, f.d, value);
      yield* f.c.inventoryRegistered(f.parent);
      assert.equal((yield* snapshot(f.c)).locations[0].tools.length, 1);
      yield* refused(
        f.c.inventoryTools(
          f.h,
          [{ ...f.state.get().tools.get("read"), execute: () => Effect.void }],
          0,
        ),
      );
    }),
  ));

// Extract the actual transformed Read factory and its private callback WeakMap.
// No original module imports, service acquisition or execute calls occur.
test("actual fixed Read publisher reaches original State and exact Control result", async () => {
  const { NATIVE_PERMISSION_OVERLAY_RECIPE: recipe } = await import(
    "./native-permission-overlay-contract.mjs"
  );
  const path = "node_modules/@opencode/core/dist/chunks/config-kcmnw9z9.js";
  let source = await readFile(join(install, path), "utf8");
  for (const edit of recipe.files.find((row) => row.path === path).edits)
    source = source.replace(edit.find, () => edit.replace);
  const header = source.slice(
    source.indexOf("var readDeclarations2 ="),
    source.indexOf("var Plugin37 ="),
  );
  const actual = new Function(
    "name2",
    "Input2",
    "Output",
    header +
      ";return {readDeclaration2,readPublication2,getReadPublication2,isReadDeclaration2};",
  )("read", {}, {});
  return run(
    (f) =>
      Effect.gen(function* () {
        const value = f.p.declaration();
        const registered = yield* f
          .reg(f.p.publish(value))
          .pipe(Effect.provideService(Scope.Scope, f.scope));
        assert.equal(f.state.get().tools.get("read").execute, value.execute);
        yield* f.c.inventoryToolResult(f.h, f.d, value, f.scope);
        yield* f.c.inventoryToolDeclaration(f.parent, f.d, value);
        yield* f.c.inventoryRegistered(f.parent);
        assert.equal((yield* snapshot(f.c)).locations[0].tools.length, 1);
        yield* registered.dispose;
        assert.equal(f.state.get().tools.size, 0);
      }),
    () => ({
      plugin: Object.freeze({
        id: "opencode.tool.read",
        effect: () => Effect.void,
      }),
      accepts: actual.isReadDeclaration2,
      publication: actual.getReadPublication2,
      publish: actual.readPublication2,
      declaration: () =>
        actual.readDeclaration2(
          {},
          {},
          {},
          {},
          {},
          () => {},
          () => {},
        ),
    }),
  );
});
test("missing current editor row cannot be replaced by successful plugin result", () =>
  run((f) =>
    Effect.gen(function* () {
      const value = f.p.declaration();
      yield* f
        .reg(f.p.publish(value))
        .pipe(Effect.provideService(Scope.Scope, f.scope));
      yield* f.c.inventoryTools(f.h, [], 0);
      yield* refused(f.c.inventoryToolResult(f.h, f.d, value, f.scope));
    }),
  ));
