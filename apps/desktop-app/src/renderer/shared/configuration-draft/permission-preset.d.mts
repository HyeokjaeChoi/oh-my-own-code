export type PermissionPresetId = "ask" | "scoped_edit" | "read_plan" | "custom";
export function classifyPreset(rules: unknown): PermissionPresetId;
