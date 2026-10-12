import { copyPermissionControlSources } from "../scripts/native-permission-test-fixture.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { after, test } from "node:test";
import { mkdtemp, rm, symlink, mkdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Resolve both the copied source and the tests against the same pinned packages.
// The shared installation is only a dependency link; tests never write into it.
const namespace = await mkdtemp(
  join(tmpdir(), "omoc-permission-control-test-"),
);
let control;
let library;
let graph;
try {
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
  await copyPermissionControlSources(namespace);
  control = await import(
    pathToFileURL(join(namespace, "native-permission-control.mjs")).href
  );
  library = await import(
    pathToFileURL(join(namespace, "node_modules/effect/dist/index.js")).href
  );
  graph = await import(
    pathToFileURL(
      join(namespace, "node_modules/@opencode/util/dist/effect/layer-node.js"),
    ).href
  );
} catch (error) {
  await rm(namespace, { recursive: true, force: true });
  throw error;
}
// Each run owns its child fibers; Effect completes their interruption before
// resolving runPromise. Remove the namespace only after all tests have finished.
after(() => rm(namespace, { recursive: true, force: true }));
const { Effect, Deferred, Fiber, Exit, Context, Layer } = library;
const options = () => ({ runtimeEpoch: "test_epoch-1", bootHolds: [] });
const run = (body, layer = control.configured(options())) =>
  Effect.runPromise(
    Effect.provide(
      Effect.gen(function* () {
        yield* body(yield* control.Service);
      }),
      layer,
    ).pipe(Effect.timeout("5 seconds")),
  );
const settle = Effect.gen(function* () {
  // Cooperatively drain runnable children; no wall-clock timing assumption.
  for (let i = 0; i < 64; i++) yield* Effect.yieldNow;
});
const expectFailure = (effect, code) =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(effect);
    assert.ok(Exit.isFailure(exit), `expected failure ${code ?? ""}`);
    assert.ok(exit.cause.reasons.length > 0);
    assert.ok(
      exit.cause.reasons.every((reason) => reason._tag === "Fail"),
      `contract rejection must be a typed failure: ${exit.cause.reasons.map((reason) => `${reason._tag}: ${reason.error ?? reason.defect}`).join(", ")}`,
    );
    if (code) {
      assert.ok(
        exit.cause.reasons.some((reason) =>
          [
            reason.error?.code,
            reason.error?._tag,
            reason.error?.message,
            String(reason.error),
          ].some((value) => String(value).includes(code)),
        ),
        `expected ${code}: ${JSON.stringify(exit.cause.reasons)}`,
      );
    }
  });
const snapshot = (service, projectId = "a") =>
  service.transaction([projectId], (tx) => service.inspect(tx, projectId));
const holder = (service, ids, entered, release, body = () => Effect.void) =>
  service.transaction(ids, (tx) =>
    Effect.gen(function* () {
      yield* Deferred.succeed(entered, tx);
      yield* Deferred.await(release);
      yield* body(tx);
    }),
  );

test("boot-held admission allocates no leases, including after invalidation", async () => {
  const { createNativeOriginScopes } = await import(
    pathToFileURL(join(namespace, "native-permission-origin-scopes.mjs")).href
  );
  // Genuine synthetic scope, foreign to Control's private registry. No journal
  // admission or Native execution authority is implied by this registration.
  const origins = createNativeOriginScopes({ runtimeEpoch: "test_epoch-1" });
  const origin = origins.admit({
    origin: {
      runtimeEpoch: "test_epoch-1",
      operationId: "operation",
      type: "message.send",
      digest: "a".repeat(64),
    },
    originKind: "prompt",
    taskScopeId: "33333333-3333-4333-8333-333333333333",
    workspaceId: "workspace",
    appSessionId: "app_session",
    nativeSessionId: "ses_native",
    projectId: "a",
    locationIncarnation: "location",
    locationId: "44444444-4444-4444-8444-444444444444",
    modeGeneration: 1,
    inventoryGeneration: 1,
    inputDigest: "b".repeat(64),
  });
  const scope = origins.createScope({ cause: origin, inboxes: [] });
  try {
    await run((service) =>
      service.transaction(["a"], (tx) =>
        Effect.gen(function* () {
          assert.equal(service.origins, undefined);
          assert.equal(service.advanceScope, undefined);
          let traps = 0;
          const proxy = new Proxy(scope, {
            get() {
              traps++;
              throw new Error("scope trap");
            },
            ownKeys() {
              traps++;
              throw new Error("scope trap");
            },
          });
          for (const invalidated of [false, true]) {
            if (invalidated) {
              origins.revoke(origin);
              yield* service.invalidate("unverified");
            }
            for (const candidate of [
              scope,
              proxy,
              Object.freeze({}),
              origins.inspect(scope),
            ]) {
              const identity = {
                scope: candidate,
                projectId: "a",
                locationIncarnation: "location",
                locationId: "44444444-4444-4444-8444-444444444444",
                sessionId: "session",
                kind: "coordinator",
                modeGeneration: 1,
                inventoryGeneration: 1,
                parentLeaseId: null,
              };
              yield* expectFailure(
                service.admitLease(tx, identity),
                "native_permission_held",
              );
              assert.deepEqual(yield* service.leaseSnapshot(tx, "a"), []);
            }
            yield* expectFailure(
              service.assertExecution(tx, "a"),
              "native_permission_held",
            );
          }
          assert.equal(traps, 0);
        }),
      ),
    );
  } finally {
    origins.close();
  }
});

test("default global node fails closed without explicit configuration", async () => {
  assert.ok(control.node);
  await expectFailure(
    Effect.provide(control.Service, graph.compile(control.node)),
    "native_permission_uninitialized",
  ).pipe(Effect.runPromise);
});

test("configured global node replacement shares one kernel across actual graph consumers", async () => {
  const { makeGlobalNode } = await import(
    pathToFileURL(
      join(namespace, "node_modules/@opencode/util/dist/effect/app-node.js"),
    ).href
  );
  const Left = Context.Service("permission-test/Left");
  const Right = Context.Service("permission-test/Right");
  const left = makeGlobalNode({
    service: Left,
    layer: Layer.effect(Left, control.Service),
    deps: [control.node],
  });
  const right = makeGlobalNode({
    service: Right,
    layer: Layer.effect(Right, control.Service),
    deps: [control.node],
  });
  const compiled = graph.compile(graph.group([left, right]), {
    replacements: [control.node.replace(control.configured(options()))],
  });
  await Effect.runPromise(
    Effect.provide(
      Effect.gen(function* () {
        const first = yield* Left;
        const second = yield* Right;
        assert.equal(first, second);
        yield* first.invalidate("shared_runtime");
        assert.equal((yield* snapshot(second)).runtimeHeld, true);
      }),
      compiled,
    ).pipe(Effect.timeout("5 seconds")),
  );
});

test("configured rejects malformed closed inputs synchronously without getter or proxy traps", () => {
  let accesses = 0;
  const accessor = (key, target) =>
    Object.defineProperty(target, key, {
      enumerable: true,
      get() {
        accesses++;
        throw new Error("authority getter executed");
      },
    });
  const proxy = (target) =>
    new Proxy(target, {
      ownKeys() {
        accesses++;
        throw new Error("proxy trap executed");
      },
      get() {
        accesses++;
        throw new Error("proxy trap executed");
      },
      getPrototypeOf() {
        accesses++;
        throw new Error("proxy trap executed");
      },
    });
  const hold = { projectId: "a", originalOperationKey: "op" };
  const invalid = [
    undefined,
    null,
    [],
    {},
    { runtimeEpoch: "x" },
    { ...options(), extra: true },
    { ...options(), [Symbol("extra")]: true },
    accessor("runtimeEpoch", { bootHolds: [] }),
    proxy(options()),
    ...["", "x".repeat(129), "é", "space here", "x\n", 1].map(
      (runtimeEpoch) => ({ ...options(), runtimeEpoch }),
    ),
    ...[
      null,
      {},
      new Array(1),
      Array(1025).fill(hold),
      proxy([]),
      [null],
      [{}],
      [{ ...hold, extra: 1 }],
      [{ ...hold, [Symbol("extra")]: 1 }],
      [accessor("projectId", { originalOperationKey: "op" })],
      [proxy(hold)],
      [{ ...hold, projectId: "" }],
      [{ ...hold, originalOperationKey: "" }],
      [{ ...hold, projectId: "é".repeat(2049) }],
      [{ ...hold, originalOperationKey: "é".repeat(2049) }],
      Object.assign([], { extra: true }),
      accessor("0", [hold]),
    ].map((bootHolds) => ({ ...options(), bootHolds })),
  ];
  for (const input of invalid) assert.throws(() => control.configured(input));
  assert.equal(accesses, 0);
});

test("boot holds are copied, sorted, deduplicated, deeply frozen and remain held", async () => {
  const input = {
    runtimeEpoch: "epoch_A",
    bootHolds: [
      { projectId: "a", originalOperationKey: "z" },
      { projectId: "b", originalOperationKey: "other" },
      { projectId: "a", originalOperationKey: "a" },
      { projectId: "a", originalOperationKey: "z" },
    ],
  };
  const layer = control.configured(input);
  input.runtimeEpoch = "mutated";
  input.bootHolds[0].originalOperationKey = "mutated";
  input.bootHolds.length = 0;
  await run(
    (service) =>
      Effect.gen(function* () {
        const value = yield* snapshot(service);
        assert.deepEqual(value, {
          runtimeEpoch: "epoch_A",
          projectId: "a",
          generation: 0,
          state: "boot_held",
          runtimeHeld: false,
          bootHolds: [
            { projectId: "a", originalOperationKey: "a" },
            { projectId: "a", originalOperationKey: "z" },
          ],
        });
        assert.ok(Object.isFrozen(value));
        assert.ok(Object.isFrozen(value.bootHolds));
        for (const item of value.bootHolds) assert.ok(Object.isFrozen(item));
        assert.throws(() => {
          value.bootHolds[0].originalOperationKey = "escape";
        });
        assert.deepEqual(yield* snapshot(service), value);
        const empty = yield* snapshot(service, "unseen");
        assert.equal(empty.state, "boot_held");
        assert.deepEqual(empty.bootHolds, []);
        yield* service.transaction(["unseen"], (tx) =>
          expectFailure(
            service.assertExecution(tx, "unseen"),
            "native_permission_held",
          ),
        );
      }),
    layer,
  );
});

test("initialization accepts exact UTF8 and count boundaries", async () => {
  const projectId = "é".repeat(2048);
  const originalOperationKey = "é".repeat(2048);
  const layer = control.configured({
    runtimeEpoch: "A".repeat(128),
    bootHolds: Array.from({ length: 1024 }, () => ({
      projectId,
      originalOperationKey,
    })),
  });
  await run(
    (service) =>
      Effect.gen(function* () {
        const value = yield* snapshot(service, projectId);
        assert.deepEqual(value.bootHolds, [
          { projectId, originalOperationKey },
        ]);
        assert.equal(value.runtimeEpoch.length, 128);
      }),
    layer,
  );
});

test("transaction rejects invalid inputs before callbacks and does not execute getters", async () => {
  await run((service) =>
    Effect.gen(function* () {
      let calls = 0;
      let getters = 0;
      const accessor = Object.defineProperty(["a"], "0", {
        get() {
          getters++;
          return "a";
        },
      });
      const proxy = new Proxy(["a"], {
        get() {
          getters++;
          return "a";
        },
      });
      for (const ids of [
        null,
        {},
        [],
        [""],
        [1],
        new Array(1),
        accessor,
        proxy,
        Array.from({ length: 33 }, (_, i) => `p${i}`),
      ]) {
        yield* expectFailure(
          service.transaction(ids, () => {
            calls++;
            return Effect.void;
          }),
        );
      }
      yield* expectFailure(service.transaction(["a"], null));
      assert.equal(calls, 0);
      assert.equal(getters, 0);
      yield* service.transaction(
        Array.from({ length: 32 }, (_, i) => `p${i}`),
        () => Effect.void,
      );
    }),
  );
});

test("capabilities reject forgery, copies, uncovered projects, child fibers and escaped reuse", async () => {
  await run((service) =>
    Effect.gen(function* () {
      let escaped;
      yield* service.transaction(["a"], (tx) =>
        Effect.gen(function* () {
          escaped = tx;
          assert.ok(Object.isFrozen(tx));
          assert.throws(
            () => JSON.stringify(tx),
            /native_permission_transaction/,
          );
          for (const bad of [null, {}, { ...tx }, Object.create(tx)]) {
            yield* expectFailure(
              service.inspect(bad, "a"),
              "native_permission_transaction",
            );
            yield* expectFailure(
              service.assertExecution(bad, "a"),
              "native_permission_transaction",
            );
          }
          yield* expectFailure(
            service.inspect(tx, "b"),
            "native_permission_transaction",
          );
          yield* expectFailure(
            service.assertExecution(tx, "b"),
            "native_permission_transaction",
          );
          const child = yield* Effect.forkChild(
            expectFailure(
              service.inspect(tx, "a"),
              "native_permission_transaction",
            ),
          );
          yield* Fiber.join(child);
          yield* expectFailure(
            service.assertExecution(tx, "a"),
            "native_permission_held",
          );
        }),
      );
      yield* expectFailure(
        service.inspect(escaped, "a"),
        "native_permission_transaction",
      );
      yield* service.transaction(["a"], () =>
        expectFailure(
          service.inspect(escaped, "a"),
          "native_permission_transaction",
        ),
      );
    }),
  );
});

test("same-fiber public reentry fails before acquiring even disjoint projects", async () => {
  await run((service) =>
    service.transaction(["a"], () =>
      Effect.gen(function* () {
        let calls = 0;
        for (const ids of [["a"], ["b"]]) {
          yield* expectFailure(
            service.transaction(ids, () => {
              calls++;
              return Effect.void;
            }),
            "native_permission_reentrant",
          );
        }
        assert.equal(calls, 0);
      }),
    ),
  );
});

test("inherited child transaction reentry rejects before parent-held or disjoint locks", async () => {
  await run((service) =>
    service.transaction(["a"], () =>
      Effect.gen(function* () {
        let calls = 0;
        for (const ids of [["a"], ["b"]]) {
          const child = yield* Effect.forkChild(
            expectFailure(
              service.transaction(ids, () => {
                calls++;
                return Effect.void;
              }),
              "native_permission_reentrant",
            ),
          );
          yield* Fiber.join(child);
        }
        assert.equal(calls, 0);
      }),
    ),
  );
});

test("same projects serialize; disjoint projects continue; reversed duplicate inputs cannot deadlock", async () => {
  await run((service) =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make();
      const release = yield* Deferred.make();
      const events = [];
      const first = yield* Effect.forkChild(
        holder(service, ["b", "a", "a"], entered, release, () =>
          Effect.sync(() => events.push("first-end")),
        ),
      );
      yield* Deferred.await(entered);
      const second = yield* Effect.forkChild(
        service.transaction(["a", "b"], () =>
          Effect.sync(() => events.push("second")),
        ),
      );
      yield* settle;
      assert.deepEqual(events, []);
      yield* service.transaction(["c"], () =>
        Effect.sync(() => events.push("independent")),
      );
      assert.deepEqual(events, ["independent"]);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(first);
      yield* Fiber.join(second);
      assert.deepEqual(events, ["independent", "first-end", "second"]);
    }),
  );
});

test("reverse inputs acquire the sorted first project before touching the second", async () => {
  await run((service) =>
    Effect.gen(function* () {
      const aEntered = yield* Deferred.make();
      const bEntered = yield* Deferred.make();
      const aRelease = yield* Deferred.make();
      const bRelease = yield* Deferred.make();
      const a = yield* Effect.forkChild(
        holder(service, ["a"], aEntered, aRelease),
      );
      const b = yield* Effect.forkChild(
        holder(service, ["b"], bEntered, bRelease),
      );
      yield* Deferred.await(aEntered);
      yield* Deferred.await(bEntered);
      const input = ["b", "a", "a"];
      const reverse = yield* Effect.forkChild(
        service.transaction(input, (tx) =>
          Effect.gen(function* () {
            assert.equal((yield* service.inspect(tx, "a")).projectId, "a");
            assert.equal((yield* service.inspect(tx, "b")).projectId, "b");
            yield* expectFailure(
              service.inspect(tx, "c"),
              "native_permission_transaction",
            );
          }),
        ),
      );
      yield* settle;
      input.splice(0, input.length, "c");
      yield* Deferred.succeed(bRelease, undefined);
      yield* Fiber.join(b);
      // A reverse-order implementation would take b and then block on a here.
      yield* service.transaction(["b"], () => Effect.void);
      yield* Deferred.succeed(aRelease, undefined);
      yield* Fiber.join(a);
      yield* Fiber.join(reverse);
    }),
  );
});

test("callback throw, failed Effect and interruption release all gates and expire capabilities", async () => {
  await run((service) =>
    Effect.gen(function* () {
      let escaped;
      const thrown = yield* Effect.exit(
        service.transaction(["b", "a"], (tx) => {
          escaped = tx;
          throw new Error("callback exploded");
        }),
      );
      assert.ok(Exit.isFailure(thrown));
      yield* expectFailure(
        service.inspect(escaped, "a"),
        "native_permission_transaction",
      );
      yield* service.transaction(["a", "b"], () => Effect.void);
      yield* expectFailure(
        service.transaction(["a", "b"], () => Effect.fail("body_failed")),
        "body_failed",
      );
      const entered = yield* Deferred.make();
      const release = yield* Deferred.make();
      const active = yield* Effect.forkChild(
        holder(service, ["b", "a"], entered, release),
      );
      escaped = yield* Deferred.await(entered);
      yield* Fiber.interrupt(active);
      yield* expectFailure(
        service.inspect(escaped, "a"),
        "native_permission_transaction",
      );
      yield* service.transaction(["a", "b"], () => Effect.void);
    }),
  );
});

test("32 waiters exclude the holder; overflow never enters; cancellation restores every project slot", async () => {
  await run((service) =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make();
      const release = yield* Deferred.make();
      const active = yield* Effect.forkChild(
        holder(service, ["b"], entered, release),
      );
      yield* Deferred.await(entered);
      let callbacks = 0;
      const queued = [];
      for (let i = 0; i < 32; i++) {
        queued.push(
          yield* Effect.forkChild(
            service.transaction(["b", "a"], () =>
              Effect.sync(() => callbacks++),
            ),
          ),
        );
        yield* settle;
      }
      assert.equal(callbacks, 0);
      yield* expectFailure(
        service.transaction(["b"], () => Effect.sync(() => callbacks++)),
        "native_permission_busy",
      );
      assert.equal(callbacks, 0);
      // Rejection on a saturated later project must not leak earlier reservations.
      for (let i = 0; i < 40; i++) {
        yield* expectFailure(
          service.transaction(["0_free", "b"], () =>
            Effect.sync(() => callbacks++),
          ),
          "native_permission_busy",
        );
      }
      yield* service.transaction(["0_free"], () => Effect.void);
      yield* Fiber.interrupt(queued.shift());
      const replacement = yield* Effect.forkChild(
        service.transaction(["a", "b"], () => Effect.sync(() => callbacks++)),
      );
      yield* settle;
      yield* expectFailure(
        service.transaction(["b"], () => Effect.sync(() => callbacks++)),
        "native_permission_busy",
      );
      yield* Fiber.interrupt(replacement);
      for (const fiber of queued) yield* Fiber.interrupt(fiber);
      assert.equal(callbacks, 0);
      // All multi-project requests were cancelled while b remained occupied.
      // a must have neither a leaked permit nor a leaked queue reservation.
      yield* service.transaction(["a"], () => Effect.void);
      const refill = [];
      for (let i = 0; i < 32; i++) {
        refill.push(
          yield* Effect.forkChild(
            service.transaction(["a", "b"], () =>
              Effect.sync(() => callbacks++),
            ),
          ),
        );
        yield* settle;
      }
      yield* expectFailure(
        service.transaction(["a", "b"], () => Effect.sync(() => callbacks++)),
        "native_permission_busy",
      );
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(active);
      for (const fiber of refill) yield* Fiber.join(fiber);
      assert.equal(callbacks, 32);
      yield* service.transaction(["a", "b"], () => Effect.void);
    }),
  );
});

test("invalidation proceeds while gates are held and is permanent for existing and new projects", async () => {
  await run((service) =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make();
      const release = yield* Deferred.make();
      const active = yield* Effect.forkChild(
        holder(service, ["a"], entered, release, (tx) =>
          Effect.gen(function* () {
            assert.equal((yield* service.inspect(tx, "a")).runtimeHeld, true);
            yield* expectFailure(
              service.assertExecution(tx, "a"),
              "native_permission_held",
            );
          }),
        ),
      );
      yield* Deferred.await(entered);
      yield* service.invalidate("runtime_lost");
      assert.equal((yield* snapshot(service, "new_project")).runtimeHeld, true);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(active);
      yield* service.invalidate("again");
      const state = yield* snapshot(service);
      assert.equal(state.runtimeHeld, true);
      assert.equal(state.generation, 0);
      assert.equal(state.state, "boot_held");
    }),
  );
});

test("invalid invalidation reasons fail without changing runtime state", async () => {
  await run((service) =>
    Effect.gen(function* () {
      for (const reason of [
        undefined,
        null,
        "",
        "x".repeat(129),
        "é",
        "has space",
        "x\n",
        {},
      ]) {
        yield* expectFailure(service.invalidate(reason));
        assert.equal((yield* snapshot(service)).runtimeHeld, false);
      }
      yield* service.invalidate("A".repeat(128));
      assert.equal((yield* snapshot(service)).runtimeHeld, true);
    }),
  );
});

test("each acquisition of the same configured Layer owns an independent kernel", async () => {
  const layer = control.configured(options());
  await run((service) => service.invalidate("first_acquisition"), layer);
  await run(
    (service) =>
      Effect.gen(function* () {
        assert.equal((yield* snapshot(service)).runtimeHeld, false);
        yield* service.transaction(["a"], (tx) =>
          expectFailure(
            service.assertExecution(tx, "a"),
            "native_permission_held",
          ),
        );
      }),
    layer,
  );
});

test("location owner retains building, ready and finalizing incarnations without settlement claims", async () => {
  await run((service) =>
    Effect.gen(function* () {
      const handle = yield* service.locationBegin({
        directory: "/workspace",
        workspaceID: undefined,
      });
      const read = () =>
        service.transaction(["a"], (tx) => service.locationSnapshot(tx, "a"));
      const first = yield* read();
      assert.equal(first.unknownBuilding, 1);
      assert.equal(first.incomplete, true);
      yield* service.locationBind(handle, {
        directory: "/workspace",
        workspaceID: undefined,
        project: { id: "a" },
      });
      yield* service.locationReady(handle);
      const ready = yield* read();
      assert.equal(ready.unknownBuilding, 0);
      assert.equal(ready.locations.length, 1);
      assert.equal(ready.locations[0].state, "ready");
      assert.equal(ready.incomplete, false);
      yield* service.locationFinalizing(handle);
      yield* service.locationScopeObserved(handle);
      const closed = yield* read();
      assert.equal(closed.locations[0].state, "finalizing");
      assert.equal(closed.locations[0].scopeObserved, true);
      assert.equal(closed.incomplete, true);
      assert.ok(closed.generation > ready.generation);
      yield* expectFailure(service.locationReady(handle), "location");
      const replacement = yield* service.locationBegin({
        directory: "/workspace",
      });
      yield* service.locationBind(replacement, {
        directory: "/workspace",
        project: { id: "a" },
      });
      yield* service.locationReady(replacement);
      const both = yield* read();
      assert.equal(both.locations.length, 2);
      assert.equal(both.incomplete, true);
      assert.notEqual(
        both.locations[0].incarnation,
        both.locations[1].incarnation,
      );
    }),
  );
});

test("location metadata excludes active project transactions without holding across Native effects", async () => {
  await run((service) =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make(),
        release = yield* Deferred.make();
      let began = false;
      const first = yield* Effect.forkChild(
        holder(service, ["a"], entered, release),
      );
      yield* Deferred.await(entered);
      const build = yield* Effect.forkChild(
        service.locationBegin({ directory: "/workspace" }).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              began = true;
            }),
          ),
        ),
      );
      yield* settle;
      assert.equal(began, false);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(first);
      const handle = yield* Fiber.join(build);
      assert.equal(began, true);
      yield* service.transaction(["b"], () => Effect.void);
      yield* service.locationFinalizing(handle);
    }),
  );
});

test("queued metadata precedes later shared admissions with staggered overlapping readers", async () => {
  await run((service) =>
    Effect.gen(function* () {
      const events = [];
      const start = (id) =>
        Effect.gen(function* () {
          const entered = yield* Deferred.make();
          const release = yield* Deferred.make();
          const fiber = yield* Effect.forkChild(
            holder(service, [id], entered, release, () =>
              Effect.sync(() => events.push(`${id}-end`)),
            ),
          );
          yield* Deferred.await(entered);
          return { fiber, release };
        });
      const finish = (reader) =>
        Effect.gen(function* () {
          yield* Deferred.succeed(reader.release, undefined);
          yield* Fiber.join(reader.fiber);
        });
      const a = yield* start("a");
      const b = yield* start("b");
      yield* finish(a);
      const c = yield* start("c");
      // a -> b -> c continuously overlap, but every reader is finite.
      const metadata = yield* Effect.forkChild(
        service
          .locationBegin({ directory: "/fair" })
          .pipe(Effect.tap(() => Effect.sync(() => events.push("metadata")))),
      );
      yield* settle;
      const later = [];
      for (const id of ["d", "e", "f"]) {
        later.push(
          yield* Effect.forkChild(
            service.transaction([id], (tx) =>
              Effect.gen(function* () {
                events.push(id);
                const value = yield* service.locationSnapshot(tx, id);
                assert.equal(value.unknownBuilding, 1);
              }),
            ),
          ),
        );
        yield* settle;
        assert.deepEqual(
          events,
          ["a-end"],
          "later shared reader overtook queued metadata",
        );
      }
      yield* finish(b);
      yield* settle;
      assert.deepEqual(events, ["a-end", "b-end"]);
      yield* finish(c);
      yield* Fiber.join(metadata);
      for (const fiber of later) yield* Fiber.join(fiber);
      // The committed snapshot above proves mutation order. The metadata
      // caller's tap can resume after readers awakened by its cleanup.
      assert.deepEqual(events.slice(0, 3), ["a-end", "b-end", "c-end"]);
      assert.ok(events.indexOf("metadata") >= 3);
      assert.deepEqual(
        events
          .slice(3)
          .filter((event) => event !== "metadata")
          .sort(),
        ["d", "e", "f"],
      );
    }),
  );
});

test("metadata admission bounds and cancellation reopen readers only after the last writer leaves", async () => {
  await run((service) =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make();
      const release = yield* Deferred.make();
      const active = yield* Effect.forkChild(
        holder(service, ["active"], entered, release),
      );
      yield* Deferred.await(entered);
      for (let round = 0; round < 2; round++) {
        const writers = [];
        for (let i = 0; i < 32; i++) {
          writers.push(
            yield* Effect.forkChild(
              service.locationBegin({ directory: `/cancel-${round}-${i}` }),
            ),
          );
          yield* settle;
        }
        yield* expectFailure(
          service.locationBegin({ directory: "/overflow" }),
          "busy",
        );
        let calls = 0;
        const reader = () =>
          service.transaction(["later"], () => Effect.sync(() => calls++));
        const cancelled = yield* Effect.forkChild(reader());
        yield* settle;
        assert.equal(calls, 0);
        yield* Fiber.interrupt(cancelled);
        const replacement = yield* Effect.forkChild(reader());
        yield* settle;
        for (const writer of writers.slice(0, -1))
          yield* Fiber.interrupt(writer);
        yield* settle;
        assert.equal(calls, 0);
        yield* Fiber.interrupt(writers.at(-1));
        // The active reader remains held: cancellation must reopen admission
        // without requiring a graph-wide drain or leaking a project queue slot.
        yield* Fiber.join(replacement);
        assert.equal(calls, 1);
      }
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(active);
      const value = yield* service.transaction(["active"], (tx) =>
        service.locationSnapshot(tx, "active"),
      );
      assert.equal(value.unknownBuilding, 0);
      yield* service.locationBegin({ directory: "/after-cancellation" });
    }),
  );
});

test("failed queued metadata releases admission and inherited lifecycle reentry fails before waiting", async () => {
  await run((service) =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make();
      const release = yield* Deferred.make();
      const active = yield* Effect.forkChild(
        holder(service, ["a"], entered, release, () =>
          Effect.gen(function* () {
            const child = yield* Effect.forkChild(
              expectFailure(
                service.locationBegin({ directory: "/nested" }),
                "reentrant",
              ),
            );
            yield* Fiber.join(child);
          }),
        ),
      );
      yield* Deferred.await(entered);
      const failed = yield* Effect.forkChild(
        expectFailure(service.locationReady({}), "location"),
      );
      yield* settle;
      let calls = 0;
      const reader = yield* Effect.forkChild(
        service.transaction(["b"], () => Effect.sync(() => calls++)),
      );
      yield* settle;
      assert.equal(calls, 0);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(active);
      yield* Fiber.join(failed);
      yield* Fiber.join(reader);
      assert.equal(calls, 1);
      yield* service.locationBegin({ directory: "/after-failure" });
    }),
  );
});

test("location handles reject forgery, cross owner use, identity rebinding and reentrant lifecycle mutation", async () => {
  let handle;
  await run((service) =>
    Effect.gen(function* () {
      handle = yield* service.locationBegin({ directory: "/workspace" });
      yield* expectFailure(
        service.locationBind(
          {},
          { directory: "/workspace", project: { id: "a" } },
        ),
        "location",
      );
      yield* expectFailure(
        service.locationBind(handle, {
          directory: "/foreign",
          project: { id: "a" },
        }),
        "location",
      );
      yield* service.locationBind(handle, {
        directory: "/workspace",
        project: { id: "a" },
      });
      yield* expectFailure(
        service.locationBind(handle, {
          directory: "/workspace",
          project: { id: "b" },
        }),
        "location",
      );
      yield* expectFailure(
        service.transaction(["a"], () => service.locationFinalizing(handle)),
        "reentrant",
      );
      yield* service.locationReady(handle);
      const snap = yield* service.transaction(["a"], (tx) =>
        service.locationSnapshot(tx, "a"),
      );
      assert.equal(snap.locations[0].projectId, "a");
      assert.ok(Object.isFrozen(snap.locations[0]));
    }),
  );
  await run((service) =>
    expectFailure(service.locationReady(handle), "location"),
  );
});

test("location capacity retains all thirty-two unknown entries and refuses another before effects", async () => {
  await run((service) =>
    Effect.gen(function* () {
      for (let i = 0; i < 32; i++)
        yield* service.locationBegin({ directory: `/workspace-${i}` });
      yield* expectFailure(
        service.locationBegin({ directory: "/overflow" }),
        "capacity",
      );
      const value = yield* service.transaction(["a"], (tx) =>
        service.locationSnapshot(tx, "a"),
      );
      assert.equal(value.unknownBuilding, 32);
      assert.equal(value.incomplete, true);
    }),
  );
});

test("location identity validation never invokes caller accessors or Proxy traps", async () => {
  await run((service) =>
    Effect.gen(function* () {
      let calls = 0;
      const accessor = Object.defineProperty({}, "directory", {
          enumerable: true,
          get() {
            calls++;
            return "/workspace";
          },
        }),
        proxy = new Proxy(
          { directory: "/workspace" },
          {
            getOwnPropertyDescriptor() {
              calls++;
              throw new Error("trap");
            },
          },
        );
      for (const input of [
        accessor,
        proxy,
        { directory: "relative" },
        { directory: "/not/../canonical" },
        { directory: "/workspace", workspaceID: null },
      ])
        yield* expectFailure(service.locationBegin(input));
      assert.equal(calls, 0);
      const value = yield* service.transaction(["a"], (tx) =>
        service.locationSnapshot(tx, "a"),
      );
      assert.equal(value.unknownBuilding, 0);
    }),
  );
});

test("cancelled exclusive metadata waiter releases graph permits and does not leak an unknown build", async () => {
  await run((service) =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make(),
        release = yield* Deferred.make();
      const held = yield* Effect.forkChild(
        holder(service, ["a"], entered, release),
      );
      yield* Deferred.await(entered);
      const queued = yield* Effect.forkChild(
        service.locationBegin({ directory: "/cancelled" }),
      );
      yield* settle;
      yield* Fiber.interrupt(queued);
      yield* service.transaction(["independent"], () => Effect.void);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(held);
      const value = yield* service.transaction(["a"], (tx) =>
        service.locationSnapshot(tx, "a"),
      );
      assert.equal(value.unknownBuilding, 0);
    }),
  );
});

const taskRequest = () => ({
  originKind: "prompt",
  origin: {
    runtimeEpoch: "test_epoch-1",
    operationId: "op:1.0",
    type: "message.send",
    digest: "a".repeat(64),
  },
  workspaceId: "workspace:1",
  appSessionId: "app.session",
  nativeSessionId: "ses_native",
  inputDigest: "b".repeat(64),
});

test("actual acquired Control prepareTask holds without allocating authority", async () => {
  await run((service) =>
    Effect.gen(function* () {
      const before = yield* service.transaction(["a"], (tx) =>
        Effect.all([
          service.inspect(tx, "a"),
          service.locationSnapshot(tx, "a"),
          service.leaseSnapshot(tx, "a"),
        ]),
      );
      assert.equal(typeof service.prepareTask, "function");
      const result = yield* service.prepareTask(taskRequest());
      assert.deepEqual(result, {
        status: "held",
        reason: "inventory_unverified",
      });
      assert.ok(Object.isFrozen(result));
      const after = yield* service.transaction(["a"], (tx) =>
        Effect.all([
          service.inspect(tx, "a"),
          service.locationSnapshot(tx, "a"),
          service.leaseSnapshot(tx, "a"),
        ]),
      );
      assert.deepEqual(after, before);
    }),
  );
});

test("prepare captures entry metadata and observes runtime loss before deferred execution", async () => {
  await run((service) =>
    Effect.gen(function* () {
      const request = taskRequest();
      const pending = service.prepareTask(request);
      request.origin.runtimeEpoch = "foreign";
      request.inputDigest = undefined;
      assert.deepEqual(yield* pending, {
        status: "held",
        reason: "inventory_unverified",
      });
      assert.deepEqual(
        yield* service.prepareTask({
          ...taskRequest(),
          origin: { ...taskRequest().origin, runtimeEpoch: "foreign" },
        }),
        { status: "held", reason: "runtime_unavailable" },
      );
      const late = service.prepareTask(taskRequest());
      yield* service.invalidate("owner_lost");
      assert.deepEqual(yield* late, {
        status: "held",
        reason: "runtime_unavailable",
      });
      assert.deepEqual(yield* service.prepareTask(taskRequest()), {
        status: "held",
        reason: "runtime_unavailable",
      });
      yield* expectFailure(
        service.prepareTask({ ...taskRequest(), rawText: "forbidden" }),
        "native_permission_input",
      );
      yield* expectFailure(
        service.prepareTask({ ...taskRequest(), inputDigest: undefined }),
        "native_permission_input",
      );
      assert.equal((yield* snapshot(service)).generation, 0);
      assert.deepEqual(
        yield* service.transaction(["a"], (tx) =>
          service.locationSnapshot(tx, "a"),
        ),
        { generation: 1, unknownBuilding: 0, incomplete: false, locations: [] },
      );
    }),
  );
});

test("trusted configured callback runs only at acquisition and receives the actual shared Service", async () => {
  const observed = [];
  const layer = control.configured(options(), (service) => {
    observed.push(service);
  });
  assert.equal(observed.length, 0);
  await run(
    (service) =>
      Effect.gen(function* () {
        assert.deepEqual(observed, [service]);
        assert.equal(service, yield* control.Service);
        yield* service.prepareTask(taskRequest());
        assert.equal(observed.length, 1);
      }),
    layer,
  );
  assert.throws(
    () => control.configured({ ...options(), onAcquire() {} }),
    /native_permission_input/,
  );
  for (const callback of [null, {}, true, "callback"])
    assert.throws(
      () => control.configured(options(), callback),
      /native_permission_input/,
    );
});

test("real Control owns inventory counters and refuses caller completeness and old registration closures", async () => {
  await run((service) =>
    Effect.gen(function* () {
      const handle = yield* service.locationBegin({ directory: "/inventory" });
      yield* service.locationBind(handle, {
        directory: "/inventory",
        project: { id: "inventory-project" },
      });
      yield* service.locationReady(handle);
      const read = () =>
        service.transaction(["inventory-project"], (tx) =>
          service.inventorySnapshot(tx, "inventory-project"),
        );
      const before = yield* read();
      assert.equal(before.complete, false);
      assert.equal(before.generation, 0);
      const token = yield* service.inventoryBegin(handle, "hook");
      yield* service.inventoryRegistered(token);
      const after = yield* read();
      assert.ok(after.generation > before.generation);
      assert.equal(after.complete, false);
      assert.equal(after.locations[0].registrations[0].state, "registered");
      yield* expectFailure(
        service.inventoryGuard(token),
        "inventory_unverified",
      );
      yield* service.inventoryEnd(token, "disposed");
      const disposed = yield* read();
      assert.ok(disposed.generation > after.generation);
      yield* expectFailure(
        service.transaction(["inventory-project"], (tx) =>
          service.inventoryLookup(
            tx,
            "inventory-project",
            { ...disposed, complete: true },
            "read",
          ),
        ),
        "inventory_unverified",
      );
      yield* expectFailure(
        service.transaction(["inventory-project"], (tx) =>
          service.inventoryLookup(tx, "inventory-project", after, "read"),
        ),
        "inventory_unverified",
      );
      yield* expectFailure(
        service.transaction(["inventory-project"], (tx) =>
          service.assertExecution(tx, "inventory-project"),
        ),
        "held",
      );
    }),
  );
});

test("location root pins actual directory before services and closes only at observed scope exit", async (t) => {
  const fs = await import("node:fs/promises");
  const directory = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "omoc-location-root-")),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await run((service) =>
    Effect.gen(function* () {
      const handle = yield* service.locationBegin({ directory });
      yield* service.locationRootAcquire(handle);
      yield* expectFailure(
        service.locationRootAcquire(handle),
        "root_unverified",
      );
      yield* service.locationBind(handle, { directory, project: { id: "p1" } });
      yield* service.locationReady(handle);
      yield* service.transaction(["p1"], (tx) =>
        Effect.gen(function* () {
          assert.equal(
            yield* service.locationRootCheck(tx, "p1", handle),
            true,
          );
          yield* expectFailure(service.assertExecution(tx, "p1"), "held");
          yield* expectFailure(
            service.locationRootCheck(tx, "p1", {}),
            "location",
          );
        }),
      );
      yield* service.locationFinalizing(handle);
      yield* service.transaction(["p1"], (tx) =>
        expectFailure(
          service.locationRootCheck(tx, "p1", handle),
          "root_unverified",
        ),
      );
      yield* service.locationScopeObserved(handle);
      yield* service.locationScopeObserved(handle);
    }),
  );
});

test("location root replacement cannot be blessed by a current transaction or rename-back", async (t) => {
  const fs = await import("node:fs/promises");
  const parent = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "omoc-location-replaced-")),
  );
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const directory = join(parent, "root");
  await fs.mkdir(directory);
  await run((service) =>
    Effect.gen(function* () {
      const handle = yield* service.locationBegin({ directory });
      yield* service.locationRootAcquire(handle);
      yield* service.locationBind(handle, { directory, project: { id: "p1" } });
      yield* service.locationReady(handle);
      yield* Effect.promise(async () => {
        await fs.rename(directory, directory + "-old");
        await fs.mkdir(directory);
      });
      yield* service.transaction(["p1"], (tx) =>
        expectFailure(service.locationRootCheck(tx, "p1", handle)),
      );
      yield* Effect.promise(async () => {
        await fs.rmdir(directory);
        await fs.rename(directory + "-old", directory);
      });
      yield* service.transaction(["p1"], (tx) =>
        expectFailure(
          service.locationRootCheck(tx, "p1", handle),
          "root_unverified",
        ),
      );
      yield* service.locationScopeObserved(handle);
    }),
  );
});

test("location root capture refuses missing roots and cannot turn failure into a ready pin", async () => {
  await run((service) =>
    Effect.gen(function* () {
      const handle = yield* service.locationBegin({
        directory: join(namespace, "missing-root"),
      });
      yield* expectFailure(service.locationRootAcquire(handle));
      yield* service.locationBind(handle, {
        directory: join(namespace, "missing-root"),
        project: { id: "p1" },
      });
      yield* expectFailure(service.locationReady(handle), "root_unverified");
      yield* service.locationScopeObserved(handle);
    }),
  );
});

test("location root changed during Native service construction cannot become ready", async (t) => {
  const fs = await import("node:fs/promises");
  const parent = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "omoc-building-root-")),
  );
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const directory = join(parent, "root");
  await fs.mkdir(directory);
  await run((service) =>
    Effect.gen(function* () {
      const handle = yield* service.locationBegin({ directory });
      yield* service.locationRootAcquire(handle);
      yield* service.locationBind(handle, { directory, project: { id: "p1" } });
      yield* Effect.promise(async () => {
        await fs.rename(directory, directory + "-old");
        await fs.mkdir(directory);
      });
      yield* expectFailure(service.locationReady(handle));
      yield* service.transaction(["p1"], (tx) =>
        Effect.gen(function* () {
          const snapshot = yield* service.locationSnapshot(tx, "p1");
          assert.equal(snapshot.incomplete, true);
          assert.equal(snapshot.locations[0].state, "building");
        }),
      );
      yield* service.locationScopeObserved(handle);
    }),
  );
});

test("transaction owner is the actual Fiber object even if a child copies its id", async () => {
  await run((service) =>
    service.transaction(["a"], (tx) =>
      Effect.withFiber((parent) =>
        Effect.gen(function* () {
          const child = yield* Effect.forkChild(
            Effect.withFiber((actual) =>
              Effect.gen(function* () {
                assert.notEqual(actual, parent);
                const original = actual.id;
                actual.id = parent.id;
                try {
                  yield* expectFailure(
                    service.inspect(tx, "a"),
                    "native_permission_transaction",
                  );
                } finally {
                  actual.id = original;
                }
              }),
            ),
          );
          yield* Fiber.join(child);
          assert.equal((yield* service.inspect(tx, "a")).projectId, "a");
        }),
      ),
    ),
  );
});

const bootstrapRequest = (workspacePath) => ({
  originKind: "bootstrap",
  origin: {
    runtimeEpoch: "test_epoch-1",
    operationId: "bootstrap-op",
    type: "session.create",
    digest: "a".repeat(64),
  },
  workspaceId: "workspace-1",
  workspacePath,
  appSessionId: "app-session",
  plannedNativeSessionId: "ses_planned",
  metadataDigest: "b".repeat(64),
  reservation: {
    kind: "bootstrap",
    step: "native.create",
    reservationDigest: "c".repeat(64),
    parentIdentityDigest: null,
  },
});

test("bootstrap preparation observes actual candidate and closes retained root before prepared reply", async () => {
  const fs = await import("node:fs/promises");
  const { syncBuiltinESMExports } = await import("node:module");
  const base = await realpath(
    await mkdtemp(join(tmpdir(), "omoc-control-bootstrap-")),
  );
  const directory = join(base, "root");
  await mkdir(directory);
  const original = fs.default.open;
  const handles = [];
  fs.default.open = async (...args) => {
    const handle = await original(...args);
    handles.push(handle);
    return handle;
  };
  syncBuiltinESMExports();
  try {
    await run((service) =>
      Effect.gen(function* () {
        const before = yield* snapshot(service);
        const prepared = yield* service.prepareTask(
          bootstrapRequest(directory),
        );
        // Prepared identity candidates only: no lease, location, mode or
        // inventory activity is created, and the root pin is already closed.
        assert.equal(prepared.status, "prepared");
        assert.equal(
          prepared.projectId,
          createHash("sha1").update(`directory:${directory}`).digest("hex"),
        );
        assert.equal(prepared.modeGeneration, 1);
        assert.equal(prepared.inventoryGeneration, 1);
        assert.deepEqual(Object.keys(prepared).sort(), [
          "inventoryGeneration",
          "launchId",
          "locationId",
          "modeGeneration",
          "projectId",
          "status",
          "taskScopeId",
        ]);
        assert.ok(Object.isFrozen(prepared));
        assert.equal(handles.length, 1);
        assert.equal(handles[0].fd, -1);
        assert.deepEqual(yield* snapshot(service), before);
      }),
    );
  } finally {
    fs.default.open = original;
    syncBuiltinESMExports();
    await rm(base, { recursive: true, force: true });
  }
});

test("runtime close waits for original bootstrap open and descriptor close, with no new preparation IO", async () => {
  const fs = await import("node:fs/promises");
  const { syncBuiltinESMExports } = await import("node:module");
  const base = await realpath(
    await mkdtemp(join(tmpdir(), "omoc-bootstrap-close-")),
  );
  const directory = join(base, "root");
  await mkdir(directory);
  const original = fs.default.open;
  let releaseOpen,
    markOpened,
    handle,
    opens = 0;
  const opened = new Promise((resolve) => {
    markOpened = resolve;
  });
  const paused = new Promise((resolve) => {
    releaseOpen = resolve;
  });
  fs.default.open = async (...args) => {
    opens++;
    handle = await original(...args);
    markOpened();
    await paused;
    return handle;
  };
  syncBuiltinESMExports();
  try {
    await run((service) =>
      Effect.gen(function* () {
        const preparing = yield* Effect.forkChild(
          service.prepareTask(bootstrapRequest(directory)),
        );
        yield* Effect.promise(() => opened);
        let closed = false;
        const closing = yield* Effect.forkChild(
          Effect.tap(service.closeRoots(), () =>
            Effect.sync(() => {
              closed = true;
            }),
          ),
        );
        yield* settle;
        assert.equal(closed, false);
        assert.ok(handle.fd >= 0);
        assert.deepEqual(
          yield* service.prepareTask(bootstrapRequest(directory)),
          { status: "held", reason: "runtime_unavailable" },
        );
        assert.equal(opens, 1);
        releaseOpen();
        assert.deepEqual(yield* Fiber.join(preparing), {
          status: "held",
          reason: "runtime_unavailable",
        });
        yield* Fiber.join(closing);
        assert.equal(closed, true);
        assert.equal(handle.fd, -1);
      }),
    );
  } finally {
    releaseOpen();
    fs.default.open = original;
    syncBuiltinESMExports();
    await rm(base, { recursive: true, force: true });
  }
});

test("bootstrap candidate rejection closes original root without inventing location or poisoning clean runtime", async () => {
  const fs = await import("node:fs/promises");
  const base = await realpath(
    await mkdtemp(join(tmpdir(), "omoc-bootstrap-marker-")),
  );
  const real = join(base, "root");
  await mkdir(real);
  // A non-canonical (aliased) workspace path is unverifiable and refused.
  const directory = join(base, "alias");
  await fs.symlink(real, directory);
  try {
    await run((service) =>
      Effect.gen(function* () {
        assert.deepEqual(
          yield* service.prepareTask(bootstrapRequest(directory)),
          { status: "held", reason: "runtime_unavailable" },
        );
        assert.deepEqual(yield* service.prepareTask(taskRequest()), {
          status: "held",
          reason: "inventory_unverified",
        });
        assert.equal((yield* snapshot(service)).generation, 0);
        assert.deepEqual(
          yield* service.transaction(["a"], (tx) =>
            service.locationSnapshot(tx, "a"),
          ),
          {
            generation: 1,
            unknownBuilding: 0,
            incomplete: false,
            locations: [],
          },
        );
      }),
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

// ---- Bootstrap handoff arm/consume (real Control, real bootstrap workspace) ----
const bootstrapDigest = await import(
  "./native-permission-bootstrap-digest.mjs"
);
const BASELINE = () => [
  { action: "*", resource: "*", effect: "ask" },
  { action: "external_directory", resource: "*", effect: "deny" },
];
const createInput = (directory, over = {}) => ({
  id: "ses_planned",
  metadata: { operationId: "bootstrap-op", digest: "a".repeat(64) },
  title: "Workbench",
  location: { directory },
  permissions: BASELINE(),
  ...over,
});
const parentIdentity = (directory) => ({
  id: "ses_parent",
  projectID: "parent-project",
  directory,
});
async function bootstrapFixture(body, step = "native.create") {
  const base = await realpath(
    await mkdtemp(join(tmpdir(), "omoc-bootstrap-handoff-")),
  );
  const directory = join(base, "root");
  await mkdir(directory);
  try {
    await run((service) =>
      Effect.gen(function* () {
        const create = step === "native.create";
        const input = create
          ? createInput(directory)
          : { sessionID: "ses_parent" };
        const stageArgumentDigest = bootstrapDigest.bootstrapStageDigest(
          step,
          input,
        );
        const request = {
          ...bootstrapRequest(directory),
          metadataDigest: bootstrapDigest.bootstrapMetadataDigest(
            createInput(directory).metadata,
          ),
          reservation: {
            kind: "bootstrap",
            step,
            reservationDigest: "c".repeat(64),
            parentIdentityDigest: create
              ? null
              : bootstrapDigest.bootstrapParentDigest(
                  parentIdentity(directory),
                ),
          },
          ...(create
            ? {}
            : {
                origin: {
                  ...bootstrapRequest(directory).origin,
                  type: "session.fork",
                },
              }),
        };
        if (!create) {
          delete request.plannedNativeSessionId;
          request.parentNativeSessionId = "ses_parent";
        }
        const prepared = yield* service.prepareTask(request);
        assert.equal(prepared.status, "prepared");
        const handoffId = "5f1c2a40-1b7e-4c1a-8d33-0f5e5b9d3a11";
        const row = (over = {}) => ({
          handoffId,
          taskScopeId: prepared.taskScopeId,
          originalKey: {
            runtimeEpoch: request.origin.runtimeEpoch,
            operationId: request.origin.operationId,
          },
          originalDigest: request.origin.digest,
          step,
          stageArgumentDigest,
          targetIdentity: {
            taskScopeId: prepared.taskScopeId,
            origin: request.origin,
            workspaceId: request.workspaceId,
            projectId: prepared.projectId,
            locationId: prepared.locationId,
            modeGeneration: prepared.modeGeneration,
            inventoryGeneration: prepared.inventoryGeneration,
            originKind: "bootstrap",
          },
          currentLaunchIdentity: prepared.launchId,
          ...over,
        });
        yield* body({
          service,
          directory,
          request,
          prepared,
          row,
          input,
          handoffId,
        });
      }),
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}
const forkConsume = (service, parent, input) =>
  service.transaction([parent.projectID], (tx) =>
    service.enterBootstrap(tx, parent, input),
  );

test("bootstrap create consumes exactly once for the exact armed input and never admits execution", async () => {
  await bootstrapFixture(({ service, directory, row, input }) =>
    Effect.gen(function* () {
      // Nothing armed: every consume is refused, including the exact input.
      yield* expectFailure(service.consumeBootstrap(input), "held");
      yield* service.armBootstrap(row());
      for (const changed of [
        createInput(directory, { id: "ses_other" }),
        createInput(directory, { title: "Other" }),
        createInput(directory, {
          location: { directory: join(directory, "x") },
        }),
        createInput(directory, {
          metadata: { operationId: "other", digest: "a".repeat(64) },
        }),
        createInput(directory, { permissions: [] }),
        createInput(directory, {
          permissions: [
            ...BASELINE(),
            { action: "subagent", resource: "*", effect: "deny" },
          ],
        }),
        createInput(directory, { permissions: BASELINE().reverse() }),
        { ...createInput(directory), parentID: "ses_parent" },
        { ...createInput(directory), agent: "build" },
        { sessionID: "ses_parent" },
        {},
        null,
      ])
        yield* expectFailure(service.consumeBootstrap(changed));
      // The handoff survives wrong callers (they never matched its digest).
      yield* service.consumeBootstrap(input);
      // Double consume, replayed arm and direct probes find nothing armed.
      yield* expectFailure(service.consumeBootstrap(input));
      yield* expectFailure(service.armBootstrap(row()));
      yield* expectFailure(service.revokeBootstrap(row().handoffId));
      // Consume is not execution: the held assertion is unchanged.
      yield* expectFailure(
        service.transaction(["parent-project"], (tx) =>
          service.assertExecution(tx, "parent-project"),
        ),
        "held",
      );
    }),
  );
});

test("bootstrap arm binds every prepared field, launch and exactly one handoff at a time", async () => {
  await bootstrapFixture(({ service, request, prepared, row }) =>
    Effect.gen(function* () {
      const forged = [
        { taskScopeId: "6f1c2a40-1b7e-4c1a-8d33-0f5e5b9d3a12" },
        { originalDigest: "e".repeat(64) },
        {
          originalKey: {
            runtimeEpoch: request.origin.runtimeEpoch,
            operationId: "other",
          },
        },
        { currentLaunchIdentity: "forged-launch" },
        { step: "native.fork" },
        {
          targetIdentity: {
            ...row().targetIdentity,
            projectId: "forged-project",
          },
        },
        {
          targetIdentity: {
            ...row().targetIdentity,
            locationId: "7f1c2a40-1b7e-4c1a-8d33-0f5e5b9d3a13",
          },
        },
        {
          targetIdentity: {
            ...row().targetIdentity,
            modeGeneration: prepared.modeGeneration + 1,
          },
        },
        {
          targetIdentity: {
            ...row().targetIdentity,
            inventoryGeneration: prepared.inventoryGeneration + 1,
          },
        },
        { targetIdentity: { ...row().targetIdentity, workspaceId: "forged" } },
        { expiresAt: 1 },
      ];
      for (const over of forged)
        yield* expectFailure(service.armBootstrap(row(over)));
      yield* service.armBootstrap(row());
      // A second handoff cannot be armed while one is armed.
      yield* expectFailure(
        service.armBootstrap(
          row({ handoffId: "8f1c2a40-1b7e-4c1a-8d33-0f5e5b9d3a14" }),
        ),
      );
    }),
  );
});

test("bootstrap handoff expires on the child clock, after revoke and after runtime invalidation", async () => {
  const { mock } = await import("node:test");
  let now = 1000;
  await bootstrapFixture(({ service, row, input, handoffId }) =>
    Effect.gen(function* () {
      const clock = mock.method(performance, "now", () => now);
      try {
        yield* service.armBootstrap(row());
        now += 4001;
        yield* expectFailure(service.consumeBootstrap(input));
        // Expired is unusable and unreplayable; revoke still resolves cleanly.
        yield* expectFailure(service.armBootstrap(row()));
        yield* service.revokeBootstrap(handoffId);
        yield* service.revokeBootstrap(handoffId);
      } finally {
        clock.mock.restore();
      }
    }),
  );
  now = 1000;
  await bootstrapFixture(({ service, row, input, handoffId }) =>
    Effect.gen(function* () {
      yield* service.armBootstrap(row());
      yield* service.revokeBootstrap(handoffId);
      yield* expectFailure(service.consumeBootstrap(input));
      yield* expectFailure(service.armBootstrap(row()));
    }),
  );
  await bootstrapFixture(({ service, row, input }) =>
    Effect.gen(function* () {
      yield* service.armBootstrap(row());
      yield* service.invalidate("owner_lost");
      yield* expectFailure(service.consumeBootstrap(input));
    }),
  );
});

test("an expired armed handoff does not block arming the next prepared task", async () => {
  const { mock } = await import("node:test");
  let now = 1000;
  await bootstrapFixture(({ service, request, directory, row }) =>
    Effect.gen(function* () {
      const clock = mock.method(performance, "now", () => now);
      try {
        yield* service.armBootstrap(row());
        const second = yield* service.prepareTask({
          ...request,
          origin: { ...request.origin, operationId: "second-op" },
          workspacePath: directory,
        });
        assert.equal(second.status, "prepared");
        const next = {
          ...row(),
          handoffId: "6a2d3b51-2c8f-4d2b-9e44-1a6f6c0e4b22",
          taskScopeId: second.taskScopeId,
          originalKey: {
            runtimeEpoch: request.origin.runtimeEpoch,
            operationId: "second-op",
          },
          targetIdentity: {
            ...row().targetIdentity,
            taskScopeId: second.taskScopeId,
            origin: { ...request.origin, operationId: "second-op" },
            locationId: second.locationId,
            modeGeneration: second.modeGeneration,
            inventoryGeneration: second.inventoryGeneration,
          },
          currentLaunchIdentity: second.launchId,
        };
        // Still within the first handoff's lifetime: the single slot is taken.
        yield* expectFailure(service.armBootstrap(next));
        now += 4001;
        yield* service.armBootstrap(next);
      } finally {
        clock.mock.restore();
      }
    }),
  );
});

test("bootstrap preparation is never re-issued for an original operation key", async () => {
  await bootstrapFixture(({ service, request, directory }) =>
    Effect.gen(function* () {
      assert.deepEqual(yield* service.prepareTask(request), {
        status: "held",
        reason: "runtime_unavailable",
      });
      assert.deepEqual(
        yield* service
          .prepareTask({
            ...request,
            origin: { ...request.origin, operationId: "different-op" },
            workspacePath: directory,
          })
          .pipe(Effect.map((result) => result.status)),
        "prepared",
      );
    }),
  );
});

test("bootstrap fork consumes under the parent's own transaction with exact parent identity", async () => {
  await bootstrapFixture(
    ({ service, directory, row, input }) =>
      Effect.gen(function* () {
        const parent = parentIdentity(directory);
        // Outside a transaction capability, or before arming, nothing is consumed.
        yield* expectFailure(
          service.enterBootstrap({}, parent, input),
          "transaction",
        );
        yield* expectFailure(forkConsume(service, parent, input), "held");
        yield* service.armBootstrap(row());
        for (const [identity, changed] of [
          [{ ...parent, id: "ses_other" }, { sessionID: "ses_other" }],
          [{ ...parent, projectID: "other-project" }, input],
          [{ ...parent, directory: join(directory, "x") }, input],
          [parent, { sessionID: "ses_other" }],
          [parent, { sessionID: "ses_parent", before: "msg_1" }],
          [parent, { sessionID: "ses_parent", extra: true }],
        ])
          yield* expectFailure(forkConsume(service, identity, changed));
        yield* forkConsume(service, parent, input);
        yield* expectFailure(forkConsume(service, parent, input));
        // Create input never satisfies a fork handoff and vice versa.
        yield* expectFailure(
          service.consumeBootstrap(createInput(directory)),
          "held",
        );
      }),
    "native.fork",
  );
});

test("location project candidate API exists on the actual acquired Control", async () => {
  await run((service) =>
    Effect.sync(() => {
      assert.equal(typeof service.locationProjectCandidate, "function");
    }),
  );
});

// These hooks observe real Node handles; neither factory nor Effect is mocked.
async function candidateFixture(body) {
  const fs = await import("node:fs/promises");
  const { syncBuiltinESMExports } = await import("node:module");
  const base = await realpath(
    await mkdtemp(join(tmpdir(), "omoc-location-candidate-")),
  );
  const directory = join(base, "root");
  await mkdir(directory);
  const original = fs.default.open;
  const handles = [];
  fs.default.open = async (...args) => {
    const handle = await original(...args);
    handles.push(handle);
    return handle;
  };
  syncBuiltinESMExports();
  try {
    await body({ fs, base, directory, handles, syncBuiltinESMExports });
  } finally {
    fs.default.open = original;
    syncBuiltinESMExports();
    await Promise.allSettled(
      handles
        .filter((handle) => handle.fd >= 0)
        .map((handle) => handle.close()),
    );
    await rm(base, { recursive: true, force: true });
  }
}

test("location candidate retains real pins, returns detached NONVCS metadata and preserves holds", async () => {
  await candidateFixture(async ({ directory, handles }) => {
    const { createHash } = await import("node:crypto");
    await run((service) =>
      Effect.gen(function* () {
        const handle = yield* service.locationBegin({ directory });
        yield* expectFailure(
          service.locationProjectCandidate(handle),
          "root_unverified",
        );
        yield* service.locationRootAcquire(handle);
        const before = yield* snapshot(service);
        const candidate = yield* service.locationProjectCandidate(handle);
        assert.deepEqual(candidate, {
          id: createHash("sha1").update(`directory:${directory}`).digest("hex"),
          directory,
          canonical: directory,
          vcs: undefined,
        });
        assert.ok(Object.isFrozen(candidate));
        assert.throws(() => {
          candidate.directory = "/changed";
        }, TypeError);
        assert.equal(handles.length, 2);
        assert.ok(handles.every((handle) => handle.fd >= 0));
        assert.deepEqual(yield* snapshot(service), before);
        yield* expectFailure(
          service.locationProjectCandidate(handle),
          "bootstrap_unverified",
        );
        yield* expectFailure(
          service.locationBind(handle, {
            directory,
            project: { id: "forged" },
          }),
        );
        yield* service.locationBind(handle, { directory, project: candidate });
        yield* service.locationReady(handle);
        yield* service.transaction([candidate.id], (tx) =>
          Effect.gen(function* () {
            assert.equal(
              yield* service.locationRootCheck(tx, candidate.id, handle),
              true,
            );
            yield* expectFailure(
              service.assertExecution(tx, candidate.id),
              "held",
            );
            assert.equal(
              (yield* service.inventorySnapshot(tx, candidate.id)).complete,
              false,
            );
          }),
        );
        yield* service.locationScopeObserved(handle);
        assert.ok(handles.every((handle) => handle.fd === -1));
        yield* service.locationScopeObserved(handle);
        yield* expectFailure(service.locationProjectCandidate(handle));
        assert.equal(candidate.directory, directory);
      }),
    );
    assert.ok(handles.every((handle) => handle.fd === -1));
  });
});

for (const marker of [".git", ".hg"]) {
  for (const level of ["root", "ancestor"]) {
    test(`location candidate accepts actual ${level} ${marker} as plain non-VCS and physically cleans`, async () => {
      await candidateFixture(async ({ fs, directory, base, handles }) => {
        await fs.mkdir(join(level === "root" ? directory : base, marker));
        await run((service) =>
          Effect.gen(function* () {
            const handle = yield* service.locationBegin({ directory });
            yield* service.locationRootAcquire(handle);
            const candidate = yield* service.locationProjectCandidate(handle);
            // Native VCS discovery is never invoked: no VCS identity, and the
            // project id is the plain directory hash.
            assert.equal(candidate.vcs, undefined);
            const { createHash } = yield* Effect.promise(
              () => import("node:crypto"),
            );
            assert.equal(
              candidate.id,
              createHash("sha1").update(`directory:${directory}`).digest("hex"),
            );
            assert.equal(handles.length, 2);
            yield* service.locationScopeObserved(handle);
            assert.ok(handles.every((handle) => handle.fd === -1));
            assert.equal((yield* snapshot(service)).runtimeHeld, false);
          }),
        );
      });
    });
  }
}

for (const phase of ["ready", "check"]) {
  test(`location candidate ${phase} rechecks actual ancestor identity and permanently refuses stale owner`, async () => {
    await candidateFixture(async ({ fs, directory, base }) => {
      await run((service) =>
        Effect.gen(function* () {
          const handle = yield* service.locationBegin({ directory });
          yield* service.locationRootAcquire(handle);
          const candidate = yield* service.locationProjectCandidate(handle);
          yield* service.locationBind(handle, {
            directory,
            project: candidate,
          });
          if (phase === "check") yield* service.locationReady(handle);
          yield* Effect.promise(() => fs.chmod(base, 0o755));
          const check = () =>
            phase === "ready"
              ? service.locationReady(handle)
              : service.transaction([candidate.id], (tx) =>
                  service.locationRootCheck(tx, candidate.id, handle),
                );
          yield* expectFailure(check());
          yield* Effect.promise(() => fs.chmod(base, 0o700));
          yield* expectFailure(check());
          yield* service.locationScopeObserved(handle);
        }),
      );
    });
  });
}

test("location candidate cannot bless replacement of the original pin", async () => {
  await candidateFixture(async ({ fs, directory, handles }) => {
    await run((service) =>
      Effect.gen(function* () {
        const handle = yield* service.locationBegin({ directory });
        yield* service.locationRootAcquire(handle);
        yield* Effect.promise(async () => {
          await fs.rename(directory, directory + ".moved");
          await mkdir(directory);
        });
        yield* expectFailure(service.locationProjectCandidate(handle));
        assert.ok(handles.every((handle) => handle.fd === -1));
        yield* service.locationScopeObserved(handle);
      }),
    );
  });
});

for (const change of ["close", "scope", "finalizing", "invalidate"]) {
  test(`location candidate ${change} during original open prevents result and waits for cleanup`, async () => {
    await candidateFixture(
      async ({ fs, directory, handles, syncBuiltinESMExports }) => {
        let release, opened;
        const paused = new Promise((resolve) => {
          release = resolve;
        });
        const started = new Promise((resolve) => {
          opened = resolve;
        });
        const trackedOpen = fs.default.open;
        fs.default.open = async (...args) => {
          const handle = await trackedOpen(...args);
          if (handles.length === 2) {
            opened();
            await paused;
          }
          return handle;
        };
        syncBuiltinESMExports();
        try {
          await run((service) =>
            Effect.gen(function* () {
              const handle = yield* service.locationBegin({ directory });
              yield* service.locationRootAcquire(handle);
              const acquiring = yield* Effect.forkChild(
                Effect.exit(service.locationProjectCandidate(handle)),
              );
              yield* Effect.promise(() => started);
              let settled = false;
              let closing;
              if (change === "close" || change === "scope") {
                closing = yield* Effect.forkChild(
                  (change === "close"
                    ? service.closeRoots()
                    : service.locationScopeObserved(handle)
                  ).pipe(
                    Effect.tap(() =>
                      Effect.sync(() => {
                        settled = true;
                      }),
                    ),
                  ),
                );
              } else if (change === "finalizing")
                yield* service.locationFinalizing(handle);
              else yield* service.invalidate("test_invalidated");
              yield* settle;
              assert.equal(settled, false);
              assert.ok(handles[1].fd >= 0);
              release();
              assert.ok(Exit.isFailure(yield* Fiber.join(acquiring)));
              if (closing) yield* Fiber.join(closing);
              assert.ok(handles.every((handle) => handle.fd === -1));
            }),
          );
        } finally {
          release();
        }
      },
    );
  });
}

test("location candidate rejects foreign, forged and inherited transaction handles without IO", async () => {
  let foreign;
  await run((service) =>
    Effect.gen(function* () {
      foreign = yield* service.locationBegin({ directory: "/foreign" });
    }),
  );
  await candidateFixture(async ({ directory, handles }) => {
    await run((service) =>
      Effect.gen(function* () {
        const handle = yield* service.locationBegin({ directory });
        let traps = 0;
        const proxy = new Proxy(
          {},
          {
            get() {
              traps++;
            },
            ownKeys() {
              traps++;
            },
          },
        );
        for (const invalid of [foreign, {}, proxy])
          yield* expectFailure(
            service.locationProjectCandidate(invalid),
            "location",
          );
        yield* expectFailure(
          service.transaction(["a"], () =>
            service.locationProjectCandidate(handle),
          ),
          "reentrant",
        );
        assert.equal(handles.length, 0);
        assert.equal(traps, 0);
      }),
    );
  });
});

test("location candidate interruption waits for original acquisition and scope physically closes both pins", async () => {
  await candidateFixture(
    async ({ fs, directory, handles, syncBuiltinESMExports }) => {
      let release, opened;
      const paused = new Promise((resolve) => {
        release = resolve;
      });
      const started = new Promise((resolve) => {
        opened = resolve;
      });
      const trackedOpen = fs.default.open;
      fs.default.open = async (...args) => {
        const handle = await trackedOpen(...args);
        if (handles.length === 2) {
          opened();
          await paused;
        }
        return handle;
      };
      syncBuiltinESMExports();
      try {
        await run((service) =>
          Effect.gen(function* () {
            const handle = yield* service.locationBegin({ directory });
            yield* service.locationRootAcquire(handle);
            const acquiring = yield* Effect.forkChild(
              service.locationProjectCandidate(handle),
            );
            yield* Effect.promise(() => started);
            let interrupted = false;
            const interruption = yield* Effect.forkChild(
              Fiber.interrupt(acquiring).pipe(
                Effect.tap(() =>
                  Effect.sync(() => {
                    interrupted = true;
                  }),
                ),
              ),
            );
            yield* settle;
            assert.equal(interrupted, false);
            assert.ok(handles[1].fd >= 0);
            release();
            yield* Fiber.join(interruption);
            assert.equal(interrupted, true);
            yield* service.locationScopeObserved(handle);
            assert.ok(handles.every((handle) => handle.fd === -1));
          }),
        );
      } finally {
        release();
      }
    },
  );
});

for (const constructionFailure of [false, true]) {
  test(`location candidate physical close failure escapes ${constructionFailure ? "failed construction" : "scope cleanup"} and remains failed on runtime cleanup`, async () => {
    await candidateFixture(
      async ({ fs, directory, handles, syncBuiltinESMExports }) => {
        const trackedOpen = fs.default.open;
        const closeFailure = new Error("actual_candidate_close_failed");
        // Caller flags must not substitute for factory-private cleanup facts.
        closeFailure.closed = true;
        fs.default.open = async (...args) => {
          const handle = await trackedOpen(...args);
          if (handles.length === 2) {
            const close = handle.close.bind(handle);
            handle.close = async () => {
              await close();
              throw closeFailure;
            };
          }
          return handle;
        };
        syncBuiltinESMExports();
        const trackedLstat = fs.default.lstat;
        if (constructionFailure) {
          // Fail the candidate's own post-open observation of the root.
          fs.default.lstat = async (path, ...args) => {
            if (handles.length === 2 && path === directory) {
              fs.default.lstat = trackedLstat;
              syncBuiltinESMExports();
              throw new Error("construction_failed");
            }
            return trackedLstat(path, ...args);
          };
          syncBuiltinESMExports();
        }
        let operationFailed = false,
          cleanupFailed = false;
        await assert.rejects(
          run((service) =>
            Effect.gen(function* () {
              const handle = yield* service.locationBegin({ directory });
              yield* service.locationRootAcquire(handle);
              const acquired = yield* Effect.exit(
                service.locationProjectCandidate(handle),
              );
              operationFailed = Exit.isFailure(acquired);
              if (!constructionFailure) assert.ok(Exit.isSuccess(acquired));
              const closed = yield* Effect.exit(
                service.locationScopeObserved(handle),
              );
              cleanupFailed = Exit.isFailure(closed);
              assert.equal(cleanupFailed, true);
              assert.ok(handles.every((handle) => handle.fd === -1));
            }),
          ),
          /root_close_unverified/,
        );
        assert.equal(operationFailed, constructionFailure);
        assert.equal(cleanupFailed, true);
      },
    );
  });
}

test("Native Read runtime binding is private, single-use and cannot enter consumer/resource factory without current Task authority", () =>
  run((service) =>
    Effect.gen(function* () {
      assert.equal(typeof service.bindNativeReadRuntime, "function");
      assert.equal(typeof service.readNativeFile, "function");
      let consumers = 0,
        factories = 0;
      const binding = {
        read() {
          consumers++;
          return Effect.succeed(undefined);
        },
        effects() {
          factories++;
          throw Error("resource factory must remain held");
        },
        consumerSha256: "a".repeat(64),
        effectsSha256: "b".repeat(64),
      };
      service.bindNativeReadRuntime(binding);
      assert.throws(() => service.bindNativeReadRuntime(binding));
      yield* expectFailure(
        service.readNativeFile({
          kind: "read",
          path: "/synthetic/file.txt",
          resource: "file.txt",
          page: { offset: 0, limit: 2 },
        }),
      );
      yield* expectFailure(
        service.readNativeFile({ kind: "list", path: "/synthetic" }),
      );
      assert.equal(consumers, 0);
      assert.equal(factories, 0);
    }),
  ));
test("Native Read rejects accessor/Proxy/page extras before any caller access or Task dispatch", () =>
  run((service) =>
    Effect.gen(function* () {
      assert.equal(typeof service.readNativeFile, "function");
      let accessed = 0;
      const request = {
        kind: "read",
        path: "/synthetic/file",
        resource: "file",
        page: {},
      };
      Object.defineProperty(request.page, "offset", {
        enumerable: true,
        get() {
          accessed++;
          return 1;
        },
      });
      yield* expectFailure(service.readNativeFile(request));
      yield* expectFailure(
        service.readNativeFile({
          ...request,
          page: new Proxy(
            {},
            {
              ownKeys() {
                accessed++;
                return [];
              },
            },
          ),
        }),
      );
      yield* expectFailure(
        service.readNativeFile({
          ...request,
          page: { offset: 0, extra: true },
        }),
      );
      yield* expectFailure(
        service.readNativeFile({ kind: "list", path: "relative" }),
      );
      yield* expectFailure(
        service.readNativeFile({
          kind: "list",
          path: "/synthetic",
          factory() {
            accessed++;
          },
        }),
      );
      assert.equal(accessed, 0);
    }),
  ));

test("Agent notification capture accepts only one fixed synchronous source and detached listeners", async () => {
  await run((service) =>
    Effect.sync(() => {
      assert.equal(typeof service.bindAgentNotificationSource, "function");
      assert.equal(
        typeof service.captureAgentNotificationListeners,
        "function",
      );
      const listener = () => Effect.void;
      const branded = new WeakSet([listener]);
      const accepts = (value) => branded.has(value);
      assert.throws(() => service.captureAgentNotificationListeners([]));
      for (const invalid of [
        async () => true,
        function* () {},
        new Proxy(accepts, {}),
      ]) {
        assert.throws(() =>
          service.bindAgentNotificationSource({
            accepts: invalid,
            sourceSha256: "a".repeat(64),
          }),
        );
      }
      service.bindAgentNotificationSource({
        accepts,
        sourceSha256: "a".repeat(64),
      });
      assert.throws(() =>
        service.bindAgentNotificationSource({
          accepts,
          sourceSha256: "a".repeat(64),
        }),
      );
      const input = [listener];
      const copy = service.captureAgentNotificationListeners(input);
      assert.ok(Object.isFrozen(copy));
      input.length = 0;
      assert.deepEqual(copy, [listener]);
      for (const value of [
        [() => Effect.void],
        new Array(1),
        Object.assign([listener], { extra: true }),
        new Proxy([listener], {}),
        Array(33).fill(listener),
      ]) {
        assert.throws(() => service.captureAgentNotificationListeners(value));
      }
      let accessorCalls = 0;
      const access = [];
      Object.defineProperty(access, "0", {
        enumerable: true,
        get() {
          accessorCalls++;
          return listener;
        },
      });
      assert.throws(() => service.captureAgentNotificationListeners(access));
      assert.equal(accessorCalls, 0);
    }),
  );
});

test("Agent notification capture rejects non-true source responses and closed Control", async () => {
  for (const response of [1, undefined, Promise.resolve(true)]) {
    await run((service) =>
      Effect.sync(() => {
        service.bindAgentNotificationSource({
          accepts: () => response,
          sourceSha256: "b".repeat(64),
        });
        assert.throws(() =>
          service.captureAgentNotificationListeners([() => Effect.void]),
        );
      }),
    );
  }
  await run((service) =>
    Effect.gen(function* () {
      service.bindAgentNotificationSource({
        accepts: () => true,
        sourceSha256: "c".repeat(64),
      });
      yield* service.closeRoots();
      assert.throws(() => service.captureAgentNotificationListeners([]));
    }),
  );
});

// Closed synthetic source bindings exercise plumbing only. Production Graph
// deliberately does not bind this setup source while startup proof is pending.
const stateInventory = await import(
  pathToFileURL(join(namespace, "native-permission-inventory.mjs")).href
);
const setupFixture = (service, overrides = {}) =>
  Effect.gen(function* () {
    const handle = yield* service.locationBegin({ directory: "/setup" });
    const plugin = {
      id: "opencode.config.worktree",
      effect: () => Effect.void,
    };
    service.inventorySetupSource(plugin, "a".repeat(64));
    yield* service.inventoryPlan(
      handle,
      stateInventory.BUILTIN_PLUGIN_ORDER.pre.map((id) => ({ id })),
      stateInventory.BUILTIN_PLUGIN_ORDER.post.map((id) => ({ id })),
      [{}],
    );
    const descriptor = Object.freeze({ id: plugin.id, effect: plugin.effect });
    yield* service.inventoryToolResolve(handle, plugin, descriptor);
    const token = yield* service.inventoryBegin(handle, "plugin", plugin.id);
    const scope = yield* library.Scope.make();
    yield* service.inventoryToolActivation(token, descriptor, scope);
    let replay;
    let calls = 0;
    let disposed = 0;
    const original = {
      transform(callback, options) {
        assert.equal(this, original);
        assert.equal(options, undefined);
        return Effect.sync(() => {
          calls++;
          replay = callback;
          callback({});
          return {
            dispose: Effect.sync(() => {
              disposed++;
            }),
          };
        });
      },
      ...overrides,
    };
    const domain = service.inventoryStateDomain(handle, "worktree", original);
    const register = (callback = () => {}, options) =>
      stateInventory
        .observeNativeStateRegistration(
          Effect,
          library.Scope,
          service,
          domain,
          callback,
          options,
        )
        .pipe(Effect.provideService(library.Scope.Scope, scope));
    const activate = (body) =>
      service.inventorySetupRun(token, descriptor, scope, () => body);
    const finish = () =>
      Effect.gen(function* () {
        yield* service.inventoryToolResult(
          handle,
          descriptor,
          undefined,
          scope,
        );
        yield* service.inventoryToolDeclaration(token, descriptor, undefined);
        yield* service.inventoryRegistered(token);
      });
    return {
      handle,
      plugin,
      descriptor,
      token,
      scope,
      original,
      domain,
      register,
      activate,
      finish,
      replay: () => replay({}),
      calls: () => calls,
      disposed: () => disposed,
    };
  });

test("direct State API: first replay, successful void and later replay retain original ownership", async () => {
  await run((service) =>
    Effect.gen(function* () {
      const fixture = yield* setupFixture(service);
      let replayed = 0;
      let registration;
      yield* fixture.activate(
        Effect.gen(function* () {
          registration = yield* fixture.register(() => {
            replayed++;
          });
        }),
      );
      yield* fixture.finish();
      fixture.replay();
      assert.equal(replayed, 2);
      assert.equal(fixture.calls(), 1);
      yield* registration.dispose;
      assert.equal(fixture.disposed(), 1);
      assert.throws(fixture.replay, /inventory_unverified/);
      yield* library.Scope.close(fixture.scope, Exit.void);
    }),
  );
});

test("direct State API: missing source still rejects before unknown factory construction", async () => {
  await run((service) =>
    Effect.gen(function* () {
      const handle = yield* service.locationBegin({
        directory: "/unknown-setup",
      });
      yield* service.inventoryPlan(
        handle,
        stateInventory.BUILTIN_PLUGIN_ORDER.pre.map((id) => ({ id })),
        stateInventory.BUILTIN_PLUGIN_ORDER.post.map((id) => ({ id })),
        [{}],
      );
      const descriptor = Object.freeze({
        id: "opencode.config.worktree",
        effect: () => Effect.void,
      });
      const token = yield* service.inventoryBegin(
        handle,
        "plugin",
        descriptor.id,
      );
      const scope = yield* library.Scope.make();
      yield* expectFailure(
        service.inventoryToolActivation(token, descriptor, scope),
        "inventory_unverified",
      );
      yield* library.Scope.close(scope, Exit.void);
    }),
  );
});

for (const variant of [
  "missing",
  "duplicate",
  "nonvoid",
  "wrong-options",
  "wrong-scope",
  "forged-domain",
  "other-location",
  "stale-generation",
]) {
  test(`direct State rejects ${variant} before claiming factory success`, async () => {
    await run((service) =>
      Effect.gen(function* () {
        const fixture = yield* setupFixture(service);
        let result;
        const body = Effect.gen(function* () {
          if (variant === "missing") return;
          if (variant === "wrong-options")
            return yield* fixture.register(() => {}, {});
          if (variant === "wrong-scope") {
            const foreign = yield* library.Scope.make();
            try {
              return yield* stateInventory
                .observeNativeStateRegistration(
                  Effect,
                  library.Scope,
                  service,
                  fixture.domain,
                  () => {},
                  undefined,
                )
                .pipe(Effect.provideService(library.Scope.Scope, foreign));
            } finally {
              yield* library.Scope.close(foreign, Exit.void);
            }
          }
          if (variant === "forged-domain" || variant === "other-location") {
            const foreign =
              variant === "forged-domain"
                ? Object.freeze({})
                : service.inventoryStateDomain(
                    yield* service.locationBegin({ directory: "/other-setup" }),
                    "worktree",
                    fixture.original,
                  );
            return yield* stateInventory
              .observeNativeStateRegistration(
                Effect,
                library.Scope,
                service,
                foreign,
                () => {},
                undefined,
              )
              .pipe(Effect.provideService(library.Scope.Scope, fixture.scope));
          }
          if (variant === "stale-generation") {
            yield* service.inventoryBegin(fixture.handle, "hook");
            return yield* fixture.register();
          }
          result = yield* fixture.register();
          if (variant === "duplicate") yield* fixture.register();
          if (variant === "nonvoid") return {};
        });
        yield* expectFailure(fixture.activate(body), "inventory_unverified");
        yield* expectFailure(fixture.finish(), "inventory_unverified");
        assert.equal(
          fixture.calls(),
          ["duplicate", "nonvoid"].includes(variant) ? 1 : 0,
        );
        if (result) yield* result.dispose;
        yield* library.Scope.close(fixture.scope, Exit.void);
      }),
    );
  });
}

test("direct State refuses inherited sibling Fiber, accepts exact Fiber, refuses late registration", async () => {
  await run((service) =>
    Effect.gen(function* () {
      const fixture = yield* setupFixture(service);
      let registration;
      yield* fixture.activate(
        Effect.gen(function* () {
          const child = yield* Effect.forkChild(fixture.register());
          assert.ok(Exit.isFailure(yield* Fiber.await(child)));
          assert.equal(fixture.calls(), 0);
          registration = yield* fixture.register();
        }),
      );
      yield* fixture.finish();
      yield* expectFailure(fixture.register(), "inventory_unverified");
      assert.equal(fixture.calls(), 1);
      fixture.replay();
      yield* registration.dispose;
      yield* library.Scope.close(fixture.scope, Exit.void);
    }),
  );
});

test("direct State refuses ended activation even when parent Scope remains open", async () => {
  await run((service) =>
    Effect.gen(function* () {
      const fixture = yield* setupFixture(service);
      const entered = yield* Deferred.make();
      const release = yield* Deferred.make();
      const inherited = yield* Deferred.make();
      let registration;
      yield* fixture.activate(
        Effect.gen(function* () {
          yield* Effect.forkIn(
            Effect.gen(function* () {
              yield* Deferred.succeed(entered, undefined);
              yield* Deferred.await(release);
              yield* Deferred.complete(inherited, fixture.register());
            }),
            fixture.scope,
          );
          yield* Deferred.await(entered);
          registration = yield* fixture.register();
        }),
      );
      yield* fixture.finish();
      yield* Deferred.succeed(release, undefined);
      yield* expectFailure(Deferred.await(inherited), "inventory_unverified");
      assert.equal(fixture.calls(), 1);
      yield* registration.dispose;
      yield* library.Scope.close(fixture.scope, Exit.void);
    }),
  );
});

test("direct State rejects copied and transplanted producer descriptors without entering run thunk", async () => {
  await run((service) =>
    Effect.gen(function* () {
      const fixture = yield* setupFixture(service);
      assert.ok(Object.isFrozen(fixture.plugin));
      for (const plugin of [
        Object.freeze({ ...fixture.plugin }),
        Object.freeze({
          id: fixture.plugin.id,
          effect: fixture.plugin.effect,
        }),
      ]) {
        yield* expectFailure(
          service.inventoryToolResolve(
            fixture.handle,
            plugin,
            fixture.descriptor,
          ),
          "inventory_unverified",
        );
      }
      let entered = 0;
      const forged = Object.freeze({ ...fixture.descriptor });
      yield* expectFailure(
        service.inventorySetupRun(fixture.token, forged, fixture.scope, () => {
          entered++;
          return Effect.void;
        }),
        "inventory_unverified",
      );
      assert.equal(entered, 0);
      yield* library.Scope.close(fixture.scope, Exit.void);
    }),
  );
});

test("direct State source binding rejects accessors, proxies and other setup IDs without traps", async () => {
  await run((service) =>
    Effect.sync(() => {
      let traps = 0;
      const proxy = new Proxy(
        {},
        {
          ownKeys() {
            traps++;
            return [];
          },
        },
      );
      const getter = {
        id: "opencode.config.worktree",
        get effect() {
          traps++;
          return () => Effect.void;
        },
      };
      for (const plugin of [
        proxy,
        getter,
        { id: "opencode.config.mcp", effect: () => Effect.void },
      ])
        assert.throws(() =>
          service.inventorySetupSource(plugin, "a".repeat(64)),
        );
      assert.equal(traps, 0);
    }),
  );
});

test("direct State rejects foreign Control domain handles before original registration", async () => {
  let domain;
  await run((service) =>
    Effect.gen(function* () {
      const fixture = yield* setupFixture(service);
      domain = fixture.domain;
      yield* library.Scope.close(fixture.scope, Exit.void);
    }),
  );
  await run((service) =>
    Effect.gen(function* () {
      const fixture = yield* setupFixture(service);
      yield* expectFailure(
        fixture.activate(
          stateInventory
            .observeNativeStateRegistration(
              Effect,
              library.Scope,
              service,
              domain,
              () => {},
              undefined,
            )
            .pipe(Effect.provideService(library.Scope.Scope, fixture.scope)),
        ),
        "inventory_unverified",
      );
      assert.equal(fixture.calls(), 0);
      yield* library.Scope.close(fixture.scope, Exit.void);
    }),
  );
});

test("direct State Scope Closed replay rejects before original disposal finalizer", async () => {
  await run((service) =>
    Effect.gen(function* () {
      const fixture = yield* setupFixture(service);
      let replayed = 0;
      yield* fixture.activate(
        Effect.gen(function* () {
          yield* fixture.register(() => {
            replayed++;
          });
        }),
      );
      yield* fixture.finish();
      yield* library.Scope.addFinalizer(
        fixture.scope,
        Effect.sync(() => {
          assert.equal(fixture.disposed(), 0);
          assert.throws(fixture.replay, /inventory_unverified/);
          assert.equal(replayed, 1);
        }),
      );
      yield* library.Scope.close(fixture.scope, Exit.void);
      assert.equal(fixture.disposed(), 1);
      assert.throws(fixture.replay, /inventory_unverified/);
    }),
  );
});

for (const phase of ["first-replay", "after-original-return"]) {
  test(`direct State rolls back original registration when Scope closes ${phase}`, async () => {
    await run((service) =>
      Effect.gen(function* () {
        let fixture;
        let replayed = 0;
        let disposed = 0;
        fixture = yield* setupFixture(service, {
          transform(callback) {
            return Effect.gen(function* () {
              if (phase === "first-replay") {
                yield* library.Scope.close(fixture.scope, Exit.void);
                callback({});
              } else {
                callback({});
                yield* library.Scope.close(fixture.scope, Exit.void);
              }
              return {
                dispose: Effect.sync(() => {
                  disposed++;
                }),
              };
            });
          },
        });
        const exit = yield* Effect.exit(
          fixture.activate(
            fixture
              .register(() => {
                replayed++;
              })
              .pipe(Effect.asVoid),
          ),
        );
        assert.ok(Exit.isFailure(exit));
        assert.equal(replayed, phase === "first-replay" ? 0 : 1);
        // Before a dispose is returned the original activation Scope owns cleanup.
        assert.equal(disposed, phase === "first-replay" ? 0 : 1);
      }),
    );
  });
}

test("direct State cleanup settles both Exits and joins repeated disposal", async () => {
  await run((service) =>
    Effect.gen(function* () {
      const fixture = yield* setupFixture(service);
      let nativeDisposed = 0;
      fixture.original.transform = () =>
        Effect.succeed({
          dispose: Effect.sync(() => {
            nativeDisposed++;
          }),
        });
      // Bound original function identity is immutable even if service fields mutate.
      let registration;
      yield* fixture.activate(
        Effect.gen(function* () {
          registration = yield* fixture.register();
        }),
      );
      yield* fixture.finish();
      yield* registration.dispose;
      yield* registration.dispose;
      yield* library.Scope.close(fixture.scope, Exit.void);
      assert.equal(nativeDisposed, 0);
      assert.equal(fixture.disposed(), 1);
    }),
  );
});

for (const failure of ["control", "native", "both"]) {
  test(`direct State original cleanup still runs after ${failure} cleanup failure`, async () => {
    await run((service) =>
      Effect.gen(function* () {
        let disposed = 0;
        let replay;
        const fixture = yield* setupFixture(service, {
          transform(callback) {
            return Effect.sync(() => {
              replay = callback;
              callback({});
              return {
                dispose: Effect.gen(function* () {
                  disposed++;
                  if (failure !== "control")
                    return yield* Effect.fail(new Error("native_cleanup"));
                }),
              };
            });
          },
        });
        const decoratedControl = {
          ...service,
          inventoryEnd:
            failure === "native"
              ? service.inventoryEnd
              : () => Effect.fail(new Error("control_cleanup")),
        };
        let registration;
        yield* fixture.activate(
          Effect.gen(function* () {
            registration = yield* stateInventory
              .observeNativeStateRegistration(
                Effect,
                library.Scope,
                decoratedControl,
                fixture.domain,
                () => {},
                undefined,
              )
              .pipe(Effect.provideService(library.Scope.Scope, fixture.scope));
          }),
        );
        yield* fixture.finish();
        const exit = yield* Effect.exit(registration.dispose);
        assert.ok(Exit.isFailure(exit));
        assert.equal(disposed, 1);
        const messages = exit.cause.reasons.map(
          (reason) => reason.error?.message,
        );
        if (failure !== "native")
          assert.ok(messages.includes("control_cleanup"));
        if (failure !== "control")
          assert.ok(messages.includes("native_cleanup"));
        yield* expectFailure(registration.dispose);
        assert.equal(disposed, 1);
        assert.throws(() => replay({}), /inventory_unverified/);
        assert.equal((yield* snapshot(service)).runtimeHeld, true);
        yield* expectFailure(library.Scope.close(fixture.scope, Exit.void));
        assert.equal(disposed, 1);
      }),
    );
  });
}

test("diagnostics sink observes reject sites and the first hold step without changing behavior", async () => {
  const rows = [];
  await run(
    (service) =>
      Effect.gen(function* () {
        const handle = yield* service.locationBegin({ directory: "/diag" });
        yield* expectFailure(
          service.locationProjectCandidate(handle),
          "root_unverified",
        );
        yield* service.invalidate("first_reason");
        yield* service.invalidate("second_reason");
      }),
    control.configured(options(), (service) =>
      service.bindDiagnostic((row) => rows.push(row)),
    ),
  );
  const rejection = rows.find((row) => row.code === "root_unverified");
  assert.equal(rejection.kind, "reject");
  assert.equal(rejection.runtimeHeld, false);
  assert.equal(rejection.inventoryFailed, false);
  assert.match(rejection.step, /^[^@\s]+@native-permission-control\.mjs:\d+$/u);
  const holds = rows.filter((row) => row.kind === "hold");
  assert.deepEqual(
    holds.map((row) => [row.step, row.heldBy, row.runtimeHeld]),
    [
      ["invalidate:first_reason", "invalidate:first_reason", true],
      ["invalidate:second_reason", "invalidate:first_reason", true],
      // Layer release also holds; the first step stays the recorded cause.
      ["close_roots", "invalidate:first_reason", true],
    ],
  );
  // A throwing sink never alters control flow.
  await run(
    (service) =>
      Effect.gen(function* () {
        const handle = yield* service.locationBegin({ directory: "/diag" });
        yield* expectFailure(
          service.locationProjectCandidate(handle),
          "root_unverified",
        );
      }),
    control.configured(options(), (service) =>
      service.bindDiagnostic(() => {
        throw new Error("sink");
      }),
    ),
  );
  await run((service) =>
    Effect.sync(() =>
      assert.throws(() => service.bindDiagnostic("not a function")),
    ),
  );
});

test("diagnostics sinks are per kernel: one kernel's sink never sees another's rejects", async () => {
  const first = [],
    second = [];
  const reject = (service) =>
    Effect.gen(function* () {
      const handle = yield* service.locationBegin({ directory: "/diag" });
      yield* expectFailure(
        service.locationProjectCandidate(handle),
        "root_unverified",
      );
    });
  await run(
    reject,
    control.configured(options(), (service) =>
      service.bindDiagnostic((row) => first.push(row)),
    ),
  );
  assert.ok(first.some((row) => row.code === "root_unverified"));
  // A later kernel with no sink: nothing leaks into the earlier sink.
  const before = first.length;
  await run(
    reject,
    control.configured(options(), () => {}),
  );
  await run(
    reject,
    control.configured(options(), (service) =>
      service.bindDiagnostic((row) => second.push(row)),
    ),
  );
  assert.equal(first.length, before);
  assert.ok(second.some((row) => row.code === "root_unverified"));
});
