export {
  PALETTE_SOURCES,
  buildPaletteEntries,
  filterPaletteEntries,
} from "./index.mjs";
export type { PaletteAction, PaletteEntry, PaletteContext } from "./index.mjs";
// Palette -> preferences sheet; the sheet owns its own open state.
export const OPEN_SETTINGS_EVENT = "omoc:open-settings";
