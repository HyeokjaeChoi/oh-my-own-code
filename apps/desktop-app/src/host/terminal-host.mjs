import { spawn as nodeSpawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { TERMINAL_LIMITS } from "../renderer/shared/terminal/index.mjs";

const WIN = process.platform === "win32";
const ENV_KEYS = WIN
  ? ["SystemRoot", "ComSpec", "PATH", "PATHEXT", "USERPROFILE", "TEMP", "TMP"]
  : ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "TMPDIR"];
const fail = (code) => Object.assign(new Error(code), { terminalCode: code });

function defaultShell() {
  return WIN
    ? { file: process.env.ComSpec ?? "cmd.exe", args: [] }
    : { file: process.env.SHELL || "/bin/sh", args: [] };
}
function minimalEnv() {
  const env = { TERM: "dumb" };
  for (const k of ENV_KEYS)
    if (process.env[k] !== undefined) env[k] = process.env[k];
  return env;
}
function inside(root, path) {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}
// Kills the whole process group so background children of the shell die too.
// ponytail: Windows has no process groups here; taskkill /T walks the child tree instead (untested).
function killTree(child, signal) {
  if (child.pid === undefined) return;
  try {
    if (WIN)
      nodeSpawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      }).on("error", () => {});
    else process.kill(-child.pid, signal);
  } catch {
    // ESRCH: group already gone.
  }
}

// ponytail: pipe-based, no PTY. Shell sees non-tty stdio (no prompt, line editing, job control, colors); resize is a no-op.
// A PTY backend (node-pty) can replace spawn+pipes behind this same start/write/read/resize/stop/close surface.
export function createTerminalHost({
  resolveWorkspace,
  spawn = nodeSpawn,
  shell = defaultShell(),
  killGraceMs = 1500,
} = {}) {
  const terminals = new Map();

  function view(t) {
    return {
      terminalId: t.id,
      workspaceId: t.workspaceId,
      status: t.exited ? "exited" : "running",
      exitCode: t.exitCode,
      signal: t.signal,
    };
  }
  function get(id, owner) {
    const t = terminals.get(id);
    if (!t || t.owner !== owner) throw fail("NOT_FOUND");
    return t;
  }
  function append(t, chunk) {
    t.output += t.decoder.write(chunk);
    if (t.output.length > TERMINAL_LIMITS.outputChars) {
      const drop = t.output.length - TERMINAL_LIMITS.outputChars;
      t.output = t.output.slice(drop);
      t.base += drop;
    }
  }
  function terminate(t) {
    if (t.exited) return Promise.resolve();
    killTree(t.child, "SIGTERM");
    const timer = setTimeout(() => killTree(t.child, "SIGKILL"), killGraceMs);
    timer.unref?.();
    return t.done.finally(() => clearTimeout(timer));
  }
  async function remove(t) {
    t.closing = true;
    await terminate(t);
    terminals.delete(t.id);
  }

  return {
    start(owner, { workspaceId, cwd } = {}) {
      const root = resolveWorkspace(workspaceId);
      if (typeof root !== "string") throw fail("NOT_FOUND");
      let realRoot, realCwd;
      try {
        realRoot = realpathSync(root);
        realCwd = realpathSync(cwd ?? root);
        if (!statSync(realCwd).isDirectory())
          throw new Error("not a directory");
      } catch {
        throw fail("CWD_DENIED");
      }
      if (!inside(realRoot, realCwd)) throw fail("CWD_DENIED");
      const all = [...terminals.values()];
      if (
        all.length >= TERMINAL_LIMITS.total ||
        all.filter((t) => t.workspaceId === workspaceId).length >=
          TERMINAL_LIMITS.perWorkspace
      )
        throw fail("LIMIT_REACHED");
      const child = spawn(shell.file, shell.args, {
        cwd: realCwd,
        env: minimalEnv(),
        stdio: ["pipe", "pipe", "pipe"],
        detached: !WIN,
        windowsHide: true,
      });
      const t = {
        id: randomUUID(),
        owner,
        workspaceId,
        child,
        output: "",
        base: 0,
        decoder: new StringDecoder("utf8"),
        exited: false,
        exitCode: null,
        signal: null,
        closing: false,
      };
      t.done = new Promise((resolve) => {
        const finish = (code, signal) => {
          if (t.exited) return;
          t.exited = true;
          t.exitCode = code;
          t.signal = signal;
          append(t, Buffer.from(t.decoder.end()));
          resolve();
        };
        // No orphans: anything the shell left running in its group goes with it.
        // Finish on "close" so output still buffered in the pipes is not lost.
        child.once("exit", () => killTree(child, "SIGKILL"));
        child.once("close", finish);
        child.once("error", (e) => {
          append(t, Buffer.from(`\n[spawn error: ${e.code ?? e.message}]\n`));
          finish(127, null);
        });
      });
      child.stdout?.on("data", (c) => append(t, c));
      child.stderr?.on("data", (c) => append(t, c));
      child.stdin?.on("error", () => {});
      terminals.set(t.id, t);
      return view(t);
    },
    list(owner, workspaceId) {
      return [...terminals.values()]
        .filter((t) => t.owner === owner && t.workspaceId === workspaceId)
        .map(view);
    },
    write(owner, id, text) {
      const t = get(id, owner);
      if (t.exited || !t.child.stdin?.writable) throw fail("NOT_RUNNING");
      t.child.stdin.write(text);
      return view(t);
    },
    read(owner, id, cursor) {
      const t = get(id, owner);
      const truncated = cursor < t.base;
      const from = Math.max(cursor, t.base);
      const slice = t.output.slice(
        from - t.base,
        from - t.base + TERMINAL_LIMITS.readChars,
      );
      return {
        ...view(t),
        output: slice,
        cursor: from + slice.length,
        truncated,
      };
    },
    resize(owner, id) {
      get(id, owner);
      return { resized: false };
    },
    async stop(owner, id) {
      const t = get(id, owner);
      await terminate(t);
      return view(t);
    },
    async close(owner, id) {
      await remove(get(id, owner));
      return { closed: true };
    },
    // Renderer reload/destroy: nothing else can ever reach these terminals.
    closeOwner: (owner) =>
      Promise.all(
        [...terminals.values()].filter((t) => t.owner === owner).map(remove),
      ),
    // Workspace removed or untrusted since start.
    reap: () =>
      Promise.all(
        [...terminals.values()]
          .filter((t) => typeof resolveWorkspace(t.workspaceId) !== "string")
          .map(remove),
      ),
    closeAll: () => Promise.all([...terminals.values()].map(remove)),
    // Last-ditch for process exit handlers, where async cannot run.
    killAllSync() {
      for (const t of terminals.values()) killTree(t.child, "SIGKILL");
    },
    size: () => terminals.size,
  };
}
