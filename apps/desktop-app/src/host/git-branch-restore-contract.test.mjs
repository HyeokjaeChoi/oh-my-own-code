import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  gitBranchRestoreBlob,
  gitBranchRestoreBackupId,
  gitBranchRestoreIdentityDigest,
  gitBranchRestoreOccupancyDigest,
  validateGitBranchRestoreKernelResult,
  validateGitBranchRestoreKernelTokenRequest,
  validateGitBranchRestoreArtifactManifest,
} from "./git-branch-restore-contract.mjs";

test("private object proof rejects accessors before reading them", () => {
  const H = "a".repeat(64),
    head = "1".repeat(40),
    tree = "2".repeat(40),
    author = { name: "Synthetic", email: "synthetic@example.invalid" },
    timestamp = 1;
  const target = {
    action: "create",
    objectFormat: "sha1",
    previewDigest: H,
    occupancyDigest: H,
    branch: "refs/heads/next",
    source: null,
    currentBranch: "refs/heads/main",
    headOid: head,
    nextHeadOid: head,
    treeOid: tree,
    headDigest: H,
    indexExists: true,
    indexDigest: H,
    identityDigest: gitBranchRestoreIdentityDigest(author, timestamp),
    timestamp,
    paths: [],
    metadata: [
      { role: "branch_ref", before: null, after: { bytes: 41, digest: H } },
    ],
  };
  const request = {
    runtimeEpoch: "epoch",
    operationId: "o1",
    workspaceId: "w1",
    workspacePath: "/synthetic/repo",
    digest: H,
    target,
    artifact: {
      root: "/private/synthetic-artifact",
      dev: "1",
      ino: "2",
      manifest: { path: "manifest.json", bytes: 1, digest: H },
    },
  };
  const directory = (path) => ({ path, dev: "1", ino: "3" });
  const markers = [
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
  ];
  let reads = 0;
  const object = {};
  Object.defineProperty(object, "oid", {
    enumerable: true,
    get() {
      reads++;
      return head;
    },
  });
  const manifest = {
    schemaVersion: 1,
    feature: "git_branch_restore_mutation_v1",
    runtimeEpoch: "epoch",
    operationId: "o1",
    workspaceId: "w1",
    workspacePath: "/synthetic/repo",
    digest: H,
    target,
    layout: {
      root: directory("/synthetic/repo"),
      gitDirectory: directory("/synthetic/repo/.git"),
      commonDirectory: directory("/synthetic/repo/.git"),
    },
    source: {
      directories: [],
      files: [],
      listings: [],
      missing: markers.map((x) => "/synthetic/repo/.git/" + x),
    },
    author,
    currentEntries: [],
    desiredEntries: [],
    worktree: [],
    metadata: [
      {
        role: "branch_ref",
        proposal: { path: "proposal.branch_ref", bytes: 41, digest: H },
      },
    ],
    objects: [object],
  };
  assert.throws(
    () => validateGitBranchRestoreArtifactManifest(manifest, request),
    { appCode: "INVALID_REQUEST" },
  );
  assert.equal(reads, 0);
});
const oid = (raw, format) =>
  createHash(format)
    .update(Buffer.from(`blob ${raw.length}\0`))
    .update(raw)
    .digest("hex");
for (const format of ["sha1", "sha256"])
  test(`raw ${format} blob identity and bounded ident preserve BOM/CRLF/binary`, () => {
    const raw = Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from("before\r\n$Id$\r\nafter\0$Id$\n"),
      ]),
      key = oid(raw, format);
    assert.deepEqual(gitBranchRestoreBlob(raw, key, format, false), raw);
    const expected = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(`before\r\n$Id: ${key} $\r\nafter\0$Id: ${key} $\n`),
    ]);
    assert.deepEqual(gitBranchRestoreBlob(raw, key, format, true), expected);
    assert.throws(
      () => gitBranchRestoreBlob(raw, "0".repeat(key.length), format, true),
      { appCode: "INVALID_REQUEST" },
    );
    const expanded = Buffer.from(`$Id: ${key} $`);
    assert.throws(
      () => gitBranchRestoreBlob(expanded, oid(expanded, format), format, true),
      { appCode: "INVALID_REQUEST" },
    );
    assert.deepEqual(
      gitBranchRestoreBlob(expanded, oid(expanded, format), format, false),
      expanded,
    );
  });
test("ident expansion refuses bytes beyond the existing 16MiB bound", () => {
  const raw = Buffer.alloc(16777216, 65);
  Buffer.from("$Id$").copy(raw);
  assert.throws(
    () => gitBranchRestoreBlob(raw, oid(raw, "sha1"), "sha1", true),
    { appCode: "INVALID_REQUEST" },
  );
});
test("original-key backup includes role/path and identity digest includes explicit time", () => {
  const a = gitBranchRestoreBackupId("old", "same", "worktree", "a.txt");
  assert.notEqual(
    a,
    gitBranchRestoreBackupId("new", "same", "worktree", "a.txt"),
  );
  assert.notEqual(
    a,
    gitBranchRestoreBackupId("old", "same", "worktree", "b.txt"),
  );
  assert.notEqual(a, gitBranchRestoreBackupId("old", "same", "index"));
  const author = { name: "Synthetic User", email: "synthetic@example.invalid" };
  assert.notEqual(
    gitBranchRestoreIdentityDigest(author, 1),
    gitBranchRestoreIdentityDigest(author, 2),
  );
  assert.throws(
    () => gitBranchRestoreIdentityDigest({ ...author, extra: true }, 1),
    { appCode: "INVALID_REQUEST" },
  );
});
test("occupancy binds complete canonical record order including locked and backlink digests", () => {
  const rows = [
      ["/synthetic/common", "a".repeat(64), null, null, null],
      [
        "/synthetic/common/worktrees/child",
        "b".repeat(64),
        "c".repeat(64),
        "d".repeat(64),
        null,
      ],
    ],
    key = gitBranchRestoreOccupancyDigest(rows);
  assert.match(key, /^[a-f0-9]{64}$/u);
  assert.notEqual(
    key,
    gitBranchRestoreOccupancyDigest([
      rows[0],
      [...rows[1].slice(0, 4), "e".repeat(64)],
    ]),
  );
  assert.throws(() => gitBranchRestoreOccupancyDigest([...rows].reverse()), {
    appCode: "INVALID_REQUEST",
  });
});
test("typed kernel token and unknown are closed without permitting authority upgrade", () => {
  assert.deepEqual(
    validateGitBranchRestoreKernelTokenRequest({ token: "a".repeat(64) }),
    { token: "a".repeat(64) },
  );
  assert.throws(
    () =>
      validateGitBranchRestoreKernelTokenRequest({
        token: "a".repeat(64),
        kind: "commit",
      }),
    { appCode: "INVALID_REQUEST" },
  );
  for (const reason of [
    "unsupported_branch_restore_state",
    "branch_occupied",
    "deadline",
    "process_unverified",
  ]) {
    const v = { status: "unknown", reason };
    assert.equal(validateGitBranchRestoreKernelResult(v), v);
    assert.throws(
      () =>
        validateGitBranchRestoreKernelResult({ ...v, token: "a".repeat(64) }),
      { appCode: "INVALID_REQUEST" },
    );
  }
});
