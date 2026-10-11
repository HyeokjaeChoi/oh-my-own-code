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
  GIT_INDEX_ASSETS,
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
    join(repository, "docs/runs/git-index-mutations/evidence"),
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
  await fs.writeFile(join(path, ".owned-index-probe"), "synthetic only\n", {
    flag: "wx",
    mode: 0o600,
  });
  return path;
}
async function child(root, kernelPath) {
  assert.equal(globalThis.Bun?.version, "1.4.2");
  assert.equal(
    await fs.readFile(join(dirname(root), ".owned-index-probe"), "utf8"),
    "synthetic only\n",
  );
  const { createGitIndexKernel } = await import(pathToFileURL(kernelPath).href);
  const { createWorkbenchService } = await import(
    "../src/workbench-service.mjs"
  );
  const { openWorkspaceRegistry } = await import(
    "../src/host/workspace-registry.mjs"
  );
  const { BASELINE_POLICY } = await import("../src/workbench-contract.mjs");
  const { GIT_INDEX_TARGET_FIELDS } = await import(
    "../src/renderer/shared/git-index/index.mjs"
  );
  const { gitIndexBackupId } = await import(
    "../src/host/git-index-contract.mjs"
  );
  const { validateHostMessage } = await import(
    "../src/event-host-protocol.mjs"
  );
  const observations = [],
    kernelEvents = [];
  const nonce = "a".repeat(64);
  const value = (r) => {
    assert.equal(r.ok, true, JSON.stringify(r));
    return r.value;
  };
  async function run(
    name,
    {
      format = "sha1",
      action = "stage",
      absent = false,
      unborn = false,
      change = "modified",
      lock = false,
      unknown = false,
      normalized = false,
      fileModeFalse = false,
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
    const kernel = await createGitIndexKernel();
    let effects = 0,
      prepared = 0,
      published = 0,
      operation;
    const adapter = {};
    for (const method of ["prepare", "publish", "abort"])
      adapter[method] = async (input) => {
        const type = `git-index-${method}`;
        const message = {
          type,
          nonce,
          requestId: nonce,
          ...(method === "prepare"
            ? { operation: input }
            : { token: input.token }),
        };
        assert.equal(validateHostMessage(message, "child"), message);
        effects++;
        if (method === "prepare") {
          prepared++;
          operation = input;
          const journal = await fs.readFile(
            join(home, "private/journal.jsonl"),
            "utf8",
          );
          assert.ok(journal.includes("filesystem.git.index.stage"));
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
          const journal = await fs.readFile(
            join(home, "private/journal.jsonl"),
            "utf8",
          );
          assert.ok(
            journal.indexOf("filesystem.git.index.stage") <
              journal.indexOf("filesystem.git.index.publish"),
          );
        }
        const result = await kernel[method](input);
        kernelEvents.push({ name, method, result });
        const response = {
          type: "git-index-result",
          nonce,
          pid: process.pid,
          requestId: nonce,
          result,
        };
        assert.equal(validateHostMessage(response, "parent"), response);
        return result;
      };
    const records = new Map();
    const client = {
      session: {
        create: async (input) => {
          const v = { ...input, permissions: BASELINE_POLICY };
          records.set(v.id, v);
          return v;
        },
        get: async ({ sessionID }) => records.get(sessionID),
        update: async ({ sessionID, ...update }) => {
          const v = { ...records.get(sessionID), ...update };
          records.set(sessionID, v);
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
      workbenchContext: () => ({ client, gitIndex: adapter }),
      workspace: home,
    };
    const service = createWorkbenchService({
      registry,
      runtime,
      runtimeEpoch: "synthetic",
      bootstrap: true,
      confirmTrust: async () => true,
      confirmGitIndex: async () => true,
      deadlineMs: 10000,
    });
    let readId = 0;
    const read = (op) =>
      service.handle(
        {
          version: 2,
          runtimeEpoch: "synthetic",
          readId: `r-${++readId}`,
          operation: op,
        },
        "synthetic-sender",
      );
    let workspace, originalIndex, applied;
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
        GIT_AUTHOR_NAME: "Synthetic",
        GIT_AUTHOR_EMAIL: "synthetic@example.invalid",
        GIT_COMMITTER_NAME: "Synthetic",
        GIT_COMMITTER_EMAIL: "synthetic@example.invalid",
        LC_ALL: "C",
      };
      const git = (...args) => {
        const r = spawnSync(executable, args, {
          cwd: workspace.path,
          env,
          encoding: "utf8",
        });
        assert.equal(r.status, 0, `Synthetic Git command failed: ${args[0]}`);
        return r.stdout.trim();
      };
      git("init", "-b", "main", `--object-format=${format}`);
      if (fileModeFalse) git("config", "core.filemode", "false");
      if (normalized)
        await fs.writeFile(
          join(workspace.path, ".gitattributes"),
          "a.txt text eol=lf\n",
        );
      await fs.writeFile(join(workspace.path, "a.txt"), "head\n");
      await fs.writeFile(join(workspace.path, "b.txt"), "nonselected\n");
      if (!absent) {
        git("add", "--", "a.txt", "b.txt");
        if (normalized) git("add", "--", ".gitattributes");
        if (!unborn) git("commit", "-m", "synthetic");
      }
      if (action === "unstage") {
        await fs.writeFile(join(workspace.path, "a.txt"), "staged\n");
        git("add", "--", "a.txt");
      }
      if (change === "deleted") await fs.unlink(join(workspace.path, "a.txt"));
      else await fs.writeFile(join(workspace.path, "a.txt"), "current\r\n");
      if (fileModeFalse) await fs.chmod(join(workspace.path, "a.txt"), 0o755);
      const indexPath = join(workspace.path, ".git/index"),
        head = await fs.readFile(join(workspace.path, ".git/HEAD")),
        config = await fs.readFile(join(workspace.path, ".git/config"));
      originalIndex = await fs.readFile(indexPath).catch((error) => {
        if (error.code !== "ENOENT") throw error;
        return null;
      });
      const worktree = await fs
        .readFile(join(workspace.path, "a.txt"))
        .catch((error) => {
          if (error.code !== "ENOENT") throw error;
          return null;
        });
      if (lock)
        await fs.writeFile(
          join(workspace.path, ".git/index.lock"),
          "foreign lock\n",
          { flag: "wx" },
        );
      const nonselected = git("ls-files", "--stage", "--", "b.txt");
      const reviewed = value(
        await read({ type: "git.review.read", workspaceId: workspace.id }),
      );
      assert.equal(reviewed.status, "available", JSON.stringify(reviewed));
      const preview = value(
        await read({
          type: "git.index.preview.read",
          workspaceId: workspace.id,
          observationId: reviewed.observationId,
          action,
          paths: ["a.txt"],
        }),
      );
      assert.equal(preview.status, "available", JSON.stringify(preview));
      assert.equal(preview.indexExists, originalIndex !== null);
      const op = {
        type: "git.index.apply",
        workspaceId: workspace.id,
        requestId: name,
        previewId: preview.previewId,
        ...Object.fromEntries(
          GIT_INDEX_TARGET_FIELDS.map((key) => [key, preview[key]]),
        ),
      };
      const request = {
        version: 2,
        runtimeEpoch: "synthetic",
        operationId: name,
        expectedRevision: preview.revision,
        operation: op,
      };
      const result = await service.handle(request, "synthetic-sender");
      applied = value(result);
      if (lock || unknown) {
        assert.equal(applied.status, "unknown", JSON.stringify(result));
        assert.equal(result.receipt.effect, "unknown");
        assert.equal(published, 0);
        assert.deepEqual(await fs.readFile(indexPath), originalIndex);
        if (lock)
          assert.equal(
            await fs.readFile(join(workspace.path, ".git/index.lock"), "utf8"),
            "foreign lock\n",
          );
      } else {
        assert.equal(applied.status, "applied", JSON.stringify(result));
        assert.equal(prepared, 1);
        assert.equal(published, 1);
        assert.equal(
          hash(await fs.readFile(indexPath)),
          preview.nextIndexDigest,
        );
        const backup = originalIndex
          ? gitIndexBackupId("synthetic", name)
          : null;
        assert.equal(applied.backupId, backup);
        if (backup)
          assert.deepEqual(
            await fs.readFile(join(workspace.path, ".git", backup)),
            originalIndex,
          );
        assert.equal(result.receipt.effect, "confirmed");
        assert.equal(
          result.receipt.result.indexDigest,
          preview.nextIndexDigest,
        );
        assert.equal(result.receipt.result.digest, operation.digest);
        const entries = git("ls-files", "--stage").split("\n");
        const row = entries.find((x) => x.endsWith("\ta.txt"));
        if (preview.entries[0].after === null) assert.equal(row, undefined);
        else assert.ok(row.includes(preview.entries[0].after.oid));
        if (normalized) {
          const body = Buffer.from("current\n");
          const expected = createHash(format)
            .update(Buffer.from(`blob ${body.length}\0`))
            .update(body)
            .digest("hex");
          assert.equal(preview.entries[0].after.oid, expected);
        }
        if (fileModeFalse) assert.ok(row.startsWith("100644 "));
        assert.equal(git("ls-files", "--stage", "--", "b.txt"), nonselected);
      }
      assert.deepEqual(
        await fs.readFile(join(workspace.path, ".git/HEAD")),
        head,
      );
      assert.deepEqual(
        await fs.readFile(join(workspace.path, ".git/config")),
        config,
      );
      assert.deepEqual(
        await fs.readFile(join(workspace.path, "a.txt")).catch((error) => {
          if (error.code !== "ENOENT") throw error;
          return null;
        }),
        worktree,
      );
      assert.equal(
        await fs.readFile(join(workspace.path, "b.txt"), "utf8"),
        "nonselected\n",
      );
      const count = effects;
      await service.handle(request, "synthetic-sender");
      assert.equal(effects, count);
      const lookup = value(
        await read({
          type: "operation.lookup",
          runtimeEpoch: "synthetic",
          operationId: name,
        }),
      );
      assert.equal(lookup.receipt.effect, result.receipt.effect);
      observations.push({
        name,
        status: "pass",
        format,
        action,
        indexExists: originalIndex !== null,
        result: applied.status,
        prepared,
        published,
        backupId: applied.backupId ?? null,
      });
    } finally {
      service.close();
      await service.drain();
      await kernel.close();
      if (applied) await registry.checkpoint();
      await registry.close();
    }
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
      assert.equal(
        record.receipt.effect,
        applied.status === "applied" ? "confirmed" : "unknown",
      );
    } finally {
      await reopened.close();
    }
  }
  const report = {
    result: "fail",
    observations,
    kernelEvents,
    limits: [
      "Synthetic Native SDK and direct kernel adapter; actual production protocol validators, not an Event Host process lifetime proof.",
      "No production Main, provider, private project, Windows or power-loss acceptance.",
      "All synthetic namespaces retained. Unknowns are lookup-only, never replayed.",
    ],
  };
  try {
    for (const format of ["sha1", "sha256"]) {
      await run(`${format}-stage`, { format });
      await run(`${format}-unstage`, { format, action: "unstage" });
      await run(`${format}-deleted`, { format, change: "deleted" });
      await run(`${format}-absent-unborn`, {
        format,
        absent: true,
        unborn: true,
      });
      await run(`${format}-existing-unborn`, { format, unborn: true });
    }
    await run("builtin-normalization", { normalized: true });
    await run("filemode-disabled", { fileModeFalse: true });
    await run("foreign-lock", { lock: true });
    await run("unknown-no-replay", { unknown: true });
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
        script: "git-index",
        mode: "dev",
        platform: "darwin",
      }),
      engine: await executableIdentity(descriptor.enginePath),
      manifest: await resourceFileSha256(descriptor.manifestPath),
      git: await executableIdentity(executable),
      assets: Object.fromEntries(
        await Promise.all(
          GIT_INDEX_ASSETS.map(async (path) => {
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
        join(descriptor.root, "host/git-index-kernel.mjs"),
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
        timeout: 90000,
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
    assert.equal(report.matrix.observations.length, 14);
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
