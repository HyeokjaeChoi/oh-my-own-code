import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  FILE_FEATURE,
  FILE_TARGET_FIELDS,
  FILE_RESULT_FIELDS,
  isFileSave,
  validFileTarget,
  fileTargetAdmission,
  fileBackupId,
  validateFileAdmission,
  validateFileDispatch,
  validateFileCompletion,
  validFileSavedResult,
} from "./workbench-file-storage.mjs";
import { redactReceipt } from "./workbench-receipts.mjs";
import { createHostAdmission } from "./workbench-admission.mjs";
import {
  validateStorageIdentity,
  validateStorageReceipt,
} from "./storage-journal.mjs";
const target = () => ({
  path: "src/example.txt",
  version: "b".repeat(64),
  directoryVersion: "c".repeat(64),
});
const original = () => ({
  runtimeEpoch: "epoch",
  operationId: "save",
  type: "file.save",
  workspaceId: "workspace",
  digest: "a".repeat(64),
});
const saved = () => ({
  ...original(),
  fileTarget: target(),
  admission: "dispatched",
  delivery: "accepted",
  effect: "confirmed",
  revision: 1,
  evidence: [],
  result: {
    kind: "file_saved",
    workspaceId: "workspace",
    path: target().path,
    version: "d".repeat(64),
    digest: original().digest,
    backupId: fileBackupId("epoch", "save"),
  },
});
const operation = () => ({
  identity: original(),
  fileTarget: target(),
  dispatches: ["stage", "publish"].map((step) => ({
    step: `filesystem.configuration.${step}`,
    fileTarget: target(),
  })),
});
const empty = () => ({ workspaces: [], sessions: [], tombstones: [] });
test("FILE helper exports exact closed target/result fields and original-key backup", () => {
  assert.equal(FILE_FEATURE, "workspace_file_save_v1");
  assert.equal(isFileSave("file.save"), true);
  assert.deepEqual(FILE_TARGET_FIELDS, ["path", "version", "directoryVersion"]);
  assert.deepEqual(FILE_RESULT_FIELDS, [
    "kind",
    "workspaceId",
    "path",
    "version",
    "digest",
    "backupId",
  ]);
  assert.equal(
    fileBackupId("epoch", "save"),
    `.omoc-configuration-${createHash("sha256").update('["epoch","save"]').digest("hex")}.file.backup`,
  );
  assert.notEqual(fileBackupId("epoch", "save"), fileBackupId("new", "save"));
  assert.deepEqual(
    fileTargetAdmission({ ...original(), ...target(), expectation: "version" }),
    target(),
  );
  assert.throws(() => fileTargetAdmission({ ...original(), ...target() }));
  assert.throws(() =>
    fileTargetAdmission({ ...original(), ...target(), expectation: "missing" }),
  );
});
test("FILE metadata rejects hidden fields/accessors/symbols/prototypes and protected relative paths", () => {
  assert.equal(validFileTarget(target()), true);
  for (const value of [
    { ...target(), text: undefined },
    { ...target(), [Symbol("token")]: "secret" },
    Object.assign(Object.create(target()), {}),
    Object.defineProperty(target(), "root", {
      value: "/PRIVATE",
      enumerable: false,
    }),
    Object.defineProperty(target(), "version", {
      get() {
        throw new Error("getter executed");
      },
    }),
    ...["../file", "/PRIVATE/file", "AGENTS.md", ".opencode/x", ".env"].map(
      (path) => ({ ...target(), path }),
    ),
  ])
    assert.equal(validFileTarget(value), false);
  assert.throws(() =>
    validateStorageIdentity({ ...original(), sessionId: "session" }),
  );
  assert.throws(() =>
    validateStorageIdentity({ ...original(), workspaceId: undefined }),
  );
  assert.throws(() =>
    validateFileAdmission({
      identity: { ...original(), type: "workspace.remove" },
      fileTarget: target(),
    }),
  );
});
test("FILE receipt projects only correlated relative result and strips private authority", () => {
  const record = saved();
  assert.equal(
    validFileSavedResult(record, record.fileTarget, record.digest),
    true,
  );
  const projected = redactReceipt({
    ...record,
    text: "PRIVATE",
    workspacePath: "/PRIVATE/root",
  });
  assert.deepEqual(projected.result, record.result);
  assert.equal(projected.digest, undefined);
  assert.equal(projected.fileTarget, undefined);
  assert.equal(JSON.stringify(projected).includes("PRIVATE"), false);
  assert.deepEqual(validateStorageReceipt(projected), projected);
  for (const change of [
    { fileTarget: { ...target(), path: "other.txt" } },
    { digest: "f".repeat(64) },
    { runtimeEpoch: "new" },
    { effect: "unknown" },
    { admission: "admitted" },
    { delivery: "pending" },
    { result: { ...record.result, text: "PRIVATE" } },
    { result: { ...record.result, path: "/PRIVATE/file" } },
    { result: { ...record.result, digest: "f".repeat(64) } },
    { fileTarget: undefined },
    { digest: undefined },
  ])
    assert.equal(redactReceipt({ ...record, ...change }).result, undefined);
});
test("FILE completion requires named feature, original digest, exact ordered stage proof and zero delta", () => {
  const receipt = redactReceipt(saved());
  const payload = { receipt, delta: empty() };
  validateFileCompletion(operation(), payload, [FILE_FEATURE]);
  assert.throws(() => validateFileCompletion(operation(), payload, []), {
    code: "unsupported_version",
  });
  for (const change of [
    { dispatches: [] },
    { dispatches: operation().dispatches.slice(0, 1) },
    { dispatches: operation().dispatches.toReversed() },
    {
      dispatches: operation().dispatches.map((d) => ({
        ...d,
        fileTarget: { ...target(), version: "f".repeat(64) },
      })),
    },
    { identity: { ...original(), digest: "f".repeat(64) } },
    { fileTarget: { ...target(), path: "other.txt" } },
    { reserved: true },
  ])
    assert.throws(() =>
      validateFileCompletion({ ...operation(), ...change }, payload, [
        FILE_FEATURE,
      ]),
    );
  assert.throws(() =>
    validateFileDispatch(operation(), {
      step: "native.create",
      fileTarget: target(),
    }),
  );
  assert.throws(() =>
    validateFileDispatch(
      {
        ...operation(),
        identity: { ...original(), type: "configuration.save" },
      },
      operation().dispatches[0],
    ),
  );
});
test("FILE admission requires durable registry and exact outer operationId before execution", async () => {
  let executed = 0;
  const host = createHostAdmission({
    execute: async () => {
      executed++;
    },
    ready: () => Promise.resolve(),
    revision: () => 0,
    projectReceipt: () => {},
    runtimeEpoch: "epoch",
  });
  const envelope = {
    version: 2,
    runtimeEpoch: "epoch",
    operationId: "save",
    operation: {
      type: "file.save",
      workspaceId: "workspace",
      requestId: "save",
      ...target(),
      expectation: "version",
      text: "body",
    },
  };
  assert.equal((await host.handle(envelope, "sender")).code, "UNAVAILABLE");
  host.close();
  const durable = createHostAdmission({
    execute: async () => {
      executed++;
    },
    ready: () => Promise.resolve(),
    revision: () => 0,
    projectReceipt: () => {},
    runtimeEpoch: "epoch",
    registry: () => ({ status: () => ({ state: "ready" }) }),
  });
  assert.equal(
    (
      await durable.handle(
        {
          ...envelope,
          operation: { ...envelope.operation, requestId: "different" },
        },
        "sender",
      )
    ).code,
    "INVALID_REQUEST",
  );
  assert.equal(executed, 0);
  durable.close();
});
