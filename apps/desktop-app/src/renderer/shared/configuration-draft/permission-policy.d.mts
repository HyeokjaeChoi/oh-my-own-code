export type PermissionPolicyRule = {
  action: string;
  resource: string;
  effect: "ask" | "allow" | "deny";
};
export type PermissionPolicyScope = {
  runtimeEpoch: string;
  revision: number;
  workspaceId: string;
  workspacePath: string;
  sessionId: string;
};
export type WorkbenchPermissionPolicyObservation = PermissionPolicyScope &
  (
    | {
        status: "available";
        sessionRulesState: "absent" | "present";
        sessionRules: PermissionPolicyRule[];
        requiredBaselineRules: PermissionPolicyRule[];
        baselineMatches: boolean;
        evaluation: "not_evaluated";
      }
    | { status: "unavailable"; reason: "native_policy_unverified" }
  );
export function validPermissionPolicyRules(
  value: unknown,
): value is PermissionPolicyRule[];
export function validatePermissionPolicyObservation(
  value: unknown,
): WorkbenchPermissionPolicyObservation;
export function projectPermissionPolicy(
  scope: PermissionPolicyScope,
  nativeSession: unknown,
): WorkbenchPermissionPolicyObservation;
