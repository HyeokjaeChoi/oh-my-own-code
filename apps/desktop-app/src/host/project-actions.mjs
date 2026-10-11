import { lstat, open, readdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import {
  PROJECT_ACTION_LIMITS,
  detectPackageManager,
  parsePackageScripts,
} from "../renderer/shared/project-actions/index.mjs";

// Reads package.json scripts and the lockfile-derived package manager of a workspace root.
// Bounded regular-file read; nothing is executed. Any problem yields an empty list.
export async function readProjectActions(root) {
  let realRoot, names;
  try {
    realRoot = await realpath(root);
    names = await readdir(realRoot);
  } catch {
    return { packageManager: "npm", scripts: [] };
  }
  const packageManager = detectPackageManager(names);
  if (!names.includes("package.json")) return { packageManager, scripts: [] };
  const path = join(realRoot, "package.json");
  let handle;
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.size > PROJECT_ACTION_LIMITS.fileBytes)
      return { packageManager, scripts: [] };
    handle = await open(path, "r");
    const text = (await handle.readFile({ encoding: "utf8" })).slice(
      0,
      PROJECT_ACTION_LIMITS.fileBytes,
    );
    return { packageManager, scripts: parsePackageScripts(text) };
  } catch {
    return { packageManager, scripts: [] };
  } finally {
    await handle?.close();
  }
}
