import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdtemp,
  rm,
  readFile,
  writeFile,
  mkdir,
  symlink,
  stat,
  chmod,
  realpath,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createWorkbenchService,
  projectMessages,
} from "./workbench-service.mjs";
import { BASELINE_POLICY } from "./workbench-contract.mjs";
import { MAX_FILE_BYTES, defaultFolderName } from "./host/workbench-files.mjs";

async function fixture(
  t,
  { contextIO, deadlineMs = 5000, confirmSessionRevert, checkpoints } = {},
) {
  // realpath: containment compares canonical paths (macOS TMPDIR is a symlink).
  const root = await realpath(await mkdtemp(join(tmpdir(), "workbench-test-")));
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls = [];
  const infos = new Map();
  let count = 0;
  const info = (id) => ({
    id,
    projectID: "project",
    title: "Synthetic session",
    time: { created: 1, updated: 1 },
    location: { directory: workspace },
    permissions: BASELINE_POLICY,
  });
  infos.set("sdk-default", info("sdk-default"));
  const state = {
    active: {},
    connection: "connected",
    inbox: [],
    messages: [],
    permissions: [],
    policyReadFails: false,
    policyMismatch: false,
    models: true,
    pick: null,
    trust: true,
    importOk: true,
    importPrompts: [],
  };
  const method =
    (name, fn) =>
    async (...args) => {
      calls.push({ name, args });
      return fn(...args);
    };
  const client = {
    session: {
      get: method("get", ({ sessionID }) => {
        if (state.policyReadFails) throw new Error("secret endpoint");
        return {
          ...infos.get(sessionID),
          permissions: state.policyMismatch
            ? []
            : infos.get(sessionID).permissions,
        };
      }),
      update: method("update", ({ sessionID, permissions }) => {
        infos.get(sessionID).permissions = permissions;
      }),
      create: method("create", ({ title, location }) => {
        const result = { ...info(`sdk-${++count}`), title, location };
        infos.set(result.id, result);
        return result;
      }),
      list: method("sessions", () => ({
        data: state.sessionList ?? [...infos.values()],
        cursor: {},
      })),
      active: method("active", () => state.active),
      inbox: { list: method("inbox", () => state.inbox) },
      switchAgent: method("switchAgent", () => {}),
      switchModel: method("switchModel", () => {}),
      prompt: method("prompt", async ({ sessionID, text }) => {
        if (state.prompt) return state.prompt();
        const result = {
          id: "inbox-1",
          sessionID,
          type: "user",
          time: { created: 2 },
          payload: { text },
          delivery: "queue",
        };
        state.inbox = [result];
        return result;
      }),
      command: method("command", () => {}),
      interrupt: method("interrupt", () => ({ interrupted: true })),
    },
    message: {
      list: method("messages", () => ({ data: state.messages, cursor: {} })),
    },
    permission: {
      list: method("permissions", () => state.permissions),
      reply: method("reply", () => {}),
    },
    command: {
      list: method("commands", () => ({
        data: [{ name: "review", description: "Review" }],
      })),
    },
    skill: { list: method("skills", () => ({ data: [] })) },
    mcp: { list: method("mcp", () => ({ data: [] })) },
    agent: {
      list: method("agents", () => ({
        data: [{ id: "build", name: "Build", mode: "primary", hidden: false }],
      })),
    },
    model: {
      list: method("models", () => ({
        data: state.models
          ? [
              {
                id: "model-a",
                providerID: state.providerID ?? "provider",
                name: "Model",
                enabled: true,
                status: "active",
                headers: { secret: "never expose" },
                ...(state.modelOptions ?? {}),
              },
              ...(state.extraModels ?? []),
            ]
          : [],
      })),
    },
    provider: {
      list: method("providers", () => ({
        data: [
          {
            id: state.providerID ?? "provider",
            integrationID: "integration",
            activation: "enabled",
          },
        ],
      })),
    },
    integration: {
      list: method("integrations", () => ({
        data: [
          {
            id: "integration",
            connections: state.noCredential
              ? []
              : [
                  {
                    type: "credential",
                    id: "credential",
                    method: "key",
                    label: "test",
                  },
                ],
          },
        ],
      })),
    },
  };
  const runtime = {
    workspace,
    snapshot: () => ({ state: state.connection }),
    workbenchContext: () => ({
      client,
      session: infos.get("sdk-default"),
      nativeExtensions: {
        observe: async (scope) => {
          calls.push({ name: "extensions.observe", args: [scope] });
          return state.extensions
            ? state.extensions(scope)
            : {
                ...scope,
                status: "available",
                plugins: { status: "available", rows: [] },
                tools: {
                  status: "available",
                  rows: [{ id: "read", name: "read" }],
                },
                hooks: {
                  status: "not_reported",
                  reason: "inventory_not_supported",
                },
              };
        },
      },
    }),
  };
  const service = createWorkbenchService({
    trustedTestAdapter: true,
    deadlineMs,
    ...(contextIO && { contextIO }),
    runtime,
    pickDirectory: async () => state.pick,
    pickFile: async (dir, kind) => {
      state.pickedFrom = dir;
      state.pickedKind = kind;
      return state.pickFile;
    },
    probeWorkspace: async (path) => ({
      branch: "main",
      writable: path !== "x",
      ...(path.endsWith("typed") && { kind: "worktree", origin: "/repo" }),
    }),
    confirmTrust: async () => state.trust,
    confirmImport: async (path) => {
      state.importPrompts.push(path);
      return state.importOk;
    },
    ...(confirmSessionRevert && { confirmSessionRevert }),
    ...(checkpoints && { checkpoints }),
  });
  t.after(() => service.close());
  const initial = await service.handle({ type: "snapshot" });
  assert.equal(initial.ok, true);
  const ids = {
    workspaceId: initial.value.selectedWorkspaceId,
    sessionId: initial.value.selectedSessionId,
  };
  return {
    root,
    workspace,
    epoch: initial.value.runtimeEpoch,
    service,
    client,
    state,
    calls,
    infos,
    ids,
    send: (overrides = {}) =>
      service.handle({
        type: "message.send",
        ...ids,
        requestId: "req-1",
        text: "Hello",
        ...overrides,
      }),
  };
}
test("context.pick and context.resolve contain every path in the workspace", async (t) => {
  const f = await fixture(t);
  const read = (operation) =>
    f.service.handle(
      {
        version: 2,
        runtimeEpoch: f.epoch,
        readId: randomUUID(),
        operation: { workspaceId: f.ids.workspaceId, ...operation },
      },
      "pick-sender",
    );
  const pick = (kind) => read({ type: "context.pick", ...(kind && { kind }) });
  const resolve = (paths) => read({ type: "context.resolve", paths });
  await mkdir(join(f.workspace, "src"));
  await writeFile(join(f.workspace, "src", "app.ts"), "x");
  await writeFile(join(f.workspace, "b.txt"), "x");
  await writeFile(join(f.root, "outside.txt"), "x");
  await mkdir(join(f.root, "outside-dir"));
  await symlink(join(f.root, "outside.txt"), join(f.workspace, "link.txt"));
  await symlink(join(f.root, "outside-dir"), join(f.workspace, "dirlink"));
  const rootReal = await realpath(f.workspace);

  // File pick: multi-select, each canonicalized; outside entries are counted.
  f.state.pickFile = [
    join(f.workspace, "src", "app.ts"),
    join(f.workspace, "b.txt"),
    join(f.root, "outside.txt"),
    join(f.workspace, "link.txt"),
    join(f.workspace, "missing.txt"),
  ];
  assert.deepEqual(await pick(), {
    ok: true,
    value: { files: ["src/app.ts", "b.txt"], folders: [], refused: 3 },
  });
  assert.equal(f.state.pickedFrom, rootReal);
  assert.equal(f.state.pickedKind, "file");
  // A directory in a file pick is not a file.
  f.state.pickFile = [join(f.workspace, "src")];
  assert.deepEqual((await pick()).value, {
    files: [],
    folders: [],
    refused: 1,
  });
  // Folder pick: workspace root maps to "", subfolders to their relative path.
  f.state.pickFile = [f.workspace];
  assert.deepEqual((await pick("folder")).value, {
    files: [],
    folders: [""],
    refused: 0,
  });
  f.state.pickFile = [join(f.workspace, "src")];
  assert.deepEqual((await pick("folder")).value.folders, ["src"]);
  assert.equal(f.state.pickedKind, "folder");
  for (const outside of [
    f.root,
    join(f.root, "outside-dir"),
    join(f.workspace, "dirlink"),
  ]) {
    f.state.pickFile = [outside];
    assert.deepEqual((await pick("folder")).value, {
      files: [],
      folders: [],
      refused: 1,
    });
  }
  // Cancel and caps.
  f.state.pickFile = undefined;
  assert.equal((await pick()).code, "CANCELLED");
  f.state.pickFile = Array.from({ length: 20 }, () =>
    join(f.workspace, "b.txt"),
  );
  const capped = (await pick()).value;
  assert.equal(capped.files.length, 16);
  assert.equal(capped.refused, 4);
  assert.notEqual(
    (await read({ type: "context.pick", workspaceId: "nope" })).ok,
    true,
  );

  // Drag-and-drop resolution uses the same containment.
  assert.deepEqual(
    (
      await resolve([
        join(f.workspace, "b.txt"),
        join(f.workspace, "src"),
        join(f.root, "outside.txt"),
        join(f.workspace, "link.txt"),
        join(f.workspace, "dirlink"),
        join(f.workspace, "nope"),
      ])
    ).value,
    { files: ["b.txt"], folders: ["src"], refused: 4 },
  );
  assert.equal((await resolve(["relative/path.txt"])).code, "INVALID_REQUEST");
  assert.equal((await resolve([])).code, "INVALID_REQUEST");
  assert.equal(
    (
      await resolve(
        Array.from({ length: 17 }, () => join(f.workspace, "b.txt")),
      )
    ).code,
    "INVALID_REQUEST",
  );
  assert.equal(
    (await resolve(["/" + "a".repeat(2050)])).code,
    "INVALID_REQUEST",
  );
  assert.equal(
    (await read({ type: "context.pick", kind: "other" })).code,
    "INVALID_REQUEST",
  );
});
test("context.resolve refuses lexically outside paths without touching the filesystem", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.workspace, "in.txt"), "x");
  // Outside the workspace, but its realpath is inside: only a lexical
  // pre-filter (before any realpath) refuses it.
  await symlink(join(f.workspace, "in.txt"), join(f.root, "alias-in.txt"));
  const result = await f.service.handle(
    {
      version: 2,
      runtimeEpoch: f.epoch,
      readId: randomUUID(),
      operation: {
        workspaceId: f.ids.workspaceId,
        type: "context.resolve",
        paths: [
          join(f.root, "alias-in.txt"),
          join(f.workspace, "..", "alias-in.txt"),
          join(f.workspace, "in.txt"),
        ],
      },
    },
    "resolve-sender",
  );
  assert.deepEqual(result, {
    ok: true,
    value: { files: ["in.txt"], folders: [], refused: 2 },
  });
});
test("explicit extension read has exact scope/clocks and no session/configuration effects", async (t) => {
  const f = await fixture(t);
  const before = await f.service.handle({ type: "snapshot" });
  const path = before.value.workspaces.find(
    (w) => w.id === f.ids.workspaceId,
  ).path;
  f.calls.length = 0;
  const response = await f.service.handle(
    {
      version: 2,
      runtimeEpoch: before.value.runtimeEpoch,
      readId: "extensions-explicit",
      operation: {
        type: "configuration.extensions.read",
        workspaceId: f.ids.workspaceId,
      },
    },
    "window",
  );
  assert.equal(response.ok, true, JSON.stringify(response));
  assert.equal(response.value.runtimeEpoch, before.value.runtimeEpoch);
  assert.equal(response.value.revision, before.value.revision);
  assert.equal(response.value.workspacePath, path);
  assert.deepEqual(
    f.calls.map((entry) => entry.name),
    ["extensions.observe"],
  );
  assert.deepEqual(f.calls[0].args, [
    { workspaceId: f.ids.workspaceId, workspacePath: path },
  ]);
  assert.equal(Object.hasOwn(response.value, "sessionId"), false);
});
test("extension read rejects foreign response and untrusted workspace without effect calls", async (t) => {
  const f = await fixture(t);
  f.state.extensions = (scope) => ({
    ...scope,
    workspaceId: "foreign",
    status: "available",
    plugins: { status: "available", rows: [] },
    tools: { status: "available", rows: [] },
    hooks: { status: "not_reported", reason: "inventory_not_supported" },
  });
  assert.equal(
    (
      await f.service.handle({
        type: "configuration.extensions.read",
        workspaceId: f.ids.workspaceId,
      })
    ).ok,
    false,
  );
  const other = join(f.root, "untrusted");
  await mkdir(other);
  f.state.pick = other;
  const imported = await f.service.handle({ type: "workspace.import" });
  assert.equal(imported.ok, true);
  f.calls.length = 0;
  const result = await f.service.handle({
    type: "configuration.extensions.read",
    workspaceId: imported.value.selectedWorkspaceId,
  });
  assert.equal(result.ok, false);
  assert.equal(f.calls.length, 0);
});
test("typed-path import uses the picker's validation and publishes workspace meta", async (t) => {
  const f = await fixture(t);
  const dir = join(f.root, "typed");
  await mkdir(dir);
  f.state.pick = undefined; // picker must not be consulted
  assert.equal(
    (await f.service.handle({ type: "workspace.import", path: "relative" })).ok,
    false,
  );
  assert.equal(
    (
      await f.service.handle({
        type: "workspace.import",
        path: join(dir, "nope"),
      })
    ).ok,
    false,
  );
  const imported = await f.service.handle({
    type: "workspace.import",
    path: dir,
  });
  assert.equal(imported.ok, true);
  const w = imported.value.workspaces.find((x) => x.path.endsWith("typed"));
  assert.equal(w.branch, "main");
  assert.equal(w.writable, true);
  // Linked-worktree kind and origin repository are published read-only.
  assert.equal(w.kind, "worktree");
  assert.equal(w.origin, "/repo");
});
test("typed-path import rejects bad paths with one non-leaking code and imports resolved real paths once", async (t) => {
  const f = await fixture(t);
  f.state.pick = undefined;
  const dir = join(f.root, "real");
  await mkdir(dir);
  await writeFile(join(f.root, "file.txt"), "x");
  await symlink(dir, join(f.root, "alias"));
  await symlink(join(f.root, "file.txt"), join(f.root, "filelink"));
  await symlink(join(f.root, "gone"), join(f.root, "dangling"));
  const imp = (path) => f.service.handle({ type: "workspace.import", path });
  for (const [path, code] of [
    ["relative/dir", "INVALID_REQUEST"],
    ["./real", "INVALID_REQUEST"],
    ["~other/real", "INVALID_REQUEST"],
    [join(f.root, "nope"), "FILE_DENIED"],
    [join(f.root, "file.txt"), "FILE_DENIED"],
    [join(f.root, "filelink"), "FILE_DENIED"],
    [join(f.root, "dangling"), "FILE_DENIED"],
    [`${f.root}/real/../file.txt`, "FILE_DENIED"],
  ]) {
    const r = await imp(path);
    assert.equal(r.ok, false, path);
    assert.equal(r.code, code, path);
    assert.ok(!JSON.stringify(r).includes(f.root), "no path leaked");
  }
  await t.test("permission denied", async (st) => {
    if (process.getuid?.() === 0) return st.skip("root ignores modes");
    await mkdir(join(f.root, "locked", "inner"), { recursive: true });
    await chmod(join(f.root, "locked"), 0o000);
    // Subtest hook runs before the parent fixture's rm.
    st.after(() => chmod(join(f.root, "locked"), 0o700));
    const r = await imp(join(f.root, "locked", "inner"));
    assert.equal(r.code, "FILE_DENIED");
    assert.ok(!JSON.stringify(r).includes(f.root));
  });
  const first = await imp(`${f.root}/real/../real/`);
  assert.equal(first.ok, true, JSON.stringify(first));
  const real = await realpath(dir);
  assert.ok(first.value.workspaces.some((w) => w.path === real));
  const count = first.value.workspaces.length;
  const viaAlias = await imp(join(f.root, "alias"));
  assert.equal(viaAlias.ok, true);
  assert.equal(viaAlias.value.workspaces.length, count);
  assert.equal(
    viaAlias.value.selectedWorkspaceId,
    first.value.selectedWorkspaceId,
  );
  const prior = process.env.HOME;
  process.env.HOME = dir;
  t.after(() => {
    process.env.HOME = prior;
  });
  const home = await imp("~");
  assert.equal(home.ok, true, JSON.stringify(home));
  assert.equal(home.value.workspaces.length, count);
});
test("typed-path import needs native confirmation of the canonical path before registering", async (t) => {
  const f = await fixture(t);
  f.state.pick = undefined;
  const dir = join(f.root, "confirm-me");
  await mkdir(dir);
  await writeFile(join(dir, "note.txt"), "hello");
  await symlink(dir, join(f.root, "confirm-alias"));
  const imp = (path) => f.service.handle({ type: "workspace.import", path });
  const before = (await f.service.handle({ type: "snapshot" })).value.workspaces
    .length;
  f.state.importOk = false;
  const declined = await imp(join(f.root, "confirm-alias"));
  assert.equal(declined.ok, false);
  assert.equal(declined.code, "CANCELLED");
  assert.deepEqual(f.state.importPrompts, [await realpath(dir)]);
  const after = (await f.service.handle({ type: "snapshot" })).value;
  assert.equal(after.workspaces.length, before);
  assert.ok(!after.workspaces.some((w) => w.path.endsWith("confirm-me")));
  f.state.importOk = true;
  const ok = await imp(dir);
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(f.state.importPrompts.length, 2);
  assert.ok(
    ok.value.workspaces.some((w) => w.path === f.state.importPrompts[1]),
  );
});
test("extension read discards a pending observation after a workspace mutation", async (t) => {
  const f = await fixture(t);
  let release, started;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const entered = new Promise((resolve) => {
    started = resolve;
  });
  f.state.extensions = async (scope) => {
    started();
    await gate;
    return {
      ...scope,
      status: "available",
      plugins: { status: "available", rows: [] },
      tools: { status: "available", rows: [] },
      hooks: { status: "not_reported", reason: "inventory_not_supported" },
    };
  };
  const epoch = (await f.service.handle({ type: "snapshot" })).value
    .runtimeEpoch;
  const task = f.service.handle(
    {
      version: 2,
      runtimeEpoch: epoch,
      readId: "pending-extension",
      operation: {
        type: "configuration.extensions.read",
        workspaceId: f.ids.workspaceId,
      },
    },
    "extension-window",
  );
  await entered;
  const mutation = await f.service.handle(
    {
      version: 2,
      runtimeEpoch: epoch,
      operationId: "pin-during-observation",
      operation: {
        type: "session.pin",
        ...f.ids,
        requestId: "pin-during-observation",
        pinned: true,
      },
    },
    "extension-window",
  );
  assert.equal(mutation.ok, true, JSON.stringify(mutation));
  release();
  assert.equal((await task).ok, false);
});
test("cancelled extension read never publishes its late observation", async (t) => {
  const f = await fixture(t);
  let release, started;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const entered = new Promise((resolve) => {
    started = resolve;
  });
  f.state.extensions = async (scope) => {
    started();
    await gate;
    return {
      ...scope,
      status: "available",
      plugins: { status: "available", rows: [] },
      tools: { status: "available", rows: [] },
      hooks: { status: "not_reported", reason: "inventory_not_supported" },
    };
  };
  const snapshot = (await f.service.handle({ type: "snapshot" })).value;
  const task = f.service.handle(
    {
      version: 2,
      runtimeEpoch: snapshot.runtimeEpoch,
      readId: "cancel-extension",
      operation: {
        type: "configuration.extensions.read",
        workspaceId: f.ids.workspaceId,
      },
    },
    "extension-window",
  );
  await entered;
  f.service.cancelRead(
    {
      version: 2,
      runtimeEpoch: snapshot.runtimeEpoch,
      readId: "cancel-extension",
    },
    "extension-window",
  );
  assert.equal((await task).code, "CANCELLED");
  release();
  await new Promise((resolve) => setImmediate(resolve));
  const after = (await f.service.handle({ type: "snapshot" })).value;
  assert.equal(after.revision, snapshot.revision);
});
test("catalog adds inert provenance through the actual v2 read without a new config/effect call", async (t) => {
  const f = await fixture(t);
  const secret = "SYNTHETIC_CONFIG_SECRET_CANARY";
  await writeFile(
    join(f.workspace, "opencode.json"),
    JSON.stringify({ token: secret }),
  );
  let configReads = 0;
  f.client.config = {
    get() {
      configReads++;
      throw new Error("config.get must not run");
    },
  };
  const initial = await f.service.handle({ type: "snapshot" });
  const canonicalWorkspace = initial.value.workspaces.find(
    (w) => w.id === f.ids.workspaceId,
  ).path;
  f.client.skill.list = async () => ({
    data: [
      {
        id: "review",
        name: "Review",
        path: join(canonicalWorkspace, "SKILL.md"),
        content: secret,
        options: { token: secret },
      },
    ],
  });
  const before = f.calls.filter(({ name }) =>
    ["create", "prompt", "command", "update"].includes(name),
  ).length;
  const result = await f.service.handle(
    {
      version: 2,
      runtimeEpoch: initial.value.runtimeEpoch,
      readId: "configuration-read",
      operation: { type: "catalog.list", ...f.ids },
    },
    "configuration-test",
  );
  assert.equal(result.ok, true);
  assert.equal(configReads, 0);
  assert.equal(result.value.configuration.runtimeStatus, "not_reported");
  assert.equal(result.value.configuration.entries[0].state, "discovered");
  assert.equal(result.value.skills.entries[0].source, "runtime");
  assert.equal(result.value.skills.entries[0].scope, "workspace");
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(
    f.calls.filter(({ name }) =>
      ["create", "prompt", "command", "update"].includes(name),
    ).length,
    before,
  );
  assert.equal(
    await readFile(join(f.workspace, "opencode.json"), "utf8"),
    JSON.stringify({ token: secret }),
  );
});
test("explicit configuration file reads use real host IO through v2 without new SDK calls or original changes", async (t) => {
  const f = await fixture(t);
  const initial = await f.service.handle({ type: "snapshot" });
  const root = initial.value.workspaces.find(
    (w) => w.id === f.ids.workspaceId,
  ).path;
  await writeFile(
    join(root, "AGENTS.md"),
    "# Synthetic loaded file\nKeep the original.\n",
  );
  const secret = "SYNTHETIC-PRIVATE-CONFIG-CANARY";
  const raw = JSON.stringify({
    mcp: {
      servers: {
        private: {
          type: "local",
          command: ["node"],
          environment: { TOKEN: secret },
        },
      },
    },
  });
  await writeFile(join(root, "opencode.json"), raw);
  f.client.config = {
    get() {
      throw new Error("configuration SDK call forbidden");
    },
  };
  const before = f.calls.length;
  const read = (kind, readId) =>
    f.service.handle(
      {
        version: 2,
        runtimeEpoch: initial.value.runtimeEpoch,
        readId,
        operation: {
          type: "configuration.read",
          workspaceId: f.ids.workspaceId,
          kind,
        },
      },
      "configuration-file-sender",
    );
  const instructions = await read("instructions", "file-instructions");
  assert.equal(instructions.ok, true);
  assert.equal(instructions.value.status, "available");
  assert.equal(
    instructions.value.content,
    "# Synthetic loaded file\nKeep the original.\n",
  );
  assert.match(instructions.value.version, /^[a-f0-9]{64}$/);
  const blocked = await read("mcp", "file-private");
  assert.equal(blocked.ok, true);
  assert.equal(blocked.value.status, "unsupported");
  assert.equal(Object.hasOwn(blocked.value, "content"), false);
  assert.equal(Object.hasOwn(blocked.value, "version"), false);
  assert.doesNotMatch(
    JSON.stringify(blocked),
    /SYNTHETIC-PRIVATE-CONFIG-CANARY/,
  );
  assert.equal(f.calls.length, before);
  assert.equal(await readFile(join(root, "opencode.json"), "utf8"), raw);
  const ordinary = await f.service.handle({
    type: "file.read",
    workspaceId: f.ids.workspaceId,
    path: "opencode.json",
  });
  assert.equal(ordinary.code, "FILE_DENIED");
  const backupName = `.omoc-configuration-${"a".repeat(64)}.instructions.backup`;
  await writeFile(join(root, backupName), "SYNTHETIC-BACKUP-PRIVATE-CANARY");
  const backupRead = await f.service.handle({
    type: "file.read",
    workspaceId: f.ids.workspaceId,
    path: backupName,
  });
  assert.equal(backupRead.code, "FILE_DENIED");
  const listed = await f.service.handle({
    type: "file.list",
    workspaceId: f.ids.workspaceId,
  });
  assert.equal(listed.ok, true);
  assert.equal(
    listed.value.entries.some((entry) => entry.name === backupName),
    false,
  );
  assert.doesNotMatch(
    JSON.stringify([backupRead, listed]),
    /SYNTHETIC-BACKUP-PRIVATE-CANARY/,
  );
});
test("normal initial policy, real inbox receipt, transcript and duplicate fingerprint", async (t) => {
  const f = await fixture(t);
  const catalog = await f.service.handle({ type: "catalog.list", ...f.ids });
  assert.equal(catalog.ok, true);
  assert.equal(JSON.stringify(catalog).includes("never expose"), false);
  assert.equal(
    (
      await f.send({
        agent: "build",
        model: catalog.value.models.entries[0].id,
      })
    ).value.status,
    "accepted",
  );
  assert.equal(f.calls.find((x) => x.name === "prompt").args[0].text, "Hello");
  assert.equal(
    f.calls.find((x) => x.name === "prompt").args[0].agent,
    undefined,
  );
  assert.equal((await f.send()).code, "DUPLICATE_CONFLICT");
  assert.equal(
    (
      await f.send({
        agent: "build",
        model: catalog.value.models.entries[0].id,
      })
    ).value.status,
    "duplicate",
  );
  assert.equal(f.calls.filter((x) => x.name === "prompt").length, 1);
  f.state.messages = [
    { id: "u1", type: "user", text: "Hello", time: { created: 1 } },
    {
      id: "a1",
      type: "assistant",
      content: [
        { type: "text", text: "Partial" },
        {
          type: "tool",
          id: "tool1",
          name: "read",
          state: {
            status: "error",
            input: { path: "a" },
            error: { type: "Error", message: "secret" },
          },
          time: { created: 2 },
        },
      ],
      time: { created: 2 },
      agent: "build",
      model: { id: "model-a", providerID: "provider" },
    },
  ];
  f.state.messages.reverse();
  const snap = await f.service.handle({ type: "snapshot", ...f.ids });
  assert.equal(snap.value.messages[1].text, "Partial");
  assert.equal(
    snap.value.messages[1].tools[0].output,
    "A tool operation failed.",
  );
  assert.equal(snap.value.sessions[0].status, "running");
});
test("workspaceActivity reports sessions and fails closed when a session is not idle", async (t) => {
  const f = await fixture(t);
  const idle = f.service.workspaceActivity(f.ids.workspaceId);
  assert.equal(idle.sessions >= 1, true);
  assert.equal(idle.busy, false);
  const catalog = await f.service.handle({ type: "catalog.list", ...f.ids });
  assert.equal(
    (
      await f.send({
        agent: "build",
        model: catalog.value.models.entries[0].id,
      })
    ).value.status,
    "accepted",
  );
  await f.service.handle({ type: "snapshot", ...f.ids });
  assert.equal(f.service.workspaceActivity(f.ids.workspaceId).busy, true);
  assert.ok(f.service.workspaceInfo(f.ids.workspaceId).path);
  assert.equal(f.service.workspaceActivity("missing").busy, true);
});
test("untrusted import is deduplicated without SDK activation; native trust precedes creation", async (t) => {
  const f = await fixture(t);
  f.state.pick = join(f.root, "import");
  await mkdir(f.state.pick);
  await writeFile(
    join(f.state.pick, "AGENTS.md"),
    "Untrusted synthetic instructions; never execute",
  );
  const before = f.calls.length;
  const imported = await f.service.handle({ type: "workspace.import" });
  const workspaceId = imported.value.selectedWorkspaceId;
  assert.equal(f.calls.length, before);
  const catalog = await f.service.handle({ type: "catalog.list", workspaceId });
  assert.equal(catalog.value.models.status, "unavailable");
  assert.equal(catalog.value.configuration.reason, "untrusted_workspace");
  assert.equal(catalog.value.configuration.entries[0].state, "discovered");
  assert.equal(catalog.value.configuration.runtimeStatus, "not_reported");
  assert.equal(f.calls.length, before);
  const again = await f.service.handle({ type: "workspace.import" });
  assert.equal(again.value.workspaces.length, 2);
  f.state.trust = false;
  assert.equal(
    (await f.service.handle({ type: "session.create", workspaceId })).code,
    "CANCELLED",
  );
  assert.equal(f.calls.length, before);
  f.state.trust = true;
  const created = await f.service.handle({
    type: "session.create",
    workspaceId,
    title: "New",
  });
  assert.equal(created.ok, true);
  assert.equal(created.value.sessions.at(-1).workspaceId, workspaceId);
  assert.equal(
    (
      await f.service.handle({
        type: "snapshot",
        workspaceId,
        sessionId: f.ids.sessionId,
      })
    ).code,
    "NOT_FOUND",
  );
});
test("policy mismatch and read failure block sends; unavailable models skip provider execution", async (t) => {
  const f = await fixture(t);
  f.state.policyMismatch = true;
  assert.equal((await f.send()).code, "POLICY_UNVERIFIED");
  f.state.policyMismatch = false;
  f.state.policyReadFails = true;
  assert.equal((await f.send({ requestId: "r2" })).code, "POLICY_UNVERIFIED");
  f.state.policyReadFails = false;
  f.state.models = false;
  assert.equal((await f.send({ requestId: "r3" })).code, "AUTH_REQUIRED");
  assert.equal(
    f.calls.some((x) => x.name === "prompt"),
    false,
  );
});
test("atomic busy state, pending duplicate and unknown outcome never resend", async (t) => {
  const f = await fixture(t);
  let release;
  f.state.prompt = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const sending = f.send();
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await f.send()).value.status, "duplicate");
  assert.equal((await f.send({ requestId: "r2" })).code, "BUSY");
  assert.equal(
    (
      await f.service.handle({
        type: "workspace.remove",
        workspaceId: f.ids.workspaceId,
      })
    ).code,
    "BUSY",
  );
  release({ bad: "shape" });
  assert.equal((await sending).value.status, "unknown");
  assert.equal((await f.send()).value.status, "unknown");
  assert.equal(f.calls.filter((x) => x.name === "prompt").length, 1);
});
test("reject invalidates all pending permissions even if runtime list is stale", async (t) => {
  const f = await fixture(t);
  f.state.permissions = [
    { id: "p1", sessionID: "sdk-default", action: "read", resources: ["file"] },
    {
      id: "p2",
      sessionID: "sdk-default",
      action: "write",
      resources: ["file"],
    },
  ];
  const reply = (requestId, decision) =>
    f.service.handle({
      type: "permission.respond",
      ...f.ids,
      requestId,
      decision,
    });
  assert.equal((await reply("p1", "reject")).value.status, "decided");
  assert.equal((await reply("p2", "once")).code, "STALE_PERMISSION");
  assert.equal(f.calls.filter((x) => x.name === "reply").length, 1);
});
const permissionHelpers = (f) => {
  const ask = (id, action, save, sessionID = "sdk-default") => ({
    id,
    sessionID,
    action,
    resources: ["src/a.txt"],
    ...(save && { save }),
  });
  const reply = (requestId, decision, ids = f.ids) =>
    f.service.handle({
      type: "permission.respond",
      ...ids,
      requestId,
      decision,
    });
  const shown = async (ids = f.ids) =>
    (await f.service.handle({ type: "snapshot", ...ids })).value.permissions;
  const replies = () => f.calls.filter((x) => x.name === "reply");
  // Main answers on its own after the snapshot; wait for it to settle.
  const settle = async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5));
  };
  return { ask, reply, shown, replies, settle };
};
test("always is session-scoped: refused in main for external_directory/read/pattern-less, never forwarded to Native", async (t) => {
  const f = await fixture(t);
  const { ask, reply, shown, replies } = permissionHelpers(f);
  f.state.permissions = [
    ask("x1", "external_directory", ["/etc/*"]),
    ask("n1", "edit"),
    ask("n2", "edit", [""]),
    ask("n3", "edit", ["", "src/*"]),
    ask("r1", "read", ["*"]),
  ];
  for (const id of ["x1", "n1", "n2", "n3", "r1"])
    assert.equal((await reply(id, "always")).code, "INVALID_REQUEST");
  assert.equal(replies().length, 0);
  assert.equal(
    (await shown()).some((p) => "sessionAllow" in p),
    false,
  );
  f.state.permissions = [ask("e1", "edit", ["src/*", "lib/*"])];
  assert.deepEqual((await shown())[0].sessionAllow, ["src/*", "lib/*"]);
  assert.equal((await reply("e1", "always")).value.status, "decided");
  assert.equal(replies().length, 1);
  assert.equal(replies()[0].args[0].decision, "once");
});
test("main auto-answers matching requests once, also for a non-selected session; others stay manual", async (t) => {
  const f = await fixture(t);
  const { ask, reply, shown, replies, settle } = permissionHelpers(f);
  f.state.permissions = [ask("e1", "edit", ["src/*"])];
  assert.equal((await reply("e1", "always")).value.status, "decided");
  f.state.permissions = [
    ask("e2", "edit", ["src/*"]),
    ask("e3", "bash", ["src/*"]),
    ask("e4", "edit", ["lib/*"]),
    ask("x1", "external_directory", ["src/*"]),
    ask("r1", "read", ["src/*"]),
  ];
  const first = await shown();
  assert.equal(first.length, 5);
  await settle();
  assert.deepEqual(
    replies()
      .slice(1)
      .map((c) => [c.args[0].requestID, c.args[0].decision]),
    [["e2", "once"]],
  );
  // Repeated refreshes do not re-answer the same (now handled) request.
  await shown();
  await settle();
  assert.equal(replies().length, 2);
  // Another session becomes the selected one; the grant holder is refreshed
  // in the background and its next matching request is still answered by main.
  const other = (
    await f.service.handle({
      type: "session.create",
      workspaceId: f.ids.workspaceId,
      title: "New",
    })
  ).value;
  const otherIds = {
    workspaceId: f.ids.workspaceId,
    sessionId: other.selectedSessionId,
  };
  f.state.permissions = [ask("e5", "edit", ["src/*"])];
  await shown(otherIds);
  await settle();
  assert.equal(replies().length, 3);
  assert.equal(replies()[2].args[0].requestID, "e5");
});
test("a subagent grant never covers the parent or a sibling, and vice versa", async (t) => {
  const f = await fixture(t);
  const { ask, reply, shown, replies, settle } = permissionHelpers(f);
  f.state.sessionList = [
    ...f.infos.values(),
    { id: "child-1", parentID: "sdk-default", title: "A" },
    { id: "child-2", parentID: "sdk-default", title: "B" },
  ];
  f.state.permissions = [ask("c1", "edit", ["src/*"], "child-1")];
  assert.equal((await reply("c1", "always")).value.status, "decided");
  assert.equal(replies()[0].args[0].sessionID, "child-1");
  f.state.permissions = [
    ask("p1", "edit", ["src/*"]),
    ask("c2", "edit", ["src/*"], "child-2"),
    ask("c3", "edit", ["src/*"], "child-1"),
  ];
  await shown();
  await settle();
  assert.deepEqual(
    replies()
      .slice(1)
      .map((c) => c.args[0].requestID),
    ["c3"],
  );
  // A parent grant does not cover its children.
  f.state.permissions = [ask("p2", "edit", ["lib/*"])];
  await reply("p2", "always");
  f.state.permissions = [
    ask("p3", "edit", ["lib/*"], "child-1"),
    ask("p4", "edit", ["lib/*"]),
  ];
  await shown();
  await settle();
  assert.deepEqual(
    replies()
      .slice(3)
      .map((c) => c.args[0].requestID),
    ["p4"],
  );
});
test("archiving a session ends its always grants", async (t) => {
  const f = await fixture(t);
  const { ask, reply, shown, replies, settle } = permissionHelpers(f);
  f.state.permissions = [ask("e1", "edit", ["src/*"])];
  await reply("e1", "always");
  const archive = (archived) =>
    f.service.handle({
      type: "session.archive",
      ...f.ids,
      requestId: `arch-${archived}`,
      archived,
    });
  assert.equal((await archive(true)).ok, true);
  assert.equal((await archive(false)).ok, true);
  f.state.permissions = [ask("e2", "edit", ["src/*"])];
  await shown();
  await settle();
  assert.equal(replies().length, 1);
  assert.deepEqual(
    (await shown()).map((p) => p.id),
    ["e2"],
  );
});
test("a grant cleared between observe and reply never reaches Native", async (t) => {
  const f = await fixture(t);
  const { ask, reply, replies, settle } = permissionHelpers(f);
  const snapshot = () =>
    f.service.handle({ type: "snapshot", ...f.ids }).catch(() => {});
  f.state.permissions = [ask("e1", "edit", ["src/*"])];
  await reply("e1", "always");
  f.state.permissions = [ask("e2", "edit", ["src/*"])];
  // The read is discarded (a mutation lands mid-read): nothing is scheduled.
  const pending = snapshot();
  await f.service.handle({
    type: "session.archive",
    ...f.ids,
    requestId: "arch",
    archived: true,
  });
  await pending;
  await settle();
  assert.equal(replies().length, 1);
  // The internal sender is only honored while the grant stands (checked under
  // the lock); without it Native is never replied to.
  const internal = (requestId) =>
    f.service.handle(
      {
        version: 2,
        runtimeEpoch: f.epoch,
        operationId: `op-${requestId}`,
        operation: {
          type: "permission.respond",
          ...f.ids,
          requestId,
          decision: "once",
        },
      },
      "main:auto-allow",
    );
  assert.equal((await internal("e2")).code, "STALE_PERMISSION");
  assert.equal(replies().length, 1);
});
test("auto-answer skips while a user mutation is active and gives up after bounded failures", async (t) => {
  const f = await fixture(t);
  const { ask, reply, shown, replies, settle } = permissionHelpers(f);
  const other = (
    await f.service.handle({
      type: "session.create",
      workspaceId: f.ids.workspaceId,
      title: "New",
    })
  ).value;
  const otherIds = {
    workspaceId: f.ids.workspaceId,
    sessionId: other.selectedSessionId,
  };
  f.state.permissions = [ask("e1", "edit", ["src/*"], "sdk-1")];
  await reply("e1", "always", otherIds);
  f.state.permissions = [ask("e2", "edit", ["src/*"], "sdk-1")];
  let release;
  f.state.prompt = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const sending = f.send();
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  await shown(otherIds);
  await settle();
  assert.equal(replies().length, 1);
  release({ id: "i", sessionID: "sdk-default", type: "user", time: {} });
  await sending;
  f.state.prompt = undefined;
  // A permanent failure (the request is gone when main replies) is attempted
  // once, never retried on later snapshots.
  const live = f.client.permission.list;
  let listCalls = 0;
  let stale = 0;
  f.client.permission.list = async () => {
    if (listCalls++ === 0) return [ask("e3", "edit", ["src/*"], "sdk-1")];
    stale++;
    return [];
  };
  for (let i = 0; i < 5; i++) {
    listCalls = 0;
    await shown(otherIds);
    await settle();
  }
  assert.equal(stale, 1);
  assert.equal(replies().length, 1);
  f.client.permission.list = live;
});
test("background light check answers a non-selected grant holder and skips archived ones", async (t) => {
  const f = await fixture(t);
  const { ask, reply, replies, settle } = permissionHelpers(f);
  f.state.permissions = [ask("e1", "edit", ["src/*"])];
  await reply("e1", "always");
  const other = (
    await f.service.handle({
      type: "session.create",
      workspaceId: f.ids.workspaceId,
      title: "New",
    })
  ).value;
  const otherIds = {
    workspaceId: f.ids.workspaceId,
    sessionId: other.selectedSessionId,
  };
  const reads = () => f.calls.filter((x) => x.name === "messages").length;
  f.state.permissions = [ask("e2", "edit", ["src/*"])];
  const before = reads();
  await f.service.handle({ type: "snapshot", ...otherIds });
  await settle();
  assert.equal(reads() - before, 1);
  assert.deepEqual(
    replies()
      .slice(1)
      .map((c) => c.args[0].requestID),
    ["e2"],
  );
  await f.service.handle({
    type: "session.archive",
    ...f.ids,
    requestId: "arch",
    archived: true,
  });
  f.state.permissions = [ask("e3", "edit", ["src/*"])];
  await f.service.handle({ type: "snapshot", ...otherIds });
  await settle();
  assert.equal(replies().length, 2);
});
test("owned filesystem preview denies traversal, symlinks, sensitive, binary and oversize files", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.workspace, "a.txt"), "hello");
  await writeFile(
    join(f.workspace, "view.html"),
    "<script>never executed</script>",
  );
  await writeFile(join(f.workspace, ".env"), "secret");
  await writeFile(join(f.workspace, "binary"), Buffer.from([0, 1]));
  await writeFile(join(f.workspace, "large"), Buffer.alloc(MAX_FILE_BYTES + 1));
  await symlink(f.root, join(f.workspace, "escape"));
  const read = (path) =>
    f.service.handle({
      type: "file.read",
      workspaceId: f.ids.workspaceId,
      path,
    });
  assert.equal((await read("a.txt")).value.content, "hello");
  assert.match((await read("view.html")).value.content, /<script>/);
  for (const path of [
    "../outside",
    "escape/workspace/a.txt",
    ".env",
    "binary",
    "large",
  ])
    assert.equal((await read(path)).ok, false, path);
  const listing = await f.service.handle({
    type: "file.list",
    workspaceId: f.ids.workspaceId,
  });
  assert.equal(
    listing.value.entries.some((x) => [".env", "escape"].includes(x.name)),
    false,
  );
});
test("command.run and session.interrupt receipts confirm on Native success and go unknown on error", async (t) => {
  const f = await fixture(t);
  const run = async (operation, id) => {
    const snap = await f.service.handle(
      {
        version: 2,
        runtimeEpoch: f.epoch,
        readId: `r-${id}`,
        operation: { type: "snapshot", ...f.ids },
      },
      "receipt-sender",
    );
    return f.service.handle(
      {
        version: 2,
        runtimeEpoch: f.epoch,
        operationId: id,
        expectedRevision: snap.value.revision,
        operation,
      },
      "receipt-sender",
    );
  };
  const ok = await run(
    {
      type: "command.run",
      ...f.ids,
      requestId: "c-ok",
      name: "review",
      arguments: "x",
    },
    "c-ok",
  );
  assert.equal(ok.receipt?.effect, "confirmed");
  const stop = await run({ type: "session.interrupt", ...f.ids }, "i-ok");
  assert.equal(stop.receipt?.effect, "confirmed");
  f.state.active = {};
  f.state.inbox = [];
  f.client.session.interrupt = async () => {
    throw new Error("boom");
  };
  const bad = await run({ type: "session.interrupt", ...f.ids }, "i-bad");
  assert.equal(bad.receipt?.effect, "unknown");
});
test("send waits briefly for a just-finished reply to leave active before BUSY", async (t) => {
  const f = await fixture(t);
  f.state.active = { "sdk-default": { type: "running" } };
  setTimeout(() => {
    f.state.active = {};
  }, 300);
  assert.equal(
    (await f.send({ requestId: "late-idle" })).value.status,
    "accepted",
  );
});
test("catalog keeps local models when a large cloud catalog exceeds the cap", async (t) => {
  const f = await fixture(t);
  const cloud = Array.from({ length: 400 }, (_, i) => ({
    id: `c${i}`,
    providerID: "provider",
    name: `Cloud ${i}`,
    enabled: true,
    status: "active",
  }));
  f.client.model.list = async () => ({
    data: [
      ...cloud,
      {
        id: "local-1",
        providerID: "lmstudio",
        name: "Local",
        enabled: true,
        status: "active",
      },
    ],
  });
  const original = f.client.provider.list;
  f.client.provider.list = async (...a) => ({
    data: [
      ...(await original(...a)).data,
      { id: "lmstudio", activation: "enabled" },
    ],
  });
  const entries = (await f.service.handle({ type: "catalog.list", ...f.ids }))
    .value.models.entries;
  assert.equal(entries.length, 300);
  assert.equal(entries[0].name, "Local");
});
test("catalog pins requested models beyond the display cap", async (t) => {
  const f = await fixture(t);
  f.client.model.list = async () => ({
    data: Array.from({ length: 400 }, (_, i) => ({
      id: `c${i}`,
      providerID: "provider",
      name: `Cloud ${i}`,
      enabled: true,
      status: "active",
    })),
  });
  const all = (await f.service.handle({ type: "catalog.list", ...f.ids })).value
    .models.entries;
  assert.equal(all.length, 300);
  const pinned = (
    await f.service.handle({
      type: "catalog.list",
      ...f.ids,
      pinModels: [
        createHash("sha256")
          .update(JSON.stringify(["provider", "c399"]))
          .digest("hex"),
      ],
    })
  ).value.models.entries;
  assert.equal(pinned.length, 301);
  assert.equal(pinned.at(-1).name, "Cloud 399");
});
test("only the synthetic reminder from our own agent switch is ignored", async (t) => {
  const f = await fixture(t);
  const agents = await f.service.handle({ type: "catalog.list", ...f.ids });
  const agent = agents.value.agents.entries[0]?.id;
  assert.ok(agent);
  f.client.session.switchAgent = async ({ sessionID }) => {
    f.state.inbox = [
      {
        id: "syn",
        sessionID,
        type: "synthetic",
        time: { created: Date.now() },
        payload: {},
      },
    ];
  };
  assert.equal(
    (await f.send({ requestId: "syn-send", agent })).value.status,
    "accepted",
  );
});
test("a pre-existing synthetic inbox item is a pending run", async (t) => {
  const f = await fixture(t);
  f.state.inbox = [
    {
      id: "syn",
      sessionID: "sdk-default",
      type: "synthetic",
      time: { created: Date.now() },
      payload: {},
    },
  ];
  assert.equal((await f.send({ requestId: "syn-pending" })).code, "BUSY");
});
test("native cancellation, exclusive folder create, UUIDv7 fallback and registration-only removal", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await f.service.handle({ type: "workspace.import" })).code,
    "CANCELLED",
  );
  f.state.pick = f.root;
  assert.equal(
    (await f.service.handle({ type: "workspace.create", name: "../escape" }))
      .code,
    "INVALID_REQUEST",
  );
  const result = await f.service.handle({
    type: "workspace.create",
    name: "ordinary",
  });
  assert.equal(result.ok, true);
  const id = result.value.selectedWorkspaceId;
  assert.equal(
    (await f.service.handle({ type: "workspace.remove", workspaceId: id })).ok,
    true,
  );
  assert.equal((await stat(join(f.root, "ordinary"))).isDirectory(), true);
  assert.match(
    defaultFolderName(new Date(2026, 8, 29)),
    /^2026-09-29-[\da-f]{8}-[\da-f]{4}-7[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/,
  );
});
test("wrong IDs and unknown command never reach execution; listed command uses text API", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.send({ sessionId: "unknown" })).code, "NOT_FOUND");
  assert.equal((await f.send({ agent: "missing" })).code, "INVALID_SELECTION");
  assert.equal(
    (
      await f.service.handle({
        type: "command.run",
        ...f.ids,
        requestId: "c1",
        name: "missing",
        arguments: "x",
      })
    ).code,
    "INVALID_SELECTION",
  );
  assert.equal(
    (
      await f.service.handle({
        type: "command.run",
        ...f.ids,
        requestId: "c2",
        name: "review",
        arguments: "scope",
      })
    ).value.status,
    "accepted",
  );
  assert.deepEqual(f.calls.find((c) => c.name === "command").args[0], {
    sessionID: "sdk-default",
    name: "review",
    text: "scope",
  });
  assert.equal(
    (await f.service.handle({ type: "session.interrupt", ...f.ids })).value
      .status,
    "stopping",
  );
  f.state.inbox = [];
  f.state.active = {};
  const original = f.client.session.get;
  f.client.session.get = async (...args) => ({
    ...(await original(...args)),
    time: { created: 1, updated: Date.now(), idle: Date.now() + 1 },
    outcome: "interrupted",
  });
  assert.equal(
    (await f.service.handle({ type: "snapshot", ...f.ids })).value.sessions[0]
      .status,
    "idle",
  );
});
test("transport rejection and service cancellation retain unknown execution receipts", async (t) => {
  const f = await fixture(t);
  f.state.prompt = () => {
    throw new Error("authorization: secret");
  };
  assert.equal((await f.send()).value.status, "unknown");
  assert.equal((await f.send()).value.status, "unknown");
  assert.equal((await f.send({ requestId: "r2" })).code, "BUSY");
  const g = await fixture(t);
  let entered;
  g.state.prompt = () => {
    entered = true;
    return new Promise(() => {});
  };
  const sending = g.send();
  while (!entered) await new Promise((resolve) => setImmediate(resolve));
  g.service.close();
  assert.equal((await sending).value.status, "unknown");
  assert.equal(g.calls.filter((c) => c.name === "prompt").length, 1);
});
test("snapshot reads coalesce and provider auth errors are fixed safe messages", async (t) => {
  const f = await fixture(t);
  f.state.messages = [
    {
      id: "a",
      type: "assistant",
      content: [],
      time: { created: 1 },
      error: {
        type: "ProviderAuthError",
        status: 401,
        message: "private URL and key",
      },
    },
  ];
  const before = f.calls.filter((c) => c.name === "messages").length;
  const snapshots = await Promise.all(
    Array.from({ length: 8 }, () =>
      f.service.handle({ type: "snapshot", ...f.ids }),
    ),
  );
  assert.equal(f.calls.filter((c) => c.name === "messages").length - before, 1);
  assert.equal(snapshots[0].value.error.code, "AUTH_REQUIRED");
  assert.equal(JSON.stringify(snapshots).includes("private URL"), false);
});
test("request timeout is bounded and a timed-out prompt is never replayed", async (t) => {
  const f = await fixture(t);
  f.state.prompt = () => new Promise(() => {});
  // Keep this synthetic test alive: AbortSignal.timeout does not keep Node alive.
  const keepAlive = setTimeout(() => {}, 6500);
  t.after(() => clearTimeout(keepAlive));
  const started = Date.now();
  assert.equal((await f.send()).value.status, "unknown");
  assert.ok(Date.now() - started < 6200);
  assert.equal((await f.send()).value.status, "unknown");
  assert.equal(f.calls.filter((c) => c.name === "prompt").length, 1);
});
test("selection-triggered policy drift is blocked immediately before dispatch", async (t) => {
  const f = await fixture(t);
  f.client.session.switchAgent = async () => {
    f.state.policyMismatch = true;
  };
  assert.equal((await f.send({ agent: "build" })).code, "POLICY_UNVERIFIED");
  assert.equal(
    f.calls.some((c) => c.name === "prompt"),
    false,
  );
});
test("available empty inventories differ from unavailable inventories", async (t) => {
  const f = await fixture(t);
  f.client.skill.list = async () => {
    throw new Error("private config");
  };
  const result = await f.service.handle({ type: "catalog.list", ...f.ids });
  assert.equal(result.value.skills.status, "unavailable");
  assert.equal(result.value.mcp.status, "available");
  assert.deepEqual(result.value.mcp.entries, []);
  assert.equal(JSON.stringify(result).includes("private config"), false);
});

test("preserves runtime model resolution when the user leaves the default selected", async (t) => {
  for (const currentModel of [
    undefined,
    { id: "model-a", providerID: "provider", variant: "runtime-variant" },
    { id: "different-default", providerID: "other-provider" },
  ]) {
    await t.test(currentModel?.id ?? "runtime-resolved", async (subtest) => {
      const f = await fixture(subtest);
      const get = f.client.session.get;
      f.client.session.get = async (...args) => ({
        ...(await get(...args)),
        model: currentModel,
      });
      const result = await f.send({ agent: "build" });
      assert.equal(result.value.status, "accepted");
      assert.equal(
        f.calls.filter((call) => call.name === "switchModel").length,
        0,
      );
      assert.equal(
        f.calls.filter((call) => call.name === "switchAgent").length,
        1,
      );
      assert.deepEqual(f.calls.find((call) => call.name === "prompt").args[0], {
        sessionID: "sdk-default",
        text: "Hello",
      });
    });
  }
});

test("explicit model selection uses the catalog mapping and is rechecked before send", async (t) => {
  const f = await fixture(t);
  const catalog = await f.service.handle({ type: "catalog.list", ...f.ids });
  const result = await f.send({ model: catalog.value.models.entries[0].id });
  assert.equal(result.value.status, "accepted");
  const switchAt = f.calls.findIndex((call) => call.name === "switchModel");
  const promptAt = f.calls.findIndex((call) => call.name === "prompt");
  assert.deepEqual(f.calls[switchAt].args[0], {
    sessionID: "sdk-default",
    model: { id: "model-a", providerID: "provider" },
  });
  assert.ok(
    f.calls
      .slice(switchAt + 1, promptAt)
      .some((call) => call.name === "update"),
  );
  assert.ok(
    f.calls.slice(switchAt + 1, promptAt).some((call) => call.name === "get"),
  );
});

test("Git read refuses legacy memory-only workspace authority before process work", async (t) => {
  const f = await fixture(t);
  f.calls.length = 0;
  const result = await f.service.handle({
    type: "git.review.read",
    workspaceId: f.ids.workspaceId,
  });
  assert.equal(result.code, "UNAVAILABLE");
  assert.equal(f.calls.length, 0);
});

test("runtime options model variants are closed public IDs and selected before native model switch", async (t) => {
  const f = await fixture(t);
  f.state.modelOptions = {
    variants: [
      {
        id: "custom/effort#x",
        body: { secret: "private-overlay" },
        headers: { secret: "private-overlay" },
      },
    ],
    capabilities: {
      tools: true,
      input: ["text", "unknown-mode"],
      output: ["text"],
    },
  };
  const catalog = await f.service.handle({ type: "catalog.list", ...f.ids });
  assert.equal(catalog.ok, true);
  const model = catalog.value.models.entries[0];
  assert.deepEqual(model.variants, {
    status: "available",
    ids: ["custom/effort#x"],
  });
  assert.equal(JSON.stringify(catalog).includes("private-overlay"), false);
  const sent = await f.send({ model: model.id, variant: "custom/effort#x" });
  assert.equal(sent.ok, true);
  assert.deepEqual(
    f.calls.find((c) => c.name === "switchModel").args[0].model,
    { id: "model-a", providerID: "provider", variant: "custom/effort#x" },
  );
  const names = f.calls.map((c) => c.name);
  const selection = names.indexOf("switchModel");
  assert.ok(names.slice(0, selection).includes("update"));
  assert.ok(
    names.slice(selection + 1, names.indexOf("prompt")).includes("update"),
  );
});
test("credential stays required for free models; Zen (opencode) free models are excluded, paid Zen stays usable", async (t) => {
  const free = {
    cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }],
  };
  const paid = { cost: [{ input: 1, output: 2 }] };
  const list = async (f) =>
    (await f.service.handle({ type: "catalog.list", ...f.ids })).value.models
      .entries;
  // No credential: free or not, nothing is usable and sending is refused.
  let f = await fixture(t);
  f.state.noCredential = true;
  f.state.modelOptions = free;
  assert.deepEqual(await list(f), []);
  assert.equal((await f.send()).code, "AUTH_REQUIRED");
  // Credentialed free model of another provider (e.g. OpenRouter :free).
  f = await fixture(t);
  f.state.modelOptions = free;
  let entries = await list(f);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].free, true);
  assert.equal((await f.send({ model: entries[0].id })).ok, true);
  // Paid models carry no free marker.
  f = await fixture(t);
  f.state.modelOptions = paid;
  assert.equal("free" in (await list(f))[0], false);
  // Zen: free excluded even with a credential, paid kept.
  f = await fixture(t);
  f.state.providerID = "opencode";
  f.state.modelOptions = free;
  assert.deepEqual(await list(f), []);
  f = await fixture(t);
  f.state.providerID = "opencode";
  f.state.modelOptions = paid;
  assert.equal((await list(f)).length, 1);
});
test("catalog entries carry the provider, OpenRouter :free ids are free and its free router leads", async (t) => {
  const f = await fixture(t);
  f.state.providerID = "openrouter";
  f.state.extraModels = [
    {
      id: "vendor/x:free",
      providerID: "openrouter",
      name: "X free",
      enabled: true,
      status: "active",
    },
    {
      id: "openrouter/free",
      providerID: "openrouter",
      name: "Free Models Router",
      enabled: true,
      status: "active",
    },
  ];
  const entries = (await f.service.handle({ type: "catalog.list", ...f.ids }))
    .value.models.entries;
  assert.deepEqual(
    entries.map((e) => [e.name, e.free === true, e.providerId]),
    [
      ["Free Models Router", true, "openrouter"],
      ["X free", true, "openrouter"],
      ["Model", false, "openrouter"],
    ],
  );
  assert.equal(typeof entries[0].provider, "string");
});
test("free models survive the 300-entry catalog cap", async (t) => {
  const f = await fixture(t);
  f.state.extraModels = [
    ...Array.from({ length: 310 }, (_, i) => ({
      id: `paid-${i}`,
      providerID: "provider",
      name: `Paid ${i}`,
      enabled: true,
      status: "active",
      cost: [{ input: 1, output: 1 }],
    })),
    {
      id: "last-free",
      providerID: "provider",
      name: "Last free",
      enabled: true,
      status: "active",
      cost: [{ input: 0, output: 0 }],
    },
  ];
  const entries = (await f.service.handle({ type: "catalog.list", ...f.ids }))
    .value.models.entries;
  assert.equal(entries.length, 300);
  assert.ok(entries.some((e) => e.name === "Last free"));
});
test("runtime options removed or malformed variants cannot switch or prompt", async (t) => {
  for (const variants of [
    [],
    [{ id: "duplicate" }, { id: "duplicate" }],
    undefined,
  ]) {
    const f = await fixture(t);
    f.state.modelOptions = { variants };
    const catalog = await f.service.handle({ type: "catalog.list", ...f.ids });
    const sent = await f.send({
      model: catalog.value.models.entries[0].id,
      variant: "duplicate",
    });
    assert.equal(sent.ok, false);
    assert.equal(sent.code, "INVALID_SELECTION");
    assert.equal(
      f.calls.some((c) => ["switchModel", "prompt"].includes(c.name)),
      false,
    );
  }
});
test("runtime options native session setting and assistant response reports differ and clear after failed refresh", async (t) => {
  const f = await fixture(t);
  const info = f.infos.get("sdk-default");
  info.agent = "session-agent";
  info.model = {
    id: "session-model",
    providerID: "session-provider",
    variant: "session-variant",
    headers: { secret: "private-setting" },
  };
  f.state.messages = [
    {
      id: "response",
      sessionID: "sdk-default",
      type: "assistant",
      agent: "response-agent",
      model: {
        providerID: "historical",
        id: "response-model",
        variant: "response-variant",
      },
      content: [],
    },
  ];
  const read = () => f.service.handle({ type: "snapshot", ...f.ids });
  const observed = await read();
  assert.equal(observed.ok, true);
  assert.deepEqual(observed.value.sessionSelection, {
    sessionId: f.ids.sessionId,
    agent: "session-agent",
    model: {
      id: "session-model",
      providerId: "session-provider",
      variant: "session-variant",
    },
  });
  assert.equal(observed.value.messages[0].runtime.agent, "response-agent");
  assert.equal(JSON.stringify(observed).includes("private-setting"), false);
  f.state.policyReadFails = true;
  assert.equal((await read()).value.sessionSelection, undefined);
  f.state.policyReadFails = false;
  delete info.agent;
  delete info.model;
  assert.equal((await read()).value.sessionSelection, undefined);
});

test("runtime options ambiguous duplicate model identities do not authorize selection", async (t) => {
  const f = await fixture(t);
  f.client.model.list = async () => ({
    data: [
      {
        id: "duplicate",
        providerID: "provider",
        name: "First",
        enabled: true,
        variants: [{ id: "first" }],
      },
      {
        id: "duplicate",
        providerID: "provider",
        name: "Second",
        enabled: true,
        variants: [{ id: "second" }],
      },
    ],
  });
  const catalog = await f.service.handle({ type: "catalog.list", ...f.ids });
  assert.equal(catalog.ok, true);
  assert.deepEqual(catalog.value.models.entries, []);
});

test("runtime options omitted variant does not assert a Native reset", async (t) => {
  const f = await fixture(t);
  f.infos.get("sdk-default").model = {
    providerID: "provider",
    id: "model-a",
    variant: "prior-session-setting",
  };
  const catalog = await f.service.handle({ type: "catalog.list", ...f.ids });
  assert.equal(catalog.value.models.entries[0].variants.status, "unavailable");
  assert.equal(
    (await f.send({ model: catalog.value.models.entries[0].id })).ok,
    true,
  );
  assert.equal(
    Object.hasOwn(
      f.calls.find((c) => c.name === "switchModel").args[0].model,
      "variant",
    ),
    false,
  );
  const snapshot = await f.service.handle({ type: "snapshot", ...f.ids });
  assert.equal(
    snapshot.value.sessionSelection.model.variant,
    "prior-session-setting",
  );
});
test("runtime options uncertain model switch is never repeated under same original request", async (t) => {
  const f = await fixture(t);
  f.state.modelOptions = { variants: [{ id: "custom" }, { id: "different" }] };
  const catalog = await f.service.handle({ type: "catalog.list", ...f.ids });
  let attempts = 0;
  f.client.session.switchModel = async () => {
    attempts++;
    throw new Error("synthetic uncertain switch");
  };
  const request = {
    model: catalog.value.models.entries[0].id,
    variant: "custom",
  };
  const first = await f.send(request);
  assert.equal(first.ok, false);
  assert.equal((await f.send(request)).ok, false);
  assert.equal(
    (await f.send({ ...request, variant: "different" })).code,
    "DUPLICATE_CONFLICT",
  );
  assert.equal(attempts, 1);
  assert.equal(
    f.calls.some((c) => c.name === "prompt"),
    false,
  );
  const snapshot = await f.service.handle({ type: "snapshot", ...f.ids });
  assert.equal(
    snapshot.value.sessions.find((s) => s.id === f.ids.sessionId).status,
    "unknown",
  );
});

test("context explicit current-run queue keeps both policies and omits next-send switches", async (t) => {
  const f = await fixture(t);
  f.state.active = { "sdk-default": { type: "running" } };
  await f.service.handle({ type: "snapshot", ...f.ids });
  const start = f.calls.length;
  const result = await f.send({ delivery: "queue" });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.value.status, "accepted");
  const calls = f.calls.slice(start);
  assert.equal(calls.filter((c) => c.name === "update").length, 2);
  assert.equal(
    calls.some((c) => ["switchModel", "switchAgent"].includes(c.name)),
    false,
  );
  assert.deepEqual(calls.find((c) => c.name === "prompt").args[0], {
    sessionID: "sdk-default",
    text: "Hello",
    delivery: "queue",
  });
});
test("context explicit inbox exports bounded request preview and cancellation ACK stays request-only", async (t) => {
  const f = await fixture(t);
  f.state.inbox = [
    {
      id: "pending1",
      sessionID: "sdk-default",
      type: "user",
      delivery: "queue",
      payload: {
        text: "queued",
        files: [
          { data: "SECRET", source: { type: "file", path: "/private/a" } },
        ],
      },
    },
  ];
  const observed = await f.service.handle({ type: "session.inbox", ...f.ids });
  assert.equal(observed.ok, true);
  assert.equal(observed.value.entries[0].textPreview, "queued");
  assert.equal(JSON.stringify(observed).includes("SECRET"), false);
  const cancelled = [];
  f.client.session.inbox.cancel = async (args) => {
    cancelled.push(args);
  };
  const result = await f.service.handle({
    type: "session.inbox.cancel",
    ...f.ids,
    requestId: "cancel1",
    inboxId: "pending1",
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.status, "accepted");
  assert.deepEqual(cancelled, [
    { sessionID: "sdk-default", inboxID: "pending1" },
  ]);
  assert.equal(f.state.inbox.length, 1); // ACK cannot prove absence or nonexecution.
});
test("context before-user branch validates Native boundary and never prompts or restores files", async (t) => {
  const f = await fixture(t);
  const baseline = "current workspace stays";
  await writeFile(join(f.workspace, "current.txt"), baseline);
  f.client.session.message = {
    get: async () => ({
      id: "user-before",
      sessionID: "sdk-default",
      type: "user",
      text: "original",
    }),
  };
  const forks = [];
  const forkInfo = {
    ...f.infos.get("sdk-default"),
    id: "sdk-fork",
    parentID: "sdk-default",
    fork: {
      sessionID: "sdk-default",
      boundary: { type: "before", messageID: "user-before" },
    },
  };
  f.client.session.fork = async (args) => {
    forks.push(args);
    f.infos.set("sdk-fork", forkInfo);
    return forkInfo;
  };
  const start = f.calls.length;
  const result = await f.service.handle({
    type: "session.fork",
    ...f.ids,
    requestId: "branch1",
    before: "user-before",
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(forks, [
    { sessionID: "sdk-default", before: "user-before" },
  ]);
  assert.equal(
    f.calls.slice(start).some((c) => c.name === "prompt"),
    false,
  );
  assert.equal(
    await readFile(join(f.workspace, "current.txt"), "utf8"),
    baseline,
  );
});
test("context before-user branch accepts Native's real message.get and fork shapes (no sessionID, no parentID)", async (t) => {
  const f = await fixture(t);
  f.client.session.message = {
    get: async () => ({ id: "user-before", type: "user", text: "original" }),
  };
  const forkInfo = {
    ...f.infos.get("sdk-default"),
    id: "sdk-fork",
    fork: {
      sessionID: "sdk-default",
      boundary: { type: "before", messageID: "user-before" },
    },
  };
  f.client.session.fork = async () => {
    f.infos.set("sdk-fork", forkInfo);
    return forkInfo;
  };
  const result = await f.service.handle({
    type: "session.fork",
    ...f.ids,
    requestId: "branch-no-sid",
    before: "user-before",
  });
  assert.equal(result.ok, true, JSON.stringify(result));
});
test("context before-user branch refuses an explicit other-session target before Native fork", async (t) => {
  const f = await fixture(t);
  let count = 0;
  f.client.session.message = {
    get: async () => ({ id: "target", sessionID: "sdk-other", type: "user" }),
  };
  f.client.session.fork = async () => {
    count++;
  };
  const result = await f.service.handle({
    type: "session.fork",
    ...f.ids,
    requestId: "branch-cross",
    before: "target",
  });
  assert.equal(result.ok, false);
  assert.equal(count, 0);
});
test("context before-user branch maps MessageNotFoundError to INVALID_SELECTION without forking", async (t) => {
  const f = await fixture(t);
  let count = 0;
  f.client.session.message = {
    get: async () => {
      throw Object.assign(new Error("Message not found"), {
        _tag: "MessageNotFoundError",
      });
    },
  };
  f.client.session.fork = async () => {
    count++;
  };
  const result = await f.service.handle({
    type: "session.fork",
    ...f.ids,
    requestId: "branch-missing",
    before: "other-session-message",
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "INVALID_SELECTION");
  assert.equal(count, 0);
});
test("context before-user branch refuses assistant targets before Native fork", async (t) => {
  const f = await fixture(t);
  let count = 0;
  f.client.session.message = {
    get: async () => ({
      id: "target",
      sessionID: "sdk-default",
      type: "assistant",
    }),
  };
  f.client.session.fork = async () => {
    count++;
  };
  const result = await f.service.handle({
    type: "session.fork",
    ...f.ids,
    requestId: "branch2",
    before: "target",
  });
  assert.equal(result.ok, false);
  assert.equal(count, 0);
});
test("context actual SDK attachment pin outlives deadline and original-key lookup", async (t) => {
  const { createConversationContextIO } = await import(
    "./host/conversation-context-io.mjs"
  );
  let acquired = 0,
    released = 0,
    releaseSettled;
  const settled = new Promise((resolve) => {
    releaseSettled = resolve;
  });
  const actual = createConversationContextIO();
  const contextIO = {
    ...actual,
    acquire(...args) {
      acquired++;
      const hold = actual.acquire(...args);
      return {
        ...hold,
        release() {
          released++;
          hold.release();
          releaseSettled();
        },
      };
    },
  };
  const f = await fixture(t, { contextIO, deadlineMs: 150 });
  await writeFile(join(f.workspace, "pin.txt"), "captured");
  f.state.modelOptions = {
    capabilities: { tools: true, input: ["text"], output: ["text"] },
  };
  const read = (operation, readId) =>
    f.service.handle(
      { version: 2, runtimeEpoch: f.epoch, readId, operation },
      "context-sender",
    );
  const observed = await read(
    {
      type: "context.observe",
      workspaceId: f.ids.workspaceId,
      path: "pin.txt",
    },
    "context-read",
  );
  assert.equal(observed.ok, true, JSON.stringify(observed));
  const catalog = await read(
    { type: "catalog.list", workspaceId: f.ids.workspaceId },
    "context-model",
  );
  let finish, entered;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  t.after(() =>
    finish({
      id: "late",
      sessionID: "sdk-default",
      type: "user",
      payload: {
        text: "check",
        files: [
          {
            name: "pin.txt",
            mime: "text/plain",
            source: { type: "inline" },
            data: Buffer.from("captured").toString("base64"),
          },
        ],
      },
    }),
  );
  f.state.prompt = () => {
    entered();
    return pending;
  };
  const request = {
    type: "message.send",
    ...f.ids,
    requestId: "pin-send",
    text: "check",
    model: catalog.value.models.entries[0].id,
    attachments: [observed.value.descriptor],
  };
  const sending = f.service.handle(
    {
      version: 2,
      runtimeEpoch: f.epoch,
      operationId: "pin-send",
      expectedRevision: observed.value.revision,
      operation: request,
    },
    "context-sender",
  );
  await started;
  const result = await sending;
  assert.notEqual(result.receipt?.effect, "confirmed");
  assert.equal(acquired, 1);
  assert.equal(released, 0);
  const lookup = await read(
    {
      type: "operation.lookup",
      runtimeEpoch: f.epoch,
      operationId: "pin-send",
    },
    "pin-lookup",
  );
  assert.equal(lookup.value.status, "found");
  assert.equal(released, 0);
  finish({
    id: "late",
    sessionID: "sdk-default",
    type: "user",
    payload: {
      text: "check",
      files: [
        {
          name: "pin.txt",
          mime: "text/plain",
          source: { type: "inline" },
          data: Buffer.from("captured").toString("base64"),
        },
      ],
    },
  });
  await settled;
  assert.equal(released, 1);
  const final = await read(
    {
      type: "operation.lookup",
      runtimeEpoch: f.epoch,
      operationId: "pin-send",
    },
    "pin-final",
  );
  assert.equal(final.value.receipt.effect, "unknown");
});
test("context shutdown cancels pre-runtime readiness wait without claiming runtime settlement", async () => {
  const service = createWorkbenchService({
    runtimeReady: new Promise(() => {}),
    bootstrap: false,
  });
  await new Promise((resolve) => setImmediate(resolve));
  service.close();
  let timer;
  const result = await Promise.race([
    service.drain().then(() => "settled"),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve("blocked"), 100);
    }),
  ]);
  clearTimeout(timer);
  assert.equal(result, "settled");
});

test("permission policy explicit read preserves observed rules without mutations", async (t) => {
  const f = await fixture(t);
  f.calls.length = 0;
  const result = await f.service.handle({
    type: "permission.policy.read",
    ...f.ids,
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.status, "available");
  assert.deepEqual(result.value.sessionRules, BASELINE_POLICY);
  assert.equal(result.value.baselineMatches, true);
  assert.equal(result.value.evaluation, "not_evaluated");
  assert.ok(f.calls.some((call) => call.name === "get"));
  assert.deepEqual(
    f.calls.filter((call) => call.name !== "get"),
    [],
  );
});

for (const [name, value] of [
  ["absent", undefined],
  ["present empty", []],
  ["invalid rules", [{ action: "*", resource: "*", effect: "invalid" }]],
]) {
  test(`permission policy read ${name} never installs baseline`, async (t) => {
    const f = await fixture(t);
    const get = f.client.session.get;
    f.client.session.get = async (input) => {
      const info = await get(input);
      if (value === undefined) delete info.permissions;
      else info.permissions = value;
      return info;
    };
    f.calls.length = 0;
    const result = await f.service.handle({
      type: "permission.policy.read",
      ...f.ids,
    });
    assert.equal(result.ok, true);
    assert.equal(
      result.value.status,
      name === "invalid rules" ? "unavailable" : "available",
    );
    if (result.value.status === "available") {
      assert.equal(
        result.value.sessionRulesState,
        name === "absent" ? "absent" : "present",
      );
      assert.equal(result.value.baselineMatches, false);
    }
    assert.deepEqual(
      f.calls.filter((row) => row.name !== "get"),
      [],
    );
  });
}
test("permission policy wrong Native identity is rejected without raw data", async (t) => {
  const f = await fixture(t);
  const get = f.client.session.get;
  f.client.session.get = async (input) => ({
    ...(await get(input)),
    id: "wrong-secret-id",
  });
  f.calls.length = 0;
  const result = await f.service.handle({
    type: "permission.policy.read",
    ...f.ids,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "UNAVAILABLE");
  assert.equal(JSON.stringify(result).includes("wrong-secret"), false);
  assert.deepEqual(
    f.calls.filter((row) => row.name !== "get"),
    [],
  );
});
test("permission policy SDK error cannot leak secrets or mutate rules", async (t) => {
  const f = await fixture(t);
  f.state.policyReadFails = true;
  f.calls.length = 0;
  const result = await f.service.handle({
    type: "permission.policy.read",
    ...f.ids,
  });
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(result).includes("secret endpoint"), false);
  assert.deepEqual(
    f.calls.filter((row) => row.name !== "get"),
    [],
  );
});

test("permission policy v2 read and cancellation preserve original read identity", async (t) => {
  const f = await fixture(t);
  const get = f.client.session.get;
  let release, entered;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  f.client.session.get = async (input) => {
    entered();
    await held;
    return get(input);
  };
  const envelope = {
    version: 2,
    runtimeEpoch: f.epoch,
    readId: "policy-cancel",
    operation: { type: "permission.policy.read", ...f.ids },
  };
  const pending = f.service.handle(envelope, "policy-sender");
  await started;
  const cancelled = await f.service.cancelRead(
    { version: 2, runtimeEpoch: f.epoch, readId: "policy-cancel" },
    "policy-sender",
  );
  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.value.status, "cancelled");
  release();
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.code, "CANCELLED");
});
test("permission policy v2 read deadline does not release a late observation", async (t) => {
  const f = await fixture(t, { deadlineMs: 20 });
  const get = f.client.session.get;
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  f.client.session.get = async (input) => {
    await held;
    return get(input);
  };
  const pending = f.service.handle(
    {
      version: 2,
      runtimeEpoch: f.epoch,
      readId: "policy-timeout",
      operation: { type: "permission.policy.read", ...f.ids },
    },
    "policy-sender",
  );
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.code, "READ_TIMEOUT");
  release();
  await f.service.drain();
});
test("permission policy mismatched epoch makes zero Native calls", async (t) => {
  const f = await fixture(t);
  f.calls.length = 0;
  const result = await f.service.handle(
    {
      version: 2,
      runtimeEpoch: "wrong-epoch",
      readId: "policy-stale",
      operation: { type: "permission.policy.read", ...f.ids },
    },
    "policy-sender",
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, "STALE_EPOCH");
  assert.deepEqual(f.calls, []);
});
test("permission policy changed canonical Native location cannot produce rules", async (t) => {
  const f = await fixture(t);
  const get = f.client.session.get;
  f.client.session.get = async (input) => ({
    ...(await get(input)),
    location: { directory: f.root },
  });
  f.calls.length = 0;
  const result = await f.service.handle({
    type: "permission.policy.read",
    ...f.ids,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "UNAVAILABLE");
  assert.deepEqual(
    f.calls.filter((row) => row.name !== "get"),
    [],
  );
});

test("permission policy disconnected runtime makes zero Native calls", async (t) => {
  const f = await fixture(t);
  f.state.connection = "disconnected";
  f.calls.length = 0;
  const result = await f.service.handle({
    type: "permission.policy.read",
    ...f.ids,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "UNAVAILABLE");
  assert.deepEqual(f.calls, []);
});

test("permission policy runtime disconnect during get retires the observation", async (t) => {
  const f = await fixture(t);
  const get = f.client.session.get;
  f.client.session.get = async (input) => {
    const value = await get(input);
    f.state.connection = "disconnected";
    return value;
  };
  const result = await f.service.handle({
    type: "permission.policy.read",
    ...f.ids,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "UNAVAILABLE");
});

test("permission policy session generation change during get retires the observation", async (t) => {
  const f = await fixture(t);
  const get = f.client.session.get;
  let changed = false;
  f.client.session.get = async (input) => {
    const value = await get(input);
    if (!changed) {
      changed = true;
      const stopped = await f.service.handle({
        type: "session.interrupt",
        ...f.ids,
      });
      assert.equal(stopped.ok, true);
    }
    return value;
  };
  const result = await f.service.handle({
    type: "permission.policy.read",
    ...f.ids,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "UNAVAILABLE");
});

// --- per-turn revert ---
async function revertFixture(t, confirm = async () => true, checkpoints) {
  const asked = [];
  const f = await fixture(t, {
    checkpoints,
    confirmSessionRevert: async (details) => {
      asked.push(details);
      return confirm(details);
    },
  });
  const rec = { stage: [], clear: [], asked };
  const sdk = f.infos.get("sdk-default");
  f.state.messages = [
    {
      id: "msg_4",
      type: "assistant",
      content: [{ type: "text", text: "b2" }],
      snapshot: { start: "tree-a", files: ["a.txt"] },
    },
    { id: "msg_3", type: "user", text: "second" },
    { id: "msg_2", type: "assistant", content: [{ type: "text", text: "b1" }] },
    { id: "msg_1", type: "user", text: "first" },
  ];
  f.client.session.message = {
    get: async ({ messageID }) => {
      const m = f.state.messages.find((x) => x.id === messageID);
      return m && { ...m, sessionID: "sdk-default" };
    },
  };
  f.client.session.revert = {
    stage: async (args) => {
      rec.stage.push(args);
      sdk.revert = {
        messageID: args.messageID,
        snapshot: "tree",
        files: [
          { file: "a.txt", patch: "SECRET-PATCH", additions: 1, deletions: 0 },
        ],
      };
    },
    clear: async (args) => {
      rec.clear.push(args);
      delete sdk.revert;
    },
  };
  const revert = (type, overrides = {}) =>
    f.service.handle({
      type,
      ...f.ids,
      requestId: `r-${Math.random()}`,
      messageId: "msg_3",
      ...overrides,
    });
  return { f, rec, sdk, revert };
}
test("revert stages through Native after native confirmation and hides the boundary and later messages", async (t) => {
  const { f, rec, revert } = await revertFixture(t);
  const result = await revert("session.revert");
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(rec.stage, [
    { sessionID: "sdk-default", messageID: "msg_3" },
  ]);
  assert.equal(rec.asked.length, 1);
  assert.equal(rec.asked[0].action, "revert");
  // Dialog facts come from Native (a later step recorded a snapshot), never
  // from the renderer.
  assert.equal(rec.asked[0].restoresFiles, true);
  assert.equal(Object.hasOwn(rec.asked[0], "messageId"), false);
  const snap = await f.service.handle({ type: "snapshot" });
  assert.deepEqual(
    snap.value.messages.map((m) => m.id),
    ["msg_1", "msg_2"],
  );
  assert.deepEqual(snap.value.revert, {
    messageId: "msg_3",
    fileCount: 1,
    files: ["a.txt"],
    filesRestored: true,
  });
  assert.equal(JSON.stringify(snap.value).includes("SECRET-PATCH"), false);
});
test("without Native snapshot facts the dialog and snapshot say no files are restored", async (t) => {
  const { f, rec, sdk, revert } = await revertFixture(t);
  for (const m of f.state.messages) delete m.snapshot;
  f.client.session.revert.stage = async (args) => {
    sdk.revert = { messageID: args.messageID, files: [] };
  };
  const result = await revert("session.revert");
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(rec.asked[0].restoresFiles, false);
  const snap = await f.service.handle({ type: "snapshot" });
  assert.equal(snap.value.revert.filesRestored, false);
  assert.equal(snap.value.revert.fileCount, 0);
  assert.deepEqual(
    snap.value.messages.map((m) => m.id),
    ["msg_1", "msg_2"],
  );
});
test("revert is default-deny: no confirmation, no Native stage", async (t) => {
  const { rec, revert } = await revertFixture(t, async () => false);
  const result = await revert("session.revert");
  assert.equal(result.ok, false);
  assert.equal(result.code, "CANCELLED");
  assert.equal(rec.stage.length, 0);
  const plain = await fixture(t);
  plain.client.session.revert = { stage: async () => assert.fail("staged") };
  plain.state.messages = [{ id: "m", type: "user", text: "x" }];
  plain.client.session.message = {
    get: async () => ({ id: "m", sessionID: "sdk-default", type: "user" }),
  };
  const denied = await plain.service.handle({
    type: "session.revert",
    ...plain.ids,
    requestId: "r1",
    messageId: "m",
  });
  assert.equal(denied.code, "CANCELLED");
});
test("revert refuses assistant, unknown and already hidden targets, and busy sessions, before any Native write", async (t) => {
  const { f, rec, revert } = await revertFixture(t);
  assert.equal(
    (await revert("session.revert", { messageId: "msg_4" })).code,
    "INVALID_SELECTION",
  );
  assert.equal(
    (await revert("session.revert", { messageId: "nope" })).code,
    "INVALID_SELECTION",
  );
  const get = f.client.session.message.get;
  f.client.session.message.get = async (args) => ({
    ...(await get(args)),
    sessionID: "someone-else",
  });
  assert.equal((await revert("session.revert")).code, "INVALID_SELECTION");
  f.client.session.message.get = async (args) => {
    const real = { ...(await get(args)) };
    delete real.sessionID;
    return real;
  };
  f.state.inbox = [{ id: "i1", sessionID: "sdk-default" }];
  assert.equal((await revert("session.revert")).code, "BUSY");
  f.state.inbox = [];
  f.state.active = { "sdk-default": { type: "running" } };
  assert.equal((await revert("session.revert")).code, "BUSY");
  f.state.active = {};
  assert.equal(rec.stage.length, 0);
  assert.equal(rec.asked.length, 0);
  // Real Native omits sessionID from message.get: still accepted.
  assert.equal((await revert("session.revert")).ok, true);
  // Re-staging at or after the current boundary is not a visible message.
  assert.equal(
    (await revert("session.revert", { messageId: "msg_3" })).code,
    "INVALID_SELECTION",
  );
  assert.equal(rec.stage.length, 1);
});
test("a revert that Native did not record, or that fails after dispatch, is an unknown outcome", async (t) => {
  const a = await revertFixture(t);
  a.f.client.session.revert.stage = async () => {};
  const missing = await a.revert("session.revert");
  assert.equal(missing.code, "UNKNOWN_OUTCOME");
  const b = await revertFixture(t);
  b.f.client.session.revert.stage = async () => {
    throw new Error("checkout failed halfway");
  };
  const partial = await b.revert("session.revert");
  assert.equal(partial.code, "UNKNOWN_OUTCOME");
  const snap = await b.f.service.handle({ type: "snapshot" });
  assert.equal(
    snap.value.sessions.find((x) => x.id === b.f.ids.sessionId).status,
    "unknown",
  );
});
test("reapply clears only the staged boundary, with its own confirmation", async (t) => {
  const { f, rec, revert } = await revertFixture(t);
  assert.equal(
    (await revert("session.revert.clear")).code,
    "INVALID_SELECTION",
  );
  assert.equal(rec.clear.length, 0);
  assert.equal((await revert("session.revert")).ok, true);
  assert.equal(
    (await revert("session.revert.clear", { messageId: "msg_1" })).code,
    "INVALID_SELECTION",
  );
  assert.equal(rec.clear.length, 0);
  const result = await revert("session.revert.clear");
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(rec.clear, [{ sessionID: "sdk-default" }]);
  assert.equal(rec.asked.at(-1).action, "reapply");
  const snap = await f.service.handle({ type: "snapshot" });
  assert.equal(Object.hasOwn(snap.value, "revert"), false);
  assert.deepEqual(
    snap.value.messages.map((m) => m.id),
    ["msg_1", "msg_2", "msg_3", "msg_4"],
  );
});
test("reapply is default-deny and a clear that leaves the revert in place is unknown", async (t) => {
  const deny = await revertFixture(t, async (d) => d.action !== "reapply");
  assert.equal((await deny.revert("session.revert")).ok, true);
  assert.equal((await deny.revert("session.revert.clear")).code, "CANCELLED");
  assert.equal(deny.rec.clear.length, 0);
  const noop = await revertFixture(t);
  assert.equal((await noop.revert("session.revert")).ok, true);
  noop.f.client.session.revert.clear = async () => {};
  assert.equal(
    (await noop.revert("session.revert.clear")).code,
    "UNKNOWN_OUTCOME",
  );
});
function pagedList(all) {
  // Native: at most 100 per page; cursor.next continues toward older messages.
  return async ({ limit, cursor, order }) => {
    // The cursor already encodes the order.
    if (cursor && order) throw new Error("order with cursor");
    if (limit > 100) throw new Error("limit must be <= 100");
    const from = cursor ? Number(cursor) : 0;
    const data = all.slice(from, from + limit);
    return {
      data,
      cursor: from + limit < all.length ? { next: String(from + limit) } : {},
    };
  };
}
test("hidden messages do not shrink the transcript: paged at Native's 100 limit", async (t) => {
  const { f, revert } = await revertFixture(t);
  const all = [];
  for (let i = 250; i >= 1; i--)
    all.push({
      id: `m${String(i).padStart(3, "0")}`,
      type: i % 2 ? "user" : "assistant",
      text: `t${i}`,
      content: [{ type: "text", text: `t${i}` }],
    });
  f.state.messages = all;
  f.client.message.list = pagedList(all);
  const result = await revert("session.revert", { messageId: "m231" });
  assert.equal(result.ok, true, JSON.stringify(result));
  const snap = await f.service.handle({ type: "snapshot" });
  assert.equal(snap.value.messages.length, 100);
  assert.equal(snap.value.messages.at(-1).id, "m230");
  assert.equal(snap.value.messages[0].id, "m131");
});
test("hiding follows Native's sequence order, not id order", async (t) => {
  const { f, revert } = await revertFixture(t);
  // seq order (oldest first): u1, a1, u3(boundary), a3, queued-u2 (smaller id, later seq)
  f.state.messages = [
    { id: "msg_2q", type: "user", text: "queued later" },
    { id: "msg_4", type: "assistant", content: [] },
    { id: "msg_3", type: "user", text: "second" },
    { id: "msg_2", type: "assistant", content: [] },
    { id: "msg_1", type: "user", text: "first" },
  ];
  f.client.message.list = pagedList(f.state.messages);
  assert.equal((await revert("session.revert")).ok, true);
  const snap = await f.service.handle({ type: "snapshot" });
  assert.deepEqual(
    snap.value.messages.map((m) => m.id),
    ["msg_1", "msg_2"],
  );
});
test("a message id of another session (Native MessageNotFoundError) is an invalid selection", async (t) => {
  const { f, rec, revert } = await revertFixture(t);
  f.client.session.message.get = async () => {
    throw Object.assign(new Error("not found"), {
      _tag: "MessageNotFoundError",
    });
  };
  const result = await revert("session.revert");
  assert.equal(result.code, "INVALID_SELECTION");
  assert.equal(rec.stage.length, 0);
});

function fakeCheckpoints(over = {}) {
  const log = [];
  const known = new Map();
  let record;
  return {
    log,
    known,
    snapshot: async (...a) => (
      log.push(["snapshot", ...a.slice(2)]),
      { oid: "oid-1", fileCount: 2 }
    ),
    bind: async (_w, sid, mid, oid) => (
      known.set(mid, oid),
      log.push(["bind", sid, mid, oid])
    ),
    clearStaged: async () => log.push(["clearStaged"]),
    find: async (_w, _s, mid) => known.get(mid),
    staged: async () => record,
    stage: async (_w, _p, sid, mid) => {
      log.push(["stage", sid, mid]);
      record = {
        messageId: mid,
        original: "orig",
        fileCount: 2,
        files: ["a.txt", "b/c.txt"],
      };
      return record;
    },
    reapply: async (_w, _p, sid, mid) => {
      log.push(["reapply", sid, mid]);
      record = undefined;
      return { fileCount: 2 };
    },
    dropSession: async (...a) => log.push(["dropSession", a[1]]),
    dropWorkspace: async () => {},
    ...over,
  };
}
test("checkpoint: an idle send is checkpointed before the prompt and bound to the inbox id", async (t) => {
  const cp = fakeCheckpoints();
  const { f } = await revertFixture(t, async () => true, cp);
  const order = [];
  const prompt = f.client.session.prompt;
  f.client.session.prompt = async (a) => (order.push("prompt"), prompt(a));
  const snap = cp.snapshot;
  cp.snapshot = async (...a) => (order.push("snapshot"), snap(...a));
  const sent = await f.send();
  assert.equal(sent.ok, true, JSON.stringify(sent));
  assert.deepEqual(order, ["snapshot", "prompt"]);
  assert.deepEqual(cp.log.find((e) => e[0] === "bind").slice(2), [
    "inbox-1",
    "oid-1",
  ]);
  assert.equal(cp.known.get("inbox-1"), "oid-1");
});
test("checkpoint: an unavailable checkpoint never blocks the send and clears a staged revert record", async (t) => {
  const cp = fakeCheckpoints({
    snapshot: async () => ({ unavailable: "too_many_files" }),
  });
  const { f } = await revertFixture(t, async () => true, cp);
  const sent = await f.send();
  assert.equal(sent.ok, true, JSON.stringify(sent));
  assert.equal(
    cp.log.some((e) => e[0] === "bind"),
    false,
  );
  assert.equal(
    cp.log.some((e) => e[0] === "clearStaged"),
    true,
  );
});
test("checkpoint: revert restores files from the checkpoint, the dialog and DTO come from it", async (t) => {
  const cp = fakeCheckpoints();
  const { f, rec, revert } = await revertFixture(t, async () => true, cp);
  for (const m of f.state.messages) delete m.snapshot;
  cp.known.set("msg_3", "oid-9");
  const result = await revert("session.revert");
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(rec.asked[0].restoresFiles, true);
  assert.equal(cp.log.find((e) => e[0] === "stage")[2], "msg_3");
  const snap = await f.service.handle({ type: "snapshot" });
  assert.deepEqual(snap.value.revert, {
    messageId: "msg_3",
    fileCount: 2,
    files: ["a.txt", "b/c.txt"],
    filesRestored: true,
  });
  const again = await revert("session.revert.clear");
  assert.equal(again.ok, true, JSON.stringify(again));
  assert.equal(rec.asked.at(-1).restoresFiles, true);
  assert.equal(rec.asked.at(-1).fileCount, 2);
  assert.equal(
    cp.log.some((e) => e[0] === "reapply"),
    true,
  );
});
test("checkpoint: without a checkpoint for the boundary no files are claimed or touched", async (t) => {
  const cp = fakeCheckpoints();
  const { f, rec, revert } = await revertFixture(t, async () => true, cp);
  for (const m of f.state.messages) delete m.snapshot;
  const result = await revert("session.revert");
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(rec.asked[0].restoresFiles, false);
  assert.equal(
    cp.log.some((e) => e[0] === "stage"),
    false,
  );
});
test("checkpoint: a file restore that fails after Native staged is an unknown outcome", async (t) => {
  const cp = fakeCheckpoints({
    stage: async () => {
      throw new Error("disk");
    },
  });
  const { f, revert } = await revertFixture(t, async () => true, cp);
  cp.known.set("msg_3", "oid-9");
  const result = await revert("session.revert");
  assert.equal(result.code, "UNKNOWN_OUTCOME");
  const snap = await f.service.handle({ type: "snapshot" });
  assert.equal(
    snap.value.sessions.find((x) => x.id === f.ids.sessionId).status,
    "unknown",
  );
});
test("checkpoint: a file restore is refused while another session of the workspace runs", async (t) => {
  const cp = fakeCheckpoints();
  const { f, rec, revert } = await revertFixture(t, async () => true, cp);
  cp.known.set("msg_3", "oid-9");
  const created = await f.service.handle({
    type: "session.create",
    workspaceId: f.ids.workspaceId,
    title: "Other",
  });
  assert.equal(created.ok, true, JSON.stringify(created));
  f.state.active["sdk-1"] = true;
  const result = await revert("session.revert");
  assert.equal(result.code, "BUSY");
  assert.equal(rec.asked.length, 0);
  assert.equal(rec.stage.length, 0);
  assert.equal(
    cp.log.some((e) => e[0] === "stage"),
    false,
  );
  f.state.active = {};
  const ok = await revert("session.revert");
  assert.equal(ok.ok, true, JSON.stringify(ok));
});

test("checkpoint: another session's newer checkpoint refuses the file restore with CONFLICT", async (t) => {
  const cp = fakeCheckpoints({ conflict: async () => true });
  const { rec, revert } = await revertFixture(t, async () => true, cp);
  cp.known.set("msg_3", "oid-9");
  const result = await revert("session.revert");
  assert.equal(result.code, "CONFLICT");
  assert.equal(rec.asked.length, 0);
  assert.equal(rec.stage.length, 0);
});
test("checkpoint: another session starting during the confirmation refuses the restore", async (t) => {
  const cp = fakeCheckpoints();
  let f;
  const made = await revertFixture(
    t,
    async () => {
      f.state.active["sdk-1"] = true;
      return true;
    },
    cp,
  );
  f = made.f;
  cp.known.set("msg_3", "oid-9");
  const created = await f.service.handle({
    type: "session.create",
    workspaceId: f.ids.workspaceId,
    title: "Other",
  });
  assert.equal(created.ok, true, JSON.stringify(created));
  const result = await made.revert("session.revert");
  assert.equal(result.code, "BUSY");
  assert.equal(made.rec.stage.length, 0);
});
test("a failed assistant turn projects only its numeric HTTP status", () => {
  const turn = (error) => ({
    id: "a",
    type: "assistant",
    content: [],
    time: { created: 1 },
    ...(error ? { error } : {}),
  });
  const [failed, plain, odd] = projectMessages([
    turn({
      type: "provider.invalid-request",
      status: 404,
      message: "key sk-secret at http://x",
    }),
    turn(),
    turn({ type: "x", status: "404", message: "m" }),
  ]);
  assert.deepEqual(failed.failure, { status: 404 });
  assert.equal(JSON.stringify(failed).includes("sk-secret"), false);
  assert.equal("failure" in plain, false);
  assert.equal("failure" in odd, false);
});
test("bash tool exit comes only from structured metadata, bounded, else absent", () => {
  const part = (id, metadata, output = "exit code: 0") => ({
    type: "tool",
    id,
    name: "bash",
    state: {
      status: "completed",
      input: { command: "npm test" },
      content: [{ type: "text", text: output }],
      ...(metadata !== undefined && { metadata }),
    },
  });
  const [m] = projectMessages([
    {
      id: "a",
      type: "assistant",
      time: { created: 1 },
      content: [
        part("t1", { exit: 0 }),
        part("t2", { exit: 3 }),
        part("t3", undefined),
        part("t4", { exit: "0" }),
        part("t5", { exit: -1 }),
        part("t6", { exit: 256 }),
        part("t7", { exit: 1.5 }),
      ],
    },
  ]);
  assert.deepEqual(
    m.tools.map((t) => t.exit),
    [0, 3, undefined, undefined, undefined, undefined, undefined],
  );
  assert.equal("exit" in m.tools[2], false);
});
test("snapshot sessions carry Native's last activity time as updatedAt", async (t) => {
  const f = await fixture(t);
  const original = f.client.session.get;
  f.client.session.get = async (...args) => ({
    ...(await original(...args)),
    time: { created: 1, updated: 5000, idle: 7000 },
  });
  const sessions = (await f.service.handle({ type: "snapshot", ...f.ids }))
    .value.sessions;
  assert.equal(sessions[0].updatedAt, 7000);
  // Sessions other than the selected one get their time from Native's list
  // (end of last run, else creation; its `updated` also moves on renames). The
  // read never blocks a snapshot: the next one carries the result.
  f.state.sessionList = [
    { id: "sdk-1", time: { created: 1, updated: 99999, idle: 9000 } },
  ];
  const created = await f.service.handle({
    type: "session.create",
    workspaceId: f.ids.workspaceId,
    title: "Other",
  });
  assert.equal(created.ok, true);
  await f.service.handle({ type: "snapshot", ...f.ids });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const other = (
    await f.service.handle({ type: "snapshot", ...f.ids })
  ).value.sessions.find((x) => x.title === "Other");
  assert.equal(other.updatedAt, 9000);
});
test("session time reads skip while not connected and keep old values on failure", async (t) => {
  const f = await fixture(t);
  const listCalls = () => f.calls.filter((c) => c.name === "sessions").length;
  const snap = async () => {
    await f.service.handle({ type: "snapshot", ...f.ids });
    await new Promise((resolve) => setTimeout(resolve, 20));
  };
  const other = () =>
    f.service
      .handle({ type: "snapshot", ...f.ids })
      .then((r) => r.value.sessions.find((x) => x.title === "Other"));
  f.state.connection = "disconnected";
  const before = listCalls();
  await snap();
  assert.equal(listCalls(), before);
  // Not connected must not burn the 30s throttle.
  f.state.connection = "connected";
  f.state.sessionList = [{ id: "sdk-1", time: { created: 1, idle: 4000 } }];
  await f.service.handle({
    type: "session.create",
    workspaceId: f.ids.workspaceId,
    title: "Other",
  });
  await snap();
  await snap();
  assert.ok(listCalls() > before);
  assert.equal((await other()).updatedAt, 4000);
  // Past the throttle a failing read keeps the last known value.
  const realNow = globalThis.performance.now.bind(globalThis.performance);
  t.mock.method(globalThis.performance, "now", () => realNow() + 31000);
  f.client.session.list = async () => {
    throw new Error("boom");
  };
  await snap();
  assert.equal((await other()).updatedAt, 4000);
});
test("activityTime prefers the last idle, then creation, never updated", async () => {
  const { activityTime } = await import("./workbench-service.mjs");
  assert.equal(activityTime({ created: 1, updated: 99, idle: 7 }), 7);
  assert.equal(activityTime({ created: 5, updated: 99 }), 5);
  assert.equal(activityTime({ updated: 99 }), undefined);
  assert.equal(activityTime(undefined), undefined);
});
test("a failed turn's type reduces to a closed cause and never leaves main", () => {
  const turn = (error) => ({
    id: "a",
    type: "assistant",
    content: [],
    time: { created: 1 },
    error,
  });
  const [auth, net, other, none, filtered, unauth] = projectMessages([
    turn({ type: "provider.auth", status: 403, message: "sk-secret" }),
    turn({ type: "provider.transport", message: "http://x" }),
    turn({ type: "provider.rate-limit", status: 429 }),
    turn({ type: "unknown" }),
    turn({ type: "provider.content-filter", status: 403 }),
    turn({ type: "provider.other", status: 401 }),
  ]);
  assert.deepEqual(filtered.failure, { status: 403 });
  assert.deepEqual(unauth.failure, { status: 401, kind: "auth" });
  assert.deepEqual(auth.failure, { status: 403, kind: "auth" });
  assert.deepEqual(net.failure, { kind: "network" });
  assert.deepEqual(other.failure, { status: 429 });
  assert.equal("failure" in none, false);
});

test("context.stage stages a pasted image app-side and context.release deletes it", async (t) => {
  const stageRoot = await mkdtemp(join(tmpdir(), "workbench-stage-"));
  t.after(() => rm(stageRoot, { recursive: true, force: true }));
  const { createConversationContextIO } = await import(
    "./host/conversation-context-io.mjs"
  );
  const contextIO = createConversationContextIO({ stageRoot });
  t.after(() => contextIO.close());
  const f = await fixture(t, { contextIO });
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  );
  const read = (operation, readId) =>
    f.service.handle(
      { version: 2, runtimeEpoch: f.epoch, readId, operation },
      "paste-sender",
    );
  const staged = await read(
    {
      type: "context.stage",
      workspaceId: f.ids.workspaceId,
      mime: "image/png",
      bytes: new Uint8Array(png),
    },
    "stage-1",
  );
  assert.equal(staged.ok, true, JSON.stringify(staged));
  const d = staged.value.descriptor;
  assert.equal(d.source, "paste");
  assert.equal(d.workspacePath, await realpath(f.workspace));
  assert.ok(!JSON.stringify(staged.value).includes(stageRoot));
  const dir = join(stageRoot, f.epoch);
  assert.equal((await readdir(dir)).length, 1);
  assert.deepEqual(await readdir(f.workspace), []);
  // Wrong magic bytes for the claimed type is refused and writes nothing.
  const bad = await read(
    {
      type: "context.stage",
      workspaceId: f.ids.workspaceId,
      mime: "image/jpeg",
      bytes: new Uint8Array(png),
    },
    "stage-2",
  );
  assert.equal(bad.ok, true);
  assert.equal(bad.value.status, "unsupported");
  assert.equal((await readdir(dir)).length, 1);
  // Strings, Buffers and unknown workspaces never reach the staged directory.
  for (const operation of [
    { ...bad, type: "context.stage" },
    {
      type: "context.stage",
      workspaceId: f.ids.workspaceId,
      mime: "image/png",
      bytes: png,
    },
    {
      type: "context.stage",
      workspaceId: "missing",
      mime: "image/png",
      bytes: new Uint8Array(png),
    },
  ]) {
    const refused = await read(operation, "stage-3").catch(() => ({
      ok: false,
    }));
    assert.equal(refused.ok, false);
  }
  assert.equal((await readdir(dir)).length, 1);
  const released = await read(
    {
      type: "context.release",
      workspaceId: f.ids.workspaceId,
      capabilityId: d.capabilityId,
    },
    "release-1",
  );
  assert.deepEqual(released.value, {
    workspaceId: f.ids.workspaceId,
    released: true,
  });
  assert.deepEqual(await readdir(dir), []);
});
