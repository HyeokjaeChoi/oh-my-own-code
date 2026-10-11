import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeWorkspaceMeta } from "./host/workspace-meta.mjs";

test("probeWorkspaceMeta reads branch, detached HEAD, linked worktree and non-git", async () => {
  const root = await mkdtemp(join(tmpdir(), "meta-"));
  const repo = join(root, "repo");
  await mkdir(join(repo, ".git"), { recursive: true });
  await writeFile(join(repo, ".git", "HEAD"), "ref: refs/heads/feat/x\n");
  assert.deepEqual(await probeWorkspaceMeta(repo), {
    writable: true,
    branch: "feat/x",
  });
  await writeFile(join(repo, ".git", "HEAD"), `${"a".repeat(40)}\n`);
  assert.equal((await probeWorkspaceMeta(repo)).branch, "(detached aaaaaaa)");
  const gitdir = join(root, "gd");
  await mkdir(gitdir);
  await writeFile(join(gitdir, "HEAD"), "ref: refs/heads/wt\n");
  const wt = join(root, "wt");
  await mkdir(wt);
  await writeFile(join(wt, ".git"), `gitdir: ${gitdir}\n`);
  assert.equal((await probeWorkspaceMeta(wt)).branch, "wt");
  const plain = join(root, "plain");
  await mkdir(plain);
  assert.deepEqual(await probeWorkspaceMeta(plain), { writable: true });
});
