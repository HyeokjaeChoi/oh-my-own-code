// Private graph service. No execution activation is available until reconciliation.
import { randomUUID } from "node:crypto";
import { types } from "node:util";
import { isAbsolute, normalize } from "node:path";
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

// Internal location build context; not an execution or renderer capability.
export class LocationBuildScope extends Context.Service()(
  "@workbench/PermissionLocationBuild",
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
  // Project transactions share a permit. Membership updates take every permit,
  // excluding active project transactions while preserving disjoint progress.
  const graphMembership = Semaphore.makeUnsafe(1024);
  const locations = new Map();
  const locationHandles = new WeakMap();
  let locationGeneration = 1;
  let incarnation = 0;
  let metadataQueued = 0;
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
          return yield* restore(graphMembership.withPermits(1)(locked)).pipe(
            Effect.ensuring(Effect.sync(leaveQueue)),
          );
        }),
      ),
    );

  const property = (input, key, optional = false) => {
    if (!input || typeof input !== "object" || types.isProxy(input))
      reject("location");
    const slot = Object.getOwnPropertyDescriptor(input, key);
    if (!slot && optional) return undefined;
    if (!slot?.enumerable || !Object.hasOwn(slot, "value")) reject("location");
    return slot.value;
  };
  const locationIdentity = (input, resolved = false) => {
    const directory = text(property(input, "directory"));
    if (!isAbsolute(directory) || normalize(directory) !== directory)
      reject("location");
    const workspaceID = property(input, "workspaceID", true);
    if (workspaceID !== undefined) text(workspaceID);
    const projectId = resolved
      ? text(property(property(input, "project"), "id"))
      : undefined;
    return { directory, workspaceID, projectId };
  };
  const locationEntry = (handle) => {
    if (!handle || typeof handle !== "object" || types.isProxy(handle))
      reject("location");
    const entry = locationHandles.get(handle);
    if (!entry || locations.get(entry.locationId) !== entry) reject("location");
    return entry;
  };
  const advanceLocations = () => {
    if (locationGeneration >= Number.MAX_SAFE_INTEGER) {
      runtimeHeld = true;
      leases.close();
      reject("capacity");
    }
    locationGeneration++;
  };
  const metadata = (change) =>
    Effect.withFiber((fiber) =>
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const inherited = yield* Effect.serviceOption(TransactionScope);
          if (owners.has(fiber.id) || Option.isSome(inherited))
            return yield* Effect.fail(error("reentrant"));
          if (metadataQueued >= 32) return yield* Effect.fail(error("busy"));
          metadataQueued++;
          return yield* restore(
            graphMembership.withPermits(1024)(
              Effect.try({ try: change, catch: (failure) => failure }),
            ),
          ).pipe(Effect.ensuring(Effect.sync(() => metadataQueued--)));
        }),
      ),
    );
  const locationBegin = (input) =>
    Effect.gen(function* () {
      const identity = yield* Effect.try({
        try: () => locationIdentity(input),
        catch: (failure) => failure,
      });
      return yield* metadata(() => {
        if (locations.size >= 32 || incarnation >= Number.MAX_SAFE_INTEGER)
          reject("capacity");
        advanceLocations();
        const handle = Object.freeze({});
        const entry = {
          ...identity,
          locationId: randomUUID(),
          incarnation: ++incarnation,
          state: "building",
          scopeObserved: false,
        };
        locations.set(entry.locationId, entry);
        locationHandles.set(handle, entry);
        return handle;
      });
    });
  const locationBind = (handle, input) =>
    Effect.gen(function* () {
      const identity = yield* Effect.try({
        try: () => locationIdentity(input, true),
        catch: (failure) => failure,
      });
      yield* metadata(() => {
        const entry = locationEntry(handle);
        if (
          entry.state !== "building" ||
          entry.projectId !== undefined ||
          entry.directory !== identity.directory ||
          entry.workspaceID !== identity.workspaceID
        )
          reject("location");
        advanceLocations();
        entry.projectId = identity.projectId;
      });
    });
  const locationReady = (handle) =>
    metadata(() => {
      const entry = locationEntry(handle);
      if (entry.state !== "building" || entry.projectId === undefined)
        reject("location");
      advanceLocations();
      entry.state = "ready";
    });
  const locationFinalizing = (handle) =>
    metadata(() => {
      const entry = locationEntry(handle);
      if (entry.state === "finalizing") return;
      advanceLocations();
      entry.state = "finalizing";
    });
  const locationScopeObserved = (handle) =>
    metadata(() => {
      const entry = locationEntry(handle);
      if (entry.scopeObserved) return;
      advanceLocations();
      entry.state = "finalizing";
      entry.scopeObserved = true;
      // This callback is not proof of all finalizers, tasks or child exits.
      // Retain the incarnation. No removal or execution activation API exists.
    });
  const locationSnapshot = (tx, id) =>
    Effect.withFiber((fiber) =>
      Effect.try({
        try: () => {
          checked(tx, id, fiber);
          const all = [...locations.values()];
          const unknownBuilding = all.filter(
            (entry) => entry.projectId === undefined,
          ).length;
          const rows = all
            .filter((entry) => entry.projectId === id)
            .sort((a, b) => compare(a.locationId, b.locationId))
            .map((entry) =>
              Object.freeze({
                locationId: entry.locationId,
                incarnation: entry.incarnation,
                directory: entry.directory,
                ...(entry.workspaceID !== undefined && {
                  workspaceID: entry.workspaceID,
                }),
                projectId: entry.projectId,
                state: entry.state,
                scopeObserved: entry.scopeObserved,
              }),
            );
          return Object.freeze({
            generation: locationGeneration,
            unknownBuilding,
            incomplete:
              unknownBuilding > 0 || rows.some((row) => row.state !== "ready"),
            locations: Object.freeze(rows),
          });
        },
        catch: (failure) => failure,
      }),
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
      locationBegin,
      locationBind,
      locationReady,
      locationFinalizing,
      locationScopeObserved,
      locationSnapshot,
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
