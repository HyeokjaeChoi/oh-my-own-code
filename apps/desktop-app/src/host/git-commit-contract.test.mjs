import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import {
  gitCommitBackupId,
  GIT_COMMIT_STATE_MARKERS,
  validateGitCommitKernelRequest,
  validateGitCommitArtifactManifest,
  validateGitCommitKernelResult,
  gitCommitExpectedBackups,
} from "./git-commit-contract.mjs";
import { GIT_COMMIT_ABSENT_DIGEST } from "../renderer/shared/git-commit/index.mjs";
test("Commit backup binds original epoch operation and exact closed role", () => {
  const expected =
    ".omoc-git-commit-" +
    createHash("sha256")
      .update(JSON.stringify(["epoch-1", "operation-1", "head_log"]))
      .digest("hex") +
    ".backup";
  assert.equal(
    gitCommitBackupId("epoch-1", "operation-1", "head_log"),
    expected,
  );
  assert.notEqual(
    gitCommitBackupId("epoch-2", "operation-1", "head_log"),
    expected,
  );
  assert.notEqual(
    gitCommitBackupId("epoch-1", "operation-1", "branch_log"),
    expected,
  );
  assert.throws(
    () => gitCommitBackupId("epoch-1", "operation-1", "arbitrary/path"),
    { appCode: "INVALID_REQUEST" },
  );
  assert.deepEqual(GIT_COMMIT_STATE_MARKERS, [
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "REBASE_HEAD",
    "rebase-apply",
    "rebase-merge",
    "sequencer",
    "MERGE_MSG",
    "MERGE_MODE",
    "SQUASH_MSG",
    "AUTO_MERGE",
  ]);
});

const h = "a".repeat(64),
  hash = (v) => createHash("sha256").update(v).digest("hex");
const invalid = (fn) => assert.throws(fn, { appCode: "INVALID_REQUEST" });
function fixture() {
  const target = {
    objectFormat: "sha1",
    previewDigest: h,
    indexDigest: h,
    headOid: null,
    treeOid: "b".repeat(40),
    treeDigest: hash("[]"),
    commitOid: "c".repeat(40),
    commitBodyDigest: h,
    reference: {
      kind: "branch",
      name: "refs/heads/nested/branch",
      exists: false,
      digest: GIT_COMMIT_ABSENT_DIGEST,
      nextDigest: h,
    },
    logs: [],
  };
  const request = {
    runtimeEpoch: "epoch-1",
    operationId: "operation-1",
    workspaceId: "workspace-1",
    workspacePath: "/SYNTHETIC/workspace",
    digest: h,
    target,
    artifact: {
      root: "/SYNTHETIC/artifact",
      dev: "1",
      ino: "2",
      manifest: { path: "manifest.json", bytes: 100, digest: h },
    },
  };
  const git = "/SYNTHETIC/workspace/.git",
    dir = (path) => ({ path, dev: "1", ino: "3" });
  const manifest = {
    schemaVersion: 1,
    feature: "git_commit_mutation_v1",
    runtimeEpoch: request.runtimeEpoch,
    operationId: request.operationId,
    workspaceId: request.workspaceId,
    workspacePath: request.workspacePath,
    digest: h,
    target: globalThis.structuredClone(target),
    layout: {
      root: dir(request.workspacePath),
      gitDirectory: dir(git),
      commonDirectory: dir(git),
    },
    source: {
      directories: [dir(request.workspacePath), dir(git)],
      files: [{ path: git + "/index", signature: "1:2:3:4:5:6:7", digest: h }],
      listings: [{ path: git, names: ["index"] }],
      missing: GIT_COMMIT_STATE_MARKERS.map((name) => git + "/" + name),
    },
    author: { name: "SYNTHETIC", email: "synthetic@example.invalid" },
    timestamp: 1234567890,
    canonicalMessage: "SYNTHETIC\n",
    entries: [],
    commit: { path: "commit.body", bytes: 100, digest: h },
    reference: { path: "proposal.reference", bytes: 41, digest: h },
    logs: [],
    objects: [
      {
        oid: target.treeOid,
        type: "tree",
        rawBytes: 0,
        path: `objects/${target.treeOid.slice(0, 2)}/${target.treeOid.slice(2)}`,
        bytes: 10,
        digest: h,
        install: true,
      },
      {
        oid: target.commitOid,
        type: "commit",
        rawBytes: 100,
        path: `objects/${target.commitOid.slice(0, 2)}/${target.commitOid.slice(2)}`,
        bytes: 100,
        digest: h,
        install: true,
      },
    ],
  };
  return { request, manifest };
}

test("Commit private request excludes public source bodies and overlapping artifact authority", () => {
  const { request: r } = fixture();
  assert.equal(validateGitCommitKernelRequest(r), r);
  for (const edit of [
    { message: "private" },
    { author: { name: "private" } },
    { artifact: { ...r.artifact, root: r.workspacePath + "/scratch" } },
    { artifact: { ...r.artifact, root: "/SYNTHETIC" } },
    { target: { ...r.target, text: "private" } },
    { runtimeEpoch: "invalid epoch" },
  ])
    invalid(() => validateGitCommitKernelRequest({ ...r, ...edit }));
});

test("Commit manifest is original-bound and requires exact commit-only state absence", () => {
  const { request: r, manifest: m } = fixture();
  assert.equal(validateGitCommitArtifactManifest(m, r), m);
  for (const marker of GIT_COMMIT_STATE_MARKERS)
    invalid(() =>
      validateGitCommitArtifactManifest(
        {
          ...m,
          source: {
            ...m.source,
            missing: m.source.missing.filter((p) => !p.endsWith("/" + marker)),
          },
        },
        r,
      ),
    );
  for (const edit of [
    { digest: "e".repeat(64) },
    { runtimeEpoch: "epoch-2" },
    { operationId: "other" },
    {
      entries: [
        { path: "unexpected.txt", mode: 0o100644, oid: "d".repeat(40) },
      ],
    },
    { reference: { ...m.reference, path: "refs/heads/untrusted" } },
    { commit: { ...m.commit, digest: "e".repeat(64) } },
    { objects: m.objects.slice(1) },
    { source: { ...m.source, files: [] } },
    {
      source: {
        ...m.source,
        missing: [...m.source.missing, m.source.missing[0]],
      },
    },
    { author: { ...m.author, name: " leading" } },
    { canonicalMessage: "no LF" },
    { timestamp: -1 },
  ])
    invalid(() => validateGitCommitArtifactManifest({ ...m, ...edit }, r));
});

test("Commit manifest rejects source alias, getters and artifact extensions", () => {
  const { request: r, manifest: m } = fixture();
  for (const object of [
    { ...m.objects[0], type: "blob" },
    { ...m.objects[0], install: undefined },
    { ...m.objects[0], path: "../outside" },
    { ...m.objects[0], rawBytes: 134217729 },
  ])
    invalid(() =>
      validateGitCommitArtifactManifest(
        { ...m, objects: [object, m.objects[1]] },
        r,
      ),
    );
  let called = 0;
  const bad = { ...r };
  Object.defineProperty(bad, "digest", {
    enumerable: true,
    get() {
      called++;
      return h;
    },
  });
  invalid(() => validateGitCommitKernelRequest(bad));
  assert.equal(called, 0);
  invalid(() =>
    validateGitCommitArtifactManifest(
      {
        ...m,
        layout: {
          ...m.layout,
          commonDirectory: {
            ...m.layout.commonDirectory,
            path: r.artifact.root,
          },
        },
      },
      r,
    ),
  );
});

test("Commit private result and original-key backup role correlation stay closed", () => {
  const { request: r } = fixture();
  assert.deepEqual(
    gitCommitExpectedBackups(r.target, r.runtimeEpoch, r.operationId),
    [{ role: "branch_ref", backupId: null }],
  );
  const result = {
    status: "committed",
    commitOid: r.target.commitOid,
    treeOid: r.target.treeOid,
    referenceDigest: h,
    logDigests: [],
    backups: [{ role: "branch_ref", backupId: null }],
  };
  assert.equal(validateGitCommitKernelResult(result), result);
  invalid(() =>
    validateGitCommitKernelResult({ ...result, requestId: "escaped" }),
  );
  invalid(() => validateGitCommitKernelResult({ ...result, token: h }));
  assert.deepEqual(
    validateGitCommitKernelResult({
      status: "unknown",
      reason: "unsupported_commit_state",
    }),
    { status: "unknown", reason: "unsupported_commit_state" },
  );
  invalid(() =>
    validateGitCommitKernelResult({
      status: "unknown",
      reason: "none",
      body: "private",
    }),
  );
});
