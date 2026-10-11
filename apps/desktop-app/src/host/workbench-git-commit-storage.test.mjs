import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as storage from "./workbench-git-commit-storage.mjs";
import { gitCommitExpectedBackups } from "./git-commit-contract.mjs";
import {
  GIT_COMMIT_ABSENT_DIGEST,
  GIT_COMMIT_TARGET_FIELDS,
} from "../renderer/shared/git-commit/index.mjs";
import { redactReceipt } from "./workbench-receipts.mjs";

const identity = {
  runtimeEpoch: "original",
  operationId: "commit",
  workspaceId: "workspace",
  type: "git.commit.apply",
  digest: "a".repeat(64),
};
const empty = () => ({ workspaces: [], sessions: [], tombstones: [] });
const target = (
  format = "sha1",
  kind = "branch",
  exists = true,
  roles = ["head_log", "branch_log"],
) => {
  const width = format === "sha1" ? 40 : 64;
  return {
    objectFormat: format,
    previewDigest: "b".repeat(64),
    indexDigest: "c".repeat(64),
    headOid: exists ? "1".repeat(width) : null,
    treeOid: "2".repeat(width),
    treeDigest: "d".repeat(64),
    commitOid: "3".repeat(width),
    commitBodyDigest: "e".repeat(64),
    reference: {
      kind,
      name: kind === "head" ? null : "refs/heads/main",
      exists,
      digest: exists ? "f".repeat(64) : GIT_COMMIT_ABSENT_DIGEST,
      nextDigest: "9".repeat(64),
    },
    logs: roles.map((role) => ({
      role,
      exists,
      digest: exists ? "f".repeat(64) : GIT_COMMIT_ABSENT_DIGEST,
      nextDigest: "8".repeat(64),
      nextBytes: 256,
    })),
  };
};
const record = (t) => ({
  ...identity,
  admission: "dispatched",
  delivery: "accepted",
  effect: "confirmed",
  revision: 5,
  evidence: [],
  result: {
    kind: "git_commit_created",
    workspaceId: identity.workspaceId,
    commitOid: t.commitOid,
    treeOid: t.treeOid,
    parentOid: t.headOid,
    referenceDigest: t.reference.nextDigest,
    logDigests: t.logs.map((x) => ({ role: x.role, digest: x.nextDigest })),
    previewDigest: t.previewDigest,
    backups: gitCommitExpectedBackups(
      t,
      identity.runtimeEpoch,
      identity.operationId,
    ),
    digest: identity.digest,
  },
});
const operation = (t) => ({
  identity,
  gitCommitTarget: t,
  dispatches: ["stage", "publish"].map((step) => ({
    step: storage.GIT_COMMIT_STEPS[step],
    gitCommitTarget: globalThis.structuredClone(t),
  })),
});

test("GC helper correlates exact SHA1/SHA256 attached, unborn, detached, no-log and absent backup results", () => {
  for (const format of ["sha1", "sha256"])
    for (const [kind, exists, roles] of [
      ["branch", true, ["head_log", "branch_log"]],
      ["branch", false, ["head_log", "branch_log"]],
      ["branch", true, []],
      ["head", true, ["head_log"]],
    ]) {
      const t = target(format, kind, exists, roles),
        r = record(t),
        op = operation(t);
      storage.validateGitCommitCompletion(op, { receipt: r, delta: empty() }, [
        storage.GIT_COMMIT_FEATURE,
      ]);
      for (const backup of r.result.backups)
        assert.equal(
          backup.backupId,
          exists
            ? `.omoc-git-commit-${createHash("sha256")
                .update(
                  JSON.stringify([
                    identity.runtimeEpoch,
                    identity.operationId,
                    backup.role,
                  ]),
                )
                .digest("hex")}.backup`
            : null,
        );
      const projected = redactReceipt({
        ...r,
        gitCommitTarget: t,
        author: "private",
        message: "private",
        body: "private",
        logs: "private",
        config: "private",
        root: "/private",
        token: "private",
      });
      assert.deepEqual(projected.result, r.result);
      for (const field of [
        "author",
        "message",
        "body",
        "logs",
        "config",
        "root",
        "token",
        "gitCommitTarget",
        "digest",
      ])
        assert.equal(Object.hasOwn(projected, field), false);
      projected.result.backups[0].backupId = null;
      if (exists) assert.notEqual(r.result.backups[0].backupId, null);
      assert.equal(
        redactReceipt({ ...r, digest: undefined }).result,
        undefined,
      );
      assert.equal(
        redactReceipt({ ...r, gitCommitTarget: t, digest: "0".repeat(64) })
          .result,
        undefined,
      );
    }
});

test("GC helper rejects forged commit/tree/parent/ref/log/preview/original digest and independently keyed backups", () => {
  const t = target(),
    op = operation(t),
    original = record(t);
  const wrong = {
    commitOid: "4".repeat(40),
    treeOid: "4".repeat(40),
    parentOid: null,
    referenceDigest: "4".repeat(64),
    previewDigest: "4".repeat(64),
    digest: "4".repeat(64),
    logDigests: [
      { role: "head_log", digest: "4".repeat(64) },
      { role: "branch_log", digest: "8".repeat(64) },
    ],
    backups: gitCommitExpectedBackups(t, "different", identity.operationId),
  };
  for (const [field, value] of Object.entries(wrong)) {
    const r = { ...original, result: { ...original.result, [field]: value } };
    assert.equal(
      storage.validGitCommitCreatedResult(r, t, identity.digest),
      false,
      field,
    );
    assert.throws(
      () =>
        storage.validateGitCommitCompletion(
          op,
          { receipt: r, delta: empty() },
          [storage.GIT_COMMIT_FEATURE],
        ),
      field,
    );
  }
  for (const backups of [
    original.result.backups.slice(1),
    [...original.result.backups].reverse(),
    original.result.backups.map((x) => ({ ...x, backupId: null })),
    original.result.backups.map((x) => ({ ...x, role: "head_ref" })),
    gitCommitExpectedBackups(t, identity.runtimeEpoch, "different"),
  ]) {
    const r = { ...original, result: { ...original.result, backups } };
    assert.equal(
      storage.validGitCommitCreatedResult(r, t, identity.digest),
      false,
    );
  }
  for (const logDigests of [
    [],
    [...original.result.logDigests].reverse(),
    original.result.logDigests.map((x) => ({ ...x, bytes: "private" })),
  ])
    assert.equal(
      storage.validGitCommitCreatedResult(
        { ...original, result: { ...original.result, logDigests } },
        t,
        identity.digest,
      ),
      false,
    );
  const absent = target("sha1", "branch", false);
  const forged = record(absent);
  forged.result.backups = original.result.backups;
  assert.equal(
    storage.validGitCommitCreatedResult(forged, absent, identity.digest),
    false,
  );
});

test("GC helper uses frozen public closed target fields and rejects descriptors without invoking getters", () => {
  const t = target(),
    apply = {
      type: identity.type,
      workspaceId: identity.workspaceId,
      requestId: "commit",
      previewId: "a".repeat(64),
      ...globalThis.structuredClone(t),
    };
  const admitted = storage.gitCommitTargetAdmission(apply);
  assert.deepEqual(Object.keys(admitted), [...GIT_COMMIT_TARGET_FIELDS]);
  apply.reference.name = "refs/heads/changed";
  apply.logs[0].nextDigest = "0".repeat(64);
  assert.deepEqual(admitted, t);
  let calls = 0;
  const getter = target();
  Object.defineProperty(getter.reference, "digest", {
    enumerable: true,
    get() {
      calls++;
      return "a".repeat(64);
    },
  });
  const arrayGetter = target();
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
    { ...t, author: undefined },
    { ...t, [Symbol("private")]: true },
    { ...t, reference: { ...t.reference, root: undefined } },
    { ...t, logs: [{ ...t.logs[0], body: undefined }] },
    { ...t, logs: Object.assign([], { hidden: undefined }) },
  ])
    assert.throws(() =>
      storage.validateGitCommitAdmission({
        identity,
        expectedRevision: 0,
        gitCommitTarget,
      }),
    );
  assert.equal(calls, 0);
  for (const change of [
    { identity: { ...identity, sessionId: "session" } },
    { expectedRevision: undefined },
    { gitIndexTarget: undefined },
    { nativeServerName: undefined },
    { agentSourceName: undefined },
  ])
    assert.throws(() =>
      storage.validateGitCommitAdmission({
        identity,
        expectedRevision: 0,
        gitCommitTarget: t,
        ...change,
      }),
    );
});

test("GC helper requires exact ordered target pair, empty delta, no reservation and no native metadata", () => {
  const t = target(),
    op = { ...operation(t), dispatches: [] };
  const [stage, publish] = operation(t).dispatches;
  assert.throws(() => storage.validateGitCommitDispatch(op, publish));
  storage.validateGitCommitDispatch(op, stage);
  op.dispatches.push(stage);
  assert.throws(() => storage.validateGitCommitDispatch(op, stage));
  for (const field of [
    "nativeSessionId",
    "nativeServerName",
    "agentRuntime",
    "skillRuntime",
    "fileTarget",
    "gitIndexTarget",
  ])
    assert.throws(() =>
      storage.validateGitCommitDispatch(op, { ...publish, [field]: undefined }),
    );
  storage.validateGitCommitDispatch(op, publish);
  op.dispatches.push(publish);
  assert.throws(() => storage.validateGitCommitDispatch(op, publish));
  for (const delta of [
    { ...empty(), tombstones: [{ kind: "workspace", id: "workspace" }] },
    { ...empty(), workspaces: [{}] },
    { ...empty(), sessions: [{}] },
  ])
    assert.throws(() =>
      storage.validateGitCommitCompletion(op, { receipt: record(t), delta }, [
        storage.GIT_COMMIT_FEATURE,
      ]),
    );
  for (const patch of [
    { reserved: true },
    { reservation: {} },
    { dispatches: [publish] },
    { dispatches: [stage, { ...publish, gitCommitTarget: target("sha256") }] },
    { completedDelta: empty(), receipt: { ...record(t), effect: "unknown" } },
  ])
    assert.throws(() =>
      storage.validateGitCommitCompletion(
        { ...op, ...patch },
        { receipt: record(t), delta: empty() },
        [storage.GIT_COMMIT_FEATURE],
      ),
    );
  assert.throws(
    () =>
      storage.validateGitCommitCompletion(
        op,
        { receipt: record(t), delta: empty() },
        [],
      ),
    { code: "unsupported_version" },
  );
  assert.throws(() =>
    storage.validateGitCommitDispatch(
      { identity: { ...identity, type: "file.save" } },
      stage,
    ),
  );
  assert.throws(() =>
    storage.validateGitCommitReceipt({ ...record(t), type: "file.save" }),
  );
});
