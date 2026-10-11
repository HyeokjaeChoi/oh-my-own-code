// User-facing permission presets mapped onto the existing policy compiler.
// Source-owned built-in tool table: unknown or unlisted tools fall to the
// baseline "ask" rule, and the compiler appends the non-overridable deny floor.
import { compilePermissionRules } from "./permission-policy-compiler.mjs";

export const PERMISSION_MODES = Object.freeze([
  "ask",
  "scoped_edit",
  "read_plan",
]);
const BUILTIN = [
  ["read", "file_read"],
  ["glob", "file_read"],
  ["grep", "file_read"],
  ["edit", "file_write"],
  ["shell", "shell"],
  ["webfetch", "network"],
  ["websearch", "network"],
  ["subagent", "delegation"],
];
const capabilities = BUILTIN.map(([action, category]) => ({
  capabilityId: `opencode.tool.${action}`,
  category,
  support: "verified",
  action,
  resource: "*",
  adapterId: "opencode.builtin",
}));

const ENV_READ_RULES = [
  { action: "read", resource: "*.env", effect: "ask" },
  { action: "read", resource: "*.env.*", effect: "ask" },
  { action: "read", resource: "*.env.example", effect: "allow" },
];

export const validPermissionMode = (mode) => PERMISSION_MODES.includes(mode);

// Rules a pre-F-07 build wrote for this mode: no subagent capability rule and
// a trailing subagent deny. Used only to accept persisted sessions as stricter.
export function legacyModeRules(mode = "ask") {
  const current = compileModeRules(mode);
  return [
    ...current.filter((rule) => rule.action !== "subagent"),
    { action: "subagent", resource: "*", effect: "deny" },
  ];
}

export function compileModeRules(mode = "ask") {
  if (!validPermissionMode(mode)) throw new Error("permission_mode_invalid");
  const rules = compilePermissionRules({
    mode,
    settings: [],
    capabilities: mode === "ask" ? [] : capabilities.map((c) => ({ ...c })),
    authenticatedDenies: [],
    agentDenies: [],
  });
  // Mirror Native's agent defaults: the broad read allow must not override
  // the .env ask (last match wins), so re-assert it right after.
  const at = rules.findIndex(
    (r) => r.action === "read" && r.effect === "allow",
  );
  if (at < 0) return rules;
  return Object.freeze([
    ...rules.slice(0, at + 1),
    ...ENV_READ_RULES.map((r) => Object.freeze({ ...r })),
    ...rules.slice(at + 1),
  ]);
}
