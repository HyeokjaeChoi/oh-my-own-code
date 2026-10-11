import assert from "node:assert/strict";
import test from "node:test";
import * as files from "./renderer/shared/workspace-file/index.mjs";
import { validateRequest, validateEnvelope } from "./workbench-contract.mjs";
import { validateHostMessage } from "./event-host-protocol.mjs";
const hash = "a".repeat(64);
const base = {
  runtimeEpoch: "epoch",
  revision: 0,
  workspaceId: "workspace",
  workspacePath: "/synthetic/workspace",
  path: "src/hello.txt",
  targetPath: "/synthetic/workspace/src/hello.txt",
};
const available = () => ({
  ...base,
  status: "available",
  content: "\uFEFFhello\r\n",
  version: hash,
  directoryVersion: hash,
});
const operation = () => ({
  type: "file.save",
  workspaceId: "workspace",
  path: base.path,
  requestId: "operation",
  expectation: "version",
  version: hash,
  directoryVersion: hash,
  text: "",
});
const invalid = (fn) =>
  assert.throws(
    fn,
    (e) => e.appCode === "INVALID_REQUEST" || e.message === "INVALID_REQUEST",
  );

test("portable existing file grammar rejects traversal, alias separators and invalid Unicode", () => {
  assert.equal(files.validWorkspaceFilePath("src/한국어 😀.txt"), true);
  for (const path of [
    "",
    "/a",
    "../a",
    "a/../b",
    "a//b",
    "a/./b",
    "a\\b",
    "a:b",
    "a\n",
    "a\u202e.txt",
    "a\ud800",
    "con.txt",
    "a/lpt1",
    "a.",
    "a ",
    "a?b",
    "a|b",
    "a<b",
    "a/",
  ])
    assert.equal(
      files.validWorkspaceFilePath(path),
      false,
      JSON.stringify(path),
    );
  assert.equal(files.validWorkspaceFilePath("x/".repeat(31) + "x"), true);
  assert.equal(files.validWorkspaceFilePath("x/".repeat(32) + "x"), false);
  assert.equal(files.validWorkspaceFilePath("한".repeat(85)), true);
  assert.equal(files.validWorkspaceFilePath("한".repeat(86)), false);
  assert.equal(
    files.validWorkspaceFilePath(Array(9).fill("x".repeat(255)).join("/")),
    false,
  );
});
test("protected source paths remain lexical metadata but never write targets", () => {
  for (const path of [
    ".env",
    "a/.GIT/config",
    ".OpEnCoDe/agents/a.md",
    ".agents/a",
    ".codex/a",
    ".claude/a",
    "AGENTS.md",
    "a/CLAUDE.md",
    "credentials.json",
    "auth.json",
    "x/private.key",
    ".omoc-configuration-x.backup",
  ]) {
    assert.equal(files.validWorkspaceFilePath(path), true, path);
    assert.equal(files.workspaceFilePathReason(path), "protected_source", path);
    invalid(() => validateRequest({ ...operation(), path }));
  }
  assert.equal(files.workspaceFilePathReason("src/ordinary.ts"), undefined);
});
test("plain exact text permits blank/BOM/CRLF and enforces UTF8 bytes, no binary controls", () => {
  for (const text of [
    "",
    " \r\n\t",
    "\uFEFFhello\r\n",
    "x".repeat(65536),
    "한".repeat(21845),
  ]) {
    assert.equal(files.workspaceFileContentFits(text), true);
    assert.equal(files.workspaceFileWriteFits(text), true);
    assert.equal(files.validateWorkspaceFileText(text).status, "valid");
  }
  for (const text of [
    "x".repeat(65537),
    "한".repeat(21846),
    "\0",
    "\u0001",
    "\u007f",
    "\u0085",
    "\ud800",
    null,
  ])
    assert.equal(files.workspaceFileContentFits(text), false);
});
test("closed observation validates current clocks, root/path and exact shape without invoking getters", () => {
  const v = available();
  assert.equal(files.validateWorkspaceFileObservation(v), v);
  for (const bad of [
    { ...v, native: {} },
    { ...v, revision: -1 },
    { ...v, revision: Number.MAX_SAFE_INTEGER + 1 },
    { ...v, targetPath: "/elsewhere" },
    { ...v, runtimeEpoch: "" },
    { ...v, version: "bad" },
    { ...v, directoryVersion: undefined },
    { ...v, workspacePath: "relative" },
    { ...v, path: "../bad" },
    { ...v, content: "\0" },
  ])
    invalid(() => files.validateWorkspaceFileObservation(bad));
  let invoked = false;
  const accessor = { ...v };
  Object.defineProperty(accessor, "content", {
    enumerable: true,
    get() {
      invoked = true;
      return "";
    },
  });
  invalid(() => files.validateWorkspaceFileObservation(accessor));
  assert.equal(invoked, false);
  for (const [status, reason] of [
    ["unavailable", "missing_file"],
    ["unavailable", "path_missing"],
    ["unavailable", "path_denied"],
    ["unavailable", "file_changed"],
    ["unsupported", "too_large"],
    ["unsupported", "unsupported_content"],
  ]) {
    const value = { ...base, status, reason };
    assert.equal(files.validateWorkspaceFileObservation(value), value);
    invalid(() =>
      files.validateWorkspaceFileObservation({ ...value, content: "secret" }),
    );
  }
  const protectedValue = {
    ...base,
    path: "AGENTS.md",
    targetPath: base.workspacePath + "/AGENTS.md",
    status: "unsupported",
    reason: "protected_source",
  };
  assert.equal(
    files.validateWorkspaceFileObservation(protectedValue),
    protectedValue,
  );
  invalid(() =>
    files.validateWorkspaceFileObservation({
      ...available(),
      path: "AGENTS.md",
      targetPath: protectedValue.targetPath,
    }),
  );
});
test("saved existing file result requires backup while unknown contains no false proof", () => {
  const saved = {
    requestId: "operation",
    status: "saved",
    version: hash,
    backupId: `.omoc-configuration-${hash}.file.backup`,
  };
  assert.equal(files.validateWorkspaceFileSave(saved), saved);
  const unknown = { requestId: "operation", status: "unknown" };
  assert.equal(files.validateWorkspaceFileSave(unknown), unknown);
  for (const bad of [
    { ...saved, backupId: undefined },
    { ...saved, backupId: saved.backupId.replace(".file.", ".agent.") },
    { ...saved, content: "secret" },
    { ...unknown, version: hash },
  ])
    invalid(() => files.validateWorkspaceFileSave(bad));
});
test("normal v2 editor read and exact existing-only save are admitted; preview remains separate", () => {
  const read = {
    type: "file.edit.read",
    workspaceId: "workspace",
    path: base.path,
  };
  assert.deepEqual(validateRequest(read), read);
  assert.deepEqual(
    validateEnvelope({
      version: 2,
      runtimeEpoch: "epoch",
      readId: "read",
      operation: read,
    }).operation,
    read,
  );
  assert.deepEqual(validateRequest(operation()), operation());
  for (const patch of [
    { expectation: "missing" },
    { directoryVersion: undefined },
    { version: "bad" },
    { text: "x".repeat(65537) },
    { sessionId: "s" },
  ])
    invalid(() => validateRequest({ ...operation(), ...patch }));
  assert.deepEqual(
    validateRequest({
      type: "file.read",
      workspaceId: "workspace",
      path: "AGENTS.md",
    }),
    { type: "file.read", workspaceId: "workspace", path: "AGENTS.md" },
  );
});
test("maximum admitted root/path/text plus full JSON escaping fits unchanged save IPC cap", () => {
  const root = "/" + "r".repeat(4095);
  const path = Array(7)
    .fill("p".repeat(255))
    .concat("p".repeat(254), "p")
    .join("/");
  assert.equal(Buffer.byteLength(path), 2048);
  const text = '"\\\n\t'.repeat(16384);
  const op = {
    runtimeEpoch: "e".repeat(128),
    operationId: "o".repeat(128),
    workspaceId: "w".repeat(128),
    workspacePath: root,
    kind: "file",
    path,
    text,
    expectation: "version",
    version: hash,
    directoryVersion: hash,
  };
  const message = {
    type: "configuration-prepare",
    nonce: hash,
    requestId: hash,
    operation: op,
  };
  assert.equal(files.workspaceFileWriteFits(text), true);
  assert.equal(Buffer.byteLength(JSON.stringify(message)) < 262144, true);
  assert.equal(validateHostMessage(message, "child"), message);
  for (const patch of [
    { expectation: "missing" },
    { path: "AGENTS.md" },
    { text: "x".repeat(65537) },
    { directoryVersion: undefined },
  ])
    assert.throws(
      () =>
        validateHostMessage(
          { ...message, operation: { ...op, ...patch } },
          "child",
        ),
      { message: "invalid_ipc" },
    );
  const result = {
    type: "configuration-result",
    nonce: hash,
    pid: 1,
    requestId: hash,
    result: {
      status: "saved",
      version: hash,
      backupId: `.omoc-configuration-${hash}.file.backup`,
    },
  };
  assert.equal(validateHostMessage(result, "parent"), result);
});
