import type {
  WorkbenchSkillRuntimeRow,
  WorkbenchSkillRuntimeObservation,
  WorkbenchSkillRuntimeMutation,
} from "../../../desktop-bridge";
export const SKILL_RUNTIME_FEATURE: "configuration_skill_runtime_v1";
export function skillRuntimeStep(
  type: string,
):
  | "native.skill.register"
  | "native.skill.remove"
  | "native.skill.apply"
  | undefined;
export function validSkillNativeId(value: unknown): value is string;
export function skillRuntimeIdPayload(value: {
  runtimeEpoch: string;
  workspaceId: string;
  sourceName: string;
  operationId: string;
}): string;
export function validSkillRuntimeRow(
  value: unknown,
): value is WorkbenchSkillRuntimeRow;
export function validSkillRuntimeObservation(
  value: unknown,
): value is WorkbenchSkillRuntimeObservation;
export function validSkillRuntimeMutation(
  value: unknown,
): value is WorkbenchSkillRuntimeMutation;
