// Private runtime bookkeeping only. Registration is not Main journal proof or
// execution authority. Native input/task wiring must still verify both.
import { randomUUID } from "node:crypto";
import { types } from "node:util";
import { permissionCanonicalJSON } from "./permission-control-canonical.mjs";
import {
  array,
  identifier,
  record,
  text,
} from "./native-permission-control-input.mjs";

const MAX_ENTRIES = 8192;
const MAX_ORIGINS = 256;
const MAX_INPUTS = 1024;
const fail = (code) => {
  throw new Error(`native_permission_origin_${code}`);
};
const constraintFields = [
  "projectId",
  "locationIncarnation",
  "locationId",
  "modeGeneration",
  "inventoryGeneration",
];
const ownerFields = ["workspaceId", "appSessionId", "nativeSessionId"];
const positive = (value) => {
  if (!Number.isSafeInteger(value) || value <= 0) fail("input");
};
const digest = (value) => {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value))
    fail("input");
};
const keyFor = (origin) =>
  JSON.stringify([origin.runtimeEpoch, origin.operationId]);
const compare = (a, b) =>
  Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
const opaque = () =>
  Object.freeze({
    toJSON() {
      fail("handle");
    },
  });
const copyBinding = (input, runtimeEpoch) => {
  const detached = JSON.parse(permissionCanonicalJSON(input));
  const variantFields = {
    prompt: ["inputDigest"],
    command: ["bindingDigest"],
    bootstrap: ["bindingDigest", "reservation"],
    mutation: [
      "targetKind",
      "bindingDigest",
      "method",
      "affectedSessionIds",
      "affectedProjectIds",
    ],
  };
  if (!Object.hasOwn(variantFields, detached.originKind)) fail("input");
  const workspaceMutation =
    detached.originKind === "mutation" && detached.targetKind === "workspace";
  const requiredOwnerFields =
    detached.originKind === "bootstrap" || workspaceMutation
      ? ["workspaceId"]
      : ownerFields;
  const body = record(detached, [
    "origin",
    "originKind",
    "taskScopeId",
    ...requiredOwnerFields,
    ...constraintFields,
    ...variantFields[detached.originKind],
  ]);
  body.origin = record(body.origin, [
    "runtimeEpoch",
    "operationId",
    "type",
    "digest",
  ]);
  identifier(body.origin.runtimeEpoch);
  identifier(body.origin.operationId);
  if (body.origin.runtimeEpoch !== runtimeEpoch) fail("epoch");
  digest(body.origin.digest);
  text(body.origin.type, 128);
  const bootstrapTypes = [
    "workspace.create",
    "workspace.import",
    "session.create",
    "session.fork",
  ];
  if (
    body.originKind === "prompt"
      ? body.origin.type !== "message.send"
      : body.originKind === "command"
        ? body.origin.type !== "command.run"
        : body.originKind === "bootstrap"
          ? !bootstrapTypes.includes(body.origin.type)
          : ["message.send", "command.run", ...bootstrapTypes].includes(
              body.origin.type,
            )
  )
    fail("input");
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(
      body.taskScopeId,
    )
  )
    fail("input");
  digest(body.originKind === "prompt" ? body.inputDigest : body.bindingDigest);
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(
      body.locationId,
    )
  )
    fail("input");
  if (body.originKind === "bootstrap") {
    body.reservation = record(body.reservation, [
      "kind",
      "step",
      "reservationDigest",
      "parentIdentityDigest",
    ]);
    if (
      body.reservation.kind !== "bootstrap" ||
      !["native.create", "native.fork"].includes(body.reservation.step)
    )
      fail("input");
    digest(body.reservation.reservationDigest);
    if (body.reservation.step === "native.fork")
      digest(body.reservation.parentIdentityDigest);
    else if (body.reservation.parentIdentityDigest !== null) fail("input");
    if (
      (body.origin.type === "session.fork") !==
      (body.reservation.step === "native.fork")
    )
      fail("input");
    Object.freeze(body.reservation);
  }
  if (body.originKind === "mutation") {
    if (!["session", "workspace"].includes(body.targetKind)) fail("input");
    text(body.method, 128);
    for (const field of ["affectedSessionIds", "affectedProjectIds"]) {
      const ids = array(body[field], 256);
      if (
        ((!workspaceMutation || field === "affectedProjectIds") &&
          !ids.length) ||
        new Set(ids).size !== ids.length
      )
        fail("input");
      ids.forEach(identifier);
      body[field] = Object.freeze(ids);
    }
    if (
      !body.affectedProjectIds.includes(body.projectId) ||
      (!workspaceMutation &&
        !body.affectedSessionIds.includes(body.nativeSessionId))
    )
      fail("scope");
  }
  for (const key of [
    ...requiredOwnerFields,
    "projectId",
    "locationIncarnation",
  ])
    identifier(body[key]);
  positive(body.modeGeneration);
  positive(body.inventoryGeneration);
  Object.freeze(body.origin);
  return Object.freeze(body);
};

export function createNativeOriginScopes(input, bindLifetime = () => {}) {
  const { runtimeEpoch } = record(input, ["runtimeEpoch"]);
  identifier(runtimeEpoch);
  const origins = new Map();
  const originHandles = new WeakMap();
  const taskScopeIds = new Set();
  const inputs = new Map();
  const inputHandles = new WeakMap();
  const reservations = new WeakMap();
  const completions = new WeakMap();
  const leaseOwners = new Map();
  const scopes = new Map();
  const scopeHandles = new WeakMap();
  let versions = 0;
  let reservationCount = 0;
  let closed = false;
  const open = () => {
    if (closed) fail("closed");
  };
  const owned = (handles, handle) => {
    if (!handle || typeof handle !== "object" || types.isProxy(handle))
      fail("handle");
    const entry = handles.get(handle);
    if (!entry) fail("handle");
    return entry;
  };
  const originFor = (handle) => {
    open();
    const entry = owned(originHandles, handle);
    if (entry.revoked) fail("revoked");
    if (entry.state !== "open") fail("settled");
    return entry;
  };
  const scopeFor = (handle) => owned(scopeHandles, handle);
  const assertUsable = (handle) => {
    open();
    const entry = scopeFor(handle);
    if (entry.origins.some((origin) => origin.revoked)) fail("revoked");
    if (entry.origins.some((origin) => origin.state !== "open"))
      fail("settled");
    return entry.row;
  };
  const assertCurrent = (handle) => {
    const row = assertUsable(handle);
    if (scopes.get(row.executionScopeId).current !== handle) fail("stale");
    return row;
  };
  const admit = (input) => {
    open();
    const binding = copyBinding(input, runtimeEpoch);
    const key = keyFor(binding.origin);
    const previous = origins.get(key);
    if (previous) {
      if (
        permissionCanonicalJSON(previous.binding) !==
        permissionCanonicalJSON(binding)
      )
        fail("conflict");
      fail("duplicate");
    }
    if (taskScopeIds.has(binding.taskScopeId)) fail("conflict");
    if (origins.size >= MAX_ENTRIES) fail("capacity");
    const entry = {
      key,
      binding,
      revoked: false,
      scopeId: undefined,
      state: "open",
      inputs: new Set(),
      reservations: new Set(),
      leases: new Set(),
      completedReservations: 0,
      session: undefined,
    };
    const handle = opaque();
    taskScopeIds.add(binding.taskScopeId);
    origins.set(key, entry);
    originHandles.set(handle, entry);
    return handle;
  };
  const bindInput = (origin, input, syntheticLeaseId = null) => {
    const entry = originFor(origin);
    const prompt =
      entry.binding.originKind === "prompt" && syntheticLeaseId === null;
    const row = record(
      input,
      prompt
        ? ["nativeSessionId", "inboxId"]
        : ["nativeSessionId", "inboxId", "inputDigest", "source"],
    );
    const { nativeSessionId, inboxId } = row;
    if (!prompt) {
      digest(row.inputDigest);
      if (syntheticLeaseId !== null) {
        if (
          !["prompt", "command"].includes(entry.binding.originKind) ||
          row.source !== "synthetic_child"
        )
          fail("scope");
      } else {
        if (
          entry.binding.originKind !== "command" ||
          row.source !== "command_expansion"
        )
          fail("scope");
        if (![...entry.reservations].some((slot) => slot.kind === "expansion"))
          fail("reservation");
      }
    }
    identifier(nativeSessionId);
    identifier(inboxId);
    if (
      nativeSessionId !== entry.binding.nativeSessionId ||
      !inboxId.startsWith("msg_")
    )
      fail("scope");
    if (inputs.has(inboxId)) fail("conflict");
    if (inputs.size >= MAX_ENTRIES || entry.inputs.size >= MAX_INPUTS)
      fail("capacity");
    const handle = opaque();
    const item = {
      origin: entry,
      row: Object.freeze({
        nativeSessionId,
        inboxId,
        originalOperationKey: entry.key,
        inputDigest: prompt ? entry.binding.inputDigest : row.inputDigest,
        source: prompt ? "prompt" : row.source,
        parentLeaseId: syntheticLeaseId,
      }),
      state: "pending",
      carriers: new Set(),
    };
    entry.inputs.add(item);
    inputs.set(inboxId, item);
    inputHandles.set(handle, item);
    return handle;
  };
  const bindInbox = (origin, input) => bindInput(origin, input);
  const bindSyntheticInbox = (scope, origin, input, leaseId) => {
    assertUsable(scope);
    const entry = originFor(origin);
    if (!scopeFor(scope).origins.includes(entry)) fail("lineage");
    return bindInput(origin, input, leaseId);
  };
  const selectedInputs = (inboxes) => {
    const chosen = array(inboxes, MAX_INPUTS).map((handle) =>
      owned(inputHandles, handle),
    );
    if (new Set(chosen).size !== chosen.length) fail("duplicate");
    if (chosen.some((item) => item.state !== "pending")) fail("replay");
    if (chosen.some((item) => item.cancellation)) fail("cancelling");
    if (chosen.some((item) => item.origin.revoked)) fail("revoked");
    if (chosen.some((item) => item.origin.state !== "open")) fail("settled");
    return chosen;
  };
  const publishVersion = (scope, chosen, previous) => {
    if (versions >= MAX_ENTRIES) fail("capacity");
    const selectedOrigins = new Map(
      previous?.origins.map((origin) => [origin.key, origin]) ?? [
        [scope.cause.key, scope.cause],
      ],
    );
    for (const item of chosen) {
      const binding = item.origin.binding;
      if (
        [...constraintFields, ...ownerFields].some(
          (key) => binding[key] !== scope.cause.binding[key],
        )
      )
        fail("scope");
      selectedOrigins.set(item.origin.key, item.origin);
    }
    if (selectedOrigins.size > MAX_ORIGINS) fail("capacity");
    const originRows = [...selectedOrigins.values()].sort((a, b) =>
      compare(a.key, b.key),
    );
    if (
      originRows.some((origin) => origin.scopeId && origin.scopeId !== scope.id)
    )
      fail("replay");
    const promoted = [...(previous?.inputs ?? []), ...chosen];
    if (promoted.length > MAX_INPUTS) fail("capacity");
    promoted.sort((a, b) =>
      compare(
        JSON.stringify([a.row.nativeSessionId, a.row.inboxId]),
        JSON.stringify([b.row.nativeSessionId, b.row.inboxId]),
      ),
    );
    const row = Object.freeze({
      executionScopeId: scope.id,
      version: (previous?.row.version ?? 0) + 1,
      origins: Object.freeze(originRows.map((origin) => origin.binding.origin)),
      promotedInputs: Object.freeze(promoted.map((item) => item.row)),
    });
    // Check the detached response bound before ANY registry state changes.
    permissionCanonicalJSON(row);
    const handle = opaque();
    scopeHandles.set(handle, {
      row,
      origins: originRows,
      inputs: promoted,
      scope,
    });
    for (const origin of originRows) origin.scopeId = scope.id;
    for (const item of chosen) {
      item.state = "promoted";
      item.scopeId = scope.id;
      item.scopeVersion = row.version;
    }
    scope.current = handle;
    scopes.set(scope.id, scope);
    versions++;
    return handle;
  };
  const createScope = (input) => {
    open();
    const { cause, inboxes } = record(input, ["cause", "inboxes"]);
    const entry = originFor(cause);
    if (entry.binding.originKind === "bootstrap") fail("boot_held");
    // Workspace mutation lifetime uses concrete original RPC/IO reservations.
    // It cannot borrow a session or mint a session-bound execution scope.
    if (
      entry.binding.originKind === "mutation" &&
      entry.binding.targetKind === "workspace"
    )
      fail("workspace_held");
    if (entry.scopeId) fail("replay");
    const chosen = selectedInputs(inboxes);
    if (entry.binding.originKind === "mutation" && chosen.length) fail("scope");
    if (scopes.size >= MAX_ENTRIES) fail("capacity");
    const scope = { id: randomUUID(), cause: entry, current: undefined };
    return publishVersion(scope, chosen);
  };
  const promote = (handle, inboxes) => {
    assertCurrent(handle);
    const previous = scopeFor(handle);
    if (previous.scope.cause.binding.originKind === "mutation") fail("scope");
    const chosen = selectedInputs(inboxes);
    if (!chosen.length) fail("input");
    return publishVersion(previous.scope, chosen, previous);
  };
  const inspect = (handle) => scopeFor(handle).row;
  const constraints = (handle) => {
    const binding = scopeFor(handle).scope.cause.binding;
    return Object.freeze(
      Object.fromEntries(constraintFields.map((key) => [key, binding[key]])),
    );
  };
  const revoke = (handle) => {
    open();
    owned(originHandles, handle).revoked = true;
  };
  const lookup = (key) => {
    if (typeof key !== "string") fail("input");
    const entry = origins.get(key);
    return entry
      ? Object.freeze({
          state:
            closed || entry.revoked
              ? "revoked"
              : entry.state === "settled"
                ? "settled"
                : "registered",
          binding: entry.binding,
        })
      : undefined;
  };
  // These are private transitions. The authenticated Native adapter must verify
  // actual removal/no-effect BEFORE cancellation; a transition is not evidence
  // of Native removal and grants no execution or durable task proof.
  const inspectInbox = (handle) => {
    const item = owned(inputHandles, handle);
    return Object.freeze({
      ...item.row,
      state: item.state,
      ...(item.scopeId
        ? { scopeId: item.scopeId, scopeVersion: item.scopeVersion }
        : {}),
    });
  };
  const cancelInbox = (handle, completion) => {
    open();
    const item = owned(inputHandles, handle);
    if (item.origin.state !== "open" || item.state !== "pending")
      fail("transition");
    const receipt = owned(completions, completion);
    if (receipt.input !== item || receipt.used) fail("proof");
    if (
      item.origin.reservations.size ||
      [...item.origin.leases].some((lease) => !lease.done)
    )
      fail("outstanding");
    receipt.used = true;
    item.state = "cancelled";
  };
  const settleInbox = (handle) => {
    open();
    const item = owned(inputHandles, handle);
    if (item.state !== "promoted") fail("transition");
    if (!item.carriers.size) fail("proof");
    if (
      item.origin.reservations.size ||
      [...item.origin.leases].some((lease) => !lease.done)
    )
      fail("outstanding");
    item.state = "settled";
  };
  const reserve = (origin, kind) => {
    const entry = originFor(origin);
    if (!["expansion", "child", "rpc", "handoff"].includes(kind)) fail("input");
    if (entry.binding.originKind === "mutation" && kind === "expansion")
      fail("scope");
    if (entry.reservations.size >= 32 || reservationCount >= MAX_ENTRIES)
      fail("capacity");
    const slot = { entry, kind, done: false };
    const handle = opaque();
    reservationCount++;
    reservations.set(handle, slot);
    entry.reservations.add(slot);
    return handle;
  };
  const releaseReservation = (handle) => {
    open();
    const slot = owned(reservations, handle);
    if (slot.done) fail("replay");
    slot.done = true;
    slot.entry.reservations.delete(slot);
    slot.entry.completedReservations++;
    if (slot.input) {
      const completion = opaque();
      completions.set(completion, { input: slot.input, used: false });
      return completion;
    }
    return undefined;
  };
  const reserveCancellation = (input) => {
    open();
    const item = owned(inputHandles, input);
    if (
      item.state !== "pending" ||
      item.cancellation ||
      item.origin.state !== "open" ||
      item.origin.revoked
    )
      fail("transition");
    if (item.origin.reservations.size >= 32 || reservationCount >= MAX_ENTRIES)
      fail("capacity");
    const slot = {
      entry: item.origin,
      input: item,
      kind: "cancellation",
      done: false,
    };
    item.cancellation = slot;
    const handle = opaque();
    reservations.set(handle, slot);
    reservationCount++;
    item.origin.reservations.add(slot);
    return handle;
  };
  const attachLease = (scope, token) => {
    assertUsable(scope);
    const entry = scopeFor(scope);
    let lease = leaseOwners.get(token);
    if (lease?.done) fail("settled");
    if (!lease) {
      lease = { done: false };
      leaseOwners.set(token, lease);
    }
    for (const origin of entry.origins) origin.leases.add(lease);
    for (const item of entry.inputs) item.carriers.add(lease);
  };
  const finishLease = (token) => {
    const lease = leaseOwners.get(token);
    if (!lease) fail("handle");
    lease.done = true;
  };
  const hasPending = (handle) =>
    scopeFor(handle).origins.some(
      (entry) =>
        entry.reservations.size ||
        [...entry.inputs].some((item) => item.state === "pending"),
    );
  const settleRoot = (handle) => {
    open();
    const entry = owned(originHandles, handle);
    if (entry.state !== "open") fail("settled");
    if (
      entry.reservations.size ||
      [...entry.inputs].some((item) =>
        ["pending", "promoted"].includes(item.state),
      ) ||
      [...entry.leases].some((lease) => !lease.done)
    )
      return false;
    // An empty origin is not proof of no effect. It must carry an observed lease
    // or an observed reservation. Main separately verifies durable no_effect.
    if (!entry.leases.size && !entry.completedReservations) return false;
    entry.state = "settled";
    return true;
  };
  const bindSession = (origin, input) => {
    const entry = originFor(origin);
    if (entry.binding.originKind !== "bootstrap" || entry.session)
      fail("scope");
    const actual = record(input, [
      "appSessionId",
      "nativeSessionId",
      "projectId",
      "locationId",
      "locationIncarnation",
    ]);
    for (const key of Object.keys(actual)) identifier(actual[key]);
    for (const key of ["projectId", "locationId", "locationIncarnation"])
      if (actual[key] !== entry.binding[key]) fail("scope");
    entry.session = Object.freeze(actual);
    return entry.session;
  };
  // Only the lease owner receives lifetime mutation capabilities. Public origin
  // bookkeeping cannot manufacture observed lease or reservation completion.
  bindLifetime(
    Object.freeze({
      reserve,
      reserveCancellation,
      releaseReservation,
      attachLease,
      finishLease,
      leaseFinished: (token) => leaseOwners.get(token)?.done === true,
      bindSyntheticInbox,
    }),
  );
  const close = () => {
    closed = true;
  };
  return Object.freeze({
    admit,
    bindInbox,
    inspectInbox,
    cancelInbox,
    settleInbox,
    hasPending,
    settleRoot,
    bindSession,
    createScope,
    promote,
    inspect,
    constraints,
    assertUsable,
    assertCurrent,
    revoke,
    lookup,
    close,
  });
}
