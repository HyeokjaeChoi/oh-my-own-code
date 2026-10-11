import test from "node:test";
import assert from "node:assert/strict";
import { validateRequest, validateEnvelope } from "./workbench-contract.mjs";
import {
  gitBranchRestoreMode,
  validGitBranchRestoreTarget,
  validateGitBranchRestorePreview,
  gitBranchRestoreTargetFromApply,
  validateGitBranchRestoreReceiptResult,
} from "./renderer/shared/git-branch-restore/index.mjs";
import { gitBranchRestoreExpectedBackups } from "./host/git-branch-restore-contract.mjs";
const H = "a".repeat(64),
  OID = "1".repeat(40),
  TREE = "2".repeat(40);
const file = (digest, mode = 0o640) => ({
  bytes: 4,
  digest: digest.repeat(64),
  mode,
});
const byte = (digest, bytes = 41) => ({ bytes, digest: digest.repeat(64) });
const target = (action = "create") => ({
  action,
  objectFormat: "sha1",
  previewDigest: H,
  occupancyDigest: H,
  branch: action === "restore" ? null : "refs/heads/next",
  source: action === "restore" ? "index" : null,
  currentBranch: "refs/heads/main",
  headOid: OID,
  nextHeadOid: OID,
  treeOid: TREE,
  headDigest: H,
  indexExists: true,
  indexDigest: H,
  identityDigest: action === "restore" ? null : H,
  timestamp: action === "restore" ? null : 1770000000,
  paths:
    action === "restore"
      ? [
          {
            path: "ordinary.txt",
            before: file("b"),
            after: file("c"),
            beforeEntry: { mode: 0o100644, oid: OID },
            afterEntry: { mode: 0o100644, oid: OID },
            ident: false,
          },
        ]
      : [],
  metadata:
    action === "create"
      ? [{ role: "branch_ref", before: null, after: byte("d") }]
      : action === "select"
        ? [
            { role: "index", before: byte("a"), after: byte("b") },
            { role: "head_ref", before: byte("a"), after: byte("c") },
          ]
        : [],
});
const apply = (t) => ({
  type: t.action === "restore" ? "git.restore.apply" : "git.branch.apply",
  workspaceId: "w1",
  requestId: "o1",
  previewId: H,
  ...t,
});

test("branch preview validates explicit identity without implicit switching", () => {
  const request = {
    type: "git.branch.preview.read",
    workspaceId: "w1",
    observationId: "a".repeat(64),
    action: "create",
    branch: "refs/heads/feature",
    author: { name: "Synthetic User", email: "synthetic@example.invalid" },
  };
  assert.equal(validateRequest(request), request);
});

for (const action of ["create", "select", "restore"])
  test(`closed ${action} target and detached immutable admission`, () => {
    const t = target(action),
      r = apply(globalThis.structuredClone(t));
    assert.equal(validGitBranchRestoreTarget(t), true);
    assert.equal(validateRequest(r), r);
    const copy = gitBranchRestoreTargetFromApply(r);
    assert.deepEqual(copy, t);
    if (r.paths.length) r.paths[0].after.digest = "f".repeat(64);
    else r.metadata[0].after.digest = "f".repeat(64);
    assert.deepEqual(copy, t);
    const preview = {
      runtimeEpoch: "epoch",
      revision: 3,
      workspaceId: "w1",
      workspacePath: "/synthetic/repo",
      status: "available",
      previewId: H,
      ...t,
      author:
        action === "restore"
          ? null
          : { name: "Synthetic", email: "synthetic@example.invalid" },
    };
    assert.equal(validateGitBranchRestorePreview(preview), preview);
  });
for (const [label, change] of [
  ["extra payload", (t) => ({ ...t, text: "secret" })],
  [
    "author text in target",
    (t) => ({ ...t, author: { name: "x", email: "x@example.invalid" } }),
  ],
  ["restore identity", (t) => ({ ...t, identityDigest: H })],
  [
    "protected path",
    (t) => ({ ...t, paths: t.paths.map((p) => ({ ...p, path: ".env" })) }),
  ],
  [
    "future special mode",
    (t) => ({
      ...t,
      paths: t.paths.map((p) => ({
        ...p,
        after: { ...p.after, mode: 0o4640 },
      })),
    }),
  ],
  [
    "wrong mode transition",
    (t) => ({
      ...t,
      paths: t.paths.map((p) => ({ ...p, after: { ...p.after, mode: 0o600 } })),
    }),
  ],
  [
    "INDEX source absent",
    (t) => ({ ...t, paths: t.paths.map((p) => ({ ...p, beforeEntry: null })) }),
  ],
  [
    "INDEX source changed",
    (t) => ({
      ...t,
      paths: t.paths.map((p) => ({
        ...p,
        afterEntry: { ...p.afterEntry, oid: TREE },
      })),
    }),
  ],
  [
    "extra nested field",
    (t) => ({
      ...t,
      paths: t.paths.map((p) => ({
        ...p,
        after: { ...p.after, text: undefined },
      })),
    }),
  ],
  ["duplicate path", (t) => ({ ...t, paths: [t.paths[0], t.paths[0]] })],
  [
    "unsorted path",
    (t) => ({
      ...t,
      paths: [
        { ...t.paths[0], path: "z" },
        { ...t.paths[0], path: "a" },
      ],
    }),
  ],
  [
    "restore metadata write",
    (t) => ({
      ...t,
      metadata: [{ role: "head_ref", before: byte("a"), after: byte("b") }],
    }),
  ],
  ["absence forged digest", (t) => ({ ...t, indexExists: false })],
])
  test(`branch/restore refuses ${label}`, () => {
    assert.equal(validGitBranchRestoreTarget(change(target("restore"))), false);
  });
test("branch action cannot be disguised as restore apply", () => {
  assert.throws(
    () => validateRequest({ ...apply(target()), type: "git.restore.apply" }),
    { appCode: "INVALID_REQUEST" },
  );
});
test("branch target getters do not run", () => {
  const t = target();
  let reads = 0;
  Object.defineProperty(t, "action", {
    get() {
      reads++;
      return "create";
    },
    enumerable: true,
  });
  assert.equal(validGitBranchRestoreTarget(t), false);
  assert.equal(reads, 0);
});
test("apply requires matching outer operation and explicit revision floor", () => {
  const operation = apply(target()),
    outer = {
      version: 2,
      runtimeEpoch: "epoch",
      operationId: "o1",
      expectedRevision: 3,
      operation,
    };
  assert.deepEqual(validateEnvelope(outer), outer);
  assert.throws(() => validateEnvelope({ ...outer, operationId: "other" }), {
    appCode: "INVALID_REQUEST",
  });
  const missing = { ...outer };
  delete missing.expectedRevision;
  assert.throws(() => validateEnvelope(missing), {
    appCode: "INVALID_REQUEST",
  });
});
test("receipt binds every path mode/digest, metadata and deterministic original-key backup", () => {
  const t = target("restore"),
    backups = gitBranchRestoreExpectedBackups(t, "old-epoch", "o1"),
    expected = { workspaceId: "w1", target: t, digest: H, backups };
  const result = {
    kind: "git_branch_restore_applied",
    workspaceId: "w1",
    action: t.action,
    previewDigest: t.previewDigest,
    paths: t.paths.map((p) => ({ path: p.path, after: p.after })),
    metadata: [],
    backups,
    digest: H,
  };
  assert.equal(validateGitBranchRestoreReceiptResult(result, expected), result);
  assert.throws(
    () =>
      validateGitBranchRestoreReceiptResult(
        {
          ...result,
          paths: result.paths.map((p) => ({
            ...p,
            after: { ...p.after, mode: 0o600 },
          })),
        },
        expected,
      ),
    { appCode: "INVALID_REQUEST" },
  );
  assert.throws(
    () =>
      validateGitBranchRestoreReceiptResult(
        { ...result, digest: "f".repeat(64) },
        expected,
      ),
    { appCode: "INVALID_REQUEST" },
  );
  assert.throws(
    () =>
      validateGitBranchRestoreReceiptResult(
        { ...result, backups: [{ ...backups[0], backupId: null }] },
        expected,
      ),
    { appCode: "INVALID_REQUEST" },
  );
});
test("permission formula preserves rw bits and explicit Git exec class", () => {
  for (const mode of [
    0o400, 0o440, 0o444, 0o600, 0o640, 0o644, 0o666, 0o700, 0o750, 0o755, 0o777,
  ]) {
    assert.equal(gitBranchRestoreMode(mode, false), mode & 0o666);
    assert.equal(
      gitBranchRestoreMode(mode, true),
      (mode & 0o666) | ((mode & 0o444) >> 2),
    );
  }
  assert.equal(gitBranchRestoreMode(null, false), 0o600);
  assert.equal(gitBranchRestoreMode(null, true), 0o700);
});
test("restore preview requires explicit index or HEAD and tracked path selection", () => {
  const request = {
    type: "git.restore.preview.read",
    workspaceId: "w1",
    observationId: "a".repeat(64),
    source: "index",
    paths: ["ordinary.txt"],
  };
  assert.equal(validateRequest(request), request);
  assert.throws(() => validateRequest({ ...request, source: "worktree" }), {
    appCode: "INVALID_REQUEST",
  });
});
