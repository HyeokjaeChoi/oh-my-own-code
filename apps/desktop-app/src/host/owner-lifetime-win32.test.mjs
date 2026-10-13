import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { createLifetimeWitness } from "./owner-lifetime.mjs";

const sha = (value) => createHash("sha256").update(value).digest("hex");
const id = (pid, birth = `birth-${pid}`) => ({
  pid,
  platform: "win32",
  bootId: sha("boot"),
  startToken: sha(birth),
});
const nonce = randomUUID();
const context = (role, identity) => ({
  root: "/synthetic/root",
  rootIdentity: "1:2",
  ownerNonce: nonce,
  role,
  identity,
});
function witness(states = {}) {
  const calls = [];
  const processIdentity = {
    capture: async (pid) =>
      states[pid]?.alive === false ? null : id(pid, states[pid]?.birth),
    inspect: async (expected) => {
      calls.push(expected.pid);
      const state = states[expected.pid] ?? { state: "alive" };
      return state.state === "conflict"
        ? { state: "identity_conflict" }
        : state.state === "unverified"
          ? { state: "unverified" }
          : { state: state.state, identity: expected, evidence: "os_identity" };
    },
  };
  return {
    calls,
    w: createLifetimeWitness({
      platform: "win32",
      arch: "x64",
      processIdentity,
      deadlineMs: 200,
    }),
  };
}

test("registers one live app and at most one live child, then seals", async () => {
  const { w } = witness();
  const app = id(10);
  const child = id(11);
  assert.deepEqual(await w.register(context("app", app)), { state: "ready" });
  assert.equal(
    (await w.register(context("app", app))).state,
    "recovery_required",
  ); // second app
  assert.deepEqual(await w.register(context("child", child)), {
    state: "ready",
  });
  assert.equal(
    (await w.register(context("child", id(12)))).state,
    "recovery_required",
  ); // second child
  assert.deepEqual(await w.closeRegistration(nonce), { state: "ready" });
  assert.equal(
    (await w.closeRegistration(randomUUID())).state,
    "recovery_required",
  );
});

test("refuses registration of a dead, replaced or foreign identity and child-before-app", async () => {
  let { w } = witness({ 10: { alive: false } });
  assert.equal(
    (await w.register(context("app", id(10)))).state,
    "recovery_required",
  );
  ({ w } = witness({ 10: { birth: "other" } }));
  assert.equal(
    (await w.register(context("app", id(10)))).state,
    "recovery_required",
  );
  ({ w } = witness());
  assert.equal(
    (await w.register(context("child", id(11)))).state,
    "recovery_required",
  );
  assert.equal(
    (await w.register(context("app", { ...id(10), platform: "linux" }))).state,
    "recovery_required",
  );
  await w.register(context("app", id(10)));
  assert.equal(
    (await w.register(context("child", id(10)))).state,
    "recovery_required",
  ); // same pid
  assert.equal(
    (
      await w.register(
        context("child", { ...id(11), bootId: sha("other boot") }),
      )
    ).state,
    "recovery_required",
  );
  await w.closeRegistration(nonce);
  assert.equal(
    (await w.register(context("child", id(11)))).state,
    "recovery_required",
  ); // sealed
});

test("verify reports exited only when every registered role is proven exited", async () => {
  const app = id(10),
    child = id(11);
  const verifyContext = (childId) => ({
    ...context("app", app),
    expectedRegistrations: { app, child: childId },
  });
  let { w, calls } = witness({
    10: { state: "exited" },
    11: { state: "exited" },
  });
  assert.equal(await w.verify(verifyContext(child)), "exited");
  assert.deepEqual(calls, [10, 11]);
  ({ w } = witness({ 10: { state: "exited" } }));
  assert.equal(await w.verify(verifyContext(null)), "exited");
  ({ w } = witness({ 10: { state: "exited" }, 11: { state: "alive" } }));
  assert.equal(await w.verify(verifyContext(child)), "unverified");
  ({ w } = witness({ 10: { state: "alive" } }));
  assert.equal(await w.verify(verifyContext(null)), "unverified");
  ({ w } = witness({ 10: { state: "unverified" } }));
  assert.equal(await w.verify(verifyContext(null)), "unverified");
  ({ w } = witness({ 10: { state: "conflict" } }));
  assert.equal(await w.verify(verifyContext(null)), "identity_conflict");
  ({ w } = witness());
  assert.equal(
    await w.verify({ ...verifyContext(null), root: "relative" }),
    "unverified",
  );
});

test("an inspect that never answers is bounded by the deadline", async () => {
  const w = createLifetimeWitness({
    platform: "win32",
    arch: "x64",
    processIdentity: {
      capture: async () => null,
      inspect: () => new Promise(() => {}),
    },
    deadlineMs: 20,
  });
  const app = id(10);
  assert.equal(
    await w.verify({
      ...context("app", app),
      expectedRegistrations: { app, child: null },
    }),
    "unverified",
  );
});

test("a darwin identity is never accepted by the Windows witness", async () => {
  const { w } = witness();
  const mac = { ...id(10), platform: "darwin" };
  assert.equal(
    (await w.register(context("app", mac))).state,
    "recovery_required",
  );
  assert.equal(
    await w.verify({
      ...context("app", mac),
      expectedRegistrations: { app: mac, child: null },
    }),
    "unverified",
  );
});
