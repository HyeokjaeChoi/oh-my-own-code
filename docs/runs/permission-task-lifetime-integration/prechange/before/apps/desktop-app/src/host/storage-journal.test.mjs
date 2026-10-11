import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { MCP_FEATURE, mcpNativeName, mcpStep } from "./workbench-mcp.mjs";

const beforeBranchRecords = () => {
  const key = { runtimeEpoch: "original", operationId: "before-branch" };
  const identity = {
    ...key,
    type: "session.fork",
    workspaceId: "workspace",
    sessionId: "parent",
    digest: "b".repeat(64),
  };
  const forkTarget = { beforeMessageId: "message-1" };
  return {
    marker: {
      kind: "feature_gate",
      feature: "conversation_context_before_branch_v1",
      revision: 1,
    },
    admitted: { kind: "admission", identity, forkTarget, revision: 2 },
    reserved: {
      kind: "reservation",
      ...key,
      appSessionId: "child",
      workspace: {
        workspaceId: "workspace",
        ownership: "imported",
        canonicalPath: "/synthetic",
        registrationState: "reserved",
      },
      revision: 3,
    },
    fork: {
      kind: "dispatch",
      ...key,
      step: "native.fork",
      forkTarget: { ...forkTarget },
      nativeSessionId: "parent-native",
      revision: 4,
    },
    policy: {
      kind: "dispatch",
      ...key,
      step: "native.policy",
      nativeSessionId: "child-native",
      revision: 5,
    },
    completed: {
      kind: "completion",
      ...key,
      revision: 6,
      receipt: {
        ...key,
        type: identity.type,
        workspaceId: identity.workspaceId,
        sessionId: identity.sessionId,
        admission: "dispatched",
        delivery: "accepted",
        effect: "confirmed",
        revision: 6,
        evidence: [{ kind: "native_session_verified", id: "child-native" }],
        result: {
          kind: "forked",
          workspaceId: "workspace",
          sessionId: "child",
          nativeSessionId: "child-native",
        },
      },
      delta: {
        workspaces: [],
        sessions: [
          {
            appSessionId: "child",
            workspaceId: "workspace",
            parentSessionId: "parent",
            nativeSessionId: "child-native",
            lifecycleState: "active",
            pinned: false,
            archived: false,
          },
        ],
        tombstones: [],
      },
    },
  };
};

test("CTX-BRANCH journal preserves exact admitted/dispatch target and unchanged result across checkpoint", async (t) => {
  const f = await fixture(t);
  const records = beforeBranchRecords();
  for (const payload of Object.values(records)) await f.journal.append(payload);
  await f.journal.checkpoint();
  await f.journal.close();
  const next = await openStorageJournal({
    directory: f.directory,
    storeId: "store",
  });
  t.after(() => next.close());
  assert.equal(next.status().state, "ready");
  assert.deepEqual(
    next.readRecords().committed.map((r) => r.payload),
    Object.values(records),
  );
});

for (const mode of [
  "marker",
  "undefined-target",
  "extra-target",
  "foreign-target",
  "missing-dispatch-target",
  "changed-dispatch-target",
  "target-on-policy",
  "target-on-send",
  "generic-dispatch-target",
  "missing-fork",
  "duplicate-fork",
  "result-child",
  "result-native",
  "result-parent",
  "unknown-upgrade",
  "dispatch-after-unknown",
])
  test(`CTX-BRANCH journal rejects ${mode} before byte mutation`, async (t) => {
    const r = beforeBranchRecords();
    let payloads = Object.values(r);
    if (mode === "marker") payloads.shift();
    if (mode === "undefined-target") r.admitted.forkTarget = undefined;
    if (mode === "extra-target") r.admitted.forkTarget.extra = undefined;
    if (mode === "foreign-target") r.admitted.identity.type = "message.send";
    if (mode === "missing-dispatch-target") delete r.fork.forkTarget;
    if (mode === "changed-dispatch-target")
      r.fork.forkTarget.beforeMessageId = "changed";
    if (mode === "target-on-policy")
      r.policy.forkTarget = r.admitted.forkTarget;
    if (mode === "target-on-send") r.fork.step = "native.send";
    if (mode === "generic-dispatch-target") delete r.admitted.forkTarget;
    if (mode === "missing-fork") payloads.splice(payloads.indexOf(r.fork), 1);
    if (mode === "duplicate-fork")
      payloads.splice(
        payloads.indexOf(r.policy),
        0,
        globalThis.structuredClone(r.fork),
      );
    if (mode === "result-child") r.completed.receipt.result.sessionId = "other";
    if (mode === "result-native")
      r.completed.receipt.result.nativeSessionId = "other";
    if (mode === "result-parent")
      r.completed.delta.sessions[0].parentSessionId = "other";
    if (mode === "unknown-upgrade" || mode === "dispatch-after-unknown") {
      const unknown = globalThis.structuredClone(r.completed);
      unknown.receipt.delivery = "unknown";
      unknown.receipt.effect = "unknown";
      delete unknown.receipt.result;
      unknown.delta = { workspaces: [], sessions: [], tombstones: [] };
      if (mode === "unknown-upgrade")
        payloads.splice(payloads.indexOf(r.completed), 0, unknown);
      else
        payloads = [
          r.marker,
          r.admitted,
          r.reserved,
          r.fork,
          unknown,
          r.policy,
        ];
    }
    const f = await fixture(t);
    let rejected = false;
    for (const [index, payload] of payloads.entries()) {
      payload.revision = index + 1;
      if (payload.receipt) payload.receipt.revision = index + 1;
      const before = await fs.readFile(join(f.directory, "journal.jsonl"));
      try {
        await f.journal.append(payload);
      } catch {
        rejected = true;
        assert.deepEqual(
          await fs.readFile(join(f.directory, "journal.jsonl")),
          before,
        );
        break;
      }
    }
    assert.equal(rejected, true, mode);
  });

for (const mode of ["journal", "checkpoint"])
  test(`CTX-BRANCH actual archived parser refuses ${mode} and preserves every store byte`, async (t) => {
    const base = new URL(
      "../../../../docs/runs/conversation-context/evidence/prechange/",
      import.meta.url,
    );
    const manifest = JSON.parse(
      await fs.readFile(new URL("manifest.json", base), "utf8"),
    );
    assert.equal(Object.keys(manifest.files).length, 79);
    for (const [name, expected] of Object.entries(manifest.files)) {
      const bytes = await fs.readFile(new URL(`legacy-source/${name}`, base));
      assert.equal(bytes.length, expected.bytes, name);
      assert.equal(
        createHash("sha256").update(bytes).digest("hex"),
        expected.sha256,
        name,
      );
    }
    const legacySource = await import(
      new URL(
        "legacy-source/apps/desktop-app/src/host/storage-journal.mjs",
        base,
      ).href
    );
    const records = beforeBranchRecords();
    assert.throws(() => legacySource.validateJournalPayload(records.marker), {
      code: "unsupported_version",
    });
    const f = await fixture(t);
    for (const payload of Object.values(records))
      await f.journal.append(payload);
    if (mode === "checkpoint") await f.journal.checkpoint();
    await f.journal.close();
    const names = (await fs.readdir(f.directory)).sort();
    const before = await Promise.all(
      names.map((name) => fs.readFile(join(f.directory, name))),
    );
    const legacy = await legacySource.openStorageJournal({
      directory: f.directory,
      storeId: "store",
    });
    assert.equal(legacy.status().reason, "unsupported_version");
    await assert.rejects(legacy.checkpoint(), { code: "unsupported_version" });
    await assert.rejects(async () => legacy.append(records.marker), {
      code: "unsupported_version",
    });
    await legacy.close();
    assert.deepEqual((await fs.readdir(f.directory)).sort(), names);
    assert.deepEqual(
      await Promise.all(
        names.map((name) => fs.readFile(join(f.directory, name))),
      ),
      before,
    );
  });
import {
  openStorageJournal,
  validateStorageReceipt,
  validateStorageIdentity,
  validateRegistryDelta,
  validateJournalPayload,
} from "./storage-journal.mjs";

const admission = (operationId = "op") => ({
  kind: "admission",
  identity: {
    runtimeEpoch: "original",
    operationId,
    type: "workspace.create",
    digest: "a".repeat(64),
  },
  revision: 1,
});
async function fixture(t, io = {}) {
  const directory = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "p7-journal-")),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const journal = await openStorageJournal({ directory, storeId: "store", io });
  t.after(() => journal.close());
  return { directory, journal };
}

const completionReceipt = (extra = {}) => ({
  runtimeEpoch: "original",
  operationId: "op",
  type: "workspace.create",
  admission: "admitted",
  delivery: "unknown",
  effect: "unknown",
  revision: 2,
  evidence: [],
  ...extra,
});

test("JR-V5-01 staged policy intents retain single policy, reject duplicates and unknown stages before append", async (t) => {
  const f = await fixture(t);
  await f.journal.append(admission());
  for (const [index, step] of [
    "native.policy",
    "native.policy.before_selection",
    "native.policy.after_selection",
  ].entries()) {
    const payload = {
      kind: "dispatch",
      runtimeEpoch: "original",
      operationId: "op",
      revision: index + 2,
      step,
    };
    await f.journal.append(payload);
    const before = await fs.readFile(join(f.directory, "journal.jsonl"));
    await assert.rejects(
      f.journal.append({ ...payload, revision: index + 3 }),
      { code: "identity_conflict" },
    );
    assert.deepEqual(
      await fs.readFile(join(f.directory, "journal.jsonl")),
      before,
    );
  }
  const before = await fs.readFile(join(f.directory, "journal.jsonl"));
  await assert.rejects(
    async () =>
      f.journal.append({
        kind: "dispatch",
        runtimeEpoch: "original",
        operationId: "op",
        revision: 5,
        step: "native.policy.third_selection",
      }),
    { code: "invalid_record" },
  );
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    before,
  );
  await f.journal.checkpoint();
  await f.journal.close();
  const reopened = await openStorageJournal({
    directory: f.directory,
    storeId: "store",
  });
  t.after(() => reopened.close());
  assert.equal(reopened.status().state, "ready");
  assert.deepEqual(
    reopened
      .readRecords()
      .committed.slice(1)
      .map(({ payload }) => payload.step),
    [
      "native.policy",
      "native.policy.before_selection",
      "native.policy.after_selection",
    ],
  );
});

for (const [label, value] of [
  ["null", null],
  ["false", false],
  ["zero", 0],
  ["empty string", ""],
  ["undefined", undefined],
]) {
  for (const field of ["result", "removedSessionIds"]) {
    test(`JR-V5-04 present ${field} ${label} is rejected before append`, async (t) => {
      const invalid = completionReceipt(
        field === "result"
          ? { result: value }
          : {
              result: {
                kind: "removed",
                workspaceId: "workspace",
                workspaceRemoved: false,
                removedSessionIds: value,
              },
            },
      );
      assert.throws(() => validateStorageReceipt(invalid), {
        code: "invalid_record",
      });
      const f = await fixture(t);
      await f.journal.append(admission());
      const before = await fs.readFile(join(f.directory, "journal.jsonl"));
      await assert.rejects(
        async () =>
          f.journal.append({
            kind: "completion",
            runtimeEpoch: "original",
            operationId: "op",
            revision: 2,
            receipt: invalid,
            delta: { workspaces: [], sessions: [], tombstones: [] },
          }),
        { code: "invalid_record" },
      );
      assert.deepEqual(
        await fs.readFile(join(f.directory, "journal.jsonl")),
        before,
      );
      assert.equal(f.journal.status().state, "ready");
    });
    if (value === undefined) continue;
    test(`JR-V5-04 checksum-valid ${field} ${label} is refused on reopen`, async (t) => {
      const f = await fixture(t);
      await f.journal.append(admission());
      await f.journal.checkpoint();
      await f.journal.close();
      const first = JSON.parse(
        (await fs.readFile(join(f.directory, "journal.jsonl"), "utf8")).trim(),
      );
      await fs.appendFile(
        join(f.directory, "journal.jsonl"),
        encode({
          schemaVersion: 1,
          storeId: "store",
          sequence: 2,
          previousHash: first.checksum,
          payload: {
            kind: "completion",
            runtimeEpoch: "original",
            operationId: "op",
            revision: 2,
            receipt: completionReceipt(
              field === "result"
                ? { result: value }
                : {
                    result: {
                      kind: "removed",
                      workspaceId: "workspace",
                      workspaceRemoved: false,
                      removedSessionIds: value,
                    },
                  },
            ),
            delta: { workspaces: [], sessions: [], tombstones: [] },
          },
        }),
      );
      const bytes = await fs.readFile(join(f.directory, "journal.jsonl"));
      const reopened = await openStorageJournal({
        directory: f.directory,
        storeId: "store",
      });
      t.after(() => reopened.close());
      assert.equal(reopened.status().reason, "corrupt_journal");
      assert.equal(reopened.readRecords().committed.length, 1);
      assert.deepEqual(
        await fs.readFile(join(f.directory, "journal.jsonl")),
        bytes,
      );
    });
  }
}

test("JR-V5-04 omitted optional fields and valid empty removedSessionIds remain valid", () => {
  assert.deepEqual(
    validateStorageReceipt(completionReceipt()),
    completionReceipt(),
  );
  for (const extra of [
    {},
    { removedSessionIds: [] },
    { removedSessionIds: ["session"] },
  ]) {
    const valid = completionReceipt({
      result: {
        kind: "removed",
        workspaceId: "workspace",
        workspaceRemoved: false,
        ...extra,
      },
    });
    assert.deepEqual(validateStorageReceipt(valid), valid);
  }
});

test("admission sync rejection preserves exact bytes, poisons every later append and reopens as uncertainty", async (t) => {
  const f = await fixture(t, {
    syncFile: async (_file, context) => {
      if (context.startsWith("append:")) throw new Error("PRIVATE FAILURE");
      await _file.sync();
    },
  });
  await assert.rejects(f.journal.append(admission()), {
    code: "writer_poisoned",
  });
  const bytes = await fs.readFile(join(f.directory, "journal.jsonl"));
  assert.ok(bytes.length > 0);
  await assert.rejects(f.journal.append(admission("later")), {
    code: "writer_poisoned",
  });
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    bytes,
  );
  await f.journal.close();
  const reopened = await openStorageJournal({
    directory: f.directory,
    storeId: "store",
  });
  t.after(() => reopened.close());
  assert.equal(reopened.status().reason, "unconfirmed_tail");
  assert.equal(reopened.readRecords().committed.length, 0);
  assert.equal(reopened.readRecords().uncertain.length, 1);
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    bytes,
  );
});

test("partial append stays damaged, checkpoint is retained and writes fail stop", async (t) => {
  let broken = false;
  const f = await fixture(t, {
    write: async (file, bytes, context) => {
      if (broken && context === "append") {
        await file.write(bytes.subarray(0, 23));
        throw new Error("partial");
      }
      await file.writeFile(bytes);
    },
  });
  await f.journal.append(admission());
  await f.journal.checkpoint();
  broken = true;
  await assert.rejects(
    f.journal.append({ ...admission("second"), revision: 2 }),
  );
  const bytes = await fs.readFile(join(f.directory, "journal.jsonl"));
  await f.journal.close();
  const recovered = await openStorageJournal({
    directory: f.directory,
    storeId: "store",
  });
  t.after(() => recovered.close());
  assert.equal(recovered.status().reason, "corrupt_journal");
  assert.equal(recovered.readRecords().committed.length, 1);
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    bytes,
  );
  await assert.rejects(
    recovered.append({ ...admission("third"), revision: 2 }),
  );
});

// Make deliberately checksum-valid adversarial records, independently of production encoding.
function encode(record) {
  const checksum = createHash("sha256")
    .update(JSON.stringify(record))
    .digest("hex");
  return JSON.stringify({ ...record, checksum }) + "\n";
}

test("serialized appends cannot pass a paused flush and queued append cannot pass poison", async (t) => {
  let release,
    entered = false;
  const paused = new Promise((resolve) => {
    release = resolve;
  });
  const f = await fixture(t, {
    syncFile: async (file, context) => {
      if (context === "append:admission") {
        entered = true;
        await paused;
        throw new Error("failure");
      }
      await file.sync();
    },
  });
  const first = f.journal.append(admission());
  const second = f.journal.append({ ...admission("queued"), revision: 2 });
  while (!entered) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.journal.status().sequence, 0);
  assert.equal(
    (await fs.readFile(join(f.directory, "journal.jsonl"), "utf8"))
      .split("\n")
      .filter(Boolean).length,
    1,
  );
  release();
  assert.deepEqual(
    (await Promise.allSettled([first, second])).map(
      (entry) => entry.reason.code,
    ),
    ["writer_poisoned", "writer_poisoned"],
  );
  assert.equal(
    (await fs.readFile(join(f.directory, "journal.jsonl"), "utf8"))
      .split("\n")
      .filter(Boolean).length,
    1,
  );
});

for (const failurePoint of [
  "checkpoint:pending",
  "checkpoint:previous",
  "checkpoint:file",
  "checkpoint:publish",
  "rename",
  "unlink",
]) {
  test(`checkpoint failure at ${failurePoint} preserves prior generation and original journal bytes`, async (t) => {
    let broken = false;
    const f = await fixture(t, {
      syncFile: async (file, context) => {
        if (broken && context === failurePoint) throw new Error("fault");
        await file.sync();
      },
      syncDirectory: async (directory, context) => {
        if (broken && context === failurePoint)
          throw new Error("directory fault");
        const file = await fs.open(directory, "r");
        try {
          await file.sync();
        } finally {
          await file.close();
        }
      },
      rename: async (...args) => {
        if (broken && failurePoint === "rename")
          throw new Error("rename fault");
        await fs.rename(...args);
      },
      unlink: async (...args) => {
        if (broken && failurePoint === "unlink")
          throw new Error("unlink fault");
        await fs.unlink(...args);
      },
    });
    await f.journal.append(admission());
    await f.journal.checkpoint();
    await f.journal.append({ ...admission("next"), revision: 2 });
    const bytes = await fs.readFile(join(f.directory, "journal.jsonl"));
    broken = true;
    await assert.rejects(f.journal.checkpoint(), { code: "writer_poisoned" });
    await assert.rejects(
      f.journal.append({ ...admission("later"), revision: 3 }),
    );
    await f.journal.close();
    const reopened = await openStorageJournal({
      directory: f.directory,
      storeId: "store",
    });
    t.after(() => reopened.close());
    assert.equal(reopened.status().state, "recovery_required");
    assert.equal(reopened.status().checkpointGeneration, 1);
    assert.equal(reopened.readRecords().committed.length, 1);
    assert.deepEqual(
      await fs.readFile(join(f.directory, "journal.jsonl")),
      bytes,
    );
  });
}

for (const [label, expected, mutate] of [
  [
    "checksum",
    "corrupt_journal",
    (body) => JSON.stringify({ ...body, checksum: "b".repeat(64) }) + "\n",
  ],
  ["sequence", "identity_conflict", (body) => encode({ ...body, sequence: 2 })],
  [
    "previous hash",
    "identity_conflict",
    (body) => encode({ ...body, previousHash: "b".repeat(64) }),
  ],
  [
    "store identity",
    "identity_conflict",
    (body) => encode({ ...body, storeId: "different" }),
  ],
  [
    "unsupported version",
    "unsupported_version",
    (body) => encode({ ...body, schemaVersion: 2 }),
  ],
  [
    "unknown payload field",
    "corrupt_journal",
    (body) =>
      encode({ ...body, payload: { ...body.payload, prompt: "PRIVATE" } }),
  ],
  ["partial UTF8", "corrupt_journal", () => Buffer.from([123, 0xff, 10])],
  ["empty line", "corrupt_journal", () => "\n"],
  [
    "oversized record",
    "corrupt_journal",
    () => " ".repeat(4 * 1024 * 1024) + "\n",
  ],
]) {
  test(`reopen refuses ${label} without modifying a single byte`, async (t) => {
    const f = await fixture(t);
    await f.journal.close();
    const bytes = Buffer.from(
      mutate({
        schemaVersion: 1,
        storeId: "store",
        sequence: 1,
        previousHash: "0".repeat(64),
        payload: admission(),
      }),
    );
    await fs.writeFile(join(f.directory, "journal.jsonl"), bytes);
    const reopened = await openStorageJournal({
      directory: f.directory,
      storeId: "store",
    });
    t.after(() => reopened.close());
    assert.equal(reopened.status().reason, expected);
    assert.equal(reopened.readRecords().committed.length, 0);
    assert.deepEqual(
      await fs.readFile(join(f.directory, "journal.jsonl")),
      bytes,
    );
  });
}

test("checksum-valid conflicting duplicate identity remains blocked across recovery", async (t) => {
  const f = await fixture(t);
  await f.journal.append(admission());
  await f.journal.checkpoint();
  await f.journal.close();
  const first = JSON.parse(
    (await fs.readFile(join(f.directory, "journal.jsonl"), "utf8")).trim(),
  );
  await fs.appendFile(
    join(f.directory, "journal.jsonl"),
    encode({
      schemaVersion: 1,
      storeId: "store",
      sequence: 2,
      previousHash: first.checksum,
      payload: {
        ...admission(),
        revision: 2,
        identity: { ...admission().identity, digest: "b".repeat(64) },
      },
    }),
  );
  const bytes = await fs.readFile(join(f.directory, "journal.jsonl"));
  const reopened = await openStorageJournal({
    directory: f.directory,
    storeId: "store",
  });
  t.after(() => reopened.close());
  assert.equal(reopened.status().reason, "identity_conflict");
  assert.equal(reopened.readRecords().committed.length, 1);
  await assert.rejects(
    reopened.recover({
      action: "adopt_validated_tail",
      expectedSequence: 1,
      expectedHash: first.checksum,
      ownerVerified: true,
      preflightVerified: true,
    }),
    { code: "recovery_denied" },
  );
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    bytes,
  );
});

test("explicit checkpoint is required; recovery adoption needs exact reviewed chain and owner/preflight", async (t) => {
  const f = await fixture(t);
  await f.journal.append(admission());
  await f.journal.close();
  const reopened = await openStorageJournal({
    directory: f.directory,
    storeId: "store",
  });
  t.after(() => reopened.close());
  const before = reopened.status();
  assert.equal(before.reason, "unconfirmed_tail");
  await assert.rejects(
    reopened.recover({
      action: "adopt_validated_tail",
      expectedSequence: before.sequence,
      expectedHash: before.hash,
      ownerVerified: true,
      preflightVerified: false,
    }),
    { code: "recovery_denied" },
  );
  await assert.rejects(
    reopened.recover({
      action: "adopt_validated_tail",
      expectedSequence: before.sequence,
      expectedHash: "b".repeat(64),
      ownerVerified: true,
      preflightVerified: true,
    }),
    { code: "recovery_denied" },
  );
  await reopened.recover({
    action: "adopt_validated_tail",
    expectedSequence: before.sequence,
    expectedHash: before.hash,
    ownerVerified: true,
    preflightVerified: true,
  });
  assert.equal(reopened.status().state, "ready");
  assert.equal(reopened.readRecords().committed.length, 2);
  await reopened.close();
  const third = await openStorageJournal({
    directory: f.directory,
    storeId: "store",
  });
  t.after(() => third.close());
  assert.equal(third.status().state, "ready");
});

test("symlink or hardlinked journal is denied without following or modifying it", async (t) => {
  for (const kind of ["symlink", "hardlink"]) {
    const f = await fixture(t);
    await f.journal.close();
    const outside = join(f.directory, "sentinel");
    await fs.writeFile(outside, "SENTINEL");
    await fs.unlink(join(f.directory, "journal.jsonl"));
    if (kind === "symlink")
      await fs.symlink(outside, join(f.directory, "journal.jsonl"));
    else await fs.link(outside, join(f.directory, "journal.jsonl"));
    const reopened = await openStorageJournal({
      directory: f.directory,
      storeId: "store",
    });
    t.after(() => reopened.close());
    assert.equal(reopened.status().reason, "storage_denied");
    assert.equal(await fs.readFile(outside, "utf8"), "SENTINEL");
  }
});

test("owner/migration records have explicit closed variants and ordered retained phases", async (t) => {
  const f = await fixture(t);
  await assert.rejects(async () =>
    f.journal.append({
      kind: "owner_intent",
      revision: 1,
      ownerNonce: "owner",
      phase: "startup",
      prompt: "PRIVATE",
    }),
  );
  await f.journal.append({
    kind: "owner_intent",
    revision: 1,
    ownerNonce: "owner",
    phase: "startup",
  });
  const migration = {
    kind: "migration_phase",
    migrationId: "move",
    sourceStoreId: "source",
    destinationStoreId: "dest",
    inventoryHash: "b".repeat(64),
  };
  await assert.rejects(
    f.journal.append({ ...migration, phase: "cutover", revision: 2 }),
    { code: "identity_conflict" },
  );
  await f.journal.append({ ...migration, phase: "retained", revision: 2 });
  await f.journal.append({ ...migration, phase: "quiesced", revision: 3 });
  await f.journal.append({ ...migration, phase: "rollback", revision: 4 });
  await assert.rejects(
    f.journal.append({ ...migration, phase: "copied", revision: 5 }),
    { code: "identity_conflict" },
  );
  assert.equal(f.journal.status().state, "ready");
});

test("configuration save feature marker precedes its new identity and ordered intent pair, surviving checkpoint", async (t) => {
  const f = await fixture(t);
  const save = {
    kind: "admission",
    revision: 2,
    identity: {
      ...admission().identity,
      type: "configuration.save",
      workspaceId: "workspace",
    },
  };
  await assert.rejects(f.journal.append({ ...save, revision: 1 }), {
    code: "unsupported_version",
  });
  await f.journal.append({
    kind: "feature_gate",
    revision: 1,
    feature: "configuration_save_v1",
  });
  await f.journal.append(save);
  const dispatch = {
    kind: "dispatch",
    runtimeEpoch: "original",
    operationId: "op",
    revision: 3,
    step: "filesystem.configuration.publish",
  };
  await assert.rejects(f.journal.append(dispatch), {
    code: "identity_conflict",
  });
  await assert.rejects(f.journal.append({ ...dispatch, step: "native.send" }), {
    code: "identity_conflict",
  });
  await f.journal.append({
    ...dispatch,
    step: "filesystem.configuration.stage",
  });
  await f.journal.append({ ...dispatch, revision: 4 });
  const receipt = {
    ...completionReceipt(),
    revision: 5,
    type: "configuration.save",
    workspaceId: "workspace",
    delivery: "accepted",
    effect: "confirmed",
    result: {
      kind: "configuration_saved",
      workspaceId: "workspace",
      configurationKind: "instructions",
      version: "b".repeat(64),
    },
  };
  await f.journal.append({
    kind: "completion",
    revision: 5,
    runtimeEpoch: "original",
    operationId: "op",
    receipt,
    delta: { workspaces: [], sessions: [], tombstones: [] },
  });
  await f.journal.checkpoint();
  await f.journal.close();
  const reopened = await openStorageJournal({
    directory: f.directory,
    storeId: "store",
  });
  t.after(() => reopened.close());
  assert.equal(reopened.status().state, "ready");
  assert.equal(reopened.readRecords().committed.length, 5);
  assert.throws(
    () => validateStorageReceipt({ ...receipt, effect: "unknown" }),
    { code: "invalid_record" },
  );
  assert.throws(
    () =>
      validateStorageReceipt({
        ...receipt,
        result: { ...receipt.result, backupId: "../../private" },
      }),
    { code: "invalid_record" },
  );
});

test("instruction marker makes the immutable old parser refuse journal and checkpoint without writes", async (t) => {
  const f = await fixture(t);
  await f.journal.append({
    kind: "feature_gate",
    revision: 1,
    feature: "configuration_instructions_v1",
  });
  await f.journal.checkpoint();
  await f.journal.close();
  const bundle = new URL(
    "../../../../docs/runs/configuration-instructions/evidence/prechange/legacy-storage-journal.bundle.mjs",
    import.meta.url,
  );
  assert.equal(
    createHash("sha256")
      .update(await fs.readFile(bundle))
      .digest("hex"),
    "1b6cf5048680e3e246e4efa8da4299e7e25008972f3604d2e5bf0f9fead98f33",
  );
  const before = await Promise.all(
    ["journal.jsonl", "checkpoint.json"].map((name) =>
      fs.readFile(join(f.directory, name)),
    ),
  );
  const { openStorageJournal: openLegacy } = await import(bundle.href);
  const legacy = await openLegacy({ directory: f.directory, storeId: "store" });
  assert.equal(legacy.status().reason, "unsupported_version");
  await assert.rejects(legacy.checkpoint(), { code: "unsupported_version" });
  await legacy.close();
  assert.deepEqual(
    await Promise.all(
      ["journal.jsonl", "checkpoint.json"].map((name) =>
        fs.readFile(join(f.directory, name)),
      ),
    ),
    before,
  );
  const current = await openStorageJournal({
    directory: f.directory,
    storeId: "store",
  });
  t.after(() => current.close());
  assert.equal(current.status().state, "ready");
});

test("instruction identity, receipt and registration are closed; new intents require the matching admitted feature operation", async (t) => {
  const identity = {
    ...admission().identity,
    type: "configuration.instructions.apply",
    workspaceId: "workspace",
    sessionId: "session",
  };
  assert.deepEqual(validateStorageIdentity(identity), identity);
  for (const missing of ["workspaceId", "sessionId"]) {
    const candidate = { ...identity };
    delete candidate[missing];
    assert.throws(() => validateStorageIdentity(candidate), {
      code: "invalid_record",
    });
  }
  const registered = completionReceipt({
    ...identity,
    digest: undefined,
    admission: "dispatched",
    delivery: "accepted",
    effect: "confirmed",
    result: {
      kind: "instruction_registered",
      workspaceId: "workspace",
      sessionId: "session",
      digest: "b".repeat(64),
      sourceVersion: "c".repeat(64),
    },
  });
  delete registered.digest;
  assert.deepEqual(validateStorageReceipt(registered), registered);
  for (const candidate of [
    { ...registered, effect: "unknown" },
    { ...registered, delivery: "pending" },
    { ...registered, admission: "admitted" },
    { ...registered, type: "session.pin" },
    { ...registered, result: { ...registered.result, sessionId: "other" } },
    { ...registered, result: { ...registered.result, text: "PRIVATE" } },
    { ...registered, result: { ...registered.result, sourceVersion: "bad" } },
  ])
    assert.throws(() => validateStorageReceipt(candidate), {
      code: "invalid_record",
    });
  const removed = {
    ...registered,
    type: "configuration.instructions.remove",
    result: {
      kind: "instruction_removed",
      workspaceId: "workspace",
      sessionId: "session",
    },
  };
  assert.deepEqual(validateStorageReceipt(removed), removed);
  assert.throws(
    () =>
      validateStorageReceipt({
        ...removed,
        result: { ...removed.result, digest: "b".repeat(64) },
      }),
    { code: "invalid_record" },
  );
  const registration = {
    state: "registered",
    key: "omoc.project-instructions",
    digest: "b".repeat(64),
    sourceVersion: "c".repeat(64),
    origin: "direct",
  };
  const session = {
    appSessionId: "session",
    workspaceId: "workspace",
    lifecycleState: "active",
    nativeSessionId: "native",
    pinned: false,
    archived: false,
  };
  for (const instructionRegistration of [
    { ...registration, inheritedFromSessionId: "parent" },
    { ...registration, origin: "fork" },
    { ...registration, origin: "guessed" },
    { ...registration, text: "PRIVATE" },
    { state: "absent", key: registration.key, origin: "direct" },
    null,
  ])
    assert.throws(
      () =>
        validateRegistryDelta({
          workspaces: [],
          sessions: [{ ...session, instructionRegistration }],
          tombstones: [],
        }),
      { code: "invalid_record" },
    );
  const f = await fixture(t);
  await assert.rejects(
    f.journal.append({ kind: "admission", revision: 1, identity }),
    { code: "unsupported_version" },
  );
  await f.journal.append({
    kind: "feature_gate",
    revision: 1,
    feature: "configuration_instructions_v1",
  });
  await f.journal.append({ kind: "admission", revision: 2, identity });
  const before = await fs.readFile(join(f.directory, "journal.jsonl"));
  // A marker and matching operation are insufficient without a committed Native mapping.
  await assert.rejects(
    f.journal.append({
      kind: "dispatch",
      revision: 3,
      runtimeEpoch: identity.runtimeEpoch,
      operationId: identity.operationId,
      step: "native.instructions.put",
      nativeSessionId: "native",
    }),
    { code: "identity_conflict" },
  );
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    before,
  );
});

const mcpDelta = () => ({ workspaces: [], sessions: [], tombstones: [] });
function mcpRecords(
  action = "register",
  status = "disabled",
  noEffect = false,
) {
  const identity = {
    runtimeEpoch: "original",
    operationId: "mcp",
    type: `configuration.mcp.${action}`,
    workspaceId: "workspace",
    digest: "a".repeat(64),
  };
  const nativeServerName = mcpNativeName(identity.workspaceId, "local");
  const request = {
    runtimeEpoch: identity.runtimeEpoch,
    operationId: identity.operationId,
  };
  const result = {
    kind:
      action === "register"
        ? "mcp_registered"
        : action === "remove"
          ? "mcp_removed"
          : "mcp_connection",
    workspaceId: identity.workspaceId,
    sourceName: "local",
    nativeName: nativeServerName,
    ...(action === "register" && {
      digest: "b".repeat(64),
      sourceVersion: "c".repeat(64),
      status,
    }),
    ...(["connect", "disconnect"].includes(action) && {
      action,
      connectionStatus: status,
    }),
  };
  const revision = noEffect ? 3 : 4;
  return {
    marker: { kind: "feature_gate", revision: 1, feature: MCP_FEATURE },
    admission: { kind: "admission", revision: 2, identity, nativeServerName },
    dispatch: {
      kind: "dispatch",
      revision: 3,
      ...request,
      step: mcpStep(identity.type),
      nativeServerName,
    },
    completion: {
      kind: "completion",
      revision,
      ...request,
      receipt: {
        ...request,
        type: identity.type,
        workspaceId: identity.workspaceId,
        revision,
        evidence: [],
        admission: noEffect ? "admitted" : "dispatched",
        delivery: "accepted",
        effect: noEffect ? "none" : "confirmed",
        result,
      },
      delta: mcpDelta(),
    },
  };
}
for (const [action, status, noEffect = false] of [
  ["register", "disabled"],
  ["connect", "connected"],
  ["connect", "failed"],
  ["connect", "needs_auth"],
  ["disconnect", "disabled"],
  ["remove", undefined],
  ["remove", undefined, true],
]) {
  test(`MCP journal confirms ${action}/${status ?? "absent"}/${noEffect ? "no-effect" : "dispatched"} without registry metadata`, async (t) => {
    const f = await fixture(t);
    const r = mcpRecords(action, status, noEffect);
    assert.deepEqual(
      validateStorageReceipt(r.completion.receipt),
      r.completion.receipt,
    );
    await assert.rejects(f.journal.append({ ...r.admission, revision: 1 }), {
      code: "unsupported_version",
    });
    await f.journal.append(r.marker);
    await f.journal.append(r.admission);
    if (!noEffect) await f.journal.append(r.dispatch);
    const before = await fs.readFile(join(f.directory, "journal.jsonl"));
    const invalid = {
      ...r.completion,
      receipt: {
        ...r.completion.receipt,
        result: {
          ...r.completion.receipt.result,
          sourceName: "other",
          nativeName: mcpNativeName("workspace", "other"),
        },
      },
    };
    await assert.rejects(f.journal.append(invalid), {
      code: "identity_conflict",
    });
    assert.deepEqual(
      await fs.readFile(join(f.directory, "journal.jsonl")),
      before,
    );
    await f.journal.append(r.completion);
    // An absent remove is terminal even though it has no Native dispatch.
    await assert.rejects(
      f.journal.append({ ...r.dispatch, revision: r.completion.revision + 1 }),
      { code: "identity_conflict" },
    );
    await f.journal.checkpoint();
    await f.journal.close();
    const reopened = await openStorageJournal({
      directory: f.directory,
      storeId: "store",
    });
    t.after(() => reopened.close());
    assert.equal(reopened.status().state, "ready");
    assert.deepEqual(
      reopened.readRecords().committed.at(-1).payload.receipt.result,
      r.completion.receipt.result,
    );
  });
}

test("MCP closed receipts refuse wrong type/action/status/scope/derived name, speculative results and payload copies", () => {
  const r = mcpRecords().completion.receipt;
  for (const candidate of [
    { ...r, sessionId: "session" },
    { ...r, type: "session.pin" },
    { ...r, type: "configuration.mcp.remove" },
    { ...r, admission: "admitted" },
    { ...r, delivery: "unknown" },
    { ...r, effect: "unknown" },
    { ...r, effect: "none" },
    { ...r, result: undefined },
    { ...r, result: { ...r.result, workspaceId: "other" } },
    {
      ...r,
      result: { ...r.result, nativeName: mcpNativeName("workspace", "other") },
    },
    { ...r, result: { ...r.result, sourceName: "../bad" } },
    { ...r, result: { ...r.result, status: "connected" } },
    { ...r, result: { ...r.result, digest: "bad" } },
    { ...r, result: { ...r.result, sourceVersion: "bad" } },
    { ...r, result: { kind: "delivery", status: "accepted" } },
    ...[
      "command",
      "config",
      "text",
      "env",
      "headers",
      "ownership",
      "runtimeEpoch",
    ].map((field) => ({ ...r, result: { ...r.result, [field]: "PRIVATE" } })),
  ])
    assert.throws(() => validateStorageReceipt(candidate), {
      code: "invalid_record",
    });
  for (const action of ["connect", "disconnect"]) {
    const valid = mcpRecords(
      action,
      action === "connect" ? "connected" : "disabled",
    ).completion.receipt;
    for (const connectionStatus of [
      "pending",
      "absent",
      "other",
      ...(action === "connect"
        ? ["disabled"]
        : ["connected", "failed", "needs_auth"]),
    ])
      assert.throws(
        () =>
          validateStorageReceipt({
            ...valid,
            result: { ...valid.result, connectionStatus },
          }),
        { code: "invalid_record" },
      );
    assert.throws(
      () =>
        validateStorageReceipt({
          ...valid,
          result: {
            ...valid.result,
            action: action === "connect" ? "disconnect" : "connect",
          },
        }),
      { code: "invalid_record" },
    );
  }
  const absent = mcpRecords("remove", undefined, true).completion.receipt;
  assert.throws(
    () => validateStorageReceipt({ ...absent, admission: "dispatched" }),
    { code: "invalid_record" },
  );
  assert.throws(
    () =>
      validateStorageReceipt({
        ...absent,
        result: { ...absent.result, status: "absent" },
      }),
    { code: "invalid_record" },
  );
  const { result: _result, ...unknown } = r;
  assert.deepEqual(
    validateStorageReceipt({
      ...unknown,
      delivery: "unknown",
      effect: "unknown",
    }),
    { ...unknown, delivery: "unknown", effect: "unknown" },
  );
});

test("MCP admission/dispatch reject mixed identity, session target and unrelated steps before append", async (t) => {
  const f = await fixture(t);
  const r = mcpRecords();
  const { nativeServerName: _target, ...noTarget } = r.admission;
  for (const invalid of [
    noTarget,
    { ...r.admission, nativeServerName: "foreign" },
    {
      ...r.admission,
      identity: {
        ...r.admission.identity,
        nativeServerName: r.admission.nativeServerName,
      },
    },
    {
      ...r.admission,
      identity: { ...r.admission.identity, sessionId: "session" },
    },
    { ...r.admission, identity: { ...admission().identity } },
  ])
    assert.throws(() => validateJournalPayload(invalid), {
      code: "invalid_record",
    });
  const { workspaceId: _workspace, ...noWorkspace } = r.admission.identity;
  assert.throws(() => validateStorageIdentity(noWorkspace), {
    code: "invalid_record",
  });
  await f.journal.append(r.marker);
  await f.journal.append(r.admission);
  const before = await fs.readFile(join(f.directory, "journal.jsonl"));
  for (const invalid of [
    { ...r.dispatch, nativeServerName: mcpNativeName("workspace", "other") },
    { ...r.dispatch, step: "native.mcp.connect" },
    ...[
      "native.send",
      "native.policy",
      "registry.metadata",
      "native.instructions.put",
    ].map((step) => {
      const { nativeServerName: _name, ...dispatch } = r.dispatch;
      return {
        ...dispatch,
        step,
        ...(step === "native.instructions.put" && {
          nativeSessionId: "native",
        }),
      };
    }),
  ])
    await assert.rejects(f.journal.append(invalid), {
      code: "identity_conflict",
    });
  for (const invalid of [
    { ...r.dispatch, nativeSessionId: "native" },
    { ...r.dispatch, nativeServerName: undefined },
    { ...r.dispatch, step: "native.send" },
  ])
    await assert.rejects(async () => f.journal.append(invalid), {
      code: "invalid_record",
    });
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    before,
  );
  await f.journal.append(r.dispatch);
  for (const invalid of [
    {
      ...r.completion,
      delta: {
        ...mcpDelta(),
        tombstones: [{ kind: "workspace", id: "workspace" }],
      },
    },
    {
      ...r.completion,
      receipt: {
        ...r.completion.receipt,
        effect: "none",
        admission: "admitted",
        result: {
          kind: "mcp_removed",
          workspaceId: "workspace",
          sourceName: "local",
          nativeName: r.dispatch.nativeServerName,
        },
        type: "configuration.mcp.remove",
      },
    },
  ])
    await assert.rejects(async () => f.journal.append(invalid), {
      code: "identity_conflict",
    });
  await f.journal.append(r.completion);
  // A different operation cannot borrow a valid MCP marker and intent.
  const other = await fixture(t);
  await other.journal.append(r.marker);
  await other.journal.append({ ...admission(), revision: 2 });
  await assert.rejects(
    other.journal.append({ ...r.dispatch, operationId: "op" }),
    { code: "identity_conflict" },
  );
});

test("MCP feature marker makes actual immutable prechange parser refuse journal and checkpoint with byte preservation", async (t) => {
  const f = await fixture(t);
  const r = mcpRecords();
  await f.journal.append(r.marker);
  await f.journal.append(r.admission);
  await f.journal.append(r.dispatch);
  await f.journal.append(r.completion);
  await f.journal.checkpoint();
  await f.journal.close();
  const bundle = new URL(
    "../../../../docs/runs/configuration-mcp/evidence/prechange/legacy-storage-journal.bundle.mjs",
    import.meta.url,
  );
  assert.equal(
    createHash("sha256")
      .update(await fs.readFile(bundle))
      .digest("hex"),
    "7337542c0bb7b49e447188c75b762227ea250d9302df97dfe2534ee2f0efcc92",
  );
  const files = (await fs.readdir(f.directory)).sort();
  const before = await Promise.all(
    files.map((name) => fs.readFile(join(f.directory, name))),
  );
  const { openStorageJournal: openLegacy } = await import(bundle.href);
  const legacy = await openLegacy({ directory: f.directory, storeId: "store" });
  assert.equal(legacy.status().reason, "unsupported_version");
  await assert.rejects(async () => legacy.append(r.marker), {
    code: "unsupported_version",
  });
  await assert.rejects(legacy.checkpoint(), { code: "unsupported_version" });
  await legacy.close();
  assert.deepEqual((await fs.readdir(f.directory)).sort(), files);
  assert.deepEqual(
    await Promise.all(
      files.map((name) => fs.readFile(join(f.directory, name))),
    ),
    before,
  );
});

test("SKILL journal requires feature before private admission and forbids name on other types", async (t) => {
  const f = await fixture(t);
  const payload = {
    ...admission(),
    skillSourceName: "review",
    identity: {
      ...admission().identity,
      type: "configuration.skill.save",
      workspaceId: "ws",
    },
  };
  assert.throws(() =>
    validateJournalPayload({ ...payload, skillSourceName: "../escape" }),
  );
  assert.throws(() =>
    validateJournalPayload({ ...admission(), skillSourceName: "review" }),
  );
  assert.throws(() =>
    validateJournalPayload({
      ...payload,
      identity: { ...payload.identity, sessionId: "session" },
    }),
  );
  await assert.rejects(f.journal.append(payload), {
    code: "unsupported_version",
  });
  await f.journal.append({
    kind: "feature_gate",
    feature: "configuration_skill_files_v1",
    revision: 1,
  });
  await f.journal.append({ ...payload, revision: 2 });
  assert.equal(f.journal.status().state, "ready");
});

function skillJournalRecords() {
  const key = { runtimeEpoch: "original", operationId: "op" };
  const marker = {
    kind: "feature_gate",
    feature: "configuration_skill_files_v1",
    revision: 1,
  };
  const admitted = {
    ...admission(),
    revision: 2,
    skillSourceName: "review",
    identity: {
      ...admission().identity,
      type: "configuration.skill.save",
      workspaceId: "ws",
    },
  };
  const stage = {
    kind: "dispatch",
    ...key,
    revision: 3,
    step: "filesystem.configuration.stage",
  };
  const publish = {
    ...stage,
    revision: 4,
    step: "filesystem.configuration.publish",
  };
  const completion = {
    kind: "completion",
    ...key,
    revision: 5,
    receipt: {
      ...completionReceipt(),
      type: "configuration.skill.save",
      workspaceId: "ws",
      revision: 5,
      admission: "dispatched",
      delivery: "accepted",
      effect: "confirmed",
      result: {
        kind: "skill_file_saved",
        workspaceId: "ws",
        sourceName: "review",
        version: "a".repeat(64),
      },
    },
    delta: { workspaces: [], sessions: [], tombstones: [] },
  };
  return { marker, admitted, stage, publish, completion };
}

test("SKILL parser binds successful result to original name and rejects reservation/native dispatch before append", async (t) => {
  const f = await fixture(t),
    r = skillJournalRecords();
  await f.journal.append(r.marker);
  await f.journal.append(r.admitted);
  const reservation = {
    kind: "reservation",
    runtimeEpoch: "original",
    operationId: "op",
    revision: 3,
    appSessionId: "session",
    workspace: {
      workspaceId: "ws",
      ownership: "imported",
      canonicalPath: "/synthetic",
      registrationState: "reserved",
    },
  };
  validateJournalPayload(reservation); // Valid shape; rejection must come from the Skill relationship.
  const before = await fs.readFile(join(f.directory, "journal.jsonl"));
  for (const payload of [
    reservation,
    { ...r.publish, revision: 3 },
    { ...r.stage, step: "native.send" },
    { ...r.stage, nativeSessionId: "session" },
  ])
    await assert.rejects(f.journal.append(payload), {
      code: "identity_conflict",
    });
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    before,
  );
  await f.journal.append(r.stage);
  await f.journal.append(r.publish);
  const staged = await fs.readFile(join(f.directory, "journal.jsonl"));
  for (const change of [
    {
      receipt: {
        ...r.completion.receipt,
        result: { ...r.completion.receipt.result, sourceName: "other" },
      },
    },
    {
      delta: {
        ...r.completion.delta,
        tombstones: [{ kind: "workspace", id: "ws" }],
      },
    },
  ])
    await assert.rejects(f.journal.append({ ...r.completion, ...change }), {
      code: "identity_conflict",
    });
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    staged,
  );
  await f.journal.append(r.completion);
});

for (const mode of [
  "marker-tail",
  "marker-checkpoint-zero-operations",
  "confirmed-checkpoint-zero-retained",
]) {
  test(`SKILL exact prechange parser refuses ${mode} and preserves all bytes`, async (t) => {
    const f = await fixture(t),
      r = skillJournalRecords();
    await f.journal.append(r.marker);
    if (mode.startsWith("confirmed"))
      for (const payload of [r.admitted, r.stage, r.publish, r.completion])
        await f.journal.append(payload);
    if (mode !== "marker-tail") await f.journal.checkpoint();
    await f.journal.close();
    const base = new URL(
      "../../../../docs/runs/configuration-skill-files/evidence/prechange/",
      import.meta.url,
    );
    const manifest = JSON.parse(
      await fs.readFile(new URL("legacy-parser-closure.json", base), "utf8"),
    );
    assert.equal(
      manifest.sha256,
      "6ccadc0c97bf67345da0bcb2dfe07174678177c744098c321d22df25ddb68b68",
    );
    const bundle = new URL("legacy-storage-journal.bundle.mjs", base);
    assert.equal(
      createHash("sha256")
        .update(await fs.readFile(bundle))
        .digest("hex"),
      manifest.sha256,
    );
    const names = (await fs.readdir(f.directory)).sort();
    const before = await Promise.all(
      names.map((name) => fs.readFile(join(f.directory, name))),
    );
    const { openStorageJournal: openLegacy } = await import(bundle.href);
    const legacy = await openLegacy({
      directory: f.directory,
      storeId: "store",
    });
    assert.equal(legacy.status().reason, "unsupported_version");
    await assert.rejects(legacy.checkpoint(), { code: "unsupported_version" });
    await assert.rejects(async () => legacy.append(r.marker), {
      code: "unsupported_version",
    });
    await legacy.close();
    assert.deepEqual((await fs.readdir(f.directory)).sort(), names);
    assert.deepEqual(
      await Promise.all(
        names.map((name) => fs.readFile(join(f.directory, name))),
      ),
      before,
    );
    const next = await openStorageJournal({
      directory: f.directory,
      storeId: "store",
    });
    t.after(() => next.close());
    assert.equal(
      next.status().state,
      mode === "marker-tail" ? "recovery_required" : "ready",
    );
    if (mode !== "marker-tail")
      assert.equal(
        next.readRecords().committed[0].payload.feature,
        "configuration_skill_files_v1",
      );
  });
}

test("SKILL public storage schemas reject explicit undefined session although internal redaction allows it", () => {
  const r = skillJournalRecords();
  assert.throws(
    () =>
      validateStorageReceipt({ ...r.completion.receipt, sessionId: undefined }),
    { code: "invalid_record" },
  );
  assert.throws(
    () =>
      validateStorageIdentity({ ...r.admitted.identity, sessionId: undefined }),
    { code: "invalid_record" },
  );
});

import { nativeSkillRegistrationId } from "../native-skills-protocol.mjs";
import { SKILL_RUNTIME_FEATURE } from "./workbench-skill-runtime-storage.mjs";
function runtimeJournalRecords() {
  const key = { runtimeEpoch: "original", operationId: "runtime-register" };
  const target = {
    sourceName: "review",
    nativeId: nativeSkillRegistrationId({
      ...key,
      workspaceId: "ws",
      sourceName: "review",
    }),
    digest: "b".repeat(64),
    nativeDigest: "c".repeat(64),
    bodyDigest: "d".repeat(64),
    registrationRuntimeEpoch: key.runtimeEpoch,
    registrationOperationId: key.operationId,
  };
  const skillRuntime = {
    sourceName: target.sourceName,
    nativeId: target.nativeId,
    digest: target.digest,
    version: "e".repeat(64),
    directoryVersion: "f".repeat(64),
  };
  return {
    marker: {
      kind: "feature_gate",
      feature: SKILL_RUNTIME_FEATURE,
      revision: 1,
    },
    admitted: {
      kind: "admission",
      revision: 2,
      identity: {
        ...key,
        type: "configuration.skill.register",
        workspaceId: "ws",
        digest: "a".repeat(64),
      },
      skillRuntime,
    },
    dispatch: {
      kind: "dispatch",
      ...key,
      revision: 3,
      step: "native.skill.register",
      skillRuntime: target,
    },
    completion: {
      kind: "completion",
      ...key,
      revision: 4,
      receipt: {
        ...key,
        type: "configuration.skill.register",
        workspaceId: "ws",
        revision: 4,
        admission: "dispatched",
        delivery: "accepted",
        effect: "confirmed",
        evidence: [],
        result: {
          kind: "skill_registered",
          workspaceId: "ws",
          ...target,
          version: skillRuntime.version,
          directoryVersion: skillRuntime.directoryVersion,
        },
      },
      delta: { workspaces: [], sessions: [], tombstones: [] },
    },
  };
}

for (const mode of [
  "marker-tail",
  "marker-checkpoint-zero-operations",
  "confirmed-checkpoint-zero-retained",
]) {
  test(`Native Skill runtime saved actual prechange parser refuses ${mode} without any writes`, async (t) => {
    const f = await fixture(t),
      r = runtimeJournalRecords();
    await f.journal.append(r.marker);
    if (mode.startsWith("confirmed"))
      for (const p of [r.admitted, r.dispatch, r.completion])
        await f.journal.append(p);
    if (mode !== "marker-tail") await f.journal.checkpoint();
    await f.journal.close();
    const base = new URL(
      "../../../../docs/runs/configuration-skill-runtime/evidence/prechange/",
      import.meta.url,
    );
    const manifest = JSON.parse(
      await fs.readFile(new URL("legacy-parser-closure.json", base), "utf8"),
    );
    const bundle = new URL("legacy-storage-journal.bundle.mjs", base);
    assert.equal(
      manifest.sha256,
      "0da4ad71b3db112d356677aa9077e450da9e2ba1eea4c75df76f3b4d5fac2795",
    );
    assert.equal(
      createHash("sha256")
        .update(await fs.readFile(bundle))
        .digest("hex"),
      manifest.sha256,
    );
    const names = (await fs.readdir(f.directory)).sort();
    const bytes = await Promise.all(
      names.map((name) => fs.readFile(join(f.directory, name))),
    );
    const { openStorageJournal: openLegacy } = await import(bundle.href);
    const legacy = await openLegacy({
      directory: f.directory,
      storeId: "store",
    });
    assert.equal(legacy.status().reason, "unsupported_version");
    await assert.rejects(legacy.checkpoint(), { code: "unsupported_version" });
    await assert.rejects(async () => legacy.append(r.marker), {
      code: "unsupported_version",
    });
    await legacy.close();
    assert.deepEqual((await fs.readdir(f.directory)).sort(), names);
    assert.deepEqual(
      await Promise.all(
        names.map((name) => fs.readFile(join(f.directory, name))),
      ),
      bytes,
    );
    const current = await openStorageJournal({
      directory: f.directory,
      storeId: "store",
    });
    t.after(() => current.close());
    assert.equal(
      current.status().state,
      mode === "marker-tail" ? "recovery_required" : "ready",
    );
  });
}

test("Native Skill runtime journal requires feature, original targets and flushed exact result before bytes", async (t) => {
  const f = await fixture(t),
    r = runtimeJournalRecords();
  await assert.rejects(f.journal.append({ ...r.admitted, revision: 1 }), {
    code: "unsupported_version",
  });
  await f.journal.append(r.marker);
  await f.journal.append(r.admitted);
  const before = await fs.readFile(join(f.directory, "journal.jsonl"));
  for (const payload of [
    { ...r.dispatch, step: "native.send" },
    { ...r.dispatch, nativeSessionId: "forbidden" },
    {
      ...r.dispatch,
      skillRuntime: { ...r.dispatch.skillRuntime, digest: "0".repeat(64) },
    },
    {
      ...r.dispatch,
      skillRuntime: { ...r.dispatch.skillRuntime, body: "PRIVATE" },
    },
    {
      ...r.completion,
      revision: 3,
      receipt: { ...r.completion.receipt, revision: 3 },
    },
  ])
    await assert.rejects(async () => f.journal.append(payload));
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    before,
  );
  await f.journal.append(r.dispatch);
  const dispatched = await fs.readFile(join(f.directory, "journal.jsonl"));
  for (const field of [
    "digest",
    "nativeDigest",
    "bodyDigest",
    "version",
    "directoryVersion",
  ])
    await assert.rejects(async () =>
      f.journal.append({
        ...r.completion,
        receipt: {
          ...r.completion.receipt,
          result: { ...r.completion.receipt.result, [field]: "0".repeat(64) },
        },
      }),
    );
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    dispatched,
  );
  await f.journal.append(r.completion);
});

import { nativeAgentRegistrationId } from "../native-agents-protocol.mjs";
const AGENT_FEATURE = "configuration_agents_v1";
function agentJournalRecords() {
  const key = { runtimeEpoch: "original", operationId: "runtime-register" };
  const target = {
    sourceName: "review",
    nativeId: nativeAgentRegistrationId({
      ...key,
      workspaceId: "ws",
      sourceName: "review",
    }),
    digest: "b".repeat(64),
    nativeDigest: "c".repeat(64),
    systemDigest: "d".repeat(64),
    registrationRuntimeEpoch: key.runtimeEpoch,
    registrationOperationId: key.operationId,
  };
  const agentRuntime = {
    sourceName: target.sourceName,
    nativeId: target.nativeId,
    digest: target.digest,
    version: "e".repeat(64),
    directoryVersion: "f".repeat(64),
  };
  return {
    marker: {
      kind: "feature_gate",
      feature: AGENT_FEATURE,
      revision: 1,
    },
    admitted: {
      kind: "admission",
      revision: 2,
      identity: {
        ...key,
        type: "configuration.agent.register",
        workspaceId: "ws",
        digest: "a".repeat(64),
      },
      agentRuntime,
    },
    dispatch: {
      kind: "dispatch",
      ...key,
      revision: 3,
      step: "native.agent.register",
      agentRuntime: target,
    },
    completion: {
      kind: "completion",
      ...key,
      revision: 4,
      receipt: {
        ...key,
        type: "configuration.agent.register",
        workspaceId: "ws",
        revision: 4,
        admission: "dispatched",
        delivery: "accepted",
        effect: "confirmed",
        evidence: [],
        result: {
          kind: "agent_registered",
          workspaceId: "ws",
          ...target,
          defaultAgentId: "build",
          version: agentRuntime.version,
          directoryVersion: agentRuntime.directoryVersion,
        },
      },
      delta: { workspaces: [], sessions: [], tombstones: [] },
    },
  };
}

for (const mode of [
  "marker-tail",
  "marker-checkpoint-zero-operations",
  "confirmed-checkpoint-zero-retained",
]) {
  test(`Native Agent runtime saved actual prechange parser refuses ${mode} without any writes`, async (t) => {
    const f = await fixture(t),
      r = agentJournalRecords();
    await f.journal.append(r.marker);
    if (mode.startsWith("confirmed"))
      for (const p of [r.admitted, r.dispatch, r.completion])
        await f.journal.append(p);
    if (mode !== "marker-tail") await f.journal.checkpoint();
    await f.journal.close();
    const base = new URL(
      "../../../../docs/runs/configuration-agents/evidence/prechange/",
      import.meta.url,
    );
    const manifest = JSON.parse(
      await fs.readFile(new URL("legacy-parser-closure.json", base), "utf8"),
    );
    const bundle = new URL("legacy-storage-journal.bundle.mjs", base);
    assert.equal(
      manifest.sha256,
      "b4ab19434bd655269b195724a58f03f0e2011ee835d46d73470d748efe9062a1",
    );
    assert.equal(
      createHash("sha256")
        .update(await fs.readFile(bundle))
        .digest("hex"),
      manifest.sha256,
    );
    const names = (await fs.readdir(f.directory)).sort();
    const bytes = await Promise.all(
      names.map((name) => fs.readFile(join(f.directory, name))),
    );
    const { openStorageJournal: openLegacy } = await import(bundle.href);
    const legacy = await openLegacy({
      directory: f.directory,
      storeId: "store",
    });
    assert.equal(legacy.status().reason, "unsupported_version");
    await assert.rejects(legacy.checkpoint(), { code: "unsupported_version" });
    await assert.rejects(async () => legacy.append(r.marker), {
      code: "unsupported_version",
    });
    await legacy.close();
    assert.deepEqual((await fs.readdir(f.directory)).sort(), names);
    assert.deepEqual(
      await Promise.all(
        names.map((name) => fs.readFile(join(f.directory, name))),
      ),
      bytes,
    );
    const current = await openStorageJournal({
      directory: f.directory,
      storeId: "store",
    });
    t.after(() => current.close());
    assert.equal(
      current.status().state,
      mode === "marker-tail" ? "recovery_required" : "ready",
    );
  });
}

test("Native Agent runtime journal requires feature, original targets and flushed exact result before bytes", async (t) => {
  const f = await fixture(t),
    r = agentJournalRecords();
  await assert.rejects(f.journal.append({ ...r.admitted, revision: 1 }), {
    code: "unsupported_version",
  });
  await f.journal.append(r.marker);
  await f.journal.append(r.admitted);
  const before = await fs.readFile(join(f.directory, "journal.jsonl"));
  for (const payload of [
    { ...r.dispatch, step: "native.send" },
    { ...r.dispatch, nativeSessionId: "forbidden" },
    {
      ...r.dispatch,
      agentRuntime: { ...r.dispatch.agentRuntime, digest: "0".repeat(64) },
    },
    {
      ...r.dispatch,
      agentRuntime: { ...r.dispatch.agentRuntime, body: "PRIVATE" },
    },
    {
      ...r.completion,
      revision: 3,
      receipt: { ...r.completion.receipt, revision: 3 },
    },
  ])
    await assert.rejects(async () => f.journal.append(payload));
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    before,
  );
  await f.journal.append(r.dispatch);
  const dispatched = await fs.readFile(join(f.directory, "journal.jsonl"));
  for (const field of [
    "digest",
    "nativeDigest",
    "systemDigest",
    "version",
    "directoryVersion",
  ])
    await assert.rejects(async () =>
      f.journal.append({
        ...r.completion,
        receipt: {
          ...r.completion.receipt,
          result: { ...r.completion.receipt.result, [field]: "0".repeat(64) },
        },
      }),
    );
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    dispatched,
  );
  await f.journal.append(r.completion);
});

test("AGENT file journal requires feature before private admission and forbids name on other types", async (t) => {
  const f = await fixture(t);
  const payload = {
    ...admission(),
    agentSourceName: "review",
    identity: {
      ...admission().identity,
      type: "configuration.agent.save",
      workspaceId: "ws",
    },
  };
  assert.throws(() =>
    validateJournalPayload({ ...payload, agentSourceName: "../escape" }),
  );
  assert.throws(() =>
    validateJournalPayload({ ...admission(), agentSourceName: "review" }),
  );
  assert.throws(() =>
    validateJournalPayload({
      ...payload,
      identity: { ...payload.identity, sessionId: "session" },
    }),
  );
  await assert.rejects(f.journal.append(payload), {
    code: "unsupported_version",
  });
  await f.journal.append({
    kind: "feature_gate",
    feature: "configuration_agents_v1",
    revision: 1,
  });
  await f.journal.append({ ...payload, revision: 2 });
  assert.equal(f.journal.status().state, "ready");
});

function agentFileJournalRecords() {
  const key = { runtimeEpoch: "original", operationId: "op" };
  const marker = {
    kind: "feature_gate",
    feature: "configuration_agents_v1",
    revision: 1,
  };
  const admitted = {
    ...admission(),
    revision: 2,
    agentSourceName: "review",
    identity: {
      ...admission().identity,
      type: "configuration.agent.save",
      workspaceId: "ws",
    },
  };
  const stage = {
    kind: "dispatch",
    ...key,
    revision: 3,
    step: "filesystem.configuration.stage",
  };
  const publish = {
    ...stage,
    revision: 4,
    step: "filesystem.configuration.publish",
  };
  const completion = {
    kind: "completion",
    ...key,
    revision: 5,
    receipt: {
      ...completionReceipt(),
      type: "configuration.agent.save",
      workspaceId: "ws",
      revision: 5,
      admission: "dispatched",
      delivery: "accepted",
      effect: "confirmed",
      result: {
        kind: "agent_file_saved",
        workspaceId: "ws",
        sourceName: "review",
        version: "a".repeat(64),
      },
    },
    delta: { workspaces: [], sessions: [], tombstones: [] },
  };
  return { marker, admitted, stage, publish, completion };
}

test("AGENT file parser binds successful result to original name and rejects reservation/native dispatch before append", async (t) => {
  const f = await fixture(t),
    r = agentFileJournalRecords();
  await f.journal.append(r.marker);
  await f.journal.append(r.admitted);
  const reservation = {
    kind: "reservation",
    runtimeEpoch: "original",
    operationId: "op",
    revision: 3,
    appSessionId: "session",
    workspace: {
      workspaceId: "ws",
      ownership: "imported",
      canonicalPath: "/synthetic",
      registrationState: "reserved",
    },
  };
  validateJournalPayload(reservation); // Valid shape; rejection must come from the Agent relationship.
  const before = await fs.readFile(join(f.directory, "journal.jsonl"));
  for (const payload of [
    reservation,
    { ...r.publish, revision: 3 },
    { ...r.stage, step: "native.send" },
    { ...r.stage, nativeSessionId: "session" },
  ])
    await assert.rejects(f.journal.append(payload), {
      code: "identity_conflict",
    });
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    before,
  );
  await f.journal.append(r.stage);
  await f.journal.append(r.publish);
  const staged = await fs.readFile(join(f.directory, "journal.jsonl"));
  for (const change of [
    {
      receipt: {
        ...r.completion.receipt,
        result: { ...r.completion.receipt.result, sourceName: "other" },
      },
    },
    {
      delta: {
        ...r.completion.delta,
        tombstones: [{ kind: "workspace", id: "ws" }],
      },
    },
  ])
    await assert.rejects(f.journal.append({ ...r.completion, ...change }), {
      code: "identity_conflict",
    });
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    staged,
  );
  await f.journal.append(r.completion);
});

const workspaceFileJournalRecords = () => {
  const fileTarget = {
    path: "src/example.txt",
    version: "b".repeat(64),
    directoryVersion: "c".repeat(64),
  };
  const identity = {
    runtimeEpoch: "original",
    operationId: "save",
    type: "file.save",
    workspaceId: "workspace",
    digest: "a".repeat(64),
  };
  return {
    marker: {
      kind: "feature_gate",
      feature: "workspace_file_save_v1",
      revision: 1,
    },
    admitted: { kind: "admission", identity, fileTarget, revision: 2 },
    stage: {
      kind: "dispatch",
      runtimeEpoch: "original",
      operationId: "save",
      step: "filesystem.configuration.stage",
      fileTarget,
      revision: 3,
    },
    publish: {
      kind: "dispatch",
      runtimeEpoch: "original",
      operationId: "save",
      step: "filesystem.configuration.publish",
      fileTarget,
      revision: 4,
    },
  };
};
test("FILE journal refuses missing feature and target proof without appending bytes", async (t) => {
  const f = await fixture(t);
  const r = workspaceFileJournalRecords();
  const before = await fs.readFile(join(f.directory, "journal.jsonl"));
  await assert.rejects(f.journal.append({ ...r.admitted, revision: 1 }), {
    code: "unsupported_version",
  });
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    before,
  );
  await f.journal.append(r.marker);
  await f.journal.append(r.admitted);
  const admittedBytes = await fs.readFile(join(f.directory, "journal.jsonl"));
  for (const payload of [
    { ...r.stage, fileTarget: undefined },
    { ...r.stage, fileTarget: { ...r.stage.fileTarget, path: "other.txt" } },
    { ...r.stage, fileTarget: { ...r.stage.fileTarget, text: "PRIVATE" } },
    { ...r.stage, step: "native.send" },
    { ...r.publish, revision: 3 },
  ])
    await assert.rejects(async () => f.journal.append(payload));
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    admittedBytes,
  );
  await f.journal.append(r.stage);
  await f.journal.append(r.publish);
});
test("FILE actual archived 18-file parser closure refuses the new journal and preserves every store byte", async (t) => {
  const base = new URL(
    "../../../../docs/runs/workspace-file-editing/evidence/prechange/",
    import.meta.url,
  );
  const manifest = JSON.parse(
    await fs.readFile(new URL("legacy-source-manifest.json", base), "utf8"),
  );
  assert.equal(Object.keys(manifest.files).length, 18);
  let bytes = 0;
  for (const [name, expected] of Object.entries(manifest.files)) {
    const content = await fs.readFile(new URL(`legacy-source/${name}`, base));
    assert.equal(content.length, expected.bytes, name);
    assert.equal(
      createHash("sha256").update(content).digest("hex"),
      expected.sha256,
      name,
    );
    bytes += content.length;
  }
  assert.equal(bytes, 231307);
  const {
    openStorageJournal: openLegacy,
    validateJournalPayload: validateLegacy,
  } = await import(
    new URL("legacy-source/apps/desktop-app/src/host/storage-journal.mjs", base)
      .href
  );
  const r = workspaceFileJournalRecords();
  assert.throws(() => validateLegacy(r.marker), {
    code: "unsupported_version",
  });
  const f = await fixture(t);
  for (const payload of Object.values(r)) await f.journal.append(payload);
  await f.journal.checkpoint();
  await f.journal.close();
  const names = (await fs.readdir(f.directory)).sort();
  const before = await Promise.all(
    names.map((name) => fs.readFile(join(f.directory, name))),
  );
  const legacy = await openLegacy({ directory: f.directory, storeId: "store" });
  assert.equal(legacy.status().state, "recovery_required");
  assert.equal(legacy.status().reason, "unsupported_version");
  await assert.rejects(legacy.checkpoint(), { code: "unsupported_version" });
  await assert.rejects(async () => legacy.append(r.marker), {
    code: "unsupported_version",
  });
  await assert.rejects(async () => legacy.append(r.admitted), {
    code: "invalid_record",
  });
  await legacy.close();
  assert.deepEqual((await fs.readdir(f.directory)).sort(), names);
  assert.deepEqual(
    await Promise.all(
      names.map((name) => fs.readFile(join(f.directory, name))),
    ),
    before,
  );
});

const indexJournalRecords = (exists = true) => {
  const gitIndexTarget = {
    action: "stage",
    paths: ["src/example.txt"],
    previewDigest: "b".repeat(64),
    headOid: null,
    indexExists: exists,
    indexDigest: exists
      ? "c".repeat(64)
      : "1e805e1eec918accfc6bba36e68b1a5f77c81ec7f1a7a90ed99b688b7b141eae",
    nextIndexDigest: "d".repeat(64),
    objectFormat: "sha1",
  };
  const identity = {
    runtimeEpoch: "original",
    operationId: "index",
    type: "git.index.apply",
    workspaceId: "workspace",
    digest: "a".repeat(64),
  };
  const key = {
    runtimeEpoch: identity.runtimeEpoch,
    operationId: identity.operationId,
  };
  return {
    marker: {
      kind: "feature_gate",
      feature: "git_index_mutation_v1",
      revision: 1,
    },
    admitted: { kind: "admission", identity, gitIndexTarget, revision: 2 },
    stage: {
      kind: "dispatch",
      ...key,
      step: "filesystem.git.index.stage",
      gitIndexTarget,
      revision: 3,
    },
    publish: {
      kind: "dispatch",
      ...key,
      step: "filesystem.git.index.publish",
      gitIndexTarget,
      revision: 4,
    },
    completion: {
      kind: "completion",
      ...key,
      revision: 5,
      receipt: {
        ...key,
        type: identity.type,
        workspaceId: identity.workspaceId,
        admission: "dispatched",
        delivery: "accepted",
        effect: "confirmed",
        revision: 5,
        evidence: [],
        result: {
          kind: "git_index_updated",
          workspaceId: identity.workspaceId,
          action: gitIndexTarget.action,
          paths: [...gitIndexTarget.paths],
          indexDigest: gitIndexTarget.nextIndexDigest,
          previewDigest: gitIndexTarget.previewDigest,
          digest: identity.digest,
          backupId: exists
            ? `.omoc-git-index-${createHash("sha256")
                .update(
                  JSON.stringify([identity.runtimeEpoch, identity.operationId]),
                )
                .digest("hex")}.backup`
            : null,
        },
      },
      delta: { workspaces: [], sessions: [], tombstones: [] },
    },
  };
};
test("GI journal rejects feature, target, step, result and backup forgery before append", async (t) => {
  for (const exists of [true, false]) {
    const f = await fixture(t);
    const r = indexJournalRecords(exists);
    const before = await fs.readFile(join(f.directory, "journal.jsonl"));
    await assert.rejects(f.journal.append({ ...r.admitted, revision: 1 }), {
      code: "unsupported_version",
    });
    assert.deepEqual(
      await fs.readFile(join(f.directory, "journal.jsonl")),
      before,
    );
    await f.journal.append(r.marker);
    await f.journal.append(r.admitted);
    const admittedBytes = await fs.readFile(join(f.directory, "journal.jsonl"));
    for (const bad of [
      { ...r.stage, gitIndexTarget: undefined },
      {
        ...r.stage,
        gitIndexTarget: {
          ...r.stage.gitIndexTarget,
          nextIndexDigest: "f".repeat(64),
        },
      },
      {
        ...r.stage,
        gitIndexTarget: {
          ...r.stage.gitIndexTarget,
          privateArtifact: undefined,
        },
      },
      { ...r.stage, nativeSessionId: "native" },
      { ...r.stage, step: "native.send" },
      { ...r.publish, revision: 3 },
    ])
      await assert.rejects(async () => f.journal.append(bad));
    assert.deepEqual(
      await fs.readFile(join(f.directory, "journal.jsonl")),
      admittedBytes,
    );
    await f.journal.append(r.stage);
    await assert.rejects(f.journal.append({ ...r.stage, revision: 4 }));
    await f.journal.append(r.publish);
    const published = await fs.readFile(join(f.directory, "journal.jsonl"));
    for (const patch of [
      { indexDigest: "f".repeat(64) },
      { digest: "f".repeat(64) },
      { paths: ["other.txt"] },
      { previewDigest: "f".repeat(64) },
      {
        backupId: exists
          ? null
          : indexJournalRecords().completion.receipt.result.backupId,
      },
    ])
      await assert.rejects(async () =>
        f.journal.append({
          ...r.completion,
          receipt: {
            ...r.completion.receipt,
            result: { ...r.completion.receipt.result, ...patch },
          },
        }),
      );
    assert.deepEqual(
      await fs.readFile(join(f.directory, "journal.jsonl")),
      published,
    );
    await f.journal.append(r.completion);
    await f.journal.checkpoint();
    await f.journal.close();
    const reopened = await openStorageJournal({
      directory: f.directory,
      storeId: "store",
    });
    t.after(() => reopened.close());
    assert.equal(reopened.status().state, "ready");
  }
});
test("GI journal refuses upgrading a completed unknown original operation", async (t) => {
  const f = await fixture(t),
    r = indexJournalRecords();
  for (const p of [r.marker, r.admitted, r.stage, r.publish])
    await f.journal.append(p);
  const unknown = globalThis.structuredClone(r.completion);
  unknown.receipt.effect = "unknown";
  unknown.receipt.delivery = "unknown";
  delete unknown.receipt.result;
  await f.journal.append(unknown);
  await assert.rejects(
    f.journal.append({
      ...r.completion,
      revision: 6,
      receipt: { ...r.completion.receipt, revision: 6 },
    }),
  );
  await f.journal.checkpoint();
  await f.journal.close();
  const reopened = await openStorageJournal({
    directory: f.directory,
    storeId: "store",
  });
  t.after(() => reopened.close());
  await assert.rejects(
    reopened.append({
      ...r.completion,
      revision: 6,
      receipt: { ...r.completion.receipt, revision: 6 },
    }),
  );
});
for (const mode of ["marker-tail", "marker-checkpoint", "completed-checkpoint"])
  test(`GI actual archived 19-file parser refuses ${mode} and preserves every store byte`, async (t) => {
    const base = new URL(
      "../../../../docs/runs/git-index-mutations/evidence/prechange/",
      import.meta.url,
    );
    const manifest = JSON.parse(
      await fs.readFile(new URL("legacy-closure.json", base), "utf8"),
    );
    assert.equal(Object.keys(manifest.files).length, 19);
    for (const [name, expected] of Object.entries(manifest.files)) {
      const bytes = await fs.readFile(new URL(`legacy-source/${name}`, base));
      assert.equal(bytes.length, expected.bytes, name);
      assert.equal(
        createHash("sha256").update(bytes).digest("hex"),
        expected.sha256,
        name,
      );
    }
    const bundle = new URL("legacy-storage-journal.bundle.mjs", base),
      bytes = await fs.readFile(bundle);
    assert.equal(bytes.length, manifest.bundle.bytes);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      manifest.bundle.sha256,
    );
    const {
      openStorageJournal: openLegacy,
      validateJournalPayload: validateLegacy,
    } = await import(bundle.href);
    const r = indexJournalRecords();
    assert.throws(() => validateLegacy(r.marker), {
      code: "unsupported_version",
    });
    const f = await fixture(t);
    await f.journal.append(r.marker);
    if (mode === "completed-checkpoint")
      for (const p of [r.admitted, r.stage, r.publish, r.completion])
        await f.journal.append(p);
    if (mode !== "marker-tail") await f.journal.checkpoint();
    await f.journal.close();
    const names = (await fs.readdir(f.directory)).sort();
    const before = await Promise.all(
      names.map((n) => fs.readFile(join(f.directory, n))),
    );
    const legacy = await openLegacy({
      directory: f.directory,
      storeId: "store",
    });
    assert.equal(legacy.status().reason, "unsupported_version");
    await assert.rejects(legacy.checkpoint(), { code: "unsupported_version" });
    await assert.rejects(async () => legacy.append(r.marker), {
      code: "unsupported_version",
    });
    await legacy.close();
    assert.deepEqual((await fs.readdir(f.directory)).sort(), names);
    assert.deepEqual(
      await Promise.all(names.map((n) => fs.readFile(join(f.directory, n)))),
      before,
    );
  });
test("GI nested receipt and envelope descriptors are rejected without invoking getters", () => {
  let calls = 0;
  const r = indexJournalRecords();
  const payload = { ...r.admitted };
  Object.defineProperty(payload, "kind", {
    enumerable: true,
    get() {
      calls++;
      return "admission";
    },
  });
  assert.throws(() => validateJournalPayload(payload));
  const evidence = [{ kind: "publication" }];
  Object.defineProperty(evidence, "0", {
    enumerable: true,
    get() {
      calls++;
      return { kind: "publication" };
    },
  });
  assert.throws(() =>
    validateStorageReceipt({ ...r.completion.receipt, evidence }),
  );
  const result = { ...r.completion.receipt.result };
  Object.defineProperty(result, "kind", {
    enumerable: true,
    get() {
      calls++;
      return "git_index_updated";
    },
  });
  assert.throws(() =>
    validateStorageReceipt({ ...r.completion.receipt, result }),
  );
  const delta = { workspaces: [], sessions: [], tombstones: [] };
  delta.workspaces[Symbol("hidden")] = "private";
  assert.throws(() => validateRegistryDelta(delta));
  assert.equal(calls, 0);
});

import { gitCommitExpectedBackups } from "./git-commit-contract.mjs";
const commitStorageTarget = (exists = true) => ({
  objectFormat: "sha1",
  previewDigest: "b".repeat(64),
  indexDigest: "c".repeat(64),
  headOid: "1".repeat(40),
  treeOid: "2".repeat(40),
  treeDigest: "d".repeat(64),
  commitOid: "3".repeat(40),
  commitBodyDigest: "e".repeat(64),
  reference: {
    kind: "branch",
    name: "refs/heads/main",
    exists,
    digest: exists
      ? "a".repeat(64)
      : "f3560bbc703230ea0f066682a64be64c85613c9fd03cc4fb1f0cb8af9642818d",
    nextDigest: "f".repeat(64),
  },
  logs: [
    {
      role: "head_log",
      exists,
      digest: exists
        ? "a".repeat(64)
        : "f3560bbc703230ea0f066682a64be64c85613c9fd03cc4fb1f0cb8af9642818d",
      nextDigest: "9".repeat(64),
      nextBytes: 128,
    },
  ],
});
const commitJournalRecords = (exists = true) => {
  const gitCommitTarget = commitStorageTarget(exists);
  const identity = {
    runtimeEpoch: "original",
    operationId: "index",
    type: "git.commit.apply",
    workspaceId: "workspace",
    digest: "a".repeat(64),
  };
  const key = {
    runtimeEpoch: identity.runtimeEpoch,
    operationId: identity.operationId,
  };
  return {
    marker: {
      kind: "feature_gate",
      feature: "git_commit_mutation_v1",
      revision: 1,
    },
    admitted: {
      kind: "admission",
      identity,
      gitCommitTarget,
      expectedRevision: 0,
      revision: 2,
    },
    stage: {
      kind: "dispatch",
      ...key,
      step: "filesystem.git.commit.stage",
      gitCommitTarget,
      revision: 3,
    },
    publish: {
      kind: "dispatch",
      ...key,
      step: "filesystem.git.commit.publish",
      gitCommitTarget,
      revision: 4,
    },
    completion: {
      kind: "completion",
      ...key,
      revision: 5,
      receipt: {
        ...key,
        type: identity.type,
        workspaceId: identity.workspaceId,
        admission: "dispatched",
        delivery: "accepted",
        effect: "confirmed",
        revision: 5,
        evidence: [],
        result: {
          kind: "git_commit_created",
          workspaceId: identity.workspaceId,
          commitOid: gitCommitTarget.commitOid,
          treeOid: gitCommitTarget.treeOid,
          parentOid: gitCommitTarget.headOid,
          referenceDigest: gitCommitTarget.reference.nextDigest,
          logDigests: gitCommitTarget.logs.map((x) => ({
            role: x.role,
            digest: x.nextDigest,
          })),
          previewDigest: gitCommitTarget.previewDigest,
          digest: identity.digest,
          backups: gitCommitExpectedBackups(
            gitCommitTarget,
            identity.runtimeEpoch,
            identity.operationId,
          ),
        },
      },
      delta: { workspaces: [], sessions: [], tombstones: [] },
    },
  };
};
test("GC journal rejects feature, target, step, result and backup forgery before append", async (t) => {
  for (const exists of [true, false]) {
    const f = await fixture(t);
    const r = commitJournalRecords(exists);
    const before = await fs.readFile(join(f.directory, "journal.jsonl"));
    await assert.rejects(f.journal.append({ ...r.admitted, revision: 1 }), {
      code: "unsupported_version",
    });
    assert.deepEqual(
      await fs.readFile(join(f.directory, "journal.jsonl")),
      before,
    );
    await f.journal.append(r.marker);
    await f.journal.append(r.admitted);
    const admittedBytes = await fs.readFile(join(f.directory, "journal.jsonl"));
    for (const bad of [
      { ...r.stage, gitCommitTarget: undefined },
      {
        ...r.stage,
        gitCommitTarget: {
          ...r.stage.gitCommitTarget,
          commitOid: "f".repeat(40),
        },
      },
      {
        ...r.stage,
        gitCommitTarget: {
          ...r.stage.gitCommitTarget,
          privateArtifact: undefined,
        },
      },
      { ...r.stage, nativeSessionId: "native" },
      { ...r.stage, step: "native.send" },
      { ...r.publish, revision: 3 },
    ])
      await assert.rejects(async () => f.journal.append(bad));
    assert.deepEqual(
      await fs.readFile(join(f.directory, "journal.jsonl")),
      admittedBytes,
    );
    await f.journal.append(r.stage);
    await assert.rejects(f.journal.append({ ...r.stage, revision: 4 }));
    await f.journal.append(r.publish);
    const published = await fs.readFile(join(f.directory, "journal.jsonl"));
    for (const patch of [
      { referenceDigest: "a".repeat(64) },
      { digest: "f".repeat(64) },
      { parentOid: null },
      { previewDigest: "f".repeat(64) },
      { backups: [{ role: "branch_ref", backupId: null }] },
    ])
      await assert.rejects(async () =>
        f.journal.append({
          ...r.completion,
          receipt: {
            ...r.completion.receipt,
            result: { ...r.completion.receipt.result, ...patch },
          },
        }),
      );
    assert.deepEqual(
      await fs.readFile(join(f.directory, "journal.jsonl")),
      published,
    );
    await f.journal.append(r.completion);
    await f.journal.checkpoint();
    await f.journal.close();
    const reopened = await openStorageJournal({
      directory: f.directory,
      storeId: "store",
    });
    t.after(() => reopened.close());
    assert.equal(reopened.status().state, "ready");
  }
});
test("GC journal refuses upgrading a completed unknown original operation", async (t) => {
  const f = await fixture(t),
    r = commitJournalRecords();
  for (const p of [r.marker, r.admitted, r.stage, r.publish])
    await f.journal.append(p);
  const unknown = globalThis.structuredClone(r.completion);
  unknown.receipt.effect = "unknown";
  unknown.receipt.delivery = "unknown";
  delete unknown.receipt.result;
  await f.journal.append(unknown);
  await assert.rejects(
    f.journal.append({
      ...r.completion,
      revision: 6,
      receipt: { ...r.completion.receipt, revision: 6 },
    }),
  );
  await f.journal.checkpoint();
  await f.journal.close();
  const reopened = await openStorageJournal({
    directory: f.directory,
    storeId: "store",
  });
  t.after(() => reopened.close());
  await assert.rejects(
    reopened.append({
      ...r.completion,
      revision: 6,
      receipt: { ...r.completion.receipt, revision: 6 },
    }),
  );
});
for (const mode of ["marker-tail", "marker-checkpoint", "completed-checkpoint"])
  test(`GC actual archived 21-file parser refuses ${mode} and preserves every store byte`, async (t) => {
    const base = new URL(
      "../../../../docs/runs/git-explicit-commit/evidence/prechange/",
      import.meta.url,
    );
    const manifest = JSON.parse(
      await fs.readFile(new URL("legacy-closure.json", base), "utf8"),
    );
    assert.equal(Object.keys(manifest.files).length, 21);
    for (const [name, expected] of Object.entries(manifest.files)) {
      const bytes = await fs.readFile(new URL(`legacy-source/${name}`, base));
      assert.equal(bytes.length, expected.bytes, name);
      assert.equal(
        createHash("sha256").update(bytes).digest("hex"),
        expected.sha256,
        name,
      );
    }
    const bundle = new URL("legacy-storage-journal.bundle.mjs", base),
      bytes = await fs.readFile(bundle);
    assert.equal(bytes.length, manifest.bundle.bytes);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      manifest.bundle.sha256,
    );
    const {
      openStorageJournal: openLegacy,
      validateJournalPayload: validateLegacy,
    } = await import(bundle.href);
    const r = commitJournalRecords();
    assert.throws(() => validateLegacy(r.marker), {
      code: "unsupported_version",
    });
    const f = await fixture(t);
    await f.journal.append(r.marker);
    if (mode === "completed-checkpoint")
      for (const p of [r.admitted, r.stage, r.publish, r.completion])
        await f.journal.append(p);
    if (mode !== "marker-tail") await f.journal.checkpoint();
    await f.journal.close();
    const names = (await fs.readdir(f.directory)).sort();
    const before = await Promise.all(
      names.map((n) => fs.readFile(join(f.directory, n))),
    );
    const legacy = await openLegacy({
      directory: f.directory,
      storeId: "store",
    });
    assert.equal(legacy.status().reason, "unsupported_version");
    await assert.rejects(legacy.checkpoint(), { code: "unsupported_version" });
    await assert.rejects(async () => legacy.append(r.marker), {
      code: "unsupported_version",
    });
    await legacy.close();
    assert.deepEqual((await fs.readdir(f.directory)).sort(), names);
    assert.deepEqual(
      await Promise.all(names.map((n) => fs.readFile(join(f.directory, n)))),
      before,
    );
  });
test("GC nested receipt and envelope descriptors are rejected without invoking getters", () => {
  let calls = 0;
  const r = commitJournalRecords();
  const payload = { ...r.admitted };
  Object.defineProperty(payload, "kind", {
    enumerable: true,
    get() {
      calls++;
      return "admission";
    },
  });
  assert.throws(() => validateJournalPayload(payload));
  const evidence = [{ kind: "publication" }];
  Object.defineProperty(evidence, "0", {
    enumerable: true,
    get() {
      calls++;
      return { kind: "publication" };
    },
  });
  assert.throws(() =>
    validateStorageReceipt({ ...r.completion.receipt, evidence }),
  );
  const result = { ...r.completion.receipt.result };
  Object.defineProperty(result, "kind", {
    enumerable: true,
    get() {
      calls++;
      return "git_commit_created";
    },
  });
  assert.throws(() =>
    validateStorageReceipt({ ...r.completion.receipt, result }),
  );
  const delta = { workspaces: [], sessions: [], tombstones: [] };
  delta.workspaces[Symbol("hidden")] = "private";
  assert.throws(() => validateRegistryDelta(delta));
  assert.equal(calls, 0);
});

test("BR feature marker is a supported durable record", () => {
  assert.deepEqual(
    validateJournalPayload({
      kind: "feature_gate",
      feature: "git_branch_restore_mutation_v1",
      revision: 1,
    }),
    {
      kind: "feature_gate",
      feature: "git_branch_restore_mutation_v1",
      revision: 1,
    },
  );
});

import { gitBranchRestoreExpectedBackups } from "./git-branch-restore-contract.mjs";
function brStorageTarget(action = "restore", format = "sha1", exists = true) {
  const oid = "1".repeat(format === "sha1" ? 40 : 64);
  const before = exists
    ? { bytes: 3, digest: "a".repeat(64), mode: 0o600 }
    : null;
  return {
    action,
    objectFormat: format,
    previewDigest: "b".repeat(64),
    occupancyDigest: "c".repeat(64),
    branch: action === "restore" ? null : "refs/heads/topic",
    source: action === "restore" ? "index" : null,
    currentBranch: "refs/heads/main",
    headOid: oid,
    nextHeadOid: oid,
    treeOid: oid,
    headDigest: "d".repeat(64),
    indexExists: true,
    indexDigest: "e".repeat(64),
    identityDigest: action === "restore" ? null : "f".repeat(64),
    timestamp: action === "restore" ? null : 1,
    paths:
      action === "create"
        ? []
        : [
            {
              path: "src/a.txt",
              before,
              after: { bytes: 4, digest: "9".repeat(64), mode: 0o600 },
              beforeEntry: { mode: 0o100644, oid },
              afterEntry: { mode: 0o100644, oid },
              ident: false,
            },
          ],
    metadata:
      action === "restore"
        ? []
        : action === "create"
          ? [
              {
                role: "branch_ref",
                before: null,
                after: { bytes: 41, digest: "8".repeat(64) },
              },
            ]
          : [
              {
                role: "index",
                before: { bytes: 12, digest: "e".repeat(64) },
                after: { bytes: 12, digest: "8".repeat(64) },
              },
              {
                role: "head_ref",
                before: { bytes: 20, digest: "d".repeat(64) },
                after: { bytes: 21, digest: "7".repeat(64) },
              },
            ],
  };
}

function brJournalRecords(action = "restore", format = "sha1", exists = true) {
  const gitBranchRestoreTarget = brStorageTarget(action, format, exists);
  const identity = {
    runtimeEpoch: "original",
    operationId: "branch-restore",
    type: action === "restore" ? "git.restore.apply" : "git.branch.apply",
    workspaceId: "workspace",
    digest: "a".repeat(64),
  };
  const key = {
    runtimeEpoch: identity.runtimeEpoch,
    operationId: identity.operationId,
  };
  return {
    marker: {
      kind: "feature_gate",
      feature: "git_branch_restore_mutation_v1",
      revision: 1,
    },
    admitted: {
      kind: "admission",
      identity,
      gitBranchRestoreTarget,
      expectedRevision: 0,
      revision: 2,
    },
    stage: {
      kind: "dispatch",
      ...key,
      step: "filesystem.git.branch_restore.stage",
      gitBranchRestoreTarget,
      revision: 3,
    },
    publish: {
      kind: "dispatch",
      ...key,
      step: "filesystem.git.branch_restore.publish",
      gitBranchRestoreTarget,
      revision: 4,
    },
    completion: {
      kind: "completion",
      ...key,
      revision: 5,
      receipt: {
        ...key,
        type: identity.type,
        workspaceId: identity.workspaceId,
        admission: "dispatched",
        delivery: "accepted",
        effect: "confirmed",
        revision: 5,
        evidence: [],
        result: {
          kind: "git_branch_restore_applied",
          workspaceId: identity.workspaceId,
          action,
          previewDigest: gitBranchRestoreTarget.previewDigest,
          paths: gitBranchRestoreTarget.paths.map((x) => ({
            path: x.path,
            after: x.after,
          })),
          metadata: gitBranchRestoreTarget.metadata.map((x) => ({
            role: x.role,
            digest: x.after.digest,
          })),
          backups: gitBranchRestoreExpectedBackups(
            gitBranchRestoreTarget,
            identity.runtimeEpoch,
            identity.operationId,
          ),
          digest: identity.digest,
        },
      },
      delta: { workspaces: [], sessions: [], tombstones: [] },
    },
  };
}
for (const mode of ["marker-tail", "marker-checkpoint", "completed-checkpoint"])
  test(`BR actual archived 24-file parser refuses ${mode} and preserves every store byte`, async (t) => {
    const base = new URL(
      "../../../../docs/runs/git-branch-restore/evidence/prechange/",
      import.meta.url,
    );
    const manifest = JSON.parse(
      await fs.readFile(new URL("legacy-closure.json", base), "utf8"),
    );
    assert.equal(Object.keys(manifest.files).length, 24);
    for (const [name, expected] of Object.entries(manifest.files)) {
      const bytes = await fs.readFile(new URL(`legacy-source/${name}`, base));
      assert.equal(bytes.length, expected.bytes, name);
      assert.equal(
        createHash("sha256").update(bytes).digest("hex"),
        expected.sha256,
        name,
      );
    }
    const bundle = new URL("legacy-storage-journal.bundle.mjs", base),
      bytes = await fs.readFile(bundle);
    assert.equal(bytes.length, manifest.bundle.bytes);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      manifest.bundle.sha256,
    );
    const {
      openStorageJournal: openLegacy,
      validateJournalPayload: validateLegacy,
    } = await import(bundle.href);
    const r = brJournalRecords();
    assert.throws(() => validateLegacy(r.marker), {
      code: "unsupported_version",
    });
    const f = await fixture(t);
    await f.journal.append(r.marker);
    if (mode === "completed-checkpoint")
      for (const p of [r.admitted, r.stage, r.publish, r.completion])
        await f.journal.append(p);
    if (mode !== "marker-tail") await f.journal.checkpoint();
    await f.journal.close();
    const names = (await fs.readdir(f.directory)).sort();
    const before = await Promise.all(
      names.map((n) => fs.readFile(join(f.directory, n))),
    );
    const legacy = await openLegacy({
      directory: f.directory,
      storeId: "store",
    });
    assert.equal(legacy.status().reason, "unsupported_version");
    await assert.rejects(legacy.checkpoint(), { code: "unsupported_version" });
    await assert.rejects(async () => legacy.append(r.marker), {
      code: "unsupported_version",
    });
    await legacy.close();
    assert.deepEqual((await fs.readdir(f.directory)).sort(), names);
    assert.deepEqual(
      await Promise.all(names.map((n) => fs.readFile(join(f.directory, n)))),
      before,
    );
  });

test("BR journal all actions and formats bind target, ordered steps, empty delta and original-key result before append", async (t) => {
  for (const action of ["create", "select", "restore"])
    for (const format of ["sha1", "sha256"]) {
      const f = await fixture(t),
        r = brJournalRecords(action, format);
      await assert.rejects(f.journal.append({ ...r.admitted, revision: 1 }), {
        code: "unsupported_version",
      });
      await f.journal.append(r.marker);
      await f.journal.append(r.admitted);
      let before = await fs.readFile(join(f.directory, "journal.jsonl"));
      for (const bad of [
        { ...r.publish, revision: 3 },
        {
          ...r.stage,
          gitBranchRestoreTarget: {
            ...r.stage.gitBranchRestoreTarget,
            previewDigest: "0".repeat(64),
          },
        },
        { ...r.stage, nativeSessionId: undefined },
        { ...r.stage, gitBranchRestoreTarget: undefined },
        { ...r.stage, step: "native.send" },
      ])
        await assert.rejects(async () => f.journal.append(bad));
      assert.deepEqual(
        await fs.readFile(join(f.directory, "journal.jsonl")),
        before,
      );
      await f.journal.append(r.stage);
      await f.journal.append(r.publish);
      before = await fs.readFile(join(f.directory, "journal.jsonl"));
      for (const patch of [
        { action: action === "create" ? "restore" : "create" },
        { digest: "0".repeat(64) },
        { previewDigest: "0".repeat(64) },
        { paths: [{ path: "forged", after: null }] },
        { backups: [{ role: "worktree", path: "forged", backupId: null }] },
        { metadata: [{ role: "index", digest: "0".repeat(64) }] },
      ])
        await assert.rejects(async () =>
          f.journal.append({
            ...r.completion,
            receipt: {
              ...r.completion.receipt,
              result: { ...r.completion.receipt.result, ...patch },
            },
          }),
        );
      await assert.rejects(
        f.journal.append({
          ...r.completion,
          delta: {
            ...r.completion.delta,
            tombstones: [{ kind: "workspace", id: "workspace" }],
          },
        }),
      );
      assert.deepEqual(
        await fs.readFile(join(f.directory, "journal.jsonl")),
        before,
      );
      await f.journal.append(r.completion);
      await f.journal.checkpoint();
      await f.journal.close();
      const reopened = await openStorageJournal({
        directory: f.directory,
        storeId: "store",
      });
      t.after(() => reopened.close());
      assert.equal(reopened.status().state, "ready");
    }
});
test("BR journal completed unknown cannot gain dispatch or confirmed status, including after checkpoint", async (t) => {
  const f = await fixture(t),
    r = brJournalRecords();
  for (const p of [r.marker, r.admitted, r.stage, r.publish])
    await f.journal.append(p);
  const unknown = globalThis.structuredClone(r.completion);
  unknown.receipt.delivery = "unknown";
  unknown.receipt.effect = "unknown";
  delete unknown.receipt.result;
  await f.journal.append(unknown);
  await assert.rejects(
    f.journal.append({
      ...r.completion,
      revision: 6,
      receipt: { ...r.completion.receipt, revision: 6 },
    }),
  );
  await assert.rejects(f.journal.append({ ...r.publish, revision: 6 }));
  await f.journal.checkpoint();
  await f.journal.close();
  const reopened = await openStorageJournal({
    directory: f.directory,
    storeId: "store",
  });
  t.after(() => reopened.close());
  await assert.rejects(
    reopened.append({
      ...r.completion,
      revision: 6,
      receipt: { ...r.completion.receipt, revision: 6 },
    }),
  );
});

const inboxCancelRecords = () => {
  const identity = {
    runtimeEpoch: "original",
    operationId: "inbox-cancel",
    type: "session.inbox.cancel",
    workspaceId: "workspace",
    sessionId: "session",
    digest: "a".repeat(64),
  };
  const key = {
    runtimeEpoch: identity.runtimeEpoch,
    operationId: identity.operationId,
  };
  return {
    marker: {
      kind: "feature_gate",
      feature: "conversation_context_cancel_v1",
      revision: 1,
    },
    admitted: {
      kind: "admission",
      identity,
      inboxTarget: { inboxId: "pending-1" },
      revision: 2,
    },
    before: {
      kind: "dispatch",
      ...key,
      step: "native.policy.before_selection",
      revision: 3,
    },
    after: {
      kind: "dispatch",
      ...key,
      step: "native.policy.after_selection",
      revision: 4,
    },
    cancel: {
      kind: "dispatch",
      ...key,
      step: "native.inbox.cancel",
      inboxTarget: { inboxId: "pending-1" },
      revision: 5,
    },
    completed: {
      kind: "completion",
      ...key,
      revision: 6,
      receipt: completionReceipt({
        ...key,
        type: identity.type,
        workspaceId: identity.workspaceId,
        sessionId: identity.sessionId,
        admission: "dispatched",
        delivery: "accepted",
        effect: "confirmed",
        revision: 6,
        result: {
          kind: "inbox_cancel_requested",
          workspaceId: "workspace",
          sessionId: "session",
          inboxId: "pending-1",
          digest: identity.digest,
        },
      }),
      delta: { workspaces: [], sessions: [], tombstones: [] },
    },
  };
};
test("CTX-CANCEL journal preserves exact target and confirmed request ACK across checkpoint", async (t) => {
  const f = await fixture(t);
  for (const payload of Object.values(inboxCancelRecords()))
    await f.journal.append(payload);
  await f.journal.checkpoint();
  await f.journal.close();
  const next = await openStorageJournal({
    directory: f.directory,
    storeId: "store",
  });
  t.after(() => next.close());
  assert.equal(next.status().state, "ready");
  assert.deepEqual(
    next.readRecords().committed.map((r) => r.payload),
    Object.values(inboxCancelRecords()),
  );
});
for (const mode of ["journal", "checkpoint"])
  test(`CTX-CANCEL actual archived parser refuses ${mode} without changing store bytes`, async (t) => {
    const base = new URL(
      "../../../../docs/runs/conversation-context/evidence/prechange/",
      import.meta.url,
    );
    const manifest = JSON.parse(
      await fs.readFile(new URL("manifest.json", base), "utf8"),
    );
    for (const [name, expected] of Object.entries(manifest.files)) {
      const bytes = await fs.readFile(new URL(`legacy-source/${name}`, base));
      assert.equal(bytes.length, expected.bytes, name);
      assert.equal(
        createHash("sha256").update(bytes).digest("hex"),
        expected.sha256,
        name,
      );
    }
    const {
      openStorageJournal: openLegacy,
      validateJournalPayload: validateLegacy,
    } = await import(
      new URL(
        "legacy-source/apps/desktop-app/src/host/storage-journal.mjs",
        base,
      ).href
    );
    const r = inboxCancelRecords();
    assert.throws(() => validateLegacy(r.marker), {
      code: "unsupported_version",
    });
    const f = await fixture(t);
    for (const payload of Object.values(r)) await f.journal.append(payload);
    if (mode === "checkpoint") await f.journal.checkpoint();
    await f.journal.close();
    const names = (await fs.readdir(f.directory)).sort();
    const before = await Promise.all(
      names.map((name) => fs.readFile(join(f.directory, name))),
    );
    const legacy = await openLegacy({
      directory: f.directory,
      storeId: "store",
    });
    assert.equal(legacy.status().reason, "unsupported_version");
    await assert.rejects(legacy.checkpoint(), { code: "unsupported_version" });
    await assert.rejects(async () => legacy.append(r.marker), {
      code: "unsupported_version",
    });
    await legacy.close();
    assert.deepEqual((await fs.readdir(f.directory)).sort(), names);
    assert.deepEqual(
      await Promise.all(
        names.map((name) => fs.readFile(join(f.directory, name))),
      ),
      before,
    );
  });

for (const mode of [
  "marker",
  "missing-target",
  "extra-target",
  "foreign-target",
  "missing-before",
  "missing-after",
  "reverse-policy",
  "duplicate-policy",
  "duplicate-cancel",
  "missing-dispatch-target",
  "changed-dispatch-target",
  "native-metadata",
  "target-on-policy",
  "result-target",
  "result-digest",
  "result-body",
  "none",
  "wrong-scope",
  "unknown-upgrade",
  "dispatch-after-unknown",
])
  test(`CTX-CANCEL journal rejects ${mode} before mutation`, async (t) => {
    const r = inboxCancelRecords();
    let payloads = Object.values(r);
    if (mode === "marker") payloads.shift();
    if (mode === "missing-target") delete r.admitted.inboxTarget;
    if (mode === "extra-target") r.admitted.inboxTarget.body = "PRIVATE";
    if (mode === "foreign-target") r.admitted.identity.type = "message.send";
    if (mode === "missing-before")
      payloads.splice(payloads.indexOf(r.before), 1);
    if (mode === "missing-after") payloads.splice(payloads.indexOf(r.after), 1);
    if (mode === "reverse-policy")
      [payloads[2], payloads[3]] = [payloads[3], payloads[2]];
    if (mode === "duplicate-policy") payloads.splice(3, 0, { ...r.before });
    if (mode === "duplicate-cancel")
      payloads.splice(5, 0, globalThis.structuredClone(r.cancel));
    if (mode === "missing-dispatch-target") delete r.cancel.inboxTarget;
    if (mode === "changed-dispatch-target")
      r.cancel.inboxTarget.inboxId = "other";
    if (mode === "native-metadata") r.cancel.nativeSessionId = "PRIVATE";
    if (mode === "target-on-policy")
      r.before.inboxTarget = r.admitted.inboxTarget;
    if (mode === "result-target") r.completed.receipt.result.inboxId = "other";
    if (mode === "result-digest")
      r.completed.receipt.result.digest = "f".repeat(64);
    if (mode === "result-body") r.completed.receipt.result.body = "PRIVATE";
    if (mode === "none") {
      r.completed.receipt.effect = "none";
      delete r.completed.receipt.result;
    }
    if (mode === "wrong-scope") r.completed.receipt.sessionId = "other";
    if (mode === "unknown-upgrade" || mode === "dispatch-after-unknown") {
      const unknown = globalThis.structuredClone(r.completed);
      unknown.receipt.effect = "unknown";
      unknown.receipt.delivery = "unknown";
      delete unknown.receipt.result;
      if (mode === "unknown-upgrade") payloads.splice(5, 0, unknown);
      else payloads = [r.marker, r.admitted, r.before, unknown, r.after];
    }
    const f = await fixture(t);
    let rejected = false;
    for (const [index, payload] of payloads.entries()) {
      payload.revision = index + 1;
      if (payload.receipt) payload.receipt.revision = index + 1;
      const before = await fs.readFile(join(f.directory, "journal.jsonl"));
      try {
        await f.journal.append(payload);
      } catch {
        assert.deepEqual(
          await fs.readFile(join(f.directory, "journal.jsonl")),
          before,
        );
        rejected = true;
        break;
      }
    }
    assert.equal(rejected, true, mode);
  });

function permissionJournalRecords() {
  const d = "a".repeat(64),
    key = { runtimeEpoch: "original", operationId: "permission-journal" };
  const target = {
    version: 1,
    kind: "reply",
    previewId: "preview_base64url_128bits",
    previewDigest: d,
    scopeDigest: d,
    projectIdentityDigest: d,
    generations: {
      control: 1,
      inventory: 1,
      pending: 1,
      saved: 1,
      locations: 1,
    },
    targets: [
      { kind: "project", scopeDigest: d },
      {
        kind: "pending",
        workspaceId: "w",
        sessionId: "s",
        locationId: "location_base64url_128bits",
        permissionId: "p",
        requestDigest: d,
        resolution: "reject",
      },
      {
        kind: "pending",
        workspaceId: "w",
        sessionId: "s",
        locationId: "location_base64url_128bits",
        permissionId: "p2",
        requestDigest: d,
        resolution: "reject",
      },
    ],
    plan: [
      { ordinal: 0, step: "native.permission.hold", targetIndex: 0 },
      { ordinal: 1, step: "native.permission.reply", targetIndex: 1 },
      { ordinal: 2, step: "native.permission.reply", targetIndex: 2 },
      { ordinal: 3, step: "native.permission.activate", targetIndex: 0 },
    ],
    ruleBindings: [],
    policyBindings: [],
  };
  const identity = {
    ...key,
    type: "permission.reply.apply",
    workspaceId: "w",
    sessionId: "s",
    digest: d,
  };
  const marker = {
      kind: "feature_gate",
      feature: "permission_control_v1",
      revision: 1,
    },
    admission = {
      kind: "admission",
      revision: 2,
      identity,
      permissionTarget: target,
    };
  const records = [marker, admission];
  let revision = 2;
  for (const slot of target.plan) {
    records.push({
      kind: "dispatch",
      revision: ++revision,
      ...key,
      step: slot.step,
      permissionEffect: {
        ordinal: slot.ordinal,
        targetIndex: slot.targetIndex,
        previewDigest: d,
      },
    });
    records.push({
      kind: "permission_progress",
      ...key,
      ordinal: slot.ordinal,
      outcome: "verified",
      observation: { kind: "state", stateDigest: d },
    });
  }
  const completion = {
    kind: "completion",
    revision: ++revision,
    ...key,
    receipt: {
      ...key,
      type: identity.type,
      workspaceId: "w",
      sessionId: "s",
      admission: "dispatched",
      delivery: "accepted",
      effect: "confirmed",
      revision,
      evidence: [],
      result: {
        kind: "permission_replied",
        workspaceId: "w",
        sessionId: "s",
        previewDigest: d,
        scopeDigest: d,
        digest: d,
        decision: "reject",
        resolved: target.targets
          .filter((t) => t.kind === "pending")
          .map((t) => ({
            locationId: t.locationId,
            sessionId: t.sessionId,
            permissionId: t.permissionId,
          })),
      },
    },
    delta: { workspaces: [], sessions: [], tombstones: [] },
  };
  records.push(completion);
  return { records, marker, admission, completion, key };
}
test("permission journal round-trips consecutive repeated-step ordinals and exact progress checkpoint", async (t) => {
  const f = await fixture(t),
    r = permissionJournalRecords();
  for (const p of r.records) await f.journal.append(p);
  await f.journal.checkpoint();
  await f.journal.close();
  const next = await openStorageJournal({
    directory: f.directory,
    storeId: "store",
  });
  t.after(() => next.close());
  assert.equal(next.status().state, "ready");
  assert.deepEqual(
    next.readRecords().committed.map((r) => r.payload),
    r.records,
  );
});
for (const mode of [
  "no-marker",
  "extra-target",
  "foreign-type",
  "missing-binding",
  "skip-ordinal",
  "duplicate-ordinal",
  "wrong-target",
  "wrong-preview",
  "progress-before-dispatch",
  "duplicate-progress",
  "changed-progress",
  "foreign-progress",
  "missing-progress",
  "unverified-progress",
  "completion-target",
  "completion-digest",
  "unknown-upgrade",
  "unknown-dispatch",
])
  test(`permission journal rejects ${mode} before byte mutation`, async (t) => {
    const f = await fixture(t),
      r = permissionJournalRecords();
    let records = r.records;
    if (mode === "no-marker") records = records.slice(1);
    if (mode === "extra-target") r.admission.permissionTarget.secret = "raw";
    if (mode === "foreign-type") r.admission.identity.type = "message.send";
    if (mode === "missing-binding")
      delete r.admission.permissionTarget.projectIdentityDigest;
    if (mode === "skip-ordinal") records[2].permissionEffect.ordinal = 1;
    if (mode === "duplicate-ordinal")
      records.splice(4, 0, globalThis.structuredClone(records[2]));
    if (mode === "wrong-target") records[4].permissionEffect.targetIndex = 2;
    if (mode === "wrong-preview")
      records[2].permissionEffect.previewDigest = "b".repeat(64);
    if (mode === "progress-before-dispatch")
      [records[2], records[3]] = [records[3], records[2]];
    if (mode === "duplicate-progress")
      records.splice(4, 0, globalThis.structuredClone(records[3]));
    if (mode === "changed-progress") {
      const p = globalThis.structuredClone(records[3]);
      p.observation.stateDigest = "b".repeat(64);
      records.splice(4, 0, p);
    }
    if (mode === "foreign-progress") records[3].operationId = "foreign";
    if (mode === "missing-progress") records.splice(3, 1);
    if (mode === "unverified-progress") records[3].outcome = "unverified";
    if (mode === "completion-target")
      r.completion.receipt.result.resolved[0].permissionId = "foreign";
    if (mode === "completion-digest")
      r.completion.receipt.result.digest = "b".repeat(64);
    if (mode === "unknown-upgrade" || mode === "unknown-dispatch") {
      const unknown = globalThis.structuredClone(r.completion);
      unknown.receipt.delivery = "unknown";
      unknown.receipt.effect = "unknown";
      delete unknown.receipt.result;
      if (mode === "unknown-upgrade")
        records.splice(records.length - 1, 0, unknown);
      else records = [...records.slice(0, 4), unknown, records[4]];
    }
    let rejected = false,
      revision = 0;
    for (const p of records) {
      if (p.kind !== "permission_progress") {
        p.revision = ++revision;
        if (p.receipt) p.receipt.revision = revision;
      }
      const before = await fs.readFile(join(f.directory, "journal.jsonl"));
      try {
        await f.journal.append(p);
      } catch {
        rejected = true;
        assert.deepEqual(
          await fs.readFile(join(f.directory, "journal.jsonl")),
          before,
        );
        break;
      }
    }
    assert.equal(rejected, true, mode);
  });
for (const mode of ["marker", "journal", "checkpoint"])
  test(`permission real archived parser rejects ${mode} unsupported_version and preserves ALL bytes`, async (t) => {
    const base = new URL(
      "../../../../docs/runs/permission-control-journal/prechange/",
      import.meta.url,
    );
    const manifest = JSON.parse(
      await fs.readFile(new URL("legacy-manifest-r1.json", base), "utf8"),
    );
    assert.equal(manifest.files.length, 33);
    let total = 0;
    for (const entry of manifest.files) {
      const bytes = await fs.readFile(
        new URL(`legacy-source/${entry.path}`, base),
      );
      total += bytes.length;
      assert.equal(bytes.length, entry.bytes, entry.path);
      assert.equal(
        createHash("sha256").update(bytes).digest("hex"),
        entry.sha256,
        entry.path,
      );
    }
    assert.equal(total, 401729);
    const legacy = await import(
      new URL(
        "legacy-source/apps/desktop-app/src/host/storage-journal.mjs",
        base,
      ).href
    );
    const legacyRegistry = await import(
      new URL(
        "legacy-source/apps/desktop-app/src/host/workspace-registry.mjs",
        base,
      ).href
    );
    assert.equal(typeof legacyRegistry.openWorkspaceRegistry, "function");
    const f = await fixture(t),
      r = permissionJournalRecords();
    assert.throws(() => legacy.validateJournalPayload(r.marker), {
      code: "unsupported_version",
    });
    for (const p of mode === "marker" ? [r.marker] : r.records)
      await f.journal.append(p);
    if (mode === "checkpoint") await f.journal.checkpoint();
    await f.journal.close();
    const names = (await fs.readdir(f.directory)).sort();
    const before = await Promise.all(
      names.map((n) => fs.readFile(join(f.directory, n))),
    );
    const old = await legacy.openStorageJournal({
      directory: f.directory,
      storeId: "store",
    });
    assert.equal(old.status().reason, "unsupported_version");
    await assert.rejects(old.checkpoint(), { code: "unsupported_version" });
    await assert.rejects(async () => old.append(r.marker), {
      code: "unsupported_version",
    });
    await old.close();
    const oldRegistry = await legacyRegistry.openWorkspaceRegistry({
      directory: f.directory,
      storeId: "store",
      documentsPath: f.directory,
      runtimeEpoch: "new",
    });
    assert.equal(oldRegistry.status().reason, "unsupported_version");
    await assert.rejects(oldRegistry.checkpoint(), {
      code: "unsupported_version",
    });
    await oldRegistry.close();
    assert.deepEqual((await fs.readdir(f.directory)).sort(), names);
    assert.deepEqual(
      await Promise.all(names.map((n) => fs.readFile(join(f.directory, n)))),
      before,
    );
  });
