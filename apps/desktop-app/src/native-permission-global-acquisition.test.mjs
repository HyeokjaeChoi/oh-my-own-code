import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import test from "node:test";
import ts from "typescript";

// Inert original expressions with scripted SQLite/migration dependencies.
// Never import Native/core, open SQLite, or execute actual migration SQL.
const install = new URL(
  "../runtime-event-host/.generated/install/",
  import.meta.url,
);
const path = "node_modules/@opencode/core/dist/chunks/config-yds56wag.js";
const original = await readFile(new URL(path, install), "utf8");
const sha = (value) => createHash("sha256").update(value).digest("hex");
const expected =
  "694e68cfbc64c520478a98074c0b7e53a5a60f555a5ada934f08635c37e6f9ee";
const receipt = JSON.parse(
  await readFile(new URL("../receipt.json", install), "utf8"),
);
assert.equal(sha(original), expected);
assert.equal(
  receipt.installEntries.find((row) => row.path === path)?.sha256,
  expected,
);
const effectPath = "node_modules/effect/dist/index.js";
assert.equal(
  sha(await readFile(new URL(effectPath, install))),
  receipt.installEntries.find((row) => row.path === effectPath)?.sha256,
);
const { Context, Effect, Layer, Semaphore } = await import(
  "../runtime-event-host/.generated/install/node_modules/effect/dist/index.js"
);
const ast = ts.createSourceFile(
  path,
  original,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.JS,
);
assert.equal(ast.parseDiagnostics.length, 0);
function extract(name, declaration) {
  const matches = [];
  function visit(node) {
    if (
      declaration === "function" &&
      ts.isFunctionDeclaration(node) &&
      node.name?.text === name
    )
      matches.push(node.getText(ast));
    if (
      declaration === "variable" &&
      ts.isVariableDeclaration(node) &&
      node.name.getText(ast) === name
    )
      matches.push(node.initializer.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(matches.length, 1, name);
  return matches[0];
}
const databaseExpression = extract("databaseLayer", "variable");
const layerExpression = extract("layer26", "function");
const lockExpression = extract("lockFor", "function");
function fixture({
  tuning = true,
  foreignKeys = true,
  migrationFails = false,
} = {}) {
  class Database extends Context.Service()("test/Database") {}
  class Client extends Context.Service()("test/Client") {}
  class GlobalService extends Context.Service()("test/Global") {}
  const events = [];
  const db = { run: (sql) => Effect.sync(() => events.push(["sql", sql])) };
  const sqliteLayer = ({ filename }) =>
    Layer.effect(
      Client,
      Effect.gen(function* () {
        events.push(["open", filename]);
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => events.push(["close", filename])),
        );
        return { db };
      }),
    );
  const dependencies = {
    Layer,
    Effect,
    Semaphore,
    Service84: Database,
    makeDatabase: Effect.map(Client, (value) => value.db),
    supportsTuningPragmas: tuning,
    supportsForeignKeyToggle: foreignKeys,
    apply3: (received) =>
      Effect.sync(() => {
        assert.equal(received, db);
        events.push(["migrate"]);
        if (migrationFails) throw new Error("scripted_migration_failure");
      }),
    sqliteLayer,
    Global: { Service: GlobalService },
    isAbsolute,
    join,
  };
  const layer = new Function(
    ...Object.keys(dependencies),
    `"use strict"; const locks = new Map(); ${lockExpression}; const databaseLayer = (${databaseExpression}); ${layerExpression}; return layer26;`,
  )(...Object.values(dependencies));
  async function acquire(options, global) {
    let selected = layer(options);
    if (global)
      selected = selected.pipe(
        Layer.provide(Layer.succeed(GlobalService, global)),
      );
    return Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const context = yield* Layer.build(selected);
          assert.equal(Context.get(context, Database).db, db);
          events.push(["acquired"]);
        }),
      ),
    );
  }
  return { layer, acquire, events };
}
test("original Database constructor is deferred until Layer acquisition", async () => {
  const f = fixture();
  f.layer({ path: "/owned/data/event-host.sqlite" });
  assert.deepEqual(f.events, []);
  await f.acquire({ path: "/owned/data/event-host.sqlite" });
  assert.deepEqual(f.events, [
    ["open", "/owned/data/event-host.sqlite"],
    ["sql", "PRAGMA journal_mode = WAL"],
    ["sql", "PRAGMA synchronous = NORMAL"],
    ["sql", "PRAGMA busy_timeout = 5000"],
    ["sql", "PRAGMA cache_size = -64000"],
    ["sql", "PRAGMA wal_checkpoint(PASSIVE)"],
    ["sql", "PRAGMA foreign_keys = ON"],
    ["migrate"],
    ["acquired"],
    ["close", "/owned/data/event-host.sqlite"],
  ]);
});
test("original default memory path does not acquire Global", async () => {
  const f = fixture();
  await f.acquire();
  assert.deepEqual(f.events[0], ["open", ":memory:"]);
});
test("relative Database path requires and uses actual supplied Global data", async () => {
  const f = fixture();
  await assert.rejects(f.acquire({ path: "db.sqlite" }));
  assert.deepEqual(f.events, []);
  await f.acquire({ path: "db.sqlite" }, { data: "/owned/data" });
  assert.deepEqual(f.events[0], ["open", "/owned/data/db.sqlite"]);
});
test("supported pragma flags preserve original conditional behavior", async () => {
  const f = fixture({ tuning: false, foreignKeys: false });
  await f.acquire({ path: ":memory:" });
  assert.deepEqual(f.events, [
    ["open", ":memory:"],
    ["migrate"],
    ["acquired"],
    ["close", ":memory:"],
  ]);
});
test("original migration failure closes acquired client and publishes no service", async () => {
  const f = fixture({ migrationFails: true });
  await assert.rejects(
    f.acquire({ path: "/owned/data/event-host.sqlite" }),
    /scripted_migration_failure/u,
  );
  assert.equal(
    f.events.some(([name]) => name === "acquired"),
    false,
  );
  assert.deepEqual(f.events.at(-1), ["close", "/owned/data/event-host.sqlite"]);
});
