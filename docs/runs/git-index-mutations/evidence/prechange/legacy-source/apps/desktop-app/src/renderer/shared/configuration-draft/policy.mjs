// Shared inert policy. Main, the fixed Native plugin and response validation
// use the same rules. Importing this module performs no IO.
export const BASELINE_POLICY = Object.freeze([
  Object.freeze({ action: "*", resource: "*", effect: "ask" }),
  Object.freeze({
    action: "external_directory",
    resource: "*",
    effect: "deny",
  }),
  Object.freeze({ action: "subagent", resource: "*", effect: "deny" }),
]);
export function policyMatches(rules) {
  if (!Array.isArray(rules) || rules.length !== BASELINE_POLICY.length)
    return false;
  for (let index = 0; index < rules.length; index++) {
    const slot = Object.getOwnPropertyDescriptor(rules, String(index));
    if (!slot || !Object.hasOwn(slot, "value")) return false;
    const rule = slot.value;
    if (
      !rule ||
      Object.getPrototypeOf(rule) !== Object.prototype ||
      Reflect.ownKeys(rule).length !== 3
    )
      return false;
    for (const key of ["action", "resource", "effect"]) {
      const field = Object.getOwnPropertyDescriptor(rule, key);
      if (
        !field ||
        !Object.hasOwn(field, "value") ||
        field.value !== BASELINE_POLICY[index][key]
      )
        return false;
    }
  }
  return true;
}
