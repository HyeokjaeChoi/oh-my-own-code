// Private producer shape validation. A validated shape is not execution authority.
import { permissionCanonicalJSON } from "./permission-control-canonical.mjs";
import { validWireId } from "./wire-id.mjs";

const invalid = () => {
  throw new Error("permission_control_invalid_data");
};
const requireValue = (condition) => {
  if (!condition) invalid();
};
const modes = ["ask", "read_plan", "scoped_edit", "custom"];
const effects = ["deny", "ask", "allow"];
const reasons = [
  "inventory_unverified",
  "identity_unverified",
  "policy_unverified",
  "settlement_unverified",
  "unsupported_capability",
  "scope_unverified",
  "stale_preview",
  "expired_preview",
  "limit_exceeded",
  "runtime_unavailable",
];
const common = [
  "runtimeEpoch",
  "revision",
  "observationSequence",
  "workspaceId",
  "sessionId",
  "status",
];
const object = (value) =>
  requireValue(
    value !== null && typeof value === "object" && !Array.isArray(value),
  );
const closed = (value, fields, optional = []) => {
  object(value);
  requireValue(
    fields.every((field) => Object.hasOwn(value, field)) &&
      Object.keys(value).every(
        (field) => fields.includes(field) || optional.includes(field),
      ),
  );
};
const id = (value) => requireValue(validWireId(value));
const digest = (value) =>
  requireValue(typeof value === "string" && /^[a-f0-9]{64}$/.test(value));
const uint = (value, positive = false) =>
  requireValue(
    Number.isSafeInteger(value) &&
      !Object.is(value, -0) &&
      value >= (positive ? 1 : 0),
  );
const oneOf = (value, choices) => requireValue(choices.includes(value));
const list = (value, max = Infinity) =>
  requireValue(Array.isArray(value) && value.length <= max);
// Reuse the current safe permission projection's lexical rule, with accepted UTF-8 bounds.
const text = (value, max = 4096) =>
  requireValue(
    typeof value === "string" &&
      value.length > 0 &&
      Buffer.byteLength(value, "utf8") <= max &&
      !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value),
  );
const key = (...values) => JSON.stringify(values);
const unique = (rows, identity, orderIdentity = identity) => {
  const result = new Map();
  let previous;
  for (const row of rows) {
    const name = identity(row);
    requireValue(!result.has(name));
    const current = Buffer.from(
      permissionCanonicalJSON(orderIdentity(row)),
      "utf8",
    );
    requireValue(
      previous === undefined || Buffer.compare(previous, current) < 0,
    );
    previous = current;
    result.set(name, row);
  }
  return result;
};
function settings(value) {
  list(value, 256);
  let previous;
  for (const row of value) {
    closed(row, ["capabilityId", "effect"]);
    id(row.capabilityId);
    oneOf(row.effect, effects);
    const current = Buffer.from(
      permissionCanonicalJSON(row.capabilityId),
      "utf8",
    );
    requireValue(
      previous === undefined || Buffer.compare(previous, current) < 0,
    );
    previous = current;
  }
}
function policy(value) {
  closed(value, [
    "mode",
    "modeGeneration",
    "settings",
    "floorDigest",
    "compilerVersion",
    "policyDigest",
    "rules",
  ]);
  oneOf(value.mode, modes);
  uint(value.modeGeneration, true);
  settings(value.settings);
  requireValue(value.mode === "custom" || value.settings.length === 0);
  digest(value.floorDigest);
  requireValue(value.compilerVersion === 1);
  digest(value.policyDigest);
  list(value.rules);
  for (const row of value.rules) {
    closed(row, ["action", "resource", "effect"]);
    text(row.action);
    text(row.resource);
    oneOf(row.effect, effects);
  }
}
function generations(value) {
  const fields = ["control", "inventory", "pending", "saved", "locations"];
  closed(value, fields);
  for (const field of fields) uint(value[field], true);
}
function capability(value) {
  closed(value, [
    "capabilityId",
    "label",
    "category",
    "support",
    "effect",
    "source",
  ]);
  id(value.capabilityId);
  text(value.label, 256);
  oneOf(value.category, [
    "file_read",
    "file_write",
    "shell",
    "network",
    "mcp",
    "delegation",
    "other",
  ]);
  oneOf(value.support, ["verified", "unsupported"]);
  oneOf(value.effect, effects);
  oneOf(value.source, ["builtin", "trusted_adapter"]);
  requireValue(value.support !== "unsupported" || value.effect === "deny");
}
function location(value) {
  closed(value, ["locationId", "workspaceId", "incarnation", "state"]);
  id(value.locationId);
  id(value.workspaceId);
  uint(value.incarnation, true);
  oneOf(value.state, ["ready", "building", "finalizing"]);
}
function session(value) {
  closed(
    value,
    [
      "workspaceId",
      "sessionId",
      "locationId",
      "mode",
      "modeGeneration",
      "policyDigest",
      "state",
    ],
    ["parentSessionId"],
  );
  id(value.workspaceId);
  id(value.sessionId);
  id(value.locationId);
  if (Object.hasOwn(value, "parentSessionId")) id(value.parentSessionId);
  oneOf(value.mode, modes);
  uint(value.modeGeneration, true);
  digest(value.policyDigest);
  oneOf(value.state, ["idle", "running", "held", "unknown"]);
}
function pending(value) {
  closed(value, [
    "permissionId",
    "workspaceId",
    "sessionId",
    "locationId",
    "action",
    "resources",
    "savePatterns",
    "requestDigest",
  ]);
  id(value.permissionId);
  id(value.workspaceId);
  id(value.sessionId);
  id(value.locationId);
  text(value.action);
  digest(value.requestDigest);
  for (const field of ["resources", "savePatterns"]) {
    list(value[field]);
    for (const item of value[field]) text(item);
  }
}
function checkMembership(value) {
  const locations = unique(
    value.locations,
    (row) => row.locationId,
    (row) => [row.locationId, row.incarnation],
  );
  const sessions = unique(
    value.sessions,
    (row) => key(row.workspaceId, row.sessionId),
    (row) => [row.workspaceId, row.sessionId],
  );
  const byId = new Map();
  for (const row of value.sessions) {
    const rows = byId.get(row.sessionId) ?? [];
    rows.push(row);
    byId.set(row.sessionId, rows);
    requireValue(
      locations.get(row.locationId)?.workspaceId === row.workspaceId,
    );
  }
  const root = sessions.get(key(value.workspaceId, value.sessionId));
  requireValue(
    root !== undefined &&
      root.mode === value.policy.mode &&
      root.modeGeneration === value.policy.modeGeneration &&
      root.policyDigest === value.policy.policyDigest,
  );
  const parents = new Map();
  for (const row of value.sessions) {
    if (!Object.hasOwn(row, "parentSessionId")) continue;
    const candidates = byId.get(row.parentSessionId);
    requireValue(candidates?.length === 1);
    parents.set(row, candidates[0]);
  }
  const done = new Set();
  for (const row of value.sessions) {
    const path = new Set();
    let current = row;
    while (current && !done.has(current)) {
      requireValue(!path.has(current));
      path.add(current);
      current = parents.get(current);
    }
    for (const item of path) done.add(item);
  }
  unique(
    value.pending,
    (row) => key(row.locationId, row.sessionId, row.permissionId),
    (row) => [row.locationId, row.sessionId, row.permissionId],
  );
  for (const row of value.pending) {
    requireValue(
      sessions.get(key(row.workspaceId, row.sessionId))?.locationId ===
        row.locationId,
    );
  }
}
function control(value) {
  policy(value.policy);
  list(value.capabilities, 256);
  value.capabilities.forEach(capability);
  const capabilities = unique(value.capabilities, (row) => row.capabilityId);
  for (const setting of value.policy.settings) {
    const row = capabilities.get(setting.capabilityId);
    requireValue(row !== undefined && row.effect === setting.effect);
  }
  list(value.locations, 32);
  value.locations.forEach(location);
  list(value.sessions, 1024);
  value.sessions.forEach(session);
  list(value.pending, 1024);
  value.pending.forEach(pending);
  oneOf(value.hold, ["none", "transition", "recovery", "actual_call"]);
  checkMembership(value);
}
function saved(value) {
  list(value.saved, 1024);
  for (const row of value.saved) {
    closed(row, [
      "savedId",
      "action",
      "resource",
      "effect",
      "ruleDigest",
      "createdAt",
      "updatedAt",
    ]);
    id(row.savedId);
    text(row.action);
    text(row.resource);
    digest(row.ruleDigest);
    requireValue(row.effect === "allow");
    uint(row.createdAt);
    uint(row.updatedAt);
  }
  unique(value.saved, (row) => row.savedId);
}
function freeze(value) {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function validate(input, kind) {
  // Strict canonical traversal rejects Proxy/accessors before any ordinary reads.
  const value = JSON.parse(permissionCanonicalJSON(input));
  object(value);
  const available = value.status === "available";
  closed(value, [
    ...common,
    ...(available
      ? [
          "complete",
          "observationId",
          "scopeDigest",
          "generations",
          ...(kind === "control"
            ? [
                "policy",
                "capabilities",
                "locations",
                "sessions",
                "pending",
                "hold",
              ]
            : ["saved"]),
        ]
      : ["reason"]),
  ]);
  id(value.runtimeEpoch);
  uint(value.revision);
  uint(value.observationSequence, true);
  id(value.workspaceId);
  id(value.sessionId);
  oneOf(value.status, ["available", "unavailable"]);
  if (!available) oneOf(value.reason, reasons);
  else {
    requireValue(value.complete === true);
    id(value.observationId);
    digest(value.scopeDigest);
    generations(value.generations);
    if (kind === "control") control(value);
    else saved(value);
  }
  return freeze(value);
}
// Complete membership/digests, owner/sender/epoch freshness, floor compilation,
// Native inventory and unpredictable handle ownership MUST be proven by the producer.
// These validators only check the detached public shape and structural consistency.
export const validatePermissionControlObservation = (value) =>
  validate(value, "control");
export const validatePermissionSavedObservation = (value) =>
  validate(value, "saved");
