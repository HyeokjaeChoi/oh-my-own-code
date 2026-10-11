import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as storage from "./workbench-git-index-storage.mjs";
import {
  GIT_ABSENT_INDEX_DIGEST,
  GIT_INDEX_STEPS,
} from "../renderer/shared/git-index/index.mjs";
import { redactReceipt } from "./workbench-receipts.mjs";
const target = (indexExists = true) => ({
  action: "stage",
  paths: ["src/example.txt"],
  previewDigest: "b".repeat(64),
  headOid: null,
  indexExists,
  indexDigest: indexExists ? "c".repeat(64) : GIT_ABSENT_INDEX_DIGEST,
  nextIndexDigest: "d".repeat(64),
  objectFormat: "sha1",
});
const identity = {
  runtimeEpoch: "original",
  operationId: "apply",
  type: "git.index.apply",
  workspaceId: "workspace",
  digest: "a".repeat(64),
};
const operation = (t = target()) => ({
  identity,
  gitIndexTarget: t,
  dispatches: [],
});
const confirmed = (t = target()) => ({
  runtimeEpoch: identity.runtimeEpoch,
  operationId: identity.operationId,
  type: identity.type,
  workspaceId: identity.workspaceId,
  admission: "dispatched",
  delivery: "accepted",
  effect: "confirmed",
  revision: 3,
  evidence: [],
  result: {
    kind: "git_index_updated",
    workspaceId: identity.workspaceId,
    action: t.action,
    paths: [...t.paths],
    indexDigest: t.nextIndexDigest,
    previewDigest: t.previewDigest,
    backupId: t.indexExists
      ? `.omoc-git-index-${createHash("sha256")
          .update(JSON.stringify([identity.runtimeEpoch, identity.operationId]))
          .digest("hex")}.backup`
      : null,
    digest: identity.digest,
  },
});
const empty = () => ({ workspaces: [], sessions: [], tombstones: [] });
test("Git index completion binds next digest, original key and exact ordered target", () => {
  for (const exists of [true, false]) {
    const op = operation(target(exists));
    const receipt = confirmed(op.gitIndexTarget);
    const payload = { receipt, delta: empty() };
    const stage = {
      step: GIT_INDEX_STEPS.stage,
      gitIndexTarget: op.gitIndexTarget,
    };
    const publish = {
      step: GIT_INDEX_STEPS.publish,
      gitIndexTarget: op.gitIndexTarget,
    };
    assert.throws(() => storage.validateGitIndexDispatch(op, publish));
    storage.validateGitIndexDispatch(op, stage);
    op.dispatches.push(stage);
    assert.throws(() => storage.validateGitIndexDispatch(op, stage));
    storage.validateGitIndexDispatch(op, publish);
    op.dispatches.push(publish);
    storage.validateGitIndexCompletion(op, payload, [
      storage.GIT_INDEX_FEATURE,
    ]);
    for (const field of [
      "indexDigest",
      "previewDigest",
      "digest",
      "backupId",
      "paths",
      "action",
    ]) {
      const bad = globalThis.structuredClone(payload);
      bad.receipt.result[field] =
        field === "paths"
          ? ["other.txt"]
          : field === "action"
            ? "unstage"
            : "f".repeat(64);
      assert.throws(() =>
        storage.validateGitIndexCompletion(op, bad, [
          storage.GIT_INDEX_FEATURE,
        ]),
      );
    }
    const projected = redactReceipt({
      ...receipt,
      gitIndexTarget: op.gitIndexTarget,
      digest: identity.digest,
    });
    assert.deepEqual(projected.result, receipt.result);
    assert.equal(projected.gitIndexTarget, undefined);
    assert.equal(redactReceipt(receipt).result, undefined);
    assert.equal(
      storage.validGitIndexUpdatedResult(
        receipt,
        op.gitIndexTarget,
        "f".repeat(64),
      ),
      false,
    );
    const badBackup = globalThis.structuredClone(receipt);
    badBackup.result.backupId = exists ? null : confirmed().result.backupId;
    assert.equal(
      storage.validGitIndexUpdatedResult(
        badBackup,
        op.gitIndexTarget,
        identity.digest,
      ),
      false,
    );
  }
});
test("Git index nested descriptors refuse getters, symbols and private target fields without reading them", () => {
  let calls = 0;
  for (const bad of [
    { ...target(), root: "/private" },
    { ...target(), bytes: "secret" },
    { ...target(), previewId: "a".repeat(64) },
    { ...target(), [Symbol("private")]: true },
  ]) {
    assert.throws(() =>
      storage.validateGitIndexAdmission({ identity, gitIndexTarget: bad }),
    );
  }
  const bad = target();
  Object.defineProperty(bad, "paths", {
    enumerable: true,
    get() {
      calls++;
      return ["secret"];
    },
  });
  assert.throws(() =>
    storage.validateGitIndexAdmission({ identity, gitIndexTarget: bad }),
  );
  assert.equal(calls, 0);
  assert.throws(() =>
    storage.validateGitIndexAdmission({
      identity: { ...identity, sessionId: "session" },
      gitIndexTarget: target(),
    }),
  );
  assert.throws(() =>
    storage.validateGitIndexDispatch(operation(), {
      step: GIT_INDEX_STEPS.stage,
      gitIndexTarget: target(),
      nativeSessionId: "native",
    }),
  );
  assert.throws(() =>
    storage.validateGitIndexDispatch(
      { identity: { ...identity, type: "file.save" } },
      { step: GIT_INDEX_STEPS.stage, gitIndexTarget: target() },
    ),
  );
});
