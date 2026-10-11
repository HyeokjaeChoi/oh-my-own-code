// Node-only helper tests. No Electron/Bun/Native/provider process is launched.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseNativeProbeOptions,
  claimNativeProbeOutput,
  snapshotNativeOriginals,
  assertProductionProbeStart,
  closedProbeFailure,
  probeEnvelope,
} from "../native-preflight-probe.mjs";
import {
  validateProductionProbeOptions,
  retainNativeOnlyInbox,
} from "./p7-storage-owner-host.mjs";

async function fixture(run) {
  const path = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "omoc-native-probe-node-")),
  );
  try {
    await run(path);
  } finally {
    await fs.rm(path, { recursive: true, force: false });
  }
}
const evidence = "docs/runs/durable-native-preflight/evidence";
test("closed CLI rejects unknown runtime selectors and missing output", () => {
  assert.deepEqual(
    parseNativeProbeOptions(["--out", `${evidence}/native-r1`]),
    { out: `${evidence}/native-r1` },
  );
  for (const args of [
    [],
    ["--out"],
    ["--out", "x", "--binary", "x"],
    ["--out", "x\n"],
    ["--provider", "x"],
  ])
    assert.throws(() => parseNativeProbeOptions(args));
});
test("evidence output is exclusive and contained", async () =>
  fixture(async (root) => {
    const out = `${evidence}/new`;
    const path = await claimNativeProbeOutput(root, out);
    assert.equal(path, join(root, out));
    assert.equal((await fs.stat(path)).mode & 0o777, 0o700);
    await assert.rejects(claimNativeProbeOutput(root, out), { code: "EEXIST" });
    for (const bad of [
      evidence,
      `${evidence}/../escape`,
      "other",
      join(root, "escape"),
    ])
      await assert.rejects(claimNativeProbeOutput(root, bad));
  }));
test("evidence rejects a symlink ancestor without writing its target", async () =>
  fixture(async (root) => {
    await fs.mkdir(join(root, "target"));
    await fs.symlink(join(root, "target"), join(root, "docs"));
    await assert.rejects(claimNativeProbeOutput(root, `${evidence}/new`));
    assert.deepEqual(await fs.readdir(join(root, "target")), []);
  }));
test("complete original DB snapshot preserves identity and optional absences", async () =>
  fixture(async (data) => {
    await fs.writeFile(
      join(data, "event-host.sqlite"),
      "Node synthetic DB bytes",
      { flag: "wx", mode: 0o600 },
    );
    await fs.writeFile(
      join(data, "event-host.sqlite-wal"),
      "Node synthetic WAL bytes",
      { flag: "wx", mode: 0o600 },
    );
    const before = await snapshotNativeOriginals(data);
    const after = await snapshotNativeOriginals(data);
    assert.deepEqual(after, before);
    assert.deepEqual(
      before.map((item) => item.present),
      [true, true, false, false],
    );
    assert.equal(before[0].sha256.length, 64);
    assert.ok(before[0].identity.ctimeNs);
    assert.equal(Object.hasOwn(before[0].identity, "atimeNs"), false);
    // An unchanged length still detects a changed file via content and ctime.
    await fs.writeFile(
      join(data, "event-host.sqlite-wal"),
      "Node synthetic WAL drift",
      { mode: 0o600 },
    );
    assert.notDeepEqual(await snapshotNativeOriginals(data), before);
  }));
test("original DB snapshot rejects redirects and hard links", async () =>
  fixture(async (data) => {
    await fs.writeFile(join(data, "target"), "synthetic", { mode: 0o600 });
    const path = join(data, "event-host.sqlite");
    await fs.symlink(join(data, "target"), path);
    await assert.rejects(snapshotNativeOriginals(data));
    await fs.unlink(path);
    await fs.link(join(data, "target"), path);
    await assert.rejects(snapshotNativeOriginals(data));
  }));
test("a missing original database cannot count as an unchanged complete set", async () =>
  fixture(async (data) => {
    await assert.rejects(
      snapshotNativeOriginals(data),
      /Original Native DB required/,
    );
  }));
test("production owner forbids injected historical exits", () => {
  validateProductionProbeOptions({
    productionAuthority: true,
    resourcesPath: "/tmp/resources",
  });
  for (const extra of [
    { ownedExited: [{}] },
    { unverified: [{}] },
    { resourcesPath: "relative" },
  ])
    assert.throws(() =>
      validateProductionProbeOptions({
        productionAuthority: true,
        resourcesPath: "/tmp/resources",
        ...extra,
      }),
    );
  // Existing P7 fixture options retain their previous authority.
  validateProductionProbeOptions(
    { ownedExited: [{}], unverified: [{}] },
    false,
  );
});
test("production preflight cannot use synthetic admission or a fixture owner", () => {
  validateProductionProbeOptions(
    { useProductionPreflight: true, eventHost: {} },
    true,
  );
  assert.throws(() =>
    validateProductionProbeOptions(
      {
        useProductionPreflight: true,
        eventHost: {},
        allowSyntheticStart: true,
      },
      true,
    ),
  );
  assert.throws(() =>
    validateProductionProbeOptions(
      { useProductionPreflight: true, eventHost: {} },
      false,
    ),
  );
  assert.throws(() =>
    validateProductionProbeOptions({ useProductionPreflight: true }, true),
  );
});
test("synthetic allow cannot count as production positive evidence", () => {
  const actual = {
    startupAuthority: "production-native-preflight",
    blocked: false,
    fresh: false,
    spawned: 1,
    windows: 0,
    activationPolicy: "prohibited",
    processId: 99,
    nativeIdentity: { pid: 99 },
  };
  assertProductionProbeStart(actual, false);
  for (const extra of [
    { startupAuthority: "explicit-trusted-synthetic-only" },
    { fresh: true },
    { spawned: 0 },
    { blocked: true },
    { windows: 1 },
    { nativeIdentity: { pid: 98 } },
  ])
    assert.throws(() =>
      assertProductionProbeStart({ ...actual, ...extra }, false),
    );
});
test("Native-only producer uses public enqueue with resume false and verifies stored inbox", async () => {
  const calls = [];
  const client = {
    session: {
      synthetic: async (input, options) => {
        calls.push({ input, options });
        return { id: "inbox-node-only" };
      },
      inbox: {
        list: async (input) => {
          calls.push(input);
          return [{ id: "inbox-node-only" }];
        },
      },
    },
  };
  const options = { signal: AbortSignal.timeout(1000) };
  const result = await retainNativeOnlyInbox(
    client,
    "session-node-only",
    options,
  );
  assert.equal(calls[0].input.resume, false);
  assert.equal(calls[0].input.sessionID, "session-node-only");
  assert.equal(calls[0].options, options);
  assert.deepEqual(calls[1], { sessionID: "session-node-only" });
  assert.equal(result.status, "produced");
  assert.equal(result.appRegistryIntent, false);
  assert.equal(result.resumed, false);
  assert.equal(Object.hasOwn(result, "inboxId"), false);
});
test("missing public producer is explicitly unmet, never synthetic positive proof", async () => {
  assert.deepEqual(
    await retainNativeOnlyInbox({ session: { inbox: {} } }, "s"),
    {
      status: "unmet_proof",
      reason: "public_producer_unavailable",
    },
  );
  await assert.rejects(
    retainNativeOnlyInbox(
      {
        session: {
          synthetic: async () => ({ id: "missing" }),
          inbox: { list: async () => [] },
        },
      },
      "s",
    ),
  );
});
test("current envelope epoch preserves nested original receipt keys", () => {
  const original = {
    type: "operation.lookup",
    runtimeEpoch: "previous",
    operationId: "original",
  };
  const envelope = probeEnvelope("current", original, "read-one");
  assert.equal(envelope.runtimeEpoch, "current");
  assert.equal(envelope.operation.runtimeEpoch, "previous");
  assert.equal(envelope.operation.operationId, "original");
  assert.equal(envelope.readId, "read-one");
  assert.equal(Object.hasOwn(envelope, "operationId"), false);
});
test("closed failure report cannot forward credentials or child exception text", () => {
  assert.deepEqual(closedProbeFailure("native-only-pending"), {
    code: "NATIVE_PREFLIGHT_PROBE_FAILED",
    phase: "native-only-pending",
  });
  assert.deepEqual(closedProbeFailure("password=do-not-record\n"), {
    code: "NATIVE_PREFLIGHT_PROBE_FAILED",
    phase: "unknown",
  });
});
