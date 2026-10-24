import { execFile, execFileSync, spawn as nodeSpawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, realpathSync, statSync } from "node:fs";
import { constants as osConstants } from "node:os";
import { isAbsolute, relative, win32 } from "node:path";
import { TERMINAL_LIMITS } from "../renderer/shared/terminal/index.mjs";
import { readProjectActions } from "./project-actions.mjs";
import {
  isWin32,
  taskkillCommand,
  trustedSystemRoot,
} from "../platform-paths.mjs";

const WIN = process.platform === "win32";
const ENV_KEYS = WIN
  ? [
      "SystemRoot",
      "windir",
      "ComSpec",
      "PATH",
      "PATHEXT",
      "USERPROFILE",
      "USERNAME",
      "APPDATA",
      "LOCALAPPDATA",
      "ProgramFiles",
      "ProgramData",
      "SystemDrive",
      "HOMEDRIVE",
      "HOMEPATH",
      "NUMBER_OF_PROCESSORS",
      "PROCESSOR_ARCHITECTURE",
      "TEMP",
      "TMP",
    ]
  : ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "TMPDIR"];
const fail = (code) => Object.assign(new Error(code), { terminalCode: code });

// The renderer never picks an executable: only this shell or a project-actions argv runs.
export function defaultShell({
  platform = process.platform,
  env = process.env,
  exists = existsSync,
} = {}) {
  if (!isWin32(platform)) return { file: env.SHELL || "/bin/sh", args: ["-l"] };
  const ps = win32.join(
    trustedSystemRoot(env),
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  return {
    file: exists(ps) ? ps : (env.ComSpec ?? "cmd.exe"),
    args: [],
  };
}
// Output is replayed into xterm.js, so the child sees a capable terminal.
const TERM_ENV = { TERM: "xterm-256color", COLORTERM: "truecolor" };
const signalName = (n) =>
  n
    ? (Object.entries(osConstants.signals).find(([, v]) => v === n)?.[0] ??
      `${n}`)
    : null;
// Packaged macOS apps start with a minimal PATH; ask the login shell once for the user's real one.
// Bounded by timeout and output size; any failure falls back to the process PATH.
export function resolveLoginPath({
  run = execFile,
  shell = process.env.SHELL || "/bin/sh",
  timeoutMs = 3000,
} = {}) {
  const fallback = process.env.PATH ?? "";
  if (WIN) return Promise.resolve(fallback);
  return new Promise((rawDone) => {
    let child;
    let timer;
    const done = (v) => {
      clearTimeout(timer);
      child?.stdout?.destroy?.();
      child?.stderr?.destroy?.();
      rawDone(v);
    };
    // Resolve on timeout without waiting for the shell's pipes to close.
    timer = setTimeout(() => done(fallback), timeoutMs);
    try {
      child = run(
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
  const env = { ...TERM_ENV };
  for (const k of ENV_KEYS)
    if (process.env[k] !== undefined) env[k] = process.env[k];
  if (pathValue) env.PATH = pathValue;
  // A GUI-launched app may have no locale; shells and TUIs then fall back to non-UTF-8 output.
  if (!WIN && !env.LANG && !env.LC_ALL) env.LANG = "en_US.UTF-8";
  return env;
}
function inside(root, path) {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}
// Interactive shells give each job its own process group, so killing the shell's group alone misses
// `cmd &` jobs. Snapshot the descendant tree (pids and their groups) and signal all of it.
function processTable() {
  try {
    return execFileSync(
      process.platform === "darwin" ? "/bin/ps" : "ps",
      ["-A", "-o", "pid=,ppid=,pgid="],
      {
        encoding: "utf8",
        timeout: 2000,
        maxBuffer: 1 << 22,
        stdio: ["ignore", "pipe", "ignore"],
      },
    )
      .split("\n")
      .map((l) => l.trim().split(/\s+/).map(Number))
      .filter((r) => r.length === 3 && r.every(Number.isInteger));
  } catch {
    return [];
  }
}
function treeOf(root, snap = {}) {
  const rows = (snap.rows ??= processTable());
  const pids = new Set([root]);
  const groups = new Set([root]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [pid, ppid, pgid] of rows)
      if (!pids.has(pid) && pids.has(ppid)) {
        pids.add(pid);
        groups.add(pgid);
        grew = true;
      }
  }
  return { pids, groups };
}
// ponytail: Windows has no process groups here; taskkill /T walks the child tree instead (untested).
// `snap` is an optional lazily-filled ps snapshot holder so one terminate/closeAll costs one ps call.
export function killTree(
  t,
  signal,
  snap,
  {
    platform = process.platform,
    spawnProcess = nodeSpawn,
    env = process.env,
  } = {},
) {
  const pid = t.pid;
  // The pid may already be reused; never signal a child that has exited.
  if (pid === undefined || t.exited) return;
  if (isWin32(platform)) {
    try {
      // Absolute System32 path (a poisoned PATH cannot substitute taskkill), no console window.
      const { file, args } = taskkillCommand(pid, {
        systemRoot: trustedSystemRoot(env),
      });
      const killer = spawnProcess(file, args, {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.once?.("error", () => {});
      killer.unref?.();
    } catch {
      // taskkill unavailable: the caller's proc.kill() still closes the console.
    }
    return;
  }
  const { pids, groups } = treeOf(pid, snap);
  for (const g of groups) if (g > 1) send(-g, signal);
  for (const p of pids) send(p, signal);
}
function send(target, signal) {
  try {
    process.kill(target, signal);
  } catch {
    // ESRCH: already gone.
  }
}

// Windows package managers are .cmd shims, so the script runs through cmd. The shim is resolved
// from absolute PATH entries only: cmd itself would try the (workspace) cwd first and could pick up
// a planted pnpm.cmd. If no safe absolute path is found it falls back to the bare name (cwd first).
// Script names are [\w:.-] and the manager comes from a fixed set. node-pty takes a string
// command line on Windows verbatim, which keeps the quoting exactly as written here.
export function windowsScriptSpec(
  pm,
  script,
  { env = process.env, exists = existsSync, comSpec = env.ComSpec } = {},
) {
  const dirs = (env.PATH ?? env.Path ?? "")
    .split(";")
    .filter((d) => win32.isAbsolute(d));
  let command = pm;
  search: for (const dir of dirs)
    for (const ext of [".cmd", ".exe", ".bat"]) {
      const candidate = win32.join(dir, pm + ext);
      if (!/["%^&|<>]/.test(candidate) && exists(candidate)) {
        command = `"${candidate}"`;
        break search;
      }
    }
  return {
    file: comSpec ?? "cmd.exe",
    args: `/d /s /c "${command} run ${script}"`,
  };
}

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
// Per-terminal input limits: a compromised renderer cannot flood the PTY or the resize ioctl.
const RATE = Object.freeze({
  windowMs: 1000,
  writeCalls: 200,
  writeChars: 262144,
  resizeCalls: 30,
});

// `pty` is node-pty's module shape ({ spawn }); injected so tests use a fake and the packaged
// build loads the staged native binary. A missing pty fails closed with PTY_UNAVAILABLE.
export function createTerminalHost({
  resolveWorkspace,
  pty,
  shell = defaultShell(),
  now = Date.now,
  kill = killTree,
  killGraceMs = 1500,
  forceExitMs = 2000,
  closeAllMs = killGraceMs + forceExitMs + 1000,
  loginPath,
  loginPathTimeoutMs = 3000,
} = {}) {
  const terminals = new Map();
  let pathValue;
  const epochs = new Map(); // owner -> closeOwner count; a bump during the PATH wait cancels the spawn
  const guarded = (owner, wait, run) => {
    if (!wait) return run();
    const e = epochs.get(owner) ?? 0;
    return wait.then(() => {
      if ((epochs.get(owner) ?? 0) !== e) throw fail("NOT_FOUND");
      return run();
    });
  };
  // loginPath may be a promise or a function that starts the lookup (called lazily on first use).
  // start() stays synchronous once settled; until then it waits (bounded) so no terminal gets a minimal PATH.
  let pathReady;
  let pathSettled = !loginPath;
  const ensurePath = () => {
    if (pathSettled) return undefined;
    return (pathReady ??= Promise.race([
      Promise.resolve(
        typeof loginPath === "function" ? loginPath() : loginPath,
      ),
      new Promise((r) => setTimeout(r, loginPathTimeoutMs).unref?.()),
    ])
      .then((p) => {
        if (typeof p === "string" && p) pathValue = p;
      })
      .catch(() => {})
      .finally(() => {
        pathSettled = true;
      }));
  };

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
  // Fixed window per terminal and kind; cheap and good enough against a runaway renderer.
  function allow(t, kind, calls, chars = 0, limit = Infinity) {
    const at = now();
    const w = (t.rate[kind] ??= { start: at, calls: 0, chars: 0 });
    if (at - w.start >= RATE.windowMs)
      Object.assign(w, { start: at, calls: 0, chars: 0 });
    if (w.calls + 1 > calls || w.chars + chars > limit)
      throw fail("RATE_LIMITED");
    w.calls += 1;
    w.chars += chars;
  }
  // Chunk ring: appends are O(1) (no re-slicing of the whole buffer per pty read); whole oldest
  // chunks are dropped once the rest still holds the limit. `total` is the absolute end offset.
  function appendText(t, text) {
    if (!text) return;
    const dropped = Math.max(0, text.length - TERMINAL_LIMITS.outputChars);
    if (dropped) text = text.slice(dropped);
    t.chunks.push({ start: t.total + dropped, text });
    t.total += dropped + text.length;
    t.size += text.length;
    while (
      t.chunks.length - t.head > 1 &&
      t.size - t.chunks[t.head].text.length >= TERMINAL_LIMITS.outputChars
    ) {
      t.size -= t.chunks[t.head].text.length;
      t.chunks[t.head++] = undefined;
    }
    if (t.head > 1024) {
      t.chunks = t.chunks.slice(t.head);
      t.head = 0;
    }
  }
  const baseOf = (t) => t.chunks[t.head]?.start ?? t.total;
  function sliceFrom(t, from, max) {
    let i = t.chunks.length - 1;
    while (i > t.head && t.chunks[i].start > from) i--;
    let out = "";
    for (; i < t.chunks.length && out.length < max; i++) {
      const c = t.chunks[i];
      if (!c) continue;
      out += c.text.slice(
        Math.max(0, from - c.start),
        max - out.length + Math.max(0, from - c.start),
      );
    }
    return out;
  }
  // Interactive shells ignore SIGTERM, so hang up the session first, then force after the grace period.
  // Bounded: if the OS never reports the exit (e.g. a Windows console that will not close), the
  // terminal is declared exited after `forceExitMs` so close/stop cannot hang forever.
  function terminate(t, snap = {}) {
    if (t.exited) return Promise.resolve();
    kill(t, "SIGHUP", snap);
    kill(t, "SIGTERM", snap);
    if (WIN) {
      try {
        t.proc.kill();
      } catch {
        // already closed
      }
    }
    const timer = setTimeout(() => kill(t, "SIGKILL"), killGraceMs);
    const forced = setTimeout(
      () => t.finish(null, "SIGKILL"),
      killGraceMs + forceExitMs,
    );
    timer.unref?.();
    forced.unref?.();
    return t.done.finally(() => {
      clearTimeout(timer);
      clearTimeout(forced);
    });
  }
  async function remove(t, snap) {
    t.closing = true;
    await terminate(t, snap);
    terminals.delete(t.id);
  }

  // spawnSpec overrides the interactive shell: argv is passed as-is, never through a shell string.
  let closedAll = false;
  function launch(
    owner,
    { workspaceId, cwd, cols, rows } = {},
    spawnSpec,
    meta = {},
  ) {
    if (!pty) throw fail("PTY_UNAVAILABLE");
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
    let proc;
    try {
      proc = pty.spawn(target.file, target.args, {
        name: TERM_ENV.TERM,
        cols: cols ?? DEFAULT_COLS,
        rows: rows ?? DEFAULT_ROWS,
        cwd: realCwd,
        env: minimalEnv(pathValue),
        encoding: "utf8",
        ...(WIN ? { useConpty: true } : {}),
      });
    } catch (e) {
      throw fail(
        e?.terminalCode === "PTY_UNAVAILABLE"
          ? "PTY_UNAVAILABLE"
          : "SPAWN_FAILED",
      );
    }
    const t = {
      id: randomUUID(),
      owner,
      workspaceId,
      proc,
      pid: proc.pid,
      chunks: [],
      head: 0,
      total: 0,
      size: 0,
      exited: false,
      exitCode: null,
      signal: null,
      closing: false,
      rate: {},
      script: meta.script ?? null,
      label: meta.label ?? null,
    };
    t.done = new Promise((resolve) => {
      t.finish = (exitCode, signal) => {
        if (t.exited) return;
        t.exited = true;
        t.exitCode = exitCode;
        t.signal = signal;
        resolve();
      };
      proc.onExit(({ exitCode, signal }) => {
        if (t.exited) return;
        t.finish(signal ? null : (exitCode ?? null), signalName(signal));
        // The leader's group cannot have been reused yet, so one immediate sweep is safe: anything the
        // shell left in its own group dies with it. Jobs that an interactive shell moved to their own
        // process group are not found here (the tree is gone once the shell exits); like in any
        // terminal they outlive a shell that exits by itself. Close/stop/quit kill the whole tree first.
        if (!WIN) send(-t.pid, "SIGKILL");
      });
    });
    proc.onData((data) => appendText(t, data));
    terminals.set(t.id, t);
    return view(t);
  }

  return {
    start(owner, request) {
      return guarded(owner, ensurePath(), () => launch(owner, request));
    },
    // Script must exist in the workspace's package.json right now; package manager comes from its lockfile.
    async startScript(owner, { workspaceId, script, cols, rows }) {
      const root = resolveWorkspace(workspaceId);
      if (typeof root !== "string") throw fail("NOT_FOUND");
      const e = epochs.get(owner) ?? 0;
      const { packageManager, scripts } = await readProjectActions(root);
      if ((epochs.get(owner) ?? 0) !== e) throw fail("NOT_FOUND");
      // After the await: closeAll may have landed while reading package.json.
      // ponytail: never reset; if quit fails mid-way, scripts stay CLOSED until restart.
      if (closedAll) throw fail("CLOSED");
      if (!scripts.some((s) => s.name === script)) throw fail("UNKNOWN_SCRIPT");
      const label = `${packageManager} run ${script}`;
      const spec = WIN
        ? windowsScriptSpec(packageManager, script, {
            env: { ...process.env, PATH: pathValue ?? process.env.PATH },
          })
        : { file: packageManager, args: ["run", script] };
      return guarded(owner, ensurePath(), () =>
        launch(owner, { workspaceId, cols, rows }, spec, { script, label }),
      );
    },
    async scripts(owner, workspaceId) {
      const root = resolveWorkspace(workspaceId);
      if (typeof root !== "string") throw fail("NOT_FOUND");
      return readProjectActions(root);
    },
    // Open terminal tabs of any owner for a workspace (exited ones stay until closed).
    openCount(workspaceId) {
      return [...terminals.values()].filter(
        (t) => t.workspaceId === workspaceId,
      ).length;
    },
    list(owner, workspaceId) {
      return [...terminals.values()]
        .filter((t) => t.owner === owner && t.workspaceId === workspaceId)
        .map(view);
    },
    write(owner, id, text) {
      const t = get(id, owner);
      if (t.exited) throw fail("NOT_RUNNING");
      allow(t, "write", RATE.writeCalls, text.length, RATE.writeChars);
      try {
        t.proc.write(text);
      } catch {
        throw fail("NOT_RUNNING");
      }
      return view(t);
    },
    read(owner, id, cursor) {
      const t = get(id, owner);
      const base = baseOf(t);
      const truncated = cursor < base;
      const from = Math.min(Math.max(cursor, base), t.total);
      const slice = sliceFrom(t, from, TERMINAL_LIMITS.readChars);
      return {
        ...view(t),
        output: slice,
        cursor: from + slice.length,
        truncated,
      };
    },
    resize(owner, id, cols, rows) {
      const t = get(id, owner);
      if (t.exited) return { resized: false };
      allow(t, "resize", RATE.resizeCalls);
      try {
        t.proc.resize(cols, rows);
      } catch {
        return { resized: false };
      }
      return { resized: true };
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
    closeOwner(owner) {
      epochs.set(owner, (epochs.get(owner) ?? 0) + 1);
      return Promise.all(
        [...terminals.values()].filter((t) => t.owner === owner).map(remove),
      );
    },
    // Workspace removed or untrusted since start.
    reap: () =>
      Promise.all(
        [...terminals.values()]
          .filter((t) => typeof resolveWorkspace(t.workspaceId) !== "string")
          .map(remove),
      ),
    // Bounded: a terminal that never settles must not hang app quit.
    async closeAll() {
      closedAll = true;
      let timer;
      const snap = {};
      await Promise.race([
        Promise.all([...terminals.values()].map((t) => remove(t, snap))),
        new Promise((r) => {
          timer = setTimeout(r, closeAllMs);
          timer.unref?.();
        }),
      ]);
      clearTimeout(timer);
      for (const t of terminals.values()) kill(t, "SIGKILL");
      terminals.clear();
    },
    // Last-ditch for process exit handlers, where async cannot run.
    killAllSync() {
      const snap = {};
      for (const t of terminals.values()) kill(t, "SIGKILL", snap);
    },
    size: () => terminals.size,
  };
}
