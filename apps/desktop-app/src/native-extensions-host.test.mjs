import test from "node:test";
import assert from "node:assert/strict";
import { OpenCode } from "@opencode/client";
import { createNativeExtensionsClient } from "./native-extensions-client.mjs";
import { NATIVE_EXTENSIONS_RPC_DEFINITION } from "./native-extensions-protocol.mjs";

const nonce = "a".repeat(64);
const input = () => ({
  workspaceId: "workspace",
  workspacePath: "/tmp/workspace",
});
const inventory = (scope = input()) => ({
  ...scope,
  status: "available",
  plugins: { status: "available", rows: [] },
  tools: { status: "available", rows: [{ id: "read", name: "read" }] },
  hooks: { status: "not_reported", reason: "inventory_not_supported" },
});
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
test("extension adapter exposes only observe and supplies private nonce/canonical location", async () => {
  const calls = [];
  let checks = 0;
  const api = createNativeExtensionsClient({
    nonce,
    assertLive: async () => {
      checks++;
    },
    client: {
      rpc: (namespace) => {
        assert.equal(namespace, NATIVE_EXTENSIONS_RPC_DEFINITION);
        return {
          observe: async (request, options) => {
            calls.push({ request, options });
            return inventory();
          },
        };
      },
    },
  });
  assert.deepEqual(Object.keys(api), ["observe"]);
  assert.deepEqual(await api.observe(input()), inventory());
  assert.equal(checks, 2);
  assert.deepEqual(calls[0].request, { ...input(), nonce });
  assert.deepEqual(calls[0].options.location, {
    directory: input().workspacePath,
  });
  assert.ok(calls[0].options.signal instanceof AbortSignal);
});
test("extension adapter supplies a portable definition to the actual installed SDK RPC factory", async () => {
  const actual = OpenCode.make({
    baseUrl: "http://127.0.0.1:1",
    fetch: async () => {
      throw new Error("No network permitted in this test");
    },
  });
  let factories = 0;
  const api = createNativeExtensionsClient({
    nonce,
    assertLive: async () => {},
    client: {
      rpc: (definition) => {
        const methods = actual.rpc(definition);
        assert.equal(typeof methods.observe, "function");
        factories++;
        return { observe: async () => inventory() };
      },
    },
  });
  assert.deepEqual(await api.observe(input()), inventory());
  assert.equal(factories, 1);
});
test("extension adapter rejects extra/nonce/getter/relative inputs before owner or RPC", async () => {
  let calls = 0;
  const api = createNativeExtensionsClient({
    nonce,
    assertLive: async () => {
      calls++;
    },
    client: {
      rpc: () => {
        calls++;
      },
    },
  });
  const getter = input();
  Object.defineProperty(getter, "workspacePath", {
    get() {
      throw new Error("getter evaluated");
    },
  });
  for (const value of [
    { ...input(), nonce },
    { ...input(), execute: true },
    { ...input(), workspacePath: "relative" },
    getter,
    Object.create(null),
  ])
    await assert.rejects(api.observe(value));
  assert.equal(calls, 0);
});
test("extension adapter captures request before asynchronous owner verification", async () => {
  const gate = deferred();
  const value = input();
  const api = createNativeExtensionsClient({
    nonce,
    assertLive: async () => gate.promise,
    client: {
      rpc: () => ({
        observe: async (request) => {
          assert.equal(request.workspaceId, "workspace");
          return inventory();
        },
      }),
    },
  });
  const task = api.observe(value);
  value.workspaceId = "other";
  gate.resolve();
  assert.equal((await task).workspaceId, "workspace");
});
test("extension adapter refuses foreign scope, malformed output and owner loss", async () => {
  for (const result of [
    inventory({ workspaceId: "other", workspacePath: "/tmp/workspace" }),
    inventory({ workspaceId: "workspace", workspacePath: "/tmp/other" }),
    { ...inventory(), secret: "canary" },
  ]) {
    const api = createNativeExtensionsClient({
      nonce,
      assertLive: async () => {},
      client: { rpc: () => ({ observe: async () => result }) },
    });
    await assert.rejects(api.observe(input()));
  }
  let checks = 0;
  const api = createNativeExtensionsClient({
    nonce,
    assertLive: async () => {
      if (++checks === 2) throw new Error("owner lost");
    },
    client: { rpc: () => ({ observe: async () => inventory() }) },
  });
  await assert.rejects(api.observe(input()));
});
test("whole-read deadline includes owner verification and suppresses late RPC dispatch", async () => {
  const gate = deferred();
  let calls = 0;
  const api = createNativeExtensionsClient({
    nonce,
    timeoutMs: 20,
    assertLive: async () => gate.promise,
    client: {
      rpc: () => {
        calls++;
        return { observe: async () => inventory() };
      },
    },
  });
  await assert.rejects(api.observe(input()), /native_extensions_unavailable/);
  gate.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 0);
});
test("whole-read deadline bounds ignored abort and rejects late inventory", async () => {
  const gate = deferred();
  let signal;
  const api = createNativeExtensionsClient({
    nonce,
    timeoutMs: 20,
    assertLive: async () => {},
    client: {
      rpc: () => ({
        observe: async (_, options) => {
          signal = options.signal;
          return gate.promise;
        },
      }),
    },
  });
  await assert.rejects(api.observe(input()), /native_extensions_unavailable/);
  assert.equal(signal.aborted, true);
  gate.resolve(inventory());
  await new Promise((resolve) => setImmediate(resolve));
});
