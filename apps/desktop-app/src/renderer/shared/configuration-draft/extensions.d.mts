export type WorkbenchExtensionUnavailableReason =
  | "runtime_unavailable"
  | "invalid_response"
  | "limit_reached";
export type WorkbenchExtensionSource =
  | { type: "builtin" | "sdk" }
  | { type: "local"; path: string }
  | { type: "package"; target: string }
  | { type: "local" | "package"; reason: "unsupported_source" };
export type WorkbenchExtensionPlugin = {
  id: string;
  source: WorkbenchExtensionSource;
  features: { server: boolean; tui: boolean; rpc: boolean };
} & (
  | { state: "active"; reason?: never }
  | { state: "failed"; reason: "native_failed" }
);
export type WorkbenchExtensionTool = { id: string; name: string };
export type WorkbenchExtensionsGroup<Row> =
  | { status: "available"; rows: Row[] }
  | { status: "unavailable"; reason: WorkbenchExtensionUnavailableReason };
export type WorkbenchExtensionsInventory = {
  workspaceId: string;
  workspacePath: string;
  status: "available" | "partial" | "unavailable";
  plugins: WorkbenchExtensionsGroup<WorkbenchExtensionPlugin>;
  tools: WorkbenchExtensionsGroup<WorkbenchExtensionTool>;
  hooks: { status: "not_reported"; reason: "inventory_not_supported" };
};
export type WorkbenchExtensionsObservation = WorkbenchExtensionsInventory & {
  runtimeEpoch: string;
  revision: number;
};
export const EXTENSIONS_LIMITS: Readonly<{ plugins: 128; tools: 128 }>;
export function projectNativePlugins(
  rawArray: unknown,
): WorkbenchExtensionsGroup<WorkbenchExtensionPlugin>;
export function projectNativeTools(
  rawArray: unknown,
): WorkbenchExtensionsGroup<WorkbenchExtensionTool>;
export function validateExtensionsInventory(
  core: unknown,
): WorkbenchExtensionsInventory;
export function validateExtensionsObservation(
  full: unknown,
): WorkbenchExtensionsObservation;
