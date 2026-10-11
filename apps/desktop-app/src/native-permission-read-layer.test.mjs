// Inert original layer extraction with real pinned Effect. No Native module,
// service IO, Task grant, Bun or physical runtime is imported or executed.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import test from "node:test";
import { NATIVE_PERMISSION_OVERLAY_RECIPE as recipe } from "./native-permission-overlay-contract.mjs";
const install = new URL(
  "../runtime-event-host/.generated/install/",
  import.meta.url,
);
const { Context, Effect, Layer } = await import(
  new URL("node_modules/effect/dist/index.js", install)
);
const path = "node_modules/@opencode/core/dist/chunks/config-119mbqs2.js";
const original = await readFile(new URL(path, install), "utf8");
assert.equal(
  createHash("sha256").update(original).digest("hex"),
  "80ddf77b814ec271b0a169c58eb80999867a110dfe7a554838b594ecdfbe0c84",
);
function transformed() {
  let source = original;
  const entry = recipe.files.find((row) => row.path === path);
  for (const edit of entry?.edits ?? []) {
    assert.equal(source.split(edit.find).length - 1, 1);
    source = source.replace(edit.find, () => edit.replace);
  }
  if (entry)
    assert.equal(
      createHash("sha256").update(source).digest("hex"),
      entry.afterSha256,
    );
  return source;
}
test("actual Native Read layer routes read/list to same Control without acquiring raw Environment files", async () => {
  const source = transformed();
  const Service = Context.Service("read-layer-test/native"),
    Environment = Context.Service("read-layer-test/raw-environment"),
    Control = Context.Service("read-layer-test/control");
  let raw = 0;
  const forbidden = () => {
    raw++;
    throw Error("raw Environment file IO forbidden");
  };
  const calls = [];
  const layer = new Function(
    "Layer",
    "Effect",
    "Service7",
    "Service78",
    "WorkbenchControl",
    "read2",
    source.slice(source.indexOf("var layer ="), source.indexOf("var node8 =")) +
      "return layer;",
  )(Layer, Effect, Service, Environment, Control, forbidden);
  const service = await Effect.runPromise(
    Effect.provide(
      Service,
      Layer.provide(
        layer,
        Layer.mergeAll(
          Layer.succeed(Environment, {
            get files() {
              return forbidden();
            },
          }),
          Layer.succeed(Control, {
            readNativeFile(input) {
              calls.push(input);
              return Effect.succeed({ kind: input.kind, path: input.path });
            },
          }),
        ),
      ),
    ),
  );
  const page = { offset: 0, limit: 20 };
  assert.deepEqual(
    await Effect.runPromise(
      service.read("/synthetic/workspace/file.txt", "file.txt", page),
    ),
    { kind: "read", path: "/synthetic/workspace/file.txt" },
  );
  assert.deepEqual(
    await Effect.runPromise(service.list("/synthetic/workspace")),
    { kind: "list", path: "/synthetic/workspace" },
  );
  assert.deepEqual(calls, [
    {
      kind: "read",
      path: "/synthetic/workspace/file.txt",
      resource: "file.txt",
      page,
    },
    { kind: "list", path: "/synthetic/workspace" },
  ]);
  assert.equal(raw, 0);
});
test("checked layer preserves original consumer algorithms and has no environment dependency fallback", () => {
  const source = transformed();
  assert.equal(
    source.slice(
      source.indexOf("var MAX_READ_LINES2 ="),
      source.indexOf("var layer ="),
    ),
    original.slice(
      original.indexOf("var MAX_READ_LINES2 ="),
      original.indexOf("var layer ="),
    ),
  );
  assert.match(
    source,
    /makeLocationNode\(\{ service: Service7, layer, deps: \[workbenchControlNode\] \}\)/u,
  );
});
