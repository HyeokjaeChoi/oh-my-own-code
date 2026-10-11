import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  mcpNativeName,
  mcpDigest,
  normalizeMcpDefinition,
  observeMcpCatalog,
} from "./workbench-mcp.mjs";

test("inactive MCP conversion preserves exact argv, requires explicit external-auth mode and contains cwd", async () => {
  const parent = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "omoc-mcp-")),
  );
  const root = join(parent, "workspace");
  await fs.mkdir(root);
  await fs.mkdir(join(root, "inside"));
  await fs.symlink(parent, join(root, "escape"));
  const wrap = (config) =>
    JSON.stringify({ mcp: { servers: { sample: config } } });
  try {
    const source = {
      type: "local",
      command: ["node", "exact argument"],
      cwd: "inside",
      disabled: false,
    };
    const value = await normalizeMcpDefinition(root, wrap(source), "sample");
    assert.deepEqual(value.definition.command, source.command);
    assert.equal(value.definition.disabled, true);
    assert.equal(value.definition.cwd, join(root, "inside"));
    assert.match(value.digest, /^[a-f0-9]{64}$/);
    assert.ok(Object.isFrozen(value.definition.command));
    for (const cwd of ["..", "escape", join(parent, "outside"), "missing"]) {
      await assert.rejects(
        normalizeMcpDefinition(root, wrap({ ...source, cwd }), "sample"),
        { appCode: "MCP_UNSUPPORTED" },
      );
    }
    const remote = {
      type: "remote",
      url: "https://example.invalid/mcp",
      oauth: false,
    };
    assert.deepEqual(
      (await normalizeMcpDefinition(root, wrap(remote), "sample")).definition,
      { ...remote, disabled: true },
    );
    for (const config of [
      { type: "remote", url: remote.url },
      { ...remote, oauth: true },
      { ...remote, headers: { Authorization: "private-canary" } },
      { ...source, environment: { SECRET: "private-canary" } },
    ])
      await assert.rejects(
        normalizeMcpDefinition(root, wrap(config), "sample"),
        { appCode: "MCP_UNSUPPORTED" },
      );
    await assert.rejects(
      normalizeMcpDefinition(root, wrap(source), "not-in-file"),
      { appCode: "MCP_UNSUPPORTED" },
    );
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});

test("MCP observation redacts config/auth/errors, refuses malformed scope and expires live ownership", () => {
  const scope = {
    workspaceId: "workspace",
    path: "/synthetic/workspace",
    runtimeEpoch: "epoch",
  };
  const name = mcpNativeName(scope.workspaceId, "sample");
  assert.equal(name, mcpNativeName(scope.workspaceId, "sample"));
  assert.notEqual(name, mcpNativeName("other", "sample"));
  const registration = {
    ...scope,
    sourceName: "sample",
    digest: mcpDigest("submitted"),
    sourceVersion: "a".repeat(64),
    definition: { secret: "private-canary" },
  };
  const owned = new Map([[name, registration]]);
  const result = {
    location: { directory: scope.path },
    data: [
      {
        name,
        status: { status: "failed", error: "private-canary" },
        integrationID: "private-canary",
      },
    ],
  };
  const observed = observeMcpCatalog(result, { ...scope, owned });
  assert.equal(observed.status, "observed");
  assert.equal(observed.servers[0].ownership, "current_runtime");
  assert.equal(observed.servers[0].status, "failed");
  assert.equal(
    observed.servers[0].submittedDefinitionDigest,
    registration.digest,
  );
  assert.ok(!JSON.stringify(observed).includes("private-canary"));
  assert.match(observed.version, /^[a-f0-9]{64}$/);
  assert.equal(
    observeMcpCatalog(result, { ...scope, runtimeEpoch: "new-epoch", owned })
      .servers[0].ownership,
    "unowned",
  );
  assert.equal(
    observeMcpCatalog({ ...result, data: [] }, { ...scope, owned }).servers[0]
      .status,
    "absent",
  );
  for (const bad of [
    { ...result, location: { directory: "/other" } },
    { ...result, data: [...result.data, ...result.data] },
    { ...result, data: [{ name, status: { status: "new-unknown-state" } }] },
    { ...result, data: Array(301).fill(result.data[0]) },
    null,
  ])
    assert.equal(
      observeMcpCatalog(bad, { ...scope, owned }).status,
      "unavailable",
    );
});
