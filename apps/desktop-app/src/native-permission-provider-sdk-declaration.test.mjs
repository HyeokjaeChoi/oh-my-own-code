import { assertOnlyCreateGateChanged } from "./native-permission-overlay-bootstrap-edit.mjs";
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
const callers = [
  ["z0bkrqjs", "CoherePlugin2", "cohere"],
  ["669tq793", "GatewayPlugin2", "gateway"],
  ["veqvce7d", "PerplexityPlugin2", "perplexity"],
  ["yrhqyw5v", "VenicePlugin2", "venice"],
].map(([chunk, variable, suffix]) => ({
  path: `node_modules/@opencode/core/dist/chunks/config-${chunk}.js`,
  variable,
  id: `opencode.provider.${suffix}`,
  shared: true,
  domains: ["aisdk"],
  names: ["sdk"],
}));
const factory = {
  path: "node_modules/@opencode/core/dist/chunks/config-ym463w8f.js",
};
const individuals = [
  [
    "7nwbzwwg",
    "AmazonBedrockPlugin2",
    "amazon.bedrock",
    ["integration", "provider"],
    ["transform", "transform"],
    ["CHAIN_ENV", "isBedrock"],
  ],
  [
    "8pbmndb6",
    "GoogleVertexPlugin2",
    "google.vertex",
    ["provider", "model", "aisdk"],
    ["transform", "transform", "language"],
    [
      "resolveProject",
      "resolveLocation",
      "vertexEndpoint",
      "replaceVertexVars",
    ],
  ],
  [
    "pezzyds3",
    "VercelPlugin2",
    "vercel",
    ["provider", "aisdk"],
    ["transform", "sdk"],
    [],
  ],
].map(([chunk, variable, suffix, domains, names, helpers]) => ({
  path: `node_modules/@opencode/core/dist/chunks/config-${chunk}.js`,
  variable,
  id: `opencode.provider.${suffix}`,
  domains,
  names,
  helpers,
}));
const specs = [...callers, ...individuals];
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
test("four SDK producer sources expose the agreed fixed hook APIs", async () => {
  for (const spec of [factory, ...individuals]) {
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
      ["transform", "hook"].includes(node.callee.property.name) &&
      node.callee.object.object?.name === "ctx"
    ) {
      assert.equal(
        node.arguments.length,
        node.callee.property.name === "hook" ? 2 : 1,
      );
      rows.push({
        domain: node.callee.object.property.name,
        name:
          node.callee.property.name === "hook"
            ? node.arguments[0].value
            : "transform",
        callback: source.slice(...node.arguments.at(-1).range),
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
function load(source, spec, patched, callerSource) {
  const names = [
    ...(spec.shared
      ? ["createProviderPlugin2"]
      : [spec.variable, ...spec.helpers]),
    ...(patched ? privateNames : []),
  ];
  const code = `${defineSource}\n${selected(source, names)}`;
  const deps = references(code);
  const baselineDeps = spec.shared
    ? ["Effect"]
    : spec.variable === "AmazonBedrockPlugin2"
      ? ["Effect", "ID12", "process"]
      : spec.variable === "GoogleVertexPlugin2"
        ? ["Effect", "ID12", "String", "process"]
        : ["Effect", "isAISDK2", "packageName2"];
  assert.deepEqual(
    deps,
    [
      ...baselineDeps,
      ...(patched ? ["Object", "WeakMap", "undefined"] : []),
    ].sort(),
  );
  const allowed = new Set([
    "Effect",
    "ID12",
    "process",
    "String",
    "isAISDK2",
    "packageName2",
    "Object",
    "WeakMap",
    "undefined",
  ]);
  assert.ok(
    deps.every((name) => allowed.has(name)),
    "closed dependency set",
  );
  const injected = deps.filter(
    (name) => !["Object", "WeakMap", "undefined"].includes(name),
  );
  const caller = spec.shared ? selected(callerSource, [spec.variable]) : "";
  // The original load closure is compiled verbatim, but is never called.
  return new Function(
    ...injected,
    `${code}\n${caller}\nreturn {plugin: ${spec.variable}, ${spec.shared ? "create: createProviderPlugin2," : ""} ${patched ? "accepts: isFixedHookDeclaration2, lookup: getFixedHookPublication2," : ""}};`,
  )(
    ...injected.map((name) =>
      name === "Effect" ? Effect : name === "String" ? String : trap(),
    ),
  );
}
function fixture(spec, failIndex = -1) {
  const log = [],
    rows = [],
    ctx = {};
  const register = (domain, args) => {
    const index = rows.length;
    log.push(`construct:${index}`);
    rows.push({ domain, args });
    return Effect.acquireRelease(
      Effect.sync(() => {
        log.push(`register:${index}`);
        if (index === failIndex) throw Error("scripted registration failure");
      }),
      () => Effect.sync(() => log.push(`release:${index}`)),
    );
  };
  for (const domain of new Set(spec.domains)) {
    ctx[domain] =
      domain === "aisdk"
        ? { hook: (...args) => register(domain, args) }
        : { transform: (...args) => register(domain, args) };
  }
  return { ctx, log, rows };
}
function callbackExpressions(source) {
  const body = ast(source).body.find(
    (node) =>
      node.type === "FunctionDeclaration" &&
      node.id.name === "fixedHookDeclaration2",
  );
  return body.body.body
    .filter((node) => node.type === "VariableDeclaration")
    .map((node) => source.slice(...node.declarations[0].init.range));
}
const transformedPaths = [factory, ...individuals].map((spec) => spec.path);
test("four SDK additions preserve original fifty entries within the 512 edit ceiling", async () => {
  const backup = new URL(
    "../../../docs/runs/permission-task-lifetime-integration/prechange/provider-sdk-source-before-r1/",
    import.meta.url,
  );
  const saved = await readFile(
    new URL(
      "apps/desktop-app/src/native-permission-overlay-contract.mjs",
      backup,
    ),
    "utf8",
  );
  const manifest = JSON.parse(
    await readFile(new URL("manifest.json", backup), "utf8"),
  );
  assert.equal(
    hash(saved),
    manifest.files.find((row) =>
      row.path.endsWith("/native-permission-overlay-contract.mjs"),
    ).sha256,
  );
  const literal = saved.slice(
    saved.indexOf("const recipe = ") + "const recipe = ".length,
    saved.indexOf(";\nfor (const file"),
  );
  const original = new Function(`return (${literal});`)();
  assertOnlyCreateGateChanged(recipe.files.slice(0, 50), original.files);
  assert.deepEqual(
    recipe.files.slice(50, 54).map((row) => row.path),
    transformedPaths,
  );
  assert.ok(recipe.files.reduce((n, row) => n + row.edits.length, 0) <= 512);
});
for (const spec of specs) {
  test(`${spec.id}: pinned inert source, exact callbacks, lazy publication and owner isolation`, async () => {
    const { before, after, entry } = await sources(
      spec.shared ? factory : spec,
    );
    assert.ok(entry);
    assert.equal(hash(after), entry.afterSha256);
    let restored = after;
    for (const edit of entry.edits.toReversed())
      restored = restored.replace(edit.replace, () => edit.find);
    assert.equal(restored, before);
    const caller = spec.shared ? await sources(spec) : undefined;
    if (caller) {
      assert.equal(caller.entry, undefined, "caller module bytes unchanged");
      assert.equal(caller.after, caller.before);
    }
    const original = originalRegistrations(before);
    assert.deepEqual(
      original.map((row) => row.domain),
      spec.domains,
    );
    assert.deepEqual(
      original.map((row) => row.name),
      spec.names,
    );
    assert.deepEqual(
      callbackExpressions(after),
      original.map((row) => row.callback),
      "full Effect.fn/async/import expression bytes preserved",
    );
    original.forEach((row, index) =>
      assert.deepEqual(
        references(`(${row.callback});`),
        references(`(${callbackExpressions(after)[index]});`),
      ),
    );
    if (!spec.shared)
      assert.equal(
        selected(after, spec.helpers),
        selected(before, spec.helpers),
      );
    const current = load(after, spec, true, caller?.before);
    const foreign = load(after, spec, true, caller?.before);
    const baseline = load(before, spec, false, caller?.before);
    const owner = spec.shared ? current.plugin : spec.id;
    assert.equal(current.plugin.id, spec.id);
    assert.ok(Object.isFrozen(current.plugin));
    const f = fixture(spec);
    const pending = current.plugin.effect(f.ctx);
    assert.deepEqual(f.log, [], "no registration before generator starts");
    const declaration = await Effect.runPromise(Effect.scoped(pending));
    assert.equal(current.accepts(declaration, owner), true);
    assert.equal(
      foreign.accepts(declaration, spec.shared ? foreign.plugin : spec.id),
      false,
    );
    assert.deepEqual(Reflect.ownKeys(declaration), ["hooks"]);
    assert.ok(
      Object.isFrozen(declaration) && Object.isFrozen(declaration.hooks),
    );
    assert.equal(declaration.hooks.length, spec.domains.length);
    const old = fixture(spec);
    const oldPending = baseline.plugin.effect(old.ctx);
    assert.deepEqual(old.log, []);
    assert.equal(await Effect.runPromise(Effect.scoped(oldPending)), undefined);
    assert.deepEqual(f.log, old.log, "original registration/release order");
    declaration.hooks.forEach((row, index) => {
      assert.deepEqual(Reflect.ownKeys(row), [
        "domain",
        "name",
        "callback",
        "options",
      ]);
      assert.ok(Object.isFrozen(row));
      assert.deepEqual(
        [row.domain, row.name, row.options],
        [spec.domains[index], spec.names[index], undefined],
      );
      const args = f.rows[index].args;
      assert.equal(args.length, row.domain === "aisdk" ? 2 : 1);
      if (row.domain === "aisdk") assert.equal(args[0], row.name);
      assert.equal(args.at(-1), row.callback);
      assert.equal(
        old.rows[index].args.at(-1).toString(),
        row.callback.toString(),
        "original function and Effect.fn wrapper behavior",
      );
      assert.equal(current.lookup(row.callback, owner), declaration);
      assert.equal(current.lookup(row.callback.bind(null), owner), undefined);
      assert.equal(
        foreign.lookup(row.callback, spec.shared ? foreign.plugin : spec.id),
        undefined,
      );
      for (const wrong of [
        undefined,
        null,
        {},
        "foreign",
        ...(spec.shared
          ? [spec.id, { ...current.plugin }, foreign.plugin]
          : []),
      ]) {
        assert.equal(current.accepts(declaration, wrong), false);
        assert.equal(current.lookup(row.callback, wrong), undefined);
      }
    });
    for (const forged of [
      undefined,
      null,
      1,
      {},
      trap(),
      { ...declaration },
      { hooks: declaration.hooks },
      { hooks: [] },
      { hooks: declaration.hooks.toReversed() },
      { hooks: [...declaration.hooks, declaration.hooks[0]] },
      { hooks: declaration.hooks.map((row) => ({ ...row, options: {} })) },
    ]) {
      assert.equal(current.accepts(forged, owner), false);
      assert.equal(current.lookup(forged, owner), undefined);
    }
    assert.throws(() => {
      declaration.hooks[0].options = {};
    }, TypeError);
    const nextFixture = fixture(spec);
    const next = await Effect.runPromise(
      Effect.scoped(current.plugin.effect(nextFixture.ctx)),
    );
    assert.notEqual(next, declaration);
    assert.notEqual(next.hooks[0].callback, declaration.hooks[0].callback);
    assert.equal(
      current.lookup(declaration.hooks[0].callback, owner),
      declaration,
    );
    if (spec.shared) {
      // Same exported factory, same ID, different exact object: never the original owner.
      const forgedPlugin = current.create({
        id: spec.id,
        package: "foreign",
        load: trap(),
      });
      assert.ok(Object.isFrozen(forgedPlugin));
      const forgedFixture = fixture(spec);
      const forgedPending = forgedPlugin.effect(forgedFixture.ctx);
      assert.deepEqual(forgedFixture.log, []);
      const forgedDeclaration = await Effect.runPromise(
        Effect.scoped(forgedPending),
      );
      assert.equal(current.accepts(forgedDeclaration, forgedPlugin), true);
      assert.equal(current.accepts(forgedDeclaration, current.plugin), false);
      assert.equal(
        current.lookup(forgedDeclaration.hooks[0].callback, current.plugin),
        undefined,
      );
      assert.equal(current.accepts(declaration, forgedPlugin), false);
      assert.equal(
        current.lookup(declaration.hooks[0].callback, forgedPlugin),
        undefined,
      );
    }
    for (let index = 0; index < spec.domains.length; index++) {
      const failed = fixture(spec, index),
        oldFailed = fixture(spec, index);
      await assert.rejects(
        Effect.runPromise(Effect.scoped(current.plugin.effect(failed.ctx))),
        /scripted registration failure/,
      );
      await assert.rejects(
        Effect.runPromise(Effect.scoped(baseline.plugin.effect(oldFailed.ctx))),
        /scripted registration failure/,
      );
      assert.deepEqual(
        failed.log,
        oldFailed.log,
        "original partial registration failure/cleanup timing",
      );
    }
  });
}
