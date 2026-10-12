import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";

// F-02/F-03: git worktree creation and physical deletion. Host-only; the
// renderer never supplies a command, only validated names/ids/paths.
const fail = (code, extra = {}) =>
  Object.assign(new Error(code), { worktreeCode: code, ...extra });
const NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;

export function validateRefName(name) {
  return (
    typeof name === "string" &&
    NAME.test(name) &&
    !name.includes("..") &&
    !name.includes("//") &&
    !name.endsWith("/") &&
    !name.endsWith(".") &&
    !name.endsWith(".lock") &&
    !name
      .split("/")
      .some((part) => part.startsWith(".") || part.endsWith(".lock"))
  );
}

// Workspaces are user repos: never run their hooks or fsmonitor command.
const NULL_DEVICE = process.platform === "win32" ? "NUL" : "/dev/null";
const HARDEN = [
  "-c",
  `core.hooksPath=${NULL_DEVICE}`,
  "-c",
  "core.fsmonitor=false",
];

// Repository config keys that make git execute a program on checkout/diff/merge
// or follow files outside the repository; such repos are refused outright.
const UNSAFE_CONFIG =
  /^(filter\..+|include\..+|includeif\..+|core\.sshcommand|core\.gitproxy|diff\..+\.textconv|merge\..+\.driver)$/u;
const gitEnv = (cwd) => ({
  ...process.env,
  // No system/global config: only the repo's own (screened) config applies.
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: NULL_DEVICE,
  GIT_TERMINAL_PROMPT: "0",
  LC_ALL: "C",
  // Never discover a repo in a parent of cwd (a plain folder inside someone else's repo).
  GIT_CEILING_DIRECTORIES: dirname(cwd),
});
const execGit = (cwd, args) =>
  new Promise((done, reject) => {
    execFile(
      "git",
      [...HARDEN, ...args],
      { cwd, timeout: 30000, maxBuffer: 1 << 22, env: gitEnv(cwd) },
      (error, stdout, stderr) =>
        error ? reject({ error, stderr }) : done(stdout),
    );
  });

async function assertSafeRepoConfig(cwd) {
  // Not a repository (or unreadable): the real command reports that itself.
  const listing = await execGit(cwd, [
    "config",
    "--local",
    "-z",
    "--list",
  ]).catch(() => "");
  for (const entry of listing.split("\0")) {
    const key = entry.split("\n", 1)[0].toLowerCase();
    if (UNSAFE_CONFIG.test(key)) throw fail("UNSAFE_REPO_CONFIG");
  }
}

async function runGit(cwd, args) {
  await assertSafeRepoConfig(cwd);
  return execGit(cwd, args).catch(({ error, stderr }) => {
    throw fail("GIT_FAILED", {
      detail: String(stderr || error.message).slice(0, 400),
    });
  });
}
const inside = (root, path) => {
  const rel = relative(root, path);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
};
// Time-ordered id (UUIDv7 layout) for default directory names.
export function uuidv7(now = Date.now()) {
  const b = randomBytes(16);
  b.writeUIntBE(now, 0, 6);
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function createWorktreeHost({ documentsRoot, linksFile, git = runGit }) {
  const root = () => join(documentsRoot(), "OhMyOwnCode");
  async function links() {
    try {
      return JSON.parse(await readFile(linksFile(), "utf8"));
    } catch {
      return {};
    }
  }
  // Read-modify-write under one queue so concurrent create/remove never lose a link.
  let queue = Promise.resolve();
  function updateLinks(change) {
    const run = queue.then(async () => {
      const value = change(await links());
      const file = linksFile();
      await mkdir(dirname(file), { recursive: true });
      const tmp = `${file}.${randomUUID()}.tmp`;
      await writeFile(tmp, JSON.stringify(value));
      await rename(tmp, file);
    });
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function create({ repo, branch, base, dest }) {
    if (!validateRefName(branch)) throw fail("INVALID_BRANCH");
    if (!validateRefName(base) && base !== "HEAD") throw fail("INVALID_BASE");
    const top = await git(repo, ["rev-parse", "--show-toplevel"])
      .then((out) => realpath(out.trim()))
      .catch((error) => {
        throw error?.worktreeCode === "UNSAFE_REPO_CONFIG"
          ? error
          : fail("NOT_GIT_REPO");
      });
    if (top !== (await realpath(repo))) throw fail("NOT_GIT_REPO");
    await git(top, [
      "rev-parse",
      "--verify",
      "--quiet",
      `${base}^{commit}`,
    ]).catch(() => {
      throw fail("INVALID_BASE");
    });
    const exists = await git(top, [
      "show-ref",
      "--verify",
      "--quiet",
      `refs/heads/${branch}`,
    ]).then(
      () => true,
      () => false,
    );
    if (exists) throw fail("BRANCH_EXISTS");
    let target;
    if (dest === undefined) {
      await mkdir(root(), { recursive: true });
      target = join(await realpath(root()), uuidv7());
    } else {
      if (typeof dest !== "string" || !isAbsolute(dest))
        throw fail("INVALID_PATH");
      target = resolve(dest);
      if (
        await lstat(target).then(
          () => true,
          () => false,
        )
      )
        throw fail("PATH_EXISTS");
      const parent = await realpath(dirname(target)).catch(() => {
        throw fail("INVALID_PATH");
      });
      target = join(parent, basename(target));
      if (target === top || inside(top, target)) throw fail("INVALID_PATH");
    }
    await git(top, ["worktree", "add", "-b", branch, target, base]);
    const path = await realpath(target);
    await updateLinks((all) => ({ ...all, [path]: { parent: top, branch } }));
    return { path, parent: top, branch };
  }

  // Classifies what physical delete would do and why it is or is not safe.
  async function inspect({ path, ownership }) {
    const real = await realpath(path).catch(() => {
      throw fail("MISSING");
    });
    if (
      real !== path ||
      (await lstat(real)).isSymbolicLink() ||
      !(await lstat(real)).isDirectory()
    )
      throw fail("NOT_CANONICAL");
    let linked = false;
    let common;
    try {
      const out = (
        await git(real, [
          "rev-parse",
          "--path-format=absolute",
          "--show-toplevel",
          "--git-dir",
          "--git-common-dir",
        ])
      ).split("\n");
      const [top, gitDir, commonDir] = out;
      linked =
        (await realpath(top)) === real &&
        (await realpath(gitDir)) !== (await realpath(commonDir));
      common = commonDir;
    } catch {
      // not a git checkout
    }
    if (linked) {
      const changed = (
        await git(real, ["status", "--porcelain", "--untracked-files=all"])
      )
        .split("\n")
        .filter(Boolean).length;
      // Directory-level ignored entries (node_modules counts once), so output stays small.
      const ignored = (
        await git(real, [
          "status",
          "--porcelain",
          "--ignored",
          "--untracked-files=normal",
        ])
      )
        .split("\n")
        .filter((l) => l.startsWith("!! ")).length;
      const head = (
        await git(real, ["symbolic-ref", "--short", "-q", "HEAD"]).catch(
          () => "",
        )
      ).trim();
      const unique = Number(
        (
          await git(real, [
            "rev-list",
            "--count",
            "HEAD",
            "--not",
            ...(head ? [`--exclude=${head}`] : []),
            "--branches",
            "--remotes",
          ])
        ).trim(),
      );
      const reasons = [];
      if (changed) reasons.push("커밋되지 않은 변경이 있습니다");
      if (ignored)
        reasons.push(`.env 등 무시된 파일 ${ignored}개가 함께 삭제됩니다`);
      if (unique > 0)
        reasons.push(`다른 브랜치·원격에 없는 커밋 ${unique}개가 있습니다`);
      return {
        kind: "worktree",
        path: real,
        reasons,
        mainRepo: dirname(await realpath(common)),
        branch: head,
      };
    }
    if (
      ownership === "managed" &&
      inside(await realpath(root()).catch(() => root()), real)
    )
      return { kind: "managed", path: real, reasons: [] };
    throw fail("NOT_DELETABLE");
  }

  async function remove({ path, ownership, force }) {
    const info = await inspect({ path, ownership });
    if (info.reasons.length && force !== true)
      throw fail("UNSAFE", { reasons: info.reasons });
    if (info.kind === "worktree") {
      await git(info.mainRepo, [
        "worktree",
        "remove",
        ...(info.reasons.length ? ["--force"] : []),
        info.path,
      ]);
      await updateLinks((all) => {
        delete all[info.path];
        return all;
      });
    } else {
      // rm unlinks symlinks instead of following them.
      await rm(info.path, { recursive: true });
    }
    return info;
  }
  return { create, inspect, remove, links };
}
