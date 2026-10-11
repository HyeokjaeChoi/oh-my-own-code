// Private runtime bookkeeping only. Registration is not Main journal proof or
// execution authority. Native input/task wiring must still verify both.
import { randomUUID } from "node:crypto";
import { types } from "node:util";
import { permissionCanonicalJSON } from "./permission-control-canonical.mjs";
import {
  array,
  identifier,
  record,
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
  const body = record(JSON.parse(permissionCanonicalJSON(input)), [
    "origin",
    ...ownerFields,
    ...constraintFields,
    "inputDigest",
  ]);
  body.origin = record(body.origin, ["runtimeEpoch", "operationId", "digest"]);
  identifier(body.origin.runtimeEpoch);
  identifier(body.origin.operationId);
  if (body.origin.runtimeEpoch !== runtimeEpoch) fail("epoch");
  digest(body.origin.digest);
  digest(body.inputDigest);
  for (const key of [...ownerFields, "projectId", "locationIncarnation"])
    identifier(body[key]);
  positive(body.modeGeneration);
  positive(body.inventoryGeneration);
  Object.freeze(body.origin);
  return Object.freeze(body);
};

export function createNativeOriginScopes(input) {
  const { runtimeEpoch } = record(input, ["runtimeEpoch"]);
  identifier(runtimeEpoch);
  const origins = new Map();
  const originHandles = new WeakMap();
  const inputs = new Map();
  const inputHandles = new WeakMap();
  const scopes = new Map();
  const scopeHandles = new WeakMap();
  let versions = 0;
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
    return entry;
  };
  const scopeFor = (handle) => owned(scopeHandles, handle);
  const assertUsable = (handle) => {
    open();
    const entry = scopeFor(handle);
    if (entry.origins.some((origin) => origin.revoked)) fail("revoked");
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
    if (origins.size >= MAX_ENTRIES) fail("capacity");
    const entry = { key, binding, revoked: false, scopeId: undefined };
    const handle = opaque();
    origins.set(key, entry);
    originHandles.set(handle, entry);
    return handle;
  };
  const bindInbox = (origin, input) => {
    const entry = originFor(origin);
    const { nativeSessionId, inboxId } = record(input, [
      "nativeSessionId",
      "inboxId",
    ]);
    identifier(nativeSessionId);
    identifier(inboxId);
    if (
      nativeSessionId !== entry.binding.nativeSessionId ||
      !inboxId.startsWith("msg_")
    )
      fail("scope");
    if (inputs.has(inboxId)) fail("conflict");
    if (inputs.size >= MAX_ENTRIES) fail("capacity");
    const handle = opaque();
    const item = {
      origin: entry,
      row: Object.freeze({
        nativeSessionId,
        inboxId,
        originalOperationKey: entry.key,
      }),
      consumed: false,
    };
    inputs.set(inboxId, item);
    inputHandles.set(handle, item);
    return handle;
  };
  const selectedInputs = (inboxes) => {
    const chosen = array(inboxes, MAX_INPUTS).map((handle) =>
      owned(inputHandles, handle),
    );
    if (new Set(chosen).size !== chosen.length) fail("duplicate");
    if (chosen.some((item) => item.consumed)) fail("replay");
    if (chosen.some((item) => item.origin.revoked)) fail("revoked");
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
    for (const item of chosen) item.consumed = true;
    scope.current = handle;
    scopes.set(scope.id, scope);
    versions++;
    return handle;
  };
  const createScope = (input) => {
    open();
    const { cause, inboxes } = record(input, ["cause", "inboxes"]);
    const entry = originFor(cause);
    if (entry.scopeId) fail("replay");
    const chosen = selectedInputs(inboxes);
    if (scopes.size >= MAX_ENTRIES) fail("capacity");
    const scope = { id: randomUUID(), cause: entry, current: undefined };
    return publishVersion(scope, chosen);
  };
  const promote = (handle, inboxes) => {
    assertCurrent(handle);
    const previous = scopeFor(handle);
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
          state: closed || entry.revoked ? "revoked" : "registered",
          binding: entry.binding,
        })
      : undefined;
  };
  const close = () => {
    closed = true;
  };
  return Object.freeze({
    admit,
    bindInbox,
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
