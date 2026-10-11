import assert from "node:assert/strict";
import test from "node:test";
import { createNativeOriginScopes } from "./native-permission-origin-scopes.mjs";

const binding = (operationId = "operation_a", changes = {}) => ({
  origin: { runtimeEpoch: "epoch", operationId, digest: "a".repeat(64) },
  workspaceId: "workspace",
  appSessionId: "app_session",
  nativeSessionId: "ses_native",
  projectId: "project",
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
