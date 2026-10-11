import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  symlink,
  readFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  syntheticMcpProbeText,
  claimMcpProbeOutput,
  validateSyntheticStartup,
  validateMcpExitEvent,
} from "./configuration-mcp-probe.mjs";
import { syntheticMcpResponse } from "./fixtures/synthetic-mcp-server.mjs";
import {
  createSyntheticMcpConfirmation,
  observeMcpClient,
} from "./fixtures/p7-storage-owner-host.mjs";

test("MCP evidence claims refuse reuse, escape and symlink redirects", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "mcp-claim-")));
  try {
    const base = join(root, "docs/runs/configuration-mcp/evidence");
    const out = join(base, "native-r1");
    assert.equal(await claimMcpProbeOutput(root, out), out);
    await assert.rejects(claimMcpProbeOutput(root, out));
    await assert.rejects(claimMcpProbeOutput(root, join(root, "outside")));
    await assert.rejects(claimMcpProbeOutput(root, join(base, "native-r0")));
    const elsewhere = join(root, "elsewhere");
    await mkdir(elsewhere);
    await symlink(elsewhere, join(base, "native-r2"));
    await assert.rejects(claimMcpProbeOutput(root, join(base, "native-r2")));
    assert.match(
      await readFile(join(out, ".configuration-mcp-claim"), "utf8"),
      /synthetic/,
    );
  } finally {
    await rm(root, { recursive: true });
  }
});
test("synthetic MCP protocol handles actual initialize, list, call and ping without execution", () => {
  const request = (method, params) => ({
    jsonrpc: "2.0",
    id: 7,
    method,
    params,
  });
  const init = syntheticMcpResponse(
    request("initialize", { protocolVersion: "2025-03-26" }),
  );
  assert.equal(init.result.protocolVersion, "2025-03-26");
  assert.deepEqual(init.result.capabilities, { tools: {} });
  assert.equal(
    syntheticMcpResponse({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }),
    undefined,
  );
  assert.deepEqual(syntheticMcpResponse(request("ping")).result, {});
  assert.equal(
    syntheticMcpResponse(request("tools/list")).result.tools[0].name,
    "synthetic_echo",
  );
  assert.equal(
    syntheticMcpResponse(
      request("tools/call", { name: "synthetic_echo", arguments: {} }),
    ).result.content[0].text,
    "SYNTHETIC_MCP_ONLY",
  );
  assert.equal(
    syntheticMcpResponse(request("tools/call", { name: "exec" })).error.code,
    -32602,
  );
  assert.equal(syntheticMcpResponse(request("unknown")).error.code, -32601);
  assert.equal(syntheticMcpResponse(null).error.code, -32600);
});
test("exit acceptance requires exact birth identity and actual kernel event", () => {
  const identity = {
    pid: 123,
    platform: "darwin",
    bootId: "a".repeat(64),
    startToken: "b".repeat(64),
  };
  const startup = validateSyntheticStartup(
    { pid: 123, marker: "marker-one" },
    "marker-one",
  );
  assert.equal(startup.pid, 123);
  assert.throws(() =>
    validateSyntheticStartup({ ...startup, marker: "wrong" }, "marker-one"),
  );
  assert.throws(() =>
    validateSyntheticStartup({ ...startup, pid: 0 }, "marker-one"),
  );
  const event = { event: "NOTE_EXIT", pid: 123, filter: "EVFILT_PROC" };
  assert.equal(validateMcpExitEvent(event, identity, identity), true);
  for (const bad of [
    { ...event, pid: 124 },
    { ...event, event: "disabled" },
    { ...event, filter: "poll" },
  ])
    assert.throws(() => validateMcpExitEvent(bad, identity, identity));
  assert.throws(() =>
    validateMcpExitEvent(event, identity, {
      ...identity,
      startToken: "c".repeat(64),
    }),
  );
});
test("synthetic confirmation requires frozen exact target, nested argv and contained root", async () => {
  const state = { enabled: false, requests: [] };
  const confirm = createSyntheticMcpConfirmation("/synthetic", state);
  const definition = Object.freeze({
    type: "local",
    command: Object.freeze([
      "/node",
      new URL("./fixtures/synthetic-mcp-server.mjs", import.meta.url).pathname,
      "--startup",
      "/synthetic/startup.jsonl",
      "--marker",
      "marker-one",
    ]),
    cwd: "/synthetic/workspace",
    disabled: true,
  });
  const target = Object.freeze({
    action: "register",
    workspaceId: "w",
    workspacePath: "/synthetic/workspace",
    sourceName: "demo",
    nativeName: "omoc-mcp-" + "a".repeat(40),
    expectedObservationVersion: "a".repeat(64),
    digest: "b".repeat(64),
    sourceVersion: "c".repeat(64),
    definition,
  });
  // Name is derived by the production helper, not accepted as arbitrary input.
  const { mcpNativeName } = await import("../src/host/workbench-mcp.mjs");
  const valid = Object.freeze({
    ...target,
    nativeName: mcpNativeName("w", "demo"),
  });
  assert.equal(await confirm(valid), false);
  state.enabled = true;
  assert.equal(await confirm(valid), true);
  await assert.rejects(confirm({ ...valid }));
  await assert.rejects(
    confirm(Object.freeze({ ...valid, workspacePath: "/synthetic-escape/w" })),
  );
  await assert.rejects(
    confirm(Object.freeze({ ...valid, definition: { ...definition } })),
  );
});
test("SDK counting wrapper preserves actual calls/results/errors", async () => {
  const calls = [];
  const counts = { list: 0, add: 0, connect: 0, disconnect: 0, remove: 0 };
  const client = {
    mcp: Object.fromEntries(
      Object.keys(counts).map((method) => [
        method,
        async (...args) => {
          calls.push([method, ...args]);
          if (method === "remove") throw new Error("synthetic");
          return method;
        },
      ]),
    ),
  };
  assert.equal(observeMcpClient(client, counts), client);
  assert.equal(await client.mcp.connect({ server: "demo" }), "connect");
  await assert.rejects(client.mcp.remove({ server: "demo" }));
  assert.equal(counts.connect, 1);
  assert.equal(counts.remove, 1);
  assert.deepEqual(calls[0], ["connect", { server: "demo" }]);
});

test("explicit synthetic failure gate follows real add and read, then resets", async () => {
  const calls = [],
    fault = { nextAddPostread: true };
  const counts = { list: 0, add: 0, connect: 0, disconnect: 0, remove: 0 };
  const client = {
    mcp: {
      list: async () => {
        calls.push("list");
        return { data: [] };
      },
      add: async () => {
        calls.push("add");
      },
    },
  };
  observeMcpClient(client, counts, fault);
  await client.mcp.list();
  await client.mcp.add();
  await assert.rejects(
    client.mcp.list(),
    /Explicit synthetic post-add read failure/,
  );
  assert.deepEqual(await client.mcp.list(), { data: [] });
  assert.deepEqual(calls, ["list", "add", "list", "list"]);
  assert.equal(counts.add, 1);
});

test("saved MCP probe input satisfies the actual supported file reader before any Native launch", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "mcp-probe-source-")),
  );
  const { readConfigurationFile } = await import(
    "../src/host/workbench-configuration-files.mjs"
  );
  const { writeFile } = await import("node:fs/promises");
  const path = join(root, "opencode.json");
  try {
    const text = syntheticMcpProbeText(
      "/synthetic/node",
      "/synthetic/server.mjs",
      join(root, "startup.jsonl"),
      "synthetic-marker",
    );
    await writeFile(path, "\ufeff" + text);
    const unsupported = await readConfigurationFile(
      { id: "probe", path: root },
      "mcp",
    );
    assert.equal(unsupported.status, "unsupported");
    assert.equal(unsupported.reason, "unsupported_content");
    await writeFile(path, text);
    const loaded = await readConfigurationFile(
      { id: "probe", path: root },
      "mcp",
    );
    assert.equal(loaded.status, "available");
    assert.equal(loaded.content, text);
    assert.throws(() =>
      syntheticMcpProbeText(
        "x".repeat(1025),
        "/server",
        join(root, "startup.jsonl"),
        "marker",
      ),
    );
  } finally {
    await rm(root, { recursive: true });
  }
});

test(
  "actual macOS observer attaches before exact owned synthetic exit",
  { skip: process.platform !== "darwin" },
  async () => {
    const { spawn } = await import("node:child_process");
    const { once } = await import("node:events");
    const { createInterface } = await import("node:readline");
    const { createOSProcessIdentityAdapter } = await import(
      "../src/sidecar-supervisor.mjs"
    );
    const target = spawn(process.execPath, ["-e", "process.stdin.resume()"], {
      stdio: ["pipe", "ignore", "ignore"],
    });
    const targetDone = once(target, "exit");
    let observer, observerDone;
    try {
      const adapter = createOSProcessIdentityAdapter();
      const before = await adapter.capture(target.pid);
      assert.ok(before);
      observer = spawn(
        "/usr/bin/python3",
        [
          new URL("./fixtures/mcp-exit-observer.py", import.meta.url).pathname,
          String(target.pid),
          "10",
        ],
        {
          stdio: ["ignore", "pipe", "ignore"],
          env: { PATH: "/usr/bin:/bin", PYTHONDONTWRITEBYTECODE: "1" },
        },
      );
      observerDone = once(observer, "exit");
      const lines = createInterface({ input: observer.stdout })[
        Symbol.asyncIterator
      ]();
      const first = await lines.next();
      assert.equal(first.done, false);
      assert.deepEqual(JSON.parse(first.value), {
        event: "READY",
        pid: target.pid,
      });
      const attached = await adapter.capture(target.pid);
      assert.deepEqual(attached, before);
      target.stdin.end();
      const event = await lines.next();
      assert.equal(event.done, false);
      assert.equal(
        validateMcpExitEvent(JSON.parse(event.value), before, attached),
        true,
      );
      assert.deepEqual(await observerDone, [0, null]);
      assert.deepEqual(await targetDone, [0, null]);
    } finally {
      target.stdin.end();
      if (
        observer &&
        observer.exitCode === null &&
        observer.signalCode === null
      )
        observer.kill("SIGTERM");
      await targetDone;
      if (observerDone) await observerDone;
    }
  },
);
