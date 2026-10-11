import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir, symlink, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkbenchService } from "./workbench-service.mjs";
import { BASELINE_POLICY } from "./workbench-contract.mjs";
import { MAX_FILE_BYTES, defaultFolderName } from "./host/workbench-files.mjs";

async function fixture(t) {
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
    snapshot: () => ({ state: "connected" }),
    workbenchContext: () => ({ client, session: infos.get("sdk-default") }),
  };
  const service = createWorkbenchService({
    trustedTestAdapter: true,
    deadlineMs: 5000,
    runtime,
    pickDirectory: async () => state.pick,
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
    service,
    client,
    state,
    calls,
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
  const before = f.calls.length;
  const imported = await f.service.handle({ type: "workspace.import" });
  const workspaceId = imported.value.selectedWorkspaceId;
  assert.equal(f.calls.length, before);
  const catalog = await f.service.handle({ type: "catalog.list", workspaceId });
  assert.equal(catalog.value.models.status, "unavailable");
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
