// Concrete Control/Effect contract; synthetic producers confer no Native authority.
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtemp, symlink, rm, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { NATIVE_PERMISSION_OVERLAY_RECIPE as recipe } from "./native-permission-overlay-contract.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { copyPermissionControlSources } from "../scripts/native-permission-test-fixture.mjs";
const install = fileURLToPath(
  new URL("../runtime-event-host/.generated/install/", import.meta.url),
);
const root = await mkdtemp(join(tmpdir(), "omoc-builtin-metadata-"));
after(() => rm(root, { recursive: true, force: true }));
await symlink(join(install, "node_modules"), join(root, "node_modules"));
await copyPermissionControlSources(root);
const Control = await import(
  pathToFileURL(join(root, "native-permission-control.mjs"))
);
const { Effect, Exit } = await import(
  pathToFileURL(join(install, "node_modules/effect/dist/index.js"))
);
import { BUILTIN_PLUGIN_ORDER } from "./native-permission-inventory.mjs";
const names = [
  "read",
  "question",
  "glob",
  "grep",
  "skill",
  "webfetch",
  "edit",
  "write",
  "patch",
  "shell",
  "subagent",
  "websearch",
];
const action = (name) =>
  ["edit", "write", "patch"].includes(name) ? "edit" : name;
const run = (body) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const control = yield* Control.Service;
      const handle = yield* control.locationBegin({
        directory: "/builtin-metadata",
      });
      yield* control.locationBind(handle, {
        directory: "/builtin-metadata",
        project: { id: "project" },
      });
      yield* control.locationReady(handle);
      yield* control.inventoryPlan(
        handle,
        BUILTIN_PLUGIN_ORDER.pre.map((id) => ({ id })),
        BUILTIN_PLUGIN_ORDER.post.map((id) => ({ id })),
        [{}],
      );
      return yield* body(control, handle);
    }).pipe(
      Effect.provide(
        Control.configured({ runtimeEpoch: "builtin-metadata", bootHolds: [] }),
      ),
    ),
  );
const snapshot = (c) =>
  c.transaction(["project"], (tx) => c.inventorySnapshot(tx, "project"));
const refused = (effect) =>
  Effect.gen(function* () {
    assert.ok(Exit.isFailure(yield* Effect.exit(effect)));
  });
function producer(name) {
  const values = new WeakSet();
  const plugin = Object.freeze({
    id: name.startsWith("opencode.") ? name : `opencode.tool.${name}`,
    effect: () => Effect.void,
  });
  const accepts = (value) => values.has(value);
  const declaration = () => {
    const value = new Proxy(
      {},
      {
        get() {
          throw Error("declaration fields must remain inert");
        },
      },
    );
    values.add(value);
    return value;
  };
  return { plugin, accepts, declaration };
}
function* resolve(c, h, p) {
  c.inventoryToolSource(p.plugin, p.accepts);
  const descriptor = Object.freeze({
    id: p.plugin.id,
    effect: () => Effect.void,
  });
  yield* c.inventoryToolResolve(h, p.plugin, descriptor);
  const copy = Object.freeze({
    ...descriptor,
    revision: "internal",
    source: Object.freeze({ type: "builtin" }),
  });
  c.inventoryToolCopy(h, descriptor, copy);
  return copy;
}
for (const name of names)
  test(`fixed ${name} metadata requires original source, scope and result and stays unsupported`, async () =>
    run((c, h) =>
      Effect.gen(function* () {
        const p = producer(name),
          descriptor = yield* resolve(c, h, p);
        const token = yield* c.inventoryBegin(h, "plugin", p.plugin.id),
          scope = {},
          result = p.declaration();
        yield* c.inventoryToolActivation(token, descriptor, scope);
        yield* refused(c.inventoryToolResult(h, descriptor, result, {}));
        yield* c.inventoryToolResult(h, descriptor, result, scope);
        yield* c.inventoryToolDeclaration(token, descriptor, result);
        yield* refused(c.inventoryToolDeclaration(token, descriptor, result));
        yield* c.inventoryRegistered(token);
        const before = yield* snapshot(c);
        assert.equal(before.complete, false);
        assert.deepEqual(before.capabilities, []);
        assert.deepEqual(before.locations[0].tools, [
          {
            toolId: name,
            action: action(name),
            support: "unsupported",
            resource: null,
            adapterId: null,
          },
        ]);
        assert.equal(JSON.stringify(before).includes("execute"), false);
        yield* c.inventoryEnd(token, "disposed");
        assert.deepEqual((yield* snapshot(c)).locations[0].tools, []);
      }),
    ));
test("known unconfigured family refuses; unknown family cannot inject tool metadata", async () =>
  run((c, h) =>
    Effect.gen(function* () {
      const p = producer("question"),
        d = Object.freeze({ ...p.plugin });
      yield* refused(c.inventoryToolResolve(h, p.plugin, d));
      const unknown = producer("input.repair"),
        other = Object.freeze({ ...unknown.plugin });
      assert.throws(() =>
        c.inventoryToolSource(unknown.plugin, unknown.accepts),
      );
      assert.equal(
        yield* c.inventoryToolResolve(h, unknown.plugin, other),
        other,
      );
      const token = yield* c.inventoryBegin(h, "plugin", unknown.plugin.id);
      yield* c.inventoryToolDeclaration(token, other, unknown.declaration());
      yield* c.inventoryRegistered(token);
      assert.deepEqual((yield* snapshot(c)).locations[0].tools, []);
    }),
  ));
test("cross-family results, same-id source transplants and undeclared descriptor copies refuse", async () =>
  run((c, h) =>
    Effect.gen(function* () {
      const a = producer("question"),
        b = producer("glob");
      const da = yield* resolve(c, h, a),
        db = yield* resolve(c, h, b);
      const token = yield* c.inventoryBegin(h, "plugin", a.plugin.id),
        scope = {};
      yield* c.inventoryToolActivation(token, da, scope);
      yield* refused(c.inventoryToolResult(h, da, b.declaration(), scope));
      yield* refused(c.inventoryToolDeclaration(token, db, a.declaration()));
      yield* refused(
        c.inventoryToolResult(h, { ...da }, a.declaration(), scope),
      );
      yield* refused(
        c.inventoryToolResolve(
          h,
          Object.freeze({ ...a.plugin }),
          Object.freeze({ ...da }),
        ),
      );
      assert.throws(() => c.inventoryToolCopy(h, { ...da }, da));
      const result = a.declaration();
      yield* c.inventoryToolResult(h, da, result, scope);
      yield* c.inventoryChanged(h, "tool_reload");
      yield* refused(c.inventoryToolDeclaration(token, da, result));
      assert.deepEqual((yield* snapshot(c)).locations[0].tools, []);
    }),
  ));
test("fixed source configuration rejects unknown IDs, accessors and duplicate producers without invoking them", async () =>
  run((c) =>
    Effect.sync(() => {
      let calls = 0;
      const p = producer("question");
      assert.throws(() =>
        c.inventoryToolSource(
          Object.freeze({
            id: p.plugin.id,
            get effect() {
              calls++;
              throw Error("getter");
            },
          }),
          p.accepts,
        ),
      );
      assert.throws(() =>
        c.inventoryToolSource(
          new Proxy(p.plugin, {
            get() {
              calls++;
              throw Error("proxy");
            },
          }),
          p.accepts,
        ),
      );
      assert.throws(() =>
        c.inventoryToolSource(p.plugin, async () => {
          calls++;
          return true;
        }),
      );
      assert.throws(() =>
        c.inventoryToolSource(producer("input.repair").plugin, p.accepts),
      );
      c.inventoryToolSource(p.plugin, p.accepts);
      assert.throws(() => c.inventoryToolSource(p.plugin, p.accepts));
      assert.equal(calls, 0);
    }),
  ));
test("concurrent fixed family registrations retain separate immutable metadata and disposal ownership", async () =>
  run((c, h) =>
    Effect.gen(function* () {
      const tokens = [];
      const families = [
        ...names,
        "opencode.tools",
        "opencode.tools.mcp-resources",
      ];
      const expected = [
        ...names,
        "opencode_session_rename",
        "opencode_session_move",
        "opencode_models",
        "opencode_list_mcp_resources",
        "opencode_read_mcp_resource",
      ];
      for (const name of families) {
        const p = producer(name),
          descriptor = yield* resolve(c, h, p),
          scope = {};
        const token = yield* c.inventoryBegin(h, "plugin", p.plugin.id),
          result = p.declaration();
        yield* c.inventoryToolActivation(token, descriptor, scope);
        yield* c.inventoryToolResult(h, descriptor, result, scope);
        yield* c.inventoryToolDeclaration(token, descriptor, result);
        yield* c.inventoryRegistered(token);
        tokens.push(token);
      }
      const before = yield* snapshot(c);
      assert.deepEqual(
        before.locations[0].tools.map((row) => row.toolId),
        expected,
      );
      assert.ok(Object.isFrozen(before.locations[0].tools[1]));
      yield* c.inventoryEnd(tokens[1], "disposed");
      assert.deepEqual(
        (yield* snapshot(c)).locations[0].tools.map((row) => row.toolId),
        expected.filter((name) => name !== "question"),
      );
      yield* c.inventoryEnd(tokens.at(-1), "disposed");
      assert.deepEqual(
        (yield* snapshot(c)).locations[0].tools.map((row) => row.toolId),
        expected.filter(
          (name) => name !== "question" && !name.includes("mcp_resource"),
        ),
      );
      assert.equal(before.locations[0].tools.length, 17);
    }),
  ));
test("disposed activation results cannot be adopted by a later registration or another Location", async () =>
  run((c, h) =>
    Effect.gen(function* () {
      const p = producer("question"),
        d = yield* resolve(c, h, p),
        scope = {},
        result = p.declaration();
      const old = yield* c.inventoryBegin(h, "plugin", p.plugin.id);
      yield* c.inventoryToolActivation(old, d, scope);
      yield* c.inventoryToolResult(h, d, result, scope);
      yield* c.inventoryEnd(old, "disposed");
      const next = yield* c.inventoryBegin(h, "plugin", p.plugin.id),
        nextScope = {};
      yield* c.inventoryToolActivation(next, d, nextScope);
      yield* refused(c.inventoryToolResult(h, d, result, nextScope));
      const other = yield* c.locationBegin({ directory: "/other-builtin" });
      yield* c.locationBind(other, {
        directory: "/other-builtin",
        project: { id: "other-project" },
      });
      yield* c.locationReady(other);
      assert.throws(() => c.inventoryToolCopy(other, d, d));
      assert.deepEqual((yield* snapshot(c)).locations[0].tools, []);
    }),
  ));

test("five actual pinned predicates feed concrete Control without accessing services", async () => {
  const rows = [
    ["question", "fcxyj98j", "Plugin51", 2],
    ["glob", "ec87pa6m", "Plugin38", 5],
    ["grep", "e661jwrm", "Plugin50", 5],
    ["skill", "ym52mge9", "Plugin44", 3],
    ["webfetch", "4xsr0mw7", "Plugin43", 2],
  ];
  let calls = 0;
  const trap = new Proxy(() => {}, {
    get() {
      calls++;
      throw Error("service accessed");
    },
    apply() {
      calls++;
      throw Error("service called");
    },
  });
  const actual = [];
  for (const [name, chunk, plugin, count] of rows) {
    const path = `node_modules/@opencode/core/dist/chunks/config-${chunk}.js`;
    const entry = recipe.files.find((row) => row.path === path);
    const original = await readFile(join(install, path), "utf8");
    assert.equal(
      createHash("sha256").update(original).digest("hex"),
      entry.beforeSha256,
    );
    let changed = original;
    for (const edit of entry.edits) {
      assert.equal(changed.split(edit.find).length, 2);
      changed = changed.replace(edit.find, () => edit.replace);
    }
    assert.equal(
      createHash("sha256").update(changed).digest("hex"),
      entry.afterSha256,
    );
    const start = original.indexOf(
      "    yield* ctx.tool.transform((editor) => editor.add(",
    );
    const header = original.slice(
      start,
      original.indexOf("      execute:", start),
    );
    const names = [
      ...header.matchAll(
        /(?:name|description|input|output): ([A-Za-z][\w]*)[,\n]/g,
      ),
    ].map((match) => match[1]);
    const factory = new Function(
      ...names,
      changed.slice(
        changed.indexOf(`var ${name}Declarations2 =`),
        changed.indexOf(`var ${plugin} =`),
      ) +
        `\nreturn {make:${name}Declaration2, accepts:is${name[0].toUpperCase() + name.slice(1)}Declaration2};`,
    )(
      ...names.map((key) =>
        key.startsWith("name")
          ? name
          : Object.freeze({ schemaPlaceholder: key }),
      ),
    );
    const value = factory.make(...Array(count).fill(trap));
    actual.push({
      plugin: Object.freeze({
        id: `opencode.tool.${name}`,
        effect: () => Effect.void,
      }),
      accepts: factory.accepts,
      declaration: () => value,
    });
  }
  await run((c, h) =>
    Effect.gen(function* () {
      for (const p of actual) {
        const descriptor = yield* resolve(c, h, p),
          scope = {},
          result = p.declaration();
        const token = yield* c.inventoryBegin(h, "plugin", p.plugin.id);
        yield* c.inventoryToolActivation(token, descriptor, scope);
        yield* refused(
          c.inventoryToolResult(h, descriptor, { ...result }, scope),
        );
        yield* c.inventoryToolResult(h, descriptor, result, scope);
        yield* c.inventoryToolDeclaration(token, descriptor, result);
        yield* c.inventoryRegistered(token);
      }
      const value = yield* snapshot(c);
      assert.deepEqual(
        value.locations[0].tools.map((row) => row.toolId),
        rows.map((row) => row[0]),
      );
      assert.equal(value.complete, false);
      assert.deepEqual(value.capabilities, []);
      assert.equal(calls, 0);
    }),
  );
});

for (const [family, ids] of [
  [
    "opencode.tools",
    ["opencode_session_rename", "opencode_session_move", "opencode_models"],
  ],
  [
    "opencode.tools.mcp-resources",
    ["opencode_list_mcp_resources", "opencode_read_mcp_resource"],
  ],
])
  test(`fixed ${family} bundle projects all exact declarations atomically without inspecting result`, async () =>
    run((c, h) =>
      Effect.gen(function* () {
        const p = producer(family),
          d = yield* resolve(c, h, p),
          scope = {},
          result = p.declaration();
        const token = yield* c.inventoryBegin(h, "plugin", family);
        yield* c.inventoryToolActivation(token, d, scope);
        yield* refused(c.inventoryToolResult(h, d, {}, scope));
        yield* c.inventoryToolResult(h, d, result, scope);
        yield* c.inventoryToolDeclaration(token, d, result);
        assert.deepEqual((yield* snapshot(c)).locations[0].tools, []);
        yield* c.inventoryRegistered(token);
        const value = yield* snapshot(c);
        assert.deepEqual(
          value.locations[0].tools,
          ids.map((toolId) => ({
            toolId,
            action: toolId,
            support: "unsupported",
            resource: null,
            adapterId: null,
          })),
        );
        assert.ok(value.locations[0].tools.every(Object.isFrozen));
        assert.equal(value.complete, false);
        assert.deepEqual(value.capabilities, []);
        yield* c.inventoryEnd(token, "disposed");
        assert.deepEqual((yield* snapshot(c)).locations[0].tools, []);
      }),
    ));
