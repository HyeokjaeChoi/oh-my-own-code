import test from "node:test";
import assert from "node:assert/strict";
import { createWorkbenchGitAccess } from "./workbench-git.mjs";
test("branch/restore shares the real reader owner and exposes the typed manager", async () => {
  let calls = 0;
  const access = createWorkbenchGitAccess({
    io: new Proxy(
      {},
      {
        get() {
          calls++;
          throw new Error("unexpected IO");
        },
      },
    ),
    spawn() {
      calls++;
      throw new Error("unexpected spawn");
    },
  });
  assert.ok(access.branchRestoreManager);
  for (const name of [
    "preview",
    "previewForApply",
    "apply",
    "retireSender",
    "retireAll",
    "closeSender",
    "close",
  ])
    assert.equal(typeof access.branchRestoreManager[name], "function");
  assert.equal(calls, 0);
  await access.branchRestoreManager.close();
  await access.reader.close();
  assert.equal(calls, 0);
});

import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createWorkbenchService } from "../workbench-service.mjs";
import { openWorkspaceRegistry } from "./workspace-registry.mjs";
import { BASELINE_POLICY } from "../workbench-contract.mjs";
import { GIT_BRANCH_RESTORE_TARGET_FIELDS } from "../renderer/shared/git-branch-restore/index.mjs";
const request = (p, id = "operation-1") => ({
  type: p.action === "restore" ? "git.restore.apply" : "git.branch.apply",
  workspaceId: p.workspaceId,
  requestId: id,
  previewId: p.previewId,
  ...Object.fromEntries(GIT_BRANCH_RESTORE_TARGET_FIELDS.map((k) => [k, p[k]])),
});
async function serviceFixture(
  t,
  { confirmGitBranchRestore, gitBranchRestore, restore = false } = {},
) {
  const home = await fs.realpath(
      await fs.mkdtemp(join(tmpdir(), "omoc-branch-service-")),
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
  const callbackErrors = [];
  const guarded =
    (fn) =>
    async (...args) => {
      try {
        return await fn(...args);
      } catch (error) {
        callbackErrors.push(error);
        throw error;
      }
    };
  if (gitBranchRestore)
    gitBranchRestore = Object.fromEntries(
      Object.entries(gitBranchRestore).map(([name, fn]) => [name, guarded(fn)]),
    );
  if (confirmGitBranchRestore)
    confirmGitBranchRestore = guarded(confirmGitBranchRestore);
  const runtime = {
    snapshot: () => ({ state: "connected" }),
    workbenchContext: () => ({ client, gitBranchRestore }),
    workspace: home,
  };
  const service = createWorkbenchService({
    registry,
    runtime,
    runtimeEpoch: "epoch",
    bootstrap: true,
    confirmTrust: async () => true,
    confirmGitBranchRestore,
    deadlineMs: 10000,
  });
  t.after(async () => {
    service.close();
    await service.drain();
    await registry.close();
    assert.deepEqual(callbackErrors, [], callbackErrors[0]?.message);
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
    type: restore ? "git.restore.preview.read" : "git.branch.preview.read",
    workspaceId: workspace.id,
    observationId: reviewed.value.observationId,
    ...(restore
      ? { source: "head", paths: ["a.txt"] }
      : {
          action: "create",
          branch: "refs/heads/next",
          author: { name: "Synthetic", email: "synthetic@example.invalid" },
        }),
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

test("Durable branch service denies default confirmation without filesystem dispatch", async (t) => {
  let calls = 0;
  const f = await serviceFixture(t, {
    gitBranchRestore: {
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
for (const restore of [false, true])
  test(`Durable ${restore ? "restore" : "branch"} service flushes original target before prepare and never replays unknown`, async (t) => {
    let calls = 0,
      f;
    f = await serviceFixture(t, {
      restore,
      confirmGitBranchRestore: async (details) => {
        assert.equal(details.action, restore ? "restore" : "create");
        assert.equal(details.workspacePath, f.workspace.path);
        assert.ok(details.backups.length > 0);
        if (restore) {
          assert.equal(details.source, "head");
          assert.equal(details.author, null);
          assert.equal(details.paths[0].path, "a.txt");
        } else {
          assert.equal(details.author.name, "Synthetic");
          assert.equal(details.branch, "refs/heads/next");
        }
        return true;
      },
      gitBranchRestore: {
        prepare: async (op) => {
          calls++;
          assert.equal(
            f.registry.lookup({
              runtimeEpoch: op.runtimeEpoch,
              operationId: op.operationId,
            }).receipt.admission,
            "dispatched",
          );
          const journal = await fs.readFile(
            join(f.home, "private/journal.jsonl"),
            "utf8",
          );
          assert.ok(journal.includes("filesystem.git.branch_restore.stage"));
          assert.ok(journal.includes(op.target.previewDigest));
          assert.ok(!journal.includes("synthetic@example.invalid"));
          return { status: "unknown", reason: "io_failed" };
        },
        publish: async () => assert.fail("no token"),
        abort: async () => assert.fail("no token"),
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
    assert.equal(lookup.ok, true);
    assert.equal(lookup.value.receipt.effect, "unknown");
    await f.mutate();
    assert.equal(calls, 1);
  });

test("Branch confirmation cannot preserve preview authority after an external file change", async (t) => {
  let f,
    effects = 0;
  f = await serviceFixture(t, {
    confirmGitBranchRestore: async () => {
      await fs.writeFile(
        join(f.workspace.path, "a.txt"),
        "external change after preview\n",
      );
      return true;
    },
    gitBranchRestore: {
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
  const response = await f.mutate();
  assert.equal(response.ok, false, JSON.stringify(response));
  assert.equal(response.code, "FILE_CHANGED");
  assert.equal(response.receipt.effect, "none");
  assert.equal(effects, 0);
  assert.equal(
    await fs.readFile(join(f.workspace.path, "a.txt"), "utf8"),
    "external change after preview\n",
  );
});

test("Branch service flushes both immutable intents and retains an uncertain publish", async (t) => {
  let f,
    effects = 0;
  f = await serviceFixture(t, {
    confirmGitBranchRestore: async () => true,
    gitBranchRestore: {
      prepare: async (operation) => {
        effects++;
        assert.equal(operation.operationId, "operation-1");
        return { status: "prepared", token: "a".repeat(64) };
      },
      publish: async ({ token }) => {
        effects++;
        assert.equal(token, "a".repeat(64));
        const journal = await fs.readFile(
          join(f.home, "private/journal.jsonl"),
          "utf8",
        );
        const records = journal
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        const steps = records
          .map((record) => record.payload)
          .filter((payload) =>
            payload.step?.startsWith("filesystem.git.branch_restore."),
          );
        assert.deepEqual(
          steps.map((step) => step.step),
          [
            "filesystem.git.branch_restore.stage",
            "filesystem.git.branch_restore.publish",
          ],
        );
        assert.deepEqual(
          steps[0].gitBranchRestoreTarget,
          steps[1].gitBranchRestoreTarget,
        );
        return { status: "unknown", reason: "io_failed" };
      },
      abort: async () => assert.fail("published token is consumed"),
    },
  });
  const response = await f.mutate();
  assert.equal(response.ok, true, JSON.stringify(response));
  assert.equal(response.value.status, "unknown");
  assert.equal(response.receipt.effect, "unknown");
  assert.equal(effects, 2);
  await f.mutate();
  assert.equal(effects, 2);
});

async function managerFixture(t, format = "sha1", options = {}) {
  const home = await fs.realpath(
      await fs.mkdtemp(join(tmpdir(), "omoc-branch-manager-")),
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
  git("switch", "-c", "target");
  await fs.writeFile(join(root, "a.txt"), "target\n");
  git("add", "--", "a.txt");
  git("commit", "-m", "synthetic target");
  git("switch", "main");
  const { packed = false, ...readerOptions } = options;
  if (packed) {
    git("pack-refs", "--all");
    git("-c", "repack.updateServerInfo=false", "repack", "-ad");
  }
  const access = createWorkbenchGitAccess(readerOptions);
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
  const preview = async (action = "select", source = "head") => {
    if (action === "restore")
      await fs.writeFile(join(root, "a.txt"), "dirty\r\n");
    const o = await read();
    assert.equal(o.status, "available", JSON.stringify(o));
    return access.branchRestoreManager.preview(
      workspace,
      action === "restore"
        ? {
            type: "git.restore.preview.read",
            workspaceId: workspace.id,
            observationId: o.observationId,
            source,
            paths: ["a.txt"],
          }
        : {
            type: "git.branch.preview.read",
            workspaceId: workspace.id,
            observationId: o.observationId,
            action,
            branch:
              action === "create" ? "refs/heads/created" : "refs/heads/target",
            author: { name: "합성 A, B", email: "synthetic@example.invalid" },
          },
      scope,
    );
  };
  return { home, root, git, access, workspace, scope, preview, read };
}

import { validateGitBranchRestoreArtifactManifest } from "./git-branch-restore-contract.mjs";
for (const format of ["sha1", "sha256"])
  for (const action of ["create", "select", "restore"])
    test(`Actual ${format} ${action} manager binds raw private objects and retires uncertain original authority`, async (t) => {
      const f = await managerFixture(t, format),
        p = await f.preview(action);
      assert.equal(p.status, "available", JSON.stringify(p));
      const op = request(p),
        index = await fs.readFile(join(f.root, ".git/index")),
        head = await fs.readFile(join(f.root, ".git/HEAD")),
        original = await fs.readFile(join(f.root, "a.txt"));
      let calls = 0,
        callbackError;
      const response = await f.access.branchRestoreManager.apply(
        f.workspace,
        op,
        { ...f.scope, operationDigest: "9".repeat(64) },
        async (operation) => {
          calls++;
          try {
            const manifest = JSON.parse(
              await fs.readFile(
                join(operation.artifact.root, "manifest.json"),
                "utf8",
              ),
            );
            validateGitBranchRestoreArtifactManifest(manifest, operation);
            assert.equal(operation.digest, "9".repeat(64));
            assert.equal(
              manifest.author?.name ?? null,
              action === "restore" ? null : "합성 A, B",
            );
            assert.ok(
              manifest.objects.every(
                (object) =>
                  object.install === false && object.bytes === object.rawBytes,
              ),
            );
            const proofOids = new Set(
              manifest.objects
                .filter((x) => x.type === "blob")
                .map((x) => x.oid),
            );
            for (const entry of manifest.currentEntries) {
              if (action === "select" || entry.path.endsWith(".gitattributes"))
                assert.ok(
                  proofOids.has(entry.oid),
                  `Original blob proof missing: ${entry.path}`,
                );
            }
            for (const path of p.paths)
              for (const entry of [path.beforeEntry, path.afterEntry])
                if (entry)
                  assert.ok(
                    proofOids.has(entry.oid),
                    `Selected blob proof missing: ${path.path}`,
                  );
            assert.ok(
              manifest.source.files.some(
                (file) => file.path === join(f.root, ".git/index"),
              ),
            );
            return { status: "unknown", reason: "io_failed" };
          } catch (error) {
            callbackError = error;
            throw error;
          }
        },
      );
      assert.equal(callbackError, undefined, callbackError?.message);
      assert.deepEqual(response, {
        requestId: op.requestId,
        status: "unknown",
      });
      assert.equal(calls, 1);
      assert.deepEqual(await fs.readFile(join(f.root, ".git/index")), index);
      assert.deepEqual(await fs.readFile(join(f.root, ".git/HEAD")), head);
      assert.deepEqual(await fs.readFile(join(f.root, "a.txt")), original);
      assert.throws(
        () =>
          f.access.branchRestoreManager.previewForApply(
            f.workspace,
            op,
            f.scope,
          ),
        { appCode: "FILE_CHANGED" },
      );
    });
test("Branch manager refuses scope changes and sender closure before any publisher authority", async (t) => {
  const f = await managerFixture(t),
    p = await f.preview("create"),
    op = request(p);
  for (const change of [
    { sender: {} },
    { runtimeEpoch: "other" },
    { trustRevision: 2 },
    { revision: 4 },
    { trusted: false },
  ])
    assert.throws(() =>
      f.access.branchRestoreManager.previewForApply(f.workspace, op, {
        ...f.scope,
        ...change,
      }),
    );
  f.access.reader.closeSender(f.scope.sender);
  assert.throws(
    () =>
      f.access.branchRestoreManager.previewForApply(f.workspace, op, f.scope),
    { appCode: "FILE_CHANGED" },
  );
});

for (const format of ["sha1", "sha256"])
  test(`Packed ${format} branch selection declares absent loose refs for independent lookup`, async (t) => {
    const f = await managerFixture(t, format, { packed: true });
    const p = await f.preview("select");
    assert.equal(p.status, "available", JSON.stringify(p));
    let manifest;
    await f.access.branchRestoreManager.apply(
      f.workspace,
      request(p),
      { ...f.scope, operationDigest: "9".repeat(64) },
      async (operation) => {
        manifest = JSON.parse(
          await fs.readFile(
            join(operation.artifact.root, "manifest.json"),
            "utf8",
          ),
        );
        return { status: "unknown", reason: "io_failed" };
      },
    );
    assert.ok(manifest);
    for (const name of ["main", "target"])
      assert.ok(
        manifest.source.missing.includes(join(f.root, ".git/refs/heads", name)),
        `Missing loose-ref absence: ${name}`,
      );
    assert.ok(
      manifest.source.files.some((f) => f.path.endsWith("/.git/packed-refs")),
    );
  });
