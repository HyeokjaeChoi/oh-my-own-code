import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
  lstat,
  realpath,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCheckpointStore } from "./workspace-checkpoint.mjs";

async function setup(t, limits) {
  const base = await realpath(await mkdtemp(join(tmpdir(), "checkpoint-")));
  t.after(() => rm(base, { recursive: true, force: true }));
  const ws = join(base, "ws");
  await mkdir(ws);
  const store = createCheckpointStore({
    root: join(base, "cp"),
    limits,
    beforeApply: () => hook.run?.(),
  });
  return { base, ws, store };
}
const hook = {};
const read = (p) => readFile(p, "utf8");

test("checkpoint round trip: modify, create and delete are undone, then reapplied", async (t) => {
  const { ws, store } = await setup(t);
  await writeFile(join(ws, "a.txt"), "one");
  await writeFile(join(ws, "gone.txt"), "keep me");
  await mkdir(join(ws, "dir"));
  await writeFile(join(ws, "dir", "n.txt"), "nested");
  await writeFile(join(ws, ".gitignore"), "ignored.log\n");
  await writeFile(join(ws, "ignored.log"), "ignored one");
  const snap = await store.snapshot("w1", ws, "s1");
  assert.ok(snap.oid, JSON.stringify(snap));
  await store.bind("w1", "s1", "msg_1", snap.oid);
  // The "turn": modify, delete, create (also in a new directory), touch ignored.
  await writeFile(join(ws, "a.txt"), "two");
  await rm(join(ws, "gone.txt"));
  await mkdir(join(ws, "newdir"));
  await writeFile(join(ws, "newdir", "b.txt"), "created");
  await writeFile(join(ws, "ignored.log"), "ignored two");
  const record = await store.stage("w1", ws, "s1", "msg_1");
  assert.equal(await read(join(ws, "a.txt")), "one");
  assert.equal(await read(join(ws, "gone.txt")), "keep me");
  assert.equal(existsSync(join(ws, "newdir", "b.txt")), false);
  assert.equal(existsSync(join(ws, "newdir")), false);
  assert.equal(await read(join(ws, "ignored.log")), "ignored two");
  assert.deepEqual(record.files.sort(), ["a.txt", "gone.txt", "newdir/b.txt"]);
  assert.equal((await store.staged("w1", "s1")).messageId, "msg_1");
  const again = await store.reapply("w1", ws, "s1", "msg_1");
  assert.equal(again.fileCount, 3);
  assert.equal(await read(join(ws, "a.txt")), "two");
  assert.equal(existsSync(join(ws, "gone.txt")), false);
  assert.equal(await read(join(ws, "newdir", "b.txt")), "created");
  assert.equal(await store.staged("w1", "s1"), undefined);
});

test("a second stage keeps the first original so reapply returns to it", async (t) => {
  const { ws, store } = await setup(t);
  await writeFile(join(ws, "f"), "v0");
  const c0 = await store.snapshot("w", ws, "s");
  await store.bind("w", "s", "m0", c0.oid);
  await writeFile(join(ws, "f"), "v1");
  const c1 = await store.snapshot("w", ws, "s");
  await store.bind("w", "s", "m1", c1.oid);
  await writeFile(join(ws, "f"), "v2");
  await store.stage("w", ws, "s", "m1");
  assert.equal(await read(join(ws, "f")), "v1");
  await store.stage("w", ws, "s", "m0");
  assert.equal(await read(join(ws, "f")), "v0");
  await store.reapply("w", ws, "s", "m0");
  assert.equal(await read(join(ws, "f")), "v2");
});

test("the workspace .git and ignore rules are respected; large files are never deleted", async (t) => {
  const { ws, store } = await setup(t, { fileBytes: 10 });
  execFileSync("git", ["init", "-q"], { cwd: ws });
  await writeFile(join(ws, "small"), "tiny");
  await writeFile(join(ws, "big"), "x".repeat(50));
  const snap = await store.snapshot("w", ws, "s");
  await store.bind("w", "s", "m", snap.oid);
  await writeFile(join(ws, "big"), "y".repeat(60));
  await writeFile(join(ws, "small"), "changed");
  await writeFile(join(ws, "big2"), "z".repeat(70));
  await store.stage("w", ws, "s", "m");
  assert.equal(await read(join(ws, "small")), "tiny");
  assert.equal(await read(join(ws, "big")), "y".repeat(60));
  assert.equal(await read(join(ws, "big2")), "z".repeat(70));
  const tree = execFileSync("git", [
    "--git-dir",
    join(ws, "..", "cp", "w.git"),
    "ls-tree",
    "-r",
    "--name-only",
    snap.oid,
  ]).toString();
  assert.equal(tree.trim(), "small");
  assert.equal(existsSync(join(ws, ".git", "refs", "omoc")), false);
});

test("more files than the cap makes the checkpoint unavailable, never partial", async (t) => {
  const { ws, store } = await setup(t, { files: 3 });
  for (const n of "abcd") await writeFile(join(ws, n), n);
  const snap = await store.snapshot("w", ws, "s");
  assert.deepEqual(snap, { unavailable: "too_many_files" });
  assert.equal(await store.find("w", "s", "m"), undefined);
});

test("a directory swapped for an outside symlink before the restore is refused, nothing is written outside", async (t) => {
  const { base, ws, store } = await setup(t);
  const outside = join(base, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "victim"), "precious");
  await mkdir(join(ws, "dir"));
  await writeFile(join(ws, "dir", "f"), "inside");
  const snap = await store.snapshot("w", ws, "s");
  await store.bind("w", "s", "m", snap.oid);
  await writeFile(join(ws, "dir", "f"), "changed");
  hook.run = async () => {
    await rm(join(ws, "dir"), { recursive: true });
    await symlink(outside, join(ws, "dir"));
  };
  t.after(() => delete hook.run);
  await assert.rejects(store.stage("w", ws, "s", "m"), {
    checkpoint: "containment",
  });
  assert.equal(existsSync(join(outside, "f")), false);
  assert.equal(await read(join(outside, "victim")), "precious");
});

test("a created file whose directory became an outside symlink is not deleted through it", async (t) => {
  const { base, ws, store } = await setup(t);
  const outside = join(base, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "victim"), "precious");
  await writeFile(join(ws, "keep"), "k");
  const snap = await store.snapshot("w", ws, "s");
  await store.bind("w", "s", "m", snap.oid);
  await mkdir(join(ws, "made"));
  await writeFile(join(ws, "made", "victim"), "new");
  hook.run = async () => {
    await rm(join(ws, "made"), { recursive: true });
    await symlink(outside, join(ws, "made"));
  };
  t.after(() => delete hook.run);
  await assert.rejects(store.stage("w", ws, "s", "m"), {
    checkpoint: "containment",
  });
  assert.equal(await read(join(outside, "victim")), "precious");
  assert.equal((await lstat(join(ws, "made"))).isSymbolicLink(), true);
});

test("a checkpointed symlink is restored as a link, not as its target", async (t) => {
  const { base, ws, store } = await setup(t);
  await writeFile(join(base, "secret"), "outside secret");
  await symlink(join(base, "secret"), join(ws, "link"));
  const snap = await store.snapshot("w", ws, "s");
  const tree = execFileSync("git", [
    "--git-dir",
    join(base, "cp", "w.git"),
    "ls-tree",
    snap.oid,
  ]).toString();
  assert.match(tree, /^120000 blob/u);
  assert.equal(
    execFileSync("git", [
      "--git-dir",
      join(base, "cp", "w.git"),
      "cat-file",
      "blob",
      `${snap.oid}:link`,
    ]).toString(),
    join(base, "secret"),
  );
});

test("repository- and user-controlled git config, hooks and filters never run", async (t) => {
  const { base, ws, store } = await setup(t);
  const marker = join(base, "MARKER");
  const hostile = `touch ${marker}`;
  // Workspace repository config + hook + .gitattributes filter.
  execFileSync("git", ["init", "-q"], { cwd: ws });
  await writeFile(
    join(ws, ".git", "config"),
    `[core]\n\tfsmonitor = ${hostile}\n\thooksPath = ${join(ws, "hooks")}\n[filter "evil"]\n\tclean = ${hostile}\n\tsmudge = ${hostile}\n\trequired = true\n`,
  );
  await mkdir(join(ws, "hooks"));
  await writeFile(join(ws, "hooks", "post-commit"), `#!/bin/sh\n${hostile}\n`, {
    mode: 0o755,
  });
  await writeFile(join(ws, ".gitattributes"), "* filter=evil\n");
  await writeFile(join(ws, "f.txt"), "content");
  // User-level config in the real HOME and XDG config.
  const home = join(base, "userhome");
  await mkdir(join(home, ".config", "git"), { recursive: true });
  const userConfig = `[core]\n\tfsmonitor = ${hostile}\n[filter "evil"]\n\tclean = ${hostile}\n[safe]\n\tdirectory = *\n`;
  await writeFile(join(home, ".gitconfig"), userConfig);
  await writeFile(join(home, ".config", "git", "config"), userConfig);
  const saved = {
    HOME: process.env.HOME,
    XDG: process.env.XDG_CONFIG_HOME,
    G: process.env.GIT_CONFIG_GLOBAL,
  };
  process.env.HOME = home;
  process.env.XDG_CONFIG_HOME = join(home, ".config");
  process.env.GIT_CONFIG_GLOBAL = join(home, ".gitconfig");
  t.after(() => {
    for (const [k, v] of [
      ["HOME", saved.HOME],
      ["XDG_CONFIG_HOME", saved.XDG],
      ["GIT_CONFIG_GLOBAL", saved.G],
    ])
      v === undefined ? delete process.env[k] : (process.env[k] = v);
  });
  // Control: plain git on the same inputs does run the hostile command.
  execFileSync("git", ["-C", ws, "add", "-A"], {
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    stdio: "ignore",
  });
  assert.equal(
    existsSync(marker),
    true,
    "control: the hostile config must be live",
  );
  await rm(marker);
  const snap = await store.snapshot("w", ws, "s");
  assert.ok(snap.oid, JSON.stringify(snap));
  await store.bind("w", "s", "m", snap.oid);
  await writeFile(join(ws, "f.txt"), "changed");
  await store.stage("w", ws, "s", "m");
  assert.equal(await read(join(ws, "f.txt")), "content");
  assert.equal(existsSync(marker), false, "hostile command ran");
});

test("pruning keeps the last turns and dropSession removes every ref", async (t) => {
  const { ws, store } = await setup(t, { turns: 2 });
  await writeFile(join(ws, "f"), "1");
  for (const m of ["m1", "m2", "m3"]) {
    const snap = await store.snapshot("w", ws, "s");
    await store.bind("w", "s", m, snap.oid);
  }
  assert.equal(await store.find("w", "s", "m1"), undefined);
  assert.ok(await store.find("w", "s", "m2"));
  assert.ok(await store.find("w", "s", "m3"));
  await store.dropSession("w", "s");
  assert.equal(await store.find("w", "s", "m3"), undefined);
});

test("missing git makes the checkpoint unavailable", async (t) => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "checkpoint-")));
  t.after(() => rm(base, { recursive: true, force: true }));
  const store = createCheckpointStore({
    root: join(base, "cp"),
    git: join(base, "no-such-git"),
  });
  assert.deepEqual(await store.snapshot("w", base, "s"), {
    unavailable: "git_missing",
  });
});
