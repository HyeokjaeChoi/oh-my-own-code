import test from "node:test";
import assert from "node:assert/strict";
import { setupNativeExtensions } from "./builtins/workbench-skills/extensions.mjs";
import {
  NATIVE_EXTENSIONS_RPC,
  NATIVE_EXTENSIONS_RPC_DEFINITION,
  validateExtensionRpc,
  validateExtensionRpcResult,
} from "./native-extensions-protocol.mjs";

const nonce = "b".repeat(64),
  root = "/synthetic/workspace";
const input = () => ({
  nonce,
  workspaceId: "workspace-one",
  workspacePath: root,
});
const rawPlugin = () => ({
  id: "omoc.workbench.skills",
  source: { type: "builtin" },
  state: { status: "active" },
  features: { server: true, rpc: true },
});
const rpcContext = {
  error: (type, message, data) =>
    Object.assign(new Error(message), { type, data }),
};
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
// Mirrors pinned Schema.Class Location.Info own fields. PublicRef omits both
// workspaceID and project; unit tests must not import a built Native resource.
class NativeLocationInfo {
  constructor({ directory = root, workspaceID, project } = {}) {
    this.directory = directory;
    this.workspaceID = workspaceID;
    this.project = project;
  }
  toJSON() {
    assert.fail("Private Location.Info serialization must not run");
  }
}
const nativeProject = () => ({
  id: "project-private",
  directory: "/synthetic",
  canonical: "/synthetic",
});
async function host(location = { directory: root }) {
  const state = {
    plugins: 0,
    tools: 0,
    disposed: 0,
    registered: 0,
    forbidden: 0,
  };
  const forbidden = () => {
    state.forbidden++;
    assert.fail("Forbidden native call");
  };
  const ctx = {
    options: { nonce },
    location,
    plugin: {
      async list() {
        state.plugins++;
        return state.pluginList
          ? state.pluginList()
          : { location: { directory: root }, data: [rawPlugin()] };
      },
      check: forbidden,
      update: forbidden,
    },
    tool: {
      async list() {
        state.tools++;
        return state.toolList
          ? state.toolList()
          : [
              {
                id: "ns.read",
                name: "read",
                execute: forbidden,
                input: { secret: true },
              },
            ];
      },
      transform: forbidden,
      reload: forbidden,
      hook: forbidden,
      execute: forbidden,
    },
    agent: { list: forbidden, transform: forbidden, reload: forbidden },
    skill: { list: forbidden, transform: forbidden, reload: forbidden },
    config: { get: forbidden },
    npm: { check: forbidden, update: forbidden },
    rpc: {
      async register(definition, handlers) {
        state.registered++;
        assert.equal(definition, NATIVE_EXTENSIONS_RPC_DEFINITION);
        state.handlers = handlers;
        return {
          async dispose() {
            state.disposed++;
          },
        };
      },
    },
  };
  const handle = await setupNativeExtensions(ctx);
  return {
    ctx,
    state,
    handle,
    call: (request = input(), context = rpcContext) =>
      state.handlers.observe(request, context),
  };
}

test("private observe uses portable strict input/output schemas and no other method", () => {
  assert.equal(NATIVE_EXTENSIONS_RPC, "omoc.workbench.extensions");
  assert.equal(NATIVE_EXTENSIONS_RPC_DEFINITION.id, NATIVE_EXTENSIONS_RPC);
  assert.deepEqual(Object.keys(NATIVE_EXTENSIONS_RPC_DEFINITION.methods), [
    "observe",
  ]);
  const value = input();
  assert.equal(validateExtensionRpc("observe", value), value);
  assert.throws(() => validateExtensionRpc("install", value));
  const schema =
    NATIVE_EXTENSIONS_RPC_DEFINITION.methods.observe.input["~standard"];
  assert.equal(schema.validate(value).value, value);
  for (const bad of [
    { ...value, extra: true },
    { ...value, nonce: "b".repeat(63) },
    { ...value, nonce: `${nonce}\n` },
    { ...value, workspacePath: `${root}/..` },
  ])
    assert.ok(schema.validate(bad).issues);
});

test("setup calls only rpc.register, observe calls only the two inventories", async () => {
  const h = await host();
  assert.equal(h.state.registered, 1);
  assert.equal(h.state.plugins + h.state.tools + h.state.forbidden, 0);
  assert.deepEqual(Object.keys(h.state.handlers), ["observe"]);
  const result = await h.call();
  assert.equal(validateExtensionRpcResult("observe", result), result);
  assert.equal(result.status, "available");
  assert.equal(result.workspacePath, root);
  assert.equal(result.workspaceId, "workspace-one");
  assert.deepEqual(result.tools.rows, [{ id: "ns.read", name: "read" }]);
  assert.deepEqual(result.hooks, {
    status: "not_reported",
    reason: "inventory_not_supported",
  });
  assert.equal(h.state.forbidden, 0);
  await h.handle.dispose();
  await h.handle.dispose();
  assert.equal(h.state.disposed, 1);
});

test("Native Location.Info private identity accepts directory-only public Plugin projection", async () => {
  for (const location of [
    new NativeLocationInfo({
      workspaceID: "wrk_native",
      project: nativeProject(),
    }),
    new NativeLocationInfo({ project: nativeProject() }),
    new NativeLocationInfo(),
    { directory: root, workspaceID: undefined, project: undefined },
  ]) {
    assert.deepEqual(Reflect.ownKeys(location), [
      "directory",
      "workspaceID",
      "project",
    ]);
    const h = await host(location);
    assert.equal(h.state.registered, 1);
    assert.equal(h.state.plugins + h.state.tools + h.state.forbidden, 0);
    for (const request of [
      { ...input(), nonce: "c".repeat(64) },
      { ...input(), workspacePath: "/other/workspace" },
    ])
      assert.equal((await h.call(request)).type, "denied");
    assert.equal(h.state.plugins + h.state.tools, 0);
    const result = await h.call();
    assert.equal(result.status, "available");
    assert.equal(h.state.plugins, 1);
    assert.equal(h.state.tools, 1);
    assert.equal(JSON.stringify(result).includes("project-private"), false);
    assert.equal(JSON.stringify(result).includes("workspaceID"), false);
    assert.equal(JSON.stringify(result).includes("wrk_native"), false);
    await h.handle.dispose();
  }
});

test("Native Location.Info reads only own data; prototype callbacks stay inert", async () => {
  let callbacks = 0;
  const location = new NativeLocationInfo({ project: nativeProject() });
  const prototype = Object.create(NativeLocationInfo.prototype, {
    directory: {
      get() {
        callbacks++;
        return root;
      },
    },
    toJSON: {
      get() {
        callbacks++;
        throw new Error("Private prototype callback");
      },
    },
  });
  Object.setPrototypeOf(location, prototype);
  const h = await host(location);
  assert.equal((await h.call()).status, "available");
  assert.equal(callbacks, 0);
  // A valid inherited field must not substitute for a missing own field.
  delete location.directory;
  assert.equal((await h.call()).type, "denied");
  assert.equal(h.state.plugins, 1);
  assert.equal(h.state.tools, 1);
  assert.equal(callbacks, 0);
  await h.handle.dispose();
});

test("Native workspace/project identity changes refuse reads before inventory", async () => {
  for (const change of [
    (location) => {
      location.workspaceID = "wrk_changed";
    },
    (location) => {
      location.project.id = "changed";
    },
    (location) => {
      location.project.directory = "/other/project";
    },
    (location) => {
      location.project.canonical = "/other/canonical";
    },
    (location) => {
      location.project = undefined;
    },
  ]) {
    const h = await host(
      new NativeLocationInfo({
        workspaceID: "wrk_native",
        project: nativeProject(),
      }),
    );
    change(h.ctx.location);
    assert.equal((await h.call()).type, "denied");
    assert.equal(h.state.plugins + h.state.tools + h.state.forbidden, 0);
    await h.handle.dispose();
  }
});

test("Native identity and lifecycle changes after either awaited inventory retire results", async () => {
  for (const group of ["pluginList", "toolList"]) {
    for (const change of [
      "workspace",
      "project",
      "location",
      "options",
      "close",
      "cancel",
    ]) {
      const h = await host(
        new NativeLocationInfo({
          workspaceID: "wrk_native",
          project: nativeProject(),
        }),
      );
      const gate = deferred(),
        controller = new AbortController();
      h.state[group] = () => gate.promise;
      const pending = h.call(input(), {
        ...rpcContext,
        signal: controller.signal,
      });
      if (change === "workspace") h.ctx.location.workspaceID = "wrk_changed";
      if (change === "project") h.ctx.location.project.id = "changed";
      if (change === "location") h.ctx.location.directory = "/other/workspace";
      if (change === "options") h.ctx.options.nonce = "c".repeat(64);
      if (change === "close") await h.handle.dispose();
      if (change === "cancel") controller.abort();
      gate.resolve(
        group === "pluginList"
          ? { location: { directory: root }, data: [] }
          : [],
      );
      assert.equal((await pending).type, "denied");
      assert.equal(h.state.forbidden, 0);
      await h.handle.dispose();
    }
  }
});

test("late accessor or unknown private context fields refuse results without callbacks", async () => {
  let callbacks = 0;
  for (const change of [
    (ctx) =>
      Object.defineProperty(ctx, "location", {
        get() {
          callbacks++;
          throw new Error();
        },
      }),
    (ctx) =>
      Object.defineProperty(ctx, "options", {
        get() {
          callbacks++;
          throw new Error();
        },
      }),
    (ctx) =>
      Object.defineProperty(ctx.location, "workspaceID", {
        get() {
          callbacks++;
          throw new Error();
        },
      }),
    (ctx) =>
      Object.defineProperty(ctx.location.project, "id", {
        get() {
          callbacks++;
          throw new Error();
        },
      }),
    (ctx) => {
      ctx.location[Symbol("private")] = true;
    },
    (ctx) => {
      ctx.location.unknown = true;
    },
  ]) {
    const h = await host(new NativeLocationInfo({ project: nativeProject() }));
    const gate = deferred();
    h.state.pluginList = () => gate.promise;
    const pending = h.call();
    change(h.ctx);
    gate.resolve({ location: { directory: root }, data: [] });
    assert.equal((await pending).type, "denied");
    await h.handle.dispose();
  }
  assert.equal(callbacks, 0);
});

test("wrong nonce, extra keys, noncanonical context and closed scope make zero inventory calls", async () => {
  const h = await host();
  for (const request of [
    { ...input(), nonce: "c".repeat(64) },
    { ...input(), extra: true },
    { ...input(), workspacePath: "/other/workspace" },
    Object.create(input()),
  ]) {
    const result = await h.call(request);
    assert.equal(result.type, "denied");
  }
  h.ctx.location.directory = "/other/workspace";
  assert.equal((await h.call()).type, "denied");
  h.ctx.location.directory = root;
  await h.handle.dispose();
  assert.equal((await h.call()).type, "denied");
  assert.equal(h.state.plugins + h.state.tools + h.state.forbidden, 0);
});

test("group failures are independent, generic, and never empty success", async () => {
  const h = await host();
  h.state.pluginList = () => {
    throw new Error("secret exception");
  };
  let result = await h.call();
  assert.equal(result.status, "partial");
  assert.deepEqual(result.plugins, {
    status: "unavailable",
    reason: "runtime_unavailable",
  });
  h.state.toolList = () => [
    { id: "duplicate", name: "a" },
    { id: "duplicate", name: "b" },
  ];
  result = await h.call();
  assert.equal(result.status, "unavailable");
  assert.deepEqual(result.tools, {
    status: "unavailable",
    reason: "invalid_response",
  });
  assert.equal(JSON.stringify(result).includes("secret"), false);
  h.state.pluginList = () => ({ location: { directory: root }, data: [] });
  h.state.toolList = () => [];
  result = await h.call();
  assert.equal(result.status, "available");
  assert.deepEqual(result.plugins.rows, []);
  delete h.ctx.plugin;
  delete h.ctx.tool;
  assert.equal((await h.call()).status, "unavailable");
  await h.handle.dispose();
});

test("SDK location envelope is exact; malformed/getter/truncated groups fail closed", async () => {
  const h = await host();
  let getters = 0;
  for (const response of [
    [],
    { data: [], location: { directory: "/other/root" } },
    { data: [], location: { directory: root, extra: true } },
    { data: [], location: { directory: root, workspaceID: undefined } },
    { data: [], location: { directory: root, project: nativeProject() } },
    { data: [], location: new NativeLocationInfo() },
    { data: [], location: { directory: root, [Symbol("private")]: true } },
    {
      data: [],
      location: {
        get directory() {
          getters++;
          return root;
        },
      },
    },
    { data: [], location: { directory: root }, extra: true },
    {
      get data() {
        getters++;
        throw new Error();
      },
      location: { directory: root },
    },
  ]) {
    h.state.pluginList = () => response;
    assert.deepEqual((await h.call()).plugins, {
      status: "unavailable",
      reason: "invalid_response",
    });
  }
  h.state.pluginList = () => ({
    data: Array.from({ length: 129 }, rawPlugin),
    location: { directory: root },
  });
  assert.equal((await h.call()).plugins.reason, "limit_reached");
  assert.equal(getters, 0);
  await h.handle.dispose();
});

test("request and Native rows are detached before asynchronous reuse", async () => {
  const h = await host(),
    gate = deferred(),
    raw = rawPlugin(),
    request = input();
  h.state.pluginList = () => gate.promise;
  const pending = h.call(request);
  request.workspaceId = "changed";
  gate.resolve({ location: { directory: root }, data: [raw] });
  const result = await pending;
  raw.features.server = false;
  assert.equal(result.workspaceId, "workspace-one");
  assert.equal(result.plugins.rows[0].features.server, true);
  assert.equal(h.state.forbidden, 0);
  await h.handle.dispose();
});

test("close/context change/cancellation retire pending observations", async () => {
  for (const change of ["close", "location", "cancel"]) {
    const h = await host(),
      gate = deferred(),
      controller = new AbortController();
    h.state.pluginList = () => gate.promise;
    const pending = h.call(input(), {
      ...rpcContext,
      signal: controller.signal,
    });
    if (change === "close") await h.handle.dispose();
    if (change === "location") h.ctx.location.directory = "/other/workspace";
    if (change === "cancel") controller.abort();
    gate.resolve({ location: { directory: root }, data: [rawPlugin()] });
    assert.equal((await pending).type, "denied");
    await h.handle.dispose();
  }
});

test("setup refuses malformed authority and location before registration or Native lists", async () => {
  let calls = 0,
    getters = 0;
  const invalidLocations = [
    Object.assign(new NativeLocationInfo(), { unknown: true }),
    Object.assign(new NativeLocationInfo(), { [Symbol("private")]: true }),
    new NativeLocationInfo({ workspaceID: null }),
    new NativeLocationInfo({ workspaceID: "a".repeat(257) }),
    new NativeLocationInfo({ project: null }),
    new NativeLocationInfo({ project: { ...nativeProject(), extra: true } }),
    new NativeLocationInfo({
      project: { ...nativeProject(), [Symbol("private")]: true },
    }),
    new NativeLocationInfo({
      project: { ...nativeProject(), id: "a".repeat(513) },
    }),
    new NativeLocationInfo({
      project: {
        ...nativeProject(),
        id: {
          toString() {
            getters++;
            return "private";
          },
        },
      },
    }),
    new NativeLocationInfo({
      project: { ...nativeProject(), canonical: `${root}/..` },
    }),
    new NativeLocationInfo({
      project: { ...nativeProject(), directory: "relative" },
    }),
    new NativeLocationInfo({ project: Object.create(nativeProject()) }),
  ];
  for (const field of ["directory", "workspaceID", "project"]) {
    const location = new NativeLocationInfo({ project: nativeProject() });
    Object.defineProperty(location, field, {
      get() {
        getters++;
        throw new Error();
      },
    });
    invalidLocations.push(location);
  }
  for (const field of ["id", "directory", "canonical"]) {
    const project = nativeProject();
    Object.defineProperty(project, field, {
      get() {
        getters++;
        throw new Error();
      },
    });
    invalidLocations.push(new NativeLocationInfo({ project }));
  }
  for (const patch of [
    ...invalidLocations.map((location) => ({ location })),
    { options: { nonce, extra: true } },
    { options: { nonce: "b".repeat(63) } },
    {
      options: {
        get nonce() {
          getters++;
          return nonce;
        },
      },
    },
    { location: { directory: `${root}/..` } },
    { location: { directory: root, extra: true } },
    {
      location: {
        get directory() {
          getters++;
          return root;
        },
      },
    },
  ]) {
    await assert.rejects(
      setupNativeExtensions({
        options: { nonce },
        location: { directory: root },
        rpc: {
          register() {
            calls++;
          },
        },
        plugin: {
          list() {
            calls++;
          },
        },
        tool: {
          list() {
            calls++;
          },
        },
        ...patch,
      }),
      { message: "invalid_context" },
    );
  }
  assert.equal(calls, 0);
  assert.equal(getters, 0);
});

test("already cancelled and accessor inputs are refused with zero Native reads", async () => {
  const h = await host(),
    controller = new AbortController();
  controller.abort();
  assert.equal(
    (await h.call(input(), { ...rpcContext, signal: controller.signal })).type,
    "denied",
  );
  let calls = 0;
  const request = {
    ...input(),
    get workspaceId() {
      calls++;
      return "workspace-one";
    },
  };
  assert.equal((await h.call(request)).type, "denied");
  h.ctx.options.nonce = "c".repeat(64);
  assert.equal((await h.call()).type, "denied");
  assert.equal(calls + h.state.plugins + h.state.tools, 0);
  await h.handle.dispose();
});

test("both awaited groups retire late results and copy Native scalars before another group settles", async () => {
  const h = await host(),
    gate = deferred(),
    raw = rawPlugin();
  h.state.pluginList = () => ({ location: { directory: root }, data: [raw] });
  h.state.toolList = () => gate.promise;
  const pending = h.call();
  // Let the completed Plugin projection settle while the Tool list is pending.
  await Promise.resolve();
  await Promise.resolve();
  raw.features.server = false;
  gate.resolve([{ id: "ns.read", name: "read" }]);
  const result = await pending;
  assert.equal(result.plugins.rows[0].features.server, true);
  assert.equal(Object.isFrozen(result.plugins.rows[0].features), true);
  assert.throws(() => {
    result.tools.rows[0].name = "changed";
  });
  const late = deferred();
  h.state.toolList = () => late.promise;
  const waiting = h.call();
  await h.handle.dispose();
  late.resolve([]);
  assert.equal((await waiting).type, "denied");
});

test("portable result schema rejects extras without stripping them", async () => {
  const h = await host(),
    value = await h.call();
  const schema =
    NATIVE_EXTENSIONS_RPC_DEFINITION.methods.observe.output["~standard"];
  assert.equal(schema.validate(value).value, value);
  for (const bad of [
    { ...value, nonce },
    { ...value, runtimeEpoch: "epoch" },
    { ...value, status: "partial" },
    { ...value, hooks: { status: "available", rows: [] } },
  ])
    assert.ok(schema.validate(bad).issues);
  assert.throws(() => validateExtensionRpcResult("execute", value));
  await h.handle.dispose();
});

test("simplified private workspaceID stays valid with strict directory-only PublicRef", async () => {
  let handlers;
  const ctx = {
    options: { nonce },
    location: { directory: root, workspaceID: "native-workspace" },
    plugin: {
      async list() {
        return { location: { directory: root }, data: [] };
      },
    },
    tool: {
      async list() {
        return [];
      },
    },
    rpc: {
      async register(_definition, callbacks) {
        handlers = callbacks;
        return { async dispose() {} };
      },
    },
  };
  const handle = await setupNativeExtensions(ctx);
  assert.equal(
    (await handlers.observe(input(), rpcContext)).status,
    "available",
  );
  ctx.plugin.list = async () => ({
    location: { directory: root, workspaceID: "other-native" },
    data: [],
  });
  assert.equal(
    (await handlers.observe(input(), rpcContext)).plugins.reason,
    "invalid_response",
  );
  ctx.location.workspaceID = "changed-native";
  assert.equal((await handlers.observe(input(), rpcContext)).type, "denied");
  await handle.dispose();
});

test("RPC setup/cleanup failure is generic and disposal is idempotent", async () => {
  let handlers,
    disposed = 0;
  const ctx = {
    options: { nonce },
    location: { directory: root },
    rpc: {
      async register() {
        throw new Error("private credential diagnostic");
      },
    },
  };
  await assert.rejects(setupNativeExtensions(ctx), {
    message: "Native extension setup failed.",
  });
  ctx.rpc.register = async (_definition, callbacks) => {
    handlers = callbacks;
    return {
      async dispose() {
        disposed++;
        throw new Error("private credential diagnostic");
      },
    };
  };
  const handle = await setupNativeExtensions(ctx);
  await assert.rejects(handle.dispose(), {
    message: "Native extension cleanup failed.",
  });
  await assert.rejects(handle.dispose(), {
    message: "Native extension cleanup failed.",
  });
  assert.equal(disposed, 1);
  assert.equal((await handlers.observe(input(), rpcContext)).type, "denied");
});
