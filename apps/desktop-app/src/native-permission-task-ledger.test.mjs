import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createNativeTaskLedger } from "./native-permission-task-ledger.mjs";
import {
  bootstrapHandoffProof,
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
  const state = { live: true, reads: [], answer: undefined };
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
  const context = () => ({ runtimeEpoch: "now", operation, task });
  return { state, ledger, operation, task, record, context, info };
};
test("reconcile reads only the planned id and verifies exactly the decision it observed", async () => {
  const f = reconcileFixture();
  const decision = await f.ledger.reconcile(
    f.operation && { operation: f.operation, task: f.task },
  );
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
