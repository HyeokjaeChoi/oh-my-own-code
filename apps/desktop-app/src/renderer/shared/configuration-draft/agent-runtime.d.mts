import type {
  WorkbenchAgentRuntimeRow,
  WorkbenchAgentRuntimeObservation,
  WorkbenchAgentRuntimeMutation,
} from "../../../desktop-bridge";
export const AGENT_RUNTIME_FEATURE: "configuration_agents_v1";
export function agentRuntimeStep(
  type: string,
): "native.agent.register" | "native.agent.remove" | undefined;
export function validAgentNativeId(value: unknown): value is string;
export function agentRuntimeIdPayload(value: {
  runtimeEpoch: string;
  workspaceId: string;
  sourceName: string;
  operationId: string;
}): string;
export function validAgentRuntimeRow(
  value: unknown,
): value is WorkbenchAgentRuntimeRow;
export function validAgentRuntimeObservation(
  value: unknown,
): value is WorkbenchAgentRuntimeObservation;
export function validAgentRuntimeMutation(
  value: unknown,
): value is WorkbenchAgentRuntimeMutation;
