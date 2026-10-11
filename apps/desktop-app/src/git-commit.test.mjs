import assert from "node:assert/strict";
import { test } from "node:test";
import {
  validateRequest,
  validateEnvelope,
  READ_TYPES,
  validateSnapshot,
} from "./workbench-contract.mjs";
import { createHash } from "node:crypto";
import {
  GIT_COMMIT_ABSENT_DIGEST,
  GIT_COMMIT_STEPS,
  validGitCommitAuthor,
  validGitCommitMessage,
  canonicalGitCommitMessage,
  validGitCommitBranch,
  validGitCommitTarget,
  gitCommitTargetFromApply,
  validateGitCommitPreview,
  validateGitCommitMutationResult,
  validateGitCommitReceiptResult,
} from "./renderer/shared/git-commit/index.mjs";

test("Git commit explicit preview accepts original user identity and message", () => {
  const request = {
    type: "git.commit.preview.read",
    workspaceId: "workspace-1",
    observationId: "a".repeat(64),
    author: { name: "합성 사용자", email: "synthetic@example.invalid" },
    message: "SYNTHETIC message\r\n",
  };
  assert.equal(validateRequest(request), request);
});

const h = "a".repeat(64),
  oid = "b".repeat(40);
const invalid = (fn) => assert.throws(fn, { appCode: "INVALID_REQUEST" });
const target = () => ({
  objectFormat: "sha1",
  previewDigest: h,
  indexDigest: h,
  headOid: oid,
  treeOid: "c".repeat(40),
  treeDigest: h,
  commitOid: "d".repeat(40),
  commitBodyDigest: h,
  reference: {
    kind: "branch",
    name: "refs/heads/main",
    exists: false,
    digest: GIT_COMMIT_ABSENT_DIGEST,
    nextDigest: h,
  },
  logs: [
    {
      role: "head_log",
      exists: false,
      digest: GIT_COMMIT_ABSENT_DIGEST,
      nextDigest: h,
      nextBytes: 150,
    },
    {
      role: "branch_log",
      exists: true,
      digest: h,
      nextDigest: h,
      nextBytes: 300,
    },
  ],
});
const apply = () => ({
  type: "git.commit.apply",
  workspaceId: "workspace-1",
  requestId: "operation-1",
  previewId: h,
  ...target(),
});
const preview = () => ({
  runtimeEpoch: "epoch-1",
  revision: 2,
  workspaceId: "workspace-1",
  workspacePath: "/SYNTHETIC/workspace",
  status: "available",
  previewId: h,
  ...target(),
  author: { name: "합성 사용자", email: "synthetic@example.invalid" },
  timestamp: 1234567890,
  canonicalMessage: "SYNTHETIC\r\n",
  entries: [
    { path: "notes.txt", before: { mode: 0o100644, oid }, after: null },
  ],
});

test("Git commit author is byte preserved, bounded and refuses Git boundary crud", () => {
  assert.equal(
    validGitCommitAuthor({
      name: "합성 A, B: C; D",
      email: "synthetic+tag@example.invalid",
    }),
    true,
  );
  for (const c of [
    " ",
    ",",
    ":",
    ";",
    "<",
    ">",
    '"',
    "\\",
    "'",
    "\t",
    "\n",
    "\x7f",
  ]) {
    for (const name of [c + "name", "name" + c])
      assert.equal(
        validGitCommitAuthor({ name, email: "test@example.invalid" }),
        false,
      );
    for (const email of [
      c + "test@example.invalid",
      "test@example.invalid" + c,
    ])
      assert.equal(validGitCommitAuthor({ name: "Name", email }), false);
  }
  for (const name of ["", "x".repeat(257), "\ud800", "a\0b", "a<b"])
    assert.equal(
      validGitCommitAuthor({ name, email: "test@example.invalid" }),
      false,
    );
  assert.equal(
    validGitCommitAuthor({
      name: "x".repeat(256),
      email: "test@example.invalid",
    }),
    true,
  );
  assert.equal(
    validGitCommitAuthor({ name: "Name", email: "test @example.invalid" }),
    false,
  );
  assert.equal(
    validGitCommitAuthor({
      name: "Name",
      email: "test@example.invalid",
      default: true,
    }),
    false,
  );
});

test("Git commit message retains BOM CRLF and adds only missing final LF", () => {
  const text = "\ufeffSYNTHETIC\r\n\r\n";
  assert.equal(canonicalGitCommitMessage(text), text);
  assert.equal(canonicalGitCommitMessage("SYNTHETIC\r"), "SYNTHETIC\r\n");
  assert.equal(validGitCommitMessage("x".repeat(65536)), true);
  for (const v of ["", " \r\n", "x".repeat(65537), "x\0y", "\ud800", null])
    assert.equal(validGitCommitMessage(v), false);
});

test("Git commit apply requires outer original ID and floor and preview is a read", () => {
  const op = apply(),
    env = {
      version: 2,
      runtimeEpoch: "epoch-1",
      operationId: op.requestId,
      expectedRevision: 2,
      operation: op,
    };
  assert.equal(validateRequest(op), op);
  assert.equal(validateEnvelope(env).operation, op);
  invalid(() => validateEnvelope({ ...env, operationId: "other" }));
  const { expectedRevision: _floor, ...missing } = env;
  invalid(() => validateEnvelope(missing));
  assert.ok(READ_TYPES.includes("git.commit.preview.read"));
  assert.equal(READ_TYPES.includes("git.commit.apply"), false);
  assert.equal(GIT_COMMIT_STEPS.stage, "filesystem.git.commit.stage");
  assert.equal(GIT_COMMIT_STEPS.publish, "filesystem.git.commit.publish");
  for (const extra of [
    { sessionId: "session" },
    { author: { name: "forged" } },
    { message: "body" },
    { token: h },
    { expectedRevision: 2 },
  ])
    invalid(() => validateRequest({ ...op, ...extra }));
});

test("Git commit target keeps physical absence separate and returns detached copies", () => {
  assert.equal(
    GIT_COMMIT_ABSENT_DIGEST,
    createHash("sha256").update("omoc-absent-git-commit-v1").digest("hex"),
  );
  const op = apply(),
    t = gitCommitTargetFromApply(op);
  op.reference.name = "refs/heads/changed";
  op.logs[0].nextDigest = "f".repeat(64);
  assert.equal(t.reference.name, "refs/heads/main");
  assert.equal(t.logs[0].nextDigest, h);
  assert.equal(validGitCommitTarget(t), true);
  for (const edit of [
    { reference: { ...t.reference, digest: h } },
    {
      headOid: null,
      reference: {
        kind: "head",
        name: null,
        exists: true,
        digest: h,
        nextDigest: h,
      },
    },
    { logs: [...t.logs].reverse() },
    { logs: [...t.logs, t.logs[0]] },
    { body: "private" },
    { treeOid: h },
  ])
    assert.equal(validGitCommitTarget({ ...t, ...edit }), false);
  const detached = {
    ...t,
    reference: {
      kind: "head",
      name: null,
      exists: true,
      digest: h,
      nextDigest: h,
    },
    logs: [t.logs[0]],
  };
  assert.equal(validGitCommitTarget(detached), true);
  const sha256 = {
    ...t,
    objectFormat: "sha256",
    headOid: h,
    treeOid: h,
    commitOid: h,
  };
  assert.equal(validGitCommitTarget(sha256), true);
  for (const name of [
    "refs/tags/main",
    "refs/heads/a..b",
    "refs/heads/.hidden",
    "refs/heads/a.lock",
    "refs/heads/a//b",
    "refs/heads/a@{b",
    "refs/heads/a\\b",
  ])
    assert.equal(validGitCommitBranch(name), false);
  assert.equal(validGitCommitBranch("refs/heads/기능/nested"), true);
});

test("Git commit preview includes complete changed entries and canonical user data", () => {
  const v = preview();
  assert.equal(validateGitCommitPreview(v), v);
  for (const edit of [
    { canonicalMessage: undefined },
    { canonicalMessage: "no LF" },
    { author: { ...v.author, name: " leading" } },
    { timestamp: -1 },
    { revision: 1.1 },
    { entries: [] },
    { entries: [{ ...v.entries[0], path: ".env" }] },
    { entries: [{ ...v.entries[0], after: v.entries[0].before }] },
    { entries: [{ ...v.entries[0], path: "other", extra: true }] },
    { rawLog: "private" },
  ])
    invalid(() => validateGitCommitPreview({ ...v, ...edit }));
  const unavailable = {
    runtimeEpoch: v.runtimeEpoch,
    revision: v.revision,
    workspaceId: v.workspaceId,
    workspacePath: v.workspacePath,
    status: "unavailable",
    reason: "unsupported_commit_state",
  };
  assert.equal(validateGitCommitPreview(unavailable), unavailable);
  invalid(() => validateGitCommitPreview({ ...unavailable, previewId: h }));
  // Full staged deletion is meaningful, although its resulting tree is empty.
  assert.equal(validateGitCommitPreview(v).entries[0].after, null);
});

test("Git commit getter authority is refused without execution", () => {
  let called = 0;
  const t = target();
  Object.defineProperty(t.reference, "nextDigest", {
    enumerable: true,
    get() {
      called++;
      return h;
    },
  });
  assert.equal(validGitCommitTarget(t), false);
  const v = preview();
  Object.defineProperty(v, "canonicalMessage", {
    enumerable: true,
    get() {
      called++;
      return "SYNTHETIC\n";
    },
  });
  invalid(() => validateGitCommitPreview(v));
  assert.equal(called, 0);
});

test("Git commit result and receipt correlate full target and exact backup roles", () => {
  const t = target(),
    backups = [
      { role: "head_log", backupId: null },
      {
        role: "branch_log",
        backupId: `.omoc-git-commit-${"e".repeat(64)}.backup`,
      },
      { role: "branch_ref", backupId: null },
    ],
    expected = { workspaceId: "workspace-1", target: t, digest: h, backups };
  const result = {
    kind: "git_commit_created",
    workspaceId: expected.workspaceId,
    commitOid: t.commitOid,
    treeOid: t.treeOid,
    parentOid: t.headOid,
    referenceDigest: t.reference.nextDigest,
    logDigests: t.logs.map((x) => ({ role: x.role, digest: x.nextDigest })),
    previewDigest: t.previewDigest,
    backups,
    digest: h,
  };
  assert.equal(validateGitCommitReceiptResult(result, expected), result);
  for (const edit of [
    { parentOid: null },
    { commitOid: oid },
    { treeOid: oid },
    { digest: "e".repeat(64) },
    { backups: backups.slice(1) },
    { backups: backups.map((x) => ({ ...x, backupId: null })) },
    { logDigests: [] },
    { rawMessage: "private" },
    { referenceDigest: "e".repeat(64) },
  ])
    invalid(() =>
      validateGitCommitReceiptResult({ ...result, ...edit }, expected),
    );
  const committed = {
    requestId: "operation-1",
    status: "committed",
    commitOid: t.commitOid,
    treeOid: t.treeOid,
    referenceDigest: t.reference.nextDigest,
    logDigests: result.logDigests,
    backups,
  };
  assert.equal(validateGitCommitMutationResult(committed), committed);
  invalid(() =>
    validateGitCommitMutationResult({ ...committed, status: "unknown" }),
  );
  assert.deepEqual(
    validateGitCommitMutationResult({
      requestId: "operation-1",
      status: "unknown",
    }),
    { requestId: "operation-1", status: "unknown" },
  );
});

test("Git commit retained operation contains lookup identity only", () => {
  const v = {
    runtimeEpoch: "epoch-2",
    revision: 0,
    observationSequence: 1,
    state: "unavailable",
    temporary: false,
    recovery: { store: { state: "ready" }, resources: [] },
    retainedOperations: [
      {
        runtimeEpoch: "epoch-1",
        operationId: "operation-1",
        workspaceId: "workspace-1",
        type: "git.commit.apply",
      },
    ],
    workspaces: [],
    sessions: [],
    messages: [],
    permissions: [],
  };
  assert.equal(validateSnapshot(v), v);
  invalid(() =>
    validateSnapshot({
      ...v,
      retainedOperations: [
        { ...v.retainedOperations[0], type: "git.commit.preview.read" },
      ],
    }),
  );
  invalid(() =>
    validateSnapshot({
      ...v,
      retainedOperations: [{ ...v.retainedOperations[0], message: "private" }],
    }),
  );
});

test("Git commit preview refuses boundary-normalized identity before authority", () => {
  for (const name of [" leading", "trailing ", ",name", "name:"]) {
    const request = {
      type: "git.commit.preview.read",
      workspaceId: "workspace-1",
      observationId: "a".repeat(64),
      author: { name, email: "synthetic@example.invalid" },
      message: "SYNTHETIC",
    };
    assert.throws(() => validateRequest(request), {
      appCode: "INVALID_REQUEST",
    });
  }
});
