import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { chmodSync } from "node:fs";
import { bindWorktreeIpc } from "./worktree-ipc.mjs";
import {
  createWorktreeHost,
  uuidv7,
  validateRefName,
} from "./worktree-host.mjs";

const g = (cwd, ...args) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" },
  });
function fixture() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "omoc-wt-")));
  const repo = join(dir, "repo");
  mkdirSync(repo);
  g(repo, "init", "-q", "-b", "main");
  g(
    repo,
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@t",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "init",
  );
  const documents = join(dir, "docs");
  mkdirSync(documents);
  const host = createWorktreeHost({
    documentsRoot: () => documents,
    linksFile: () => join(dir, "links.json"),
  });
  return {
    dir,
    repo,
    documents,
    host,
    done: () => rmSync(dir, { recursive: true, force: true }),
  };
}
const fails = (promise, code) =>
  assert.rejects(promise, (e) => e.worktreeCode === code);

test("branch name validation", () => {
  for (const bad of [
    "",
    "-x",
    "a..b",
    "a b",
    "a/",
    "x.lock",
    "a//b",
    "a;rm",
    "/a",
    ".h",
    "a@{1}",
    "a~1",
  ])
    assert.equal(validateRefName(bad), false, bad);
  for (const good of ["feat/x-1", "a.b_c"])
    assert.equal(validateRefName(good), true);
  assert.match(
    uuidv7(),
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
});

test("creates a worktree under the default root and links it to its parent", async () => {
  const f = fixture();
  try {
    const made = await f.host.create({
      repo: f.repo,
      branch: "feat/a",
      base: "main",
    });
    assert.ok(
      made.path.startsWith(join(realpathSync(f.documents), "OhMyOwnCode")),
    );
    assert.equal(made.parent, f.repo);
    assert.equal(
      g(made.path, "rev-parse", "--abbrev-ref", "HEAD").trim(),
      "feat/a",
    );
    assert.equal((await f.host.links())[made.path].parent, f.repo);
    await fails(
      f.host.create({ repo: f.repo, branch: "feat/a", base: "main" }),
      "BRANCH_EXISTS",
    );
    await fails(
      f.host.create({ repo: f.repo, branch: "b", base: "nope" }),
      "INVALID_BASE",
    );
    await fails(
      f.host.create({ repo: f.repo, branch: "--evil", base: "main" }),
      "INVALID_BRANCH",
    );
    await fails(
      f.host.create({
        repo: f.repo,
        branch: "c",
        base: "main",
        dest: join(f.repo, "in"),
      }),
      "INVALID_PATH",
    );
    await fails(
      f.host.create({ repo: f.dir, branch: "c", base: "main" }),
      "NOT_GIT_REPO",
    );
    const custom = join(f.dir, "custom");
    assert.equal(
      (
        await f.host.create({
          repo: f.repo,
          branch: "d",
          base: "HEAD",
          dest: custom,
        })
      ).path,
      custom,
    );
  } finally {
    f.done();
  }
});

test("deletes a clean worktree via git worktree remove, keeps the main repo and branch", async () => {
  const f = fixture();
  try {
    const made = await f.host.create({
      repo: f.repo,
      branch: "feat/a",
      base: "main",
    });
    await f.host.remove({ path: made.path, ownership: "imported" });
    assert.equal(existsSync(made.path), false);
    assert.ok(existsSync(join(f.repo, ".git")));
    assert.match(g(f.repo, "branch", "--list", "feat/a"), /feat\/a/);
    assert.deepEqual(await f.host.links(), {});
  } finally {
    f.done();
  }
});

test("refuses dirty or unmerged worktrees unless forced", async () => {
  const f = fixture();
  try {
    const made = await f.host.create({
      repo: f.repo,
      branch: "feat/a",
      base: "main",
    });
    writeFileSync(join(made.path, "x.txt"), "x");
    await assert.rejects(
      f.host.remove({ path: made.path, ownership: "imported" }),
      (e) => e.worktreeCode === "UNSAFE" && e.reasons.length === 1,
    );
    assert.ok(existsSync(made.path));
    g(made.path, "add", "x.txt");
    g(
      made.path,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "-q",
      "-m",
      "c",
    );
    const info = await f.host.inspect({
      path: made.path,
      ownership: "imported",
    });
    assert.match(info.reasons.join(), /커밋 1개/);
    await fails(
      f.host.remove({ path: made.path, ownership: "imported", force: false }),
      "UNSAFE",
    );
    await f.host.remove({
      path: made.path,
      ownership: "imported",
      force: true,
    });
    assert.equal(existsSync(made.path), false);
  } finally {
    f.done();
  }
});

test("refuses imported folders and the main repo; allows only managed folders inside the root", async () => {
  const f = fixture();
  try {
    await fails(
      f.host.remove({ path: f.repo, ownership: "imported" }),
      "NOT_DELETABLE",
    );
    await fails(
      f.host.remove({ path: f.repo, ownership: "managed" }),
      "NOT_DELETABLE",
    );
    assert.ok(existsSync(f.repo));
    const outside = join(f.dir, "outside");
    mkdirSync(outside);
    await fails(
      f.host.remove({ path: outside, ownership: "managed" }),
      "NOT_DELETABLE",
    );
    const root = join(realpathSync(f.documents), "OhMyOwnCode");
    const managed = join(root, "sess");
    mkdirSync(managed, { recursive: true });
    // symlink inside must be unlinked, never followed
    const keep = join(f.dir, "keep");
    mkdirSync(keep);
    writeFileSync(join(keep, "f"), "1");
    symlinkSync(keep, join(managed, "link"));
    await f.host.remove({ path: managed, ownership: "managed" });
    assert.equal(existsSync(managed), false);
    assert.ok(existsSync(join(keep, "f")));
    // a managed path reached through a symlink is rejected
    const link = join(root, "sneaky");
    symlinkSync(keep, link);
    await fails(
      f.host.remove({ path: link, ownership: "managed" }),
      "NOT_CANONICAL",
    );
    assert.ok(existsSync(join(keep, "f")));
  } finally {
    f.done();
  }
});

test("repo hooks and fsmonitor never run during create/inspect", async () => {
  const f = fixture();
  try {
    const marker = join(f.dir, "ran");
    const hook = join(f.repo, ".git", "hooks", "post-checkout");
    writeFileSync(hook, `#!/bin/sh\ntouch "${marker}"\n`);
    chmodSync(hook, 0o755);
    const made = await f.host.create({
      repo: f.repo,
      branch: "feat/h",
      base: "main",
    });
    g(f.repo, "config", "core.fsmonitor", `touch ${marker}.fsm`);
    await f.host.inspect({ path: made.path, ownership: "imported" });
    assert.equal(existsSync(marker), false);
    assert.equal(existsSync(`${marker}.fsm`), false);
  } finally {
    f.done();
  }
});

test("ignored files are reported as a delete reason", async () => {
  const f = fixture();
  try {
    const made = await f.host.create({
      repo: f.repo,
      branch: "feat/i",
      base: "main",
    });
    writeFileSync(join(made.path, ".gitignore"), ".env\n");
    g(made.path, "add", ".gitignore");
    g(
      made.path,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "-qm",
      "i",
    );
    writeFileSync(join(made.path, ".env"), "SECRET=1");
    const info = await f.host.inspect({
      path: made.path,
      ownership: "imported",
    });
    assert.ok(info.reasons.some((r) => r.includes("무시된 파일 1개")));
  } finally {
    f.done();
  }
});

test("concurrent creates keep every link", async () => {
  const f = fixture();
  try {
    const made = await Promise.all(
      ["a", "b", "c"].map((branch) =>
        f.host.create({ repo: f.repo, branch, base: "main" }),
      ),
    );
    assert.deepEqual(
      Object.keys(await f.host.links()).sort(),
      made.map((m) => m.path).sort(),
    );
  } finally {
    f.done();
  }
});

test("worktree IPC refuses untrusted workspaces before touching git", async () => {
  let handler;
  let touched = 0;
  bindWorktreeIpc({
    ipcMain: { handle: (_c, h) => (handler = h) },
    admit: () => true,
    host: { inspect: async () => touched++, create: async () => touched++ },
    info: () => ({ path: "/x", ownership: "imported" }),
    trusted: () => false,
    confirmTrust: async () => false,
    confirmDelete: async () => true,
  });
  for (const req of [
    { type: "worktree.inspect", workspaceId: "w" },
    { type: "worktree.create", workspaceId: "w", branch: "b", base: "HEAD" },
  ])
    assert.deepEqual(await handler({}, req), {
      ok: false,
      code: "UNTRUSTED_WORKSPACE",
    });
  assert.equal(touched, 0);
});

test("inspect stays bounded with a huge ignored directory", async () => {
  const f = fixture();
  try {
    const made = await f.host.create({
      repo: f.repo,
      branch: "feat/nm",
      base: "main",
    });
    writeFileSync(join(made.path, ".gitignore"), "node_modules/\n");
    g(made.path, "add", ".gitignore");
    g(
      made.path,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "-qm",
      "i",
    );
    mkdirSync(join(made.path, "node_modules"));
    for (let i = 0; i < 3000; i++)
      writeFileSync(join(made.path, "node_modules", `f${i}.js`), "x");
    const info = await f.host.inspect({
      path: made.path,
      ownership: "imported",
    });
    assert.ok(info.reasons.some((r) => r.includes("무시된 파일 1개")));
    assert.ok(!info.reasons.some((r) => r.includes("커밋되지 않은")));
  } finally {
    f.done();
  }
});

test("worktree IPC trust gate: confirm for git workspaces, none for plain managed folders", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "omoc-ipc-")));
  const plain = join(dir, "plain");
  const gitish = join(dir, "gitish");
  mkdirSync(plain);
  mkdirSync(join(gitish, ".git"), { recursive: true });
  try {
    let handler;
    let git = 0;
    let asked = 0;
    let answer = false;
    const infos = {
      p: { path: plain, ownership: "managed" },
      g: { path: gitish, ownership: "managed" },
    };
    bindWorktreeIpc({
      ipcMain: { handle: (_c, h) => (handler = h) },
      admit: () => true,
      host: {
        inspect: async () => (git++, { kind: "folder", reasons: [] }),
        remove: async () => git++,
        create: async () => git++,
      },
      info: (id) => infos[id],
      trusted: () => false,
      confirmTrust: async () => (asked++, answer),
      confirmDelete: async () => true,
    });
    const del = (workspaceId) =>
      handler({}, { type: "worktree.delete", workspaceId });
    assert.equal((await del("p")).ok, true);
    assert.equal(asked, 0);
    assert.deepEqual(await del("g"), {
      ok: false,
      code: "UNTRUSTED_WORKSPACE",
    });
    assert.equal(asked, 1);
    const gitBefore = git;
    assert.equal(git, gitBefore);
    answer = true;
    assert.equal((await del("g")).ok, true);
    assert.deepEqual(
      await handler(
        {},
        {
          type: "worktree.create",
          workspaceId: "p",
          branch: "b",
          base: "HEAD",
        },
      ),
      { ok: false, code: "UNTRUSTED_WORKSPACE" },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
