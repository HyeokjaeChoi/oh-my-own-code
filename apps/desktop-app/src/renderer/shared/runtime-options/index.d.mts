export interface RuntimeModel {
  providerId: string;
  id: string;
  variant?: string;
}
export interface AssistantRuntime {
  agent: string;
  model: RuntimeModel;
}
export interface SessionSelection {
  sessionId: string;
  agent?: string;
  model?: RuntimeModel;
}
export interface ModelOptions {
  variants: { status: "available" | "unavailable"; ids: string[] };
  capabilities?: { tools: boolean; input: string[]; output: string[] };
}
export const RUNTIME_OPTIONS_LIMITS: Readonly<{
  text: 256;
  variants: 64;
  capabilities: 32;
  capabilityText: 64;
}>;
export function validRuntimeText(
  value: unknown,
  limit?: number,
): value is string;
export function validRuntimeModel(value: unknown): value is RuntimeModel;
export function validAssistantRuntime(
  value: unknown,
): value is AssistantRuntime;
export function validSessionSelection(
  value: unknown,
): value is SessionSelection;
export function validModelOptions(value: unknown): value is ModelOptions;
export function projectModelOptions(model: unknown): ModelOptions;
export function projectAssistantRuntime(
  message: unknown,
): AssistantRuntime | undefined;
export function projectSessionSelection(
  info: unknown,
  sessionId: string,
): SessionSelection | undefined;
