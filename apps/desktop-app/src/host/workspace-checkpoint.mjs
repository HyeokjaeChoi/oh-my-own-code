// App-owned file checkpoints for per-turn revert. A checkpoint is a commit in a
// private git dir under app data (`<root>/<workspace-id>.git`), never inside the
// workspace and never the user's `.git`. System git runs with a from-scratch
// environment so no repository-, user- or system-controlled config, hook,
// filter driver or attribute can run. Files are read here and written with
// `fast-import`, so no content filter is involved at all.
//
// Index (all in the private git dir, so it follows the workspace/session):
//   refs/omoc/<session>/pending        last snapshot, not yet bound to a message
//   refs/omoc/<session>/t/<ms>-<hash>  checkpoint taken before user message <hash>
//   refs/omoc/<session>/orig           state when the revert was staged
//   refs/omoc/<session>/staged         blob: JSON record of the staged restore
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  rmdir,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { devNull } from "node:os";
import { join } from "node:path";

export const CHECKPOINT_LIMITS = Object.freeze({
  fileBytes: 5 * 1024 * 1024,
  files: 20_000,
  totalBytes: 512 * 1024 * 1024,
  turns: 50,
  gitMs: 20_000,
  snapshotMs: 4_000,
});
const ID = /^[A-Za-z0-9_-]{1,80}$/u;
const hashOf = (value) =>
  createHash("sha256").update(value).digest("hex").slice(0, 24);
const fail = (code) => Object.assign(new Error(code), { checkpoint: code });

// C-style quoting for fast-import paths (bytes, so any file name is safe).
function quotePath(path) {
  let out = '"';
  for (const byte of Buffer.from(path, "utf8")) {
    out +=
      byte < 0x20 || byte === 0x22 || byte === 0x5c || byte >= 0x7f
        ? `\\${byte.toString(8).padStart(3, "0")}`
        : String.fromCharCode(byte);
  }
  return `${out}"`;
}
// A restore path is a plain relative path with no traversal and never `.git`.
function cleanPath(path) {
  if (
    !path ||
    path.includes("\0") ||
    path.startsWith("/") ||
    path.includes("\\")
  )
    return undefined;
  const parts = path.split("/");
  return parts.every(
    (p) => p && p !== "." && p !== ".." && p.toLowerCase() !== ".git",
  )
    ? parts
    : undefined;
}

// Bounded-parallel map (file system latency dominates a serial walk).
async function pool(items, fn, width = 32) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(width, items.length) }, async () => {
      while (next < items.length) {
        const at = next++;
        out[at] = await fn(items[at]);
      }
    }),
  );
  return out;
}

export function createCheckpointStore({
  root,
  git = "git",
  limits = {},
  platform = process.platform,
  beforeApply, // test seam: runs between computing the diff and writing
} = {}) {
  const lim = { ...CHECKPOINT_LIMITS, ...limits };
  const home = join(root, "home");
  let ready;
  let gitOk;
  const prepare = () =>
    (ready ??= mkdir(home, { recursive: true, mode: 0o700 }));

  function environment(gitDir, workTree, index) {
    return {
      PATH:
        platform === "win32"
          ? (process.env.PATH ?? "")
          : "/usr/bin:/bin:/usr/sbin:/sbin",
      ...(platform === "win32" && { SystemRoot: process.env.SystemRoot ?? "" }),
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: home,
      GIT_DIR: gitDir,
      ...(workTree && { GIT_WORK_TREE: workTree }),
      ...(index && { GIT_INDEX_FILE: index }),
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: devNull,
      GIT_ATTR_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
      GIT_OPTIONAL_LOCKS: "0",
      GIT_NO_REPLACE_OBJECTS: "1",
      GIT_AUTHOR_NAME: "omoc",
      GIT_AUTHOR_EMAIL: "omoc@localhost",
      GIT_COMMITTER_NAME: "omoc",
      GIT_COMMITTER_EMAIL: "omoc@localhost",
      LC_ALL: "C",
    };
  }
  const flags = [
    "-c",
    `core.hooksPath=${devNull}`,
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.untrackedCache=false",
    "-c",
    "core.autocrlf=false",
    "-c",
    "core.symlinks=true",
    "-c",
    `core.attributesFile=${devNull}`,
    "-c",
    "core.quotepath=false",
    "-c",
    "safe.directory=*",
    "-c",
    "gc.auto=0",
  ];

  // Runs git; `feed(write)` may stream stdin. Resolves stdout; always bounded.
  function run(
    env,
    args,
    { input, feed, max = 256 * 1024 * 1024, ms = lim.gitMs } = {},
  ) {
    return new Promise((resolve, reject) => {
      const child = spawn(git, [...flags, ...args], {
        env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        signal: AbortSignal.timeout(ms),
      });
      const out = [];
      let size = 0;
      let err = "";
      child.stdout.on("data", (chunk) => {
        size += chunk.length;
        if (size > max) child.kill();
        else out.push(chunk);
      });
      child.stderr.on("data", (chunk) => {
        if (err.length < 2000) err += chunk.toString("utf8");
      });
      child.once("error", (error) =>
        reject(fail(error.code === "ENOENT" ? "git_missing" : "git_failed")),
      );
      child.once("close", (code) =>
        code === 0 && size <= max
          ? resolve(Buffer.concat(out))
          : reject(fail("git_failed")),
      );
      child.stdin.on("error", () => {});
      (async () => {
        if (feed)
          await feed(
            (chunk) =>
              new Promise((ok) =>
                child.stdin.write(chunk) ? ok() : child.stdin.once("drain", ok),
              ),
          );
        else if (input) child.stdin.write(input);
        child.stdin.end();
      })().catch(() => child.kill());
    });
  }

  const dirOf = (workspaceId) => {
    if (!ID.test(workspaceId)) throw fail("invalid_id");
    return join(root, `${workspaceId}.git`);
  };
  async function repo(workspaceId, workTree, index) {
    await prepare();
    const gitDir = dirOf(workspaceId);
    const env = environment(gitDir, workTree, index);
    try {
      await lstat(join(gitDir, "HEAD"));
    } catch {
      await mkdir(gitDir, { recursive: true, mode: 0o700 });
      await run(env, ["init", "-q"]);
    }
    return { gitDir, env };
  }
  async function hasGit() {
    gitOk ??= run(
      {
        PATH:
          platform === "win32"
            ? (process.env.PATH ?? "")
            : "/usr/bin:/bin:/usr/sbin:/sbin",
        HOME: home,
      },
      ["--version"],
    ).then(
      () => true,
      () => false,
    );
    return gitOk;
  }
  const text = (buffer) => buffer.toString("utf8").trim();
  const sessionRef = (sessionId) => {
    if (!ID.test(sessionId)) throw fail("invalid_id");
    return `refs/omoc/${sessionId}`;
  };

  // Take a checkpoint of the workspace. Returns { oid, fileCount } or
  // { unavailable: reason }; never a partial checkpoint.
  async function snapshot(workspaceId, workspacePath, sessionId) {
    if (!(await hasGit())) return { unavailable: "git_missing" };
    try {
      const base = await realpath(workspacePath);
      const index = join(
        dirOf(workspaceId),
        `index-${randomBytes(6).toString("hex")}`,
      );
      const { env } = await repo(workspaceId, base, index);
      // Standard ignore rules (read as data); the empty index means every
      // non-ignored file is "other". `.git` is never listed.
      const listed = (
        await run(env, ["ls-files", "-z", "-o", "--exclude-standard"], {
          ms: lim.snapshotMs,
        })
      )
        .toString("utf8")
        .split("\0")
        .filter((p) => p && !p.endsWith("/"));
      await rm(index, { force: true });
      if (listed.length > lim.files) return { unavailable: "too_many_files" };
      const entries = [];
      let total = 0;
      const stats = await pool(listed, async (path) => {
        const parts = cleanPath(path);
        const info = parts
          ? await lstat(join(base, ...parts)).catch(() => undefined)
          : undefined;
        return { path, parts, info };
      });
      for (const { path, parts, info } of stats) {
        if (!info) continue;
        if (info.isSymbolicLink())
          entries.push({ path, parts, mode: "120000", symlink: true });
        else if (info.isFile() && info.size <= lim.fileBytes) {
          total += info.size;
          entries.push({
            path,
            parts,
            mode: info.mode & 0o100 ? "100755" : "100644",
          });
        }
      }
      if (total > lim.totalBytes) return { unavailable: "too_large" };
      const ref = `${sessionRef(sessionId)}/pending`;
      await discard(workspaceId, sessionId);
      const stamp = Math.floor(Date.now() / 1000);
      await run(
        environment(dirOf(workspaceId)),
        ["fast-import", "--quiet", "--done"],
        {
          ms: lim.snapshotMs,
          feed: async (write) => {
            const message = Buffer.from("omoc checkpoint\n");
            await write(
              Buffer.concat([
                Buffer.from(
                  `commit ${ref}\ncommitter omoc <omoc@localhost> ${stamp} +0000\ndata ${message.length}\n`,
                ),
                message,
                Buffer.from("deleteall\n"),
              ]),
            );
            for (let i = 0; i < entries.length; i += 32) {
              const batch = await pool(
                entries.slice(i, i + 32),
                async (entry) => {
                  const file = join(base, ...entry.parts);
                  const data = entry.symlink
                    ? Buffer.from(await readlink(file).catch(() => ""), "utf8")
                    : await readFile(file).catch(() => undefined);
                  return data && data.length <= lim.fileBytes
                    ? Buffer.concat([
                        Buffer.from(
                          `M ${entry.mode} inline ${quotePath(entry.path)}\ndata ${data.length}\n`,
                        ),
                        data,
                        Buffer.from("\n"),
                      ])
                    : Buffer.alloc(0);
                },
              );
              await write(Buffer.concat(batch));
            }
            await write(Buffer.from("done\n"));
          },
        },
      );
      const oid = text(
        await run(environment(dirOf(workspaceId)), [
          "rev-parse",
          "--verify",
          ref,
        ]),
      );
      return { oid, fileCount: entries.length };
    } catch (error) {
      if (error.checkpoint === "git_missing")
        return { unavailable: "git_missing" };
      return { unavailable: error.checkpoint ?? "failed" };
    }
  }

  const refEnv = (workspaceId) => environment(dirOf(workspaceId));
  async function bind(workspaceId, sessionId, messageId, oid) {
    const env = refEnv(workspaceId);
    const prefix = `${sessionRef(sessionId)}/t`;
    await run(env, [
      "update-ref",
      `${prefix}/${String(Date.now()).padStart(14, "0")}-${hashOf(messageId)}`,
      oid,
    ]);
    await run(env, [
      "update-ref",
      "-d",
      `${sessionRef(sessionId)}/pending`,
    ]).catch(() => {});
    // The next send commits any staged revert.
    await clearStaged(workspaceId, sessionId);
    const refs = text(
      await run(env, ["for-each-ref", "--format=%(refname)", `${prefix}/`]),
    )
      .split("\n")
      .filter(Boolean)
      .sort();
    const old = refs.slice(0, Math.max(0, refs.length - lim.turns));
    if (old.length)
      await run(env, ["update-ref", "--stdin"], {
        input: old.map((r) => `delete ${r}\n`).join(""),
      });
    return old.length;
  }
  async function discard(workspaceId, sessionId) {
    await run(refEnv(workspaceId), [
      "update-ref",
      "-d",
      `${sessionRef(sessionId)}/pending`,
    ]).catch(() => {});
  }
  async function find(workspaceId, sessionId, messageId) {
    try {
      const out = text(
        await run(refEnv(workspaceId), [
          "for-each-ref",
          "--format=%(objectname)",
          `${sessionRef(sessionId)}/t/*-${hashOf(messageId)}`,
        ]),
      );
      return out.split("\n").filter(Boolean).at(-1);
    } catch {
      return undefined;
    }
  }
  async function staged(workspaceId, sessionId) {
    try {
      const blob = text(
        await run(refEnv(workspaceId), [
          "rev-parse",
          "--verify",
          "-q",
          `${sessionRef(sessionId)}/staged`,
        ]),
      );
      return JSON.parse(
        (await run(refEnv(workspaceId), ["cat-file", "blob", blob])).toString(
          "utf8",
        ),
      );
    } catch {
      return undefined;
    }
  }
  async function clearStaged(workspaceId, sessionId) {
    const env = refEnv(workspaceId);
    for (const name of ["staged", "orig"])
      await run(env, [
        "update-ref",
        "-d",
        `${sessionRef(sessionId)}/${name}`,
      ]).catch(() => {});
  }

  // --- restore --------------------------------------------------------------
  // Walk the parent directories without following symlinks. A symlink or file
  // where a directory is expected is a containment failure, never a write.
  async function parentOf(base, parts, create) {
    let current = base;
    for (const part of parts.slice(0, -1)) {
      current = join(current, part);
      const info = await lstat(current).catch((e) => {
        if (e.code === "ENOENT") return null;
        throw e;
      });
      if (!info) {
        if (!create) return undefined;
        await mkdir(current);
      } else if (!info.isDirectory()) throw fail("containment");
    }
    return current;
  }
  async function removeEmptyParents(base, parts) {
    for (let n = parts.length - 1; n > 0; n--) {
      const dir = join(base, ...parts.slice(0, n));
      try {
        await rmdir(dir);
      } catch {
        return;
      }
    }
  }
  // Make the workspace match `target` for every path that differs from
  // `current` (both commits in the private repo). Returns the changed paths.
  async function applyDiff(workspaceId, workspacePath, target, current) {
    const base = await realpath(workspacePath);
    const env = environment(dirOf(workspaceId));
    const raw = (
      await run(env, [
        "diff-tree",
        "-r",
        "-z",
        "--no-renames",
        "--raw",
        target,
        current,
      ])
    )
      .toString("utf8")
      .split("\0");
    const changes = [];
    for (let i = 0; i + 1 < raw.length; i += 2) {
      const m = /^:(\d+) (\d+) ([0-9a-f]+) ([0-9a-f]+) ([A-Z])/u.exec(raw[i]);
      const parts = cleanPath(raw[i + 1]);
      if (!m || !parts) {
        if (m) throw fail("containment");
        continue;
      }
      const [, srcMode, , srcOid, , status] = m;
      changes.push({
        path: raw[i + 1],
        parts,
        srcMode,
        srcOid,
        remove: status === "A",
      });
    }
    await beforeApply?.();
    const changed = [];
    for (let i = 0; i < changes.length; i += 200) {
      const chunk = changes.slice(i, i + 200);
      const writes = chunk.filter((c) => !c.remove && c.srcMode !== "160000");
      const blobs = new Map();
      if (writes.length) {
        const out = await run(env, ["cat-file", "--batch"], {
          input: writes.map((c) => `${c.srcOid}\n`).join(""),
        });
        let at = 0;
        for (const c of writes) {
          const eol = out.indexOf(10, at);
          const head = out.subarray(at, eol).toString("utf8").split(" ");
          if (head[1] !== "blob") throw fail("git_failed");
          const size = Number(head[2]);
          blobs.set(c.path, out.subarray(eol + 1, eol + 1 + size));
          at = eol + 1 + size + 1;
        }
      }
      for (const c of chunk) {
        if (c.srcMode === "160000") continue;
        if (c.remove) {
          const dir = await parentOf(base, c.parts, false);
          if (!dir) continue;
          const file = join(dir, c.parts.at(-1));
          const info = await lstat(file).catch(() => null);
          if (info && !info.isDirectory()) {
            await unlink(file);
            await removeEmptyParents(base, c.parts);
            changed.push(c.path);
          }
          continue;
        }
        const dir = await parentOf(base, c.parts, true);
        const file = join(dir, c.parts.at(-1));
        const info = await lstat(file).catch(() => null);
        if (info?.isDirectory()) throw fail("containment");
        const temp = join(
          dir,
          `.omoc-restore-${randomBytes(6).toString("hex")}`,
        );
        if (c.srcMode === "120000")
          await symlink(blobs.get(c.path).toString("utf8"), temp);
        else {
          await writeFile(temp, blobs.get(c.path), {
            flag: "wx",
            mode: c.srcMode === "100755" ? 0o755 : 0o644,
          });
          await chmod(temp, c.srcMode === "100755" ? 0o755 : 0o644);
        }
        try {
          await rename(temp, file);
        } catch (error) {
          await rm(temp, { force: true });
          throw error;
        }
        changed.push(c.path);
      }
    }
    return changed;
  }

  // Revert: checkpoint the current state ("original"), restore the checkpoint
  // taken before the boundary message, and record what changed.
  async function stage(workspaceId, workspacePath, sessionId, messageId) {
    const target = await find(workspaceId, sessionId, messageId);
    if (!target) throw fail("no_checkpoint");
    const now = await snapshot(workspaceId, workspacePath, sessionId);
    if (!now.oid) throw fail("unavailable");
    // Re-staging keeps the first original so 다시 적용 returns to it.
    const prior = await staged(workspaceId, sessionId);
    const original = prior?.original ?? now.oid;
    const env = refEnv(workspaceId);
    const ref = sessionRef(sessionId);
    await run(env, ["update-ref", `${ref}/orig`, original]);
    const changed = await applyDiff(
      workspaceId,
      workspacePath,
      target,
      now.oid,
    );
    const record = {
      messageId,
      original,
      fileCount: changed.length,
      files: changed.slice(0, 50),
    };
    const blob = text(
      await run(env, ["hash-object", "-w", "--stdin"], {
        input: JSON.stringify(record),
      }),
    );
    await run(env, ["update-ref", `${ref}/staged`, blob]);
    await discard(workspaceId, sessionId);
    return record;
  }
  // 다시 적용: put back the state that existed when the revert was staged.
  async function reapply(workspaceId, workspacePath, sessionId, messageId) {
    const record = await staged(workspaceId, sessionId);
    if (!record || record.messageId !== messageId) throw fail("no_staged");
    const now = await snapshot(workspaceId, workspacePath, sessionId);
    if (!now.oid) throw fail("unavailable");
    const changed = await applyDiff(
      workspaceId,
      workspacePath,
      record.original,
      now.oid,
    );
    await discard(workspaceId, sessionId);
    await clearStaged(workspaceId, sessionId);
    return { fileCount: changed.length };
  }
  async function dropSession(workspaceId, sessionId) {
    try {
      const env = refEnv(workspaceId);
      const refs = text(
        await run(env, [
          "for-each-ref",
          "--format=%(refname)",
          `${sessionRef(sessionId)}/`,
        ]),
      );
      if (refs)
        await run(env, ["update-ref", "--stdin"], {
          input: refs
            .split("\n")
            .map((r) => `delete ${r}\n`)
            .join(""),
        });
      await run(env, ["gc", "--auto", "--quiet"]).catch(() => {});
    } catch {
      // nothing recorded for this session
    }
  }
  async function dropWorkspace(workspaceId) {
    await rm(dirOf(workspaceId), { recursive: true, force: true });
  }
  return {
    snapshot,
    bind,
    discard,
    find,
    staged,
    clearStaged,
    stage,
    reapply,
    dropSession,
    dropWorkspace,
  };
}
