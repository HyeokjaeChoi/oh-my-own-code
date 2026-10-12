// Native Worktree.create/refresh/remove run the git strategy (git worktree
// add/remove/list: repo hooks and filters) and the project start command. The
// overlay refuses them before any project lookup, settings load or strategy.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { NATIVE_PERMISSION_OVERLAY_RECIPE } from "./native-permission-overlay-contract.mjs";
import { planNativePermissionOverlay } from "../scripts/native-permission-overlay.mjs";

const root = new URL(
  "../runtime-event-host/.generated/install/",
  import.meta.url,
);
const CHUNK = "node_modules/@opencode/core/dist/chunks/config-446vgdts.js";
const inputs = await Promise.all(
  NATIVE_PERMISSION_OVERLAY_RECIPE.files.map(async ({ path }) => ({
    path,
    content: await readFile(new URL(path, root)),
  })),
);
const patched = planNativePermissionOverlay(
  NATIVE_PERMISSION_OVERLAY_RECIPE,
  inputs,
)
  .files.find((file) => file.path === CHUNK)
  .content.toString("utf8");
const original = await readFile(new URL(CHUNK, root), "utf8");
const { Effect } = await import(
  pathToFileURL(new URL("node_modules/effect/dist/index.js", root).pathname)
    .href
);

// Extract create/remove/refresh; every collaborator is a recording stub.
function ops(source) {
  const start = source.indexOf('  const create = Effect.fn("Worktree.create")');
  const end = source.indexOf("  return Service16.of(");
  assert.ok(start >= 0 && end > start);
  const calls = [];
  const reach = (name) => () =>
    Effect.sync(() => calls.push(name)).pipe(
      Effect.flatMap(() => Effect.fail(new Error("reached " + name))),
    );
  const api = new Function(
    "Effect",
    "project",
    "load",
    "getStrategy",
    "source",
    "ops",
    `${source.slice(start, end)}\nreturn { create, remove, refresh };`,
  )(
    Effect,
    reach("project"),
    reach("load"),
    reach("getStrategy"),
    reach("source"),
    {
      list: reach("ops.list"),
      find: reach("ops.find"),
      create: reach("ops.create"),
      remove: reach("ops.remove"),
    },
  );
  return { api, calls };
}
const input = { projectID: "p", directory: "/x", force: true };
const run = (effect) =>
  Effect.runPromise(Effect.flip(effect)).then((error) => error.message);

for (const name of ["create", "remove", "refresh"]) {
  test(`patched Worktree.${name} fails closed before any project, settings or strategy`, async () => {
    const { api, calls } = ops(patched);
    assert.equal(
      await run(api[name](input, undefined)),
      "native_permission_held",
    );
    assert.deepEqual(calls, []);
  });
  test(`unpatched Worktree.${name} reaches the strategy path (positive control)`, async () => {
    const { api, calls } = ops(original);
    assert.equal(await run(api[name](input, undefined)), "reached project");
    assert.deepEqual(calls, ["project"]);
  });
}
