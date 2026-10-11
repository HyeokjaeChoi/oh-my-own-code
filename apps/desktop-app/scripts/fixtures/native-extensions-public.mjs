// Main-only contained proof. No provider, installation or direct tool execution.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { NATIVE_EXTENSIONS_RPC_DEFINITION } from "../../src/native-extensions-protocol.mjs";
import { validateExtensionsObservation } from "../../src/renderer/shared/configuration-draft/extensions.mjs";
import { policyMatches } from "../../src/workbench-contract.mjs";

const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function inventory(root, prefix = "") {
  const rows = [];
  for (const entry of (await fs.readdir(root, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    const path = join(root, entry.name),
      name = prefix ? `${prefix}/${entry.name}` : entry.name;
    assert.equal((await fs.lstat(path)).isSymbolicLink(), false);
    if (entry.isDirectory()) rows.push(...(await inventory(path, name)));
    else {
      assert.ok(entry.isFile());
      const bytes = await fs.readFile(path);
      rows.push({
        path: name,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
  }
  return rows;
}
export async function runExtensionsPublic({
  runtime,
  registry,
  service,
  namespace,
  durable,
}) {
  const view = registry.readView(),
    workspace = view.workspaces[0];
  assert.ok(workspace);
  const root = workspace.canonicalPath,
    workspaceId = workspace.workspaceId,
    epoch = view.runtimeEpoch;
  const rel = relative(namespace, root);
  assert.ok(rel && !rel.startsWith("..") && !isAbsolute(rel));
  const context = runtime.workbenchContext(),
    client = context.client;
  const stableView = () => {
    const { observationSequence: _sequence, ...value } = registry.readView();
    return value;
  };
  const options = () => ({ signal: AbortSignal.timeout(10000) });
  let sequence = 0,
    phase = "SEED";
  const cases = [],
    pass = (name) => cases.push({ name, result: "pass" });
  const handle = (operation) =>
    service.handle(
      {
        version: 2,
        runtimeEpoch: epoch,
        readId: `extension-public-${++sequence}`,
        operation,
      },
      "contained-extension-proof",
    );
  try {
    const sentinel = join(root, "extension-must-not-execute");
    const plugin = join(root, ".opencode/plugins/never-load.mjs");
    await fs.mkdir(join(root, ".opencode/plugins"), {
      recursive: true,
      mode: 0o700,
    });
    await fs.writeFile(
      plugin,
      `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(sentinel)}, 'executed'); export default async () => ({});\n`,
      { flag: "wx", mode: 0o600 },
    );
    await fs.writeFile(
      join(root, "opencode.json"),
      JSON.stringify({ plugins: [{ package: plugin }] }) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    const sessionState = async () => {
      const rows = [];
      for (const session of registry.readView().sessions) {
        const info = await client.session.get(
          { sessionID: session.nativeSessionId },
          options(),
        );
        assert.equal(info.id, session.nativeSessionId);
        assert.equal(policyMatches(info.permissions), true);
        rows.push(info);
      }
      return rows;
    };
    const agentState = async () => {
      const result = await client.agent.list(
        { location: { directory: root } },
        options(),
      );
      assert.equal(result.location?.directory, root);
      assert.ok(
        Array.isArray(result.data) &&
          result.data.length > 0 &&
          result.data.length <= 128,
      );
      return result.data;
    };
    phase = "BASELINE";
    const before = {
      view: stableView(),
      sessions: await sessionState(),
      agents: await agentState(),
      config: await inventory(durable.config),
      metadata: await inventory(durable.metadata),
      files: await inventory(root),
    };
    phase = "OBSERVE";
    const result = await handle({
      type: "configuration.extensions.read",
      workspaceId,
    });
    if (!result.ok) {
      const publicCodes = [
        "UNAVAILABLE",
        "INVALID_REQUEST",
        "INVALID_SELECTION",
        "BUSY",
        "READ_BUSY",
        "READ_TIMEOUT",
        "RUNTIME_ERROR",
      ];
      let adapterCode = "missing_adapter";
      if (typeof context.nativeExtensions?.observe === "function") {
        try {
          await context.nativeExtensions.observe({
            workspaceId,
            workspacePath: root,
          });
          adapterCode = "available";
        } catch (error) {
          const code = error.data?.code ?? error.message;
          adapterCode = [
            "invalid_context",
            "nonce_mismatch",
            "native_extensions_invalid",
            "native_extensions_unavailable",
            "owner_unverified",
            "event_host_held",
          ].includes(code)
            ? code
            : "unavailable";
        }
      }
      throw Object.assign(new Error("public_read_refused"), {
        extensionAssertion: {
          publicCode: publicCodes.includes(result.code)
            ? result.code
            : "unavailable",
          adapterCode,
        },
      });
    }
    assert.equal(result.ok, true);
    const observation = validateExtensionsObservation(result.value);
    assert.equal(observation.runtimeEpoch, epoch);
    assert.equal(observation.workspaceId, workspaceId);
    assert.equal(observation.workspacePath, root);
    assert.equal(observation.revision, registry.status().revision);
    assert.equal(observation.plugins.status, "available");
    assert.equal(observation.tools.status, "available");
    assert.ok(observation.plugins.rows.length > 0);
    // An available empty registry is a valid current Native observation.
    // Never reload/register a tool just to make this proof nonempty.
    assert.equal(
      observation.plugins.rows.some((row) => row.source.path === plugin),
      false,
    );
    assert.deepEqual(observation.hooks, {
      status: "not_reported",
      reason: "inventory_not_supported",
    });
    assert.equal(Object.hasOwn(result, "receipt"), false);
    pass(
      "actual-public-fixed-plugin-inventory-and-tool-presence-exact-scope-clocks-no-receipt",
    );
    pass("hooks-unsupported-is-not-reported-never-empty-or-inactive");
    phase = "CLOSED-REFUSAL";
    for (const extra of [
      { sessionId: "unrelated" },
      { execute: "read" },
      { update: true },
    ]) {
      const rejected = await handle({
        type: "configuration.extensions.read",
        workspaceId,
        ...extra,
      });
      assert.equal(rejected.code, "INVALID_REQUEST");
    }
    const rpc = client.rpc(NATIVE_EXTENSIONS_RPC_DEFINITION);
    await assert.rejects(
      rpc.observe(
        { nonce: "0".repeat(64), workspaceId, workspacePath: root },
        { location: { directory: root }, ...options() },
      ),
      (error) =>
        error.type === "denied" && error.data?.code === "nonce_mismatch",
    );
    pass("public-extra-effect-fields-and-private-wrong-nonce-refused");
    phase = "REPEAT";
    const repeated = await handle({
      type: "configuration.extensions.read",
      workspaceId,
    });
    assert.equal(repeated.ok, true);
    assert.deepEqual(repeated.value, observation);
    phase = "PRESERVATION";
    assert.deepEqual(stableView(), before.view);
    assert.deepEqual(await sessionState(), before.sessions);
    assert.deepEqual(await agentState(), before.agents);
    assert.deepEqual(await inventory(durable.config), before.config);
    assert.deepEqual(await inventory(durable.metadata), before.metadata);
    assert.deepEqual(await inventory(root), before.files);
    await assert.rejects(fs.stat(sentinel), { code: "ENOENT" });
    pass(
      "repeat-reads-preserve-session-default-policy-config-app-journal-and-workspace-bytes",
    );
    pass("project-plugin-config-reference-stays-inert-sentinel-absent");
    return {
      cases,
      pluginCount: observation.plugins.rows.length,
      toolCount: observation.tools.rows.length,
      observationSha256: hash(observation),
      preservedSessionStateSha256: hash(before.sessions),
      preservedAgentDefaultStateSha256: hash(before.agents),
      preservedRegistrySha256: hash(before.view),
      workspaceId,
    };
  } catch (error) {
    throw Object.assign(new Error("contained_extension_proof_failed"), {
      code: "EXTENSIONS_PROOF_FAILED",
      extensionPhase: phase,
      ...(error.extensionAssertion
        ? { extensionAssertion: error.extensionAssertion }
        : error.code === "ERR_ASSERTION" && {
            extensionAssertion: {
              operator: error.operator,
              location: String(error.stack).match(
                /native-extensions-public\.mjs:\d+:\d+/u,
              )?.[0],
            },
          }),
    });
  }
}
