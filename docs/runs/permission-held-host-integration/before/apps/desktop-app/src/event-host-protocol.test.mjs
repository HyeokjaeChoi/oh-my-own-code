import assert from "node:assert/strict";
import test from "node:test";
import { validateHostMessage } from "./event-host-protocol.mjs";
const hex = "a".repeat(64);
const operation = {
  runtimeEpoch: "epoch",
  operationId: "operation",
  workspaceId: "workspace",
  workspacePath: "/SYNTHETIC/work",
  digest: hex,
  target: {
    action: "stage",
    paths: ["a.txt"],
    previewDigest: hex,
    headOid: null,
    indexExists: true,
    indexDigest: hex,
    nextIndexDigest: hex,
    objectFormat: "sha1",
  },
  artifact: {
    root: "/SYNTHETIC/artifact",
    dev: "1",
    ino: "2",
    manifest: { path: "manifest.json", bytes: 100, digest: hex },
  },
};
test("Branch restore IPC accepts only its typed descriptor and closed phase result", () => {
  const target = {
    action: "create",
    objectFormat: "sha1",
    previewDigest: hex,
    occupancyDigest: hex,
    branch: "refs/heads/next",
    source: null,
    currentBranch: "refs/heads/main",
    headOid: "1".repeat(40),
    nextHeadOid: "1".repeat(40),
    treeOid: "2".repeat(40),
    headDigest: hex,
    indexExists: true,
    indexDigest: hex,
    identityDigest: hex,
    timestamp: 1,
    paths: [],
    metadata: [
      { role: "branch_ref", before: null, after: { bytes: 41, digest: hex } },
    ],
  };
  const prepare = {
    type: "git-branch-restore-prepare",
    nonce: hex,
    requestId: hex,
    operation: { ...operation, target },
  };
  assert.equal(validateHostMessage(prepare, "child"), prepare);
  assert.throws(() => validateHostMessage({ ...prepare, operation }, "child"));
  assert.throws(() =>
    validateHostMessage(
      {
        ...prepare,
        operation: { ...prepare.operation, author: { name: "private" } },
      },
      "child",
    ),
  );
  for (const type of [
    "git-branch-restore-publish",
    "git-branch-restore-abort",
  ]) {
    const message = { type, nonce: hex, requestId: hex, token: hex };
    assert.equal(validateHostMessage(message, "child"), message);
    assert.throws(() =>
      validateHostMessage({ ...message, operation }, "child"),
    );
  }
  const response = {
    type: "git-branch-restore-result",
    nonce: hex,
    requestId: hex,
    pid: 12,
    result: { status: "prepared", token: hex },
  };
  assert.equal(validateHostMessage(response, "parent"), response);
  assert.throws(() =>
    validateHostMessage(
      {
        ...response,
        result: { status: "committed", commitOid: "1".repeat(40) },
      },
      "parent",
    ),
  );
  assert.throws(() =>
    validateHostMessage(
      { ...response, result: { ...response.result, text: "private" } },
      "parent",
    ),
  );
});
test("Git index IPC closes descriptor authority and keeps prepared token private", () => {
  const prepare = {
    type: "git-index-prepare",
    nonce: hex,
    requestId: hex,
    operation,
  };
  assert.equal(validateHostMessage(prepare, "child"), prepare);
  for (const type of ["git-index-publish", "git-index-abort"]) {
    const m = { type, nonce: hex, requestId: hex, token: hex };
    assert.equal(validateHostMessage(m, "child"), m);
    assert.throws(() => validateHostMessage({ ...m, operation }, "child"));
  }
  assert.throws(() =>
    validateHostMessage(
      { ...prepare, operation: { ...operation, text: "source bytes" } },
      "child",
    ),
  );
  assert.throws(() =>
    validateHostMessage(
      {
        ...prepare,
        operation: {
          ...operation,
          artifact: {
            ...operation.artifact,
            manifest: { ...operation.artifact.manifest, path: "../escape" },
          },
        },
      },
      "child",
    ),
  );
  const result = {
    type: "git-index-result",
    nonce: hex,
    requestId: hex,
    pid: 12,
    result: { status: "prepared", token: hex },
  };
  assert.equal(validateHostMessage(result, "parent"), result);
  assert.throws(() =>
    validateHostMessage(
      {
        ...result,
        result: { status: "prepared", token: hex, source: "forbidden" },
      },
      "parent",
    ),
  );
  assert.throws(() =>
    validateHostMessage(
      {
        ...result,
        result: { status: "applied", indexDigest: hex, backupId: "invented" },
      },
      "parent",
    ),
  );
});

test("Git commit IPC admits only closed kind-specific private authority", () => {
  const commitOperation = {
    ...operation,
    target: {
      objectFormat: "sha1",
      previewDigest: hex,
      indexDigest: hex,
      headOid: null,
      treeOid: "a".repeat(40),
      treeDigest: hex,
      commitOid: "b".repeat(40),
      commitBodyDigest: hex,
      reference: {
        kind: "branch",
        name: "refs/heads/main",
        exists: true,
        digest: hex,
        nextDigest: hex,
      },
      logs: [],
    },
  };
  const prepare = {
    type: "git-commit-prepare",
    nonce: hex,
    requestId: hex,
    operation: commitOperation,
  };
  assert.equal(validateHostMessage(prepare, "child"), prepare);
  for (const type of ["git-commit-publish", "git-commit-abort"]) {
    const m = { type, nonce: hex, requestId: hex, token: hex };
    assert.equal(validateHostMessage(m, "child"), m);
    assert.throws(() =>
      validateHostMessage({ ...m, operation: commitOperation }, "child"),
    );
  }
  assert.throws(() =>
    validateHostMessage(
      { ...prepare, operation: { ...commitOperation, message: "private" } },
      "child",
    ),
  );
  const response = {
    type: "git-commit-result",
    nonce: hex,
    pid: 12,
    requestId: hex,
    result: { status: "prepared", token: hex },
  };
  assert.equal(validateHostMessage(response, "parent"), response);
  assert.throws(() =>
    validateHostMessage(
      {
        ...response,
        result: { status: "applied", indexDigest: hex, backupId: null },
      },
      "parent",
    ),
  );
});
