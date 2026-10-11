// Inert closed projection. Session rules are not an evaluated effective policy.
import { BASELINE_POLICY, policyMatches } from "./policy.mjs";
import { validWorkspaceFileRoot } from "../workspace-file/index.mjs";
const fail = () => {
  throw Object.assign(new Error("INVALID_REQUEST"), {
    appCode: "INVALID_REQUEST",
  });
};
const object = (value, keys) => {
  if (
    !value ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Reflect.ownKeys(value).length !== keys.length
  )
    return false;
  return keys.every((key) => {
    const slot = Object.getOwnPropertyDescriptor(value, key);
    return slot && Object.hasOwn(slot, "value");
  });
};
const text = (value, limit) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= limit &&
  value.isWellFormed() &&
  !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value);
export function validPermissionPolicyRules(value) {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > 128 ||
    Reflect.ownKeys(value).length !== value.length + 1
  )
    return false;
  for (let i = 0; i < value.length; i++) {
    const slot = Object.getOwnPropertyDescriptor(value, String(i));
    if (!slot || !Object.hasOwn(slot, "value")) return false;
    const row = slot.value;
    if (
      !object(row, ["action", "resource", "effect"]) ||
      !text(row.action, 128) ||
      !text(row.resource, 2048) ||
      !["ask", "allow", "deny"].includes(row.effect)
    )
      return false;
  }
  return true;
}
export function validatePermissionPolicyObservation(value) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) fail();
  const status = Object.getOwnPropertyDescriptor(value, "status")?.value;
  const common = [
    "runtimeEpoch",
    "revision",
    "workspaceId",
    "workspacePath",
    "sessionId",
    "status",
  ];
  if (
    !value ||
    !object(value, [
      ...common,
      ...(status === "available"
        ? [
            "sessionRulesState",
            "sessionRules",
            "requiredBaselineRules",
            "baselineMatches",
            "evaluation",
          ]
        : ["reason"]),
    ])
  )
    fail();
  if (
    !text(value.runtimeEpoch, 256) ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    !text(value.workspaceId, 256) ||
    !text(value.sessionId, 256) ||
    !validWorkspaceFileRoot(value.workspacePath)
  )
    fail();
  if (value.status === "unavailable") {
    if (value.reason !== "native_policy_unverified") fail();
    return value;
  }
  if (
    value.status !== "available" ||
    !["absent", "present"].includes(value.sessionRulesState) ||
    !validPermissionPolicyRules(value.sessionRules) ||
    (value.sessionRulesState === "absent" && value.sessionRules.length !== 0) ||
    !validPermissionPolicyRules(value.requiredBaselineRules) ||
    !policyMatches(value.requiredBaselineRules) ||
    value.baselineMatches !==
      (value.sessionRulesState === "present" &&
        policyMatches(value.sessionRules)) ||
    value.evaluation !== "not_evaluated"
  )
    fail();
  return value;
}
export function projectPermissionPolicy(scope, nativeSession) {
  const unavailable = () =>
    validatePermissionPolicyObservation({
      ...scope,
      status: "unavailable",
      reason: "native_policy_unverified",
    });
  if (
    !nativeSession ||
    Object.getPrototypeOf(nativeSession) !== Object.prototype
  )
    return unavailable();
  const slot = Object.getOwnPropertyDescriptor(nativeSession, "permissions");
  if (
    slot &&
    (!Object.hasOwn(slot, "value") || !validPermissionPolicyRules(slot.value))
  )
    return unavailable();
  const sessionRules = slot
    ? slot.value.map(({ action, resource, effect }) => ({
        action,
        resource,
        effect,
      }))
    : [];
  return validatePermissionPolicyObservation({
    ...scope,
    status: "available",
    sessionRulesState: slot ? "present" : "absent",
    sessionRules,
    requiredBaselineRules: BASELINE_POLICY.map((row) => ({ ...row })),
    baselineMatches: !!slot && policyMatches(sessionRules),
    evaluation: "not_evaluated",
  });
}
