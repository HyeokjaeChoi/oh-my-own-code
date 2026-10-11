import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// No Native/core import, overlay, report, plan or ledger dependency. Only the
// receipt-pinned original expressions below are evaluated, with a closed input
// vocabulary. Scripted Bus/Integration/Location are NOT upstream Layer evidence.
const root = new URL(
  "../runtime-event-host/.generated/install/",
  import.meta.url,
);
const receipt = JSON.parse(await readFile(new URL("../receipt.json", root)));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const chunks = "node_modules/@opencode/core/dist/chunks/";
const pins = {
  "config-zrq68ahz.js":
    "475eaad9396f996a69155ece0828e12135646cad1905c41e2f123a9fa2a34757",
  "config-2e655exz.js":
    "dec09d0bf8fa0b6716b82502604014af9db5734d2ac3ef3315c6bfb89767824e",
  "config-rdw6cm16.js":
    "8627e8ffcac2bfc7225c3d4731b0d180c86dc1cf9b445e7f2f74fb436328288c",
};
async function pinned(path, expected) {
  const rows = receipt.installEntries.filter((row) => row.path === path);
  assert.equal(rows.length, 1, `unique receipt identity: ${path}`);
  if (expected) assert.equal(rows[0].sha256, expected, path);
  const bytes = await readFile(new URL(path, root));
  assert.equal(sha(bytes), rows[0].sha256, path);
  return bytes.toString("utf8");
}
const originals = Object.fromEntries(
  await Promise.all(
    Object.entries(pins).map(async ([name, hash]) => [
      name,
      await pinned(chunks + name, hash),
    ]),
  ),
);
const effectPackage = JSON.parse(
  await pinned("node_modules/effect/package.json"),
);
assert.equal(effectPackage.version, "4.0.0-rc.112");
// Verify the installed Effect JS closure before its first import, not just its
// barrel. No original application dependency module is imported.
const effectRows = receipt.installEntries.filter(
  (row) =>
    row.path.startsWith("node_modules/effect/") && row.path.endsWith(".js"),
);
assert.ok(
  effectRows.some((row) => row.path === "node_modules/effect/dist/index.js"),
);
await Promise.all(effectRows.map((row) => pinned(row.path)));
const { Context, Deferred, Effect, Exit, Fiber, Layer, Queue, Scope, Stream } =
  await import(
    "../runtime-event-host/.generated/install/node_modules/effect/dist/index.js"
  );

function select(name, identity, kind = "variable") {
  const source = ts.createSourceFile(
    name,
    originals[name],
    ts.ScriptTarget.Latest,
    true,
  );
  assert.equal(source.parseDiagnostics.length, 0);
  const matches = [];
  function visit(node) {
    if (
      (kind === "variable" && ts.isVariableDeclaration(node)) ||
      (kind === "function" && ts.isFunctionDeclaration(node)) ||
      (kind === "class" && ts.isClassDeclaration(node))
    ) {
      if (node.name?.getText(source) === identity) matches.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(matches.length, 1, `${name}: unique ${identity}`);
  const node = matches[0];
  const selected = kind === "variable" ? node.initializer : node;
  assert.ok(selected);
  return {
    text: selected.getText(source),
    line:
      source.getLineAndCharacterOfPosition(selected.getStart(source)).line + 1,
    end: source.getLineAndCharacterOfPosition(selected.end).line + 1,
    identity,
    name,
  };
}

// TypeScript resolves local symbols, including nested closures. Unknown free
// names fail BEFORE evaluation; no fallback Proxy/Effect.void dependency exists.
const builtins = {
  Map,
  Set,
  WeakMap,
  WeakSet,
  Array,
  Object,
  structuredClone: globalThis.structuredClone,
  undefined,
};
function compile(text, inputs) {
  const code = `function extracted(${Object.keys(inputs).join(",")}) { ${text} }`;
  const file = ts.createSourceFile(
    "extracted.ts",
    code,
    ts.ScriptTarget.Latest,
    true,
  );
  const host = {
    getSourceFile: (name) => (name === file.fileName ? file : undefined),
    getDefaultLibFileName: () => "unused.d.ts",
    writeFile: () => assert.fail("no compiler writes"),
    getCurrentDirectory: () => "",
    getDirectories: () => [],
    fileExists: (name) => name === file.fileName,
    readFile: () => undefined,
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
  };
  const checker = ts
    .createProgram([file.fileName], { noLib: true }, host)
    .getTypeChecker();
  const unknown = new Set();
  function visit(node) {
    if (
      ts.isImportDeclaration(node) ||
      node.kind === ts.SyntaxKind.ImportKeyword
    )
      assert.fail("extracted application imports refused");
    if (ts.isIdentifier(node) && !checker.getSymbolAtLocation(node)) {
      const parent = node.parent;
      const property =
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent)) &&
          parent.name === node);
      if (!property && !Object.hasOwn(builtins, node.text))
        unknown.add(node.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.deepEqual(
    [...unknown].sort(),
    [],
    "unknown original dependency refused",
  );
  const environment = { ...builtins, ...inputs };
  return new Function(...Object.keys(environment), `"use strict"; ${text}`)(
    ...Object.values(environment),
  );
}

const stateName = "config-rdw6cm16.js";
const stateSelections = [
  select(stateName, "CurrentGroup"),
  select(stateName, "CurrentBatch"),
  select(stateName, "disable", "function"),
  select(stateName, "run", "function"),
  select(stateName, "shutdown2", "function"),
  select(stateName, "create3", "function"),
];
const stateText = stateSelections
  .map((row) =>
    row.identity.startsWith("Current")
      ? `const ${row.identity} = ${row.text};`
      : row.text,
  )
  .join("\n");
const actualState = compile(`${stateText}\nreturn { create3, shutdown2 };`, {
  Context,
  Effect,
  Exit,
  Scope,
});
const specs = [
  { name: "Provider", file: "config-zrq68ahz.js", service: "Service71" },
  { name: "Model", file: "config-2e655exz.js", service: "Service68" },
].map((spec) => ({
  ...spec,
  layer: select(spec.file, "layer"),
  serviceClass: select(spec.file, spec.service, "class"),
}));

function fixture(spec, options = {}) {
  const calls = [];
  const forbidden =
    (name) =>
    (..._args) => {
      calls.push(`FORBIDDEN:${name}`);
      throw Error(`external_or_unscripted:${name}`);
    };
  // Scripted schema identities only; no schema/SDK/provider module evaluation.
  const event = (name) =>
    Object.freeze({ Updated: `${name}.Updated`, Switched: `${name}.Switched` });
  const Provider = { Event: event("Provider") };
  const Model = {
    Event: event("Model"),
    Info: { default: forbidden("Model.Info.default") },
  };
  const Service83 = Context.Service("script/Bus");
  const Service72 = Context.Service("script/Integration");
  const Service80 = Context.Service("script/Location");
  const Service71 = Context.Service("script/Provider");
  const published = Deferred.makeUnsafe();
  const entered = Deferred.makeUnsafe();
  const acquired = Deferred.makeUnsafe();
  let queue;
  let state;
  let subscriptionScope;
  const bus = {
    subscribe(input) {
      calls.push(["subscribe.construct", input]);
      if (options.denySubscribe) return forbidden("Bus.subscribe")();
      const acquire = (q) =>
        Effect.acquireRelease(
          Effect.gen(function* () {
            subscriptionScope = yield* Scope.Scope;
            queue = q;
            calls.push("subscribe.acquire");
            yield* Deferred.succeed(acquired, undefined);
          }),
          () => Effect.sync(() => calls.push("subscribe.release")),
        );
      // Two explicit stream schedules. callback forks its producer; unwrap
      // directly acquires the scripted resource. Neither imports original Bus.
      if (options.deferredProducer) return Stream.callback(acquire);
      return Stream.unwrap(
        Effect.gen(function* () {
          const q = yield* Queue.unbounded();
          yield* acquire(q);
          return Stream.fromQueue(q);
        }),
      );
    },
    publish(type, body, location) {
      calls.push(["publish.construct", type, body, location]);
      return Effect.gen(function* () {
        calls.push("publish.execute");
        yield* Deferred.succeed(published, undefined);
      });
    },
  };
  const scriptedRead = (name, value) => {
    calls.push(`${name}.construct`);
    return Effect.gen(function* () {
      calls.push(`${name}.execute`);
      yield* Deferred.succeed(entered, undefined);
      if (options.blockRead)
        return yield* Effect.never.pipe(
          Effect.onInterrupt(() =>
            Effect.sync(() => calls.push(`${name}.interrupt`)),
          ),
        );
      return value;
    });
  };
  const providers = options.providers ?? {
    snapshot: () =>
      options.denySnapshot
        ? forbidden("Provider.snapshot.factory")()
        : scriptedRead("snapshot", snapshot),
  };
  const snapshot = { records: new Map(), available: [], providers: [] };
  const integrations = {
    revision: () => {
      calls.push("integration.revision");
      return 0;
    },
    list: () => scriptedRead("integration.list", []),
  };
  const location = Object.freeze({
    directory: "/scripted/never-opened",
    workspaceID: "scripted",
  });
  const inputs = {
    Context,
    Effect,
    Layer,
    Stream,
    Service83,
    Service72,
    Service80,
    Service71,
    Provider,
    Model,
    Event17: event("Integration"),
    Event16: Provider.Event,
    Credential: { Event: event("Credential") },
    Info26: { empty: forbidden("Provider.Info.empty") },
    Info25: Model.Info,
    ID13: { make: forbidden("Integration.ID.make") },
    index: forbidden("Provider.index"),
    key2: forbidden("Connection.key"),
    rewrite2: forbidden("provider.transform.rewrite"),
    mergeOverlay2: forbidden("mergeOverlay"),
    mergeHeaders2: forbidden("mergeHeaders"),
    modelSettings2: forbidden("modelSettings"),
    // Explicit inert standin, limited to empty synthetic snapshots. This is not
    // proof of Immer or nonempty provider/model merge behavior.
    freeze(value, deep) {
      assert.equal(deep, true);
      assert.ok(value?.providers?.length === 0 || value?.all?.length === 0);
      calls.push("freeze.scripted");
      return value;
    },
    create3(input) {
      calls.push(`state.create:${input.name}`);
      state = actualState.create3(input);
      return {
        ...state,
        reload() {
          calls.push("state.reload.construct");
          return state.reload();
        },
      };
    },
    shutdown2(effect) {
      calls.push("shutdown.construct");
      return actualState
        .shutdown2(effect)
        .pipe(
          Effect.tap(() => Effect.sync(() => calls.push("shutdown.complete"))),
        );
    },
  };
  // Do not replace any constructor/state expression, including fork options.
  const { service, layer } = compile(
    `${spec.serviceClass.text}\nconst layer = ${spec.layer.text};\nreturn { service: ${spec.service}, layer };`,
    Object.fromEntries(
      Object.entries(inputs).filter(([name]) => name !== spec.service),
    ),
  );
  let context = Context.empty();
  for (const [tag, value] of [
    [Service83, bus],
    [Service72, integrations],
    [Service80, location],
    [Service71, providers],
  ])
    context = Context.add(context, tag, value);
  return {
    calls,
    service,
    acquired,
    entered,
    published,
    get state() {
      return state;
    },
    get subscriptionScope() {
      return subscriptionScope;
    },
    build: (scope) =>
      Layer.buildWithScope(layer, scope).pipe(Effect.provide(context)),
    emit: () => {
      assert.ok(queue, "subscription acquired");
      return Queue.offer(queue, {});
    },
  };
}
const count = (f, name) => f.calls.filter((call) => call === name).length;
const run = (effect) => Effect.runPromise(effect);
const scopeFor = () => run(Scope.make());
const close = (scope) => run(Scope.close(scope, Exit.void));
function noExternal(f) {
  assert.deepEqual(
    f.calls.filter(
      (call) => typeof call === "string" && call.startsWith("FORBIDDEN:"),
    ),
    [],
  );
}

test("extraction fails closed on unknown names and imports before evaluation", () => {
  assert.throws(
    () => compile("return unseenExternal();", {}),
    /unknown original dependency/,
  );
  assert.throws(
    () => compile('return import("@opencode/core");', {}),
    /imports refused/,
  );
});

for (const spec of specs) {
  test(
    `${spec.name}: startImmediately does not override an asynchronous subscriber producer`,
    { timeout: 5000 },
    async () => {
      const f = fixture(spec, { deferredProducer: true });
      const scope = await scopeFor();
      try {
        await run(f.build(scope));
        assert.equal(
          f.calls.filter(
            (call) => Array.isArray(call) && call[0] === "subscribe.construct",
          ).length,
          1,
        );
        assert.equal(
          count(f, "subscribe.acquire"),
          0,
          "scripted Stream.callback producer is still scheduled",
        );
        await run(Deferred.await(f.acquired));
        assert.equal(
          count(f, "subscribe.acquire"),
          1,
          "acquires without calling service methods",
        );
        assert.equal(count(f, "publish.execute"), 0);
      } finally {
        await close(scope);
      }
      assert.equal(count(f, "subscribe.release"), 1);
      assert.equal(count(f, "shutdown.complete"), 1);
      noExternal(f);
    },
  );

  test(
    `${spec.name}: original Layer acquires subscriber eagerly; state and notification are separate`,
    { timeout: 5000 },
    async () => {
      const f = fixture(spec);
      assert.deepEqual(
        f.calls,
        [],
        "constructing Layer does not run its generator",
      );
      const scope = await scopeFor();
      try {
        const context = await run(f.build(scope));
        assert.equal(
          count(f, "subscribe.acquire"),
          1,
          "startImmediately acquires before Layer build returns",
        );
        await run(Deferred.await(f.acquired));
        assert.ok(Context.get(context, f.service));
        assert.equal(count(f, "subscribe.acquire"), 1);
        assert.notEqual(f.subscriptionScope, scope, "real Stream child scope");
        assert.equal(count(f, `state.create:${spec.name.toLowerCase()}`), 1);
        assert.equal(
          count(f, "snapshot.construct"),
          spec.name === "Model" ? 1 : 0,
        );
        for (const name of [
          "snapshot.execute",
          "integration.list.construct",
          "integration.list.execute",
          "publish.execute",
          "state.reload.construct",
          "shutdown.construct",
        ])
          assert.equal(count(f, name), 0, name);
        assert.equal(f.state.revision(), 0);
        assert.equal(
          count(f, "subscribe.release"),
          0,
          "build completion retains scoped child",
        );
        const filter = f.calls.find(
          (call) => Array.isArray(call) && call[0] === "subscribe.construct",
        )[1];
        assert.deepEqual(
          filter,
          spec.name === "Provider"
            ? [
                "Integration.Updated",
                "Credential.Updated",
                "Credential.Switched",
              ]
            : "Provider.Updated",
        );
      } finally {
        await close(scope);
      }
      assert.equal(count(f, "subscribe.release"), 1);
      assert.equal(count(f, "state.reload.construct"), 1);
      assert.equal(count(f, "shutdown.complete"), 1);
      assert.equal(
        f.state.revision(),
        1,
        "actual shutdown invalidates and closes state",
      );
      await run(f.state.reload());
      assert.equal(
        f.state.revision(),
        1,
        "closed state refuses subsequent notification",
      );
      await close(scope);
      assert.equal(count(f, "subscribe.release"), 1, "idempotent owner close");
      assert.equal(count(f, "shutdown.complete"), 1);
      assert.equal(count(f, "publish.execute"), 0, "shutdown does not publish");
      noExternal(f);
    },
  );

  test(
    `${spec.name}: event invokes original notify/read only after subscription`,
    { timeout: 5000 },
    async () => {
      const f = fixture(spec);
      const scope = await scopeFor();
      try {
        await run(f.build(scope));
        await run(Deferred.await(f.acquired));
        await run(f.emit());
        await run(Deferred.await(f.published));
        assert.equal(count(f, "publish.execute"), 1);
        if (spec.name === "Provider") {
          assert.equal(count(f, "integration.list.execute"), 1);
          assert.equal(count(f, "integration.revision"), 2);
        } else {
          assert.equal(
            count(f, "snapshot.construct"),
            3,
            "one prepare plus two original read calls",
          );
          assert.equal(count(f, "snapshot.execute"), 2);
          assert.equal(f.state.revision(), 1);
        }
        assert.deepEqual(
          f.calls.find(
            (call) => Array.isArray(call) && call[0] === "publish.construct",
          ),
          [
            "publish.construct",
            `${spec.name}.Updated`,
            {},
            {
              location: {
                directory: "/scripted/never-opened",
                workspaceID: "scripted",
              },
            },
          ],
        );
      } finally {
        await close(scope);
      }
      assert.equal(count(f, "subscribe.release"), 1);
      assert.equal(count(f, "shutdown.complete"), 1);
      noExternal(f);
    },
  );

  test(
    `${spec.name}: owner close cancels a blocked notification and awaits subscriber release`,
    { timeout: 5000 },
    async () => {
      const f = fixture(spec, { blockRead: true });
      const scope = await scopeFor();
      try {
        await run(f.build(scope));
        await run(Deferred.await(f.acquired));
        await run(f.emit());
        await run(Deferred.await(f.entered));
      } finally {
        await close(scope);
      }
      assert.equal(
        count(
          f,
          spec.name === "Provider"
            ? "integration.list.interrupt"
            : "snapshot.interrupt",
        ),
        1,
      );
      assert.equal(count(f, "subscribe.release"), 1);
      assert.equal(count(f, "shutdown.complete"), 1);
      assert.equal(count(f, "publish.execute"), 0);
      noExternal(f);
    },
  );

  test(
    `${spec.name}: cancellation of Layer user closes original scoped subscriber`,
    { timeout: 5000 },
    async () => {
      const f = fixture(spec);
      const fiber = Effect.runFork(
        Effect.scoped(
          Effect.gen(function* () {
            const scope = yield* Scope.Scope;
            yield* f.build(scope);
            yield* Effect.never;
          }),
        ),
      );
      try {
        await run(Deferred.await(f.acquired));
      } finally {
        await run(Fiber.interrupt(fiber));
      }
      assert.equal(count(f, "subscribe.release"), 1);
      assert.equal(count(f, "shutdown.complete"), 1);
      assert.equal(count(f, "publish.execute"), 0);
      noExternal(f);
    },
  );

  test(`${spec.name}: unscripted Bus construction refuses and existing state finalizer still owns cleanup`, async () => {
    const f = fixture(spec, { denySubscribe: true });
    const scope = await scopeFor();
    try {
      await assert.rejects(
        run(f.build(scope)),
        /external_or_unscripted:Bus.subscribe/,
      );
    } finally {
      await close(scope);
    }
    assert.equal(count(f, "subscribe.acquire"), 0);
    assert.equal(count(f, "shutdown.complete"), 1);
    assert.equal(count(f, "publish.execute"), 0);
    assert.deepEqual(
      f.calls.filter(
        (call) => typeof call === "string" && call.startsWith("FORBIDDEN:"),
      ),
      ["FORBIDDEN:Bus.subscribe"],
    );
  });
}

test("Model: eager Provider.snapshot factory can fail before subscription, despite deferred Effect body", async () => {
  const f = fixture(specs[1], { denySnapshot: true });
  const scope = await scopeFor();
  try {
    await assert.rejects(
      run(f.build(scope)),
      /external_or_unscripted:Provider.snapshot.factory/,
    );
  } finally {
    await close(scope);
  }
  assert.equal(count(f, "subscribe.acquire"), 0);
  assert.equal(count(f, "snapshot.execute"), 0);
  assert.equal(count(f, "shutdown.complete"), 1);
});

test(
  "Model consuming actual original Provider: construction/finalization do not execute Integration list",
  { timeout: 5000 },
  async () => {
    const provider = fixture(specs[0]);
    const providerScope = await scopeFor();
    const modelScope = await scopeFor();
    let model;
    try {
      const context = await run(provider.build(providerScope));
      model = fixture(specs[1], {
        providers: Context.get(context, provider.service),
      });
      await run(model.build(modelScope));
      await run(Deferred.await(provider.acquired));
      await run(Deferred.await(model.acquired));
      assert.equal(count(provider, "integration.list.construct"), 0);
      assert.equal(count(provider, "integration.list.execute"), 0);
      await close(modelScope);
      assert.equal(count(model, "subscribe.release"), 1);
      assert.equal(
        count(provider, "subscribe.release"),
        0,
        "separate owner remains live",
      );
    } finally {
      await close(modelScope);
      await close(providerScope);
    }
    assert.equal(count(provider, "integration.list.execute"), 0);
    assert.equal(count(provider, "shutdown.complete"), 1);
    noExternal(provider);
    noExternal(model);
  },
);

test("original identity/line evidence and receipt pins remain stable after tests", async (t) => {
  for (const [name, hash] of Object.entries(pins))
    await pinned(chunks + name, hash);
  for (const row of [
    ...specs.flatMap((spec) => [spec.serviceClass, spec.layer]),
    ...stateSelections,
  ])
    t.diagnostic(
      `${chunks}${row.name}:${row.line}-${row.end} ${row.identity} sha256=${pins[row.name]}`,
    );
  t.diagnostic(
    `Effect ${effectPackage.version}; verified ${effectRows.length} receipt-pinned JS files; no Native imports/runtime launch`,
  );
  t.diagnostic(
    "Limits: empty scripted Bus/Integration/Location and freeze; no actual upstream Database/Bus/config acquisition, provider transforms, SDK/network, nonempty merges or startup acceptance. Next seam: original Provider/Model subscribe->forkScoped acquisition and Model prepare snapshot factory; preserve original state shutdown ownership.",
  );
});
