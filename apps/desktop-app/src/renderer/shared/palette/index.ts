export {
  PALETTE_SOURCES,
  buildPaletteEntries,
  filterPaletteEntries,
} from "./index.mjs";
export type { PaletteAction, PaletteEntry, PaletteContext } from "./index.mjs";
// Palette -> preferences sheet; the sheet owns its own open state.
export const OPEN_SETTINGS_EVENT = "omoc:open-settings";
export const OPEN_NOTIFICATIONS_EVENT = "omoc:open-notifications";
export const OPEN_AUTOMATION_EVENT = "omoc:open-automation";
export const OPEN_DATA_EVENT = "omoc:open-data";
export const OPEN_EXTENSIONS_EVENT = "omoc:open-extensions";
export type SettingsPage =
  | "general"
  | "models"
  | "permissions"
  | "extensions"
  | "notifications"
  | "automation"
  | "data"
  | "shortcuts";
// OPEN_SETTINGS_EVENT optionally carries the page to land on.
export const openSettingsPage = (page: SettingsPage) =>
  window.dispatchEvent(
    new CustomEvent(OPEN_SETTINGS_EVENT, { detail: { page } }),
  );
// OPEN_EXTENSIONS_EVENT optionally carries the kind to drill into.
export const openExtensionsSub = (sub: string) =>
  window.dispatchEvent(
    new CustomEvent(OPEN_EXTENSIONS_EVENT, { detail: { sub } }),
  );
