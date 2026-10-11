import assert from "node:assert/strict";
import test from "node:test";
import * as api from "./workbench-git.mjs";
test("paired Git access retains read facade and adds separately scoped index manager", async () => {
  assert.equal(typeof api.createWorkbenchGitAccess, "function");
  const access = api.createWorkbenchGitAccess({ platform: "unsupported" });
  assert.deepEqual(Object.keys(access).sort(), ["commitManager", "indexManager", "reader"]);
  for (const name of ["review", "diff", "closeSender", "close"])
    assert.equal(typeof access.reader[name], "function");
  for (const name of [
    "preview",
    "previewForApply",
    "apply",
    "closeSender",
    "close",
  ])
    assert.equal(typeof access.indexManager[name], "function");
  const scope = {
    runtimeEpoch: "epoch",
    sender: {},
    trusted: true,
    trustRevision: 0,
    revision: 0,
  };
  await assert.rejects(
    () =>
      access.indexManager.preview(
        { id: "w", path: "/SYNTHETIC/work" },
        {
          type: "git.index.preview.read",
          workspaceId: "w",
          observationId: "a".repeat(64),
          action: "stage",
          paths: ["a.txt"],
        },
        scope,
      ),
    { appCode: "INVALID_REQUEST" },
  );
  await access.reader.close();
});

import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { gitIndexTargetFromApply } from "../renderer/shared/git-index/index.mjs";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function fixture(t, format = "sha1") {
  const home = await fs.realpath(
      await fs.mkdtemp(join(tmpdir(), "omoc-index-manager-")),
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
    assert.equal(r.status, 0, "owned setup Git command failed");
    return r.stdout.trim();
  };
  git("init", "-b", "main", `--object-format=${format}`);
  await fs.writeFile(join(root, "a.txt"), "head\n");
  await fs.writeFile(join(root, "b.txt"), "nonselected\n");
  git("add", "--", "a.txt", "b.txt");
  git("commit", "-m", "synthetic");
  const access = api.createWorkbenchGitAccess();
  t.after(() => access.reader.close());
  const scope = {
    runtimeEpoch: "epoch",
    sender: {},
    trusted: true,
    trustRevision: 1,
    revision: 0,
  };
  // Retain test namespaces; a subsequent actual publisher may retain uncertainty evidence.
  return {
    home,
    root,
    git,
    access,
    scope,
    workspace: { id: "synthetic", path: root },
  };
}
function applyRequest(p, id = "operation") {
  return {
    type: "git.index.apply",
    workspaceId: p.workspaceId,
    requestId: id,
    previewId: p.previewId,
    ...gitIndexTargetFromApply({
      type: "git.index.apply",
      workspaceId: p.workspaceId,
      requestId: id,
      previewId: p.previewId,
      action: p.action,
      paths: p.paths,
      previewDigest: p.previewDigest,
      headOid: p.headOid,
      indexExists: p.indexExists,
      indexDigest: p.indexDigest,
      nextIndexDigest: p.nextIndexDigest,
      objectFormat: p.objectFormat,
    }),
  };
}
test("unborn preview artifact explicitly binds missing HEAD ref and missing index", async (t) => {
  const f = await fixture(t);
  await fs.unlink(join(f.root, ".git/index"));
  await fs.unlink(join(f.root, ".git/refs/heads/main"));
  const o = await f.access.reader.review(f.workspace, f.scope);
  assert.equal(o.status, "available");
  const p = await f.access.indexManager.preview(
    f.workspace,
    {
      type: "git.index.preview.read",
      workspaceId: f.workspace.id,
      observationId: o.observationId,
      action: "stage",
      paths: ["a.txt"],
    },
    f.scope,
  );
  assert.equal(p.status, "available");
  assert.equal(p.headOid, null);
  assert.equal(p.indexExists, false);
  let captured;
  await f.access.indexManager.apply(
    f.workspace,
    applyRequest(p),
    {
      ...f.scope,
      operationDigest: "9".repeat(64),
    },
    async (operation) => {
      captured = JSON.parse(
        await fs.readFile(
          join(operation.artifact.root, "manifest.json"),
          "utf8",
        ),
      );
      return { status: "unknown", reason: "io_failed" };
    },
  );
  assert.ok(captured.source.missing.includes(join(f.root, ".git/index")));
  assert.ok(
    captured.source.missing.includes(join(f.root, ".git/refs/heads/main")),
  );
});
test("selected preview applies checked builtin text/eol normalization in the private worktree", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(join(f.root, ".gitattributes"), "a.txt text eol=lf\n");
  await fs.writeFile(join(f.root, "a.txt"), "current\r\n");
  const o = await f.access.reader.review(f.workspace, f.scope);
  assert.equal(o.status, "available");
  const p = await f.access.indexManager.preview(
    f.workspace,
    {
      type: "git.index.preview.read",
      workspaceId: f.workspace.id,
      observationId: o.observationId,
      action: "stage",
      paths: ["a.txt"],
    },
    f.scope,
  );
  assert.equal(p.status, "available");
  const body = Buffer.from("current\n");
  const expected = createHash("sha1")
    .update(Buffer.from(`blob ${body.length}\0`))
    .update(body)
    .digest("hex");
  assert.equal(p.entries[0].after.oid, expected);
});
for (const format of ["sha1", "sha256"])
  test(`actual private ${format} selected preview creates no original effect and binds immutable artifact`, async (t) => {
    const f = await fixture(t, format);
    await fs.writeFile(join(f.root, "a.txt"), "worktree\r\n");
    if (format === "sha1") {
      f.git("config", "core.filemode", "false");
      await fs.chmod(join(f.root, "a.txt"), 0o755);
    }
    const initial = await fs.readFile(join(f.root, ".git/index")),
      head = await fs.readFile(join(f.root, ".git/HEAD"));
    const o = await f.access.reader.review(f.workspace, f.scope);
    assert.equal(o.status, "available");
    const p = await f.access.indexManager.preview(
      f.workspace,
      {
        type: "git.index.preview.read",
        workspaceId: f.workspace.id,
        observationId: o.observationId,
        action: "stage",
        paths: ["a.txt"],
      },
      f.scope,
    );
    assert.equal(p.status, "available");
    if (format === "sha1") assert.equal(p.entries[0].after.mode, 0o100644);
    assert.equal(p.indexDigest, digest(initial));
    assert.equal(p.entries[0].before.oid, f.git("rev-parse", "HEAD:a.txt"));
    assert.notEqual(p.entries[0].after.oid, p.entries[0].before.oid);
    assert.deepEqual(await fs.readFile(join(f.root, ".git/index")), initial);
    const req = applyRequest(p);
    const s = { ...f.scope, operationDigest: "9".repeat(64) };
    assert.equal(
      f.access.indexManager.previewForApply(f.workspace, req, s).previewId,
      p.previewId,
    );
    assert.throws(
      () =>
        f.access.indexManager.previewForApply(
          f.workspace,
          { ...req, nextIndexDigest: "8".repeat(64) },
          s,
        ),
      { appCode: "FILE_CHANGED" },
    );
    let called = 0,
      artifact;
    const r = await f.access.indexManager.apply(
      f.workspace,
      req,
      s,
      async (operation) => {
        called++;
        artifact = operation.artifact.root;
        const manifest = JSON.parse(
          await fs.readFile(join(artifact, "manifest.json"), "utf8"),
        );
        assert.equal(manifest.proposal.digest, p.nextIndexDigest);
        assert.equal(manifest.digest, s.operationDigest);
        assert.equal(manifest.target.nextIndexDigest, p.nextIndexDigest);
        assert.equal(manifest.objects.length, 1);
        assert.equal(manifest.objects[0].rawBytes, 10);
        assert.deepEqual(
          await fs.readFile(join(f.root, ".git/index")),
          initial,
        );
        return { status: "unknown", reason: "io_failed" };
      },
    );
    assert.deepEqual(r, { requestId: req.requestId, status: "unknown" });
    assert.equal(called, 1);
    assert.ok(await fs.stat(artifact));
    assert.deepEqual(await fs.readFile(join(f.root, ".git/index")), initial);
    assert.deepEqual(await fs.readFile(join(f.root, ".git/HEAD")), head);
    assert.equal(
      await fs.readFile(join(f.root, "b.txt"), "utf8"),
      "nonselected\n",
    );
    await assert.rejects(
      () =>
        f.access.indexManager.apply(f.workspace, req, s, async () => {
          called++;
        }),
      { appCode: "FILE_CHANGED" },
    );
    assert.equal(called, 1);
  });

import { openWorkspaceRegistry } from "./workspace-registry.mjs";
import { createWorkbenchService } from "../workbench-service.mjs";
import { BASELINE_POLICY } from "../workbench-contract.mjs";
async function serviceFixture(t, { confirmGitIndex, gitIndex } = {}) {
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
    workbenchContext: () => ({ client, gitIndex }),
    workspace: home,
  };
  const service = createWorkbenchService({
    registry,
    runtime,
    runtimeEpoch: "epoch",
    bootstrap: true,
    confirmTrust: async () => true,
    confirmGitIndex,
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
  const reviewed = await read({
    type: "git.review.read",
    workspaceId: workspace.id,
  });
  assert.equal(reviewed.ok, true, JSON.stringify(reviewed));
  assert.equal(reviewed.value.status, "available");
  const preview = await read({
    type: "git.index.preview.read",
    workspaceId: workspace.id,
    observationId: reviewed.value.observationId,
    action: "stage",
    paths: ["a.txt"],
  });
  assert.equal(preview.ok, true, JSON.stringify(preview));
  assert.equal(preview.value.status, "available", JSON.stringify(preview));
  const mutate = (id = "operation") => {
    const operation = applyRequest(preview.value, id);
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
test("actual durable service defaults Git confirmation to denial with zero publisher calls", async (t) => {
  let effects = 0;
  const f = await serviceFixture(t, {
    gitIndex: {
      prepare: async () => {
        effects++;
      },
      publish: async () => {
        effects++;
      },
      abort: async () => {
        effects++;
      },
    },
  });
  const r = await f.mutate();
  assert.equal(r.ok, false, JSON.stringify(r));
  assert.equal(r.code, "CANCELLED");
  assert.equal(r.receipt.effect, "none");
  assert.equal(effects, 0);
  const key = { runtimeEpoch: "epoch", operationId: "operation" };
  assert.equal(f.registry.lookup(key).receipt.effect, "none");
});
test("actual durable service flushes stage target before private prepare and keeps unknown original key", async (t) => {
  let effects = 0,
    operation;
  let f;
  f = await serviceFixture(t, {
    confirmGitIndex: async (details) => {
      assert.equal(details.action, "stage");
      assert.deepEqual(details.paths, ["a.txt"]);
      return true;
    },
    gitIndex: {
      prepare: async (value) => {
        effects++;
        operation = value;
        const key = {
          runtimeEpoch: value.runtimeEpoch,
          operationId: value.operationId,
        };
        assert.equal(f.registry.lookup(key).receipt.admission, "dispatched");
        const journal = await fs.readFile(
          join(f.home, "private/journal.jsonl"),
          "utf8",
        );
        assert.ok(journal.includes("filesystem.git.index.stage"));
        assert.ok(journal.includes(value.target.nextIndexDigest));
        return { status: "unknown", reason: "io_failed" };
      },
      publish: async () => {
        effects++;
        assert.fail("no prepared token");
      },
      abort: async () => {
        assert.fail("no prepared token");
      },
    },
  });
  const r = await f.mutate();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.value.status, "unknown");
  assert.equal(r.receipt.effect, "unknown");
  assert.equal(effects, 1);
  assert.equal(operation.target.nextIndexDigest, f.preview.nextIndexDigest);
  const lookup = await f.read({
    type: "operation.lookup",
    runtimeEpoch: "epoch",
    operationId: "operation",
  });
  assert.equal(lookup.ok, true);
  assert.equal(lookup.value.receipt.effect, "unknown");
  await f.mutate();
  assert.equal(effects, 1);
});
