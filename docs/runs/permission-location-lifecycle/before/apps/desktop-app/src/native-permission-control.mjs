// Private graph service. No execution activation is available until reconciliation.
import { randomUUID } from "node:crypto";
import { types } from "node:util";
import { Context, Effect, Layer, Option, Semaphore } from "effect";
import { makeGlobalNode } from "@opencode/util/effect/app-node";

import {
  array,
  text,
  identifier,
  initialization,
  record,
} from "./native-permission-control-input.mjs";
import { createNativeLeaseRegistry } from "./native-permission-leases.mjs";

const error = (code) => new Error(`native_permission_${code}`);
const reject = (code) => {
  throw error(code);
};
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export class Service extends Context.Service()(
  "@workbench/PermissionControl",
) {}

class TransactionScope extends Context.Service()(
  "@workbench/PermissionControlScope",
) {}

function kernel(initial) {
  const leases = createNativeLeaseRegistry({
    runtimeEpoch: initial.runtimeEpoch,
  });
  const projects = new Map();
  const capabilities = new WeakMap();
  const owners = new Map();
  let runtimeHeld = false;
  const project = (id) => {
    let state = projects.get(id);
    if (!state) {
      if (projects.size >= 1024) reject("capacity");
      state = {
        semaphore: Semaphore.makeUnsafe(1),
        queued: 0,
        generation: 0,
        bootHolds: Object.freeze(
          initial.bootHolds.filter((row) => row.projectId === id),
        ),
      };
      projects.set(id, state);
    }
    return state;
  };
  // Eagerly establish the complete supplied hold table; never truncate it.
  for (const hold of initial.bootHolds) project(hold.projectId);

  const checked = (tx, id, fiber) => {
    text(id);
    if (!tx || typeof tx !== "object" || types.isProxy(tx))
      reject("transaction");
    const entry = capabilities.get(tx);
    if (
      !entry?.active ||
      entry.fiber !== fiber.id ||
      owners.get(fiber.id) !== tx ||
      !entry.projects.includes(id)
    )
      reject("transaction");
    return project(id);
  };

  const transaction = (input, body) =>
    Effect.withFiber((fiber) =>
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          // Do this before acquisition: nested public entry would deadlock.
          const inherited = yield* Effect.serviceOption(TransactionScope);
          if (owners.has(fiber.id) || Option.isSome(inherited))
            return yield* Effect.fail(error("reentrant"));
          const { ids, states } = yield* Effect.try({
            try: () => {
              const ids = [
                ...new Set(array(input, 32).map((id) => text(id))),
              ].sort(compare);
              if (!ids.length || typeof body !== "function") reject("input");
              return { ids, states: ids.map(project) };
            },
            catch: (failure) => failure,
          });
          if (states.some((state) => state.queued >= 32))
            return yield* Effect.fail(error("busy"));
          for (const state of states) state.queued++;
          let waiting = true;
          const leaveQueue = () => {
            if (!waiting) return;
            waiting = false;
            for (const state of states) state.queued--;
          };
          const run = Effect.suspend(() => {
            leaveQueue();
            const tx = Object.freeze({
              toJSON() {
                reject("transaction");
              },
            });
            const entry = {
              runtimeEpoch: initial.runtimeEpoch,
              transactionId: randomUUID(),
              projects: Object.freeze(ids),
              generations: Object.freeze(
                states.map((state) => state.generation),
              ),
              fiber: fiber.id,
              active: true,
            };
            capabilities.set(tx, entry);
            owners.set(fiber.id, tx);
            return Effect.suspend(() => body(tx)).pipe(
              Effect.provideService(TransactionScope, tx),
              Effect.ensuring(
                Effect.sync(() => {
                  entry.active = false;
                  owners.delete(fiber.id);
                }),
              ),
            );
          });
          // Deterministic order across callers, including reverse-input moves.
          const locked = states.reduceRight(
            (effect, state) => state.semaphore.withPermits(1)(effect),
            run,
          );
          return yield* restore(locked).pipe(
            Effect.ensuring(Effect.sync(leaveQueue)),
          );
        }),
      ),
    );

  const inspect = (tx, id) =>
    Effect.withFiber((fiber) =>
      Effect.try({
        try: () => {
          const state = checked(tx, id, fiber);
          return Object.freeze({
            runtimeEpoch: initial.runtimeEpoch,
            projectId: id,
            generation: state.generation,
            state: "boot_held",
            bootHolds: state.bootHolds,
            runtimeHeld,
          });
        },
        catch: (failure) => failure,
      }),
    );
  const assertExecution = (tx, id) =>
    Effect.flatMap(inspect(tx, id), () => Effect.fail(error("held")));
  const leaseSnapshot = (tx, id) =>
    Effect.flatMap(inspect(tx, id), () =>
      Effect.sync(() => leases.snapshot(id)),
    );
  const admitLease = (tx, input) =>
    Effect.flatMap(
      Effect.try({
        try: () =>
          record(input, [
            "scope",
            "projectId",
            "locationIncarnation",
            "sessionId",
            "kind",
            "modeGeneration",
            "inventoryGeneration",
            "parentLeaseId",
          ]),
        catch: (failure) => failure,
      }),
      (identity) =>
        Effect.flatMap(assertExecution(tx, identity.projectId), () =>
          Effect.try({
            try: () => leases.admit(identity),
            catch: (failure) => failure,
          }),
        ),
    );
  const invalidate = (reason) =>
    Effect.try({
      try: () => {
        identifier(reason);
        runtimeHeld = true;
        leases.close();
      },
      catch: (failure) => failure,
    });
  return Service.of(
    Object.freeze({
      transaction,
      inspect,
      assertExecution,
      invalidate,
      admitLease,
      leaseSnapshot,
    }),
  );
}

// No usable default: the host must supply immutable epoch/holds before graph boot.
export const node = makeGlobalNode({
  service: Service,
  layer: Layer.effect(Service, Effect.fail(error("uninitialized"))),
  deps: [],
});

export function configured(input) {
  const initial = initialization(input);
  return Layer.effect(
    Service,
    Effect.sync(() => kernel(initial)),
  );
}
