import test from "node:test";
import assert from "node:assert/strict";
import { setupNativeAgents } from "./builtins/workbench-skills/agents.mjs";
import {
  NATIVE_AGENTS_RPC,
  NATIVE_AGENT_LIMITS,
  nativeAgentId,
  nativeAgentDigest,
  validateAgentRpcResult,
} from "./native-agents-protocol.mjs";
import { BASELINE_POLICY } from "./renderer/shared/configuration-draft/policy.mjs";

const root = "/synthetic/workspace";
const nonce = "b".repeat(64);
const clone = (v) => globalThis.structuredClone(v);
const context = {
  error: (type, message, data) =>
    Object.assign(new Error(message), { type, data }),
};
const observe = (extra = {}) => ({
  nonce,
  workspaceId: "workspace-one",
  workspacePath: root,
  ...extra,
});
function register(operationId = "register-one", sourceName = "demo") {
  const owner = {
    runtimeEpoch: "epoch-one",
    operationId,
    workspaceId: "workspace-one",
    workspacePath: root,
    sourceName,
    digest: "a".repeat(64),
  };
  const record = {
    id: nativeAgentId(owner),
    name: sourceName,
    system: "Synthetic system text",
    description: "Synthetic description",
    color: "#123abc",
    mode: "primary",
    hidden: false,
    request: { settings: {}, headers: {}, body: {} },
    permissions: clone(BASELINE_POLICY),
  };
  return {
    nonce,
    owner,
    record,
    recordDigest: nativeAgentDigest(record),
    expectedNativeId: null,
  };
}
const remove = (request, operationId = "remove-one") => ({
  nonce,
  owner: { ...request.owner, operationId },
  registration: clone(request.owner),
  nativeId: request.record.id,
  recordDigest: request.recordDigest,
});
const foreign = (id = "actual-default", extra = {}) => ({
  id,
  name: "Foreign Agent",
  mode: "primary",
  hidden: false,
  model: { provider: "private", model: "secret" },
  system: "Private foreign system",
  request: {
    settings: { secret: true },
    headers: { token: "secret" },
    body: {},
  },
  permissions: [{ action: "*", resource: "*", effect: "allow" }],
  ...extra,
});
const projection = ({ id, name, mode, hidden }) => ({ id, name, mode, hidden });
const globalDeny = { action: "*", resource: "*", effect: "deny" };
function deferred() {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
}

// Synthetic pinned behavior: each reload rebuilds from base. Missing update IDs
// receive permissive defaults and resource allow rules BEFORE the callback.
async function host({
  base = [foreign()],
  options = { nonce },
  directory = root,
  postConfig = false,
} = {}) {
  const transforms = new Set();
  const state = {
    base: clone(base),
    native: new Map(),
    reloads: 0,
    lists: 0,
    updates: 0,
    transforms: 0,
    disposals: [],
    swallow: false,
  };
  function recompute() {
    const next = new Map(state.base.map((r) => [r.id, clone(r)]));
    const editor = {
      list: () => [...next.values()],
      default() {
        throw new Error("Default mutation forbidden");
      },
      update(id, change) {
        state.updates++;
        const current = next.get(id) ?? {
          id,
          name: id,
          mode: "primary",
          hidden: false,
          request: { settings: {}, headers: {}, body: {} },
          permissions: [
            { action: "*", resource: "*", effect: "allow" },
            { action: "external_directory", resource: "*", effect: "ask" },
            { action: "read", resource: "*.env", effect: "ask" },
            {
              action: "external_directory",
              resource: "/synthetic/data/*",
              effect: "allow",
            },
          ],
          // Detect incomplete overwrites under future defaults too.
          model: { provider: "inherited", model: "inherited" },
          steps: 7,
        };
        next.set(id, current);
        change(current);
        current.id = id;
      },
      remove: (id) => next.delete(id),
    };
    for (const transform of transforms) {
      try {
        assert.equal(transform(editor), undefined);
      } catch (error) {
        if (!state.swallow) throw error;
        transforms.clear();
        return recompute();
      }
    }
    state.afterTransform?.(next);
    state.native = next;
  }
  const ctx = {
    options,
    location: { directory },
    agent: {
      async transform(callback) {
        state.transforms++;
        transforms.add(callback);
        recompute();
        await state.beforeTransformReturn?.();
        return {
          async dispose() {
            state.disposals.push("transform");
            transforms.delete(callback);
            recompute();
          },
        };
      },
      async reload() {
        state.reloads++;
        await state.beforeReload?.();
        recompute();
      },
      async list() {
        state.lists++;
        return state.listOverride
          ? state.listOverride()
          : {
              location: { directory },
              data: clone([...state.native.values()]),
            };
      },
    },
    rpc: {
      async register(definition, handlers) {
        assert.equal(definition, NATIVE_AGENTS_RPC);
        state.rpcHandlers ??= new Map();
        assert.equal(state.rpcHandlers.has(definition.id), false);
        state.rpcHandlers.set(definition.id, handlers);
        state.handlers = handlers;
        return {
          async dispose() {
            state.disposals.push("rpc");
          },
        };
      },
    },
  };
  recompute();
  const registration = await setupNativeAgents(ctx);
  if (postConfig) {
    // Native installs ConfigAgentPlugin after configured plugins finish setup.
    transforms.add((editor) => {
      for (const row of editor.list())
        editor.update(row.id, (record) => {
          record.permissions.push(clone(globalDeny));
        });
    });
    recompute();
  }
  return {
    state,
    ctx,
    recompute,
    activeTransforms: () => transforms.size,
    close: () => registration.dispose(),
    call: (method, input, rpcContext = context) =>
      state.rpcHandlers.get(NATIVE_AGENTS_RPC.id)[method](input, rpcContext),
  };
}
function denied(result, code) {
  assert.ok(result instanceof Error);
  assert.equal(result.type, "denied");
  assert.deepEqual(result.data, { code });
  assert.equal(result.message, "Native Agent request denied.");
}

test("post-config global deny stays on builtins while lazy owned rows keep exactly three baseline rules", async () => {
  const h = await host({ postConfig: true });
  const builtin = {
    ...foreign(),
    permissions: [...foreign().permissions, globalDeny],
  };
  const request = register();
  const result = await h.call("register", request);
  assert.equal(result.status, "registered");
  assert.deepEqual(h.state.native.get(request.record.id), request.record);
  assert.equal(h.state.native.get(request.record.id).permissions.length, 3);
  assert.deepEqual(h.state.native.get("actual-default"), builtin);
  assert.equal(result.defaultAgentId, "actual-default");
  const second = register("second", "second");
  assert.equal((await h.call("register", second)).status, "registered");
  assert.deepEqual(h.state.native.get(request.record.id), request.record);
  assert.deepEqual(h.state.native.get(second.record.id), second.record);
  assert.equal((await h.call("remove", remove(request))).status, "removed");
  assert.equal(
    (await h.call("remove", remove(second, "remove-second"))).status,
    "removed",
  );
  assert.deepEqual(h.state.native.get("actual-default"), builtin);
  assert.equal(h.state.transforms, 1);
  await h.close();
  assert.equal(h.activeTransforms(), 1); // Only Native's post-config hook remains.
});

test("observe and predispatch refusals install zero Agent transforms", async () => {
  const request = register();
  const h = await host({ base: [foreign(), request.record] });
  assert.equal(h.state.transforms, 0);
  assert.equal((await h.call("observe", observe())).status, "ready");
  denied(
    await h.call("register", { ...request, nonce: "c".repeat(64) }),
    "nonce_mismatch",
  );
  denied(
    await h.call("register", { ...request, extra: true }),
    "invalid_context",
  );
  denied(await h.call("register", request), "collision");
  denied(await h.call("remove", remove(request)), "changed");
  assert.equal(h.state.transforms, 0);
  assert.equal(h.state.reloads, 0);
  await h.close();
  assert.deepEqual(h.state.disposals, ["rpc"]);
});

test("explicit lifecycle uses actual default and exact replacement of permissive Native defaults", async () => {
  const h = await host();
  assert.equal(h.state.reloads, 0);
  assert.equal(h.state.updates, 0);
  assert.deepEqual(Object.keys(h.state.handlers).sort(), [
    "observe",
    "register",
    "remove",
  ]);
  const initial = await h.call("observe", observe());
  assert.equal(initial.defaultAgentId, "actual-default");
  assert.deepEqual(initial.native, [projection(foreign())]);
  const request = register();
  const result = await h.call("register", request);
  validateAgentRpcResult("register", result);
  assert.deepEqual(result, {
    status: "registered",
    owner: request.owner,
    record: request.record,
    recordDigest: request.recordDigest,
    defaultAgentId: "actual-default",
  });
  assert.deepEqual(h.state.native.get(request.record.id), request.record);
  assert.deepEqual(h.state.native.get("actual-default"), foreign());
  assert.equal(Object.isFrozen(result.record.permissions[0]), true);
  const observed = await h.call("observe", observe());
  validateAgentRpcResult("observe", observed);
  assert.deepEqual(observed.rows, [
    {
      owner: request.owner,
      record: request.record,
      recordDigest: request.recordDigest,
    },
  ]);
  assert.deepEqual(observed.native, [
    projection(foreign()),
    projection(request.record),
  ]);
  const removal = remove(request);
  const removed = await h.call("remove", removal);
  validateAgentRpcResult("remove", removed);
  assert.deepEqual(removed, {
    status: "removed",
    owner: removal.owner,
    registration: request.owner,
    nativeId: request.record.id,
    recordDigest: request.recordDigest,
    defaultAgentId: "actual-default",
  });
  assert.deepEqual([...h.state.native.values()], [foreign()]);
  await h.close();
  assert.deepEqual(h.state.disposals.sort(), ["rpc", "transform"]);
});

test("setup validates exact nonce options and canonical root before registration", async () => {
  for (const args of [
    { options: {} },
    { options: { nonce, extra: true } },
    { options: { nonce: "B".repeat(64) } },
    { directory: "/" },
    { directory: "relative" },
    { directory: root + "/../workspace" },
    { directory: root + "/" },
  ])
    await assert.rejects(host(args), /invalid_context/);
  let accesses = 0;
  await assert.rejects(
    host({
      options: {
        get nonce() {
          accesses++;
          return nonce;
        },
      },
    }),
    /invalid_context/,
  );
  assert.equal(accesses, 0);
});

test("direct handler rejects nonce, schema, root, record and owner violations before effects", async () => {
  const h = await host();
  const r = register();
  let accesses = 0;
  for (const input of [
    { ...r, extra: true },
    { ...r, owner: { ...r.owner, extra: true } },
    { ...r, owner: { ...r.owner, workspacePath: "/other/root" } },
    { ...r, owner: { ...r.owner, workspacePath: root + "/../workspace" } },
    { ...r, record: { ...r.record, model: {} } },
    { ...r, record: { ...r.record, hidden: true } },
    {
      ...r,
      record: {
        ...r.record,
        request: { settings: {}, headers: { token: "secret" }, body: {} },
      },
    },
    {
      ...r,
      record: {
        ...r.record,
        permissions: [{ action: "*", resource: "*", effect: "allow" }],
      },
    },
    {
      ...r,
      record: {
        ...r.record,
        get system() {
          accesses++;
          return "inert";
        },
      },
    },
    { ...r, recordDigest: "f".repeat(64) },
    { ...r, expectedNativeId: r.record.id },
  ])
    denied(await h.call("register", input), "invalid_context");
  const hooked = clone(r);
  hooked.record.permissions.toJSON = () => {
    accesses++;
    return [];
  };
  denied(await h.call("register", hooked), "invalid_context");
  denied(
    await h.call("observe", { ...observe(), extra: true }),
    "invalid_context",
  );
  denied(
    await h.call("observe", observe({ workspacePath: "/other/root" })),
    "invalid_context",
  );
  denied(
    await h.call("observe", observe({ nonce: "c".repeat(64) })),
    "nonce_mismatch",
  );
  denied(
    await h.call("remove", { ...remove(r), extra: true }),
    "invalid_context",
  );
  await assert.rejects(
    h.call("observe", observe({ nonce: "c".repeat(64) }), {}),
    (error) => {
      assert.deepEqual(error.data, { code: "nonce_mismatch" });
      return true;
    },
  );
  assert.equal(accesses, 0);
  assert.equal(h.state.lists, 0);
  assert.equal(h.state.reloads, 0);
  assert.equal(h.state.updates, 0);
  await h.close();
});

test("foreign rows are minimal read-only projections, even with matching IDs and bytes", async () => {
  const r = register();
  const h = await host({
    base: [foreign(), r.record, foreign("omoc-agent-" + "f".repeat(64))],
  });
  const observed = await h.call("observe", observe());
  assert.deepEqual(observed.rows, []);
  assert.deepEqual(observed.native, h.state.base.map(projection));
  denied(await h.call("register", r), "collision");
  denied(await h.call("remove", remove(r)), "changed");
  assert.equal(h.state.updates, 0);
  assert.equal(h.state.reloads, 0);
  let reads = 0;
  const privateRow = foreign();
  Object.defineProperty(privateRow, "system", {
    get() {
      reads++;
      throw new Error("private");
    },
  });
  h.state.listOverride = () => ({
    location: { directory: root },
    data: [privateRow],
  });
  assert.deepEqual((await h.call("observe", observe())).native, [
    projection(foreign()),
  ]);
  assert.equal(reads, 0);
  await h.close();
});

test("register never replaces a source and removal requires exact original ownership", async () => {
  const h = await host();
  const r = register();
  await h.call("register", r);
  denied(await h.call("register", register("new-key")), "changed");
  for (const [key, value] of [
    ["digest", "f".repeat(64)],
    ["runtimeEpoch", "other-epoch"],
    ["operationId", "other-registration"],
  ]) {
    const input = remove(r, "bad-" + key);
    input.registration[key] = value;
    input.nativeId = nativeAgentId(input.registration);
    denied(await h.call("remove", input), "changed");
  }
  const wrong = remove(r, "wrong-digest");
  wrong.recordDigest = "c".repeat(64);
  denied(await h.call("remove", wrong), "changed");
  assert.deepEqual(
    await h.call("observe", observe({ workspaceId: "workspace-two" })),
    { status: "unavailable", reason: "identity_conflict" },
  );
  assert.equal(h.state.reloads, 1);
  await h.close();
});

test("complete owned public row must match, including no model or unknown fields", async () => {
  for (const change of [
    (r) => {
      r.system = "Changed system";
    },
    (r) => {
      r.model = { provider: "secret", model: "secret" };
    },
    (r) => {
      r.steps = 1;
    },
    (r) => {
      r.request.headers.token = "secret";
    },
    (r) => {
      r.permissions.push({ action: "*", resource: "*", effect: "allow" });
    },
    (r) => {
      r.hidden = true;
    },
  ]) {
    const h = await host();
    const r = register();
    await h.call("register", r);
    change(h.state.native.get(r.record.id));
    assert.deepEqual(await h.call("observe", observe()), {
      status: "unavailable",
      reason: "identity_conflict",
    });
    denied(await h.call("remove", remove(r)), "changed");
    assert.equal(h.state.reloads, 1);
    await h.close();
  }
});

test("original key duplicate never replays after removal and changed digest or method conflicts", async () => {
  const h = await host();
  const r = register();
  const first = await h.call("register", r);
  assert.equal(await h.call("register", clone(r)), first);
  const reordered = Object.fromEntries(Object.entries(r).reverse());
  reordered.owner = Object.fromEntries(Object.entries(r.owner).reverse());
  reordered.record = Object.fromEntries(Object.entries(r.record).reverse());
  assert.equal(await h.call("register", reordered), first);
  const conflict = clone(r);
  conflict.record.system = "Different";
  conflict.recordDigest = nativeAgentDigest(conflict.record);
  denied(await h.call("register", conflict), "identity_conflict");
  denied(
    await h.call("remove", remove(r, r.owner.operationId)),
    "identity_conflict",
  );
  const removal = remove(r);
  const removed = await h.call("remove", removal);
  assert.equal(await h.call("remove", removal), removed);
  assert.equal(await h.call("register", r), first);
  assert.equal(h.state.native.has(r.record.id), false);
  assert.equal(h.state.reloads, 2);
  await h.close();
});

test("original denial remains cached after collision disappears", async () => {
  const r = register();
  const h = await host({ base: [foreign(), r.record] });
  denied(await h.call("register", r), "collision");
  h.state.base = [foreign()];
  h.recompute();
  denied(await h.call("register", clone(r)), "collision");
  assert.equal(h.state.reloads, 0);
  assert.equal(
    (await h.call("register", register("fresh"))).status,
    "registered",
  );
  await h.close();
});

test("queued input and pending duplicates are immutable and serialized", async () => {
  const h = await host();
  const entered = deferred();
  const release = deferred();
  h.state.beforeReload = () => {
    entered.resolve();
    return release.promise;
  };
  const r = register();
  const expected = clone(r);
  const first = h.call("register", r);
  await entered.promise;
  const next = register("next", "next-source");
  const expectedNext = clone(next);
  const second = h.call("register", next);
  const duplicate = h.call("register", clone(expected));
  const read = h.call("observe", observe());
  r.owner.digest = "f".repeat(64);
  r.record.system = "mutated";
  next.record.permissions[0].effect = "allow";
  next.record.system = "queued mutation";
  assert.equal(h.state.reloads, 1);
  release.resolve();
  const result = await first;
  assert.deepEqual(result.record, expected.record);
  assert.equal(await duplicate, result);
  assert.deepEqual((await second).record, expectedNext.record);
  assert.equal((await read).rows.length, 2);
  assert.equal(h.state.reloads, 2);
  assert.equal(h.state.transforms, 1);
  await h.close();
});

test("reload failures retain original unknown and desired state without replay or rollback", async () => {
  for (const removing of [false, true]) {
    const h = await host();
    const r = register();
    if (removing) await h.call("register", r);
    h.state.beforeReload = () => {
      throw new Error("Private diagnostic");
    };
    const method = removing ? "remove" : "register";
    const input = removing ? remove(r) : r;
    const result = await h.call(method, input);
    assert.deepEqual(result, { status: "unknown", reason: "reload_failed" });
    assert.equal(await h.call(method, clone(input)), result);
    denied(
      await h.call("register", register("after-unknown", "other")),
      "changed",
    );
    assert.equal(h.state.native.has(r.record.id), removing);
    const reloads = h.state.reloads;
    h.state.beforeReload = undefined;
    await h.ctx.agent.reload();
    assert.equal(h.state.native.has(r.record.id), !removing);
    assert.equal(await h.call(method, input), result);
    assert.equal(h.state.reloads, reloads + 1);
    await h.close();
  }
});

test("collision preflight checks ALL desired rows before update, even when State.group swallows failure", async () => {
  for (const swallow of [false, true]) {
    const h = await host();
    const first = register();
    const second = register("second", "second");
    await h.call("register", first);
    const writes = h.state.updates;
    h.state.swallow = swallow;
    h.state.beforeReload = () => {
      h.state.base.push(clone(second.record));
    };
    const result = await h.call("register", second);
    assert.deepEqual(result, {
      status: "unknown",
      reason: swallow ? "verification_failed" : "reload_failed",
    });
    assert.equal(h.state.updates, writes);
    assert.equal(await h.call("register", second), result);
    assert.deepEqual(await h.call("observe", observe()), {
      status: "unavailable",
      reason: "identity_conflict",
    });
    denied(await h.call("register", register("third", "third")), "changed");
    h.state.beforeReload = undefined;
    await h.close();
  }
});

test("post-effect missing, changed, model-inherited and default-drift rows remain unknown", async () => {
  for (const mode of ["missing", "system", "model", "default"]) {
    const h = await host();
    const r = register();
    h.state.afterTransform = (map) => {
      if (!map.has(r.record.id)) return;
      if (mode === "missing") map.delete(r.record.id);
      if (mode === "system") map.get(r.record.id).system = "changed";
      if (mode === "model") map.get(r.record.id).model = {};
      if (mode === "default") {
        const original = map.get("actual-default");
        map.delete("actual-default");
        map.set("actual-default", original);
      }
    };
    const result = await h.call("register", r);
    assert.deepEqual(result, {
      status: "unknown",
      reason: "verification_failed",
    });
    assert.equal(await h.call("register", r), result);
    assert.equal(h.state.reloads, 1);
    h.state.afterTransform = undefined;
    await h.close();
  }
});

test("remove never fabricates absence or default preservation after effects", async () => {
  for (const mode of ["retained", "default"]) {
    const h = await host({ base: [foreign(), foreign("other-default")] });
    const r = register();
    await h.call("register", r);
    h.state.afterTransform = (map) => {
      if (mode === "retained") map.set(r.record.id, clone(r.record));
      else map.delete("actual-default");
    };
    const removal = remove(r);
    const result = await h.call("remove", removal);
    assert.deepEqual(result, {
      status: "unknown",
      reason: "verification_failed",
    });
    assert.equal(await h.call("remove", removal), result);
    assert.deepEqual((await h.call("observe", observe())).rows, []);
    h.state.afterTransform = undefined;
    await h.close();
  }
});

test("default must exist before registration and owned default cannot be removed", async () => {
  const empty = await host({ base: [] });
  assert.equal((await empty.call("observe", observe())).defaultAgentId, null);
  denied(await empty.call("register", register()), "changed");
  assert.equal(empty.state.reloads, 0);
  assert.equal(empty.state.transforms, 0);
  await empty.close();
  const h = await host();
  const r = register();
  await h.call("register", r);
  const builtin = h.state.native.get("actual-default");
  h.state.native.delete("actual-default");
  h.state.native.set("actual-default", builtin);
  denied(await h.call("remove", remove(r)), "changed");
  assert.equal(h.state.reloads, 1);
  await h.close();
});

test("actual Promise located list rejects malformed, duplicate, cross-root and oversized results", async () => {
  const h = await host();
  for (const [output, reason] of [
    [{ data: [] }, "runtime_error"],
    [{ location: { directory: "/other/root" }, data: [] }, "runtime_error"],
    [{ location: { directory: root }, data: {} }, "runtime_error"],
    [
      { location: { directory: root }, data: [foreign(), foreign()] },
      "identity_conflict",
    ],
    [
      {
        location: { directory: root },
        data: [{ id: "x", name: "x", mode: "invalid", hidden: false }],
      },
      "identity_conflict",
    ],
    [
      {
        location: { directory: root },
        data: Array.from({ length: 65 }, (_, i) => foreign(`foreign-${i}`)),
      },
      "retained_limit",
    ],
    [{ location: { directory: root }, data: Array(1) }, "identity_conflict"],
  ]) {
    h.state.listOverride = () => output;
    assert.deepEqual(await h.call("observe", observe()), {
      status: "unavailable",
      reason,
    });
  }
  h.state.listOverride = undefined;
  await h.close();
});

test("read errors are safe before effects and cached unknown after effects", async () => {
  const h = await host();
  const failure = () => {
    throw new Error("Private Native content");
  };
  h.state.listOverride = failure;
  assert.deepEqual(await h.call("observe", observe()), {
    status: "unavailable",
    reason: "runtime_error",
  });
  denied(await h.call("register", register("before-failure")), "changed");
  assert.equal(h.state.reloads, 0);
  h.state.listOverride = undefined;
  h.state.afterTransform = () => {
    h.state.listOverride = failure;
  };
  const r = register();
  const result = await h.call("register", r);
  assert.deepEqual(result, {
    status: "unknown",
    reason: "verification_failed",
  });
  h.state.listOverride = undefined;
  assert.equal(await h.call("register", r), result);
  h.state.afterTransform = undefined;
  await h.close();
});

test("context drift during awaited reads refuses before effects and remains unknown afterward", async () => {
  for (const afterEffect of [false, true]) {
    const h = await host();
    const r = register();
    if (afterEffect)
      h.state.beforeReload = () => {
        h.state.afterTransform = () => {
          h.ctx.location.directory = "/other/root";
        };
      };
    else
      h.state.listOverride = () => {
        h.ctx.location.directory = "/other/root";
        return { location: { directory: root }, data: [foreign()] };
      };
    const result = await h.call("register", r);
    if (afterEffect)
      assert.deepEqual(result, {
        status: "unknown",
        reason: "verification_failed",
      });
    else denied(result, "invalid_context");
    assert.equal(h.state.reloads, afterEffect ? 1 : 0);
    h.state.afterTransform = undefined;
    h.state.listOverride = undefined;
    await h.close();
  }
});

test("owned and public row capacity refuse before mutation", async () => {
  const h = await host();
  for (let i = 0; i < NATIVE_AGENT_LIMITS.owned; i++)
    assert.equal(
      (await h.call("register", register(`op-${i}`, `source-${i}`))).status,
      "registered",
    );
  denied(
    await h.call("register", register("overflow", "overflow")),
    "retained_limit",
  );
  assert.equal(h.state.reloads, 16);
  await h.close();
  const full = await host({
    base: Array.from({ length: 64 }, (_, i) => foreign(`foreign-${i}`)),
  });
  denied(await full.call("register", register()), "retained_limit");
  assert.equal(full.state.reloads, 0);
  assert.equal(full.state.updates, 0);
  assert.equal(full.state.transforms, 0);
  await full.close();
});

test("operation cache never evicts original keys, including denials", async () => {
  const h = await host();
  const r = register();
  const original = await h.call("register", r);
  await h.call("remove", remove(r));
  for (let i = 2; i < NATIVE_AGENT_LIMITS.operations; i++)
    denied(await h.call("remove", remove(r, `absent-${i}`)), "changed");
  denied(await h.call("register", register("overflow")), "retained_limit");
  assert.equal(await h.call("register", r), original);
  assert.equal(h.state.reloads, 2);
  await h.close();
});

test("pending duplicate and conflict lookup precede bounded queue admission", async () => {
  const h = await host();
  const entered = deferred();
  const release = deferred();
  h.state.beforeReload = () => {
    entered.resolve();
    return release.promise;
  };
  const r = register();
  const first = h.call("register", r);
  await entered.promise;
  const reads = Array.from({ length: 255 }, () => h.call("observe", observe()));
  denied(await h.call("observe", observe()), "retained_limit");
  const duplicate = h.call("register", clone(r));
  const conflict = clone(r);
  conflict.owner.digest = "c".repeat(64);
  denied(await h.call("register", conflict), "identity_conflict");
  const waiting = register("waiting", "other");
  denied(await h.call("register", waiting), "retained_limit");
  release.resolve();
  const original = await first;
  assert.equal(await duplicate, original);
  assert.equal(
    (await Promise.all(reads)).every((r) => r.rows.length === 1),
    true,
  );
  assert.equal(h.state.reloads, 1);
  assert.equal((await h.call("register", waiting)).status, "registered");
  await h.close();
});

test("dispose does not await reload queue and prevents late effects or ownership settlement", async () => {
  const h = await host();
  const entered = deferred();
  const release = deferred();
  h.state.beforeReload = () => {
    entered.resolve();
    return release.promise;
  };
  const r = register();
  const first = h.call("register", r);
  await entered.promise;
  const second = h.call("register", register("late", "late"));
  await h.close();
  await h.close();
  release.resolve();
  assert.deepEqual(await first, {
    status: "unknown",
    reason: "verification_failed",
  });
  denied(await second, "invalid_context");
  denied(await h.call("observe", observe()), "invalid_context");
  assert.equal(h.state.native.has(r.record.id), false);
  assert.equal(h.state.reloads, 1);
  assert.deepEqual(h.state.disposals.sort(), ["rpc", "transform"]);
});

test("reload can itself await dispose without deadlocking", async () => {
  const h = await host();
  h.state.beforeReload = () => h.close();
  assert.deepEqual(await h.call("register", register()), {
    status: "unknown",
    reason: "verification_failed",
  });
  assert.equal(h.state.native.size, 1);
});

test(
  "late async transform registration disposes itself after close without settling ownership",
  { timeout: 1000 },
  async () => {
    const h = await host();
    const entered = deferred();
    const release = deferred();
    h.state.beforeTransformReturn = () => {
      entered.resolve();
      return release.promise;
    };
    const r = register();
    const pending = h.call("register", r);
    await entered.promise;
    const duplicate = h.call("register", clone(r));
    const queued = h.call("register", register("queued", "queued"));
    await h.close();
    assert.deepEqual(h.state.disposals, ["rpc"]);
    release.resolve();
    const result = await pending;
    assert.deepEqual(result, {
      status: "unknown",
      reason: "verification_failed",
    });
    assert.equal(await duplicate, result);
    denied(await queued, "invalid_context");
    assert.equal(h.activeTransforms(), 0);
    assert.equal(h.state.transforms, 1);
    assert.equal(h.state.reloads, 0);
    assert.equal(h.state.native.has(r.record.id), false);
    assert.deepEqual(h.state.disposals.sort(), ["rpc", "transform"]);
    await h.close();
    assert.equal(h.state.disposals.length, 2);
  },
);

test(
  "transform registration can itself await dispose without deadlocking",
  { timeout: 1000 },
  async () => {
    const h = await host();
    h.state.beforeTransformReturn = () => h.close();
    assert.deepEqual(await h.call("register", register()), {
      status: "unknown",
      reason: "verification_failed",
    });
    assert.equal(h.activeTransforms(), 0);
    assert.equal(h.state.reloads, 0);
  },
);

test("transform registration failure caches unknown and poisons fresh mutations without retry", async () => {
  const h = await host();
  let attempts = 0;
  h.ctx.agent.transform = async () => {
    attempts++;
    throw new Error("Private transform failure");
  };
  const r = register();
  const result = await h.call("register", r);
  assert.deepEqual(result, {
    status: "unknown",
    reason: "verification_failed",
  });
  assert.equal(await h.call("register", clone(r)), result);
  denied(await h.call("register", register("fresh", "fresh")), "changed");
  assert.equal(attempts, 1);
  assert.equal(h.state.reloads, 0);
  assert.deepEqual((await h.call("observe", observe())).rows, []);
  await h.close();
});

test("async hook installation rechecks Native collision, default, capacity, reads and current location before publishing", async () => {
  for (const mode of ["collision", "default", "capacity", "read", "location"]) {
    const h = await host();
    const r = register();
    h.state.beforeTransformReturn = () => {
      if (mode === "collision")
        h.state.native.set(r.record.id, clone(r.record));
      if (mode === "default") h.state.native.delete("actual-default");
      if (mode === "capacity")
        for (let i = 0; i < 63; i++)
          h.state.native.set(`extra-${i}`, foreign(`extra-${i}`));
      if (mode === "read")
        h.state.listOverride = () => {
          throw new Error("Private read failure");
        };
      if (mode === "location") h.ctx.location.directory = "/other/root";
    };
    const result = await h.call("register", r);
    assert.deepEqual(result, {
      status: "unknown",
      reason: "verification_failed",
    });
    assert.equal(h.state.reloads, 0);
    assert.equal(h.state.updates, 0);
    if (mode !== "location") {
      assert.equal(await h.call("register", clone(r)), result);
      denied(await h.call("register", register("fresh", "fresh")), "changed");
      h.state.listOverride = undefined;
      assert.deepEqual((await h.call("observe", observe())).rows, []);
    }
    await h.close();
    assert.equal(h.activeTransforms(), 0);
  }
});

test("RPC setup failure never installs an Agent transform or exposes raw diagnostics", async () => {
  let disposed = 0;
  await assert.rejects(
    setupNativeAgents({
      options: { nonce },
      location: { directory: root },
      agent: {
        async transform() {
          return {
            async dispose() {
              disposed++;
            },
          };
        },
      },
      rpc: {
        async register() {
          throw new Error("Private setup content");
        },
      },
    }),
    { message: "Native Agent setup failed." },
  );
  assert.equal(disposed, 0);
});

test("new instance never restores previous ownership or autoloads records", async () => {
  const h = await host();
  await h.call("register", register());
  await h.close();
  const reopened = await host();
  assert.deepEqual((await reopened.call("observe", observe())).rows, []);
  assert.equal(reopened.state.updates, 0);
  assert.equal(reopened.state.reloads, 0);
  await reopened.close();
});
