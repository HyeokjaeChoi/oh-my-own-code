// Private bookkeeping only. Admission to this registry does not authorize work.
import { randomUUID } from "node:crypto";
import { types } from "node:util";
import { Effect } from "effect";
import {
  identifier,
  record,
  text,
} from "./native-permission-control-input.mjs";
import { createNativeTaskObserver } from "./native-permission-task-observer.mjs";
import { createNativeOriginScopes } from "./native-permission-origin-scopes.mjs";

const kinds = new Set([
  "coordinator",
  "direct_tool",
  "shell",
  "background",
  "move_commit",
  "plugin_transition",
  "filesystem",
]);
const fields = [
  "scope",
  "projectId",
  "locationIncarnation",
  "sessionId",
  "kind",
  "modeGeneration",
  "inventoryGeneration",
  "parentLeaseId",
];
const inherited = [
  "executionScopeId",
  "scopeVersion",
  "projectId",
  "locationIncarnation",
  "modeGeneration",
  "inventoryGeneration",
];
const fail = (code) => {
  throw new Error(`native_permission_lease_${code}`);
};
const positive = (value) => {
  if (!Number.isSafeInteger(value) || value <= 0) fail("input");
  return value;
};

export function createNativeLeaseRegistry(input) {
  const { runtimeEpoch } = record(input, ["runtimeEpoch"]);
  identifier(runtimeEpoch);
  const origins = createNativeOriginScopes({ runtimeEpoch });
  const observer = createNativeTaskObserver({ runtimeEpoch });
  const handles = new WeakMap();
  const entries = new Map();
  const fibers = new WeakSet();
  let closed = false;

  const entryFor = (handle) => {
    if (!handle || typeof handle !== "object" || types.isProxy(handle))
      fail("handle");
    const entry = handles.get(handle);
    if (!entry) fail("handle");
    return entry;
  };
  const active = (handle) => {
    const entry = entryFor(handle);
    if (
      closed ||
      entry.row.state === "settled" ||
      entry.row.state === "unverified"
    )
      fail("inactive");
    return entry;
  };
  const view = (entry) => Object.freeze({ ...entry.row });
  const taskEnded = (entry) => !!entry.fiber?.pollUnsafe();
  const admit = (input) => {
    if (closed) fail("closed");
    const { scope, ...identity } = record(input, fields);
    const scopeRow = origins.assertCurrent(scope);
    const constraints = origins.constraints(scope);
    if (
      Object.keys(constraints).some((key) => identity[key] !== constraints[key])
    )
      fail("scope");
    identity.executionScopeId = scopeRow.executionScopeId;
    identity.scopeVersion = scopeRow.version;
    for (const key of ["projectId", "locationIncarnation", "sessionId"])
      text(identity[key]);
    if (!kinds.has(identity.kind)) fail("input");
    positive(identity.modeGeneration);
    positive(identity.inventoryGeneration);
    let parent;
    if (identity.parentLeaseId !== null) {
      identifier(identity.parentLeaseId);
      parent = entries.get(identity.parentLeaseId);
      if (!parent || parent.row.state !== "running" || taskEnded(parent))
        fail("parent");
      if (parent.children.size >= 32) fail("capacity");
      if (inherited.some((key) => identity[key] !== parent.row[key]))
        fail("lineage");
    }
    if (entries.size >= 8192) fail("capacity");
    const leaseId = randomUUID();
    const handle = Object.freeze({
      toJSON() {
        fail("handle");
      },
    });
    const entry = {
      handle,
      row: { runtimeEpoch, leaseId, ...identity, state: "admitted" },
      children: new Set(),
      fiber: undefined,
      proof: undefined,
      observationToken: Object.freeze(Object.create(null)),
      scope,
    };
    handles.set(handle, entry);
    entries.set(leaseId, entry);
    parent?.children.add(leaseId);
    return handle;
  };
  const start = (handle, fiber) => {
    const entry = active(handle);
    origins.assertCurrent(entry.scope);
    if (
      entry.row.state !== "admitted" ||
      !fiber ||
      typeof fiber !== "object" ||
      types.isProxy(fiber) ||
      fibers.has(fiber)
    )
      fail("task");
    // The observer validates concrete pinned runtime provenance synchronously.
    // Register before checking exit, so no end event can slip through binding.
    const observed = observer.observe(entry.observationToken, fiber);
    // Poll is the actual runtime Fiber exit, never a UI/session status.
    if (fiber.pollUnsafe()) {
      entry.row.state = "unverified";
      fail("task");
    }
    entry.fiber = fiber;
    entry.observed = observed;
    fibers.add(fiber);
    entry.row.state = "running";
  };
  const capture = (handle) =>
    Effect.suspend(() => {
      const entry = active(handle);
      origins.assertCurrent(entry.scope);
      if (entry.row.state !== "admitted")
        return Effect.fail(new Error("native_permission_lease_task"));
      return observer.capture(entry.observationToken);
    });
  const reserve = (handle, kind) => {
    const entry = active(handle);
    origins.assertCurrent(entry.scope);
    if (entry.row.state !== "admitted" || entry.fiber) fail("reservation");
    return observer.reserve(entry.observationToken, kind);
  };
  const observe = (handle) => {
    const entry = active(handle);
    if (!entry.fiber) fail("task");
    return entry.observed;
  };
  const settle = (handle, proof) => {
    const entry = entryFor(handle);
    if (closed || entry.row.state === "unverified") fail("inactive");
    if (entry.row.state === "settled") {
      if (entry.proof !== proof) fail("proof");
      return true;
    }
    if (!entry.fiber || !taskEnded(entry)) fail("task");
    const facts = observer.proofFor(proof, entry.observationToken);
    if (facts.runtimeEpoch !== runtimeEpoch) fail("proof");
    if (!facts.complete) {
      entry.proof = proof;
      entry.row.state = "unverified";
      return false;
    }
    // A finished foreground Fiber does not imply its background lineage ended.
    if (
      [...entry.children].some((id) => entries.get(id).row.state !== "settled")
    )
      return false;
    entry.proof = proof;
    entry.row.state = "settled";
    return true;
  };
  const cancel = (handle) => {
    const entry = active(handle);
    entry.row.state = "cancelling";
    // This is intent only; the existing executor owns interruption/termination.
  };
  const close = () => {
    if (closed) return;
    closed = true;
    origins.close();
    observer.close();
    for (const entry of entries.values()) {
      if (entry.row.state !== "settled") entry.row.state = "unverified";
    }
  };
  return Object.freeze({
    origins,
    admit,
    capture,
    start,
    reserve,
    bindProcess: observer.bindProcess,
    bindIO: observer.bindIO,
    observe,
    settle,
    cancel,
    advanceScope: (handle, scope) => {
      const entry = active(handle);
      if (entry.row.state !== "running" || taskEnded(entry)) fail("task");
      const current = origins.assertCurrent(scope);
      const constraints = origins.constraints(scope);
      if (
        current.executionScopeId !== entry.row.executionScopeId ||
        current.version <= entry.row.scopeVersion ||
        Object.keys(constraints).some(
          (key) => entry.row[key] !== constraints[key],
        )
      )
        fail("scope");
      // An existing child keeps the exact origin snapshot captured at birth.
      // Catching up to a newer parent version would relabel its earlier task.
      if (entry.row.parentLeaseId !== null) fail("lineage");
      entry.scope = scope;
      entry.row.scopeVersion = current.version;
      return view(entry);
    },
    inspect: (handle) => view(entryFor(handle)),
    snapshot: (projectId) => {
      text(projectId);
      return Object.freeze(
        [...entries.values()]
          .filter((e) => e.row.projectId === projectId)
          .map(view),
      );
    },
    close,
  });
}
