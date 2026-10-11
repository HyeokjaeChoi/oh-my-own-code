// Pure compilation, not inventory, mode-generation or execution authority.
// Production callers must resolve mappings from the current trusted owner.
import { permissionCanonicalJSON } from "./permission-control-canonical.mjs";
import { permissionPolicyDigest } from "./permission-control-digests.mjs";
import { validWireId } from "./wire-id.mjs";
import { BASELINE_POLICY } from "./renderer/shared/configuration-draft/policy.mjs";

const fail = () => {
  throw new Error("permission_policy_unverified");
};
const need = (value) => {
  if (!value) fail();
};
const capture = (value) => JSON.parse(permissionCanonicalJSON(value));
const exact = (value, fields) =>
  need(
    value &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      Object.keys(value).length === fields.length &&
      fields.every((key) => Object.hasOwn(value, key)),
  );
const text = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  Buffer.byteLength(value) <= 4096 &&
  value.isWellFormed() &&
  !value.includes("\0");
const list = (value, max = 256) =>
  need(Array.isArray(value) && value.length <= max);
const effects = ["deny", "ask", "allow"];
const categories = [
  "file_read",
  "file_write",
  "shell",
  "network",
  "mcp",
  "delegation",
  "other",
];
const compare = (a, b) =>
  Buffer.compare(
    Buffer.from(permissionCanonicalJSON(a)),
    Buffer.from(permissionCanonicalJSON(b)),
  );
const freezeRules = (rules) =>
  Object.freeze(rules.map((rule) => Object.freeze(rule)));

function rules(value, max = 1024) {
  list(value, max);
  for (const rule of value) {
    exact(rule, ["action", "resource", "effect"]);
    need(
      text(rule.action) && text(rule.resource) && effects.includes(rule.effect),
    );
  }
  return value;
}
function denies(value) {
  rules(value, 256);
  need(value.every((rule) => rule.effect === "deny"));
  return value;
}
function floor(authenticatedDenies, agentDenies) {
  const output = BASELINE_POLICY.filter((rule) => rule.effect === "deny").map(
    (rule) => ({ ...rule }),
  );
  for (const rule of [...denies(authenticatedDenies), ...denies(agentDenies)])
    if (
      !output.some(
        (existing) =>
          permissionCanonicalJSON(existing) === permissionCanonicalJSON(rule),
      )
    )
      output.push(rule);
  return output;
}

export function compilePermissionRules(input) {
  const value = capture(input);
  exact(value, [
    "mode",
    "settings",
    "capabilities",
    "authenticatedDenies",
    "agentDenies",
  ]);
  need(["ask", "read_plan", "scoped_edit", "custom"].includes(value.mode));
  list(value.settings);
  list(value.capabilities);
  need(value.mode === "custom" || value.settings.length === 0);
  const settings = new Map();
  let previous;
  for (const setting of value.settings) {
    exact(setting, ["capabilityId", "effect"]);
    need(validWireId(setting.capabilityId) && effects.includes(setting.effect));
    need(previous === undefined || compare(previous, setting.capabilityId) < 0);
    previous = setting.capabilityId;
    settings.set(setting.capabilityId, setting.effect);
  }
  const identities = new Set(),
    actions = new Set();
  for (const capability of value.capabilities) {
    exact(capability, [
      "capabilityId",
      "category",
      "support",
      "action",
      "resource",
      "adapterId",
    ]);
    need(
      validWireId(capability.capabilityId) && validWireId(capability.adapterId),
    );
    need(
      categories.includes(capability.category) &&
        ["verified", "unsupported"].includes(capability.support),
    );
    // Exact Native action identities only. Ambiguous patterns or multiple
    // resource mappings for one action require a separately resolved table.
    need(
      validWireId(capability.action) &&
        !["*", "?", "[", "]", "{", "}", "!", "\\"].some((char) =>
          capability.action.includes(char),
        ) &&
        text(capability.resource),
    );
    need(
      !identities.has(capability.capabilityId) &&
        !actions.has(capability.action.toLowerCase()),
    );
    identities.add(capability.capabilityId);
    actions.add(capability.action.toLowerCase());
  }
  need([...settings.keys()].every((id) => identities.has(id)));
  const output = [{ ...BASELINE_POLICY[0] }];
  for (const capability of value.capabilities.sort((a, b) =>
    compare(a.capabilityId, b.capabilityId),
  )) {
    const effect =
      capability.support === "unsupported"
        ? "deny"
        : value.mode === "ask"
          ? "ask"
          : value.mode === "custom"
            ? (settings.get(capability.capabilityId) ?? "ask")
            : capability.category === "file_read" ||
                (value.mode === "scoped_edit" &&
                  capability.category === "file_write")
              ? "allow"
              : "deny";
    // Default ask remains the exact existing fallback, without redundant rules.
    if (effect !== "ask")
      output.push({
        action: capability.action,
        resource: capability.resource,
        effect,
      });
  }
  output.push(...floor(value.authenticatedDenies, value.agentDenies));
  return freezeRules(output);
}

export function compilePermissionPolicy(input) {
  const value = capture(input);
  exact(value, [
    "compilerVersion",
    "floorDigest",
    "mode",
    "modeGeneration",
    "settings",
    "selectedAgentIdentityDigest",
    "inventoryDigest",
    "capabilities",
    "authenticatedDenies",
    "agentDenies",
  ]);
  const compiledRules = compilePermissionRules({
    mode: value.mode,
    settings: value.settings,
    capabilities: value.capabilities,
    authenticatedDenies: value.authenticatedDenies,
    agentDenies: value.agentDenies,
  });
  const {
    capabilities: _capabilities,
    authenticatedDenies: _authenticated,
    agentDenies: _agent,
    ...body
  } = value;
  body.rules = compiledRules;
  const policyDigest = permissionPolicyDigest(body);
  return Object.freeze({
    ...body,
    settings: Object.freeze(
      body.settings.map((setting) => Object.freeze(setting)),
    ),
    policyDigest,
  });
}

export function matchesOrderedPermissionRules(expected, observed) {
  try {
    const left = rules(capture(expected)),
      right = rules(capture(observed));
    return permissionCanonicalJSON(left) === permissionCanonicalJSON(right);
  } catch {
    return false;
  }
}
export function matchesAuthenticatedFloor(
  observed,
  authenticatedDenies = [],
  agentDenies = [],
) {
  try {
    const actual = rules(capture(observed));
    const expected = floor(capture(authenticatedDenies), capture(agentDenies));
    return matchesOrderedPermissionRules(
      expected,
      actual.slice(-expected.length),
    );
  } catch {
    return false;
  }
}
export function matchesModeRecord(record, compiled) {
  try {
    const value = capture(record),
      candidate = capture(compiled);
    exact(value, [
      "version",
      "mode",
      "modeGeneration",
      "settings",
      "floorDigest",
      "compilerVersion",
      "policyDigest",
    ]);
    const { policyDigest, ...body } = candidate;
    need(policyDigest === permissionPolicyDigest(body) && value.version === 1);
    return Object.keys(value)
      .filter((key) => key !== "version")
      .every(
        (key) =>
          permissionCanonicalJSON(value[key]) ===
          permissionCanonicalJSON(candidate[key]),
      );
  } catch {
    return false;
  }
}
