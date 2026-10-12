import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  rm,
  readFile,
  writeFile,
  mkdir,
  symlink,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkbenchService } from "./workbench-service.mjs";
import { BASELINE_POLICY } from "./workbench-contract.mjs";
import { MAX_FILE_BYTES, defaultFolderName } from "./host/workbench-files.mjs";

async function fixture(t, { contextIO, deadlineMs = 5000 } = {}) {
  const root = await mkdtemp(join(tmpdir(), "workbench-test-"));
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
                providerID: "provider",
                name: "Model",
                enabled: true,
                status: "active",
                headers: { secret: "never expose" },
                ...(state.modelOptions ?? {}),
              },
            ]
          : [],
      })),
    },
    provider: {
      list: method("providers", () => ({
        data: [
          {
            id: "provider",
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
            connections: [
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
    probeWorkspace: async (path) => ({
      branch: "main",
      writable: path !== "x",
    }),
    confirmTrust: async () => state.trust,
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
