// Private inert hashes. These helpers do not grant permission or execution authority.
import {
  permissionCanonicalJSON,
  permissionDomainDigest,
} from "./permission-control-canonical.mjs";
import { validWireId } from "./wire-id.mjs";

const invalid = () => {
  throw new Error("permission_control_invalid_data");
};
const requireValue = (condition) => {
  if (!condition) invalid();
};
const digest64hex = (value) =>
  requireValue(typeof value === "string" && /^[a-f0-9]{64}$/.test(value));
const id = (value) => requireValue(validWireId(value));
const uint = (value, positive = false) =>
  requireValue(
    Number.isSafeInteger(value) &&
      !Object.is(value, -0) &&
      value >= (positive ? 1 : 0),
  );
const oneOf = (value, choices) => requireValue(choices.includes(value));
const object = (value) =>
  requireValue(
    value !== null && typeof value === "object" && !Array.isArray(value),
  );
const closed = (value, fields) => {
  object(value);
  requireValue(
    Object.keys(value).length === fields.length &&
      fields.every((field) => Object.hasOwn(value, field)),
  );
};
const list = (value, max) =>
  requireValue(Array.isArray(value) && value.length <= max);
const text = (value) =>
  requireValue(
    typeof value === "string" && Buffer.byteLength(value, "utf8") <= 4096,
  );
const mode = (value) =>
  oneOf(value, ["ask", "read_plan", "scoped_edit", "custom"]);
const effect = (value) => oneOf(value, ["deny", "ask", "allow"]);

// Canonical traverses descriptors and rejects Proxies/accessors without invoking
// user code. Only its detached parse is read by the shape validators below.
function hashBody(domain, input, validate) {
  const body = JSON.parse(permissionCanonicalJSON(input));
  validate(body);
  return permissionDomainDigest(domain, body);
}

function grantFields(body) {
  digest64hex(body.projectIdentityDigest);
  text(body.action);
  text(body.resource);
  requireValue(body.effect === "allow");
}

export function permissionGrantDigest(input) {
  return hashBody("grant", input, (body) => {
    closed(body, ["projectIdentityDigest", "action", "resource", "effect"]);
    grantFields(body);
  });
}

export function permissionSavedRuleDigest(input) {
  return hashBody("saved", input, (body) => {
    closed(body, [
      "projectIdentityDigest",
      "savedId",
      "action",
      "resource",
      "effect",
      "createdAt",
      "updatedAt",
    ]);
    grantFields(body);
    id(body.savedId);
    uint(body.createdAt);
    uint(body.updatedAt);
  });
}

function settings(value) {
  list(value, 256);
  let previous;
  for (const setting of value) {
    closed(setting, ["capabilityId", "effect"]);
    id(setting.capabilityId);
    effect(setting.effect);
    const identity = Buffer.from(
      permissionCanonicalJSON(setting.capabilityId),
      "utf8",
    );
    requireValue(
      previous === undefined || Buffer.compare(previous, identity) < 0,
    );
    previous = identity;
  }
}

export function permissionPolicyDigest(input) {
  return hashBody("policy", input, (body) => {
    closed(body, [
      "compilerVersion",
      "floorDigest",
      "mode",
      "modeGeneration",
      "settings",
      "selectedAgentIdentityDigest",
      "inventoryDigest",
      "rules",
    ]);
    requireValue(body.compilerVersion === 1);
    digest64hex(body.floorDigest);
    mode(body.mode);
    uint(body.modeGeneration, true);
    settings(body.settings);
    requireValue(body.mode === "custom" || body.settings.length === 0);
    digest64hex(body.selectedAgentIdentityDigest);
    digest64hex(body.inventoryDigest);
    requireValue(Array.isArray(body.rules));
    for (const rule of body.rules) {
      closed(rule, ["action", "resource", "effect"]);
      text(rule.action);
      text(rule.resource);
      effect(rule.effect);
    }
  });
}

function scopeLists(body) {
  list(body.locations, 32);
  list(body.sessions, 1024);
}

// Location/Session DTO semantics, complete membership and canonical set order
// must be established by the complete validated producer. Never sort here.
export function permissionScopeDigest(input) {
  return hashBody("scope", input, (body) => {
    closed(body, ["locations", "sessions", "projectIdentityDigest"]);
    digest64hex(body.projectIdentityDigest);
    scopeLists(body);
  });
}

function clock(value) {
  closed(value, ["runtimeEpoch", "revision", "observationSequence"]);
  id(value.runtimeEpoch);
  uint(value.revision);
  uint(value.observationSequence, true);
}

function generations(value) {
  const fields = ["control", "inventory", "pending", "saved", "locations"];
  closed(value, fields);
  for (const field of fields) uint(value[field], true);
}

// Scope/impact nested semantics, handle ownership/entropy, expiry and preview
// authority remain producer/registry responsibilities. This is not their validator.
export function permissionPreviewDigest(input) {
  return hashBody("preview", input, (body) => {
    closed(body, [
      "kind",
      "clock",
      "scope",
      "trustRevision",
      "rootIdentityDigest",
      "nativeIdentityDigest",
      "generations",
      "inventoryDigest",
      "previewId",
      "expiresAt",
      "impact",
    ]);
    oneOf(body.kind, ["mode", "reply", "remember", "revoke"]);
    clock(body.clock);
    closed(body.scope, ["kind", "scopeDigest", "locations", "sessions"]);
    requireValue(body.scope.kind === "project");
    digest64hex(body.scope.scopeDigest);
    scopeLists(body.scope);
    uint(body.trustRevision);
    digest64hex(body.rootIdentityDigest);
    digest64hex(body.nativeIdentityDigest);
    generations(body.generations);
    digest64hex(body.inventoryDigest);
    requireValue(
      typeof body.previewId === "string" && body.previewId.length > 0,
    );
    uint(body.expiresAt);
    object(body.impact);
  });
}
