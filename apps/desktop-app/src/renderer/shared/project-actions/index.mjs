// Browser-safe package.json script discovery helpers. No IO, no execution.
export const PROJECT_ACTION_LIMITS = Object.freeze({
  fileBytes: 262144,
  scripts: 100,
  commandChars: 200,
});
export const PACKAGE_MANAGERS = Object.freeze(["pnpm", "npm", "yarn", "bun"]);
// First match wins; mirrors common precedence when several lockfiles exist.
const LOCKFILES = [
  ["pnpm-lock.yaml", "pnpm"],
  ["bun.lockb", "bun"],
  ["bun.lock", "bun"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
  ["npm-shrinkwrap.json", "npm"],
];
// Not starting with "-" keeps a script name from ever being read as a flag.
const SCRIPT_NAME = /^[A-Za-z0-9_][\w:.-]{0,127}$/;
export const isScriptName = (v) => typeof v === "string" && SCRIPT_NAME.test(v);

export function detectPackageManager(fileNames) {
  const names = new Set(fileNames);
  return LOCKFILES.find(([file]) => names.has(file))?.[1] ?? "npm";
}

// Malformed JSON, non-object scripts, bad names and non-string commands are skipped.
export function parsePackageScripts(text) {
  let pkg;
  try {
    pkg = JSON.parse(text);
  } catch {
    return [];
  }
  const scripts = pkg && typeof pkg === "object" ? pkg.scripts : undefined;
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts))
    return [];
  const out = [];
  for (const [name, command] of Object.entries(scripts)) {
    if (!isScriptName(name) || typeof command !== "string") continue;
    out.push({
      name,
      command: command.slice(0, PROJECT_ACTION_LIMITS.commandChars),
    });
    if (out.length >= PROJECT_ACTION_LIMITS.scripts) break;
  }
  return out;
}
