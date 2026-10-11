import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import {
  validateRequest,
  validateEnvelope,
  READ_TYPES,
  validateSnapshot,
} from "./workbench-contract.mjs";
import {
  GIT_ABSENT_INDEX_DIGEST,
  GIT_INDEX_STEPS,
  validGitIndexPaths,
  validGitIndexTarget,
  validateGitIndexRequest,
  gitIndexTargetFromApply,
  validateGitIndexPreview,
  validateGitIndexMutationResult,
  validateGitIndexReceiptResult,
} from "./renderer/shared/git-index/index.mjs";

const hex = "a".repeat(64);
const preview = {
  type: "git.index.preview.read",
  workspaceId: "workspace-1",
  observationId: hex,
  action: "stage",
  paths: ["notes/a.txt"],
};
const apply = {
  type: "git.index.apply",
  workspaceId: "workspace-1",
  requestId: "operation-1",
  previewId: hex,
  previewDigest: hex,
  action: "stage",
  paths: ["notes/a.txt"],
  headOid: "b".repeat(40),
  indexExists: true,
  indexDigest: hex,
  nextIndexDigest: "c".repeat(64),
  objectFormat: "sha1",
};

test("Git index explicit preview uses the actual request validator", () => {
  assert.equal(validateRequest(preview), preview);
});

test("Git index original-bound apply uses the actual request validator", () => {
  assert.equal(validateRequest(apply), apply);
});

const invalid = (fn) => assert.throws(fn, { appCode: "INVALID_REQUEST" });
const target = () => gitIndexTargetFromApply(globalThis.structuredClone(apply));
const observation = () => ({
  runtimeEpoch: "epoch-1",
  revision: 2,
  workspaceId: "workspace-1",
  workspacePath: "/SYNTHETIC/workspace",
  status: "available",
  previewId: hex,
  ...target(),
  entries: [
    {
      path: "notes/a.txt",
      before: { mode: 0o100644, oid: "d".repeat(40) },
      after: { mode: 0o100644, oid: "e".repeat(40) },
    },
  ],
});

test("Git index wire uses read lane and binds original apply ID and revision", () => {
  assert.ok(READ_TYPES.includes(preview.type));
  assert.equal(READ_TYPES.includes(apply.type), false);
  assert.deepEqual(
    validateEnvelope({
      version: 2,
      runtimeEpoch: "epoch-1",
      readId: "read-1",
      operation: preview,
    }).operation,
    preview,
  );
  const envelope = {
    version: 2,
    runtimeEpoch: "epoch-1",
    operationId: apply.requestId,
    expectedRevision: 2,
    operation: apply,
  };
  assert.equal(validateEnvelope(envelope).operation, apply);
  invalid(() => validateEnvelope({ ...envelope, operationId: "other" }));
  const { expectedRevision: _floor, ...missingFloor } = envelope;
  invalid(() => validateEnvelope(missingFloor));
  assert.equal(GIT_INDEX_STEPS.stage, "filesystem.git.index.stage");
  assert.equal(GIT_INDEX_STEPS.publish, "filesystem.git.index.publish");
});

test("Git index requests reject session, source bytes, duplicate and unsafe paths", () => {
  for (const extra of [
    { sessionId: "session-1" },
    { text: "SYNTHETIC payload" },
    { nativeId: "native" },
    { expectedRevision: 2 },
    { artifact: "/SYNTHETIC/artifact" },
  ]) {
    invalid(() => validateRequest({ ...preview, ...extra }));
    invalid(() => validateRequest({ ...apply, ...extra }));
  }
  for (const paths of [
    [],
    ["a.txt", "a.txt"],
    ["b.txt", "a.txt"],
    ["../a.txt"],
    ["/a.txt"],
    [".git/index"],
    [".GIT/index"],
    [".env"],
    ["AGENTS.md"],
    ["opencode.json"],
    ["a\u0000.txt"],
  ]) {
    assert.equal(validGitIndexPaths(paths), false, JSON.stringify(paths));
    invalid(() => validateGitIndexRequest({ ...preview, paths }));
  }
});

test("Git index path count and aggregate UTF8 bounds are exact", () => {
  const paths = Array.from(
    { length: 128 },
    (_, i) => `a/${String(i).padStart(3, "0")}/${"x".repeat(250)}`,
  );
  assert.equal(Buffer.byteLength(paths.join("")), 32768);
  assert.equal(validGitIndexPaths(paths), true);
  const over = [...paths];
  over[127] += "x";
  assert.equal(validGitIndexPaths(over), false);
  assert.equal(validGitIndexPaths([...paths, "z.txt"]), false);
  const sparse = new Array(1);
  assert.equal(validGitIndexPaths(sparse), false);
  const decorated = ["a.txt"];
  decorated.extra = "not a path";
  assert.equal(validGitIndexPaths(decorated), false);
});

test("Git index getters are rejected without executing them", () => {
  let called = 0;
  const request = { ...apply };
  Object.defineProperty(request, "nextIndexDigest", {
    enumerable: true,
    get() {
      called++;
      return hex;
    },
  });
  invalid(() => validateGitIndexRequest(request));
  const paths = ["a.txt"];
  Object.defineProperty(paths, "0", {
    get() {
      called++;
      return "a.txt";
    },
  });
  assert.equal(validGitIndexPaths(paths), false);
  assert.equal(called, 0);
});

test("Git index target copies paths and distinguishes absence from unborn HEAD", () => {
  const original = globalThis.structuredClone(apply);
  const admitted = gitIndexTargetFromApply(original);
  original.paths[0] = "changed.txt";
  assert.deepEqual(admitted.paths, ["notes/a.txt"]);
  assert.equal(
    GIT_ABSENT_INDEX_DIGEST,
    createHash("sha256").update("omoc-absent-git-index-v1").digest("hex"),
  );
  const absent = {
    ...admitted,
    headOid: null,
    indexExists: false,
    indexDigest: GIT_ABSENT_INDEX_DIGEST,
  };
  assert.equal(validGitIndexTarget(absent), true);
  assert.equal(validGitIndexTarget({ ...absent, indexDigest: hex }), false);
  assert.equal(validGitIndexTarget({ ...admitted, headOid: null }), true);
  assert.equal(validGitIndexTarget({ ...admitted, text: "bytes" }), false);
  assert.equal(
    validGitIndexTarget({ ...admitted, objectFormat: "sha256" }),
    false,
  );
  assert.equal(
    validGitIndexTarget({
      ...admitted,
      objectFormat: "sha256",
      headOid: "b".repeat(64),
    }),
    true,
  );
});

test("Git index preview is closed, maps exact paths and refuses semantic no-op", () => {
  const value = observation();
  assert.equal(validateGitIndexPreview(value), value);
  for (const bad of [
    { ...value, floor: 2 },
    { ...value, revision: -1 },
    { ...value, revision: 1.1 },
    { ...value, revision: Number.MAX_SAFE_INTEGER + 1 },
    { ...value, entries: [] },
    {
      ...value,
      entries: [{ ...value.entries[0], path: "other.txt" }],
    },
    {
      ...value,
      entries: [{ ...value.entries[0], after: { ...value.entries[0].before } }],
    },
    {
      ...value,
      entries: [{ path: value.paths[0], before: null, after: null }],
    },
  ])
    invalid(() => validateGitIndexPreview(bad));
  const { previewId: _id, entries: _entries, ...rest } = value;
  const unavailable = {
    runtimeEpoch: rest.runtimeEpoch,
    revision: rest.revision,
    workspaceId: rest.workspaceId,
    workspacePath: rest.workspacePath,
    status: "unavailable",
    reason: "no_changes",
  };
  assert.equal(validateGitIndexPreview(unavailable), unavailable);
  invalid(() =>
    validateGitIndexPreview({ ...unavailable, paths: value.paths }),
  );
  invalid(() =>
    validateGitIndexPreview({ ...unavailable, reason: "anything" }),
  );
});

test("Git index result and receipt correlate admitted next digest and backup nullability", () => {
  const backupId = `.omoc-git-index-${"f".repeat(64)}.backup`;
  const expected = {
    workspaceId: apply.workspaceId,
    target: target(),
    digest: "9".repeat(64),
    backupId,
  };
  const result = {
    kind: "git_index_updated",
    workspaceId: expected.workspaceId,
    action: expected.target.action,
    paths: [...expected.target.paths],
    indexDigest: expected.target.nextIndexDigest,
    previewDigest: expected.target.previewDigest,
    backupId,
    digest: expected.digest,
  };
  assert.equal(validateGitIndexReceiptResult(result, expected), result);
  for (const forged of [
    { indexDigest: expected.target.indexDigest },
    { indexDigest: "8".repeat(64) },
    { digest: "8".repeat(64) },
    { paths: ["other.txt"] },
    { action: "unstage" },
    { backupId: null },
    { backupId: `.omoc-git-index-${"7".repeat(64)}.backup` },
    { previewDigest: "8".repeat(64) },
    { text: "SYNTHETIC forbidden body" },
  ])
    invalid(() =>
      validateGitIndexReceiptResult({ ...result, ...forged }, expected),
    );
  const absent = {
    ...expected,
    target: {
      ...expected.target,
      indexExists: false,
      indexDigest: GIT_ABSENT_INDEX_DIGEST,
    },
    backupId: null,
  };
  assert.equal(
    validateGitIndexReceiptResult({ ...result, backupId: null }, absent)
      .backupId,
    null,
  );
  invalid(() => validateGitIndexReceiptResult(result, absent));
  const applied = {
    requestId: apply.requestId,
    status: "applied",
    indexDigest: expected.target.nextIndexDigest,
    backupId,
  };
  assert.equal(validateGitIndexMutationResult(applied), applied);
  invalid(() =>
    validateGitIndexMutationResult({ ...applied, artifact: "/tmp/x" }),
  );
  assert.deepEqual(
    validateGitIndexMutationResult({
      requestId: apply.requestId,
      status: "unknown",
    }),
    { requestId: apply.requestId, status: "unknown" },
  );
  invalid(() =>
    validateGitIndexMutationResult({ ...applied, status: "unknown" }),
  );
});

test("Git index unknown retained key survives snapshot validation without payload", () => {
  const value = {
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
        type: "git.index.apply",
        workspaceId: "workspace-1",
        authorityHold: false,
      },
    ],
    workspaces: [],
    sessions: [],
    messages: [],
    permissions: [],
  };
  assert.equal(validateSnapshot(value), value);
  invalid(() =>
    validateSnapshot({
      ...value,
      retainedOperations: [
        { ...value.retainedOperations[0], type: "git.index.preview.read" },
      ],
    }),
  );
  invalid(() =>
    validateSnapshot({
      ...value,
      retainedOperations: [
        { ...value.retainedOperations[0], paths: ["notes/a.txt"] },
      ],
    }),
  );
});
