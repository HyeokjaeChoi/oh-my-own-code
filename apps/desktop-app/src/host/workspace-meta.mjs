// Read-only display metadata for a workspace folder: current git branch and
// writability. Never executes git; reads at most one small HEAD file.
import { access, lstat, open } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

async function readSmall(file) {
  const info = await lstat(file);
  if (!info.isFile() || info.size > 512) return undefined;
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    return (await handle.readFile({ encoding: "utf8" })).trim();
  } finally {
    await handle.close();
  }
}

async function headFile(root) {
  const dot = join(root, ".git");
  const info = await lstat(dot);
  if (info.isDirectory()) return join(dot, "HEAD");
  // Linked worktree: ".git" is a file "gitdir: <path>".
  const pointer = info.isFile() && (await readSmall(dot));
  const match = /^gitdir: (.+)$/u.exec(pointer || "");
  if (!match) return undefined;
  return join(
    isAbsolute(match[1]) ? match[1] : resolve(root, match[1]),
    "HEAD",
  );
}

export async function probeWorkspaceMeta(path) {
  const meta = {};
  try {
    await access(path, constants.W_OK);
    meta.writable = true;
  } catch {
    meta.writable = false;
  }
  try {
    const head = await headFile(path);
    const text = head && (await readSmall(head));
    const ref = /^ref: refs\/heads\/(.+)$/u.exec(text || "");
    if (ref && ref[1].length <= 200) meta.branch = ref[1];
    else if (/^[0-9a-f]{40,64}$/u.test(text || ""))
      meta.branch = `(detached ${text.slice(0, 7)})`;
  } catch {
    // Non-git or unreadable: show nothing.
  }
  return meta;
}
