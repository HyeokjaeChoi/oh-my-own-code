import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { createNativeOriginScopes } from "./native-permission-origin-scopes.mjs";
import { taskBindingDigest } from "./host/workbench-task-storage.mjs";
import { permissionCanonicalJSON } from "./permission-control-canonical.mjs";

const binding = (operationId = "operation_a", changes = {}) => ({
  origin: {
    runtimeEpoch: "epoch",
    operationId,
    type: "message.send",
    digest: "a".repeat(64),
  },
  taskScopeId: `${createHash("sha256").update(operationId).digest("hex").slice(0, 8)}-1111-4111-8111-111111111111`,
  originKind: "prompt",
  workspaceId: "workspace",
  appSessionId: "app_session",
  nativeSessionId: "ses_native",
  projectId: "project",
  locationId: "11111111-1111-4111-8111-111111111111",
  locationIncarnation: "location",
  modeGeneration: 1,
  inventoryGeneration: 1,
  inputDigest: "b".repeat(64),
  ...changes,
});

test("multiple admitted origins share one immutable execution scope without losing original keys", () => {
  const registry = createNativeOriginScopes({ runtimeEpoch: "epoch" });
  const a = registry.admit(binding());
  const b = registry.admit(binding("operation_b"));
  const input = registry.bindInbox(b, {
    nativeSessionId: "ses_native",
    inboxId: "msg_b",
  });
  const first = registry.createScope({ cause: a, inboxes: [] });
  const second = registry.promote(first, [input]);
  assert.equal(registry.inspect(first).version, 1);
  assert.equal(registry.inspect(first).origins.length, 1);
  assert.equal(registry.inspect(second).version, 2);
  assert.equal(registry.inspect(second).origins.length, 2);
  assert.equal(
    registry.inspect(first).executionScopeId,
    registry.inspect(second).executionScopeId,
  );
  assert.deepEqual(registry.inspect(second).promotedInputs, [
    {
      nativeSessionId: "ses_native",
      inboxId: "msg_b",
      originalOperationKey: '["epoch","operation_b"]',
      inputDigest: "b".repeat(64),
      source: "prompt",
      parentLeaseId: null,
    },
  ]);
  assert.throws(() => registry.assertCurrent(first));
  assert.doesNotThrow(() => registry.assertUsable(first));
  assert.doesNotThrow(() => registry.assertCurrent(second));
});

test("an original cannot be reused as another execution scope cause or input", () => {
  const registry = createNativeOriginScopes({ runtimeEpoch: "epoch" });
  const a = registry.admit(binding());
  const b = registry.admit(binding("operation_b"));
  registry.createScope({ cause: a, inboxes: [] });
  assert.throws(
    () => registry.createScope({ cause: a, inboxes: [] }),
    /replay/,
  );
  const inbox = registry.bindInbox(a, {
    nativeSessionId: "ses_native",
    inboxId: "msg_a_late",
  });
  assert.throws(
    () => registry.createScope({ cause: b, inboxes: [inbox] }),
    /replay/,
  );
});

test("scope input is detached and closed; duplicate original identities never mint new handles", () => {
  const registry = createNativeOriginScopes({ runtimeEpoch: "epoch" });
  const input = binding();
  registry.admit(input);
  input.origin.digest = "c".repeat(64);
  input.projectId = "changed";
  const found = registry.lookup('["epoch","operation_a"]');
  assert.equal(found.binding.origin.digest, "a".repeat(64));
  assert.equal(found.binding.projectId, "project");
  assert.ok(Object.isFrozen(found.binding));
  assert.ok(Object.isFrozen(found.binding.origin));
  assert.throws(() => registry.admit(binding()), /duplicate/);
  assert.throws(
    () =>
      registry.admit(binding("operation_a", { inputDigest: "c".repeat(64) })),
    /conflict/,
  );
  assert.throws(
    () => registry.admit(binding("operation_a", { projectId: "another" })),
    /conflict/,
  );
  assert.throws(
    () =>
      registry.admit(
        binding("b", {
          origin: {
            runtimeEpoch: "old",
            operationId: "b",
            type: "message.send",
            digest: "a".repeat(64),
          },
        }),
      ),
    /epoch/,
  );
  for (const changes of [
    { inputDigest: "fake" },
    { extra: true },
    { modeGeneration: 0 },
    { inventoryGeneration: -0 },
    { appSessionId: "" },
  ])
    assert.throws(() => registry.admit(binding("b", changes)));
  assert.equal(registry.lookup('["epoch","missing"]'), undefined);
});

test("no getters, Proxy traps, foreign handles or sparse batch can create bookkeeping", () => {
  const registry = createNativeOriginScopes({ runtimeEpoch: "epoch" });
  let effects = 0;
  const input = binding();
  Object.defineProperty(input, "origin", {
    enumerable: true,
    get() {
      effects++;
      return {};
    },
  });
  assert.throws(() => registry.admit(input));
  assert.throws(() =>
    registry.admit(
      new Proxy(
        {},
        {
          ownKeys() {
            effects++;
            return [];
          },
        },
      ),
    ),
  );
  const origin = registry.admit(binding());
  const foreign = createNativeOriginScopes({ runtimeEpoch: "epoch" });
  const other = foreign.admit(binding("foreign"));
  for (const cause of [{}, new Proxy(origin, {}), other])
    assert.throws(() => registry.createScope({ cause, inboxes: [] }));
  assert.throws(() =>
    registry.createScope({ cause: origin, inboxes: new Array(1) }),
  );
  const scope = registry.createScope({ cause: origin, inboxes: [] });
  assert.throws(() => registry.inspect(new Proxy(scope, {})));
  assert.throws(() => JSON.stringify(scope));
  assert.throws(() => JSON.stringify(origin));
  assert.equal(effects, 0);
});

test("complete batch rejects mismatched owner or generation atomically before consuming any input", () => {
  for (const changes of [
    { projectId: "other" },
    { locationIncarnation: "other" },
    { modeGeneration: 2 },
    { inventoryGeneration: 2 },
    { workspaceId: "other" },
    { appSessionId: "other" },
    { nativeSessionId: "ses_other" },
  ]) {
    const registry = createNativeOriginScopes({ runtimeEpoch: "epoch" });
    const a = registry.admit(binding());
    const b = registry.admit(binding("b"));
    const cBinding = binding("c", changes);
    const c = registry.admit(cBinding);
    const good = registry.bindInbox(b, {
      nativeSessionId: "ses_native",
      inboxId: "msg_good",
    });
    const bad = registry.bindInbox(c, {
      nativeSessionId: cBinding.nativeSessionId,
      inboxId: "msg_bad",
    });
    const first = registry.createScope({ cause: a, inboxes: [] });
    assert.throws(() => registry.promote(first, [good, bad]), /scope/);
    assert.equal(registry.inspect(first).version, 1);
    assert.doesNotThrow(() => registry.assertCurrent(first));
    const next = registry.promote(first, [good]);
    assert.equal(registry.inspect(next).version, 2);
    assert.equal(registry.inspect(next).promotedInputs.length, 1);
  }
});

test("inbox correlation is unique and promotion cannot replay or substitute inputs", () => {
  const registry = createNativeOriginScopes({ runtimeEpoch: "epoch" });
  const a = registry.admit(binding());
  assert.throws(() =>
    registry.bindInbox(a, { nativeSessionId: "ses_other", inboxId: "msg_a" }),
  );
  assert.throws(() =>
    registry.bindInbox(a, {
      nativeSessionId: "ses_native",
      inboxId: "not_native",
    }),
  );
  const input = registry.bindInbox(a, {
    nativeSessionId: "ses_native",
    inboxId: "msg_a",
  });
  assert.throws(
    () =>
      registry.bindInbox(a, {
        nativeSessionId: "ses_native",
        inboxId: "msg_a",
      }),
    /conflict/,
  );
  assert.throws(
    () => registry.createScope({ cause: a, inboxes: [input, input] }),
    /duplicate/,
  );
  const scope = registry.createScope({ cause: a, inboxes: [input] });
  assert.throws(() => registry.promote(scope, [input]), /replay/);
  assert.throws(() => registry.promote(scope, []));
  assert.throws(() => registry.promote(scope, [{}]));
  assert.equal(registry.inspect(scope).version, 1);
});

test("revoke and close stop new scope use while retaining read-only original data", () => {
  const registry = createNativeOriginScopes({ runtimeEpoch: "epoch" });
  const a = registry.admit(binding());
  const b = registry.admit(binding("b"));
  const scope = registry.createScope({ cause: a, inboxes: [] });
  const input = registry.bindInbox(b, {
    nativeSessionId: "ses_native",
    inboxId: "msg_b",
  });
  registry.revoke(b);
  assert.throws(() => registry.promote(scope, [input]), /revoked/);
  assert.doesNotThrow(() => registry.assertUsable(scope));
  registry.revoke(a);
  assert.throws(() => registry.assertUsable(scope), /revoked/);
  assert.equal(registry.lookup('["epoch","operation_a"]').state, "revoked");
  assert.equal(registry.inspect(scope).version, 1);
  registry.close();
  registry.close();
  assert.throws(() => registry.admit(binding("late")), /closed/);
  assert.throws(() => registry.assertCurrent(scope), /closed/);
  assert.equal(registry.inspect(scope).origins.length, 1);
});

test("scope origin bound refuses complete append without partial state or lost input", () => {
  const registry = createNativeOriginScopes({ runtimeEpoch: "epoch" });
  const cause = registry.admit(binding("cause"));
  const inboxes = [];
  let finalOrigin;
  for (let i = 0; i < 256; i++) {
    const origin = registry.admit(binding(`input_${i}`));
    inboxes.push(
      registry.bindInbox(origin, {
        nativeSessionId: "ses_native",
        inboxId: `msg_${i}`,
      }),
    );
    finalOrigin = origin;
  }
  const scope = registry.createScope({ cause, inboxes: inboxes.slice(0, 255) });
  assert.equal(registry.inspect(scope).origins.length, 256);
  assert.throws(() => registry.promote(scope, [inboxes[255]]), /capacity/);
  assert.equal(registry.inspect(scope).version, 1);
  const independent = registry.createScope({
    cause: finalOrigin,
    inboxes: [inboxes[255]],
  });
  assert.equal(registry.inspect(independent).origins.length, 1);
  assert.equal(registry.inspect(independent).promotedInputs.length, 1);
});

test("graph lifetime origin and version bounds do not evict or reuse old keys", () => {
  const registry = createNativeOriginScopes({ runtimeEpoch: "epoch" });
  let last, scope;
  for (let i = 0; i < 8192; i++) {
    last = registry.admit(binding(`op_${i}`));
    if (i < 8191) scope = registry.createScope({ cause: last, inboxes: [] });
  }
  assert.throws(() => registry.admit(binding("overflow")), /capacity/);
  const extra = registry.bindInbox(last, {
    nativeSessionId: "ses_native",
    inboxId: "msg_extra",
  });
  scope = registry.promote(scope, [extra]);
  const firstOrigin = registry.lookup('["epoch","op_0"]');
  assert.equal(firstOrigin.binding.origin.operationId, "op_0");
  const more = registry.bindInbox(last, {
    nativeSessionId: "ses_native",
    inboxId: "msg_more",
  });
  assert.throws(() => registry.promote(scope, [more]), /capacity/);
  assert.throws(() => registry.admit(binding("op_0")), /duplicate/);
  assert.equal(registry.inspect(scope).version, 2);
});

test("closed origin variants never synthesize prompt digests or pre-session IDs", () => {
  const registry = createNativeOriginScopes({ runtimeEpoch: "epoch" });
  const nonprompt = (id, kind, extra = {}) => {
    const value = binding(id, {
      origin: {
        runtimeEpoch: "epoch",
        operationId: id,
        type:
          kind === "command"
            ? "command.run"
            : kind === "bootstrap"
              ? "session.create"
              : "session.interrupt",
        digest: "a".repeat(64),
      },
      originKind: kind,
      bindingDigest: "c".repeat(64),
      ...extra,
    });
    delete value.inputDigest;
    return value;
  };
  const command = registry.admit(nonprompt("command", "command"));
  assert.throws(() =>
    registry.bindInbox(command, {
      nativeSessionId: "ses_native",
      inboxId: "msg_expanded",
    }),
  );
  assert.throws(
    () =>
      registry.bindInbox(command, {
        nativeSessionId: "ses_native",
        inboxId: "msg_expanded",
        inputDigest: "d".repeat(64),
        source: "command_expansion",
      }),
    /reservation/,
  );
  registry.admit(
    nonprompt("mutation", "mutation", {
      targetKind: "session",
      method: "interrupt",
      affectedSessionIds: ["ses_native"],
      affectedProjectIds: ["project"],
    }),
  );
  const bootstrap = nonprompt("bootstrap", "bootstrap", {
    reservation: {
      kind: "bootstrap",
      step: "native.create",
      reservationDigest: "d".repeat(64),
      parentIdentityDigest: null,
    },
  });
  delete bootstrap.appSessionId;
  delete bootstrap.nativeSessionId;
  const boot = registry.admit(bootstrap);
  assert.throws(
    () => registry.createScope({ cause: boot, inboxes: [] }),
    /boot_held/,
  );
  assert.equal(
    Object.hasOwn(
      registry.lookup('["epoch","bootstrap"]').binding,
      "nativeSessionId",
    ),
    false,
  );
  assert.throws(
    () =>
      registry.bindSession(boot, {
        appSessionId: "actual_app",
        nativeSessionId: "ses_created",
        projectId: "other",
        locationId: bootstrap.locationId,
        locationIncarnation: "location",
      }),
    /scope/,
  );
  registry.bindSession(boot, {
    appSessionId: "actual_app",
    nativeSessionId: "ses_created",
    projectId: "project",
    locationId: bootstrap.locationId,
    locationIncarnation: "location",
  });
  assert.throws(
    () => registry.createScope({ cause: boot, inboxes: [] }),
    /boot_held/,
  );
  assert.throws(() =>
    registry.admit({ ...bootstrap, nativeSessionId: "invented" }),
  );
  assert.throws(() => registry.admit(nonprompt("unknown", "other")));
  assert.throws(() =>
    registry.admit({
      ...nonprompt("dummy", "command"),
      inputDigest: "b".repeat(64),
    }),
  );
  assert.throws(() =>
    registry.admit(
      nonprompt("bad_mutation", "mutation", {
        method: "interrupt",
        affectedSessionIds: ["ses_native", "ses_native"],
        affectedProjectIds: ["project"],
      }),
    ),
  );
});

test("opaque location UUID participates in promotion and immutable lease constraints", () => {
  const registry = createNativeOriginScopes({ runtimeEpoch: "epoch" });
  const a = registry.admit(binding("location_a"));
  const b = registry.admit(
    binding("location_b", {
      locationId: "22222222-2222-4222-8222-222222222222",
    }),
  );
  const input = registry.bindInbox(b, {
    nativeSessionId: "ses_native",
    inboxId: "msg_location",
  });
  const scope = registry.createScope({ cause: a, inboxes: [] });
  assert.throws(() => registry.promote(scope, [input]), /scope/);
  assert.equal(registry.inspectInbox(input).state, "pending");
  assert.equal(registry.constraints(scope).locationId, binding().locationId);
  for (const locationId of ["/some/path", "1", 1, null])
    assert.throws(() =>
      registry.admit(binding("invalid_location", { locationId })),
    );
});

test("pending, promoted and cancelled transitions cannot be asserted with caller proof objects", () => {
  const registry = createNativeOriginScopes({ runtimeEpoch: "epoch" });
  const cause = registry.admit(binding("transition"));
  const input = registry.bindInbox(cause, {
    nativeSessionId: "ses_native",
    inboxId: "msg_transition",
  });
  assert.throws(() => registry.cancelInbox(input, {}));
  assert.throws(() => registry.settleInbox(input), /transition/);
  assert.equal(registry.settleRoot(cause), false);
  registry.createScope({ cause, inboxes: [input] });
  assert.equal(registry.inspectInbox(input).state, "promoted");
  assert.throws(() => registry.cancelInbox(input, {}), /transition/);
  assert.throws(() => registry.settleInbox(input), /proof/);
  assert.equal(registry.settleRoot(cause), false);
  assert.equal(registry.releaseReservation, undefined);
  assert.equal(registry.finishLease, undefined);
});

// Synthetic admission fixtures validate the closed union, not execution authority.
const mutationBinding = (targetKind = "workspace", changes = {}) => {
  const value = binding("workspace_mutation", {
    origin: {
      runtimeEpoch: "epoch",
      operationId: "workspace_mutation",
      type: "configuration.mcp.connect",
      digest: "a".repeat(64),
    },
    originKind: "mutation",
    targetKind,
    method: "mcp.connect",
    bindingDigest: "c".repeat(64),
    affectedSessionIds: [],
    affectedProjectIds: ["project"],
    ...changes,
  });
  delete value.inputDigest;
  if (targetKind === "workspace") {
    delete value.appSessionId;
    delete value.nativeSessionId;
  }
  return value;
};

test("empty workspace mutation admits exact detached target without session or prompt fabrication", () => {
  const registry = createNativeOriginScopes({ runtimeEpoch: "epoch" });
  const value = mutationBinding();
  const origin = registry.admit(value);
  value.affectedSessionIds.push("ses_later");
  value.affectedProjectIds[0] = "changed";
  const saved = registry.lookup('["epoch","workspace_mutation"]').binding;
  assert.deepEqual(saved.affectedSessionIds, []);
  assert.deepEqual(saved.affectedProjectIds, ["project"]);
  assert.ok(Object.isFrozen(saved.affectedSessionIds));
  for (const field of ["appSessionId", "nativeSessionId", "inputDigest"])
    assert.equal(Object.hasOwn(saved, field), false);
  assert.equal(registry.settleRoot(origin), false);
  assert.throws(
    () => registry.createScope({ cause: origin, inboxes: [] }),
    /workspace_held/,
  );
  assert.throws(() => registry.bindSession(origin, {}));
  assert.throws(() =>
    registry.bindInbox(origin, {
      nativeSessionId: "ses_invented",
      inboxId: "msg_invented",
      inputDigest: "d".repeat(64),
      source: "command_expansion",
    }),
  );
});

test("mutation target variants require complete unique bounded sets and exact owner membership", () => {
  const admit = (value) =>
    createNativeOriginScopes({ runtimeEpoch: "epoch" }).admit(value);
  assert.doesNotThrow(() =>
    admit(mutationBinding("session", { affectedSessionIds: ["ses_native"] })),
  );
  assert.doesNotThrow(() =>
    admit(
      mutationBinding("workspace", {
        affectedSessionIds: Array.from({ length: 256 }, (_, i) => `ses_${i}`),
        affectedProjectIds: [
          "project",
          ...Array.from({ length: 255 }, (_, i) => `project_${i}`),
        ],
      }),
    ),
  );
  const invalid = [
    { targetKind: "other" },
    { affectedSessionIds: ["ses_a", "ses_a"] },
    { affectedSessionIds: Array.from({ length: 257 }, (_, i) => `ses_${i}`) },
    { affectedProjectIds: [] },
    { affectedProjectIds: ["other"] },
    { affectedProjectIds: ["project", "project"] },
    {
      affectedProjectIds: [
        "project",
        ...Array.from({ length: 256 }, (_, i) => `p_${i}`),
      ],
    },
    { affectedSessionIds: [""] },
  ];
  for (const changes of invalid)
    assert.throws(() => admit(mutationBinding("workspace", changes)));
  assert.throws(() =>
    admit({ ...mutationBinding(), inputDigest: "d".repeat(64) }),
  );
  for (const field of [
    "targetKind",
    "affectedSessionIds",
    "affectedProjectIds",
  ]) {
    const value = mutationBinding();
    delete value[field];
    assert.throws(() => admit(value));
  }
  for (const field of ["appSessionId", "nativeSessionId"]) {
    assert.throws(() => admit({ ...mutationBinding(), [field]: "invented" }));
    const value = mutationBinding("session", {
      affectedSessionIds: ["ses_native"],
    });
    delete value[field];
    assert.throws(() => admit(value));
  }
  for (const affectedSessionIds of [[], ["ses_other"]])
    assert.throws(() =>
      admit(mutationBinding("session", { affectedSessionIds })),
    );
  for (const kind of ["prompt", "command", "bootstrap"])
    assert.throws(() =>
      admit({ ...binding(), originKind: kind, targetKind: "workspace" }),
    );
});

test("session mutation cannot promote genuine prompt inputs or borrow their lineage", () => {
  const registry = createNativeOriginScopes({ runtimeEpoch: "epoch" });
  const origin = registry.admit(
    mutationBinding("session", { affectedSessionIds: ["ses_native"] }),
  );
  const prompt = registry.admit(binding("genuine_prompt"));
  const inbox = registry.bindInbox(prompt, {
    nativeSessionId: "ses_native",
    inboxId: "msg_real",
  });
  assert.throws(
    () => registry.createScope({ cause: origin, inboxes: [inbox] }),
    /scope/,
  );
  const scope = registry.createScope({ cause: origin, inboxes: [] });
  assert.throws(() => registry.promote(scope, [inbox]), /scope/);
  assert.equal(registry.inspectInbox(inbox).state, "pending");
  const promptScope = registry.createScope({ cause: prompt, inboxes: [inbox] });
  assert.equal(registry.inspect(promptScope).promotedInputs.length, 1);
});

test("Native mutation admission preserves the exact shared closed-binding digest for both targets", () => {
  // Detached fixture targets/arguments exercise the shared producer; this is
  // digest compatibility evidence, not actual Native stage authorization.
  const hashFixture = (value) =>
    createHash("sha256").update(permissionCanonicalJSON(value)).digest("hex");
  for (const targetKind of ["workspace", "session"]) {
    const affectedSessionIds = targetKind === "workspace" ? [] : ["ses_native"];
    const persisted = {
      kind: "mutation",
      targetKind,
      step: "native.mcp.connect",
      targetDigest: hashFixture({
        workspaceId: "workspace",
        projectId: "project",
        affectedSessionIds,
      }),
      stageArgumentDigest: hashFixture({ name: "fixture_mcp" }),
      affectedSessionIds,
      affectedProjectIds: ["project"],
    };
    const expected = taskBindingDigest(persisted);
    const value = mutationBinding(targetKind, {
      affectedSessionIds,
      bindingDigest: expected,
    });
    const registry = createNativeOriginScopes({ runtimeEpoch: "epoch" });
    registry.admit(value);
    const saved = registry.lookup('["epoch","workspace_mutation"]').binding;
    assert.equal(saved.bindingDigest, expected);
    assert.deepEqual(saved.affectedSessionIds, persisted.affectedSessionIds);
    assert.deepEqual(saved.affectedProjectIds, persisted.affectedProjectIds);
    for (const changed of [
      {
        ...persisted,
        targetKind: targetKind === "workspace" ? "session" : "workspace",
        affectedSessionIds: ["ses_native"],
      },
      { ...persisted, step: "native.mcp.disconnect" },
      { ...persisted, targetDigest: hashFixture({ workspaceId: "other" }) },
      {
        ...persisted,
        stageArgumentDigest: hashFixture({ name: "substituted" }),
      },
      { ...persisted, affectedSessionIds: ["ses_native", "ses_added"] },
      { ...persisted, affectedProjectIds: ["project", "project_added"] },
    ]) {
      const changedDigest = taskBindingDigest(changed);
      assert.notEqual(changedDigest, expected);
      assert.throws(
        () => registry.admit({ ...value, bindingDigest: changedDigest }),
        /conflict/,
      );
    }
    persisted.affectedSessionIds.push("ses_later");
    persisted.affectedProjectIds.push("project_later");
    assert.equal(saved.bindingDigest, expected);
    assert.equal(saved.affectedSessionIds.includes("ses_later"), false);
    assert.equal(saved.affectedProjectIds.includes("project_later"), false);
    const earlier = { ...persisted };
    delete earlier.targetKind;
    assert.throws(() => taskBindingDigest(earlier));
  }
});
