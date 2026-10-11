export type Theme = "system" | "light" | "dark";
export type FontSize = "small" | "medium" | "large";
export type Density = "comfortable" | "compact";
export interface Preferences {
  theme: Theme;
  fontSize: FontSize;
  density: Density;
  osNotifications: boolean;
}
export const THEMES: readonly Theme[];
export const FONT_SIZES: readonly FontSize[];
export const DENSITIES: readonly Density[];
export const DEFAULT_PREFERENCES: Readonly<Preferences>;
export const PREFERENCES_STORAGE_KEY: string;
export const SHORTCUTS: readonly { keys: string; action: string }[];
export function parsePreferences(raw: unknown): Preferences;
export function loadPreferences(
  storage?: Pick<Storage, "getItem">,
): Preferences;
export function savePreferences(
  preferences: Preferences,
  storage?: Pick<Storage, "setItem">,
): void;
export function applyPreferences(
  root: Pick<HTMLElement, "setAttribute"> & {
    style: Pick<CSSStyleDeclaration, "setProperty" | "removeProperty">;
  },
  preferences: Preferences,
  systemDark: boolean,
): void;
