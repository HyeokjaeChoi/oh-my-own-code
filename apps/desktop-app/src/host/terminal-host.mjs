import { execFile, spawn as nodeSpawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { TERMINAL_LIMITS } from "../renderer/shared/terminal/index.mjs";
import { readProjectActions } from "./project-actions.mjs";

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
// Packaged macOS apps start with a minimal PATH; ask the login shell once for the user's real one.
// Bounded by timeout and output size; any failure falls back to the process PATH.
export function resolveLoginPath({
  run = execFile,
  shell = process.env.SHELL || "/bin/sh",
  timeoutMs = 3000,
} = {}) {
  const fallback = process.env.PATH ?? "";
  if (WIN) return Promise.resolve(fallback);
  return new Promise((done) => {
    try {
      const child = run(
        shell,
        ["-ilc", 'printf "__OMOC_PATH__%s__OMOC_PATH__" "$PATH"'],
        {
          timeout: timeoutMs,
          maxBuffer: 1 << 16,
          env: { ...process.env, TERM: "dumb" },
        },
        (error, stdout) => {
          const m = /__OMOC_PATH__([^\0]{1,8192}?)__OMOC_PATH__/.exec(
            String(stdout),
          );
          if (error || !m) return done(fallback);
          const dirs = m[1].split(":").filter((d) => isAbsolute(d));
          const extra = fallback.split(":").filter((d) => !dirs.includes(d));
          done([...dirs, ...extra].join(":") || fallback);
        },
      );
      child?.stdin?.end?.();
    } catch {
      done(fallback);
    }
  });
}
function minimalEnv(pathValue) {
  const env = { TERM: "dumb" };
  for (const k of ENV_KEYS)
    if (process.env[k] !== undefined) env[k] = process.env[k];
  if (pathValue) env.PATH = pathValue;
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
  // The pid may already be reused; never taskkill a child that has exited.
  if (WIN && (child.exitCode !== null || child.signalCode !== null)) return;
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
  exitGraceMs = 500,
  closeAllMs = killGraceMs + exitGraceMs + 1000,
  loginPath,
} = {}) {
  const terminals = new Map();
  let pathValue;
  Promise.resolve(loginPath).then(
    (p) => {
      if (typeof p === "string" && p) pathValue = p;
    },
    () => {},
  );

  function view(t) {
    return {
      terminalId: t.id,
      workspaceId: t.workspaceId,
      status: t.exited ? "exited" : "running",
      exitCode: t.exitCode,
      signal: t.signal,
      script: t.script,
      label: t.label,
    };
  }
  function get(id, owner) {
    const t = terminals.get(id);
    if (!t || t.owner !== owner) throw fail("NOT_FOUND");
    return t;
  }
  const append = (t, chunk, stream) =>
    appendText(t, t.decoders[stream].write(chunk));
  function appendText(t, text) {
    t.output += text;
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

  // spawnSpec overrides the interactive shell: argv is passed as-is, never through a shell string.
  function launch(owner, { workspaceId, cwd } = {}, spawnSpec, meta = {}) {
    const root = resolveWorkspace(workspaceId);
    if (typeof root !== "string") throw fail("NOT_FOUND");
    let realRoot, realCwd;
    try {
      realRoot = realpathSync(root);
      realCwd = realpathSync(cwd ?? root);
      if (!statSync(realCwd).isDirectory()) throw new Error("not a directory");
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
    const target = spawnSpec ?? shell;
    const child = spawn(target.file, target.args, {
      cwd: realCwd,
      env: minimalEnv(pathValue),
      stdio: ["pipe", "pipe", "pipe"],
      detached: !WIN,
      windowsHide: true,
      // ponytail: Windows .cmd shims need a shell; script names are validated to [\w:.-] so no metacharacters reach it (untested).
      ...(WIN && spawnSpec ? { shell: true } : {}),
    });
    const t = {
      id: randomUUID(),
      owner,
      workspaceId,
      child,
      output: "",
      base: 0,
      decoders: {
        stdout: new StringDecoder("utf8"),
        stderr: new StringDecoder("utf8"),
      },
      exited: false,
      exitCode: null,
      signal: null,
      closing: false,
      script: meta.script ?? null,
      label: meta.label ?? null,
    };
    t.done = new Promise((resolve) => {
      let grace;
      const finish = (code, signal) => {
        if (t.exited) return;
        clearTimeout(grace);
        t.exited = true;
        t.exitCode = code;
        t.signal = signal;
        appendText(t, t.decoders.stdout.end() + t.decoders.stderr.end());
        resolve();
      };
      // No orphans: anything the shell left running in its group goes with it.
      // Finish on "close" so output still buffered in the pipes is not lost; a descendant that
      // escaped the group (setsid) may hold the pipes open, so after a short grace cut them.
      child.once("exit", (code, signal) => {
        killTree(child, "SIGKILL");
        grace = setTimeout(() => {
          child.stdout?.destroy();
          child.stderr?.destroy();
          finish(code, signal);
        }, exitGraceMs);
        grace.unref?.();
      });
      child.once("close", finish);
      child.once("error", (e) => {
        appendText(t, `\n[spawn error: ${e.code ?? e.message}]\n`);
        finish(127, null);
      });
    });
    child.stdout?.on("data", (c) => append(t, c, "stdout"));
    child.stderr?.on("data", (c) => append(t, c, "stderr"));
    child.stdin?.on("error", () => {});
    terminals.set(t.id, t);
    return view(t);
  }

  return {
    start: (owner, request) => launch(owner, request),
    // Script must exist in the workspace's package.json right now; package manager comes from its lockfile.
    async startScript(owner, { workspaceId, script }) {
      const root = resolveWorkspace(workspaceId);
      if (typeof root !== "string") throw fail("NOT_FOUND");
      const { packageManager, scripts } = await readProjectActions(root);
      if (!scripts.some((s) => s.name === script)) throw fail("UNKNOWN_SCRIPT");
      return launch(
        owner,
        { workspaceId },
        { file: packageManager, args: ["run", script] },
        { script, label: `${packageManager} run ${script}` },
      );
    },
    async scripts(owner, workspaceId) {
      const root = resolveWorkspace(workspaceId);
      if (typeof root !== "string") throw fail("NOT_FOUND");
      return readProjectActions(root);
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
    // Bounded: a terminal that never settles must not hang app quit.
    async closeAll() {
      let timer;
      await Promise.race([
        Promise.all([...terminals.values()].map(remove)),
        new Promise((r) => {
          timer = setTimeout(r, closeAllMs);
          timer.unref?.();
        }),
      ]);
      clearTimeout(timer);
      for (const t of terminals.values()) killTree(t.child, "SIGKILL");
      terminals.clear();
    },
    // Last-ditch for process exit handlers, where async cannot run.
    killAllSync() {
      for (const t of terminals.values()) killTree(t.child, "SIGKILL");
    },
    size: () => terminals.size,
  };
}
