import { renameReplacing } from "../platform-paths.mjs";
import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { resolveGit } from "./workspace-checkpoint.mjs";

// F-02/F-03: git worktree creation and physical deletion. Host-only; the
// renderer never supplies a command or a path, only validated names/ids.
// Delete is limited to app-created folders/worktrees directly under the
// managed root and always goes to the OS trash (never a permanent delete).
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
// Minimal environment: fixed PATH, no user git variables, no global/system config.
const gitEnv = (cwd) => ({
  PATH:
    process.platform === "win32"
      ? (process.env.PATH ?? "")
      : "/usr/bin:/bin:/usr/sbin:/sbin",
  ...(process.platform === "win32" && {
    SystemRoot: process.env.SystemRoot ?? "",
  }),
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: NULL_DEVICE,
  GIT_ATTR_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  GIT_OPTIONAL_LOCKS: "0",
  LC_ALL: "C",
  // Never discover a repo in a parent of cwd (a plain folder inside someone else's repo).
  GIT_CEILING_DIRECTORIES: dirname(cwd),
});
const execGit = (bin, cwd, args) =>
  new Promise((done, reject) => {
    execFile(
      bin,
      [...HARDEN, ...args],
      {
        cwd,
        timeout: 30000,
        maxBuffer: 1 << 22,
        env: gitEnv(cwd),
        windowsHide: true,
      },
      (error, stdout, stderr) =>
        error ? reject({ error, stderr }) : done(stdout),
    );
  });

// Maps git's stderr to a stable code the UI turns into a Korean message.
export function mapGitError(stderr) {
  const text = String(stderr);
  if (/branch named .* already exists/iu.test(text)) return "BRANCH_EXISTS";
  if (/already exists/iu.test(text)) return "PATH_EXISTS";
  if (/not a valid branch name|invalid reference/iu.test(text))
    return "INVALID_BRANCH";
  if (/already (checked out|used by worktree)/iu.test(text))
    return "BRANCH_IN_USE";
  if (
    /permission denied|operation not permitted|read-only file system/iu.test(
      text,
    )
  )
    return "PERMISSION_DENIED";
  if (/not a git repository/iu.test(text)) return "NOT_GIT_REPO";
  return "GIT_FAILED";
}

async function assertSafeRepoConfig(bin, cwd) {
  // Not a repository (or unreadable): the real command reports that itself.
  const listing = await execGit(bin, cwd, [
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

async function runGit(bin, cwd, args) {
  await assertSafeRepoConfig(bin, cwd);
  return execGit(bin, cwd, args).catch(({ error, stderr }) => {
    throw fail(mapGitError(stderr), {
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

// Local calendar date for default directory names: yyyy-mm-dd.
export function localDate(date = new Date()) {
  const two = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

// trash(path) moves a directory to the OS trash (shell.trashItem); gitBinary is
// an absolute git path (default: resolved like the checkpoint store).
export function createWorktreeHost({
  documentsRoot,
  linksFile,
  trash,
  gitBinary,
  git: gitInput,
}) {
  let binary;
  const git =
    gitInput ??
    (async (cwd, args) => {
      binary ??= Promise.resolve(gitBinary ?? resolveGit());
      const bin = await binary;
      if (!bin) throw fail("GIT_MISSING");
      return runGit(bin, cwd, args);
    });
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
      await renameReplacing(tmp, file);
    });
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function create({ repo, branch, base }) {
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
    let managed;
    try {
      await mkdir(root(), { recursive: true, mode: 0o700 });
      managed = await realpath(root());
    } catch (error) {
      throw fail(
        ["EACCES", "EPERM", "EROFS"].includes(error?.code)
          ? "PERMISSION_DENIED"
          : "INVALID_PATH",
      );
    }
    // The only destination is a fresh child of the managed root, never inside the repo.
    const target = join(managed, `${localDate()}-${uuidv7()}`);
    if (target === top || inside(top, target)) throw fail("INVALID_PATH");
    await git(top, ["worktree", "add", "-b", branch, target, base]);
    const path = await realpath(target);
    await updateLinks((all) => ({ ...all, [path]: { parent: top, branch } }));
    return { path, parent: top, branch };
  }

  // Classifies what physical delete would do and why it is or is not safe.
  // `reasons` block the delete; `notes` are shown in the confirmation only.
  async function inspect({ path, ownership }) {
    const real = await realpath(path).catch(() => {
      throw fail("MISSING");
    });
    const stat = await lstat(real);
    if (real !== path || stat.isSymbolicLink() || !stat.isDirectory())
      throw fail("NOT_CANONICAL");
    // Only a direct child of the managed root (never the root, a nested project or the repo).
    const managed = await realpath(root()).catch(() => undefined);
    if (!managed || dirname(real) !== managed) throw fail("NOT_DELETABLE");
    const hasDotGit = await lstat(join(real, ".git")).then(
      () => true,
      () => false,
    );
    let top;
    let gitDir;
    let commonDir;
    try {
      [top, gitDir, commonDir] = (
        await git(real, [
          "rev-parse",
          "--path-format=absolute",
          "--show-toplevel",
          "--git-dir",
          "--git-common-dir",
        ])
      ).split("\n");
    } catch (error) {
      // A folder with .git whose state cannot be read is never deleted blind.
      if (hasDotGit) throw error;
    }
    const checkout = Boolean(top) && (await realpath(top)) === real;
    const linked =
      checkout && (await realpath(gitDir)) !== (await realpath(commonDir));
    let mainRepo;
    if (linked) {
      // Only worktrees this app created (recorded at creation) are deletable.
      mainRepo = dirname(await realpath(commonDir));
      if ((await links())[real]?.parent !== mainRepo)
        throw fail("NOT_DELETABLE");
    } else if (ownership !== "managed") throw fail("NOT_DELETABLE");
    const reasons = [];
    const notes = [];
    let changed = 0;
    let branch = "";
    if (checkout) {
      changed = (
        await git(real, ["status", "--porcelain", "--untracked-files=all"])
      )
        .split("\n")
        .filter(Boolean).length;
      if (changed) reasons.push(`커밋되지 않은 변경 ${changed}개`);
      branch = (
        await git(real, ["symbolic-ref", "--short", "-q", "HEAD"]).catch(
          () => "",
        )
      ).trim();
    }
    if (linked) {
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
      const unique = Number(
        (
          await git(real, [
            "rev-list",
            "--count",
            "HEAD",
            "--not",
            ...(branch ? [`--exclude=${branch}`] : []),
            "--branches",
            "--remotes",
          ])
        ).trim(),
      );
      if (ignored)
        notes.push(
          `.env 등 무시된 파일 ${ignored}개가 함께 휴지통으로 이동합니다`,
        );
      if (unique > 0)
        notes.push(`다른 브랜치·원격에 없는 커밋 ${unique}개가 있습니다`);
    }
    return {
      kind: linked ? "worktree" : "managed",
      path: real,
      reasons,
      notes,
      changed,
      ...(linked && { mainRepo, branch }),
    };
  }

  // Re-inspects, then moves the folder to the OS trash. Never a permanent
  // delete, never `git worktree remove --force`.
  async function remove({ path, ownership }) {
    if (typeof trash !== "function") throw fail("TRASH_UNAVAILABLE");
    const info = await inspect({ path, ownership });
    if (info.reasons.length) throw fail("UNSAFE", { reasons: info.reasons });
    try {
      await trash(info.path);
    } catch {
      throw fail("TRASH_FAILED");
    }
    const stillThere = await lstat(info.path).then(
      () => true,
      () => false,
    );
    if (stillThere) throw fail("TRASH_FAILED");
    let pruned = true;
    if (info.kind === "worktree") {
      // The folder is already gone: a prune failure must not report the delete as failed.
      await git(info.mainRepo, ["worktree", "prune"]).catch(() => {
        pruned = false;
      });
      await updateLinks((all) => {
        delete all[info.path];
        return all;
      });
    }
    return { ...info, pruned };
  }
  return { create, inspect, remove, links };
}
