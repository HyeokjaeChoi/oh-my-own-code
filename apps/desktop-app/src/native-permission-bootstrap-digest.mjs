// Private payload identity for bootstrap (Native create/fork) task authority.
// Pure: no journal, Native, IO or execution authority. Shared by Main (planning
// and verification) and the child (consume-time recomputation from the ACTUAL
// Native input), so both sides hash identical normalized bytes.
import { createHash } from "node:crypto";
import { types } from "node:util";
import { permissionCanonicalJSON } from "./permission-control-canonical.mjs";
import { BASELINE_POLICY } from "./renderer/shared/configuration-draft/policy.mjs";

const invalid = () => {
  throw new Error("native_bootstrap_digest_invalid");
};
const need = (condition) => {
  if (!condition) invalid();
};
const sha = (domain, value) =>
  createHash("sha256")
    .update(`omoc.native.bootstrap.${domain}.v1\n`, "utf8")
    .update(permissionCanonicalJSON(value), "utf8")
    .digest("hex");

// Own data properties of a plain object. Any defined key outside `allowed`
// (parentID, agent, model, ...) is refused: only the exact method input passes.
function fields(value, allowed, required) {
  need(
    value &&
      typeof value === "object" &&
      !types.isProxy(value) &&
      !Array.isArray(value) &&
      [Object.prototype, null].includes(Object.getPrototypeOf(value)),
  );
  const copy = {};
  for (const key of Reflect.ownKeys(value)) {
    need(typeof key === "string");
    const slot = Object.getOwnPropertyDescriptor(value, key);
    need(slot.enumerable && Object.hasOwn(slot, "value"));
    if (slot.value === undefined) continue;
    need(allowed.includes(key));
    copy[key] = slot.value;
  }
  for (const key of required) need(Object.hasOwn(copy, key));
  return copy;
}
const stringMap = (value) => {
  const copy = fields(value, Object.keys(value ?? {}), []);
  for (const item of Object.values(copy)) need(typeof item === "string");
  return copy;
};
const rules = (value) => {
  need(
    Array.isArray(value) &&
      !types.isProxy(value) &&
      Object.getPrototypeOf(value) === Array.prototype &&
      value.length <= 16,
  );
  return value.map((rule) => {
    const row = fields(
      rule,
      ["action", "resource", "effect"],
      ["action", "resource", "effect"],
    );
    for (const item of Object.values(row)) need(typeof item === "string");
    return row;
  });
};

// Normalized exact Native input for the two bootstrap methods.
export function bootstrapStageArguments(step, input) {
  if (step === "native.create") {
    const row = fields(
      input,
      ["id", "metadata", "title", "location", "permissions"],
      ["id", "metadata", "title", "location", "permissions"],
    );
    need(typeof row.id === "string" && typeof row.title === "string");
    const location = fields(row.location, ["directory"], ["directory"]);
    need(typeof location.directory === "string");
    return {
      id: row.id,
      metadata: stringMap(row.metadata),
      title: row.title,
      location,
      permissions: rules(row.permissions),
    };
  }
  need(step === "native.fork");
  const row = fields(input, ["sessionID", "before"], ["sessionID"]);
  need(
    typeof row.sessionID === "string" &&
      (row.before === undefined || typeof row.before === "string"),
  );
  return {
    sessionID: row.sessionID,
    ...(row.before !== undefined && { before: row.before }),
  };
}
export const bootstrapStageDigest = (step, input) =>
  sha("args", { step, args: bootstrapStageArguments(step, input) });
export function bootstrapParentDigest(parent) {
  const row = fields(
    parent,
    ["id", "projectID", "directory"],
    ["id", "projectID", "directory"],
  );
  for (const item of Object.values(row)) need(typeof item === "string");
  return sha("parent", row);
}
export const bootstrapMetadataDigest = (metadata) =>
  sha("metadata", stringMap(metadata));
// Exactly the shared baseline (ask-all, then the external_directory deny floor).
export function bootstrapBaselinePermissions(permissions) {
  try {
    return (
      permissionCanonicalJSON(rules(permissions)) ===
      permissionCanonicalJSON(BASELINE_POLICY.map((rule) => ({ ...rule })))
    );
  } catch {
    return false;
  }
}
export const bootstrapHandoffProof = ({
  handoffId,
  step,
  stageArgumentDigest,
  state,
}) => sha("handoff", { handoffId, step, stageArgumentDigest, state });
export const bootstrapTaskProof = ({
  outcome,
  taskScopeId,
  appSessionId,
  nativeSessionId,
}) =>
  sha("proof", {
    outcome,
    taskScopeId,
    ...(nativeSessionId && { appSessionId, nativeSessionId }),
  });
