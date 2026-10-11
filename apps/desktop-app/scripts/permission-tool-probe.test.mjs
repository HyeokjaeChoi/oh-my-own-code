import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  claimPermissionOutput,
  permissionEnvironment,
  runPermissionChild,
} from "./permission-tool-probe.mjs";

test("permission probe refuses escaped, reused and symbolic output namespaces", async () => {
  const root = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "permission-node-")),
  );
  await assert.rejects(claimPermissionOutput(root, "../outside"));
  await assert.rejects(
    claimPermissionOutput(
      root,
      "docs/runs/permission-tool-boundary-probe/evidence/other",
    ),
  );
  const out = "docs/runs/permission-tool-boundary-probe/evidence/native-r1";
  const target = await claimPermissionOutput(root, out);
  assert.equal(target, join(root, out));
  await assert.rejects(claimPermissionOutput(root, out));
  await fs.symlink(
    root,
    join(root, "docs/runs/permission-tool-boundary-probe/evidence/native-r2"),
  );
  await assert.rejects(claimPermissionOutput(root, out.replace("r1", "r2")));
});
test("permission child environment never inherits provider or real HOME", () => {
  const env = permissionEnvironment("/synthetic/owned");
  assert.equal(env.HOME, "/synthetic/owned/home");
  assert.equal(env.PATH, "/usr/bin:/bin");
  assert.equal(env.OPENCODE_CONFIG_DIR, "/synthetic/owned/config/opencode");
  assert.ok(!Object.hasOwn(env, "OPENAI_API_KEY"));
  assert.ok(!Object.hasOwn(env, "ANTHROPIC_API_KEY"));
});
test("owned Node child protocol and actual normal exit settle without raw output", async () => {
  const root = await fs.mkdtemp(join(tmpdir(), "permission-node-child-"));
  const script = join(root, "child.mjs");
  await fs.writeFile(
    script,
    'import {writeFileSync} from "node:fs";writeFileSync(3,JSON.stringify({result:"pass"}));console.error("not exported");',
  );
  const result = await runPermissionChild(process.execPath, script, [], {
    cwd: root,
    env: permissionEnvironment(root),
    timeoutMs: 1000,
  });
  assert.equal(result.code, 0);
  assert.equal(result.exited, true);
  assert.deepEqual(result.report, { result: "pass" });
  assert.deepEqual(result.signals, []);
  assert.ok(!Object.hasOwn(result, "stderr"));
});
test("owned hung Node child records timeout and actual exit", async () => {
  const root = await fs.mkdtemp(join(tmpdir(), "permission-node-timeout-"));
  const script = join(root, "child.mjs");
  await fs.writeFile(script, "setInterval(()=>{},1000);");
  const result = await runPermissionChild(process.execPath, script, [], {
    cwd: root,
    env: permissionEnvironment(root),
    timeoutMs: 50,
  });
  assert.equal(result.timedOut, true);
  assert.equal(result.exited, true);
  assert.equal(result.signal, "SIGTERM");
  assert.deepEqual(result.signals, ["SIGTERM"]);
});
test("missing executable records failure without claiming a process exited", async () => {
  const root = await fs.mkdtemp(join(tmpdir(), "permission-node-missing-"));
  const result = await runPermissionChild(join(root, "absent"), "unused", [], {
    cwd: root,
    env: permissionEnvironment(root),
    timeoutMs: 1000,
  });
  assert.equal(result.spawnFailed, true);
  assert.equal(result.exited, false);
  assert.equal(result.pid, null);
});
test("oversized child protocol is bounded and terminated", async () => {
  const root = await fs.mkdtemp(join(tmpdir(), "permission-node-overflow-"));
  const script = join(root, "child.mjs");
  await fs.writeFile(
    script,
    'import {writeFileSync} from "node:fs";writeFileSync(3,Buffer.alloc(70000));setInterval(()=>{},1000);',
  );
  const result = await runPermissionChild(process.execPath, script, [], {
    cwd: root,
    env: permissionEnvironment(root),
    timeoutMs: 1000,
  });
  assert.equal(result.protocolOverflow, true);
  assert.equal(result.exited, true);
  assert.equal(result.report, null);
  assert.deepEqual(result.signals, ["SIGTERM"]);
});
test("owned child that refuses TERM is killed and its actual exit is recorded", async () => {
  const root = await fs.mkdtemp(join(tmpdir(), "permission-node-kill-"));
  const script = join(root, "child.mjs");
  await fs.writeFile(
    script,
    'process.on("SIGTERM",()=>{});setInterval(()=>{},1000);',
  );
  const result = await runPermissionChild(process.execPath, script, [], {
    cwd: root,
    env: permissionEnvironment(root),
    timeoutMs: 300,
  });
  assert.equal(result.timedOut, true);
  assert.equal(result.exited, true);
  assert.equal(result.signal, "SIGKILL");
  assert.deepEqual(result.signals, ["SIGTERM", "SIGKILL"]);
});
