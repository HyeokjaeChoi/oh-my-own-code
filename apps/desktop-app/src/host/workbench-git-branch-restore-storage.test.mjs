import test from "node:test";
import assert from "node:assert/strict";
import * as storage from "./workbench-git-branch-restore-storage.mjs";
import { gitBranchRestoreExpectedBackups } from "./git-branch-restore-contract.mjs";
import { redactReceipt } from "./workbench-receipts.mjs";
const clone = globalThis.structuredClone;
const identity = {
  runtimeEpoch: "original",
  operationId: "restore",
  type: "git.restore.apply",
  workspaceId: "workspace",
  digest: "a".repeat(64),
};
const empty = () => ({ workspaces: [], sessions: [], tombstones: [] });
function target(action = "restore", format = "sha1", exists = true) {
  const oid = "1".repeat(format === "sha1" ? 40 : 64);
  const before = exists
    ? { bytes: 3, digest: "a".repeat(64), mode: 0o600 }
    : null;
  return {
    action,
    objectFormat: format,
    previewDigest: "b".repeat(64),
    occupancyDigest: "c".repeat(64),
    branch: action === "restore" ? null : "refs/heads/topic",
    source: action === "restore" ? "index" : null,
    currentBranch: "refs/heads/main",
    headOid: oid,
    nextHeadOid: oid,
    treeOid: oid,
    headDigest: "d".repeat(64),
    indexExists: true,
    indexDigest: "e".repeat(64),
    identityDigest: action === "restore" ? null : "f".repeat(64),
    timestamp: action === "restore" ? null : 1,
    paths:
      action === "create"
        ? []
        : [
            {
              path: "src/a.txt",
              before,
              after: { bytes: 4, digest: "9".repeat(64), mode: 0o600 },
              beforeEntry: { mode: 0o100644, oid },
              afterEntry: { mode: 0o100644, oid },
              ident: false,
            },
          ],
    metadata:
      action === "restore"
        ? []
        : action === "create"
          ? [
              {
                role: "branch_ref",
                before: null,
                after: { bytes: 41, digest: "8".repeat(64) },
              },
            ]
          : [
              {
                role: "index",
                before: { bytes: 12, digest: "e".repeat(64) },
                after: { bytes: 12, digest: "8".repeat(64) },
              },
              {
                role: "head_ref",
                before: { bytes: 20, digest: "d".repeat(64) },
                after: { bytes: 21, digest: "7".repeat(64) },
              },
            ],
  };
}
function record(t) {
  const type =
    t.action === "restore" ? "git.restore.apply" : "git.branch.apply";
  return {
    ...identity,
    type,
    admission: "dispatched",
    delivery: "accepted",
    effect: "confirmed",
    revision: 5,
    evidence: [],
    result: {
      kind: "git_branch_restore_applied",
      workspaceId: identity.workspaceId,
      action: t.action,
      previewDigest: t.previewDigest,
      paths: t.paths.map((x) => ({ path: x.path, after: clone(x.after) })),
      metadata: t.metadata.map((x) => ({
        role: x.role,
        digest: x.after.digest,
      })),
      backups: gitBranchRestoreExpectedBackups(
        t,
        identity.runtimeEpoch,
        identity.operationId,
      ),
      digest: identity.digest,
    },
  };
}
function operation(t) {
  return {
    identity: { ...identity, type: record(t).type },
    gitBranchRestoreTarget: t,
    dispatches: ["stage", "publish"].map((step) => ({
      step: storage.GIT_BRANCH_RESTORE_STEPS[step],
      gitBranchRestoreTarget: clone(t),
    })),
  };
}
test("BR helper binds all actions, object formats and original-key nullable backups", () => {
  for (const action of ["create", "select", "restore"])
    for (const format of ["sha1", "sha256"])
      for (const exists of [true, false]) {
        const t = target(action, format, exists),
          r = record(t),
          op = operation(t);
        storage.validateGitBranchRestoreCompletion(
          op,
          { receipt: r, delta: empty() },
          [storage.GIT_BRANCH_RESTORE_FEATURE],
        );
        const projected = redactReceipt({
          ...r,
          gitBranchRestoreTarget: t,
          author: "private",
          body: "private",
          config: "private",
          argv: ["private"],
          reflog: "private",
          root: "/private",
        });
        assert.deepEqual(projected.result, r.result);
        for (const k of [
          "gitBranchRestoreTarget",
          "digest",
          "author",
          "body",
          "config",
          "argv",
          "reflog",
          "root",
        ])
          assert.equal(Object.hasOwn(projected, k), false);
        if (projected.result.paths.length)
          projected.result.paths[0].after.digest = "0".repeat(64);
        assert.deepEqual(r.result, record(t).result);
        assert.equal(
          redactReceipt({
            ...r,
            gitBranchRestoreTarget: t,
            digest: "0".repeat(64),
          }).result,
          undefined,
        );
      }
});
test("BR helper rejects forged action, paths, modes, metadata, preview, digest and backup authority", () => {
  for (const action of ["create", "select", "restore"]) {
    const t = target(action),
      r = record(t),
      op = operation(t);
    for (const patch of [
      { action: action === "create" ? "restore" : "create" },
      { paths: [{ path: "forged.txt", after: null }] },
      { metadata: [{ role: "head_ref", digest: "0".repeat(64) }] },
      { previewDigest: "0".repeat(64) },
      { digest: "0".repeat(64) },
      {
        backups: gitBranchRestoreExpectedBackups(
          t,
          "different",
          identity.operationId,
        ),
      },
      {
        backups: gitBranchRestoreExpectedBackups(
          t,
          identity.runtimeEpoch,
          "different",
        ),
      },
      { raw: undefined },
    ]) {
      const bad = { ...r, result: { ...r.result, ...patch } };
      // Originally absent targets legitimately have no keyed backup. Test non-null correlations separately.
      if (
        patch.backups &&
        JSON.stringify(patch.backups) === JSON.stringify(r.result.backups)
      )
        continue;
      assert.equal(
        storage.validGitBranchRestoreAppliedResult(bad, t, identity.digest),
        false,
      );
      assert.throws(() =>
        storage.validateGitBranchRestoreCompletion(
          op,
          { receipt: bad, delta: empty() },
          [storage.GIT_BRANCH_RESTORE_FEATURE],
        ),
      );
    }
    if (t.paths.length) {
      const bad = clone(r);
      bad.result.paths[0].after.mode = 0o700;
      assert.equal(
        storage.validGitBranchRestoreAppliedResult(bad, t, identity.digest),
        false,
      );
    }
    assert.throws(() =>
      storage.validateGitBranchRestoreCompletion(
        op,
        { receipt: r, delta: { ...empty(), workspaces: [{}] } },
        [storage.GIT_BRANCH_RESTORE_FEATURE],
      ),
    );
    assert.throws(() =>
      storage.validateGitBranchRestoreCompletion(
        {
          ...op,
          completedDelta: empty(),
          receipt: { ...r, effect: "unknown" },
        },
        { receipt: r, delta: empty() },
        [storage.GIT_BRANCH_RESTORE_FEATURE],
      ),
    );
  }
});
test("BR helper refuses descriptors, undefined metadata and wrong action before copy", () => {
  const t = target(),
    op = operation(t);
  let calls = 0;
  const getter = clone(t);
  Object.defineProperty(getter.paths[0].after, "digest", {
    enumerable: true,
    get() {
      calls++;
      return "a".repeat(64);
    },
  });
  const array = clone(t);
  Object.defineProperty(array.paths, "0", {
    enumerable: true,
    get() {
      calls++;
      return t.paths[0];
    },
  });
  for (const v of [
    getter,
    array,
    { ...t, extra: undefined },
    { ...t, paths: [{ ...t.paths[0], extra: undefined }] },
    { ...t, action: "create" },
  ])
    assert.throws(() =>
      storage.validateGitBranchRestoreAdmission({
        identity,
        expectedRevision: 0,
        gitBranchRestoreTarget: v,
      }),
    );
  for (const patch of [
    { expectedRevision: undefined },
    { identity: { ...identity, sessionId: "session" } },
    { nativeServerName: undefined },
    { gitCommitTarget: undefined },
    { fileTarget: undefined },
    { identity: { ...identity, type: "git.branch.apply" } },
  ])
    assert.throws(() =>
      storage.validateGitBranchRestoreAdmission({
        identity,
        expectedRevision: 0,
        gitBranchRestoreTarget: t,
        ...patch,
      }),
    );
  assert.equal(calls, 0);
  const apply = {
    type: identity.type,
    workspaceId: identity.workspaceId,
    requestId: identity.operationId,
    previewId: "a".repeat(64),
    ...clone(t),
  };
  const admitted = storage.gitBranchRestoreTargetAdmission(apply);
  apply.paths[0].path = "changed";
  assert.deepEqual(admitted, t);
  const [stage, publish] = op.dispatches;
  op.dispatches = [];
  assert.throws(() => storage.validateGitBranchRestoreDispatch(op, publish));
  storage.validateGitBranchRestoreDispatch(op, stage);
  op.dispatches.push(stage);
  assert.throws(() => storage.validateGitBranchRestoreDispatch(op, stage));
  for (const patch of [
    { nativeSessionId: undefined },
    { gitCommitTarget: undefined },
    { extra: undefined },
    { gitBranchRestoreTarget: getter },
    { step: "native.send" },
  ])
    assert.throws(() =>
      storage.validateGitBranchRestoreDispatch(op, { ...publish, ...patch }),
    );
  storage.validateGitBranchRestoreDispatch(op, publish);
  op.dispatches.push(publish);
  assert.throws(() => storage.validateGitBranchRestoreDispatch(op, publish));
  assert.equal(calls, 0);
  assert.throws(() =>
    storage.validateGitBranchRestoreDispatch(
      { identity: { ...identity, type: "file.save" } },
      stage,
    ),
  );
  assert.throws(() =>
    storage.validateGitBranchRestoreReceipt({
      ...record(t),
      type: "file.save",
    }),
  );
});

test("BR helper binds optional log roles, after deletion, and present versus absent original backups", () => {
  for (const action of ["create", "select"])
    for (const exists of [true, false]) {
      const t = target(action);
      const log = {
        role: action === "create" ? "branch_log" : "head_log",
        before: exists ? { bytes: 10, digest: "6".repeat(64) } : null,
        after: { bytes: 20, digest: "5".repeat(64) },
      };
      t.metadata.splice(action === "create" ? 0 : 1, 0, log);
      const r = record(t);
      storage.validateGitBranchRestoreCompletion(
        operation(t),
        { receipt: r, delta: empty() },
        [storage.GIT_BRANCH_RESTORE_FEATURE],
      );
      for (const backups of [
        [...r.result.backups].reverse(),
        r.result.backups.map((x) => ({ ...x, path: "forged.txt" })),
        r.result.backups.map((x) => ({
          ...x,
          backupId:
            x.backupId === null
              ? `.omoc-git-branch-restore-${"0".repeat(64)}.backup`
              : null,
        })),
      ])
        assert.equal(
          storage.validGitBranchRestoreAppliedResult(
            { ...r, result: { ...r.result, backups } },
            t,
            identity.digest,
          ),
          false,
        );
    }
  const t = target();
  t.source = "head";
  t.paths[0].after = null;
  t.paths[0].afterEntry = null;
  storage.validateGitBranchRestoreCompletion(
    operation(t),
    { receipt: record(t), delta: empty() },
    [storage.GIT_BRANCH_RESTORE_FEATURE],
  );
});
test("BR helper enforces bounded paths and affected bytes before detachment", () => {
  const t = target();
  const overPaths = clone(t);
  overPaths.paths = Array.from({ length: 129 }, (_, i) => ({
    ...clone(t.paths[0]),
    path: `p${String(i).padStart(3, "0")}`,
  }));
  const overBytes = clone(t);
  overBytes.paths[0].before.bytes = 16777216;
  for (const gitBranchRestoreTarget of [overPaths, overBytes])
    assert.throws(() =>
      storage.validateGitBranchRestoreAdmission({
        identity,
        expectedRevision: 0,
        gitBranchRestoreTarget,
      }),
    );
});
