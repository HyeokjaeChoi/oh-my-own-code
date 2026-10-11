// Contained production-module filesystem proof. No Native/server/provider start.
import assert from "node:assert/strict";
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
  const base = join(repository, "docs/runs/configuration-skill-files/evidence");
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
  await fs.writeFile(join(path, ".owned-skill-probe"), "synthetic only\n", {
    flag: "wx",
    mode: 0o600,
  });
  return path;
}
async function child(root, resourcesRoot) {
  assert.equal(globalThis.Bun?.version, "1.4.2");
  assert.equal(
    await fs.readFile(join(dirname(root), ".owned-skill-probe"), "utf8"),
    "synthetic only\n",
  );
  const { createConfigurationSaveKernel } = await import(
    pathToFileURL(join(resourcesRoot, "host/configuration-save-kernel.mjs"))
      .href
  );
  const { readSkillFile, listSkillFiles } = await import(
    "../src/host/workbench-skills.mjs"
  );
  const observations = [];
  async function test(name, body) {
    const path = join(root, name);
    await fs.mkdir(join(path, ".opencode/skills/demo"), { recursive: true });
    const workspace = { id: name, path },
      parent = join(path, ".opencode/skills/demo"),
      target = join(parent, "SKILL.md");
    const kernel = await createConfigurationSaveKernel();
    try {
      await body({ workspace, parent, target, kernel });
      observations.push({ name, status: "pass" });
    } finally {
      kernel.close();
    }
  }
  const request = (o, text, id) => ({
    runtimeEpoch: "synthetic",
    operationId: id,
    workspaceId: o.workspaceId,
    workspacePath: o.workspacePath,
    kind: "skill",
    sourceName: o.sourceName,
    text,
    directoryVersion: o.directoryVersion,
    expectation: o.status === "missing" ? "missing" : "version",
    ...(o.status === "available" ? { version: o.version } : {}),
  });
  await test("unsupported-original-conversion", async ({
    workspace,
    parent,
    target,
    kernel,
  }) => {
    const original = "---\nname: ordinary YAML\n---\n# Original\n";
    await fs.writeFile(target, original);
    const listed = await listSkillFiles(workspace);
    assert.equal(listed.status, "available");
    assert.equal(listed.entries[0].sourceName, "demo");
    const read = await readSkillFile(workspace, "demo");
    assert.equal(read.status, "available");
    assert.equal(read.content, original);
    const text =
      '---\nname: "Supported"\nmetadata:\n  opencode/autoinvoke: false\n---\n# Saved\n';
    const staged = kernel.prepare(request(read, text, "convert"));
    assert.equal(staged.status, "staged", JSON.stringify(staged));
    const saved = kernel.publish({ token: staged.token });
    assert.equal(saved.status, "saved", JSON.stringify(saved));
    const final = await readSkillFile(workspace, "demo");
    assert.equal(final.content, text);
    assert.equal(final.version, saved.version);
    assert.equal(final.directoryVersion, read.directoryVersion);
    assert.equal(
      await fs.readFile(join(parent, saved.backupId), "utf8"),
      original,
    );
  });
  await test("missing-leaf-create", async ({ workspace, target, kernel }) => {
    const read = await readSkillFile(workspace, "demo");
    assert.equal(read.status, "missing");
    const staged = kernel.prepare(request(read, "# New skill\n", "create"));
    assert.equal(staged.status, "staged", JSON.stringify(staged));
    const saved = kernel.publish({ token: staged.token });
    assert.equal(saved.status, "saved", JSON.stringify(saved));
    assert.equal(saved.backupId, undefined);
    assert.equal(
      (await readSkillFile(workspace, "demo")).version,
      saved.version,
    );
    assert.equal(await fs.readFile(target, "utf8"), "# New skill\n");
  });
  await test("missing-ancestor-replaced", async ({
    workspace,
    parent,
    kernel,
  }) => {
    const read = await readSkillFile(workspace, "demo");
    assert.equal(read.status, "missing");
    await fs.rename(parent, parent + "-original");
    await fs.mkdir(parent);
    const result = kernel.prepare(
      request(read, "# Must not save\n", "replacement"),
    );
    assert.equal(result.status, "unknown");
    assert.equal(result.reason, "file_changed");
    assert.deepEqual(await fs.readdir(parent), []);
  });
  await test("staged-ancestor-symlink", async ({
    workspace,
    parent,
    target,
    kernel,
  }) => {
    await fs.writeFile(target, "# Original\n");
    const read = await readSkillFile(workspace, "demo");
    const staged = kernel.prepare(
      request(read, "# Must not escape\n", "symlink"),
    );
    assert.equal(staged.status, "staged", JSON.stringify(staged));
    const outside = join(root, "outside-synthetic");
    await fs.mkdir(outside);
    await fs.writeFile(join(outside, "SKILL.md"), "SYNTHETIC_CANARY");
    await fs.rename(parent, parent + "-original");
    await fs.symlink(outside, parent);
    const result = kernel.publish({ token: staged.token });
    assert.equal(result.status, "unknown");
    assert.equal(
      await fs.readFile(join(outside, "SKILL.md"), "utf8"),
      "SYNTHETIC_CANARY",
    );
    assert.deepEqual(await fs.readdir(outside), ["SKILL.md"]);
  });
  await test("external-file-replacement", async ({
    workspace,
    target,
    kernel,
  }) => {
    await fs.writeFile(target, "# Original\n");
    const read = await readSkillFile(workspace, "demo");
    const staged = kernel.prepare(
      request(read, "# Must not overwrite\n", "external"),
    );
    assert.equal(staged.status, "staged", JSON.stringify(staged));
    await fs.rename(target, target + ".outside-edit");
    await fs.writeFile(target, "# External edit\n");
    assert.equal(kernel.publish({ token: staged.token }).status, "unknown");
    assert.equal(await fs.readFile(target, "utf8"), "# External edit\n");
  });
  await test("parent-required-no-mkdir", async ({
    workspace,
    parent,
    kernel,
  }) => {
    const read = await readSkillFile(workspace, "demo");
    await fs.rmdir(parent);
    const denied = await readSkillFile(workspace, "demo");
    assert.equal(denied.status, "unavailable");
    assert.equal(denied.reason, "path_missing");
    assert.equal(
      kernel.prepare(request(read, "# Must not mkdir\n", "no-mkdir")).status,
      "unknown",
    );
    await assert.rejects(fs.stat(parent), { code: "ENOENT" });
  });
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
    assert.equal(evidence.observations.length, 6);
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
