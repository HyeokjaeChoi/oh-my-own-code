import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  INSTRUCTION_KEY,
  instructionDigest,
} from "./host/workbench-instructions.mjs";
import { createNativeTaskLedger } from "./native-permission-task-ledger.mjs";
import {
  bootstrapHandoffProof,
  bootstrapParentDigest,
  bootstrapTaskProof,
} from "./native-permission-bootstrap-digest.mjs";

const request = (overrides = {}) => ({
  originKind: "bootstrap",
  origin: {
    runtimeEpoch: "epoch",
    operationId: "op-1",
    type: "session.create",
    digest: "a".repeat(64),
  },
  workspaceId: "workspace",
  workspacePath: "/work",
  appSessionId: "app-session",
  plannedNativeSessionId: "ses_planned",
  metadataDigest: "b".repeat(64),
  reservation: {
    kind: "bootstrap",
    step: "native.create",
    reservationDigest: "c".repeat(64),
    parentIdentityDigest: null,
  },
  ...overrides,
});
const plan = () => ({
  handoffId: randomUUID(),
  stageArgumentDigest: "d".repeat(64),
});
function ledgerFixture() {
  const state = { live: true, unconfirmed: 0, arm: "ok", revoke: "ok" };
  const sent = [];
  const channel = {
    async prepare(req) {
      sent.push(["prepare", req]);
      if (state.held) return { status: "held", reason: "inventory_unverified" };
      return {
        status: "prepared",
        taskScopeId: randomUUID(),
        locationId: randomUUID(),
        projectId: "project",
        modeGeneration: 1,
        inventoryGeneration: 2,
        launchId: "launch-1",
      };
    },
    async arm(row) {
      sent.push(["arm", row]);
      return state.arm;
    },
    async revoke(id) {
      sent.push(["revoke", id]);
      return state.revoke;
    },
  };
  let clock = 0;
  const ledger = createNativeTaskLedger({
    runtimeEpoch: "epoch",
    isLive: () => state.live,
    channel,
    onUnconfirmed: () => state.unconfirmed++,
    now: () => clock,
  });
  return { ledger, state, sent, advance: (ms) => (clock += ms) };
}
const identity = (req, prepared) => ({
  taskScopeId: prepared.taskScopeId,
  origin: req.origin,
  workspaceId: req.workspaceId,
  projectId: prepared.projectId,
  locationId: prepared.locationId,
  modeGeneration: prepared.modeGeneration,
  inventoryGeneration: prepared.inventoryGeneration,
  originKind: "bootstrap",
});
const armRow = (req, prepared, p) => ({
  handoffId: p.handoffId,
  taskScopeId: prepared.taskScopeId,
  originalKey: {
    runtimeEpoch: req.origin.runtimeEpoch,
    operationId: req.origin.operationId,
  },
  originalDigest: req.origin.digest,
  step: req.reservation.step,
  stageArgumentDigest: p.stageArgumentDigest,
  targetIdentity: identity(req, prepared),
  currentLaunchIdentity: prepared.launchId,
});
const handoff = (p, step, state) => ({
  handoffId: p.handoffId,
  step,
  stageArgumentDigest: p.stageArgumentDigest,
  state,
  proofDigest: bootstrapHandoffProof({
    handoffId: p.handoffId,
    step,
    stageArgumentDigest: p.stageArgumentDigest,
    state,
  }),
});
const envelope = (prepared, kind, rest) => ({
  kind,
  runtimeEpoch: "epoch",
  operationId: "op-1",
  taskScopeId: prepared.taskScopeId,
  ...rest,
});
const context = (task = null) => ({ runtimeEpoch: "epoch", task });

test("prepare requires a plan only for bootstrap and refuses duplicate keys and handoffs", async () => {
  const f = ledgerFixture();
  await assert.rejects(() => f.ledger.prepare(request()), /invalid_record/);
  await assert.rejects(() =>
    f.ledger.prepare(request(), { handoffId: "x", stageArgumentDigest: "y" }),
  );
  const p = plan();
  const prepared = await f.ledger.prepare(request(), p);
  assert.equal(prepared.status, "prepared");
  assert.ok(Object.isFrozen(prepared));
  // Never re-issue: the same original key and the same handoff id are refused
  // before another child round trip.
  const before = f.sent.length;
  await assert.rejects(() => f.ledger.prepare(request(), plan()), /held/);
  await assert.rejects(
    () =>
      f.ledger.prepare(
        request({ origin: { ...request().origin, operationId: "op-2" } }),
        p,
      ),
    /held/,
  );
  assert.equal(f.sent.length, before);
  await assert.rejects(
    () =>
      f.ledger.prepare(
        request({ origin: { ...request().origin, runtimeEpoch: "other" } }),
        plan(),
      ),
    /held/,
  );
});

test("a held child reply creates no correlation and verifies nothing", async () => {
  const f = ledgerFixture();
  f.state.held = true;
  const p = plan();
  const result = await f.ledger.prepare(request(), p);
  assert.deepEqual(
    { ...result },
    {
      status: "held",
      reason: "inventory_unverified",
    },
  );
  assert.equal(
    f.ledger.verify(
      envelope({ taskScopeId: randomUUID() }, "task.observe", {
        phase: "bound",
        launchId: "launch-1",
      }),
      context(),
    ),
    false,
  );
});

test("verify accepts exactly the live prepared identity and refuses forged prepare records", async () => {
  const f = ledgerFixture();
  const req = request();
  const p = plan();
  const prepared = await f.ledger.prepare(req, p);
  const good = envelope(prepared, "task.prepare", {
    identity: identity(req, prepared),
    binding: req.reservation,
  });
  assert.equal(f.ledger.verify(good, context()), true);
  // Replay against an existing task, other identity fields or other epochs.
  assert.equal(f.ledger.verify(good, context({ phase: "prepared" })), false);
  for (const forged of [
    { ...good, identity: { ...good.identity, projectId: "forged" } },
    { ...good, identity: { ...good.identity, locationId: randomUUID() } },
    { ...good, identity: { ...good.identity, modeGeneration: 9 } },
    { ...good, identity: { ...good.identity, inventoryGeneration: 9 } },
    { ...good, identity: { ...good.identity, workspaceId: "forged" } },
    {
      ...good,
      binding: { ...good.binding, reservationDigest: "e".repeat(64) },
    },
    { ...good, taskScopeId: randomUUID() },
    { ...good, operationId: "op-other" },
  ])
    assert.equal(f.ledger.verify(forged, context()), false);
  assert.equal(
    f.ledger.verify(good, { runtimeEpoch: "other", task: null }),
    false,
  );
  f.state.live = false;
  assert.equal(f.ledger.verify(good, context()), false);
});

test("handoff records follow prepared -> armed -> consumed/completed and bind to the plan", async () => {
  const f = ledgerFixture();
  const req = request();
  const p = plan();
  const prepared = await f.ledger.prepare(req, p);
  const record = (state, rest = {}) =>
    envelope(prepared, "task.handoff", {
      ...handoff(p, req.reservation.step, state),
      ...rest,
    });
  assert.equal(
    f.ledger.verify(
      envelope(prepared, "task.observe", {
        phase: "bound",
        launchId: "launch-1",
      }),
      context(),
    ),
    true,
  );
  assert.equal(
    f.ledger.verify(
      envelope(prepared, "task.observe", {
        phase: "bound",
        launchId: "forged",
      }),
      context(),
    ),
    false,
  );
  assert.equal(f.ledger.verify(record("armed"), context()), true);
  // Consumed/completed need an ACKed arm; the child has not armed yet.
  assert.equal(f.ledger.verify(record("consumed"), context()), false);
  for (const forged of [
    record("armed", { stageArgumentDigest: "f".repeat(64) }),
    record("armed", { handoffId: randomUUID() }),
    record("armed", { step: "native.fork" }),
    record("armed", { proofDigest: "f".repeat(64) }),
  ])
    assert.equal(f.ledger.verify(forged, context()), false);
  await f.ledger.arm(armRow(req, prepared, p));
  assert.equal(f.ledger.verify(record("armed"), context()), false);
  assert.equal(f.ledger.verify(record("consumed"), context()), true);
  assert.equal(f.ledger.verify(record("completed"), context()), true);
  assert.equal(f.ledger.verify(record("revoked"), context()), false);
});

test("arm only sends the exact prepared row once and a refusal leaves the task unarmed", async () => {
  const f = ledgerFixture();
  const req = request();
  const p = plan();
  const prepared = await f.ledger.prepare(req, p);
  const row = armRow(req, prepared, p);
  for (const forged of [
    { ...row, handoffId: randomUUID() },
    { ...row, stageArgumentDigest: "f".repeat(64) },
    { ...row, currentLaunchIdentity: "forged" },
    { ...row, originalDigest: "f".repeat(64) },
    { ...row, targetIdentity: { ...row.targetIdentity, projectId: "forged" } },
  ])
    await assert.rejects(() => f.ledger.arm(forged));
  assert.equal(f.sent.filter(([name]) => name === "arm").length, 0);
  f.state.arm = "refused";
  await assert.rejects(() => f.ledger.arm(row), /task_arm_refused/);
  // A refused arm is final for this correlation: no second arm, no verify.
  f.state.arm = "ok";
  await assert.rejects(() => f.ledger.arm(row), /task_arm_held/);
  assert.equal(f.sent.filter(([name]) => name === "arm").length, 1);
  assert.equal(
    f.ledger.verify(
      envelope(
        prepared,
        "task.handoff",
        handoff(p, "native.create", "consumed"),
      ),
      context(),
    ),
    false,
  );
  // Nothing was armed in the child, so revoking it is local and final.
  await f.ledger.revoke(p.handoffId);
  assert.equal(f.sent.filter(([name]) => name === "revoke").length, 0);
});

test("settled proof requires the armed child, the durable binding and exact proof; settle consumes the correlation", async () => {
  const f = ledgerFixture();
  const req = request();
  const p = plan();
  const prepared = await f.ledger.prepare(req, p);
  await f.ledger.arm(armRow(req, prepared, p));
  const bound = {
    ...identity(req, prepared),
    appSessionId: "app-session",
    nativeSessionId: "ses_planned",
  };
  const binding = (rest = {}) =>
    envelope(prepared, "task.bootstrap-binding", {
      appSessionId: "app-session",
      nativeSessionId: "ses_planned",
      metadataDigest: "b".repeat(64),
      ...rest,
    });
  assert.equal(f.ledger.verify(binding(), context()), true);
  for (const forged of [
    binding({ appSessionId: "foreign" }),
    binding({ nativeSessionId: "ses_other" }),
    binding({ metadataDigest: "e".repeat(64) }),
  ])
    assert.equal(f.ledger.verify(forged, context()), false);
  const proofDigest = bootstrapTaskProof({
    outcome: "settled",
    taskScopeId: prepared.taskScopeId,
    appSessionId: "app-session",
    nativeSessionId: "ses_planned",
  });
  const proof = (kind, rest = {}) =>
    envelope(prepared, kind, { proofDigest, outcome: "settled", ...rest });
  const task = { identity: bound };
  assert.equal(f.ledger.verify(proof("task_proof"), context(task)), true);
  // Not bound yet, or a different proof, or a no-effect proof for a live arm.
  assert.equal(
    f.ledger.verify(
      proof("task_proof"),
      context({ identity: identity(req, prepared) }),
    ),
    false,
  );
  assert.equal(
    f.ledger.verify(
      proof("task_proof", { proofDigest: "f".repeat(64) }),
      context(task),
    ),
    false,
  );
  assert.equal(
    f.ledger.verify(
      proof("task_proof", {
        outcome: "no_effect",
        proofDigest: bootstrapTaskProof({
          outcome: "no_effect",
          taskScopeId: prepared.taskScopeId,
        }),
      }),
      context(task),
    ),
    false,
  );
  assert.equal(f.ledger.verify(proof("task.settle"), context(task)), true);
  // The final record consumed the live correlation.
  assert.equal(f.ledger.verify(proof("task.settle"), context(task)), false);
});

test("no-effect proof requires a revoked correlation; consumed arms cannot be revoked", async () => {
  const f = ledgerFixture();
  const req = request();
  const p = plan();
  const prepared = await f.ledger.prepare(req, p);
  await f.ledger.arm(armRow(req, prepared, p));
  const none = (kind) =>
    envelope(prepared, kind, {
      proofDigest: bootstrapTaskProof({
        outcome: "no_effect",
        taskScopeId: prepared.taskScopeId,
      }),
      outcome: "no_effect",
    });
  assert.equal(f.ledger.verify(none("task_proof"), context()), false);
  f.state.revoke = "refused";
  await assert.rejects(
    () => f.ledger.revoke(p.handoffId),
    /task_revoke_refused/,
  );
  assert.equal(f.ledger.verify(none("task_proof"), context()), false);
  f.state.revoke = "ok";
  await f.ledger.revoke(p.handoffId);
  await f.ledger.revoke(p.handoffId);
  assert.equal(f.sent.filter(([name]) => name === "revoke").length, 2);
  assert.equal(f.ledger.verify(none("task_proof"), context()), true);
  assert.equal(
    f.ledger.verify(
      envelope(
        prepared,
        "task.handoff",
        handoff(p, "native.create", "revoked"),
      ),
      context(),
    ),
    true,
  );
  await assert.rejects(() => f.ledger.revoke("unknown-handoff"));
});

test("a lost child clears nothing durable but revokes every verification; unconfirmed prepared results fail closed", async () => {
  const f = ledgerFixture();
  const req = request();
  const p = plan();
  const prepared = await f.ledger.prepare(req, p);
  f.state.live = false;
  await assert.rejects(() => f.ledger.arm(armRow(req, prepared, p)));
  f.ledger.clear();
  f.state.live = true;
  assert.equal(
    f.ledger.verify(
      envelope(prepared, "task.observe", {
        phase: "bound",
        launchId: "launch-1",
      }),
      context(),
    ),
    false,
  );
  // A prepared reply for a non-bootstrap request is a protocol fault.
  const bad = createNativeTaskLedger({
    runtimeEpoch: "epoch",
    isLive: () => true,
    channel: {
      prepare: async () => ({
        status: "prepared",
        taskScopeId: randomUUID(),
        locationId: randomUUID(),
        projectId: "p",
        modeGeneration: 1,
        inventoryGeneration: 1,
        launchId: "l",
      }),
    },
    onUnconfirmed: () => f.state.unconfirmed++,
  });
  await assert.rejects(() =>
    bad.prepare({
      originKind: "prompt",
      origin: {
        runtimeEpoch: "epoch",
        operationId: "prompt-op",
        type: "message.send",
        digest: "a".repeat(64),
      },
      workspaceId: "w",
      appSessionId: "a",
      nativeSessionId: "n",
      inputDigest: "b".repeat(64),
    }),
  );
  assert.equal(f.state.unconfirmed, 1);
});

test("the bounded table purges retired entries and refuses a seventeenth live task", async () => {
  const f = ledgerFixture();
  for (let index = 0; index < 16; index++)
    await f.ledger.prepare(
      request({ origin: { ...request().origin, operationId: `op-${index}` } }),
      plan(),
    );
  await assert.rejects(
    () =>
      f.ledger.prepare(
        request({ origin: { ...request().origin, operationId: "op-16" } }),
        plan(),
      ),
    /held/,
  );
});

// ---- startup reconciliation (read-only observation + verification) --------
const reconcileFixture = (over = {}) => {
  const state = { live: true, reads: [], answer: undefined, list: [] };
  const info = {
    id: "ses_1",
    projectID: "project",
    location: { directory: "/work" },
    metadata: {
      operationId: "op-1",
      originalRuntimeEpoch: "old",
      appSessionId: "app",
      workspaceId: "w",
      digest: "d".repeat(64),
    },
    permissions: [
      { action: "*", resource: "*", effect: "ask" },
      { action: "external_directory", resource: "*", effect: "deny" },
    ],
    title: "Title",
  };
  state.answer = info;
  const ledger = createNativeTaskLedger({
    runtimeEpoch: "now",
    isLive: () => state.live,
    channel: {},
    onUnconfirmed() {},
    readSession: async (sessionID) => {
      state.reads.push(sessionID);
      if (state.answer instanceof Error) throw state.answer;
      return state.answer;
    },
    listSessions: async () => {
      state.lists = (state.lists ?? 0) + 1;
      if (state.list instanceof Error) throw state.list;
      return state.list;
    },
    ...over,
  });
  const operation = {
    identity: {
      runtimeEpoch: "old",
      operationId: "op-1",
      type: "session.create",
      digest: "d".repeat(64),
      workspaceId: "w",
    },
    terminal: false,
    reservation: {
      appSessionId: "app",
      plannedNativeSessionId: "ses_1",
      workspace: { workspaceId: "w", canonicalPath: "/work" },
    },
  };
  const taskScopeId = randomUUID();
  const task = {
    identity: { originKind: "bootstrap", taskScopeId, projectId: "project" },
    binding: { step: "native.create" },
    phase: "bound",
    handoffs: [{ state: "armed" }],
    proof: null,
  };
  const record = (decision) => ({
    kind: "task_reconciled",
    runtimeEpoch: "old",
    operationId: "op-1",
    taskScopeId,
    ticketDigest: decision.ticketDigest,
    proofDigest: decision.proofDigest,
    outcome: decision.outcome,
    bootstrap: decision.bootstrap,
  });
  const registry = {
    sessions: [],
    workspaces: [{ workspaceId: "w", registrationState: "reserved" }],
  };
  const context = () => ({
    runtimeEpoch: "now",
    operation,
    task,
    reconcileState: registry,
  });
  return { state, ledger, operation, task, record, context, info, registry };
};
test("reconcile reads only the planned id and verifies exactly the decision it observed", async () => {
  const f = reconcileFixture();
  const decision = await f.ledger.reconcile({
    operation: f.operation,
    task: f.task,
    state: f.registry,
  });
  assert.deepEqual(f.state.reads, ["ses_1"]);
  assert.equal(decision.outcome, "settled");
  assert.equal(decision.bootstrap.title, "Title");
  assert.equal(f.ledger.verify(f.record(decision), f.context()), true);
  // Claims beyond what the observation proved are refused.
  for (const over of [
    { outcome: "no_effect", bootstrap: {} },
    { ticketDigest: "e".repeat(64) },
    { proofDigest: "e".repeat(64) },
    { taskScopeId: randomUUID() },
    { bootstrap: { ...decision.bootstrap, nativeSessionId: "ses_other" } },
  ])
    assert.equal(
      f.ledger.verify({ ...f.record(decision), ...over }, f.context()),
      false,
      JSON.stringify(over),
    );
  // Journal context that no longer matches the observed task is refused.
  assert.equal(
    f.ledger.verify(f.record(decision), {
      ...f.context(),
      task: { ...f.task, handoffs: [] },
    }),
    false,
  );
  // Authority dies with the live child and with clear().
  f.state.live = false;
  assert.equal(f.ledger.verify(f.record(decision), f.context()), false);
  f.state.live = true;
  assert.equal(f.ledger.verify(f.record(decision), f.context()), true);
  f.ledger.clear();
  assert.equal(f.ledger.verify(f.record(decision), f.context()), false);
});
test("reconcile maps only the typed not-found to no_effect and holds every other failure", async () => {
  const absent = reconcileFixture();
  absent.state.answer = Object.assign(new Error("absent"), {
    _tag: "SessionNotFoundError",
    sessionID: "ses_1",
  });
  const decision = await absent.ledger.reconcile({
    operation: absent.operation,
    task: absent.task,
    state: absent.registry,
  });
  assert.equal(decision.outcome, "no_effect");
  assert.equal(
    absent.ledger.verify(absent.record(decision), absent.context()),
    true,
  );
  for (const failure of [
    new Error("boom"),
    Object.assign(new Error("x"), {
      _tag: "SessionNotFoundError",
      sessionID: "ses_other",
    }),
    Object.assign(new Error("x"), { status: 404 }),
  ]) {
    const f = reconcileFixture();
    f.state.answer = failure;
    await assert.rejects(
      f.ledger.reconcile({ operation: f.operation, task: f.task }),
      {
        message: "task_preparation_held",
      },
    );
  }
  // Not live, no reader, or an unrecognised journal trail: nothing is read.
  const dead = reconcileFixture();
  dead.state.live = false;
  await assert.rejects(
    dead.ledger.reconcile({ operation: dead.operation, task: dead.task }),
  );
  assert.deepEqual(dead.state.reads, []);
  const noReader = reconcileFixture({ readSession: undefined });
  await assert.rejects(
    noReader.ledger.reconcile({
      operation: noReader.operation,
      task: noReader.task,
    }),
  );
  const odd = reconcileFixture();
  await assert.rejects(
    odd.ledger.reconcile({
      operation: odd.operation,
      task: { ...odd.task, handoffs: [{ state: "armed" }, { state: "armed" }] },
    }),
  );
  assert.deepEqual(odd.state.reads, []);
});

const gone = (id = "ses_1") =>
  Object.assign(new Error("absent"), {
    _tag: "SessionNotFoundError",
    sessionID: id,
  });
test("reconcile confirms a typed not-found with a complete scan and holds without it", async () => {
  const plain = async (f) =>
    f.ledger.reconcile({
      operation: f.operation,
      task: f.task,
      state: f.registry,
    });
  // The scan must lack the id too (a get that lies cannot prove absence).
  const listed = reconcileFixture();
  listed.state.answer = gone();
  listed.state.list = [{ id: "ses_1" }];
  await assert.rejects(plain(listed), { message: "task_preparation_held" });
  // Scan failure, missing scanner, id-less not-found: held, never no_effect.
  const broken = reconcileFixture();
  broken.state.answer = gone();
  broken.state.list = new Error("scan failed");
  await assert.rejects(plain(broken), { message: "scan failed" });
  const noScanner = reconcileFixture({ listSessions: undefined });
  noScanner.state.answer = gone();
  await assert.rejects(plain(noScanner), { message: "task_preparation_held" });
  const anonymous = reconcileFixture();
  anonymous.state.answer = Object.assign(new Error("absent"), {
    _tag: "SessionNotFoundError",
  });
  await assert.rejects(plain(anonymous), { message: "task_preparation_held" });
  const ok = reconcileFixture();
  ok.state.answer = gone();
  ok.state.list = [{ id: "ses_other" }];
  assert.equal((await plain(ok)).outcome, "no_effect");
  assert.equal(ok.state.lists, 1);
});
test("reconcile of an absent workspace create/import resolves only a still-reserved workspace", async () => {
  for (const type of ["workspace.create", "workspace.import"]) {
    const reserved = reconcileFixture();
    reserved.operation.identity.type = type;
    reserved.state.answer = gone();
    const decision = await reserved.ledger.reconcile({
      operation: reserved.operation,
      task: reserved.task,
      state: reserved.registry,
    });
    assert.equal(decision.outcome, "no_effect");
    assert.equal(
      reserved.ledger.verify(reserved.record(decision), reserved.context()),
      true,
    );
    // An unavailable or missing workspace row cannot be registered: hold.
    for (const workspaces of [
      [{ workspaceId: "w", registrationState: "unavailable" }],
      [],
    ]) {
      const f = reconcileFixture();
      f.operation.identity.type = type;
      f.state.answer = gone();
      f.registry.workspaces = workspaces;
      const held = await f.ledger.reconcile({
        operation: f.operation,
        task: f.task,
        state: f.registry,
      });
      assert.equal(held.outcome, "hold");
      assert.equal(f.ledger.verify(f.record(held), f.context()), false);
    }
    // A registry that changed after the observation no longer verifies.
    reserved.registry.workspaces = [
      { workspaceId: "w", registrationState: "unavailable" },
    ];
    assert.equal(
      reserved.ledger.verify(reserved.record(decision), reserved.context()),
      false,
    );
  }
});

const forkFixture = (over = {}) => {
  const f = reconcileFixture(over);
  const permissions = [
    { action: "*", resource: "*", effect: "ask" },
    { action: "external_directory", resource: "*", effect: "deny" },
  ];
  const parent = {
    id: "ses_parent",
    projectID: "project",
    location: { directory: "/work" },
    metadata: { operationId: "op-0", digest: "a".repeat(64) },
    permissions,
    title: "Parent",
  };
  const child = (extra = {}) => ({
    id: "ses_child",
    projectID: "project",
    location: { directory: "/work" },
    parentID: "ses_parent",
    fork: {
      sessionID: "ses_parent",
      boundary: { type: "before", messageID: "msg_1" },
    },
    metadata: { ...parent.metadata },
    permissions,
    title: "Child",
    time: { created: 200_000 },
    ...extra,
  });
  f.operation.identity = {
    runtimeEpoch: "old",
    operationId: "op-1",
    type: "session.fork",
    digest: "d".repeat(64),
    workspaceId: "w",
    sessionId: "app-parent",
  };
  f.operation.forkTarget = { beforeMessageId: "msg_1" };
  f.operation.dispatches = [
    { step: "native.fork", nativeSessionId: "ses_parent" },
  ];
  delete f.operation.reservation.plannedNativeSessionId;
  f.task.binding = {
    step: "native.fork",
    parentIdentityDigest: bootstrapParentDigest({
      id: "ses_parent",
      projectID: "project",
      directory: "/work",
    }),
  };
  f.registry.sessions = [
    {
      appSessionId: "app-parent",
      workspaceId: "w",
      nativeSessionId: "ses_parent",
      lifecycleState: "active",
    },
  ];
  f.state.answer = parent;
  f.state.list = [parent, child()];
  const run = () =>
    f.ledger.reconcile({
      operation: f.operation,
      task: f.task,
      state: f.registry,
    });
  return { ...f, parent, child, run };
};
test("reconcile of a fork settles exactly one child carrying the parent's metadata and baseline", async () => {
  for (const handoff of ["armed", "consumed", "completed"]) {
    const f = forkFixture();
    f.task.handoffs = [{ state: handoff, armedAt: 100_000 }];
    const decision = await f.run();
    assert.deepEqual(f.state.reads, ["ses_parent"]);
    assert.equal(decision.outcome, "settled");
    assert.equal(decision.bootstrap.nativeSessionId, "ses_child");
    assert.equal(decision.bootstrap.appSessionId, "app");
    assert.equal(decision.bootstrap.title, "Child");
    assert.equal(f.ledger.verify(f.record(decision), f.context()), true);
    for (const over of [
      { outcome: "no_effect", bootstrap: {} },
      { bootstrap: { ...decision.bootstrap, nativeSessionId: "ses_other" } },
      { proofDigest: "e".repeat(64) },
    ])
      assert.equal(
        f.ledger.verify({ ...f.record(decision), ...over }, f.context()),
        false,
      );
    // The registry state judged at decision time must be the verified one.
    f.registry.sessions.push({
      appSessionId: "x",
      workspaceId: "w",
      nativeSessionId: "ses_child",
    });
    assert.equal(f.ledger.verify(f.record(decision), f.context()), false);
  }
});
test("reconcile of a fork with no child proves no effect only for an unconsumed trail", async () => {
  for (const [handoffs, outcome] of [
    [[], "no_effect"],
    [[{ state: "armed", armedAt: 100_000 }], "no_effect"],
    [[{ state: "revoked", armedAt: 100_000 }], "no_effect"],
    [[{ state: "consumed", armedAt: 100_000 }], "hold"],
    [[{ state: "completed", armedAt: 100_000 }], "hold"],
  ]) {
    const f = forkFixture();
    f.task.handoffs = handoffs;
    f.state.list = [f.parent];
    const decision = await f.run();
    assert.equal(decision.outcome, outcome, JSON.stringify(handoffs));
    if (outcome === "no_effect")
      assert.equal(f.ledger.verify(f.record(decision), f.context()), true);
  }
  // A bound task, or this operation's own partial mapping, contradicts absence.
  const bound = forkFixture();
  bound.task.identity = {
    ...bound.task.identity,
    appSessionId: "app",
    nativeSessionId: "ses_child",
  };
  bound.state.list = [bound.parent];
  assert.equal((await bound.run()).outcome, "hold");
  const partial = forkFixture();
  partial.registry.sessions.push({
    appSessionId: "app",
    workspaceId: "w",
    nativeSessionId: "ses_child",
    lifecycleState: "unavailable",
  });
  partial.state.list = [partial.parent];
  assert.equal((await partial.run()).outcome, "hold");
  // Plain subagents and already-mapped children are not this fork.
  const others = forkFixture();
  others.registry.sessions.push({
    appSessionId: "mapped",
    workspaceId: "w",
    nativeSessionId: "ses_mapped",
  });
  others.state.list = [
    others.parent,
    others.child({ id: "ses_sub", fork: null }),
    others.child({ id: "ses_mapped" }),
  ];
  assert.equal((await others.run()).outcome, "no_effect");
});
const registered = (text = "rules") => ({
  state: "registered",
  key: INSTRUCTION_KEY,
  digest: instructionDigest(text),
  sourceVersion: "b".repeat(64),
  origin: "direct",
});
const forkTampered = {
  "two matching children": (f) => {
    f.state.list.push(f.child({ id: "ses_child2" }));
  },
  "metadata drift": (f) => {
    f.state.list[1] = f.child({ metadata: { operationId: "other" } });
  },
  "permissions differ": (f) => {
    f.state.list[1] = f.child({
      permissions: [{ action: "*", resource: "*", effect: "allow" }],
    });
  },
  "floor not last": (f) => {
    f.state.list[1] = f.child({
      permissions: [...f.parent.permissions].reverse(),
    });
    f.state.answer = {
      ...f.parent,
      permissions: [...f.parent.permissions].reverse(),
    };
  },
  "other boundary": (f) => {
    f.state.list[1] = f.child({
      fork: {
        sessionID: "ses_parent",
        boundary: { type: "before", messageID: "msg_2" },
      },
    });
  },
  "other directory": (f) => {
    f.state.list[1] = f.child({ location: { directory: "/elsewhere" } });
  },
  "other project": (f) => {
    f.state.list[1] = f.child({ projectID: "other" });
  },
  "a different id than the bound one": (f) => {
    f.task.identity = {
      ...f.task.identity,
      appSessionId: "app",
      nativeSessionId: "ses_bound",
    };
  },
  "an unreadable child row": (f) => {
    f.state.list.push({
      id: "ses_junk",
      parentID: "ses_parent",
      permissions: 7,
    });
  },
  "a changed parent identity": (f) => {
    f.state.answer = { ...f.parent, location: { directory: "/moved" } };
  },
  "a malformed parent registration": (f) => {
    f.registry.sessions[0].instructionRegistration = { state: "registered" };
  },
  "an unmapped parent": (f) => {
    f.registry.sessions = [];
  },
};
for (const [name, mutate] of Object.entries(forkTampered))
  test(`reconcile of a fork holds with ${name}`, async () => {
    const f = forkFixture();
    f.task.handoffs = [{ state: "armed", armedAt: 100_000 }];
    mutate(f);
    let decision;
    try {
      decision = await f.run();
    } catch {
      return; // a read error holds by throwing
    }
    assert.equal(decision.outcome, "hold");
    assert.equal(f.ledger.verify(f.record(decision), f.context()), false);
  });
test("reconcile of a fork with a registered parent settles with only get/list reads", async () => {
  const f = forkFixture();
  f.task.handoffs = [{ state: "armed", armedAt: 100_000 }];
  f.registry.sessions[0].instructionRegistration = registered();
  const decision = await f.run();
  assert.equal(decision.outcome, "settled");
  assert.deepEqual(f.state.reads, ["ses_parent"]);
  assert.equal(f.state.lists, 1);
  assert.equal(f.ledger.verify(f.record(decision), f.context()), true);
});
test("reconcile of a fork ignores children created before the durable arm", async () => {
  const at = (created) => ({ time: { created } });
  const armed = [{ state: "armed", armedAt: 100_000 }];
  // Orphan fork of the same parent from before the arm; crash before the fork.
  const orphan = forkFixture();
  orphan.task.handoffs = armed;
  orphan.operation.forkTarget = {};
  orphan.state.list = [orphan.parent, orphan.child({ ...at(1_000) })];
  // A pre-arm child that matches exactly may still be ours if the wall clock
  // stepped back: it never proves absence.
  assert.equal((await orphan.run()).outcome, "hold");
  // A pre-arm session that is not an exact fork of this parent can be ignored.
  const stranger = forkFixture();
  stranger.task.handoffs = armed;
  stranger.operation.forkTarget = {};
  stranger.state.list = [
    stranger.parent,
    stranger.child({ ...at(1_000), projectID: "other" }),
  ];
  const none = await stranger.run();
  assert.equal(none.outcome, "no_effect");
  assert.equal(
    stranger.ledger.verify(stranger.record(none), stranger.context()),
    true,
  );
  // The real post-arm child settles even beside an old orphan.
  const both = forkFixture();
  both.task.handoffs = armed;
  both.operation.forkTarget = {};
  both.state.list = [
    both.parent,
    both.child({ id: "ses_old", ...at(1_000) }),
    both.child({ ...at(100_001) }),
  ];
  const settled = await both.run();
  assert.equal(settled.outcome, "settled");
  assert.equal(settled.bootstrap.nativeSessionId, "ses_child");
  // Inside the skew window before the arm, or with no creation time: ambiguous.
  for (const extra of [at(98_000), { time: {} }, at(100_000 - 1)]) {
    const f = forkFixture();
    f.task.handoffs = armed;
    f.operation.forkTarget = {};
    f.state.list = [f.parent, f.child({ ...extra })];
    assert.equal((await f.run()).outcome, "hold", JSON.stringify(extra));
  }
  // An unbound fork with no arm time cannot be proven ours, before or not.
  for (const forkTarget of [{}, { beforeMessageId: "msg_1" }]) {
    const legacy = forkFixture();
    legacy.task.handoffs = [{ state: "armed" }];
    legacy.operation.forkTarget = forkTarget;
    assert.equal((await legacy.run()).outcome, "hold");
  }
});
test("reconcile of a fork never settles from a never-armed trail and holds every read error", async () => {
  const unarmed = forkFixture();
  unarmed.task.handoffs = [];
  assert.equal((await unarmed.run()).outcome, "hold");
  const revoked = forkFixture();
  revoked.task.handoffs = [{ state: "revoked", armedAt: 100_000 }];
  assert.equal((await revoked.run()).outcome, "hold");
  for (const make of [
    (f) => (f.state.answer = gone("ses_parent")),
    (f) => (f.state.answer = new Error("boom")),
    (f) => (f.state.list = new Error("scan failed")),
  ]) {
    const f = forkFixture();
    make(f);
    await assert.rejects(f.run());
  }
  const huge = forkFixture();
  huge.state.list = [
    huge.parent,
    ...Array.from({ length: 65 }, (_, i) => huge.child({ id: `ses_c${i}` })),
  ];
  await assert.rejects(huge.run(), { message: "task_preparation_held" });
});
