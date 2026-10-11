// Inert exact source extraction with pinned Effect and scripted effects only.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { NATIVE_PERMISSION_OVERLAY_RECIPE } from "./native-permission-overlay-contract.mjs";
import { planNativePermissionOverlay } from "../scripts/native-permission-overlay.mjs";

const install = new URL(
  "../runtime-event-host/.generated/install/",
  import.meta.url,
);
const { Effect, Schema, Exit, Cause } = await import(
  new URL("node_modules/effect/dist/index.js", install)
);
const pins = {
  "config-hjbc5kem.js":
    "851f52b95d70a48f17bbc99c233f6f45454dd9a43b979d00d528382d8a990191",
  "config-zrq68ahz.js":
    "475eaad9396f996a69155ece0828e12135646cad1905c41e2f123a9fa2a34757",
};
const originals = {};
const inputs = await Promise.all(
  NATIVE_PERMISSION_OVERLAY_RECIPE.files.map(async ({ path }) => ({
    path,
    content: await readFile(new URL(path, install)),
  })),
);
const planned = planNativePermissionOverlay(
  NATIVE_PERMISSION_OVERLAY_RECIPE,
  inputs,
);
for (const [name, pin] of Object.entries(pins)) {
  const bytes = await readFile(
    new URL(`node_modules/@opencode/core/dist/chunks/${name}`, install),
  );
  assert.equal(createHash("sha256").update(bytes).digest("hex"), pin);
  originals[name] = bytes.toString("utf8");
}
const transformed = (name) =>
  planned.files
    .find(({ path }) => path.endsWith(`/${name}`))
    ?.content.toString("utf8") ?? originals[name];
const sdkBody = (source) =>
  source.slice(
    source.indexOf("var loadSDKFactory2 ="),
    source.indexOf("\nexport {"),
  );
const providerBody = (source) =>
  source.slice(
    source.indexOf("var loadPackage2 ="),
    source.indexOf("var CORE_KEYS ="),
  );
const providerOriginal = originals["config-zrq68ahz.js"];
const builtinBody = providerOriginal.slice(
  providerOriginal.indexOf("var builtins ="),
  providerOriginal.indexOf("var loadPackage2 ="),
);
const names = [...builtinBody.matchAll(/import\("([^"]+)"\)/g)].map(
  (match) => match[1],
);
assert.ok(names.length > 20);

function fixture(sdkSource, providerSource, installed = true) {
  const counters = { npm: 0, resolve: 0, import: 0, builtin: 0 };
  const factory = () => "scripted-factory";
  const npm = {
    add: () =>
      Effect.sync(() => {
        counters.npm++;
        return { name: "scripted", directory: "/inert" };
      }),
  };
  const resolveModule = () => {
    counters.resolve++;
    return "inert:resolved";
  };
  const importModule = async () => {
    counters.import++;
    return { createScripted: factory };
  };
  const sdk = new Function(
    "Effect",
    "resolveModule",
    "importModule",
    sdkBody(sdkSource) + "\nreturn loadSDKFactory2;",
  )(Effect, resolveModule, importModule);
  const normalization = providerOriginal.slice(
    providerOriginal.indexOf("var AISDK_PREFIX2 ="),
    providerOriginal.indexOf("var JsonRecord ="),
  );
  const error = providerOriginal.slice(
    providerOriginal.indexOf("class LoadError3 extends"),
    providerOriginal.indexOf("var packages ="),
  );
  // Replace only import.meta.resolve and fixed literal imports with explicit counters.
  // Neither core/provider modules nor vendor code is imported.
  const builtins = builtinBody.replace(
    /import\("([^"]+)"\)/g,
    'builtinImport("$1")',
  );
  const builtinImport = async (name) => {
    assert.ok(names.includes(name));
    counters.builtin++;
    return { createScripted: factory };
  };
  const importPackage = (specifier, entrypoint, builtin) =>
    Effect.promise(() => (builtin ? builtin() : importModule(entrypoint)));
  const resolveSpecifier = () => {
    counters.resolve++;
    if (!installed) throw new Error("scripted not installed");
    return "inert:specifier";
  };
  const provider = new Function(
    "Effect",
    "Schema",
    "resolveModule",
    "importPackage",
    "resolveSpecifier",
    "builtinImport",
    normalization +
      error +
      builtins +
      providerBody(providerSource).replace(
        "import.meta.resolve(specifier)",
        "resolveSpecifier(specifier)",
      ) +
      "\nreturn loadPackage2;",
  )(
    Effect,
    Schema,
    resolveModule,
    importPackage,
    resolveSpecifier,
    builtinImport,
  );
  return { sdk, provider, npm, counters, factory };
}
const zero = { npm: 0, resolve: 0, import: 0, builtin: 0 };

for (const packageName of [
  "file:///inert/sdk.mjs",
  "unknown-sdk",
  "@opencode/ai/unknown",
]) {
  test(`original SDK ${packageName} reaches scripted effects; overlay refuses before all effects`, async () => {
    const original = fixture(originals["config-hjbc5kem.js"], providerOriginal);
    assert.equal(
      await Effect.runPromise(original.sdk(original.npm, packageName)),
      original.factory,
    );
    assert.deepEqual(
      original.counters,
      packageName.startsWith("file://")
        ? { ...zero, import: 1 }
        : { ...zero, npm: 1, resolve: 1, import: 1 },
    );
    const patched = fixture(
      transformed("config-hjbc5kem.js"),
      transformed("config-zrq68ahz.js"),
    );
    const exit = await Effect.runPromise(
      Effect.exit(patched.sdk(patched.npm, packageName)),
    );
    assert.deepEqual(patched.counters, zero);
    assert.equal(exit._tag, "Failure");
    assert.match(
      Cause.findDefect(exit.cause).success.message,
      /native_permission_provider_source_unverified/,
    );
  });
}
for (const specifier of [
  "file:///inert/provider.mjs",
  "unknown-provider",
  "@opencode/ai/unknown",
  "@opencode-ai/ai/unknown",
  "aisdk:unknown-provider",
]) {
  for (const withNpm of [false, true]) {
    test(`Provider ${specifier} npm=${withNpm} refuses unknown source before all effects`, async () => {
      const original = fixture(
        originals["config-hjbc5kem.js"],
        providerOriginal,
      );
      await Effect.runPromise(
        original.provider(specifier, withNpm ? original.npm : undefined),
      );
      assert.equal(original.counters.import, 1);
      const patched = fixture(
        transformed("config-hjbc5kem.js"),
        transformed("config-zrq68ahz.js"),
      );
      const result = await Effect.runPromiseExit(
        patched.provider(specifier, withNpm ? patched.npm : undefined),
      );
      assert.deepEqual(patched.counters, zero);
      assert.equal(result._tag, "Failure");
      const error = Exit.findErrorOption(result);
      assert.equal(error._tag, "Some");
      assert.equal(error.value._tag, "Provider.LoadError");
      assert.match(
        error.value.cause.message,
        /native_permission_provider_source_unverified/,
      );
    });
  }
}
test("all exact fixed builtin branches retain original dispatch; no execution authority is asserted", async () => {
  const branch = providerOriginal.slice(
    providerOriginal.indexOf("  const specifier = packageName2(input);"),
    providerOriginal.indexOf("  const resolved ="),
  );
  assert.ok(transformed("config-zrq68ahz.js").includes(branch));
  assert.ok(transformed("config-zrq68ahz.js").includes(builtinBody));
  for (const name of names) {
    for (const input of [
      name,
      `aisdk:${name}`,
      name.replace("@opencode/", "@opencode-ai/"),
    ]) {
      const original = fixture(
        originals["config-hjbc5kem.js"],
        providerOriginal,
      );
      const patched = fixture(
        transformed("config-hjbc5kem.js"),
        transformed("config-zrq68ahz.js"),
      );
      assert.equal(
        (await Effect.runPromise(patched.provider(input, patched.npm)))
          .createScripted,
        patched.factory,
      );
      assert.equal(
        (await Effect.runPromise(original.provider(input, original.npm)))
          .createScripted,
        original.factory,
      );
      assert.deepEqual(patched.counters, { ...zero, builtin: 1 });
      assert.deepEqual(patched.counters, original.counters);
    }
  }
});

test("original missing npm package installs then resolves/imports; overlay refuses before those effects", async () => {
  const original = fixture(
    originals["config-hjbc5kem.js"],
    providerOriginal,
    false,
  );
  await Effect.runPromise(original.provider("unknown-provider", original.npm));
  assert.deepEqual(original.counters, {
    ...zero,
    npm: 1,
    resolve: 2,
    import: 1,
  });
  const patched = fixture(
    transformed("config-hjbc5kem.js"),
    transformed("config-zrq68ahz.js"),
    false,
  );
  const exit = await Effect.runPromiseExit(
    patched.provider("unknown-provider", patched.npm),
  );
  assert.deepEqual(patched.counters, zero);
  assert.equal(Exit.findErrorOption(exit).value._tag, "Provider.LoadError");
});
