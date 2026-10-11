import assert from "node:assert/strict";
import { after, test } from "node:test";
import { copyFile, mkdtemp, rm, symlink, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const namespace = await mkdtemp(join(tmpdir(), "omoc-coordinator-admission-"));
await symlink(
  fileURLToPath(
    new URL(
      "../runtime-event-host/.generated/install/node_modules",
      import.meta.url,
    ),
  ),
  join(namespace, "node_modules"),
  "dir",
);
for (const name of [
  "native-permission-control.mjs",
  "native-permission-control-input.mjs",
  "native-permission-leases.mjs",
  "native-permission-origin-scopes.mjs",
  "permission-control-canonical.mjs",
  "native-permission-task-observer.mjs",
  "native-permission-coordinator-admission.mjs",
]) {
  await copyFile(new URL(`./${name}`, import.meta.url), join(namespace, name));
}
const { createCoordinatorAdmission, toolSessionID } = await import(
  pathToFileURL(join(namespace, "native-permission-coordinator-admission.mjs"))
    .href
);
const Control = await import(
  pathToFileURL(join(namespace, "native-permission-control.mjs")).href
);
const { Effect, Deferred, Fiber, Exit, Layer, Context } = await import(
  pathToFileURL(join(namespace, "node_modules/effect/dist/index.js")).href
);
after(() => rm(namespace, { recursive: true, force: true }));
const row = () => ({
  id: "session",
  projectID: "project",
  location: { directory: "/checked/workspace" },
});
const run = (body) =>
  Effect.runPromise(
    Effect.provide(
      Effect.gen(function* () {
        yield* body(yield* Control.Service);
      }),
      Control.configured({ runtimeEpoch: "epoch", bootHolds: [] }),
    ).pipe(Effect.timeout("5 seconds")),
  );
const code = (exit, expected) => {
  assert.ok(Exit.isFailure(exit));
  assert.ok(
    exit.cause.reasons.some(
      (r) => r._tag === "Fail" && r.error?.message === expected,
    ),
  );
};

test("actual shared Control denies coordinator callback after two Native identity reads", async () => {
  await run((control) =>
    Effect.gen(function* () {
      let reads = 0,
        calls = 0;
      const enter = createCoordinatorAdmission({
        control,
        store: {
          get: () =>
            Effect.sync(() => {
              reads++;
              return row();
            }),
        },
      });
      code(
        yield* Effect.exit(
          enter("session", () =>
            Effect.sync(() => {
              calls++;
            }),
          ),
        ),
        "native_permission_held",
      );
      assert.equal(reads, 2);
      assert.equal(calls, 0);
      assert.deepEqual(
        yield* control.transaction(["project"], (tx) =>
          control.leaseSnapshot(tx, "project"),
        ),
        [],
      );
    }),
  );
});

test("missing, malformed and accessor identity is refused without invoking effect callbacks", async () => {
  await run((control) =>
    Effect.gen(function* () {
      let traps = 0,
        calls = 0;
      const accessor = row();
      Object.defineProperty(accessor, "projectID", {
        enumerable: true,
        get() {
          traps++;
          return "project";
        },
      });
      const invalid = [
        undefined,
        {},
        { ...row(), id: "other" },
        { ...row(), projectID: "" },
        { ...row(), location: { directory: "relative" } },
        { ...row(), location: { directory: "/bad/../path" } },
        { ...row(), location: { directory: "/ok", workspaceID: 1 } },
        accessor,
        new Proxy(row(), {
          getOwnPropertyDescriptor() {
            traps++;
            throw new Error("trap");
          },
        }),
      ];
      for (const value of invalid) {
        const enter = createCoordinatorAdmission({
          control,
          store: { get: () => Effect.succeed(value) },
        });
        code(
          yield* Effect.exit(
            enter("session", () =>
              Effect.sync(() => {
                calls++;
              }),
            ),
          ),
          "native_permission_scope_unverified",
        );
      }
      assert.equal(traps, 0);
      assert.equal(calls, 0);
    }),
  );
});

test("changed project, path or workspace during gate wait refuses old admission", async () => {
  for (const change of [
    (value) => {
      value.projectID = "other";
    },
    (value) => {
      value.location.directory = "/replacement";
    },
    (value) => {
      value.location.workspaceID = "workspace";
    },
  ])
    await run((control) =>
      Effect.gen(function* () {
        const held = yield* Deferred.make();
        const release = yield* Deferred.make();
        const read = yield* Deferred.make();
        const original = row();
        let reads = 0,
          calls = 0;
        const holder = yield* Effect.forkChild(
          control.transaction(["project"], () =>
            Deferred.succeed(held, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
            ),
          ),
        );
        yield* Deferred.await(held);
        const enter = createCoordinatorAdmission({
          control,
          store: {
            get: () =>
              Effect.sync(() => {
                reads++;
                // Native Store returns a detached Info for each DB read.
                return { ...original, location: { ...original.location } };
              }).pipe(Effect.tap(() => Deferred.succeed(read, undefined))),
          },
        });
        const pending = yield* Effect.forkChild(
          Effect.exit(
            enter("session", () =>
              Effect.sync(() => {
                calls++;
              }),
            ),
          ),
        );
        yield* Deferred.await(read);
        change(original);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(holder);
        code(yield* Fiber.join(pending), "native_permission_scope_unverified");
        assert.equal(reads, 2);
        assert.equal(calls, 0);
      }),
    );
});

test("invalid entry and body fail before Store IO; dependency accessors never run", async () => {
  await run((control) =>
    Effect.gen(function* () {
      let reads = 0;
      const store = {
        get: () =>
          Effect.sync(() => {
            reads++;
            return row();
          }),
      };
      const enter = createCoordinatorAdmission({ control, store });
      for (const [id, body] of [
        ["", () => Effect.void],
        ["session", undefined],
      ])
        code(
          yield* Effect.exit(enter(id, body)),
          "native_permission_scope_unverified",
        );
      assert.equal(reads, 0);
      let calls = 0;
      assert.throws(() =>
        createCoordinatorAdmission({
          control,
          store: {
            get get() {
              calls++;
              return undefined;
            },
          },
        }),
      );
      assert.equal(calls, 0);
    }),
  );
});

// Exercise the actual saved child's service capture expressions with pinned
// Effect under Node. No Native graph/import/engine is executed here.
test("saved child capture uses real pinned Layer and Context APIs", async () => {
  const source = await readFile(
    new URL(
      "../scripts/fixtures/native-permission-graph-native.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  const start = source.indexOf(
    "  let actualExecution, actualStore, actualControl;",
  );
  const end = source.indexOf("  const [", start);
  assert.ok(start > 0 && end > start);
  const build = new Function(
    "Layer",
    "Effect",
    "Context",
    "ControlRuntime",
    source.slice(start, end) +
      "return {layer:actualControlNode, captured:()=>actualControl};",
  );
  const captured = build(Layer, Effect, Context, Control);
  const control = await Effect.runPromise(
    Effect.provide(Control.Service, captured.layer),
  );
  assert.equal(captured.captured(), control);
  await Effect.runPromise(
    control.transaction(["project"], (tx) =>
      Effect.gen(function* () {
        assert.equal(
          (yield* control.inspect(tx, "project")).state,
          "boot_held",
        );
      }),
    ),
  );
});

test("tool context session ID capture refuses accessor and Proxy before callbacks", () => {
  let calls = 0;
  const accessor = Object.defineProperty({}, "sessionID", {
    enumerable: true,
    get() {
      calls++;
      return "session";
    },
  });
  const proxy = new Proxy(
    { sessionID: "session" },
    {
      getOwnPropertyDescriptor() {
        calls++;
        throw new Error("trap");
      },
    },
  );
  for (const value of [
    undefined,
    null,
    {},
    accessor,
    proxy,
    { sessionID: undefined },
    { sessionID: 0 },
    { sessionID: "" },
    Object.create({ sessionID: "session" }),
    Object.defineProperty({}, "sessionID", {
      value: "session",
      enumerable: false,
    }),
  ])
    assert.throws(() => toolSessionID(value));
  assert.equal(calls, 0);
  const value = {
    sessionID: "session",
    progress() {
      calls++;
    },
  };
  const captured = toolSessionID(value);
  value.sessionID = "other";
  assert.equal(captured, "session");
  assert.equal(calls, 0);
});
