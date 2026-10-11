import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, symlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTerminalHost } from "./host/terminal-host.mjs";
import {
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
  for (let i = 0; i < 100; i++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.fail("timeout");
};
function fixture(args, extra = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "term-")));
  mkdirSync(join(root, "sub"));
  const host = createTerminalHost({
    resolveWorkspace: (id) => (id === "w1" ? root : undefined),
    shell: { file: "/bin/sh", args },
    killGraceMs: 200,
    ...extra,
  });
  return { root, host };
}

test("terminal captures output and exit code", { skip: !posix }, async () => {
  const { host } = fixture(["-c", "echo hi; echo err >&2; exit 3"]);
  const t = host.start("o", { workspaceId: "w1" });
  await until(() => host.read("o", t.terminalId, 0).status === "exited");
  const r = host.read("o", t.terminalId, 0);
  assert.equal(r.exitCode, 3);
  assert.match(r.output, /hi\n/);
  assert.match(r.output, /err\n/);
  assert.equal(host.read("o", t.terminalId, r.cursor).output, "");
  await host.closeAll();
});

test("terminal input, cwd, and resize no-op", { skip: !posix }, async () => {
  const { host, root } = fixture([]);
  const t = host.start("o", { workspaceId: "w1", cwd: join(root, "sub") });
  host.write("o", t.terminalId, "pwd\nexit 0\n");
  await until(() => host.read("o", t.terminalId, 0).status === "exited");
  assert.ok(host.read("o", t.terminalId, 0).output.includes(join(root, "sub")));
  assert.deepEqual(host.resize("o", t.terminalId, 80, 24), { resized: false });
  assert.throws(() => host.write("o", t.terminalId, "x"), {
    terminalCode: "NOT_RUNNING",
  });
  await host.closeAll();
});

test(
  "terminal refuses unknown workspace and cwd outside root",
  { skip: !posix },
  () => {
    const { host, root } = fixture([]);
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
  },
);

test("terminal is scoped to its owner", { skip: !posix }, async () => {
  const { host } = fixture(["-c", "sleep 30"]);
  const t = host.start("a", { workspaceId: "w1" });
  assert.throws(() => host.read("b", t.terminalId, 0), {
    terminalCode: "NOT_FOUND",
  });
  assert.deepEqual(host.list("b", "w1"), []);
  await host.closeOwner("a");
  assert.equal(host.size(), 0);
});

test(
  "close and closeAll kill the whole process group",
  { skip: !posix },
  async () => {
    const { host } = fixture(["-c", "sleep 60 & echo $!; wait"]);
    const t = host.start("o", { workspaceId: "w1" });
    const sh = host.start("o", { workspaceId: "w1" });
    await until(() => /\d+\n/.test(host.read("o", t.terminalId, 0).output));
    const bg = Number(host.read("o", t.terminalId, 0).output.trim());
    assert.ok(alive(bg));
    await host.close("o", t.terminalId);
    await until(() => !alive(bg));
    assert.equal(host.size(), 1);
    await host.closeAll();
    assert.equal(host.size(), 0);
    assert.equal(sh.status, "running");
  },
);

test(
  "stop keeps the tab with a signal and reap closes removed workspaces",
  { skip: !posix },
  async () => {
    let live = true;
    const { host, root } = fixture(["-c", "sleep 60"], {
      resolveWorkspace: () => (live ? process.cwd() : undefined),
    });
    void root;
    const t = host.start("o", { workspaceId: "w1" });
    const stopped = await host.stop("o", t.terminalId);
    assert.equal(stopped.status, "exited");
    assert.equal(stopped.signal, "SIGTERM");
    assert.equal(host.list("o", "w1").length, 1);
    live = false;
    await host.reap();
    assert.equal(host.size(), 0);
  },
);

test(
  "output ring keeps a bounded tail and reports truncation",
  { skip: !posix },
  async () => {
    const { host } = fixture(["-c", "head -c 300000 /dev/zero | tr '\\0' x"]);
    const t = host.start("o", { workspaceId: "w1" });
    await until(() => host.read("o", t.terminalId, 0).status === "exited");
    const r = host.read("o", t.terminalId, 0);
    assert.equal(r.truncated, true);
    assert.ok(r.output.length <= 65536);
    await host.closeAll();
  },
);

test("terminal request validation is closed", () => {
  const good = [
    { type: "terminal.start", workspaceId: "w1" },
    { type: "terminal.start", workspaceId: "w1", cols: 80, rows: 24 },
    { type: "terminal.write", terminalId: "abc", text: "ls\n" },
    { type: "terminal.read", terminalId: "abc", cursor: 0 },
    { type: "terminal.close", terminalId: "abc" },
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
