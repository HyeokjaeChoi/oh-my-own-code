// Production (non-strict) behaviour: OpenCode's own permission rules are the
// safety layer, so Control's execution/inventory checks never hold or fail it.
import { copyPermissionControlSources } from "../scripts/native-permission-test-fixture.mjs";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

delete process.env.OMOC_PERMISSION_PROOF_STRICT;
const namespace = await mkdtemp(join(tmpdir(), "omoc-permission-plain-test-"));
let control;
let library;
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
} catch (error) {
  await rm(namespace, { recursive: true, force: true });
  throw error;
}
after(() => rm(namespace, { recursive: true, force: true }));
const { Effect, Exit } = library;
const run = (body, diagnostics) =>
  Effect.runPromise(
    Effect.provide(
      Effect.gen(function* () {
        const service = yield* control.Service;
        if (diagnostics) service.bindDiagnostic(diagnostics);
        yield* body(service);
      }),
      control.configured({ runtimeEpoch: "test_epoch-1", bootHolds: [] }),
    ).pipe(Effect.timeout("5 seconds")),
  );

test("assertExecution admits an inspected project transaction", () =>
  run((service) =>
    service.transaction(["a"], (tx) => service.assertExecution(tx, "a")),
  ));

test("assertExecution still requires a live transaction", () =>
  run((service) =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        service.assertExecution(Object.freeze({}), "a"),
      );
      assert.ok(Exit.isFailure(exit));
    }),
  ));

test("inventory guard is a diagnostic, never a refusal", () =>
  run((service) => service.inventoryGuard(Object.freeze({}))));

test("agent notification capture passes unverified listeners through", () =>
  run((service) =>
    Effect.sync(() => {
      const listener = () => undefined;
      const captured = service.captureAgentNotificationListeners([listener]);
      assert.deepEqual([...captured], [listener]);
      assert.ok(Object.isFrozen(captured));
    }),
  ));

test("failed runtime inventory checks pass the original value through", () =>
  run(
    (service) =>
      Effect.gen(function* () {
        const original = Object.freeze({ id: "x", effect: () => undefined });
        // No location handle exists: the strict check would throw.
        const copy = service.inventoryToolCopy({}, original, original);
        assert.equal(copy, original);
        const resolved = yield* service.inventoryToolResolve(
          {},
          original,
          original,
        );
        assert.equal(resolved, original);
        yield* service.inventoryEnd(Object.freeze({}), "failed");
      }),
    (row) => rows.push(row),
  ));
const rows = [];
test("inventory failures were reported as diagnostics", () => {
  assert.ok(rows.some((row) => row.kind === "inventory-diagnostic"));
});
