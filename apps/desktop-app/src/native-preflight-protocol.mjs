import { isAbsolute } from "node:path";
import { TextDecoder } from "node:util";

export const PREFLIGHT_LIMITS = Object.freeze({
  requestBytes: 65536,
  responseBytes: 131072,
  sessions: 200,
  messages: 10000,
  messageBytes: 1048576,
  messageTotalBytes: 67108864,
  deadlineMs: 20000,
  pathBytes: 8192,
  migrations: 48,
  cancellationGraceMs: 1000,
});
export const isPreflightId = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
export const isPreflightDigest = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export const isPreflightPath = (value) =>
  typeof value === "string" &&
  !value.includes("\0") &&
  Buffer.byteLength(value) <= PREFLIGHT_LIMITS.pathBytes &&
  isAbsolute(value);
export function preflightAssert(condition) {
  if (!condition) throw new Error("invalid_preflight");
}
export function assertClosedObject(value, required, optional = []) {
  preflightAssert(
    value !== null && typeof value === "object" && !Array.isArray(value),
  );
  preflightAssert(
    Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null,
  );
  const keys = Reflect.ownKeys(value);
  preflightAssert(
    required.every((key) => Object.hasOwn(value, key)) &&
      keys.every((key) => required.includes(key) || optional.includes(key)),
  );
  preflightAssert(
    keys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor?.enumerable === true && descriptor.value !== undefined;
    }),
  );
}
function boundedJson(value, max) {
  const text = JSON.stringify(value);
  preflightAssert(
    typeof text === "string" && Buffer.byteLength(text) + 1 <= max,
  );
}
// Sessions that an unsettled bootstrap create MAY have produced (crash
// reconciliation). Each is validated with the same root-session rules as a
// mapping and bound to its original operation, but its presence is optional.
const PROVISIONAL_MAX = 16;
const PROVISIONAL_FIELDS = [
  "appSessionId",
  "nativeSessionId",
  "workspaceId",
  "canonicalPath",
  "operationId",
  "originalRuntimeEpoch",
  "digest",
];
function validateRequest(value) {
  assertClosedObject(
    value,
    ["version", "nonce", "database", "mappings"],
    ["provisional", "provisionalForks"],
  );
  preflightAssert(
    value.version === 1 &&
      isPreflightDigest(value.nonce) &&
      isPreflightPath(value.database),
  );
  preflightAssert(
    Array.isArray(value.mappings) &&
      value.mappings.length <= PREFLIGHT_LIMITS.sessions,
  );
  const appIds = new Set();
  const nativeIds = new Set();
  for (const mapping of value.mappings) {
    assertClosedObject(
      mapping,
      ["appSessionId", "nativeSessionId", "workspaceId", "canonicalPath"],
      ["parentAppSessionId"],
    );
    preflightAssert(
      isPreflightId(mapping.appSessionId) &&
        isPreflightId(mapping.nativeSessionId) &&
        isPreflightId(mapping.workspaceId) &&
        isPreflightPath(mapping.canonicalPath),
    );
    preflightAssert(
      !appIds.has(mapping.appSessionId) &&
        !nativeIds.has(mapping.nativeSessionId),
    );
    appIds.add(mapping.appSessionId);
    nativeIds.add(mapping.nativeSessionId);
  }
  if (Object.hasOwn(value, "provisional")) {
    preflightAssert(
      Array.isArray(value.provisional) &&
        value.provisional.length >= 1 &&
        value.provisional.length <= PROVISIONAL_MAX,
    );
    // Separate id sets: a mapped fork's parent must itself be a real mapping.
    const provisionalApp = new Set(appIds);
    const provisionalNative = new Set(nativeIds);
    for (const entry of value.provisional) {
      assertClosedObject(entry, PROVISIONAL_FIELDS);
      preflightAssert(
        [
          "appSessionId",
          "nativeSessionId",
          "workspaceId",
          "operationId",
          "originalRuntimeEpoch",
        ].every((key) => isPreflightId(entry[key])) &&
          isPreflightPath(entry.canonicalPath) &&
          isPreflightDigest(entry.digest),
      );
      preflightAssert(
        !provisionalApp.has(entry.appSessionId) &&
          !provisionalNative.has(entry.nativeSessionId),
      );
      provisionalApp.add(entry.appSessionId);
      provisionalNative.add(entry.nativeSessionId);
    }
  }
  if (Object.hasOwn(value, "provisionalForks")) {
    // A fork child's Native id is unknown before it is read: the optional child
    // is described by its parent only, and is bound to a mapped parent.
    preflightAssert(
      Array.isArray(value.provisionalForks) &&
        value.provisionalForks.length >= 1 &&
        value.provisionalForks.length <= PROVISIONAL_MAX,
    );
    const taken = new Set([
      ...appIds,
      ...(value.provisional ?? []).map((entry) => entry.appSessionId),
    ]);
    for (const entry of value.provisionalForks) {
      assertClosedObject(entry, [
        "appSessionId",
        "workspaceId",
        "canonicalPath",
        "parentAppSessionId",
        "parentNativeSessionId",
      ]);
      preflightAssert(
        [
          "appSessionId",
          "workspaceId",
          "parentAppSessionId",
          "parentNativeSessionId",
        ].every((key) => isPreflightId(entry[key])) &&
          isPreflightPath(entry.canonicalPath) &&
          !taken.has(entry.appSessionId) &&
          value.mappings.some(
            (mapping) =>
              mapping.appSessionId === entry.parentAppSessionId &&
              mapping.nativeSessionId === entry.parentNativeSessionId &&
              mapping.workspaceId === entry.workspaceId,
          ),
      );
      taken.add(entry.appSessionId);
    }
  }
  for (const mapping of value.mappings) {
    if (Object.hasOwn(mapping, "parentAppSessionId"))
      preflightAssert(
        isPreflightId(mapping.parentAppSessionId) &&
          appIds.has(mapping.parentAppSessionId) &&
          mapping.parentAppSessionId !== mapping.appSessionId,
      );
  }
  boundedJson(value, PREFLIGHT_LIMITS.requestBytes);
  return value;
}
export function validatePreflightRequest(value) {
  try {
    return validateRequest(value);
  } catch {
    throw new Error("invalid_preflight");
  }
}
function validateDecision(value, nonce) {
  assertClosedObject(value, [
    "version",
    "nonce",
    "allowed",
    "reason",
    "counts",
    "correlations",
  ]);
  preflightAssert(
    value.version === 1 &&
      isPreflightDigest(nonce) &&
      value.nonce === nonce &&
      typeof value.allowed === "boolean",
  );
  const bounds = {
    sessions: 201,
    messages: 10001,
    pending: 1,
    inbox: 1,
    kv: 1,
    migrations: 49,
  };
  assertClosedObject(value.counts, Object.keys(bounds));
  for (const [key, max] of Object.entries(bounds))
    preflightAssert(
      Number.isSafeInteger(value.counts[key]) &&
        value.counts[key] >= 0 &&
        value.counts[key] <= max,
    );
  preflightAssert(
    Array.isArray(value.correlations) &&
      value.correlations.length <= PREFLIGHT_LIMITS.sessions,
  );
  if (value.allowed) {
    preflightAssert(
      value.reason === null &&
        value.counts.sessions <= PREFLIGHT_LIMITS.sessions &&
        value.counts.messages <= PREFLIGHT_LIMITS.messages &&
        value.counts.pending === 0 &&
        value.counts.inbox === 0 &&
        value.counts.kv === 0 &&
        value.counts.migrations === PREFLIGHT_LIMITS.migrations &&
        value.correlations.length <= value.counts.sessions,
    );
  } else {
    preflightAssert(
      ["pending_inbox", "native_startup_unverified"].includes(value.reason) &&
        value.correlations.length === 0,
    );
  }
  const appIds = new Set();
  const nativeIds = new Set();
  for (const correlation of value.correlations) {
    assertClosedObject(correlation, [
      "nativeSessionId",
      "appSessionId",
      "workspaceId",
      "runtimeEpoch",
      "operationId",
      "digest",
    ]);
    preflightAssert(
      [
        "nativeSessionId",
        "appSessionId",
        "workspaceId",
        "runtimeEpoch",
        "operationId",
      ].every((key) => isPreflightId(correlation[key])) &&
        isPreflightDigest(correlation.digest),
    );
    preflightAssert(
      !appIds.has(correlation.appSessionId) &&
        !nativeIds.has(correlation.nativeSessionId),
    );
    appIds.add(correlation.appSessionId);
    nativeIds.add(correlation.nativeSessionId);
  }
  boundedJson(value, PREFLIGHT_LIMITS.responseBytes);
  return value;
}
export function validatePreflightDecision(value, nonce) {
  try {
    return validateDecision(value, nonce);
  } catch {
    throw new Error("invalid_preflight");
  }
}

// stdin remains open as a lifetime signal after the one accepted newline frame.
export function createPreflightRequestDecoder({ onRequest, onCancel }) {
  let buffers = [];
  let bytes = 0;
  let accepted = false;
  let cancelled = false;
  function cancel() {
    if (cancelled) return;
    cancelled = true;
    buffers = [];
    onCancel();
  }
  return {
    push(chunk) {
      if (cancelled) return;
      if (
        !Buffer.isBuffer(chunk) ||
        accepted ||
        bytes + chunk.length > PREFLIGHT_LIMITS.requestBytes
      )
        return cancel();
      bytes += chunk.length;
      const newline = chunk.indexOf(10);
      if (newline !== -1 && newline !== chunk.length - 1) return cancel();
      buffers.push(chunk);
      if (newline === -1) return;
      try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(
          Buffer.concat(buffers, bytes).subarray(0, bytes - 1),
        );
        const request = validatePreflightRequest(JSON.parse(text));
        accepted = true;
        buffers = [];
        onRequest(request);
      } catch {
        cancel();
      }
    },
    end: cancel,
    error: cancel,
  };
}
