import test from "node:test";
import assert from "node:assert/strict";
import {
  EXTENSIONS_LIMITS,
  projectNativePlugins,
  projectNativeTools,
  validateExtensionsInventory,
  validateExtensionsObservation,
} from "./renderer/shared/configuration-draft/extensions.mjs";

const plugin = (extra = {}) => ({
  id: "omoc.workbench.skills",
  source: { type: "builtin" },
  state: { status: "active" },
  features: { server: true, rpc: true },
  ...extra,
});
const core = () => ({
  workspaceId: "workspace-one",
  workspacePath: "/synthetic/workspace",
  status: "available",
  plugins: projectNativePlugins([plugin()]),
  tools: projectNativeTools([{ id: "mcp.demo.read", name: "read" }]),
  hooks: { status: "not_reported", reason: "inventory_not_supported" },
});

test("projects actual Native shapes into detached closed scalars", () => {
  assert.deepEqual(EXTENSIONS_LIMITS, { plugins: 128, tools: 128 });
  const raw = plugin({
    state: { status: "failed", error: "secret", ref: "secret" },
  });
  const group = projectNativePlugins([raw]);
  assert.deepEqual(group, {
    status: "available",
    rows: [
      {
        id: raw.id,
        state: "failed",
        source: { type: "builtin" },
        features: { server: true, tui: false, rpc: true },
        reason: "native_failed",
      },
    ],
  });
  raw.features.server = false;
  assert.equal(group.rows[0].features.server, true);
  let calls = 0;
  const tools = projectNativeTools([
    {
      id: "ns.read",
      name: "read",
      execute() {
        calls++;
      },
      input: { secret: true },
      description: "secret",
    },
  ]);
  assert.deepEqual(tools, {
    status: "available",
    rows: [{ id: "ns.read", name: "read" }],
  });
  assert.equal(calls, 0);
});

test("unsafe source metadata is omitted without exposing credentials", () => {
  for (const source of [
    { type: "package", target: "https://name:secret@example.test/private" },
    { type: "local", path: "file://name:secret@example.test/private" },
    { type: "local", path: "/safe/../secret" },
    { type: "local", path: "/safe/\u202esecret" },
  ]) {
    const result = projectNativePlugins([plugin({ source })]);
    assert.deepEqual(result.rows[0].source, {
      type: source.type,
      reason: "unsupported_source",
    });
    assert.equal(JSON.stringify(result).includes("secret"), false);
  }
  for (const target of [
    "demo",
    "@scope/demo",
    "@scope/demo@1.2.3-beta.1",
    "demo@latest",
  ]) {
    assert.equal(
      projectNativePlugins([plugin({ source: { type: "package", target } })])
        .rows[0].source.target,
      target,
    );
  }
  for (const path of [
    "/safe/full plugin/server.mjs",
    "C:\\safe\\plugin\\server.mjs",
    "\\\\server\\share\\plugin.mjs",
  ]) {
    assert.equal(
      projectNativePlugins([plugin({ source: { type: "local", path } })])
        .rows[0].source.path,
      path,
    );
  }
});

test("malformed, missing, duplicate and truncated Native groups fail closed", () => {
  const unavailable = { status: "unavailable", reason: "invalid_response" };
  for (const raw of [
    undefined,
    {},
    [plugin(), plugin()],
    [plugin({ id: undefined })],
    [plugin({ state: "active" })],
    [plugin({ features: { unknown: true } })],
    [plugin({ features: { server: "true" } })],
    Array(1),
    Object.assign([], { extra: true }),
    Object.setPrototypeOf([plugin()], null),
  ]) {
    assert.deepEqual(projectNativePlugins(raw), unavailable);
  }
  assert.deepEqual(
    projectNativePlugins(
      Array.from({ length: 129 }, (_, i) => plugin({ id: `plugin-${i}` })),
    ),
    { status: "unavailable", reason: "limit_reached" },
  );
  assert.deepEqual(
    projectNativeTools([
      { id: "a", name: "a" },
      { id: "a", name: "b" },
    ]),
    unavailable,
  );
  assert.deepEqual(
    projectNativeTools([{ id: "https://user:secret@example.test", name: "a" }]),
    unavailable,
  );
  assert.deepEqual(projectNativePlugins([]), { status: "available", rows: [] });
});

test("data validation never evaluates getters or toJSON callbacks", () => {
  let calls = 0;
  const getter = {
    get id() {
      calls++;
      throw new Error("secret");
    },
  };
  for (const raw of [
    [getter],
    [Object.create(plugin())],
    [Object.assign(plugin(), { [Symbol("bad")]: true })],
  ])
    assert.equal(projectNativePlugins(raw).status, "unavailable");
  const array = [];
  Object.defineProperty(array, "0", {
    get() {
      calls++;
      throw new Error("secret");
    },
  });
  assert.equal(projectNativeTools(array).status, "unavailable");
  assert.equal(
    projectNativeTools([
      {
        id: "read",
        name: "read",
        toJSON() {
          calls++;
        },
      },
    ]).status,
    "available",
  );
  assert.equal(calls, 0);
});

test("byte limits and full dense inventory boundaries are exact", () => {
  for (const project of [projectNativePlugins, projectNativeTools]) {
    const raw = Array.from({ length: 128 }, (_, i) =>
      project === projectNativePlugins
        ? plugin({ id: `plugin-${i}` })
        : { id: `tool-${i}`, name: "도구" },
    );
    assert.equal(project(raw).rows.length, 128);
    raw.push(
      project === projectNativePlugins
        ? plugin({ id: "overflow" })
        : { id: "overflow", name: "도구" },
    );
    assert.deepEqual(project(raw), {
      status: "unavailable",
      reason: "limit_reached",
    });
  }
  assert.equal(
    projectNativeTools([{ id: "read", name: "é".repeat(256) }]).status,
    "available",
  );
  assert.equal(
    projectNativeTools([{ id: "read", name: "é".repeat(257) }]).status,
    "unavailable",
  );
  const safePath = `/${"é".repeat(16383)}a`;
  assert.equal(
    projectNativePlugins([
      plugin({ source: { type: "local", path: safePath } }),
    ]).rows[0].source.path,
    safePath,
  );
  assert.equal(
    projectNativePlugins([
      plugin({ source: { type: "local", path: `${safePath}a` } }),
    ]).rows[0].source.reason,
    "unsupported_source",
  );
  for (const state of [
    { status: "active", surprise: true },
    { status: "failed" },
    { status: "failed", error: {} },
  ])
    assert.equal(
      projectNativePlugins([plugin({ state })]).status,
      "unavailable",
    );
});

test("all public group/status combinations are exact and closed at every level", () => {
  for (const plugins of [
    { status: "available", rows: [] },
    { status: "unavailable", reason: "limit_reached" },
  ]) {
    for (const tools of [
      { status: "available", rows: [] },
      { status: "unavailable", reason: "runtime_unavailable" },
    ]) {
      const count =
        Number(plugins.status === "available") +
        Number(tools.status === "available");
      const value = {
        ...core(),
        plugins,
        tools,
        status: ["unavailable", "partial", "available"][count],
      };
      assert.equal(validateExtensionsInventory(value), value);
    }
  }
  const value = core(),
    row = value.plugins.rows[0];
  for (const replacement of [
    { ...row, source: { ...row.source, target: "secret" } },
    { ...row, features: { ...row.features, hidden: true } },
    { ...row, features: { server: true, rpc: true } },
    {
      ...row,
      source: { type: "package", target: "demo", reason: "unsupported_source" },
    },
    { ...row, state: "failed" },
  ])
    assert.throws(() =>
      validateExtensionsInventory({
        ...value,
        plugins: { status: "available", rows: [replacement] },
      }),
    );
  for (const rows of [
    Array(1),
    [row, row],
    Object.assign([row], { extra: true }),
    Object.setPrototypeOf([row], null),
  ])
    assert.throws(() =>
      validateExtensionsInventory({
        ...value,
        plugins: { status: "available", rows },
      }),
    );
  let calls = 0;
  assert.throws(() =>
    validateExtensionsObservation({
      ...value,
      get runtimeEpoch() {
        calls++;
        return "epoch";
      },
      revision: 1,
    }),
  );
  assert.equal(calls, 0);
});

test("required Native fields and omitted flags never use Object.prototype values", () => {
  const names = ["id", "name", "server", "path", "target", "type"];
  const before = names.map((key) => [
    key,
    Object.getOwnPropertyDescriptor(Object.prototype, key),
  ]);
  try {
    for (const [key, value] of Object.entries({
      id: "inherited",
      name: "inherited",
      server: true,
      path: "/inherited/path",
      target: "inherited-package",
      type: "builtin",
    }))
      Object.defineProperty(Object.prototype, key, {
        value,
        configurable: true,
        writable: true,
      });
    const missingId = plugin();
    delete missingId.id;
    assert.equal(projectNativePlugins([missingId]).status, "unavailable");
    assert.equal(projectNativeTools([{}]).status, "unavailable");
    assert.equal(
      projectNativePlugins([plugin({ features: {} })]).rows[0].features.server,
      false,
    );
    assert.deepEqual(
      projectNativePlugins([plugin({ source: { type: "local" } })]).rows[0]
        .source,
      { type: "local", reason: "unsupported_source" },
    );
    assert.deepEqual(
      projectNativePlugins([plugin({ source: { type: "package" } })]).rows[0]
        .source,
      { type: "package", reason: "unsupported_source" },
    );
    assert.equal(
      projectNativePlugins([plugin({ source: {} })]).status,
      "unavailable",
    );
  } finally {
    for (const [key, descriptor] of before) {
      if (descriptor) Object.defineProperty(Object.prototype, key, descriptor);
      else delete Object.prototype[key];
    }
  }
});

test("public validators return identity and reject open, inconsistent or unsafe DTOs", () => {
  const value = core();
  assert.equal(validateExtensionsInventory(value), value);
  const full = { ...value, runtimeEpoch: "epoch-one", revision: 0 };
  assert.equal(validateExtensionsObservation(full), full);
  const bad = [
    { ...value, extra: true },
    { ...value, status: "partial" },
    { ...value, hooks: { status: "available", rows: [] } },
    {
      ...value,
      tools: { status: "unavailable", reason: "invalid_response", rows: [] },
    },
    {
      ...value,
      tools: {
        status: "available",
        rows: [{ id: "read", name: "read", execute: true }],
      },
    },
    {
      ...value,
      plugins: {
        status: "available",
        rows: [{ ...value.plugins.rows[0], reason: "native_failed" }],
      },
    },
    { ...value, workspacePath: "/safe/../wrong" },
  ];
  for (const invalid of bad)
    assert.throws(() => validateExtensionsInventory(invalid));
  for (const revision of [-1, 0.1, Number.MAX_SAFE_INTEGER + 1, "1"])
    assert.throws(() => validateExtensionsObservation({ ...full, revision }));
  for (const id of [
    "bad\n",
    "x\u0085",
    "\ud800",
    "x".repeat(513),
    "https://user:secret@example.test",
  ])
    assert.equal(projectNativePlugins([plugin({ id })]).status, "unavailable");
  const inherited = Object.create(value);
  assert.throws(() => validateExtensionsInventory(inherited));
  Object.defineProperty(value, "hidden", { value: true });
  assert.throws(() => validateExtensionsInventory(value));
});
