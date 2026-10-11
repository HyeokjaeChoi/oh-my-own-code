// Private graph service. No execution activation is available until reconciliation.
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  createNativeBootstrapWorkspace,
  nativeBootstrapWorkspaceFailureClosed,
} from "./host/native-bootstrap-workspace.mjs";
import { types } from "node:util";
import { isAbsolute, normalize } from "node:path";
import { Context, Deferred, Effect, Layer, Option, Semaphore } from "effect";
import { makeGlobalNode } from "@opencode/util/effect/app-node";

import {
  array,
  text,
  identifier,
  initialization,
  taskPreparation,
  record,
} from "./native-permission-control-input.mjs";
import {
  validateFixedPluginSource,
  BUILTIN_PLUGIN_ORDER,
  FIXED_TOOL_DECLARATIONS,
} from "./native-permission-inventory.mjs";
import { createNativeLeaseRegistry } from "./native-permission-leases.mjs";
import {
  createWorkspaceRootAuthority,
  assertWorkspaceRootGuard,
  workspaceRootFailureClosed,
} from "./host/workspace-root-authority.mjs";

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
  const bootstrapTasks = new Set();
  const bootstrapCloseFailures = [];
  const projects = new Map();
  const capabilities = new WeakMap();
  const owners = new Map();
  // Project transactions share a permit. Membership updates take every permit,
  // excluding active project transactions while preserving disjoint progress.
  const graphMembership = Semaphore.makeUnsafe(1024);
  const locations = new Map();
  const locationHandles = new WeakMap();
  // No generation exists until an actual inventory event has been observed.
  let inventoryGeneration = 0;
  let inventorySources;
  const inventoryTokens = new WeakMap();
  const inventorySnapshots = new WeakMap();
  // Configured only by the resource-verified graph. This is provenance for
  // unsupported metadata, never execution/adapter proof or schema validation.
  const toolSources = new Map();
  const toolDescriptors = new WeakMap();
  const toolResults = new WeakSet();
  const inventoryAdvance = () => {
    if (inventoryGeneration >= Number.MAX_SAFE_INTEGER) {
      runtimeHeld = true;
      leases.close();
      reject("capacity");
    }
    inventoryGeneration++;
  };
  let locationGeneration = 1;
  let incarnation = 0;
  let metadataQueued = 0;
  let metadataDrained = Deferred.makeUnsafe();
  let runtimeHeld = false;
  const sharedMembership = (effect) =>
    Effect.suspend(() => {
      if (metadataQueued > 0)
        return Deferred.await(metadataDrained).pipe(
          Effect.flatMap(() => sharedMembership(effect)),
        );
      return graphMembership
        .withPermits(1)(
          // Recheck after acquisition: a reader already waiting for a permit
          // must also yield to metadata queued since its first admission check.
          Effect.suspend(() =>
            metadataQueued > 0
              ? Effect.succeed(Option.none())
              : Effect.map(effect, Option.some),
          ),
        )
        .pipe(
          Effect.flatMap((result) =>
            Option.isSome(result)
              ? Effect.succeed(result.value)
              : sharedMembership(effect),
          ),
        );
    });
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
      entry.fiber !== fiber ||
      owners.get(fiber) !== tx ||
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
          if (owners.has(fiber) || Option.isSome(inherited))
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
              fiber: fiber,
              active: true,
            };
            capabilities.set(tx, entry);
            owners.set(fiber, tx);
            return Effect.suspend(() => body(tx)).pipe(
              Effect.provideService(TransactionScope, tx),
              Effect.ensuring(
                Effect.sync(() => {
                  entry.active = false;
                  owners.delete(fiber);
                }),
              ),
            );
          });
          // Deterministic order across callers, including reverse-input moves.
          const locked = states.reduceRight(
            (effect, state) => state.semaphore.withPermits(1)(effect),
            run,
          );
          return yield* restore(sharedMembership(locked)).pipe(
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
  const metadata = (change, terminal = false) =>
    Effect.withFiber((fiber) =>
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const inherited = yield* Effect.serviceOption(TransactionScope);
          if (owners.has(fiber) || Option.isSome(inherited))
            return yield* Effect.fail(error("reentrant"));
          if (metadataQueued >= 32 && !terminal)
            return yield* Effect.fail(error("busy"));
          if (metadataQueued++ === 0) metadataDrained = Deferred.makeUnsafe();
          return yield* restore(
            graphMembership.withPermits(1024)(
              Effect.try({ try: change, catch: (failure) => failure }),
            ),
          ).pipe(
            Effect.ensuring(
              Effect.suspend(() => {
                metadataQueued--;
                return metadataQueued === 0
                  ? Deferred.succeed(metadataDrained, undefined)
                  : Effect.void;
              }),
            ),
          );
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
          entry.workspaceID !== identity.workspaceID ||
          (entry.candidateTask &&
            (entry.candidateState !== "retained" ||
              entry.candidate.inspect().projectId !== identity.projectId))
        )
          reject("location");
        advanceLocations();
        entry.projectId = identity.projectId;
      });
    });
  // The actual graph calls this before building location services or plugins.
  // Root identity is private and does not release the execution boot hold.
  const rootUsable = (entry) => {
    if (
      runtimeHeld ||
      entry.state === "finalizing" ||
      entry.scopeObserved ||
      !["acquiring", "pinned"].includes(entry.rootState)
    )
      reject("root_unverified");
  };
  const closeRoot = (entry) => {
    if (entry.rootClosing) return entry.rootClosing;
    entry.rootState = "closed";
    // Revoke synchronously, then await the actual retained descriptor close.
    const finish = async (task, ownerKey, failureClosed) => {
      // Observe both the original task and close even when either rejects.
      const owner = entry[ownerKey];
      const closing = owner?.close();
      const results = await Promise.allSettled([
        Promise.resolve(task),
        Promise.resolve(closing),
      ]);
      const failures = [];
      if (results[1].status === "rejected") failures.push(results[1].reason);
      if (!owner && entry[ownerKey]) {
        try {
          await entry[ownerKey].close();
        } catch (failure) {
          failures.push(failure);
        }
      }
      if (
        results[0].status === "rejected" &&
        !entry[ownerKey] &&
        !failureClosed(results[0].reason)
      )
        failures.push(results[0].reason);
      if (failures.length)
        throw new AggregateError(
          failures,
          "native_permission_root_close_unverified",
        );
    };
    entry.rootClosing = Promise.allSettled([
      finish(entry.rootTask, "root", workspaceRootFailureClosed),
      finish(
        entry.candidateTask,
        "candidate",
        (failure) =>
          !entry.candidateFactoryStarted ||
          nativeBootstrapWorkspaceFailureClosed(failure),
      ),
    ]).then((results) => {
      const failures = results.filter((row) => row.status === "rejected");
      if (failures.length)
        throw new AggregateError(
          failures.map((row) => row.reason),
          "native_permission_root_close_unverified",
        );
    });
    return entry.rootClosing;
  };
  const locationRootAcquire = (handle) =>
    Effect.uninterruptible(
      Effect.gen(function* () {
        const entry = yield* metadata(() => {
          const entry = locationEntry(handle);
          if (runtimeHeld || entry.state !== "building" || entry.rootState)
            reject("root_unverified");
          entry.rootState = "acquiring";
          return entry;
        });
        yield* Effect.tryPromise({
          try: () => {
            entry.rootTask = createWorkspaceRootAuthority(
              { id: entry.locationId, path: entry.directory },
              { check: () => rootUsable(entry) },
            ).then((root) => {
              entry.root = root;
              rootUsable(entry);
              entry.rootState = "pinned";
            });
            return entry.rootTask;
          },
          catch: (failure) => failure,
        }).pipe(
          Effect.onExit((exit) =>
            exit._tag === "Failure"
              ? Effect.promise(() => closeRoot(entry))
              : Effect.void,
          ),
        );
      }),
    );
  const candidateCurrent = async (entry) => {
    rootUsable(entry);
    await entry.root.assertCurrent();
    if (entry.candidate) {
      await entry.candidate.assertCurrent();
      const row = entry.candidate.inspect();
      assertWorkspaceRootGuard(entry.root.assertOpened, {
        workspaceId: entry.locationId,
        workspacePath: entry.directory,
        ...row.rootIdentity,
      });
    }
    rootUsable(entry);
  };
  const locationProjectCandidate = (handle) =>
    Effect.uninterruptible(
      Effect.gen(function* () {
        const entry = yield* metadata(() => {
          const entry = locationEntry(handle);
          rootUsable(entry);
          if (
            entry.state !== "building" ||
            entry.rootState !== "pinned" ||
            !entry.root ||
            entry.projectId !== undefined ||
            entry.candidateTask
          )
            reject("bootstrap_unverified");
          // Reserve on the same entry before another metadata caller can enter.
          entry.candidateState = "acquiring";
          entry.candidateTask = (async () => {
            const check = () => {
              rootUsable(entry);
            };
            check();
            await entry.root.assertCurrent();
            check();
            entry.candidateFactoryStarted = true;
            entry.candidate = await createNativeBootstrapWorkspace(
              { id: entry.locationId, path: entry.directory },
              { check },
            );
            await candidateCurrent(entry);
            check();
            if (entry.state !== "building" || entry.projectId !== undefined)
              reject("bootstrap_unverified");
            const row = entry.candidate.inspect();
            entry.candidateState = "retained";
            return Object.freeze({
              id: row.projectId,
              directory: row.workspacePath,
              canonical: row.workspacePath,
              vcs: undefined,
            });
          })();
          return entry;
        });
        return yield* Effect.tryPromise({
          try: () => entry.candidateTask,
          catch: (failure) => failure,
        }).pipe(
          Effect.onExit((exit) =>
            exit._tag === "Failure"
              ? Effect.promise(() => closeRoot(entry))
              : Effect.void,
          ),
        );
      }),
    );
  const locationRootCheck = (tx, id, handle) =>
    Effect.withFiber((fiber) =>
      Effect.gen(function* () {
        const entry = yield* Effect.try({
          try: () => {
            checked(tx, id, fiber);
            const entry = locationEntry(handle);
            if (
              entry.projectId !== id ||
              entry.state !== "ready" ||
              entry.rootState !== "pinned" ||
              !entry.root
            )
              reject("root_unverified");
            rootUsable(entry);
            return entry;
          },
          catch: (failure) => failure,
        });
        return yield* Effect.tryPromise({
          try: async () => {
            await candidateCurrent(entry);
            checked(tx, id, fiber);
            rootUsable(entry);
            return true;
          },
          catch: (failure) => failure,
        }).pipe(
          Effect.onExit((exit) =>
            exit._tag === "Failure"
              ? Effect.sync(() => {
                  entry.rootState = "unverified";
                  inventoryAdvance();
                })
              : Effect.void,
          ),
        );
      }),
    );
  const readyEntry = (handle) => {
    const entry = locationEntry(handle);
    if (entry.state !== "building" || entry.projectId === undefined)
      reject("location");
    if (entry.rootState && entry.rootState !== "pinned")
      reject("root_unverified");
    if (entry.candidateTask && entry.candidateState !== "retained")
      reject("bootstrap_unverified");
    return entry;
  };
  const locationReady = (handle) =>
    Effect.gen(function* () {
      const entry = yield* metadata(() => readyEntry(handle));
      if (entry.root) {
        yield* Effect.tryPromise({
          try: () => candidateCurrent(entry),
          catch: (failure) => failure,
        }).pipe(
          Effect.onExit((exit) =>
            exit._tag === "Failure"
              ? metadata(() => {
                  entry.rootState = "unverified";
                  inventoryAdvance();
                })
              : Effect.void,
          ),
        );
      }
      yield* metadata(() => {
        readyEntry(handle);
        if (entry.root) rootUsable(entry);
        advanceLocations();
        entry.state = "ready";
      });
    });
  const locationFinalizing = (handle) =>
    metadata(() => {
      const entry = locationEntry(handle);
      if (entry.state === "finalizing") return;
      advanceLocations();
      entry.state = "finalizing";
    });
  const locationScopeObserved = (handle) =>
    Effect.uninterruptible(
      Effect.gen(function* () {
        const entry = yield* metadata(() => {
          const entry = locationEntry(handle);
          if (!entry.scopeObserved) {
            advanceLocations();
            entry.state = "finalizing";
            entry.scopeObserved = true;
          }
          return entry;
        });
        yield* Effect.promise(() => closeRoot(entry));
        // Descriptor close is not proof of all tasks, finalizers or child exits.
        // Retain this incarnation and the execution hold.
      }),
    );
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

  // Trusted graph factory configures fixed sources on the SAME acquired owner.
  // This does not attest plugin effects or release boot hold.
  const inventoryConfigure = (root, nonce) => {
    if (inventorySources) reject("inventory_unverified");
    text(root);
    text(nonce);
    if (
      !isAbsolute(root) ||
      normalize(root) !== root ||
      !/^[a-f0-9]{64}$/u.test(nonce)
    )
      reject("inventory_unverified");
    inventorySources = Object.freeze({ root, nonce });
  };
  const inventorySource = (handle, operation) =>
    metadata(() => {
      const entry = locationEntry(handle);
      inventoryAdvance();
      if (!inventorySources || entry.state === "finalizing")
        reject("inventory_unverified");
      try {
        const source = validateFixedPluginSource(
          inventorySources.root,
          inventorySources.nonce,
          operation,
        );
        entry.inventorySource = source;
        return source;
      } catch (failure) {
        entry.inventoryFailed = true;
        runtimeHeld = true;
        throw failure;
      }
    });
  const inventoryToolSource = (
    plugin,
    accepts,
    project = undefined,
    publication = undefined,
  ) => {
    if (
      !plugin ||
      types.isProxy(plugin) ||
      !Object.isFrozen(plugin) ||
      typeof accepts !== "function" ||
      types.isProxy(accepts) ||
      types.isAsyncFunction(accepts) ||
      types.isGeneratorFunction(accepts) ||
      (project !== undefined &&
        (typeof project !== "function" ||
          types.isProxy(project) ||
          types.isAsyncFunction(project) ||
          types.isGeneratorFunction(project))) ||
      (publication !== undefined &&
        (typeof publication !== "function" ||
          types.isProxy(publication) ||
          types.isAsyncFunction(publication) ||
          types.isGeneratorFunction(publication)))
    )
      reject("inventory_unverified");
    const id = property(plugin, "id");
    const effect = property(plugin, "effect");
    if (
      !Object.hasOwn(FIXED_TOOL_DECLARATIONS, id) ||
      toolSources.has(id) ||
      typeof effect !== "function" ||
      types.isProxy(effect)
    )
      reject("inventory_unverified");
    toolSources.set(
      id,
      Object.freeze({
        id,
        plugin,
        effect,
        accepts,
        project,
        publication,
        metadata: FIXED_TOOL_DECLARATIONS[id],
      }),
    );
  };
  const toolDescriptor = (entry, value) => {
    if (!value || types.isProxy(value)) reject("inventory_unverified");
    const source = toolDescriptors.get(value);
    if (
      !source ||
      source.entry !== entry ||
      property(value, "id") !== source.producer.id ||
      property(value, "effect") !== source.effect ||
      !Object.isFrozen(value)
    )
      reject("inventory_unverified");
    return source;
  };
  const inventoryToolResolve = (handle, plugin, descriptor) =>
    metadata(() => {
      const entry = locationEntry(handle);
      const id = property(plugin, "id");
      if (!Object.hasOwn(FIXED_TOOL_DECLARATIONS, id)) return descriptor;
      const producer = toolSources.get(id);
      if (
        !producer ||
        plugin !== producer.plugin ||
        property(plugin, "effect") !== producer.effect ||
        entry.state === "finalizing" ||
        property(descriptor, "id") !== id ||
        typeof property(descriptor, "effect") !== "function" ||
        !Object.isFrozen(descriptor)
      )
        reject("inventory_unverified");
      record(descriptor, ["id", "effect"]);
      if (types.isProxy(property(descriptor, "effect")))
        reject("inventory_unverified");
      toolDescriptors.set(descriptor, {
        entry,
        producer,
        effect: property(descriptor, "effect"),
      });
      return descriptor;
    });
  // The fixed supervisor/loader copy sites preserve private object provenance.
  // Arbitrary spreads and same-effect identity transplants are not registered.
  const inventoryToolCopy = (handle, original, copy) => {
    const entry = locationEntry(handle);
    if (!Object.hasOwn(FIXED_TOOL_DECLARATIONS, property(original, "id")))
      return copy;
    const source = toolDescriptor(entry, original);
    if (
      entry.state === "finalizing" ||
      !copy ||
      types.isProxy(copy) ||
      !Object.isFrozen(copy) ||
      property(copy, "id") !== source.producer.id ||
      property(copy, "effect") !== source.effect
    )
      reject("inventory_unverified");
    const fields = record(copy, ["id", "effect", "revision", "source"]);
    const origin = record(fields.source, ["type"]);
    if (
      fields.revision !== "internal" ||
      origin.type !== "builtin" ||
      !Object.isFrozen(fields.source)
    )
      reject("inventory_unverified");
    toolDescriptors.set(copy, source);
    return copy;
  };
  const inventoryToolActivation = (token, descriptor, scope) =>
    metadata(() => {
      const registration = inventoryToken(token);
      if (!Object.hasOwn(FIXED_TOOL_DECLARATIONS, registration.identity)) {
        if (Object.hasOwn(FIXED_TOOL_DECLARATIONS, property(descriptor, "id")))
          reject("inventory_unverified");
        return;
      }
      if (property(descriptor, "id") !== registration.identity)
        reject("inventory_unverified");
      if (
        registration.kind !== "plugin" ||
        registration.state !== "registering" ||
        registration.toolScope ||
        !scope ||
        typeof scope !== "object" ||
        types.isProxy(scope)
      )
        reject("inventory_unverified");
      registration.toolDescriptor = toolDescriptor(
        registration.entry,
        descriptor,
      );
      registration.toolScope = scope;
    });
  const inventoryToolResult = (handle, descriptor, result, scope) =>
    metadata(() => {
      const entry = locationEntry(handle);
      if (!Object.hasOwn(FIXED_TOOL_DECLARATIONS, property(descriptor, "id")))
        return;
      const source = toolDescriptor(entry, descriptor);
      const registration = (entry.inventoryRegistrations ?? []).find(
        (item) =>
          item.kind === "plugin" &&
          item.identity === source.producer.id &&
          item.state === "registering" &&
          item.toolScope === scope &&
          item.toolDescriptor === source,
      );
      if (
        !registration ||
        registration.toolResult ||
        entry.state === "finalizing" ||
        !result ||
        (typeof result !== "object" && typeof result !== "function") ||
        toolResults.has(result) ||
        source.producer.accepts(result) !== true ||
        (source.producer.publication &&
          (registration.toolPublished !== result ||
            registration.toolPublication?.state !== "registered" ||
            source.producer.metadata.some(
              (row) =>
                !entry.inventoryTools?.some(
                  (current) => current.toolId === row.toolId,
                ),
            )))
      )
        reject("inventory_unverified");
      toolResults.add(result);
      registration.toolResult = result;
      if (source.producer.project) {
        try {
          const rows = array(source.producer.project(result), 17);
          if (rows.length !== source.producer.metadata.length)
            reject("inventory_unverified");
          registration.toolProjection = Object.freeze(
            rows.map((row, index) => {
              const data = record(row, [
                "toolId",
                "sourceSha256",
                "schemaDigest",
                "optionsDigest",
              ]);
              if (
                data.toolId !== source.producer.metadata[index].toolId ||
                [data.sourceSha256, data.schemaDigest, data.optionsDigest].some(
                  (value) =>
                    typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value),
                )
              )
                reject("inventory_unverified");
              return Object.freeze({ ...data });
            }),
          );
        } catch (failure) {
          entry.inventoryFailed = true;
          runtimeHeld = true;
          registration.toolResult = undefined;
          registration.toolProjection = undefined;
          throw failure;
        }
      }
    });
  const inventoryToolDeclaration = (token, descriptor, result) =>
    metadata(() => {
      const registration = inventoryToken(token);
      if (!Object.hasOwn(FIXED_TOOL_DECLARATIONS, registration.identity)) {
        if (Object.hasOwn(FIXED_TOOL_DECLARATIONS, property(descriptor, "id")))
          reject("inventory_unverified");
        return;
      }
      const entry = registration.entry;
      const source = toolDescriptor(entry, descriptor);
      if (
        registration.identity !== source.producer.id ||
        registration.toolDescriptor !== source ||
        registration.kind !== "plugin" ||
        registration.state !== "registering" ||
        registration.toolMetadata ||
        entry.state === "finalizing" ||
        registration.toolResult !== result ||
        !result
      )
        reject("inventory_unverified");
      registration.toolResult = undefined;
      inventoryAdvance();
      registration.toolMetadata = Object.freeze(
        source.producer.metadata.map((row, index) =>
          Object.freeze({
            ...row,
            ...(registration.toolProjection?.[index] ?? {}),
            support: "unsupported",
            resource: null,
            adapterId: null,
          }),
        ),
      );
      registration.toolProjection = undefined;
    });
  // Compatibility entry points retain the old Read-only source configuration.
  const inventoryReadSource = (plugin, accepts) => {
    if (property(plugin, "id") !== "opencode.tool.read")
      reject("inventory_unverified");
    inventoryToolSource(plugin, accepts);
  };
  const inventoryReadResolve = inventoryToolResolve;
  const inventoryReadCopy = inventoryToolCopy;
  const inventoryReadActivation = inventoryToolActivation;
  const inventoryReadResult = inventoryToolResult;
  const inventoryReadDeclaration = inventoryToolDeclaration;
  const inventoryPlan = (handle, pre, post, operations) =>
    metadata(() => {
      const entry = locationEntry(handle);
      inventoryAdvance();
      const identities = (values) =>
        array(values, 256).map((plugin) => text(property(plugin, "id")));
      const before = identities(pre),
        after = identities(post);
      if (
        JSON.stringify(before) !== JSON.stringify(BUILTIN_PLUGIN_ORDER.pre) ||
        JSON.stringify(after) !== JSON.stringify(BUILTIN_PLUGIN_ORDER.post) ||
        array(operations, 1).length !== 1
      ) {
        entry.inventoryFailed = true;
        runtimeHeld = true;
        reject("inventory_unverified");
      }
      entry.inventoryPlan = Object.freeze([
        ...before,
        "omoc.workbench.skills",
        ...after,
      ]);
    });
  const inventoryActivation = (handle, plugins, failures) =>
    metadata(() => {
      const entry = locationEntry(handle);
      inventoryAdvance();
      const ids = array(plugins, 256).map((plugin) =>
        text(property(plugin, "id")),
      );
      if (
        !entry.inventoryPlan ||
        JSON.stringify(ids) !== JSON.stringify(entry.inventoryPlan) ||
        array(failures, 256).length !== 0 ||
        new Set(ids).size !== ids.length
      ) {
        entry.inventoryFailed = true;
        runtimeHeld = true;
        reject("inventory_unverified");
      }
    });
  // Synchronous transform callbacks can be replayed by State.get(), including
  // outside registration Effects. Invalidate before invoking each callback.
  // No complete inventory can be issued until those effects have adapter proof.
  const inventoryMutation = (handle) => {
    const entry = locationEntry(handle);
    inventoryAdvance();
    entry.inventoryFailed = true;
    if (owners.size > 0 || entry.state === "finalizing") runtimeHeld = true;
    // Invalidation is not permission to run an unverified callback. State.get
    // can replay it outside a transaction and its body may have real effects.
    reject("inventory_unverified");
  };
  // A verified factory owns this exact synchronous editor callback. The
  // activation's original Scope owns its registration; no result can mint one.
  const inventoryToolPublication = (token, callback, scope) =>
    metadata(() => {
      const registration = inventoryToken(token);
      if (
        registration.kind !== "tool" ||
        registration.state !== "registering" ||
        registration.toolParent ||
        typeof callback !== "function" ||
        types.isProxy(callback) ||
        types.isAsyncFunction(callback) ||
        types.isGeneratorFunction(callback)
      )
        reject("inventory_unverified");
      const matches = [];
      for (const producer of toolSources.values()) {
        if (!producer.publication) continue;
        const declaration = producer.publication(callback);
        if (declaration !== undefined) matches.push({ producer, declaration });
      }
      if (matches.length !== 1) reject("inventory_unverified");
      const { producer, declaration } = matches[0];
      const parents = (registration.entry.inventoryRegistrations ?? []).filter(
        (item) =>
          item.kind === "plugin" &&
          item.state === "registering" &&
          item.identity === producer.id &&
          item.toolScope === scope &&
          item.toolDescriptor?.producer === producer,
      );
      if (
        parents.length !== 1 ||
        parents[0].toolPublished ||
        producer.accepts(declaration) !== true ||
        registration.entry.state === "finalizing"
      )
        reject("inventory_unverified");
      registration.toolParent = parents[0];
      registration.toolPublished = declaration;
      parents[0].toolPublished = declaration;
      parents[0].toolPublication = registration;
      inventoryAdvance();
    });
  // State.get replays synchronously outside Effect. Check the actual token and
  // its owner before invoking the fixed callback, including after disposal.
  const inventoryToolReplay = (token) => {
    const registration = inventoryToken(token);
    const parent = registration.toolParent;
    inventoryAdvance();
    if (
      registration.kind !== "tool" ||
      !["registering", "registered"].includes(registration.state) ||
      !parent ||
      !["registering", "registered"].includes(parent.state) ||
      parent.entry !== registration.entry ||
      parent.toolPublished !== registration.toolPublished ||
      !parent.toolScope ||
      registration.entry.state === "finalizing"
    ) {
      registration.entry.inventoryFailed = true;
      reject("inventory_unverified");
    }
  };
  const inventoryBegin = (handle, kind, identity = undefined) =>
    metadata(() => {
      const entry = locationEntry(handle);
      inventoryAdvance();
      if (
        !["plugin", "hook", "tool"].includes(kind) ||
        entry.state === "finalizing" ||
        (entry.inventoryRegistrations?.length ?? 0) >= 256
      ) {
        runtimeHeld = true;
        reject("inventory_unverified");
      }
      if (identity !== undefined) text(identity);
      if (
        kind === "plugin" &&
        (!entry.inventoryPlan?.includes(identity) ||
          (entry.inventoryRegistrations ?? []).some(
            (item) =>
              item.kind === "plugin" &&
              item.identity === identity &&
              item.state === "registered",
          ))
      ) {
        entry.inventoryFailed = true;
        reject("inventory_unverified");
      }
      const token = Object.freeze({});
      const registration = {
        kind,
        identity: identity ?? null,
        sequence: inventoryGeneration,
        state: "registering",
        entry,
      };
      inventoryTokens.set(token, registration);
      (entry.inventoryRegistrations ??= []).push(registration);
      return token;
    });
  const inventoryToken = (token) => {
    if (!token || typeof token !== "object" || types.isProxy(token))
      reject("inventory_unverified");
    const registration = inventoryTokens.get(token);
    if (
      !registration ||
      locations.get(registration.entry.locationId) !== registration.entry
    )
      reject("inventory_unverified");
    return registration;
  };
  const inventoryRegistered = (token) =>
    metadata(() => {
      const registration = inventoryToken(token);
      inventoryAdvance();
      if (
        registration.state !== "registering" ||
        registration.entry.state === "finalizing"
      ) {
        registration.entry.inventoryFailed = true;
        reject("inventory_unverified");
      }
      registration.state = "registered";
    });
  const inventoryEnd = (token, state) =>
    Effect.withFiber((fiber) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          // Terminal cleanup cannot be refused merely because new metadata work
          // filled the ordinary queue. One joinable cleanup per actual token keeps
          // this exception bounded by 32 locations * 256 registrations. It uses
          // the SAME exclusive permit/generation path; no out-of-lock mutation.
          const inherited = yield* Effect.serviceOption(TransactionScope);
          if (owners.has(fiber) || Option.isSome(inherited))
            return yield* Effect.fail(error("reentrant"));
          const registration = yield* Effect.try({
            try: () => {
              if (!["disposed", "failed"].includes(state))
                reject("inventory_unverified");
              return inventoryToken(token);
            },
            catch: (failure) => failure,
          });
          if (!registration.endWait) {
            registration.endWait = Deferred.makeUnsafe();
            yield* Deferred.complete(
              registration.endWait,
              metadata(() => {
                if (
                  registration.state === "disposed" ||
                  registration.state === "failed"
                )
                  return;
                registration.state = state;
                if (registration.toolParent) {
                  registration.toolParent.toolMetadata = undefined;
                  registration.toolParent.toolProjection = undefined;
                  registration.toolParent.toolResult = undefined;
                }
                registration.toolMetadata = undefined;
                registration.toolResult = undefined;
                registration.toolProjection = undefined;
                registration.toolScope = undefined;
                registration.toolDescriptor = undefined;
                registration.toolPublished = undefined;
                registration.entry.inventoryFailed = true;
                inventoryAdvance();
              }, true),
            );
          }
          return yield* Deferred.await(registration.endWait);
        }),
      ),
    );
  const inventoryTools = (handle, tools, errors) =>
    metadata(() => {
      const entry = locationEntry(handle);
      inventoryAdvance();
      const rows = array(tools, 256).map((tool) => {
        const toolId = text(property(tool, "id"));
        // The original editor clones declarations. Compare that exact shallow
        // copy with its source-owned publisher; a same-ID replacement is not
        // the declaration admitted by the original plugin activation.
        for (const registration of entry.inventoryRegistrations ?? []) {
          const producer = registration.toolDescriptor?.producer;
          if (
            !producer?.publication ||
            !registration.toolPublished ||
            !["registering", "registered"].includes(registration.state)
          )
            continue;
          const index = producer.metadata.findIndex(
            (row) => row.toolId === toolId,
          );
          if (index < 0) continue;
          const declared =
            producer.metadata.length === 1
              ? registration.toolPublished
              : property(registration.toolPublished, "declarations")[index];
          const original = record(declared, Reflect.ownKeys(declared));
          const current = record(tool, [
            ...new Set([...Object.keys(original), "id", "options"]),
          ]);
          for (const key of Object.keys(original)) {
            if (key !== "options" && current[key] !== original[key])
              reject("inventory_unverified");
          }
          if (original.options === undefined) {
            if (current.options !== undefined) reject("inventory_unverified");
          } else {
            const options = record(
              original.options,
              Reflect.ownKeys(original.options),
            );
            const copy = record(current.options, Object.keys(options));
            if (Object.keys(options).some((key) => options[key] !== copy[key]))
              reject("inventory_unverified");
          }
        }
        const options = property(tool, "options", true);
        const permission =
          options === undefined
            ? undefined
            : property(options, "permission", true);
        return Object.freeze({
          toolId,
          action: permission === undefined ? toolId : text(permission),
          support: "unsupported",
          resource: null,
          adapterId: null,
        });
      });
      if (
        new Set(rows.map((row) => row.toolId)).size !== rows.length ||
        !Number.isSafeInteger(errors) ||
        errors < 0
      )
        reject("inventory_unverified");
      entry.inventoryTools = Object.freeze(rows);
      if (errors) entry.inventoryFailed = true;
    });
  const inventoryChanged = (handle, kind) =>
    metadata(() => {
      const entry = locationEntry(handle);
      inventoryAdvance();
      if (
        ![
          "tool_transform",
          "tool_reload",
          "plugin_reload",
          "plugin_plan",
          "tool_editor",
          "tool_failed",
          "registration_failed",
        ].includes(kind)
      )
        reject("inventory_unverified");
      entry.inventoryFailed = true;
      for (const registration of entry.inventoryRegistrations ?? []) {
        registration.toolMetadata = undefined;
        registration.toolResult = undefined;
        registration.toolProjection = undefined;
        registration.toolScope = undefined;
        registration.toolDescriptor = undefined;
      }
    });
  // Old hook and execute closures cannot acquire authority from a newer list.
  const inventoryGuard = (token) =>
    Effect.try({
      try: () => {
        inventoryToken(token);
        reject("inventory_unverified");
      },
      catch: (failure) => failure,
    });
  const inventorySnapshot = (tx, id) =>
    Effect.flatMap(locationSnapshot(tx, id), (membership) =>
      Effect.sync(() => {
        const snapshot = Object.freeze({
          projectId: id,
          generation: inventoryGeneration,
          locationGeneration: membership.generation,
          complete: false,
          reason: "inventory_unverified",
          // Internal provenance only; no public capability row or positive proof.
          locations: Object.freeze(
            membership.locations.map((row) => {
              const entry = locations.get(row.locationId);
              return Object.freeze({
                locationId: row.locationId,
                incarnation: row.incarnation,
                state: row.state,
                sourceSha256: entry.inventorySource?.sourceSha256 ?? null,
                plugins: entry.inventoryPlan ?? Object.freeze([]),
                tools: Object.freeze([
                  ...(entry.inventoryTools ?? []).map((row) => {
                    const published = (entry.inventoryRegistrations ?? []).find(
                      (registration) =>
                        registration.state === "registered" &&
                        registration.toolDescriptor?.producer.publication &&
                        registration.toolMetadata?.some(
                          (item) => item.toolId === row.toolId,
                        ),
                    );
                    return (
                      published?.toolMetadata.find(
                        (item) => item.toolId === row.toolId,
                      ) ?? row
                    );
                  }),
                  ...(entry.inventoryRegistrations ?? []).flatMap(
                    (registration) =>
                      registration.state === "registered" &&
                      registration.toolMetadata &&
                      !registration.toolDescriptor?.producer.publication
                        ? registration.toolMetadata
                        : [],
                  ),
                ]),
                registrations: Object.freeze(
                  (entry.inventoryRegistrations ?? []).map((item) =>
                    Object.freeze({
                      kind: item.kind,
                      identity: item.identity,
                      sequence: item.sequence,
                      state: item.state,
                    }),
                  ),
                ),
              });
            }),
          ),
          capabilities: Object.freeze([]),
        });
        if (Buffer.byteLength(JSON.stringify(snapshot), "utf8") > 1024 * 1024) {
          runtimeHeld = true;
          reject("capacity");
        }
        inventorySnapshots.set(snapshot, {
          projectId: id,
          generation: inventoryGeneration,
          locationGeneration: membership.generation,
        });
        return snapshot;
      }),
    );
  const inventoryLookup = (tx, id, snapshot, capabilityId) =>
    Effect.flatMap(inspect(tx, id), () =>
      Effect.try({
        try: () => {
          identifier(capabilityId);
          if (
            !snapshot ||
            typeof snapshot !== "object" ||
            types.isProxy(snapshot)
          )
            reject("inventory_unverified");
          const issued = inventorySnapshots.get(snapshot);
          if (
            !issued ||
            issued.projectId !== id ||
            issued.generation !== inventoryGeneration ||
            issued.locationGeneration !== locationGeneration ||
            !snapshot.complete
          )
            reject("inventory_unverified");
          reject("inventory_unverified");
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
            "locationId",
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
  // Capture detached metadata at entry. Recheck runtime state when executed.
  // Inventory identity alone cannot authorize a mode, origin, lease or ID.
  const prepareTask = (request) => {
    let captured;
    try {
      captured = taskPreparation(request);
    } catch (failure) {
      return Effect.fail(failure);
    }
    const held = (reason) => Object.freeze({ status: "held", reason });
    if (captured.originKind !== "bootstrap")
      return Effect.sync(() =>
        held(
          runtimeHeld || captured.origin.runtimeEpoch !== initial.runtimeEpoch
            ? "runtime_unavailable"
            : "inventory_unverified",
        ),
      );
    // Metadata observation owns its original Node IO through close. It cannot
    // allocate a location, mode generation, task, session or execution grant.
    return Effect.uninterruptible(
      Effect.promise(() => {
        if (
          runtimeHeld ||
          captured.origin.runtimeEpoch !== initial.runtimeEpoch ||
          bootstrapTasks.size >= 16
        )
          return Promise.resolve(held("runtime_unavailable"));
        const deadline = performance.now() + 5000;
        const check = () => {
          if (runtimeHeld || performance.now() >= deadline)
            reject("bootstrap_unverified");
        };
        let task;
        task = (async () => {
          let owner;
          let reason = "inventory_unverified";
          try {
            owner = await createNativeBootstrapWorkspace(
              { id: captured.workspaceId, path: captured.workspacePath },
              { check },
            );
            await owner.assertCurrent();
            check();
          } catch (failure) {
            reason = "runtime_unavailable";
            if (!owner && !nativeBootstrapWorkspaceFailureClosed(failure)) {
              runtimeHeld = true;
              bootstrapCloseFailures.push(failure);
            }
          } finally {
            if (owner) {
              try {
                await owner.close();
              } catch (failure) {
                reason = "runtime_unavailable";
                runtimeHeld = true;
                bootstrapCloseFailures.push(failure);
              }
            }
          }
          return held(runtimeHeld ? "runtime_unavailable" : reason);
        })().finally(() => bootstrapTasks.delete(task));
        bootstrapTasks.add(task);
        return task;
      }),
    );
  };
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
      prepareTask,
      admitLease,
      leaseSnapshot,
      locationBegin,
      locationBind,
      locationReady,
      locationRootAcquire,
      locationProjectCandidate,
      locationRootCheck,
      closeRoots: () =>
        Effect.uninterruptible(
          Effect.promise(async () => {
            runtimeHeld = true;
            leases.close();
            // Revoke checks first; await original candidate IO and physical
            // close before the acquired Control scope can report settlement.
            await Promise.allSettled([...bootstrapTasks]);
            const results = await Promise.allSettled(
              [...locations.values()].map(closeRoot),
            );
            const failures = results.filter((row) => row.status === "rejected");
            if (failures.length || bootstrapCloseFailures.length)
              throw new AggregateError(
                [
                  ...failures.map((row) => row.reason),
                  ...bootstrapCloseFailures,
                ],
                "native_permission_root_close_unverified",
              );
          }),
        ),
      locationFinalizing,
      locationScopeObserved,
      locationSnapshot,
      inventoryConfigure,
      inventoryToolSource,
      inventoryToolResolve,
      inventoryToolCopy,
      inventoryToolActivation,
      inventoryToolResult,
      inventoryToolDeclaration,
      inventoryToolPublication,
      inventoryToolReplay,
      inventoryReadSource,
      inventoryReadResolve,
      inventoryReadCopy,
      inventoryReadActivation,
      inventoryReadResult,
      inventoryReadDeclaration,
      inventorySource,
      inventoryPlan,
      inventoryActivation,
      inventoryMutation,
      inventoryBegin,
      inventoryRegistered,
      inventoryEnd,
      inventoryChanged,
      inventoryTools,
      inventoryGuard,
      inventorySnapshot,
      inventoryLookup,
    }),
  );
}

// No usable default: the host must supply immutable epoch/holds before graph boot.
export const node = makeGlobalNode({
  service: Service,
  layer: Layer.effect(Service, Effect.fail(error("uninitialized"))),
  deps: [],
});

export function configured(input, onAcquire) {
  const initial = initialization(input);
  if (onAcquire !== undefined && typeof onAcquire !== "function")
    reject("input");
  return Layer.effect(
    Service,
    Effect.acquireRelease(
      Effect.sync(() => {
        const service = kernel(initial);
        // Trusted factory closure only; never read this callback from input.
        if (onAcquire) onAcquire(service);
        return service;
      }),
      (service) => service.closeRoots(),
    ),
  );
}
