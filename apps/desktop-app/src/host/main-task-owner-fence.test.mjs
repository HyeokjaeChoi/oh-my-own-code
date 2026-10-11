// Execute only exact inert Main closures under Node with scripted private
// dependencies. Never import Electron/Main or claim actual journal execution.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const text = await readFile(new URL("../main.mjs", import.meta.url), "utf8");
const unique = (needle) => {
  const at = text.indexOf(needle);
  assert.ok(at >= 0 && text.indexOf(needle, at + needle.length) === -1);
  return at;
};
const guardStart = unique("    let ownerReason;");
const guardEnd = unique("    const storage = await openWorkspaceRegistry({");
const loopStart = text.indexOf("    for (const method of [", guardEnd);
const loopEnd = text.indexOf("    return registry;", loopStart);
assert.ok(guardEnd > guardStart && loopStart > guardEnd && loopEnd > loopStart);
const create = new Function(
  "owner",
  "registry",
  "storage",
  text.slice(guardStart, guardEnd) +
    text.slice(loopStart, loopEnd) +
    "\nreturn {registry,requireOwner,reason:()=>ownerReason};",
);
const methods = [
  "begin",
  "reserve",
  "dispatch",
  "complete",
  "materializeManaged",
  "recordOwnerIntent",
  "recordMigrationPhase",
  "checkpoint",
  "recordTask",
  "recordPermissionReconciled",
  "permissionProgress",
];
function fixture() {
  const state = {
    checks: 0,
    revocations: 0,
    calls: [],
    result: { state: "ready" },
  };
  const storage = Object.fromEntries(
    methods.map((name) => [
      name,
      async (...args) => {
        state.calls.push({ name, args });
        return state.invoke?.(name, args) ?? { status: "recorded" };
      },
    ]),
  );
  storage.invalidateTaskAuthority = () => {
    state.revocations++;
  };
  const registry = { ...storage };
  const owner = {
    getNonce: () => "private-owned-nonce",
    async assertOwned(nonce) {
      assert.equal(nonce, "private-owned-nonce");
      state.checks++;
      if (state.failure) throw state.failure;
      return state.result;
    },
  };
  return { ...create(owner, registry, storage), state };
}

for (const method of [
  "recordTask",
  "recordPermissionReconciled",
  "permissionProgress",
]) {
  test(`actual Main ${method} refuses a lost owner before storage invocation`, async () => {
    const f = fixture();
    f.state.result = { state: "recovery_required", reason: "owner_unverified" };
    await assert.rejects(f.registry[method]({ original: "synthetic" }));
    assert.deepEqual(f.state.calls, []);
    assert.equal(f.state.revocations, 1);
    assert.equal(f.reason(), "owner_unverified");
  });
  test(`actual Main ${method} rechecks ownership after original async storage completion`, async () => {
    const f = fixture();
    const gate = Promise.withResolvers();
    f.state.invoke = () => gate.promise;
    const pending = f.registry[method]({ original: "synthetic" });
    await new Promise((done) => setImmediate(done));
    assert.equal(f.state.calls.length, 1);
    f.state.result = { state: "recovery_required", reason: "owner_conflict" };
    gate.resolve({ status: "recorded" });
    await assert.rejects(pending);
    assert.equal(f.state.checks, 2);
    assert.equal(f.state.revocations, 1);
  });
}

test("actual Main owner verifier throw revokes task authority without storage IO", async () => {
  const f = fixture();
  const error = new Error("synthetic owner verifier failure");
  f.state.failure = error;
  await assert.rejects(f.requireOwner(), (actual) => actual === error);
  assert.equal(f.state.revocations, 1);
  assert.equal(f.reason(), "owner_unverified");
  assert.deepEqual(f.state.calls, []);
});

test("actual Main original dispatch retains both fences and storage result", async () => {
  const f = fixture();
  const args = { original: "synthetic" };
  const result = await f.registry.dispatch(args);
  assert.deepEqual(result, { status: "recorded" });
  assert.deepEqual(f.state.calls, [{ name: "dispatch", args: [args] }]);
  assert.equal(f.state.checks, 2);
  assert.equal(f.state.revocations, 0);
});

test("actual Main observed owner loss cannot revive through a later ready response", async () => {
  const f = fixture();
  f.state.result = { state: "recovery_required", reason: "owner_conflict" };
  await assert.rejects(f.registry.recordTask({ original: "first" }));
  f.state.result = { state: "ready" };
  await assert.rejects(f.registry.recordTask({ original: "second" }));
  assert.deepEqual(f.state.calls, []);
  assert.equal(f.reason(), "owner_conflict");
});
