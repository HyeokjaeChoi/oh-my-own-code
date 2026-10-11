import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import { NATIVE_PERMISSION_OVERLAY_RECIPE as recipe } from "./native-permission-overlay-contract.mjs";

const root = new URL(
  "../runtime-event-host/.generated/install/",
  import.meta.url,
);
const specs = [
  ["wc3fc9cn", "CerebrasPlugin2", "cerebras", ["provider"]],
  ["qg3g05ea", "KiloPlugin2", "kilo", ["provider"]],
  ["24dcb14g", "NvidiaPlugin2", "nvidia", ["provider"]],
  ["s72nwfj1", "OpenRouterPlugin2", "openrouter", ["provider", "model"]],
  ["k35dwc4g", "PromptCacheKeyPlugin2", "prompt-cache-key", ["model"]],
  ["jjkms2e6", "ZenmuxPlugin2", "zenmux", ["provider"]],
].map(([chunk, variable, suffix, domains]) => ({
  path: `node_modules/@opencode/core/dist/chunks/config-${chunk}.js`,
  variable,
  id: `opencode.provider.${suffix}`,
  domains,
}));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const receipt = JSON.parse(
  await readFile(new URL("../receipt.json", root), "utf8"),
);
async function sources(spec) {
  const before = await readFile(new URL(spec.path, root), "utf8");
  assert.equal(
    hash(before),
    receipt.installEntries.find((row) => row.path === spec.path)?.sha256,
  );
  const entry = recipe.files.find((row) => row.path === spec.path);
  let after = before;
  for (const edit of entry?.edits ?? []) {
    assert.equal(after.split(edit.find).length - 1, 1);
    after = after.replace(edit.find, () => edit.replace);
  }
  return { before, after, entry };
}
test("six service-free Provider sources expose the existing fixed hook APIs", async () => {
  for (const spec of specs) {
    const { after } = await sources(spec);
    assert.match(
      after,
      /export var isFixedHookDeclaration2 =/,
      `${spec.id}: missing source API`,
    );
    assert.match(after, /export var getFixedHookPublication2 =/);
  }
});

// Compile selected inert declarations only. Never import a Provider/core module.
const require = createRequire(import.meta.url);
const eslintRequire = createRequire(require.resolve("eslint"));
const parse = eslintRequire("espree").parse;
const scope = eslintRequire("eslint-scope");
const ast = (source) =>
  parse(source, { ecmaVersion: "latest", sourceType: "module", range: true });
function walk(node, visit) {
  if (!node || typeof node !== "object") return;
  if (node.type) visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === "range") continue;
    if (Array.isArray(value)) value.forEach((child) => walk(child, visit));
    else if (value && typeof value === "object") walk(value, visit);
  }
}
function selected(source, names) {
  const found = ast(source)
    .body.map((node) =>
      node.type === "ExportNamedDeclaration" ? node.declaration : node,
    )
    .filter(
      (node) =>
        node &&
        (node.type === "FunctionDeclaration"
          ? names.includes(node.id.name)
          : node.type === "VariableDeclaration" &&
            node.declarations.every((row) => names.includes(row.id.name))),
    );
  assert.equal(
    found.flatMap((node) =>
      node.type === "FunctionDeclaration"
        ? [node.id.name]
        : node.declarations.map((row) => row.id.name),
    ).length,
    names.length,
  );
  return found.map((node) => source.slice(...node.range)).join("\n");
}
function originalRegistrations(source) {
  const rows = [];
  walk(ast(source), (node) => {
    if (
      node.type === "CallExpression" &&
      node.callee.type === "MemberExpression" &&
      node.callee.property.name === "transform" &&
      node.callee.object.object?.name === "ctx"
    ) {
      assert.equal(node.arguments.length, 1);
      rows.push({
        domain: node.callee.object.property.name,
        callback: source.slice(...node.arguments[0].range),
      });
    }
  });
  return rows;
}
function references(source) {
  return [
    ...new Set(
      scope
        .analyze(ast(source), { ecmaVersion: 2024, sourceType: "module" })
        .globalScope.through.map((ref) => ref.identifier.name),
    ),
  ].sort();
}
const privateNames = [
  "fixedHookDeclarations2",
  "fixedHookPublications2",
  "isFixedHookDeclaration2",
  "getFixedHookPublication2",
  "fixedHookBundle2",
  "fixedHookDeclaration2",
];
const effectPath = "node_modules/effect/dist/index.js";
assert.equal(
  hash(await readFile(new URL(effectPath, root))),
  receipt.installEntries.find((row) => row.path === effectPath)?.sha256,
);
const { Effect } = await import(
  "../runtime-event-host/.generated/install/node_modules/effect/dist/index.js"
);
const definePath = "node_modules/@opencode/plugin/dist/effect/plugin.js";
const defineBytes = await readFile(new URL(definePath, root), "utf8");
assert.equal(
  hash(defineBytes),
  receipt.installEntries.find((row) => row.path === definePath)?.sha256,
);
const defineSource = selected(defineBytes, ["define"]);
function trap() {
  return new Proxy(function () {}, {
    get() {
      throw Error("inert declaration touched a callback dependency");
    },
    apply() {
      throw Error("inert declaration executed a callback dependency");
    },
  });
}
function load(source, spec, patched) {
  const names = [
    spec.variable,
    ...(spec.id.endsWith("prompt-cache-key") ? ["providerIDs"] : []),
    ...(patched ? privateNames : []),
  ];
  const code = `${defineSource}\n${selected(source, names)}`;
  const external = references(code);
  const originalExternal = spec.id.endsWith("openrouter")
    ? ["Effect", "ID11"]
    : spec.id.endsWith("prompt-cache-key")
      ? ["Effect", "ID12"]
      : ["Effect"];
  assert.deepEqual(
    external,
    [
      ...originalExternal,
      ...(patched ? ["Object", "WeakMap", "undefined"] : []),
    ].sort(),
    "closed original dependency set; no IO/module execution",
  );
  return new Function(
    "Effect",
    "ID11",
    "ID12",
    `${code}; return { plugin: ${spec.variable}, ${patched ? "make: fixedHookDeclaration2, accepts: isFixedHookDeclaration2, lookup: getFixedHookPublication2" : ""} };`,
  )(Effect, trap(), trap());
}
function fixture(spec, failIndex = -1) {
  const log = [],
    rows = [];
  const ctx = {};
  for (const domain of new Set(spec.domains))
    ctx[domain] = {
      transform(...args) {
        const index = rows.length;
        log.push(`construct:${domain}`);
        rows.push({ domain, args });
        // Only registration is scripted. No callback or event is executed.
        return Effect.acquireRelease(
          Effect.sync(() => {
            log.push(`register:${domain}`);
            if (index === failIndex)
              throw Error("scripted registration failure");
          }),
          () => Effect.sync(() => log.push(`release:${domain}`)),
        );
      },
    };
  return { ctx, log, rows };
}
for (const spec of specs) {
  test(`${spec.id}: exact sources/dependencies, private branding, lazy Scope publication`, async () => {
    const { before, after, entry } = await sources(spec);
    assert.ok(entry);
    assert.equal(hash(before), entry.beforeSha256);
    assert.equal(hash(after), entry.afterSha256);
    ast(after);
    let restored = after;
    for (const edit of [...entry.edits].reverse()) {
      assert.equal(restored.split(edit.replace).length - 1, 1);
      restored = restored.replace(edit.replace, () => edit.find);
    }
    assert.equal(restored, before);
    const original = originalRegistrations(before);
    assert.deepEqual(
      original.map((row) => row.domain),
      spec.domains,
    );
    const current = load(after, spec, true),
      foreign = load(after, spec, true),
      baseline = load(before, spec, false);
    assert.equal(current.plugin.id, spec.id);
    assert.ok(Object.isFrozen(current.plugin));
    // Original Effect.fn form stays inside the descriptor; declarations stay generator-lazy.
    assert.match(
      after,
      /effect: Effect\.fn\(function\* \(ctx\) \{\n {4}const declaration = fixedHookDeclaration2\(\);/,
    );
    if (spec.id.endsWith("prompt-cache-key"))
      assert.equal(
        selected(after, ["providerIDs"]),
        selected(before, ["providerIDs"]),
      );
    const bundle = current.make(trap());
    assert.deepEqual(Reflect.ownKeys(bundle), ["hooks"]);
    assert.ok(Object.isFrozen(bundle) && Object.isFrozen(bundle.hooks));
    assert.equal(bundle.hooks.length, original.length);
    assert.equal(current.accepts(bundle, spec.id), true);
    assert.equal(foreign.accepts(bundle, spec.id), false);
    bundle.hooks.forEach((row, index) => {
      assert.ok(Object.isFrozen(row));
      assert.deepEqual(Reflect.ownKeys(row), [
        "domain",
        "name",
        "callback",
        "options",
      ]);
      assert.equal(row.domain, original[index].domain);
      assert.equal(row.name, "transform");
      assert.equal(row.options, undefined);
      assert.equal(
        row.callback.toString(),
        original[index].callback,
        "byte-exact original expression",
      );
      assert.deepEqual(
        references(`(${row.callback.toString()});`),
        references(`(${original[index].callback});`),
      );
      assert.equal(current.lookup(row.callback, spec.id), bundle);
      assert.equal(current.lookup(row.callback.bind(null), spec.id), undefined);
      assert.equal(
        current.lookup(
          new Function(`return (${row.callback.toString()});`)(),
          spec.id,
        ),
        undefined,
      );
      assert.equal(foreign.lookup(row.callback, spec.id), undefined);
      for (const wrong of [
        undefined,
        null,
        "",
        "foreign",
        ...specs.filter((s) => s.id !== spec.id).map((s) => s.id),
      ]) {
        assert.equal(current.accepts(bundle, wrong), false);
        assert.equal(current.lookup(row.callback, wrong), undefined);
      }
    });
    const forged = [
      undefined,
      null,
      1,
      {},
      trap(),
      { ...bundle },
      { hooks: [] },
      { hooks: bundle.hooks.toReversed() },
      { hooks: [...bundle.hooks, bundle.hooks[0]] },
      { hooks: bundle.hooks.slice(1) },
      { hooks: bundle.hooks.map((row) => ({ ...row, options: {} })) },
      {
        hooks: bundle.hooks.map((row) => ({
          ...row,
          callback: row.callback.bind(null),
        })),
      },
    ];
    for (const value of forged) {
      assert.equal(current.accepts(value, spec.id), false);
      assert.equal(current.lookup(value, spec.id), undefined);
    }
    const f = fixture(spec);
    const pending = current.plugin.effect(f.ctx);
    assert.deepEqual(
      f.log,
      [],
      "Effect.fn invocation cannot register or create a publication",
    );
    const returned = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const declaration = yield* pending;
          assert.equal(current.accepts(declaration, spec.id), true);
          assert.deepEqual(
            f.log,
            spec.domains.flatMap((domain) => [
              `construct:${domain}`,
              `register:${domain}`,
            ]),
          );
          assert.equal(f.rows.length, declaration.hooks.length);
          f.rows.forEach(({ domain, args }, index) => {
            assert.equal(domain, declaration.hooks[index].domain);
            assert.equal(
              args.length,
              1,
              "original absent options argument remains absent",
            );
            assert.equal(args[0], declaration.hooks[index].callback);
            assert.equal(
              current.lookup(args[0], spec.id),
              declaration,
              "same returned/registered bundle",
            );
          });
          return declaration;
        }),
      ),
    );
    assert.notEqual(returned, bundle);
    assert.deepEqual(f.log, [
      ...spec.domains.flatMap((domain) => [
        `construct:${domain}`,
        `register:${domain}`,
      ]),
      ...spec.domains.toReversed().map((domain) => `release:${domain}`),
    ]);
    const old = fixture(spec);
    const oldPending = baseline.plugin.effect(old.ctx);
    assert.deepEqual(old.log, []);
    assert.equal(await Effect.runPromise(Effect.scoped(oldPending)), undefined);
    assert.deepEqual(
      old.log,
      f.log,
      "original registration position/order/Scope cleanup",
    );
    old.rows.forEach(({ args }, index) =>
      assert.equal(
        args[0].toString(),
        returned.hooks[index].callback.toString(),
      ),
    );
    const second = fixture(spec);
    const next = await Effect.runPromise(
      Effect.scoped(current.plugin.effect(second.ctx)),
    );
    assert.notEqual(next, returned);
    assert.notEqual(next.hooks[0].callback, returned.hooks[0].callback);
    assert.equal(
      current.lookup(returned.hooks[0].callback, spec.id),
      returned,
      "same fixed8 source-brand lifetime after Scope cleanup",
    );
    assert.throws(() => {
      bundle.hooks[0] = {};
    }, TypeError);
    assert.throws(() => {
      bundle.hooks[0].options = {};
    }, TypeError);
    if (spec.domains.length === 2) {
      const failed = fixture(spec, 1);
      await assert.rejects(
        Effect.runPromise(Effect.scoped(current.plugin.effect(failed.ctx))),
        /scripted registration failure/,
      );
      assert.deepEqual(failed.log, [
        "construct:provider",
        "register:provider",
        "construct:model",
        "register:model",
        "release:provider",
      ]);
    }
  });
}
