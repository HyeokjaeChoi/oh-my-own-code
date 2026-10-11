import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  claimGraphOutput,
  executeGraphProbe,
  sourceIdentity,
} from "./native-permission-graph-probe.mjs";
import {
  permissionEnvironment,
  runPermissionChild,
} from "./permission-tool-probe.mjs";

const names = [
  "overlay_forwarding",
  "fixed_config",
  "fixed_plugin_source",
  "sdk_registration_denied",
  "inert_wellknown",
  "control_boot",
  "permission_held",
  "saved_held",
  "coordinator_held",
  "session_execution_held",
  "lease_component_runtime",
  "session_content_held",
  "session_policy_held",
  "session_inbox_held",
  "session_shell_held",
  "session_misc_held",
  "session_factory_held",
];
const protocol = () => ({
  schema_version: 1,
  result: "pass",
  phase: "complete",
  cases: names.map((name) => ({ name, result: "pass" })),
});
const fresh = async () =>
  fs.mkdtemp(join(await fs.realpath(tmpdir()), "omoc-graph-node-test-"));
const evidence = "docs/runs/native-permission-session-entry-gate/evidence";

test("output claim is contained, canonical and exclusive", async () => {
  const root = await fresh();
  const out = `${evidence}/native-r1`;
  assert.equal(await claimGraphOutput(root, out), join(root, out));
  assert.equal((await fs.stat(join(root, out))).mode & 0o777, 0o700);
  await assert.rejects(claimGraphOutput(root, out));
  for (const bad of [
    "../escape",
    "docs/runs/native-permission-graph-foundation/evidence/native-r1",
    "docs/runs/native-permission-gated-graph/evidence/native-r1",
    "docs/runs/native-permission-coordinator-gate/evidence/native-r1",
    "/tmp/native-r1",
    `${evidence}/native-r01`,
    `${evidence}/native-r1\0`,
    evidence,
    `${evidence}/native-r0`,
    `${evidence}/native-r2/extra`,
    `${evidence}/../evidence/native-r3`,
    `${evidence}/native-r4\\extra`,
  ])
    await assert.rejects(claimGraphOutput(root, bad));
  const linked = await fresh();
  await fs.symlink(root, join(linked, "docs"));
  await assert.rejects(claimGraphOutput(linked, out));
  const fileRoot = await fresh();
  await fs.writeFile(join(fileRoot, "docs"), "file");
  await assert.rejects(claimGraphOutput(fileRoot, out));
});

async function fixture(body, changes = {}) {
  const repository = await fresh();
  const output = await claimGraphOutput(repository, `${evidence}/native-r1`);
  const childSource = join(repository, "child.mjs");
  await fs.writeFile(childSource, body);
  let stagedRoot;
  const calls = [];
  const stable = async () => ({
    digest: "unchanged",
    engine: "node-only-synthetic-engine",
  });
  const report = await executeGraphProbe({
    repository,
    output,
    temporaryParent: repository,
    childSource,
    sourceIdentity: stable,
    originalIdentity: stable,
    stagedIdentity: stable,
    stage: async ({ resources, platform, arch }) => {
      calls.push({ resources, platform, arch });
      stagedRoot = join(resources, "checked");
      await fs.mkdir(stagedRoot);
      return { root: stagedRoot, enginePath: process.execPath };
    },
    runChild: (engine, script, args, options) => {
      assert.equal(engine, process.execPath);
      assert.deepEqual(args, [options.env.HOME.slice(0, -5), stagedRoot]);
      assert.equal(options.cwd, join(args[0], "workspace"));
      assert.deepEqual(options.env, permissionEnvironment(args[0]));
      return runPermissionChild(engine, script, args, {
        ...options,
        timeoutMs: 500,
      });
    },
    ...changes,
  });
  assert.deepEqual(
    JSON.parse(await fs.readFile(join(output, "report.json"))),
    report,
  );
  assert.equal(calls.length, changes.stage ? 0 : 1);
  assert.match(report.retainedRoot, /\/omoc-permission-graph-[A-Za-z0-9]+$/u);
  assert.equal(
    await fs.readFile(
      join(report.retainedRoot, ".permission-graph-probe-owned"),
      "utf8",
    ),
    "synthetic permission graph probe v1\n",
  );
  return report;
}
const send = (value) =>
  `import {writeSync} from 'node:fs'; writeSync(3, ${JSON.stringify(JSON.stringify(value))});`;

test("Node scripted child exercises driver, environment and seventeen-case protocol only", async () => {
  const inherited = process.env.OMOC_GRAPH_TEST_SECRET;
  process.env.OMOC_GRAPH_TEST_SECRET = "PRIVATE_SECRET";
  let report;
  try {
    report = await fixture(`
      import assert from 'node:assert/strict';
      import {join} from 'node:path';
      assert.equal(process.env.OMOC_GRAPH_TEST_SECRET, undefined);
      assert.equal(process.env.NODE_OPTIONS, undefined);
      assert.equal(process.env.BUN_OPTIONS, undefined);
      assert.equal(process.env.HOME, join(process.argv[2], 'home'));
      assert.equal(process.env.TMPDIR, join(process.argv[2], 'tmp'));
      assert.equal(process.cwd(), join(process.argv[2], 'workspace'));
      ${send(protocol())}
    `);
  } finally {
    if (inherited === undefined) delete process.env.OMOC_GRAPH_TEST_SECRET;
    else process.env.OMOC_GRAPH_TEST_SECRET = inherited;
  }
  assert.equal(report.result, "pass");
  assert.equal(report.phase, "complete");
  assert.equal(report.identityStable, true);
  assert.deepEqual(report.cases, protocol().cases);
  assert.equal(report.copiedChild.before, report.copiedChild.after);
});

test("reject malformed, extra, duplicate, incomplete and failing child reports without exporting raw data", async () => {
  const values = [
    null,
    { ...protocol(), schema_version: 2 },
    { result: "pass", phase: "complete", cases: protocol().cases },
    { ...protocol(), result: "unknown" },
    { ...protocol(), cases: null },
    {
      ...protocol(),
      cases: protocol().cases.map((entry, index) =>
        index === 6 ? null : entry,
      ),
    },
    {
      ...protocol(),
      cases: protocol().cases.map((entry, index) =>
        index === 7 ? { ...entry, result: "unknown" } : entry,
      ),
    },
    { ...protocol(), password: "PRIVATE_SECRET" },
    { ...protocol(), phase: "PRIVATE_SECRET" },
    { ...protocol(), cases: protocol().cases.slice(1) },
    { ...protocol(), cases: protocol().cases.slice(0, 5) },
    { ...protocol(), cases: protocol().cases.slice(0, 8) },
    { ...protocol(), cases: protocol().cases.slice(0, 11) },
    { ...protocol(), cases: protocol().cases.slice(0, 16) },
    {
      ...protocol(),
      cases: [...protocol().cases, { name: "extra", result: "pass" }],
    },
    { ...protocol(), cases: [...protocol().cases].reverse() },
    {
      ...protocol(),
      cases: protocol().cases.map((entry, index) =>
        index === 7 ? { ...entry, result: "fail" } : entry,
      ),
    },
    {
      ...protocol(),
      cases: protocol().cases.map((entry, index) =>
        index === 5 ? { ...entry, name: "PRIVATE_SECRET" } : entry,
      ),
    },
    { ...protocol(), phase: "control_boot" },
    {
      ...protocol(),
      cases: names.map(() => ({ name: names[0], result: "pass" })),
    },
    { ...protocol(), result: "fail" },
    {
      ...protocol(),
      cases: protocol().cases.map((x) => ({ ...x, raw: "PRIVATE_SECRET" })),
    },
  ];
  for (const name of names.slice(11)) {
    values.push({
      ...protocol(),
      cases: protocol().cases.filter((entry) => entry.name !== name),
    });
    const reordered = protocol().cases;
    const index = names.indexOf(name);
    [reordered[10], reordered[index]] = [reordered[index], reordered[10]];
    values.push({ ...protocol(), cases: reordered });
    values.push({
      ...protocol(),
      cases: protocol().cases.map((entry) =>
        entry.name === name ? { ...entry, name: names[10] } : entry,
      ),
    });
  }
  for (const name of names.slice(8)) {
    values.push({
      ...protocol(),
      cases: protocol().cases.map((entry) =>
        entry.name === name ? { ...entry, result: "fail" } : entry,
      ),
    });
  }
  for (const value of values) {
    const report = await fixture(send(value));
    assert.equal(report.result, "fail");
    assert.equal(JSON.stringify(report).includes("PRIVATE_SECRET"), false);
    assert.equal(report.identityStable, true);
  }
  const report = await fixture(
    "import {writeSync} from 'node:fs'; writeSync(3,'PRIVATE_SECRET'); console.error('PRIVATE_SECRET');",
  );
  assert.equal(report.result, "fail");
  assert.equal(JSON.stringify(report).includes("PRIVATE_SECRET"), false);
});

test("Node scripted child preserves only the six fixed Session failure phases with seventeen closed slots", async () => {
  for (const phase of names.slice(11)) {
    const value = {
      ...protocol(),
      result: "fail",
      phase,
      cases: names.map((name) => ({ name, result: "fail" })),
    };
    const report = await fixture(send(value) + "process.exit(1);");
    assert.equal(report.result, "fail");
    assert.equal(report.child.code, 1);
    assert.equal(report.child.exited, true);
    assert.deepEqual(report.child.report, value);
    assert.deepEqual(report.cases, value.cases);
    assert.equal(report.identityStable, true);
  }
});

test("actual helper detects exit, signal, timeout, overflow and spawn failures", async () => {
  for (const [body, key] of [
    [send(protocol()) + "process.exit(7);", "code"],
    ["process.kill(process.pid,'SIGTERM');", "signal"],
    ["setInterval(()=>{},1000);", "timedOut"],
    [
      "import {writeSync} from 'node:fs'; writeSync(3,'x'.repeat(70000)); setInterval(()=>{},1000);",
      "protocolOverflow",
    ],
  ]) {
    const report = await fixture(body);
    assert.equal(report.result, "fail");
    assert.ok(report.child[key]);
    assert.equal(report.identityStable, true);
  }
  const report = await fixture("", {
    runChild: (_engine, script, args, options) =>
      runPermissionChild("/missing-graph-test-engine", script, args, options),
  });
  assert.equal(report.result, "fail");
  assert.equal(report.child.spawnFailed, true);
});

test("source, original and staged identities are rechecked on failure and drift", async () => {
  for (const name of ["sourceIdentity", "originalIdentity", "stagedIdentity"]) {
    let reads = 0;
    const report = await fixture(send(protocol()), {
      [name]: async () => ({ digest: String(++reads) }),
    });
    assert.equal(report.result, "fail");
    assert.equal(report.identityStable, false);
    assert.ok(reads >= 2);
  }
  const report = await fixture("", {
    stage: async () => {
      throw new Error("PRIVATE_SECRET");
    },
  });
  assert.equal(report.result, "fail");
  assert.equal(report.phase, "stage");
  assert.equal(report.identityStable, true);
  assert.equal(JSON.stringify(report).includes("PRIVATE_SECRET"), false);
});

test("post-child identity failures and copied-child mutation cannot produce a pass", async () => {
  let reads = 0;
  const failedRead = await fixture(send(protocol()), {
    stagedIdentity: async () => {
      if (++reads === 3) throw new Error("PRIVATE_SECRET");
      return { digest: "unchanged", engine: "node-only-synthetic-engine" };
    },
  });
  assert.equal(failedRead.result, "fail");
  assert.equal(failedRead.identityStable, false);
  assert.equal(failedRead.child.report.result, "pass");
  assert.equal(JSON.stringify(failedRead).includes("PRIVATE_SECRET"), false);
  const changed = await fixture(send(protocol()), {
    runChild: async (engine, script, args, options) => {
      const value = await runPermissionChild(engine, script, args, options);
      await fs.appendFile(script, "\n// synthetic mutation\n");
      return value;
    },
  });
  assert.equal(changed.result, "fail");
  assert.equal(changed.identityStable, false);
  assert.notEqual(changed.copiedChild.before, changed.copiedChild.after);
});

test("actual saved child refuses Node before Native imports and emits all closed failure slots", async () => {
  const { fileURLToPath } = await import("node:url");
  const root = await fresh();
  const child = await runPermissionChild(
    process.execPath,
    fileURLToPath(
      new URL("./fixtures/native-permission-graph-native.mjs", import.meta.url),
    ),
    [root, root],
    { cwd: root, env: permissionEnvironment(root), timeoutMs: 500 },
  );
  assert.equal(child.code, 1);
  assert.equal(child.signal, null);
  assert.equal(child.exited, true);
  assert.deepEqual(Object.keys(child.report).sort(), [
    "cases",
    "phase",
    "result",
    "schema_version",
  ]);
  assert.equal(child.report.phase, "guard");
  assert.equal(child.report.result, "fail");
  assert.deepEqual(
    child.report.cases,
    names.map((name) => ({ name, result: "fail" })),
  );
});

// Read-only hashing does not import the helper, Control, Effect or Native.
test("source closure automatically binds the packaged admission helper and Control dependencies", async () => {
  const { createHash } = await import("node:crypto");
  const { EVENT_HOST_CODE_ASSETS } = await import(
    "../src/event-host-resources.mjs"
  );
  const identity = await sourceIdentity();
  assert.equal(Object.keys(identity.files).length, 50);
  for (const name of EVENT_HOST_CODE_ASSETS) {
    const bytes = await fs.readFile(new URL(`../src/${name}`, import.meta.url));
    assert.equal(
      identity.files[`apps/desktop-app/src/${name}`],
      createHash("sha256").update(bytes).digest("hex"),
    );
  }
  for (const name of [
    "native-permission-overlay-contract.mjs",
    "native-permission-coordinator-admission.mjs",
    "native-permission-control.mjs",
    "native-permission-control-input.mjs",
    "native-permission-leases.mjs",
    "native-permission-origin-scopes.mjs",
    "permission-control-canonical.mjs",
    "native-permission-task-observer.mjs",
  ]) {
    assert.ok(EVENT_HOST_CODE_ASSETS.includes(name));
    const bytes = await fs.readFile(new URL(`../src/${name}`, import.meta.url));
    assert.equal(
      identity.files[`apps/desktop-app/src/${name}`],
      createHash("sha256").update(bytes).digest("hex"),
    );
  }
  assert.deepEqual(await sourceIdentity(), identity);
});

test("engine mismatch and preexecution identity drift prevent child launch", async () => {
  for (const identity of [
    "engine",
    "sourceIdentity",
    "originalIdentity",
    "stagedIdentity",
  ]) {
    let reads = 0;
    let launches = 0;
    const key = identity === "engine" ? "stagedIdentity" : identity;
    const report = await fixture(send(protocol()), {
      [key]: async () => ({
        digest: identity === "engine" ? "unchanged" : String(++reads),
        engine:
          identity === "engine"
            ? "different-synthetic-engine"
            : "node-only-synthetic-engine",
      }),
      runChild: async () => {
        launches++;
        throw new Error("must not launch");
      },
    });
    assert.equal(launches, 0);
    assert.equal(report.result, "fail");
    assert.equal(report.child, undefined);
  }
});

test("source and original drift after an exited passing child still fail", async () => {
  for (const key of ["sourceIdentity", "originalIdentity"]) {
    let reads = 0;
    const report = await fixture(send(protocol()), {
      [key]: async () => ({
        digest: ++reads <= 2 ? "unchanged" : "post-child-drift",
        engine: "node-only-synthetic-engine",
      }),
    });
    assert.equal(report.child.exited, true);
    assert.equal(report.child.report.result, "pass");
    assert.equal(report.result, "fail");
    assert.equal(report.identityStable, false);
  }
});
