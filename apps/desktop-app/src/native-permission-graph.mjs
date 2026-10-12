// App-owned graph construction. No request can provide nodes, options or sources.
import { isAbsolute, join, normalize } from "node:path";
import { pathToFileURL } from "node:url";
import { types } from "node:util";
import { verifyEventHostResources } from "./event-host-resources.mjs";
import { createBuiltinDeclarationProjector } from "./native-permission-tool-data.mjs";
import { NATIVE_PERMISSION_OVERLAY_RECEIPT } from "./native-permission-overlay-contract.mjs";
import { nativeSkillsConfig } from "./native-skills-config.mjs";
import {
  initialization,
  taskArmRequest,
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

// `diagnostic` is a trusted observational sink (bounded/redacted by its owner).
export async function createNativePermissionGraph(input, diagnostic) {
  const { root, nonce, runtimeEpoch, bootHolds } = options(input);
  const manifest = await verifyEventHostResources(
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
  // Database acquisition opens the configured client and runs migration before
  // PluginHost registration. Pin the inspected original constructor here; this
  // proves source identity only, not startup isolation or permission authority.
  const databaseSource = manifest.entries.find(
    (entry) =>
      entry.path ===
      "node_modules/@opencode/core/dist/chunks/config-yds56wag.js",
  );
  if (
    databaseSource?.type !== "file" ||
    databaseSource.sha256 !==
      "694e68cfbc64c520478a98074c0b7e53a5a60f555a5ada934f08635c37e6f9ee"
  )
    throw new Error("native_permission_graph_unverified");
  // The converter is an overlay output: the verified manifest holds the
  // post-overlay bytes. Bind the approved original (28f8e167...) to the
  // overlay contract's deterministic output hash before importing any Native module.
  const converter = manifest.entries.find(
    (entry) =>
      entry.path ===
      "node_modules/@opencode/core/dist/chunks/config-3w5fmr99.js",
  );
  const converterOverlay = NATIVE_PERMISSION_OVERLAY_RECEIPT.files.find(
    (file) => file.path === converter?.path,
  );
  if (
    converter?.type !== "file" ||
    converterOverlay?.beforeSha256 !==
      "28f8e167d496e3469ce4d1532b003b6adbc03c6641734be66a9e7b02fad1584d" ||
    converter.sha256 !== converterOverlay.afterSha256
  )
    throw new Error("native_permission_graph_unverified");
  // Fixed config shields literal resource paths before this original raw-text
  // substitution consumer. Pin its inspected behavior before Native imports.
  const configVariables = manifest.entries.find(
    (entry) =>
      entry.path ===
      "node_modules/@opencode/core/dist/chunks/config-s4enseaf.js",
  );
  if (
    configVariables?.type !== "file" ||
    configVariables.sha256 !==
      "164d7b54c26bec17fc4291f61569c602598b63f66c90052650ac80be2d079cdf"
  )
    throw new Error("native_permission_graph_unverified");
  // Direct State provenance requires the exact original Worktree service and
  // producer. Source identity alone never enables its held setup factory.
  for (const [chunk, digest] of [
    [
      "skwjfd4r",
      "26b0675f239f11bb5053567ad0ce8f3d32aa2e559d8158947db4ea69e4b34ffc",
    ],
    [
      "gk30pdy3",
      "3e6a9601868a860703d8fb99a2b10558a4450f9046077ce70d904d3c8c37e1ca",
    ],
  ]) {
    const entry = manifest.entries.find(
      (row) =>
        row.path ===
        `node_modules/@opencode/core/dist/chunks/config-${chunk}.js`,
    );
    if (entry?.type !== "file" || entry.sha256 !== digest)
      throw new Error("native_permission_graph_unverified");
  }
  // SDK hook registration is a private metadata list plus Scope finalizer.
  // Pin its reviewed original implementation before Host can import it.
  const sdkRegistrationSource = manifest.entries.find(
    (entry) =>
      entry.path ===
      "node_modules/@opencode/core/dist/chunks/config-ppzgkaaq.js",
  );
  if (
    sdkRegistrationSource?.type !== "file" ||
    sdkRegistrationSource.sha256 !==
      "070409f56769cf4bd845dc6adc94c51a51f4818947a6b821809b21e367c5acc5"
  )
    throw new Error("native_permission_graph_unverified");
  const modelsSource = manifest.entries.find(
    (entry) =>
      entry.path ===
      "node_modules/@opencode/core/dist/chunks/config-2synrjax.js",
  );
  if (
    modelsSource?.type !== "file" ||
    modelsSource.sha256 !==
      "768f6a969bbd880e29e67cf4f28a5395d6a9e18d58dea4c9f19f43366208f999"
  )
    throw new Error("native_permission_graph_unverified");
  // Shared factory callbacks close over unchanged caller-owned SDK loaders.
  // Pin each original caller before imports, as well as transformed factory.
  for (const [chunk, digest] of [
    [
      "z0bkrqjs",
      "e544e70da4832b6ab29e08bb416dfeed915987b22522b72a4fe288e1bd442aa2",
    ],
    [
      "669tq793",
      "74217f50ff12c4ea378921d557f4dbf7a148902febefee639c086f0881c5377a",
    ],
    [
      "veqvce7d",
      "4e4af94467e4568d02c5ad9fb069cc88950a7da8778615f9b0d8e2bda4769ad7",
    ],
    [
      "yrhqyw5v",
      "33f6a5f99d298e3b01aa1d1e18827e326ba71b50660e01f44c5304fd524881d4",
    ],
  ]) {
    const source = manifest.entries.find(
      (entry) =>
        entry.path ===
        `node_modules/@opencode/core/dist/chunks/config-${chunk}.js`,
    );
    if (source?.type !== "file" || source.sha256 !== digest)
      throw new Error("native_permission_graph_unverified");
  }
  const readSource = manifest.permissionOverlay.files.find(
    (entry) =>
      entry.path ===
      "node_modules/@opencode/core/dist/chunks/config-119mbqs2.js",
  );
  const readEffectsSource = manifest.entries.find(
    (entry) => entry.path === "native-permission-read-effect.mjs",
  );
  if (
    readSource?.beforeSha256 !==
      "80ddf77b814ec271b0a169c58eb80999867a110dfe7a554838b594ecdfbe0c84" ||
    typeof readSource.afterSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(readSource.afterSha256) ||
    readEffectsSource?.type !== "file" ||
    typeof readEffectsSource.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(readEffectsSource.sha256)
  )
    throw new Error("native_permission_graph_unverified");
  // Fixed startup maintenance stays disabled; Agent metadata may notify only
  // the fixed original LocationLifecycle listener.
  // Verify this closure before any Native import; it grants no execution mode.
  for (const [path, before] of [
    [
      "node_modules/@opencode/core/dist/chunks/config-gh5tebn4.js",
      "3fd56d8e579c116c8e766b080295d35dc0af3ac04a276834fa4649b7bfe29cef",
    ],
    [
      "node_modules/@opencode/core/dist/chunks/config-vaz5h5qv.js",
      "61e70c3fbcb62f304a6e930404e6f306a36385c5e93d58ef8ae5da2bc87aac2e",
    ],
    [
      "node_modules/@opencode/core/dist/chunks/config-znr04804.js",
      "5d3cbf85696f24f6e07fc226754ca19544d15a19abd82eaf01dfbbbb49c7107d",
    ],
    [
      "node_modules/@opencode/core/dist/chunks/config-g4xer9vd.js",
      "0b78f3dbd0899a168d980f6946490c7763b37005fe6d3bd9518cc161f1c97029",
    ],
    [
      "node_modules/@opencode/core/dist/chunks/config-hbtt76ya.js",
      "8afa7591a9f6c71e2c3169b0b55a2429ad578705ca32a67b35fe992dc8b76198",
    ],
    [
      "node_modules/@opencode/core/dist/chunks/config-11jgdds2.js",
      "ca0f6134bc21197f76ca12fede197b08f41eb4ad736db99bf3beed4eed03f992",
    ],
    [
      "node_modules/@opencode/core/dist/chunks/config-vhejgqwc.js",
      "d1c57ce84aa8014e8e2f2ba09fae01912941dc2ef614821556bd6e2b7726ccc4",
    ],
  ]) {
    const source = manifest.permissionOverlay.files.find(
      (entry) => entry.path === path,
    );
    if (
      source?.beforeSha256 !== before ||
      typeof source.afterSha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(source.afterSha256)
    )
      throw new Error("native_permission_graph_unverified");
  }
  for (const [path, digest] of [
    [
      "node_modules/@opencode/core/dist/chunks/config-gd4qta3r.js",
      "89c5db7b2a8dac6d7383745186270354317edab7c3771410532923cd32422982",
    ],
    [
      "node_modules/@opencode/core/dist/chunks/config-ec1grn59.js",
      "ae641a78a0362b12cd9f11593c12e115d4f896bee5dbafbe5052a314d88b4f82",
    ],
    [
      "node_modules/@opencode/schema/dist/event.js",
      "71d91c9726dee6df55f9a2472c034fa1941ec0c2b2b89469a40bb78231ad1e03",
    ],
    [
      "node_modules/@opencode/schema/dist/schema.js",
      "f5ca3a5da2eda8726ddfd3003203589eb20487158976beddf3f65ba602acf6c6",
    ],
    [
      "node_modules/@opencode/core/dist/chunks/config-tats7t1r.js",
      "30003b4f011a368aa4e3f9a8c86e95e6994b1f889b21a70a531297b6c79cad64",
    ],
    [
      "node_modules/@opencode/core/dist/chunks/config-rdw6cm16.js",
      "8627e8ffcac2bfc7225c3d4731b0d180c86dc1cf9b445e7f2f74fb436328288c",
    ],
    [
      "node_modules/@opencode/schema/dist/agent.js",
      "c18ebdc0462ffb0625c286b6ab8a1f6f25081f395ca06b53553ba3d3147dd25e",
    ],
    [
      "node_modules/@opencode/schema/dist/session-event.js",
      "f1e5e1652c97ebdde3fd945bca43bf7bc77ff77e949b36307ca1d9af850ff07c",
    ],
  ]) {
    const source = manifest.entries.find((entry) => entry.path === path);
    if (source?.type !== "file" || source.sha256 !== digest)
      throw new Error("native_permission_graph_unverified");
  }
  const control = await import(
    pathToFileURL(join(root, "native-permission-control.mjs")).href
  );
  const content = nativeSkillsConfig(root, nonce);
  const pinned = (file) =>
    import(pathToFileURL(join(root, "node_modules", file)).href);
  const [{ read2: originalRead }, { createNativeReadEffects }] =
    await Promise.all([
      pinned("@opencode/core/dist/chunks/config-119mbqs2.js"),
      import(
        pathToFileURL(join(root, "native-permission-read-effect.mjs")).href
      ),
    ]);
  if (
    [originalRead, createNativeReadEffects].some(
      (value) => typeof value !== "function",
    )
  )
    throw new Error("native_permission_graph_unverified");
  const [
    { isAgentMetadataListener2 },
    { Effect, Layer, Stream },
    { Config },
    { WellKnown },
    { ConfigPluginSource },
    { SdkPlugins },
    { InstancePlugins },
    { definition2 },
    { exports_models_dev: ModelsDev },
    { Plugin37: readPlugin, isReadDeclaration2, getReadPublication2 },
    {
      Plugin51: questionPlugin,
      isQuestionDeclaration2,
      getQuestionPublication2,
    },
    { Plugin38: globPlugin, isGlobDeclaration2, getGlobPublication2 },
    { Plugin50: grepPlugin, isGrepDeclaration2, getGrepPublication2 },
    { Plugin44: skillPlugin, isSkillDeclaration2, getSkillPublication2 },
    {
      Plugin43: webfetchPlugin,
      isWebfetchDeclaration2,
      getWebfetchPublication2,
    },
    { Plugin39: editPlugin, isEditDeclaration2, getEditPublication2 },
    { Plugin42: writePlugin, isWriteDeclaration2, getWritePublication2 },
    { Plugin46: patchPlugin, isPatchDeclaration2, getPatchPublication2 },
    { Plugin41: shellPlugin, isShellDeclaration2, getShellPublication2 },
    {
      Plugin49: subagentPlugin,
      isSubagentDeclaration2,
      getSubagentPublication2,
    },
    {
      Plugin45: websearchPlugin,
      isWebsearchDeclaration2,
      getWebsearchPublication2,
    },
    {
      Plugin47: opencodeToolsPlugin,
      isOpencodeToolsDeclaration2,
      getOpencodeToolsPublication2,
    },
    {
      Plugin48: mcpResourcesPlugin,
      isMcpResourcesDeclaration2,
      getMcpResourcesPublication2,
    },
    { default: browserPlugin },
    { isBrowserDeclaration2, getBrowserPublication2 },
    {
      Plugin31: repairPlugin,
      isFixedHookDeclaration2: isRepairHook,
      getFixedHookPublication2: getRepairHook,
    },
    {
      OpenAIPlugin2,
      AnthropicPlugin2,
      KimiPlugin2,
      ArceePlugin2,
      MetaPlugin2,
      isFixedHookDeclaration2: isOptimizeHook,
      getFixedHookPublication2: getOptimizeHook,
    },
    {
      Plugin29: verbosityPlugin,
      isFixedHookDeclaration2: isVerbosityHook,
      getFixedHookPublication2: getVerbosityHook,
    },
    {
      Plugin32: identityPlugin,
      isFixedHookDeclaration2: isIdentityHook,
      getFixedHookPublication2: getIdentityHook,
    },
    {
      CerebrasPlugin2,
      isFixedHookDeclaration2: isCerebrasHook,
      getFixedHookPublication2: getCerebrasHook,
    },
    {
      KiloPlugin2,
      isFixedHookDeclaration2: isKiloHook,
      getFixedHookPublication2: getKiloHook,
    },
    {
      NvidiaPlugin2,
      isFixedHookDeclaration2: isNvidiaHook,
      getFixedHookPublication2: getNvidiaHook,
    },
    {
      OpenRouterPlugin2,
      isFixedHookDeclaration2: isOpenRouterHook,
      getFixedHookPublication2: getOpenRouterHook,
    },
    {
      PromptCacheKeyPlugin2,
      isFixedHookDeclaration2: isPromptCacheKeyHook,
      getFixedHookPublication2: getPromptCacheKeyHook,
    },
    {
      ZenmuxPlugin2,
      isFixedHookDeclaration2: isZenmuxHook,
      getFixedHookPublication2: getZenmuxHook,
    },
    {
      isFixedHookDeclaration2: isSdkFactoryHook,
      getFixedHookPublication2: getSdkFactoryHook,
    },
    { CoherePlugin2 },
    { GatewayPlugin2 },
    { PerplexityPlugin2 },
    { VenicePlugin2 },
    {
      AmazonBedrockPlugin2,
      isFixedHookDeclaration2: isAmazonBedrockHook,
      getFixedHookPublication2: getAmazonBedrockHook,
    },
    {
      GoogleVertexPlugin2,
      isFixedHookDeclaration2: isGoogleVertexHook,
      getFixedHookPublication2: getGoogleVertexHook,
    },
    {
      VercelPlugin2,
      isFixedHookDeclaration2: isVercelHook,
      getFixedHookPublication2: getVercelHook,
    },
    {
      Plugin34: agentDefaultsPlugin,
      isFixedHookDeclaration2: isAgentDefaultsHook,
      getFixedHookPublication2: getAgentDefaultsHook,
    },
    {
      Plugin26: mcpDefaultsPlugin,
      isFixedHookDeclaration2: isMcpDefaultsHook,
      getFixedHookPublication2: getMcpDefaultsHook,
    },
  ] = await Promise.all([
    pinned("@opencode/core/dist/chunks/config-11jgdds2.js"),
    pinned("effect/dist/index.js"),
    pinned("@opencode/core/dist/config.js"),
    pinned("@opencode/core/dist/wellknown.js"),
    pinned("@opencode/core/dist/config/plugin/source.js"),
    pinned("@opencode/core/dist/plugin/sdk.js"),
    pinned("@opencode/core/dist/plugin/instance.js"),
    pinned("@opencode/core/dist/chunks/config-3w5fmr99.js"),
    pinned("@opencode/core/dist/chunks/config-2synrjax.js"),
    pinned("@opencode/core/dist/chunks/config-kcmnw9z9.js"),
    pinned("@opencode/core/dist/chunks/config-fcxyj98j.js"),
    pinned("@opencode/core/dist/chunks/config-ec87pa6m.js"),
    pinned("@opencode/core/dist/chunks/config-e661jwrm.js"),
    pinned("@opencode/core/dist/chunks/config-ym52mge9.js"),
    pinned("@opencode/core/dist/chunks/config-4xsr0mw7.js"),
    pinned("@opencode/core/dist/chunks/config-04zc2vp5.js"),
    pinned("@opencode/core/dist/chunks/config-5m3ds5v3.js"),
    pinned("@opencode/core/dist/chunks/config-8f36rj9w.js"),
    pinned("@opencode/core/dist/chunks/config-2et2b5t1.js"),
    pinned("@opencode/core/dist/chunks/config-191v1wnc.js"),
    pinned("@opencode/core/dist/chunks/config-9tndjada.js"),
    pinned("@opencode/core/dist/chunks/config-kb6gw2zp.js"),
    pinned("@opencode/core/dist/chunks/config-e2skv07x.js"),
    pinned("@opencode/plugin-browser/dist/index.js"),
    pinned("@opencode/plugin-browser/dist/tools.js"),
    pinned("@opencode/core/dist/chunks/config-reg6q42h.js"),
    pinned("@opencode/core/dist/chunks/config-6pc27hjz.js"),
    pinned("@opencode/core/dist/chunks/config-rqzxc8xy.js"),
    pinned("@opencode/core/dist/chunks/config-y6mhz57t.js"),
    pinned("@opencode/core/dist/chunks/config-wc3fc9cn.js"),
    pinned("@opencode/core/dist/chunks/config-qg3g05ea.js"),
    pinned("@opencode/core/dist/chunks/config-24dcb14g.js"),
    pinned("@opencode/core/dist/chunks/config-s72nwfj1.js"),
    pinned("@opencode/core/dist/chunks/config-k35dwc4g.js"),
    pinned("@opencode/core/dist/chunks/config-jjkms2e6.js"),
    pinned("@opencode/core/dist/chunks/config-ym463w8f.js"),
    pinned("@opencode/core/dist/chunks/config-z0bkrqjs.js"),
    pinned("@opencode/core/dist/chunks/config-669tq793.js"),
    pinned("@opencode/core/dist/chunks/config-veqvce7d.js"),
    pinned("@opencode/core/dist/chunks/config-yrhqyw5v.js"),
    pinned("@opencode/core/dist/chunks/config-7nwbzwwg.js"),
    pinned("@opencode/core/dist/chunks/config-8pbmndb6.js"),
    pinned("@opencode/core/dist/chunks/config-pezzyds3.js"),
    pinned("@opencode/core/dist/chunks/config-az9r17tx.js"),
    pinned("@opencode/core/dist/chunks/config-0xqyf95c.js"),
  ]);
  if (
    [isAgentMetadataListener2, isSdkFactoryHook, getSdkFactoryHook].some(
      (value) => typeof value !== "function",
    )
  )
    throw new Error("native_permission_graph_unverified");
  const bindToolSource = (service, plugin, accepts, publication, chunk) => {
    const path =
      chunk === "browser"
        ? "node_modules/@opencode/plugin-browser/dist/tools.js"
        : `node_modules/@opencode/core/dist/chunks/config-${chunk}.js`;
    const source = manifest.permissionOverlay.files.find(
      (file) => file.path === path,
    );
    if (!source || typeof publication !== "function")
      throw new Error("native_permission_graph_unverified");
    service.inventoryToolSource(
      plugin,
      accepts,
      createBuiltinDeclarationProjector({
        pluginId: plugin.id,
        sourceSha256: source.afterSha256,
        accepts,
        definition: definition2,
      }),
      publication,
    );
  };
  const bindHookSource = (service, plugin, accepts, publication, chunk) => {
    const path = `node_modules/@opencode/core/dist/chunks/config-${chunk}.js`;
    const source = manifest.permissionOverlay.files.find(
      (file) => file.path === path,
    );
    if (
      !source ||
      typeof accepts !== "function" ||
      typeof publication !== "function"
    )
      throw new Error("native_permission_graph_unverified");
    const id = plugin.id;
    service.inventoryHookSource(
      plugin,
      (value) => accepts(value, id),
      (callback) => publication(callback, id),
      source.afterSha256,
    );
  };
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
    // Private Main delivery after durable original intent only. Both fail closed
    // (typed failure, no handoff) when the graph is closed or not yet acquired.
    arm(request) {
      let captured;
      try {
        captured = taskArmRequest(request);
      } catch (failure) {
        return Effect.fail(failure);
      }
      const service = acquired;
      return Effect.suspend(() =>
        closed || !service || acquired !== service
          ? Effect.fail(new Error("native_permission_runtime_unavailable"))
          : service.armBootstrap(captured),
      );
    },
    revoke(handoffId) {
      const service = acquired;
      return Effect.suspend(() =>
        closed || !service || acquired !== service
          ? Effect.fail(new Error("native_permission_runtime_unavailable"))
          : service.revokeBootstrap(handoffId),
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
        service.bindDiagnostic(diagnostic);
        service.bindAgentNotificationSource({
          accepts: isAgentMetadataListener2,
          sourceSha256: manifest.permissionOverlay.files.find(
            (entry) =>
              entry.path ===
              "node_modules/@opencode/core/dist/chunks/config-11jgdds2.js",
          ).afterSha256,
        });
        service.inventoryConfigure(root, nonce);
        bindToolSource(
          service,
          readPlugin,
          isReadDeclaration2,
          getReadPublication2,
          "kcmnw9z9",
        );
        bindToolSource(
          service,
          questionPlugin,
          isQuestionDeclaration2,
          getQuestionPublication2,
          "fcxyj98j",
        );
        bindToolSource(
          service,
          globPlugin,
          isGlobDeclaration2,
          getGlobPublication2,
          "ec87pa6m",
        );
        bindToolSource(
          service,
          grepPlugin,
          isGrepDeclaration2,
          getGrepPublication2,
          "e661jwrm",
        );
        bindToolSource(
          service,
          skillPlugin,
          isSkillDeclaration2,
          getSkillPublication2,
          "ym52mge9",
        );
        bindToolSource(
          service,
          webfetchPlugin,
          isWebfetchDeclaration2,
          getWebfetchPublication2,
          "4xsr0mw7",
        );
        bindToolSource(
          service,
          editPlugin,
          isEditDeclaration2,
          getEditPublication2,
          "04zc2vp5",
        );
        bindToolSource(
          service,
          writePlugin,
          isWriteDeclaration2,
          getWritePublication2,
          "5m3ds5v3",
        );
        bindToolSource(
          service,
          patchPlugin,
          isPatchDeclaration2,
          getPatchPublication2,
          "8f36rj9w",
        );
        bindToolSource(
          service,
          shellPlugin,
          isShellDeclaration2,
          getShellPublication2,
          "2et2b5t1",
        );
        bindToolSource(
          service,
          subagentPlugin,
          isSubagentDeclaration2,
          getSubagentPublication2,
          "191v1wnc",
        );
        bindToolSource(
          service,
          websearchPlugin,
          isWebsearchDeclaration2,
          getWebsearchPublication2,
          "9tndjada",
        );
        bindToolSource(
          service,
          opencodeToolsPlugin,
          isOpencodeToolsDeclaration2,
          getOpencodeToolsPublication2,
          "kb6gw2zp",
        );
        bindToolSource(
          service,
          mcpResourcesPlugin,
          isMcpResourcesDeclaration2,
          getMcpResourcesPublication2,
          "e2skv07x",
        );

        bindToolSource(
          service,
          browserPlugin,
          isBrowserDeclaration2,
          getBrowserPublication2,
          "browser",
        );

        bindHookSource(
          service,
          repairPlugin,
          isRepairHook,
          getRepairHook,
          "reg6q42h",
        );
        for (const plugin of [
          OpenAIPlugin2,
          AnthropicPlugin2,
          KimiPlugin2,
          ArceePlugin2,
          MetaPlugin2,
        ])
          bindHookSource(
            service,
            plugin,
            isOptimizeHook,
            getOptimizeHook,
            "6pc27hjz",
          );
        bindHookSource(
          service,
          verbosityPlugin,
          isVerbosityHook,
          getVerbosityHook,
          "rqzxc8xy",
        );
        bindHookSource(
          service,
          identityPlugin,
          isIdentityHook,
          getIdentityHook,
          "y6mhz57t",
        );

        bindHookSource(
          service,
          CerebrasPlugin2,
          isCerebrasHook,
          getCerebrasHook,
          "wc3fc9cn",
        );
        bindHookSource(
          service,
          KiloPlugin2,
          isKiloHook,
          getKiloHook,
          "qg3g05ea",
        );
        bindHookSource(
          service,
          NvidiaPlugin2,
          isNvidiaHook,
          getNvidiaHook,
          "24dcb14g",
        );
        bindHookSource(
          service,
          OpenRouterPlugin2,
          isOpenRouterHook,
          getOpenRouterHook,
          "s72nwfj1",
        );
        bindHookSource(
          service,
          PromptCacheKeyPlugin2,
          isPromptCacheKeyHook,
          getPromptCacheKeyHook,
          "k35dwc4g",
        );
        bindHookSource(
          service,
          ZenmuxPlugin2,
          isZenmuxHook,
          getZenmuxHook,
          "jjkms2e6",
        );

        // The exported factory can create repeated IDs; bind exact owner.
        bindHookSource(
          service,
          CoherePlugin2,
          (value) => isSdkFactoryHook(value, CoherePlugin2),
          (callback) => getSdkFactoryHook(callback, CoherePlugin2),
          "ym463w8f",
        );
        bindHookSource(
          service,
          GatewayPlugin2,
          (value) => isSdkFactoryHook(value, GatewayPlugin2),
          (callback) => getSdkFactoryHook(callback, GatewayPlugin2),
          "ym463w8f",
        );
        bindHookSource(
          service,
          PerplexityPlugin2,
          (value) => isSdkFactoryHook(value, PerplexityPlugin2),
          (callback) => getSdkFactoryHook(callback, PerplexityPlugin2),
          "ym463w8f",
        );
        bindHookSource(
          service,
          VenicePlugin2,
          (value) => isSdkFactoryHook(value, VenicePlugin2),
          (callback) => getSdkFactoryHook(callback, VenicePlugin2),
          "ym463w8f",
        );
        bindHookSource(
          service,
          AmazonBedrockPlugin2,
          isAmazonBedrockHook,
          getAmazonBedrockHook,
          "7nwbzwwg",
        );
        bindHookSource(
          service,
          GoogleVertexPlugin2,
          isGoogleVertexHook,
          getGoogleVertexHook,
          "8pbmndb6",
        );
        bindHookSource(
          service,
          VercelPlugin2,
          isVercelHook,
          getVercelHook,
          "pezzyds3",
        );

        bindHookSource(
          service,
          agentDefaultsPlugin,
          isAgentDefaultsHook,
          getAgentDefaultsHook,
          "az9r17tx",
        );
        bindHookSource(
          service,
          mcpDefaultsPlugin,
          isMcpDefaultsHook,
          getMcpDefaultsHook,
          "0xqyf95c",
        );

        service.bindNativeReadRuntime({
          read: originalRead,
          effects: createNativeReadEffects,
          consumerSha256: readSource.afterSha256,
          effectsSha256: readEffectsSource.sha256,
        });

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
    ModelsDev.node.replace(
      ModelsDev.node.mapLayer(() =>
        ModelsDev.layer({ fetch: false, snapshot: true }),
      ),
    ),
    InstancePlugins.node.replace(InstancePlugins.bound([])),
  ];
  return Object.freeze({ overrides: Object.freeze(overrides), taskControl });
}
