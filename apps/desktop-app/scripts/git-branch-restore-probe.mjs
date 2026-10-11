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
  EVENT_HOST_CODE_ASSETS,
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
  const bases = [join(repository, "docs/runs/git-branch-restore/evidence")];
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
  await fs.writeFile(
    join(path, ".owned-branch-restore-probe"),
    "synthetic only\n",
    {
      flag: "wx",
      mode: 0o600,
    },
  );
  return path;
}

const MATRIX = [
  ...["sha1", "sha256"].flatMap((format) => [
    [format + "-create", { format, action: "create" }],
    [format + "-select", { format, action: "select" }],
    [format + "-index", { format, action: "restore", source: "index" }],
    [format + "-head", { format, action: "restore", source: "head" }],
    [format + "-delete", { format, action: "restore", deletion: true }],
    [format + "-missing", { format, action: "restore", missing: true }],
    [
      format + "-mode",
      { format, action: "restore", source: "index", mode: true },
    ],
  ]),
  ["ident-select", { action: "select", ident: true }],
  ["ident-index", { action: "restore", source: "index", ident: true }],
  ["binary-head", { action: "restore", binary: true }],
  ["linked-select", { action: "select", linked: true }],
  ["detached-select", { action: "select", detached: true }],
  ["packed-select", { action: "select", packed: true }],
  ["nested-create", { action: "create", nested: true }],
  ["disabled-absent-log", { action: "create", logsDisabled: true }],
  ["readonly-unchanged-metadata", { action: "restore", readonly: true }],
  ["readonly-index-create", { action: "create", readonly: true }],
  ["marker-refusal", { action: "restore", marker: true }],
  ["occupied-refusal", { action: "select", occupied: true }],
  ["dirty-refusal", { action: "select", dirty: true }],
  ["collision-refusal", { action: "select", collision: true }],
  ["protected-refusal", { action: "restore", protectedPath: true }],
  ["late-marker", { action: "create", lateMarker: true }],
  ["default-cancel", { action: "restore", deny: true }],
  ["foreign-lock", { action: "restore", foreignLock: true }],
  ["unknown-no-replay", { action: "select", unknown: true }],
  ["partial-no-upgrade", { action: "select", partial: true }],
];

async function child(root, kernelPath) {
  assert.equal(globalThis.Bun?.version, "1.4.2");
  assert.equal(
    await fs.readFile(
      join(dirname(root), ".owned-branch-restore-probe"),
      "utf8",
    ),
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
  const { GIT_BRANCH_RESTORE_TARGET_FIELDS, gitBranchRestoreTargetFromApply } =
    await import("../src/renderer/shared/git-branch-restore/index.mjs");
  const { gitBranchRestoreExpectedBackups, GIT_BRANCH_RESTORE_STATE_MARKERS } =
    await import("../src/host/git-branch-restore-contract.mjs");
  const { validateHostMessage } = await import(
    "../src/event-host-protocol.mjs"
  );
  const sync = await import("node:fs");
  const observations = [],
    kernelEvents = [],
    nonce = "a".repeat(64);
  const report = {
    result: "fail",
    observations,
    kernelEvents,
    limits: [
      "Actual production reader/manager/service/journal and staged pinned Bun descriptor core; SyntheticSDK/direct typed adapter with actual protocol validation. No actual EventHost OS IPC/lifetime or productionMain Native dialog pixels.",
      "Contained known-byte synthetic repositories only; all namespaces retained. No provider/private project/Windows/power-loss acceptance; ordered publication is not global atomicity or exclusion of uncooperative writers.",
    ],
  };
  const value = (response) => {
    assert.equal(response.ok, true, JSON.stringify(response));
    return response.value;
  };
  const optional = (path) =>
    fs.readFile(path).catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return null;
    });
  async function inventory(directory) {
    const rows = {};
    async function walk(path, prefix = "") {
      for (const name of (await fs.readdir(path)).sort()) {
        const full = join(path, name),
          rel = prefix ? `${prefix}/${name}` : name;
        const stat = await fs.lstat(full, { bigint: true });
        assert.ok(!stat.isSymbolicLink());
        if (stat.isDirectory()) {
          rows[rel + "/"] = { mode: Number(stat.mode & 0o777n) };
          await walk(full, rel);
        } else {
          assert.ok(stat.isFile() && stat.nlink === 1n);
          rows[rel] = {
            dev: String(stat.dev),
            ino: String(stat.ino),
            mode: Number(stat.mode & 0o777n),
            bytes: Number(stat.size),
            mtime: String(stat.mtimeNs),
            ctime: String(stat.ctimeNs),
            digest: hash(await fs.readFile(full)),
          };
        }
      }
    }
    await walk(directory);
    return rows;
  }
  async function run(name, opts) {
    const { format = "sha1", action, source = "head" } = opts;
    const home = join(root, name),
      privateRoot = join(home, "private"),
      documentsPath = join(home, "Documents");
    await fs.mkdir(home);
    await fs.mkdir(privateRoot);
    await fs.mkdir(documentsPath);
    const registry = await openWorkspaceRegistry({
      directory: privateRoot,
      documentsPath,
      storeId: name,
      runtimeEpoch: "synthetic",
    });
    let workspace,
      gitDirectory,
      commonDirectory,
      preview,
      original,
      originalCommon,
      operation,
      receipt,
      prepared = 0,
      published = 0,
      effects = 0,
      fault = false,
      adapterError;
    const core = await createGitMetadataKernel({
      check() {
        if (fault && preview?.paths[0]?.after && workspace) {
          try {
            if (
              hash(
                sync.readFileSync(join(workspace.path, preview.paths[0].path)),
              ) === preview.paths[0].after.digest
            )
              throw Object.assign(
                new Error("SYNTHETIC scope expired after first path"),
                { syntheticFault: true },
              );
          } catch (error) {
            if (error.syntheticFault) throw error;
          }
        }
      },
    });
    const adapter = {};
    for (const method of ["prepare", "publish", "abort"])
      adapter[method] = async (input) => {
        try {
          validateHostMessage(
            {
              type: `git-branch-restore-${method}`,
              nonce,
              requestId: nonce,
              ...(method === "prepare"
                ? { operation: input }
                : { token: input.token }),
            },
            "child",
          );
          effects++;
          const journal = await fs.readFile(
            join(privateRoot, "journal.jsonl"),
            "utf8",
          );
          if (method === "prepare") {
            prepared++;
            operation = input;
            assert.ok(journal.includes("filesystem.git.branch_restore.stage"));
            assert.ok(!journal.includes("synthetic@example.invalid"));
            assert.equal(
              registry.lookup({
                runtimeEpoch: input.runtimeEpoch,
                operationId: input.operationId,
              }).receipt.admission,
              "dispatched",
            );
            const manifest = JSON.parse(
              await fs.readFile(
                join(input.artifact.root, "manifest.json"),
                "utf8",
              ),
            );
            for (const marker of GIT_BRANCH_RESTORE_STATE_MARKERS)
              assert.ok(
                manifest.source.missing.includes(join(gitDirectory, marker)),
              );
            if (opts.unknown) return { status: "unknown", reason: "io_failed" };
          }
          if (method === "publish") {
            published++;
            assert.ok(
              journal.indexOf("filesystem.git.branch_restore.stage") <
                journal.indexOf("filesystem.git.branch_restore.publish"),
            );
            fault = !!opts.partial;
          }
          const result = await core.branchRestore[method](input);
          kernelEvents.push({
            name,
            method,
            status: result.status,
            reason: result.reason ?? null,
          });
          validateHostMessage(
            {
              type: "git-branch-restore-result",
              nonce,
              requestId: nonce,
              pid: process.pid,
              result,
            },
            "parent",
          );
          return result;
        } catch (error) {
          adapterError = error;
          throw error;
        }
      };
    const sessions = new Map();
    const client = {
      session: {
        create: async (input) => {
          const session = { ...input, permissions: BASELINE_POLICY };
          sessions.set(session.id, session);
          return session;
        },
        get: async ({ sessionID }) => sessions.get(sessionID),
        update: async ({ sessionID, ...update }) => {
          const session = { ...sessions.get(sessionID), ...update };
          sessions.set(sessionID, session);
          return session;
        },
        active: async () => ({}),
        inbox: { list: async () => [] },
      },
      message: { list: async () => ({ data: [] }) },
      permission: { list: async () => [] },
    };
    const runtime = {
      snapshot: () => ({ state: "connected" }),
      workspace: home,
      workbenchContext: () => ({ client, gitBranchRestore: adapter }),
    };
    const service = createWorkbenchService({
      registry,
      runtime,
      runtimeEpoch: "synthetic",
      bootstrap: true,
      confirmTrust: async () => true,
      confirmGitBranchRestore: async () => !opts.deny,
      deadlineMs: 10000,
    });
    let readId = 0;
    const read = (operation) =>
      service.handle(
        {
          version: 2,
          runtimeEpoch: "synthetic",
          readId: `r-${++readId}`,
          operation,
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
        LC_ALL: "C",
        LANG: "C",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_SYSTEM: "/dev/null",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_TERMINAL_PROMPT: "0",
        GIT_AUTHOR_NAME: "Synthetic Setup",
        GIT_AUTHOR_EMAIL: "setup@example.invalid",
        GIT_COMMITTER_NAME: "Synthetic Setup",
        GIT_COMMITTER_EMAIL: "setup@example.invalid",
      };
      const gitAt = (cwd, ...args) => {
        assert.ok(cwd.startsWith(home + "/"));
        const result = spawnSync(
          executable,
          [
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "commit.gpgSign=false",
            ...args,
          ],
          { cwd, env, encoding: "utf8", timeout: 10000 },
        );
        assert.equal(result.status, 0, `Synthetic setup ${args[0]}`);
        return result.stdout.trim();
      };
      const primary = opts.linked ? join(home, "primary") : workspace.path;
      if (opts.linked) await fs.mkdir(primary);
      gitAt(primary, "init", "-b", "main", `--object-format=${format}`);
      const tracked = opts.protectedPath ? ".env" : "a.txt";
      await fs.writeFile(
        join(primary, tracked),
        opts.ident
          ? "head $Id$\n"
          : opts.binary
            ? Buffer.from("head\0a\r\n")
            : "head a\n",
      );
      await fs.writeFile(join(primary, "b.txt"), "head b\n");
      if (opts.ident) {
        await fs.writeFile(join(primary, ".gitattributes"), "a.txt ident\n");
        gitAt(primary, "add", "--", ".gitattributes");
      }
      gitAt(primary, "add", "--", tracked, "b.txt");
      gitAt(primary, "commit", "-m", "synthetic head");
      gitAt(primary, "switch", "-c", "target");
      await fs.writeFile(
        join(primary, tracked),
        opts.ident ? "target $Id$\n" : "target a\n",
      );
      await fs.writeFile(join(primary, "b.txt"), "target b\n");
      await fs.writeFile(join(primary, "new.txt"), "new target\n");
      gitAt(primary, "add", "--", tracked, "b.txt", "new.txt");
      gitAt(primary, "commit", "-m", "synthetic target");
      gitAt(primary, "switch", "main");
      if (opts.linked)
        gitAt(
          primary,
          "worktree",
          "add",
          "-b",
          "linked/current",
          workspace.path,
        );
      const git = (...args) => gitAt(workspace.path, ...args);
      if (opts.detached) git("checkout", "--detach");
      if (opts.packed) {
        git("pack-refs", "--all");
        git("-c", "repack.updateServerInfo=false", "repack", "-ad");
      }
      gitDirectory = git("rev-parse", "--absolute-git-dir");
      commonDirectory = resolve(
        workspace.path,
        git("rev-parse", "--git-common-dir"),
      );
      if (opts.logsDisabled) git("config", "core.logAllRefUpdates", "false");
      if (action === "restore" || opts.dirty) {
        await fs.writeFile(
          join(workspace.path, tracked),
          opts.ident ? "staged $Id$\n" : "staged a\n",
        );
        git("add", "--", tracked);
        await fs.writeFile(join(workspace.path, tracked), "unstaged a\r\n");
      }
      let selected = [tracked];
      if (opts.deletion) {
        await fs.writeFile(
          join(workspace.path, "added.txt"),
          "selected staged new\n",
        );
        git("add", "--", "added.txt");
        selected = ["added.txt"];
      }
      if (opts.missing) await fs.unlink(join(workspace.path, tracked));
      if (opts.mode) {
        await fs.chmod(join(workspace.path, tracked), 0o700);
        git("add", "--", tracked);
        await fs.chmod(join(workspace.path, tracked), 0o600);
      }
      await fs.mkdir(join(workspace.path, "empty"));
      await fs.writeFile(
        join(workspace.path, "untracked.txt"),
        "preserve untracked\n",
      );
      await fs.writeFile(join(workspace.path, ".gitignore"), "ignored.txt\n");
      await fs.writeFile(
        join(workspace.path, "ignored.txt"),
        "preserve ignored\n",
      );
      if (opts.collision)
        await fs.writeFile(
          join(workspace.path, "new.txt"),
          "preserve collision\n",
        );
      if (opts.occupied)
        git("worktree", "add", join(home, "foreign"), "target");
      if (opts.marker)
        await fs.writeFile(
          join(gitDirectory, "MERGE_HEAD"),
          git("rev-parse", "HEAD") + "\n",
        );
      if (opts.foreignLock)
        await fs.writeFile(join(gitDirectory, "index.lock"), "foreign lock\n", {
          flag: "wx",
        });
      if (opts.readonly) {
        await fs.chmod(join(gitDirectory, "index"), 0o400);
        await fs.chmod(join(gitDirectory, "HEAD"), 0o400);
      }
      const canary = join(home, "helper-called"),
        hooks = join(home, "hooks");
      await fs.mkdir(hooks);
      await fs.writeFile(
        join(hooks, "post-checkout"),
        `#!/bin/sh\nprintf called > '${canary}'\n`,
        { mode: 0o700 },
      );
      await fs.writeFile(
        join(hooks, "reference-transaction"),
        `#!/bin/sh\nprintf called > '${canary}'\n`,
        { mode: 0o700 },
      );
      // No later setup Git commands run without explicit safe hook overrides.
      git("config", "core.hooksPath", hooks);
      original = await inventory(workspace.path);
      originalCommon = await inventory(commonDirectory);
      const beforeMetadata = new Map();
      for (const [role, path] of [
        ["index", join(gitDirectory, "index")],
        ["head_ref", join(gitDirectory, "HEAD")],
        ["head_log", join(gitDirectory, "logs/HEAD")],
        [
          "branch_ref",
          join(
            commonDirectory,
            opts.nested ? "refs/heads/nested/new" : "refs/heads/created",
          ),
        ],
        [
          "branch_log",
          join(
            commonDirectory,
            "logs",
            opts.nested ? "refs/heads/nested/new" : "refs/heads/created",
          ),
        ],
      ])
        beforeMetadata.set(role, { path, bytes: await optional(path) });
      const observed = value(
        await read({ type: "git.review.read", workspaceId: workspace.id }),
      );
      assert.equal(observed.status, "available", JSON.stringify(observed));
      const previewRequest =
        action === "restore"
          ? {
              type: "git.restore.preview.read",
              workspaceId: workspace.id,
              observationId: observed.observationId,
              source,
              paths: selected,
            }
          : {
              type: "git.branch.preview.read",
              workspaceId: workspace.id,
              observationId: observed.observationId,
              action,
              branch:
                action === "select"
                  ? "refs/heads/target"
                  : opts.nested
                    ? "refs/heads/nested/new"
                    : "refs/heads/created",
              author: { name: "합성 A, B", email: "synthetic@example.invalid" },
            };
      const previewResponse = await read(previewRequest);
      if (opts.protectedPath) {
        assert.equal(
          previewResponse.ok,
          false,
          JSON.stringify(previewResponse),
        );
        assert.equal(previewResponse.code, "INVALID_REQUEST");
        assert.equal(effects, 0);
        assert.deepEqual(await inventory(workspace.path), original);
        observations.push({
          name,
          status: "pass",
          refusal: previewResponse.code,
          closedRequestRefusal: true,
          originalFullInventoryUnchanged: true,
        });
        return;
      }
      preview = value(previewResponse);
      if (opts.marker || opts.occupied || opts.dirty || opts.collision) {
        assert.equal(preview.status, "unavailable", JSON.stringify(preview));
        assert.equal(effects, 0);
        assert.deepEqual(await inventory(workspace.path), original);
        observations.push({
          name,
          status: "pass",
          refusal: preview.reason,
          originalFullInventoryUnchanged: true,
        });
        return;
      }
      assert.equal(preview.status, "available", JSON.stringify(preview));
      assert.deepEqual(await inventory(workspace.path), original);
      if (opts.logsDisabled)
        assert.ok(!preview.metadata.some((m) => m.role === "branch_log"));
      if (opts.lateMarker)
        await fs.writeFile(
          join(gitDirectory, "REVERT_HEAD"),
          preview.headOid + "\n",
        );
      const op = {
        type: action === "restore" ? "git.restore.apply" : "git.branch.apply",
        workspaceId: workspace.id,
        requestId: name,
        previewId: preview.previewId,
        ...Object.fromEntries(
          GIT_BRANCH_RESTORE_TARGET_FIELDS.map((k) => [k, preview[k]]),
        ),
      };
      const envelope = {
        version: 2,
        runtimeEpoch: "synthetic",
        operationId: name,
        expectedRevision: preview.revision,
        operation: op,
      };
      const response = await service.handle(envelope, "synthetic-sender");
      assert.equal(adapterError, undefined, adapterError?.message);
      receipt = response.receipt;
      if (opts.deny || opts.lateMarker) {
        assert.equal(response.ok, false, JSON.stringify(response));
        assert.equal(response.code, opts.deny ? "CANCELLED" : "FILE_CHANGED");
        assert.equal(receipt.effect, "none");
        assert.equal(effects, 0);
      } else {
        const applied = value(response);
        if (opts.foreignLock || opts.unknown || opts.partial) {
          assert.equal(applied.status, "unknown", JSON.stringify(response));
          assert.equal(receipt.effect, "unknown");
          if (!opts.partial) assert.equal(published, 0);
        } else {
          assert.equal(applied.status, "applied", JSON.stringify(response));
          assert.equal(receipt.effect, "confirmed");
          assert.equal(prepared, 1);
          assert.equal(published, 1);
          assert.deepEqual(
            applied.backups,
            gitBranchRestoreExpectedBackups(
              gitBranchRestoreTargetFromApply(op),
              "synthetic",
              name,
            ),
          );
          assert.equal(receipt.result.digest, operation.digest);
          for (const path of preview.paths) {
            const bytes = await optional(join(workspace.path, path.path));
            if (path.after === null) assert.equal(bytes, null);
            else {
              assert.equal(hash(bytes), path.after.digest);
              assert.equal(bytes.length, path.after.bytes);
              assert.equal(
                (await fs.stat(join(workspace.path, path.path))).mode & 0o777,
                path.after.mode,
              );
            }
          }
          for (const meta of preview.metadata) {
            const prior = beforeMetadata.get(meta.role),
              bytes = await fs.readFile(prior.path);
            assert.equal(hash(bytes), meta.after.digest);
            assert.equal(bytes.length, meta.after.bytes);
            if (meta.role.endsWith("_log")) {
              const ident = `합성 A, B <synthetic@example.invalid> ${preview.timestamp} +0000`,
                old =
                  action === "create"
                    ? "0".repeat(format === "sha1" ? 40 : 64)
                    : preview.headOid,
                reason =
                  action === "create"
                    ? "branch: Created from HEAD"
                    : `checkout: moving from ${preview.currentBranch?.slice(11) ?? preview.headOid} to target`;
              assert.deepEqual(
                bytes,
                Buffer.concat([
                  prior.bytes ?? Buffer.alloc(0),
                  Buffer.from(
                    `${old} ${preview.nextHeadOid} ${ident}\t${reason}\n`,
                  ),
                ]),
              );
            }
          }
          for (const backup of applied.backups) {
            if (backup.backupId === null) continue;
            const prior =
              backup.role === "worktree"
                ? await fs.readFile(join(gitDirectory, backup.backupId))
                : await fs.readFile(
                    join(
                      backup.role.startsWith("branch")
                        ? commonDirectory
                        : gitDirectory,
                      backup.backupId,
                    ),
                  );
            const expected =
              backup.role === "worktree" ? original[backup.path] : null;
            if (expected) assert.equal(hash(prior), expected.digest);
            else assert.deepEqual(prior, beforeMetadata.get(backup.role).bytes);
          }
        }
      }
      const after = await inventory(workspace.path),
        changed = new Set(preview.paths.map((p) => p.path));
      for (const [path, stat] of Object.entries(original)) {
        if (
          path === ".git" ||
          path.startsWith(".git/") ||
          changed.has(path) ||
          path.endsWith("/")
        )
          continue;
        assert.deepEqual(after[path], stat, `Unchanged original ${path}`);
      }
      const changedMetadata = new Set(
        preview.metadata.map((m) =>
          relative(commonDirectory, beforeMetadata.get(m.role).path),
        ),
      );
      const afterCommon = await inventory(commonDirectory);
      for (const [path, stat] of Object.entries(originalCommon)) {
        if (path.endsWith("/") || changedMetadata.has(path)) continue;
        assert.deepEqual(
          afterCommon[path],
          stat,
          `Unchanged common metadata ${path}`,
        );
      }
      if (action === "restore" || action === "create") {
        assert.deepEqual(
          await fs.readFile(join(gitDirectory, "index")),
          beforeMetadata.get("index").bytes,
        );
        assert.deepEqual(
          await fs.readFile(join(gitDirectory, "HEAD")),
          beforeMetadata.get("head_ref").bytes,
        );
      }
      if (opts.partial) {
        assert.equal(
          hash(await fs.readFile(join(workspace.path, preview.paths[0].path))),
          preview.paths[0].after.digest,
        );
        assert.deepEqual(
          await fs.readFile(join(gitDirectory, "HEAD")),
          beforeMetadata.get("head_ref").bytes,
        );
      }
      assert.equal(
        await fs.lstat(canary).then(
          () => true,
          () => false,
        ),
        false,
      );
      const count = effects;
      await service.handle(envelope, "synthetic-sender");
      assert.equal(effects, count);
      const conflict = await service.handle(
        { ...envelope, operation: { ...op, previewDigest: "f".repeat(64) } },
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
        action,
        source: preview.source,
        outcome: response.ok ? response.value.status : response.code,
        prepared,
        published,
        exactUnaffectedFileInventory: true,
        helpersNotInvoked: true,
        backups:
          receipt.result?.backups?.map((b) => ({
            role: b.role,
            present: b.backupId !== null,
          })) ?? [],
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
        directory: privateRoot,
        documentsPath,
        storeId: name,
        runtimeEpoch: "reopened",
      });
      try {
        assert.equal(
          reopened.lookup({ runtimeEpoch: "synthetic", operationId: name })
            .receipt.effect,
          receipt.effect,
        );
        if (receipt.effect === "unknown")
          assert.ok(
            reopened
              .readView()
              .retainedOperations.some(
                (o) => o.runtimeEpoch === "synthetic" && o.operationId === name,
              ),
          );
      } finally {
        await reopened.close();
      }
    }
  }
  try {
    for (const [name, options] of MATRIX) await run(name, options);
    assert.equal(observations.length, MATRIX.length);
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
        script: "git-branch-restore",
        mode: "dev",
        platform: "darwin",
      }),
      engine: await executableIdentity(descriptor.enginePath),
      manifest: await resourceFileSha256(descriptor.manifestPath),
      git: await executableIdentity(executable),
      assets: Object.fromEntries(
        await Promise.all(
          EVENT_HOST_CODE_ASSETS.map(async (path) => {
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
    const container = await fs.mkdtemp(
      "/private/tmp/omoc-branch-restore-probe-",
    );
    await fs.chmod(container, 0o700);
    await fs.writeFile(
      join(container, ".owned-branch-restore-probe"),
      "synthetic only\n",
      { flag: "wx", mode: 0o600 },
    );
    const root = join(container, "synthetic");
    await fs.mkdir(root, { mode: 0o700 });
    report.retainedContainer = container;
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
    assert.equal(report.matrix.observations.length, MATRIX.length);
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
