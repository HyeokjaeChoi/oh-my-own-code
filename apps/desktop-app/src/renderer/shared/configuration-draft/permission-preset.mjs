// Pure, inert classifier: which built-in permission mode do the session's rules
// equal? Mirrors src/permission-mode.mjs compileModeRules (a test pins the two
// together). Exact ordered match only; anything else is "custom".
import { BASELINE_POLICY } from "./policy.mjs";
const r = (action, resource, effect) => ({ action, resource, effect });
const ENV = [
  r("read", "*.env", "ask"),
  r("read", "*.env.*", "ask"),
  r("read", "*.env.example", "allow"),
];
const VCS = [".git", ".hg"].flatMap((n) =>
  [n, `${n}/*`, `*/${n}`, `*/${n}/*`].map((p) => r("edit", p, "deny")),
);
const TAIL = [
  r("glob", "*", "allow"),
  r("grep", "*", "allow"),
  r("read", "*", "allow"),
  ...ENV,
  r("shell", "*", "deny"),
  r("subagent", "*", "allow"),
  r("webfetch", "*", "deny"),
  r("websearch", "*", "deny"),
];
const [ASK, FLOOR] = BASELINE_POLICY;
const TEMPLATES = {
  ask: [ASK, FLOOR],
  scoped_edit: [ASK, r("edit", "*", "allow"), ...VCS, ...TAIL, FLOOR],
  read_plan: [ASK, r("edit", "*", "deny"), ...TAIL, FLOOR],
};
// Pre-F-07 builds: no subagent allow, trailing subagent deny.
const legacy = (rules) => [
  ...rules.filter((x) => x.action !== "subagent"),
  r("subagent", "*", "deny"),
];
const same = (a, b) =>
  a.length === b.length &&
  a.every(
    (x, i) =>
      x.action === b[i].action &&
      x.resource === b[i].resource &&
      x.effect === b[i].effect,
  );
export function classifyPreset(rules) {
  if (!Array.isArray(rules)) return "custom";
  const rows = [];
  for (let i = 0; i < rules.length; i++) {
    const x = rules[i];
    if (!x || typeof x !== "object") return "custom";
    rows.push(x);
  }
  for (const [id, t] of Object.entries(TEMPLATES))
    if (same(rows, t) || same(rows, legacy(t))) return id;
  return "custom";
}
