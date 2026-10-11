import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createWorkbenchGitReader } from "./workbench-git.mjs";

const git = "/Library/Developer/CommandLineTools/usr/bin/git";
const scope = () => ({
  runtimeEpoch: "test-epoch",
  sender: {},
  trusted: false,
  trustRevision: 0,
  check() {},
});
async function fixture(t) {
  const home = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "omoc-git-unit-")),
  );
  const root = join(home, "repo");
  await fs.mkdir(root);
  const env = {
    HOME: home,
    PATH: "/Library/Developer/CommandLineTools/usr/bin",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_AUTHOR_NAME: "Synthetic",
    GIT_AUTHOR_EMAIL: "synthetic@example.invalid",
    GIT_COMMITTER_NAME: "Synthetic",
    GIT_COMMITTER_EMAIL: "synthetic@example.invalid",
    LC_ALL: "C",
  };
  const run = (...args) => {
    const r = spawnSync(git, args, { cwd: root, env, encoding: "utf8" });
    assert.equal(r.status, 0, "safe synthetic setup command failed");
    return r.stdout.trim();
  };
  run("init", "-b", "main");
  await fs.writeFile(join(root, "a.txt"), "head\n");
  run("add", "--", "a.txt");
  run("commit", "-m", "synthetic");
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  return { home, root, run, workspace: { id: "synthetic", path: root } };
}
test("actual inert reader separates HEAD-index and index-worktree", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(join(f.root, "a.txt"), "index\n");
  f.run("add", "--", "a.txt");
  await fs.writeFile(join(f.root, "a.txt"), "worktree\n");
  const reader = createWorkbenchGitReader();
  t.after(() => reader.close());
  const observed = await reader.review(f.workspace, scope());
  const version = f.run("--version");
  if (
    !(
      version === "git version 2.50.1 (Apple Git-155)" ||
      /^git version 2\.54\./.test(version)
    )
  ) {
    assert.equal(observed.reason, "git_unavailable");
    t.diagnostic(
      "Actual runtime prerequisite rejected: " +
        version +
        ". No accepted Git semantics or rootFD safety claim.",
    );
    return;
  }
  assert.equal(observed.status, "available", observed.reason);
  assert.deepEqual(observed.files, [
    { path: "a.txt", index: "modified", worktree: "modified", kind: "tracked" },
  ]);
  assert.equal(Object.hasOwn(observed, "runtimeEpoch"), false);
  assert.equal(Object.hasOwn(observed, "revision"), false);
});

test("contentDigest changes when an already-modified file is edited again", async (t) => {
  const f = await fixture(t);
  const reader = createWorkbenchGitReader();
  t.after(() => reader.close());
  await fs.writeFile(join(f.root, "a.txt"), "one\n");
  const first = await reader.review(f.workspace, scope());
  if (first.status !== "available") return t.diagnostic(first.reason);
  assert.match(first.contentDigest, /^[a-f0-9]{64}$/);
  const same = await reader.review(f.workspace, scope());
  assert.equal(same.contentDigest, first.contentDigest);
  await fs.writeFile(join(f.root, "a.txt"), "two\n");
  const second = await reader.review(f.workspace, scope());
  assert.deepEqual(second.files, first.files);
  assert.notEqual(second.contentDigest, first.contentDigest);
});

// Fully scripted process adapter: no Git executable is run by these unit cases.
// These tests establish parser/lifecycle behavior, never actual no-helper safety.
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createHash } from "node:crypto";
import {
  validateGitReviewObservation,
  validateGitDiffObservation,
} from "../renderer/shared/git-review/index.mjs";
const oid = "1".repeat(40);
function indexBytes(path = "a.txt", mode = 0o100644) {
  const name = Buffer.from(path + "\0");
  const entry = Buffer.alloc(Math.ceil((62 + name.length) / 8) * 8);
  entry.writeUInt32BE(mode, 24);
  Buffer.from(oid, "hex").copy(entry, 40);
  entry.writeUInt16BE(name.length - 1, 60);
  name.copy(entry, 62);
  const header = Buffer.alloc(12);
  header.write("DIRC");
  header.writeUInt32BE(2, 4);
  header.writeUInt32BE(1, 8);
  const body = Buffer.concat([header, entry]);
  return Buffer.concat([body, createHash("sha1").update(body).digest()]);
}
async function scriptedFixture(t, withIndex = true) {
  const home = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "omoc-git-scripted-")),
  );
  const root = join(home, "repo"),
    gitdir = join(root, ".git");
  for (const p of ["objects/info", "objects/pack", "refs/heads", "info"])
    await fs.mkdir(join(gitdir, p), { recursive: true });
  await fs.writeFile(join(gitdir, "HEAD"), "ref: refs/heads/main\n");
  await fs.writeFile(join(gitdir, "refs/heads/main"), oid + "\n");
  await fs.writeFile(
    join(gitdir, "config"),
    "[core]\nrepositoryformatversion = 0\nbare = false\n",
  );
  if (withIndex) await fs.writeFile(join(gitdir, "index"), indexBytes());
  await fs.writeFile(join(root, "a.txt"), "worktree\n");
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  return { home, root, gitdir, workspace: { id: "scripted", path: root } };
}
function scriptedSpawn(settings = {}) {
  const calls = [],
    children = [];
  let childId = 0;
  const spawn = (exe, argv, options) => {
    assert.equal(exe, git);
    assert.equal(Object.hasOwn(options.env, "GIT_CONFIG_COUNT"), false);
    assert.equal(options.env.GIT_CONFIG_GLOBAL, "/dev/null");
    assert.equal(options.env.GIT_OPTIONAL_LOCKS, "0");
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.pid = undefined;
    children.push(child);
    const number = childId++;
    const record = { argv, options, signals: [], input: [] };
    calls.push(record);
    child.stdin.on("data", (b) => record.input.push(b));
    let ended = false;
    const finish = (code = 0, signal = null, output = Buffer.alloc(0)) => {
      if (ended) return;
      ended = true;
      child.stdout.end(output);
      child.stderr.end();
      child.emit("close", code, signal);
    };
    child.kill = (signal) => {
      record.signals.push(signal);
      if (!settings.unproved) queueMicrotask(() => finish(null, signal));
      return true;
    };
    child.stdin.once("finish", () =>
      queueMicrotask(async () => {
        if (ended) return;
        const cmd = argv.find((a) =>
          [
            "config",
            "status",
            "ls-files",
            "check-attr",
            "ls-tree",
            "cat-file",
            "diff",
          ].includes(a),
        );
        if (
          (settings.hold !== undefined && settings.hold === cmd) ||
          settings.holdNumber === number
        )
          return;
        try {
          const capability =
            argv.some((arg) => /capability-(sha1|sha256)/.test(arg)) ||
            (cmd === "config" &&
              Buffer.concat(record.input).toString().includes("/capability-"));
          if (capability) {
            const format = argv.some((arg) => arg.includes("capability-sha256"))
              ? "sha256"
              : "sha1";
            const old = createHash(format)
              .update("blob 4\0old\n")
              .digest("hex");
            const outputs = {
              config: "core.bare\nfalse\0include.path\nprivate\0",
              "ls-files": "probe.txt\0",
              "check-attr": "",
              status: " M probe.txt\0",
              "ls-tree": `100644 blob ${old}\tprobe.txt\0`,
              "cat-file": argv.includes("-s") ? "4\n" : "old\n",
              diff: argv.includes("--cached")
                ? ""
                : "--- a/probe.txt\n+++ b/probe.txt\n@@ -1 +1 @@\n-old\n+new\n",
            };
            finish(0, null, Buffer.from(outputs[cmd] ?? ""));
            return;
          }
          let output = "";
          if (argv[0] === "--version") output = "git version 2.54.0\n";
          else if (cmd === "config") {
            assert.deepEqual(argv, [
              "config",
              "--file",
              "-",
              "--no-includes",
              "--null",
              "--list",
            ]);
            output =
              settings.config ??
              "core.repositoryformatversion\n0\0core.bare\nfalse\0";
            if (settings.parseFailure) {
              child.stderr.write(Buffer.concat(record.input));
              finish(128);
              return;
            }
          } else if (cmd === "ls-files")
            output = settings.candidates ?? "a.txt\0";
          else if (cmd === "check-attr") output = settings.attributes ?? "";
          else if (cmd === "status") output = settings.status ?? "MM a.txt\0";
          else if (cmd === "ls-tree")
            output = settings.treeAbsent ? "" : `100644 blob ${oid}\ta.txt\0`;
          else if (cmd === "cat-file")
            output = argv.includes("-s") ? "5\n" : "head\n";
          else if (cmd === "diff") {
            if (settings.status === "?? a.txt\0") {
              const copied = argv
                .find((arg) => arg.startsWith("--work-tree="))
                .slice(12);
              record.compared = [
                "head\n",
                await fs.readFile(join(copied, "a.txt"), "utf8"),
              ];
              const gitdir = argv
                .find((arg) => arg.startsWith("--git-dir="))
                .slice(10);
              record.privateIndex = await fs.readFile(join(gitdir, "index"));
              output =
                record.compared[0] === record.compared[1]
                  ? ""
                  : "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-head\n+worktree\n";
            } else
              output =
                settings.patch ??
                "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-head\n+worktree\n";
          }
          await settings.beforeClose?.(cmd, record);
          finish(
            settings.exitCode ??
              (cmd === "diff" && argv.includes("--no-index") && output ? 1 : 0),
            null,
            Buffer.from(output),
          );
        } catch {
          finish(128);
        }
      }),
    );
    return child;
  };
  return { spawn, calls, children };
}
const reviewShape = (value) =>
  validateGitReviewObservation({
    runtimeEpoch: "test-epoch",
    revision: 0,
    ...value,
  });
const diffShape = (value) =>
  validateGitDiffObservation({
    runtimeEpoch: "test-epoch",
    revision: 0,
    ...value,
  });
const detail = (f, observed, mode = "unstaged", baseRef) => ({
  type: "git.diff.read",
  workspaceId: f.workspace.id,
  observationId: observed.observationId,
  mode,
  path: "a.txt",
  ...(baseRef ? { baseRef } : {}),
});

test("scripted adapter preserves separate XY and exact public shape", async (t) => {
  const f = await scriptedFixture(t),
    adapter = scriptedSpawn(),
    events = [];
  const r = createWorkbenchGitReader({
    spawn: adapter.spawn,
    tempRoot: f.home,
    onEvent: (e) => events.push(e),
  });
  t.after(() => r.close());
  const s = scope(),
    observed = await r.review(f.workspace, s);
  assert.equal(observed.status, "available", observed.reason);
  reviewShape(observed);
  assert.deepEqual(observed.files, [
    { path: "a.txt", index: "modified", worktree: "modified", kind: "tracked" },
  ]);
  assert.equal(Object.hasOwn(observed, "runtimeEpoch"), false);
  const selected = await r.diff(f.workspace, detail(f, observed), s);
  assert.equal(selected.status, "available", selected.reason);
  diffShape(selected);
  const patchCall = adapter.calls.find((c) => c.argv.includes("diff"));
  assert.ok(patchCall.argv.includes("--no-textconv"));
  assert.ok(patchCall.argv.includes("--no-ext-diff"));
  assert.equal(patchCall.options.stdio.length, 3);
  assert.ok(
    patchCall.argv.some((arg) =>
      arg.startsWith("--work-tree=" + f.home + "/omoc-git-read-"),
    ),
  );
  assert.equal(
    patchCall.argv.some((arg) => arg.includes("/dev/fd/")),
    false,
  );
  assert.equal(
    events.filter((e) => e.type === "spawn").length,
    events.filter((e) => e.type === "exit").length,
  );
  for (const e of events.filter((e) => e.type === "namespace"))
    await assert.rejects(fs.stat(e.path), { code: "ENOENT" });
});
test("unknown, evicted, wrong sender/epoch and unobserved branch reject without IO", async (t) => {
  const f = await scriptedFixture(t),
    a = scriptedSpawn(),
    r = createWorkbenchGitReader({
      spawn: a.spawn,
      tempRoot: f.home,
      limits: { observationsPerWorkspace: 1 },
    });
  t.after(() => r.close());
  const s = scope(),
    first = await r.review(f.workspace, s);
  assert.equal(first.status, "available", first.reason);
  await assert.rejects(r.diff(f.workspace, detail(f, first), scope()), {
    appCode: "INVALID_REQUEST",
  });
  await assert.rejects(
    r.diff(f.workspace, detail(f, first, "base", "unknown"), s),
    { appCode: "INVALID_REQUEST" },
  );
  const second = await r.review(f.workspace, s);
  const count = a.calls.length;
  await assert.rejects(r.diff(f.workspace, detail(f, first), s), {
    appCode: "INVALID_REQUEST",
  });
  await assert.rejects(
    r.diff(
      f.workspace,
      { ...detail(f, second), observationId: "0".repeat(64) },
      s,
    ),
    { appCode: "INVALID_REQUEST" },
  );
  await assert.rejects(
    r.diff(f.workspace, detail(f, second), { ...s, runtimeEpoch: "other" }),
    { appCode: "INVALID_REQUEST" },
  );
  r.closeSender(s.sender);
  await assert.rejects(r.diff(f.workspace, detail(f, second), s), {
    appCode: "INVALID_REQUEST",
  });
  assert.equal(a.calls.length, count);
});
test("known expired base retains original OID and makes no fresh observation", async (t) => {
  const f = await scriptedFixture(t),
    a = scriptedSpawn();
  let clock = Date.now();
  const r = createWorkbenchGitReader({
    spawn: a.spawn,
    now: () => clock,
    tempRoot: f.home,
  });
  t.after(() => r.close());
  const s = scope(),
    o = await r.review(f.workspace, s);
  assert.equal(o.status, "available", o.reason);
  clock += 30000;
  await fs.writeFile(join(f.gitdir, "refs/heads/main"), "2".repeat(40) + "\n");
  const count = a.calls.length;
  const d = await r.diff(f.workspace, detail(f, o, "base", "main"), s);
  assert.equal(d.reason, "expired_observation");
  assert.equal(d.baseOid, oid);
  diffShape(d);
  assert.equal(a.calls.length, count);
});
test("changed original metadata invalidates identity permanently", async (t) => {
  const f = await scriptedFixture(t),
    a = scriptedSpawn(),
    r = createWorkbenchGitReader({ spawn: a.spawn, tempRoot: f.home });
  t.after(() => r.close());
  const s = scope(),
    o = await r.review(f.workspace, s);
  assert.equal(o.status, "available", o.reason);
  const p = join(f.gitdir, "config"),
    original = await fs.readFile(p);
  await fs.appendFile(p, "\n");
  assert.equal(
    (await r.diff(f.workspace, detail(f, o), s)).reason,
    "stale_observation",
  );
  await fs.writeFile(p, original);
  const count = a.calls.length;
  assert.equal(
    (await r.diff(f.workspace, detail(f, o), s)).reason,
    "stale_observation",
  );
  assert.equal(a.calls.length, count);
});
test("scripted untracked base uses real base blob; equal and different paths", async (t) => {
  const f = await scriptedFixture(t, false),
    a = scriptedSpawn({ status: "?? a.txt\0" });
  const r = createWorkbenchGitReader({ spawn: a.spawn, tempRoot: f.home });
  t.after(() => r.close());
  const s = scope();
  await fs.writeFile(join(f.root, "a.txt"), "head\n");
  const o = await r.review(f.workspace, s);
  assert.equal(o.status, "available", o.reason);
  const staged = await r.diff(f.workspace, detail(f, o, "staged"), s);
  assert.equal(staged.reason, "not_staged");
  const equal = await r.diff(f.workspace, detail(f, o, "base", "main"), s);
  assert.equal(equal.status, "available", equal.reason);
  assert.equal(equal.patch, "");
  await fs.writeFile(join(f.root, "a.txt"), "worktree\n");
  const fresh = await r.review(f.workspace, s);
  const different = await r.diff(
    f.workspace,
    detail(f, fresh, "base", "main"),
    s,
  );
  assert.equal(different.status, "available", different.reason);
  assert.match(different.patch, /-head\n\+worktree/);
  const pairs = a.calls.filter((c) => c.compared);
  assert.deepEqual(
    pairs.map((c) => c.compared),
    [
      ["head\n", "head\n"],
      ["head\n", "worktree\n"],
    ],
  );
});
test("closed unsupported config/attributes never become clean", async (t) => {
  for (const settings of [
    { config: "include.path\nelsewhere\0" },
    { config: "filter.evil.clean\nhelper\0" },
    { config: "core.autocrlf\ntrue\0" },
    { attributes: "a.txt\0filter\0evil\0" },
    { attributes: "a.txt\0working-tree-encoding\0UTF-16\0" },
    { attributes: "a.txt\0diff\0evil\0" },
  ]) {
    const f = await scriptedFixture(t),
      a = scriptedSpawn(settings),
      r = createWorkbenchGitReader({ spawn: a.spawn, tempRoot: f.home });
    t.after(() => r.close());
    const o = await r.review(f.workspace, scope());
    assert.equal(o.reason, "unsupported_configuration");
    assert.equal(Object.hasOwn(o, "files"), false);
    assert.equal(
      a.calls.some(
        (c) =>
          c.argv.includes("status") &&
          !c.argv.some((v) => v.includes("/capability-")),
      ),
      false,
    );
  }
});
test("full refusal on row/object/index/output bounds, no partial clean", async (t) => {
  for (const settings of [
    { limits: { files: 1 }, adapter: { status: " M a.txt\0 M b.txt\0" } },
    { limits: { candidates: 1 } },
    { limits: { indexBytes: 20 } },
    { limits: { childStdoutBytes: 4 } },
  ]) {
    const f = await scriptedFixture(t);
    if (settings.limits.candidates === 1)
      await fs.writeFile(join(f.root, "b.txt"), "b\n");
    const a = scriptedSpawn(settings.adapter),
      r = createWorkbenchGitReader({
        spawn: a.spawn,
        tempRoot: f.home,
        limits: settings.limits,
      });
    t.after(() => r.close());
    const o = await r.review(f.workspace, scope());
    assert.equal(o.reason, "too_large");
    assert.equal(Object.hasOwn(o, "files"), false);
  }
});
test("alternate, split index, gitlinks and symlink metadata refuse", async (t) => {
  for (const kind of ["alternate", "gitlink", "symlink", "bad-index"]) {
    const f = await scriptedFixture(t),
      a = scriptedSpawn(),
      r = createWorkbenchGitReader({ spawn: a.spawn, tempRoot: f.home });
    t.after(() => r.close());
    if (kind === "alternate")
      await fs.writeFile(
        join(f.gitdir, "objects/info/alternates"),
        "/untrusted\n",
      );
    if (kind === "gitlink")
      await fs.writeFile(
        join(f.gitdir, "index"),
        indexBytes("a.txt", 0o160000),
      );
    if (kind === "bad-index")
      await fs.writeFile(join(f.gitdir, "index"), "DIRC truncated");
    if (kind === "symlink") {
      await fs.rename(join(f.gitdir, "HEAD"), join(f.home, "head"));
      await fs.symlink(join(f.home, "head"), join(f.gitdir, "HEAD"));
    }
    const o = await r.review(f.workspace, scope());
    assert.equal(o.status, "unavailable");
    assert.ok(["unsupported_repository", "path_denied"].includes(o.reason));
  }
});
test("injected timeout/cancel settle exact child before removing namespace", async (t) => {
  for (const kind of ["timeout", "cancel"]) {
    const f = await scriptedFixture(t),
      a = scriptedSpawn({ hold: "config" }),
      events = [];
    const r = createWorkbenchGitReader({
      spawn: a.spawn,
      tempRoot: f.home,
      limits: { childMs: 30, termMs: 5, exitMs: 50 },
      onEvent: (e) => {
        events.push(e);
        if (kind === "cancel" && e.type === "spawn" && e.kind === "config")
          queueMicrotask(() => controller.abort());
      },
    });
    t.after(() => r.close());
    const controller = new AbortController(),
      s = { ...scope(), signal: controller.signal };
    await assert.rejects(r.review(f.workspace, s), (e) =>
      ["READ_TIMEOUT", "STALE_EPOCH"].includes(e.appCode),
    );
    assert.ok(events.find((e) => e.type === "signal"));
    assert.ok(
      events.findLastIndex((e) => e.type === "exit") <
        events.findLastIndex((e) => e.type === "removed"),
    );
  }
});
test("injected unproved exit retains namespace, disables workspace and holds capacity", async (t) => {
  const f = await scriptedFixture(t),
    a = scriptedSpawn({ hold: "config", unproved: true }),
    events = [];
  const r = createWorkbenchGitReader({
    spawn: a.spawn,
    tempRoot: f.home,
    limits: { childMs: 10, termMs: 5, exitMs: 20 },
    onEvent: (e) => events.push(e),
  });
  t.after(() => r.close());
  const o = await r.review(f.workspace, scope());
  assert.equal(o.reason, "process_unverified");
  const retained = events.find((e) => e.type === "retained");
  assert.ok((await fs.stat(retained.path)).isDirectory());
  const count = a.calls.length;
  assert.equal(
    (await r.review(f.workspace, scope())).reason,
    "process_unverified",
  );
  assert.equal(a.calls.length, count);
  assert.deepEqual(a.calls.at(-1).signals, ["SIGTERM", "SIGKILL"]);
});
test("config canaries stay out of all scratch and sanitized events, including parse failure", async (t) => {
  for (const parseFailure of [false, true]) {
    const f = await scriptedFixture(t),
      secret = `CANARY-${Math.random().toString(36).slice(2)}`;
    await fs.appendFile(
      join(f.gitdir, "config"),
      `[remote "origin"]\nurl = https://user:${secret}@example.invalid/r\n[http]\nextraHeader = Authorization: Bearer ${secret}\n`,
    );
    const a = scriptedSpawn({ parseFailure }),
      events = [];
    const r = createWorkbenchGitReader({
      spawn: a.spawn,
      tempRoot: f.home,
      onEvent: (e) => events.push(e),
    });
    t.after(() => r.close());
    const o = await r.review(f.workspace, scope());
    assert.equal(JSON.stringify(o).includes(secret), false);
    assert.equal(JSON.stringify(events).includes(secret), false);
    assert.equal(
      a.calls.some((c) => c.argv.some((arg) => arg.includes(secret))),
      false,
    );
    assert.equal(
      o.status,
      parseFailure ? "unavailable" : "available",
      o.reason,
    );
    assert.ok(
      a.calls
        .filter((c) => c.argv[0] === "config")
        .some((c) => Buffer.concat(c.input).includes(Buffer.from(secret))),
    );
  }
});
test("platform refusal and factory lower-only options perform no child IO", async () => {
  const s = scope();
  let spawned = false;
  const r = createWorkbenchGitReader({
    platform: "win32",
    spawn: () => {
      spawned = true;
    },
  });
  assert.equal(
    (await r.review({ id: "x", path: "/synthetic" }, s)).reason,
    "platform_unavailable",
  );
  assert.equal(spawned, false);
  await r.close();
  assert.throws(
    () => createWorkbenchGitReader({ executable: "/usr/bin/git" }),
    { appCode: "INVALID_REQUEST" },
  );
  assert.throws(
    () => createWorkbenchGitReader({ limits: { deadlineMs: 8001 } }),
    { appCode: "INVALID_REQUEST" },
  );
});

test("metadata alias inside worktree refuses before any raw config can be copied", async (t) => {
  const f = await scriptedFixture(t),
    a = scriptedSpawn();
  await fs.rename(f.gitdir, join(f.root, ".meta"));
  await fs.writeFile(join(f.root, ".git"), "gitdir: .meta\n");
  const token = `META-CANARY-${Math.random().toString(36).slice(2)}`;
  await fs.appendFile(
    join(f.root, ".meta/config"),
    `[remote "origin"]\nurl = https://user:${token}@example.invalid/x\n`,
  );
  const writes = [];
  const io = {
    ...fs,
    async writeFile(path, bytes, options) {
      writes.push({
        path,
        containsCanary: Buffer.from(bytes).includes(Buffer.from(token)),
      });
      return fs.writeFile(path, bytes, options);
    },
  };
  const r = createWorkbenchGitReader({ io, spawn: a.spawn, tempRoot: f.home });
  t.after(() => r.close());
  const observed = await r.review(f.workspace, scope());
  assert.equal(observed.reason, "unsupported_repository");
  assert.equal(
    writes.some((w) => w.containsCanary),
    false,
  );
  assert.equal(
    a.calls.some(
      (c) =>
        c.argv[0] === "config" &&
        Buffer.concat(c.input).includes(Buffer.from(token)),
    ),
    false,
  );
});

test("case variant nested Git markers never copy config canaries", async (t) => {
  for (const marker of [".GIT", ".GiT"]) {
    const f = await scriptedFixture(t),
      a = scriptedSpawn();
    const nested = join(f.root, "nested", marker);
    await fs.mkdir(nested, { recursive: true });
    const token = `NESTED-CONFIG-CANARY-${marker}`;
    await fs.writeFile(join(nested, "config"), token);
    let canaryWrites = 0;
    const io = {
      ...fs,
      async open(path, flags, mode) {
        const handle = await fs.open(path, flags, mode);
        if (flags === "wx") {
          const write = handle.write.bind(handle);
          handle.write = async (...args) => {
            if (Buffer.from(args[0]).includes(Buffer.from(token)))
              canaryWrites++;
            return write(...args);
          };
        }
        return handle;
      },
    };
    const r = createWorkbenchGitReader({
      io,
      spawn: a.spawn,
      tempRoot: f.home,
    });
    t.after(() => r.close());
    const observed = await r.review(f.workspace, scope());
    assert.equal(canaryWrites, 0, marker + " config was copied");
    assert.equal(observed.reason, "unsupported_repository");
  }
});

test("changed trust authority retires observation before new reader IO", async (t) => {
  const f = await scriptedFixture(t),
    a = scriptedSpawn();
  let reads = 0;
  const io = {
    ...fs,
    async lstat(...args) {
      reads++;
      return fs.lstat(...args);
    },
  };
  const r = createWorkbenchGitReader({ io, spawn: a.spawn, tempRoot: f.home });
  t.after(() => r.close());
  const s = scope();
  const observed = await r.review(f.workspace, s);
  assert.equal(observed.status, "available");
  const before = { reads, spawns: a.calls.length };
  const changed = { ...s, trusted: true, trustRevision: 1 };
  const result = await r.diff(f.workspace, detail(f, observed), changed);
  assert.equal(result.reason, "stale_observation");
  assert.deepEqual({ reads, spawns: a.calls.length }, before);
  assert.equal(
    (await r.diff(f.workspace, detail(f, observed), s)).reason,
    "stale_observation",
  );
});

test("scratch parent inside worktree or external metadata refuses before any write or spawn", async (t) => {
  for (const kind of ["root", "descendant", "git", "common"]) {
    const f = await scriptedFixture(t);
    let tempRoot = f.root;
    if (kind === "descendant") {
      tempRoot = join(f.root, "scratch-parent");
      await fs.mkdir(tempRoot);
    } else if (["git", "common"].includes(kind)) {
      const external = join(f.home, "external-metadata");
      await fs.rename(f.gitdir, external);
      await fs.writeFile(f.gitdir, `gitdir: ${external}\n`);
      tempRoot = external;
      if (kind === "common") {
        const linked = join(external, "worktrees", "linked");
        await fs.mkdir(linked, { recursive: true });
        await fs.writeFile(join(linked, "commondir"), "../..\n");
        await fs.writeFile(join(linked, "gitdir"), f.gitdir + "\n");
        await fs.writeFile(f.gitdir, `gitdir: ${linked}\n`);
      }
    }
    const inventory = async (root) => {
      const rows = [];
      const walk = async (path) => {
        const stat = await fs.lstat(path, { bigint: true });
        rows.push([
          path,
          [
            stat.dev,
            stat.ino,
            stat.mode,
            stat.size,
            stat.mtimeNs,
            stat.ctimeNs,
          ].map(String),
          stat.isFile()
            ? createHash("sha256")
                .update(await fs.readFile(path))
                .digest("hex")
            : null,
        ]);
        if (stat.isDirectory())
          for (const name of (await fs.readdir(path)).sort())
            await walk(join(path, name));
      };
      await walk(root);
      return rows;
    };
    const before = await inventory(f.home);
    let created = 0,
      spawned = 0;
    const adapter = scriptedSpawn();
    const reader = createWorkbenchGitReader({
      tempRoot,
      io: {
        ...fs,
        async mkdtemp(...args) {
          created++;
          return fs.mkdtemp(...args);
        },
      },
      spawn: (...args) => {
        spawned++;
        return adapter.spawn(...args);
      },
    });
    t.after(() => reader.close());
    const result = await reader.review(f.workspace, scope());
    assert.equal(result.reason, "path_denied", kind);
    assert.equal(created, 0, kind);
    assert.equal(spawned, 0, kind);
    assert.deepEqual(await inventory(f.home), before, kind);
  }
});
