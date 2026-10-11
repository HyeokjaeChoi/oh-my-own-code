import test from "node:test";
import assert from "node:assert/strict";
import {
  forkTargetAdmission,
  validForkTarget,
  validateBeforeBranchAdmission,
  validateBeforeBranchDispatch,
  validateBeforeBranchDispatchPayload,
} from "./conversation-context-branch-storage.mjs";

test("CTX-BRANCH private target uses the public wire ID grammar and never runs accessors", () => {
  let reads = 0;
  const accessor = Object.defineProperty({}, "beforeMessageId", {
    enumerable: true,
    get() {
      reads++;
      return "message";
    },
  });
  for (const target of [
    undefined,
    {},
    { beforeMessageId: undefined },
    { beforeMessageId: "" },
    { beforeMessageId: "space id" },
    { beforeMessageId: "한글" },
    { beforeMessageId: "x".repeat(129) },
    { beforeMessageId: "m", extra: undefined },
    Object.assign(Object.create(null), { beforeMessageId: "m" }),
    accessor,
    Object.defineProperty({}, "beforeMessageId", { value: "m" }),
    { beforeMessageId: "m", [Symbol("extra")]: "private" },
  ])
    assert.equal(validForkTarget(target), false);
  for (const beforeMessageId of ["msg_.:-1", "x".repeat(128)])
    assert.equal(validForkTarget({ beforeMessageId }), true);
  assert.equal(reads, 0);
});

test("CTX-BRANCH only explicit before forks receive detached frozen authority", () => {
  const operation = { type: "session.fork", before: "message" };
  const target = forkTargetAdmission(operation);
  operation.before = "changed";
  assert.deepEqual(target, { beforeMessageId: "message" });
  assert.equal(Object.isFrozen(target), true);
  assert.equal(forkTargetAdmission({ type: "session.fork" }), undefined);
  assert.equal(
    forkTargetAdmission({ type: "message.send", before: "message" }),
    undefined,
  );
  assert.throws(
    () => forkTargetAdmission({ type: "session.fork", before: undefined }),
    { code: "invalid_record" },
  );
  let reads = 0;
  assert.throws(
    () =>
      forkTargetAdmission({
        type: "session.fork",
        get before() {
          reads++;
          return "m";
        },
      }),
    { code: "invalid_record" },
  );
  assert.equal(reads, 0);
});

test("CTX-BRANCH target cannot travel through another admission, policy, or generic fork", () => {
  const forkTarget = { beforeMessageId: "message" };
  const identity = {
    type: "session.fork",
    workspaceId: "workspace",
    sessionId: "parent",
  };
  validateBeforeBranchAdmission({ identity, forkTarget });
  assert.throws(
    () =>
      validateBeforeBranchAdmission({
        identity: { ...identity, type: "message.send" },
        forkTarget,
      }),
    { code: "invalid_record" },
  );
  for (const step of [
    "native.policy",
    "native.policy.before_selection",
    "native.policy.after_selection",
    "native.rename",
    "native.send",
  ])
    assert.throws(
      () => validateBeforeBranchDispatchPayload({ step, forkTarget }),
      { code: "invalid_record" },
    );
  assert.throws(
    () =>
      validateBeforeBranchDispatch(
        { identity, dispatches: [] },
        { step: "native.fork", forkTarget },
      ),
    { code: "identity_conflict" },
  );
  validateBeforeBranchDispatch(
    { identity, dispatches: [], forkTarget },
    { step: "native.fork", forkTarget, nativeSessionId: "parent-native" },
  );
  assert.throws(
    () =>
      validateBeforeBranchDispatch(
        { identity, dispatches: [], forkTarget },
        { step: "native.fork" },
      ),
    { code: "identity_conflict" },
  );
});
