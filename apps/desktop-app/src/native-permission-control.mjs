// Private graph service. No execution activation is available until reconciliation.
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  assertNotVcsMetadataPath,
  createNativeBootstrapWorkspace,
  nativeBootstrapWorkspaceFailureClosed,
} from "./host/native-bootstrap-workspace.mjs";
import { types } from "node:util";
import { isAbsolute, normalize, relative } from "node:path";
import { realpathSync } from "node:fs";
import { Context, Deferred, Effect, Layer, Option, Semaphore } from "effect";
import { makeGlobalNode } from "@opencode/util/effect/app-node";

import {
  array,
  text,
  identifier,
  initialization,
  taskPreparation,
  taskArmRequest,
  record,
} from "./native-permission-control-input.mjs";
import { createNativeTaskHandoffs } from "./native-permission-task-handoff.mjs";
import {
  bootstrapBaselinePermissions,
  bootstrapMetadataDigest,
  bootstrapParentDigest,
  bootstrapStageArguments,
  bootstrapStageDigest,
} from "./native-permission-bootstrap-digest.mjs";
import {
  validateFixedPluginSource,
  BUILTIN_PLUGIN_ORDER,
  FIXED_TOOL_DECLARATIONS,
  FIXED_HOOK_DECLARATIONS,
} from "./native-permission-inventory.mjs";
import { createNativeLeaseRegistry } from "./native-permission-leases.mjs";
import {
  createWorkspaceRootAuthority,
  assertWorkspaceRootGuard,
  workspaceRootFailureClosed,
} from "./host/workspace-root-authority.mjs";

const error = (code) => new Error(`native_permission_${code}`);
// Caller function and file:line only (no directories) for diagnostics.
const rejectSite = () => {
  const frame = new Error().stack?.split("\n")[3] ?? "";
  const at = /([^/\s:]+:\d+):\d+\)?$/u.exec(frame)?.[1];
  const name = /at (?:async )?([^\s(]+) \(/u.exec(frame)?.[1];
  return at && `${name ?? "anon"}@${at}`;
};
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

// Test seam: the original hold-everything proof behavior stays available for the
// retained proof tests. Production never sets it; OpenCode's own permission
// rules are the safety layer.
const strictProof = () => process.env.OMOC_PERMISSION_PROOF_STRICT === "1";

function kernel(initial) {
  const strict = strictProof();
  // Per-kernel diagnostics sink bound by the graph factory; observational only.
  // The call site is captured (stack walk) only when a sink is bound.
  let diagnostic;
  let diagnose;
  const reject = (code) => {
    if (diagnostic) diagnose({ kind: "reject", code, step: rejectSite() });
    throw error(code);
  };
  const leases = createNativeLeaseRegistry({
    runtimeEpoch: initial.runtimeEpoch,
  });
  const bootstrapTasks = new Set();
  const bootstrapCloseFailures = [];
  // Child-only bootstrap handoff state. Handoffs are in-memory, never restored,
  // and bound to this launch. Prepared entries carry no execution authority.
  const launchId = randomUUID();
  const handoffs = createNativeTaskHandoffs({
    runtimeEpoch: initial.runtimeEpoch,
    launchIdentity: launchId,
  });
  const bootstrapPrepared = new Map();
  const bootstrapUsed = new Set();
  let armedBootstrap;
  const bootstrapKey = (value) =>
    JSON.stringify([value.runtimeEpoch, value.operationId]);
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
  // Private provenance only. State retains the sole executable callback set.
  const stateDomains = new WeakMap();
  const setupFibers = new WeakMap();
  // Bound once by the source-verified graph before Location/Plugin acquisition.
  // This source identity is metadata provenance, never execution authority.
  let agentNotificationSource;
  const ordinaryFunction = (value) =>
    typeof value === "function" &&
    !types.isProxy(value) &&
    !types.isAsyncFunction(value) &&
    !types.isGeneratorFunction(value);
  const bindAgentNotificationSource = (input) => {
    const { accepts, sourceSha256 } = record(input, [
      "accepts",
      "sourceSha256",
    ]);
    if (
      agentNotificationSource ||
      runtimeHeld ||
      locations.size ||
      toolSources.size ||
      !ordinaryFunction(accepts) ||
      typeof sourceSha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(sourceSha256)
    )
      reject("inventory_unverified");
    agentNotificationSource = Object.freeze({ accepts, sourceSha256 });
  };
  // Observational: an unverified listener set is recorded and passed through.
  const captureAgentNotificationListeners = (listeners) => {
    try {
      if (!agentNotificationSource || runtimeHeld)
        reject("inventory_unverified");
      const copy = array(listeners, 32);
      for (const listener of copy) {
        if (
          !ordinaryFunction(listener) ||
          agentNotificationSource.accepts(listener) !== true
        )
          reject("inventory_unverified");
      }
      return Object.freeze(copy);
    } catch (failure) {
      if (strict) throw failure;
      return Object.freeze(Array.isArray(listeners) ? [...listeners] : []);
    }
  };

  const inventoryAdvance = () => {
    if (inventoryGeneration >= Number.MAX_SAFE_INTEGER) {
      hold("inventory_generation_capacity");
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
  let heldBy;
  // Trusted graph factory only; observational, never an authority.
  const bindDiagnostic = (sink) => {
    if (sink !== undefined && typeof sink !== "function") reject("input");
    diagnostic = sink;
  };
  const anyLocation = (flag) =>
    [...locations.values()].some((entry) => entry[flag]);
  diagnose = (row) => {
    try {
      diagnostic?.({
        ...row,
        runtimeHeld,
        heldBy,
        inventoryFailed: anyLocation("inventoryFailed"),
        inventoryChanged: anyLocation("inventoryChangedKind"),
      });
    } catch {
      /* diagnostics never alter control flow */
    }
  };
  // Every runtime hold records which step set it (first wins) for diagnostics.
  // Inventory verification is diagnostic only (OpenCode's own permission rules
  // are the safety layer): these steps never hold the runtime.
  const diagnosticHolds = new Set([
    "inventory_source",
    "tool_declaration_unverified",
    "tool_publication",
    "plugin_order",
    "inventory_plan",
    "inventory_mutation",
    "setup_failure",
    "setup_activation_exit",
    "inventory_state_uncertain",
    "inventory_begin",
    "snapshot_size",
  ]);
  const hold = (step) => {
    if (!strict && diagnosticHolds.has(step)) {
      diagnose({ kind: "inventory-diagnostic", step });
      return;
    }
    runtimeHeld = true;
    heldBy ??= step;
    diagnose({ kind: "hold", step });
  };
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
      hold("location_generation_capacity");
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
        hold("inventory_source");
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
        kind: "tool",
        plugin,
        effect,
        accepts,
        project,
        publication,
        metadata: FIXED_TOOL_DECLARATIONS[id],
      }),
    );
  };
  const inventorySetupSource = (plugin, sourceSha256) => {
    const fields = record(plugin, ["id", "effect"]);
    if (
      fields.id !== "opencode.config.worktree" ||
      !ordinaryFunction(fields.effect) ||
      toolSources.has(fields.id) ||
      runtimeHeld ||
      locations.size > 32 ||
      typeof sourceSha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(sourceSha256)
    )
      reject("inventory_unverified");
    // Native define returns this actual mutable object. Freeze it, never a copy.
    Object.freeze(plugin);
    toolSources.set(
      fields.id,
      Object.freeze({
        id: fields.id,
        kind: "setup",
        plugin,
        effect: fields.effect,
        sourceSha256,
        metadata: Object.freeze([
          Object.freeze({ domain: "worktree", name: "transform" }),
        ]),
      }),
    );
  };
  const declarationPlugin = (id) =>
    id === "opencode.config.worktree" ||
    Object.hasOwn(FIXED_TOOL_DECLARATIONS, id) ||
    Object.hasOwn(FIXED_HOOK_DECLARATIONS, id);
  const inventoryHookSource = (plugin, accepts, publication, sourceSha256) => {
    if (!plugin || types.isProxy(plugin) || !Object.isFrozen(plugin))
      reject("inventory_unverified");
    const id = property(plugin, "id"),
      effect = property(plugin, "effect");
    if (
      !Object.hasOwn(FIXED_HOOK_DECLARATIONS, id) ||
      toolSources.has(id) ||
      [effect, accepts, publication].some(
        (value) =>
          typeof value !== "function" ||
          types.isProxy(value) ||
          types.isAsyncFunction(value) ||
          types.isGeneratorFunction(value),
      ) ||
      typeof sourceSha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(sourceSha256)
    )
      reject("inventory_unverified");
    toolSources.set(
      id,
      Object.freeze({
        id,
        kind: "hook",
        plugin,
        effect,
        accepts,
        publication,
        sourceSha256,
        metadata: FIXED_HOOK_DECLARATIONS[id],
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
      if (!declarationPlugin(id)) return descriptor;
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
    if (!declarationPlugin(property(original, "id"))) return copy;
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
      if (!declarationPlugin(registration.identity)) {
        // An incomplete inventory is not permission to enter an unverified
        // builtin factory. Setup can start discovery before its first callback
        // registration, so refuse before the original effect is constructed.
        registration.entry.inventoryFailed = true;
        hold("tool_declaration_unverified");
        reject("inventory_unverified");
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
      if (!declarationPlugin(property(descriptor, "id"))) return;
      const source = toolDescriptor(entry, descriptor);
      const registration = (entry.inventoryRegistrations ?? []).find(
        (item) =>
          item.kind === "plugin" &&
          item.identity === source.producer.id &&
          item.state === "registering" &&
          item.toolScope === scope &&
          item.toolDescriptor === source,
      );
      if (source.producer.kind === "setup") {
        if (
          !registration ||
          result !== undefined ||
          !registration.setupComplete ||
          registration.setupResult ||
          !activeMetadataScope(scope) ||
          entry.inventoryFailed ||
          entry.state === "finalizing" ||
          registration.setupPublication?.state !== "registered"
        )
          reject("inventory_unverified");
        registration.setupResult = true;
        return;
      }
      if (
        !registration ||
        registration.toolResult ||
        entry.state === "finalizing" ||
        !result ||
        (typeof result !== "object" && typeof result !== "function") ||
        toolResults.has(result) ||
        source.producer.accepts(result) !== true ||
        (source.producer.kind === "hook" &&
          (entry.inventoryFailed ||
            registration.hookPublications?.size !==
              source.producer.metadata.length ||
            [...registration.hookPublications.values()].some(
              (row) => row.state !== "registered",
            ) ||
            registration.toolPublished !== result)) ||
        (source.producer.kind !== "hook" &&
          source.producer.publication &&
          (registration.toolPublished !== result ||
            registration.toolPublication?.state !== "registered" ||
            registration.toolPublicationFailed))
      )
        reject("inventory_unverified");
      toolResults.add(result);
      registration.toolResult = result;
      if (source.producer.project) {
        try {
          const rows = array(source.producer.project(result), 256);
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
          hold("tool_publication");
          registration.toolResult = undefined;
          registration.toolProjection = undefined;
          throw failure;
        }
      }
    });
  const inventoryToolDeclaration = (token, descriptor, result) =>
    metadata(() => {
      const registration = inventoryToken(token);
      if (!declarationPlugin(registration.identity)) {
        if (declarationPlugin(property(descriptor, "id")))
          reject("inventory_unverified");
        return;
      }
      const entry = registration.entry;
      const source = toolDescriptor(entry, descriptor);
      if (source.producer.kind === "setup") {
        if (
          result !== undefined ||
          !registration.setupResult ||
          registration.toolDescriptor !== source ||
          registration.kind !== "plugin" ||
          registration.state !== "registering" ||
          registration.hookMetadata ||
          entry.inventoryFailed ||
          !activeMetadataScope(registration.toolScope) ||
          entry.state === "finalizing" ||
          registration.setupPublication?.state !== "registered"
        )
          reject("inventory_unverified");
        registration.setupResult = false;
        registration.hookMetadata = Object.freeze(
          source.producer.metadata.map((row) =>
            Object.freeze({
              ...row,
              sourceSha256: source.producer.sourceSha256,
              support: "unsupported",
              resource: null,
              adapterId: null,
            }),
          ),
        );
        inventoryAdvance();
        return;
      }
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
      if (source.producer.kind === "hook") {
        registration.hookMetadata = Object.freeze(
          source.producer.metadata.map((row) =>
            Object.freeze({
              ...row,
              sourceSha256: source.producer.sourceSha256,
              support: "unsupported",
              resource: null,
              adapterId: null,
            }),
          ),
        );
        return;
      }
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
        hold("plugin_order");
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
        hold("inventory_plan");
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
    if (owners.size > 0 || entry.state === "finalizing")
      hold("inventory_mutation");
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
        if (producer.kind === "hook" || !producer.publication) continue;
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
  const inventoryPublication = (
    kind,
    token,
    domain,
    name,
    callback,
    options,
    scope,
  ) =>
    metadata(() => {
      const registration = inventoryToken(token);
      if (
        !["hook", "transform"].includes(kind) ||
        registration.kind !== kind ||
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
        if (producer.kind !== "hook") continue;
        const declaration = producer.publication(callback);
        if (declaration !== undefined) matches.push({ producer, declaration });
      }
      if (matches.length !== 1) reject("inventory_unverified");
      const { producer, declaration } = matches[0];
      if (producer.accepts(declaration) !== true)
        reject("inventory_unverified");
      const originalHooks = record(declaration, ["hooks"]).hooks;
      const hooks = array(originalHooks, 256);
      if (
        !Object.isFrozen(declaration) ||
        !Object.isFrozen(originalHooks) ||
        hooks.length !== producer.metadata.length
      )
        reject("inventory_unverified");
      const rows = hooks.map((row, index) => {
        const data = record(row, ["domain", "name", "callback", "options"]),
          expected = producer.metadata[index];
        if (
          !Object.isFrozen(row) ||
          data.domain !== expected.domain ||
          data.name !== expected.name ||
          data.options !== undefined ||
          typeof data.callback !== "function" ||
          types.isProxy(data.callback) ||
          types.isAsyncFunction(data.callback) ||
          types.isGeneratorFunction(data.callback)
        )
          reject("inventory_unverified");
        return data;
      });
      const index = rows.findIndex(
        (row) =>
          row.domain === domain &&
          row.name === name &&
          row.callback === callback &&
          row.options === options,
      );
      const parents = (registration.entry.inventoryRegistrations ?? []).filter(
        (item) =>
          item.kind === "plugin" &&
          item.state === "registering" &&
          item.identity === producer.id &&
          item.toolScope === scope &&
          item.toolDescriptor?.producer === producer,
      );
      if (
        index < 0 ||
        parents.length !== 1 ||
        registration.entry.state === "finalizing"
      )
        reject("inventory_unverified");
      const parent = parents[0];
      if (
        (parent.toolPublished && parent.toolPublished !== declaration) ||
        parent.hookPublications?.has(index)
      )
        reject("inventory_unverified");
      registration.toolParent = parent;
      registration.hookIndex = index;
      parent.toolPublished = declaration;
      (parent.hookPublications ??= new Map()).set(index, registration);
      inventoryAdvance();
    });
  const inventoryHookPublication = (...args) =>
    inventoryPublication("hook", ...args);
  const inventoryTransformPublication = (...args) =>
    inventoryPublication("transform", ...args);
  // Only the inspected fixed Agent defaults may enter State metadata. The same
  // parent/source/Scope registration remains its owner. Other State domains,
  // arbitrary callbacks and every execution route remain held.
  // Pinned Effect Scope exposes state and marks Closed before running any
  // finalizer. A finalizer token alone cannot close this synchronous window.
  const activeMetadataScope = (scope) => {
    if (!scope || types.isProxy(scope)) return false;
    const slot = Object.getOwnPropertyDescriptor(scope, "state");
    if (
      !slot ||
      !Object.hasOwn(slot, "value") ||
      !slot.value ||
      types.isProxy(slot.value)
    )
      return false;
    const tag = Object.getOwnPropertyDescriptor(slot.value, "_tag");
    return (
      !!tag &&
      Object.hasOwn(tag, "value") &&
      ["Empty", "Open"].includes(tag.value)
    );
  };
  const setupFailure = (entry) => {
    entry.inventoryFailed = true;
    hold("setup_failure");
    inventoryAdvance();
    reject("inventory_unverified");
  };
  const inventoryStateDomain = (handle, domain, service) => {
    const entry = locationEntry(handle);
    const transform = property(service, "transform");
    if (
      domain !== "worktree" ||
      !ordinaryFunction(transform) ||
      entry.state === "finalizing" ||
      runtimeHeld
    )
      reject("inventory_unverified");
    const key = Object.freeze({});
    stateDomains.set(
      key,
      Object.freeze({
        entry,
        incarnation: entry.incarnation,
        service,
        transform,
        domain,
      }),
    );
    return key;
  };
  const setupParent = (parent, source) => {
    const producer = source?.producer;
    return (
      !runtimeHeld &&
      parent &&
      parent.kind === "plugin" &&
      ["registering", "registered"].includes(parent.state) &&
      parent.toolDescriptor === source &&
      source.entry === parent.entry &&
      producer?.kind === "setup" &&
      producer.id === "opencode.config.worktree" &&
      toolSources.get(producer.id) === producer &&
      !parent.entry.inventoryFailed &&
      parent.entry.state !== "finalizing" &&
      locations.get(parent.entry.locationId) === parent.entry &&
      activeMetadataScope(parent.toolScope)
    );
  };
  // Call inside Loader's updateContext, AFTER inventoryToolActivation. The
  // original constructor thunk is entered only after actual Fiber validation.
  const inventorySetupRun = (token, descriptor, scope, run) =>
    Effect.withFiber((fiber) =>
      Effect.gen(function* () {
        const activation = yield* metadata(() => {
          const parent = inventoryToken(token);
          const source = toolDescriptor(parent.entry, descriptor);
          if (
            !ordinaryFunction(run) ||
            !setupParent(parent, source) ||
            parent.state !== "registering" ||
            parent.toolScope !== scope ||
            parent.setupStarted ||
            setupFibers.has(fiber)
          )
            setupFailure(parent.entry);
          parent.setupStarted = true;
          const activation = {
            parent,
            source,
            scope,
            fiber,
            live: true,
            generation: inventoryGeneration,
          };
          setupFibers.set(fiber, activation);
          return activation;
        });
        return yield* Effect.gen(function* () {
          const result = yield* Effect.suspend(run);
          yield* metadata(() => {
            const parent = activation.parent;
            if (
              result !== undefined ||
              !setupParent(parent, activation.source) ||
              parent.setupPublication?.state !== "registered"
            )
              setupFailure(parent.entry);
            parent.setupComplete = true;
          });
          return result;
        }).pipe(
          Effect.onExit((exit) => {
            activation.live = false;
            setupFibers.delete(fiber);
            return exit._tag === "Failure"
              ? metadata(() => {
                  activation.parent.entry.inventoryFailed = true;
                  hold("setup_activation_exit");
                  inventoryAdvance();
                }, true)
              : Effect.void;
          }),
        );
      }),
    );
  const stateRow = (token) => {
    const row = inventoryToken(token),
      parent = row.toolParent;
    const domain = row.stateDomain;
    if (
      !domain ||
      !["registering", "registered"].includes(row.state) ||
      row.kind !== "transform" ||
      row.identity !== JSON.stringify(["worktree", "transform"]) ||
      !setupParent(parent, row.setupSource) ||
      parent.setupPublication !== row ||
      row.entry !== domain.entry ||
      row.entry !== parent.entry ||
      row.entry.incarnation !== domain.incarnation ||
      !activeMetadataScope(row.registrationScope)
    )
      reject("inventory_unverified");
    return row;
  };
  const inventoryStateBegin = (domainHandle, callback, options, scope) =>
    Effect.withFiber((fiber) =>
      metadata(() => {
        const domain =
          domainHandle && !types.isProxy(domainHandle)
            ? stateDomains.get(domainHandle)
            : undefined;
        const activation = setupFibers.get(fiber);
        if (!domain || !activation) reject("inventory_unverified");
        const parent = activation.parent,
          entry = parent.entry;
        if (
          !activation.live ||
          activation.fiber !== fiber ||
          activation.generation !== inventoryGeneration ||
          !setupParent(parent, activation.source) ||
          parent.state !== "registering" ||
          domain.entry !== entry ||
          domain.incarnation !== entry.incarnation ||
          scope !== activation.scope ||
          options !== undefined ||
          !ordinaryFunction(callback) ||
          parent.setupPublication ||
          (entry.inventoryRegistrations?.length ?? 0) >= 256
        )
          setupFailure(entry);
        // Reserve in the existing row set under the same metadata permit BEFORE
        // original State.transform can add or synchronously replay the wrapper.
        inventoryAdvance();
        activation.generation = inventoryGeneration;
        const token = Object.freeze({});
        const row = {
          kind: "transform",
          identity: JSON.stringify(["worktree", "transform"]),
          sequence: inventoryGeneration,
          state: "registering",
          entry,
          toolParent: parent,
          setupSource: activation.source,
          stateDomain: domain,
          registrationScope: scope,
          setupActivation: activation,
        };
        inventoryTokens.set(token, row);
        entry.inventoryRegistrations.push(row);
        parent.setupPublication = row;
        return token;
      }),
    );
  const inventoryStateReplay = (token) => {
    stateRow(token);
    inventoryAdvance();
  };
  const inventoryStateRegister = (domainHandle, token, guarded) =>
    Effect.withFiber((fiber) =>
      Effect.gen(function* () {
        const domain = yield* Effect.try({
          try: () => {
            const row = stateRow(token),
              activation = setupFibers.get(fiber);
            if (
              stateDomains.get(domainHandle) !== row.stateDomain ||
              activation !== row.setupActivation ||
              !activation?.live ||
              !ordinaryFunction(guarded)
            )
              reject("inventory_unverified");
            return row.stateDomain;
          },
          catch: (failure) => failure,
        });
        return yield* domain.transform.call(domain.service, guarded, undefined);
      }),
    );
  const inventoryStateRegistered = (token) =>
    metadata(() => {
      const row = stateRow(token);
      if (row.state !== "registering" || !row.setupActivation.live)
        setupFailure(row.entry);
      row.state = "registered";
      inventoryAdvance();
      row.setupActivation.generation = inventoryGeneration;
    });
  // Cleanup uncertainty invalidates authority even if terminal metadata fails.
  const inventoryStateUncertain = (token) => {
    const row = inventoryToken(token);
    row.entry.inventoryFailed = true;
    hold("inventory_state_uncertain");
    inventoryAdvance();
  };
  const agentTransformMetadata = (token) => {
    const registration = inventoryToken(token);
    const parent = registration.toolParent;
    const producer = parent?.toolDescriptor?.producer;
    if (
      runtimeHeld ||
      !agentNotificationSource ||
      registration.kind !== "transform" ||
      registration.identity !== JSON.stringify(["agent", "transform"]) ||
      !["registering", "registered"].includes(registration.state) ||
      !parent ||
      parent.kind !== "plugin" ||
      parent.identity !== "opencode.agent" ||
      !["registering", "registered"].includes(parent.state) ||
      parent.entry !== registration.entry ||
      !activeMetadataScope(parent.toolScope) ||
      producer?.kind !== "hook" ||
      producer.id !== "opencode.agent" ||
      toolSources.get(producer.id) !== producer ||
      parent.toolDescriptor.entry !== registration.entry ||
      producer.metadata.length !== 1 ||
      producer.metadata[0].domain !== "agent" ||
      producer.metadata[0].name !== "transform" ||
      !parent.toolPublished ||
      producer.accepts(parent.toolPublished) !== true ||
      registration.hookIndex !== 0 ||
      parent.hookPublications?.get(0) !== registration ||
      registration.entry.state === "finalizing"
    )
      reject("inventory_unverified");
    return registration;
  };
  const inventoryTransformMetadata = (token) =>
    metadata(() => {
      agentTransformMetadata(token);
      inventoryAdvance();
    });
  const inventoryTransformReplay = (token) => {
    agentTransformMetadata(token);
    inventoryAdvance();
  };
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
        !["plugin", "hook", "tool", "transform"].includes(kind) ||
        entry.state === "finalizing" ||
        (entry.inventoryRegistrations?.length ?? 0) >= 256
      ) {
        hold("inventory_begin");
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
                  registration.toolParent.hookMetadata = undefined;
                  registration.toolParent.toolMetadata = undefined;
                  registration.toolParent.toolProjection = undefined;
                  registration.toolParent.toolResult = undefined;
                }
                registration.hookMetadata = undefined;
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
      try {
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
              if (
                Object.keys(options).some((key) => options[key] !== copy[key])
              )
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
        // State.batch defers this original notify until after plugin results.
        // Validate live row completeness here, never before the batch can publish.
        for (const registration of entry.inventoryRegistrations ?? []) {
          const producer = registration.toolDescriptor?.producer;
          if (
            !producer?.publication ||
            !registration.toolPublished ||
            !["registering", "registered"].includes(registration.state) ||
            !["registering", "registered"].includes(
              registration.toolPublication?.state,
            )
          )
            continue;
          if (
            producer.metadata.some(
              (row) => !rows.some((current) => current.toolId === row.toolId),
            ) ||
            registration.toolPublicationFailed
          )
            reject("inventory_unverified");
        }
        entry.inventoryTools = Object.freeze(rows);
        if (errors) entry.inventoryFailed = true;
      } catch (failure) {
        entry.inventoryFailed = true;
        entry.inventoryTools = Object.freeze([]);
        for (const registration of entry.inventoryRegistrations ?? []) {
          if (registration.toolPublished) {
            registration.toolPublicationFailed = true;
            registration.toolMetadata = undefined;
            registration.toolProjection = undefined;
            registration.toolResult = undefined;
          }
        }
        throw failure;
      }
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
      entry.inventoryChangedKind = kind;
      for (const registration of entry.inventoryRegistrations ?? []) {
        registration.toolMetadata = undefined;
        registration.toolResult = undefined;
        registration.toolProjection = undefined;
        registration.toolScope = undefined;
        registration.toolDescriptor = undefined;
      }
    });
  // Hook/execute closures run under OpenCode's own permission checks; a stale
  // inventory token is a diagnostic only.
  const inventoryGuard = (token) =>
    strict
      ? Effect.try({
          try: () => {
            inventoryToken(token);
            reject("inventory_unverified");
          },
          catch: (failure) => failure,
        })
      : Effect.sync(() => {
          try {
            inventoryToken(token);
          } catch (failure) {
            diagnose({
              kind: "inventory-diagnostic",
              step: "inventoryGuard",
              code: String(failure?.message ?? failure).slice(0, 80),
            });
          }
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
                hooks: Object.freeze(
                  (entry.inventoryRegistrations ?? []).flatMap(
                    (registration) =>
                      registration.state === "registered" &&
                      registration.hookMetadata
                        ? registration.hookMetadata
                        : [],
                  ),
                ),
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
          hold("snapshot_size");
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
  // Execution is admitted for any inspected project transaction; OpenCode's own
  // permission rules and ask prompts are the safety layer.
  const assertExecution = (tx, id) =>
    strict
      ? Effect.flatMap(inspect(tx, id), () => Effect.fail(error("held")))
      : Effect.asVoid(inspect(tx, id));
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
  // Only the resource-verified graph installs these original implementations.
  // A binding records provenance; it never releases an execution hold.
  let readRuntime;
  const bindNativeReadRuntime = (input) => {
    if (readRuntime || runtimeHeld) reject("read_unverified");
    const binding = record(input, [
      "read",
      "effects",
      "consumerSha256",
      "effectsSha256",
    ]);
    for (const key of ["read", "effects"]) {
      const fn = binding[key];
      if (
        typeof fn !== "function" ||
        types.isProxy(fn) ||
        types.isAsyncFunction(fn) ||
        types.isGeneratorFunction(fn)
      )
        reject("input");
    }
    for (const key of ["consumerSha256", "effectsSha256"])
      if (
        typeof binding[key] !== "string" ||
        !/^[a-f0-9]{64}$/u.test(binding[key])
      )
        reject("input");
    readRuntime = Object.freeze(binding);
  };
  const plainRead = (request) =>
    Effect.gen(function* () {
      const inside = (directory, path) => {
        const rel = relative(directory, path);
        return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
      };
      const realOrUndefined = (path) => {
        try {
          return realpathSync(path);
        } catch {
          return undefined;
        }
      };
      // Contained to a location by lexical path or by realpath; a path no
      // location owns is never read.
      const real = realOrUndefined(request.path);
      const owner = [...locations.values()].find(
        (entry) =>
          inside(entry.directory, request.path) ||
          (real !== undefined &&
            inside(realOrUndefined(entry.directory) ?? entry.directory, real)),
      );
      if (!owner) return yield* Effect.fail(error("read_unverified"));
      // A symlink inside the location must not lead out of it unprompted.
      try {
        const rel = relative(
          realpathSync(owner.directory),
          realpathSync(request.path),
        );
        if (rel.startsWith("..") || isAbsolute(rel))
          return yield* Effect.fail(error("read_unverified"));
      } catch (failure) {
        if (failure?.code !== "ENOENT" && failure?.code !== "ENOTDIR")
          return yield* Effect.fail(error("read_unverified"));
      }
      const { makeLocalDriver } = yield* Effect.promise(
        () => import("@opencode/core/environment/local"),
      );
      const files = makeLocalDriver(undefined).overrides;
      return request.kind === "read"
        ? yield* readRuntime.read(
            files,
            request.path,
            request.resource,
            request.page,
          )
        : yield* files.list(request.path);
    });
  const readNativeFile = (input) => {
    let request;
    try {
      if (!input || typeof input !== "object" || types.isProxy(input))
        reject("input");
      const kind = Object.getOwnPropertyDescriptor(input, "kind");
      if (!kind || !Object.hasOwn(kind, "value")) reject("input");
      request = record(
        input,
        kind.value === "read"
          ? ["kind", "path", "resource", "page"]
          : ["kind", "path"],
      );
      if (!["read", "list"].includes(request.kind)) reject("input");
      text(request.path);
      if (!isAbsolute(request.path) || normalize(request.path) !== request.path)
        reject("input");
      if (request.kind === "read") {
        text(request.resource);
        if (request.page !== undefined) {
          const page = request.page;
          if (!page || typeof page !== "object" || types.isProxy(page))
            reject("input");
          // The Read tool passes {offset, limit} with undefined when unset.
          const keys = Reflect.ownKeys(page).filter((key) => {
            const slot = Object.getOwnPropertyDescriptor(page, key);
            return !(slot && "value" in slot && slot.value === undefined);
          });
          if (keys.some((key) => !["offset", "limit"].includes(key)))
            reject("input");
          request.page = keys.length ? record(page, keys) : {};
          for (const value of Object.values(request.page))
            if (!Number.isSafeInteger(value) || value < 0) reject("input");
          Object.freeze(request.page);
        }
      }
      Object.freeze(request);
    } catch (failure) {
      return Effect.fail(failure);
    }
    return Effect.gen(function* () {
      if (!readRuntime) return yield* Effect.fail(error("read_unverified"));
      // Plain Native tool call (no task lease): OpenCode's own permission check
      // already ran in the Read tool; this only reads, contained to the
      // location when the lexical path is inside it.
      const handle = strict
        ? yield* leases.current()
        : yield* Effect.catch(leases.current(), () =>
            Effect.succeed(undefined),
          );
      if (handle === undefined) return yield* plainRead(request);
      const identity = leases.inspect(handle);
      // This short transaction retains the existing execution hold. A current
      // Task handle or verified source binding alone cannot authorize Read.
      yield* transaction([identity.projectId], (tx) =>
        assertExecution(tx, identity.projectId),
      );
      const entry = locations.get(identity.locationId);
      const generation = project(identity.projectId).generation;
      const inventory = inventoryGeneration,
        membership = locationGeneration;
      const check = () => {
        rootUsable(entry);
        const current = leases.inspect(handle);
        if (
          entry.state !== "ready" ||
          entry.rootState !== "pinned" ||
          entry.projectId !== identity.projectId ||
          entry.incarnation !== identity.locationIncarnation ||
          current.state !== "running" ||
          current.runtimeEpoch !== initial.runtimeEpoch ||
          inventory !== inventoryGeneration ||
          inventory !== current.inventoryGeneration ||
          membership !== locationGeneration ||
          generation !== project(identity.projectId).generation
        )
          reject("read_unverified");
      };
      yield* Effect.try({ try: check, catch: (failure) => failure });
      return yield* Effect.acquireUseRelease(
        leases.openDescriptorRead(
          handle,
          { id: entry.locationId, path: entry.directory },
          { checkRoot: entry.root.assertOpened, check },
        ),
        (owner) =>
          Effect.gen(function* () {
            yield* Effect.tryPromise({
              try: () => owner.ready,
              catch: (failure) => failure,
            });
            yield* Effect.try({ try: check, catch: (failure) => failure });
            const effects = readRuntime.effects(
              owner.resource,
              entry.directory,
            );
            const result = yield* request.kind === "read"
              ? readRuntime.read(
                  effects.files,
                  request.path,
                  request.resource,
                  request.page,
                )
              : effects.files.list(request.path);
            // Revalidate the exact running Fiber and current origin after the
            // original consumer's final yield, before disclosing its result.
            yield* leases.current();
            yield* Effect.try({ try: check, catch: (failure) => failure });
            return result;
          }),
        (owner) =>
          Effect.uninterruptible(
            Effect.tryPromise({
              try: async () => {
                const result = await owner.close();
                if (result?.complete !== true) {
                  hold("read_close_unverified");
                  reject("read_close_unverified");
                }
              },
              catch: (failure) => {
                hold("read_close_failed");
                return failure;
              },
            }),
          ),
      );
    });
  };
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
        const key = bootstrapKey(captured.origin);
        for (const [id, entry] of bootstrapPrepared)
          if (performance.now() - entry.preparedAt > 60000)
            bootstrapPrepared.delete(id);
        if (
          runtimeHeld ||
          captured.origin.runtimeEpoch !== initial.runtimeEpoch ||
          bootstrapTasks.size >= 16 ||
          bootstrapPrepared.size >= 16 ||
          bootstrapUsed.size >= 8192 ||
          // Never re-issue: one preparation per original operation key.
          bootstrapUsed.has(key)
        )
          return Promise.resolve(held("runtime_unavailable"));
        bootstrapUsed.add(key);
        const deadline = performance.now() + 5000;
        const check = () => {
          if (runtimeHeld || performance.now() >= deadline)
            reject("bootstrap_unverified");
        };
        let task;
        task = (async () => {
          let owner;
          let observed;
          let reason = "inventory_unverified";
          try {
            owner = await createNativeBootstrapWorkspace(
              { id: captured.workspaceId, path: captured.workspacePath },
              { check },
            );
            await owner.assertCurrent();
            check();
            observed = owner.inspect();
          } catch (failure) {
            observed = undefined;
            reason = "runtime_unavailable";
            if (!owner && !nativeBootstrapWorkspaceFailureClosed(failure)) {
              hold("bootstrap_workspace_open");
              bootstrapCloseFailures.push(failure);
            }
          } finally {
            if (owner) {
              try {
                await owner.close();
              } catch (failure) {
                observed = undefined;
                reason = "runtime_unavailable";
                hold("bootstrap_workspace_close");
                bootstrapCloseFailures.push(failure);
              }
            }
          }
          if (runtimeHeld) return held("runtime_unavailable");
          if (!observed) return held(reason);
          const result = Object.freeze({
            status: "prepared",
            taskScopeId: randomUUID(),
            locationId: randomUUID(),
            projectId: observed.projectId,
            // Nothing executes for a bootstrap task: these are the control's
            // current observed counters. No location exists before the first
            // session, so a counter may still be 0; zero is not a valid
            // generation, hence the floor of 1.
            modeGeneration: Math.max(
              1,
              projects.get(observed.projectId)?.generation ?? 0,
            ),
            inventoryGeneration: Math.max(1, inventoryGeneration),
            launchId,
          });
          bootstrapPrepared.set(key, {
            request: captured,
            result,
            state: "prepared",
            preparedAt: performance.now(),
          });
          return result;
        })().finally(() => bootstrapTasks.delete(task));
        bootstrapTasks.add(task);
        return task;
      }),
    );
  };
  // Arm exactly one handoff for a prepared bootstrap task. Main reaches this only
  // after its durable original-intent records; the child still binds every field
  // to its own prepared state and chooses the (<=5s) expiry on its own clock.
  const armBootstrap = (input) =>
    Effect.try({
      try: () => {
        const row = taskArmRequest(input);
        // An expired handoff is unusable; it must not block the single slot.
        if (armedBootstrap && armedBootstrap.row.expiresAt <= performance.now())
          armedBootstrap = undefined;
        const entry = bootstrapPrepared.get(bootstrapKey(row.originalKey));
        const { request, result } = entry ?? {};
        if (
          runtimeHeld ||
          !entry ||
          entry.state !== "prepared" ||
          armedBootstrap ||
          row.currentLaunchIdentity !== launchId ||
          row.taskScopeId !== result.taskScopeId ||
          row.originalDigest !== request.origin.digest ||
          row.step !== request.reservation.step ||
          row.targetIdentity.workspaceId !== request.workspaceId ||
          row.targetIdentity.projectId !== result.projectId ||
          row.targetIdentity.locationId !== result.locationId ||
          row.targetIdentity.modeGeneration !== result.modeGeneration ||
          row.targetIdentity.inventoryGeneration !== result.inventoryGeneration
        )
          reject("bootstrap_unverified");
        const armed = Object.freeze({
          ...row,
          expiresAt: Math.floor(performance.now()) + 4000,
        });
        handoffs.arm(armed);
        entry.state = "armed";
        entry.handoffId = row.handoffId;
        entry.row = armed;
        armedBootstrap = entry;
      },
      catch: (failure) => failure,
    });
  const revokeBootstrap = (handoffId) =>
    Effect.try({
      try: () => {
        identifier(handoffId);
        const entry = [...bootstrapPrepared.values()].find(
          (row) => row.handoffId === handoffId,
        );
        // A consumed handoff means Native may have an effect: never "revoked".
        if (!entry || !["armed", "revoked"].includes(entry.state))
          reject("bootstrap_unverified");
        if (entry.state === "armed")
          try {
            handoffs.revoke(handoffId);
          } catch {
            // Already expired in the store: equally unusable.
          }
        entry.state = "revoked";
        if (armedBootstrap === entry) armedBootstrap = undefined;
      },
      catch: (failure) => failure,
    });
  // Native-side consume. The key is the digest of the ACTUAL input, so a direct
  // HTTP call, another method or a duplicate-id probe finds no armed handoff.
  const consumeArmed = (step, input, verify) => {
    const entry = armedBootstrap;
    if (
      runtimeHeld ||
      !entry ||
      entry.state !== "armed" ||
      entry.row.step !== step ||
      entry.row.stageArgumentDigest !== bootstrapStageDigest(step, input)
    )
      reject("held");
    verify(entry.request);
    // Throws when expired, already consumed or revoked.
    handoffs.consume(entry.row);
    entry.state = "consumed";
    armedBootstrap = undefined;
  };
  const consumeBootstrap = (input) =>
    Effect.try({
      try: () => {
        const args = bootstrapStageArguments("native.create", input);
        consumeArmed("native.create", args, (request) => {
          if (
            args.id !== request.plannedNativeSessionId ||
            args.location.directory !== request.workspacePath ||
            bootstrapMetadataDigest(args.metadata) !== request.metadataDigest ||
            !bootstrapBaselinePermissions(args.permissions)
          )
            reject("held");
        });
      },
      catch: (failure) => failure,
    });
  // Fork replaces assertExecution for the parent's own transaction.
  const enterBootstrap = (tx, parent, input) =>
    Effect.withFiber((fiber) =>
      Effect.try({
        try: () => {
          checked(tx, parent.projectID, fiber);
          const args = bootstrapStageArguments("native.fork", input);
          consumeArmed("native.fork", args, (request) => {
            if (
              args.sessionID !== parent.id ||
              args.sessionID !== request.parentNativeSessionId ||
              bootstrapParentDigest({
                id: parent.id,
                projectID: parent.projectID,
                directory: parent.directory,
              }) !== request.reservation.parentIdentityDigest
            )
              reject("held");
          });
        },
        catch: (failure) => failure,
      }),
    );
  const invalidate = (reason) =>
    Effect.try({
      try: () => {
        identifier(reason);
        hold(`invalidate:${reason}`);
        leases.close();
        handoffs.close();
      },
      catch: (failure) => failure,
    });
  // Runtime inventory checks are observational: a failed check is recorded as a
  // diagnostic and the original value passes through; it never fails the
  // plugin/tool pipeline. Build-time source declarations stay strict.
  const passThroughSync = new Set([
    "inventoryToolCopy",
    "inventoryReadCopy",
    "inventoryMutation",
    "inventoryStateReplay",
    "inventoryTransformReplay",
    "inventoryToolReplay",
    "inventoryStateUncertain",
  ]);
  const passThroughValue = new Set([
    "inventoryToolCopy",
    "inventoryReadCopy",
    "inventoryToolResolve",
    "inventoryReadResolve",
  ]);
  const tolerant =
    (name, fn) =>
    (...args) => {
      const fallback = passThroughValue.has(name) ? args[2] : undefined;
      const swallow = (failure) => {
        diagnose({
          kind: "inventory-diagnostic",
          step: name,
          code: String(failure?.message ?? failure).slice(0, 80),
        });
        return fallback;
      };
      let out;
      try {
        out = fn(...args);
      } catch (failure) {
        return passThroughSync.has(name)
          ? swallow(failure)
          : Effect.succeed(swallow(failure));
      }
      return Effect.isEffect(out)
        ? Effect.catch(out, (failure) => Effect.succeed(swallow(failure)))
        : out;
    };
  const strictInventory = new Set([
    "inventoryConfigure",
    "inventoryToolSource",
    "inventoryHookSource",
    "inventorySetupSource",
    "inventoryReadSource",
    "inventoryStateDomain",
    "inventoryLookup",
    "inventorySnapshot",
    "inventoryGuard",
  ]);
  const api = {
    transaction,
    inspect,
    assertExecution,
    invalidate,
    prepareTask,
    armBootstrap,
    revokeBootstrap,
    consumeBootstrap,
    enterBootstrap,
    admitLease,
    bindNativeReadRuntime,
    readNativeFile,
    // Execution phase (step D) must call this with the running lease's
    // location directory before admitting any tool file effect (edit, write,
    // patch) and on formatter-output paths; permission rules alone are
    // lexical and case-sensitive.
    assertNotVcsMetadataPath: (directory, path) =>
      Effect.tryPromise({
        try: () => assertNotVcsMetadataPath(directory, path),
        catch: (failure) => failure,
      }),
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
          hold("close_roots");
          leases.close();
          handoffs.close();
          // Revoke checks first; await original candidate IO and physical
          // close before the acquired Control scope can report settlement.
          await Promise.allSettled([...bootstrapTasks]);
          const results = await Promise.allSettled(
            [...locations.values()].map(closeRoot),
          );
          const failures = results.filter((row) => row.status === "rejected");
          if (failures.length || bootstrapCloseFailures.length)
            throw new AggregateError(
              [...failures.map((row) => row.reason), ...bootstrapCloseFailures],
              "native_permission_root_close_unverified",
            );
        }),
      ),
    locationFinalizing,
    locationScopeObserved,
    locationSnapshot,
    bindAgentNotificationSource,
    bindDiagnostic,
    captureAgentNotificationListeners,
    inventoryConfigure,
    inventoryToolSource,
    inventoryHookSource,
    inventorySetupSource,
    inventoryStateDomain,
    inventorySetupRun,
    inventoryStateBegin,
    inventoryStateRegister,
    inventoryStateRegistered,
    inventoryStateReplay,
    inventoryStateUncertain,
    inventoryHookPublication,
    inventoryTransformPublication,
    inventoryTransformMetadata,
    inventoryTransformReplay,
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
  };
  for (const [name, fn] of Object.entries(api))
    if (!strict && name.startsWith("inventory") && !strictInventory.has(name))
      api[name] = tolerant(name, fn);
  return Service.of(Object.freeze(api));
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
