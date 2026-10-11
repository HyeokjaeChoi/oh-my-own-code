import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  realpath,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nativeSkillsConfig } from "./native-skills-config.mjs";
import { createNativeSkillsClient } from "./native-skills-client.mjs";
import { EVENT_HOST_CONFIG } from "./event-host-protocol.mjs";
import { NATIVE_SKILLS_RPC } from "./native-skills-protocol.mjs";

test("actual pinned RPC adapter accepts schemas and preserves rejection of extra fields", async () => {
  const { Schema, SchemaRepresentation, JsonSchema } = await import(
    "../dist/resources/opencode/event-host/darwin-arm64/node_modules/effect/dist/index.js"
  );
  const decode = (schema, input) => {
    if (schema["~standard"]) {
      const result = schema["~standard"].validate(input);
      assert.ok(!result.issues);
      return result.value;
    }
    return Schema.decodeUnknownSync(
      Schema.make(
        SchemaRepresentation.fromJsonSchemaDocument(
          JsonSchema.fromSchemaDraft2020_12(schema),
        ).ast,
      ),
    )(input);
  };
  const method = NATIVE_SKILLS_RPC.methods.observe;
  const input = {
    nonce: "a".repeat(64),
    workspaceId: "one",
    workspacePath: "/synthetic/one",
  };
  assert.deepEqual(decode(method.input, input), input);
  assert.throws(() => decode(method.input, { ...input, extra: true }));
  assert.throws(() => decode(method.input, { ...input, nonce: "invalid" }));
  assert.deepEqual(
    decode(method.output, { status: "unavailable", reason: "runtime_error" }),
    { status: "unavailable", reason: "runtime_error" },
  );
  assert.throws(() =>
    decode(method.output, {
      status: "unavailable",
      reason: "runtime_error",
      extra: true,
    }),
  );
});

test("fixed Skill plugin config preserves deny policy and rejects symlink or package substitution", async (t) => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "omoc-skill-assets-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const plugin = join(root, "builtins/workbench-skills");
  await mkdir(plugin, { recursive: true });
  const pkg = {
    name: "@oh-my-own-code/workbench-skills",
    version: "1.0.0",
    private: true,
    type: "module",
  };
  await writeFile(join(plugin, "package.json"), JSON.stringify(pkg));
  await writeFile(join(plugin, "server.mjs"), "// inert fixture\n");
  const nonce = "a".repeat(64);
  const config = JSON.parse(nativeSkillsConfig(root, nonce));
  assert.deepEqual(config, {
    ...JSON.parse(EVENT_HOST_CONFIG),
    plugins: [{ package: plugin, options: { nonce } }],
  });
  assert.deepEqual(JSON.parse(EVENT_HOST_CONFIG).plugins, []);
  assert.throws(() => nativeSkillsConfig(root, "bad"));
  await writeFile(
    join(plugin, "package.json"),
    JSON.stringify({ ...pkg, scripts: { install: "bad" } }),
  );
  assert.throws(() => nativeSkillsConfig(root, nonce));
  await writeFile(join(plugin, "package.json"), JSON.stringify(pkg));
  await rm(join(plugin, "server.mjs"));
  await writeFile(join(root, "external.mjs"), "// external\n");
  await symlink(join(root, "external.mjs"), join(plugin, "server.mjs"));
  assert.throws(() => nativeSkillsConfig(root, nonce));
});

test("private Skill client binds fixed RPC, nonce and location, snapshots input across guard await", async () => {
  const calls = [];
  let release;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  const client = {
    rpc(definition) {
      assert.equal(definition, NATIVE_SKILLS_RPC);
      return {
        observe: async (input, options) => {
          calls.push({ input, options });
          return { status: "ready" };
        },
      };
    },
  };
  let guards = 0;
  const api = createNativeSkillsClient({
    client,
    nonce: "b".repeat(64),
    assertLive: async () => {
      if (++guards === 1) await wait;
    },
  });
  const input = {
    workspaceId: "workspace-one",
    workspacePath: "/synthetic/one",
  };
  const pending = api.observe(input);
  input.workspacePath = "/synthetic/two";
  release();
  await pending;
  assert.equal(guards, 2);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].input, {
    nonce: "b".repeat(64),
    workspaceId: "workspace-one",
    workspacePath: "/synthetic/one",
  });
  assert.deepEqual(calls[0].options.location, { directory: "/synthetic/one" });
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  await assert.rejects(api.observe({ ...input, nonce: "c".repeat(64) }));
  await assert.rejects(api.observe({ ...input, extra: true }));
  assert.equal(calls.length, 1);
  const held = createNativeSkillsClient({
    client,
    nonce: "b".repeat(64),
    assertLive: async () => {
      throw new Error("owner_unverified");
    },
  });
  await assert.rejects(held.observe(input), /owner_unverified/);
  assert.equal(calls.length, 1);
});
