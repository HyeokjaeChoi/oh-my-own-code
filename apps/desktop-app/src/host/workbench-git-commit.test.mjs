import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorkbenchGitAccess } from "./workbench-git.mjs";
import * as fs from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import {
  GIT_COMMIT_TARGET_FIELDS,
  gitCommitTargetFromApply,
} from "../renderer/shared/git-commit/index.mjs";
import {
  validateGitCommitArtifactManifest,
  GIT_COMMIT_STATE_MARKERS,
  gitCommitExpectedBackups,
} from "./git-commit-contract.mjs";
test("Single Git snapshot owner exposes the explicit commit manager", async () => {
  const access = createWorkbenchGitAccess({ platform: "unsupported" });
  assert.equal(typeof access.commitManager?.preview, "function");
  assert.equal(typeof access.commitManager?.previewForApply, "function");
  assert.equal(typeof access.commitManager?.apply, "function");
  await access.reader.close();
});

const hash = (b) => createHash("sha256").update(b).digest("hex");
async function fixture(t, format = "sha1", options = {}) {
  const home = await fs.realpath(
      await fs.mkdtemp(join(tmpdir(), "omoc-commit-manager-")),
    ),
    root = join(home, "repo");
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
  const git = (...args) => {
    const r = spawnSync(
      "/Library/Developer/CommandLineTools/usr/bin/git",
      args,
      { cwd: root, env, encoding: "utf8" },
    );
    assert.equal(r.status, 0, "owned synthetic setup failed");
    return r.stdout.trim();
  };
  git("init", "-b", "main", `--object-format=${format}`);
  await fs.writeFile(join(root, "a.txt"), "original\n");
  await fs.writeFile(join(root, "b.txt"), "untouched\n");
  git("add", "--", "a.txt", "b.txt");
  git("commit", "-m", "synthetic setup");
  const access = createWorkbenchGitAccess(options);
  t.after(() => access.reader.close());
  const workspace = { id: "synthetic", path: root },
    scope = {
      runtimeEpoch: "epoch-1",
      sender: {},
      trusted: true,
      trustRevision: 1,
      revision: 3,
    };
  const read = () => access.reader.review(workspace, scope);
  const preview = async () => {
    const o = await read();
    assert.equal(o.status, "available", JSON.stringify(o));
    return access.commitManager.preview(
      workspace,
      {
        type: "git.commit.preview.read",
        workspaceId: workspace.id,
        observationId: o.observationId,
        author: { name: "합성 A, B", email: "synthetic@example.invalid" },
        message: "\ufeffSYNTHETIC\r\n\r\n",
      },
      scope,
    );
  };
  return { home, root, git, access, workspace, scope, preview, read };
}
const request = (p, id = "operation-1") => ({
  type: "git.commit.apply",
  workspaceId: p.workspaceId,
  requestId: id,
  previewId: p.previewId,
  ...Object.fromEntries(GIT_COMMIT_TARGET_FIELDS.map((k) => [k, p[k]])),
});
for (const format of ["sha1", "sha256"])
  test(`Actual private ${format} commit preview preserves original index and exact user bytes`, async (t) => {
    const f = await fixture(t, format);
    await fs.writeFile(join(f.root, "a.txt"), "staged\n");
    f.git("add", "--", "a.txt");
    await fs.writeFile(join(f.root, "a.txt"), "unstaged\r\n");
    const index = await fs.readFile(join(f.root, ".git/index")),
      head = await fs.readFile(join(f.root, ".git/HEAD")),
      ref = await fs.readFile(join(f.root, ".git/refs/heads/main")),
      log = await fs.readFile(join(f.root, ".git/logs/HEAD"));
    const p = await f.preview();
    assert.equal(p.status, "available", JSON.stringify(p));
    assert.equal(p.canonicalMessage, "\ufeffSYNTHETIC\r\n\r\n");
    assert.equal(p.indexDigest, hash(index));
    assert.equal(p.entries.length, 1);
    assert.equal(p.entries[0].path, "a.txt");
    assert.equal(p.entries[0].after.oid, f.git("rev-parse", ":a.txt"));
    assert.equal(
      f.access.commitManager.previewForApply(f.workspace, request(p), f.scope)
        .previewId,
      p.previewId,
    );
    const req = request(p);
    assert.deepEqual(gitCommitTargetFromApply(req).logs, p.logs);
    let operation,
      callbackError,
      calls = 0;
    const result = await f.access.commitManager.apply(
      f.workspace,
      req,
      { ...f.scope, operationDigest: "9".repeat(64) },
      async (op) => {
        calls++;
        operation = op;
        try {
          const manifest = JSON.parse(
            await fs.readFile(join(op.artifact.root, "manifest.json"), "utf8"),
          );
          validateGitCommitArtifactManifest(manifest, op);
          assert.equal(manifest.digest, "9".repeat(64));
          assert.equal(manifest.canonicalMessage, p.canonicalMessage);
          assert.equal(manifest.author.name, "합성 A, B");
          for (const name of GIT_COMMIT_STATE_MARKERS)
            assert.ok(
              manifest.source.missing.includes(join(f.root, ".git", name)),
            );
          for (const path of [
            join(f.root, ".git/logs/HEAD"),
            join(f.root, ".git/logs/refs/heads/main"),
          ])
            for (let parent = dirname(path); ; parent = dirname(parent)) {
              assert.ok(
                manifest.source.listings.some((x) => x.path === parent),
                "Each existing publication parent needs a frozen listing: " +
                  parent,
              );
              if (parent === join(f.root, ".git")) break;
            }
          const body = await fs.readFile(
            join(op.artifact.root, manifest.commit.path),
          );
          assert.equal(hash(body), p.commitBodyDigest);
          const ident = `합성 A, B <synthetic@example.invalid> ${p.timestamp} +0000`;
          assert.equal(
            body.toString(),
            `tree ${p.treeOid}\nparent ${p.headOid}\nauthor ${ident}\ncommitter ${ident}\n\n${p.canonicalMessage}`,
          );
          for (const object of manifest.objects) {
            const raw = inflateSync(
              await fs.readFile(join(op.artifact.root, object.path)),
            );
            assert.equal(
              createHash(format).update(raw).digest("hex"),
              object.oid,
            );
          }
          return { status: "unknown", reason: "io_failed" };
        } catch (error) {
          callbackError = error;
          throw error;
        }
      },
    );
    assert.ifError(callbackError);
    assert.deepEqual(result, { requestId: req.requestId, status: "unknown" });
    assert.equal(calls, 1);
    assert.ok(operation);
    assert.deepEqual(await fs.readFile(join(f.root, ".git/index")), index);
    assert.deepEqual(await fs.readFile(join(f.root, ".git/HEAD")), head);
    assert.deepEqual(
      await fs.readFile(join(f.root, ".git/refs/heads/main")),
      ref,
    );
    assert.deepEqual(await fs.readFile(join(f.root, ".git/logs/HEAD")), log);
    assert.equal(
      await fs.readFile(join(f.root, "a.txt"), "utf8"),
      "unstaged\r\n",
    );
    await assert.rejects(
      () =>
        f.access.commitManager.apply(
          f.workspace,
          req,
          { ...f.scope, operationDigest: "9".repeat(64) },
          async () => {
            calls++;
          },
        ),
      { appCode: "FILE_CHANGED" },
    );
    assert.equal(calls, 1);
  });

test("Commit read budget excludes only bounded publisher time", async (t) => {
  for (const mode of [
    "bounded",
    "publisher-expired",
    "read-expired",
    "cancelled",
  ]) {
    await t.test(mode, async (t) => {
      let clock = 0,
        published = false,
        consumedReadBudget = false;
      const f = await fixture(t, "sha1", { now: () => clock });
      await fs.writeFile(join(f.root, "a.txt"), "staged\n");
      f.git("add", "--", "a.txt");
      const p = await f.preview();
      assert.equal(p.status, "available");
      const req = request(p),
        controller = new AbortController();
      let callbackError;
      const result = await f.access.commitManager.apply(
        f.workspace,
        req,
        {
          ...f.scope,
          operationDigest: "9".repeat(64),
          signal: controller.signal,
          check() {
            if (published && mode === "read-expired" && !consumedReadBudget) {
              consumedReadBudget = true;
              clock += 8000;
            }
          },
        },
        async (operation) => {
          try {
            const manifest = JSON.parse(
              await fs.readFile(join(operation.artifact.root, "manifest.json")),
            );
            // Scripted publication on this owned synthetic repository only.
            // Actual descriptor publication is covered by the saved Bun probe.
            await fs.writeFile(
              join(f.root, ".git/refs/heads/main"),
              await fs.readFile(
                join(operation.artifact.root, manifest.reference.path),
              ),
            );
            for (const log of manifest.logs)
              await fs.writeFile(
                join(
                  f.root,
                  ".git/logs",
                  log.role === "head_log" ? "HEAD" : "refs/heads/main",
                ),
                await fs.readFile(
                  join(operation.artifact.root, log.proposal.path),
                ),
              );
            clock += mode === "publisher-expired" ? 10000 : 8500;
            published = true;
            if (mode === "cancelled") controller.abort();
            return {
              status: "committed",
              commitOid: p.commitOid,
              treeOid: p.treeOid,
              referenceDigest: p.reference.nextDigest,
              logDigests: p.logs.map((log) => ({
                role: log.role,
                digest: log.nextDigest,
              })),
              backups: gitCommitExpectedBackups(
                gitCommitTargetFromApply(req),
                f.scope.runtimeEpoch,
                req.requestId,
              ),
            };
          } catch (error) {
            callbackError = error;
            throw error;
          }
        },
      );
      assert.ifError(callbackError);
      assert.equal(result.status, mode === "bounded" ? "committed" : "unknown");
      await assert.rejects(
        () =>
          f.access.commitManager.apply(
            f.workspace,
            req,
            { ...f.scope, operationDigest: "9".repeat(64) },
            async () => assert.fail("No replay"),
          ),
        { appCode: "FILE_CHANGED" },
      );
    });
  }
});

test("Commit preview refuses ordinary in-progress Git state without changing legacy review", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(join(f.root, "a.txt"), "staged\n");
  f.git("add", "--", "a.txt");
  await fs.writeFile(
    join(f.root, ".git/MERGE_HEAD"),
    f.git("rev-parse", "HEAD") + "\n",
  );
  const p = await f.preview();
  assert.equal(p.status, "unavailable", JSON.stringify(p));
  assert.equal(p.reason, "unsupported_commit_state");
  assert.equal((await f.read()).status, "available");
});

test("Commit manager refuses unchanged staged trees and supports full staged deletion", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.preview()).reason, "no_changes");
  f.git("rm", "--", "a.txt", "b.txt");
  const index = await fs.readFile(join(f.root, ".git/index"));
  const p = await f.preview();
  assert.equal(p.status, "available", JSON.stringify(p));
  assert.equal(p.entries.length, 2);
  assert.ok(p.entries.every((e) => e.before && e.after === null));
  assert.deepEqual(await fs.readFile(join(f.root, ".git/index")), index);
});

test("Commit manager binds preview to sender, epoch, trust, floor, target and expiry", async (t) => {
  let clock = 1000;
  const f = await fixture(t, "sha1", { now: () => clock });
  await fs.writeFile(join(f.root, "a.txt"), "staged\n");
  f.git("add", "--", "a.txt");
  const p = await f.preview();
  assert.equal(p.status, "available", JSON.stringify(p));
  const req = request(p);
  for (const changed of [
    { sender: {} },
    { runtimeEpoch: "epoch-2" },
    { trustRevision: 2 },
    { revision: 4 },
  ])
    assert.throws(
      () =>
        f.access.commitManager.previewForApply(f.workspace, req, {
          ...f.scope,
          ...changed,
        }),
      { appCode: "FILE_CHANGED" },
    );
  assert.throws(
    () =>
      f.access.commitManager.previewForApply(
        f.workspace,
        { ...req, commitBodyDigest: "f".repeat(64) },
        f.scope,
      ),
    { appCode: "FILE_CHANGED" },
  );
  assert.equal(
    f.access.commitManager.previewForApply(f.workspace, req, f.scope).previewId,
    p.previewId,
  );
  clock += 60000;
  assert.throws(
    () => f.access.commitManager.previewForApply(f.workspace, req, f.scope),
    { appCode: "FILE_CHANGED" },
  );
});

test("Git state introduced after commit preview refuses before publisher invocation", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(join(f.root, "a.txt"), "staged\n");
  f.git("add", "--", "a.txt");
  const p = await f.preview();
  assert.equal(p.status, "available", JSON.stringify(p));
  const before = await fs.readFile(join(f.root, ".git/refs/heads/main"));
  await fs.mkdir(join(f.root, ".git/rebase-merge"));
  let calls = 0;
  await assert.rejects(
    () =>
      f.access.commitManager.apply(
        f.workspace,
        request(p),
        { ...f.scope, operationDigest: "9".repeat(64) },
        async () => {
          calls++;
        },
      ),
    { appCode: "FILE_CHANGED" },
  );
  assert.equal(calls, 0);
  assert.deepEqual(
    await fs.readFile(join(f.root, ".git/refs/heads/main")),
    before,
  );
});

import { openWorkspaceRegistry } from "./workspace-registry.mjs";
import { createWorkbenchService } from "../workbench-service.mjs";
import { BASELINE_POLICY } from "../workbench-contract.mjs";
async function serviceFixture(t, { confirmGitCommit, gitCommit } = {}) {
  const home = await fs.realpath(
      await fs.mkdtemp(join(tmpdir(), "omoc-index-service-")),
    ),
    directory = join(home, "private"),
    documentsPath = join(home, "Documents");
  await fs.mkdir(directory);
  await fs.mkdir(documentsPath);
  const registry = await openWorkspaceRegistry({
    directory,
    documentsPath,
    storeId: "synthetic",
    runtimeEpoch: "epoch",
  });
  const records = new Map();
  const client = {
    session: {
      create: async (input) => {
        const value = { ...input, permissions: BASELINE_POLICY };
        records.set(value.id, value);
        return value;
      },
      get: async ({ sessionID }) => records.get(sessionID),
      update: async ({ sessionID, ...update }) => {
        const value = { ...records.get(sessionID), ...update };
        records.set(sessionID, value);
        return value;
      },
      active: async () => ({}),
      inbox: { list: async () => [] },
    },
    message: { list: async () => ({ data: [] }) },
    permission: { list: async () => [] },
  };
  const runtime = {
    snapshot: () => ({ state: "connected" }),
    workbenchContext: () => ({ client, gitCommit }),
    workspace: home,
  };
  const service = createWorkbenchService({
    registry,
    runtime,
    runtimeEpoch: "epoch",
    bootstrap: true,
    confirmTrust: async () => true,
    confirmGitCommit,
    deadlineMs: 10000,
  });
  t.after(async () => {
    service.close();
    await service.drain();
    await registry.close();
  });
  let readId = 0;
  const read = (operation) =>
    service.handle(
      {
        version: 2,
        runtimeEpoch: "epoch",
        readId: `read-${++readId}`,
        operation,
      },
      "sender",
    );
  let snap = await read({ type: "snapshot" });
  const deadline = Date.now() + 2000;
  while (snap.ok && snap.value.state !== "connected" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    snap = await read({ type: "snapshot" });
  }
  assert.equal(snap.ok, true, JSON.stringify(snap));
  assert.equal(snap.value.recovery.store.state, "ready", JSON.stringify(snap));
  const workspace = snap.value.workspaces[0];
  assert.ok(workspace?.trusted);
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
  const git = (...args) => {
    const r = spawnSync(
      "/Library/Developer/CommandLineTools/usr/bin/git",
      args,
      { cwd: workspace.path, env, encoding: "utf8" },
    );
    assert.equal(r.status, 0);
    return r.stdout.trim();
  };
  git("init", "-b", "main");
  await fs.writeFile(join(workspace.path, "a.txt"), "head\n");
  git("add", "--", "a.txt");
  git("commit", "-m", "synthetic");
  await fs.writeFile(join(workspace.path, "a.txt"), "current\n");
  git("add", "--", "a.txt");
  const reviewed = await read({
    type: "git.review.read",
    workspaceId: workspace.id,
  });
  assert.equal(reviewed.ok, true, JSON.stringify(reviewed));
  assert.equal(reviewed.value.status, "available");
  const preview = await read({
    type: "git.commit.preview.read",
    workspaceId: workspace.id,
    observationId: reviewed.value.observationId,
    author: { name: "Synthetic", email: "synthetic@example.invalid" },
    message: "SYNTHETIC commit",
  });
  assert.equal(preview.ok, true, JSON.stringify(preview));
  assert.equal(preview.value.status, "available", JSON.stringify(preview));
  const mutate = (id = "operation-1") => {
    const operation = request(preview.value, id);
    return service.handle(
      {
        version: 2,
        runtimeEpoch: "epoch",
        operationId: id,
        expectedRevision: preview.value.revision,
        operation,
      },
      "sender",
    );
  };
  return {
    home,
    registry,
    service,
    read,
    preview: preview.value,
    mutate,
    workspace,
  };
}

test("Durable commit service defaults explicit confirmation to denial with zero effects", async (t) => {
  let calls = 0;
  const f = await serviceFixture(t, {
    gitCommit: {
      prepare: async () => {
        calls++;
      },
      publish: async () => {
        calls++;
      },
      abort: async () => {
        calls++;
      },
    },
  });
  const result = await f.mutate();
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.code, "CANCELLED");
  assert.equal(result.receipt.effect, "none");
  assert.equal(calls, 0);
});
test("Durable commit service flushes exact target before prepare and never repeats unknown original key", async (t) => {
  let calls = 0;
  let f;
  f = await serviceFixture(t, {
    confirmGitCommit: async (details) => {
      assert.equal(details.author.name, "Synthetic");
      assert.equal(details.canonicalMessage, "SYNTHETIC commit\n");
      assert.equal(details.entries.length, 1);
      return true;
    },
    gitCommit: {
      prepare: async (op) => {
        calls++;
        const key = {
          runtimeEpoch: op.runtimeEpoch,
          operationId: op.operationId,
        };
        assert.equal(f.registry.lookup(key).receipt.admission, "dispatched");
        const journal = await fs.readFile(
          join(f.home, "private/journal.jsonl"),
          "utf8",
        );
        assert.ok(journal.includes("filesystem.git.commit.stage"));
        assert.ok(journal.includes(op.target.commitOid));
        return { status: "unknown", reason: "io_failed" };
      },
      publish: async () => assert.fail("no preparedtoken"),
      abort: async () => assert.fail("no preparedtoken"),
    },
  });
  const result = await f.mutate();
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.value.status, "unknown");
  assert.equal(result.receipt.effect, "unknown");
  assert.equal(calls, 1);
  const lookup = await f.read({
    type: "operation.lookup",
    runtimeEpoch: "epoch",
    operationId: "operation-1",
  });
  assert.equal(lookup.ok, true, JSON.stringify(lookup));
  assert.equal(lookup.value.receipt.effect, "unknown");
  await f.mutate();
  assert.equal(calls, 1);
});
