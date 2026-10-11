import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

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

function runGit(cwd, args) {
  return new Promise((done, reject) => {
    execFile(
      "git",
      args,
      {
        cwd,
        timeout: 30000,
        maxBuffer: 1 << 22,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
      },
      (error, stdout, stderr) =>
        error
          ? reject(
              fail("GIT_FAILED", {
                detail: String(stderr || error.message).slice(0, 400),
              }),
            )
          : done(stdout),
    );
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
  async function saveLinks(value) {
    const file = linksFile();
    await mkdir(dirname(file), { recursive: true });
    await writeFile(`${file}.tmp`, JSON.stringify(value));
    await rename(`${file}.tmp`, file);
  }

  async function create({ repo, branch, base, dest }) {
    if (!validateRefName(branch)) throw fail("INVALID_BRANCH");
    if (!validateRefName(base) && base !== "HEAD") throw fail("INVALID_BASE");
    const top = await git(repo, ["rev-parse", "--show-toplevel"])
      .then((out) => realpath(out.trim()))
      .catch(() => {
        throw fail("NOT_GIT_REPO");
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
      target = join(parent, target.slice(dirname(target).length + 1));
      if (target === top || inside(top, target)) throw fail("INVALID_PATH");
    }
    await git(top, ["worktree", "add", "-b", branch, target, base]);
    const path = await realpath(target);
    await saveLinks({ ...(await links()), [path]: { parent: top, branch } });
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
      const status = await git(real, [
        "status",
        "--porcelain",
        "--untracked-files=all",
      ]);
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
      if (status.trim()) reasons.push("커밋되지 않은 변경이 있습니다");
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
      const all = await links();
      delete all[info.path];
      await saveLinks(all);
    } else {
      // rm unlinks symlinks instead of following them.
      await rm(info.path, { recursive: true });
    }
    return info;
  }
  return { create, inspect, remove, links };
}
