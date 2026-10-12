import { assertOnlyCreateGateChanged } from "./native-permission-overlay-bootstrap-edit.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { NATIVE_PERMISSION_OVERLAY_RECIPE as recipe } from "./native-permission-overlay-contract.mjs";

// Extracted original expressions; no Native/core/FSUtil/Global module import.
// Node constructor, FS and Global are explicit standins. Scope/Layer/Fiber and
// retention sequencing use the real receipt-verified pinned Effect library.
const root = new URL(
  "../runtime-event-host/.generated/install/",
  import.meta.url,
);
const receipt = JSON.parse(await readFile(new URL("../receipt.json", root)));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const pins = {
  g4xer9vd: "0b78f3dbd0899a168d980f6946490c7763b37005fe6d3bd9518cc161f1c97029",
  hbtt76ya: "8afa7591a9f6c71e2c3169b0b55a2429ad578705ca32a67b35fe992dc8b76198",
  gd4qta3r: "89c5db7b2a8dac6d7383745186270354317edab7c3771410532923cd32422982",
};
const originals = new Map();
function ast(file, text) {
  return ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
}
for (const [chunk, digest] of Object.entries(pins)) {
  const file = `node_modules/@opencode/core/dist/chunks/config-${chunk}.js`;
  const bytes = await readFile(new URL(file, root));
  assert.equal(sha(bytes), digest);
  assert.deepEqual(
    receipt.installEntries
      .filter((row) => row.path === file)
      .map((row) => row.sha256),
    [digest],
  );
  originals.set(chunk, ast(file, bytes.toString("utf8")));
}
for (const row of receipt.installEntries.filter(
  (row) =>
    row.path.startsWith("node_modules/effect/") && row.path.endsWith(".js"),
))
  assert.equal(sha(await readFile(new URL(row.path, root))), row.sha256);
const {
  Effect,
  Context,
  Layer,
  Scope,
  Exit,
  Deferred,
  Duration,
  Schedule,
  Option,
} = await import(
  "../runtime-event-host/.generated/install/node_modules/effect/dist/index.js"
);
function one(tree, predicate) {
  const values = [];
  function walk(node) {
    if (predicate(node)) values.push(node);
    ts.forEachChild(node, walk);
  }
  walk(tree);
  assert.equal(values.length, 1);
  return values[0];
}
const variable = (tree, name) =>
  one(
    tree,
    (node) =>
      ts.isVariableDeclaration(node) && node.name.getText(tree) === name,
  ).initializer.getText(tree);
const evaluate = (text, deps) =>
  new Function(...Object.keys(deps), `"use strict"; return (${text});`)(
    ...Object.values(deps),
  );
function patched(tree) {
  const row = recipe.files.find((file) => file.path === tree.fileName);
  if (!row) return tree; // Meaningful pre-implementation RED against actual original.
  let text = tree.text;
  assert.equal(sha(text), row.beforeSha256);
  for (const edit of row.edits) {
    assert.equal(text.split(edit.find).length, 2);
    text = text.replace(edit.find, edit.replace);
  }
  assert.equal(sha(text), row.afterSha256);
  return ast(tree.fileName, text);
}
const cleanup3 = evaluate(variable(originals.get("gd4qta3r"), "cleanup3"), {
  Effect,
  Duration,
  Option,
});
const specs = [
  {
    name: "ToolOutput",
    chunk: "g4xer9vd",
    cleanup: "cleanup",
    directory: "DIRECTORY3",
    retention: "RETENTION3",
  },
  {
    name: "Shell",
    chunk: "hbtt76ya",
    cleanup: "cleanup2",
    directory: "DIRECTORY2",
    retention: "RETENTION2",
  },
];
const run = (effect) =>
  Effect.runPromise(effect.pipe(Effect.timeout("5 seconds")));
async function fixture(spec, { patch = false, blocked = false } = {}) {
  class FS extends Context.Service()(`synthetic/${spec.name}/FS`) {}
  class GlobalService extends Context.Service()(
    `synthetic/${spec.name}/Global`,
  ) {}
  const entered = Deferred.makeUnsafe(),
    removed = Deferred.makeUnsafe(),
    never = Deferred.makeUnsafe();
  const calls = [];
  let interrupted = 0;
  const read = (items) =>
    Effect.gen(function* () {
      calls.push("read");
      yield* Deferred.succeed(entered, undefined);
      if (blocked)
        yield* Deferred.await(never).pipe(
          Effect.onInterrupt(() => Effect.sync(() => interrupted++)),
        );
      return items;
    });
  const fs = {
    readDirectory: () => read(["tool_abcdefabcdef", "ignored"]),
    readDirectoryEntries: (directory) =>
      read(
        directory.endsWith("/shell")
          ? [{ type: "directory", name: "project" }]
          : [
              { type: "file", name: "sh_abcdefabcdef.out" },
              { type: "file", name: "ignored" },
            ],
      ),
    stat: (file) =>
      Effect.sync(() => {
        calls.push(["stat", file]);
        return { mtime: Option.some(new Date(0)) };
      }),
    remove: (file) =>
      Effect.gen(function* () {
        calls.push(["remove", file]);
        yield* Deferred.succeed(removed, undefined);
      }),
  };
  const original = originals.get(spec.chunk),
    tree = patch ? patched(original) : original;
  const deps = {
    Effect,
    Layer,
    Duration,
    Schedule,
    FSUtil: { Service: FS, node: Object.freeze({ id: "synthetic-fs-node" }) },
    Global: {
      Service: GlobalService,
      node: Object.freeze({ id: "synthetic-global-node" }),
    },
    path,
    cleanup3,
    [spec.retention]: Duration.days(7),
    [spec.directory]: evaluate(variable(original, spec.directory), {}),
  };
  // Preserve original function construction; no original body runs until its
  // resulting Effect is evaluated with the synthetic context.
  deps[spec.cleanup] = evaluate(variable(original, spec.cleanup), deps);
  const cleanupLayer = evaluate(variable(original, "cleanupLayer"), deps);
  const node = evaluate(variable(tree, "cleanupNode"), {
    ...deps,
    cleanupLayer,
    makeGlobalNode: (options) => options,
  });
  assert.deepEqual(node.deps, [deps.FSUtil.node, deps.Global.node]);
  const context = Context.make(FS, fs).pipe(
    Context.add(GlobalService, { data: "/synthetic-native-data" }),
  );
  const scope = await run(Scope.make());
  return {
    node,
    scope,
    context,
    deps,
    tree,
    fs,
    calls,
    entered,
    removed,
    interrupted: () => interrupted,
    build: () =>
      run(
        Layer.buildWithScope(node.layer, scope).pipe(Effect.provide(context)),
      ),
    close: () => run(Scope.close(scope, Exit.void)),
  };
}
for (const spec of specs) {
  test(`${spec.name}: original acquisition starts retention without Task authority`, async () => {
    const f = await fixture(spec);
    try {
      await f.build();
      await run(Deferred.await(f.removed));
    } finally {
      await f.close();
    }
    assert.equal(f.calls.filter((row) => row[0] === "remove").length, 1);
    assert.equal(f.scope.state._tag, "Closed");
  });
  test(`${spec.name}: actual Scope close interrupts original pending read before removal`, async () => {
    const f = await fixture(spec, { blocked: true });
    try {
      await f.build();
      await run(Deferred.await(f.entered));
    } finally {
      await f.close();
    }
    assert.equal(f.interrupted(), 1);
    assert.equal(f.calls.filter((row) => row[0] === "remove").length, 0);
  });
  test(`${spec.name}: patched cleanup node acquires without original read/stat/remove or background fork`, async () => {
    const f = await fixture(spec, { patch: true });
    try {
      await f.build();
      await run(
        Effect.gen(function* () {
          for (let i = 0; i < 64; i++) yield* Effect.yieldNow;
        }),
      );
      assert.deepEqual(f.calls, []);
      assert.equal(f.node.layer, Layer.empty);
    } finally {
      await f.close();
    }
    assert.deepEqual(f.calls, []);
    assert.equal(f.interrupted(), 0);
  });
  test(`${spec.name}: explicit cleanup remains typed unavailable before original factory construction`, async () => {
    const f = await fixture(spec, { patch: true });
    let constructions = 0;
    const original = () => {
      constructions++;
      return Effect.void;
    };
    let method;
    if (spec.name === "Shell")
      method = evaluate(variable(f.tree, "cleanup2"), {
        Effect,
        originalMaintenanceCleanup2: original,
      });
    else {
      const field = one(
        f.tree,
        (node) =>
          ts.isPropertyAssignment(node) &&
          node.name.getText(f.tree) === "cleanup",
      );
      method = evaluate(field.initializer.getText(f.tree), {
        Effect,
        cleanup: original,
        fs: f.fs,
        directory: "/synthetic-native-data/tool-output",
      });
    }
    try {
      const exit = await run(
        Effect.exit(method().pipe(Effect.provide(f.context))),
      );
      assert.equal(exit._tag, "Failure");
      assert.ok(
        exit.cause.reasons.every(
          (row) =>
            row._tag === "Fail" &&
            /native_permission_maintenance_unverified/u.test(String(row.error)),
        ),
      );
      assert.equal(constructions, 0);
      assert.deepEqual(f.calls, []);
    } finally {
      await f.close();
    }
  });
}
test("maintenance overlay preserves original cleanup closures/layers and frozen prior60 objects", async () => {
  for (const spec of specs) {
    const original = originals.get(spec.chunk),
      tree = patched(original);
    assert.equal(
      variable(tree, "cleanupLayer"),
      variable(original, "cleanupLayer"),
    );
    if (spec.name === "Shell")
      assert.equal(
        variable(tree, "originalMaintenanceCleanup2"),
        variable(original, "cleanup2"),
      );
    else assert.equal(variable(tree, "cleanup"), variable(original, "cleanup"));
  }
  const archive = new URL(
    "../../../docs/runs/permission-task-lifetime-integration/prechange/startup-maintenance-before-r1/",
    import.meta.url,
  );
  const filename =
    "apps/desktop-app/src/native-permission-overlay-contract.mjs";
  const bytes = await readFile(new URL(filename, archive), "utf8");
  const manifest = JSON.parse(
    await readFile(new URL("manifest.json", archive)),
  );
  assert.equal(
    sha(bytes),
    manifest.existing.find((row) => row.path === filename).sha256,
  );
  const literal = bytes.slice(
    bytes.indexOf("const recipe = ") + "const recipe = ".length,
    bytes.indexOf(";\nfor (const file"),
  );
  const before = new Function(`return (${literal});`)();
  assert.equal(before.files.length, 60);
  assertOnlyCreateGateChanged(recipe.files.slice(0, 60), before.files);
  // Five later extensions plus the closed SessionTransfer.import entry.
  assert.equal(recipe.files.length, 67);
  assert.ok(
    recipe.files.reduce((count, row) => count + row.edits.length, 0) <= 256,
  );
});
