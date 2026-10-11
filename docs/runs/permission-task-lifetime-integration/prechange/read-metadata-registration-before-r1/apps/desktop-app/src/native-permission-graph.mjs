// App-owned graph construction. No request can provide nodes, options or sources.
import { isAbsolute, join, normalize } from "node:path";
import { pathToFileURL } from "node:url";
import { types } from "node:util";
import { verifyEventHostResources } from "./event-host-resources.mjs";
import { nativeSkillsConfig } from "./native-skills-config.mjs";
import {
  initialization,
  taskPreparation,
} from "./native-permission-control-input.mjs";

function options(input) {
  const fail = () => {
    throw new Error("native_permission_graph_unverified");
  };
  if (
    !input ||
    typeof input !== "object" ||
    types.isProxy(input) ||
    Object.getPrototypeOf(input) !== Object.prototype
  )
    fail();
  const keys = Reflect.ownKeys(input);
  if (
    keys.length !== 4 ||
    !["root", "nonce", "runtimeEpoch", "bootHolds"].every((key) =>
      keys.includes(key),
    )
  )
    fail();
  const fields = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) fail();
    fields[key] = descriptor.value;
  }
  const { root, nonce } = fields;
  if (
    typeof root !== "string" ||
    !isAbsolute(root) ||
    normalize(root) !== root ||
    root.includes("\0") ||
    !root.endsWith("/opencode/event-host/darwin-arm64") ||
    typeof nonce !== "string" ||
    !/^[a-f0-9]{64}$/u.test(nonce)
  )
    fail();
  return Object.freeze({
    root,
    nonce,
    ...initialization({
      runtimeEpoch: fields.runtimeEpoch,
      bootHolds: fields.bootHolds,
    }),
  });
}

export async function createNativePermissionGraph(input) {
  const { root, nonce, runtimeEpoch, bootHolds } = options(input);
  await verifyEventHostResources(
    {
      root,
      enginePath: join(root, "runtime/bun"),
      hostPath: join(root, "host.mjs"),
      manifestPath: join(root, "manifest.json"),
    },
    {
      platform: process.platform,
      arch: process.arch,
      requirePermissionOverlay: true,
    },
  );
  const control = await import(
    pathToFileURL(join(root, "native-permission-control.mjs")).href
  );
  const content = nativeSkillsConfig(root, nonce);
  const pinned = (file) =>
    import(pathToFileURL(join(root, "node_modules", file)).href);
  const [
    { Effect, Layer, Stream },
    { Config },
    { WellKnown },
    { ConfigPluginSource },
    { SdkPlugins },
    { InstancePlugins },
  ] = await Promise.all([
    pinned("effect/dist/index.js"),
    pinned("@opencode/core/dist/config.js"),
    pinned("@opencode/core/dist/wellknown.js"),
    pinned("@opencode/core/dist/config/plugin/source.js"),
    pinned("@opencode/core/dist/plugin/sdk.js"),
    pinned("@opencode/core/dist/plugin/instance.js"),
  ]);
  const denied = () =>
    Effect.fail(new Error("native_permission_source_denied"));
  const operations = () =>
    Effect.succeed([
      {
        type: "add",
        target: join(root, "builtins/workbench-skills"),
        options: { nonce },
      },
    ]);
  const sdk = SdkPlugins.node.mapLayer((layer) =>
    Layer.effect(
      SdkPlugins.Service,
      Effect.map(SdkPlugins.Service, (service) =>
        SdkPlugins.Service.of({ ...service, register: denied }),
      ),
    ).pipe(Layer.provide(layer)),
  );
  let acquired;
  let closed = false;
  const unavailable = () =>
    Effect.succeed(
      Object.freeze({
        status: "held",
        reason: "runtime_unavailable",
      }),
    );
  const taskControl = Object.freeze({
    prepare(request) {
      let captured;
      try {
        captured = taskPreparation(request);
      } catch (failure) {
        return Effect.fail(failure);
      }
      const service = acquired;
      return Effect.suspend(() =>
        closed || !service || acquired !== service
          ? unavailable()
          : service.prepareTask(captured),
      );
    },
    close(reason) {
      // Revoke immediately, even if the caller never runs the returned Effect.
      closed = true;
      return acquired ? acquired.invalidate(reason) : Effect.void;
    },
  });
  const overrides = [
    control.node.replace(
      control.configured({ runtimeEpoch, bootHolds }, (service) => {
        if (closed || acquired)
          throw new Error("native_permission_runtime_unavailable");
        service.inventoryConfigure(root, nonce);
        acquired = service;
      }),
    ),
    Config.node.replace(
      Config.configured({ project: false, global: false, content }),
    ),
    WellKnown.node.replace(
      Layer.succeed(
        WellKnown.Service,
        WellKnown.Service.of({
          entries: () => Effect.succeed([]),
          snapshot: () => [],
          resolve: () => Effect.succeed([]),
          refresh: () => Effect.succeed(false),
          add: denied,
          remove: denied,
        }),
      ),
    ),
    ConfigPluginSource.node.replace(
      Layer.succeed(
        ConfigPluginSource.Service,
        ConfigPluginSource.Service.of({
          operations,
          changes: () => Stream.never,
        }),
      ),
    ),
    SdkPlugins.node.replace(sdk),
    InstancePlugins.node.replace(InstancePlugins.bound([])),
  ];
  return Object.freeze({ overrides: Object.freeze(overrides), taskControl });
}
