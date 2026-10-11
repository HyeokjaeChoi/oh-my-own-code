import test from "node:test";
import assert from "node:assert/strict";
import plugin from "./builtins/workbench-skills/server.mjs";
import metadata from "./builtins/workbench-skills/package.json" with { type: "json" };
import { NATIVE_AGENTS_RPC } from "./native-agents-protocol.mjs";
import { NATIVE_EXTENSIONS_RPC_DEFINITION } from "./native-extensions-protocol.mjs";
import {
  NATIVE_SKILLS_RPC,
  NATIVE_SKILL_LIMITS,
  nativeSkillId,
  nativeSkillDigest,
} from "./native-skills-protocol.mjs";

const root = "/synthetic/workspace";
const nonce = "b".repeat(64);
const clone = (value) => globalThis.structuredClone(value);
const rpcContext = {
  error(type, message, data) {
    return Object.assign(new Error(message), { type, data });
  },
};
const owner = (
  operationId = "register-one",
  sourceName = "demo",
  extra = {},
) => ({
  runtimeEpoch: "epoch-one",
  operationId,
  workspaceId: "workspace-one",
  workspacePath: root,
  sourceName,
  digest: "a".repeat(64),
  ...extra,
});
function register(operationId, sourceName, extra = {}) {
  const identity = owner(operationId, sourceName, extra);
  const record = {
    id: nativeSkillId(identity),
    name: "Synthetic Skill",
    autoinvoke: false,
    path: `${identity.workspacePath}/.opencode/skills/${identity.sourceName}/SKILL.md`,
    content: "# Synthetic\r\nOnly inert test content.\r\n",
  };
  return {
    nonce,
    owner: identity,
    record,
    recordDigest: nativeSkillDigest(record),
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
const observe = (extra = {}) => ({
  nonce,
  workspaceId: "workspace-one",
  workspacePath: root,
  ...extra,
});
const foreign = (id = "foreign", extra = {}) => ({
  id,
  name: "Foreign Skill",
  path: "/synthetic/foreign/SKILL.md",
  content: "Foreign inert content",
  ...extra,
});
function deferred() {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
}

// Pinned State.create starts with an EMPTY map and synchronously runs transforms
// on each invalidation. SkillEditor.add copies the record and can overwrite IDs.
// A base here represents earlier foreign transforms, never a retained old map.
async function host({ base = [], options = { nonce }, directory = root } = {}) {
  const transforms = new Set();
  const state = {
    base: clone(base),
    native: new Map(),
    reloads: 0,
    lists: 0,
    disposals: [],
    afterTransform: undefined,
    beforeReload: undefined,
    listOverride: undefined,
    swallowTransformFailure: false,
  };
  function recompute() {
    const next = new Map(
      state.base.map((record) => [record.id, clone(record)]),
    );
    const editor = {
      list: () => [...next.values()],
      get: (id) => next.get(id),
      add: (record) => next.set(record.id, { ...record }),
      remove: (id) => next.delete(id),
      update: (id, change) => change(next.get(id)),
    };
    for (const transform of transforms) {
      try {
        assert.equal(transform(editor), undefined);
      } catch (error) {
        if (!state.swallowTransformFailure) throw error;
        // State.group disables its transforms and State.get retries from base.
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
      async transform() {
        throw new Error("Skills must not install Agent transforms");
      },
      async reload() {
        throw new Error("Skills must not reload Agents");
      },
      async list() {
        throw new Error("Skills must not read Agents");
      },
    },
    skill: {
      async transform(callback) {
        transforms.add(callback);
        recompute();
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
        if (definition.id === NATIVE_EXTENSIONS_RPC_DEFINITION.id) {
          state.extensionHandlers = handlers;
          return {
            async dispose() {
              state.disposals.push("extension-rpc");
            },
          };
        }
        if (definition === NATIVE_AGENTS_RPC) {
          state.agentHandlers = handlers;
          return {
            async dispose() {
              state.disposals.push("agent-rpc");
            },
          };
        }
        assert.equal(definition, NATIVE_SKILLS_RPC);
        state.handlers = handlers;
        return {
          async dispose() {
            state.disposals.push("rpc");
          },
        };
      },
    },
  };
  const close = await plugin.setup(ctx);
  return {
    state,
    ctx,
    close,
    recompute,
    call: (method, input, context = rpcContext) =>
      state.handlers[method](input, context),
  };
}
function denied(result, code) {
  assert.ok(result instanceof Error);
  assert.equal(result.type, "denied");
  assert.deepEqual(result.data, { code });
  assert.equal(result.message.includes(nonce), false);
}

test("fixed DIRECTORY package has only the closed local metadata", () => {
  assert.deepEqual(metadata, {
    name: "@oh-my-own-code/workbench-skills",
    private: true,
    type: "module",
    version: "1.0.0",
  });
});

test("setup registers the closed producer with no Skill or reload; lifecycle is explicit", async () => {
  assert.equal(plugin.id, "omoc.workbench.skills");
  const h = await host({ base: [foreign()] });
  assert.deepEqual(Object.keys(h.state.handlers).sort(), [
    "observe",
    "registerDisabled",
    "removeOwned",
  ]);
  assert.deepEqual(Object.keys(h.state.agentHandlers).sort(), [
    "observe",
    "register",
    "remove",
  ]);
  assert.deepEqual(Object.keys(h.state.extensionHandlers), ["observe"]);
  assert.deepEqual(
    await h.state.extensionHandlers.observe(observe(), rpcContext),
    {
      workspaceId: "workspace-one",
      workspacePath: root,
      status: "unavailable",
      plugins: { status: "unavailable", reason: "runtime_unavailable" },
      tools: { status: "unavailable", reason: "runtime_unavailable" },
      hooks: { status: "not_reported", reason: "inventory_not_supported" },
    },
  );
  assert.equal(h.state.lists, 0);
  const empty = await h.call("observe", observe());
  assert.equal(empty.status, "ready");
  assert.deepEqual(empty.rows, []);
  assert.deepEqual(empty.native, [foreign()]);
  assert.equal(h.state.reloads, 0);
  const request = register();
  const result = await h.call("registerDisabled", request);
  assert.deepEqual(result, {
    status: "registered_disabled",
    owner: request.owner,
    record: request.record,
    recordDigest: request.recordDigest,
    previousNativeId: null,
  });
  assert.equal(Object.isFrozen(result.record), true);
  const observed = await h.call("observe", observe());
  assert.deepEqual(observed.rows, [
    {
      owner: request.owner,
      record: request.record,
      recordDigest: request.recordDigest,
    },
  ]);
  assert.equal(observed.native.length, 2);
  // Reload reconstructs the desired record from empty base, with no old-ID state.
  await h.ctx.skill.reload();
  assert.equal((await h.call("observe", observe())).rows.length, 1);
  const removal = remove(request);
  assert.deepEqual(await h.call("removeOwned", removal), {
    status: "removed",
    owner: removal.owner,
    registration: request.owner,
    nativeId: request.record.id,
    recordDigest: request.recordDigest,
  });
  assert.deepEqual((await h.call("observe", observe())).native, [foreign()]);
  await h.close();
  await h.close();
  assert.deepEqual(h.state.disposals.sort(), [
    "agent-rpc",
    "extension-rpc",
    "rpc",
    "transform",
  ]);
  denied(await h.call("registerDisabled", register("late")), "invalid_context");
});

test("setup rejects noncanonical location and closed-option violations before registration", async () => {
  for (const options of [
    {},
    { nonce, extra: true },
    { nonce: "x".repeat(64) },
    { nonce, plugin: "elsewhere" },
  ]) {
    await assert.rejects(host({ options }), /invalid_context/);
  }
  for (const directory of [
    "relative",
    "/",
    root + "/../workspace",
    root + "/",
    root + "\n",
  ]) {
    await assert.rejects(host({ directory }), /invalid_context/);
  }
});

test("all handlers manually reject wrong nonce, extra fields and cross-root input without effects", async () => {
  const h = await host();
  const request = register();
  for (const [method, input] of [
    ["observe", observe()],
    ["registerDisabled", request],
    ["removeOwned", remove(request)],
  ]) {
    denied(
      await h.call(method, { ...input, nonce: "c".repeat(64) }),
      "nonce_mismatch",
    );
    denied(await h.call(method, { ...input, extra: true }), "invalid_context");
  }
  denied(
    await h.call("observe", observe({ workspacePath: "/other/root" })),
    "invalid_context",
  );
  denied(
    await h.call(
      "registerDisabled",
      register("other", "demo", { workspacePath: "/other/root" }),
    ),
    "invalid_context",
  );
  const bad = remove(
    register("other", "demo", { workspacePath: "/other/root" }),
  );
  denied(await h.call("removeOwned", bad), "invalid_context");
  assert.equal(h.state.reloads, 0);
  assert.equal(h.state.lists, 0);
  await h.close();
});

test("same-source replacement requires expected original Native ID and removes only old generation", async () => {
  const h = await host();
  const first = register();
  await h.call("registerDisabled", first);
  denied(
    await h.call("registerDisabled", register("missing-expected")),
    "changed",
  );
  const next = register("register-two");
  next.expectedNativeId = first.record.id;
  assert.equal(
    (await h.call("registerDisabled", next)).previousNativeId,
    first.record.id,
  );
  assert.equal(h.state.native.has(first.record.id), false);
  assert.deepEqual(h.state.native.get(next.record.id), next.record);
  denied(await h.call("removeOwned", remove(first)), "changed");
  assert.equal(
    (await h.call("removeOwned", remove(next, "remove-two"))).status,
    "removed",
  );
  await h.close();
});

test("foreign IDs, including prefix and exact-record collisions, never establish ownership", async () => {
  const request = register();
  const h = await host({
    base: [request.record, foreign("omoc-skill-" + "f".repeat(64))],
  });
  assert.deepEqual((await h.call("observe", observe())).rows, []);
  denied(await h.call("registerDisabled", request), "collision");
  denied(await h.call("removeOwned", remove(request)), "changed");
  assert.equal(h.state.reloads, 0);
  assert.equal(h.state.native.size, 2);
  await h.close();
});

test("ownership requires original registration, workspace and exact public record", async () => {
  const h = await host();
  const request = register();
  await h.call("registerDisabled", request);
  const changed = remove(request);
  changed.registration.digest = "f".repeat(64);
  denied(await h.call("removeOwned", changed), "changed");
  const workspace = remove(request, "other-workspace");
  workspace.owner.workspaceId = "workspace-two";
  workspace.registration.workspaceId = "workspace-two";
  workspace.nativeId = nativeSkillId(workspace.registration);
  denied(await h.call("removeOwned", workspace), "changed");
  h.state.native.set(request.record.id, {
    ...request.record,
    autoinvoke: true,
  });
  assert.deepEqual(await h.call("observe", observe()), {
    status: "unavailable",
    reason: "identity_conflict",
  });
  denied(
    await h.call("removeOwned", remove(request, "changed-public")),
    "changed",
  );
  assert.equal(h.state.reloads, 1);
  await h.close();
});

test("original-key cache returns immutable results and rejects same-key method or payload conflicts", async () => {
  const h = await host();
  const request = register();
  const original = await h.call("registerDisabled", request);
  assert.equal(await h.call("registerDisabled", clone(request)), original);
  const changed = clone(request);
  changed.record.content = "Changed inert content";
  changed.recordDigest = nativeSkillDigest(changed.record);
  denied(await h.call("registerDisabled", changed), "identity_conflict");
  denied(
    await h.call("removeOwned", remove(request, request.owner.operationId)),
    "identity_conflict",
  );
  const removal = remove(request);
  const removed = await h.call("removeOwned", removal);
  assert.equal(await h.call("removeOwned", clone(removal)), removed);
  assert.equal(await h.call("registerDisabled", clone(request)), original);
  assert.equal(h.state.reloads, 2);
  assert.equal(h.state.native.size, 0);
  await h.close();
});

test("slow handlers serialize observe and mutations; inputs are cloned before the first await", async () => {
  const h = await host();
  const entered = deferred();
  const release = deferred();
  h.state.beforeReload = () => {
    entered.resolve();
    return release.promise;
  };
  const request = register();
  const expected = clone(request);
  const first = h.call("registerDisabled", request);
  await entered.promise;
  request.owner.digest = "f".repeat(64);
  request.record.content = "Caller mutated payload";
  const duplicate = h.call("registerDisabled", expected);
  const reading = h.call("observe", observe());
  const second = h.call("registerDisabled", register("second", "second"));
  await Promise.resolve();
  assert.equal(h.state.reloads, 1);
  release.resolve();
  const result = await first;
  assert.deepEqual(result.record, expected.record);
  assert.equal(await duplicate, result);
  assert.equal((await reading).rows.length, 1);
  assert.equal((await second).status, "registered_disabled");
  assert.equal(h.state.reloads, 2);
  await h.close();
});

test("reload failure caches unknown, retains desired state and never replays or rolls back", async () => {
  const h = await host();
  h.state.beforeReload = () => {
    throw new Error("sensitive synthetic diagnostic");
  };
  const request = register();
  const result = await h.call("registerDisabled", request);
  assert.deepEqual(result, { status: "unknown", reason: "reload_failed" });
  assert.equal(Object.isFrozen(result), true);
  h.state.beforeReload = undefined;
  assert.equal(await h.call("registerDisabled", clone(request)), result);
  denied(
    await h.call("registerDisabled", register("after-unknown", "other")),
    "changed",
  );
  assert.equal(h.state.reloads, 1);
  // Native may subsequently recompute; lookup must still retain original unknown.
  await h.ctx.skill.reload();
  assert.deepEqual(h.state.native.get(request.record.id), request.record);
  assert.equal(await h.call("registerDisabled", request), result);
  await h.close();
});

test("foreign base collision during reload is refused even for an identical record", async () => {
  const h = await host();
  const request = register();
  h.state.beforeReload = () => {
    h.state.base = [clone(request.record)];
  };
  assert.deepEqual(await h.call("registerDisabled", request), {
    status: "unknown",
    reason: "reload_failed",
  });
  assert.equal(h.state.native.size, 0);
  await h.close();
});

test("Native State.group swallowing a collision cannot turn foreign exact bytes into owned success", async () => {
  const h = await host();
  const request = register();
  h.state.swallowTransformFailure = true;
  h.state.beforeReload = () => {
    h.state.base = [clone(request.record)];
  };
  const result = await h.call("registerDisabled", request);
  assert.deepEqual(result, {
    status: "unknown",
    reason: "verification_failed",
  });
  assert.equal(await h.call("registerDisabled", request), result);
  assert.deepEqual(await h.call("observe", observe()), {
    status: "unavailable",
    reason: "identity_conflict",
  });
  denied(
    await h.call("registerDisabled", register("after-disabled", "other")),
    "changed",
  );
  assert.deepEqual(h.state.native.get(request.record.id), request.record);
  assert.equal(h.state.reloads, 1);
  await h.close();
});

test("missing/changed new records and retained old IDs fail registration postconditions", async () => {
  for (const mode of ["missing", "changed", "old"]) {
    const h = await host();
    const first = register();
    await h.call("registerDisabled", first);
    const next = register("next");
    next.expectedNativeId = first.record.id;
    h.state.afterTransform = (map) => {
      if (mode === "missing") map.delete(next.record.id);
      if (mode === "changed")
        map.set(next.record.id, { ...next.record, content: "changed" });
      if (mode === "old") map.set(first.record.id, first.record);
    };
    const result = await h.call("registerDisabled", next);
    assert.deepEqual(result, {
      status: "unknown",
      reason: "verification_failed",
    });
    assert.equal(await h.call("registerDisabled", next), result);
    assert.equal(h.state.reloads, 2);
    h.state.afterTransform = undefined;
    await h.close();
  }
});

test("remove verifies Native absence and never claims to remove session history", async () => {
  const h = await host();
  const request = register();
  await h.call("registerDisabled", request);
  h.state.afterTransform = (map) => map.set(request.record.id, request.record);
  const removal = remove(request);
  const result = await h.call("removeOwned", removal);
  assert.deepEqual(result, {
    status: "unknown",
    reason: "verification_failed",
  });
  assert.equal(await h.call("removeOwned", removal), result);
  assert.deepEqual((await h.call("observe", observe())).rows, []);
  assert.equal(h.state.native.has(request.record.id), true);
  assert.equal(h.state.reloads, 2);
  h.state.afterTransform = undefined;
  await h.close();
});

test("observe requires actual located Native list and refuses malformed or oversized output", async () => {
  const h = await host();
  for (const [output, reason] of [
    [{ data: [] }, "runtime_error"],
    [
      { location: { directory: root }, data: [foreign(), foreign()] },
      "identity_conflict",
    ],
    [
      { location: { directory: root }, data: [{ ...foreign(), metadata: {} }] },
      "identity_conflict",
    ],
    [
      {
        location: { directory: root },
        data: Array.from({ length: 65 }, (_, i) => foreign(`foreign-${i}`)),
      },
      "retained_limit",
    ],
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

test("owned and native limits are checked before a mutation", async () => {
  const h = await host();
  for (let i = 0; i < NATIVE_SKILL_LIMITS.owned; i++) {
    assert.equal(
      (
        await h.call(
          "registerDisabled",
          register(`register-${i}`, `source-${i}`),
        )
      ).status,
      "registered_disabled",
    );
  }
  denied(
    await h.call("registerDisabled", register("overflow", "overflow")),
    "retained_limit",
  );
  assert.equal(h.state.reloads, 16);
  const replacement = register("replacement", "source-0");
  replacement.expectedNativeId = register("register-0", "source-0").record.id;
  assert.equal(
    (await h.call("registerDisabled", replacement)).status,
    "registered_disabled",
  );
  await h.close();
  const full = await host({
    base: Array.from({ length: 64 }, (_, i) => foreign(`foreign-${i}`)),
  });
  denied(await full.call("registerDisabled", register()), "retained_limit");
  assert.equal(full.state.reloads, 0);
  await full.close();
});

test("cache capacity is reserved before mutation and old keys are never evicted", async () => {
  const h = await host();
  const first = register();
  const result = await h.call("registerDisabled", first);
  await h.call("removeOwned", remove(first));
  for (let i = 2; i < NATIVE_SKILL_LIMITS.operations; i++) {
    denied(
      await h.call("removeOwned", remove(first, `absent-${i}`)),
      "changed",
    );
  }
  denied(
    await h.call("registerDisabled", register("overflow")),
    "retained_limit",
  );
  assert.equal(h.state.reloads, 2);
  assert.equal(await h.call("registerDisabled", first), result);
  await h.close();
});

test("cleanup closes in-flight work and queued handlers before any late Native effects", async () => {
  const h = await host();
  const entered = deferred();
  const release = deferred();
  h.state.beforeReload = () => {
    entered.resolve();
    return release.promise;
  };
  const first = h.call("registerDisabled", register());
  await entered.promise;
  const second = h.call("registerDisabled", register("late", "late"));
  await h.close();
  release.resolve();
  assert.deepEqual(await first, {
    status: "unknown",
    reason: "verification_failed",
  });
  denied(await second, "invalid_context");
  assert.equal(h.state.native.size, 0);
  assert.equal(h.state.reloads, 1);
});

test("pending duplicate and conflict lookup precede bounded queue admission", async () => {
  const h = await host();
  const entered = deferred();
  const release = deferred();
  h.state.beforeReload = () => {
    entered.resolve();
    return release.promise;
  };
  const request = register();
  const first = h.call("registerDisabled", request);
  await entered.promise;
  const reads = Array.from({ length: 255 }, () => h.call("observe", observe()));
  denied(await h.call("observe", observe()), "retained_limit");
  const duplicate = h.call("registerDisabled", clone(request));
  const conflict = clone(request);
  conflict.owner.digest = "c".repeat(64);
  denied(await h.call("registerDisabled", conflict), "identity_conflict");
  const waiting = register("waiting", "other");
  denied(await h.call("registerDisabled", waiting), "retained_limit");
  release.resolve();
  const original = await first;
  assert.equal(await duplicate, original);
  assert.equal(
    (await Promise.all(reads)).every((result) => result.rows.length === 1),
    true,
  );
  assert.equal(h.state.reloads, 1);
  assert.equal(
    (await h.call("registerDisabled", waiting)).status,
    "registered_disabled",
  );
  await h.close();
});

test("nested extra fields, accessors and wrong record digests are denied before Native reads", async () => {
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
  const h = await host();
  const request = register();
  const invalid = [
    { ...request, owner: { ...request.owner, extra: true } },
    { ...request, record: { ...request.record, metadata: {} } },
    { ...request, record: { ...request.record, autoinvoke: true } },
    { ...request, recordDigest: "c".repeat(64) },
    {
      ...request,
      owner: { ...request.owner, workspacePath: root + "/../workspace" },
    },
    {
      ...request,
      record: {
        ...request.record,
        get content() {
          accesses++;
          return "inert";
        },
      },
    },
  ];
  for (const input of invalid)
    denied(await h.call("registerDisabled", input), "invalid_context");
  assert.equal(accesses, 0);
  assert.equal(h.state.lists, 0);
  assert.equal(h.state.reloads, 0);
  await assert.rejects(
    h.call("observe", { ...observe(), nonce: "c".repeat(64) }, {}),
    (error) => {
      assert.deepEqual(error.data, { code: "nonce_mismatch" });
      assert.equal(error.message, "Native Skill request denied.");
      return true;
    },
  );
  assert.equal((await h.call("observe", observe())).status, "ready");
  await h.close();
});

test("workspace and original registration digests cannot be changed for replacement or removal", async () => {
  const h = await host();
  const request = register();
  await h.call("registerDisabled", request);
  const next = register("other-workspace", "demo", {
    workspaceId: "workspace-two",
  });
  next.expectedNativeId = request.record.id;
  denied(await h.call("registerDisabled", next), "changed");
  assert.deepEqual(
    await h.call("observe", observe({ workspaceId: "workspace-two" })),
    { status: "unavailable", reason: "identity_conflict" },
  );
  const wrongDigest = remove(request);
  wrongDigest.recordDigest = "f".repeat(64);
  denied(await h.call("removeOwned", wrongDigest), "changed");
  assert.equal(h.state.reloads, 1);
  assert.equal((await h.call("observe", observe())).rows.length, 1);
  await h.close();
});

test("canonical key digest ignores property insertion order and preserves original denials", async () => {
  const request = register();
  const h = await host({ base: [request.record] });
  denied(await h.call("registerDisabled", request), "collision");
  h.state.base = [];
  h.recompute();
  const reordered = Object.fromEntries(Object.entries(request).reverse());
  reordered.owner = Object.fromEntries(Object.entries(request.owner).reverse());
  reordered.record = Object.fromEntries(
    Object.entries(request.record).reverse(),
  );
  denied(await h.call("registerDisabled", reordered), "collision");
  assert.equal(h.state.reloads, 0);
  const fresh = register("fresh-key");
  assert.equal(
    (await h.call("registerDisabled", fresh)).status,
    "registered_disabled",
  );
  await h.close();
});

test("remove reload failures remain original unknown and do not restore or replay desired rows", async () => {
  const h = await host();
  const request = register();
  await h.call("registerDisabled", request);
  h.state.beforeReload = () => {
    throw new Error("Synthetic content must not be diagnosed");
  };
  const removal = remove(request);
  const result = await h.call("removeOwned", removal);
  assert.deepEqual(result, { status: "unknown", reason: "reload_failed" });
  assert.equal(await h.call("removeOwned", removal), result);
  assert.equal(h.state.native.has(request.record.id), true);
  assert.deepEqual((await h.call("observe", observe())).rows, []);
  denied(
    await h.call("registerDisabled", register("after-unknown")),
    "changed",
  );
  assert.equal(h.state.reloads, 2);
  h.state.beforeReload = undefined;
  await h.ctx.skill.reload();
  assert.equal(h.state.native.has(request.record.id), false);
  assert.equal(await h.call("removeOwned", removal), result);
  await h.close();
});

test("Native read failures are safe before effects and cached unknown after effects", async () => {
  const h = await host();
  const rawError = () => {
    throw new Error("Synthetic secret payload");
  };
  h.state.listOverride = rawError;
  assert.deepEqual(await h.call("observe", observe()), {
    status: "unavailable",
    reason: "runtime_error",
  });
  denied(
    await h.call("registerDisabled", register("before-read-error")),
    "changed",
  );
  assert.equal(h.state.reloads, 0);
  h.state.listOverride = undefined;
  h.state.afterTransform = () => {
    h.state.listOverride = rawError;
  };
  const request = register("after-read-error");
  const result = await h.call("registerDisabled", request);
  assert.deepEqual(result, {
    status: "unknown",
    reason: "verification_failed",
  });
  h.state.listOverride = undefined;
  assert.equal(await h.call("registerDisabled", request), result);
  assert.equal(h.state.reloads, 1);
  h.state.afterTransform = undefined;
  await h.close();
});

test("context drift while awaiting Native reads refuses before effects or stays unknown afterward", async () => {
  for (const afterEffect of [false, true]) {
    const h = await host();
    const request = register();
    if (afterEffect)
      h.state.afterTransform = () => {
        h.ctx.location.directory = "/other/root";
      };
    else
      h.state.listOverride = () => {
        h.ctx.location.directory = "/other/root";
        return { location: { directory: root }, data: [] };
      };
    const result = await h.call("registerDisabled", request);
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

test("partial setup failure disposes transform without raw diagnostics", async () => {
  let disposed = 0;
  const ctx = {
    options: { nonce },
    location: { directory: root },
    skill: {
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
        throw new Error("Synthetic private payload");
      },
    },
  };
  await assert.rejects(plugin.setup(ctx), {
    message: "Native Skill setup failed.",
  });
  assert.equal(disposed, 1);
});

test("mandatory Agent RPC setup failure releases Skill registrations without installing Agent transforms", async () => {
  const disposed = [];
  const registration = (name) => ({
    async dispose() {
      disposed.push(name);
    },
  });
  await assert.rejects(
    plugin.setup({
      options: { nonce },
      location: { directory: root },
      skill: {
        async transform() {
          return registration("skill-transform");
        },
      },
      agent: {
        async transform() {
          assert.fail("Agent transform must remain lazy");
        },
      },
      rpc: {
        async register(definition) {
          if (definition === NATIVE_AGENTS_RPC)
            throw new Error("Private diagnostic");
          assert.equal(definition, NATIVE_SKILLS_RPC);
          return registration("skill-rpc");
        },
      },
    }),
    { message: "Native Skill setup failed." },
  );
  assert.deepEqual(disposed.sort(), ["skill-rpc", "skill-transform"]);
});

test("Agent cleanup failure still settles all Skill cleanup and closes handlers", async () => {
  const disposed = [];
  let handlers;
  const registration = (name, failure = false) => ({
    async dispose() {
      disposed.push(name);
      if (failure) throw new Error("Private cleanup diagnostic");
    },
  });
  const close = await plugin.setup({
    options: { nonce },
    location: { directory: root },
    skill: {
      async transform() {
        return registration("skill-transform");
      },
    },
    agent: {
      async transform() {
        assert.fail("Agent transform must remain lazy");
      },
    },
    rpc: {
      async register(definition, callbacks) {
        if (definition === NATIVE_AGENTS_RPC)
          return registration("agent-rpc", true);
        if (definition.id === NATIVE_EXTENSIONS_RPC_DEFINITION.id)
          return registration("extension-rpc");
        assert.equal(definition, NATIVE_SKILLS_RPC);
        handlers = callbacks;
        return registration("skill-rpc");
      },
    },
  });
  await assert.rejects(close(), { message: "Native Skill cleanup failed." });
  assert.deepEqual(disposed.sort(), [
    "agent-rpc",
    "extension-rpc",
    "skill-rpc",
    "skill-transform",
  ]);
  denied(await handlers.observe(observe(), rpcContext), "invalid_context");
  await assert.rejects(close(), { message: "Native Skill cleanup failed." });
  assert.equal(disposed.length, 4);
});

test("closed scope releases owned records; a new instance does not restore prior registrations", async () => {
  const h = await host();
  await h.call("registerDisabled", register());
  await h.close();
  assert.equal(h.state.native.size, 0);
  const reopened = await host({
    base: [foreign("auto", { autoinvoke: true })],
  });
  const result = await reopened.call("observe", observe());
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.native, [foreign("auto", { autoinvoke: true })]);
  assert.equal(reopened.state.reloads, 0);
  await reopened.close();
});

test("Extension RPC setup failure drains existing Skill and Agent registrations", async () => {
  const disposed = [],
    registered = [];
  await assert.rejects(
    plugin.setup({
      options: { nonce },
      location: { directory: root },
      skill: {
        async transform() {
          return {
            async dispose() {
              disposed.push("skill-transform");
            },
          };
        },
      },
      rpc: {
        async register(definition) {
          registered.push(definition.id);
          if (definition.id === NATIVE_EXTENSIONS_RPC_DEFINITION.id)
            throw new Error("Private setup diagnostic");
          return {
            async dispose() {
              disposed.push(definition.id);
            },
          };
        },
      },
    }),
    { message: "Native Skill setup failed." },
  );
  assert.deepEqual(registered, [
    NATIVE_SKILLS_RPC.id,
    NATIVE_AGENTS_RPC.id,
    NATIVE_EXTENSIONS_RPC_DEFINITION.id,
  ]);
  assert.deepEqual(
    disposed.sort(),
    ["skill-transform", NATIVE_SKILLS_RPC.id, NATIVE_AGENTS_RPC.id].sort(),
  );
});

test("Extension cleanup failure drains sibling registrations and closes all handlers", async () => {
  const disposed = [],
    handlers = new Map();
  const close = await plugin.setup({
    options: { nonce },
    location: { directory: root },
    skill: {
      async transform() {
        return {
          async dispose() {
            disposed.push("skill-transform");
          },
        };
      },
    },
    rpc: {
      async register(definition, callbacks) {
        handlers.set(definition.id, callbacks);
        return {
          async dispose() {
            disposed.push(definition.id);
            if (definition.id === NATIVE_EXTENSIONS_RPC_DEFINITION.id)
              throw new Error("Private cleanup diagnostic");
          },
        };
      },
    },
  });
  await assert.rejects(close(), { message: "Native Skill cleanup failed." });
  assert.deepEqual(
    disposed.sort(),
    [
      "skill-transform",
      NATIVE_SKILLS_RPC.id,
      NATIVE_AGENTS_RPC.id,
      NATIVE_EXTENSIONS_RPC_DEFINITION.id,
    ].sort(),
  );
  for (const callbacks of handlers.values())
    denied(await callbacks.observe(observe(), rpcContext), "invalid_context");
  await assert.rejects(close(), { message: "Native Skill cleanup failed." });
  assert.equal(disposed.length, 4);
});
