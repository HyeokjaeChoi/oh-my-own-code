export const BASELINE_POLICY: readonly [
  Readonly<{ action: "*"; resource: "*"; effect: "ask" }>,
  Readonly<{ action: "external_directory"; resource: "*"; effect: "deny" }>,
  Readonly<{ action: "subagent"; resource: "*"; effect: "deny" }>,
];
export function policyMatches(value: unknown): boolean;
