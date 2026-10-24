import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  renameSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { test } from "node:test";
import { chmodSync } from "node:fs";
import { bindWorktreeIpc } from "./worktree-ipc.mjs";
import {
  createWorktreeHost,
  localDate,
  mapGitError,
  uuidv7,
  validateRefName,
} from "./worktree-host.mjs";

const g = (cwd, ...args) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" },
  });
function fixture(options = {}) {
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
  // The fake trash moves the folder next to the fixture (never a permanent delete).
  const trashDir = join(dir, "trash");
  mkdirSync(trashDir);
  const trashed = [];
  const host = createWorktreeHost({
    documentsRoot: () => documents,
    linksFile: () => join(dir, "links.json"),
    trash: async (path) => {
      trashed.push(path);
      renameSync(path, join(trashDir, `${trashed.length}`));
    },
    ...options,
  });
  return {
    trashed,
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
      f.host.create({ repo: f.dir, branch: "c", base: "main" }),
      "NOT_GIT_REPO",
    );
    // Default naming: local date + UUIDv7, a direct child of the managed root.
    assert.match(
      basename(made.path),
      /^\d{4}-\d{2}-\d{2}-[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    assert.ok(basename(made.path).startsWith(localDate()));
    // No caller-chosen destination exists: extra keys are ignored by create.
    const second = await f.host.create({
      repo: f.repo,
      branch: "d",
      base: "HEAD",
      dest: join(f.dir, "custom"),
    });
    assert.equal(existsSync(join(f.dir, "custom")), false);
    assert.equal(dirname(second.path), dirname(made.path));
  } finally {
    f.done();
  }
});

test("error mapping: git stderr becomes a stable code", () => {
  for (const [stderr, code] of [
    ["fatal: a branch named 'x' already exists", "BRANCH_EXISTS"],
    ["fatal: '/p/x' already exists", "PATH_EXISTS"],
    ["fatal: 'a b' is not a valid branch name", "INVALID_BRANCH"],
    ["fatal: 'x' is already checked out at '/p'", "BRANCH_IN_USE"],
    [
      "fatal: could not create directory: Permission denied",
      "PERMISSION_DENIED",
    ],
    ["fatal: not a git repository (or any of the parent", "NOT_GIT_REPO"],
    ["fatal: something else", "GIT_FAILED"],
  ])
    assert.equal(mapGitError(stderr), code, stderr);
});

test("create reports an existing branch and an existing path with their codes", async () => {
  const f = fixture();
  try {
    g(f.repo, "branch", "taken");
    await fails(
      f.host.create({ repo: f.repo, branch: "taken", base: "main" }),
      "BRANCH_EXISTS",
    );
    // Branch checked out in another worktree.
    await f.host.create({ repo: f.repo, branch: "wt1", base: "main" });
    await fails(
      f.host.create({ repo: f.repo, branch: "wt1", base: "main" }),
      "BRANCH_EXISTS",
    );
    // Unwritable managed root maps to PERMISSION_DENIED.
    const root = join(realpathSync(f.documents), "OhMyOwnCode");
    chmodSync(root, 0o500);
    try {
      if (process.getuid?.() !== 0)
        await fails(
          f.host.create({ repo: f.repo, branch: "np", base: "main" }),
          "PERMISSION_DENIED",
        );
    } finally {
      chmodSync(root, 0o700);
    }
  } finally {
    f.done();
  }
});

test("deletes a clean app-created worktree to the trash, prunes the origin, keeps repo and branch", async () => {
  const f = fixture();
  try {
    const made = await f.host.create({
      repo: f.repo,
      branch: "feat/a",
      base: "main",
    });
    const info = await f.host.remove({
      path: made.path,
      ownership: "imported",
    });
    assert.equal(info.pruned, true);
    assert.deepEqual(f.trashed, [made.path]);
    assert.equal(existsSync(made.path), false);
    assert.ok(existsSync(join(f.repo, ".git")));
    assert.match(g(f.repo, "branch", "--list", "feat/a"), /feat\/a/);
    assert.deepEqual(await f.host.links(), {});
    // The stale worktree registration was pruned (no force-remove involved).
    assert.doesNotMatch(g(f.repo, "worktree", "list"), /feat\/a/);
    assert.deepEqual(readdirSync(join(f.dir, "trash")), ["1"]);
  } finally {
    f.done();
  }
});

test("dirty worktrees are blocked with no override; unmerged commits are only a note", async () => {
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
      (e) =>
        e.worktreeCode === "UNSAFE" &&
        e.reasons.length === 1 &&
        /변경 1개/.test(e.reasons[0]),
    );
    // A leftover `force` argument is ignored: still blocked, nothing trashed.
    await fails(
      f.host.remove({ path: made.path, ownership: "imported", force: true }),
      "UNSAFE",
    );
    assert.ok(existsSync(made.path));
    assert.equal(f.trashed.length, 0);
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
    assert.deepEqual(info.reasons, []);
    assert.equal(info.changed, 0);
    assert.match(info.notes.join(), /커밋 1개/);
    await f.host.remove({ path: made.path, ownership: "imported" });
    assert.equal(existsSync(made.path), false);
  } finally {
    f.done();
  }
});

test("only app-created managed folders and worktrees directly under the managed root are deletable", async () => {
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
    mkdirSync(root, { recursive: true });
    // The root itself and a nested folder below a managed child are refused.
    await fails(
      f.host.remove({ path: root, ownership: "managed" }),
      "NOT_DELETABLE",
    );
    const managed = join(root, "sess");
    mkdirSync(join(managed, "nested"), { recursive: true });
    await fails(
      f.host.remove({ path: join(managed, "nested"), ownership: "managed" }),
      "NOT_DELETABLE",
    );
    // An imported-ownership folder inside the root is still refused.
    await fails(
      f.host.remove({ path: managed, ownership: "imported" }),
      "NOT_DELETABLE",
    );
    // A symlink (even to a managed child) is never followed or trashed.
    const keep = join(f.dir, "keep");
    mkdirSync(keep);
    writeFileSync(join(keep, "f"), "1");
    const link = join(root, "sneaky");
    symlinkSync(keep, link);
    await fails(
      f.host.remove({ path: link, ownership: "managed" }),
      "NOT_CANONICAL",
    );
    const viaLink = join(root, "via");
    symlinkSync(managed, viaLink);
    await fails(
      f.host.remove({ path: viaLink, ownership: "managed" }),
      "NOT_CANONICAL",
    );
    assert.equal(f.trashed.length, 0);
    assert.ok(existsSync(join(keep, "f")));
    // A worktree the app did not create (not in the links record) is refused.
    const foreign = join(root, "foreign");
    g(f.repo, "worktree", "add", "-q", "-b", "foreign", foreign, "main");
    await fails(
      f.host.remove({ path: foreign, ownership: "managed" }),
      "NOT_DELETABLE",
    );
    // A forged link to a different parent does not authorize it either.
    writeFileSync(
      join(f.dir, "links.json"),
      JSON.stringify({ [foreign]: { parent: f.dir, branch: "foreign" } }),
    );
    await fails(
      f.host.remove({ path: foreign, ownership: "managed" }),
      "NOT_DELETABLE",
    );
    assert.ok(existsSync(foreign));
    // The managed plain folder is trashed (contents untouched, moved as a whole).
    await f.host.remove({ path: managed, ownership: "managed" });
    assert.deepEqual(f.trashed, [managed]);
    assert.equal(existsSync(managed), false);
  } finally {
    f.done();
  }
});

test("remove refuses without a trash and never deletes permanently", async () => {
  const f = fixture({ trash: undefined });
  try {
    const root = join(realpathSync(f.documents), "OhMyOwnCode");
    const managed = join(root, "sess");
    mkdirSync(managed, { recursive: true });
    await fails(
      f.host.remove({ path: managed, ownership: "managed" }),
      "TRASH_UNAVAILABLE",
    );
    assert.ok(existsSync(managed));
    // A trash that reports success without moving the folder is a failure.
    const lying = fixture({ trash: async () => {} });
    try {
      const r = join(realpathSync(lying.documents), "OhMyOwnCode", "s");
      mkdirSync(r, { recursive: true });
      await fails(
        lying.host.remove({ path: r, ownership: "managed" }),
        "TRASH_FAILED",
      );
    } finally {
      lying.done();
    }
  } finally {
    f.done();
  }
});

test("a managed folder with an unreadable .git is never deleted blind", async () => {
  const f = fixture();
  try {
    const managed = join(realpathSync(f.documents), "OhMyOwnCode", "g");
    mkdirSync(managed, { recursive: true });
    g(managed, "init", "-q");
    g(managed, "config", "filter.x.smudge", "touch pwned");
    await fails(
      f.host.remove({ path: managed, ownership: "managed" }),
      "UNSAFE_REPO_CONFIG",
    );
    assert.ok(existsSync(managed));
    assert.equal(f.trashed.length, 0);
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

test("ignored files are reported as a confirmation note", async () => {
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
    assert.ok(info.notes.some((r) => r.includes("무시된 파일 1개")));
    assert.deepEqual(info.reasons, []);
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
  const gitDir = realpathSync(mkdtempSync(join(tmpdir(), "omoc-g-")));
  mkdirSync(join(gitDir, ".git"));
  let handler;
  let touched = 0;
  bindWorktreeIpc({
    ipcMain: { handle: (_c, h) => (handler = h) },
    admit: () => true,
    host: { inspect: async () => touched++, create: async () => touched++ },
    info: () => ({ path: gitDir, ownership: "imported" }),
    trusted: () => false,
    activity: () => ({ sessions: 0, busy: false, terminals: 0 }),
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
    assert.ok(info.notes.some((r) => r.includes("무시된 파일 1개")));
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
      i: { path: plain, ownership: "imported" },
      p: { path: plain, ownership: "managed" },
      g: { path: gitish, ownership: "managed" },
    };
    bindWorktreeIpc({
      ipcMain: { handle: (_c, h) => (handler = h) },
      admit: () => true,
      host: {
        inspect: async () => (
          git++,
          { kind: "folder", reasons: [], notes: [] }
        ),
        remove: async () => git++,
        create: async () => git++,
      },
      info: (id) => infos[id],
      trusted: () => false,
      activity: () => ({ sessions: 0, busy: false, terminals: 0 }),
      confirmTrust: async () => (asked++, answer),
      confirmDelete: async () => true,
    });
    const del = (workspaceId) =>
      handler({}, { type: "worktree.delete", workspaceId });
    assert.equal((await del("p")).ok, true);
    assert.equal(asked, 0);
    const gitAfterPlain = git;
    assert.deepEqual(await del("g"), {
      ok: false,
      code: "UNTRUSTED_WORKSPACE",
    });
    assert.equal(asked, 1);
    assert.equal(git, gitAfterPlain); // refused confirm ran no git
    assert.deepEqual(await del("i"), { ok: false, code: "NOT_DELETABLE" });
    assert.equal(asked, 1);
    assert.equal(git, gitAfterPlain);
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

test("git runs never discover a repo above a plain folder", async () => {
  const f = fixture({});
  try {
    // A managed plain folder that sits inside someone else's repo.
    const shim = join(f.dir, "gitshim");
    const log = join(f.dir, "ceiling.log");
    writeFileSync(
      shim,
      `#!/bin/sh\necho "$GIT_CEILING_DIRECTORIES" >> "${log}"\nexec ${gitPath()} "$@"\n`,
      { mode: 0o755 },
    );
    const inRepo = createWorktreeHost({
      documentsRoot: () => join(f.repo, "docs"),
      linksFile: () => join(f.dir, "links2.json"),
      trash: async () => {},
      gitBinary: shim,
    });
    const plain = join(f.repo, "docs", "OhMyOwnCode", "inner");
    mkdirSync(plain, { recursive: true });
    const info = await inRepo.inspect({ path: plain, ownership: "managed" });
    assert.equal(info.kind, "managed");
    const seen = readFileSync(log, "utf8").trim().split("\n");
    assert.ok(
      seen.length > 0 && seen.every((v) => v === dirname(plain)),
      seen.join(),
    );
  } finally {
    f.done();
  }
});

test("repos whose config can run programs or follow includes are refused before any git command", async () => {
  for (const [key, value] of [
    ["filter.x.smudge", "touch pwned"],
    ["include.path", "/tmp/elsewhere"],
    ["includeIf.gitdir:/.path", "/tmp/elsewhere"],
    ["core.sshCommand", "touch pwned"],
    ["core.gitProxy", "touch pwned"],
    ["diff.x.textconv", "touch pwned"],
    ["merge.x.driver", "touch pwned"],
  ]) {
    const f = fixture();
    try {
      g(f.repo, "config", key, value);
      await fails(
        f.host.create({ repo: f.repo, branch: "feat/u", base: "main" }),
        "UNSAFE_REPO_CONFIG",
      );
      assert.equal(existsSync(join(f.dir, "pwned")), false);
    } finally {
      f.done();
    }
  }
});

test("git runs ignore system and global config and get a minimal environment", async () => {
  const f0 = fixture();
  const dir = f0.dir;
  try {
    const log = join(dir, "env.log");
    const shim = join(dir, "gitshim2");
    writeFileSync(
      shim,
      `#!/bin/sh\necho "$GIT_CONFIG_NOSYSTEM $GIT_CONFIG_GLOBAL $PATH ${"$"}{GIT_DIR-unset} ${"$"}{GIT_EXEC_PATH-unset}" >> "${log}"\nexec ${gitPath()} "$@"\n`,
      { mode: 0o755 },
    );
    const f = fixture({ gitBinary: shim });
    process.env.GIT_DIR = "/nonexistent-user-git-dir";
    try {
      await f.host.create({ repo: f.repo, branch: "feat/e", base: "main" });
    } finally {
      delete process.env.GIT_DIR;
      f.done();
    }
    const seen = readFileSync(log, "utf8").trim().split("\n");
    assert.ok(seen.length > 1);
    for (const v of seen)
      if (process.platform !== "win32")
        assert.equal(
          v,
          "1 /dev/null /usr/bin:/bin:/usr/sbin:/sbin unset unset",
        );
  } finally {
    f0.done();
  }
});

test("worktree IPC: closed shapes (no path/force), blockers, and a re-check after the dialog", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "omoc-ipc2-")));
  const plain = join(dir, "plain");
  mkdirSync(plain);
  try {
    let handler;
    const calls = [];
    let activity = { sessions: 2, busy: false, terminals: 0 };
    let confirmed;
    let onConfirm = () => {};
    bindWorktreeIpc({
      ipcMain: { handle: (_c, h) => (handler = h) },
      admit: () => true,
      host: {
        inspect: async () => (
          calls.push("inspect"),
          { kind: "managed", path: plain, reasons: [], notes: [], changed: 0 }
        ),
        remove: async () => calls.push("remove"),
        create: async (a) => calls.push(["create", a]),
      },
      info: () => ({ path: plain, ownership: "managed" }),
      trusted: () => true,
      activity: () => activity,
      confirmTrust: async () => true,
      confirmDelete: async (details) => (
        (confirmed = details),
        onConfirm(),
        true
      ),
    });
    const del = () =>
      handler({}, { type: "worktree.delete", workspaceId: "w" });
    for (const bad of [
      { type: "worktree.delete", workspaceId: "w", force: true },
      {
        type: "worktree.create",
        workspaceId: "w",
        branch: "b",
        base: "HEAD",
        path: "/x",
      },
      {
        type: "worktree.create",
        workspaceId: "w",
        branch: "b".repeat(101),
        base: "HEAD",
      },
    ])
      assert.deepEqual(await handler({}, bad), {
        ok: false,
        code: "INVALID_REQUEST",
      });
    assert.deepEqual(calls, []);
    // Running session blocks before any git work.
    activity = { sessions: 2, busy: true, terminals: 0 };
    assert.deepEqual(await del(), {
      ok: false,
      code: "UNSAFE",
      reasons: ["실행 중인 세션이 있습니다"],
    });
    // Open terminal blocks.
    activity = { sessions: 1, busy: false, terminals: 2 };
    const t = await del();
    assert.equal(t.code, "UNSAFE");
    assert.match(t.reasons[0], /터미널 2개/);
    assert.deepEqual(calls, []);
    // The dialog gets the path, changed count and affected sessions.
    activity = { sessions: 2, busy: false, terminals: 0 };
    assert.equal((await del()).ok, true);
    assert.equal(confirmed.path, plain);
    assert.equal(confirmed.changed, 0);
    assert.equal(confirmed.sessions, 2);
    assert.deepEqual(calls, ["inspect", "remove"]);
    // A terminal opened while the dialog was up blocks the trash.
    calls.length = 0;
    onConfirm = () => {
      activity = { sessions: 2, busy: false, terminals: 1 };
    };
    activity = { sessions: 2, busy: false, terminals: 0 };
    assert.equal((await del()).code, "UNSAFE");
    assert.deepEqual(calls, ["inspect"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function gitPath() {
  return execFileSync("/usr/bin/which", ["git"], { encoding: "utf8" }).trim();
}
