import assert from "node:assert/strict";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createWin32ConfigurationSaveKernel } from "./configuration-save-kernel-win32.mjs";
import {
  configurationBackupId,
  configurationFileVersion,
} from "./configuration-file-observation.mjs";
import { readWorkspaceFile } from "./workbench-file-edit.mjs";
import { createWorkspaceRootAuthority } from "./workspace-root-authority.mjs";

let serial = 0;
function workspace(t) {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "omoc-w32save-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function instructions(dir, text = "ORIGINAL") {
  const target = join(dir, "AGENTS.md");
  if (text !== null) fs.writeFileSync(target, text);
  return target;
}
function request(dir, text = "NEW", overrides = {}) {
  const base = {
    runtimeEpoch: "epoch",
    operationId: `op-${++serial}`,
    workspaceId: "ws",
    workspacePath: dir,
    kind: "instructions",
    text,
  };
  const target = join(dir, "AGENTS.md");
  return fs.existsSync(target)
    ? {
        ...base,
        expectation: "version",
        version: configurationFileVersion(
          { ...base, path: target },
          fs.statSync(dir, { bigint: true }),
          fs.statSync(target, { bigint: true }),
          fs.readFileSync(target),
        ),
        ...overrides,
      }
    : { ...base, expectation: "missing", ...overrides };
}
const backupOf = (r) =>
  join(
    r.workspacePath,
    configurationBackupId(r.runtimeEpoch, r.operationId, r.kind),
  );
const kernel = (t, options = {}) => {
  const k = createWin32ConfigurationSaveKernel({
    check: () => {},
    checkRoot: undefined,
    timeoutMs: 2000,
    ...options,
  });
  t.after(() => k.close());
  return k;
};
const names = (dir) => fs.readdirSync(dir).sort();

test("overwrite keeps the original at the backup name and publishes the stage atomically", (t) => {
  const dir = workspace(t);
  const target = instructions(dir);
  const r = request(dir);
  const k = kernel(t);
  const prepared = k.prepare(r);
  assert.equal(prepared.status, "staged", prepared.reason);
  assert.equal(fs.readFileSync(target, "utf8"), "ORIGINAL");
  assert.equal(fs.readFileSync(backupOf(r), "utf8"), "NEW");
  const saved = k.publish({ token: prepared.token });
  assert.equal(saved.status, "saved", saved.reason);
  assert.equal(
    saved.backupId,
    configurationBackupId(r.runtimeEpoch, r.operationId, r.kind),
  );
  assert.equal(fs.readFileSync(target, "utf8"), "NEW");
  assert.equal(fs.readFileSync(backupOf(r), "utf8"), "ORIGINAL");
  assert.deepEqual(names(dir), ["AGENTS.md", saved.backupId].sort());
  assert.equal(fs.statSync(target).nlink, 1);
  assert.equal(fs.statSync(backupOf(r)).nlink, 1);
  // token is single-use
  assert.equal(k.publish({ token: prepared.token }).status, "unknown");
});

test("missing target is published exclusively and the stage name disappears", (t) => {
  const dir = workspace(t);
  const r = request(dir, "FIRST");
  const k = kernel(t);
  const prepared = k.prepare(r);
  assert.equal(prepared.status, "staged", prepared.reason);
  const saved = k.publish({ token: prepared.token });
  assert.equal(saved.status, "saved", saved.reason);
  assert.equal("backupId" in saved, false);
  assert.deepEqual(names(dir), ["AGENTS.md"]);
  assert.equal(fs.readFileSync(join(dir, "AGENTS.md"), "utf8"), "FIRST");
});

test("a target that appears between prepare and publish is never replaced", (t) => {
  const dir = workspace(t);
  const r = request(dir, "FIRST");
  const k = kernel(t);
  const prepared = k.prepare(r);
  fs.writeFileSync(join(dir, "AGENTS.md"), "RACED");
  const result = k.publish({ token: prepared.token });
  assert.deepEqual(result, { status: "unknown", reason: "file_changed" });
  assert.equal(fs.readFileSync(join(dir, "AGENTS.md"), "utf8"), "RACED");
});

test("a modified original between prepare and publish keeps its bytes", (t) => {
  const dir = workspace(t);
  const target = instructions(dir);
  const k = kernel(t);
  const prepared = k.prepare(request(dir));
  fs.appendFileSync(target, "+edit");
  const result = k.publish({ token: prepared.token });
  assert.deepEqual(result, { status: "unknown", reason: "file_changed" });
  assert.equal(fs.readFileSync(target, "utf8"), "ORIGINAL+edit");
});

test("stale version, hard links, symlinks and read-only originals are refused", (t) => {
  const dir = workspace(t);
  const target = instructions(dir);
  const k = kernel(t);
  assert.deepEqual(k.prepare(request(dir, "N", { version: "a".repeat(64) })), {
    status: "unknown",
    reason: "file_changed",
  });
  fs.linkSync(target, join(dir, "twin.md"));
  assert.equal(k.prepare(request(dir)).status, "unknown");
  fs.unlinkSync(join(dir, "twin.md"));
  fs.chmodSync(target, 0o444);
  assert.equal(k.prepare(request(dir)).reason, "unsupported_metadata");
  fs.chmodSync(target, 0o644);
  fs.rmSync(target);
  fs.writeFileSync(join(dir, "real.md"), "OUTSIDE");
  fs.symlinkSync(join(dir, "real.md"), target);
  const refused = k.prepare({
    ...request(dir),
    expectation: "missing",
    version: undefined,
  });
  assert.equal(refused.status, "unknown");
  assert.equal(fs.readFileSync(join(dir, "real.md"), "utf8"), "OUTSIDE");
  assert.deepEqual(
    names(dir).filter((n) => n.startsWith(".omoc")),
    [],
  );
});

test("abort leaves only the stage; busy and closed states are enforced", (t) => {
  const dir = workspace(t);
  instructions(dir);
  const k = kernel(t);
  const r = request(dir);
  const prepared = k.prepare(r);
  assert.equal(k.prepare(request(dir)).reason, "busy");
  assert.deepEqual(k.abort({ token: prepared.token }), { status: "aborted" });
  assert.equal(fs.readFileSync(join(dir, "AGENTS.md"), "utf8"), "ORIGINAL");
  assert.equal(k.abort({ token: prepared.token }).status, "unknown");
  k.close();
  assert.equal(k.prepare(request(dir)).reason, "closed");
});

test("stage collision and malformed requests", (t) => {
  const dir = workspace(t);
  instructions(dir);
  const k = kernel(t);
  const first = request(dir);
  fs.writeFileSync(backupOf(first), "squatter");
  // recompute the version after the squatter changed the directory times
  const r = request(dir, "NEW", { operationId: first.operationId });
  assert.equal(k.prepare(r).reason, "stage_collision");
  assert.equal(fs.readFileSync(backupOf(r), "utf8"), "squatter");
  for (const bad of [
    null,
    {},
    { ...request(dir), extra: 1 },
    { ...request(dir), workspacePath: "relative" },
  ])
    assert.equal(k.prepare(bad).status, "unknown");
});

test("workspace files: nested path, short aliases refused, ancestor symlink refused", async (t) => {
  const dir = workspace(t);
  fs.mkdirSync(join(dir, "src"));
  fs.writeFileSync(join(dir, "src", "a.txt"), "hello\n");
  const owner = await createWorkspaceRootAuthority({ id: "ws", path: dir });
  t.after(() => owner.close());
  const read = await readWorkspaceFile({ id: "ws", path: dir }, "src/a.txt", {
    checkRoot: owner.assertOpened,
  });
  assert.equal(read.status, "available", JSON.stringify(read));
  const file = {
    runtimeEpoch: "epoch",
    operationId: `file-${++serial}`,
    workspaceId: "ws",
    workspacePath: dir,
    kind: "file",
    path: "src/a.txt",
    text: "bye\n",
    expectation: "version",
    version: read.version,
    directoryVersion: read.directoryVersion,
  };
  const k = kernel(t, { checkRoot: owner.assertOpened });
  const prepared = k.prepare(file);
  assert.equal(prepared.status, "staged", prepared.reason);
  const saved = k.publish({ token: prepared.token });
  assert.equal(saved.status, "saved", saved.reason);
  assert.equal(fs.readFileSync(join(dir, "src", "a.txt"), "utf8"), "bye\n");
  assert.equal(
    fs.readFileSync(join(dir, "src", saved.backupId), "utf8"),
    "hello\n",
  );
  const alias = {
    ...file,
    operationId: `file-${++serial}`,
    path: "src/A~1.txt",
  };
  assert.equal(k.prepare(alias).status, "unknown");
  fs.renameSync(join(dir, "src"), join(dir, "real-src"));
  fs.symlinkSync(join(dir, "real-src"), join(dir, "src"));
  const linked = k.prepare({
    ...file,
    operationId: `file-${++serial}`,
    version: saved.version,
  });
  assert.equal(linked.status, "unknown");
});
