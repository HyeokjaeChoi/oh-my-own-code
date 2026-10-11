// Contained production-module filesystem proof. No Native/server/provider start.
import assert from "node:assert/strict";
import { captureProvenance } from "./build-provenance.mjs";
import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  eventHostForResources,
  CONFIGURATION_SAVE_ASSETS,
  verifyEventHostResources,
  resourceFileSha256,
} from "../src/event-host-resources.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function sourceIdentity() {
  const files = {};
  async function walk(path) {
    const entries = await fs.readdir(path, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(path, entry.name);
      if (entry.isDirectory()) await walk(p);
      else if (entry.isFile() && /\.(?:mjs|ts|tsx|css|py)$/u.test(p))
        files[relative(repository, p)] = hash(await fs.readFile(p));
    }
  }
  await walk(join(repository, "apps/desktop-app/src"));
  await walk(join(repository, "apps/desktop-app/scripts"));
  return files;
}
async function claim(out) {
  const base = join(repository, "docs/runs/workspace-file-editing/evidence");
  const path = resolve(repository, out),
    rel = relative(base, path);
  assert.ok(
    rel && rel !== ".." && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep),
  );
  let cursor = repository;
  for (const part of relative(repository, path).split(sep)) {
    cursor = join(cursor, part);
    try {
      await fs.mkdir(cursor, { mode: 0o700 });
    } catch (e) {
      if (cursor === path || e.code !== "EEXIST") throw e;
    }
    const stat = await fs.lstat(cursor);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
    assert.equal(await fs.realpath(cursor), cursor);
  }
  await fs.writeFile(join(path, ".owned-file-probe"), "synthetic only\n", {
    flag: "wx",
    mode: 0o600,
  });
  return path;
}
async function child(root, resourcesRoot) {
  assert.equal(globalThis.Bun?.version, "1.4.2");
  assert.notEqual(
    process.getuid?.(),
    0,
    "Readonly permission proof requires non-root user",
  );
  assert.equal(
    await fs.readFile(join(dirname(root), ".owned-file-probe"), "utf8"),
    "synthetic only\n",
  );
  const { createConfigurationSaveKernel } = await import(
    pathToFileURL(join(resourcesRoot, "host/configuration-save-kernel.mjs"))
      .href
  );
  const { validateHostMessage } = await import(
    pathToFileURL(join(resourcesRoot, "event-host-protocol.mjs")).href
  );
  const { readWorkspaceFile } = await import(
    "../src/host/workbench-file-edit.mjs"
  );
  const observations = [];
  const nonce = "a".repeat(64);
  const request = (o, text, operationId) => ({
    runtimeEpoch: "synthetic",
    operationId,
    workspaceId: o.workspaceId,
    workspacePath: o.workspacePath,
    kind: "file",
    path: o.path,
    text,
    expectation: "version",
    version: o.version,
    directoryVersion: o.directoryVersion,
  });
  async function run(name, body) {
    const path = join(root, name);
    await fs.mkdir(join(path, "src/nested"), { recursive: true });
    const workspace = { id: name, path },
      parent = join(path, "src/nested"),
      target = join(parent, "ordinary.txt");
    await fs.writeFile(target, "\uFEFFOriginal\r\n", { mode: 0o640 });
    const kernel = await createConfigurationSaveKernel();
    try {
      await body({ workspace, parent, target, kernel });
      observations.push({ name, status: "pass" });
    } finally {
      kernel.close();
    }
  }
  const stage = (kernel, op) => {
    const message = {
      type: "configuration-prepare",
      nonce,
      requestId: nonce,
      operation: op,
    };
    assert.equal(validateHostMessage(message, "child"), message);
    return kernel.prepare(op);
  };
  await run(
    "exact-bytes-mode-backup-ipc",
    async ({ workspace, parent, target, kernel }) => {
      const read = await readWorkspaceFile(
        workspace,
        "src/nested/ordinary.txt",
      );
      assert.equal(read.content, "\uFEFFOriginal\r\n");
      const text = "\uFEFFChanged\r\n한글\n",
        staged = stage(kernel, request(read, text, "exact"));
      assert.equal(staged.status, "staged", JSON.stringify(staged));
      const saved = kernel.publish({ token: staged.token });
      assert.equal(saved.status, "saved", JSON.stringify(saved));
      const message = {
        type: "configuration-result",
        nonce,
        pid: process.pid,
        requestId: nonce,
        result: saved,
      };
      assert.equal(validateHostMessage(message, "parent"), message);
      assert.match(saved.backupId, /\.file\.backup$/u);
      const final = await readWorkspaceFile(workspace, read.path);
      assert.equal(final.content, text);
      assert.equal(final.version, saved.version);
      assert.equal(final.directoryVersion, read.directoryVersion);
      assert.equal((await fs.stat(target)).mode & 0o777, 0o640);
      assert.equal(
        await fs.readFile(join(parent, saved.backupId), "utf8"),
        read.content,
      );
    },
  );
  for (const [name, text] of [
    ["maximum-escaped-64KiB", '"\\\n\t'.repeat(16384)],
    ["blank-existing-file", ""],
  ])
    await run(name, async ({ workspace, target, kernel }) => {
      const read = await readWorkspaceFile(
        workspace,
        "src/nested/ordinary.txt",
      );
      const staged = stage(kernel, request(read, text, name));
      assert.equal(staged.status, "staged", JSON.stringify(staged));
      const saved = kernel.publish({ token: staged.token });
      assert.equal(saved.status, "saved", JSON.stringify(saved));
      assert.equal(await fs.readFile(target, "utf8"), text);
      assert.equal(
        (await readWorkspaceFile(workspace, read.path)).version,
        saved.version,
      );
    });
  await run(
    "replaced-ancestor-before-stage",
    async ({ workspace, parent, kernel }) => {
      const read = await readWorkspaceFile(
        workspace,
        "src/nested/ordinary.txt",
      );
      await fs.rename(parent, parent + "-original");
      await fs.mkdir(parent);
      await fs.writeFile(join(parent, "ordinary.txt"), "External");
      const result = stage(
        kernel,
        request(read, "Must not overwrite", "ancestor"),
      );
      assert.equal(result.status, "unknown");
      assert.equal(
        await fs.readFile(join(parent, "ordinary.txt"), "utf8"),
        "External",
      );
      assert.deepEqual(await fs.readdir(parent), ["ordinary.txt"]);
    },
  );
  await run(
    "staged-ancestor-symlink",
    async ({ workspace, parent, kernel }) => {
      const read = await readWorkspaceFile(
          workspace,
          "src/nested/ordinary.txt",
        ),
        staged = stage(kernel, request(read, "Must not escape", "symlink"));
      assert.equal(staged.status, "staged", JSON.stringify(staged));
      const outside = join(root, "outside-synthetic");
      await fs.mkdir(outside);
      await fs.writeFile(join(outside, "ordinary.txt"), "SYNTHETIC_CANARY");
      await fs.rename(parent, parent + "-original");
      await fs.symlink(outside, parent);
      assert.equal(kernel.publish({ token: staged.token }).status, "unknown");
      assert.equal(
        await fs.readFile(join(outside, "ordinary.txt"), "utf8"),
        "SYNTHETIC_CANARY",
      );
      assert.deepEqual(await fs.readdir(outside), ["ordinary.txt"]);
    },
  );
  for (const scenario of [
    "external-replacement",
    "external-inplace",
    "removed-leaf-no-create",
  ])
    await run(scenario, async ({ workspace, target, kernel }) => {
      const read = await readWorkspaceFile(
          workspace,
          "src/nested/ordinary.txt",
        ),
        staged = stage(kernel, request(read, "Must not overwrite", scenario));
      assert.equal(staged.status, "staged", JSON.stringify(staged));
      if (scenario === "external-replacement") {
        await fs.rename(target, target + ".original");
        await fs.writeFile(target, "External");
      } else if (scenario === "external-inplace")
        await fs.writeFile(target, "External");
      else await fs.unlink(target);
      assert.equal(kernel.publish({ token: staged.token }).status, "unknown");
      if (scenario === "removed-leaf-no-create")
        await assert.rejects(fs.stat(target), { code: "ENOENT" });
      else assert.equal(await fs.readFile(target, "utf8"), "External");
    });
  await run(
    "readonly-source-before-stage",
    async ({ workspace, parent, target, kernel }) => {
      const read = await readWorkspaceFile(
        workspace,
        "src/nested/ordinary.txt",
      );
      await fs.chmod(target, 0o444);
      const current = await readWorkspaceFile(workspace, read.path),
        result = stage(
          kernel,
          request(current, "Must not replace", "readonly"),
        );
      assert.equal(result.status, "unknown");
      assert.equal(result.reason, "path_denied");
      assert.equal(await fs.readFile(target, "utf8"), read.content);
      assert.deepEqual(await fs.readdir(parent), ["ordinary.txt"]);
    },
  );
  await run(
    "explicit-abort-keeps-original",
    async ({ workspace, target, kernel }) => {
      const read = await readWorkspaceFile(
          workspace,
          "src/nested/ordinary.txt",
        ),
        staged = stage(kernel, request(read, "Must not publish", "abort"));
      assert.equal(staged.status, "staged", JSON.stringify(staged));
      kernel.abort({ token: staged.token });
      assert.equal(await fs.readFile(target, "utf8"), read.content);
      assert.notEqual(kernel.publish({ token: staged.token }).status, "saved");
    },
  );
  process.stdout.write(
    JSON.stringify({
      result: "pass",
      bunVersion: globalThis.Bun.version,
      observations,
    }) + "\n",
  );
}
async function main(args) {
  assert.deepEqual(args.length, 2);
  assert.equal(args[0], "--out");
  assert.equal(process.platform, "darwin");
  assert.equal(process.arch, "arm64");
  const out = await claim(args[1]);
  let report = {
    status: "failed",
    scope:
      "synthetic source reader and exact current staged production kernel publication; no Native activation/provider/production Main",
    namespace: out,
  };
  try {
    const descriptor = eventHostForResources(
      join(repository, "apps/desktop-app/dist/resources"),
      "darwin",
      "arm64",
    );
    await verifyEventHostResources(descriptor);
    const stagedAssets = {};
    for (const path of CONFIGURATION_SAVE_ASSETS) {
      const source = await resourceFileSha256(
        join(repository, "apps/desktop-app/src", path),
      );
      const staged = await resourceFileSha256(join(descriptor.root, path));
      assert.equal(staged, source, `Staged source mismatch: ${path}`);
      stagedAssets[path] = staged;
    }
    const before = {
      source: await sourceIdentity(),
      build: await captureProvenance(repository, {
        script: "smoke",
        mode: "dev",
        platform: "darwin",
      }),
      engineSha256: await resourceFileSha256(descriptor.enginePath),
      manifestSha256: await resourceFileSha256(descriptor.manifestPath),
      stagedAssets,
    };
    const root = await fs.mkdtemp(join(out, "synthetic-"));
    await fs.mkdir(join(root, "home"));
    await fs.mkdir(join(root, "tmp"));
    const result = spawnSync(
      descriptor.enginePath,
      [fileURLToPath(import.meta.url), "--child", root, descriptor.root],
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
        timeout: 60000,
        maxBuffer: 65536,
      },
    );
    report = {
      ...report,
      before,
      exit: {
        pid: result.pid,
        status: result.status,
        signal: result.signal,
        error: result.error?.code,
      },
      stdout: result.stdout,
      stderr: result.stderr,
      retainedNamespace: root,
    };
    const after = {
      source: await sourceIdentity(),
      build: await captureProvenance(repository, {
        script: "smoke",
        mode: "dev",
        platform: "darwin",
      }),
      engineSha256: await resourceFileSha256(descriptor.enginePath),
      manifestSha256: await resourceFileSha256(descriptor.manifestPath),
      stagedAssets: Object.fromEntries(
        await Promise.all(
          CONFIGURATION_SAVE_ASSETS.map(async (path) => [
            path,
            await resourceFileSha256(join(descriptor.root, path)),
          ]),
        ),
      ),
    };
    report.after = after;
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0);
    assert.deepEqual(after, before);
    const evidence = JSON.parse(result.stdout);
    assert.equal(evidence.result, "pass");
    assert.equal(evidence.observations.length, 10);
    report = { ...report, status: "pass", evidence };
  } catch (error) {
    report.failure = {
      name: error.name,
      code: error.code ?? null,
      message: String(error.message).slice(0, 2048),
    };
    throw error;
  } finally {
    await fs.writeFile(
      join(out, "publication-evidence.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  }
}
if (process.argv[2] === "--child")
  await child(process.argv[3], process.argv[4]);
else await main(process.argv.slice(2));
