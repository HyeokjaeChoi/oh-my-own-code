import { configurationBackupId } from "./configuration-file-observation.mjs";
import test from "node:test";
import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWorkspaceRegistry } from "./workspace-registry.mjs";
import { mcpNativeName, mcpStep } from "./workbench-mcp.mjs";
import { validateStorageReceipt } from "./storage-journal.mjs";

const identity = (operationId = "op", extra = {}) => ({
  runtimeEpoch: "old",
  operationId,
  type: "workspace.create",
  digest: "a".repeat(64),
  ...extra,
});
const receipt = (operationId = "op", extra = {}) => ({
  runtimeEpoch: "old",
  operationId,
  type: "workspace.create",
  admission: "dispatched",
  delivery: "accepted",
  effect: "confirmed",
  revision: 0,
  evidence: [],
  ...extra,
});
async function fixture(t, io = {}, runtimeEpoch = "current") {
  const root = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "p7-registry-")),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = join(root, "private");
  const documentsPath = join(root, "Documents");
  await fs.mkdir(directory);
  await fs.mkdir(documentsPath);
  const options = {
    directory,
    documentsPath,
    storeId: "store",
    runtimeEpoch,
    io,
  };
  const registry = await openWorkspaceRegistry(options);
  t.after(() => registry.close());
  return { root, directory, documentsPath, registry, options };
}
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const until = async (predicate, releaseOnTimeout) => {
  // Event-loop turns do not bound real filesystem completion under parallel load.
  const deadline = performance.now() + 2000;
  while (performance.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 1));
  }
  releaseOnTimeout?.(); // A failed assertion must not strand teardown behind a held flush.
  assert.fail("condition not reached within fixture deadline");
};

test("completion flush hides all candidates; rebasing retains concurrent BUSY rejection and owns copies", async (t) => {
  const paused = deferred();
  let entered = false;
  const f = await fixture(t, {
    syncFile: async (file, context) => {
      if (context === "append:completion") {
        entered = true;
        await paused.promise;
      }
      await file.sync();
    },
  });
  await f.registry.begin(identity());
  const reservation = await f.registry.reserve({
    runtimeEpoch: "old",
    operationId: "op",
    ownership: "managed",
  });
  await f.registry.materializeManaged({
    runtimeEpoch: "old",
    operationId: "op",
  });
  await f.registry.dispatch({
    runtimeEpoch: "old",
    operationId: "op",
    step: "native.create",
    nativeSessionId: "native",
  });
  const delta = {
    workspaces: [{ ...reservation.workspace, registrationState: "registered" }],
    sessions: [
      {
        appSessionId: reservation.appSessionId,
        workspaceId: reservation.workspace.workspaceId,
        nativeSessionId: "native",
        lifecycleState: "active",
        pinned: false,
        archived: false,
      },
    ],
    tombstones: [],
  };
  const completion = f.registry.complete({
    runtimeEpoch: "old",
    operationId: "op",
    receipt: receipt(),
    delta,
    verifiedNativeSessionIds: ["native"],
  });
  await until(() => entered, paused.resolve);
  assert.equal(f.registry.readView().sessions.length, 0);
  assert.equal(
    f.registry.lookup({ runtimeEpoch: "old", operationId: "op" }).receipt
      .effect,
    "unknown",
  );
  delta.sessions[0].nativeSessionId = "mutated";
  const concurrent = f.registry.begin({
    ...identity("busy"),
    rejectionCode: "BUSY",
  });
  paused.resolve();
  await completion;
  await concurrent;
  assert.equal(f.registry.readView().sessions[0].nativeSessionId, "native");
  assert.equal(
    f.registry.lookup({ runtimeEpoch: "old", operationId: "busy" }).status,
    "found",
  );
  const view = f.registry.readView();
  view.sessions[0].nativeSessionId = "alias";
  assert.equal(f.registry.readView().sessions[0].nativeSessionId, "native");
});

async function createManaged(f, operationId = "op") {
  await f.registry.begin(identity(operationId));
  const reserved = await f.registry.reserve({
    runtimeEpoch: "old",
    operationId,
    ownership: "managed",
    plannedNativeSessionId: `native-${operationId}`,
  });
  await f.registry.materializeManaged({ runtimeEpoch: "old", operationId });
  await f.registry.dispatch({
    runtimeEpoch: "old",
    operationId,
    step: "native.create",
    nativeSessionId: `native-${operationId}`,
  });
  const delta = {
    workspaces: [{ ...reserved.workspace, registrationState: "registered" }],
    sessions: [
      {
        appSessionId: reserved.appSessionId,
        workspaceId: reserved.workspace.workspaceId,
        nativeSessionId: `native-${operationId}`,
        lifecycleState: "active",
        pinned: false,
        archived: false,
      },
    ],
    tombstones: [],
  };
  await f.registry.complete({
    runtimeEpoch: "old",
    operationId,
    receipt: receipt(operationId),
    delta,
    verifiedNativeSessionIds: [`native-${operationId}`],
  });
  return { ...reserved, delta };
}
async function reopened(t, f, extra = {}) {
  await f.registry.close();
  const registry = await openWorkspaceRegistry({
    ...f.options,
    io: {},
    runtimeEpoch: "new",
    ...extra,
  });
  t.after(() => registry.close());
  return registry;
}

// Independently encode a valid checkpoint to exercise the real 200-session bound
// without hundreds of unrelated filesystem/native effects in setup.
async function committedSessions(t, f, count) {
  await f.registry.close();
  const workspaces = [0, 1].map((index) => ({
    workspaceId: `workspace-${index}`,
    ownership: "imported",
    canonicalPath: join(f.root, `imported-${index}`),
    registrationState: "reserved",
  }));
  for (const workspace of workspaces) await fs.mkdir(workspace.canonicalPath);
  const records = [];
  let previousHash = "0".repeat(64);
  const append = (payload) => {
    const body = {
      schemaVersion: 1,
      storeId: "store",
      sequence: records.length + 1,
      previousHash,
      payload: { ...payload, revision: records.length + 1 },
    };
    previousHash = createHash("sha256")
      .update(JSON.stringify(body))
      .digest("hex");
    records.push(JSON.stringify({ ...body, checksum: previousHash }));
  };
  const sessions = [];
  for (let index = 0; index < count; index++) {
    const workspace = workspaces[index % 2];
    const operationId = `seed-${index}`;
    const type = index < 2 ? "workspace.import" : "session.create";
    const scope = index < 2 ? {} : { workspaceId: workspace.workspaceId };
    const session = {
      appSessionId: `session-${index}`,
      workspaceId: workspace.workspaceId,
      nativeSessionId: `native-${index}`,
      lifecycleState: "active",
      pinned: false,
      archived: false,
    };
    sessions.push(session);
    append({
      kind: "admission",
      identity: identity(operationId, { type, ...scope }),
    });
    append({
      kind: "reservation",
      runtimeEpoch: "old",
      operationId,
      workspace,
      appSessionId: session.appSessionId,
      plannedNativeSessionId: session.nativeSessionId,
    });
    append({
      kind: "dispatch",
      runtimeEpoch: "old",
      operationId,
      step: "native.create",
      nativeSessionId: session.nativeSessionId,
    });
    append({
      kind: "completion",
      runtimeEpoch: "old",
      operationId,
      receipt: receipt(operationId, {
        type,
        ...scope,
        revision: records.length + 1,
        evidence: [
          { kind: "native_session_verified", id: session.nativeSessionId },
        ],
      }),
      delta: {
        workspaces:
          index < 2 ? [{ ...workspace, registrationState: "registered" }] : [],
        sessions: [session],
        tombstones: [],
      },
    });
  }
  await fs.writeFile(
    join(f.directory, "journal.jsonl"),
    records.join("\n") + "\n",
  );
  const checkpoint = {
    schemaVersion: 1,
    storeId: "store",
    generation: 1,
    sequence: records.length,
    hash: previousHash,
  };
  await fs.writeFile(
    join(f.directory, "checkpoint.json"),
    JSON.stringify({
      ...checkpoint,
      checksum: createHash("sha256")
        .update(JSON.stringify(checkpoint))
        .digest("hex"),
    }),
  );
  f.registry = await reopened(t, f);
  assert.equal(f.registry.status().state, "ready");
  assert.equal(f.registry.readView().sessions.length, count);
  return { workspaces, sessions };
}

for (const outcome of ["pause", "reject"]) {
  test(`JR-V5-01 second policy flush ${outcome} gates its effect and both duplicates have no effect`, async (t) => {
    let enabled = false,
      flushes = 0,
      entered = false,
      effects = 0;
    const paused = deferred();
    const f = await fixture(t, {
      syncFile: async (file, context) => {
        if (enabled && context === "append:dispatch" && ++flushes === 2) {
          entered = true;
          await paused.promise;
          if (outcome === "reject")
            throw new Error("injected second policy flush failure");
        }
        await file.sync();
      },
    });
    const created = await createManaged(f);
    const scope = {
      workspaceId: created.workspace.workspaceId,
      sessionId: created.appSessionId,
    };
    await f.registry.begin(
      identity("send", { type: "message.send", ...scope }),
    );
    enabled = true;
    const run = async (step) => {
      const response = await f.registry.dispatch({
        runtimeEpoch: "old",
        operationId: "send",
        step,
      });
      if (response.status === "dispatched") effects++;
      return response;
    };
    await run("native.policy.before_selection");
    const before = await fs.readFile(join(f.directory, "journal.jsonl"));
    assert.equal(
      (await run("native.policy.before_selection")).status,
      "duplicate",
    );
    assert.equal(effects, 1);
    assert.deepEqual(
      await fs.readFile(join(f.directory, "journal.jsonl")),
      before,
    );
    const second = run("native.policy.after_selection");
    const settled = Promise.allSettled([second]);
    await until(() => entered, paused.resolve);
    assert.equal(effects, 1);
    assert.equal(flushes, 2);
    const records = (
      await fs.readFile(join(f.directory, "journal.jsonl"), "utf8")
    )
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert.deepEqual(
      records
        .filter(
          ({ payload }) =>
            payload.operationId === "send" && payload.kind === "dispatch",
        )
        .map(({ payload }) => payload.step),
      ["native.policy.before_selection", "native.policy.after_selection"],
    );
    assert.equal(f.registry.status().journal.sequence, records.length - 1);
    paused.resolve();
    const [result] = await settled;
    if (outcome === "reject") {
      assert.equal(result.status, "rejected");
      assert.equal(result.reason.code, "writer_poisoned");
      await assert.rejects(run("native.policy.after_selection"), {
        code: "writer_poisoned",
      });
      assert.equal(effects, 1);
      assert.equal(
        f.registry.lookup({ runtimeEpoch: "old", operationId: "send" }).receipt
          .effect,
        "unknown",
      );
    } else {
      assert.equal(result.status, "fulfilled");
      assert.equal(effects, 2);
      const bytes = await fs.readFile(join(f.directory, "journal.jsonl"));
      for (const step of [
        "native.policy.before_selection",
        "native.policy.after_selection",
      ])
        assert.equal((await run(step)).status, "duplicate");
      await assert.rejects(run("native.policy.third_selection"), {
        code: "invalid_record",
      });
      assert.equal(effects, 2);
      assert.deepEqual(
        await fs.readFile(join(f.directory, "journal.jsonl")),
        bytes,
      );
    }
  });
}

test("JR-V5-02 session removal rejects another parentless same-workspace tombstone before append; workspace removal keeps its scope", async (t) => {
  const f = await fixture(t);
  const { sessions } = await committedSessions(t, f, 3);
  const [a, , b] = sessions;
  const scope = { workspaceId: a.workspaceId, sessionId: a.appSessionId };
  await f.registry.begin(
    identity("remove-a", { type: "session.remove", ...scope }),
  );
  await f.registry.dispatch({
    runtimeEpoch: "old",
    operationId: "remove-a",
    step: "native.remove",
  });
  const completion = {
    runtimeEpoch: "old",
    operationId: "remove-a",
    receipt: receipt("remove-a", { type: "session.remove", ...scope }),
    delta: {
      workspaces: [],
      sessions: [],
      tombstones: [{ kind: "session", id: b.appSessionId }],
    },
  };
  const before = await fs.readFile(join(f.directory, "journal.jsonl"));
  await assert.rejects(f.registry.complete(completion), {
    code: "identity_conflict",
  });
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    before,
  );
  assert.deepEqual(
    f.registry.readView().sessions.map((entry) => entry.appSessionId),
    sessions.map((entry) => entry.appSessionId),
  );
  assert.equal(
    f.registry.lookup({ runtimeEpoch: "old", operationId: "remove-a" }).receipt
      .effect,
    "unknown",
  );
  await f.registry.complete({
    ...completion,
    delta: {
      ...completion.delta,
      tombstones: [{ kind: "session", id: a.appSessionId }],
    },
  });
  await f.registry.checkpoint();
  const registry = await reopened(t, f);
  assert.equal(registry.status().state, "ready");
  assert.ok(
    registry
      .readView()
      .sessions.some((entry) => entry.appSessionId === b.appSessionId),
  );
  assert.ok(
    !registry
      .readView()
      .sessions.some((entry) => entry.appSessionId === a.appSessionId),
  );
  await registry.begin(
    identity("remove-workspace", {
      type: "workspace.remove",
      workspaceId: b.workspaceId,
    }),
  );
  await registry.dispatch({
    runtimeEpoch: "old",
    operationId: "remove-workspace",
    step: "registry.unregister",
  });
  await registry.complete({
    runtimeEpoch: "old",
    operationId: "remove-workspace",
    receipt: receipt("remove-workspace", {
      type: "workspace.remove",
      workspaceId: b.workspaceId,
    }),
    delta: {
      workspaces: [],
      sessions: [],
      tombstones: [
        { kind: "session", id: b.appSessionId },
        { kind: "workspace", id: b.workspaceId },
      ],
    },
  });
  assert.deepEqual(
    registry.readView().sessions.map((entry) => entry.appSessionId),
    [sessions[1].appSessionId],
  );
});

async function assertCompletionRejectedWithoutMutation(
  f,
  completion,
  code = "identity_conflict",
) {
  const journalPath = join(f.directory, "journal.jsonl");
  const bytes = await fs.readFile(journalPath);
  const { observationSequence: _beforeSequence, ...before } =
    f.registry.readView();
  const priorReceipt = f.registry.lookup({
    runtimeEpoch: completion.runtimeEpoch,
    operationId: completion.operationId,
  });
  const priorStatus = f.registry.status();
  await assert.rejects(f.registry.complete(completion), { code });
  assert.deepEqual(await fs.readFile(journalPath), bytes);
  const { observationSequence: _afterSequence, ...after } =
    f.registry.readView();
  assert.deepEqual(after, before);
  assert.deepEqual(
    f.registry.lookup({
      runtimeEpoch: completion.runtimeEpoch,
      operationId: completion.operationId,
    }),
    priorReceipt,
  );
  assert.deepEqual(f.registry.status(), priorStatus);
}

for (const [type, step, change] of [
  ["session.pin", "native.pin", { pinned: true }],
  ["session.rename", "native.rename", { title: "RENAMED" }],
  ["session.archive", "native.archive", { archived: true }],
]) {
  test(`JR-V5-R2-01 ${type} rejects another same-workspace session before append and retains exact metadata on reopen`, async (t) => {
    let completionAppends = 0;
    const f = await fixture(t, {
      syncFile: async (file, context) => {
        if (context === "append:completion") completionAppends++;
        await file.sync();
      },
    });
    const { sessions } = await committedSessions(t, f, 3);
    f.registry = await reopened(t, f, { io: f.options.io });
    const [a, otherWorkspace, b] = sessions;
    assert.equal(a.workspaceId, b.workspaceId);
    const scope = { workspaceId: a.workspaceId, sessionId: a.appSessionId };
    await f.registry.begin(identity(type, { type, ...scope }));
    await f.registry.dispatch({
      runtimeEpoch: "old",
      operationId: type,
      step,
    });
    const completion = {
      runtimeEpoch: "old",
      operationId: type,
      receipt: receipt(type, { type, ...scope }),
      delta: {
        workspaces: [],
        sessions: [{ ...a, ...change }],
        tombstones: [],
      },
    };
    for (const candidates of [
      [{ ...b, ...change }],
      [
        { ...a, ...change },
        { ...b, ...change },
      ],
      [{ ...otherWorkspace, ...change }],
    ])
      await assertCompletionRejectedWithoutMutation(f, {
        ...completion,
        delta: { ...completion.delta, sessions: candidates },
      });
    assert.equal(completionAppends, 0);
    assert.equal((await f.registry.complete(completion)).status, "completed");
    assert.equal(completionAppends, 1);
    const completed = f.registry.readView();
    assert.deepEqual(
      Object.fromEntries(
        Object.keys(change).map((field) => [
          field,
          completed.sessions[0][field],
        ]),
      ),
      change,
    );
    assert.equal(completed.sessions[2].pinned, b.pinned);
    assert.equal(completed.sessions[2].archived, b.archived);
    assert.equal(completed.sessions[2].title, b.title);
    const bytes = await fs.readFile(join(f.directory, "journal.jsonl"));
    assert.equal((await f.registry.complete(completion)).status, "duplicate");
    assert.deepEqual(
      await fs.readFile(join(f.directory, "journal.jsonl")),
      bytes,
    );
    await f.registry.checkpoint();
    const registry = await reopened(t, f);
    assert.equal(registry.status().state, "ready");
    assert.deepEqual(registry.readView().sessions, completed.sessions);
    assert.equal(
      registry.lookup({ runtimeEpoch: "old", operationId: type }).receipt
        .effect,
      "confirmed",
    );
    assert.equal((await registry.complete(completion)).status, "duplicate");
  });
}

for (const type of ["session.create", "session.fork"]) {
  test(`JR-V5-R2-01 ${type} binds new and partial mapping to its reservation and fork parent`, async (t) => {
    const f = await fixture(t);
    const { sessions } = await committedSessions(t, f, 3);
    const [parent, , sibling] = sessions;
    const scope = {
      workspaceId: parent.workspaceId,
      ...(type === "session.fork" && { sessionId: parent.appSessionId }),
    };
    const request = { runtimeEpoch: "old", operationId: type };
    await f.registry.begin(identity(type, { type, ...scope }));
    const reserved = await f.registry.reserve({
      ...request,
      workspaceId: parent.workspaceId,
      plannedNativeSessionId: "native-child",
    });
    await f.registry.dispatch({
      ...request,
      step: type === "session.fork" ? "native.fork" : "native.create",
      nativeSessionId: "native-child",
    });
    const child = {
      appSessionId: reserved.appSessionId,
      workspaceId: parent.workspaceId,
      nativeSessionId: "native-child",
      ...(type === "session.fork" && { parentSessionId: parent.appSessionId }),
      lifecycleState: "unavailable",
      recoveryReason: "partial_native_mapping",
      pinned: false,
      archived: false,
    };
    const completion = {
      ...request,
      receipt: receipt(type, {
        type,
        ...scope,
        effect: "unknown",
        delivery: "unknown",
      }),
      delta: { workspaces: [], sessions: [child], tombstones: [] },
      verifiedNativeSessionIds: ["native-child"],
    };
    await assertCompletionRejectedWithoutMutation(f, {
      ...completion,
      delta: {
        ...completion.delta,
        sessions: [{ ...child, appSessionId: "unreserved-child" }],
      },
    });
    if (type === "session.fork") {
      for (const parentSessionId of [sibling.appSessionId, undefined]) {
        const wrongChild = { ...child };
        if (parentSessionId) wrongChild.parentSessionId = parentSessionId;
        else delete wrongChild.parentSessionId;
        await assertCompletionRejectedWithoutMutation(f, {
          ...completion,
          delta: { ...completion.delta, sessions: [wrongChild] },
        });
      }
    }
    await f.registry.complete(completion);
    assert.equal((await f.registry.complete(completion)).status, "duplicate");
    await f.registry.checkpoint();
    f.registry = await reopened(t, f);
    assert.equal(f.registry.status().state, "ready");
    assert.equal(f.registry.readView().retainedOperations.length, 1);
    assert.equal(f.registry.readView().sessions.at(-1).status, "unavailable");
    assert.equal((await f.registry.complete(completion)).status, "duplicate");
    const { recoveryReason: _reason, ...activeChild } = child;
    activeChild.lifecycleState = "active";
    const confirmed = {
      ...completion,
      receipt: receipt(type, { type, ...scope }),
      delta: { ...completion.delta, sessions: [activeChild] },
    };
    await assertCompletionRejectedWithoutMutation(f, {
      ...confirmed,
      delta: {
        ...confirmed.delta,
        sessions: [activeChild, { ...sibling, pinned: true }],
      },
    });
    if (type === "session.fork")
      confirmed.delta.sessions.unshift({ ...parent, title: "FORK PARENT" });
    await f.registry.complete(confirmed);
    const view = f.registry.readView();
    assert.equal(view.retainedOperations.length, 0);
    assert.equal(view.sessions.at(-1).appSessionId, reserved.appSessionId);
    assert.equal(view.sessions.at(-1).nativeSessionId, "native-child");
    assert.equal(view.sessions.at(-1).status, "idle");
    if (type === "session.fork") {
      assert.equal(view.sessions[0].title, "FORK PARENT");
      assert.equal(view.sessions.at(-1).parentSessionId, parent.appSessionId);
    }
    assert.equal(view.sessions[2].pinned, false);
    await f.registry.checkpoint();
    const registry = await reopened(t, f);
    assert.equal(registry.status().state, "ready");
    assert.deepEqual(registry.readView().sessions, view.sessions);
    assert.equal((await registry.complete(confirmed)).status, "duplicate");
  });
}

test("JR-V5-R2-01 metadata cannot publish a new mapping through an unrelated reservation", async (t) => {
  const f = await fixture(t);
  const { sessions } = await committedSessions(t, f, 3);
  const [a] = sessions;
  const scope = { workspaceId: a.workspaceId, sessionId: a.appSessionId };
  await f.registry.begin(identity("pin", { type: "session.pin", ...scope }));
  const reserved = await f.registry.reserve({
    runtimeEpoch: "old",
    operationId: "pin",
    workspaceId: a.workspaceId,
    plannedNativeSessionId: "unrelated-native",
  });
  await f.registry.dispatch({
    runtimeEpoch: "old",
    operationId: "pin",
    step: "native.pin",
  });
  await assertCompletionRejectedWithoutMutation(f, {
    runtimeEpoch: "old",
    operationId: "pin",
    receipt: receipt("pin", { type: "session.pin", ...scope }),
    verifiedNativeSessionIds: ["unrelated-native"],
    delta: {
      workspaces: [],
      sessions: [
        {
          appSessionId: reserved.appSessionId,
          workspaceId: a.workspaceId,
          nativeSessionId: "unrelated-native",
          lifecycleState: "active",
          pinned: true,
          archived: false,
        },
      ],
      tombstones: [],
    },
  });
});

test("JR-V5-R2-01 workspace removal retains full same-workspace metadata and tombstone scope", async (t) => {
  const f = await fixture(t);
  const { sessions } = await committedSessions(t, f, 3);
  const [a, otherWorkspace, b] = sessions;
  const scope = { type: "workspace.remove", workspaceId: a.workspaceId };
  const request = {
    runtimeEpoch: "old",
    operationId: "remove-workspace-scope",
  };
  await f.registry.begin(identity(request.operationId, scope));
  await f.registry.dispatch({ ...request, step: "native.remove" });
  const unavailable = (session) => ({
    ...session,
    lifecycleState: "unavailable",
    recoveryReason: "partial_native_mapping",
  });
  const completion = {
    ...request,
    receipt: receipt(request.operationId, {
      ...scope,
      effect: "unknown",
      delivery: "unknown",
    }),
    delta: {
      workspaces: [],
      sessions: [unavailable(a), unavailable(b)],
      tombstones: [],
    },
  };
  await assertCompletionRejectedWithoutMutation(f, {
    ...completion,
    delta: {
      ...completion.delta,
      sessions: [...completion.delta.sessions, unavailable(otherWorkspace)],
    },
  });
  await f.registry.complete(completion);
  assert.equal(f.registry.readView().sessions[0].lifecycleState, "unavailable");
  assert.equal(f.registry.readView().sessions[2].lifecycleState, "unavailable");
  await f.registry.checkpoint();
  f.registry = await reopened(t, f);
  assert.equal((await f.registry.complete(completion)).status, "duplicate");
  const removed = {
    ...request,
    receipt: receipt(request.operationId, scope),
    delta: {
      workspaces: [],
      sessions: [],
      tombstones: [
        { kind: "session", id: a.appSessionId },
        { kind: "session", id: b.appSessionId },
        { kind: "workspace", id: a.workspaceId },
      ],
    },
  };
  await f.registry.complete(removed);
  await f.registry.checkpoint();
  const registry = await reopened(t, f);
  assert.equal(registry.status().state, "ready");
  assert.deepEqual(
    registry.readView().sessions.map((session) => session.appSessionId),
    [otherWorkspace.appSessionId],
  );
  assert.equal(registry.readView().tombstones.length, 3);
  assert.equal((await registry.complete(removed)).status, "duplicate");
});

async function createManagedWorkspaceOnly(f, operationId = "workspace-only") {
  const request = { runtimeEpoch: "old", operationId };
  await f.registry.begin(identity(operationId));
  const reserved = await f.registry.reserve({
    ...request,
    ownership: "managed",
  });
  await f.registry.materializeManaged(request);
  await f.registry.complete({
    ...request,
    receipt: receipt(operationId),
    delta: {
      workspaces: [{ ...reserved.workspace, registrationState: "registered" }],
      sessions: [],
      tombstones: [],
    },
  });
  return reserved;
}

async function completeReservedSession(f, request, reserved) {
  const nativeSessionId = `native-${request.operationId}`;
  await f.registry.dispatch({
    ...request,
    step: "native.create",
    nativeSessionId,
  });
  await f.registry.complete({
    ...request,
    receipt: receipt(request.operationId, {
      runtimeEpoch: request.runtimeEpoch,
      type: "session.create",
      workspaceId: reserved.workspace.workspaceId,
    }),
    delta: {
      workspaces: [],
      sessions: [
        {
          appSessionId: reserved.appSessionId,
          workspaceId: reserved.workspace.workspaceId,
          nativeSessionId,
          lifecycleState: "active",
          pinned: false,
          archived: false,
        },
      ],
      tombstones: [],
    },
    verifiedNativeSessionIds: [nativeSessionId],
  });
}

test("HOST-first-session staged managed workspace reuses its exact folder ID once through append/checkpoint/reopen", async (t) => {
  const f = await fixture(t);
  const staged = await createManagedWorkspaceOnly(f);
  assert.equal(f.registry.readView().sessions.length, 0);
  await f.registry.checkpoint();
  f.registry = await reopened(t, f);
  const request = { runtimeEpoch: "old", operationId: "first-session" };
  const scope = {
    type: "session.create",
    workspaceId: staged.workspace.workspaceId,
  };
  await f.registry.begin(identity(request.operationId, scope));
  const reserved = await f.registry.reserve({
    ...request,
    workspaceId: scope.workspaceId,
  });
  assert.equal(reserved.appSessionId, staged.appSessionId);
  assert.equal(reserved.appSessionId, staged.workspace.folderSessionId);
  const records = (
    await fs.readFile(join(f.directory, "journal.jsonl"), "utf8")
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line).payload);
  assert.equal(records.at(-1).kind, "reservation");
  assert.equal(records.at(-1).appSessionId, staged.appSessionId);
  await f.registry.checkpoint();
  f.registry = await reopened(t, f);
  assert.equal(f.registry.status().state, "ready");
  assert.equal(
    (await f.registry.reserve({ ...request, workspaceId: scope.workspaceId }))
      .appSessionId,
    staged.appSessionId,
  );
  await completeReservedSession(f, request, reserved);
  await f.registry.checkpoint();
  f.registry = await reopened(t, f);
  assert.equal(
    f.registry.readView().sessions[0].appSessionId,
    staged.appSessionId,
  );
  const additionalRequest = {
    runtimeEpoch: "old",
    operationId: "additional-session",
  };
  await f.registry.begin(identity(additionalRequest.operationId, scope));
  const additional = await f.registry.reserve({
    ...additionalRequest,
    workspaceId: scope.workspaceId,
  });
  assert.notEqual(additional.appSessionId, staged.appSessionId);
  await completeReservedSession(f, additionalRequest, additional);
  await f.registry.checkpoint();
  const registry = await reopened(t, f);
  assert.equal(registry.status().state, "ready");
  assert.deepEqual(
    registry.readView().sessions.map((session) => session.appSessionId),
    [staged.appSessionId, additional.appSessionId],
  );
  assert.equal(
    registry.readView().workspaces[0].canonicalPath,
    staged.workspace.canonicalPath,
  );
});

test("HOST-first-session concurrent first requests allocate the folder ID once; duplicate reservation has no append", async (t) => {
  const f = await fixture(t);
  const staged = await createManagedWorkspaceOnly(f);
  const scope = {
    type: "session.create",
    workspaceId: staged.workspace.workspaceId,
  };
  const admissions = await Promise.all(
    ["first", "second"].map((operationId) =>
      f.registry.begin(identity(operationId, scope)),
    ),
  );
  assert.deepEqual(
    admissions.map((result) => result.status),
    ["admitted", "rejected"],
  );
  const request = {
    runtimeEpoch: "old",
    operationId: "first",
    workspaceId: scope.workspaceId,
  };
  const revision = f.registry.readView().revision;
  const reservations = await Promise.all([
    f.registry.reserve(request),
    f.registry.reserve(request),
  ]);
  assert.deepEqual(
    reservations.map((result) => result.status),
    ["reserved", "duplicate"],
  );
  assert.ok(
    reservations.every((result) => result.appSessionId === staged.appSessionId),
  );
  assert.equal(f.registry.readView().revision, revision + 1);
  const bytes = await fs.readFile(join(f.directory, "journal.jsonl"));
  await assert.rejects(
    f.registry.reserve({ ...request, operationId: "second" }),
    { code: "identity_conflict" },
  );
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    bytes,
  );
  await f.registry.checkpoint();
  f.registry = await reopened(t, f);
  assert.equal(f.registry.status().state, "ready");
  assert.equal(
    (await f.registry.reserve(request)).appSessionId,
    staged.appSessionId,
  );
});

test("HOST-first-session reused folder reservation consumes one capacity slot and terminal no-effect releases only that slot", async (t) => {
  const f = await fixture(t);
  const { workspaces } = await committedSessions(t, f, 199);
  const staged = await createManagedWorkspaceOnly(f);
  const request = {
    runtimeEpoch: "old",
    operationId: "last-slot",
    workspaceId: staged.workspace.workspaceId,
  };
  await f.registry.begin(
    identity(request.operationId, {
      type: "session.create",
      workspaceId: request.workspaceId,
    }),
  );
  const reserved = await f.registry.reserve(request);
  assert.equal(reserved.appSessionId, staged.appSessionId);
  await f.registry.checkpoint();
  f.registry = await reopened(t, f);
  assert.equal((await f.registry.reserve(request)).status, "duplicate");
  const blocked = {
    runtimeEpoch: "old",
    operationId: "over-capacity",
    workspaceId: workspaces[0].workspaceId,
  };
  await f.registry.begin(
    identity(blocked.operationId, {
      type: "session.create",
      workspaceId: blocked.workspaceId,
    }),
  );
  const before = await fs.readFile(join(f.directory, "journal.jsonl"));
  await assert.rejects(f.registry.reserve(blocked), { code: "retained_limit" });
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    before,
  );
  await f.registry.complete({
    runtimeEpoch: request.runtimeEpoch,
    operationId: request.operationId,
    receipt: receipt(request.operationId, {
      type: "session.create",
      workspaceId: request.workspaceId,
      admission: "rejected",
      effect: "none",
      delivery: "pending",
      result: { kind: "rejected", code: "UNAVAILABLE" },
    }),
    delta: { workspaces: [], sessions: [], tombstones: [] },
  });
  assert.equal((await f.registry.reserve(blocked)).status, "reserved");
  const retry = {
    runtimeEpoch: "old",
    operationId: "cannot-reuse",
    workspaceId: request.workspaceId,
  };
  await f.registry.begin(
    identity(retry.operationId, {
      type: "session.create",
      workspaceId: retry.workspaceId,
    }),
  );
  await assert.rejects(f.registry.reserve(retry), { code: "retained_limit" });
});

async function rejectReservedSession(f, request) {
  await f.registry.complete({
    runtimeEpoch: request.runtimeEpoch,
    operationId: request.operationId,
    receipt: receipt(request.operationId, {
      type: "session.create",
      workspaceId: request.workspaceId,
      admission: "rejected",
      effect: "none",
      delivery: "pending",
      result: { kind: "rejected", code: "UNAVAILABLE" },
    }),
    delta: { workspaces: [], sessions: [], tombstones: [] },
  });
}

// Encode an adversarial checksum-valid reservation independently of the writer.
// Recovery must reject the identity collision without changing fixture bytes.
async function checkpointForgedReservation(
  t,
  f,
  request,
  workspace,
  appSessionId,
) {
  await f.registry.close();
  const journalPath = join(f.directory, "journal.jsonl");
  const text = await fs.readFile(journalPath, "utf8");
  const last = JSON.parse(text.trim().split("\n").at(-1));
  const body = {
    schemaVersion: 1,
    storeId: "store",
    sequence: last.sequence + 1,
    previousHash: last.checksum,
    payload: {
      kind: "reservation",
      runtimeEpoch: request.runtimeEpoch,
      operationId: request.operationId,
      revision: last.payload.revision + 1,
      workspace: { ...workspace, registrationState: "reserved" },
      appSessionId,
    },
  };
  const checksum = createHash("sha256")
    .update(JSON.stringify(body))
    .digest("hex");
  const bytes = text + JSON.stringify({ ...body, checksum }) + "\n";
  await fs.writeFile(journalPath, bytes);
  const checkpoint = {
    schemaVersion: 1,
    storeId: "store",
    generation: 10,
    sequence: body.sequence,
    hash: checksum,
  };
  await fs.writeFile(
    join(f.directory, "checkpoint.json"),
    JSON.stringify({
      ...checkpoint,
      checksum: createHash("sha256")
        .update(JSON.stringify(checkpoint))
        .digest("hex"),
    }),
  );
  const registry = await reopened(t, f);
  assert.equal(registry.status().reason, "identity_conflict");
  assert.equal(await fs.readFile(journalPath, "utf8"), bytes);
}

for (const rejectedCount of [1, 3]) {
  test(`JR-V5-R3-01 ${rejectedCount} safe rejected reservations preserve the first actual folder ID and original dedup receipts`, async (t) => {
    const f = await fixture(t);
    const staged = await createManagedWorkspaceOnly(f);
    const scope = {
      type: "session.create",
      workspaceId: staged.workspace.workspaceId,
    };
    const rejected = [];
    for (let i = 0; i < rejectedCount; i++) {
      const request = {
        runtimeEpoch: i === 0 ? "old" : `retry-epoch-${i}`,
        operationId: `safe-rejected-${i}`,
        workspaceId: scope.workspaceId,
      };
      const originalIdentity = {
        ...identity(request.operationId, scope),
        runtimeEpoch: request.runtimeEpoch,
      };
      assert.equal(
        (await f.registry.begin(originalIdentity)).status,
        "admitted",
      );
      const reserved = await f.registry.reserve(request);
      assert.equal(reserved.appSessionId, staged.workspace.folderSessionId);
      const originalReservation = JSON.parse(
        (await fs.readFile(join(f.directory, "journal.jsonl"), "utf8"))
          .trim()
          .split("\n")
          .at(-1),
      ).payload;
      const completion = {
        runtimeEpoch: request.runtimeEpoch,
        operationId: request.operationId,
        receipt: receipt(request.operationId, {
          ...scope,
          runtimeEpoch: request.runtimeEpoch,
          admission: "rejected",
          effect: "none",
          delivery: "pending",
          result: { kind: "rejected", code: "UNAVAILABLE" },
        }),
        delta: { workspaces: [], sessions: [], tombstones: [] },
      };
      await f.registry.complete(completion);
      rejected.push({
        request,
        originalIdentity,
        originalReservation,
        completion,
        lookup: f.registry.lookup({
          runtimeEpoch: request.runtimeEpoch,
          operationId: request.operationId,
        }),
      });
      assert.equal(f.registry.readView().retainedOperations.length, 0);
      if (i === 0) {
        await f.registry.checkpoint();
        f.registry = await reopened(t, f);
        assert.equal(f.registry.status().state, "ready");
      }
    }
    const request = { runtimeEpoch: "new", operationId: "first-actual" };
    await f.registry.begin({
      ...identity(request.operationId, scope),
      runtimeEpoch: request.runtimeEpoch,
    });
    const reserved = await f.registry.reserve({
      ...request,
      workspaceId: scope.workspaceId,
    });
    assert.equal(reserved.appSessionId, staged.workspace.folderSessionId);
    await completeReservedSession(f, request, reserved);
    await f.registry.checkpoint();
    f.registry = await reopened(t, f);
    assert.equal(f.registry.status().state, "ready");
    assert.equal(
      f.registry.readView().sessions[0].appSessionId,
      staged.workspace.folderSessionId,
    );
    assert.equal(
      f.registry.readView().sessions[0].nativeSessionId,
      "native-first-actual",
    );
    assert.equal(f.registry.lookup(request).receipt.effect, "confirmed");
    const bytes = await fs.readFile(join(f.directory, "journal.jsonl"));
    for (const prior of rejected) {
      const key = {
        runtimeEpoch: prior.request.runtimeEpoch,
        operationId: prior.request.operationId,
      };
      assert.deepEqual(f.registry.lookupIdentity(key), prior.originalIdentity);
      assert.deepEqual(f.registry.lookup(key), prior.lookup);
      assert.equal(
        (await f.registry.begin(prior.originalIdentity)).status,
        "duplicate",
      );
      assert.equal(
        (await f.registry.complete(prior.completion)).status,
        "duplicate",
      );
      await assert.rejects(f.registry.reserve(prior.request), {
        code: "identity_conflict",
      });
      await assert.rejects(
        f.registry.dispatch({ ...key, step: "native.create" }),
        { code: "identity_conflict" },
      );
    }
    assert.deepEqual(
      await fs.readFile(join(f.directory, "journal.jsonl")),
      bytes,
    );
    const records = bytes
      .toString("utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line).payload);
    for (const prior of rejected) {
      assert.deepEqual(
        records.find(
          (entry) =>
            entry.kind === "reservation" &&
            entry.operationId === prior.request.operationId,
        ),
        prior.originalReservation,
      );
      assert.equal(
        records.filter(
          (entry) =>
            entry.kind === "dispatch" &&
            entry.operationId === prior.request.operationId,
        ).length,
        0,
      );
    }
    assert.equal(
      records.filter(
        (entry) =>
          entry.kind === "dispatch" &&
          entry.operationId === request.operationId,
      ).length,
      1,
    );
    const additional = {
      runtimeEpoch: "new",
      operationId: "additional-after-retry",
    };
    await f.registry.begin({
      ...identity(additional.operationId, scope),
      runtimeEpoch: additional.runtimeEpoch,
    });
    assert.notEqual(
      (
        await f.registry.reserve({
          ...additional,
          workspaceId: scope.workspaceId,
        })
      ).appSessionId,
      staged.workspace.folderSessionId,
    );
  });
}

for (const consumed of ["other-reservation", "tombstone"]) {
  test(`HOST-first-session ${consumed} denies reuse of folder identity on allocation and checkpoint replay`, async (t) => {
    const f = await fixture(t);
    const staged = await createManagedWorkspaceOnly(f);
    const scope = {
      type: "session.create",
      workspaceId: staged.workspace.workspaceId,
    };
    const first = {
      runtimeEpoch: "old",
      operationId: "consumes-folder",
      workspaceId: scope.workspaceId,
    };
    // A generic fork reservation is not the exact first-session lineage, even
    // when it is safely rejected without dispatch. Its collision stays denied.
    const firstScope =
      consumed === "other-reservation"
        ? { ...scope, type: "session.fork" }
        : scope;
    await f.registry.begin(identity(first.operationId, firstScope));
    const reserved = await f.registry.reserve(first);
    if (consumed === "other-reservation") {
      assert.notEqual(reserved.appSessionId, staged.appSessionId);
      await f.registry.complete({
        runtimeEpoch: first.runtimeEpoch,
        operationId: first.operationId,
        receipt: receipt(first.operationId, {
          ...firstScope,
          admission: "rejected",
          effect: "none",
          delivery: "pending",
          result: { kind: "rejected", code: "UNAVAILABLE" },
        }),
        delta: { workspaces: [], sessions: [], tombstones: [] },
      });
    } else {
      assert.equal(reserved.appSessionId, staged.appSessionId);
      await completeReservedSession(
        f,
        { runtimeEpoch: first.runtimeEpoch, operationId: first.operationId },
        reserved,
      );
      const removal = { runtimeEpoch: "old", operationId: "remove-first" };
      const removeScope = {
        type: "session.remove",
        workspaceId: scope.workspaceId,
        sessionId: reserved.appSessionId,
      };
      await f.registry.begin(identity(removal.operationId, removeScope));
      await f.registry.dispatch({ ...removal, step: "native.remove" });
      await f.registry.complete({
        ...removal,
        receipt: receipt(removal.operationId, removeScope),
        delta: {
          workspaces: [],
          sessions: [],
          tombstones: [{ kind: "session", id: reserved.appSessionId }],
        },
      });
    }
    await f.registry.checkpoint();
    f.registry = await reopened(t, f);
    const next = { ...first, operationId: "next-session" };
    await f.registry.begin(identity(next.operationId, scope));
    const fresh = await f.registry.reserve(next);
    assert.notEqual(fresh.appSessionId, staged.appSessionId);
    await rejectReservedSession(f, next);
    const attack = { ...first, operationId: "forged-reuse" };
    await f.registry.begin(identity(attack.operationId, scope));
    await checkpointForgedReservation(
      t,
      f,
      attack,
      staged.workspace,
      staged.appSessionId,
    );
  });
}

for (const state of [
  "nonterminal",
  "unknown",
  "dispatched",
  "partial-mapping",
]) {
  test(`JR-V5-R3-01 ${state} retry remains held and cannot transfer the folder ID`, async (t) => {
    const f = await fixture(t);
    const staged = await createManagedWorkspaceOnly(f);
    const scope = {
      type: "session.create",
      workspaceId: staged.workspace.workspaceId,
    };
    const first = {
      runtimeEpoch: "old",
      operationId: "safe-before-held",
      workspaceId: scope.workspaceId,
    };
    await f.registry.begin(identity(first.operationId, scope));
    await f.registry.reserve(first);
    await rejectReservedSession(f, first);
    const held = { ...first, operationId: "held-first-session" };
    await f.registry.begin(identity(held.operationId, scope));
    const reserved = await f.registry.reserve(held);
    assert.equal(reserved.appSessionId, staged.workspace.folderSessionId);
    const key = {
      runtimeEpoch: held.runtimeEpoch,
      operationId: held.operationId,
    };
    if (["dispatched", "partial-mapping"].includes(state)) {
      await f.registry.dispatch({
        ...key,
        step: "native.create",
        nativeSessionId: "native-held",
      });
      await assertCompletionRejectedWithoutMutation(f, {
        ...key,
        receipt: receipt(held.operationId, {
          ...scope,
          admission: "rejected",
          effect: "none",
          delivery: "pending",
          result: { kind: "rejected", code: "UNAVAILABLE" },
        }),
        delta: { workspaces: [], sessions: [], tombstones: [] },
      });
    }
    if (["unknown", "partial-mapping"].includes(state)) {
      await f.registry.complete({
        ...key,
        receipt: receipt(held.operationId, {
          ...scope,
          admission: state === "unknown" ? "admitted" : "dispatched",
          effect: "unknown",
          delivery: "unknown",
        }),
        delta: {
          workspaces: [],
          sessions:
            state === "partial-mapping"
              ? [
                  {
                    appSessionId: reserved.appSessionId,
                    workspaceId: scope.workspaceId,
                    nativeSessionId: "native-held",
                    lifecycleState: "unavailable",
                    recoveryReason: "partial_native_mapping",
                    pinned: false,
                    archived: false,
                  },
                ]
              : [],
          tombstones: [],
        },
        verifiedNativeSessionIds:
          state === "partial-mapping" ? ["native-held"] : [],
      });
    }
    await f.registry.checkpoint();
    f.registry = await reopened(t, f);
    assert.equal(f.registry.status().state, "ready");
    assert.equal(f.registry.readView().state, "unavailable");
    assert.deepEqual(
      f.registry
        .readView()
        .retainedOperations.map((entry) => entry.operationId),
      [held.operationId],
    );
    const retry = { ...held, operationId: "blocked-transfer" };
    const admission = await f.registry.begin(
      identity(retry.operationId, scope),
    );
    assert.equal(admission.status, "rejected");
    assert.equal(admission.receipt.result.code, "UNAVAILABLE");
    const bytes = await fs.readFile(join(f.directory, "journal.jsonl"));
    await assert.rejects(f.registry.reserve(retry), {
      code: "identity_conflict",
    });
    assert.deepEqual(
      await fs.readFile(join(f.directory, "journal.jsonl")),
      bytes,
    );
    assert.deepEqual(
      f.registry.lookupIdentity(key),
      identity(held.operationId, scope),
    );
    assert.equal(
      f.registry.lookup(key).receipt.effect,
      state === "nonterminal" ? "none" : "unknown",
    );
    if (state === "partial-mapping")
      assert.equal(f.registry.readView().sessions[0].status, "unavailable");
  });
}

for (const uncertain of ["failed-rejection-flush", "rejected-retry-tail"]) {
  test(`JR-V5-R3-01 ${uncertain} cannot authorize ID transfer or clear original holds`, async (t) => {
    let rejectFlush = false;
    const f = await fixture(t, {
      syncFile: async (file, context) => {
        if (rejectFlush && context === "append:completion")
          throw new Error("unconfirmed rejection flush");
        await file.sync();
      },
    });
    const staged = await createManagedWorkspaceOnly(f);
    await f.registry.checkpoint();
    const scope = {
      type: "session.create",
      workspaceId: staged.workspace.workspaceId,
    };
    const request = {
      runtimeEpoch: "old",
      operationId: "uncertain-rejection",
      workspaceId: scope.workspaceId,
    };
    await f.registry.begin(identity(request.operationId, scope));
    const reserved = await f.registry.reserve(request);
    assert.equal(reserved.appSessionId, staged.workspace.folderSessionId);
    const heldIds = [request.operationId];
    if (uncertain === "failed-rejection-flush") {
      await f.registry.checkpoint();
      rejectFlush = true;
      await assert.rejects(rejectReservedSession(f, request), {
        code: "writer_poisoned",
      });
      assert.equal(
        f.registry.lookup({
          runtimeEpoch: request.runtimeEpoch,
          operationId: request.operationId,
        }).receipt.admission,
        "admitted",
      );
      await assert.rejects(f.registry.begin(identity("after-poison", scope)), {
        code: "writer_poisoned",
      });
    } else {
      await rejectReservedSession(f, request);
      for (const operationId of ["tail-rejected-retry", "tail-pending-retry"]) {
        const retry = { ...request, operationId };
        await f.registry.begin(identity(operationId, scope));
        assert.equal(
          (await f.registry.reserve(retry)).appSessionId,
          staged.workspace.folderSessionId,
        );
        heldIds.push(operationId);
        if (operationId === "tail-rejected-retry")
          await rejectReservedSession(f, retry);
      }
    }
    const bytes = await fs.readFile(join(f.directory, "journal.jsonl"));
    f.registry = await reopened(t, f);
    assert.equal(f.registry.status().reason, "unconfirmed_tail");
    assert.deepEqual(
      f.registry
        .readView()
        .retainedOperations.map((entry) => entry.operationId),
      heldIds,
    );
    assert.equal(f.registry.readView().sessions.length, 0);
    assert.ok(
      f.registry
        .readView()
        .recovery.resources.some(
          (entry) =>
            entry.workspaceId === scope.workspaceId &&
            entry.reason === "unresolved_operation",
        ),
    );
    for (const operationId of heldIds) {
      const lookup = f.registry.lookup({
        runtimeEpoch: request.runtimeEpoch,
        operationId,
      });
      assert.notEqual(lookup.receipt.admission, "rejected");
      if (uncertain === "rejected-retry-tail")
        assert.equal(lookup.receipt.effect, "unknown");
    }
    await assert.rejects(f.registry.begin(identity("cannot-transfer", scope)), {
      code: "unconfirmed_tail",
    });
    await assert.rejects(f.registry.reserve(request), {
      code: "unconfirmed_tail",
    });
    await assert.rejects(
      f.registry.dispatch({
        runtimeEpoch: request.runtimeEpoch,
        operationId: request.operationId,
        step: "native.create",
      }),
      { code: "unconfirmed_tail" },
    );
    assert.deepEqual(
      await fs.readFile(join(f.directory, "journal.jsonl")),
      bytes,
    );
  });
}

for (const collision of ["cross-workspace", "wrong-kind"]) {
  test(`HOST-first-session ${collision} reservation cannot inherit another operation's folder identity`, async (t) => {
    const f = await fixture(t);
    const staged = await createManagedWorkspaceOnly(f);
    let workspace = staged.workspace;
    if (collision === "cross-workspace")
      workspace = (await createManagedWorkspaceOnly(f, "other-workspace"))
        .workspace;
    const request = { runtimeEpoch: "old", operationId: "forged-first" };
    await f.registry.begin(
      identity(request.operationId, {
        type: collision === "wrong-kind" ? "session.pin" : "session.create",
        workspaceId: workspace.workspaceId,
      }),
    );
    await checkpointForgedReservation(
      t,
      f,
      request,
      workspace,
      staged.appSessionId,
    );
  });
}

for (const count of [0, 199]) {
  test(`HOST-first-session uncheckpointed staged reuse at ${count} sessions retains both unknown holds until explicit tail adoption`, async (t) => {
    const f = await fixture(t);
    if (count) await committedSessions(t, f, count);
    const staged = await createManagedWorkspaceOnly(f);
    const request = { runtimeEpoch: "old", operationId: "first-tail" };
    await f.registry.begin(
      identity(request.operationId, {
        type: "session.create",
        workspaceId: staged.workspace.workspaceId,
      }),
    );
    const reserved = await f.registry.reserve({
      ...request,
      workspaceId: staged.workspace.workspaceId,
    });
    assert.equal(reserved.appSessionId, staged.appSessionId);
    await completeReservedSession(f, request, reserved);
    const bytes = await fs.readFile(join(f.directory, "journal.jsonl"));
    const registry = await reopened(t, f);
    assert.equal(registry.status().reason, "unconfirmed_tail");
    assert.equal(registry.readView().sessions.length, count);
    assert.equal(registry.readView().retainedOperations.length, 2);
    for (const operationId of ["workspace-only", "first-tail"])
      assert.equal(
        registry.lookup({ runtimeEpoch: "old", operationId }).receipt.effect,
        "unknown",
      );
    assert.deepEqual(
      await fs.readFile(join(f.directory, "journal.jsonl")),
      bytes,
    );
    const { sequence, hash } = registry.status().journal;
    await registry.recover({
      action: "adopt_validated_tail",
      expectedSequence: sequence,
      expectedHash: hash,
      ownerVerified: true,
      preflightVerified: true,
    });
    assert.equal(registry.status().state, "ready");
    assert.equal(
      registry.readView().sessions.at(-1).appSessionId,
      staged.appSessionId,
    );
    assert.equal(registry.lookup(request).receipt.effect, "confirmed");
  });
}

test("JR-V5-03 200 committed sessions block create/fork/import/managed reservation before any first effect", async (t) => {
  const f = await fixture(t);
  const { sessions } = await committedSessions(t, f, 200);
  let effects = 0;
  for (const type of [
    "session.create",
    "session.fork",
    "workspace.create",
    "workspace.import",
  ]) {
    const operationId = type.replace(".", "-");
    const scope = type.startsWith("session.")
      ? {
          workspaceId: sessions[0].workspaceId,
          ...(type === "session.fork" && {
            sessionId: sessions[0].appSessionId,
          }),
        }
      : {};
    await f.registry.begin(identity(operationId, { type, ...scope }));
    const request = {
      runtimeEpoch: "old",
      operationId,
      ...(scope.workspaceId
        ? { workspaceId: scope.workspaceId }
        : type === "workspace.create"
          ? { ownership: "managed" }
          : { ownership: "imported", canonicalPath: f.documentsPath }),
    };
    const before = await fs.readFile(join(f.directory, "journal.jsonl"));
    await assert.rejects(
      (async () => {
        await f.registry.reserve(request);
        if (type === "workspace.create")
          await f.registry.materializeManaged({
            runtimeEpoch: "old",
            operationId,
          });
        const result = await f.registry.dispatch({
          runtimeEpoch: "old",
          operationId,
          step: type === "session.fork" ? "native.fork" : "native.create",
        });
        if (result.status === "dispatched") effects++;
      })(),
      { code: "retained_limit" },
    );
    assert.deepEqual(
      await fs.readFile(join(f.directory, "journal.jsonl")),
      before,
    );
    // Reject the no-effect admission so the next scope check is independent.
    await f.registry.complete({
      runtimeEpoch: "old",
      operationId,
      receipt: receipt(operationId, {
        type,
        ...scope,
        admission: "rejected",
        effect: "none",
        delivery: "pending",
        result: { kind: "rejected", code: "LIMIT_REACHED" },
      }),
      delta: { workspaces: [], sessions: [], tombstones: [] },
    });
  }
  assert.equal(effects, 0);
  assert.deepEqual(await fs.readdir(f.documentsPath), []);
  assert.equal(f.registry.readView().sessions.length, 200);
});

test("JR-V5-03 at 199 concurrent cross-workspace reservations share one slot; duplicates do not append and rejection releases it", async (t) => {
  const f = await fixture(t);
  const { workspaces } = await committedSessions(t, f, 199);
  const requests = workspaces.map((workspace, index) => ({
    runtimeEpoch: "old",
    operationId: `reserve-${index}`,
    workspaceId: workspace.workspaceId,
  }));
  for (const request of requests)
    await f.registry.begin(
      identity(request.operationId, {
        type: "session.create",
        workspaceId: request.workspaceId,
      }),
    );
  const results = await Promise.allSettled(
    requests.map((request) => f.registry.reserve(request)),
  );
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  const winner = results.findIndex((result) => result.status === "fulfilled");
  const loser = 1 - winner;
  assert.equal(results[loser].reason.code, "retained_limit");
  const before = await fs.readFile(join(f.directory, "journal.jsonl"));
  assert.equal(
    (await f.registry.reserve(requests[winner])).status,
    "duplicate",
  );
  assert.equal(
    (
      await f.registry.begin(
        identity(requests[winner].operationId, {
          type: "session.create",
          workspaceId: requests[winner].workspaceId,
        }),
      )
    ).status,
    "duplicate",
  );
  await assert.rejects(f.registry.reserve(requests[loser]), {
    code: "retained_limit",
  });
  await assert.rejects(
    f.registry.dispatch({
      runtimeEpoch: "old",
      operationId: requests[loser].operationId,
      step: "native.create",
    }),
    { code: "identity_conflict" },
  );
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    before,
  );
  await f.registry.complete({
    runtimeEpoch: "old",
    operationId: requests[winner].operationId,
    receipt: receipt(requests[winner].operationId, {
      type: "session.create",
      workspaceId: requests[winner].workspaceId,
      admission: "rejected",
      effect: "none",
      delivery: "pending",
      result: { kind: "rejected", code: "UNAVAILABLE" },
    }),
    delta: { workspaces: [], sessions: [], tombstones: [] },
  });
  assert.equal((await f.registry.reserve(requests[loser])).status, "reserved");
  await f.registry.checkpoint();
  const registry = await reopened(t, f);
  const retry = {
    runtimeEpoch: "old",
    operationId: "after-reopen",
    workspaceId: requests[winner].workspaceId,
  };
  await registry.begin(
    identity(retry.operationId, {
      type: "session.create",
      workspaceId: retry.workspaceId,
    }),
  );
  await assert.rejects(registry.reserve(retry), { code: "retained_limit" });
  assert.equal((await registry.reserve(requests[loser])).status, "duplicate");
});

test("JR-V5-03 an unresolved verified mapping counts once when its reservation becomes a committed session", async (t) => {
  const f = await fixture(t);
  const { workspaces } = await committedSessions(t, f, 198);
  const first = {
    runtimeEpoch: "old",
    operationId: "partial",
    workspaceId: workspaces[0].workspaceId,
  };
  await f.registry.begin(
    identity(first.operationId, {
      type: "session.create",
      workspaceId: first.workspaceId,
    }),
  );
  const reserved = await f.registry.reserve({
    ...first,
    plannedNativeSessionId: "native-partial",
  });
  await f.registry.dispatch({
    runtimeEpoch: "old",
    operationId: first.operationId,
    step: "native.create",
    nativeSessionId: "native-partial",
  });
  await f.registry.complete({
    runtimeEpoch: "old",
    operationId: first.operationId,
    receipt: receipt(first.operationId, {
      type: "session.create",
      workspaceId: first.workspaceId,
      effect: "unknown",
      delivery: "unknown",
    }),
    verifiedNativeSessionIds: ["native-partial"],
    delta: {
      workspaces: [],
      tombstones: [],
      sessions: [
        {
          appSessionId: reserved.appSessionId,
          workspaceId: first.workspaceId,
          nativeSessionId: "native-partial",
          lifecycleState: "unavailable",
          recoveryReason: "partial_native_mapping",
          pinned: false,
          archived: false,
        },
      ],
    },
  });
  assert.equal(f.registry.readView().sessions.length, 199);
  const second = {
    runtimeEpoch: "old",
    operationId: "last-slot",
    workspaceId: workspaces[1].workspaceId,
  };
  await f.registry.begin(
    identity(second.operationId, {
      type: "session.create",
      workspaceId: second.workspaceId,
    }),
  );
  assert.equal((await f.registry.reserve(second)).status, "reserved");
  assert.equal((await f.registry.reserve(second)).status, "duplicate");
});

test("committed fork identity lookup survives checkpoint without inherited native metadata or read effects", async (t) => {
  const f = await fixture(t);
  const parent = await createManaged(f);
  const original = identity("fork-key", {
    type: "session.fork",
    workspaceId: parent.workspace.workspaceId,
    sessionId: parent.appSessionId,
  });
  const key = {
    runtimeEpoch: original.runtimeEpoch,
    operationId: original.operationId,
  };
  await f.registry.begin(original);
  const child = await f.registry.reserve({
    ...key,
    workspaceId: original.workspaceId,
  });
  const request = { appSessionId: child.appSessionId };
  assert.equal(f.registry.lookupForkIdentity(request), undefined);
  await f.registry.dispatch({ ...key, step: "native.fork" });
  assert.equal(f.registry.lookupForkIdentity(request), undefined);
  await f.registry.complete({
    ...key,
    receipt: receipt(original.operationId, {
      type: original.type,
      workspaceId: original.workspaceId,
      sessionId: original.sessionId,
      result: {
        kind: "forked",
        workspaceId: original.workspaceId,
        sessionId: child.appSessionId,
        nativeSessionId: "fork-native",
      },
    }),
    delta: {
      workspaces: [],
      sessions: [
        {
          appSessionId: child.appSessionId,
          workspaceId: original.workspaceId,
          nativeSessionId: "fork-native",
          parentSessionId: parent.appSessionId,
          lifecycleState: "active",
          pinned: false,
          archived: false,
        },
      ],
      tombstones: [],
    },
    verifiedNativeSessionIds: ["fork-native"],
  });
  const before = await fs.readFile(join(f.directory, "journal.jsonl"));
  const sequence = f.registry.readView().observationSequence;
  const found = f.registry.lookupForkIdentity(request);
  assert.deepEqual(found, original);
  found.digest = "b".repeat(64);
  found.operationId = "changed";
  assert.deepEqual(f.registry.lookupForkIdentity(request), original);
  assert.equal(
    f.registry.lookupForkIdentity({ appSessionId: parent.appSessionId }),
    undefined,
  );
  assert.equal(
    f.registry.lookupForkIdentity({ appSessionId: "missing" }),
    undefined,
  );
  for (const invalid of [
    null,
    {},
    { ...request, digest: original.digest },
    { appSessionId: "bad/id" },
  ])
    assert.throws(() => f.registry.lookupForkIdentity(invalid), {
      code: "invalid_record",
    });
  assert.equal(f.registry.readView().observationSequence, sequence + 1);
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    before,
  );
  await f.registry.checkpoint();
  f.registry = await reopened(t, f);
  assert.deepEqual(f.registry.lookupForkIdentity(request), original);
  assert.equal(f.registry.readView().retainedOperations.length, 0);
  assert.equal(JSON.stringify(f.registry.readView()).includes("digest"), false);
});

test("lookupIdentity returns a defensive original-epoch admitted identity without wire digest, append or observation tick", async (t) => {
  const f = await fixture(t);
  const created = await createManaged(f);
  const original = identity("identity-lookup", {
    type: "session.rename",
    workspaceId: created.workspace.workspaceId,
    sessionId: created.appSessionId,
  });
  await f.registry.begin(original);
  const request = { runtimeEpoch: "old", operationId: original.operationId };
  const before = await fs.readFile(join(f.directory, "journal.jsonl"));
  const sequence = f.registry.readView().observationSequence;
  const returned = f.registry.lookupIdentity(request);
  assert.deepEqual(returned, original);
  returned.digest = "b".repeat(64);
  returned.workspaceId = "changed";
  returned.sessionId = "changed";
  request.operationId = "changed";
  const key = { runtimeEpoch: "old", operationId: original.operationId };
  assert.deepEqual(f.registry.lookupIdentity(key), original);
  assert.equal(
    f.registry.lookupIdentity({ ...key, runtimeEpoch: "current" }),
    undefined,
  );
  assert.equal(
    f.registry.lookupIdentity({ ...key, operationId: "missing" }),
    undefined,
  );
  for (const malformed of [
    null,
    {},
    { runtimeEpoch: "old" },
    { ...key, digest: original.digest },
    { ...key, operationId: "x".repeat(257) },
    { ...key, runtimeEpoch: false },
    { ...key, operationId: "bad/id" },
  ])
    assert.throws(() => f.registry.lookupIdentity(malformed), {
      code: "invalid_record",
    });
  assert.equal(
    JSON.stringify(f.registry.lookup(key)).includes("digest"),
    false,
  );
  const view = f.registry.readView();
  assert.equal(view.observationSequence, sequence + 1);
  assert.equal(JSON.stringify(view).includes("digest"), false);
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    before,
  );
  await f.registry.checkpoint();
  const registry = await reopened(t, f);
  assert.equal(registry.status().state, "ready");
  assert.deepEqual(registry.lookupIdentity(key), original);
  assert.equal(JSON.stringify(registry.lookup(key)).includes("digest"), false);
});

test("lookupIdentity hides in-flight admission and conservative tail identity until explicit validated adoption", async (t) => {
  const paused = deferred();
  let enabled = false,
    entered = false;
  const f = await fixture(t, {
    syncFile: async (file, context) => {
      if (enabled && context === "append:admission") {
        entered = true;
        await paused.promise;
      }
      await file.sync();
    },
  });
  const committed = identity("checkpointed");
  await f.registry.begin(committed);
  await f.registry.checkpoint();
  enabled = true;
  const tail = identity("uncheckpointed");
  const key = { runtimeEpoch: "old", operationId: tail.operationId };
  assert.equal(f.registry.lookupIdentity(key), undefined);
  const admission = f.registry.begin(tail);
  await until(() => entered, paused.resolve);
  assert.equal(f.registry.lookupIdentity(key), undefined);
  paused.resolve();
  await admission;
  assert.deepEqual(f.registry.lookupIdentity(key), tail);
  const registry = await reopened(t, f);
  assert.equal(registry.status().reason, "unconfirmed_tail");
  assert.deepEqual(
    registry.lookupIdentity({
      runtimeEpoch: "old",
      operationId: committed.operationId,
    }),
    committed,
  );
  assert.equal(registry.lookup(key).status, "found");
  assert.equal(registry.lookupIdentity(key), undefined);
  const before = await fs.readFile(join(f.directory, "journal.jsonl"));
  assert.equal(JSON.stringify(registry.readView()).includes("digest"), false);
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    before,
  );
  const { sequence, hash } = registry.status().journal;
  await registry.recover({
    action: "adopt_validated_tail",
    expectedSequence: sequence,
    expectedHash: hash,
    ownerVerified: true,
    preflightVerified: true,
  });
  assert.deepEqual(registry.lookupIdentity(key), tail);
});

test("lookupIdentity owner-conflict facade returns undefined without opening a journal", async (t) => {
  const f = await fixture(t);
  const directory = join(f.root, "conflict-private");
  const registry = await openWorkspaceRegistry({
    ...f.options,
    directory,
    recoveryReason: "owner_conflict",
  });
  t.after(() => registry.close());
  assert.equal(
    registry.lookupIdentity({ runtimeEpoch: "old", operationId: "missing" }),
    undefined,
  );
  await assert.rejects(fs.stat(directory), { code: "ENOENT" });
  assert.equal(JSON.stringify(registry.readView()).includes("digest"), false);
});

test("managed stable UUID is flushed BEFORE every mkdir; names never select filesystem paths", async (t) => {
  const calls = [];
  const f = await fixture(t);
  const registry = await openWorkspaceRegistry({
    ...f.options,
    directory: join(f.root, "private2"),
    recoveryReason: "owner_conflict",
  });
  await registry.close(); // Owner-conflict construction does not even create that directory.
  await f.registry.begin(identity());
  const reservation = await f.registry.reserve({
    runtimeEpoch: "old",
    operationId: "op",
    ownership: "managed",
    name: "DISPLAY ONLY",
  });
  const { workspace, appSessionId } = reservation;
  assert.equal(workspace.folderSessionId, appSessionId);
  assert.equal(
    workspace.canonicalPath,
    join(f.documentsPath, "OhMyOwnCode", appSessionId),
  );
  await assert.rejects(fs.stat(workspace.canonicalPath), { code: "ENOENT" });
  const records = (
    await fs.readFile(join(f.directory, "journal.jsonl"), "utf8")
  )
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.equal(records.at(-1).payload.kind, "reservation");
  assert.equal(records.at(-1).payload.appSessionId, appSessionId);
  await f.registry.materializeManaged({
    runtimeEpoch: "old",
    operationId: "op",
  });
  calls.push((await fs.stat(workspace.canonicalPath)).isDirectory());
  assert.deepEqual(calls, [true]);
  await assert.rejects(
    f.registry.materializeManaged({ runtimeEpoch: "old", operationId: "op" }),
  );
  assert.equal((await fs.stat(workspace.canonicalPath)).isDirectory(), true);
});

test("second dispatch flush rejects after first effect: no second call and poison blocks every later mutation", async (t) => {
  let dispatches = 0,
    effects = 0;
  const f = await fixture(t, {
    syncFile: async (file, context) => {
      if (context === "append:dispatch" && ++dispatches === 2)
        throw new Error("PRIVATE raw failure");
      await file.sync();
    },
  });
  await f.registry.begin(identity());
  await f.registry.reserve({
    runtimeEpoch: "old",
    operationId: "op",
    ownership: "managed",
  });
  const run = async (step) => {
    const result = await f.registry.dispatch({
      runtimeEpoch: "old",
      operationId: "op",
      step,
    });
    if (result.status === "dispatched") effects++;
  };
  await run("native.policy");
  await assert.rejects(run("native.model"), { code: "writer_poisoned" });
  assert.equal(effects, 1);
  assert.equal(f.registry.status().reason, "writer_poisoned");
  assert.equal(
    f.registry.lookup({ runtimeEpoch: "old", operationId: "op" }).receipt
      .effect,
    "unknown",
  );
  const bytes = await fs.readFile(join(f.directory, "journal.jsonl"));
  await assert.rejects(f.registry.begin(identity("next")), {
    code: "writer_poisoned",
  });
  await assert.rejects(
    f.registry.dispatch({
      runtimeEpoch: "old",
      operationId: "op",
      step: "native.agent",
    }),
    { code: "writer_poisoned" },
  );
  assert.equal(effects, 1);
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    bytes,
  );
});

test("admission failure allows zero effects and provides no invented durable receipt", async (t) => {
  const f = await fixture(t, {
    syncFile: async (file, context) => {
      if (context === "append:admission") throw new Error("fault");
      await file.sync();
    },
  });
  let effects = 0;
  await assert.rejects(
    (async () => {
      await f.registry.begin(identity());
      await f.registry.reserve({
        runtimeEpoch: "old",
        operationId: "op",
        ownership: "managed",
      });
      effects++;
    })(),
    { code: "writer_poisoned" },
  );
  assert.equal(effects, 0);
  assert.equal(
    f.registry.lookup({ runtimeEpoch: "old", operationId: "op" }).status,
    "wrong_epoch",
  );
  assert.deepEqual(await fs.readdir(f.documentsPath), []);
});

for (const action of ["create", "metadata", "remove"]) {
  test(`${action} completion flush rejection hides mapping/metadata/tombstone, even with a checksum-valid tail`, async (t) => {
    let failing = false;
    const f = await fixture(t, {
      syncFile: async (file, context) => {
        if (failing && context === "append:completion")
          throw new Error("fault");
        await file.sync();
      },
    });
    const reserved = action === "create" ? undefined : await createManaged(f);
    await f.registry.checkpoint();
    let targetId, delta, finalReceipt;
    if (action === "create") {
      await f.registry.begin(identity());
      const next = await f.registry.reserve({
        runtimeEpoch: "old",
        operationId: "op",
        ownership: "managed",
        plannedNativeSessionId: "native",
      });
      await f.registry.materializeManaged({
        runtimeEpoch: "old",
        operationId: "op",
      });
      await f.registry.dispatch({
        runtimeEpoch: "old",
        operationId: "op",
        step: "native.create",
        nativeSessionId: "native",
      });
      delta = {
        workspaces: [{ ...next.workspace, registrationState: "registered" }],
        sessions: [
          {
            appSessionId: next.appSessionId,
            workspaceId: next.workspace.workspaceId,
            nativeSessionId: "native",
            lifecycleState: "active",
            pinned: false,
            archived: false,
          },
        ],
        tombstones: [],
      };
      targetId = "op";
      finalReceipt = receipt();
    } else {
      targetId = action;
      const type = action === "metadata" ? "session.pin" : "session.remove";
      const scope = {
        workspaceId: reserved.workspace.workspaceId,
        sessionId: reserved.appSessionId,
      };
      await f.registry.begin(identity(action, { type, ...scope }));
      await f.registry.dispatch({
        runtimeEpoch: "old",
        operationId: action,
        step: `native.${action}`,
      });
      finalReceipt = receipt(action, { type, ...scope });
      delta =
        action === "metadata"
          ? {
              workspaces: [],
              sessions: [{ ...reserved.delta.sessions[0], pinned: true }],
              tombstones: [],
            }
          : {
              workspaces: [],
              sessions: [],
              tombstones: [{ kind: "session", id: reserved.appSessionId }],
            };
    }
    await f.registry.checkpoint();
    const before = f.registry.readView();
    failing = true;
    await assert.rejects(
      f.registry.complete({
        runtimeEpoch: "old",
        operationId: targetId,
        receipt: finalReceipt,
        delta,
        verifiedNativeSessionIds: action === "create" ? ["native"] : [],
      }),
      { code: "writer_poisoned" },
    );
    assert.deepEqual(
      f.registry.readView().sessions,
      before.sessions.map((session) => ({ ...session, status: "unavailable" })),
    );
    assert.deepEqual(f.registry.readView().tombstones, before.tombstones);
    assert.equal(
      f.registry.lookup({ runtimeEpoch: "old", operationId: targetId }).receipt
        .effect,
      "unknown",
    );
    const bytes = await fs.readFile(join(f.directory, "journal.jsonl"));
    const recovered = await reopened(t, f);
    assert.equal(recovered.status().reason, "unconfirmed_tail");
    assert.equal(recovered.status().revision, before.revision);
    assert.deepEqual(
      recovered
        .readView()
        .sessions.map(({ status: _status, ...session }) => session),
      before.sessions.map(({ status: _status, ...session }) => session),
    );
    assert.deepEqual(recovered.readView().tombstones, before.tombstones);
    assert.equal(
      recovered.lookup({ runtimeEpoch: "old", operationId: targetId }).receipt
        .effect,
      "unknown",
    );
    assert.deepEqual(
      await fs.readFile(join(f.directory, "journal.jsonl")),
      bytes,
    );
  });
}

test("old epoch lookup, immutable conflict, no-op duplicate and unknown resource holds survive explicit checkpoint/reopen", async (t) => {
  const f = await fixture(t);
  const reserved = await createManaged(f);
  await f.registry.begin(
    identity("send", {
      type: "message.send",
      workspaceId: reserved.workspace.workspaceId,
      sessionId: reserved.appSessionId,
    }),
  );
  await f.registry.dispatch({
    runtimeEpoch: "old",
    operationId: "send",
    step: "native.send",
  });
  await f.registry.checkpoint();
  const registry = await reopened(t, f);
  const view = registry.readView();
  assert.equal(view.runtimeEpoch, "new");
  assert.equal(view.temporary, false);
  assert.equal(view.sessions[0].status, "unavailable");
  assert.deepEqual(view.retainedOperations, [
    {
      runtimeEpoch: "old",
      operationId: "send",
      type: "message.send",
      workspaceId: reserved.workspace.workspaceId,
      sessionId: reserved.appSessionId,
    },
  ]);
  assert.equal(
    registry.lookup({ runtimeEpoch: "old", operationId: "send" }).receipt
      .effect,
    "unknown",
  );
  assert.equal(
    registry.lookup({ runtimeEpoch: "old", operationId: "absent" }).status,
    "missing",
  );
  assert.equal(
    registry.lookup({ runtimeEpoch: "never", operationId: "send" }).status,
    "wrong_epoch",
  );
  const before = await fs.readFile(join(f.directory, "journal.jsonl"));
  assert.equal(
    (
      await registry.begin(
        identity("send", {
          type: "message.send",
          workspaceId: reserved.workspace.workspaceId,
          sessionId: reserved.appSessionId,
        }),
      )
    ).status,
    "duplicate",
  );
  assert.equal(
    (
      await registry.dispatch({
        runtimeEpoch: "old",
        operationId: "send",
        step: "native.send",
      })
    ).status,
    "duplicate",
  );
  await assert.rejects(
    registry.begin(
      identity("send", {
        type: "message.send",
        digest: "b".repeat(64),
        workspaceId: reserved.workspace.workspaceId,
        sessionId: reserved.appSessionId,
      }),
    ),
    { code: "DUPLICATE_CONFLICT" },
  );
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    before,
  );
  const blocked = await registry.begin(
    identity("blocked", {
      type: "session.pin",
      workspaceId: reserved.workspace.workspaceId,
      sessionId: reserved.appSessionId,
    }),
  );
  assert.equal(blocked.status, "rejected");
  assert.equal(blocked.receipt.result.code, "UNAVAILABLE");
  assert.equal(registry.readView().retainedOperations.length, 1);
  assert.equal(
    (await registry.begin(identity("unrelated"))).status,
    "admitted",
  );
});

test("exact verified partial mapping is atomic, unavailable and retains unknown hold; unverified IDs are rejected", async (t) => {
  const f = await fixture(t);
  await f.registry.begin(identity());
  const reserved = await f.registry.reserve({
    runtimeEpoch: "old",
    operationId: "op",
    ownership: "managed",
    plannedNativeSessionId: "native",
  });
  await f.registry.dispatch({
    runtimeEpoch: "old",
    operationId: "op",
    step: "native.create",
    nativeSessionId: "native",
  });
  const delta = {
    workspaces: [{ ...reserved.workspace, registrationState: "unavailable" }],
    sessions: [
      {
        appSessionId: reserved.appSessionId,
        workspaceId: reserved.workspace.workspaceId,
        nativeSessionId: "native",
        lifecycleState: "unavailable",
        recoveryReason: "partial_native_mapping",
        pinned: false,
        archived: false,
      },
    ],
    tombstones: [],
  };
  const candidate = {
    runtimeEpoch: "old",
    operationId: "op",
    receipt: receipt("op", {
      effect: "unknown",
      delivery: "unknown",
      prompt: "PRIVATE PROMPT",
      permission: "approve",
      result: {
        kind: "created",
        workspaceId: reserved.workspace.workspaceId,
        nativeSessionId: "native",
        rawError: "PRIVATE ERROR",
      },
    }),
    delta,
  };
  await assert.rejects(f.registry.complete(candidate), {
    code: "native_mapping_unverified",
  });
  assert.equal(f.registry.readView().sessions.length, 0);
  await f.registry.complete({
    ...candidate,
    verifiedNativeSessionIds: ["native"],
  });
  await f.registry.checkpoint();
  const registry = await reopened(t, f);
  const view = registry.readView();
  assert.equal(view.sessions[0].nativeSessionId, "native");
  assert.equal(view.sessions[0].status, "unavailable");
  assert.ok(
    view.recovery.resources.some(
      (entry) => entry.reason === "partial_native_mapping",
    ),
  );
  assert.equal(view.retainedOperations.length, 1);
  assert.equal(
    registry.lookup({ runtimeEpoch: "old", operationId: "op" }).receipt.effect,
    "unknown",
  );
  const disk = await fs.readFile(join(f.directory, "journal.jsonl"), "utf8");
  assert.ok(!disk.includes("PRIVATE"));
  assert.ok(!disk.includes("approve"));
});

test("import stays in place: rename, session deletion and unregister never move or delete sentinels", async (t) => {
  const f = await fixture(t);
  const imported = join(f.root, "imported");
  await fs.mkdir(imported);
  await fs.writeFile(join(imported, "sentinel"), "KEEP");
  const alias = join(f.root, "alias");
  await fs.symlink(imported, alias);
  await f.registry.begin(identity("import", { type: "workspace.import" }));
  const reserved = await f.registry.reserve({
    runtimeEpoch: "old",
    operationId: "import",
    ownership: "imported",
    canonicalPath: alias,
    plannedNativeSessionId: "native-import",
  });
  assert.equal(reserved.workspace.canonicalPath, imported);
  await f.registry.dispatch({
    runtimeEpoch: "old",
    operationId: "import",
    step: "native.create",
    nativeSessionId: "native-import",
  });
  const session = {
    appSessionId: reserved.appSessionId,
    workspaceId: reserved.workspace.workspaceId,
    nativeSessionId: "native-import",
    lifecycleState: "active",
    pinned: false,
    archived: false,
  };
  await f.registry.complete({
    runtimeEpoch: "old",
    operationId: "import",
    receipt: receipt("import", { type: "workspace.import" }),
    delta: {
      workspaces: [{ ...reserved.workspace, registrationState: "registered" }],
      sessions: [session],
      tombstones: [],
    },
    verifiedNativeSessionIds: ["native-import"],
  });
  const scope = {
    workspaceId: session.workspaceId,
    sessionId: session.appSessionId,
  };
  await f.registry.begin(
    identity("rename", { type: "session.rename", ...scope }),
  );
  await f.registry.dispatch({
    runtimeEpoch: "old",
    operationId: "rename",
    step: "native.rename",
  });
  await f.registry.complete({
    runtimeEpoch: "old",
    operationId: "rename",
    receipt: receipt("rename", { type: "session.rename", ...scope }),
    delta: {
      workspaces: [],
      sessions: [{ ...session, title: "NEW NAME" }],
      tombstones: [],
    },
  });
  assert.equal(f.registry.readView().workspaces[0].canonicalPath, imported);
  await f.registry.begin(
    identity("remove", {
      type: "workspace.remove",
      workspaceId: session.workspaceId,
    }),
  );
  await f.registry.dispatch({
    runtimeEpoch: "old",
    operationId: "remove",
    step: "native.remove",
  });
  const completion = {
    runtimeEpoch: "old",
    operationId: "remove",
    receipt: receipt("remove", {
      type: "workspace.remove",
      workspaceId: session.workspaceId,
    }),
    delta: {
      workspaces: [],
      sessions: [],
      tombstones: [
        { kind: "session", id: session.appSessionId },
        { kind: "workspace", id: session.workspaceId },
      ],
    },
  };
  await f.registry.complete(completion);
  await f.registry.checkpoint();
  const registry = await reopened(t, f);
  assert.equal(registry.readView().workspaces.length, 0);
  assert.equal(registry.readView().sessions.length, 0);
  assert.equal(registry.readView().tombstones.length, 2);
  assert.equal((await registry.complete(completion)).status, "duplicate");
  assert.equal(await fs.readFile(join(imported, "sentinel"), "utf8"), "KEEP");
  assert.equal(await fs.realpath(alias), imported);
});

for (const failure of [
  "collision",
  "base-symlink",
  "Documents-symlink",
  "missing",
  "denied",
]) {
  test(`managed path ${failure} fails safely and preserves owned fixture sentinels`, async (t) => {
    const f = await fixture(t);
    const outside = join(f.root, "outside");
    await fs.mkdir(outside);
    await fs.writeFile(join(outside, "sentinel"), "KEEP");
    if (failure === "Documents-symlink") {
      await fs.rmdir(f.documentsPath);
      await fs.symlink(outside, f.documentsPath);
    }
    if (failure === "missing") await fs.rmdir(f.documentsPath);
    let registry = f.registry;
    if (failure === "denied") {
      await registry.close();
      registry = await openWorkspaceRegistry({
        ...f.options,
        pathIO: {
          lstat: async (path) => {
            if (path === f.documentsPath) {
              const error = new Error("PRIVATE path denied");
              error.code = "EACCES";
              throw error;
            }
            return fs.lstat(path);
          },
        },
      });
      t.after(() => registry.close());
    }
    await registry.begin(identity());
    if (["Documents-symlink", "missing", "denied"].includes(failure)) {
      await assert.rejects(
        registry.reserve({
          runtimeEpoch: "old",
          operationId: "op",
          ownership: "managed",
        }),
        {
          code:
            failure === "missing"
              ? "path_missing"
              : failure === "denied"
                ? "path_denied"
                : "path_conflict",
        },
      );
    } else {
      const reserved = await registry.reserve({
        runtimeEpoch: "old",
        operationId: "op",
        ownership: "managed",
      });
      const base = join(f.documentsPath, "OhMyOwnCode");
      if (failure === "base-symlink") await fs.symlink(outside, base);
      else {
        await fs.mkdir(base);
        await fs.mkdir(reserved.workspace.canonicalPath);
        await fs.writeFile(
          join(reserved.workspace.canonicalPath, "sentinel"),
          "KEEP",
        );
      }
      await assert.rejects(
        registry.materializeManaged({ runtimeEpoch: "old", operationId: "op" }),
        { code: "path_conflict" },
      );
      if (failure === "collision")
        assert.equal(
          await fs.readFile(
            join(reserved.workspace.canonicalPath, "sentinel"),
            "utf8",
          ),
          "KEEP",
        );
    }
    assert.equal(await fs.readFile(join(outside, "sentinel"), "utf8"), "KEEP");
  });
}

for (const reason of [
  "owner_conflict",
  "owner_unverified",
  "pending_inbox",
  "native_startup_unverified",
]) {
  test(`metadata-only ${reason} recovery does not admit mutations or expose native permissions`, async (t) => {
    const f = await fixture(t);
    await f.registry.close();
    if (reason.startsWith("owner_"))
      await fs.writeFile(
        join(f.directory, "journal.jsonl"),
        "PRIVATE CORRUPT OWNER JOURNAL",
      );
    const registry = await openWorkspaceRegistry({
      ...f.options,
      runtimeEpoch: "new",
      recoveryReason: reason,
    });
    t.after(() => registry.close());
    const view = registry.readView();
    assert.deepEqual(view.recovery.store, {
      state: "recovery_required",
      reason,
    });
    assert.equal(view.revision, 0);
    assert.deepEqual(view.permissions, []);
    assert.deepEqual(view.messages, []);
    assert.deepEqual(view.retainedOperations, []);
    await assert.rejects(registry.begin(identity()), { code: reason });
    assert.equal(
      registry.lookup({ runtimeEpoch: "old", operationId: "op" }).effect,
      "unknown",
    );
    if (reason.startsWith("owner_"))
      assert.equal(
        await fs.readFile(join(f.directory, "journal.jsonl"), "utf8"),
        "PRIVATE CORRUPT OWNER JOURNAL",
      );
  });
}

test("missing recorded managed location stays registered, unavailable and never recreated", async (t) => {
  const f = await fixture(t);
  const reserved = await createManaged(f);
  await f.registry.checkpoint();
  await fs.rmdir(reserved.workspace.canonicalPath);
  const registry = await reopened(t, f);
  const view = registry.readView();
  assert.equal(view.workspaces.length, 1);
  assert.equal(view.sessions[0].status, "unavailable");
  assert.ok(
    view.recovery.resources.some((entry) => entry.reason === "path_missing"),
  );
  await assert.rejects(fs.stat(reserved.workspace.canonicalPath), {
    code: "ENOENT",
  });
  const result = await registry.begin(
    identity("new", {
      type: "session.pin",
      workspaceId: reserved.workspace.workspaceId,
      sessionId: reserved.appSessionId,
    }),
  );
  assert.equal(result.receipt.result.code, "UNAVAILABLE");
});

for (const count of [2048, 2049]) {
  test(`retained original-epoch ${count} keys: complete bounded list or global retained_limit, never silent truncation`, async (t) => {
    const f = await fixture(t);
    await f.registry.close();
    let previousHash = "0".repeat(64);
    const lines = [];
    for (let index = 0; index < count; index++) {
      const body = {
        schemaVersion: 1,
        storeId: "store",
        sequence: index + 1,
        previousHash,
        payload: {
          kind: "admission",
          revision: index + 1,
          identity: identity(`op-${index}`),
        },
      };
      previousHash = createHash("sha256")
        .update(JSON.stringify(body))
        .digest("hex");
      lines.push(JSON.stringify({ ...body, checksum: previousHash }));
    }
    const bytes = Buffer.from(lines.join("\n") + "\n");
    await fs.writeFile(join(f.directory, "journal.jsonl"), bytes);
    if (count === 2048) {
      const checkpoint = {
        schemaVersion: 1,
        storeId: "store",
        generation: 1,
        sequence: count,
        hash: previousHash,
      };
      await fs.writeFile(
        join(f.directory, "checkpoint.json"),
        JSON.stringify({
          ...checkpoint,
          checksum: createHash("sha256")
            .update(JSON.stringify(checkpoint))
            .digest("hex"),
        }),
      );
    }
    const registry = await openWorkspaceRegistry({
      ...f.options,
      runtimeEpoch: "new",
    });
    t.after(() => registry.close());
    const view = registry.readView();
    if (count === 2048) {
      assert.equal(registry.status().state, "ready");
      assert.equal(view.retainedOperations.length, count);
      assert.deepEqual(view.retainedOperations.at(-1), {
        runtimeEpoch: "old",
        operationId: "op-2047",
        type: "workspace.create",
      });
      await assert.rejects(registry.begin(identity("excess")), {
        code: "LIMIT_REACHED",
      });
      assert.equal(
        registry.lookup({ runtimeEpoch: "old", operationId: "op-2047" }).status,
        "found",
      );
    } else {
      assert.equal(registry.status().reason, "retained_limit");
      assert.equal(view.recovery.store.reason, "retained_limit");
      assert.equal(view.revision, 0);
      assert.equal(view.retainedOperations.length, 0);
      await assert.rejects(registry.begin(identity("excess")), {
        code: "retained_limit",
      });
    }
    assert.deepEqual(
      await fs.readFile(join(f.directory, "journal.jsonl")),
      bytes,
    );
  });
}

test("duplicate create completion and reservation are no-ops; conflicting planned IDs fail without append", async (t) => {
  const f = await fixture(t);
  const reserved = await createManaged(f);
  const request = {
    runtimeEpoch: "old",
    operationId: "op",
    receipt: receipt(),
    delta: reserved.delta,
    verifiedNativeSessionIds: ["native-op"],
  };
  const before = await fs.readFile(join(f.directory, "journal.jsonl"));
  assert.equal((await f.registry.complete(request)).status, "duplicate");
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    before,
  );
  await f.registry.checkpoint();
  const registry = await reopened(t, f);
  assert.equal((await registry.complete(request)).status, "duplicate");
  await registry.begin(identity("reserved"));
  await registry.reserve({
    runtimeEpoch: "old",
    operationId: "reserved",
    ownership: "managed",
    plannedNativeSessionId: "chosen",
  });
  const reservedBytes = await fs.readFile(join(f.directory, "journal.jsonl"));
  assert.equal(
    (
      await registry.reserve({
        runtimeEpoch: "old",
        operationId: "reserved",
        ownership: "managed",
        plannedNativeSessionId: "chosen",
      })
    ).status,
    "duplicate",
  );
  await assert.rejects(
    registry.reserve({
      runtimeEpoch: "old",
      operationId: "reserved",
      ownership: "managed",
      plannedNativeSessionId: "other",
    }),
    { code: "DUPLICATE_CONFLICT" },
  );
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    reservedBytes,
  );
});

test("explicit recovery adopts only reviewed validated tail; ordinary reopen never promotes confirmed success", async (t) => {
  const f = await fixture(t);
  await createManaged(f);
  const registry = await reopened(t, f);
  assert.equal(registry.status().reason, "unconfirmed_tail");
  assert.equal(registry.readView().sessions.length, 0);
  assert.equal(registry.readView().revision, 0);
  assert.equal(
    registry.lookup({ runtimeEpoch: "old", operationId: "op" }).receipt.effect,
    "unknown",
  );
  const { sequence, hash } = registry.status().journal;
  await registry.recover({
    action: "adopt_validated_tail",
    expectedSequence: sequence,
    expectedHash: hash,
    ownerVerified: true,
    preflightVerified: true,
  });
  assert.equal(registry.status().state, "ready");
  assert.equal(registry.readView().sessions[0].nativeSessionId, "native-op");
  assert.equal(
    registry.lookup({ runtimeEpoch: "old", operationId: "op" }).receipt.effect,
    "confirmed",
  );
});

for (const action of ["metadata", "remove"]) {
  test(`paused ${action} completion exposes prior metadata/tombstones and unknown receipt until publication`, async (t) => {
    let paused = false,
      entered = false;
    const waiting = deferred();
    const f = await fixture(t, {
      syncFile: async (file, context) => {
        if (paused && context === "append:completion") {
          entered = true;
          await waiting.promise;
        }
        await file.sync();
      },
    });
    const reserved = await createManaged(f);
    const scope = {
      workspaceId: reserved.workspace.workspaceId,
      sessionId: reserved.appSessionId,
    };
    const type = action === "metadata" ? "session.pin" : "session.remove";
    await f.registry.begin(identity(action, { type, ...scope }));
    await f.registry.dispatch({
      runtimeEpoch: "old",
      operationId: action,
      step: `native.${action}`,
    });
    const delta =
      action === "metadata"
        ? {
            workspaces: [],
            sessions: [{ ...reserved.delta.sessions[0], pinned: true }],
            tombstones: [],
          }
        : {
            workspaces: [],
            sessions: [],
            tombstones: [{ kind: "session", id: reserved.appSessionId }],
          };
    const before = f.registry.readView();
    paused = true;
    const completion = f.registry.complete({
      runtimeEpoch: "old",
      operationId: action,
      receipt: receipt(action, { type, ...scope }),
      delta,
    });
    await until(() => entered, waiting.resolve);
    const view = f.registry.readView();
    assert.equal(view.revision, before.revision);
    assert.deepEqual(view.sessions, before.sessions);
    assert.deepEqual(view.tombstones, []);
    assert.equal(
      f.registry.lookup({ runtimeEpoch: "old", operationId: action }).receipt
        .effect,
      "unknown",
    );
    const concurrent = f.registry.begin({
      ...identity("busy"),
      rejectionCode: "BUSY",
    });
    waiting.resolve();
    await completion;
    await concurrent;
    assert.equal(
      f.registry.lookup({ runtimeEpoch: "old", operationId: "busy" }).receipt
        .result.code,
      "BUSY",
    );
    const published = f.registry.readView();
    if (action === "metadata") assert.equal(published.sessions[0].pinned, true);
    else {
      assert.equal(published.sessions.length, 0);
      assert.equal(published.tombstones.length, 1);
    }
    assert.equal(
      f.registry.lookup({ runtimeEpoch: "old", operationId: action }).receipt
        .effect,
      "confirmed",
    );
  });
}

test("configuration save marker does not invalidate its pre-marker revision; receipt survives old epoch lookup and duplicate no replay", async (t) => {
  const f = await fixture(t);
  const reserved = await createManagedWorkspaceOnly(f);
  const workspaceId = reserved.workspace.workspaceId;
  const expectedRevision = f.registry.status().revision;
  const save = identity("config-save", {
    type: "configuration.save",
    workspaceId,
    expectedRevision,
  });
  const admitted = await f.registry.begin(save);
  assert.equal(admitted.status, "admitted");
  assert.equal(f.registry.status().revision, expectedRevision + 2);
  const key = { runtimeEpoch: "old", operationId: "config-save" };
  await assert.rejects(
    f.registry.dispatch({ ...key, step: "filesystem.configuration.publish" }),
    { code: "identity_conflict" },
  );
  await f.registry.dispatch({ ...key, step: "filesystem.configuration.stage" });
  await f.registry.dispatch({
    ...key,
    step: "filesystem.configuration.publish",
  });
  const confirmed = receipt(key.operationId, {
    type: "configuration.save",
    workspaceId,
    result: {
      kind: "configuration_saved",
      workspaceId,
      configurationKind: "instructions",
      version: "b".repeat(64),
      backupId: configurationBackupId(
        key.runtimeEpoch,
        key.operationId,
        "instructions",
      ),
    },
  });
  const delta = { workspaces: [], sessions: [], tombstones: [] };
  await f.registry.complete({ ...key, receipt: confirmed, delta });
  assert.equal((await f.registry.begin(save)).status, "duplicate");
  await f.registry.checkpoint();
  await f.registry.close();
  const reopened = await openWorkspaceRegistry({
    ...f.options,
    runtimeEpoch: "next",
  });
  t.after(() => reopened.close());
  assert.equal(reopened.status().state, "ready");
  assert.equal(
    reopened.lookup(key).receipt.result.backupId,
    confirmed.result.backupId,
  );
  assert.equal((await reopened.begin(save)).status, "duplicate");
  assert.deepEqual(reopened.readView().retainedOperations, []);
  const records = (
    await fs.readFile(join(f.directory, "journal.jsonl"), "utf8")
  )
    .trim()
    .split("\n")
    .map(JSON.parse)
    .map((r) => r.payload);
  assert.equal(records.filter((r) => r.kind === "feature_gate").length, 1);
  assert.ok(
    records.findIndex((r) => r.kind === "feature_gate") <
      records.findIndex((r) => r.identity?.type === "configuration.save"),
  );
});

const instructionKey = "omoc.project-instructions";
const directRegistration = (digest = "b".repeat(64)) => ({
  state: "registered",
  key: instructionKey,
  digest,
  sourceVersion: "c".repeat(64),
  origin: "direct",
});
function storedSession(registry, appSessionId) {
  const {
    revision: _revision,
    status: _status,
    ...session
  } = registry
    .readView()
    .sessions.find((entry) => entry.appSessionId === appSessionId);
  return session;
}
async function instructionRequest(
  f,
  appSessionId,
  operationId,
  registration = directRegistration(),
) {
  const session = storedSession(f.registry, appSessionId);
  const type =
    registration.state === "registered"
      ? "configuration.instructions.apply"
      : "configuration.instructions.remove";
  const scope = { workspaceId: session.workspaceId, sessionId: appSessionId };
  const request = { runtimeEpoch: "old", operationId };
  const expectedRevision = f.registry.status().revision;
  const begun = await f.registry.begin(
    identity(operationId, { type, ...scope, expectedRevision }),
  );
  assert.equal(begun.status, "admitted");
  const dispatch = {
    ...request,
    step:
      registration.state === "registered"
        ? "native.instructions.put"
        : "native.instructions.remove",
    nativeSessionId: session.nativeSessionId,
  };
  const result =
    registration.state === "registered"
      ? {
          kind: "instruction_registered",
          ...scope,
          digest: registration.digest,
          sourceVersion: registration.sourceVersion,
        }
      : { kind: "instruction_removed", ...scope };
  return {
    request,
    dispatch,
    completion: {
      ...request,
      receipt: receipt(operationId, { type, ...scope, result }),
      delta: {
        workspaces: [],
        sessions: [{ ...session, instructionRegistration: registration }],
        tombstones: [],
      },
    },
  };
}
async function registerInstructions(
  f,
  appSessionId,
  operationId,
  registration,
) {
  const op = await instructionRequest(
    f,
    appSessionId,
    operationId,
    registration,
  );
  await f.registry.dispatch(op.dispatch);
  await f.registry.complete(op.completion);
  return op;
}
async function forkInstructions(f, parentId, operationId) {
  const parent = storedSession(f.registry, parentId);
  const scope = { workspaceId: parent.workspaceId, sessionId: parentId };
  const request = { runtimeEpoch: "old", operationId };
  await f.registry.begin(
    identity(operationId, { type: "session.fork", ...scope }),
  );
  const reserved = await f.registry.reserve({
    ...request,
    workspaceId: parent.workspaceId,
    plannedNativeSessionId: `native-${operationId}`,
  });
  await f.registry.dispatch({
    ...request,
    step: "native.fork",
    nativeSessionId: `native-${operationId}`,
  });
  const registration = parent.instructionRegistration;
  const child = {
    appSessionId: reserved.appSessionId,
    workspaceId: parent.workspaceId,
    parentSessionId: parentId,
    nativeSessionId: `native-${operationId}`,
    lifecycleState: "active",
    pinned: false,
    archived: false,
    ...(registration && {
      instructionRegistration:
        registration.state === "registered"
          ? {
              ...registration,
              origin: "fork",
              inheritedFromSessionId: parentId,
            }
          : registration,
    }),
  };
  const completion = {
    ...request,
    receipt: receipt(operationId, {
      type: "session.fork",
      ...scope,
      result: {
        kind: "forked",
        workspaceId: parent.workspaceId,
        sessionId: child.appSessionId,
        nativeSessionId: child.nativeSessionId,
      },
    }),
    delta: { workspaces: [], sessions: [child], tombstones: [] },
    verifiedNativeSessionIds: [child.nativeSessionId],
  };
  return { child, completion };
}

test("instructions commit direct/fork/identical direct/remove across checkpoint, keeping pre-marker revision and original identity", async (t) => {
  const f = await fixture(t);
  const parent = await createManaged(f);
  const before = f.registry.status().revision;
  const apply = await registerInstructions(
    f,
    parent.appSessionId,
    "instructions-parent",
  );
  assert.equal(f.registry.status().revision, before + 4); // marker, admission, intent, completion
  assert.equal(
    f.registry.lookup(apply.request).receipt.result.kind,
    "instruction_registered",
  );
  const fork = await forkInstructions(
    f,
    parent.appSessionId,
    "instructions-fork",
  );
  await f.registry.complete(fork.completion);
  const inherited = storedSession(
    f.registry,
    fork.child.appSessionId,
  ).instructionRegistration;
  assert.deepEqual(inherited, {
    ...directRegistration(),
    origin: "fork",
    inheritedFromSessionId: parent.appSessionId,
  });
  const grandchild = await forkInstructions(
    f,
    fork.child.appSessionId,
    "instructions-grandchild",
  );
  await f.registry.complete(grandchild.completion);
  assert.equal(
    storedSession(f.registry, grandchild.child.appSessionId)
      .instructionRegistration.inheritedFromSessionId,
    fork.child.appSessionId,
  );
  await registerInstructions(
    f,
    parent.appSessionId,
    "instructions-parent-change",
    directRegistration("d".repeat(64)),
  );
  assert.deepEqual(
    storedSession(f.registry, fork.child.appSessionId).instructionRegistration,
    inherited,
  );
  await f.registry.checkpoint();
  f.registry = await reopened(t, f);
  assert.deepEqual(
    storedSession(f.registry, fork.child.appSessionId).instructionRegistration,
    inherited,
  );
  const childApply = await registerInstructions(
    f,
    fork.child.appSessionId,
    "instructions-identical",
  );
  assert.deepEqual(
    storedSession(f.registry, fork.child.appSessionId).instructionRegistration,
    directRegistration(),
  );
  assert.equal(
    (await f.registry.complete(childApply.completion)).status,
    "duplicate",
  );
  const revision = f.registry.status().revision;
  assert.equal(
    (
      await f.registry.begin(
        identity("instructions-identical", {
          type: "configuration.instructions.apply",
          workspaceId: fork.child.workspaceId,
          sessionId: fork.child.appSessionId,
        }),
      )
    ).status,
    "duplicate",
  );
  assert.equal(f.registry.status().revision, revision);
  const absent = { state: "absent", key: instructionKey };
  const removal = await registerInstructions(
    f,
    fork.child.appSessionId,
    "instructions-remove",
    absent,
  );
  const absentFork = await forkInstructions(
    f,
    fork.child.appSessionId,
    "instructions-absent-fork",
  );
  await f.registry.complete(absentFork.completion);
  assert.deepEqual(
    storedSession(f.registry, absentFork.child.appSessionId)
      .instructionRegistration,
    absent,
  );
  await f.registry.checkpoint();
  const registry = await reopened(t, f);
  assert.deepEqual(
    storedSession(registry, fork.child.appSessionId).instructionRegistration,
    absent,
  );
  assert.deepEqual(
    registry.lookup(removal.request).receipt.result,
    removal.completion.receipt.result,
  );
  assert.deepEqual(
    registry.lookupIdentity(apply.request),
    identity("instructions-parent", {
      type: "configuration.instructions.apply",
      workspaceId: parent.workspace.workspaceId,
      sessionId: parent.appSessionId,
    }),
  );
});

test("instructions reject mismatched intent/session/result/metadata associations without append", async (t) => {
  const f = await fixture(t);
  const parent = await createManaged(f);
  const op = await instructionRequest(
    f,
    parent.appSessionId,
    "instructions-invalid",
  );
  for (const dispatch of [
    { ...op.dispatch, step: "native.instructions.remove" },
    { ...op.dispatch, step: "native.metadata" },
    { ...op.dispatch, nativeSessionId: "other-native" },
  ]) {
    const bytes = await fs.readFile(join(f.directory, "journal.jsonl"));
    await assert.rejects(f.registry.dispatch(dispatch), {
      code: "identity_conflict",
    });
    assert.deepEqual(
      await fs.readFile(join(f.directory, "journal.jsonl")),
      bytes,
    );
  }
  await assertCompletionRejectedWithoutMutation(f, op.completion);
  await f.registry.dispatch(op.dispatch);
  for (const registration of [
    { ...directRegistration(), digest: "d".repeat(64) },
    { ...directRegistration(), sourceVersion: "e".repeat(64) },
    {
      ...directRegistration(),
      origin: "fork",
      inheritedFromSessionId: parent.appSessionId,
    },
    undefined,
  ]) {
    const session = { ...op.completion.delta.sessions[0] };
    if (registration) session.instructionRegistration = registration;
    else delete session.instructionRegistration;
    await assertCompletionRejectedWithoutMutation(f, {
      ...op.completion,
      delta: { ...op.completion.delta, sessions: [session] },
    });
  }
  await assertCompletionRejectedWithoutMutation(f, {
    ...op.completion,
    delta: {
      ...op.completion.delta,
      sessions: [{ ...op.completion.delta.sessions[0], pinned: true }],
    },
  });
  await f.registry.complete(op.completion);
  const session = storedSession(f.registry, parent.appSessionId);
  await f.registry.begin(
    identity("instructions-forge", {
      type: "session.pin",
      workspaceId: session.workspaceId,
      sessionId: session.appSessionId,
    }),
  );
  await f.registry.dispatch({
    runtimeEpoch: "old",
    operationId: "instructions-forge",
    step: "native.pin",
  });
  for (const registration of [
    undefined,
    { state: "absent", key: instructionKey },
    directRegistration("e".repeat(64)),
  ]) {
    const next = { ...session, pinned: true };
    if (registration) next.instructionRegistration = registration;
    else delete next.instructionRegistration;
    await assertCompletionRejectedWithoutMutation(f, {
      runtimeEpoch: "old",
      operationId: "instructions-forge",
      receipt: receipt("instructions-forge", {
        type: "session.pin",
        workspaceId: session.workspaceId,
        sessionId: session.appSessionId,
      }),
      delta: { workspaces: [], sessions: [next], tombstones: [] },
    });
  }
});

test("instructions deny and unknown preserve committed fork origin and lookup hold across reopen", async (t) => {
  const f = await fixture(t);
  const parent = await createManaged(f);
  await registerInstructions(f, parent.appSessionId, "instructions-seed");
  const fork = await forkInstructions(
    f,
    parent.appSessionId,
    "instructions-unknown-fork",
  );
  await f.registry.complete(fork.completion);
  const before = storedSession(
    f.registry,
    fork.child.appSessionId,
  ).instructionRegistration;
  const denied = await instructionRequest(
    f,
    fork.child.appSessionId,
    "instructions-denied",
  );
  await f.registry.complete({
    ...denied.completion,
    receipt: receipt("instructions-denied", {
      type: "configuration.instructions.apply",
      workspaceId: fork.child.workspaceId,
      sessionId: fork.child.appSessionId,
      admission: "rejected",
      delivery: "pending",
      effect: "none",
      result: { kind: "rejected", code: "UNAVAILABLE" },
    }),
    delta: { workspaces: [], sessions: [], tombstones: [] },
  });
  assert.deepEqual(
    storedSession(f.registry, fork.child.appSessionId).instructionRegistration,
    before,
  );
  const op = await instructionRequest(
    f,
    fork.child.appSessionId,
    "instructions-unknown",
  );
  await f.registry.dispatch(op.dispatch);
  const { result: _result, ...unknownReceipt } = op.completion.receipt;
  const unknown = {
    ...op.completion,
    receipt: { ...unknownReceipt, effect: "unknown", delivery: "unknown" },
    delta: { workspaces: [], sessions: [], tombstones: [] },
  };
  await assertCompletionRejectedWithoutMutation(f, {
    ...unknown,
    delta: op.completion.delta,
  });
  await f.registry.complete(unknown);
  await f.registry.checkpoint();
  const registry = await reopened(t, f);
  assert.deepEqual(
    storedSession(registry, fork.child.appSessionId).instructionRegistration,
    before,
  );
  assert.equal(registry.lookup(op.request).receipt.effect, "unknown");
  assert.equal(registry.readView().retainedOperations.length, 1);
});

test("instructions fork requires exact committed parent metadata; unowned fork and newempty have none", async (t) => {
  const f = await fixture(t);
  const parent = await createManaged(f);
  const plain = await forkInstructions(
    f,
    parent.appSessionId,
    "instructions-plain-fork",
  );
  await assertCompletionRejectedWithoutMutation(
    f,
    {
      ...plain.completion,
      delta: {
        ...plain.completion.delta,
        sessions: [
          { ...plain.child, instructionRegistration: directRegistration() },
        ],
      },
    },
    "unsupported_version",
  );
  await f.registry.complete(plain.completion);
  assert.equal(
    storedSession(f.registry, plain.child.appSessionId).instructionRegistration,
    undefined,
  );
  await registerInstructions(
    f,
    parent.appSessionId,
    "instructions-parent-owned",
  );
  const fork = await forkInstructions(
    f,
    parent.appSessionId,
    "instructions-verified-fork",
  );
  for (const registration of [
    undefined,
    directRegistration(),
    {
      ...fork.child.instructionRegistration,
      inheritedFromSessionId: plain.child.appSessionId,
    },
    { ...fork.child.instructionRegistration, digest: "d".repeat(64) },
  ]) {
    const child = { ...fork.child };
    if (registration) child.instructionRegistration = registration;
    else delete child.instructionRegistration;
    await assertCompletionRejectedWithoutMutation(f, {
      ...fork.completion,
      delta: { ...fork.completion.delta, sessions: [child] },
    });
  }
  await f.registry.complete(fork.completion);
  const scope = { workspaceId: parent.workspace.workspaceId };
  const request = { runtimeEpoch: "old", operationId: "instructions-empty" };
  await f.registry.begin(
    identity(request.operationId, { type: "session.create", ...scope }),
  );
  const reserved = await f.registry.reserve({
    ...request,
    ...scope,
    plannedNativeSessionId: "native-empty",
  });
  await f.registry.dispatch({
    ...request,
    step: "native.create",
    nativeSessionId: "native-empty",
  });
  const empty = {
    appSessionId: reserved.appSessionId,
    ...scope,
    nativeSessionId: "native-empty",
    lifecycleState: "active",
    pinned: false,
    archived: false,
  };
  const completion = {
    ...request,
    receipt: receipt(request.operationId, { type: "session.create", ...scope }),
    delta: { workspaces: [], sessions: [empty], tombstones: [] },
    verifiedNativeSessionIds: ["native-empty"],
  };
  await assertCompletionRejectedWithoutMutation(f, {
    ...completion,
    delta: {
      ...completion.delta,
      sessions: [{ ...empty, instructionRegistration: directRegistration() }],
    },
  });
  await f.registry.complete(completion);
  assert.equal(
    storedSession(f.registry, empty.appSessionId).instructionRegistration,
    undefined,
  );
});

for (const fail of [false, true]) {
  test(`instructions completion flush ${fail ? "failure" : "pause"} preserves committed origin until durable publication`, async (t) => {
    const paused = deferred();
    let enabled = false;
    let entered = false;
    const f = await fixture(t, {
      syncFile: async (file, context) => {
        if (enabled && context === "append:completion") {
          entered = true;
          await paused.promise;
          if (fail) throw new Error("synthetic instruction completion failure");
        }
        await file.sync();
      },
    });
    const parent = await createManaged(f);
    await registerInstructions(
      f,
      parent.appSessionId,
      "instructions-flush-parent",
    );
    const fork = await forkInstructions(
      f,
      parent.appSessionId,
      "instructions-flush-fork",
    );
    await f.registry.complete(fork.completion);
    await f.registry.checkpoint();
    const before = storedSession(
      f.registry,
      fork.child.appSessionId,
    ).instructionRegistration;
    const op = await instructionRequest(
      f,
      fork.child.appSessionId,
      "instructions-flush-child",
    );
    await f.registry.dispatch(op.dispatch);
    enabled = true;
    const pending = f.registry.complete(op.completion);
    // Attach the failure handler before releasing the injected flush.
    const finished = fail
      ? assert.rejects(pending, { code: "writer_poisoned" })
      : pending;
    await until(() => entered, paused.resolve);
    assert.deepEqual(
      storedSession(f.registry, fork.child.appSessionId)
        .instructionRegistration,
      before,
    );
    assert.equal(f.registry.lookup(op.request).receipt.effect, "unknown");
    paused.resolve();
    await finished;
    if (fail) {
      f.registry = await reopened(t, f);
      assert.equal(f.registry.status().reason, "unconfirmed_tail");
      assert.deepEqual(
        storedSession(f.registry, fork.child.appSessionId)
          .instructionRegistration,
        before,
      );
      assert.equal(f.registry.lookup(op.request).receipt.effect, "unknown");
      assert.equal(f.registry.lookup(op.request).receipt.result, undefined);
    } else {
      assert.deepEqual(
        storedSession(f.registry, fork.child.appSessionId)
          .instructionRegistration,
        directRegistration(),
      );
      await f.registry.checkpoint();
      f.registry = await reopened(t, f);
      assert.deepEqual(
        storedSession(f.registry, fork.child.appSessionId)
          .instructionRegistration,
        directRegistration(),
      );
    }
  });
}

async function rewriteInstructionHistory(f, mutate) {
  const filename = join(f.directory, "journal.jsonl");
  const records = (await fs.readFile(filename, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const payloads = mutate(records.map((record) => record.payload));
  let previousHash = "0".repeat(64);
  const rewritten =
    payloads
      .map((payload, index) => {
        payload.revision = index + 1;
        if (payload.receipt) payload.receipt.revision = index + 1;
        const body = {
          schemaVersion: 1,
          storeId: "store",
          sequence: index + 1,
          previousHash,
          payload,
        };
        previousHash = createHash("sha256")
          .update(JSON.stringify(body))
          .digest("hex");
        return JSON.stringify({ ...body, checksum: previousHash });
      })
      .join("\n") + "\n";
  await fs.writeFile(filename, rewritten);
  const checkpoint = {
    schemaVersion: 1,
    storeId: "store",
    generation: 1,
    sequence: payloads.length,
    hash: previousHash,
  };
  await fs.writeFile(
    join(f.directory, "checkpoint.json"),
    JSON.stringify({
      ...checkpoint,
      checksum: createHash("sha256")
        .update(JSON.stringify(checkpoint))
        .digest("hex"),
    }),
  );
}
for (const [name, expected, mutate] of [
  [
    "missing marker",
    "unsupported_version",
    (payloads) =>
      payloads.filter((p) => p.feature !== "configuration_instructions_v1"),
  ],
  [
    "wrong native target",
    "identity_conflict",
    (payloads) =>
      payloads.map((p) =>
        p.step === "native.instructions.put"
          ? { ...p, nativeSessionId: "other-native" }
          : p,
      ),
  ],
  [
    "wrong operation type",
    "identity_conflict",
    (payloads) =>
      payloads.map((p) =>
        p.identity?.type === "configuration.instructions.apply"
          ? { ...p, identity: { ...p.identity, type: "session.pin" } }
          : p,
      ),
  ],
  [
    "receipt digest mismatch",
    "identity_conflict",
    (payloads) =>
      payloads.map((p) =>
        p.receipt?.result?.kind === "instruction_registered"
          ? {
              ...p,
              receipt: {
                ...p.receipt,
                result: { ...p.receipt.result, digest: "e".repeat(64) },
              },
            }
          : p,
      ),
  ],
  [
    "forged fork origin",
    "identity_conflict",
    (payloads) =>
      payloads.map((p) =>
        p.receipt?.result?.kind === "forked"
          ? {
              ...p,
              delta: {
                ...p.delta,
                sessions: p.delta.sessions.map((s) => ({
                  ...s,
                  instructionRegistration: directRegistration(),
                })),
              },
            }
          : p,
      ),
  ],
]) {
  test(`instructions checksum-valid checkpoint refuses ${name} without changing bytes`, async (t) => {
    const f = await fixture(t);
    const parent = await createManaged(f);
    await registerInstructions(
      f,
      parent.appSessionId,
      "instructions-replay-parent",
    );
    const fork = await forkInstructions(
      f,
      parent.appSessionId,
      "instructions-replay-fork",
    );
    await f.registry.complete(fork.completion);
    await f.registry.checkpoint();
    await f.registry.close();
    await rewriteInstructionHistory(f, mutate);
    const files = ["journal.jsonl", "checkpoint.json"];
    const bytes = await Promise.all(
      files.map((name) => fs.readFile(join(f.directory, name))),
    );
    const registry = await reopened(t, f);
    assert.equal(registry.status().reason, expected);
    await assert.rejects(registry.checkpoint(), { code: expected });
    assert.deepEqual(
      await Promise.all(
        files.map((name) => fs.readFile(join(f.directory, name))),
      ),
      bytes,
    );
  });
}

test("instructions confirmed identical direct and already absent accept empty delta; first fork-to-direct and changed digest require it", async (t) => {
  const f = await fixture(t);
  const parent = await createManaged(f);
  await registerInstructions(
    f,
    parent.appSessionId,
    "instructions-empty-delta-seed",
  );
  const same = await instructionRequest(
    f,
    parent.appSessionId,
    "instructions-empty-delta-same",
  );
  await f.registry.dispatch(same.dispatch);
  const unchanged = {
    ...same.completion,
    delta: { workspaces: [], sessions: [], tombstones: [] },
  };
  await f.registry.complete(unchanged);
  assert.equal((await f.registry.complete(unchanged)).status, "duplicate");
  const changed = await instructionRequest(
    f,
    parent.appSessionId,
    "instructions-empty-delta-changed",
    directRegistration("d".repeat(64)),
  );
  await f.registry.dispatch(changed.dispatch);
  await assertCompletionRejectedWithoutMutation(f, {
    ...changed.completion,
    delta: unchanged.delta,
  });
  await f.registry.complete(changed.completion);
  const fork = await forkInstructions(
    f,
    parent.appSessionId,
    "instructions-empty-delta-fork",
  );
  await f.registry.complete(fork.completion);
  const child = await instructionRequest(
    f,
    fork.child.appSessionId,
    "instructions-empty-delta-child",
    directRegistration("d".repeat(64)),
  );
  await f.registry.dispatch(child.dispatch);
  await assertCompletionRejectedWithoutMutation(f, {
    ...child.completion,
    delta: unchanged.delta,
  });
  await f.registry.complete(child.completion);
  const absent = { state: "absent", key: instructionKey };
  await registerInstructions(
    f,
    parent.appSessionId,
    "instructions-empty-delta-remove",
    absent,
  );
  const removed = await instructionRequest(
    f,
    parent.appSessionId,
    "instructions-empty-delta-removed",
    absent,
  );
  await f.registry.dispatch(removed.dispatch);
  await f.registry.complete({ ...removed.completion, delta: unchanged.delta });
  await f.registry.checkpoint();
  const registry = await reopened(t, f);
  assert.equal(registry.status().state, "ready");
  assert.deepEqual(
    storedSession(registry, parent.appSessionId).instructionRegistration,
    absent,
  );
  assert.deepEqual(
    storedSession(registry, fork.child.appSessionId).instructionRegistration,
    directRegistration("d".repeat(64)),
  );
  assert.equal(
    registry.lookup(same.request).receipt.result.kind,
    "instruction_registered",
  );
  assert.equal(
    registry.lookup(removed.request).receipt.result.kind,
    "instruction_removed",
  );
});

test("MCP actual API checkpoint: private admission target, unchanged lookup identity and exact workspace dispatch", async (t) => {
  const f = await fixture(t);
  const seed = await createManaged(f, "mcp-api-seed");
  const workspaceId = seed.workspace.workspaceId;
  const admittedIdentity = identity("mcp-api", {
    type: "configuration.mcp.register",
    workspaceId,
  });
  const nativeServerName = mcpNativeName(workspaceId, "local");
  const begin = { ...admittedIdentity, nativeServerName };
  const request = {
    runtimeEpoch: begin.runtimeEpoch,
    operationId: begin.operationId,
  };
  const admitted = await f.registry.begin(begin);
  assert.equal(admitted.status, "admitted");
  assert.equal(Object.hasOwn(admitted.receipt, "nativeServerName"), false);
  assert.deepEqual(f.registry.lookupIdentity(request), admittedIdentity);
  assert.equal((await f.registry.begin(begin)).status, "duplicate");
  await assert.rejects(
    f.registry.begin({
      ...begin,
      nativeServerName: mcpNativeName(workspaceId, "other"),
    }),
    { code: "DUPLICATE_CONFLICT" },
  );
  const dispatch = { ...request, step: mcpStep(begin.type), nativeServerName };
  for (const invalid of [
    { ...dispatch, nativeServerName: mcpNativeName(workspaceId, "other") },
    { ...dispatch, nativeSessionId: "native-session" },
    { ...dispatch, step: "native.mcp.connect" },
    { ...dispatch, step: "native.send", nativeServerName: undefined },
  ])
    await assert.rejects(async () => f.registry.dispatch(invalid));
  const dispatched = await f.registry.dispatch(dispatch);
  assert.equal(dispatched.status, "dispatched");
  assert.equal(Object.hasOwn(dispatched.receipt, "nativeServerName"), false);
  assert.equal((await f.registry.dispatch(dispatch)).status, "duplicate");
  await assert.rejects(
    f.registry.dispatch({
      ...dispatch,
      nativeServerName: mcpNativeName(workspaceId, "other"),
    }),
    { code: "DUPLICATE_CONFLICT" },
  );
  const confirmed = {
    ...dispatched.receipt,
    delivery: "accepted",
    effect: "confirmed",
    result: {
      kind: "mcp_registered",
      workspaceId,
      sourceName: "local",
      nativeName: nativeServerName,
      digest: "b".repeat(64),
      sourceVersion: "c".repeat(64),
      status: "disabled",
    },
  };
  assert.deepEqual(validateStorageReceipt(confirmed), confirmed);
  const records = (
    await fs.readFile(join(f.directory, "journal.jsonl"), "utf8")
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line).payload)
    .filter(
      (p) =>
        p.feature === "configuration_mcp_v1" ||
        p.identity?.operationId === "mcp-api" ||
        p.operationId === "mcp-api",
    );
  assert.deepEqual(
    records.map((p) => p.kind),
    ["feature_gate", "admission", "dispatch"],
  );
  assert.equal(records[0].feature, "configuration_mcp_v1");
  assert.deepEqual(records[1].identity, admittedIdentity);
  assert.equal(records[1].nativeServerName, nativeServerName);
  assert.equal(records[2].nativeServerName, nativeServerName);
});

function mcpRequest(
  seed,
  operationId,
  action = "register",
  status = "disabled",
  noEffect = false,
) {
  const workspaceId = seed.workspace.workspaceId;
  const admittedIdentity = identity(operationId, {
    type: `configuration.mcp.${action}`,
    workspaceId,
  });
  const nativeServerName = mcpNativeName(workspaceId, "local");
  const request = { runtimeEpoch: admittedIdentity.runtimeEpoch, operationId };
  const result = {
    kind:
      action === "register"
        ? "mcp_registered"
        : action === "remove"
          ? "mcp_removed"
          : "mcp_connection",
    workspaceId,
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
  return {
    request,
    admittedIdentity,
    begin: { ...admittedIdentity, nativeServerName },
    dispatch: {
      ...request,
      step: mcpStep(admittedIdentity.type),
      nativeServerName,
    },
    completion: {
      ...request,
      receipt: receipt(operationId, {
        type: admittedIdentity.type,
        workspaceId,
        admission: noEffect ? "admitted" : "dispatched",
        effect: noEffect ? "none" : "confirmed",
        result,
      }),
      delta: { workspaces: [], sessions: [], tombstones: [] },
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
  test(`MCP registry durable ${action}/${status ?? "absent"}/${noEffect ? "no-effect" : "dispatched"} keeps exact history and releases hold`, async (t) => {
    const f = await fixture(t);
    const seed = await createManaged(f, "mcp-seed");
    const op = mcpRequest(seed, "mcp-complete", action, status, noEffect);
    const before = f.registry.readView();
    const admitted = await f.registry.begin({
      ...op.begin,
      expectedRevision: before.revision,
    });
    assert.equal(admitted.status, "admitted");
    if (!noEffect) await f.registry.dispatch(op.dispatch);
    assert.equal(f.registry.lookup(op.request).receipt.result, undefined);
    const result = await f.registry.complete(op.completion);
    assert.deepEqual(result.receipt.result, op.completion.receipt.result);
    const after = f.registry.readView();
    assert.deepEqual(after.workspaces, before.workspaces);
    assert.deepEqual(after.sessions, before.sessions);
    assert.deepEqual(after.retainedOperations, []);
    const bytes = await fs.readFile(join(f.directory, "journal.jsonl"));
    assert.equal((await f.registry.begin(op.begin)).status, "duplicate");
    assert.equal(
      (await f.registry.complete(op.completion)).status,
      "duplicate",
    );
    assert.deepEqual(
      await fs.readFile(join(f.directory, "journal.jsonl")),
      bytes,
    );
    await assert.rejects(
      f.registry.begin({ ...op.begin, digest: "d".repeat(64) }),
      { code: "DUPLICATE_CONFLICT" },
    );
    const mismatch = {
      ...op.completion,
      receipt: {
        ...op.completion.receipt,
        result: {
          ...op.completion.receipt.result,
          sourceName: "other",
          nativeName: mcpNativeName(seed.workspace.workspaceId, "other"),
        },
      },
    };
    await assertCompletionRejectedWithoutMutation(
      f,
      mismatch,
      "DUPLICATE_CONFLICT",
    );
    await f.registry.checkpoint();
    f.registry = await reopened(t, f);
    assert.equal(f.registry.status().state, "ready");
    assert.deepEqual(
      f.registry.lookupIdentity(op.request),
      op.admittedIdentity,
    );
    assert.deepEqual(
      f.registry.lookup(op.request).receipt.result,
      op.completion.receipt.result,
    );
    assert.equal((await f.registry.begin(op.begin)).status, "duplicate");
    assert.equal(f.registry.readView().retainedOperations.length, 0);
    const durable = (
      await fs.readFile(join(f.directory, "journal.jsonl"), "utf8")
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line).payload);
    assert.equal(
      durable.filter((p) => p.feature === "configuration_mcp_v1").length,
      1,
    );
    for (const p of durable) {
      if (p.identity?.operationId === op.request.operationId) {
        assert.equal(p.nativeServerName, op.begin.nativeServerName);
        assert.deepEqual(p.identity, op.admittedIdentity);
      }
    }
    assert.equal(JSON.stringify(after.workspaces).includes("mcp"), false);
  });
}

test("MCP begin rejects missing/foreign/extra targets and session scope without writing", async (t) => {
  const f = await fixture(t);
  const seed = await createManaged(f, "mcp-input-seed");
  const op = mcpRequest(seed, "mcp-input");
  const { nativeServerName: _name, ...missing } = op.begin;
  const bytes = await fs.readFile(join(f.directory, "journal.jsonl"));
  for (const invalid of [
    missing,
    { ...op.begin, nativeServerName: undefined },
    { ...op.begin, nativeServerName: "foreign" },
    { ...op.begin, sessionId: seed.appSessionId },
    { ...op.begin, type: "session.pin", sessionId: seed.appSessionId },
    { ...op.begin, command: ["PRIVATE"] },
  ])
    await assert.rejects(async () => f.registry.begin(invalid), {
      code: "invalid_record",
    });
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    bytes,
  );
  await f.registry.begin(op.begin);
  await assert.rejects(
    f.registry.reserve({
      ...op.request,
      workspaceId: seed.workspace.workspaceId,
    }),
    { code: "identity_conflict" },
  );
  for (const step of [
    "native.send",
    "native.policy",
    "registry.metadata",
    "filesystem.configuration.stage",
  ]) {
    const { nativeServerName: _target, ...dispatch } = op.dispatch;
    await assert.rejects(f.registry.dispatch({ ...dispatch, step }), {
      code: "identity_conflict",
    });
  }
  await assert.rejects(
    async () => f.registry.dispatch({ ...op.dispatch, step: null }),
    { code: "invalid_record" },
  );
});

test("MCP unknown holds every session in its workspace, survives checkpoint, and leaves another workspace available", async (t) => {
  const f = await fixture(t);
  const seed = await createManaged(f, "mcp-hold-seed");
  const independent = await createManaged(f, "mcp-independent");
  const secondId = "mcp-second-session";
  await f.registry.begin(
    identity("mcp-second", {
      type: "session.create",
      workspaceId: seed.workspace.workspaceId,
    }),
  );
  const reserved = await f.registry.reserve({
    runtimeEpoch: "old",
    operationId: "mcp-second",
    workspaceId: seed.workspace.workspaceId,
    plannedNativeSessionId: secondId,
  });
  await f.registry.dispatch({
    runtimeEpoch: "old",
    operationId: "mcp-second",
    step: "native.create",
    nativeSessionId: secondId,
  });
  await f.registry.complete({
    runtimeEpoch: "old",
    operationId: "mcp-second",
    receipt: receipt("mcp-second", {
      type: "session.create",
      workspaceId: seed.workspace.workspaceId,
    }),
    delta: {
      workspaces: [],
      sessions: [
        {
          appSessionId: reserved.appSessionId,
          workspaceId: seed.workspace.workspaceId,
          nativeSessionId: secondId,
          lifecycleState: "active",
          pinned: false,
          archived: false,
        },
      ],
      tombstones: [],
    },
    verifiedNativeSessionIds: [secondId],
  });
  const op = mcpRequest(seed, "mcp-unknown", "connect", "connected");
  await f.registry.begin(op.begin);
  await f.registry.dispatch(op.dispatch);
  const { result: _result, ...noResult } = op.completion.receipt;
  const unknown = {
    ...op.completion,
    receipt: { ...noResult, effect: "unknown", delivery: "unknown" },
  };
  await f.registry.complete(unknown);
  const view = f.registry.readView();
  assert.deepEqual(
    view.sessions
      .filter((s) => s.workspaceId === seed.workspace.workspaceId)
      .map((s) => s.status),
    ["unavailable", "unavailable"],
  );
  assert.equal(
    view.sessions.find(
      (s) => s.workspaceId === independent.workspace.workspaceId,
    ).status,
    "idle",
  );
  assert.deepEqual(view.recovery.resources, [
    {
      workspaceId: seed.workspace.workspaceId,
      state: "unavailable",
      reason: "unresolved_operation",
    },
  ]);
  for (const [index, sessionId] of [
    seed.appSessionId,
    reserved.appSessionId,
  ].entries()) {
    const blocked = await f.registry.begin(
      identity(`mcp-blocked-${index}`, {
        type: "message.send",
        workspaceId: seed.workspace.workspaceId,
        sessionId,
      }),
    );
    assert.equal(blocked.status, "rejected");
    assert.equal(blocked.receipt.result.code, "UNAVAILABLE");
  }
  const allowed = await f.registry.begin(
    identity("mcp-independent-send", {
      type: "message.send",
      workspaceId: independent.workspace.workspaceId,
      sessionId: independent.appSessionId,
    }),
  );
  assert.equal(allowed.status, "admitted");
  await f.registry.checkpoint();
  f.registry = await reopened(t, f);
  assert.equal(f.registry.status().state, "ready");
  assert.deepEqual(f.registry.lookupIdentity(op.request), op.admittedIdentity);
  assert.equal(f.registry.lookup(op.request).receipt.effect, "unknown");
  assert.equal(f.registry.lookup(op.request).receipt.result, undefined);
  const before = await fs.readFile(join(f.directory, "journal.jsonl"));
  assert.equal((await f.registry.begin(op.begin)).status, "duplicate");
  assert.equal((await f.registry.dispatch(op.dispatch)).status, "duplicate");
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    before,
  );
});

for (const fail of [false, true]) {
  test(`MCP completion flush ${fail ? "failure" : "pause"} exposes no speculative result`, async (t) => {
    const paused = deferred();
    let enabled = false;
    let entered = false;
    const f = await fixture(t, {
      syncFile: async (file, context) => {
        if (enabled && context === "append:completion") {
          entered = true;
          await paused.promise;
          if (fail) throw new Error("synthetic MCP completion failure");
        }
        await file.sync();
      },
    });
    const seed = await createManaged(f, "mcp-flush-seed");
    const op = mcpRequest(seed, "mcp-flush");
    await f.registry.begin(op.begin);
    await f.registry.dispatch(op.dispatch);
    await f.registry.checkpoint();
    enabled = true;
    const pending = f.registry.complete(op.completion);
    const finished = fail
      ? assert.rejects(pending, { code: "writer_poisoned" })
      : pending;
    await until(() => entered, paused.resolve);
    assert.equal(f.registry.lookup(op.request).receipt.result, undefined);
    assert.equal(f.registry.lookup(op.request).receipt.effect, "unknown");
    paused.resolve();
    await finished;
    if (fail) {
      f.registry = await reopened(t, f);
      assert.equal(f.registry.status().reason, "unconfirmed_tail");
      assert.equal(f.registry.lookup(op.request).receipt.result, undefined);
      assert.equal(f.registry.lookup(op.request).receipt.effect, "unknown");
      assert.deepEqual(
        f.registry.lookupIdentity(op.request),
        op.admittedIdentity,
      );
      assert.equal(f.registry.readView().sessions[0].status, "unavailable");
      // Explicit reviewed-tail adoption revalidates the retained private target.
      const status = f.registry.status().journal;
      await f.registry.recover({
        action: "adopt_validated_tail",
        expectedSequence: status.sequence,
        expectedHash: status.hash,
        ownerVerified: true,
        preflightVerified: true,
      });
      assert.deepEqual(
        f.registry.lookup(op.request).receipt.result,
        op.completion.receipt.result,
      );
    } else
      assert.deepEqual(
        f.registry.lookup(op.request).receipt.result,
        op.completion.receipt.result,
      );
  });
}

test("MCP completion refuses another admitted target, deltas and dispatched no-effect remove without mutation", async (t) => {
  const f = await fixture(t);
  const seed = await createManaged(f, "mcp-validation-seed");
  const op = mcpRequest(seed, "mcp-validation", "remove");
  await f.registry.begin(op.begin);
  await f.registry.dispatch(op.dispatch);
  await assertCompletionRejectedWithoutMutation(f, {
    ...op.completion,
    receipt: {
      ...op.completion.receipt,
      result: {
        ...op.completion.receipt.result,
        sourceName: "other",
        nativeName: mcpNativeName(seed.workspace.workspaceId, "other"),
      },
    },
  });
  for (const delta of [
    {
      ...op.completion.delta,
      workspaces: [{ ...seed.workspace, registrationState: "registered" }],
    },
    { ...op.completion.delta, sessions: seed.delta.sessions },
    {
      ...op.completion.delta,
      tombstones: [{ kind: "session", id: seed.appSessionId }],
    },
  ])
    await assertCompletionRejectedWithoutMutation(f, {
      ...op.completion,
      delta,
    });
  await assertCompletionRejectedWithoutMutation(f, {
    ...op.completion,
    receipt: {
      ...op.completion.receipt,
      effect: "none",
      admission: "admitted",
    },
  });
  await assertCompletionRejectedWithoutMutation(
    f,
    {
      ...op.completion,
      receipt: { ...op.completion.receipt, result: undefined },
    },
    "invalid_record",
  );
  await f.registry.complete(op.completion);
});

for (const [label, expected, mutate] of [
  [
    "missing marker",
    "unsupported_version",
    (payloads) => payloads.filter((p) => p.feature !== "configuration_mcp_v1"),
  ],
  [
    "wrong private target",
    "identity_conflict",
    (payloads) =>
      payloads.map((p) =>
        p.identity?.type === "configuration.mcp.register"
          ? {
              ...p,
              nativeServerName: mcpNativeName(p.identity.workspaceId, "other"),
            }
          : p,
      ),
  ],
  [
    "wrong dispatch target",
    "identity_conflict",
    (payloads) =>
      payloads.map((p) =>
        p.step === "native.mcp.add"
          ? { ...p, nativeServerName: mcpNativeName("workspace", "other") }
          : p,
      ),
  ],
  [
    "wrong step",
    "identity_conflict",
    (payloads) =>
      payloads.map((p) =>
        p.step === "native.mcp.add" ? { ...p, step: "native.mcp.connect" } : p,
      ),
  ],
  [
    "different derived result target",
    "identity_conflict",
    (payloads) =>
      payloads.map((p) =>
        p.receipt?.result?.kind === "mcp_registered"
          ? {
              ...p,
              receipt: {
                ...p.receipt,
                result: {
                  ...p.receipt.result,
                  sourceName: "other",
                  nativeName: mcpNativeName(p.receipt.workspaceId, "other"),
                },
              },
            }
          : p,
      ),
  ],
  [
    "speculative result",
    "corrupt_journal",
    (payloads) =>
      payloads.map((p) =>
        p.receipt?.result?.kind === "mcp_registered"
          ? { ...p, receipt: { ...p.receipt, effect: "unknown" } }
          : p,
      ),
  ],
  [
    "private payload copy",
    "corrupt_journal",
    (payloads) =>
      payloads.map((p) =>
        p.receipt?.result?.kind === "mcp_registered"
          ? {
              ...p,
              receipt: {
                ...p.receipt,
                result: { ...p.receipt.result, command: ["PRIVATE"] },
              },
            }
          : p,
      ),
  ],
]) {
  test(`MCP checksum-valid checkpoint refuses ${label} and preserves all bytes`, async (t) => {
    const f = await fixture(t);
    const seed = await createManaged(f, "mcp-tamper-seed");
    const op = mcpRequest(seed, "mcp-tamper");
    await f.registry.begin(op.begin);
    await f.registry.dispatch(op.dispatch);
    await f.registry.complete(op.completion);
    await f.registry.checkpoint();
    await f.registry.close();
    await rewriteInstructionHistory(f, mutate);
    const files = (await fs.readdir(f.directory)).sort();
    const before = await Promise.all(
      files.map((name) => fs.readFile(join(f.directory, name))),
    );
    f.registry = await reopened(t, f);
    assert.equal(f.registry.status().reason, expected);
    await assert.rejects(f.registry.checkpoint(), { code: expected });
    assert.deepEqual((await fs.readdir(f.directory)).sort(), files);
    assert.deepEqual(
      await Promise.all(
        files.map((name) => fs.readFile(join(f.directory, name))),
      ),
      before,
    );
  });
}

test("MCP conservative tail keeps original lookup-only key and private target until explicit recovery", async (t) => {
  const f = await fixture(t);
  const seed = await createManaged(f, "mcp-tail-seed");
  await f.registry.checkpoint();
  const op = mcpRequest(seed, "mcp-tail");
  await f.registry.begin(op.begin);
  await f.registry.dispatch(op.dispatch);
  await f.registry.complete(op.completion);
  f.registry = await reopened(t, f);
  assert.equal(f.registry.status().reason, "unconfirmed_tail");
  assert.equal(f.registry.lookupIdentity(op.request), undefined);
  const found = f.registry.lookup(op.request);
  assert.equal(found.receipt.effect, "unknown");
  assert.equal(found.receipt.result, undefined);
  assert.equal(Object.hasOwn(found.receipt, "nativeServerName"), false);
  assert.deepEqual(f.registry.readView().retainedOperations, [
    {
      ...op.request,
      type: op.begin.type,
      workspaceId: seed.workspace.workspaceId,
    },
  ]);
  assert.equal(f.registry.readView().sessions[0].status, "unavailable");
  const status = f.registry.status().journal;
  await f.registry.recover({
    action: "adopt_validated_tail",
    expectedSequence: status.sequence,
    expectedHash: status.hash,
    ownerVerified: true,
    preflightVerified: true,
  });
  assert.deepEqual(f.registry.lookupIdentity(op.request), op.admittedIdentity);
  assert.deepEqual(
    f.registry.lookup(op.request).receipt.result,
    op.completion.receipt.result,
  );
  assert.equal((await f.registry.begin(op.begin)).status, "duplicate");
  await assert.rejects(
    f.registry.begin({
      ...op.begin,
      nativeServerName: mcpNativeName(seed.workspace.workspaceId, "other"),
    }),
    { code: "DUPLICATE_CONFLICT" },
  );
});

test("SKILL admission binds private name without public identity expansion", async (t) => {
  const f = await fixture(t);
  const { workspace } = await createManagedWorkspaceOnly(f);
  const admitted = identity("skill", {
    type: "configuration.skill.save",
    workspaceId: workspace.workspaceId,
  });
  const input = { ...admitted, skillSourceName: "review_code" };
  const begun = await f.registry.begin(input);
  assert.equal(begun.status, "admitted");
  assert.equal(begun.receipt.skillSourceName, undefined);
  assert.deepEqual(f.registry.lookupIdentity(admittedKey(input)), admitted);
  assert.deepEqual(f.registry.readView().retainedOperations, [
    {
      runtimeEpoch: "old",
      operationId: "skill",
      type: "configuration.skill.save",
      workspaceId: workspace.workspaceId,
    },
  ]);
  assert.equal((await f.registry.begin(input)).status, "duplicate");
  await assert.rejects(
    f.registry.begin({ ...input, skillSourceName: "other" }),
    { code: "DUPLICATE_CONFLICT" },
  );
  const lines = (await fs.readFile(join(f.directory, "journal.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  const marker = lines.findIndex(
    (line) => line.payload.feature === "configuration_skill_files_v1",
  );
  assert.ok(marker >= 0);
  assert.equal(lines[marker + 1].payload.skillSourceName, "review_code");
  assert.equal(lines[marker + 1].payload.identity.skillSourceName, undefined);
});
function admittedKey(value) {
  return { runtimeEpoch: value.runtimeEpoch, operationId: value.operationId };
}

import { skillBackupId } from "./workbench-skill-storage.mjs";
async function skillStorageFixture(t, io = {}) {
  const f = await fixture(t, io);
  const reserved = await createManagedWorkspaceOnly(f);
  const input = {
    ...identity("skill", {
      type: "configuration.skill.save",
      workspaceId: reserved.workspace.workspaceId,
    }),
    skillSourceName: "review",
  };
  const key = admittedKey(input);
  const expectedRevision = f.registry.status().revision;
  assert.equal(
    (await f.registry.begin({ ...input, expectedRevision })).status,
    "admitted",
  );
  assert.equal(f.registry.status().revision, expectedRevision + 2);
  const confirmed = receipt("skill", {
    type: input.type,
    workspaceId: input.workspaceId,
    result: {
      kind: "skill_file_saved",
      workspaceId: input.workspaceId,
      sourceName: "review",
      version: "b".repeat(64),
      backupId: skillBackupId(key.runtimeEpoch, key.operationId),
    },
  });
  return {
    ...f,
    input,
    key,
    confirmed,
    workspaceRecord: reserved.workspace,
    empty: { workspaces: [], sessions: [], tombstones: [] },
  };
}
test("SKILL defensive completion requires exact source, key backup, staged publication and zero delta; checkpoint reopens", async (t) => {
  const f = await skillStorageFixture(t);
  const before = await fs.readFile(join(f.directory, "journal.jsonl"));
  await assert.rejects(
    f.registry.reserve({ ...f.key, workspaceId: f.input.workspaceId }),
    { code: "identity_conflict" },
  );
  await assert.rejects(
    f.registry.dispatch({ ...f.key, step: "filesystem.configuration.publish" }),
    { code: "identity_conflict" },
  );
  await assert.rejects(
    f.registry.dispatch({ ...f.key, step: "native.create" }),
    { code: "identity_conflict" },
  );
  await assert.rejects(
    f.registry.complete({ ...f.key, receipt: f.confirmed, delta: f.empty }),
    { code: "identity_conflict" },
  );
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    before,
  );
  await f.registry.dispatch({
    ...f.key,
    step: "filesystem.configuration.stage",
  });
  await assert.rejects(
    f.registry.complete({ ...f.key, receipt: f.confirmed, delta: f.empty }),
    { code: "identity_conflict" },
  );
  await f.registry.dispatch({
    ...f.key,
    step: "filesystem.configuration.publish",
  });
  const staged = await fs.readFile(join(f.directory, "journal.jsonl"));
  for (const candidate of [
    { ...f.confirmed, result: { ...f.confirmed.result, sourceName: "other" } },
    {
      ...f.confirmed,
      result: {
        ...f.confirmed.result,
        backupId: skillBackupId("old", "other"),
      },
    },
    { ...f.confirmed, result: { ...f.confirmed.result, text: "PRIVATE" } },
    { ...f.confirmed, effect: "unknown", delivery: "unknown" },
    { ...f.confirmed, admission: "admitted" },
    { ...f.confirmed, sessionId: "session" },
  ])
    await assert.rejects(
      f.registry.complete({ ...f.key, receipt: candidate, delta: f.empty }),
    );
  await assert.rejects(
    f.registry.complete({
      ...f.key,
      receipt: f.confirmed,
      delta: {
        ...f.empty,
        tombstones: [{ kind: "workspace", id: f.input.workspaceId }],
      },
    }),
    { code: "identity_conflict" },
  );
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    staged,
  );
  await f.registry.complete({ ...f.key, receipt: f.confirmed, delta: f.empty });
  assert.deepEqual(f.registry.lookup(f.key).receipt.result, f.confirmed.result);
  assert.equal((await f.registry.begin(f.input)).status, "duplicate");
  assert.deepEqual(f.registry.readView().retainedOperations, []);
  await f.registry.checkpoint();
  const next = await reopened(t, f);
  assert.equal(next.status().state, "ready");
  assert.deepEqual(next.lookup(f.key).receipt.result, f.confirmed.result);
  assert.equal((await next.begin(f.input)).status, "duplicate");
  await assert.rejects(next.begin({ ...f.input, skillSourceName: "other" }), {
    code: "DUPLICATE_CONFLICT",
  });
});

test("SKILL staged unknown keeps original immutable key, private name and workspace hold after checkpoint", async (t) => {
  const f = await skillStorageFixture(t);
  await f.registry.dispatch({
    ...f.key,
    step: "filesystem.configuration.stage",
  });
  const unknown = { ...f.confirmed, delivery: "unknown", effect: "unknown" };
  delete unknown.result;
  await f.registry.complete({ ...f.key, receipt: unknown, delta: f.empty });
  await f.registry.checkpoint();
  const next = await reopened(t, f);
  const view = next.readView();
  assert.deepEqual(view.retainedOperations, [
    { ...f.key, type: f.input.type, workspaceId: f.input.workspaceId },
  ]);
  assert.equal(next.lookup(f.key).receipt.result, undefined);
  assert.equal(next.lookup(f.key).receipt.effect, "unknown");
  assert.equal(
    next.lookup({ ...f.key, runtimeEpoch: "new" }).status,
    "missing",
  );
  const before = await fs.readFile(join(f.directory, "journal.jsonl"));
  assert.equal((await next.begin(f.input)).status, "duplicate");
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    before,
  );
  await assert.rejects(next.begin({ ...f.input, skillSourceName: "other" }), {
    code: "DUPLICATE_CONFLICT",
  });
  assert.equal(
    (await next.begin({ ...f.input, operationId: "new-key" })).status,
    "rejected",
  );
  assert.ok(
    next
      .readView()
      .recovery.resources.some(
        (entry) =>
          entry.workspaceId === f.input.workspaceId &&
          entry.reason === "unresolved_operation",
      ),
  );
});

for (const corruption of [
  "name",
  "missing-feature",
  "backup",
  "order",
  "delta",
  "reservation",
]) {
  test(`SKILL checksum-valid ${corruption} history is rejected after checkpoint without changing bytes`, async (t) => {
    const f = await skillStorageFixture(t);
    await f.registry.dispatch({
      ...f.key,
      step: "filesystem.configuration.stage",
    });
    await f.registry.dispatch({
      ...f.key,
      step: "filesystem.configuration.publish",
    });
    await f.registry.complete({
      ...f.key,
      receipt: f.confirmed,
      delta: f.empty,
    });
    const forgedWorkspace = {
      ...f.workspaceRecord,
      registrationState: "reserved",
    };
    await f.registry.checkpoint();
    await f.registry.close();
    await rewriteInstructionHistory(f, (payloads) => {
      const admission = payloads.find(
        (p) => p.identity?.type === "configuration.skill.save",
      );
      const completion = payloads.find(
        (p) => p.kind === "completion" && p.operationId === "skill",
      );
      if (corruption === "name") admission.skillSourceName = "other";
      if (corruption === "missing-feature")
        return payloads.filter(
          (p) => p.feature !== "configuration_skill_files_v1",
        );
      if (corruption === "backup")
        completion.receipt.result.backupId = skillBackupId("old", "other");
      if (corruption === "delta")
        completion.delta.tombstones.push({
          kind: "workspace",
          id: f.input.workspaceId,
        });
      if (corruption === "order") {
        const stage = payloads.find(
          (p) =>
            p.operationId === "skill" &&
            p.step === "filesystem.configuration.stage",
        );
        stage.step = "filesystem.configuration.publish";
      }
      if (corruption === "reservation")
        payloads.splice(payloads.indexOf(admission) + 1, 0, {
          kind: "reservation",
          ...f.key,
          workspace: forgedWorkspace,
          appSessionId: "forbidden",
        });
      return payloads;
    });
    const before = await fs.readFile(join(f.directory, "journal.jsonl"));
    const next = await openWorkspaceRegistry({
      ...f.options,
      io: {},
      runtimeEpoch: "new",
    });
    t.after(() => next.close());
    assert.equal(next.status().state, "recovery_required");
    assert.equal(
      next.status().reason,
      corruption === "missing-feature"
        ? "unsupported_version"
        : corruption === "backup"
          ? "corrupt_journal"
          : "identity_conflict",
    );
    assert.notEqual(next.lookup(f.key).receipt?.effect, "confirmed");
    await next.close();
    assert.deepEqual(
      await fs.readFile(join(f.directory, "journal.jsonl")),
      before,
    );
  });
}

test("SKILL feature flush precedes visible admission and no original revision is lost", async (t) => {
  const held = deferred();
  let enabled = false,
    entered = false;
  const f = await fixture(t, {
    syncFile: async (file, context) => {
      if (enabled && context === "append:feature_gate") {
        entered = true;
        await held.promise;
      }
      await file.sync();
    },
  });
  const { workspace } = await createManagedWorkspaceOnly(f);
  const expectedRevision = f.registry.status().revision;
  enabled = true;
  const waiting = f.registry.begin({
    ...identity("skill", {
      type: "configuration.skill.save",
      workspaceId: workspace.workspaceId,
    }),
    skillSourceName: "review",
    expectedRevision,
  });
  await until(() => entered, held.resolve);
  assert.equal(f.registry.status().revision, expectedRevision);
  assert.equal(
    f.registry.lookup({ runtimeEpoch: "old", operationId: "skill" }).status,
    "missing",
  );
  assert.deepEqual(f.registry.readView().retainedOperations, []);
  held.resolve();
  assert.equal((await waiting).status, "admitted");
  assert.equal(f.registry.status().revision, expectedRevision + 2);
});

test("SKILL admission rejects missing/invalid private name, session and foreign fields before feature bytes", async (t) => {
  const f = await fixture(t);
  const before = await fs.readFile(join(f.directory, "journal.jsonl"));
  const good = identity("skill", {
    type: "configuration.skill.save",
    workspaceId: "ws",
  });
  for (const input of [
    good,
    { ...good, skillSourceName: "../bad" },
    { ...good, skillSourceName: "Upper" },
    { ...good, skillSourceName: "review", sessionId: "session" },
    { ...good, skillSourceName: "review", text: "PRIVATE" },
    { ...good, skillSourceName: "review", directoryVersion: "a".repeat(64) },
    { ...identity(), skillSourceName: "review" },
  ])
    assert.throws(() => f.registry.begin(input), { code: "invalid_record" });
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    before,
  );
});

test("SKILL failed feature flush cannot expose admission or allow dispatch", async (t) => {
  let armed = false;
  const f = await fixture(t, {
    syncFile: async (file, context) => {
      if (armed && context === "append:feature_gate")
        throw new Error("synthetic marker failure");
      await file.sync();
    },
  });
  const { workspace } = await createManagedWorkspaceOnly(f);
  armed = true;
  const key = { runtimeEpoch: "old", operationId: "skill" };
  await assert.rejects(
    f.registry.begin({
      ...identity("skill", {
        type: "configuration.skill.save",
        workspaceId: workspace.workspaceId,
      }),
      skillSourceName: "review",
    }),
    { code: "writer_poisoned" },
  );
  assert.equal(f.registry.lookup(key).status, "missing");
  assert.deepEqual(f.registry.readView().retainedOperations, []);
  await assert.rejects(
    f.registry.dispatch({ ...key, step: "filesystem.configuration.stage" }),
    { code: "writer_poisoned" },
  );
  const payloads = (
    await fs.readFile(join(f.directory, "journal.jsonl"), "utf8")
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line).payload);
  assert.equal(
    payloads.some((p) => p.identity?.type === "configuration.skill.save"),
    false,
  );
});

import { nativeSkillRegistrationId } from "../native-skills-protocol.mjs";
test("Native Skill runtime durable admission flushes feature and retains closed original target", async (t) => {
  const f = await fixture(t);
  const seed = await createManaged(f, "runtime-seed");
  const input = identity("runtime-register", {
    type: "configuration.skill.register",
    workspaceId: seed.workspace.workspaceId,
  });
  const skillRuntime = {
    sourceName: "review",
    nativeId: nativeSkillRegistrationId({ ...input, sourceName: "review" }),
    digest: "b".repeat(64),
    version: "c".repeat(64),
    directoryVersion: "d".repeat(64),
  };
  assert.equal(
    (await f.registry.begin({ ...input, skillRuntime })).status,
    "admitted",
  );
  const payloads = (
    await fs.readFile(join(f.directory, "journal.jsonl"), "utf8")
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line).payload);
  const admission = payloads.findIndex(
    (p) => p.identity?.operationId === input.operationId,
  );
  assert.equal(
    payloads[admission - 1].feature,
    "configuration_skill_runtime_v1",
  );
  assert.deepEqual(payloads[admission].skillRuntime, skillRuntime);
});

async function runtimeStorageFixture(t, io = {}) {
  const f = await fixture(t, io);
  const seed = await createManaged(f, "runtime-seed");
  const input = identity("runtime-register", {
    type: "configuration.skill.register",
    workspaceId: seed.workspace.workspaceId,
  });
  const target = {
    sourceName: "review",
    nativeId: nativeSkillRegistrationId({ ...input, sourceName: "review" }),
    digest: "b".repeat(64),
    nativeDigest: "c".repeat(64),
    bodyDigest: "d".repeat(64),
    registrationRuntimeEpoch: "old",
    registrationOperationId: input.operationId,
  };
  const admission = {
    sourceName: target.sourceName,
    nativeId: target.nativeId,
    digest: target.digest,
    version: "e".repeat(64),
    directoryVersion: "f".repeat(64),
  };
  const empty = { workspaces: [], sessions: [], tombstones: [] };
  const request = (action, operationId = `runtime-${action}`) => {
    const apply = action === "apply";
    const scope = {
      workspaceId: input.workspaceId,
      ...(apply && { sessionId: seed.appSessionId }),
    };
    const key = { runtimeEpoch: "old", operationId };
    const common = { ...target };
    if (action === "remove") delete common.bodyDigest;
    const confirmed = receipt(operationId, {
      ...scope,
      type: `configuration.skill.${action}`,
      result: {
        kind: {
          register: "skill_registered",
          apply: "skill_applied",
          remove: "skill_removed",
        }[action],
        workspaceId: scope.workspaceId,
        ...common,
        ...(action === "register" && {
          version: admission.version,
          directoryVersion: admission.directoryVersion,
        }),
        ...(apply && {
          sessionId: seed.appSessionId,
          nativeSessionId: `native-runtime-seed`,
          nativeMessageId: "message-1",
        }),
      },
    });
    return {
      key,
      begin: {
        ...identity(operationId, { type: confirmed.type, ...scope }),
        skillRuntime:
          action === "register" ? admission : { nativeId: target.nativeId },
      },
      dispatch: {
        ...key,
        step: `native.skill.${action}`,
        skillRuntime: target,
        ...(apply && { nativeSessionId: "native-runtime-seed" }),
      },
      completion: { ...key, receipt: confirmed, delta: empty },
    };
  };
  return { ...f, seed, input, target, admission, empty, request };
}

test("Native Skill runtime actual registry register/apply/remove proofs survive checkpoint and reopen", async (t) => {
  const f = await runtimeStorageFixture(t);
  const before = f.registry.readView();
  for (const action of ["register", "apply", "remove"]) {
    const r = f.request(action);
    assert.equal((await f.registry.begin(r.begin)).status, "admitted");
    if (action === "register") {
      const intent = f.registry.dispatch(r.dispatch);
      r.dispatch.skillRuntime = { ...f.target, bodyDigest: "0".repeat(64) };
      assert.equal((await intent).status, "dispatched");
      r.dispatch.skillRuntime = f.target;
    } else
      assert.equal(
        (await f.registry.dispatch(r.dispatch)).status,
        "dispatched",
      );
    assert.equal((await f.registry.complete(r.completion)).status, "completed");
    assert.deepEqual(
      f.registry.lookup(r.key).receipt.result,
      r.completion.receipt.result,
    );
    assert.equal((await f.registry.complete(r.completion)).status, "duplicate");
  }
  const view = f.registry.readView();
  assert.deepEqual(view.workspaces, before.workspaces);
  assert.deepEqual(view.sessions, before.sessions);
  assert.deepEqual(view.retainedOperations, []);
  await f.registry.checkpoint();
  const next = await reopened(t, f);
  assert.equal(next.status().state, "ready");
  for (const action of ["register", "apply", "remove"]) {
    const r = f.request(action);
    assert.deepEqual(
      next.lookup(r.key).receipt.result,
      r.completion.receipt.result,
    );
  }
  const bytes = await fs.readFile(join(f.directory, "journal.jsonl"), "utf8");
  assert.equal(bytes.includes("nonce"), false);
  assert.equal(bytes.includes("content"), false);
});

for (const corrupt of [
  "missing-feature",
  "admitted-digest",
  "admitted-version",
  "apply-body",
  "apply-session",
  "original-unconfirmed",
  "apply-none",
  "completion-body",
  "private-path",
  "reservation",
]) {
  test(`Native Skill runtime checksum-valid ${corrupt} history refuses reopen and preserves bytes`, async (t) => {
    const f = await runtimeStorageFixture(t);
    for (const action of ["register", "apply"]) {
      const r = f.request(action);
      await f.registry.begin(r.begin);
      await f.registry.dispatch(r.dispatch);
      await f.registry.complete(r.completion);
    }
    await f.registry.checkpoint();
    await f.registry.close();
    await rewriteInstructionHistory(f, (payloads) => {
      const admitted = payloads.find(
        (p) => p.identity?.operationId === "runtime-register",
      );
      const reg = payloads.find(
        (p) => p.kind === "completion" && p.operationId === "runtime-register",
      );
      const dispatch = payloads.find((p) => p.step === "native.skill.apply");
      const completed = payloads.find(
        (p) => p.kind === "completion" && p.operationId === "runtime-apply",
      );
      if (corrupt === "missing-feature")
        return payloads.filter(
          (p) => p.feature !== "configuration_skill_runtime_v1",
        );
      if (corrupt === "admitted-digest")
        admitted.skillRuntime.digest = "0".repeat(64);
      if (corrupt === "admitted-version")
        admitted.skillRuntime.version = "0".repeat(64);
      if (corrupt === "apply-body")
        dispatch.skillRuntime.bodyDigest = "0".repeat(64);
      if (corrupt === "apply-session")
        dispatch.nativeSessionId = "other-native";
      if (corrupt === "original-unconfirmed") {
        reg.receipt.effect = "unknown";
        reg.receipt.delivery = "unknown";
        delete reg.receipt.result;
      }
      if (corrupt === "apply-none") {
        completed.receipt.admission = "admitted";
        completed.receipt.effect = "none";
      }
      if (corrupt === "completion-body")
        completed.receipt.result.bodyDigest = "0".repeat(64);
      if (corrupt === "private-path") dispatch.skillRuntime.path = "/PRIVATE";
      if (corrupt === "reservation")
        payloads.splice(payloads.indexOf(admitted) + 1, 0, {
          kind: "reservation",
          runtimeEpoch: "old",
          operationId: "runtime-register",
          workspace: { ...f.seed.workspace, registrationState: "reserved" },
          appSessionId: "forbidden",
        });
      return payloads;
    });
    const names = (await fs.readdir(f.directory)).sort();
    const bytes = await Promise.all(
      names.map((name) => fs.readFile(join(f.directory, name))),
    );
    const next = await openWorkspaceRegistry({
      ...f.options,
      io: {},
      runtimeEpoch: "new",
    });
    assert.equal(next.status().state, "recovery_required");
    assert.notEqual(
      next.lookup(f.request("apply").key).receipt?.effect,
      "confirmed",
    );
    await next.close();
    assert.deepEqual((await fs.readdir(f.directory)).sort(), names);
    assert.deepEqual(
      await Promise.all(
        names.map((name) => fs.readFile(join(f.directory, name))),
      ),
      bytes,
    );
  });
}

test("Native Skill runtime unknown original key remains lookup-only and blocks workspace mutations after reopen", async (t) => {
  const f = await runtimeStorageFixture(t);
  const r = f.request("register");
  await f.registry.begin(r.begin);
  await f.registry.dispatch(r.dispatch);
  await f.registry.complete({
    ...r.completion,
    receipt: {
      ...r.completion.receipt,
      delivery: "unknown",
      effect: "unknown",
      result: undefined,
    },
  });
  await f.registry.checkpoint();
  const next = await reopened(t, f);
  assert.equal(next.status().state, "ready");
  assert.equal(next.lookup(r.key).receipt.effect, "unknown");
  assert.equal(next.lookup(r.key).receipt.result, undefined);
  const before = await fs.readFile(join(f.directory, "journal.jsonl"));
  assert.equal((await next.begin(r.begin)).status, "duplicate");
  assert.equal((await next.dispatch(r.dispatch)).status, "duplicate");
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    before,
  );
  for (const type of [
    "configuration.skill.apply",
    "configuration.skill.remove",
    "configuration.skill.save",
    "session.remove",
    "workspace.remove",
  ]) {
    const nextIdentity = identity(`blocked-${type}`, {
      type,
      workspaceId: f.input.workspaceId,
      ...(["configuration.skill.apply", "session.remove"].includes(type) && {
        sessionId: f.seed.appSessionId,
      }),
    });
    const denied = await next.begin({
      ...nextIdentity,
      ...(type === "configuration.skill.save"
        ? { skillSourceName: "review" }
        : type.startsWith("configuration.skill.")
          ? { skillRuntime: { nativeId: f.target.nativeId } }
          : {}),
    });
    assert.equal(denied.status, "rejected");
    assert.equal(denied.receipt.result.code, "UNAVAILABLE");
  }
});

for (const stage of ["feature_gate", "dispatch", "completion"]) {
  for (const fails of [false, true]) {
    test(`Native Skill runtime ${stage} flush ${fails ? "failure" : "pause"} publishes no speculative state`, async (t) => {
      const held = deferred();
      let enabled = false,
        entered = false;
      const f = await runtimeStorageFixture(t, {
        syncFile: async (file, context) => {
          if (enabled && context === `append:${stage}`) {
            entered = true;
            await held.promise;
            if (fails) throw new Error("synthetic flush failure");
          }
          await file.sync();
        },
      });
      const r = f.request("register");
      if (stage !== "feature_gate") await f.registry.begin(r.begin);
      if (stage === "completion") await f.registry.dispatch(r.dispatch);
      const beforeRevision = f.registry.status().revision;
      enabled = true;
      const actual =
        stage === "feature_gate"
          ? f.registry.begin(r.begin)
          : stage === "dispatch"
            ? f.registry.dispatch(r.dispatch)
            : f.registry.complete(r.completion);
      const finished = fails
        ? assert.rejects(actual, { code: "writer_poisoned" })
        : actual;
      await until(() => entered, held.resolve);
      assert.equal(f.registry.status().revision, beforeRevision);
      const lookup = f.registry.lookup(r.key);
      if (stage === "feature_gate") assert.equal(lookup.status, "missing");
      else {
        assert.equal(lookup.receipt.result, undefined);
        assert.equal(
          lookup.receipt.admission,
          stage === "dispatch" ? "admitted" : "dispatched",
        );
      }
      held.resolve();
      await finished;
      if (fails) {
        assert.equal(f.registry.status().state, "recovery_required");
        assert.notEqual(f.registry.lookup(r.key).receipt?.effect, "confirmed");
      } else
        assert.equal(
          f.registry.status().revision,
          beforeRevision + (stage === "feature_gate" ? 2 : 1),
        );
    });
  }
}

for (const action of ["remove", "apply"]) {
  test(`Native Skill runtime ${action} cannot dispatch without original confirmed register receipt`, async (t) => {
    const f = await runtimeStorageFixture(t);
    const r = f.request(action);
    assert.equal((await f.registry.begin(r.begin)).status, "admitted");
    const bytes = await fs.readFile(join(f.directory, "journal.jsonl"));
    await assert.rejects(f.registry.dispatch(r.dispatch), {
      code: "identity_conflict",
    });
    assert.deepEqual(
      await fs.readFile(join(f.directory, "journal.jsonl")),
      bytes,
    );
    assert.equal(f.registry.lookup(r.key).receipt.admission, "admitted");
  });
}

test("Native Skill runtime private admission rejects wrong types, undefined extras and target copies before bytes", async (t) => {
  const f = await runtimeStorageFixture(t);
  const r = f.request("register");
  const before = await fs.readFile(join(f.directory, "journal.jsonl"));
  for (const input of [
    {
      ...identity("other", {
        type: "session.pin",
        workspaceId: f.input.workspaceId,
        sessionId: f.seed.appSessionId,
      }),
      skillRuntime: undefined,
    },
    { ...r.begin, sessionId: f.seed.appSessionId },
    {
      ...r.begin,
      skillRuntime: {
        ...r.begin.skillRuntime,
        nativeId: `omoc-skill-${"0".repeat(64)}`,
      },
    },
    { ...r.begin, skillRuntime: { ...r.begin.skillRuntime, path: "/PRIVATE" } },
    { ...r.begin, skillRuntime: { ...r.begin.skillRuntime, nonce: "PRIVATE" } },
    { ...r.begin, skillSourceName: "review" },
    { ...r.begin, nativeServerName: "PRIVATE" },
  ])
    assert.throws(() => f.registry.begin(input), { code: "invalid_record" });
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    before,
  );
});

import { nativeAgentRegistrationId } from "../native-agents-protocol.mjs";
test("Native Agent runtime durable admission flushes feature and retains closed original target", async (t) => {
  const f = await fixture(t);
  const seed = await createManaged(f, "runtime-seed");
  const input = identity("runtime-register", {
    type: "configuration.agent.register",
    workspaceId: seed.workspace.workspaceId,
  });
  const agentRuntime = {
    sourceName: "review",
    nativeId: nativeAgentRegistrationId({ ...input, sourceName: "review" }),
    digest: "b".repeat(64),
    version: "c".repeat(64),
    directoryVersion: "d".repeat(64),
  };
  assert.equal(
    (await f.registry.begin({ ...input, agentRuntime })).status,
    "admitted",
  );
  const payloads = (
    await fs.readFile(join(f.directory, "journal.jsonl"), "utf8")
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line).payload);
  const admission = payloads.findIndex(
    (p) => p.identity?.operationId === input.operationId,
  );
  assert.equal(payloads[admission - 1].feature, "configuration_agents_v1");
  assert.deepEqual(payloads[admission].agentRuntime, agentRuntime);
});

async function agentStorageFixture(t, io = {}) {
  const f = await fixture(t, io, "old");
  const seed = await createManaged(f, "runtime-seed");
  const input = identity("runtime-register", {
    type: "configuration.agent.register",
    workspaceId: seed.workspace.workspaceId,
  });
  const target = {
    sourceName: "review",
    nativeId: nativeAgentRegistrationId({ ...input, sourceName: "review" }),
    digest: "b".repeat(64),
    nativeDigest: "c".repeat(64),
    systemDigest: "d".repeat(64),
    registrationRuntimeEpoch: "old",
    registrationOperationId: input.operationId,
  };
  const admission = {
    sourceName: target.sourceName,
    nativeId: target.nativeId,
    digest: target.digest,
    version: "e".repeat(64),
    directoryVersion: "f".repeat(64),
  };
  const empty = { workspaces: [], sessions: [], tombstones: [] };
  const request = (action, operationId = `runtime-${action}`) => {
    const scope = {
      workspaceId: input.workspaceId,
    };
    const key = { runtimeEpoch: "old", operationId };
    const common = { ...target };

    const confirmed = receipt(operationId, {
      ...scope,
      type: `configuration.agent.${action}`,
      result: {
        kind: {
          register: "agent_registered",
          remove: "agent_removed",
        }[action],
        workspaceId: scope.workspaceId,
        ...common,
        defaultAgentId: "build",
        ...(action === "register" && {
          version: admission.version,
          directoryVersion: admission.directoryVersion,
        }),
      },
    });
    return {
      key,
      begin: {
        ...identity(operationId, { type: confirmed.type, ...scope }),
        agentRuntime:
          action === "register" ? admission : { nativeId: target.nativeId },
      },
      dispatch: {
        ...key,
        step: `native.agent.${action}`,
        agentRuntime: target,
      },
      completion: { ...key, receipt: confirmed, delta: empty },
    };
  };
  return { ...f, seed, input, target, admission, empty, request };
}

test("Native Agent runtime actual registry register/remove proofs survive checkpoint and reopen", async (t) => {
  const f = await agentStorageFixture(t);
  const before = f.registry.readView();
  for (const action of ["register", "remove"]) {
    const r = f.request(action);
    assert.equal((await f.registry.begin(r.begin)).status, "admitted");
    if (action === "register") {
      const intent = f.registry.dispatch(r.dispatch);
      r.dispatch.agentRuntime = { ...f.target, systemDigest: "0".repeat(64) };
      assert.equal((await intent).status, "dispatched");
      r.dispatch.agentRuntime = f.target;
    } else
      assert.equal(
        (await f.registry.dispatch(r.dispatch)).status,
        "dispatched",
      );
    assert.equal((await f.registry.complete(r.completion)).status, "completed");
    assert.deepEqual(
      f.registry.lookup(r.key).receipt.result,
      r.completion.receipt.result,
    );
    assert.equal((await f.registry.complete(r.completion)).status, "duplicate");
  }
  const view = f.registry.readView();
  assert.deepEqual(view.workspaces, before.workspaces);
  assert.deepEqual(view.sessions, before.sessions);
  assert.deepEqual(view.retainedOperations, []);
  await f.registry.checkpoint();
  const next = await reopened(t, f);
  assert.equal(next.status().state, "ready");
  for (const action of ["register", "remove"]) {
    const r = f.request(action);
    assert.deepEqual(
      next.lookup(r.key).receipt.result,
      r.completion.receipt.result,
    );
  }
  const bytes = await fs.readFile(join(f.directory, "journal.jsonl"), "utf8");
  assert.equal(bytes.includes("nonce"), false);
  assert.equal(bytes.includes("content"), false);
});

for (const [priorRemoval, foreignEpoch] of [
  [false, false],
  [false, true],
  [true, false],
]) {
  test(`Native Agent current epoch workspace tombstone ${foreignEpoch ? "with foreign request epoch " : ""}${priorRemoval ? "accepts confirmed removal" : "refuses live registration"}`, async (t) => {
    const f = await agentStorageFixture(t);
    const registered = f.request("register");
    await f.registry.begin(registered.begin);
    await f.registry.dispatch(registered.dispatch);
    await f.registry.complete(registered.completion);
    if (priorRemoval) {
      const removed = f.request("remove");
      await f.registry.begin(removed.begin);
      await f.registry.dispatch(removed.dispatch);
      await f.registry.complete(removed.completion);
      const again = f.request("remove", "remove-again");
      await f.registry.begin(again.begin);
      const bytes = await fs.readFile(join(f.directory, "journal.jsonl"));
      await assert.rejects(f.registry.dispatch(again.dispatch), {
        code: "identity_conflict",
      });
      assert.deepEqual(
        await fs.readFile(join(f.directory, "journal.jsonl")),
        bytes,
      );
      await f.registry.complete({
        ...again.completion,
        receipt: {
          ...again.completion.receipt,
          admission: "rejected",
          delivery: "pending",
          effect: "none",
          result: { kind: "rejected", code: "INVALID_REQUEST" },
        },
      });
    }
    const key = {
      runtimeEpoch: foreignEpoch ? "foreign" : "old",
      operationId: "workspace-remove-agent",
    };
    await f.registry.begin(
      identity(key.operationId, {
        type: "workspace.remove",
        workspaceId: f.input.workspaceId,
        runtimeEpoch: key.runtimeEpoch,
      }),
    );
    await f.registry.dispatch({ ...key, step: "registry.unregister" });
    const completion = {
      ...key,
      receipt: receipt(key.operationId, {
        type: "workspace.remove",
        workspaceId: f.input.workspaceId,
        runtimeEpoch: key.runtimeEpoch,
        result: {
          kind: "removed",
          workspaceId: f.input.workspaceId,
          workspaceRemoved: true,
          removedSessionIds: [f.seed.appSessionId],
        },
      }),
      delta: {
        workspaces: [],
        sessions: [],
        tombstones: [
          { kind: "session", id: f.seed.appSessionId },
          { kind: "workspace", id: f.input.workspaceId },
        ],
      },
    };
    const before = await fs.readFile(join(f.directory, "journal.jsonl"));
    if (priorRemoval) {
      await f.registry.complete(completion);
      assert.equal(f.registry.readView().workspaces.length, 0);
    } else {
      await assert.rejects(f.registry.complete(completion), {
        code: "identity_conflict",
      });
      assert.deepEqual(
        await fs.readFile(join(f.directory, "journal.jsonl")),
        before,
      );
      assert.equal(f.registry.readView().workspaces.length, 1);
    }
  });
}

test("Native Agent previous epoch registration stays historical during current workspace removal", async (t) => {
  const f = await agentStorageFixture(t);
  const registered = f.request("register");
  await f.registry.begin(registered.begin);
  await f.registry.dispatch(registered.dispatch);
  await f.registry.complete(registered.completion);
  await f.registry.checkpoint();
  const next = await reopened(t, f);
  const key = {
    runtimeEpoch: "new",
    operationId: "historical-workspace-remove",
  };
  await next.begin({
    ...identity(key.operationId, {
      type: "workspace.remove",
      workspaceId: f.input.workspaceId,
    }),
    ...key,
  });
  await next.dispatch({ ...key, step: "registry.unregister" });
  await next.complete({
    ...key,
    receipt: receipt(key.operationId, {
      runtimeEpoch: "new",
      type: "workspace.remove",
      workspaceId: f.input.workspaceId,
      result: {
        kind: "removed",
        workspaceId: f.input.workspaceId,
        workspaceRemoved: true,
        removedSessionIds: [f.seed.appSessionId],
      },
    }),
    delta: {
      workspaces: [],
      sessions: [],
      tombstones: [
        { kind: "session", id: f.seed.appSessionId },
        { kind: "workspace", id: f.input.workspaceId },
      ],
    },
  });
  assert.equal(next.readView().workspaces.length, 0);
  assert.equal(next.lookup(registered.key).receipt.effect, "confirmed");
});

test("AGENT file admission binds private name without public identity expansion", async (t) => {
  const f = await fixture(t);
  const { workspace } = await createManagedWorkspaceOnly(f);
  const admitted = identity("agent", {
    type: "configuration.agent.save",
    workspaceId: workspace.workspaceId,
  });
  const input = { ...admitted, agentSourceName: "review_code" };
  const begun = await f.registry.begin(input);
  assert.equal(begun.status, "admitted");
  assert.equal(begun.receipt.agentSourceName, undefined);
  assert.deepEqual(
    f.registry.lookupIdentity(agentAdmittedKey(input)),
    admitted,
  );
  assert.deepEqual(f.registry.readView().retainedOperations, [
    {
      runtimeEpoch: "old",
      operationId: "agent",
      type: "configuration.agent.save",
      workspaceId: workspace.workspaceId,
    },
  ]);
  assert.equal((await f.registry.begin(input)).status, "duplicate");
  await assert.rejects(
    f.registry.begin({ ...input, agentSourceName: "other" }),
    { code: "DUPLICATE_CONFLICT" },
  );
  const lines = (await fs.readFile(join(f.directory, "journal.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  const marker = lines.findIndex(
    (line) => line.payload.feature === "configuration_agents_v1",
  );
  assert.ok(marker >= 0);
  assert.equal(lines[marker + 1].payload.agentSourceName, "review_code");
  assert.equal(lines[marker + 1].payload.identity.agentSourceName, undefined);
});
function agentAdmittedKey(value) {
  return { runtimeEpoch: value.runtimeEpoch, operationId: value.operationId };
}

import { agentBackupId } from "./workbench-agent-storage.mjs";
async function agentFileStorageFixture(t, io = {}) {
  const f = await fixture(t, io);
  const reserved = await createManagedWorkspaceOnly(f);
  const input = {
    ...identity("agent", {
      type: "configuration.agent.save",
      workspaceId: reserved.workspace.workspaceId,
    }),
    agentSourceName: "review",
  };
  const key = agentAdmittedKey(input);
  const expectedRevision = f.registry.status().revision;
  assert.equal(
    (await f.registry.begin({ ...input, expectedRevision })).status,
    "admitted",
  );
  assert.equal(f.registry.status().revision, expectedRevision + 2);
  const confirmed = receipt("agent", {
    type: input.type,
    workspaceId: input.workspaceId,
    result: {
      kind: "agent_file_saved",
      workspaceId: input.workspaceId,
      sourceName: "review",
      version: "b".repeat(64),
      backupId: agentBackupId(key.runtimeEpoch, key.operationId),
    },
  });
  return {
    ...f,
    input,
    key,
    confirmed,
    workspaceRecord: reserved.workspace,
    empty: { workspaces: [], sessions: [], tombstones: [] },
  };
}
test("AGENT file defensive completion requires exact source, key backup, staged publication and zero delta; checkpoint reopens", async (t) => {
  const f = await agentFileStorageFixture(t);
  const before = await fs.readFile(join(f.directory, "journal.jsonl"));
  await assert.rejects(
    f.registry.reserve({ ...f.key, workspaceId: f.input.workspaceId }),
    { code: "identity_conflict" },
  );
  await assert.rejects(
    f.registry.dispatch({ ...f.key, step: "filesystem.configuration.publish" }),
    { code: "identity_conflict" },
  );
  await assert.rejects(
    f.registry.dispatch({ ...f.key, step: "native.create" }),
    { code: "identity_conflict" },
  );
  await assert.rejects(
    f.registry.complete({ ...f.key, receipt: f.confirmed, delta: f.empty }),
    { code: "identity_conflict" },
  );
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    before,
  );
  await f.registry.dispatch({
    ...f.key,
    step: "filesystem.configuration.stage",
  });
  await assert.rejects(
    f.registry.complete({ ...f.key, receipt: f.confirmed, delta: f.empty }),
    { code: "identity_conflict" },
  );
  await f.registry.dispatch({
    ...f.key,
    step: "filesystem.configuration.publish",
  });
  const staged = await fs.readFile(join(f.directory, "journal.jsonl"));
  for (const candidate of [
    { ...f.confirmed, result: { ...f.confirmed.result, sourceName: "other" } },
    {
      ...f.confirmed,
      result: {
        ...f.confirmed.result,
        backupId: agentBackupId("old", "other"),
      },
    },
    { ...f.confirmed, result: { ...f.confirmed.result, text: "PRIVATE" } },
    { ...f.confirmed, effect: "unknown", delivery: "unknown" },
    { ...f.confirmed, admission: "admitted" },
    { ...f.confirmed, sessionId: "session" },
  ])
    await assert.rejects(
      f.registry.complete({ ...f.key, receipt: candidate, delta: f.empty }),
    );
  await assert.rejects(
    f.registry.complete({
      ...f.key,
      receipt: f.confirmed,
      delta: {
        ...f.empty,
        tombstones: [{ kind: "workspace", id: f.input.workspaceId }],
      },
    }),
    { code: "identity_conflict" },
  );
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    staged,
  );
  await f.registry.complete({ ...f.key, receipt: f.confirmed, delta: f.empty });
  assert.deepEqual(f.registry.lookup(f.key).receipt.result, f.confirmed.result);
  assert.equal((await f.registry.begin(f.input)).status, "duplicate");
  assert.deepEqual(f.registry.readView().retainedOperations, []);
  await f.registry.checkpoint();
  const next = await reopened(t, f);
  assert.equal(next.status().state, "ready");
  assert.deepEqual(next.lookup(f.key).receipt.result, f.confirmed.result);
  assert.equal((await next.begin(f.input)).status, "duplicate");
  await assert.rejects(next.begin({ ...f.input, agentSourceName: "other" }), {
    code: "DUPLICATE_CONFLICT",
  });
});

test("AGENT file staged unknown keeps original immutable key, private name and workspace hold after checkpoint", async (t) => {
  const f = await agentFileStorageFixture(t);
  await f.registry.dispatch({
    ...f.key,
    step: "filesystem.configuration.stage",
  });
  const unknown = { ...f.confirmed, delivery: "unknown", effect: "unknown" };
  delete unknown.result;
  await f.registry.complete({ ...f.key, receipt: unknown, delta: f.empty });
  await f.registry.checkpoint();
  const next = await reopened(t, f);
  const view = next.readView();
  assert.deepEqual(view.retainedOperations, [
    { ...f.key, type: f.input.type, workspaceId: f.input.workspaceId },
  ]);
  assert.equal(next.lookup(f.key).receipt.result, undefined);
  assert.equal(next.lookup(f.key).receipt.effect, "unknown");
  assert.equal(
    next.lookup({ ...f.key, runtimeEpoch: "new" }).status,
    "missing",
  );
  const before = await fs.readFile(join(f.directory, "journal.jsonl"));
  assert.equal((await next.begin(f.input)).status, "duplicate");
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    before,
  );
  await assert.rejects(next.begin({ ...f.input, agentSourceName: "other" }), {
    code: "DUPLICATE_CONFLICT",
  });
  assert.equal(
    (await next.begin({ ...f.input, operationId: "new-key" })).status,
    "rejected",
  );
  assert.ok(
    next
      .readView()
      .recovery.resources.some(
        (entry) =>
          entry.workspaceId === f.input.workspaceId &&
          entry.reason === "unresolved_operation",
      ),
  );
});

for (const corruption of [
  "name",
  "missing-feature",
  "backup",
  "order",
  "delta",
  "reservation",
]) {
  test(`AGENT file checksum-valid ${corruption} history is rejected after checkpoint without changing bytes`, async (t) => {
    const f = await agentFileStorageFixture(t);
    await f.registry.dispatch({
      ...f.key,
      step: "filesystem.configuration.stage",
    });
    await f.registry.dispatch({
      ...f.key,
      step: "filesystem.configuration.publish",
    });
    await f.registry.complete({
      ...f.key,
      receipt: f.confirmed,
      delta: f.empty,
    });
    const forgedWorkspace = {
      ...f.workspaceRecord,
      registrationState: "reserved",
    };
    await f.registry.checkpoint();
    await f.registry.close();
    await rewriteInstructionHistory(f, (payloads) => {
      const admission = payloads.find(
        (p) => p.identity?.type === "configuration.agent.save",
      );
      const completion = payloads.find(
        (p) => p.kind === "completion" && p.operationId === "agent",
      );
      if (corruption === "name") admission.agentSourceName = "other";
      if (corruption === "missing-feature")
        return payloads.filter((p) => p.feature !== "configuration_agents_v1");
      if (corruption === "backup")
        completion.receipt.result.backupId = agentBackupId("old", "other");
      if (corruption === "delta")
        completion.delta.tombstones.push({
          kind: "workspace",
          id: f.input.workspaceId,
        });
      if (corruption === "order") {
        const stage = payloads.find(
          (p) =>
            p.operationId === "agent" &&
            p.step === "filesystem.configuration.stage",
        );
        stage.step = "filesystem.configuration.publish";
      }
      if (corruption === "reservation")
        payloads.splice(payloads.indexOf(admission) + 1, 0, {
          kind: "reservation",
          ...f.key,
          workspace: forgedWorkspace,
          appSessionId: "forbidden",
        });
      return payloads;
    });
    const before = await fs.readFile(join(f.directory, "journal.jsonl"));
    const next = await openWorkspaceRegistry({
      ...f.options,
      io: {},
      runtimeEpoch: "new",
    });
    t.after(() => next.close());
    assert.equal(next.status().state, "recovery_required");
    assert.equal(
      next.status().reason,
      corruption === "missing-feature"
        ? "unsupported_version"
        : corruption === "backup"
          ? "corrupt_journal"
          : "identity_conflict",
    );
    assert.notEqual(next.lookup(f.key).receipt?.effect, "confirmed");
    await next.close();
    assert.deepEqual(
      await fs.readFile(join(f.directory, "journal.jsonl")),
      before,
    );
  });
}

test("AGENT file feature flush precedes visible admission and no original revision is lost", async (t) => {
  const held = deferred();
  let enabled = false,
    entered = false;
  const f = await fixture(t, {
    syncFile: async (file, context) => {
      if (enabled && context === "append:feature_gate") {
        entered = true;
        await held.promise;
      }
      await file.sync();
    },
  });
  const { workspace } = await createManagedWorkspaceOnly(f);
  const expectedRevision = f.registry.status().revision;
  enabled = true;
  const waiting = f.registry.begin({
    ...identity("agent", {
      type: "configuration.agent.save",
      workspaceId: workspace.workspaceId,
    }),
    agentSourceName: "review",
    expectedRevision,
  });
  await until(() => entered, held.resolve);
  assert.equal(f.registry.status().revision, expectedRevision);
  assert.equal(
    f.registry.lookup({ runtimeEpoch: "old", operationId: "agent" }).status,
    "missing",
  );
  assert.deepEqual(f.registry.readView().retainedOperations, []);
  held.resolve();
  assert.equal((await waiting).status, "admitted");
  assert.equal(f.registry.status().revision, expectedRevision + 2);
});

test("AGENT file admission rejects missing/invalid private name, session and foreign fields before feature bytes", async (t) => {
  const f = await fixture(t);
  const before = await fs.readFile(join(f.directory, "journal.jsonl"));
  const good = identity("agent", {
    type: "configuration.agent.save",
    workspaceId: "ws",
  });
  for (const input of [
    good,
    { ...good, agentSourceName: "../bad" },
    { ...good, agentSourceName: "constructor" },
    { ...good, agentSourceName: "review", sessionId: "session" },
    { ...good, agentSourceName: "review", text: "PRIVATE" },
    { ...good, agentSourceName: "review", directoryVersion: "a".repeat(64) },
    { ...identity(), agentSourceName: "review" },
  ])
    assert.throws(() => f.registry.begin(input), { code: "invalid_record" });
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    before,
  );
});

test("AGENT file failed feature flush cannot expose admission or allow dispatch", async (t) => {
  let armed = false;
  const f = await fixture(t, {
    syncFile: async (file, context) => {
      if (armed && context === "append:feature_gate")
        throw new Error("synthetic marker failure");
      await file.sync();
    },
  });
  const { workspace } = await createManagedWorkspaceOnly(f);
  armed = true;
  const key = { runtimeEpoch: "old", operationId: "agent" };
  await assert.rejects(
    f.registry.begin({
      ...identity("agent", {
        type: "configuration.agent.save",
        workspaceId: workspace.workspaceId,
      }),
      agentSourceName: "review",
    }),
    { code: "writer_poisoned" },
  );
  assert.equal(f.registry.lookup(key).status, "missing");
  assert.deepEqual(f.registry.readView().retainedOperations, []);
  await assert.rejects(
    f.registry.dispatch({ ...key, step: "filesystem.configuration.stage" }),
    { code: "writer_poisoned" },
  );
  const payloads = (
    await fs.readFile(join(f.directory, "journal.jsonl"), "utf8")
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line).payload);
  assert.equal(
    payloads.some((p) => p.identity?.type === "configuration.agent.save"),
    false,
  );
});

test("Native Agent runtime unknown original key remains lookup-only and blocks workspace mutations after reopen", async (t) => {
  const f = await agentStorageFixture(t);
  const r = f.request("register");
  await f.registry.begin(r.begin);
  await f.registry.dispatch(r.dispatch);
  await f.registry.complete({
    ...r.completion,
    receipt: {
      ...r.completion.receipt,
      delivery: "unknown",
      effect: "unknown",
      result: undefined,
    },
  });
  await f.registry.checkpoint();
  const next = await reopened(t, f);
  assert.equal(next.status().state, "ready");
  assert.equal(next.lookup(r.key).receipt.effect, "unknown");
  assert.equal(next.lookup(r.key).receipt.result, undefined);
  const before = await fs.readFile(join(f.directory, "journal.jsonl"));
  assert.equal((await next.begin(r.begin)).status, "duplicate");
  assert.equal((await next.dispatch(r.dispatch)).status, "duplicate");
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    before,
  );
  for (const type of [
    "configuration.agent.remove",
    "configuration.agent.save",
    "session.remove",
    "workspace.remove",
  ]) {
    const nextIdentity = identity(`blocked-${type}`, {
      type,
      workspaceId: f.input.workspaceId,
      ...(["configuration.agent.apply", "session.remove"].includes(type) && {
        sessionId: f.seed.appSessionId,
      }),
    });
    const denied = await next.begin({
      ...nextIdentity,
      ...(type === "configuration.agent.save"
        ? { agentSourceName: "review" }
        : type.startsWith("configuration.agent.")
          ? { agentRuntime: { nativeId: f.target.nativeId } }
          : {}),
    });
    assert.equal(denied.status, "rejected");
    assert.equal(denied.receipt.result.code, "UNAVAILABLE");
  }
});

for (const stage of ["feature_gate", "dispatch", "completion"]) {
  for (const fails of [false, true]) {
    test(`Native Agent runtime ${stage} flush ${fails ? "failure" : "pause"} publishes no speculative state`, async (t) => {
      const held = deferred();
      let enabled = false,
        entered = false;
      const f = await agentStorageFixture(t, {
        syncFile: async (file, context) => {
          if (enabled && context === `append:${stage}`) {
            entered = true;
            await held.promise;
            if (fails) throw new Error("synthetic flush failure");
          }
          await file.sync();
        },
      });
      const r = f.request("register");
      if (stage !== "feature_gate") await f.registry.begin(r.begin);
      if (stage === "completion") await f.registry.dispatch(r.dispatch);
      const beforeRevision = f.registry.status().revision;
      enabled = true;
      const actual =
        stage === "feature_gate"
          ? f.registry.begin(r.begin)
          : stage === "dispatch"
            ? f.registry.dispatch(r.dispatch)
            : f.registry.complete(r.completion);
      const finished = fails
        ? assert.rejects(actual, { code: "writer_poisoned" })
        : actual;
      await until(() => entered, held.resolve);
      assert.equal(f.registry.status().revision, beforeRevision);
      const lookup = f.registry.lookup(r.key);
      if (stage === "feature_gate") assert.equal(lookup.status, "missing");
      else {
        assert.equal(lookup.receipt.result, undefined);
        assert.equal(
          lookup.receipt.admission,
          stage === "dispatch" ? "admitted" : "dispatched",
        );
      }
      held.resolve();
      await finished;
      if (fails) {
        assert.equal(f.registry.status().state, "recovery_required");
        assert.notEqual(f.registry.lookup(r.key).receipt?.effect, "confirmed");
      } else
        assert.equal(
          f.registry.status().revision,
          beforeRevision + (stage === "feature_gate" ? 2 : 1),
        );
    });
  }
}

for (const action of ["remove"]) {
  test(`Native Agent runtime ${action} cannot dispatch without original confirmed register receipt`, async (t) => {
    const f = await agentStorageFixture(t);
    const r = f.request(action);
    assert.equal((await f.registry.begin(r.begin)).status, "admitted");
    const bytes = await fs.readFile(join(f.directory, "journal.jsonl"));
    await assert.rejects(f.registry.dispatch(r.dispatch), {
      code: "identity_conflict",
    });
    assert.deepEqual(
      await fs.readFile(join(f.directory, "journal.jsonl")),
      bytes,
    );
    assert.equal(f.registry.lookup(r.key).receipt.admission, "admitted");
  });
}

test("Native Agent runtime private admission rejects wrong types, undefined extras and target copies before bytes", async (t) => {
  const f = await agentStorageFixture(t);
  const r = f.request("register");
  const before = await fs.readFile(join(f.directory, "journal.jsonl"));
  for (const input of [
    {
      ...identity("other", {
        type: "session.pin",
        workspaceId: f.input.workspaceId,
        sessionId: f.seed.appSessionId,
      }),
      agentRuntime: undefined,
    },
    { ...r.begin, sessionId: f.seed.appSessionId },
    {
      ...r.begin,
      agentRuntime: {
        ...r.begin.agentRuntime,
        nativeId: `omoc-agent-${"0".repeat(64)}`,
      },
    },
    { ...r.begin, agentRuntime: { ...r.begin.agentRuntime, path: "/PRIVATE" } },
    { ...r.begin, agentRuntime: { ...r.begin.agentRuntime, nonce: "PRIVATE" } },
    { ...r.begin, agentSourceName: "review" },
    { ...r.begin, nativeServerName: "PRIVATE" },
  ])
    assert.throws(() => f.registry.begin(input), { code: "invalid_record" });
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    before,
  );
});

for (const corrupt of [
  "missing-feature",
  "admitted-digest",
  "admitted-version",
  "remove-body",
  "remove-session",
  "original-unconfirmed",
  "remove-none",
  "completion-body",
  "private-path",
  "reservation",
]) {
  test(`Native Agent runtime checksum-valid ${corrupt} history refuses reopen and preserves bytes`, async (t) => {
    const f = await agentStorageFixture(t);
    for (const action of ["register", "remove"]) {
      const r = f.request(action);
      await f.registry.begin(r.begin);
      await f.registry.dispatch(r.dispatch);
      await f.registry.complete(r.completion);
    }
    await f.registry.checkpoint();
    await f.registry.close();
    await rewriteInstructionHistory(f, (payloads) => {
      const admitted = payloads.find(
        (p) => p.identity?.operationId === "runtime-register",
      );
      const reg = payloads.find(
        (p) => p.kind === "completion" && p.operationId === "runtime-register",
      );
      const dispatch = payloads.find((p) => p.step === "native.agent.remove");
      const completed = payloads.find(
        (p) => p.kind === "completion" && p.operationId === "runtime-remove",
      );
      if (corrupt === "missing-feature")
        return payloads.filter((p) => p.feature !== "configuration_agents_v1");
      if (corrupt === "admitted-digest")
        admitted.agentRuntime.digest = "0".repeat(64);
      if (corrupt === "admitted-version")
        admitted.agentRuntime.version = "0".repeat(64);
      if (corrupt === "remove-body")
        dispatch.agentRuntime.systemDigest = "0".repeat(64);
      if (corrupt === "remove-session")
        dispatch.nativeSessionId = "other-native";
      if (corrupt === "original-unconfirmed") {
        reg.receipt.effect = "unknown";
        reg.receipt.delivery = "unknown";
        delete reg.receipt.result;
      }
      if (corrupt === "remove-none") {
        completed.receipt.admission = "admitted";
        completed.receipt.effect = "none";
      }
      if (corrupt === "completion-body")
        completed.receipt.result.systemDigest = "0".repeat(64);
      if (corrupt === "private-path") dispatch.agentRuntime.path = "/PRIVATE";
      if (corrupt === "reservation")
        payloads.splice(payloads.indexOf(admitted) + 1, 0, {
          kind: "reservation",
          runtimeEpoch: "old",
          operationId: "runtime-register",
          workspace: { ...f.seed.workspace, registrationState: "reserved" },
          appSessionId: "forbidden",
        });
      return payloads;
    });
    const names = (await fs.readdir(f.directory)).sort();
    const bytes = await Promise.all(
      names.map((name) => fs.readFile(join(f.directory, name))),
    );
    const next = await openWorkspaceRegistry({
      ...f.options,
      io: {},
      runtimeEpoch: "new",
    });
    assert.equal(next.status().state, "recovery_required");
    assert.notEqual(
      next.lookup(f.request("remove").key).receipt?.effect,
      "confirmed",
    );
    await next.close();
    assert.deepEqual((await fs.readdir(f.directory)).sort(), names);
    assert.deepEqual(
      await Promise.all(
        names.map((name) => fs.readFile(join(f.directory, name))),
      ),
      bytes,
    );
  });
}

// Workspace file writes use the existing original-key journal and publisher steps.
const workspaceFileTarget = () => ({
  path: "src/example.txt",
  version: "b".repeat(64),
  directoryVersion: "c".repeat(64),
});
async function workspaceFileStorageFixture(t, io = {}, begin = true) {
  const f = await fixture(t, io);
  const { workspace } = await createManagedWorkspaceOnly(f);
  const input = {
    ...identity("file-save", {
      type: "file.save",
      workspaceId: workspace.workspaceId,
    }),
    fileTarget: workspaceFileTarget(),
  };
  const key = admittedKey(input);
  const backupId = `.omoc-configuration-${createHash("sha256")
    .update(JSON.stringify([key.runtimeEpoch, key.operationId]))
    .digest("hex")}.file.backup`;
  const confirmed = receipt(key.operationId, {
    type: input.type,
    workspaceId: input.workspaceId,
    result: {
      kind: "file_saved",
      workspaceId: input.workspaceId,
      path: input.fileTarget.path,
      version: "d".repeat(64),
      digest: input.digest,
      backupId,
    },
  });
  const expectedRevision = f.registry.status().revision;
  if (begin) {
    assert.equal(
      (await f.registry.begin({ ...input, expectedRevision })).status,
      "admitted",
    );
    assert.equal(f.registry.status().revision, expectedRevision + 2);
  }
  return {
    ...f,
    input,
    key,
    confirmed,
    empty: { workspaces: [], sessions: [], tombstones: [] },
  };
}
test("FILE durable marker precedes closed target admission and retains original identity without text", async (t) => {
  const f = await workspaceFileStorageFixture(t);
  const payloads = (
    await fs.readFile(join(f.directory, "journal.jsonl"), "utf8")
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line).payload);
  const index = payloads.findIndex((p) => p.identity?.type === "file.save");
  assert.equal(payloads[index - 1].feature, "workspace_file_save_v1");
  assert.deepEqual(payloads[index].fileTarget, f.input.fileTarget);
  const { fileTarget: _fileTarget, ...original } = f.input;
  assert.deepEqual(f.registry.lookupIdentity(f.key), original);
  assert.equal(f.registry.lookup(f.key).receipt.fileTarget, undefined);
  assert.equal((await f.registry.begin(f.input)).status, "duplicate");
  await assert.rejects(
    f.registry.begin({
      ...f.input,
      fileTarget: { ...f.input.fileTarget, path: "other.txt" },
    }),
    { code: "DUPLICATE_CONFLICT" },
  );
});

test("FILE reopened unknown never dispatches a remaining step or maps to confirmed success", async (t) => {
  const f = await workspaceFileStorageFixture(t);
  await f.registry.dispatch({
    ...f.key,
    step: "filesystem.configuration.stage",
    fileTarget: f.input.fileTarget,
  });
  const unknown = { ...f.confirmed, delivery: "unknown", effect: "unknown" };
  delete unknown.result;
  await f.registry.complete({ ...f.key, receipt: unknown, delta: f.empty });
  await f.registry.checkpoint();
  await f.registry.close();
  const next = await openWorkspaceRegistry({
    ...f.options,
    runtimeEpoch: "reopened",
  });
  t.after(() => next.close());
  const before = await fs.readFile(join(f.directory, "journal.jsonl"));
  assert.equal(next.lookup(f.key).receipt.effect, "unknown");
  assert.equal((await next.begin(f.input)).status, "duplicate");
  await assert.rejects(
    next.dispatch({
      ...f.key,
      step: "filesystem.configuration.publish",
      fileTarget: f.input.fileTarget,
    }),
    { code: "UNAVAILABLE" },
  );
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    before,
  );
});

const fileDispatch = (f, step = "stage", fileTarget = f.input.fileTarget) => ({
  ...f.key,
  step: `filesystem.configuration.${step}`,
  fileTarget,
});
async function fileStaged(f) {
  await f.registry.dispatch(fileDispatch(f));
  await f.registry.dispatch(fileDispatch(f, "publish"));
}
test("FILE closed admission rejects root/text/scope/protected/missing baselines before durable intent", async (t) => {
  const f = await workspaceFileStorageFixture(t, {}, false);
  const before = await fs.readFile(join(f.directory, "journal.jsonl"));
  const bad = [
    { ...f.input, fileTarget: undefined },
    { ...f.input, sessionId: "session" },
    { ...f.input, workspaceId: undefined },
    { ...f.input, text: "PRIVATE" },
    { ...f.input, fileTarget: { ...f.input.fileTarget, text: "PRIVATE" } },
    { ...f.input, fileTarget: { ...f.input.fileTarget, root: "/PRIVATE" } },
    {
      ...f.input,
      fileTarget: { ...f.input.fileTarget, expectation: "version" },
    },
    ...[
      "/PRIVATE/file",
      "../file",
      ".agents/helper.md",
      "AGENTS.md",
      ".env",
      "x\\y",
    ].map((path) => ({
      ...f.input,
      fileTarget: { ...f.input.fileTarget, path },
    })),
    ...["version", "directoryVersion"].map((key) => ({
      ...f.input,
      fileTarget: { ...f.input.fileTarget, [key]: undefined },
    })),
    { ...identity("other"), fileTarget: f.input.fileTarget },
  ];
  for (const input of bad)
    await assert.rejects(async () => f.registry.begin(input));
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    before,
  );
});
test("FILE closed dispatch rejects changed target/baseline, Native steps and erased stage proof before intent", async (t) => {
  const f = await workspaceFileStorageFixture(t);
  const before = await fs.readFile(join(f.directory, "journal.jsonl"));
  const bad = [
    { ...f.key, step: "filesystem.configuration.stage" },
    fileDispatch(f, "publish"),
    { ...fileDispatch(f), step: "native.send" },
    { ...fileDispatch(f), nativeSessionId: "native" },
    ...["path", "version", "directoryVersion"].map((key) =>
      fileDispatch(f, "stage", {
        ...f.input.fileTarget,
        [key]: key === "path" ? "other.txt" : "e".repeat(64),
      }),
    ),
    fileDispatch(f, "stage", { ...f.input.fileTarget, stageToken: undefined }),
  ];
  for (const input of bad)
    await assert.rejects(async () => f.registry.dispatch(input));
  await assert.rejects(f.registry.reserve(f.key));
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    before,
  );
  await f.registry.dispatch(fileDispatch(f));
  assert.equal(
    (await f.registry.dispatch(fileDispatch(f))).status,
    "duplicate",
  );
  await assert.rejects(
    f.registry.dispatch(
      fileDispatch(f, "stage", { ...f.input.fileTarget, path: "other.txt" }),
    ),
    { code: "DUPLICATE_CONFLICT" },
  );
});
test("FILE completion rejects forged path/digest/key backup, delta and missing stage; confirmed checkpoint remains exact", async (t) => {
  const f = await workspaceFileStorageFixture(t);
  await assert.rejects(
    f.registry.complete({ ...f.key, receipt: f.confirmed, delta: f.empty }),
  );
  await f.registry.dispatch(fileDispatch(f));
  await assert.rejects(
    f.registry.complete({ ...f.key, receipt: f.confirmed, delta: f.empty }),
  );
  await f.registry.dispatch(fileDispatch(f, "publish"));
  const before = await fs.readFile(join(f.directory, "journal.jsonl"));
  const badResults = [
    { ...f.confirmed.result, path: "other.txt" },
    { ...f.confirmed.result, digest: "f".repeat(64) },
    { ...f.confirmed.result, workspaceId: "other" },
    {
      ...f.confirmed.result,
      backupId: f.confirmed.result.backupId.replace(".file.", ".skill."),
    },
    { ...f.confirmed.result, backupId: undefined },
    { ...f.confirmed.result, text: undefined },
  ];
  for (const result of badResults)
    await assert.rejects(async () =>
      f.registry.complete({
        ...f.key,
        receipt: { ...f.confirmed, result },
        delta: f.empty,
      }),
    );
  await assert.rejects(
    f.registry.complete({
      ...f.key,
      receipt: f.confirmed,
      delta: {
        ...f.empty,
        tombstones: [{ kind: "workspace", id: f.input.workspaceId }],
      },
    }),
  );
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    before,
  );
  const completed = await f.registry.complete({
    ...f.key,
    receipt: f.confirmed,
    delta: f.empty,
  });
  assert.deepEqual(completed.receipt.result, f.confirmed.result);
  assert.equal(
    (
      await f.registry.complete({
        ...f.key,
        receipt: f.confirmed,
        delta: f.empty,
      })
    ).status,
    "duplicate",
  );
  await f.registry.checkpoint();
  const next = await reopened(t, f);
  assert.equal(next.status().state, "ready");
  assert.deepEqual(next.lookup(f.key).receipt.result, f.confirmed.result);
  assert.equal((await next.begin(f.input)).status, "duplicate");
  await assert.rejects(next.begin({ ...f.input, digest: "f".repeat(64) }), {
    code: "DUPLICATE_CONFLICT",
  });
});
for (const fails of [false, true])
  test(`FILE completion flush ${fails ? "failure" : "pause"} exposes only prior unknown`, async (t) => {
    let pause = false,
      entered = false;
    const held = deferred();
    const f = await workspaceFileStorageFixture(t, {
      syncFile: async (file, context) => {
        if (pause && context === "append:completion") {
          entered = true;
          await held.promise;
          if (fails) throw new Error("injected");
        }
        await file.sync();
      },
    });
    await fileStaged(f);
    pause = true;
    const pending = f.registry.complete({
      ...f.key,
      receipt: f.confirmed,
      delta: f.empty,
    });
    const settled = pending.then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    await until(() => entered, held.resolve);
    assert.equal(f.registry.lookup(f.key).receipt.effect, "unknown");
    assert.equal(f.registry.lookup(f.key).receipt.result, undefined);
    held.resolve();
    const result = await settled;
    if (fails) {
      assert.equal(result.error.code, "writer_poisoned");
      assert.equal(f.registry.lookup(f.key).receipt.effect, "unknown");
      assert.equal(f.registry.lookup(f.key).receipt.result, undefined);
    } else assert.deepEqual(result.value.receipt.result, f.confirmed.result);
  });
for (const corruption of [
  "marker",
  "admission-path",
  "admission-version",
  "stage-target",
  "result-path",
  "result-digest",
  "backup",
  "publish-only",
])
  test(`FILE actual replay refuses ${corruption} and preserves bytes`, async (t) => {
    const f = await workspaceFileStorageFixture(t);
    await fileStaged(f);
    await f.registry.complete({
      ...f.key,
      receipt: f.confirmed,
      delta: f.empty,
    });
    await f.registry.close();
    await rewriteInstructionHistory(f, (payloads) => {
      const admission = payloads.find((p) => p.identity?.type === "file.save");
      const stage = payloads.find(
        (p) =>
          p.operationId === f.key.operationId &&
          p.step === "filesystem.configuration.stage",
      );
      const completion = payloads.find(
        (p) => p.operationId === f.key.operationId && p.kind === "completion",
      );
      if (corruption === "marker")
        return payloads.filter((p) => p.feature !== "workspace_file_save_v1");
      if (corruption === "admission-path")
        admission.fileTarget.path = "other.txt";
      if (corruption === "admission-version")
        admission.fileTarget.version = "f".repeat(64);
      if (corruption === "stage-target")
        stage.fileTarget.directoryVersion = "f".repeat(64);
      if (corruption === "result-path")
        completion.receipt.result.path = "other.txt";
      if (corruption === "result-digest")
        completion.receipt.result.digest = "f".repeat(64);
      if (corruption === "backup")
        completion.receipt.result.backupId =
          completion.receipt.result.backupId.replace(".file.", ".agent.");
      if (corruption === "publish-only")
        stage.step = "filesystem.configuration.publish";
      return payloads;
    });
    const before = await fs.readFile(join(f.directory, "journal.jsonl"));
    const next = await openWorkspaceRegistry({
      ...f.options,
      runtimeEpoch: "new",
    });
    t.after(() => next.close());
    assert.equal(next.status().state, "recovery_required");
    assert.notEqual(next.lookup(f.key).receipt?.effect, "confirmed");
    await assert.rejects(async () => next.begin(f.input));
    assert.deepEqual(
      await fs.readFile(join(f.directory, "journal.jsonl")),
      before,
    );
  });

for (const fails of [false, true])
  test(`FILE feature flush ${fails ? "failure" : "pause"} precedes admission and all dispatch`, async (t) => {
    let entered = false;
    const held = deferred();
    const f = await workspaceFileStorageFixture(
      t,
      {
        syncFile: async (file, context) => {
          if (context === "append:feature_gate") {
            entered = true;
            await held.promise;
            if (fails) throw new Error("injected");
          }
          await file.sync();
        },
      },
      false,
    );
    const pending = f.registry.begin(f.input);
    const settled = pending.then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    await until(() => entered, held.resolve);
    assert.equal(f.registry.lookup(f.key).status, "missing");
    const bytes = await fs.readFile(join(f.directory, "journal.jsonl"), "utf8");
    assert.equal(bytes.includes('"type":"file.save"'), false);
    held.resolve();
    const result = await settled;
    if (fails) {
      assert.equal(result.error.code, "writer_poisoned");
      assert.equal(f.registry.lookup(f.key).status, "missing");
      await assert.rejects(f.registry.dispatch(fileDispatch(f)));
    } else assert.equal(result.value.status, "admitted");
  });
test("FILE admission and dispatch retain detached target values across queued writes", async (t) => {
  const f = await workspaceFileStorageFixture(t, {}, false);
  const expected = globalThis.structuredClone(f.input);
  const pending = f.registry.begin(f.input);
  f.input.fileTarget.path = "other.txt";
  await pending;
  const staged = {
    ...f.key,
    step: "filesystem.configuration.stage",
    fileTarget: { ...expected.fileTarget },
  };
  const dispatching = f.registry.dispatch(staged);
  staged.fileTarget.path = "other.txt";
  await dispatching;
  const payloads = (
    await fs.readFile(join(f.directory, "journal.jsonl"), "utf8")
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line).payload);
  assert.deepEqual(
    payloads.find((p) => p.identity?.type === "file.save").fileTarget,
    expected.fileTarget,
  );
  assert.deepEqual(
    payloads.find(
      (p) => p.operationId === f.key.operationId && p.kind === "dispatch",
    ).fileTarget,
    expected.fileTarget,
  );
  assert.equal((await f.registry.begin(expected)).status, "duplicate");
});

import { createHostAdmission, currentScope } from "./workbench-admission.mjs";
import { redactReceipt } from "./workbench-receipts.mjs";
test("FILE actual admission correlates exact canonical original operation digest, duplicate/conflict and byte-free retention", async (t) => {
  const f = await workspaceFileStorageFixture(t, {}, false);
  let executed = 0;
  const held = deferred();
  const original = {
    type: "file.save",
    requestId: "save-admission",
    workspaceId: f.input.workspaceId,
    ...f.input.fileTarget,
    expectation: "version",
    text: "PRIVATE exact\r\n\ufeffbody",
  };
  const expected = globalThis.structuredClone(original);
  const host = createHostAdmission({
    runtimeEpoch: "current",
    registry: () => f.registry,
    revision: () => f.registry.status().revision,
    ready: () => held.promise,
    deadlineMs: 2000,
    execute: async (operation) => {
      executed++;
      assert.deepEqual(operation, expected);
      const record = currentScope().record;
      assert.deepEqual(record.fileTarget, f.input.fileTarget);
      throw Object.assign(new Error("denied"), { appCode: "FILE_DENIED" });
    },
    projectReceipt: () => {},
  });
  t.after(async () => {
    held.resolve();
    await host.drain();
    host.close();
  });
  const envelope = {
    version: 2,
    runtimeEpoch: "current",
    operationId: original.requestId,
    operation: original,
  };
  const result = host.handle(envelope, "sender");
  original.text = "CHANGED AFTER HANDLE";
  const key = { runtimeEpoch: "current", operationId: expected.requestId };
  await until(() => f.registry.lookup(key).status === "found", held.resolve);
  const canonical = { ...expected, expectedRevision: null };
  const digest = createHash("sha256")
    .update(
      JSON.stringify(
        Object.keys(canonical)
          .sort()
          .map((k) => [k, canonical[k]]),
      ),
    )
    .digest("hex");
  assert.equal(f.registry.lookupIdentity(key).digest, digest);
  assert.equal(
    (await host.handle({ ...envelope, operation: expected }, "sender")).value
      .status,
    "duplicate",
  );
  for (const change of [
    { text: "different" },
    { path: "other.txt" },
    { version: "f".repeat(64) },
    { directoryVersion: "f".repeat(64) },
  ]) {
    assert.equal(
      (
        await host.handle(
          { ...envelope, operation: { ...expected, ...change } },
          "sender",
        )
      ).code,
      "DUPLICATE_CONFLICT",
    );
  }
  assert.equal(executed, 0);
  assert.equal(
    JSON.stringify(f.registry.readView().retainedOperations).includes(
      "PRIVATE",
    ),
    false,
  );
  assert.equal(
    (await fs.readFile(join(f.directory, "journal.jsonl"), "utf8")).includes(
      "PRIVATE",
    ),
    false,
  );
  held.resolve();
  assert.equal((await result).code, "FILE_DENIED");
  assert.equal(f.registry.lookup(key).receipt.effect, "none");
  assert.equal(f.registry.lookup(key).receipt.result.code, "FILE_DENIED");
  assert.equal(executed, 1);
});
test("FILE actual admission projects confirmed result only after correlated durable stage and completion", async (t) => {
  const f = await workspaceFileStorageFixture(t, {}, false);
  const requestId = "save-confirmed";
  const host = createHostAdmission({
    runtimeEpoch: "current",
    registry: () => f.registry,
    revision: () => f.registry.status().revision,
    ready: () => Promise.resolve(),
    execute: async () => {
      const owner = currentScope(),
        record = owner.record;
      for (const step of ["stage", "publish"]) {
        await f.registry.dispatch({
          runtimeEpoch: record.runtimeEpoch,
          operationId: record.operationId,
          step: `filesystem.configuration.${step}`,
          fileTarget: record.fileTarget,
        });
        owner.markEffect();
      }
      return { ok: true, value: { status: "saved" } };
    },
    projectReceipt: async (record) => {
      record.delivery = "accepted";
      record.effect = "confirmed";
      record.result = {
        ...f.confirmed.result,
        digest: record.digest,
        backupId: `.omoc-configuration-${createHash("sha256")
          .update(JSON.stringify([record.runtimeEpoch, record.operationId]))
          .digest("hex")}.file.backup`,
      };
      const completed = await f.registry.complete({
        runtimeEpoch: record.runtimeEpoch,
        operationId: record.operationId,
        receipt: redactReceipt(record),
        delta: f.empty,
      });
      Object.assign(record, completed.receipt);
    },
  });
  t.after(async () => {
    await host.drain();
    host.close();
  });
  const result = await host.handle(
    {
      version: 2,
      runtimeEpoch: "current",
      operationId: requestId,
      operation: {
        type: "file.save",
        requestId,
        workspaceId: f.input.workspaceId,
        ...f.input.fileTarget,
        expectation: "version",
        text: "PRIVATE",
      },
    },
    "sender",
  );
  assert.equal(result.ok, true);
  assert.equal(result.receipt.effect, "confirmed");
  assert.equal(result.receipt.result.kind, "file_saved");
  assert.equal(
    result.receipt.result.digest,
    f.registry.lookupIdentity({
      runtimeEpoch: "current",
      operationId: requestId,
    }).digest,
  );
  assert.equal(result.receipt.result.path, f.input.fileTarget.path);
  assert.equal(JSON.stringify(result.receipt).includes("PRIVATE"), false);
});

const indexStorageTarget = (indexExists = true) => ({
  action: "stage",
  paths: ["src/example.txt"],
  previewDigest: "b".repeat(64),
  headOid: null,
  indexExists,
  indexDigest: indexExists
    ? "c".repeat(64)
    : "1e805e1eec918accfc6bba36e68b1a5f77c81ec7f1a7a90ed99b688b7b141eae",
  nextIndexDigest: "d".repeat(64),
  objectFormat: "sha1",
});
async function indexStorageFixture(t, io = {}, begin = true, exists = true) {
  const f = await fixture(t, io);
  const { workspace } = await createManagedWorkspaceOnly(f);
  const input = {
    ...identity("index-apply", {
      type: "git.index.apply",
      workspaceId: workspace.workspaceId,
    }),
    gitIndexTarget: indexStorageTarget(exists),
    expectedRevision: f.registry.status().revision,
  };
  const key = admittedKey(input);
  const backupId = exists
    ? `.omoc-git-index-${createHash("sha256")
        .update(JSON.stringify([key.runtimeEpoch, key.operationId]))
        .digest("hex")}.backup`
    : null;
  const confirmed = receipt(key.operationId, {
    type: input.type,
    workspaceId: input.workspaceId,
    result: {
      kind: "git_index_updated",
      workspaceId: input.workspaceId,
      action: input.gitIndexTarget.action,
      paths: [...input.gitIndexTarget.paths],
      indexDigest: input.gitIndexTarget.nextIndexDigest,
      previewDigest: input.gitIndexTarget.previewDigest,
      digest: input.digest,
      backupId,
    },
  });
  if (begin) assert.equal((await f.registry.begin(input)).status, "admitted");
  return {
    ...f,
    input,
    key,
    confirmed,
    empty: { workspaces: [], sessions: [], tombstones: [] },
  };
}
const indexDispatch = (
  f,
  phase = "stage",
  target = f.input.gitIndexTarget,
) => ({
  ...f.key,
  step: `filesystem.git.index.${phase}`,
  gitIndexTarget: target,
});
test("GI marker flush precedes closed immutable admission; lookup hides target", async (t) => {
  const f = await indexStorageFixture(t);
  const payloads = (
    await fs.readFile(join(f.directory, "journal.jsonl"), "utf8")
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line).payload);
  const i = payloads.findIndex((p) => p.identity?.type === "git.index.apply");
  assert.equal(payloads[i - 1].feature, "git_index_mutation_v1");
  assert.deepEqual(payloads[i].gitIndexTarget, f.input.gitIndexTarget);
  assert.equal(f.registry.lookup(f.key).receipt.gitIndexTarget, undefined);
  assert.equal(f.registry.status().revision, f.input.expectedRevision + 2);
});

test("GI exact steps, immutable target, empty delta and independent result authority", async (t) => {
  for (const exists of [true, false]) {
    const f = await indexStorageFixture(t, {}, true, exists);
    const before = await fs.readFile(join(f.directory, "journal.jsonl"));
    for (const request of [
      indexDispatch(f, "publish"),
      indexDispatch(f, "stage", {
        ...f.input.gitIndexTarget,
        nextIndexDigest: "f".repeat(64),
      }),
      { ...indexDispatch(f), nativeSessionId: "native" },
      { ...indexDispatch(f), fileTarget: workspaceFileTarget() },
      { ...f.key, step: "native.send" },
      { ...indexDispatch(f), step: "filesystem.configuration.stage" },
    ])
      await assert.rejects(async () => f.registry.dispatch(request));
    assert.deepEqual(
      await fs.readFile(join(f.directory, "journal.jsonl")),
      before,
    );
    await f.registry.dispatch(indexDispatch(f));
    await assert.rejects(f.registry.dispatch(indexDispatch(f)));
    await assert.rejects(
      f.registry.reserve({ ...f.key, ownership: "managed" }),
    );
    await f.registry.dispatch(indexDispatch(f, "publish"));
    await assert.rejects(f.registry.dispatch(indexDispatch(f, "publish")));
    const stagedBytes = await fs.readFile(join(f.directory, "journal.jsonl"));
    for (const patch of [
      { indexDigest: "f".repeat(64) },
      { previewDigest: "f".repeat(64) },
      { digest: "f".repeat(64) },
      { paths: ["other.txt"] },
      { action: "unstage" },
      { backupId: exists ? null : "forged" },
    ])
      await assert.rejects(async () =>
        f.registry.complete({
          ...f.key,
          receipt: {
            ...f.confirmed,
            result: { ...f.confirmed.result, ...patch },
          },
          delta: f.empty,
        }),
      );
    await assert.rejects(
      f.registry.complete({
        ...f.key,
        receipt: f.confirmed,
        delta: {
          ...f.empty,
          tombstones: [{ kind: "workspace", id: f.input.workspaceId }],
        },
      }),
    );
    assert.deepEqual(
      await fs.readFile(join(f.directory, "journal.jsonl")),
      stagedBytes,
    );
    assert.equal(
      (
        await f.registry.complete({
          ...f.key,
          receipt: f.confirmed,
          delta: f.empty,
        })
      ).receipt.effect,
      "confirmed",
    );
    assert.deepEqual(
      f.registry.lookup(f.key).receipt.result,
      f.confirmed.result,
    );
    assert.equal(
      (
        await f.registry.complete({
          ...f.key,
          receipt: f.confirmed,
          delta: f.empty,
        })
      ).status,
      "duplicate",
    );
    await f.registry.checkpoint();
    await f.registry.close();
    const reopened = await openWorkspaceRegistry({
      ...f.options,
      runtimeEpoch: "new",
    });
    t.after(() => reopened.close());
    assert.deepEqual(reopened.lookup(f.key).receipt.result, f.confirmed.result);
    assert.equal((await reopened.begin(f.input)).status, "duplicate");
    assert.equal(
      JSON.stringify(reopened.readView()).includes("gitIndexTarget"),
      false,
    );
  }
});
test("GI admission rejects nested descriptor loss before JSON copy and freezes caller paths", async (t) => {
  const f = await indexStorageFixture(t, {}, false);
  let calls = 0;
  const getter = { ...f.input.gitIndexTarget };
  Object.defineProperty(getter, "paths", {
    enumerable: true,
    get() {
      calls++;
      return ["secret"];
    },
  });
  const arrayGetter = { ...f.input.gitIndexTarget, paths: ["src/example.txt"] };
  Object.defineProperty(arrayGetter.paths, "0", {
    enumerable: true,
    get() {
      calls++;
      return "secret";
    },
  });
  for (const gitIndexTarget of [
    getter,
    arrayGetter,
    { ...f.input.gitIndexTarget, [Symbol("hidden")]: true },
    { ...f.input.gitIndexTarget, privateArtifact: undefined },
    {
      ...f.input.gitIndexTarget,
      paths: Object.assign(["src/example.txt"], { hidden: true }),
    },
  ])
    assert.throws(() => f.registry.begin({ ...f.input, gitIndexTarget }));
  assert.equal(calls, 0);
  for (const change of [
    { sessionId: "session" },
    { expectedRevision: undefined },
    { gitIndexTarget: undefined },
    { type: "file.save" },
  ])
    assert.throws(() => f.registry.begin({ ...f.input, ...change }));
  const expected = globalThis.structuredClone(f.input);
  const admission = f.registry.begin(f.input);
  f.input.gitIndexTarget.paths[0] = "other.txt";
  await admission;
  const dispatch = indexDispatch({ ...f, input: expected });
  const pending = f.registry.dispatch(dispatch);
  dispatch.gitIndexTarget.paths[0] = "mutated.txt";
  await pending;
  const payloads = (
    await fs.readFile(join(f.directory, "journal.jsonl"), "utf8")
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line).payload);
  assert.deepEqual(
    payloads.find((p) => p.identity?.type === "git.index.apply").gitIndexTarget
      .paths,
    ["src/example.txt"],
  );
  assert.deepEqual(payloads.at(-1).gitIndexTarget.paths, ["src/example.txt"]);
});
for (const mode of ["admitted", "stage", "publish", "unknown"])
  test(`GI reopened ${mode} stays retained and cannot dispatch or upgrade`, async (t) => {
    const f = await indexStorageFixture(t);
    if (mode !== "admitted") await f.registry.dispatch(indexDispatch(f));
    if (["publish", "unknown"].includes(mode))
      await f.registry.dispatch(indexDispatch(f, "publish"));
    if (mode === "unknown") {
      const unknown = {
        ...f.confirmed,
        delivery: "unknown",
        effect: "unknown",
      };
      delete unknown.result;
      await f.registry.complete({ ...f.key, receipt: unknown, delta: f.empty });
      await assert.rejects(
        f.registry.complete({ ...f.key, receipt: f.confirmed, delta: f.empty }),
      );
    }
    await f.registry.checkpoint();
    await f.registry.close();
    const reopened = await openWorkspaceRegistry({
      ...f.options,
      runtimeEpoch: "new",
    });
    t.after(() => reopened.close());
    assert.equal((await reopened.begin(f.input)).status, "duplicate");
    await assert.rejects(
      reopened.dispatch(
        indexDispatch(f, mode === "admitted" ? "stage" : "publish"),
      ),
    );
    await assert.rejects(
      reopened.complete({ ...f.key, receipt: f.confirmed, delta: f.empty }),
    );
    assert.ok(
      reopened
        .readView()
        .retainedOperations.some((k) => k.operationId === f.key.operationId),
    );
  });
for (const phase of ["feature_gate", "admission", "dispatch", "completion"])
  for (const fails of [false, true])
    test(`GI ${phase} flush ${fails ? "failure" : "pause"} keeps unpublished authority hidden`, async (t) => {
      const held = deferred();
      let entered = false,
        armed = false;
      const f = await indexStorageFixture(
        t,
        {
          syncFile: async (file, context) => {
            if (armed && context === `append:${phase}`) {
              entered = true;
              await held.promise;
              if (fails) throw new Error("synthetic GI flush failure");
            }
            await file.sync();
          },
        },
        false,
      );
      if (["dispatch", "completion"].includes(phase))
        await f.registry.begin(f.input);
      if (phase === "completion") {
        await f.registry.dispatch(indexDispatch(f));
        await f.registry.dispatch(indexDispatch(f, "publish"));
      }
      armed = true;
      const pending =
        phase === "completion"
          ? f.registry.complete({
              ...f.key,
              receipt: f.confirmed,
              delta: f.empty,
            })
          : phase === "dispatch"
            ? f.registry.dispatch(indexDispatch(f))
            : f.registry.begin(f.input);
      const settled = pending.then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
      await until(() => entered, held.resolve);
      const lookup = f.registry.lookup(f.key);
      if (["feature_gate", "admission"].includes(phase))
        assert.equal(lookup.status, "missing");
      else assert.notEqual(lookup.receipt.effect, "confirmed");
      held.resolve();
      const outcome = await settled;
      if (fails) {
        assert.equal(outcome.error.code, "writer_poisoned");
        assert.notEqual(f.registry.lookup(f.key).receipt?.effect, "confirmed");
        await assert.rejects(f.registry.dispatch(indexDispatch(f)));
      } else assert.ok(outcome.value);
    });
test("GI host binds requestId, required revision and canonical original digest before execute", async (t) => {
  const f = await indexStorageFixture(t, {}, false);
  const held = deferred();
  let executed = 0;
  const op = {
    type: "git.index.apply",
    workspaceId: f.input.workspaceId,
    requestId: "host-index",
    previewId: "e".repeat(64),
    ...f.input.gitIndexTarget,
  };
  const host = createHostAdmission({
    runtimeEpoch: "current",
    registry: () => f.registry,
    revision: () => f.registry.status().revision,
    ready: () => held.promise,
    deadlineMs: 2000,
    execute: async () => {
      executed++;
      assert.equal(currentScope().kind, "mutation");
      assert.deepEqual(
        currentScope().record.gitIndexTarget,
        f.input.gitIndexTarget,
      );
      throw Object.assign(new Error("denied"), { appCode: "FILE_DENIED" });
    },
    projectReceipt: () => {},
  });
  t.after(async () => {
    held.resolve();
    await host.drain();
    host.close();
  });
  const envelope = {
    version: 2,
    runtimeEpoch: "current",
    operationId: op.requestId,
    expectedRevision: f.input.expectedRevision,
    operation: op,
  };
  assert.equal(
    (await host.handle({ ...envelope, expectedRevision: undefined }, "sender"))
      .code,
    "INVALID_REQUEST",
  );
  assert.equal(
    (await host.handle({ ...envelope, operationId: "mismatch" }, "sender"))
      .code,
    "INVALID_REQUEST",
  );
  const pending = host.handle(envelope, "sender");
  const key = { runtimeEpoch: "current", operationId: op.requestId };
  await until(() => f.registry.lookup(key).status === "found", held.resolve);
  const canonical = { ...op, expectedRevision: envelope.expectedRevision };
  const digest = createHash("sha256")
    .update(
      JSON.stringify(
        Object.keys(canonical)
          .sort()
          .map((k) => [k, canonical[k]]),
      ),
    )
    .digest("hex");
  assert.equal(f.registry.lookupIdentity(key).digest, digest);
  assert.equal(
    (await host.handle(envelope, "sender")).value.status,
    "duplicate",
  );
  for (const patch of [
    { nextIndexDigest: "f".repeat(64) },
    { paths: ["other.txt"] },
    { previewDigest: "f".repeat(64) },
  ])
    assert.equal(
      (
        await host.handle(
          { ...envelope, operation: { ...op, ...patch } },
          "sender",
        )
      ).code,
      "DUPLICATE_CONFLICT",
    );
  assert.equal(
    (
      await host.handle(
        { ...envelope, expectedRevision: envelope.expectedRevision + 1 },
        "sender",
      )
    ).code,
    "DUPLICATE_CONFLICT",
  );
  assert.equal(executed, 0);
  held.resolve();
  assert.equal((await pending).code, "FILE_DENIED");
  assert.equal(executed, 1);
  assert.equal(
    JSON.stringify(f.registry.readView().retainedOperations).includes(
      "gitIndexTarget",
    ),
    false,
  );
});
test("GI preview read uses bounded files lane and no durable mutation", async (t) => {
  const f = await indexStorageFixture(t, {}, false);
  const scopes = [];
  const host = createHostAdmission({
    runtimeEpoch: "current",
    registry: () => f.registry,
    revision: () => f.registry.status().revision,
    ready: () => Promise.resolve(),
    execute: async () => {
      scopes.push(currentScope().kind);
      return { ok: true, value: {} };
    },
    projectReceipt: () => {},
  });
  t.after(() => host.close());
  await host.handle(
    {
      version: 2,
      runtimeEpoch: "current",
      readId: "preview-read",
      operation: {
        type: "git.index.preview.read",
        workspaceId: f.input.workspaceId,
        observationId: "a".repeat(64),
        action: "stage",
        paths: ["src/example.txt"],
      },
    },
    "sender",
  );
  assert.deepEqual(scopes, ["files"]);
  assert.equal(f.registry.lookup(f.key).status, "missing");
});
for (const phase of ["admission", "dispatch", "completion"])
  test(`GI surviving unconfirmed ${phase} tail cannot mint publication authority`, async (t) => {
    let armed = false;
    const f = await indexStorageFixture(
      t,
      {
        syncFile: async (file, context) => {
          if (armed && context === `append:${phase}`)
            throw new Error("synthetic unconfirmed tail");
          await file.sync();
        },
      },
      false,
    );
    if (phase !== "admission") await f.registry.begin(f.input);
    if (phase === "completion") {
      await f.registry.dispatch(indexDispatch(f));
      await f.registry.dispatch(indexDispatch(f, "publish"));
    }
    await f.registry.checkpoint();
    armed = true;
    await assert.rejects(
      phase === "admission"
        ? f.registry.begin(f.input)
        : phase === "dispatch"
          ? f.registry.dispatch(indexDispatch(f))
          : f.registry.complete({
              ...f.key,
              receipt: f.confirmed,
              delta: f.empty,
            }),
      { code: "writer_poisoned" },
    );
    await f.registry.close();
    const before = await fs.readFile(join(f.directory, "journal.jsonl"));
    const reopened = await openWorkspaceRegistry({
      ...f.options,
      io: {},
      runtimeEpoch: "new",
    });
    t.after(() => reopened.close());
    assert.equal(reopened.status().state, "recovery_required");
    assert.notEqual(reopened.lookup(f.key).receipt?.effect, "confirmed");
    await assert.rejects(reopened.dispatch(indexDispatch(f)));
    await assert.rejects(
      reopened.complete({ ...f.key, receipt: f.confirmed, delta: f.empty }),
    );
    assert.deepEqual(
      await fs.readFile(join(f.directory, "journal.jsonl")),
      before,
    );
  });
for (const corruption of [
  "marker",
  "target-next",
  "step-target",
  "result-next",
  "digest",
  "backup",
  "absence",
  "publish-only",
])
  test(`GI actual parser replay rejects ${corruption} without writes`, async (t) => {
    const f = await indexStorageFixture(t);
    await f.registry.dispatch(indexDispatch(f));
    await f.registry.dispatch(indexDispatch(f, "publish"));
    await f.registry.complete({
      ...f.key,
      receipt: f.confirmed,
      delta: f.empty,
    });
    await f.registry.close();
    await rewriteInstructionHistory(f, (payloads) => {
      const admission = payloads.find(
        (p) => p.identity?.type === "git.index.apply",
      );
      const stage = payloads.find(
        (p) =>
          p.operationId === f.key.operationId &&
          p.step === "filesystem.git.index.stage",
      );
      const completion = payloads.find(
        (p) => p.operationId === f.key.operationId && p.kind === "completion",
      );
      if (corruption === "marker")
        return payloads.filter((p) => p.feature !== "git_index_mutation_v1");
      if (corruption === "target-next")
        admission.gitIndexTarget.nextIndexDigest = "f".repeat(64);
      if (corruption === "step-target")
        stage.gitIndexTarget.paths = ["other.txt"];
      if (corruption === "result-next")
        completion.receipt.result.indexDigest = "f".repeat(64);
      if (corruption === "digest")
        completion.receipt.result.digest = "f".repeat(64);
      if (corruption === "backup")
        completion.receipt.result.backupId = `.omoc-git-index-${"f".repeat(64)}.backup`;
      if (corruption === "absence")
        admission.gitIndexTarget.indexExists = false;
      if (corruption === "publish-only")
        stage.step = "filesystem.git.index.publish";
      return payloads;
    });
    const before = await fs.readFile(join(f.directory, "journal.jsonl"));
    const reopened = await openWorkspaceRegistry({
      ...f.options,
      runtimeEpoch: "new",
    });
    t.after(() => reopened.close());
    assert.equal(reopened.status().state, "recovery_required");
    assert.notEqual(reopened.lookup(f.key).receipt?.effect, "confirmed");
    assert.deepEqual(
      await fs.readFile(join(f.directory, "journal.jsonl")),
      before,
    );
  });
test("GI receipt type descriptor refuses accessor before branching or copying", async (t) => {
  const f = await indexStorageFixture(t);
  let calls = 0;
  const bad = { ...f.confirmed };
  Object.defineProperty(bad, "type", {
    enumerable: true,
    get() {
      calls++;
      return "git.index.apply";
    },
  });
  assert.throws(() =>
    f.registry.complete({ ...f.key, receipt: bad, delta: f.empty }),
  );
  assert.equal(calls, 0);
});
test("GI host confirms only durable exact original result and clears speculative result on completion failure", async (t) => {
  for (const fails of [false, true]) {
    let armed = false;
    const f = await indexStorageFixture(
      t,
      {
        syncFile: async (file, context) => {
          if (armed && fails && context === "append:completion")
            throw new Error("synthetic confirmation failure");
          await file.sync();
        },
      },
      false,
    );
    armed = true;
    const requestId = "confirmed-index";
    const host = createHostAdmission({
      runtimeEpoch: "current",
      registry: () => f.registry,
      revision: () => f.registry.status().revision,
      ready: () => Promise.resolve(),
      execute: async () => {
        const owner = currentScope(),
          record = owner.record;
        for (const step of ["stage", "publish"]) {
          await f.registry.dispatch({
            runtimeEpoch: record.runtimeEpoch,
            operationId: record.operationId,
            step: `filesystem.git.index.${step}`,
            gitIndexTarget: record.gitIndexTarget,
          });
          owner.markEffect();
        }
        return {
          ok: true,
          value: {
            requestId,
            status: "applied",
            indexDigest: record.gitIndexTarget.nextIndexDigest,
            backupId: `.omoc-git-index-${createHash("sha256")
              .update(JSON.stringify([record.runtimeEpoch, record.operationId]))
              .digest("hex")}.backup`,
          },
        };
      },
      projectReceipt: async (record, _operation, result) => {
        record.effect = "confirmed";
        record.delivery = "accepted";
        record.result = {
          ...f.confirmed.result,
          digest: record.digest,
          backupId: result.value.backupId,
        };
        const durable = await f.registry.complete({
          runtimeEpoch: record.runtimeEpoch,
          operationId: record.operationId,
          receipt: redactReceipt(record),
          delta: f.empty,
        });
        Object.assign(record, durable.receipt);
      },
    });
    t.after(async () => {
      await host.drain();
      host.close();
    });
    const response = await host.handle(
      {
        version: 2,
        runtimeEpoch: "current",
        operationId: requestId,
        expectedRevision: f.input.expectedRevision,
        operation: {
          type: "git.index.apply",
          requestId,
          workspaceId: f.input.workspaceId,
          previewId: "e".repeat(64),
          ...f.input.gitIndexTarget,
        },
      },
      "sender",
    );
    if (fails) {
      assert.equal(response.code, "UNAVAILABLE");
      assert.equal(response.receipt.effect, "unknown");
      assert.equal(response.receipt.result, undefined);
    } else {
      assert.equal(response.ok, true);
      assert.equal(response.receipt.effect, "confirmed");
      assert.equal(
        response.receipt.result.digest,
        f.registry.lookupIdentity({
          runtimeEpoch: "current",
          operationId: requestId,
        }).digest,
      );
      assert.equal(
        response.receipt.result.indexDigest,
        f.input.gitIndexTarget.nextIndexDigest,
      );
    }
  }
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
async function commitStorageFixture(t, io = {}, begin = true, exists = true) {
  const f = await fixture(t, io);
  const { workspace } = await createManagedWorkspaceOnly(f);
  const input = {
    ...identity("commit-apply", {
      type: "git.commit.apply",
      workspaceId: workspace.workspaceId,
    }),
    gitCommitTarget: commitStorageTarget(exists),
    expectedRevision: f.registry.status().revision,
  };
  const key = admittedKey(input);
  const confirmed = receipt(key.operationId, {
    type: input.type,
    workspaceId: input.workspaceId,
    result: {
      kind: "git_commit_created",
      workspaceId: input.workspaceId,
      commitOid: input.gitCommitTarget.commitOid,
      treeOid: input.gitCommitTarget.treeOid,
      parentOid: input.gitCommitTarget.headOid,
      referenceDigest: input.gitCommitTarget.reference.nextDigest,
      logDigests: input.gitCommitTarget.logs.map((x) => ({
        role: x.role,
        digest: x.nextDigest,
      })),
      previewDigest: input.gitCommitTarget.previewDigest,
      digest: input.digest,
      backups: gitCommitExpectedBackups(
        input.gitCommitTarget,
        key.runtimeEpoch,
        key.operationId,
      ),
    },
  });
  if (begin) assert.equal((await f.registry.begin(input)).status, "admitted");
  return {
    ...f,
    input,
    key,
    confirmed,
    empty: { workspaces: [], sessions: [], tombstones: [] },
  };
}
const commitDispatch = (
  f,
  phase = "stage",
  target = f.input.gitCommitTarget,
) => ({
  ...f.key,
  step: `filesystem.git.commit.${phase}`,
  gitCommitTarget: target,
});
test("GC marker flush precedes closed immutable admission; lookup hides target", async (t) => {
  const f = await commitStorageFixture(t);
  const payloads = (
    await fs.readFile(join(f.directory, "journal.jsonl"), "utf8")
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line).payload);
  const i = payloads.findIndex((p) => p.identity?.type === "git.commit.apply");
  assert.equal(payloads[i - 1].feature, "git_commit_mutation_v1");
  assert.deepEqual(payloads[i].gitCommitTarget, f.input.gitCommitTarget);
  assert.equal(f.registry.lookup(f.key).receipt.gitCommitTarget, undefined);
  assert.equal(f.registry.status().revision, f.input.expectedRevision + 2);
});

test("GC exact steps, immutable target, empty delta and independent result authority", async (t) => {
  for (const exists of [true, false]) {
    const f = await commitStorageFixture(t, {}, true, exists);
    const before = await fs.readFile(join(f.directory, "journal.jsonl"));
    for (const request of [
      commitDispatch(f, "publish"),
      commitDispatch(f, "stage", {
        ...f.input.gitCommitTarget,
        commitOid: "f".repeat(40),
      }),
      { ...commitDispatch(f), nativeSessionId: "native" },
      { ...commitDispatch(f), fileTarget: workspaceFileTarget() },
      { ...f.key, step: "native.send" },
      { ...commitDispatch(f), step: "filesystem.configuration.stage" },
    ])
      await assert.rejects(async () => f.registry.dispatch(request));
    assert.deepEqual(
      await fs.readFile(join(f.directory, "journal.jsonl")),
      before,
    );
    await f.registry.dispatch(commitDispatch(f));
    await assert.rejects(f.registry.dispatch(commitDispatch(f)));
    await assert.rejects(
      f.registry.reserve({ ...f.key, ownership: "managed" }),
    );
    await f.registry.dispatch(commitDispatch(f, "publish"));
    await assert.rejects(f.registry.dispatch(commitDispatch(f, "publish")));
    const stagedBytes = await fs.readFile(join(f.directory, "journal.jsonl"));
    for (const patch of [
      { referenceDigest: "a".repeat(64) },
      { previewDigest: "f".repeat(64) },
      { digest: "f".repeat(64) },
      { treeOid: "f".repeat(40) },
      { parentOid: null },
      { backups: [{ role: "branch_ref", backupId: null }] },
    ])
      await assert.rejects(async () =>
        f.registry.complete({
          ...f.key,
          receipt: {
            ...f.confirmed,
            result: { ...f.confirmed.result, ...patch },
          },
          delta: f.empty,
        }),
      );
    await assert.rejects(
      f.registry.complete({
        ...f.key,
        receipt: f.confirmed,
        delta: {
          ...f.empty,
          tombstones: [{ kind: "workspace", id: f.input.workspaceId }],
        },
      }),
    );
    assert.deepEqual(
      await fs.readFile(join(f.directory, "journal.jsonl")),
      stagedBytes,
    );
    assert.equal(
      (
        await f.registry.complete({
          ...f.key,
          receipt: f.confirmed,
          delta: f.empty,
        })
      ).receipt.effect,
      "confirmed",
    );
    assert.deepEqual(
      f.registry.lookup(f.key).receipt.result,
      f.confirmed.result,
    );
    assert.equal(
      (
        await f.registry.complete({
          ...f.key,
          receipt: f.confirmed,
          delta: f.empty,
        })
      ).status,
      "duplicate",
    );
    await f.registry.checkpoint();
    await f.registry.close();
    const reopened = await openWorkspaceRegistry({
      ...f.options,
      runtimeEpoch: "new",
    });
    t.after(() => reopened.close());
    assert.deepEqual(reopened.lookup(f.key).receipt.result, f.confirmed.result);
    assert.equal((await reopened.begin(f.input)).status, "duplicate");
    assert.equal(
      JSON.stringify(reopened.readView()).includes("gitCommitTarget"),
      false,
    );
  }
});
test("GC admission rejects nested descriptor loss before JSON copy and freezes caller paths", async (t) => {
  const f = await commitStorageFixture(t, {}, false);
  let calls = 0;
  const getter = commitStorageTarget();
  Object.defineProperty(getter.reference, "digest", {
    enumerable: true,
    get() {
      calls++;
      return "a".repeat(64);
    },
  });
  const arrayGetter = commitStorageTarget();
  Object.defineProperty(arrayGetter.logs, "0", {
    enumerable: true,
    get() {
      calls++;
      return {};
    },
  });
  for (const gitCommitTarget of [
    getter,
    arrayGetter,
    { ...commitStorageTarget(), [Symbol("hidden")]: true },
    { ...commitStorageTarget(), privateArtifact: undefined },
    {
      ...commitStorageTarget(),
      reference: { ...commitStorageTarget().reference, hidden: undefined },
    },
    { ...commitStorageTarget(), logs: Object.assign([], { hidden: true }) },
  ])
    assert.throws(() => f.registry.begin({ ...f.input, gitCommitTarget }));
  assert.equal(calls, 0);
  for (const change of [
    { sessionId: "session" },
    { expectedRevision: undefined },
    { gitCommitTarget: undefined },
    { type: "file.save" },
  ])
    assert.throws(() => f.registry.begin({ ...f.input, ...change }));
  const expected = globalThis.structuredClone(f.input);
  const admission = f.registry.begin(f.input);
  f.input.gitCommitTarget.reference.name = "refs/heads/other";
  await admission;
  const dispatch = commitDispatch({ ...f, input: expected });
  const pending = f.registry.dispatch(dispatch);
  dispatch.gitCommitTarget.logs[0].nextDigest = "0".repeat(64);
  await pending;
  const payloads = (
    await fs.readFile(join(f.directory, "journal.jsonl"), "utf8")
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line).payload);
  assert.deepEqual(
    payloads.find((p) => p.identity?.type === "git.commit.apply")
      .gitCommitTarget.reference.name,
    "refs/heads/main",
  );
  assert.deepEqual(
    payloads.at(-1).gitCommitTarget.logs[0].nextDigest,
    "9".repeat(64),
  );
});
for (const mode of ["admitted", "stage", "publish", "unknown"])
  test(`GC reopened ${mode} stays retained and cannot dispatch or upgrade`, async (t) => {
    const f = await commitStorageFixture(t);
    if (mode !== "admitted") await f.registry.dispatch(commitDispatch(f));
    if (["publish", "unknown"].includes(mode))
      await f.registry.dispatch(commitDispatch(f, "publish"));
    if (mode === "unknown") {
      const unknown = {
        ...f.confirmed,
        delivery: "unknown",
        effect: "unknown",
      };
      delete unknown.result;
      await f.registry.complete({ ...f.key, receipt: unknown, delta: f.empty });
      await assert.rejects(
        f.registry.complete({ ...f.key, receipt: f.confirmed, delta: f.empty }),
      );
    }
    await f.registry.checkpoint();
    await f.registry.close();
    const reopened = await openWorkspaceRegistry({
      ...f.options,
      runtimeEpoch: "new",
    });
    t.after(() => reopened.close());
    assert.equal((await reopened.begin(f.input)).status, "duplicate");
    await assert.rejects(
      reopened.dispatch(
        commitDispatch(f, mode === "admitted" ? "stage" : "publish"),
      ),
    );
    await assert.rejects(
      reopened.complete({ ...f.key, receipt: f.confirmed, delta: f.empty }),
    );
    assert.ok(
      reopened
        .readView()
        .retainedOperations.some((k) => k.operationId === f.key.operationId),
    );
  });
for (const phase of ["feature_gate", "admission", "dispatch", "completion"])
  for (const fails of [false, true])
    test(`GC ${phase} flush ${fails ? "failure" : "pause"} keeps unpublished authority hidden`, async (t) => {
      const held = deferred();
      let entered = false,
        armed = false;
      const f = await commitStorageFixture(
        t,
        {
          syncFile: async (file, context) => {
            if (armed && context === `append:${phase}`) {
              entered = true;
              await held.promise;
              if (fails) throw new Error("synthetic GC flush failure");
            }
            await file.sync();
          },
        },
        false,
      );
      if (["dispatch", "completion"].includes(phase))
        await f.registry.begin(f.input);
      if (phase === "completion") {
        await f.registry.dispatch(commitDispatch(f));
        await f.registry.dispatch(commitDispatch(f, "publish"));
      }
      armed = true;
      const pending =
        phase === "completion"
          ? f.registry.complete({
              ...f.key,
              receipt: f.confirmed,
              delta: f.empty,
            })
          : phase === "dispatch"
            ? f.registry.dispatch(commitDispatch(f))
            : f.registry.begin(f.input);
      const settled = pending.then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
      await until(() => entered, held.resolve);
      const lookup = f.registry.lookup(f.key);
      if (["feature_gate", "admission"].includes(phase))
        assert.equal(lookup.status, "missing");
      else assert.notEqual(lookup.receipt.effect, "confirmed");
      held.resolve();
      const outcome = await settled;
      if (fails) {
        assert.equal(outcome.error.code, "writer_poisoned");
        assert.notEqual(f.registry.lookup(f.key).receipt?.effect, "confirmed");
        await assert.rejects(f.registry.dispatch(commitDispatch(f)));
      } else assert.ok(outcome.value);
    });
test("GC host binds requestId, required revision and canonical original digest before execute", async (t) => {
  const f = await commitStorageFixture(t, {}, false);
  const held = deferred();
  let executed = 0;
  const op = {
    type: "git.commit.apply",
    workspaceId: f.input.workspaceId,
    requestId: "host-commit",
    previewId: "e".repeat(64),
    ...f.input.gitCommitTarget,
  };
  const host = createHostAdmission({
    runtimeEpoch: "current",
    registry: () => f.registry,
    revision: () => f.registry.status().revision,
    ready: () => held.promise,
    deadlineMs: 2000,
    execute: async () => {
      executed++;
      assert.equal(currentScope().kind, "mutation");
      assert.deepEqual(
        currentScope().record.gitCommitTarget,
        f.input.gitCommitTarget,
      );
      throw Object.assign(new Error("denied"), { appCode: "FILE_DENIED" });
    },
    projectReceipt: () => {},
  });
  t.after(async () => {
    held.resolve();
    await host.drain();
    host.close();
  });
  const envelope = {
    version: 2,
    runtimeEpoch: "current",
    operationId: op.requestId,
    expectedRevision: f.input.expectedRevision,
    operation: op,
  };
  assert.equal(
    (await host.handle({ ...envelope, expectedRevision: undefined }, "sender"))
      .code,
    "INVALID_REQUEST",
  );
  assert.equal(
    (await host.handle({ ...envelope, operationId: "mismatch" }, "sender"))
      .code,
    "INVALID_REQUEST",
  );
  const pending = host.handle(envelope, "sender");
  const key = { runtimeEpoch: "current", operationId: op.requestId };
  await until(() => f.registry.lookup(key).status === "found", held.resolve);
  const canonical = { ...op, expectedRevision: envelope.expectedRevision };
  const digest = createHash("sha256")
    .update(
      JSON.stringify(
        Object.keys(canonical)
          .sort()
          .map((k) => [k, canonical[k]]),
      ),
    )
    .digest("hex");
  assert.equal(f.registry.lookupIdentity(key).digest, digest);
  assert.equal(
    (await host.handle(envelope, "sender")).value.status,
    "duplicate",
  );
  for (const patch of [
    { commitOid: "f".repeat(40) },
    { treeOid: "f".repeat(40) },
    { previewDigest: "f".repeat(64) },
  ])
    assert.equal(
      (
        await host.handle(
          { ...envelope, operation: { ...op, ...patch } },
          "sender",
        )
      ).code,
      "DUPLICATE_CONFLICT",
    );
  assert.equal(
    (
      await host.handle(
        { ...envelope, expectedRevision: envelope.expectedRevision + 1 },
        "sender",
      )
    ).code,
    "DUPLICATE_CONFLICT",
  );
  assert.equal(executed, 0);
  held.resolve();
  assert.equal((await pending).code, "FILE_DENIED");
  assert.equal(executed, 1);
  assert.equal(
    JSON.stringify(f.registry.readView().retainedOperations).includes(
      "gitCommitTarget",
    ),
    false,
  );
});
test("GC preview read uses bounded files lane and no durable mutation", async (t) => {
  const f = await commitStorageFixture(t, {}, false);
  const scopes = [];
  const host = createHostAdmission({
    runtimeEpoch: "current",
    registry: () => f.registry,
    revision: () => f.registry.status().revision,
    ready: () => Promise.resolve(),
    execute: async () => {
      scopes.push(currentScope().kind);
      return { ok: true, value: {} };
    },
    projectReceipt: () => {},
  });
  t.after(() => host.close());
  await host.handle(
    {
      version: 2,
      runtimeEpoch: "current",
      readId: "preview-read",
      operation: {
        type: "git.commit.preview.read",
        workspaceId: f.input.workspaceId,
        observationId: "a".repeat(64),
        author: { name: "Example", email: "example@example.test" },
        message: "Synthetic",
      },
    },
    "sender",
  );
  assert.deepEqual(scopes, ["files"]);
  assert.equal(f.registry.lookup(f.key).status, "missing");
});
for (const phase of ["admission", "dispatch", "completion"])
  test(`GC surviving unconfirmed ${phase} tail cannot mint publication authority`, async (t) => {
    let armed = false;
    const f = await commitStorageFixture(
      t,
      {
        syncFile: async (file, context) => {
          if (armed && context === `append:${phase}`)
            throw new Error("synthetic unconfirmed tail");
          await file.sync();
        },
      },
      false,
    );
    if (phase !== "admission") await f.registry.begin(f.input);
    if (phase === "completion") {
      await f.registry.dispatch(commitDispatch(f));
      await f.registry.dispatch(commitDispatch(f, "publish"));
    }
    await f.registry.checkpoint();
    armed = true;
    await assert.rejects(
      phase === "admission"
        ? f.registry.begin(f.input)
        : phase === "dispatch"
          ? f.registry.dispatch(commitDispatch(f))
          : f.registry.complete({
              ...f.key,
              receipt: f.confirmed,
              delta: f.empty,
            }),
      { code: "writer_poisoned" },
    );
    await f.registry.close();
    const before = await fs.readFile(join(f.directory, "journal.jsonl"));
    const reopened = await openWorkspaceRegistry({
      ...f.options,
      io: {},
      runtimeEpoch: "new",
    });
    t.after(() => reopened.close());
    assert.equal(reopened.status().state, "recovery_required");
    assert.notEqual(reopened.lookup(f.key).receipt?.effect, "confirmed");
    await assert.rejects(reopened.dispatch(commitDispatch(f)));
    await assert.rejects(
      reopened.complete({ ...f.key, receipt: f.confirmed, delta: f.empty }),
    );
    assert.deepEqual(
      await fs.readFile(join(f.directory, "journal.jsonl")),
      before,
    );
  });

test("GC confirmed surviving tail cannot upgrade unknown through explicit adoption", async (t) => {
  const f = await commitStorageFixture(t);
  await f.registry.dispatch(commitDispatch(f));
  await f.registry.dispatch(commitDispatch(f, "publish"));
  await f.registry.checkpoint();
  await f.registry.complete({ ...f.key, receipt: f.confirmed, delta: f.empty });
  await f.registry.close();
  const registry = await openWorkspaceRegistry({
    ...f.options,
    runtimeEpoch: "new",
  });
  t.after(() => registry.close());
  assert.equal(registry.status().reason, "unconfirmed_tail");
  assert.equal(registry.lookup(f.key).receipt.effect, "unknown");
  const names = (await fs.readdir(f.directory)).sort();
  const before = await Promise.all(
    names.map((n) => fs.readFile(join(f.directory, n))),
  );
  const { sequence, hash } = registry.status().journal;
  await assert.rejects(
    registry.recover({
      action: "adopt_validated_tail",
      expectedSequence: sequence,
      expectedHash: hash,
      ownerVerified: true,
      preflightVerified: true,
    }),
    { code: "recovery_denied" },
  );
  assert.equal(registry.lookup(f.key).receipt.effect, "unknown");
  assert.deepEqual((await fs.readdir(f.directory)).sort(), names);
  assert.deepEqual(
    await Promise.all(names.map((n) => fs.readFile(join(f.directory, n)))),
    before,
  );
});

test("GC logical timeout holds actual call and cannot later mint confirmed success", async (t) => {
  const f = await commitStorageFixture(t, {}, false);
  const held = deferred();
  let calls = 0;
  const host = createHostAdmission({
    runtimeEpoch: "current",
    registry: () => f.registry,
    revision: () => f.registry.status().revision,
    ready: () => Promise.resolve(),
    deadlineMs: 150,
    execute: async () => {
      calls++;
      const owner = currentScope(),
        record = owner.record;
      const key = {
        runtimeEpoch: record.runtimeEpoch,
        operationId: record.operationId,
      };
      for (const step of ["stage", "publish"])
        await f.registry.dispatch({
          ...key,
          step: `filesystem.git.commit.${step}`,
          gitCommitTarget: record.gitCommitTarget,
        });
      owner.markEffect();
      await host.sdk(() => held.promise, []);
      return { ok: true, value: { status: "committed" } };
    },
    projectReceipt: async (record, _operation, result) => {
      record.delivery = result.ok ? "accepted" : "unknown";
      record.effect = result.ok ? "confirmed" : "unknown";
      if (result.ok)
        record.result = {
          ...f.confirmed.result,
          digest: record.digest,
          backups: gitCommitExpectedBackups(
            record.gitCommitTarget,
            record.runtimeEpoch,
            record.operationId,
          ),
        };
      else delete record.result;
      const completed = await f.registry.complete({
        runtimeEpoch: record.runtimeEpoch,
        operationId: record.operationId,
        receipt: redactReceipt(record),
        delta: f.empty,
      });
      Object.assign(record, completed.receipt);
    },
  });
  t.after(async () => {
    held.resolve();
    await host.drain();
    host.close();
  });
  const operation = {
    type: "git.commit.apply",
    workspaceId: f.input.workspaceId,
    requestId: "timeout",
    previewId: "e".repeat(64),
    ...f.input.gitCommitTarget,
  };
  const envelope = {
    version: 2,
    runtimeEpoch: "current",
    operationId: "timeout",
    expectedRevision: f.input.expectedRevision,
    operation,
  };
  const response = await host.handle(envelope, "sender");
  assert.equal(response.code, "UNKNOWN_OUTCOME");
  assert.equal(host.mutationActive(), true);
  const duplicate = await host.handle(envelope, "sender");
  assert.equal(duplicate.value.status, "duplicate");
  assert.equal(calls, 1);
  host.closeSender("sender");
  assert.equal(host.mutationActive(), true);
  held.resolve();
  await host.drain();
  const lookup = f.registry.lookup({
    runtimeEpoch: "current",
    operationId: "timeout",
  });
  assert.equal(lookup.receipt.effect, "unknown");
  assert.equal(lookup.receipt.result, undefined);
  assert.equal(host.mutationActive(), false);
  assert.equal(calls, 1);
});

test("GC duplicate requires original digest, target and floor without appending bytes", async (t) => {
  const f = await commitStorageFixture(t);
  const before = await fs.readFile(join(f.directory, "journal.jsonl"));
  assert.equal((await f.registry.begin(f.input)).status, "duplicate");
  for (const change of [
    { digest: "f".repeat(64) },
    { expectedRevision: f.input.expectedRevision + 1 },
    {
      gitCommitTarget: {
        ...f.input.gitCommitTarget,
        commitOid: "f".repeat(40),
      },
    },
    {
      gitCommitTarget: {
        ...f.input.gitCommitTarget,
        reference: {
          ...f.input.gitCommitTarget.reference,
          name: "refs/heads/other",
        },
      },
    },
  ])
    await assert.rejects(f.registry.begin({ ...f.input, ...change }), {
      code: "DUPLICATE_CONFLICT",
    });
  assert.deepEqual(
    await fs.readFile(join(f.directory, "journal.jsonl")),
    before,
  );
});

test("GC queued completion detaches nested result copies before flushing", async (t) => {
  const held = deferred();
  let armed = false,
    entered = false;
  const f = await commitStorageFixture(t, {
    syncFile: async (file, context) => {
      if (armed && context === "append:completion") {
        entered = true;
        await held.promise;
      }
      await file.sync();
    },
  });
  await f.registry.dispatch(commitDispatch(f));
  await f.registry.dispatch(commitDispatch(f, "publish"));
  const expected = globalThis.structuredClone(f.confirmed.result);
  armed = true;
  const pending = f.registry.complete({
    ...f.key,
    receipt: f.confirmed,
    delta: f.empty,
  });
  await until(() => entered, held.resolve);
  f.confirmed.result.logDigests[0].digest = "0".repeat(64);
  f.confirmed.result.backups[0].backupId = null;
  held.resolve();
  const completed = await pending;
  assert.deepEqual(completed.receipt.result, expected);
  completed.receipt.result.logDigests[0].digest = "0".repeat(64);
  assert.deepEqual(f.registry.lookup(f.key).receipt.result, expected);
});

for (const phase of ["admitted", "stage", "publish", "unknown"])
  test(`GC adopted ${phase} tail retains original key without dispatch or success upgrade`, async (t) => {
    const f = await commitStorageFixture(t);
    if (phase !== "admitted") await f.registry.dispatch(commitDispatch(f));
    if (["publish", "unknown"].includes(phase))
      await f.registry.dispatch(commitDispatch(f, "publish"));
    if (phase === "unknown") {
      const unknown = {
        ...f.confirmed,
        delivery: "unknown",
        effect: "unknown",
      };
      delete unknown.result;
      await f.registry.complete({ ...f.key, receipt: unknown, delta: f.empty });
    }
    await f.registry.close();
    const registry = await openWorkspaceRegistry({
      ...f.options,
      runtimeEpoch: "new",
    });
    t.after(() => registry.close());
    const { sequence, hash } = registry.status().journal;
    await registry.recover({
      action: "adopt_validated_tail",
      expectedSequence: sequence,
      expectedHash: hash,
      ownerVerified: true,
      preflightVerified: true,
    });
    assert.equal(registry.status().state, "ready");
    assert.equal((await registry.begin(f.input)).status, "duplicate");
    await assert.rejects(
      registry.dispatch(
        commitDispatch(f, phase === "admitted" ? "stage" : "publish"),
      ),
    );
    await assert.rejects(
      registry.complete({ ...f.key, receipt: f.confirmed, delta: f.empty }),
    );
    const host = createHostAdmission({
      runtimeEpoch: "current",
      registry: () => registry,
      revision: () => registry.status().revision,
      ready: () => Promise.resolve(),
      execute: () => {
        assert.fail("Lookup must not execute a mutation");
      },
      projectReceipt: () => {},
    });
    t.after(() => host.close());
    const envelope = {
      version: 2,
      runtimeEpoch: "current",
      readId: "cancel-lookup",
      operation: { type: "operation.lookup", ...f.key },
    };
    const before = await fs.readFile(join(f.directory, "journal.jsonl"));
    const pending = host.handle(envelope, "sender");
    assert.equal(
      host.cancel(
        { version: 2, runtimeEpoch: "current", readId: "cancel-lookup" },
        "sender",
      ).value.status,
      "cancelled",
    );
    assert.equal((await pending).code, "CANCELLED");
    await new Promise((resolve) => setImmediate(resolve));
    const lookup = await host.handle(
      { ...envelope, readId: "lookup" },
      "sender",
    );
    assert.equal(lookup.ok, true);
    assert.equal(lookup.value.runtimeEpoch, f.key.runtimeEpoch);
    assert.equal(lookup.value.operationId, f.key.operationId);
    assert.equal(
      lookup.value.receipt.effect,
      phase === "admitted" ? "none" : "unknown",
    );
    assert.equal(lookup.value.receipt.result, undefined);
    assert.deepEqual(
      registry
        .readView()
        .retainedOperations.find((k) => k.operationId === f.key.operationId),
      { ...f.key, type: f.input.type, workspaceId: f.input.workspaceId },
    );
    assert.deepEqual(
      await fs.readFile(join(f.directory, "journal.jsonl")),
      before,
    );
  });

test("GC host detaches queued apply from caller before readiness settles", async (t) => {
  const f = await commitStorageFixture(t, {}, false),
    held = deferred();
  const operation = {
    type: "git.commit.apply",
    workspaceId: f.input.workspaceId,
    requestId: "detached",
    previewId: "e".repeat(64),
    ...globalThis.structuredClone(f.input.gitCommitTarget),
  };
  const expected = globalThis.structuredClone(operation);
  const host = createHostAdmission({
    runtimeEpoch: "current",
    registry: () => f.registry,
    revision: () => f.registry.status().revision,
    ready: () => held.promise,
    execute: async (request) => {
      assert.deepEqual(request, expected);
      return { ok: true, value: { status: "unknown" } };
    },
    projectReceipt: () => {},
  });
  t.after(async () => {
    held.resolve();
    await host.drain();
    host.close();
  });
  const pending = host.handle(
    {
      version: 2,
      runtimeEpoch: "current",
      operationId: "detached",
      expectedRevision: f.input.expectedRevision,
      operation,
    },
    "sender",
  );
  operation.reference.name = "refs/heads/changed";
  operation.logs[0].nextDigest = "0".repeat(64);
  operation.commitOid = "4".repeat(40);
  held.resolve();
  assert.equal((await pending).ok, true);
});

for (const corruption of [
  "marker",
  "target-next",
  "step-target",
  "result-next",
  "digest",
  "backup",
  "absence",
  "publish-only",
  "missing-floor",
  "parent",
  "log-role",
])
  test(`GC actual parser replay rejects ${corruption} without writes`, async (t) => {
    const f = await commitStorageFixture(t);
    await f.registry.dispatch(commitDispatch(f));
    await f.registry.dispatch(commitDispatch(f, "publish"));
    await f.registry.complete({
      ...f.key,
      receipt: f.confirmed,
      delta: f.empty,
    });
    await f.registry.close();
    await rewriteInstructionHistory(f, (payloads) => {
      const admission = payloads.find(
        (p) => p.identity?.type === "git.commit.apply",
      );
      const stage = payloads.find(
        (p) =>
          p.operationId === f.key.operationId &&
          p.step === "filesystem.git.commit.stage",
      );
      const completion = payloads.find(
        (p) => p.operationId === f.key.operationId && p.kind === "completion",
      );
      if (corruption === "marker")
        return payloads.filter((p) => p.feature !== "git_commit_mutation_v1");
      if (corruption === "target-next")
        admission.gitCommitTarget.commitOid = "f".repeat(40);
      if (corruption === "step-target")
        stage.gitCommitTarget.logs[0].nextDigest = "f".repeat(64);
      if (corruption === "result-next")
        completion.receipt.result.referenceDigest = "0".repeat(64);
      if (corruption === "digest")
        completion.receipt.result.digest = "f".repeat(64);
      if (corruption === "backup")
        completion.receipt.result.backups[0].backupId = `.omoc-git-commit-${"f".repeat(64)}.backup`;
      if (corruption === "absence")
        admission.gitCommitTarget.reference.exists = false;
      if (corruption === "publish-only")
        stage.step = "filesystem.git.commit.publish";
      if (corruption === "missing-floor") delete admission.expectedRevision;
      if (corruption === "parent") completion.receipt.result.parentOid = null;
      if (corruption === "log-role")
        completion.receipt.result.logDigests[0].role = "branch_log";
      return payloads;
    });
    const before = await fs.readFile(join(f.directory, "journal.jsonl"));
    const reopened = await openWorkspaceRegistry({
      ...f.options,
      runtimeEpoch: "new",
    });
    t.after(() => reopened.close());
    assert.equal(reopened.status().state, "recovery_required");
    assert.notEqual(reopened.lookup(f.key).receipt?.effect, "confirmed");
    assert.deepEqual(
      await fs.readFile(join(f.directory, "journal.jsonl")),
      before,
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

async function brStorageFixture(
  t,
  io = {},
  begin = true,
  action = "restore",
  format = "sha1",
  exists = true,
) {
  const f = await fixture(t, io);
  const { workspace } = await createManagedWorkspaceOnly(f);
  const target = brStorageTarget(action, format, exists);
  const input = {
    ...identity("branch-restore", {
      type: action === "restore" ? "git.restore.apply" : "git.branch.apply",
      workspaceId: workspace.workspaceId,
    }),
    gitBranchRestoreTarget: target,
    expectedRevision: f.registry.status().revision,
  };
  const key = admittedKey(input);
  const confirmed = receipt(key.operationId, {
    type: input.type,
    workspaceId: input.workspaceId,
    result: {
      kind: "git_branch_restore_applied",
      workspaceId: input.workspaceId,
      action,
      previewDigest: target.previewDigest,
      paths: target.paths.map((x) => ({
        path: x.path,
        after: globalThis.structuredClone(x.after),
      })),
      metadata: target.metadata.map((x) => ({
        role: x.role,
        digest: x.after.digest,
      })),
      backups: gitBranchRestoreExpectedBackups(
        target,
        key.runtimeEpoch,
        key.operationId,
      ),
      digest: input.digest,
    },
  });
  if (begin) assert.equal((await f.registry.begin(input)).status, "admitted");
  return {
    ...f,
    input,
    key,
    confirmed,
    empty: { workspaces: [], sessions: [], tombstones: [] },
  };
}
const brDispatch = (
  f,
  phase = "stage",
  target = f.input.gitBranchRestoreTarget,
) => ({
  ...f.key,
  step: `filesystem.git.branch_restore.${phase}`,
  gitBranchRestoreTarget: target,
});
test("BR registry all actions and formats retain exact closed result and deterministic original-key backups across checkpoint", async (t) => {
  for (const action of ["create", "select", "restore"])
    for (const format of ["sha1", "sha256"])
      for (const exists of [true, false]) {
        const f = await brStorageFixture(t, {}, true, action, format, exists);
        const payloads = (
          await fs.readFile(join(f.directory, "journal.jsonl"), "utf8")
        )
          .trim()
          .split("\n")
          .map((l) => JSON.parse(l).payload);
        const n = payloads.findIndex(
          (p) => p.identity?.operationId === f.key.operationId,
        );
        assert.equal(payloads[n - 1].feature, "git_branch_restore_mutation_v1");
        assert.equal(payloads[n].expectedRevision, f.input.expectedRevision);
        assert.equal(
          f.registry.lookup(f.key).receipt.gitBranchRestoreTarget,
          undefined,
        );
        const before = await fs.readFile(join(f.directory, "journal.jsonl"));
        for (const change of [
          { digest: "f".repeat(64) },
          { expectedRevision: f.input.expectedRevision + 1 },
          {
            gitBranchRestoreTarget: {
              ...f.input.gitBranchRestoreTarget,
              previewDigest: "f".repeat(64),
            },
          },
        ])
          await assert.rejects(f.registry.begin({ ...f.input, ...change }), {
            code: "DUPLICATE_CONFLICT",
          });
        for (const bad of [
          brDispatch(f, "publish"),
          { ...brDispatch(f), nativeSessionId: undefined },
          { ...brDispatch(f), step: "native.send" },
          { ...brDispatch(f), gitCommitTarget: undefined },
        ])
          await assert.rejects(async () => f.registry.dispatch(bad));
        assert.deepEqual(
          await fs.readFile(join(f.directory, "journal.jsonl")),
          before,
        );
        await f.registry.dispatch(brDispatch(f));
        await assert.rejects(f.registry.dispatch(brDispatch(f)));
        await assert.rejects(
          f.registry.reserve({ ...f.key, ownership: "managed" }),
        );
        await f.registry.dispatch(brDispatch(f, "publish"));
        for (const patch of [
          { action: action === "create" ? "restore" : "create" },
          { digest: "0".repeat(64) },
          { paths: [{ path: "forged", after: null }] },
          { metadata: [{ role: "index", digest: "0".repeat(64) }] },
          { backups: [] },
        ])
          await assert.rejects(async () =>
            f.registry.complete({
              ...f.key,
              receipt: {
                ...f.confirmed,
                result: { ...f.confirmed.result, ...patch },
              },
              delta: f.empty,
            }),
          );
        const complete = { ...f.key, receipt: f.confirmed, delta: f.empty };
        assert.equal(
          (await f.registry.complete(complete)).receipt.effect,
          "confirmed",
        );
        assert.deepEqual(
          f.registry.lookup(f.key).receipt.result,
          f.confirmed.result,
        );
        assert.equal((await f.registry.complete(complete)).status, "duplicate");
        await f.registry.checkpoint();
        await f.registry.close();
        const reopened = await openWorkspaceRegistry({
          ...f.options,
          runtimeEpoch: "new",
        });
        t.after(() => reopened.close());
        assert.deepEqual(
          reopened.lookup(f.key).receipt.result,
          f.confirmed.result,
        );
        assert.equal((await reopened.begin(f.input)).status, "duplicate");
        assert.equal(
          JSON.stringify(reopened.readView()).includes(
            "gitBranchRestoreTarget",
          ),
          false,
        );
      }
});
for (const phase of ["admitted", "stage", "publish", "unknown"])
  test(`BR adopted ${phase} tail retains original key without dispatch or success upgrade`, async (t) => {
    const f = await brStorageFixture(t);
    if (phase !== "admitted") await f.registry.dispatch(brDispatch(f));
    if (["publish", "unknown"].includes(phase))
      await f.registry.dispatch(brDispatch(f, "publish"));
    if (phase === "unknown") {
      const unknown = {
        ...f.confirmed,
        delivery: "unknown",
        effect: "unknown",
      };
      delete unknown.result;
      await f.registry.complete({ ...f.key, receipt: unknown, delta: f.empty });
    }
    await f.registry.close();
    const registry = await openWorkspaceRegistry({
      ...f.options,
      runtimeEpoch: "new",
    });
    t.after(() => registry.close());
    const { sequence, hash } = registry.status().journal;
    await registry.recover({
      action: "adopt_validated_tail",
      expectedSequence: sequence,
      expectedHash: hash,
      ownerVerified: true,
      preflightVerified: true,
    });
    assert.equal(registry.status().state, "ready");
    assert.equal((await registry.begin(f.input)).status, "duplicate");
    await assert.rejects(
      registry.dispatch(
        brDispatch(f, phase === "admitted" ? "stage" : "publish"),
      ),
    );
    await assert.rejects(
      registry.complete({ ...f.key, receipt: f.confirmed, delta: f.empty }),
    );
    const host = createHostAdmission({
      runtimeEpoch: "current",
      registry: () => registry,
      revision: () => registry.status().revision,
      ready: () => Promise.resolve(),
      execute: () => {
        assert.fail("Lookup must not execute a mutation");
      },
      projectReceipt: () => {},
    });
    t.after(() => host.close());
    const envelope = {
      version: 2,
      runtimeEpoch: "current",
      readId: "cancel-lookup",
      operation: { type: "operation.lookup", ...f.key },
    };
    const before = await fs.readFile(join(f.directory, "journal.jsonl"));
    const pending = host.handle(envelope, "sender");
    assert.equal(
      host.cancel(
        { version: 2, runtimeEpoch: "current", readId: "cancel-lookup" },
        "sender",
      ).value.status,
      "cancelled",
    );
    assert.equal((await pending).code, "CANCELLED");
    await new Promise((resolve) => setImmediate(resolve));
    const lookup = await host.handle(
      { ...envelope, readId: "lookup" },
      "sender",
    );
    assert.equal(lookup.ok, true);
    assert.equal(lookup.value.runtimeEpoch, f.key.runtimeEpoch);
    assert.equal(lookup.value.operationId, f.key.operationId);
    assert.equal(
      lookup.value.receipt.effect,
      phase === "admitted" ? "none" : "unknown",
    );
    assert.equal(lookup.value.receipt.result, undefined);
    assert.deepEqual(
      registry
        .readView()
        .retainedOperations.find((k) => k.operationId === f.key.operationId),
      { ...f.key, type: f.input.type, workspaceId: f.input.workspaceId },
    );
    assert.deepEqual(
      await fs.readFile(join(f.directory, "journal.jsonl")),
      before,
    );
  });

for (const phase of ["feature_gate", "admission", "dispatch", "completion"])
  for (const fails of [false, true])
    test(`BR ${phase} flush ${fails ? "failure" : "pause"} keeps unpublished authority hidden`, async (t) => {
      const held = deferred();
      let entered = false,
        armed = false;
      const f = await brStorageFixture(
        t,
        {
          syncFile: async (file, context) => {
            if (armed && context === `append:${phase}`) {
              entered = true;
              await held.promise;
              if (fails) throw new Error("synthetic BR flush failure");
            }
            await file.sync();
          },
        },
        false,
      );
      if (["dispatch", "completion"].includes(phase))
        await f.registry.begin(f.input);
      if (phase === "completion") {
        await f.registry.dispatch(brDispatch(f));
        await f.registry.dispatch(brDispatch(f, "publish"));
      }
      armed = true;
      const pending =
        phase === "completion"
          ? f.registry.complete({
              ...f.key,
              receipt: f.confirmed,
              delta: f.empty,
            })
          : phase === "dispatch"
            ? f.registry.dispatch(brDispatch(f))
            : f.registry.begin(f.input);
      const settled = pending.then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
      await until(() => entered, held.resolve);
      const lookup = f.registry.lookup(f.key);
      if (["feature_gate", "admission"].includes(phase))
        assert.equal(lookup.status, "missing");
      else assert.notEqual(lookup.receipt.effect, "confirmed");
      held.resolve();
      const outcome = await settled;
      if (fails) {
        assert.equal(outcome.error.code, "writer_poisoned");
        assert.notEqual(f.registry.lookup(f.key).receipt?.effect, "confirmed");
        await assert.rejects(f.registry.dispatch(brDispatch(f)));
      } else assert.ok(outcome.value);
    });
test("BR host binds requestId, required revision and canonical original digest before execute", async (t) => {
  const f = await brStorageFixture(t, {}, false);
  const held = deferred();
  let executed = 0;
  const op = {
    type: "git.restore.apply",
    workspaceId: f.input.workspaceId,
    requestId: "host-commit",
    previewId: "e".repeat(64),
    ...f.input.gitBranchRestoreTarget,
  };
  const host = createHostAdmission({
    runtimeEpoch: "current",
    registry: () => f.registry,
    revision: () => f.registry.status().revision,
    ready: () => held.promise,
    deadlineMs: 2000,
    execute: async () => {
      executed++;
      assert.equal(currentScope().kind, "mutation");
      assert.deepEqual(
        currentScope().record.gitBranchRestoreTarget,
        f.input.gitBranchRestoreTarget,
      );
      throw Object.assign(new Error("denied"), { appCode: "FILE_DENIED" });
    },
    projectReceipt: () => {},
  });
  t.after(async () => {
    held.resolve();
    await host.drain();
    host.close();
  });
  const envelope = {
    version: 2,
    runtimeEpoch: "current",
    operationId: op.requestId,
    expectedRevision: f.input.expectedRevision,
    operation: op,
  };
  assert.equal(
    (await host.handle({ ...envelope, expectedRevision: undefined }, "sender"))
      .code,
    "INVALID_REQUEST",
  );
  assert.equal(
    (await host.handle({ ...envelope, operationId: "mismatch" }, "sender"))
      .code,
    "INVALID_REQUEST",
  );
  const pending = host.handle(envelope, "sender");
  const key = { runtimeEpoch: "current", operationId: op.requestId };
  await until(() => f.registry.lookup(key).status === "found", held.resolve);
  const canonical = { ...op, expectedRevision: envelope.expectedRevision };
  const digest = createHash("sha256")
    .update(
      JSON.stringify(
        Object.keys(canonical)
          .sort()
          .map((k) => [k, canonical[k]]),
      ),
    )
    .digest("hex");
  assert.equal(f.registry.lookupIdentity(key).digest, digest);
  assert.equal(
    (await host.handle(envelope, "sender")).value.status,
    "duplicate",
  );
  for (const patch of [
    { occupancyDigest: "f".repeat(64) },
    { treeOid: "f".repeat(40) },
    { previewDigest: "f".repeat(64) },
  ])
    assert.equal(
      (
        await host.handle(
          { ...envelope, operation: { ...op, ...patch } },
          "sender",
        )
      ).code,
      "DUPLICATE_CONFLICT",
    );
  assert.equal(
    (
      await host.handle(
        { ...envelope, expectedRevision: envelope.expectedRevision + 1 },
        "sender",
      )
    ).code,
    "DUPLICATE_CONFLICT",
  );
  assert.equal(executed, 0);
  held.resolve();
  assert.equal((await pending).code, "FILE_DENIED");
  assert.equal(executed, 1);
  assert.equal(
    JSON.stringify(f.registry.readView().retainedOperations).includes(
      "gitBranchRestoreTarget",
    ),
    false,
  );
});
for (const phase of ["admission", "dispatch", "completion"])
  test(`BR surviving unconfirmed ${phase} tail cannot mint publication authority`, async (t) => {
    let armed = false;
    const f = await brStorageFixture(
      t,
      {
        syncFile: async (file, context) => {
          if (armed && context === `append:${phase}`)
            throw new Error("synthetic unconfirmed tail");
          await file.sync();
        },
      },
      false,
    );
    if (phase !== "admission") await f.registry.begin(f.input);
    if (phase === "completion") {
      await f.registry.dispatch(brDispatch(f));
      await f.registry.dispatch(brDispatch(f, "publish"));
    }
    await f.registry.checkpoint();
    armed = true;
    await assert.rejects(
      phase === "admission"
        ? f.registry.begin(f.input)
        : phase === "dispatch"
          ? f.registry.dispatch(brDispatch(f))
          : f.registry.complete({
              ...f.key,
              receipt: f.confirmed,
              delta: f.empty,
            }),
      { code: "writer_poisoned" },
    );
    await f.registry.close();
    const before = await fs.readFile(join(f.directory, "journal.jsonl"));
    const reopened = await openWorkspaceRegistry({
      ...f.options,
      io: {},
      runtimeEpoch: "new",
    });
    t.after(() => reopened.close());
    assert.equal(reopened.status().state, "recovery_required");
    assert.notEqual(reopened.lookup(f.key).receipt?.effect, "confirmed");
    await assert.rejects(reopened.dispatch(brDispatch(f)));
    await assert.rejects(
      reopened.complete({ ...f.key, receipt: f.confirmed, delta: f.empty }),
    );
    assert.deepEqual(
      await fs.readFile(join(f.directory, "journal.jsonl")),
      before,
    );
  });

test("BR confirmed surviving tail cannot upgrade unknown through explicit adoption", async (t) => {
  const f = await brStorageFixture(t);
  await f.registry.dispatch(brDispatch(f));
  await f.registry.dispatch(brDispatch(f, "publish"));
  await f.registry.checkpoint();
  await f.registry.complete({ ...f.key, receipt: f.confirmed, delta: f.empty });
  await f.registry.close();
  const registry = await openWorkspaceRegistry({
    ...f.options,
    runtimeEpoch: "new",
  });
  t.after(() => registry.close());
  assert.equal(registry.status().reason, "unconfirmed_tail");
  assert.equal(registry.lookup(f.key).receipt.effect, "unknown");
  const names = (await fs.readdir(f.directory)).sort();
  const before = await Promise.all(
    names.map((n) => fs.readFile(join(f.directory, n))),
  );
  const { sequence, hash } = registry.status().journal;
  await assert.rejects(
    registry.recover({
      action: "adopt_validated_tail",
      expectedSequence: sequence,
      expectedHash: hash,
      ownerVerified: true,
      preflightVerified: true,
    }),
    { code: "recovery_denied" },
  );
  assert.equal(registry.lookup(f.key).receipt.effect, "unknown");
  assert.deepEqual((await fs.readdir(f.directory)).sort(), names);
  assert.deepEqual(
    await Promise.all(names.map((n) => fs.readFile(join(f.directory, n)))),
    before,
  );
});

test("BR logical timeout holds actual call and cannot later mint confirmed success", async (t) => {
  const f = await brStorageFixture(t, {}, false);
  const held = deferred();
  let calls = 0;
  const host = createHostAdmission({
    runtimeEpoch: "current",
    registry: () => f.registry,
    revision: () => f.registry.status().revision,
    ready: () => Promise.resolve(),
    deadlineMs: 150,
    execute: async () => {
      calls++;
      const owner = currentScope(),
        record = owner.record;
      const key = {
        runtimeEpoch: record.runtimeEpoch,
        operationId: record.operationId,
      };
      for (const step of ["stage", "publish"])
        await f.registry.dispatch({
          ...key,
          step: `filesystem.git.branch_restore.${step}`,
          gitBranchRestoreTarget: record.gitBranchRestoreTarget,
        });
      owner.markEffect();
      await host.sdk(() => held.promise, []);
      return { ok: true, value: { status: "applied" } };
    },
    projectReceipt: async (record, _operation, result) => {
      record.delivery = result.ok ? "accepted" : "unknown";
      record.effect = result.ok ? "confirmed" : "unknown";
      if (result.ok)
        record.result = {
          ...f.confirmed.result,
          digest: record.digest,
          backups: gitBranchRestoreExpectedBackups(
            record.gitBranchRestoreTarget,
            record.runtimeEpoch,
            record.operationId,
          ),
        };
      else delete record.result;
      const completed = await f.registry.complete({
        runtimeEpoch: record.runtimeEpoch,
        operationId: record.operationId,
        receipt: redactReceipt(record),
        delta: f.empty,
      });
      Object.assign(record, completed.receipt);
    },
  });
  t.after(async () => {
    held.resolve();
    await host.drain();
    host.close();
  });
  const operation = {
    type: "git.restore.apply",
    workspaceId: f.input.workspaceId,
    requestId: "timeout",
    previewId: "e".repeat(64),
    ...f.input.gitBranchRestoreTarget,
  };
  const envelope = {
    version: 2,
    runtimeEpoch: "current",
    operationId: "timeout",
    expectedRevision: f.input.expectedRevision,
    operation,
  };
  const response = await host.handle(envelope, "sender");
  assert.equal(response.code, "UNKNOWN_OUTCOME");
  assert.equal(host.mutationActive(), true);
  const duplicate = await host.handle(envelope, "sender");
  assert.equal(duplicate.value.status, "duplicate");
  assert.equal(calls, 1);
  host.closeSender("sender");
  assert.equal(host.mutationActive(), true);
  held.resolve();
  await host.drain();
  const lookup = f.registry.lookup({
    runtimeEpoch: "current",
    operationId: "timeout",
  });
  assert.equal(lookup.receipt.effect, "unknown");
  assert.equal(lookup.receipt.result, undefined);
  assert.equal(host.mutationActive(), false);
  assert.equal(calls, 1);
});

test("BR queued completion detaches nested result copies before flushing", async (t) => {
  const held = deferred();
  let armed = false,
    entered = false;
  const f = await brStorageFixture(t, {
    syncFile: async (file, context) => {
      if (armed && context === "append:completion") {
        entered = true;
        await held.promise;
      }
      await file.sync();
    },
  });
  await f.registry.dispatch(brDispatch(f));
  await f.registry.dispatch(brDispatch(f, "publish"));
  const expected = globalThis.structuredClone(f.confirmed.result);
  armed = true;
  const pending = f.registry.complete({
    ...f.key,
    receipt: f.confirmed,
    delta: f.empty,
  });
  await until(() => entered, held.resolve);
  f.confirmed.result.paths[0].after.digest = "0".repeat(64);
  f.confirmed.result.backups[0].backupId = null;
  held.resolve();
  const completed = await pending;
  assert.deepEqual(completed.receipt.result, expected);
  completed.receipt.result.paths[0].after.digest = "0".repeat(64);
  assert.deepEqual(f.registry.lookup(f.key).receipt.result, expected);
});

test("BR host detaches queued apply from caller before readiness settles", async (t) => {
  const f = await brStorageFixture(t, {}, false),
    held = deferred();
  const operation = {
    type: "git.restore.apply",
    workspaceId: f.input.workspaceId,
    requestId: "detached",
    previewId: "e".repeat(64),
    ...globalThis.structuredClone(f.input.gitBranchRestoreTarget),
  };
  const expected = globalThis.structuredClone(operation);
  const host = createHostAdmission({
    runtimeEpoch: "current",
    registry: () => f.registry,
    revision: () => f.registry.status().revision,
    ready: () => held.promise,
    execute: async (request) => {
      assert.deepEqual(request, expected);
      return { ok: true, value: { status: "unknown" } };
    },
    projectReceipt: () => {},
  });
  t.after(async () => {
    held.resolve();
    await host.drain();
    host.close();
  });
  const pending = host.handle(
    {
      version: 2,
      runtimeEpoch: "current",
      operationId: "detached",
      expectedRevision: f.input.expectedRevision,
      operation,
    },
    "sender",
  );
  operation.paths[0].path = "changed.txt";
  operation.paths[0].after.digest = "0".repeat(64);
  operation.previewDigest = "4".repeat(64);
  held.resolve();
  assert.equal((await pending).ok, true);
});

for (const corruption of [
  "marker",
  "target",
  "step-target",
  "result-path",
  "mode",
  "digest",
  "backup",
  "absence",
  "publish-only",
  "missing-floor",
  "action",
  "metadata",
  "delta",
])
  test(`BR actual replay rejects ${corruption} without writes`, async (t) => {
    const f = await brStorageFixture(t, {}, true, "select");
    await f.registry.dispatch(brDispatch(f));
    await f.registry.dispatch(brDispatch(f, "publish"));
    await f.registry.complete({
      ...f.key,
      receipt: f.confirmed,
      delta: f.empty,
    });
    await f.registry.close();
    await rewriteInstructionHistory(f, (payloads) => {
      const admission = payloads.find(
        (p) => p.identity?.operationId === f.key.operationId,
      );
      const stage = payloads.find(
        (p) =>
          p.operationId === f.key.operationId &&
          p.step === "filesystem.git.branch_restore.stage",
      );
      const completion = payloads.find(
        (p) => p.operationId === f.key.operationId && p.kind === "completion",
      );
      if (corruption === "marker")
        return payloads.filter(
          (p) => p.feature !== "git_branch_restore_mutation_v1",
        );
      if (corruption === "target")
        admission.gitBranchRestoreTarget.previewDigest = "0".repeat(64);
      if (corruption === "step-target")
        stage.gitBranchRestoreTarget.paths[0].path = "forged.txt";
      if (corruption === "result-path")
        completion.receipt.result.paths[0].path = "forged.txt";
      if (corruption === "mode")
        completion.receipt.result.paths[0].after.mode = 0o700;
      if (corruption === "digest")
        completion.receipt.result.digest = "0".repeat(64);
      if (corruption === "backup")
        completion.receipt.result.backups[0].backupId = `.omoc-git-branch-restore-${"f".repeat(64)}.backup`;
      if (corruption === "absence")
        admission.gitBranchRestoreTarget.paths[0].before = null;
      if (corruption === "publish-only")
        stage.step = "filesystem.git.branch_restore.publish";
      if (corruption === "missing-floor") delete admission.expectedRevision;
      if (corruption === "action") completion.receipt.result.action = "restore";
      if (corruption === "metadata")
        completion.receipt.result.metadata[0].digest = "0".repeat(64);
      if (corruption === "delta")
        completion.delta.tombstones = [
          { kind: "workspace", id: f.input.workspaceId },
        ];
      return payloads;
    });
    const names = (await fs.readdir(f.directory)).sort();
    const before = await Promise.all(
      names.map((n) => fs.readFile(join(f.directory, n))),
    );
    const reopened = await openWorkspaceRegistry({
      ...f.options,
      runtimeEpoch: "new",
    });
    t.after(() => reopened.close());
    assert.equal(reopened.status().state, "recovery_required");
    assert.notEqual(reopened.lookup(f.key).receipt?.effect, "confirmed");
    await reopened.close();
    assert.deepEqual((await fs.readdir(f.directory)).sort(), names);
    assert.deepEqual(
      await Promise.all(names.map((n) => fs.readFile(join(f.directory, n)))),
      before,
    );
  });
test("BR nested admission, dispatch and completion accessors refuse before copy without invoking getters", async (t) => {
  const f = await brStorageFixture(t, {}, false);
  let calls = 0;
  const getter = brStorageTarget();
  Object.defineProperty(getter.paths[0].after, "digest", {
    enumerable: true,
    get() {
      calls++;
      return "a".repeat(64);
    },
  });
  for (const target of [
    getter,
    {
      ...brStorageTarget(),
      paths: [{ ...brStorageTarget().paths[0], extra: undefined }],
    },
  ])
    await assert.rejects(async () =>
      f.registry.begin({ ...f.input, gitBranchRestoreTarget: target }),
    );
  await f.registry.begin(f.input);
  await assert.rejects(async () =>
    f.registry.dispatch(brDispatch(f, "stage", getter)),
  );
  await f.registry.dispatch(brDispatch(f));
  await f.registry.dispatch(brDispatch(f, "publish"));
  const forged = globalThis.structuredClone(f.confirmed);
  Object.defineProperty(forged.result.paths[0].after, "digest", {
    enumerable: true,
    get() {
      calls++;
      return "a".repeat(64);
    },
  });
  await assert.rejects(async () =>
    f.registry.complete({ ...f.key, receipt: forged, delta: f.empty }),
  );
  assert.equal(calls, 0);
});

for (const fails of [false, true])
  test(`BR stage flush ${fails ? "failure" : "pause"} gates the actual caller effect`, async (t) => {
    const held = deferred();
    let entered = false,
      calls = 0,
      armed = false;
    const f = await brStorageFixture(
      t,
      {
        syncFile: async (file, context) => {
          if (armed && context === "append:dispatch") {
            entered = true;
            await held.promise;
            if (fails) throw new Error("synthetic stage failure");
          }
          await file.sync();
        },
      },
      false,
    );
    const host = createHostAdmission({
      runtimeEpoch: "current",
      registry: () => f.registry,
      revision: () => f.registry.status().revision,
      ready: () => Promise.resolve(),
      deadlineMs: 2000,
      execute: async () => {
        const owner = currentScope();
        owner.beforeEffect = () =>
          f.registry.dispatch({
            runtimeEpoch: owner.record.runtimeEpoch,
            operationId: owner.record.operationId,
            step: "filesystem.git.branch_restore.stage",
            gitBranchRestoreTarget: owner.record.gitBranchRestoreTarget,
          });
        await host.sdk(
          async () => {
            calls++;
            return {};
          },
          [],
          true,
        );
        return { ok: true, value: { status: "unknown" } };
      },
      projectReceipt: () => {},
    });
    t.after(async () => {
      held.resolve();
      await host.drain();
      host.close();
    });
    const operation = {
      type: f.input.type,
      workspaceId: f.input.workspaceId,
      requestId: "flush-stage",
      previewId: "e".repeat(64),
      ...f.input.gitBranchRestoreTarget,
    };
    armed = true;
    const pending = host.handle(
      {
        version: 2,
        runtimeEpoch: "current",
        operationId: operation.requestId,
        expectedRevision: f.input.expectedRevision,
        operation,
      },
      "sender",
    );
    await until(() => entered, held.resolve);
    assert.equal(calls, 0);
    assert.equal(host.mutationActive(), true);
    held.resolve();
    const result = await pending;
    await host.drain();
    assert.equal(calls, fails ? 0 : 1);
    assert.equal(result.ok, !fails);
  });

for (const phase of ["admission", "dispatch"])
  test(`BR queued ${phase} detaches nested targets before its flush`, async (t) => {
    const held = deferred();
    let entered = false,
      armed = false;
    const f = await brStorageFixture(
      t,
      {
        syncFile: async (file, context) => {
          if (armed && context === `append:${phase}`) {
            entered = true;
            await held.promise;
          }
          await file.sync();
        },
      },
      false,
    );
    t.after(() => held.resolve());
    const expected = globalThis.structuredClone(f.input.gitBranchRestoreTarget);
    if (phase === "dispatch") await f.registry.begin(f.input);
    armed = true;
    const request = phase === "admission" ? f.input : brDispatch(f);
    const pending =
      phase === "admission"
        ? f.registry.begin(request)
        : f.registry.dispatch(request);
    await until(() => entered, held.resolve);
    request.gitBranchRestoreTarget.paths[0].path = "changed.txt";
    request.gitBranchRestoreTarget.paths[0].after.digest = "0".repeat(64);
    held.resolve();
    await pending;
    const payloads = (
      await fs.readFile(join(f.directory, "journal.jsonl"), "utf8")
    )
      .trim()
      .split("\n")
      .map((x) => JSON.parse(x).payload);
    const saved = payloads.find(
      (p) =>
        p.kind === phase &&
        (p.identity?.operationId ?? p.operationId) === f.key.operationId,
    );
    assert.deepEqual(saved.gitBranchRestoreTarget, expected);
  });
