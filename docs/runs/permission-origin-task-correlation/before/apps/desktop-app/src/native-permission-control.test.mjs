import assert from "node:assert/strict";
import { after, test } from "node:test";
import { copyFile, mkdtemp, rm, symlink } from "node:fs/promises";
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
  await copyFile(
    new URL("./native-permission-control-input.mjs", import.meta.url),
    join(namespace, "native-permission-control-input.mjs"),
  );
  await copyFile(
    new URL("./native-permission-control.mjs", import.meta.url),
    join(namespace, "control.mjs"),
  );
  for (const name of [
    "native-permission-leases.mjs",
    "native-permission-task-observer.mjs",
  ]) {
    await copyFile(
      new URL(`./${name}`, import.meta.url),
      join(namespace, name),
    );
  }
  control = await import(pathToFileURL(join(namespace, "control.mjs")).href);
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
  await run((service) =>
    service.transaction(["a"], (tx) =>
      Effect.gen(function* () {
        const identity = {
          originalOperationKey: "old_epoch:operation",
          projectId: "a",
          locationIncarnation: "location",
          sessionId: "session",
          kind: "coordinator",
          modeGeneration: 1,
          inventoryGeneration: 1,
          parentLeaseId: null,
        };
        yield* expectFailure(service.admitLease(tx, identity), "held");
        assert.deepEqual(yield* service.leaseSnapshot(tx, "a"), []);
        yield* service.invalidate("unverified");
        yield* expectFailure(service.admitLease(tx, identity), "held");
        assert.deepEqual(yield* service.leaseSnapshot(tx, "a"), []);
      }),
    ),
  );
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
