export type PackageManager = "pnpm" | "npm" | "yarn" | "bun";
export type ProjectScript = { name: string; command: string };
export type ProjectActions = {
  packageManager: PackageManager;
  scripts: ProjectScript[];
};
export const PROJECT_ACTION_LIMITS: Readonly<{
  fileBytes: number;
  scripts: number;
  commandChars: number;
}>;
export const PACKAGE_MANAGERS: readonly PackageManager[];
export function isScriptName(value: unknown): value is string;
export function detectPackageManager(
  fileNames: Iterable<string>,
): PackageManager;
export function parsePackageScripts(text: string): ProjectScript[];
