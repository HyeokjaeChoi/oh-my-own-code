// Native Project.resolve is the one place Native discovers VCS (git/hg spawned
// against repository-controlled config). The overlay removes discovery: every
// caller (Session.create, SessionMove, Location) gets the directory-identity
// project. PATH shims record any spawn; a .git workspace must cause none.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath, { dirname, join } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { NATIVE_PERMISSION_OVERLAY_RECIPE } from "./native-permission-overlay-contract.mjs";
import { planNativePermissionOverlay } from "../scripts/native-permission-overlay.mjs";

const root = new URL("../runtime-event-host/.generated/install/", import.meta.url);
const CHUNK = "node_modules/@opencode/core/dist/chunks/config-pd1wrm5b.js";
const inputs = await Promise.all(
  NATIVE_PERMISSION_OVERLAY_RECIPE.files.map(async ({ path }) => ({
    path,
    content: await readFile(new URL(path, root)),
  })),
);
const patched = planNativePermissionOverlay(NATIVE_PERMISSION_OVERLAY_RECIPE, inputs)
  .files.find((file) => file.path === CHUNK)
  .content.toString("utf8");
const original = await readFile(new URL(CHUNK, root), "utf8");
const lib = (path) => import(pathToFileURL(new URL(path, root).pathname).href);
const { Effect } = await lib("node_modules/effect/dist/index.js");
const { Hash } = await lib("node_modules/@opencode/util/dist/hash.js");

const base = await realpath(await mkdtemp(join(tmpdir(), "omoc-project-resolve-")));
after(() => rm(base, { recursive: true, force: true }));
const log = join(base, "spawns.log");
const bin = join(base, "bin");
await mkdir(bin);
for (const name of ["git", "hg"]) {
  await writeFile(join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\nexit 1\n`);
  await chmod(join(bin, name), 0o755);
}
const spawns = async () => (await readFile(log, "utf8").catch(() => "")).trim();
// A real binary spawned by name through the shimmed PATH, as Native's git/hg service does.
const run = (name, args) =>
  spawnSync(name, args, { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });

// Extract the resolve body (cached..resolve); persistence is a recording stub.
function resolver(source) {
  const start = source.indexOf("  const cached = Effect.fnUntraced");
  const end = source.indexOf("  return Service81.of(");
  assert.ok(start >= 0 && end > start);
  const persisted = [];
  const fs = {
    resolve: (input) => Effect.promise(() => realpath(input)),
    up: ({ targets, start: from }) =>
      Effect.promise(async () => {
        for (let dir = from; ; dir = dirname(dir)) {
          for (const target of targets) {
            const found = join(dir, target);
            if (await stat(found).then(() => true, () => false)) return [found];
          }
          if (dirname(dir) === dir) return [];
        }
      }),
    readFileString: () => Effect.fail(new Error("absent")),
  };
  const git = {
    repo: { discover: (dir) => Effect.sync(() => (run("git", ["rev-parse"]), { worktree: dir, gitDirectory: join(dir, ".git"), commonDirectory: join(dir, ".git") })) },
    remote: { get: () => Effect.sync(() => (run("git", ["remote", "get-url", "origin"]), undefined)) },
    history: { rootCommits: () => Effect.sync(() => (run("git", ["rev-list"]), [])) },
    worktree: { list: () => Effect.sync(() => (run("git", ["worktree", "list"]), [])) },
  };
  const proc = { run: () => Effect.sync(() => run("hg", ["log"])).pipe(Effect.as({ exitCode: 1, stdout: Buffer.alloc(0) })) };
  const ID17 = { make: (value) => value, global: "global" };
  const AbsolutePath2 = { make: (value) => value };
  const ChildProcess = { make: () => ({}) };
  const persist = (project) => Effect.sync(() => (persisted.push(project), project));
  const names = ["Effect", "fs", "git", "proc", "path", "Hash", "AbsolutePath2", "ID17", "ChildProcess", "persist"];
  const resolve = new Function(
    ...names,
    `${source.slice(start, end)}\nreturn resolve;`,
  )(Effect, fs, git, proc, nodePath, Hash, AbsolutePath2, ID17, ChildProcess, persist);
  return { resolve, persisted };
}

async function workspace(name, vcs) {
  const dir = join(base, name);
  await mkdir(join(dir, vcs), { recursive: true });
  await writeFile(join(dir, vcs, "config"), "[core]\n\tfsmonitor = touch pwned\n");
  return dir;
}

test("unpatched Native spawns git in a .git workspace (positive control for the shims)", async () => {
  const dir = await workspace("control-git", ".git");
  const { resolve } = resolver(original);
  await Effect.runPromise(resolve(dir));
  assert.match(await spawns(), /^git rev-parse/mu);
  await Effect.runPromise(resolver(original).resolve(await workspace("control-hg", ".hg")));
  assert.match(await spawns(), /^hg log/mu);
});

test("patched Project.resolve never spawns git or hg and returns the directory identity", async () => {
  for (const vcs of [".git", ".hg"]) {
    const dir = await workspace(`patched${vcs}`, vcs);
    const { resolve, persisted } = resolver(patched);
    const before = await spawns();
    const result = await Effect.runPromise(resolve(dir));
    assert.equal(await spawns(), before);
    assert.equal(result.id, Hash.fast(`directory:${dir}`));
    assert.equal(result.directory, dir);
    assert.equal(result.canonical, dir);
    assert.equal(result.vcs, undefined);
    assert.equal(persisted.length, 1);
    // A nested directory inside the workspace is its own directory project too.
    await mkdir(join(dir, "sub"));
    const nested = await Effect.runPromise(resolve(join(dir, "sub")));
    assert.equal(nested.directory, join(dir, "sub"));
    assert.equal(nested.vcs, undefined);
  }
});
