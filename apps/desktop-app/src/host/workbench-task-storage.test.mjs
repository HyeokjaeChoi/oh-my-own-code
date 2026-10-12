import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { validateJournalPayload } from "./storage-journal.mjs";

const prepare = () => {
  const taskScopeId = randomUUID();
  return {
    kind: "task.prepare",
    revision: 3,
    runtimeEpoch: "epoch",
    operationId: "send",
    taskScopeId,
    sequence: 0,
    identity: {
      taskScopeId,
      origin: {
        runtimeEpoch: "epoch",
        operationId: "send",
        type: "message.send",
        digest: "a".repeat(64),
      },
      workspaceId: "workspace",
      appSessionId: "session",
      nativeSessionId: "native",
      projectId: "project",
      locationId: randomUUID(),
      modeGeneration: 1,
      inventoryGeneration: 1,
      originKind: "prompt",
    },
    binding: {
      kind: "prompt",
      nativeSessionId: "native",
      inboxId: "inbox",
      inputDigest: "b".repeat(64),
    },
  };
};

test("TASK actual parser accepts detached closed task prepare", () => {
  const input = prepare();
  const result = validateJournalPayload(input);
  assert.deepEqual(result, input);
  input.identity.origin.digest = "c".repeat(64);
  assert.equal(result.identity.origin.digest, "a".repeat(64));
});

import {
  TASK_LIMITS,
  TASK_NATIVE_STEPS,
  validateTaskIdentity,
  validateTaskBinding,
  validateTaskHandoffIdentity,
  validateTaskRecord,
  applyTaskRecord,
  taskBindingDigest,
  taskReservationDigest,
} from "./workbench-task-storage.mjs";
function machine() {
  const initial = prepare(),
    tasks = new Map();
  const op = {
    identity: {
      ...initial.identity.origin,
      workspaceId: "workspace",
      sessionId: "session",
    },
    dispatches: [{ step: "native.send" }],
    terminal: false,
  };
  const sessions = new Map([
    [
      "session",
      {
        appSessionId: "session",
        workspaceId: "workspace",
        nativeSessionId: "native",
      },
    ],
  ]);
  let revision = 3;
  const append = (kind, rest = {}) => {
    const task = tasks.values().next().value;
    return applyTaskRecord(
      tasks,
      op,
      {
        kind,
        runtimeEpoch: "epoch",
        operationId: "send",
        taskScopeId: initial.taskScopeId,
        revision: ++revision,
        sequence: task.sequence + 1,
        ...rest,
      },
      sessions,
    );
  };
  applyTaskRecord(tasks, op, initial, sessions);
  const bound = () =>
    append("task.observe", { phase: "bound", launchId: "launch" });
  const promote = () =>
    append("task.input-transition", {
      inboxId: "inbox",
      from: "pending",
      to: "promoted",
      scopeId: "scope",
      scopeVersion: 1,
      proofDigest: "c".repeat(64),
    });
  const running = () =>
    append("task.observe", {
      phase: "running",
      launchId: "launch",
      scopeId: "scope",
      scopeVersion: 1,
      leaseId: "lease",
    });
  const cancel = () =>
    append("task.input-transition", {
      inboxId: "inbox",
      from: "pending",
      to: "cancelled",
      proofDigest: "c".repeat(64),
    });
  const settleInput = () =>
    append("task.input-transition", {
      inboxId: "inbox",
      from: "promoted",
      to: "settled",
      scopeId: "scope",
      scopeVersion: 1,
      proofDigest: "c".repeat(64),
    });
  const task = () => tasks.values().next().value;
  const proof = (outcome) =>
    append("task_proof", {
      proofDigest: "d".repeat(64),
      outcome,
      lastActivitySequence: task().sequence,
    });
  return {
    initial,
    tasks,
    op,
    sessions,
    append,
    bound,
    promote,
    running,
    cancel,
    settleInput,
    proof,
    task,
  };
}
for (const [name, mutate] of Object.entries({
  extra: (v) => (v.extra = true),
  symbol: (v) => (v[Symbol("extra")] = true),
  undefined: (v) => (v.identity.projectId = undefined),
  accessor: (v) =>
    Object.defineProperty(v.identity, "projectId", {
      enumerable: true,
      get() {
        throw Error("must not execute");
      },
    }),
  hidden: (v) =>
    Object.defineProperty(v.identity, "projectId", {
      value: "project",
      enumerable: false,
    }),
  proxy: (v) => (v.identity = new Proxy(v.identity, {})),
  unsafe: (v) => (v.sequence = Number.MAX_SAFE_INTEGER + 1),
  negativeZero: (v) => (v.sequence = -0),
  badUUID: (v) => (v.taskScopeId = "not-uuid"),
  numericLocation: (v) => (v.identity.locationId = 1),
  zeroGeneration: (v) => (v.identity.modeGeneration = 0),
  missingParent: (v) =>
    (v.binding = {
      kind: "bootstrap",
      step: "native.fork",
      reservationDigest: "a".repeat(64),
      parentIdentityDigest: null,
    }),
}))
  test(`TASK closed producer rejects ${name}`, () => {
    const v = prepare();
    mutate(v);
    assert.throws(() => validateTaskRecord(v), { code: "invalid_record" });
  });

test("TASK shared identity/handoff validators detach and preserve exact native stages; binding digest uses required domain", () => {
  const v = prepare();
  assert.deepEqual(validateTaskIdentity(v.identity), v.identity);
  assert.deepEqual(validateTaskBinding(v.binding), v.binding);
  assert.equal(taskBindingDigest(v.binding).length, 64);
  assert.notEqual(
    taskBindingDigest(v.binding),
    taskBindingDigest({ ...v.binding, inboxId: "other" }),
  );
  for (const step of [
    "native.policy.before_selection",
    "native.policy.after_selection",
    "native.send",
  ]) {
    assert.ok(TASK_NATIVE_STEPS.includes(step));
    assert.equal(
      validateTaskHandoffIdentity({
        handoffId: randomUUID(),
        step,
        stageArgumentDigest: "a".repeat(64),
      }).step,
      step,
    );
  }
  assert.throws(
    () =>
      validateTaskHandoffIdentity({
        handoffId: randomUUID(),
        step: "native.fake",
        stageArgumentDigest: "a".repeat(64),
      }),
    { code: "invalid_record" },
  );
});

test("TASK pending owner transitions are exclusive, scope-bound and cannot settle pending or promoted input", () => {
  const f = machine();
  f.bound();
  assert.throws(() => f.proof("no_effect"), { code: "identity_conflict" });
  f.promote();
  assert.throws(f.cancel, { code: "identity_conflict" });
  assert.throws(() => f.proof("settled"), { code: "identity_conflict" });
  f.running();
  assert.throws(
    () =>
      f.append("task.input-transition", {
        inboxId: "inbox",
        from: "promoted",
        to: "settled",
        scopeId: "foreign",
        scopeVersion: 1,
        proofDigest: "c".repeat(64),
      }),
    { code: "identity_conflict" },
  );
  f.settleInput();
  assert.throws(() => f.proof("no_effect"), { code: "identity_conflict" });
  f.proof("settled");
  assert.throws(
    () =>
      f.append("task.input", {
        nativeSessionId: "native",
        inboxId: "late",
        inputDigest: "a".repeat(64),
        source: "prompt",
        parentLeaseId: null,
        state: "pending",
      }),
    { code: "identity_conflict" },
  );
  assert.throws(
    () =>
      f.append("task.settle", {
        proofDigest: "f".repeat(64),
        outcome: "settled",
      }),
    { code: "identity_conflict" },
  );
  f.append("task.settle", { proofDigest: "d".repeat(64), outcome: "settled" });
  assert.throws(
    () =>
      f.append("task.observe", {
        phase: "running",
        launchId: "launch",
        scopeId: "scope",
        scopeVersion: 1,
        leaseId: "lease",
      }),
    { code: "identity_conflict" },
  );
});

test("TASK handoffs require exact transitions and block proof until durable completion", () => {
  const f = machine();
  f.bound();
  const handoff = {
    handoffId: randomUUID(),
    step: "native.send",
    stageArgumentDigest: "b".repeat(64),
    proofDigest: "c".repeat(64),
  };
  f.append("task.handoff", { ...handoff, state: "armed" });
  f.cancel();
  assert.throws(() => f.proof("no_effect"), { code: "identity_conflict" });
  assert.throws(
    () => f.append("task.handoff", { ...handoff, state: "completed" }),
    { code: "identity_conflict" },
  );
  assert.throws(
    () =>
      f.append("task.handoff", {
        ...handoff,
        state: "consumed",
        stageArgumentDigest: "d".repeat(64),
      }),
    { code: "identity_conflict" },
  );
  f.append("task.handoff", { ...handoff, state: "consumed" });
  assert.throws(
    () => f.append("task.handoff", { ...handoff, state: "revoked" }),
    { code: "identity_conflict" },
  );
  f.append("task.handoff", { ...handoff, state: "completed" });
  f.proof("no_effect");
  f.append("task.settle", {
    proofDigest: "d".repeat(64),
    outcome: "no_effect",
  });
});

test("TASK unverified has no ordinary escape; reconciliation needs exact durable complete proof", () => {
  const f = machine();
  f.bound();
  f.cancel();
  f.proof("no_effect");
  f.append("task.observe", {
    phase: "unverified",
    launchId: "launch",
    reason: "ipc_loss",
  });
  assert.throws(
    () =>
      f.append("task.settle", {
        proofDigest: "d".repeat(64),
        outcome: "no_effect",
      }),
    { code: "identity_conflict" },
  );
  assert.throws(
    () =>
      f.append("task_reconciled", {
        ticketDigest: "e".repeat(64),
        proofDigest: "c".repeat(64),
        outcome: "no_effect",
      }),
    { code: "identity_conflict" },
  );
  f.append("task_reconciled", {
    ticketDigest: "e".repeat(64),
    proofDigest: "d".repeat(64),
    outcome: "no_effect",
  });
  const unproved = machine();
  unproved.bound();
  unproved.append("task.observe", {
    phase: "unverified",
    launchId: "launch",
    reason: "ipc_loss",
  });
  assert.throws(
    () =>
      unproved.append("task_reconciled", {
        ticketDigest: "e".repeat(64),
        proofDigest: "d".repeat(64),
        outcome: "no_effect",
      }),
    { code: "identity_conflict" },
  );
});

test("TASK synthetic lineage and reused input IDs fail closed; multiple inputs share one sequence", () => {
  const f = machine();
  f.bound();
  f.promote();
  f.running();
  const input = {
    nativeSessionId: "native",
    inboxId: "child",
    inputDigest: "a".repeat(64),
    source: "synthetic_child",
    parentLeaseId: "lease",
    state: "pending",
  };
  assert.throws(
    () => f.append("task.input", { ...input, parentLeaseId: "foreign" }),
    { code: "identity_conflict" },
  );
  f.append("task.input", input);
  assert.equal(f.task().sequence, 4);
  assert.throws(() => f.append("task.input", input), {
    code: "identity_conflict",
  });
  assert.throws(
    () =>
      f.append("task.observe", {
        phase: "running",
        launchId: "foreign",
        scopeId: "scope",
        scopeVersion: 1,
        leaseId: "lease",
      }),
    { code: "identity_conflict" },
  );
});

test("TASK safe counters, input/history/root bounds refuse before candidate mutation", () => {
  for (const mode of ["sequence", "history", "inputs", "roots", "unsettled"]) {
    const f = machine();
    f.bound();
    if (mode === "sequence")
      assert.throws(
        () =>
          f.append("task.observe", {
            phase: "running",
            launchId: "launch",
            scopeId: "scope",
            scopeVersion: 1,
            leaseId: "lease",
            sequence: Number.MAX_SAFE_INTEGER + 1,
          }),
        { code: "invalid_record" },
      );
    if (mode === "history") {
      f.task().records = Array(TASK_LIMITS.history).fill(f.initial);
      assert.throws(f.cancel, { code: "identity_conflict" });
    }
    if (mode === "inputs") {
      f.task().inputs = Array(TASK_LIMITS.inputs).fill(f.task().inputs[0]);
      assert.throws(
        () =>
          f.append("task.input", {
            nativeSessionId: "native",
            inboxId: "more",
            inputDigest: "a".repeat(64),
            source: "prompt",
            parentLeaseId: null,
            state: "pending",
          }),
        { code: "identity_conflict" },
      );
    }
    if (["roots", "unsettled"].includes(mode)) {
      const roots = new Map(
        Array.from(
          {
            length:
              mode === "roots" ? TASK_LIMITS.roots : TASK_LIMITS.unsettled,
          },
          (_, i) => [
            String(i),
            { ...f.task(), phase: mode === "roots" ? "settled" : "prepared" },
          ],
        ),
      );
      assert.throws(() => applyTaskRecord(roots, f.op, f.initial, f.sessions), {
        code: "retained_limit",
      });
    }
  }
});

test("TASK shared native step checkpoint matches current journal native dispatch allowlist", async () => {
  const { DISPATCH_STEPS } = await import("./storage-journal.mjs");
  assert.deepEqual(
    [...TASK_NATIVE_STEPS].sort(),
    DISPATCH_STEPS.filter((step) => step.startsWith("native.")).sort(),
  );
});
test("TASK bootstrap reservation binds exactly once before real session authority; no fabricated prompt", () => {
  const original = prepare();
  original.identity.originKind = "bootstrap";
  original.identity.origin.type = "session.create";
  delete original.identity.appSessionId;
  delete original.identity.nativeSessionId;
  original.binding = {
    kind: "bootstrap",
    step: "native.create",
    reservationDigest: "a".repeat(64),
    parentIdentityDigest: null,
  };
  const operation = {
    identity: { ...original.identity.origin, workspaceId: "workspace" },
    dispatches: [{ step: "native.create" }],
    terminal: false,
    reservation: {
      workspace: { workspaceId: "workspace" },
      appSessionId: "reserved",
    },
  };
  // A same-workspace/stage reservation with a forged digest must fail closed.
  assert.throws(
    () => applyTaskRecord(new Map(), operation, original, new Map()),
    { code: "identity_conflict" },
  );
  original.binding.reservationDigest = taskReservationDigest(
    operation.reservation,
  );
  for (const reservation of [
    { ...operation.reservation, appSessionId: "substituted" },
    { ...operation.reservation, extra: "unbound-field" },
    { workspace: operation.reservation.workspace },
  ]) {
    assert.throws(
      () =>
        applyTaskRecord(
          new Map(),
          { ...operation, reservation },
          original,
          new Map(),
        ),
      { code: "identity_conflict" },
    );
  }
  assert.equal(
    taskReservationDigest({
      appSessionId: operation.reservation.appSessionId,
      workspace: operation.reservation.workspace,
    }),
    original.binding.reservationDigest,
  );
  const tasks = new Map();
  applyTaskRecord(tasks, operation, original, new Map());
  const append = (sequence, kind, fields) =>
    applyTaskRecord(
      tasks,
      operation,
      {
        kind,
        runtimeEpoch: "epoch",
        operationId: "send",
        taskScopeId: original.taskScopeId,
        revision: 4 + sequence,
        sequence,
        ...fields,
      },
      new Map(),
    );
  append(1, "task.observe", { phase: "bound", launchId: "launch" });
  assert.throws(
    () =>
      append(2, "task.bootstrap-binding", {
        appSessionId: "foreign",
        nativeSessionId: "created",
        metadataDigest: "a".repeat(64),
      }),
    { code: "identity_conflict" },
  );
  append(2, "task.bootstrap-binding", {
    appSessionId: "reserved",
    nativeSessionId: "created",
    metadataDigest: "a".repeat(64),
  });
  const task = tasks.values().next().value;
  assert.equal(validateTaskIdentity(task.identity).nativeSessionId, "created");
  assert.throws(
    () =>
      append(3, "task.bootstrap-binding", {
        appSessionId: "reserved",
        nativeSessionId: "changed",
        metadataDigest: "a".repeat(64),
      }),
    { code: "identity_conflict" },
  );
  assert.throws(
    () =>
      append(3, "task.input", {
        nativeSessionId: "created",
        inboxId: "fake",
        inputDigest: "b".repeat(64),
        source: "prompt",
        parentLeaseId: null,
        state: "pending",
      }),
    { code: "identity_conflict" },
  );
});
function bootstrapMachine(step = "native.create") {
  const original = prepare();
  original.identity.originKind = "bootstrap";
  original.identity.origin.type =
    step === "native.create" ? "session.create" : "session.fork";
  delete original.identity.appSessionId;
  delete original.identity.nativeSessionId;
  const operation = {
    identity: { ...original.identity.origin, workspaceId: "workspace" },
    dispatches: [{ step }],
    terminal: false,
    reservation: {
      workspace: { workspaceId: "workspace" },
      appSessionId: "reserved",
    },
  };
  original.binding = {
    kind: "bootstrap",
    step,
    reservationDigest: taskReservationDigest(operation.reservation),
    parentIdentityDigest: step === "native.create" ? null : "e".repeat(64),
  };
  const tasks = new Map();
  applyTaskRecord(tasks, operation, original, new Map());
  // Rejected records must not advance the sequence the next append expects.
  const append = (kind, fields) => {
    const sequence = tasks.values().next().value.sequence + 1;
    return applyTaskRecord(
      tasks,
      operation,
      {
        kind,
        runtimeEpoch: "epoch",
        operationId: "send",
        taskScopeId: original.taskScopeId,
        revision: 4 + sequence,
        sequence,
        ...fields,
      },
      new Map(),
    );
  };
  const handoff = (state) =>
    append("task.handoff", {
      handoffId: "5f1c2a40-1b7e-4c1a-8d33-0f5e5b9d3a11",
      step,
      stageArgumentDigest: "1".repeat(64),
      state,
      proofDigest: "2".repeat(64),
    });
  const bind = () =>
    append("task.bootstrap-binding", {
      appSessionId: "reserved",
      nativeSessionId: "created",
      metadataDigest: "a".repeat(64),
    });
  const proof = (outcome) =>
    append("task_proof", {
      proofDigest: "3".repeat(64),
      outcome,
      lastActivitySequence: tasks.values().next().value.sequence,
    });
  const settle = (outcome) =>
    append("task.settle", { proofDigest: "3".repeat(64), outcome });
  const bound = () =>
    append("task.observe", { phase: "bound", launchId: "launch" });
  return {
    tasks,
    task: () => tasks.values().next().value,
    handoff,
    bind,
    proof,
    settle,
    bound,
    append,
  };
}
for (const step of ["native.create", "native.fork"])
  test(`TASK ${step} bootstrap settles created from bound only with a completed handoff and the session binding`, () => {
    const f = bootstrapMachine(step);
    f.bound();
    f.handoff("armed");
    // Armed/consumed handoffs are open; the proof cannot skip them.
    assert.throws(() => f.proof("settled"), { code: "identity_conflict" });
    f.handoff("consumed");
    assert.throws(() => f.proof("settled"), { code: "identity_conflict" });
    f.handoff("completed");
    // Completed handoff alone is not enough: the durable binding is required.
    assert.throws(() => f.proof("settled"), { code: "identity_conflict" });
    f.bind();
    assert.equal(f.task().phase, "bound");
    f.proof("settled");
    // A settled proof is never a no-effect proof and cannot be changed.
    assert.throws(() => f.proof("no_effect"), { code: "identity_conflict" });
    assert.throws(() => f.settle("no_effect"), { code: "identity_conflict" });
    f.settle("settled");
    assert.equal(f.task().phase, "settled");
    assert.equal(
      validateTaskIdentity(f.task().identity).nativeSessionId,
      "created",
    );
  });
test("TASK bootstrap settled proof refuses a revoked handoff, a missing observe and non-bootstrap origins", () => {
  const revoked = bootstrapMachine();
  revoked.bound();
  revoked.handoff("armed");
  revoked.handoff("revoked");
  revoked.bind();
  assert.throws(() => revoked.proof("settled"), { code: "identity_conflict" });
  // The no-effect path stays: armed -> revoked -> proof -> settle.
  const none = bootstrapMachine();
  none.bound();
  none.handoff("armed");
  assert.throws(() => none.proof("no_effect"), { code: "identity_conflict" });
  none.handoff("revoked");
  none.proof("no_effect");
  none.settle("no_effect");
  assert.equal(none.task().phase, "settled");
  // Prepared (never observed bound) cannot be proven settled.
  const prepared = bootstrapMachine();
  prepared.bind();
  assert.throws(() => prepared.proof("settled"), { code: "identity_conflict" });
  // A prompt task still needs a running/cancelling phase for a settled proof.
  const prompt = machine();
  prompt.bound();
  assert.throws(() => prompt.proof("settled"), { code: "identity_conflict" });
});
test("TASK command bindings carry command digest and actual expanded input; mutation cannot borrow prompt authority", () => {
  for (const kind of ["command", "mutation"]) {
    const initial = prepare();
    initial.identity.originKind = kind;
    if (kind === "mutation") initial.identity.targetKind = "session";
    initial.identity.origin.type =
      kind === "command" ? "command.run" : "session.rename";
    initial.binding =
      kind === "command"
        ? { kind: "command", commandDigest: "e".repeat(64) }
        : {
            kind: "mutation",
            targetKind: "session",
            affectedSessionIds: ["native"],
            affectedProjectIds: ["project"],
            step: "native.rename",
            targetDigest: "e".repeat(64),
            stageArgumentDigest: "f".repeat(64),
          };
    const operation = {
      identity: {
        ...initial.identity.origin,
        workspaceId: "workspace",
        sessionId: "session",
      },
      dispatches: [
        { step: kind === "command" ? "native.command" : "native.rename" },
      ],
      terminal: false,
    };
    const sessions = new Map([
        ["session", { workspaceId: "workspace", nativeSessionId: "native" }],
      ]),
      tasks = new Map();
    applyTaskRecord(tasks, operation, initial, sessions);
    const event = {
      kind: "task.input",
      runtimeEpoch: "epoch",
      operationId: "send",
      taskScopeId: initial.taskScopeId,
      revision: 4,
      sequence: 1,
      nativeSessionId: "native",
      inboxId: "expanded",
      inputDigest: "b".repeat(64),
      source: "command_expansion",
      parentLeaseId: null,
      state: "pending",
    };
    if (kind === "command") {
      applyTaskRecord(tasks, operation, event, sessions);
      assert.equal(tasks.values().next().value.inputs.length, 1);
    } else
      assert.throws(() => applyTaskRecord(tasks, operation, event, sessions), {
        code: "identity_conflict",
      });
  }
});

test("TASK armed handoffs are bounded across the current launch and cannot reuse IDs", () => {
  const f = machine();
  f.bound();
  const handoff = () => ({
    handoffId: randomUUID(),
    step: "native.send",
    stageArgumentDigest: "b".repeat(64),
    state: "armed",
    proofDigest: "c".repeat(64),
  });
  const first = handoff();
  f.append("task.handoff", first);
  assert.throws(() => f.append("task.handoff", first), {
    code: "identity_conflict",
  });
  for (let i = 1; i < TASK_LIMITS.armedPerLaunch; i++)
    f.append("task.handoff", handoff());
  assert.throws(() => f.append("task.handoff", handoff()), {
    code: "retained_limit",
  });
});
test("TASK original operation identity, session target, task UUID and first intent are never replaceable", () => {
  for (const mode of ["digest", "session", "scope", "intent", "terminal"]) {
    const f = machine();
    const original = JSON.parse(JSON.stringify(f.initial));
    const tasks = new Map();
    if (mode === "digest") original.identity.origin.digest = "f".repeat(64);
    if (mode === "session") original.identity.appSessionId = "foreign";
    if (mode === "scope") {
      original.taskScopeId = randomUUID();
      original.identity.taskScopeId = original.taskScopeId;
      tasks.set("another", { ...f.task() });
    }
    if (mode === "intent") f.op.dispatches = [];
    if (mode === "terminal") f.op.terminal = true;
    if (mode === "scope") {
      original.identity.taskScopeId = f.initial.taskScopeId;
      original.taskScopeId = f.initial.taskScopeId;
    }
    assert.throws(() => applyTaskRecord(tasks, f.op, original, f.sessions), {
      code: "identity_conflict",
    });
  }
});

test("TASK cancellation observes exact actual running lease and cannot move back to running", () => {
  const f = machine();
  f.bound();
  f.promote();
  f.running();
  const observation = {
    phase: "cancelling",
    launchId: "launch",
    scopeId: "scope",
    scopeVersion: 1,
    leaseId: "lease",
  };
  assert.throws(
    () => f.append("task.observe", { ...observation, leaseId: "foreign" }),
    { code: "identity_conflict" },
  );
  f.append("task.observe", observation);
  assert.throws(f.running, { code: "identity_conflict" });
  f.settleInput();
  f.proof("settled");
  f.append("task.settle", { proofDigest: "d".repeat(64), outcome: "settled" });
});

test("TASK sessionless workspace mutation cannot fabricate session authority", () => {
  const f = machine();
  const original = prepare();
  original.identity.originKind = "mutation";
  original.identity.targetKind = "session";
  original.identity.origin.type = "configuration.mcp.register";
  original.binding = {
    kind: "mutation",
    targetKind: "session",
    affectedSessionIds: ["native"],
    affectedProjectIds: ["project"],
    step: "native.mcp.add",
    targetDigest: "b".repeat(64),
    stageArgumentDigest: "c".repeat(64),
  };
  const operation = {
    ...f.op,
    identity: { ...original.identity.origin, workspaceId: "workspace" },
    dispatches: [{ step: "native.mcp.add" }],
  };
  assert.throws(
    () => applyTaskRecord(new Map(), operation, original, f.sessions),
    { code: "identity_conflict" },
  );
});

function mutationPrepare(targetKind = "workspace") {
  const v = prepare();
  v.identity.originKind = "mutation";
  v.identity.targetKind = targetKind;
  v.identity.origin.type =
    targetKind === "workspace"
      ? "configuration.mcp.register"
      : "session.rename";
  if (targetKind === "workspace") {
    delete v.identity.appSessionId;
    delete v.identity.nativeSessionId;
  }
  v.binding = {
    kind: "mutation",
    targetKind,
    step: targetKind === "workspace" ? "native.mcp.add" : "native.rename",
    targetDigest: "e".repeat(64),
    stageArgumentDigest: "f".repeat(64),
    affectedSessionIds: targetKind === "workspace" ? [] : ["native"],
    affectedProjectIds: ["project"],
  };
  return v;
}
test("TASK workspace mutation admits genuine sessionless original in an empty workspace", () => {
  const v = mutationPrepare();
  const operation = {
    identity: { ...v.identity.origin, workspaceId: "workspace" },
    terminal: false,
    dispatches: [{ step: v.binding.step }],
  };
  const task = applyTaskRecord(new Map(), operation, v, new Map());
  assert.deepEqual(task.inputs, []);
  assert.equal(Object.hasOwn(task.identity, "nativeSessionId"), false);
  assert.deepEqual(task.binding.affectedSessionIds, []);
  assert.equal(task.bindingDigest, taskBindingDigest(v.binding));
});

for (const targetKind of ["session", "workspace"]) {
  test(`TASK ${targetKind} mutation closed fields, complete local correlation and detached sets`, () => {
    const v = mutationPrepare(targetKind);
    const valid = validateTaskRecord(v);
    const operation = {
      identity: {
        ...v.identity.origin,
        workspaceId: "workspace",
        ...(targetKind === "session" ? { sessionId: "session" } : {}),
      },
      terminal: false,
      dispatches: [{ step: v.binding.step }],
    };
    const sessions = new Map([
      ["session", { workspaceId: "workspace", nativeSessionId: "native" }],
    ]);
    const workspaces = new Map([["workspace", {}]]);
    assert.equal(
      applyTaskRecord(new Map(), operation, v, sessions, workspaces)
        .bindingDigest,
      taskBindingDigest(valid.binding),
    );
    for (const change of [
      (x) => delete x.identity.targetKind,
      (x) => delete x.binding.targetKind,
      (x) => (x.identity.targetKind = "unknown"),
      (x) =>
        (x.binding.targetKind =
          targetKind === "session" ? "workspace" : "session"),
      (x) => delete x.binding.affectedSessionIds,
      (x) => delete x.binding.affectedProjectIds,
      (x) => (x.binding.affectedProjectIds = []),
      (x) => (x.binding.affectedProjectIds = ["foreign"]),
      (x) => (x.binding.affectedProjectIds = ["project", "project"]),
      (x) => (x.binding.affectedSessionIds = ["native", "native"]),
      (x) =>
        (x.binding.affectedProjectIds = Array.from(
          { length: 257 },
          (_, i) => `p${i}`,
        )),
      (x) =>
        (x.binding.affectedSessionIds = Array.from(
          { length: 257 },
          (_, i) => `s${i}`,
        )),
      (x) => (x.binding.affectedSessionIds = ["bad id"]),
      (x) => (x.binding.inputDigest = "b".repeat(64)),
      ...(targetKind === "workspace"
        ? [
            (x) => (x.identity.appSessionId = "session"),
            (x) => (x.identity.nativeSessionId = "native"),
          ]
        : [
            (x) => delete x.identity.appSessionId,
            (x) => delete x.identity.nativeSessionId,
            (x) => (x.binding.affectedSessionIds = []),
            (x) => (x.binding.affectedSessionIds = ["foreign"]),
          ]),
    ]) {
      const x = JSON.parse(JSON.stringify(v));
      change(x);
      assert.throws(() => validateTaskRecord(x), { code: "invalid_record" });
    }
    for (const altered of [
      { ...operation.identity, digest: "b".repeat(64) },
      { ...operation.identity, workspaceId: "foreign" },
      {
        ...operation.identity,
        sessionId: targetKind === "workspace" ? "session" : "foreign",
      },
    ])
      assert.throws(
        () =>
          applyTaskRecord(
            new Map(),
            { ...operation, identity: altered },
            v,
            sessions,
            workspaces,
          ),
        { code: "identity_conflict" },
      );
    assert.throws(
      () => applyTaskRecord(new Map(), operation, v, sessions, new Map()),
      { code: "identity_conflict" },
    );
    if (targetKind === "session") {
      assert.throws(
        () => applyTaskRecord(new Map(), operation, v, new Map(), workspaces),
        { code: "identity_conflict" },
      );
      assert.throws(
        () =>
          applyTaskRecord(
            new Map(),
            operation,
            v,
            new Map([
              [
                "session",
                { workspaceId: "foreign", nativeSessionId: "native" },
              ],
            ]),
            workspaces,
          ),
        { code: "identity_conflict" },
      );
    }
    v.binding.affectedProjectIds[0] = "mutated";
    v.binding.affectedSessionIds.push("mutated");
    assert.deepEqual(valid.binding.affectedProjectIds, ["project"]);
    assert.deepEqual(
      valid.binding.affectedSessionIds,
      targetKind === "session" ? ["native"] : [],
    );
  });
}
test("TASK mutation digest includes every new field and exact affected sets without truncation", () => {
  const v = mutationPrepare().binding;
  const base = taskBindingDigest(v);
  for (const binding of [
    { ...v, affectedSessionIds: ["s"] },
    { ...v, affectedProjectIds: ["project", "p"] },
    { ...v, affectedProjectIds: ["p", "project"] },
    { ...v, targetKind: "session", affectedSessionIds: ["s"] },
    { ...v, step: "native.mcp.remove" },
    { ...v, targetDigest: "a".repeat(64) },
    { ...v, stageArgumentDigest: "a".repeat(64) },
  ])
    assert.notEqual(taskBindingDigest(binding), base);
  const full = {
    ...v,
    affectedSessionIds: Array.from({ length: 256 }, (_, i) => `s${i}`),
    affectedProjectIds: Array.from({ length: 256 }, (_, i) => `p${i}`),
  };
  assert.deepEqual(validateTaskBinding(full), full);
  assert.notEqual(
    taskBindingDigest({
      ...full,
      affectedSessionIds: full.affectedSessionIds.slice(0, -1),
    }),
    taskBindingDigest(full),
  );
});
test("TASK workspace mutation binds stages without session inputs or fabricated leases", () => {
  for (const step of [
    "native.mcp.add",
    "native.policy.before_selection",
    "native.policy.after_selection",
  ]) {
    const v = mutationPrepare();
    v.binding.step = step;
    const tasks = new Map();
    const operation = {
      identity: { ...v.identity.origin, workspaceId: "workspace" },
      terminal: false,
      dispatches: [{ step }],
    };
    applyTaskRecord(tasks, operation, v, new Map());
    const append = (kind, fields) => {
      const task = [...tasks.values()][0];
      return applyTaskRecord(
        tasks,
        operation,
        {
          kind,
          runtimeEpoch: v.runtimeEpoch,
          operationId: v.operationId,
          taskScopeId: v.taskScopeId,
          revision: 4 + task.sequence,
          sequence: task.sequence + 1,
          ...fields,
        },
        new Map(),
      );
    };
    append("task.observe", { phase: "bound", launchId: "launch" });
    assert.throws(
      () =>
        append("task.observe", {
          phase: "running",
          launchId: "launch",
          scopeId: "fake",
          scopeVersion: 1,
          leaseId: "fake",
        }),
      { code: "identity_conflict" },
    );
    assert.throws(
      () =>
        append("task.input", {
          nativeSessionId: "fake",
          inboxId: "fake",
          inputDigest: "a".repeat(64),
          source: "prompt",
          parentLeaseId: null,
          state: "pending",
        }),
      { code: "identity_conflict" },
    );
    const handoff = {
      handoffId: randomUUID(),
      step,
      stageArgumentDigest: v.binding.stageArgumentDigest,
      proofDigest: "c".repeat(64),
    };
    append("task.handoff", { ...handoff, state: "armed" });
    assert.throws(
      () =>
        append("task_proof", {
          proofDigest: "d".repeat(64),
          outcome: "no_effect",
          lastActivitySequence: 2,
        }),
      { code: "identity_conflict" },
    );
    append("task.handoff", { ...handoff, state: "consumed" });
    append("task.handoff", { ...handoff, state: "completed" });
    append("task_proof", {
      proofDigest: "d".repeat(64),
      outcome: "no_effect",
      lastActivitySequence: 4,
    });
    append("task.settle", {
      proofDigest: "d".repeat(64),
      outcome: "no_effect",
    });
    assert.deepEqual([...tasks.values()][0].inputs, []);
  }
});
