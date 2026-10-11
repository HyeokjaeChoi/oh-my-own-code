// Contained production manager/service/registry/kernel proof. No Native start.
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { captureProvenance } from "./build-provenance.mjs";
import {
  eventHostForResources,
  verifyEventHostResources,
  resourceFileSha256,
  GIT_COMMIT_ASSETS,
} from "../src/event-host-resources.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const executable = "/Library/Developer/CommandLineTools/usr/bin/git";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function executableIdentity(path) {
  const components = [];
  let current = "/";
  for (const part of ["", ...path.split("/").filter(Boolean)]) {
    if (part) current = join(current, part);
    const s = await fs.lstat(current, { bigint: true });
    assert.ok(!s.isSymbolicLink());
    components.push({
      path: current,
      dev: String(s.dev),
      ino: String(s.ino),
      mode: String(s.mode),
      uid: String(s.uid),
    });
  }
  return { sha256: await resourceFileSha256(path), components };
}
async function claim(out) {
  const path = resolve(repository, out);
  const bases = [
    join(repository, "docs/runs/git-explicit-commit/evidence"),
    join(repository, "docs/runs/git-branch-restore/evidence"),
  ];
  assert.ok(
    bases.some((base) => {
      const rel = relative(base, path);
      return (
        rel &&
        rel !== ".." &&
        !rel.startsWith(`..${sep}`) &&
        !rel.startsWith(sep)
      );
    }),
  );
  let cursor = repository;
  for (const part of relative(repository, path).split(sep)) {
    cursor = join(cursor, part);
    try {
      await fs.mkdir(cursor, { mode: 0o700 });
    } catch (error) {
      if (cursor === path || error.code !== "EEXIST") throw error;
    }
    const st = await fs.lstat(cursor);
    assert.ok(st.isDirectory() && !st.isSymbolicLink());
    assert.equal(await fs.realpath(cursor), cursor);
  }
  await fs.writeFile(join(path, ".owned-commit-probe"), "synthetic only\n", {
    flag: "wx",
    mode: 0o600,
  });
  return path;
}
async function child(root, kernelPath) {
  assert.equal(globalThis.Bun?.version, "1.4.2");
  assert.equal(
    await fs.readFile(join(dirname(root), ".owned-commit-probe"), "utf8"),
    "synthetic only\n",
  );
  const { createGitMetadataKernel } = await import(
    pathToFileURL(kernelPath).href
  );
  const { createWorkbenchService } = await import(
    "../src/workbench-service.mjs"
  );
  const { openWorkspaceRegistry } = await import(
    "../src/host/workspace-registry.mjs"
  );
  const { BASELINE_POLICY } = await import("../src/workbench-contract.mjs");
  const {
    GIT_COMMIT_TARGET_FIELDS,
    GIT_COMMIT_REFLOG_REASON,
    gitCommitTargetFromApply,
  } = await import("../src/renderer/shared/git-commit/index.mjs");
  const { gitCommitExpectedBackups, GIT_COMMIT_STATE_MARKERS } = await import(
    "../src/host/git-commit-contract.mjs"
  );
  const { validateHostMessage } = await import(
    "../src/event-host-protocol.mjs"
  );
  const sync = await import("node:fs");
  const nonce = "a".repeat(64),
    observations = [],
    kernelEvents = [];
  const value = (r) => {
    assert.equal(r.ok, true, JSON.stringify(r));
    return r.value;
  };
  const report = {
    result: "fail",
    observations,
    kernelEvents,
    limits: [
      "Actual production paired manager/service/journal and pinned staged descriptor core with SyntheticSDK/directadapter +actual protocol validation. Not actual EventHost OS channel/lifetime or productionMain Nativedialog acceptance.",
      "No provider/privateproject/Windows/powerloss acceptance. Every contained synthetic namespace retained. Unknowns never replayed or upgraded.",
    ],
  };
  async function run(
    name,
    {
      format = "sha1",
      unborn = false,
      nested = false,
      detached = false,
      packed = false,
      linked = false,
      deletion = false,
      logsDisabled = false,
      logsAbsent = false,
      readonlyIndex = false,
      foreignLock = false,
      unknown = false,
      marker = false,
      lateMarker = false,
      deny = false,
      noChanges = false,
      partial = false,
    } = {},
  ) {
    const home = join(root, name);
    await fs.mkdir(home);
    await fs.mkdir(join(home, "private"));
    await fs.mkdir(join(home, "Documents"));
    const registry = await openWorkspaceRegistry({
      directory: join(home, "private"),
      documentsPath: join(home, "Documents"),
      storeId: name,
      runtimeEpoch: "synthetic",
    });
    let effects = 0,
      prepared = 0,
      published = 0,
      operation,
      workspace,
      gitDirectory,
      commonDirectory,
      preview,
      fault = false;
    const core = await createGitMetadataKernel({
      check() {
        if (fault && preview && gitDirectory) {
          const p = join(gitDirectory, "logs/HEAD");
          try {
            if (
              hash(sync.readFileSync(p)) ===
              preview.logs.find((x) => x.role === "head_log")?.nextDigest
            )
              throw Object.assign(
                new Error("SYNTHETIC scope expired after firstlog"),
                { syntheticFault: true },
              );
          } catch (e) {
            if (e.syntheticFault) throw e;
          }
        }
      },
    });
    const adapter = {};
    for (const method of ["prepare", "publish", "abort"])
      adapter[method] = async (input) => {
        const message = {
          type: `git-commit-${method}`,
          nonce,
          requestId: nonce,
          ...(method === "prepare"
            ? { operation: input }
            : { token: input.token }),
        };
        validateHostMessage(message, "child");
        effects++;
        const journal = await fs.readFile(
          join(home, "private/journal.jsonl"),
          "utf8",
        );
        if (method === "prepare") {
          prepared++;
          operation = input;
          assert.ok(journal.includes("filesystem.git.commit.stage"));
          const manifest = JSON.parse(
            await fs.readFile(
              join(input.artifact.root, "manifest.json"),
              "utf8",
            ),
          );
          for (const marker of GIT_COMMIT_STATE_MARKERS)
            assert.ok(
              manifest.source.missing.includes(join(gitDirectory, marker)),
            );
          assert.equal(
            registry.lookup({
              runtimeEpoch: input.runtimeEpoch,
              operationId: input.operationId,
            }).receipt.admission,
            "dispatched",
          );
          if (unknown) return { status: "unknown", reason: "io_failed" };
        }
        if (method === "publish") {
          published++;
          assert.ok(
            journal.indexOf("filesystem.git.commit.stage") <
              journal.indexOf("filesystem.git.commit.publish"),
          );
          fault = partial;
        }
        const result = await core.commit[method](input);
        kernelEvents.push({
          name,
          method,
          status: result.status,
          reason: result.reason ?? null,
        });
        validateHostMessage(
          {
            type: "git-commit-result",
            nonce,
            pid: process.pid,
            requestId: nonce,
            result,
          },
          "parent",
        );
        return result;
      };
    const sessions = new Map(),
      client = {
        session: {
          create: async (input) => {
            const v = { ...input, permissions: BASELINE_POLICY };
            sessions.set(v.id, v);
            return v;
          },
          get: async ({ sessionID }) => sessions.get(sessionID),
          update: async ({ sessionID, ...update }) => {
            const v = { ...sessions.get(sessionID), ...update };
            sessions.set(sessionID, v);
            return v;
          },
          active: async () => ({}),
          inbox: { list: async () => [] },
        },
        message: { list: async () => ({ data: [] }) },
        permission: { list: async () => [] },
      };
    const runtime = {
      snapshot: () => ({ state: "connected" }),
      workbenchContext: () => ({ client, gitCommit: adapter }),
      workspace: home,
    };
    const service = createWorkbenchService({
      registry,
      runtime,
      runtimeEpoch: "synthetic",
      bootstrap: true,
      confirmTrust: async () => true,
      confirmGitCommit: async () => !deny,
      deadlineMs: 10000,
    });
    let readId = 0,
      applied,
      receipt;
    const read = (op) =>
      service.handle(
        {
          version: 2,
          runtimeEpoch: "synthetic",
          readId: `read-${++readId}`,
          operation: op,
        },
        "synthetic-sender",
      );
    try {
      let snapshot;
      for (let i = 0; i < 100; i++) {
        snapshot = value(await read({ type: "snapshot" }));
        if (snapshot.state === "connected" && snapshot.workspaces[0]?.trusted)
          break;
        await new Promise((r) => setTimeout(r, 10));
      }
      assert.equal(snapshot.state, "connected");
      workspace = snapshot.workspaces[0];
      assert.ok(workspace.trusted);
      const env = {
        HOME: home,
        PATH: "/Library/Developer/CommandLineTools/usr/bin",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
        GIT_AUTHOR_NAME: "Synthetic Setup",
        GIT_AUTHOR_EMAIL: "setup@example.invalid",
        GIT_COMMITTER_NAME: "Synthetic Setup",
        GIT_COMMITTER_EMAIL: "setup@example.invalid",
        LC_ALL: "C",
      };
      const gitAt = (cwd, ...args) => {
        assert.ok(cwd.startsWith(home + "/"));
        const r = spawnSync(executable, args, { cwd, env, encoding: "utf8" });
        assert.equal(
          r.status,
          0,
          `Owned synthetic setup command failed: ${args[0]}`,
        );
        return r.stdout.trim();
      };
      let setupRoot = workspace.path;
      if (linked) {
        setupRoot = join(home, "primary");
        await fs.mkdir(setupRoot);
      }
      gitAt(
        setupRoot,
        "init",
        "-b",
        nested ? "nested/branch" : "main",
        `--object-format=${format}`,
      );
      await fs.writeFile(join(setupRoot, "a.txt"), "parent a\n");
      await fs.writeFile(join(setupRoot, "b.txt"), "parent b\n");
      gitAt(setupRoot, "add", "--", "a.txt", "b.txt");
      if (!unborn) gitAt(setupRoot, "commit", "-m", "synthetic setup");
      if (linked)
        gitAt(
          setupRoot,
          "worktree",
          "add",
          "-b",
          "linked/current",
          workspace.path,
        );
      const git = (...args) => gitAt(workspace.path, ...args);
      if (detached) git("checkout", "--detach");
      if (packed) {
        git("pack-refs", "--all");
        // Keep this fixture inside the reader's existing closed pack format.
        // gc also emits objects/info/commit-graph and server-info metadata.
        git("-c", "repack.updateServerInfo=false", "repack", "-ad");
      }
      gitDirectory = git("rev-parse", "--absolute-git-dir");
      commonDirectory = resolve(
        workspace.path,
        git("rev-parse", "--git-common-dir"),
      );
      if (logsDisabled) git("config", "core.logAllRefUpdates", "false");
      const branch = detached ? null : git("symbolic-ref", "HEAD");
      const refPath = detached
        ? join(gitDirectory, "HEAD")
        : join(commonDirectory, branch);
      const logPaths = [
        ["head_log", join(gitDirectory, "logs/HEAD")],
        ...(branch
          ? [["branch_log", join(commonDirectory, "logs", branch)]]
          : []),
      ];
      if (logsAbsent)
        for (const [, p] of logPaths)
          await fs.unlink(p).catch((e) => {
            if (e.code !== "ENOENT") throw e;
          });
      if (deletion) {
        await fs.unlink(join(workspace.path, "a.txt"));
        await fs.unlink(join(workspace.path, "b.txt"));
        git("add", "-u");
      } else if (!noChanges) {
        await fs.writeFile(join(workspace.path, "a.txt"), "staged a\n");
        git("add", "--", "a.txt");
        await fs.writeFile(join(workspace.path, "a.txt"), "unstaged a\r\n");
      }
      const expectedTree = git("write-tree");
      const indexPath = join(gitDirectory, "index");
      if (readonlyIndex) await fs.chmod(indexPath, 0o400);
      const readOptional = async (p) =>
        fs.readFile(p).catch((e) => {
          if (e.code !== "ENOENT") throw e;
          return null;
        });
      const original = {
        index: await fs.readFile(indexPath),
        head: await fs.readFile(join(gitDirectory, "HEAD")),
        config: await fs.readFile(join(commonDirectory, "config")),
        reference: await readOptional(refPath),
        logs: await Promise.all(
          logPaths.map(async ([role, path]) => ({
            role,
            path,
            bytes: await readOptional(path),
          })),
        ),
        a: await readOptional(join(workspace.path, "a.txt")),
        b: await readOptional(join(workspace.path, "b.txt")),
      };
      const parent = unborn ? null : git("rev-parse", "HEAD");
      const primary = linked
        ? {
            head: await fs.readFile(join(commonDirectory, "HEAD")),
            log: await fs.readFile(join(commonDirectory, "logs/HEAD")),
            ref: gitAt(setupRoot, "rev-parse", "main"),
          }
        : null;
      const canary = join(home, "forbidden-helper"),
        hooks = join(home, "hooks");
      await fs.mkdir(hooks);
      await fs.writeFile(
        join(hooks, "reference-transaction"),
        `#!/bin/sh\nprintf called > '${canary}'\n`,
        { mode: 0o700 },
      );
      await fs.writeFile(
        join(home, "signer"),
        `#!/bin/sh\nprintf called > '${canary}'\nexit 1\n`,
        { mode: 0o700 },
      );
      git("config", "core.hooksPath", hooks);
      git("config", "commit.gpgSign", "true");
      git("config", "gpg.program", join(home, "signer"));
      original.config = await fs.readFile(join(commonDirectory, "config"));
      if (marker)
        await fs.writeFile(
          join(gitDirectory, "MERGE_HEAD"),
          (parent ?? "0".repeat(format === "sha1" ? 40 : 64)) + "\n",
        );
      if (foreignLock)
        await fs.writeFile(join(gitDirectory, "index.lock"), "foreign lock\n", {
          flag: "wx",
        });
      const observed = value(
        await read({ type: "git.review.read", workspaceId: workspace.id }),
      );
      assert.equal(observed.status, "available", JSON.stringify(observed));
      preview = value(
        await read({
          type: "git.commit.preview.read",
          workspaceId: workspace.id,
          observationId: observed.observationId,
          author: { name: "합성 A, B", email: "synthetic@example.invalid" },
          message: "\ufeffSYNTHETIC exact commit\r\n\r\n",
        }),
      );
      if (marker || noChanges) {
        assert.equal(preview.status, "unavailable");
        assert.equal(
          preview.reason,
          marker ? "unsupported_commit_state" : "no_changes",
        );
        assert.equal(effects, 0);
        for (const [path, bytes] of [
          [indexPath, original.index],
          [join(gitDirectory, "HEAD"), original.head],
          [join(commonDirectory, "config"), original.config],
          [refPath, original.reference],
          [join(workspace.path, "a.txt"), original.a],
          [join(workspace.path, "b.txt"), original.b],
          ...original.logs.map((x) => [x.path, x.bytes]),
        ])
          assert.deepEqual(await readOptional(path), bytes);
        observations.push({
          name,
          status: "pass",
          format,
          refusal: preview.reason,
          originalUnchanged: true,
        });
        return;
      }
      assert.equal(preview.status, "available", JSON.stringify(preview));
      assert.equal(preview.treeOid, expectedTree);
      assert.equal(preview.headOid, parent);
      assert.equal(preview.indexDigest, hash(original.index));
      assert.equal(preview.entries.length, unborn || deletion ? 2 : 1);
      if (packed) assert.equal(preview.reference.exists, false);
      if (logsDisabled && logsAbsent) assert.equal(preview.logs.length, 0);
      if (readonlyIndex)
        assert.equal((await fs.stat(indexPath)).mode & 0o777, 0o400);
      if (lateMarker)
        await fs.writeFile(
          join(gitDirectory, "REVERT_HEAD"),
          (parent ?? "0".repeat(format === "sha1" ? 40 : 64)) + "\n",
        );
      const op = {
        type: "git.commit.apply",
        workspaceId: workspace.id,
        requestId: name,
        previewId: preview.previewId,
        ...Object.fromEntries(
          GIT_COMMIT_TARGET_FIELDS.map((k) => [k, preview[k]]),
        ),
      };
      const request = {
        version: 2,
        runtimeEpoch: "synthetic",
        operationId: name,
        expectedRevision: preview.revision,
        operation: op,
      };
      const response = await service.handle(request, "synthetic-sender");
      receipt = response.receipt;
      if (deny || lateMarker) {
        assert.equal(response.ok, false, JSON.stringify(response));
        assert.equal(response.code, deny ? "CANCELLED" : "FILE_CHANGED");
        assert.equal(receipt.effect, "none");
        assert.equal(effects, 0);
        applied = { status: "rejected" };
      } else {
        applied = value(response);
        if (foreignLock || unknown || partial) {
          assert.equal(applied.status, "unknown", JSON.stringify(response));
          assert.equal(receipt.effect, "unknown");
          if (!partial) assert.equal(published, 0);
        } else {
          assert.equal(applied.status, "committed", JSON.stringify(response));
          assert.equal(receipt.effect, "confirmed");
          assert.equal(prepared, 1);
          assert.equal(published, 1);
          assert.equal(git("rev-parse", "HEAD"), preview.commitOid);
          assert.equal(git("rev-parse", "HEAD^{tree}"), expectedTree);
          const ident = `합성 A, B <synthetic@example.invalid> ${preview.timestamp} +0000`,
            body = Buffer.from(
              `tree ${expectedTree}\n${parent ? `parent ${parent}\n` : ""}author ${ident}\ncommitter ${ident}\n\n${preview.canonicalMessage}`,
            );
          const actual = spawnSync(
            executable,
            ["cat-file", "commit", preview.commitOid],
            { cwd: workspace.path, env },
          );
          assert.equal(actual.status, 0);
          assert.deepEqual(actual.stdout, body);
          assert.equal(hash(body), preview.commitBodyDigest);
          assert.deepEqual(
            applied.backups,
            gitCommitExpectedBackups(
              gitCommitTargetFromApply(op),
              "synthetic",
              name,
            ),
          );
          assert.equal(receipt.result.digest, operation.digest);
          assert.deepEqual(
            await fs.readFile(refPath),
            Buffer.from(preview.commitOid + "\n"),
          );
          for (const log of preview.logs) {
            const prior = original.logs.find((x) => x.role === log.role),
              bytes = await fs.readFile(prior.path),
              line = Buffer.from(
                `${parent ?? "0".repeat(format === "sha1" ? 40 : 64)} ${preview.commitOid} ${ident}\t${GIT_COMMIT_REFLOG_REASON}\n`,
              );
            assert.deepEqual(
              bytes,
              Buffer.concat([prior.bytes ?? Buffer.alloc(0), line]),
            );
            assert.equal(hash(bytes), log.nextDigest);
          }
          for (const backup of applied.backups) {
            const metaRoot = backup.role.startsWith("branch")
              ? commonDirectory
              : gitDirectory;
            const prior = backup.role.endsWith("_ref")
              ? original.reference
              : original.logs.find((x) => x.role === backup.role).bytes;
            if (prior === null) assert.equal(backup.backupId, null);
            else
              assert.deepEqual(
                await fs.readFile(join(metaRoot, backup.backupId)),
                prior,
              );
          }
        }
      }
      assert.deepEqual(await fs.readFile(indexPath), original.index);
      if (!detached)
        assert.deepEqual(
          await fs.readFile(join(gitDirectory, "HEAD")),
          original.head,
        );
      assert.deepEqual(
        await fs.readFile(join(commonDirectory, "config")),
        original.config,
      );
      assert.deepEqual(
        await readOptional(join(workspace.path, "a.txt")),
        original.a,
      );
      assert.deepEqual(
        await readOptional(join(workspace.path, "b.txt")),
        original.b,
      );
      if (applied.status !== "committed") {
        assert.deepEqual(await readOptional(refPath), original.reference);
        if (!partial)
          for (const log of original.logs)
            assert.deepEqual(await readOptional(log.path), log.bytes);
      }
      if (partial) {
        const headLog = original.logs.find((x) => x.role === "head_log");
        assert.equal(
          hash(await fs.readFile(headLog.path)),
          preview.logs.find((x) => x.role === "head_log").nextDigest,
        );
        assert.deepEqual(await readOptional(refPath), original.reference);
      }
      if (foreignLock)
        assert.equal(
          await fs.readFile(join(gitDirectory, "index.lock"), "utf8"),
          "foreign lock\n",
        );
      assert.equal(
        await fs.lstat(canary).then(
          () => true,
          () => false,
        ),
        false,
      );
      if (primary) {
        assert.deepEqual(
          await fs.readFile(join(commonDirectory, "HEAD")),
          primary.head,
        );
        assert.deepEqual(
          await fs.readFile(join(commonDirectory, "logs/HEAD")),
          primary.log,
        );
        assert.equal(gitAt(setupRoot, "rev-parse", "main"), primary.ref);
      }
      const count = effects;
      await service.handle(request, "synthetic-sender");
      assert.equal(effects, count);
      const conflict = await service.handle(
        { ...request, operation: { ...op, commitBodyDigest: "f".repeat(64) } },
        "synthetic-sender",
      );
      assert.equal(conflict.ok, false);
      assert.equal(effects, count);
      const lookup = value(
        await read({
          type: "operation.lookup",
          runtimeEpoch: "synthetic",
          operationId: name,
        }),
      );
      assert.equal(lookup.receipt.effect, receipt.effect);
      observations.push({
        name,
        status: "pass",
        format,
        layout: linked
          ? "linked"
          : detached
            ? "detached"
            : unborn
              ? "unborn"
              : "attached",
        result: applied.status,
        prepared,
        published,
        referencePhysicalExists: preview.reference.exists,
        logRoles: preview.logs.map((x) => x.role),
        backupRoles:
          applied.backups?.map((x) => ({
            role: x.role,
            present: x.backupId !== null,
          })) ?? [],
        originalIndexWorktreeConfigPreserved: true,
        helpersNotInvoked: true,
      });
    } finally {
      service.close();
      await service.drain();
      await core.close();
      if (receipt) await registry.checkpoint();
      await registry.close();
    }
    if (receipt) {
      const reopened = await openWorkspaceRegistry({
        directory: join(home, "private"),
        documentsPath: join(home, "Documents"),
        storeId: name,
        runtimeEpoch: "reopened",
      });
      try {
        const record = reopened.lookup({
          runtimeEpoch: "synthetic",
          operationId: name,
        });
        assert.equal(record.receipt.effect, receipt.effect);
        if (receipt.effect === "unknown")
          assert.ok(
            reopened
              .readView()
              .retainedOperations.some(
                (x) => x.runtimeEpoch === "synthetic" && x.operationId === name,
              ),
          );
      } finally {
        await reopened.close();
      }
    }
  }
  try {
    for (const format of ["sha1", "sha256"]) {
      for (const [suffix, opts] of [
        ["attached", {}],
        ["unborn", { unborn: true }],
        ["nested-unborn", { unborn: true, nested: true }],
        ["detached", { detached: true }],
        ["packed", { packed: true }],
        ["linked", { linked: true }],
        ["all-deleted", { deletion: true }],
        ["logs-disabled-existing", { logsDisabled: true }],
        ["logs-disabled-absent", { logsDisabled: true, logsAbsent: true }],
        ["readonly-index", { readonlyIndex: true }],
        ["no-changes", { noChanges: true }],
        ["ordinary-marker", { marker: true }],
      ])
        await run(`${format}-${suffix}`, { format, ...opts });
    }
    for (const [name, opts] of [
      ["foreign-lock", { foreignLock: true }],
      ["unknown-no-replay", { unknown: true }],
      ["default-cancel", { deny: true }],
      ["late-marker", { lateMarker: true }],
      ["partial-first-log", { partial: true }],
      ["nested-attached", { nested: true }],
      [
        "detached-no-logs",
        { detached: true, logsDisabled: true, logsAbsent: true },
      ],
      ["sha256-partial-first-log", { format: "sha256", partial: true }],
      ["sha256-late-marker", { format: "sha256", lateMarker: true }],
    ])
      await run(name, opts);
    assert.equal(observations.length, 33);
    report.result = "pass";
  } catch (error) {
    report.failure = {
      name: error.name,
      code: error.code ?? null,
      message: String(error.message).slice(0, 4096),
    };
    throw error;
  } finally {
    await fs.writeFile(
      join(root, "matrix.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  }
}
async function main(args) {
  assert.deepEqual(
    args.filter((_, i) => i % 2 === 0),
    ["--out", "--platform"],
  );
  assert.equal(args[3], "darwin");
  assert.equal(process.platform, "darwin");
  assert.equal(process.arch, "arm64");
  const out = await claim(args[1]);
  let report = {
    schema_version: 1,
    status: "fail",
    authority:
      "Actual paired Git manager, durable service/registry and app-staged pinned Bun descriptor kernel in contained synthetic repositories; no Native start.",
  };
  let identity;
  try {
    const descriptor = eventHostForResources(
      join(repository, "apps/desktop-app/dist/resources"),
      "darwin",
      "arm64",
    );
    await verifyEventHostResources(descriptor);
    identity = async () => ({
      provenance: await captureProvenance(repository, {
        script: "git-commit",
        mode: "dev",
        platform: "darwin",
      }),
      engine: await executableIdentity(descriptor.enginePath),
      manifest: await resourceFileSha256(descriptor.manifestPath),
      git: await executableIdentity(executable),
      assets: Object.fromEntries(
        await Promise.all(
          GIT_COMMIT_ASSETS.map(async (path) => {
            const source = await resourceFileSha256(
                join(repository, "apps/desktop-app/src", path),
              ),
              staged = await resourceFileSha256(join(descriptor.root, path));
            assert.equal(source, staged, `Staged source mismatch: ${path}`);
            return [path, staged];
          }),
        ),
      ),
    });
    report.before = await identity();
    const root = await fs.mkdtemp(join(out, "synthetic-"));
    report.retainedNamespace = root;
    await fs.mkdir(join(root, "home"));
    await fs.mkdir(join(root, "tmp"));
    const result = spawnSync(
      descriptor.enginePath,
      [
        fileURLToPath(import.meta.url),
        "--child",
        root,
        join(descriptor.root, "host/git-metadata-kernel.mjs"),
      ],
      {
        cwd: root,
        env: {
          PATH: "/usr/bin:/bin",
          HOME: join(root, "home"),
          TMPDIR: join(root, "tmp"),
          XDG_CONFIG_HOME: join(root, "home"),
          XDG_DATA_HOME: join(root, "home"),
          XDG_STATE_HOME: join(root, "home"),
        },
        encoding: "utf8",
        timeout: 240000,
        maxBuffer: 65536,
      },
    );
    report.exit = {
      pid: result.pid,
      exited: result.status !== null || result.signal !== null,
      status: result.status,
      signal: result.signal,
      error: result.error?.code ?? null,
    };
    report.matrix = JSON.parse(
      await fs.readFile(join(root, "matrix.json"), "utf8"),
    );
    report.after = await identity();
    assert.deepEqual(report.after, report.before);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, JSON.stringify(report.matrix.failure));
    assert.equal(report.matrix.result, "pass");
    assert.equal(report.matrix.observations.length, 33);
    report.status = "pass";
  } catch (error) {
    report.failure = {
      name: error.name,
      code: error.code ?? null,
      message: String(error.message).slice(0, 4096),
    };
    process.exitCode = 1;
  } finally {
    if (report.before && !report.after) {
      try {
        report.after = await identity();
      } catch (error) {
        report.afterFailure = {
          code: error.code ?? null,
          message: String(error.message).slice(0, 2048),
        };
      }
    }
    await fs.writeFile(
      join(out, "publication-evidence.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  }
}
if (process.argv[2] === "--child")
  await child(process.argv[3], process.argv[4]);
else await main(process.argv.slice(2));
