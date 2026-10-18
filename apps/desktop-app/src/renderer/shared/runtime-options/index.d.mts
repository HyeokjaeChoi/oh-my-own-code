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
export function isFreeModel(model: unknown): boolean;
export function variantForModel(
  variant: string,
  model: { variants?: { status: string; ids: readonly string[] } } | undefined,
): string;
export interface PickerModel {
  id: string;
  name: string;
  free?: boolean;
  provider?: string;
  providerId?: string;
}
export function defaultFreeOnly(
  entries: readonly PickerModel[],
  stored: boolean | undefined,
): boolean;
export function groupModels<T extends PickerModel>(
  entries: readonly T[],
  options: {
    query: string;
    freeOnly: boolean;
    recent: readonly string[];
    selectedId: string;
  },
): { key: string; label: string; items: T[] }[];
export function variantLabel(id: string): string;
export function modelDisplayName(name: string): string;
export function defaultModelText(reportedName?: string): {
  chip: string;
  hint: string;
};
