import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProviderHost } from "./provider-host.mjs";
import { bindProviderIpc } from "./provider-ipc.mjs";

const KEY = "sk-test-SECRET-1234567890";
const setup = async (clientOverrides = {}) => {
  const dir = await mkdtemp(join(tmpdir(), "omoc-provider-"));
  const configFile = join(dir, "opencode.json");
  await writeFile(configFile, '{"model":"x/y"}\n', { mode: 0o600 });
  const calls = [];
  const client = {
    integration: {
      list: async () => ({
        data: [
          {
            id: "zeta",
            name: "Zeta",
            methods: [{ type: "key" }],
            connections: [],
          },
          {
            id: "openai",
            name: "OpenAI",
            methods: [{ type: "key" }],
            connections: [{ type: "credential", id: "cred_1" }],
          },
          {
            id: "oauth-only",
            name: "O",
            methods: [{ type: "oauth" }],
            connections: [],
          },
          {
            id: "anthropic",
            name: "Anthropic",
            methods: [{ type: "key" }],
            connections: [{ type: "env", name: "A" }],
          },
        ],
      }),
      get: async () => ({
        data: {
          connections: [
            { type: "credential", id: "cred_1" },
            { type: "env", name: "E" },
          ],
        },
      }),
      connect: {
        key: async (input) => {
          calls.push(["connect", input]);
        },
      },
    },
    credential: { remove: async (input) => calls.push(["remove", input]) },
    ...clientOverrides,
  };
  const host = createProviderHost({
    context: () => ({ client, directory: dir }),
    configFile: () => configFile,
  });
  const channels = new Map();
  bindProviderIpc({
    ipcMain: { handle: (c, h) => channels.set(c, h) },
    admit: () => true,
    host,
  });
  const invoke = (...args) => channels.get("desktop:v1:provider")({}, ...args);
  return { dir, configFile, calls, host, invoke, channels };
};

test("closed channel and request validation", async () => {
  const { invoke, channels, calls } = await setup();
  assert.deepEqual([...channels.keys()], ["desktop:v1:provider"]);
  for (const bad of [
    undefined,
    [],
    { type: "nope" },
    { type: "provider.list", extra: 1 },
    { type: "provider.connect", id: "openai" },
    { type: "provider.connect", id: "../x", key: KEY },
    { type: "provider.connect", id: "openai", key: KEY, label: "x" },
    { type: "provider.remove", id: "bad id" },
    { type: "provider.local", baseUrl: "file:///etc/passwd" },
    { type: "provider.local", baseUrl: "http://u:p@h/v1" },
    { type: "provider.local", baseUrl: "http://example.com/v1" },
    { type: "provider.local", baseUrl: "http://10.0.0.5:1234/v1" },
  ])
    assert.equal((await invoke(bad)).ok, false, JSON.stringify(bad));
  assert.equal(
    (await channels.get("desktop:v1:provider")({}, {}, {})).code,
    "INVALID_REQUEST",
  );
  assert.equal(
    (await invoke({ type: "provider.connect", id: "openai", key: "short" }))
      .code,
    "INVALID_KEY",
  );
  assert.equal(
    (
      await invoke({
        type: "provider.connect",
        id: "openai",
        key: "has space 12345",
      })
    ).code,
    "INVALID_KEY",
  );
  assert.deepEqual(calls, []);
});

test("list is filtered, ordered, and never carries credentials", async () => {
  const { invoke } = await setup();
  const result = await invoke({ type: "provider.list" });
  assert.deepEqual(
    result.value.providers.map((p) => [p.id, p.connected, p.source]),
    [
      ["openai", true, "credential"],
      ["anthropic", true, "env"],
      ["zeta", false, "none"],
    ],
  );
  assert.ok(!JSON.stringify(result).includes("cred_1"));
});

test("connect forwards the key to Native only and never echoes or writes it", async () => {
  const { invoke, calls, dir, configFile } = await setup();
  const result = await invoke({
    type: "provider.connect",
    id: "openai",
    key: KEY,
  });
  assert.deepEqual(result, { ok: true, value: { connected: true } });
  assert.equal(calls[0][1].key, KEY);
  assert.equal(calls[0][1].integrationID, "openai");
  assert.ok(!JSON.stringify(result).includes(KEY));
  assert.ok(!(await readFile(configFile, "utf8")).includes(KEY));
  assert.ok(dir);
});

test("Native errors map to closed codes without the key or message", async () => {
  const bad = Object.assign(new Error(`rejected ${KEY}`), {
    _tag: "InvalidRequestError",
  });
  const { invoke } = await setup({
    integration: {
      list: async () => ({ data: [] }),
      connect: {
        key: async () => {
          throw bad;
        },
      },
    },
  });
  const invalid = await invoke({
    type: "provider.connect",
    id: "openai",
    key: KEY,
  });
  assert.deepEqual(invalid, { ok: false, code: "INVALID_KEY" });
  const net = await setup({
    integration: {
      connect: {
        key: async () => {
          throw new Error(`ECONNREFUSED ${KEY}`);
        },
      },
    },
  });
  const down = await net.invoke({
    type: "provider.connect",
    id: "openai",
    key: KEY,
  });
  assert.deepEqual(down, { ok: false, code: "UNAVAILABLE" });
  assert.ok(!JSON.stringify([invalid, down]).includes(KEY));
});

test("no runtime -> UNAVAILABLE", async () => {
  const host = createProviderHost({
    context: () => undefined,
    configFile: () => "/x",
  });
  assert.equal((await host.connect("openai", KEY)).code, "UNAVAILABLE");
  assert.equal((await host.list()).code, "UNAVAILABLE");
});

test("remove deletes only stored credentials", async () => {
  const { invoke, calls } = await setup();
  assert.equal(
    (await invoke({ type: "provider.remove", id: "openai" })).ok,
    true,
  );
  assert.deepEqual(calls, [["remove", { credentialID: "cred_1" }]]);
});

test("local base URL merges into opencode.json at 0600 and can be cleared", async () => {
  const { invoke, configFile } = await setup();
  await invoke({ type: "provider.local", baseUrl: "http://127.0.0.1:1234/v1" });
  const saved = JSON.parse(await readFile(configFile, "utf8"));
  assert.equal(saved.model, "x/y");
  assert.equal(
    saved.providers.lmstudio.settings.baseURL,
    "http://127.0.0.1:1234/v1",
  );
  assert.equal((await stat(configFile)).mode & 0o777, 0o600);
  const listed = await invoke({ type: "provider.list" });
  assert.equal(listed.value.local.baseUrl, "http://127.0.0.1:1234/v1");
  await invoke({ type: "provider.local", baseUrl: "" });
  assert.equal(
    JSON.parse(await readFile(configFile, "utf8")).providers.lmstudio,
    undefined,
  );
});

test("local base URL: normalized, stub removed, concurrent saves leave one clean file", async () => {
  const { invoke, configFile, dir, host } = await setup();
  await Promise.all(
    [1, 2, 3, 4, 5].map((n) =>
      invoke({ type: "provider.local", baseUrl: `http://LOCALHOST:${n}` }),
    ),
  );
  assert.equal(
    JSON.parse(await readFile(configFile, "utf8")).providers.lmstudio.settings
      .baseURL,
    "http://localhost:5/",
  );
  assert.deepEqual(await readdir(dir), ["opencode.json"]);
  await invoke({ type: "provider.local", baseUrl: "" });
  assert.equal(
    "lmstudio" in JSON.parse(await readFile(configFile, "utf8")).providers,
    false,
  );
  await writeFile(configFile, '{"providers":[1],"model":"x/y"}\n');
  assert.equal(
    (await invoke({ type: "provider.local", baseUrl: "http://[::1]:9/v1" })).ok,
    true,
  );
  // Failure leaves no temp file behind.
  await writeFile(configFile, "not json");
  assert.equal((await host.setLocalBaseUrl("")).code, "UNAVAILABLE");
  assert.deepEqual(await readdir(dir), ["opencode.json"]);
});

test("write operations are UNAVAILABLE when this process does not own storage", async () => {
  const host = createProviderHost({
    context: () => ({ client: {}, directory: "/x" }),
    configFile: () => "/x",
    owned: () => false,
  });
  for (const r of [
    await host.connect("openai", KEY),
    await host.remove("openai"),
    await host.setLocalBaseUrl("http://127.0.0.1:1/v1"),
  ])
    assert.equal(r.code, "UNAVAILABLE");
});

test("host and ipc sources never log", async () => {
  for (const file of ["provider-host.mjs", "provider-ipc.mjs"]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /console\.|process\.std(out|err)/u, file);
  }
});
