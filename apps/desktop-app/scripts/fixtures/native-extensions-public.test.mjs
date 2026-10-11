import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runExtensionsPublic } from "./native-extensions-public.mjs";
import { BASELINE_POLICY } from "../../src/workbench-contract.mjs";
import { NATIVE_EXTENSIONS_RPC_DEFINITION } from "../../src/native-extensions-protocol.mjs";

async function fixture(t, effect) {
  const namespace = await fs.mkdtemp(join(tmpdir(), "extensions-proof-test-"));
  t.after(() => fs.rm(namespace, { recursive: true, force: true }));
  const root = join(namespace, "workspace"),
    durable = {
      config: join(namespace, "config"),
      metadata: join(namespace, "metadata"),
    };
  for (const path of [root, durable.config, durable.metadata])
    await fs.mkdir(path);
  await fs.writeFile(join(durable.config, "config.json"), "{}\n");
  await fs.writeFile(join(durable.metadata, "journal"), "original\n");
  let sequence = 0,
    reads = 0;
  const session = {
    id: "native",
    agent: "build",
    permissions: globalThis.structuredClone(BASELINE_POLICY),
  };
  const registry = {
    status: () => ({ revision: 1 }),
    readView: () => ({
      runtimeEpoch: "epoch",
      revision: 1,
      observationSequence: ++sequence,
      workspaces: [{ workspaceId: "workspace", canonicalPath: root }],
      sessions: [{ nativeSessionId: "native" }],
      retainedOperations: [],
    }),
  };
  const runtime = {
    workbenchContext: () => ({
      client: {
        session: { get: async () => globalThis.structuredClone(session) },
        agent: {
          list: async () => ({
            location: { directory: root },
            data: [{ id: "build", mode: "primary" }],
          }),
        },
        rpc: (definition) => {
          assert.equal(definition, NATIVE_EXTENSIONS_RPC_DEFINITION);
          return {
            observe: async () => {
              throw { type: "denied", data: { code: "nonce_mismatch" } };
            },
          };
        },
      },
    }),
  };
  const service = {
    handle: async (envelope) => {
      const operation = envelope.operation;
      if (Object.keys(operation).length !== 2)
        return { ok: false, code: "INVALID_REQUEST" };
      reads++;
      if (effect && reads === 2) await effect({ root, durable, session });
      return {
        ok: true,
        value: {
          runtimeEpoch: "epoch",
          revision: 1,
          workspaceId: "workspace",
          workspacePath: root,
          status: "available",
          plugins: {
            status: "available",
            rows: [
              {
                id: "fixed",
                state: "active",
                source: { type: "sdk" },
                features: { server: true, tui: false, rpc: true },
              },
            ],
          },
          tools: { status: "available", rows: [{ id: "read", name: "read" }] },
          hooks: { status: "not_reported", reason: "inventory_not_supported" },
        },
      };
    },
  };
  return { runtime, registry, service, namespace, durable };
}
test("saved extension probe ignores only advancing observation sequence and preserves state/files", async (t) => {
  const f = await fixture(t);
  const result = await runExtensionsPublic(f);
  assert.equal(result.cases.length, 5);
  assert.equal(result.pluginCount, 1);
  assert.equal(result.toolCount, 1);
});
test("saved extension probe detects Native policy or app-journal mutations", async (t) => {
  for (const effect of [
    ({ session }) => {
      session.permissions = [];
    },
    ({ durable }) =>
      fs.writeFile(join(durable.metadata, "journal"), "changed\n"),
  ]) {
    const f = await fixture(t, effect);
    await assert.rejects(
      runExtensionsPublic(f),
      (error) =>
        error.code === "EXTENSIONS_PROOF_FAILED" &&
        error.extensionPhase === "PRESERVATION",
    );
  }
});
test("saved extension probe accepts a complete available empty Tool registry without creating tools", async (t) => {
  const f = await fixture(t);
  const handle = f.service.handle;
  f.service.handle = async (...args) => {
    const result = await handle(...args);
    if (result.ok) result.value.tools.rows = [];
    return result;
  };
  assert.equal((await runExtensionsPublic(f)).toolCount, 0);
});
test("failed public observation reports only bounded public and private read codes", async (t) => {
  const f = await fixture(t);
  f.service.handle = async () => ({
    ok: false,
    code: "UNAVAILABLE",
    secret: "never-export",
  });
  const context = f.runtime.workbenchContext();
  context.nativeExtensions = {
    observe: async () => {
      throw Object.assign(new Error("never-export"), {
        type: "denied",
        data: { code: "invalid_context" },
      });
    },
  };
  f.runtime.workbenchContext = () => context;
  await assert.rejects(runExtensionsPublic(f), (error) => {
    assert.deepEqual(error.extensionAssertion, {
      publicCode: "UNAVAILABLE",
      adapterCode: "invalid_context",
    });
    assert.equal(JSON.stringify(error).includes("never-export"), false);
    return true;
  });
});
