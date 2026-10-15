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
