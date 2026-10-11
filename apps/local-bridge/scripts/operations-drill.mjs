import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalBridgeServer } from "../dist/server.js";

const scriptPath = fileURLToPath(import.meta.url);
const marker = "synthetic-operations-drill-v1";

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function effectWorker(directory) {
  assert.equal(await readFile(join(directory, "marker"), "utf8"), marker);
  await writeFile(
    join(directory, "journal.json"),
    JSON.stringify({ operationId: "synthetic-op-1", state: "dispatched" }),
  );
  await writeFile(join(directory, "effect-counter"), "1");
  // Intentionally exit before writing a confirmation receipt.
  process.exit(73);
}

if (process.argv[2] === "--effect-worker") {
  await effectWorker(process.argv[3]);
} else {
  await run();
}

function safeDiagnostic(record) {
  assert.match(record.operationId, /^synthetic-[a-z0-9-]+$/);
  assert.match(record.code, /^[A-Z_]+$/);
  return {
    operationId: record.operationId,
    code: record.code,
    effectState: record.effectState,
    source: "synthetic-drill",
  };
}

function drillRedaction() {
  const canaries = [
    "Bearer synthetic-secret-canary",
    "API_KEY=synthetic-env-canary",
    "/Users/synthetic/private-canary.txt",
    "prompt: synthetic-private-canary",
    "<script>synthetic-html-canary</script>",
    "tool-output: synthetic-result-canary",
  ];
  const raw = {
    operationId: "synthetic-op-1",
    code: "EFFECT_UNKNOWN",
    effectState: "unknown",
    authorization: canaries[0],
    environment: canaries[1],
    stack: `at ${canaries[2]}`,
    prompt: canaries[3],
    html: canaries[4],
    toolOutput: canaries[5],
  };
  const log = safeDiagnostic(raw);
  const diagnosticExport = { kind: "synthetic", incidents: [log] };
  const emitted = JSON.stringify({ log, diagnosticExport });
  for (const canary of canaries) assert.equal(emitted.includes(canary), false);
  assert.deepEqual(Object.keys(log), [
    "operationId",
    "code",
    "effectState",
    "source",
  ]);
  return "PASS synthetic log and diagnostic allowlist excludes six canaries";
}

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function drillBridgeLoss() {
  let server = createLocalBridgeServer();
  const baseUrl = await listen(server);
  try {
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, "ok");
  } finally {
    await close(server);
  }

  let sourceHealth = "available";
  try {
    await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2_000) });
    assert.fail("closed bridge unexpectedly answered");
  } catch (error) {
    if (error?.code === "ERR_ASSERTION") throw error;
    sourceHealth = "unavailable";
  }
  assert.equal(sourceHealth, "unavailable");

  server = createLocalBridgeServer();
  const reconnectedUrl = await listen(server);
  try {
    const response = await fetch(`${reconnectedUrl}/api/snapshot`);
    assert.equal(response.status, 200);
    const snapshot = await response.json();
    assert.equal(snapshot.source, "synthetic-fixture");
    assert.equal(snapshot.revision, 1);
    sourceHealth = "available";
  } finally {
    await close(server);
  }
  assert.equal(sourceHealth, "available");
  return "PASS actual loopback bridge loss reports unavailable; restart snapshot succeeds";
}

async function drillEffectCrash(directory) {
  const child = spawn(
    process.execPath,
    [scriptPath, "--effect-worker", directory],
    {
      stdio: "ignore",
    },
  );
  const [exitCode] = await once(child, "exit");
  assert.equal(exitCode, 73);
  const journal = JSON.parse(
    await readFile(join(directory, "journal.json"), "utf8"),
  );
  const effectCount = Number(
    await readFile(join(directory, "effect-counter"), "utf8"),
  );
  assert.equal(journal.state, "dispatched");
  assert.equal(effectCount, 1);

  const recovered = {
    operationId: journal.operationId,
    state: "unknown",
    effectState: "unknown",
    replayAllowed: false,
  };
  assert.equal(recovered.state, "unknown");
  assert.equal(recovered.replayAllowed, false);
  assert.equal(
    Number(await readFile(join(directory, "effect-counter"), "utf8")),
    1,
  );
  return "PASS synthetic effect then process exit retains unknown and does not replay";
}

async function drillBackupMigrationRollback(directory) {
  const source = JSON.stringify({
    schema: 1,
    records: [{ id: "synthetic-record" }],
  });
  const backupPath = join(directory, "backup.json");
  await writeFile(backupPath, source);
  const checksum = digest(source);
  assert.equal(digest(await readFile(backupPath)), checksum);

  // A partial candidate is isolated from the verified pre-migration backup.
  await writeFile(join(directory, "migration-candidate.json"), '{"schema":2,');
  let migrationFailed = false;
  try {
    JSON.parse(
      await readFile(join(directory, "migration-candidate.json"), "utf8"),
    );
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    migrationFailed = true;
  }
  assert.equal(migrationFailed, true);

  const recoveredBytes = await readFile(backupPath);
  assert.equal(digest(recoveredBytes), checksum);
  const recovery = {
    data: JSON.parse(recoveredBytes),
    readOnly: true,
    mutate() {
      if (this.readOnly) throw new Error("synthetic recovery is read-only");
    },
  };
  assert.equal(recovery.data.schema, 1);
  assert.equal(recovery.data.records.length, 1);
  assert.equal(recovery.readOnly, true);
  assert.throws(() => recovery.mutate(), /read-only/);

  const olderBuildMaxSchema = 1;
  const currentSchema = 2;
  const inPlaceRollbackAllowed = currentSchema <= olderBuildMaxSchema;
  assert.equal(inPlaceRollbackAllowed, false);
  assert.equal(recovery.data.schema <= olderBuildMaxSchema, true);
  return "PASS synthetic checksum backup and read-only recovery; incompatible in-place rollback blocked";
}

function drillMissedSchedule() {
  const dispatchedSlots = new Set();
  const missedSlots = new Set();
  const due = (slot, bridgeAvailable, paused) => {
    if (missedSlots.has(slot)) return "missed-no-backfill";
    if (!bridgeAvailable) {
      missedSlots.add(slot);
      return "missed";
    }
    if (paused) return "paused";
    if (dispatchedSlots.has(slot)) return "duplicate-blocked";
    dispatchedSlots.add(slot);
    return "dispatched";
  };
  assert.equal(due("job-1/rev-1/slot-1", false, false), "missed");
  assert.equal(dispatchedSlots.size, 0);
  assert.equal(due("job-1/rev-1/slot-1", true, false), "missed-no-backfill");
  assert.equal(due("job-1/rev-1/slot-2", true, true), "paused");
  assert.equal(dispatchedSlots.size, 0);
  assert.equal(due("job-1/rev-1/slot-3", true, false), "dispatched");
  assert.equal(due("job-1/rev-1/slot-3", true, false), "duplicate-blocked");
  return "PASS synthetic missed, paused, and duplicate slot model";
}

async function run() {
  const directory = await mkdtemp(
    join(tmpdir(), "local-bridge-operations-drill-"),
  );
  try {
    await writeFile(join(directory, "marker"), marker);
    const results = [
      drillRedaction(),
      await drillBridgeLoss(),
      await drillEffectCrash(directory),
      await drillBackupMigrationRollback(directory),
      drillMissedSchedule(),
    ];
    for (const result of results) process.stdout.write(`${result}\n`);
    process.stdout.write(
      "LIMITATION production diagnostics, journal, DB migration, rollback, and scheduler are not implemented by this fixture bridge\n",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
