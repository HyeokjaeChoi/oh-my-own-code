// Exact inert pinned SessionInstructions layer under Node/Effect. Scripted
// store/bus/FS are call-contract evidence, not Native IO or task authority.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import test from "node:test";
import { NATIVE_PERMISSION_OVERLAY_RECIPE } from "./native-permission-overlay-contract.mjs";
import { planNativePermissionOverlay } from "../scripts/native-permission-overlay.mjs";

const install = new URL(
  "../runtime-event-host/.generated/install/node_modules/",
  import.meta.url,
);
const { Context, Effect, Layer, Option, Ref, Schema, Fiber } = await import(
  new URL("effect/dist/index.js", install)
);
const bytes = await readFile(
  new URL("@opencode/core/dist/chunks/config-s0ehs66p.js", install),
);
assert.equal(
  createHash("sha256").update(bytes).digest("hex"),
  "9a7cb24c50f09a3d07eca739a556f609fe2790016d06c3d352e441781a0f1186",
);
const inputs = await Promise.all(
  NATIVE_PERMISSION_OVERLAY_RECIPE.files.map(async ({ path }) => ({
    path,
    content: await readFile(
      new URL(path.replace(/^node_modules\//, ""), install),
    ),
  })),
);
const planned = planNativePermissionOverlay(
  NATIVE_PERMISSION_OVERLAY_RECIPE,
  inputs,
);
const source = planned.files
  .find((row) => row.path.endsWith("/config-s0ehs66p.js"))
  .content.toString("utf8");
const service = (name) => class extends Context.Service()(name) {};
const Service83 = service("test/ReadInstructionsBus");
const Service50 = service("test/ReadInstructionsStore");
const Service80 = service("test/ReadInstructionsLocation");
const FSUtil = {
  Service: service("test/ReadInstructionsFS"),
  contains: (root, path) => path === root || path.startsWith(root + "/"),
};
const deps = {
  Context,
  Effect,
  Layer,
  Option,
  Ref,
  Schema,
  Service83,
  Service50,
  Service80,
  FSUtil,
  relative,
  SessionEvent2: { Synthetic: "original-synthetic-event" },
};
const originalLayer = new Function(
  ...Object.keys(deps),
  source.slice(
    source.indexOf("var InjectedMetadata ="),
    source.indexOf("var node14 ="),
  ) + "\nreturn { Service12, layer };",
)(...Object.values(deps));
const root = "/owned-synthetic/workspace";
const sessionID = "synthetic-session";
const path = root + "/nested/AGENTS.md";

function fixture(options = {}) {
  const events = [],
    reads = [],
    calls = [];
  let current;
  const fs = {
    resolve: (value) =>
      Effect.sync(() => {
        assert.equal(value, root);
        calls.push("resolve-root");
        return value;
      }),
    readFileStringSafe: (value) =>
      Effect.suspend(() => {
        reads.push(value);
        if (options.read) return options.read(value);
        return Effect.succeed(
          options.missing ? undefined : "\uFEFFexact\r\nbytes\r\n",
        );
      }),
  };
  const store = {
    context: (id) =>
      Effect.withFiber((fiber) =>
        Effect.sync(() => {
          assert.equal(id, sessionID);
          calls.push("store-context");
          if (current) assert.equal(fiber, current);
          return options.history ?? [];
        }),
      ),
  };
  const bus = {
    publish: (kind, value) =>
      Effect.withFiber((fiber) =>
        Effect.gen(function* () {
          calls.push("publish-start");
          if (current) assert.equal(fiber, current);
          assert.equal(kind, "original-synthetic-event");
          if (options.publish) yield* options.publish(value);
          events.push(value);
          calls.push("publish-end");
        }),
      ),
  };
  const dependencies = Layer.mergeAll(
    Layer.succeed(FSUtil.Service, fs),
    Layer.succeed(Service50, store),
    Layer.succeed(Service83, bus),
    Layer.succeed(Service80, { project: { directory: root } }),
  );
  const layer = originalLayer.layer.pipe(Layer.provide(dependencies));
  const run = (body) => Effect.scoped(body.pipe(Effect.provide(layer)));
  const load = (paths = [path]) =>
    run(
      Effect.gen(function* () {
        const instructions = yield* originalLayer.Service12;
        current = yield* Effect.withFiber((fiber) => Effect.succeed(fiber));
        yield* instructions.load({ sessionID, paths });
      }),
    );
  return { events, reads, calls, run, load };
}

test("original instructions preserves exact text and original metadata in Synthetic event", async () => {
  const f = fixture();
  await Effect.runPromise(f.load());
  assert.deepEqual(f.reads, [path]);
  assert.deepEqual(f.events, [
    {
      sessionID,
      text: `Instructions from: ${path}\n\uFEFFexact\r\nbytes\r\n`,
      description: "Loaded nested/AGENTS.md",
      metadata: { instruction: { paths: [path] } },
    },
  ]);
  assert.deepEqual(f.calls, [
    "resolve-root",
    "store-context",
    "publish-start",
    "publish-end",
  ]);
});

test("instruction service acquisition performs no root IO before an actual load task", async () => {
  const f = fixture();
  await Effect.runPromise(
    f.run(
      Effect.gen(function* () {
        yield* originalLayer.Service12;
      }),
    ),
  );
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.reads, []);
  assert.deepEqual(f.events, []);
});

test("original store context prevents already-injected path from being read or published", async () => {
  const f = fixture({
    history: [
      { type: "synthetic", metadata: { instruction: { paths: [path] } } },
    ],
  });
  await Effect.runPromise(f.load());
  assert.deepEqual(f.reads, []);
  assert.deepEqual(f.events, []);
});

test("ordinary messages and malformed synthetic metadata do not invent prior injection", async () => {
  const f = fixture({
    history: [
      { type: "assistant", metadata: { instruction: { paths: [path] } } },
      { type: "synthetic", metadata: { instruction: { paths: [1] } } },
    ],
  });
  await Effect.runPromise(f.load());
  assert.deepEqual(f.reads, [path]);
  assert.equal(f.events.length, 1);
});

test("missing instructions do not fabricate content or event", async () => {
  const f = fixture({ missing: true });
  await Effect.runPromise(f.load());
  assert.deepEqual(f.events, []);
});

test("instruction read failure prevents any partial Synthetic publication", async () => {
  const failure = new Error("synthetic authority revoked");
  const f = fixture({
    read: (value) =>
      value === path ? Effect.succeed("first") : Effect.fail(failure),
  });
  await assert.rejects(
    Effect.runPromise(f.load([path, root + "/other/AGENTS.md"])),
  );
  assert.deepEqual(f.events, []);
});

test("original load remains unfinished while original Synthetic publish is pending", async () => {
  const gate = Promise.withResolvers();
  const f = fixture({ publish: () => Effect.promise(() => gate.promise) });
  const fiber = Effect.runFork(f.load());
  while (!f.calls.includes("publish-start"))
    await new Promise((done) => setImmediate(done));
  assert.equal(fiber.pollUnsafe(), undefined);
  assert.deepEqual(f.events, []);
  gate.resolve();
  await Effect.runPromise(Fiber.join(fiber));
  assert.equal(f.events.length, 1);
});

test("publish failure propagates and its in-flight claim is released for a later explicit call", async () => {
  let count = 0;
  const f = fixture({
    publish: () =>
      ++count === 1
        ? Effect.fail(new Error("synthetic publish failure"))
        : Effect.void,
  });
  await Effect.runPromise(
    f.run(
      Effect.gen(function* () {
        const instructions = yield* originalLayer.Service12;
        yield* instructions
          .load({ sessionID, paths: [path] })
          .pipe(Effect.catch(() => Effect.void));
        yield* instructions.load({ sessionID, paths: [path] });
      }),
    ),
  );
  assert.equal(count, 2);
  assert.equal(f.events.length, 1);
  assert.deepEqual(f.reads, [path, path]);
});
