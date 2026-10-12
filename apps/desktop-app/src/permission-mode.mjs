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

// Workspaces may be Git/Hg repositories. An edit auto-allow must never cover
// VCS metadata (hooks, config and attributes execute code on later VCS runs),
// so it is re-denied right after the edit rule. Last match wins; resources are
// workspace-relative. This is rule-level defence in depth only: pattern matching
// is case-sensitive, so execution-time path checks must also refuse VCS
// metadata by canonical identity (tool leases, execution phase).
export const VCS_METADATA_EDIT_DENIES = Object.freeze(
  [".git", ".hg"].flatMap((name) =>
    [name, `${name}/*`, `*/${name}`, `*/${name}/*`].map((resource) =>
      Object.freeze({ action: "edit", resource, effect: "deny" }),
    ),
  ),
);

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
  const withEnv = [
    ...rules.slice(0, at + 1),
    ...ENV_READ_RULES.map((r) => Object.freeze({ ...r })),
    ...rules.slice(at + 1),
  ];
  const edit = withEnv.findIndex(
    (r) => r.action === "edit" && r.resource === "*" && r.effect === "allow",
  );
  return Object.freeze(
    edit < 0
      ? withEnv
      : [
          ...withEnv.slice(0, edit + 1),
          ...VCS_METADATA_EDIT_DENIES.map((r) => Object.freeze({ ...r })),
          ...withEnv.slice(edit + 1),
        ],
  );
}
