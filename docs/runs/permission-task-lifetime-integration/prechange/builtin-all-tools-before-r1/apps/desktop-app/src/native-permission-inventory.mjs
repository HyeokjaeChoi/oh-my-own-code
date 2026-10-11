// Private fixed-source checks and Effect decorators. All mutable inventory lives
// in PermissionControl; this module owns no runtime registry or authority.
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, normalize } from "node:path";
import { record } from "./native-permission-control-input.mjs";

const fail = () => {
  throw new Error("native_permission_inventory_unverified");
};
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const FIXED_TOOL_DECLARATIONS = Object.freeze(
  Object.fromEntries(
    ["read", "question", "glob", "grep", "skill", "webfetch"].map((name) => [
      `opencode.tool.${name}`,
      Object.freeze({ toolId: name, action: name }),
    ]),
  ),
);
export const FIXED_PLUGIN_FILES = Object.freeze({
  "builtins/workbench-skills/agents.mjs":
    "1c1ac67836b8ad1d8ffbaf1f8641bfb6e8debfc847f27a81a7ea7cddd6237305",
  "builtins/workbench-skills/extensions.mjs":
    "05403d6541072d4c566f18dc7d0606cd30270ec66bc0ed95a8ad645aec1dd962",
  "builtins/workbench-skills/package.json":
    "1bc6c28af3eef0fc880a4583011977e7a30c5dd09bb63c037fecb59a978fa120",
  "builtins/workbench-skills/server.mjs":
    "b8f325bd97eef7be6eb7e16e166247d27d1496eaf06fbd6cd4dddfaef582869d",
  "native-agents-protocol.mjs":
    "c8a4f7066855b4b93a55d6752645012e2fb6d6b690588601ca7c086ca025f918",
  "native-extensions-protocol.mjs":
    "fe6f34f163787aba93090f5ed197e9605a1724b6b8f593894731996ded955d63",
  "native-skills-protocol.mjs":
    "b0ceaed5814060ea4460e9b13de3db210c0fdfbfeddc22fd232372f6f5935dd3",
  "renderer/shared/configuration-draft/agent-runtime.mjs":
    "58241c1ec4faf550d8ca3543bbb307cf5214ac1ad04602c78c5de32448220318",
  "renderer/shared/configuration-draft/agent.mjs":
    "97a23a94e8e5ba9f1f522ce605a2cb1700c70f07036638ce826ab753585a7ee3",
  "renderer/shared/configuration-draft/extensions.mjs":
    "1a51f9776ba1ef179f1fcdb3367a021ec20b881e74cc686faae0db7af3db8a04",
  "renderer/shared/configuration-draft/policy.mjs":
    "cad78a3c98ffefbc3657bf57b8f1f692a4354873bd42f95af4babed1a8db1ba8",
  "renderer/shared/configuration-draft/skill.mjs":
    "b30cf77b1967c83758a87203548e97331916e92536f5cda64e9e6c4a7ae8719a",
});
export function validateFixedPluginSource(root, nonce, input) {
  const operation = record(input, ["type", "target", "options"]);
  const options = record(operation.options, ["nonce"]);
  if (
    typeof root !== "string" ||
    !isAbsolute(root) ||
    normalize(root) !== root ||
    typeof nonce !== "string" ||
    !/^[a-f0-9]{64}$/u.test(nonce) ||
    operation.type !== "add" ||
    operation.target !== join(root, "builtins/workbench-skills") ||
    options.nonce !== nonce
  )
    fail();
  for (const directory of [root, join(root, "builtins"), operation.target]) {
    if (
      realpathSync(directory) !== directory ||
      !lstatSync(directory).isDirectory()
    )
      fail();
  }
  for (const [name, digest] of Object.entries(FIXED_PLUGIN_FILES)) {
    const path = join(root, name);
    const before = lstatSync(path);
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      before.size > 1024 * 1024 ||
      realpathSync(path) !== path
    )
      fail();
    if (sha(readFileSync(path)) !== digest) fail();
    const after = lstatSync(path);
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.mtimeNs !== after.mtimeNs ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs
    )
      fail();
  }
  return Object.freeze({
    pluginId: "omoc.workbench.skills",
    sourceSha256: FIXED_PLUGIN_FILES["builtins/workbench-skills/server.mjs"],
  });
}

// Observe registration BEFORE the underlying service can publish it. Finalizers
// use the same returned dispose path, including failed/interrupted registration.
export function observeRegistration(
  Effect,
  Scope,
  control,
  handle,
  kind,
  register,
) {
  return (...args) =>
    Effect.gen(function* () {
      if (
        (kind === "hook" &&
          (typeof args[0] !== "string" ||
            typeof args[1] !== "string" ||
            typeof args[2] !== "function")) ||
        (kind === "tool" && typeof args[0] !== "function")
      ) {
        yield* control.inventoryChanged(handle, "registration_failed");
        return yield* Effect.fail(
          new Error("native_permission_inventory_unverified"),
        );
      }
      const token = yield* control.inventoryBegin(
        handle,
        kind,
        kind === "hook" ? JSON.stringify([args[0], args[1]]) : undefined,
      );
      const guard =
        (callback) =>
        (...values) =>
          Effect.gen(function* () {
            yield* control.inventoryGuard(token);
            return yield* callback(...values);
          });
      // Hook callback is the third argument. Tool transforms are synchronous and
      // are observed at the actual editor boundary by the pinned overlay instead.
      if (kind === "hook") args[2] = guard(args[2]);
      if (kind === "tool") {
        const callback = args[0];
        args[0] = (...values) => {
          control.inventoryMutation(handle);
          return callback(...values);
        };
      }
      const result = yield* register(...args).pipe(
        Effect.onExit((exit) =>
          exit._tag === "Failure"
            ? control.inventoryEnd(token, "failed")
            : Effect.void,
        ),
      );
      yield* control.inventoryRegistered(token);
      const dispose = control
        .inventoryEnd(token, "disposed")
        .pipe(Effect.andThen(result.dispose));
      yield* Scope.addFinalizer(yield* Scope.Scope, dispose);
      return { ...result, dispose };
    });
}

// Exact identities from pinned PluginInternal pre/post arrays; not adapter proof.
export const BUILTIN_PLUGIN_ORDER = Object.freeze({
  pre: Object.freeze([
    "opencode.tool.input.repair",
    "opencode.config.worktree",
    "opencode.browser",
    "opencode.config.mcp",
    "opencode.mcp.codemode.defaults",
    "opencode.wellknown",
    "opencode.vcs.git",
    "opencode.agent",
    "opencode.plan",
    "opencode.command",
    "opencode.skill",
    "opencode.vcs.hg",
    "opencode.models.dev",
    "opencode.compaction.native",
    "opencode.provider.amazon.bedrock",
    "opencode.provider.azure",
    "opencode.provider.cerebras",
    "opencode.provider.cloudflare.ai.gateway",
    "opencode.provider.cloudflare.workers.ai",
    "opencode.provider.cohere",
    "opencode.provider.digitalocean",
    "opencode.provider.gateway",
    "opencode.provider.github.copilot",
    "opencode.provider.gitlab",
    "opencode.provider.google.vertex",
    "opencode.provider.kilo",
    "opencode.provider.llmgateway",
    "opencode.provider.lmstudio",
    "opencode.provider.modal",
    "opencode.provider.nvidia",
    "opencode.provider.ollama",
    "opencode.provider.opencode",
    "opencode.provider.snowflake.cortex",
    "opencode.provider.openai",
    "opencode.provider.openrouter",
    "opencode.provider.perplexity",
    "opencode.provider.poe",
    "opencode.provider.prompt-cache-key",
    "opencode.provider.sap.ai.core",
    "opencode.provider.vercel",
    "opencode.provider.venice",
    "opencode.provider.vllm",
    "opencode.provider.xai",
    "opencode.provider.zenmux",
    "opencode.provider.dynamic",
    "opencode.websearch.exa",
    "opencode.websearch.firecrawl",
    "opencode.websearch.parallel",
    "opencode.websearch.tavily",
    "opencode.websearch.tinyfish",
    "opencode.tool.patch",
    "opencode.prompt.openai",
    "opencode.prompt.anthropic",
    "opencode.prompt.kimi",
    "opencode.prompt.arcee",
    "opencode.prompt.meta",
    "opencode.prompt.verbosity",
    "opencode.prompt.identity",
    "opencode.tool.edit",
    "opencode.tool.glob",
    "opencode.tool.grep",
    "opencode.tools",
    "opencode.tools.mcp-resources",
    "opencode.tool.question",
    "opencode.tool.read",
    "opencode.tool.shell",
    "opencode.tool.skill",
    "opencode.tool.subagent",
    "opencode.tool.webfetch",
    "opencode.tool.websearch",
    "opencode.tool.write",
    "opencode.warming",
  ]),
  post: Object.freeze([
    "opencode.config.instruction",
    "opencode.config.reference",
    "opencode.config.agent",
    "opencode.config.command",
    "opencode.config.compaction",
    "opencode.config.formatter",
    "opencode.config.image",
    "opencode.config.location-watcher",
    "opencode.config.shell",
    "opencode.config.snapshot",
    "opencode.config.tool-output",
    "opencode.config.compatibility",
    "opencode.config.skill",
    "opencode.config.provider",
    "opencode.config.websearch",
    "opencode.config.policy",
  ]),
});
