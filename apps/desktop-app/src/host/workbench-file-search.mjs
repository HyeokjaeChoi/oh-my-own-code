import { constants } from "node:fs";
import { lstat, realpath, open, opendir } from "node:fs/promises";
import { join } from "node:path";
import { fail } from "../workbench-contract.mjs";
import { sensitiveName } from "./workbench-files.mjs";

export const SEARCH_LIMITS = Object.freeze({
  results: 200,
  fileBytes: 1024 * 1024,
  files: 20000,
  depth: 32,
  snippet: 200,
});
const SKIP_DIRS = new Set([".git", "node_modules"]);
// ponytail: .gitignore is not parsed; add `git ls-files` enumeration if needed.
export async function searchFiles(root, request, signal) {
  const { query, mode, caseSensitive = false } = request;
  const limit = SEARCH_LIMITS;
  const fold = (text) => (caseSensitive ? text : text.toLowerCase());
  const needle = fold(query);
  const results = [];
  let scanned = 0;
  let truncated = false;
  const alive = () => {
    if (signal?.aborted) fail("CANCELLED");
  };
  if ((await realpath(root)) !== root || (await lstat(root)).isSymbolicLink())
    fail("FILE_DENIED");
  const full = () => {
    if (results.length >= limit.results || scanned >= limit.files)
      truncated = true;
    return truncated;
  };
  async function scanContent(dir, path) {
    let file;
    try {
      file = await open(
        join(dir, path.split("/").at(-1)),
        constants.O_RDONLY |
          (constants.O_NOFOLLOW ?? 0) |
          (constants.O_NONBLOCK ?? 0),
      );
    } catch {
      return;
    }
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > limit.fileBytes) return;
      const buffer = Buffer.alloc(stat.size);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      const bytes = buffer.subarray(0, bytesRead);
      if (bytes.subarray(0, 8192).includes(0)) return;
      const lines = bytes.toString("utf8").split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (!fold(lines[i]).includes(needle)) continue;
        results.push({
          path,
          line: i + 1,
          snippet: lines[i].trim().slice(0, limit.snippet),
        });
        if (full()) return;
      }
    } finally {
      await file.close();
    }
  }
  async function walk(dir, prefix, depth) {
    if (depth > limit.depth) return;
    const entries = [];
    for await (const entry of await opendir(dir)) {
      alive();
      entries.push(entry);
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      alive();
      if (full()) return;
      // Symlinks are never followed, so search cannot leave the root.
      if (sensitiveName(entry.name) || entry.isSymbolicLink()) continue;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name))
          await walk(join(dir, entry.name), path, depth + 1);
      } else if (entry.isFile()) {
        scanned++;
        if (mode === "name") {
          if (fold(path).includes(needle)) results.push({ path });
        } else await scanContent(dir, path);
      }
    }
  }
  await walk(root, "", 0);
  alive();
  return { query, mode, results, truncated };
}
