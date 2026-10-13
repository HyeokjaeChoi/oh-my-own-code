import assert from "node:assert/strict";
import test from "node:test";
import {
  createDiagnosticEmitter,
  sanitizeDiagnostic,
  validateHostMessage,
} from "./event-host-protocol.mjs";
const hex = "a".repeat(64);

const taskRequest = () => ({
  originKind: "prompt",
  origin: {
    runtimeEpoch: "main-epoch",
    operationId: "original-send",
    type: "message.send",
    digest: hex,
  },
  workspaceId: "workspace",
  appSessionId: "session",
  nativeSessionId: "native-session",
  inputDigest: "b".repeat(64),
});
test("private task preparation messages carry only closed original metadata and truthful held result", () => {
  const request = {
    type: "task-prepare",
    nonce: hex,
    requestId: hex,
    request: taskRequest(),
  };
  assert.equal(validateHostMessage(request, "child"), request);
  const response = {
    type: "task-preparation",
    nonce: hex,
    pid: 123,
    requestId: hex,
    request: taskRequest(),
    result: { status: "held", reason: "inventory_unverified" },
  };
  assert.equal(validateHostMessage(response, "parent"), response);
  for (const patch of [
    { request: { ...taskRequest(), text: "raw input must not enter IPC" } },
    { request: { ...taskRequest(), modeGeneration: 1 } },
    {
      request: {
        ...taskRequest(),
        origin: { ...taskRequest().origin, digest: "bad" },
      },
    },
    { extra: true },
  ])
    assert.throws(
      () => validateHostMessage({ ...request, ...patch }, "child"),
      /invalid_ipc/,
    );
  for (const result of [
    { status: "ready", modeGeneration: 1, inventoryGeneration: 1 },
    { status: "held", reason: "unknown" },
    { status: "held", reason: "inventory_unverified", taskScopeId: "fake" },
  ])
    assert.throws(
      () => validateHostMessage({ ...response, result }, "parent"),
      /invalid_ipc/,
    );
});

test("EventHost initialization requires exact Main epoch and refuses caller-selected graph controls", () => {
  const init = {
    type: "init",
    nonce: hex,
    password: hex,
    runtimeEpoch: "main-epoch",
    port: 0,
    root: "/SYNTHETIC/profile",
    workspace: "/SYNTHETIC/profile/workspace",
    configPath: "/SYNTHETIC/config",
    namespaceRoot: "/SYNTHETIC/durable",
    dataPath: "/SYNTHETIC/data",
    statePath: "/SYNTHETIC/state",
    database: "/SYNTHETIC/data/event-host.sqlite",
    engineVersion: "1.4.2",
    serverVersion: "2.0.18",
  };
  assert.equal(validateHostMessage(init, "child"), init);
  const omitted = { ...init };
  delete omitted.runtimeEpoch;
  assert.throws(() => validateHostMessage(omitted, "child"), /invalid_ipc/);
  for (const runtimeEpoch of [null, "", false, "with spaces", "x".repeat(129)])
    assert.throws(
      () => validateHostMessage({ ...init, runtimeEpoch }, "child"),
      /invalid_ipc/,
    );
  for (const extra of [
    { overrides: [] },
    { bootHolds: [] },
    { permissionControl: {} },
  ])
    assert.throws(
      () => validateHostMessage({ ...init, ...extra }, "child"),
      /invalid_ipc/,
    );
});

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

const uuid = (n) =>
  `5f1c2a40-1b7e-4c1a-8d33-0f5e5b9d3a${String(n).padStart(2, "0")}`;
const bootstrapRequest = () => ({
  originKind: "bootstrap",
  origin: {
    runtimeEpoch: "main-epoch",
    operationId: "original-create",
    type: "session.create",
    digest: hex,
  },
  workspaceId: "workspace",
  workspacePath: "/checked/workspace",
  appSessionId: "reserved-session",
  plannedNativeSessionId: "ses_planned",
  metadataDigest: "b".repeat(64),
  reservation: {
    kind: "bootstrap",
    step: "native.create",
    reservationDigest: "c".repeat(64),
    parentIdentityDigest: null,
  },
});
const prepared = () => ({
  status: "prepared",
  taskScopeId: uuid(1),
  locationId: uuid(2),
  projectId: "project",
  modeGeneration: 1,
  inventoryGeneration: 1,
  launchId: "launch-1",
});
const armRequest = () => ({
  handoffId: uuid(3),
  taskScopeId: uuid(1),
  originalKey: { runtimeEpoch: "main-epoch", operationId: "original-create" },
  originalDigest: hex,
  step: "native.create",
  stageArgumentDigest: "d".repeat(64),
  targetIdentity: {
    taskScopeId: uuid(1),
    origin: bootstrapRequest().origin,
    workspaceId: "workspace",
    projectId: "project",
    locationId: uuid(2),
    modeGeneration: 1,
    inventoryGeneration: 1,
    originKind: "bootstrap",
  },
  currentLaunchIdentity: "launch-1",
});

test("bootstrap preparation result is closed identity candidates only", () => {
  const response = {
    type: "task-preparation",
    nonce: hex,
    pid: 123,
    requestId: hex,
    request: bootstrapRequest(),
    result: prepared(),
  };
  assert.equal(validateHostMessage(response, "parent"), response);
  for (const result of [
    { ...prepared(), extra: true },
    { ...prepared(), modeGeneration: 0 },
    { ...prepared(), inventoryGeneration: -1 },
    { ...prepared(), taskScopeId: "not-a-uuid" },
    { ...prepared(), locationId: "not-a-uuid" },
    { ...prepared(), launchId: "bad launch" },
    { ...prepared(), reason: "inventory_unverified" },
    (({ launchId: _launch, ...rest }) => rest)(prepared()),
  ])
    assert.throws(
      () => validateHostMessage({ ...response, result }, "parent"),
      /invalid_ipc/,
    );
});

test("task-arm and task-revoke are closed private messages; handoff results are typed", () => {
  const arm = {
    type: "task-arm",
    nonce: hex,
    requestId: hex,
    request: armRequest(),
  };
  assert.equal(validateHostMessage(arm, "child"), arm);
  for (const patch of [
    { request: { ...armRequest(), expiresAt: 1 } },
    { request: { ...armRequest(), step: "native.send" } },
    { request: { ...armRequest(), handoffId: "not-a-uuid" } },
    { request: { ...armRequest(), stageArgumentDigest: "bad" } },
    { request: { ...armRequest(), taskScopeId: uuid(9) } },
    { request: { ...armRequest(), originalDigest: "e".repeat(64) } },
    {
      request: {
        ...armRequest(),
        targetIdentity: {
          ...armRequest().targetIdentity,
          originKind: "prompt",
        },
      },
    },
    { requestId: "short" },
    { extra: true },
  ])
    assert.throws(
      () => validateHostMessage({ ...arm, ...patch }, "child"),
      /invalid_ipc/,
    );
  const revoke = {
    type: "task-revoke",
    nonce: hex,
    requestId: hex,
    handoffId: uuid(3),
  };
  assert.equal(validateHostMessage(revoke, "child"), revoke);
  for (const patch of [{ handoffId: "x" }, { handoffId: 1 }, { extra: 1 }])
    assert.throws(
      () => validateHostMessage({ ...revoke, ...patch }, "child"),
      /invalid_ipc/,
    );
  const result = {
    type: "task-handoff-result",
    nonce: hex,
    pid: 123,
    requestId: hex,
    action: "arm",
    handoffId: uuid(3),
    status: "ok",
  };
  assert.equal(validateHostMessage(result, "parent"), result);
  for (const patch of [
    { action: "consume" },
    { status: "armed" },
    { handoffId: "x" },
    { extra: true },
  ])
    assert.throws(
      () => validateHostMessage({ ...result, ...patch }, "parent"),
      /invalid_ipc/,
    );
});

test("child diagnostics are bounded, path-redacted and strictly closed", () => {
  const raw = {
    kind: "native",
    tag: "Error",
    route: "GET /session/ses_0123456789abcdef0123/permission?token=secret",
    status: 500,
    detail: "boom at /Users/someone/project/secret.txt",
    code: "free text with spaces /Users/x",
    runtimeHeld: true,
    extra: "dropped",
  };
  const clean = sanitizeDiagnostic(raw);
  assert.equal(clean.route, "GET /session/:id/permission");
  // Free text is dropped entirely; identifiers must be plain tokens.
  assert.equal("detail" in clean, false);
  assert.equal("code" in clean, false);
  assert.equal(clean.tag, "Error");
  assert.equal(
    sanitizeDiagnostic({ kind: "reject", code: "root_unverified" }).code,
    "root_unverified",
  );
  assert.equal("extra" in clean, false);
  const message = {
    type: "diagnostic",
    nonce: hex,
    pid: 1,
    diagnostic: clean,
  };
  assert.equal(validateHostMessage(message, "parent"), message);
  assert.equal(sanitizeDiagnostic({ kind: "other" }), undefined);
  for (const bad of [
    { ...message, diagnostic: { ...clean, extra: 1 } },
    { ...message, diagnostic: { ...clean, detail: "anything" } },
    { ...message, diagnostic: { ...clean, tag: "/Users/x/y" } },
    { ...message, diagnostic: { kind: "reject", runtimeHeld: "yes" } },
    { ...message, extra: true },
  ])
    assert.throws(() => validateHostMessage(bad, "parent"), /invalid_ipc/);
  assert.throws(() => validateHostMessage(message, "child"), /invalid_ipc/);
});

test("diagnostic emitter caps each kind separately so holds are never lost", () => {
  const sent = [];
  let closing = false;
  const emit = createDiagnosticEmitter(
    (m) => sent.push(m),
    () => closing,
  );
  for (let i = 0; i < 1000; i++)
    emit({ kind: "native", tag: "Error", route: `GET /r/${i}` });
  for (let i = 0; i < 1000; i++) emit({ kind: "reject", code: `c${i}` });
  emit({ kind: "hold", step: "first" });
  emit({ kind: "hold", step: "first" }); // adjacent duplicate
  const count = (kind) => sent.filter((m) => m.diagnostic.kind === kind).length;
  assert.equal(count("native"), 100);
  assert.equal(count("reject"), 100);
  assert.equal(count("hold"), 1);
  closing = true;
  emit({ kind: "hold", step: "second" });
  assert.equal(count("hold"), 1);
  assert.ok(sent.every((m) => m.type === "diagnostic"));
});

import { eventHostEnvironment } from "./event-host-protocol.mjs";
test("host child environment is closed per platform and confined to the root", () => {
  const posix = eventHostEnvironment({
    platform: "darwin",
    root: "/r",
    configPath: "/c",
    dataPath: "/d",
    statePath: "/s",
  });
  assert.equal(posix.PATH, "/usr/bin:/bin:/usr/sbin:/sbin");
  assert.equal(posix.HOME, "/r/home");
  assert.equal("SystemRoot" in posix, false);
  const win = eventHostEnvironment({
    platform: "win32",
    root: "C:\\r",
    configPath: "C:\\c",
    dataPath: "C:\\d",
    statePath: "C:\\s",
    systemRoot: "C:\\Windows",
  });
  assert.deepEqual(win, {
    HOME: "C:\\r\\home",
    XDG_CONFIG_HOME: "C:\\c",
    XDG_DATA_HOME: "C:\\d",
    XDG_STATE_HOME: "C:\\s",
    XDG_CACHE_HOME: "C:\\r\\cache",
    TMPDIR: "C:\\r\\tmp",
    TMP: "C:\\r\\tmp",
    TEMP: "C:\\r\\tmp",
    OPENCODE_CONFIG_DIR: "C:\\c",
    OPENCODE_DISABLE_AUTOUPDATE: "true",
    PATH: "C:\\Windows\\System32",
    SystemRoot: "C:\\Windows",
    USERPROFILE: "C:\\r\\home",
    APPDATA: "C:\\r\\home\\AppData\\Roaming",
    LOCALAPPDATA: "C:\\r\\home\\AppData\\Local",
  });
});
