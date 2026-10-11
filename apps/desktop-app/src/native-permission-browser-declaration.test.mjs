import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import { NATIVE_PERMISSION_OVERLAY_RECIPE as recipe } from "./native-permission-overlay-contract.mjs";
const require = createRequire(import.meta.url);
const eslintRequire = createRequire(require.resolve("eslint"));
const parse = eslintRequire("espree").parse;
const eslintScope = eslintRequire("eslint-scope");
const root = new URL(
  "../runtime-event-host/.generated/install/",
  import.meta.url,
);
const hash = (s) => createHash("sha256").update(s).digest("hex");
const ast = (s) =>
  parse(s, { ecmaVersion: "latest", sourceType: "module", range: true });
function patched(before, path) {
  const entry = recipe.files.find((f) => f.path === path);
  assert.ok(entry, `missing source publication: ${path}`);
  assert.equal(hash(before), entry.beforeSha256);
  let after = before;
  for (const edit of entry.edits) {
    assert.equal(after.split(edit.find).length - 1, 1);
    after = after.replace(edit.find, () => edit.replace);
  }
  assert.equal(hash(after), entry.afterSha256);
  let restored = after;
  for (const edit of [...entry.edits].reverse()) {
    assert.equal(restored.split(edit.replace).length - 1, 1);
    restored = restored.replace(edit.replace, () => edit.find);
  }
  assert.equal(restored, before);
  ast(after);
  return after;
}
test("Browser original45 schemas/closures, inert private factory, ordered publication and register result", async () => {
  const path = "node_modules/@opencode/plugin-browser/dist/tools.js";
  const before = await readFile(new URL(path, root), "utf8");
  const after = patched(before, path);
  const E = await import(
    "../runtime-event-host/.generated/install/node_modules/effect/dist/index.js"
  );
  const { Effect, Schema } = E;
  const receipt = JSON.parse(
    await readFile(new URL("../receipt.json", root), "utf8"),
  );
  async function pinnedSource(path) {
    const source = await readFile(new URL(path, root), "utf8");
    assert.equal(
      hash(source),
      receipt.installEntries.find((e) => e.path === path)?.sha256,
    );
    return source;
  }

  // Evaluate only schema metadata source. Never import the Browser/schema provider modules.
  const schemaSource = await pinnedSource(
    "node_modules/@opencode/schema/dist/schema.js",
  );
  const optionalNode = ast(schemaSource).body.find(
    (n) => n.declaration?.declarations?.[0]?.id.name === "optional",
  ).declaration.declarations[0].init;
  const optional = new Function(
    "Schema",
    "SchemaGetter",
    "Option",
    `return (${schemaSource.slice(...optionalNode.range)});`,
  )(Schema, E.SchemaGetter, E.Option);
  const rpc = await pinnedSource(
    "node_modules/@opencode/plugin-browser/dist/rpc.js",
  );
  const metadata = rpc
    .slice(
      rpc.indexOf("export const MAX_FILE_BYTES"),
      rpc.indexOf("const attachment ="),
    )
    .replaceAll("export const ", "const ");
  const Browser = new Function(
    "Schema",
    "optional",
    `${metadata}; return {Operations};`,
  )(Schema, optional);
  const expected = JSON.parse(
    await readFile(
      new URL(
        "../../../docs/runs/permission-task-lifetime-integration/browser-source-api-r1.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ).names;
  assert.deepEqual(
    Browser.Operations.map((o) => o.name),
    expected,
  );
  const counters = {
    file: 0,
    network: 0,
    session: 0,
    tunnel: 0,
    connection: 0,
  };
  const trap = (key) =>
    new Proxy(() => {}, {
      get() {
        counters[key]++;
        throw Error(key);
      },
      apply() {
        counters[key]++;
        throw Error(key);
      },
    });
  const start = after.indexOf("var browserDeclarations2 =");
  const end = after.indexOf("export const register", start);
  assert.ok(start >= 0 && end > start, "missing private Browser factory");
  const source = after.slice(start, end).replaceAll("export var ", "var ");
  const scope = eslintScope.analyze(ast(source), {
    ecmaVersion: 2024,
    sourceType: "module",
  });
  assert.deepEqual(
    [
      ...new Set(scope.globalScope.through.map((r) => r.identifier.name)),
    ].sort(),
    [
      "Browser",
      "BrowserFiles",
      "Effect",
      "Object",
      "Tool",
      "TypeError",
      "WeakMap",
      "WeakSet",
      "decodeResult",
      "exportResult",
      "invalidURL",
      "normalizeAction",
    ].sort(),
    "factory must retain exact original dependencies, with ctx and connection explicitly bound",
  );
  const load = () =>
    new Function(
      "Effect",
      "Browser",
      "BrowserFiles",
      `${source};return {make:browserDeclaration2,accepts:isBrowserDeclaration2,publish:browserPublication2,lookup:getBrowserPublication2};`,
    )(Effect, Browser, trap("file"));
  const factory = load(),
    ctx = trap("session"),
    connection = trap("connection");
  const bundle = factory.make(ctx, connection);
  assert.deepEqual(Object.keys(bundle).sort(), ["declarations", "namespace"]);
  assert.ok(Object.isFrozen(bundle));
  assert.ok(Object.isFrozen(bundle.namespace));
  assert.ok(Object.isFrozen(bundle.declarations));
  const executeStart = before.indexOf("    const execute =");
  const executeEnd = before.indexOf("    yield* ctx.tool", executeStart);
  const bodyStart =
    before.indexOf(".transform((editor) => {") +
    ".transform((editor) => {".length;
  const bodyEnd = before.indexOf("\n    })", bodyStart);
  const original = new Function(
    "Effect",
    "Browser",
    "ctx",
    "connection",
    "BrowserFiles",
    `${before.slice(executeStart, executeEnd)};const rows=[];let namespace;const editor={namespace(value){namespace=value;},add(value){rows.push(value);}};${before.slice(bodyStart, bodyEnd)};return {namespace,rows};`,
  )(Effect, Browser, ctx, connection, trap("file"));
  assert.deepEqual(bundle.namespace, original.namespace);
  assert.equal(bundle.declarations.length, 45);
  for (let i = 0; i < 45; i++) {
    const row = bundle.declarations[i],
      old = original.rows[i],
      operation = Browser.Operations[i];
    assert.ok(Object.isFrozen(row));
    assert.ok(Object.isFrozen(row.options));
    assert.equal(row.name, old.name);
    assert.equal(row.description, old.description);
    assert.deepEqual(row.options, old.options);
    assert.equal(row.input, operation.input);
    assert.equal(row.output, operation.output);
    assert.deepEqual(
      Schema.toJsonSchemaDocument(row.input),
      Schema.toJsonSchemaDocument(old.input),
    );
    assert.deepEqual(
      Schema.toJsonSchemaDocument(row.output),
      Schema.toJsonSchemaDocument(old.output),
    );
    assert.equal(row.execute.toString(), old.execute.toString());
  }
  assert.ok(
    source.includes(before.slice(executeStart, executeEnd).trimEnd()),
    "original execute implementation changed",
  );
  const callback = factory.publish(bundle);
  assert.equal(factory.lookup(callback), bundle);
  for (const fake of [
    { ...bundle },
    new Proxy(bundle, {}),
    load().make(ctx, connection),
    undefined,
  ]) {
    assert.equal(factory.accepts(fake), false);
    assert.throws(() => factory.publish(fake), /unbranded/);
  }
  assert.equal(factory.lookup(new Proxy(callback, {})), undefined);
  assert.equal(load().lookup(callback), undefined);
  assert.equal(
    factory.lookup(() => {}),
    undefined,
  );
  const operations = [];
  callback({
    namespace(value) {
      operations.push(["namespace", value]);
    },
    add(value) {
      operations.push(["add", value]);
    },
  });
  assert.deepEqual(operations, [
    ["namespace", bundle.namespace],
    ...bundle.declarations.map((r) => ["add", r]),
  ]);
  for (const failAt of [0, 1, 23, 45]) {
    let calls = 0;
    const failure = Error("editor");
    const visit = () => {
      if (calls++ === failAt) throw failure;
    };
    assert.throws(
      () => callback({ namespace: visit, add: visit }),
      (e) => e === failure,
    );
    assert.equal(calls, failAt + 1);
  }
  // Only the extracted register generator runs, with scripted transform.
  const registerNode = ast(after).body.find(
    (n) => n.declaration?.declarations?.[0]?.id.name === "register",
  ).declaration.declarations[0].init.arguments[0];
  const register = new Function(
    "Effect",
    "browserDeclaration2",
    "browserPublication2",
    `return (${after.slice(...registerNode.range)});`,
  )(Effect, factory.make, factory.publish);
  let published,
    transforms = 0;
  const result = await Effect.runPromise(
    Effect.gen(() =>
      register(
        {
          tool: {
            transform(cb) {
              transforms++;
              published = factory.lookup(cb);
              cb({ namespace() {}, add() {} });
              return Effect.void;
            },
          },
        },
        connection,
      ),
    ),
  );
  assert.equal(result, published);
  assert.equal(transforms, 1);
  assert.ok(factory.accepts(result));
  assert.deepEqual(counters, {
    file: 0,
    network: 0,
    session: 0,
    tunnel: 0,
    connection: 0,
  });
  assert.equal(await readFile(new URL(path, root), "utf8"), before);
});
test("Browser default Plugin returns exact register bundle and freezes private identity", async () => {
  const path = "node_modules/@opencode/plugin-browser/dist/index.js";
  const before = await readFile(new URL(path, root), "utf8"),
    after = patched(before, path);
  const { Effect } = await import(
    "../runtime-event-host/.generated/install/node_modules/effect/dist/index.js"
  );
  const bundle = Object.freeze({
      namespace: Object.freeze({}),
      declarations: Object.freeze([]),
    }),
    connection = Object.freeze({});
  let make = 0,
    register = 0;
  const ctx = {};
  const extracted = after
    .replace(/^import .*;$/gm, "")
    .replace(/^export \*.*;$/gm, "")
    .replace("export default browserPlugin2;", "return browserPlugin2;");
  const plugin = new Function(
    "Plugin",
    "Effect",
    "BrowserConnection",
    "BrowserTools",
    extracted,
  )(
    { define: (v) => v },
    Effect,
    {
      make(c) {
        assert.equal(c, ctx);
        make++;
        return Effect.succeed(connection);
      },
    },
    {
      register(c, v) {
        assert.equal(c, ctx);
        assert.equal(v, connection);
        register++;
        return Effect.succeed(bundle);
      },
    },
  );
  assert.ok(Object.isFrozen(plugin));
  assert.equal(await Effect.runPromise(plugin.effect(ctx)), bundle);
  assert.equal(make, 1);
  assert.equal(register, 1);
});
