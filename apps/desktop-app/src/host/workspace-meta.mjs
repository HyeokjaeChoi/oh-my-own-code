// Read-only display metadata for a workspace folder: git kind (repository or
// linked worktree), origin repository of a linked worktree, current branch and
// writability. Never executes git; reads a few small metadata files.
import { access, lstat, open } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

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

// Locates the git dir. A linked worktree has a ".git" file "gitdir: <path>"; its
// origin is the repository that owns the common dir (read from "commondir").
async function gitLocation(root) {
  const dot = join(root, ".git");
  const info = await lstat(dot);
  if (info.isDirectory()) return { dir: dot, kind: "repository" };
  const pointer = info.isFile() && (await readSmall(dot));
  const match = /^gitdir: (.+)$/u.exec(pointer || "");
  if (!match) return undefined;
  const dir = isAbsolute(match[1]) ? match[1] : resolve(root, match[1]);
  const common = await readSmall(join(dir, "commondir")).catch(() => undefined);
  const commonDir = common ? resolve(dir, common) : undefined;
  return {
    dir,
    kind: "worktree",
    ...(commonDir &&
      basename(commonDir) === ".git" && {
        origin: dirname(commonDir),
      }),
  };
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
    const location = await gitLocation(path);
    if (location) {
      meta.kind = location.kind;
      if (location.origin && location.origin.length <= 1024)
        meta.origin = location.origin;
    }
    const text = location && (await readSmall(join(location.dir, "HEAD")));
    const ref = /^ref: refs\/heads\/(.+)$/u.exec(text || "");
    if (ref && ref[1].length <= 200) meta.branch = ref[1];
    else if (/^[0-9a-f]{40,64}$/u.test(text || ""))
      meta.branch = `(detached ${text.slice(0, 7)})`;
  } catch {
    // Non-git or unreadable: show nothing.
  }
  return meta;
}
