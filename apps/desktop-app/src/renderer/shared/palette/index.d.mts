export type PaletteAction =
  | { type: "settings"; page?: string }
  | { type: "composer"; target: "model" | "permission" | "status" | "plan" }
  | { type: "none" }
  | { type: "notifications" }
  | { type: "automation" }
  | { type: "extensions"; sub?: string }
  | {
      type: "panel";
      panel: "files" | "changes" | "work" | "terminal" | "preview" | "plan";
    }
  | { type: "session.create" }
  | { type: "workspace.import" }
  | { type: "session.select"; sessionId: string }
  | { type: "draft"; text: string }
  | { type: "script"; script: string };
export type PaletteEntry = {
  id: string;
  label: string;
  detail?: string;
  source: "app" | "runtime" | "project";
  action: PaletteAction;
  disabled?: true;
  reason?: string;
};
type CatalogList = {
  status: string;
  entries?: { id: string; name: string; description?: string }[];
};
export type PaletteContext = {
  hasWorkspace: boolean;
  pending: boolean;
  workspaceBlocked: boolean;
  resourceBlocked: boolean;
  connected: boolean;
  sessions?: { id: string; title?: string }[];
  currentSessionId?: string | undefined;
  catalog?: { commands?: CatalogList; skills?: CatalogList } | null;
  scripts?: { name: string; command: string }[] | undefined;
  packageManager?: string | undefined;
  draft?: string | undefined;
  archived?: boolean | undefined;
};
export const PALETTE_SOURCES: Readonly<Record<PaletteEntry["source"], string>>;
export function buildPaletteEntries(ctx: PaletteContext): PaletteEntry[];
export function filterPaletteEntries(
  entries: PaletteEntry[],
  query: string,
): PaletteEntry[];
export const APP_COMMAND_NAMES: readonly string[];
export function buildAppCommands(
  ctx: {
    hasWorkspace: boolean;
    hasSession: boolean;
    archived?: boolean | undefined;
  },
  runtimeNames: Set<string> | null,
): PaletteEntry[];
export function conflictingNames(runtimeNames: Set<string> | null): Set<string>;
