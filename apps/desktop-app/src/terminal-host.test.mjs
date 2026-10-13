import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, symlinkSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn as nodeSpawn } from "node:child_process";
import {
  createTerminalHost,
  resolveLoginPath,
  windowsScriptSpec,
} from "./host/terminal-host.mjs";
import { lazyPty } from "./host/pty-loader.mjs";
import {
  createResizeSync,
  validateTerminalRequest,
  stripAnsi,
} from "./renderer/shared/terminal/index.mjs";

const posix = process.platform !== "win32";
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const until = async (fn) => {
  for (let i = 0; i < 200; i++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.fail("timeout");
};

// Fake node-pty: tests drive data/exit by hand; the kill hook records signals and never touches real pids.
function fakePty() {
  const spawned = [];
  return {
    spawned,
    nextPid: 4242,
    spawn(file, args, opts) {
      const pid = this.nextPid;
      let onData = () => {};
      let onExit = () => {};
      const proc = {
        pid,
        file,
        args,
        opts,
        written: [],
        sizes: [],
        onData: (cb) => (onData = cb),
        onExit: (cb) => (onExit = cb),
        write: (t) => proc.written.push(t),
        resize: (c, r) => proc.sizes.push([c, r]),
        emit: (d) => onData(d),
        exit: (exitCode, signal = 0) => onExit({ exitCode, signal }),
      };
      spawned.push(proc);
      return proc;
    },
  };
}
function fixture(extra = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "term-")));
  mkdirSync(join(root, "sub"));
  const pty = fakePty();
  const signals = [];
  const host = createTerminalHost({
    resolveWorkspace: (id) => (id === "w1" ? root : undefined),
    pty,
    shell: { file: "/bin/fake-shell", args: ["-l"] },
    killGraceMs: 20,
    kill: (t, sig) => {
      signals.push(sig);
      // A hang-up (or kill) ends the fake session like a real shell would.
      if (sig === "SIGHUP" || sig === "SIGKILL") t.proc.exit(0, 1);
    },
    ...extra,
  });
  return { root, host, pty, signals };
}

test("terminal spawns the host shell in a pty with a safe env", () => {
  process.env.OMOC_TEST_SECRET = "s3cret";
  const { host, pty, root } = fixture();
  const t = host.start("o", { workspaceId: "w1", cols: 100, rows: 30 });
  const p = pty.spawned[0];
  assert.equal(p.file, "/bin/fake-shell");
  assert.deepEqual(p.args, ["-l"]);
  assert.equal(p.opts.cwd, root);
  assert.equal(p.opts.cols, 100);
  assert.equal(p.opts.rows, 30);
  assert.equal(p.opts.env.TERM, "xterm-256color");
  assert.equal(p.opts.env.OMOC_TEST_SECRET, undefined);
  delete process.env.OMOC_TEST_SECRET;
  assert.equal(t.status, "running");
});

test("terminal captures output, input, resize and exit code", async () => {
  const { host, pty } = fixture();
  const t = host.start("o", { workspaceId: "w1" });
  const p = pty.spawned[0];
  assert.equal(p.opts.cols, 80);
  p.emit("\x1b[31mhi\x1b[0m\r\n");
  const r = host.read("o", t.terminalId, 0);
  assert.equal(r.output, "\x1b[31mhi\x1b[0m\r\n");
  assert.equal(host.read("o", t.terminalId, r.cursor).output, "");
  host.write("o", t.terminalId, "ls\r");
  assert.deepEqual(p.written, ["ls\r"]);
  assert.deepEqual(host.resize("o", t.terminalId, 120, 40), { resized: true });
  assert.deepEqual(p.sizes, [[120, 40]]);
  p.exit(3);
  await until(() => host.read("o", t.terminalId, 0).status === "exited");
  assert.equal(host.read("o", t.terminalId, 0).exitCode, 3);
  assert.deepEqual(host.resize("o", t.terminalId, 80, 24), { resized: false });
  assert.throws(() => host.write("o", t.terminalId, "x"), {
    terminalCode: "NOT_RUNNING",
  });
});

test("terminal write and resize are rate limited per terminal", () => {
  let clock = 1000;
  const { host } = fixture({ now: () => clock });
  const t = host.start("o", { workspaceId: "w1" });
  for (let i = 0; i < 200; i++) host.write("o", t.terminalId, "a");
  assert.throws(() => host.write("o", t.terminalId, "a"), {
    terminalCode: "RATE_LIMITED",
  });
  for (let i = 0; i < 30; i++) host.resize("o", t.terminalId, 80, 24);
  assert.throws(() => host.resize("o", t.terminalId, 80, 24), {
    terminalCode: "RATE_LIMITED",
  });
  clock += 1000;
  host.write("o", t.terminalId, "a");
  host.resize("o", t.terminalId, 80, 24);
  clock += 1000;
  const big = "x".repeat(8192);
  for (let i = 0; i < 32; i++) host.write("o", t.terminalId, big);
  assert.throws(() => host.write("o", t.terminalId, big), {
    terminalCode: "RATE_LIMITED",
  });
});

test("terminal refuses unknown workspace and cwd outside root", () => {
  const { host, root } = fixture();
  assert.throws(() => host.start("o", { workspaceId: "nope" }), {
    terminalCode: "NOT_FOUND",
  });
  assert.throws(() => host.start("o", { workspaceId: "w1", cwd: tmpdir() }), {
    terminalCode: "CWD_DENIED",
  });
  assert.throws(
    () => host.start("o", { workspaceId: "w1", cwd: join(root, "..") }),
    { terminalCode: "CWD_DENIED" },
  );
  const outside = realpathSync(mkdtempSync(join(tmpdir(), "out-")));
  symlinkSync(outside, join(root, "link"));
  assert.throws(
    () => host.start("o", { workspaceId: "w1", cwd: join(root, "link") }),
    { terminalCode: "CWD_DENIED" },
  );
  assert.equal(host.size(), 0);
});

test("terminal fails closed without a pty and on spawn errors", () => {
  assert.throws(
    () => fixture({ pty: undefined }).host.start("o", { workspaceId: "w1" }),
    { terminalCode: "PTY_UNAVAILABLE" },
  );
  const { host } = fixture({
    pty: {
      spawn() {
        throw new Error("posix_spawnp failed");
      },
    },
  });
  assert.throws(() => host.start("o", { workspaceId: "w1" }), {
    terminalCode: "SPAWN_FAILED",
  });
  assert.equal(host.size(), 0);
});

test("terminal is scoped to its owner", async () => {
  const { host } = fixture();
  const t = host.start("a", { workspaceId: "w1" });
  assert.throws(() => host.read("b", t.terminalId, 0), {
    terminalCode: "NOT_FOUND",
  });
  assert.throws(() => host.write("b", t.terminalId, "x"), {
    terminalCode: "NOT_FOUND",
  });
  assert.deepEqual(host.list("b", "w1"), []);
  await host.closeOwner("a");
  assert.equal(host.size(), 0);
});

test("stop keeps the tab, close removes it, reap closes removed workspaces", async () => {
  let live = true;
  const { host, signals } = fixture({
    resolveWorkspace: () => (live ? process.cwd() : undefined),
  });
  const t = host.start("o", { workspaceId: "w1" });
  const stopped = await host.stop("o", t.terminalId);
  assert.equal(stopped.status, "exited");
  assert.ok(signals.includes("SIGHUP"));
  assert.equal(host.list("o", "w1").length, 1);
  await host.close("o", t.terminalId);
  assert.equal(host.size(), 0);
  host.start("o", { workspaceId: "w1" });
  live = false;
  await host.reap();
  assert.equal(host.size(), 0);
});

test("a terminal that ignores hang-up is force killed after the grace period", async () => {
  const signals = [];
  const { host } = fixture({
    kill: (t, sig) => {
      signals.push(sig);
      if (sig === "SIGKILL") t.proc.exit(0, 9);
    },
  });
  const t = host.start("o", { workspaceId: "w1" });
  const stopped = await host.stop("o", t.terminalId);
  assert.deepEqual(signals.slice(0, 3), ["SIGHUP", "SIGTERM", "SIGKILL"]);
  assert.equal(stopped.signal, "SIGKILL");
  assert.equal(stopped.exitCode, null);
});

test("closeAll is bounded when a terminal never settles", async () => {
  const { host } = fixture({ kill: () => {}, closeAllMs: 50 });
  host.start("o", { workspaceId: "w1" });
  const t0 = Date.now();
  await host.closeAll();
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(host.size(), 0);
});

test("output ring serves contiguous reads across chunks and survives 50MB of 1KB chunks quickly", () => {
  const { host, pty } = fixture();
  const t = host.start("o", { workspaceId: "w1" });
  const p = pty.spawned[0];
  // Contiguity: a reader that keeps up sees every byte in order.
  let seen = "";
  let cursor = 0;
  for (let i = 0; i < 300; i++) {
    p.emit(`${String(i).padStart(4, "0")}|`.repeat(100));
    const r = host.read("o", t.terminalId, cursor);
    assert.equal(r.truncated, false);
    seen += r.output;
    cursor = r.cursor;
  }
  assert.equal(seen.length, 300 * 500);
  assert.equal(seen.slice(500 * 299, 500 * 299 + 5), "0299|");
  // Throughput: appends must not re-slice the whole buffer per chunk.
  const chunk = "x".repeat(1024);
  const t0 = performance.now();
  for (let i = 0; i < 50 * 1024; i++) p.emit(chunk);
  const ms = performance.now() - t0;
  assert.ok(ms < 3000, `50MB took ${ms}ms`);
  const r = host.read("o", t.terminalId, cursor);
  assert.equal(r.truncated, true);
  assert.ok(r.output.length <= 65536);
  // A late reader resumes from the oldest retained byte and walks to the end.
  let end = r.cursor;
  for (let n = 0; n < 100; n++) {
    const next = host.read("o", t.terminalId, end);
    if (!next.output) break;
    end = next.cursor;
  }
  assert.equal(end, 300 * 500 + 50 * 1024 * 1024);
  assert.ok(host.read("o", t.terminalId, end).output === "");
});

test("output ring keeps a bounded tail and reports truncation", () => {
  const { host, pty } = fixture();
  const t = host.start("o", { workspaceId: "w1" });
  pty.spawned[0].emit("x".repeat(300000));
  const r = host.read("o", t.terminalId, 0);
  assert.equal(r.truncated, true);
  assert.ok(r.output.length <= 65536);
});

test("startScript runs only the package manager argv for a declared script", async () => {
  const { host, pty, root } = fixture();
  const { writeFileSync } = await import("node:fs");
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ scripts: { dev: "vite" } }),
  );
  writeFileSync(join(root, "pnpm-lock.yaml"), "");
  await assert.rejects(
    host.startScript("o", { workspaceId: "w1", script: "rm" }),
    { terminalCode: "UNKNOWN_SCRIPT" },
  );
  const t = await host.startScript("o", {
    workspaceId: "w1",
    script: "dev",
    cols: 90,
    rows: 20,
  });
  const p = pty.spawned[0];
  if (posix) {
    assert.equal(p.file, "pnpm");
    assert.deepEqual(p.args, ["run", "dev"]);
  }
  assert.equal(p.opts.cols, 90);
  assert.equal(t.label, "pnpm run dev");
});

// Real node-pty, when the dev install has it: proves tty behaviour, exit codes and group kill.
const realPty = (() => {
  if (!posix) return undefined;
  try {
    return createRequire(import.meta.url)("node-pty");
  } catch {
    return undefined;
  }
})();
test(
  "real pty: tty, colors, resize, exit code, and no orphan after close",
  { skip: !realPty },
  async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "term-")));
    const host = createTerminalHost({
      resolveWorkspace: () => root,
      pty: realPty,
      shell: { file: "/bin/sh", args: [] },
      killGraceMs: 300,
    });
    const t = host.start("o", { workspaceId: "w1", cols: 100, rows: 30 });
    const out = () => host.read("o", t.terminalId, 0).output;
    host.write(
      "o",
      t.terminalId,
      "[ -t 0 ] && echo TTY_$(stty size | tr ' ' x); printf '\\033[31mred\\033[0m\\n'; sleep 60 & echo BG_$!\n",
    );
    await until(() => /BG_\d+/.test(out()));
    assert.match(out(), /TTY_30x100/);
    assert.ok(out().includes("\x1b[31mred"));
    const bg = Number(/BG_(\d+)/.exec(out())[1]);
    assert.ok(alive(bg));
    host.resize("o", t.terminalId, 120, 40);
    host.write("o", t.terminalId, "stty size | tr ' ' y\n");
    await until(() => /40y120/.test(out()));
    host.write("o", t.terminalId, "exit 7\n");
    await until(() => host.read("o", t.terminalId, 0).status === "exited");
    assert.equal(host.read("o", t.terminalId, 0).exitCode, 7);
    // A shell that exits by itself leaves its own jobs alone, like any terminal.
    process.kill(bg, "SIGKILL");
    // Close tab while a background job runs: the whole group goes.
    const t2 = host.start("o", { workspaceId: "w1" });
    host.write("o", t2.terminalId, "sleep 60 & echo BG_$!\n");
    await until(() => /BG_\d+/.test(host.read("o", t2.terminalId, 0).output));
    const bg2 = Number(
      /BG_(\d+)/.exec(host.read("o", t2.terminalId, 0).output)[1],
    );
    await host.close("o", t2.terminalId);
    await until(() => !alive(bg2));
    await host.closeAll();
  },
);

test("login PATH is resolved once, bounded, with fallback", async () => {
  const calls = [];
  const run = (file, args, opts, cb) => {
    calls.push({ file, args, opts });
    cb(null, "noise__OMOC_PATH__/opt/bin:rel:/usr/bin__OMOC_PATH__tail");
  };
  const merged = await resolveLoginPath({ run, shell: "/bin/zsh" });
  if (posix) {
    assert.ok(merged.startsWith("/opt/bin:/usr/bin"));
    assert.ok(!merged.split(":").includes("rel"));
    assert.equal(calls[0].opts.timeout, 3000);
    assert.ok(calls[0].opts.maxBuffer <= 1 << 16);
  }
  const failed = await resolveLoginPath({
    run: (_f, _a, _o, cb) => cb(new Error("x"), ""),
  });
  assert.equal(failed, process.env.PATH ?? "");
});

test("login PATH timeout resolves without waiting for pipe close and destroys streams", async () => {
  let destroyed = 0;
  const run = () => ({
    stdout: { destroy: () => destroyed++ },
    stderr: { destroy: () => destroyed++ },
    stdin: { end() {} },
  }); // never calls back
  const t0 = Date.now();
  const v = await resolveLoginPath({ run, timeoutMs: 50 });
  assert.equal(v, process.env.PATH ?? "");
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(destroyed, 2);
});

test("terminals started before login PATH resolves wait for it", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const { host, pty } = fixture({ loginPath: () => gate });
  const p = host.start("o", { workspaceId: "w1" });
  assert.ok(p instanceof Promise);
  assert.equal(pty.spawned.length, 0);
  release("/login/bin");
  const t = await p;
  assert.equal(t.status, "running");
  assert.equal(pty.spawned[0].opts.env.PATH, "/login/bin");
});

test("closeOwner during the login PATH wait cancels the pending start", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const { host, pty } = fixture({ loginPath: () => gate });
  const p = host.start("o", { workspaceId: "w1" });
  await host.closeOwner("o");
  release("/x");
  await assert.rejects(p, { terminalCode: "NOT_FOUND" });
  assert.deepEqual(host.list("o", "w1"), []);
  assert.equal(pty.spawned.length, 0);
});

test(
  "an exited terminal's pid is never signalled again (pid reuse)",
  { skip: !posix },
  async () => {
    const bystander = nodeSpawn("sleep", ["30"], { stdio: "ignore" });
    try {
      const { host, pty } = fixture({ kill: undefined });
      const t = host.start("o", { workspaceId: "w1" });
      pty.spawned[0].pid = bystander.pid;
      // pid is read at launch; emulate a reused pid by pointing the host's record at the bystander.
      const rec = host.list("o", "w1");
      assert.equal(rec.length, 1);
      pty.spawned[0].exit(0);
      await until(() => host.list("o", "w1")[0].status === "exited");
      host.killAllSync();
      await host.closeAll();
      assert.equal(alive(bystander.pid), true);
      void t;
    } finally {
      bystander.kill("SIGKILL");
    }
  },
);

test("stop and close are bounded when the OS never reports the exit", async () => {
  const { host } = fixture({
    kill: () => {},
    killGraceMs: 10,
    forceExitMs: 30,
  });
  const t = host.start("o", { workspaceId: "w1" });
  const t0 = Date.now();
  const stopped = await host.stop("o", t.terminalId);
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(stopped.status, "exited");
  assert.equal(stopped.signal, "SIGKILL");
  await host.close("o", t.terminalId);
  assert.equal(host.size(), 0);
});

test(
  "child env defaults LANG to UTF-8 when the app has no locale",
  { skip: !posix },
  () => {
    const saved = { LANG: process.env.LANG, LC_ALL: process.env.LC_ALL };
    delete process.env.LANG;
    delete process.env.LC_ALL;
    try {
      const { host, pty } = fixture();
      host.start("o", { workspaceId: "w1" });
      assert.equal(pty.spawned[0].opts.env.LANG, "en_US.UTF-8");
    } finally {
      for (const [k, v] of Object.entries(saved))
        if (v !== undefined) process.env[k] = v;
    }
  },
);

test("a missing native pty maps to PTY_UNAVAILABLE", () => {
  const { host } = fixture({ pty: lazyPty(() => undefined) });
  assert.throws(() => host.start("o", { workspaceId: "w1" }), {
    terminalCode: "PTY_UNAVAILABLE",
  });
});

test("windows script launch resolves the shim from absolute PATH entries only", () => {
  const present = new Set(["C:\\tools\\pnpm.cmd", "relative\\pnpm.cmd"]);
  const spec = windowsScriptSpec("pnpm", "dev", {
    env: { PATH: "relative;C:\\tools;C:\\other" },
    exists: (p) => present.has(p),
    comSpec: "C:\\Windows\\System32\\cmd.exe",
  });
  assert.equal(spec.file, "C:\\Windows\\System32\\cmd.exe");
  assert.equal(spec.args, '/d /s /c ""C:\\tools\\pnpm.cmd" run dev"');
  const bare = windowsScriptSpec("npm", "build:app", {
    env: { PATH: "." },
    exists: () => true,
    comSpec: "cmd.exe",
  });
  assert.equal(bare.args, '/d /s /c "npm run build:app"');
});

test("terminal request validation is closed", () => {
  const good = [
    { type: "terminal.start", workspaceId: "w1" },
    { type: "terminal.start", workspaceId: "w1", cols: 80, rows: 24 },
    { type: "terminal.write", terminalId: "abc", text: "ls\n" },
    { type: "terminal.read", terminalId: "abc", cursor: 0 },
    { type: "terminal.close", terminalId: "abc" },
    { type: "terminal.resize", terminalId: "abc", cols: 120, rows: 40 },
    { type: "terminal.write", terminalId: "abc", text: "\x1b[A\u{1F600}" },
  ];
  for (const r of good)
    assert.ok(validateTerminalRequest(r), JSON.stringify(r));
  const bad = [
    null,
    [],
    { type: "terminal.start" },
    { type: "terminal.start", workspaceId: "w1", cwd: "/" },
    { type: "terminal.start", workspaceId: "../x" },
    { type: "terminal.start", workspaceId: "w1", cols: 0 },
    { type: "terminal.write", terminalId: "abc", text: "a\0" },
    { type: "terminal.write", terminalId: "abc", text: "x".repeat(8193) },
    { type: "terminal.read", terminalId: "abc", cursor: -1 },
    { type: "terminal.resize", terminalId: "abc", cols: 80 },
    { type: "terminal.resize", terminalId: "abc", cols: 80.5, rows: 24 },
    { type: "terminal.resize", terminalId: "abc", cols: 80, rows: 1001 },
    { type: "terminal.resize", terminalId: "abc", cols: 80, rows: 24, x: 1 },
    { type: "terminal.write", terminalId: "abc", text: "\ud800" },
    { type: "terminal.write", terminalId: "abc", text: 5 },
    {
      type: "terminal.start",
      workspaceId: "w1",
      script: "dev",
      file: "/bin/sh",
    },
    { type: "terminal.exec", terminalId: "abc" },
    { type: "__proto__" },
    Object.assign(Object.create({ a: 1 }), {
      type: "terminal.list",
      workspaceId: "w1",
    }),
  ];
  for (const r of bad)
    assert.equal(validateTerminalRequest(r), undefined, JSON.stringify(r));
});

test("stripAnsi removes escapes and bare carriage returns", () => {
  assert.equal(
    stripAnsi("\x1b[31mred\x1b[0m\r\nok\rx\x1b]0;title\x07!"),
    "red\r\nokx!",
  );
});

test("terminal IPC checks admission and validation before touching the host", async () => {
  const { bindTerminalIpc } = await import("./host/terminal-ipc.mjs");
  let handler;
  const calls = [];
  const host = new Proxy({}, { get: (_, k) => () => (calls.push(k), {}) });
  let admitted = false;
  bindTerminalIpc({
    ipcMain: {
      handle: (ch, h) => (
        (handler = h),
        assert.equal(ch, "desktop:v1:terminal")
      ),
    },
    admit: () => admitted,
    host,
  });
  const event = { sender: { id: 7 } };
  const req = { type: "terminal.list", workspaceId: "w1" };
  assert.equal((await handler(event, req)).code, "INVALID_REQUEST");
  admitted = true;
  assert.equal((await handler(event, req, req)).code, "INVALID_REQUEST");
  assert.equal(
    (await handler(event, { type: "nope" })).code,
    "INVALID_REQUEST",
  );
  assert.deepEqual(calls, []);
  assert.equal((await handler(event, req)).ok, true);
  assert.deepEqual(calls, ["list"]);
});

// Manual timer harness: fire() runs the pending callback.
function fakeTimers() {
  let pending;
  return {
    setTimer: (fn, ms) => (pending = { fn, ms }),
    clearTimer: () => (pending = undefined),
    get ms() {
      return pending?.ms;
    },
    async fire() {
      const p = pending;
      pending = undefined;
      await p?.fn();
    },
  };
}

test("resize sync collapses bursts into one trailing send of the latest size", async () => {
  const timers = fakeTimers();
  const sent = [];
  const sync = createResizeSync({
    ...timers,
    send: async (c, r) => (sent.push([c, r]), { ok: true }),
  });
  for (let i = 1; i <= 100; i++) sync.request(80 + i, 24);
  assert.equal(timers.ms, 100);
  await timers.fire();
  assert.deepEqual(sent, [[180, 24]]);
  sync.request(180, 24);
  await timers.fire();
  assert.equal(sent.length, 1, "unchanged size is not re-sent");
});

test("resize sync retries a rate-limited size so the final grid is not lost", async () => {
  const timers = fakeTimers();
  const sent = [];
  let limited = 2;
  const sync = createResizeSync({
    ...timers,
    send: async (c, r) => {
      sent.push([c, r]);
      return limited-- > 0 ? { ok: false, code: "RATE_LIMITED" } : { ok: true };
    },
  });
  sync.request(100, 30);
  await timers.fire();
  assert.equal(timers.ms, 250);
  await timers.fire();
  await timers.fire();
  assert.deepEqual(sent, [
    [100, 30],
    [100, 30],
    [100, 30],
  ]);
  assert.equal(timers.ms, undefined);
  // A different failure is not retried forever.
  const sync2 = createResizeSync({
    ...timers,
    send: async () => ({ ok: false, code: "NOT_FOUND" }),
  });
  sync2.request(90, 20);
  await timers.fire();
  assert.equal(timers.ms, undefined);
  // A newer size requested while a send is in flight is sent afterwards.
  let release;
  const gate = new Promise((r) => (release = r));
  const seen = [];
  const sync3 = createResizeSync({
    ...timers,
    send: async (c) => (seen.push(c), c === 70 && (await gate), { ok: true }),
  });
  sync3.request(70, 20);
  const firing = timers.fire();
  sync3.request(71, 20);
  release();
  await firing;
  await timers.fire();
  assert.deepEqual(seen, [70, 71]);
});
