// Auth-free synthetic Native compatibility proof. Never production Main.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  eventHostForResources,
  verifyEventHostResources,
  resourceFileSha256,
} from "../src/event-host-resources.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const childSource = join(
  repository,
  "apps/desktop-app/scripts/fixtures/permission-tool-native.mjs",
);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const contains = (root, path) => {
  const rel = relative(root, path);
  return (
    !!rel && rel !== ".." && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep)
  );
};
export async function claimPermissionOutput(root, out) {
  assert.equal(await fs.realpath(root), root);
  const base = join(root, "docs/runs/permission-tool-boundary-probe/evidence");
  const target = resolve(root, out);
  assert.ok(contains(base, target));
  assert.match(relative(base, target), /^native-r[1-9][0-9]*$/u);
  let cursor = root;
  for (const part of relative(root, target).split(sep)) {
    cursor = join(cursor, part);
    try {
      await fs.mkdir(cursor, { mode: 0o700 });
    } catch (error) {
      if (cursor === target || error.code !== "EEXIST") throw error;
    }
    const stat = await fs.lstat(cursor);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
    assert.equal(await fs.realpath(cursor), cursor);
  }
  return target;
}
export function permissionEnvironment(root) {
  return {
    PATH: "/usr/bin:/bin",
    HOME: join(root, "home"),
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_DATA_HOME: join(root, "data"),
    XDG_STATE_HOME: join(root, "state"),
    XDG_CACHE_HOME: join(root, "cache"),
    OPENCODE_CONFIG_DIR: join(root, "config/opencode"),
    TMPDIR: join(root, "tmp"),
    TMP: join(root, "tmp"),
    TEMP: join(root, "tmp"),
    LANG: "en_US.UTF-8",
    NO_COLOR: "1",
  };
}
export async function runPermissionChild(engine, script, args, options) {
  const { cwd, env, timeoutMs = 60000 } = options;
  assert.ok(
    Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60000,
  );
  return new Promise((resolveResult) => {
    const child = spawn(engine, [script, ...args], {
      cwd,
      env,
      stdio: ["ignore", "ignore", "ignore", "pipe"],
    });
    const chunks = [];
    let bytes = 0;
    let protocolOverflow = false;
    let timedOut = false;
    let spawnFailed = false;
    const signals = [];
    const signal = (name) => {
      signals.push(name);
      child.kill(name);
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      signal("SIGTERM");
    }, timeoutMs);
    const kill = setTimeout(() => {
      timedOut = true;
      signal("SIGKILL");
    }, timeoutMs + 2000);
    child.stdio[3]?.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes <= 65536) chunks.push(chunk);
      else if (!protocolOverflow) {
        protocolOverflow = true;
        signal("SIGTERM");
      }
    });
    child.once("error", () => {
      spawnFailed = true;
    });
    const settled = (code, exitSignal) => {
      clearTimeout(timeout);
      clearTimeout(kill);
      let report;
      if (!protocolOverflow) {
        try {
          report = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          /* Fixed failure metadata only. */
        }
      }
      resolveResult({
        pid: child.pid ?? null,
        code,
        signal: exitSignal,
        exited: Number.isInteger(child.pid),
        timedOut,
        spawnFailed,
        protocolOverflow,
        signals,
        report: report ?? null,
      });
    };
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      clearTimeout(kill);
      // A descendant holding the pipe cannot prevent owned-parent settlement.
      setTimeout(() => {
        child.stdio[3]?.destroy();
        settled(code, signal);
      }, 20);
    });
    child.once("close", (code, signal) => {
      if (!Number.isInteger(child.pid)) settled(code, signal);
    });
  });
}
async function identity(descriptor) {
  const manifest = await verifyEventHostResources(descriptor, {
    platform: "darwin",
    arch: "arm64",
  });
  const sources = {};
  for (const path of [
    fileURLToPath(import.meta.url),
    childSource,
    join(repository, "apps/desktop-app/src/event-host-resources.mjs"),
  ])
    sources[relative(repository, path)] = await resourceFileSha256(path);
  return {
    manifest: hash(JSON.stringify(manifest)),
    engine: await resourceFileSha256(descriptor.enginePath),
    sources,
  };
}
export async function runPermissionToolProbe(args = process.argv.slice(2)) {
  assert.equal(process.platform, "darwin");
  assert.equal(process.arch, "arm64");
  assert.equal(args.length, 2);
  assert.equal(args[0], "--out");
  const output = await claimPermissionOutput(repository, args[1]);
  const report = {
    schema_version: 1,
    result: "fail",
    phase: "identity",
    cases: [],
    limits: [
      "Pinned Native built-in tool and synthetic namespace only; not provider, production Main, UI or full F09 acceptance.",
      "No OS sandbox or absence of all possible filesystem/network access is claimed.",
      "Namespaces are retained; owned process exit is not descendant enumeration or power-loss evidence.",
    ],
  };
  let failed = false;
  let descriptor;
  try {
    descriptor = eventHostForResources(
      join(repository, "apps/desktop-app/dist/resources"),
      "darwin",
      "arm64",
    );
    report.before = await identity(descriptor);
    report.phase = "namespace";
    const temporaryParent = await fs.realpath(tmpdir());
    const root = await fs.mkdtemp(
      join(temporaryParent, "omoc-permission-tool-"),
    );
    await fs.chmod(root, 0o700);
    report.retainedRoot = root;
    for (const dir of [
      "home",
      "config",
      "config/opencode",
      "data",
      "state",
      "cache",
      "tmp",
      "workspace",
    ])
      await fs.mkdir(join(root, dir), { mode: 0o700, recursive: true });
    await fs.writeFile(
      join(root, ".permission-probe-owned"),
      "synthetic permission probe v1\n",
      { mode: 0o600, flag: "wx" },
    );
    const script = join(root, "native-child.mjs");
    await fs.copyFile(childSource, script, fs.constants.COPYFILE_EXCL);
    await fs.chmod(script, 0o600);
    assert.equal(
      hash(await fs.readFile(script)),
      report.before.sources[relative(repository, childSource)],
    );
    report.phase = "native";
    report.child = await runPermissionChild(
      descriptor.enginePath,
      script,
      [root, descriptor.root],
      {
        cwd: join(root, "workspace"),
        env: permissionEnvironment(root),
      },
    );
    report.cases = report.child.report?.cases ?? [];
    assert.equal(report.child.timedOut, false);
    assert.equal(report.child.spawnFailed, false);
    assert.equal(report.child.protocolOverflow, false);
    assert.equal(report.child.code, 0);
    assert.equal(report.child.signal, null);
    assert.deepEqual(report.child.signals, []);
    assert.equal(report.child.report?.result, "pass");
    assert.deepEqual(
      report.cases.map((x) => [x.name, x.result]),
      [
        ["once", "pass"],
        ["reject", "pass"],
        ["policy_deny", "pass"],
      ],
    );
    report.phase = "recheck";
    report.after = await identity(descriptor);
    assert.deepEqual(report.after, report.before);
    report.result = "pass";
    report.phase = "complete";
  } catch {
    failed = true;
    // Keep raw package errors, file content, stdout and stderr out of evidence.
    report.error = "permission_tool_probe_failed";
  } finally {
    if (report.before && descriptor && !report.after) {
      try {
        report.after = await identity(descriptor);
        report.identityStable =
          JSON.stringify(report.after) === JSON.stringify(report.before);
        if (!report.identityStable) {
          failed = true;
          report.result = "fail";
        }
      } catch {
        failed = true;
        report.result = "fail";
        report.identityStable = false;
      }
    }
    await fs.writeFile(
      join(output, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
      { mode: 0o600, flag: "wx" },
    );
  }
  if (failed) process.exitCode = 1;
  return report;
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
)
  await runPermissionToolProbe();
