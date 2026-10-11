import assert from "node:assert/strict";
import test from "node:test";
import {
  createHostAdmission,
  currentScope,
} from "./host/workbench-admission.mjs";
import { validateEnvelope, validateRequest } from "./workbench-contract.mjs";
import {
  GIT_REVIEW_LIMITS,
  GIT_REVIEW_REASONS,
  GIT_DIFF_REASONS,
  validGitBranch,
  validGitOid,
  validateGitReviewObservation,
  validateGitDiffObservation,
} from "./renderer/shared/git-review/index.mjs";

const hash = "a".repeat(64);
const oid = "b".repeat(40);
const scope = {
  runtimeEpoch: "epoch",
  revision: 0,
  workspaceId: "workspace",
  workspacePath: "/synthetic/worktree",
};
const review = () => ({
  ...scope,
  status: "available",
  observationId: hash,
  repository: {
    worktreePath: scope.workspacePath,
    gitDirectory: "/synthetic/repository/.git/worktrees/second",
    commonDirectory: "/synthetic/repository/.git",
    objectFormat: "sha1",
    head: oid,
    branch: "main",
  },
  branches: [{ name: "main", oid }],
  files: [
    {
      path: "src/file.txt",
      index: "modified",
      worktree: "modified",
      kind: "tracked",
    },
  ],
});
const diff = () => ({
  ...scope,
  observationId: hash,
  mode: "unstaged",
  path: "src/file.txt",
  status: "available",
  patch: "@@ -1 +1 @@\n-old\n+new\n",
  sourceDigest: hash,
});
const invalid = (fn) =>
  assert.throws(fn, (error) => error.appCode === "INVALID_REQUEST");

test("Git review is a normal authenticated workspace read, never a mutation", () => {
  const operation = { type: "git.review.read", workspaceId: "workspace" };
  assert.equal(validateRequest(operation), operation);
  assert.equal(
    validateEnvelope({
      version: 2,
      runtimeEpoch: "epoch",
      readId: "read",
      operation,
    }).operation,
    operation,
  );
});

test("Git selected diff closes base and workspace fields before read admission", () => {
  const request = {
    type: "git.diff.read",
    workspaceId: "workspace",
    observationId: hash,
    mode: "base",
    path: "--option-looking.txt",
    baseRef: "feature/한국어",
  };
  assert.equal(validateRequest(request), request);
  for (const bad of [
    { ...request, sessionId: "session" },
    { ...request, operationId: "operation" },
    { ...request, mode: "unstaged" },
    { ...request, mode: "bad" },
    { ...request, baseRef: undefined },
    { ...request, baseRef: "HEAD~1" },
    { ...request, path: "../outside" },
    { ...request, path: ".git/../file" },
    { ...request, observationId: "not-a-hash" },
    { ...request, workspaceId: "" },
    { ...request, root: scope.workspacePath },
  ])
    invalid(() => validateRequest(bad));
  const unstaged = { ...request, mode: "unstaged" };
  delete unstaged.baseRef;
  assert.equal(validateRequest(unstaged), unstaged);
  invalid(() =>
    validateEnvelope({
      version: 2,
      runtimeEpoch: "epoch",
      operationId: "operation",
      operation: unstaged,
    }),
  );
  invalid(() =>
    validateEnvelope({
      version: 2,
      runtimeEpoch: "epoch",
      readId: "read",
      expectedRevision: 0,
      operation: unstaged,
    }),
  );
});

test("Git branches and object IDs use literal observed names and format lengths", () => {
  for (const branch of ["main", "feature/한국어", "a".repeat(512)])
    assert.equal(validGitBranch(branch), true);
  for (const branch of [
    "",
    "HEAD",
    "@",
    "-x",
    "a..b",
    "a@{b",
    "a/.b",
    "a.lock",
    "a.",
    "a//b",
    "a/",
    "a b",
    "a~1",
    "a:b",
    "a[b",
    "a\\b",
    "a\ud800",
    "a\u202e",
    "a".repeat(513),
    "한".repeat(171),
  ])
    assert.equal(validGitBranch(branch), false, branch);
  assert.equal(validGitOid(oid, "sha1"), true);
  assert.equal(validGitOid(hash, "sha256"), true);
  assert.equal(validGitOid(hash, "sha1"), false);
  assert.equal(validGitOid(oid, "sha256"), false);
  assert.equal(validGitOid("x".repeat(40)), false);
  assert.equal(validGitOid(oid, "other"), false);
});

test("Git closed observation keeps staged and unstaged independently and accepts unborn/detached", () => {
  const value = review();
  assert.equal(validateGitReviewObservation(value), value);
  assert.equal(value.files[0].index, "modified");
  assert.equal(value.files[0].worktree, "modified");
  for (const patch of [{ head: null }, { branch: null }]) {
    const next = review();
    Object.assign(next.repository, patch);
    assert.equal(validateGitReviewObservation(next), next);
  }
  const sha256 = review();
  sha256.repository.objectFormat = "sha256";
  sha256.repository.head = hash;
  sha256.branches[0].oid = hash;
  assert.equal(validateGitReviewObservation(sha256), sha256);
  const rows = [
    {
      path: "untracked.txt",
      index: "none",
      worktree: "none",
      kind: "untracked",
    },
    {
      path: "conflict.txt",
      index: "unmerged",
      worktree: "unmerged",
      kind: "conflict",
    },
    { path: ".env", index: "added", worktree: "none", kind: "tracked" },
  ];
  const next = review();
  next.files = rows;
  assert.equal(validateGitReviewObservation(next), next);
});

test("Git observation rejects forged clocks, repositories, rows, prototypes and getters without invoking them", () => {
  const variants = [
    { revision: -1 },
    { revision: 1.5 },
    { revision: Number.MAX_SAFE_INTEGER + 1 },
    { runtimeEpoch: "" },
    { workspacePath: "relative" },
    { observationId: "x" },
    { truncated: true },
    { branches: Array(129).fill({ name: "main", oid }) },
    { files: Array(513).fill(review().files[0]) },
    {
      branches: [
        { name: "main", oid },
        { name: "main", oid },
      ],
    },
    { files: [review().files[0], review().files[0]] },
    { repository: { ...review().repository, worktreePath: "/other" } },
    { repository: { ...review().repository, objectFormat: "sha512" } },
    { repository: { ...review().repository, head: hash } },
    { repository: { ...review().repository, branch: "missing" } },
    { repository: { ...review().repository, executable: "git" } },
    { files: [{ ...review().files[0], index: "renamed" }] },
    { files: [{ ...review().files[0], kind: "untracked" }] },
    { files: [{ ...review().files[0], kind: "conflict" }] },
    { files: [{ ...review().files[0], index: "none", worktree: "none" }] },
    { files: [{ ...review().files[0], path: "../outside" }] },
    { files: [{ ...review().files[0], content: "secret" }] },
  ];
  for (const patch of variants)
    invalid(() => validateGitReviewObservation({ ...review(), ...patch }));
  let getterCalls = 0;
  const getter = review();
  Object.defineProperty(getter, "status", {
    get() {
      getterCalls++;
      return "available";
    },
  });
  invalid(() => validateGitReviewObservation(getter));
  const rows = review();
  Object.defineProperty(rows.files, "0", {
    get() {
      getterCalls++;
      return review().files[0];
    },
  });
  invalid(() => validateGitReviewObservation(rows));
  assert.equal(getterCalls, 0);
  const holes = review();
  holes.files = new Array(1);
  invalid(() => validateGitReviewObservation(holes));
  invalid(() =>
    validateGitReviewObservation(Object.assign(Object.create(null), review())),
  );
  const symbol = review();
  symbol[Symbol("extra")] = 1;
  invalid(() => validateGitReviewObservation(symbol));
});

test("Git unavailable results are closed and contain no fabricated success or raw errors", () => {
  for (const reason of GIT_REVIEW_REASONS) {
    const value = { ...scope, status: "unavailable", reason };
    assert.equal(validateGitReviewObservation(value), value);
    invalid(() => validateGitReviewObservation({ ...value, files: [] }));
    invalid(() =>
      validateGitReviewObservation({ ...value, stderr: "private" }),
    );
  }
  for (const reason of GIT_DIFF_REASONS) {
    const value = {
      ...scope,
      observationId: hash,
      mode: "base",
      path: "file.txt",
      baseRef: "main",
      baseOid: oid,
      status: "unavailable",
      reason,
    };
    assert.equal(validateGitDiffObservation(value), value);
    invalid(() => validateGitDiffObservation({ ...value, patch: "" }));
  }
  invalid(() =>
    validateGitReviewObservation({
      ...scope,
      status: "unavailable",
      reason: "unknown_reason",
    }),
  );
});

test("Git detail validates exact base shape and selected source digest", () => {
  const value = diff();
  assert.equal(validateGitDiffObservation(value), value);
  const base = {
    ...value,
    mode: "base",
    baseRef: "main",
    baseOid: oid,
    patch: "",
  };
  assert.equal(validateGitDiffObservation(base), base);
  for (const patch of [
    { mode: "base" },
    { sourceDigest: oid },
    { baseRef: "main" },
    { baseOid: oid },
    { path: "../file" },
    { observationId: oid },
    { patch: "\x1b[31mcontent" },
    { patch: "a\ud800" },
  ])
    invalid(() => validateGitDiffObservation({ ...diff(), ...patch }));
  invalid(() => validateGitDiffObservation({ ...base, baseOid: null }));
});

test("Git patch bounds refuse partial and oversized content at byte/line/hunk limits", () => {
  for (const patch of [
    "x".repeat(65536),
    "\n".repeat(2048),
    "@@ -1 +1 @@\n".repeat(128),
  ])
    assert.equal(validateGitDiffObservation({ ...diff(), patch }).patch, patch);
  for (const patch of [
    "x".repeat(65537),
    "한".repeat(21846),
    "\n".repeat(2049),
    "@@ -1 +1 @@\n".repeat(129),
  ])
    invalid(() => validateGitDiffObservation({ ...diff(), patch }));
});

test("Git aggregate JSON escaping is bounded rather than counting only raw strings", () => {
  const value = review();
  value.files = Array.from({ length: 512 }, (_, i) => ({
    path: `${i}-` + "한".repeat(70),
    index: "added",
    worktree: "none",
    kind: "tracked",
  }));
  assert.equal(validateGitReviewObservation(value), value);
  const overflow = review();
  overflow.files = Array.from({ length: 512 }, (_, i) => ({
    path: `${i}/` + Array(4).fill("x".repeat(250)).join("/"),
    index: "added",
    worktree: "none",
    kind: "tracked",
  }));
  assert.ok(
    new globalThis.TextEncoder().encode(JSON.stringify(overflow)).length >
      GIT_REVIEW_LIMITS.dtoBytes,
  );
  invalid(() => validateGitReviewObservation(overflow));
});

test("Git authority sees authenticated sender and keeps mutation hold until actual settlement", async () => {
  let release, enter;
  const paused = new Promise((resolve) => {
    release = resolve;
  });
  const entered = new Promise((resolve) => {
    enter = resolve;
  });
  const host = createHostAdmission({
    runtimeEpoch: "epoch",
    deadlineMs: 20,
    ready: () => Promise.resolve(),
    revision: () => 0,
    projectReceipt: async () => {},
    execute: async (operation) => {
      if (operation.type === "git.review.read")
        return { ok: true, value: currentScope().sender };
      enter();
      await paused;
      return { ok: true, value: {} };
    },
  });
  try {
    assert.equal(
      (
        await host.handle(
          {
            version: 2,
            runtimeEpoch: "epoch",
            readId: "read",
            operation: { type: "git.review.read", workspaceId: "workspace" },
          },
          "actual-sender",
        )
      ).value,
      "actual-sender",
    );
    assert.equal(host.mutationActive(), false);
    const response = host.handle(
      {
        version: 2,
        runtimeEpoch: "epoch",
        operationId: "operation",
        operation: { type: "workspace.create" },
      },
      "actual-sender",
    );
    await entered;
    assert.equal(host.mutationActive(), true);
    await response;
    assert.equal(host.mutationActive(), true);
    release();
    await host.drain();
    assert.equal(host.mutationActive(), false);
  } finally {
    release();
    host.close();
    await host.drain();
  }
});

async function serviceFixture(
  t,
  { reader, recoveryReason, client = {}, confirmTrust } = {},
) {
  const fs = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { openWorkspaceRegistry } = await import(
    "./host/workspace-registry.mjs"
  );
  const { createWorkbenchService } = await import("./workbench-service.mjs");
  const root = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "omoc-git-service-")),
  );
  const directory = join(root, "store"),
    workspace = join(root, "worktree");
  await fs.mkdir(directory);
  await fs.mkdir(workspace);
  const registry = await openWorkspaceRegistry({
    directory,
    documentsPath: root,
    storeId: "git-service",
    runtimeEpoch: "epoch",
  });
  const calls = [];
  const state = { pickDirectory: async () => workspace };
  const injected = reader ?? {
    async review(w, options) {
      calls.push({
        type: "review",
        workspace: w,
        options,
        signalAbortedAtDispatch: options.signal.aborted,
      });
      const value = review();
      delete value.runtimeEpoch;
      delete value.revision;
      value.workspaceId = w.id;
      value.workspacePath = w.path;
      value.repository.worktreePath = w.path;
      value.repository.gitDirectory = join(w.path, ".git");
      value.repository.commonDirectory = join(w.path, ".git");
      return value;
    },
    async diff(w, request, options) {
      calls.push({ type: "diff", workspace: w, request, options });
      const value = diff();
      delete value.runtimeEpoch;
      delete value.revision;
      return {
        ...value,
        workspaceId: w.id,
        workspacePath: w.path,
        observationId: request.observationId,
        path: request.path,
        mode: request.mode,
        ...(request.mode === "base" && {
          baseRef: request.baseRef,
          baseOid: oid,
        }),
      };
    },
    closeSender(sender) {
      calls.push({ type: "closeSender", sender });
    },
    close() {
      calls.push({ type: "close" });
    },
  };
  const service = createWorkbenchService({
    registry,
    runtimeEpoch: "epoch",
    recoveryReason,
    runtime: {
      snapshot: () => ({ state: "connected" }),
      workbenchContext: () => ({ client }),
    },
    pickDirectory: () => state.pickDirectory(),
    gitReader: injected,
    confirmTrust,
  });
  let next = 0;
  const read = (operation, sender = "sender") =>
    service.handle(
      {
        version: 2,
        runtimeEpoch: "epoch",
        readId: `read-${++next}`,
        operation,
      },
      sender,
    );
  const mutate = (operation, operationId = `operation-${++next}`) =>
    service.handle(
      { version: 2, runtimeEpoch: "epoch", operationId, operation },
      "sender",
    );
  t.after(async () => {
    service.close();
    await service.drain();
    await registry.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const readyUntil = Date.now() + 1000;
  let initial;
  do {
    initial = await read({ type: "snapshot" });
    if (initial.value?.state === "connected" || recoveryReason) break;
    await new Promise((resolve) => setImmediate(resolve));
  } while (Date.now() < readyUntil);
  assert.equal(initial.ok, true, JSON.stringify(initial));
  const imported = recoveryReason
    ? undefined
    : await mutate({ type: "workspace.import" });
  if (imported) assert.equal(imported.ok, true, JSON.stringify(imported));
  const workspaceId = imported?.value.selectedWorkspaceId;
  return {
    root,
    workspace,
    workspaceId,
    registry,
    service,
    read,
    mutate,
    calls,
    injected,
    state,
    fs,
  };
}

test("Git actual service and production reader reject pre-trust observation before new IO", async (t) => {
  const { createWorkbenchGitReader } = await import("./host/workbench-git.mjs");
  const fs = await import("node:fs/promises");
  const { spawn, spawnSync } = await import("node:child_process");
  const { join } = await import("node:path");
  let ioCalls = 0,
    spawns = 0;
  const reader = createWorkbenchGitReader({
    io: {
      ...fs,
      async lstat(...args) {
        ioCalls++;
        return fs.lstat(...args);
      },
    },
    spawn(...args) {
      spawns++;
      return spawn(...args);
    },
  });
  const records = new Map();
  const f = await serviceFixture(t, {
    reader,
    confirmTrust: async () => true,
    client: {
      session: {
        async create(input) {
          records.set(input.id, { ...input });
          return { ...input };
        },
        async get({ sessionID }) {
          return { ...records.get(sessionID) };
        },
        async update({ sessionID, permissions }) {
          records.get(sessionID).permissions = permissions;
          return { ...records.get(sessionID) };
        },
      },
    },
  });
  const git = "/Library/Developer/CommandLineTools/usr/bin/git";
  const env = {
    HOME: f.root,
    PATH: "/Library/Developer/CommandLineTools/usr/bin",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    LC_ALL: "C",
  };
  const setup = spawnSync(git, ["init", "-b", "main"], {
    cwd: f.workspace,
    env,
    encoding: "utf8",
  });
  assert.equal(setup.status, 0);
  await fs.writeFile(join(f.workspace, "a.txt"), "synthetic\n");
  const observed = await f.read({
    type: "git.review.read",
    workspaceId: f.workspaceId,
  });
  assert.equal(observed.ok, true, JSON.stringify(observed));
  assert.equal(observed.value.status, "available", observed.value.reason);
  const before = (await f.read({ type: "snapshot" })).value.workspaces[0];
  assert.equal(before.trusted, false);
  const created = await f.mutate({
    type: "session.create",
    workspaceId: f.workspaceId,
  });
  assert.equal(created.ok, true, JSON.stringify(created));
  const after = (await f.read({ type: "snapshot" })).value.workspaces[0];
  assert.equal(after.trusted, true);
  const counters = { ioCalls, spawns };
  const selected = await f.read({
    type: "git.diff.read",
    workspaceId: f.workspaceId,
    observationId: observed.value.observationId,
    path: "a.txt",
    mode: "unstaged",
  });
  assert.equal(selected.ok, true, JSON.stringify(selected));
  assert.equal(selected.value.reason, "stale_observation");
  assert.deepEqual({ ioCalls, spawns }, counters);
});

test("Git service uses durable untrusted workspace authority and atomic app clocks without Native effects", async (t) => {
  const f = await serviceFixture(t);
  assert.ok(f.workspaceId);
  const before = await f.read({ type: "snapshot" });
  assert.equal(before.value.workspaces[0].trusted, false);
  const observed = await f.read(
    { type: "git.review.read", workspaceId: f.workspaceId },
    "authenticated-sender",
  );
  assert.equal(observed.ok, true, JSON.stringify(observed));
  assert.equal(observed.value.runtimeEpoch, "epoch");
  assert.equal(observed.value.revision, f.registry.status().revision);
  assert.equal(observed.value.workspacePath, f.workspace);
  assert.equal(f.calls[0].options.sender, "authenticated-sender");
  assert.equal(f.calls[0].options.runtimeEpoch, "epoch");
  assert.equal(f.calls[0].signalAbortedAtDispatch, false);
  assert.equal(typeof f.calls[0].options.check, "function");
  const selected = await f.read({
    type: "git.diff.read",
    workspaceId: f.workspaceId,
    observationId: hash,
    mode: "base",
    path: "file.txt",
    baseRef: "main",
  });
  assert.equal(selected.ok, true, JSON.stringify(selected));
  assert.equal(selected.value.baseOid, oid);
  assert.equal(selected.value.baseRef, "main");
  assert.ok(
    Buffer.byteLength(JSON.stringify(selected)) <=
      GIT_REVIEW_LIMITS.envelopeBytes,
  );
  assert.equal(
    (
      await f.read({
        type: "file.edit.read",
        workspaceId: f.workspaceId,
        path: "file.txt",
      })
    ).code,
    "INVALID_SELECTION",
  );
});

test("Git service rejects unknown workspace, epoch and malformed DTO before granting current authority", async (t) => {
  const f = await serviceFixture(t);
  assert.equal(
    (await f.read({ type: "git.review.read", workspaceId: "unknown" })).code,
    "NOT_FOUND",
  );
  assert.equal(
    (
      await f.service.handle(
        {
          version: 2,
          runtimeEpoch: "old",
          readId: "old",
          operation: { type: "git.review.read", workspaceId: f.workspaceId },
        },
        "sender",
      )
    ).code,
    "STALE_EPOCH",
  );
  assert.equal(f.calls.length, 0);
  const original = f.injected.review;
  for (const patch of [
    { workspaceId: "wrong" },
    { workspacePath: "/wrong" },
    { files: [], rawConfig: "private" },
    { observationId: "bad" },
    {
      files: [
        {
          path: "../private",
          index: "added",
          worktree: "none",
          kind: "tracked",
        },
      ],
    },
  ]) {
    f.injected.review = async (...args) => ({
      ...(await original(...args)),
      ...patch,
    });
    assert.equal(
      (await f.read({ type: "git.review.read", workspaceId: f.workspaceId }))
        .code,
      "UNAVAILABLE",
    );
  }
});

test("Git service validates original selected detail fields and refuses scope or mode substitution", async (t) => {
  const f = await serviceFixture(t);
  const original = f.injected.diff;
  const request = {
    type: "git.diff.read",
    workspaceId: f.workspaceId,
    observationId: hash,
    mode: "base",
    path: "file.txt",
    baseRef: "main",
  };
  for (const patch of [
    { path: "other.txt" },
    { observationId: "c".repeat(64) },
    { baseRef: "other" },
    { mode: "staged" },
    { sourceDigest: "invalid" },
  ]) {
    f.injected.diff = async (...args) => ({
      ...(await original(...args)),
      ...patch,
    });
    assert.equal((await f.read(request)).code, "UNAVAILABLE");
  }
});

test("Git global recovery refuses any process work even for syntactically valid known-shaped reads", async (t) => {
  const f = await serviceFixture(t, {
    recoveryReason: "native_startup_unverified",
  });
  assert.equal(
    (await f.read({ type: "git.review.read", workspaceId: "workspace" })).code,
    "UNAVAILABLE",
  );
  assert.equal(f.calls.length, 0);
});

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
test("Git service blocks reads while any actual app mutation owns admission, then recovers", async (t) => {
  const f = await serviceFixture(t),
    pause = deferred(),
    entered = deferred();
  t.after(() => pause.resolve());
  f.state.pickDirectory = async () => {
    entered.resolve();
    await pause.promise;
    return null;
  };
  const mutating = f.mutate({ type: "workspace.import" });
  await entered.promise;
  const result = await f.read({
    type: "git.review.read",
    workspaceId: f.workspaceId,
  });
  assert.equal(result.code, "BUSY");
  assert.equal(f.calls.length, 0);
  pause.resolve();
  assert.equal((await mutating).code, "CANCELLED");
  assert.equal(
    (await f.read({ type: "git.review.read", workspaceId: f.workspaceId })).ok,
    true,
  );
});

test("Git late read cannot publish across an actual concurrent mutation revision", async (t) => {
  const f = await serviceFixture(t),
    pause = deferred(),
    entered = deferred();
  t.after(() => pause.resolve());
  const original = f.injected.review;
  f.injected.review = async (...args) => {
    entered.resolve();
    await pause.promise;
    return original(...args);
  };
  const reading = f.read({
    type: "git.review.read",
    workspaceId: f.workspaceId,
  });
  await entered.promise;
  f.state.pickDirectory = async () => null;
  const changed = await f.mutate({ type: "workspace.import" });
  assert.equal(changed.code, "CANCELLED");
  pause.resolve();
  const result = await reading;
  assert.equal(result.ok, false);
  assert.equal(result.code, "UNAVAILABLE");
});

test("Git sender close aborts its actual read signal and retires only its observation authority", async (t) => {
  const f = await serviceFixture(t),
    entered = deferred();
  const original = f.injected.review;
  let signal;
  f.injected.review = async (w, options) => {
    signal = options.signal;
    entered.resolve();
    await new Promise((resolve) =>
      options.signal.addEventListener("abort", resolve, { once: true }),
    );
    return original(w, options);
  };
  const reading = f.read(
    { type: "git.review.read", workspaceId: f.workspaceId },
    "closed-sender",
  );
  await entered.promise;
  f.service.closeSender("closed-sender");
  assert.equal((await reading).code, "CANCELLED");
  assert.equal(signal.aborted, true);
  assert.deepEqual(
    f.calls.find((call) => call.type === "closeSender"),
    { type: "closeSender", sender: "closed-sender" },
  );
  await f.service.drain();
});

test("Git service drain waits for asynchronous owned reader shutdown exactly once", async (t) => {
  const f = await serviceFixture(t),
    shutdown = deferred();
  let closes = 0;
  f.injected.close = () => {
    closes++;
    return shutdown.promise;
  };
  t.after(() => shutdown.resolve());
  f.service.close();
  f.service.close();
  let drained = false;
  const draining = f.service.drain().then(() => {
    drained = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  try {
    assert.equal(
      drained,
      false,
      "registry/owner release must wait for reader shutdown",
    );
    assert.equal(closes, 1);
  } finally {
    shutdown.resolve();
    await draining;
  }
});
