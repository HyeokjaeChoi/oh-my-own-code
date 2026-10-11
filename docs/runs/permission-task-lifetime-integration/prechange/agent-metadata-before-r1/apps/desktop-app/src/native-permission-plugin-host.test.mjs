import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdtemp, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test, { after } from "node:test";
import { NATIVE_PERMISSION_OVERLAY_RECIPE as recipe } from "./native-permission-overlay-contract.mjs";
import { copyPermissionControlSources } from "../scripts/native-permission-test-fixture.mjs";
import {
  observeNativeTransformRegistration,
  BUILTIN_PLUGIN_ORDER,
} from "./native-permission-inventory.mjs";
import ts from "typescript";

// Read original bytes; compile only selected arrows. Never import Native/core.
const root = new URL(
  "../runtime-event-host/.generated/install/",
  import.meta.url,
);
const hostPath = "node_modules/@opencode/core/dist/chunks/config-76n1dez8.js";
const receipt = JSON.parse(
  await readFile(new URL("../receipt.json", root), "utf8"),
);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const original = await readFile(new URL(hostPath, root), "utf8");
const originalSha =
  "d287ae519253b75a2b350a53b4b5c5eef01b819afcf64e79c66566daccbe361b";
assert.equal(sha(original), originalSha);
assert.equal(
  receipt.installEntries.find((row) => row.path === hostPath)?.sha256,
  originalSha,
);
const effectPath = "node_modules/effect/dist/index.js";
assert.equal(
  sha(await readFile(new URL(effectPath, root))),
  receipt.installEntries.find((row) => row.path === effectPath)?.sha256,
);
const { Effect, Scope, Exit, Cause } = await import(
  "../runtime-event-host/.generated/install/node_modules/effect/dist/index.js"
);
const domains = {
  agent: "agents",
  provider: "providers",
  model: "models",
  integration: "integration",
  mcp: "mcp",
};
function arrows(source, patched = false) {
  const ast = ts.createSourceFile(
    hostPath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  assert.equal(ast.parseDiagnostics.length, 0);
  const found = new Map();
  function visit(node) {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(ast) === "transform" &&
      ts.isArrowFunction(node.initializer)
    ) {
      const domain = node.parent.parent;
      if (
        ts.isPropertyAssignment(domain) &&
        Object.hasOwn(domains, domain.name.getText(ast))
      ) {
        const name = domain.name.getText(ast);
        assert.equal(found.has(name), false);
        const expression = node.initializer.getText(ast);
        if (!patched)
          assert.match(
            expression,
            new RegExp(`^\\(callback\\) => ${domains[name]}\\.transform\\(`),
          );
        assert.doesNotMatch(expression, /hooks\.register|import\s*\(/u);
        found.set(name, expression);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.deepEqual([...found.keys()], Object.keys(domains));
  return found;
}
const extracted = arrows(original);
// Capture this invocation's source, rather than pinning a historical report
// forever. The harness/review binding owns revision provenance; this check owns
// source stability during the test and copied original closure verification.
const repository = new URL("../../../", import.meta.url);
const liveSourceRows = await Promise.all(
  [
    "apps/desktop-app/src/native-permission-control.mjs",
    "apps/desktop-app/src/native-permission-inventory.mjs",
    "apps/desktop-app/src/native-permission-overlay-contract.mjs",
    "apps/desktop-app/scripts/native-permission-overlay-recipe.test.mjs",
  ].map(async (path) => {
    const bytes = await readFile(new URL(path, repository));
    return { path, bytes: bytes.length, sha256: sha(bytes) };
  }),
);
async function verifyLiveSources() {
  for (const row of liveSourceRows) {
    const bytes = await readFile(new URL(row.path, repository));
    assert.equal(bytes.length, row.bytes, row.path);
    assert.equal(sha(bytes), row.sha256, row.path);
  }
}
function applyRecipe(path, before) {
  const entry = recipe.files.find((row) => row.path === path);
  assert.ok(entry, path);
  assert.equal(sha(before), entry.beforeSha256);
  let result = before;
  for (const edit of entry.edits) {
    assert.equal(result.split(edit.find).length - 1, 1);
    result = result.replace(edit.find, () => edit.replace);
  }
  assert.equal(sha(result), entry.afterSha256);
  return result;
}
const patchedHost = applyRecipe(hostPath, original);
const patchedArrows = arrows(patchedHost, true);

function makeRoute(domain, state, overrides = {}, expressions = extracted) {
  const deps = {
    [domains[domain]]: state,
    mutable: (value) => value,
    ID10: { make: (value) => `agent:${value}` },
    ID11: { make: (value) => `model:${value}` },
    ID12: { make: (value) => `provider:${value}` },
    ID13: { make: (value) => `integration:${value}` },
    ID14: { make: (value) => `credential:${value}` },
    Schema: { decodeUnknownSync: (schema) => (value) => ({ schema, value }) },
    ServerConfig: "ServerConfig",
    Method2: "Method2",
    methodImplementation: (value) => ({ implementation: value }),
    ...overrides,
  };
  return new Function(
    ...Object.keys(deps),
    `"use strict"; return (${expressions.get(domain)});`,
  )(...Object.values(deps));
}
function stateCanary(
  editor = { default: { get() {} }, provider: { list() {} } },
) {
  const counts = { construct: 0, state: 0, callback: 0, control: 0 };
  let replay;
  const state = {
    transform(callback) {
      counts.construct++;
      return Effect.sync(() => {
        counts.state++;
        replay = callback;
        callback(editor);
        return { dispose: Effect.void };
      });
    },
  };
  return { counts, state, replay: () => replay(editor) };
}
// Import only the pure copied Control closure, resolving its pinned Effect/util.
const namespace = await mkdtemp(join(tmpdir(), "omoc-plugin-host-test-"));
after(() => rm(namespace, { recursive: true, force: true }));
await symlink(
  fileURLToPath(new URL("node_modules", root)),
  join(namespace, "node_modules"),
);
const copied = await copyPermissionControlSources(namespace);
const Control = await import(
  pathToFileURL(join(namespace, "native-permission-control.mjs"))
);
const privateNames = [
  "fixedHookDeclarations2",
  "fixedHookPublications2",
  "isFixedHookDeclaration2",
  "getFixedHookPublication2",
  "fixedHookBundle2",
  "fixedHookDeclaration2",
];
function selectedDeclarations(source, names) {
  const ast = ts.createSourceFile(
    "inert.js",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  assert.equal(ast.parseDiagnostics.length, 0);
  const rows = ast.statements.filter((node) =>
    ts.isFunctionDeclaration(node)
      ? names.includes(node.name?.text)
      : ts.isVariableStatement(node) &&
        node.declarationList.declarations.every((row) =>
          names.includes(row.name.getText(ast)),
        ),
  );
  assert.equal(rows.length, names.length);
  return rows
    .map((row) => row.getText(ast).replace(/^export /u, ""))
    .join("\n");
}
const definePath = "node_modules/@opencode/plugin/dist/effect/plugin.js";
const defineBytes = await readFile(new URL(definePath, root), "utf8");
assert.equal(
  sha(defineBytes),
  receipt.installEntries.find((row) => row.path === definePath)?.sha256,
);
const defineSource = selectedDeclarations(defineBytes, ["define"]);
const trap = new Proxy(function () {}, {
  get() {
    throw Error("inert callback dependency touched");
  },
  apply() {
    throw Error("inert callback dependency executed");
  },
});
const producerSpecs = [
  {
    chunk: "az9r17tx",
    variable: "Plugin34",
    domain: "agent",
    helpers: ["PROMPT_EXPLORE", "PROMPT_TITLE", "PROMPT_SUMMARY"],
  },
  {
    chunk: "0xqyf95c",
    variable: "Plugin26",
    domain: "mcp",
    helpers: ["urls", "posthog", "mode"],
  },
  {
    chunk: "wc3fc9cn",
    variable: "CerebrasPlugin2",
    domain: "provider",
    helpers: [],
  },
];
async function producer(spec) {
  const path = `node_modules/@opencode/core/dist/chunks/config-${spec.chunk}.js`;
  const bytes = await readFile(new URL(path, root), "utf8");
  assert.equal(
    sha(bytes),
    receipt.installEntries.find((row) => row.path === path)?.sha256,
  );
  const patched = applyRecipe(path, bytes);
  const deps = {
    Effect,
    ID10: trap,
    Name3: trap,
    defaultID2: trap,
    merge2: trap,
    URL: trap,
  };
  const names = [spec.variable, ...spec.helpers, ...privateNames];
  const load = new Function(
    ...Object.keys(deps),
    `${defineSource}\n${selectedDeclarations(patched, names)}\nreturn {plugin:${spec.variable},make:fixedHookDeclaration2,accepts:isFixedHookDeclaration2,publication:getFixedHookPublication2};`,
  )(...Object.values(deps));
  const id = load.plugin.id;
  assert.equal(Object.isFrozen(load.plugin), true);
  return {
    ...load,
    accepts: (value) => load.accepts(value, id),
    publication: (callback) => load.publication(callback, id),
    original: bytes,
    path,
    sha256: sha(patched),
  };
}
async function runControl(spec, body) {
  const p = await producer(spec);
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const c = yield* Control.Service;
        const h = yield* c.locationBegin({
          directory: "/plugin-host-scripted",
        });
        yield* c.locationBind(h, {
          directory: "/plugin-host-scripted",
          project: { id: "project" },
        });
        yield* c.locationReady(h);
        yield* c.inventoryPlan(
          h,
          BUILTIN_PLUGIN_ORDER.pre.map((id) => ({ id })),
          BUILTIN_PLUGIN_ORDER.post.map((id) => ({ id })),
          [{}],
        );
        c.inventoryHookSource(p.plugin, p.accepts, p.publication, p.sha256);
        const descriptor = Object.freeze({
          id: p.plugin.id,
          effect: () => Effect.void,
        });
        yield* c.inventoryToolResolve(h, p.plugin, descriptor);
        const parent = yield* c.inventoryBegin(h, "plugin", p.plugin.id);
        const scope = yield* Scope.make();
        yield* c.inventoryToolActivation(parent, descriptor, scope);
        yield* Scope.addFinalizer(scope, c.inventoryEnd(parent, "disposed"));
        try {
          return yield* body({ c, h, p, parent, scope });
        } finally {
          yield* Scope.close(scope, Exit.void);
        }
      }).pipe(
        Effect.provide(
          Control.configured({ runtimeEpoch: "plugin-host", bootHolds: [] }),
        ),
      ),
    ),
  );
}

test("actual Host constructor retains the opaque LocationBuildScope handle", async () => {
  const start = patchedHost.indexOf("var make11 =");
  const end = patchedHost.indexOf("  const app = yield* Metadata2;", start);
  assert.ok(start >= 0 && end > start);
  const make = new Function(
    "Effect",
    "WorkbenchControl",
    "LocationBuildScope",
    `${patchedHost.slice(start, end)}return {control,inventoryHandle};});return make11;`,
  )(Effect, Control.Service, Control.LocationBuildScope);
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const control = yield* Control.Service;
        const handle = yield* control.locationBegin({
          directory: "/host-constructor",
        });
        const result = yield* make({}).pipe(
          Effect.provideService(Control.Service, control),
          Effect.provideService(Control.LocationBuildScope, handle),
        );
        assert.equal(result.control, control);
        assert.equal(result.inventoryHandle, handle);
      }).pipe(
        Effect.provide(
          Control.configured({
            runtimeEpoch: "host-constructor",
            bootHolds: [],
          }),
        ),
      ),
    ),
  );
});

for (const domain of Object.keys(domains)) {
  test(`original Host ${domain} arrow bypasses Control before State registration and replay`, async () => {
    const fixture = stateCanary();
    const callback = () => fixture.counts.callback++;
    const controlCanary = new Proxy(
      {},
      {
        get() {
          fixture.counts.control++;
          throw Error("original unexpectedly entered Control");
        },
      },
    );
    const route = makeRoute(domain, fixture.state, {
      control: controlCanary,
      hooks: controlCanary,
    });
    await Effect.runPromise(Effect.scoped(route(callback)));
    assert.deepEqual(fixture.counts, {
      construct: 1,
      state: 1,
      callback: 1,
      control: 0,
    });
    fixture.replay();
    assert.equal(fixture.counts.callback, 2);
    if (process.env.PLUGIN_HOST_ORIGINAL_RED === "1") {
      // Intentional EARLY RED: real original arrow violates the held boundary.
      assert.equal(
        fixture.counts.state,
        0,
        "held Host route must not enter underlying State",
      );
    }
  });
}

// A manually scripted permissive harness checks editor conversions only.
// It does not instantiate Control and does not represent an execution grant.
for (const [domain, patched] of Object.keys(domains).flatMap((domain) => [
  [domain, false],
  [domain, true],
])) {
  test(`${patched ? "patched" : "original"} Host ${domain} editor conversion under isolated scripted permissive fixture`, async () => {
    const log = [];
    const record =
      (name) =>
      (...args) => {
        log.push([name, ...args]);
        return args[0];
      };
    const editor = {
      list: () =>
        domain === "mcp"
          ? [["server", { command: "inert" }]]
          : [{ id: "original" }],
      get: record("get"),
      add: record("add"),
      update: record("update"),
      remove: record("remove"),
      default: Object.assign(record("default"), {
        get: record("default.get"),
        set: record("default.set"),
      }),
      models: {
        set: record("models.set"),
        update: record("models.update"),
        remove: record("models.remove"),
      },
      provider: { list: record("provider.list"), get: record("provider.get") },
      method: {
        list: record("method.list"),
        update: record("method.update"),
        remove: record("method.remove"),
      },
      set: record("set"),
    };
    const fixture = stateCanary(editor);
    let converted;
    await Effect.runPromise(
      Effect.scoped(
        makeRoute(
          domain,
          fixture.state,
          patched
            ? {
                Effect,
                Scope,
                control: scriptedControl({ failure: null, permissive: true })
                  .control,
                inventoryHandle: {},
                observeNativeTransformRegistration,
              }
            : {},
          patched ? patchedArrows : extracted,
        )((value) => {
          converted = value;
        }),
      ),
    );
    if (domain === "agent") {
      converted.get("a");
      converted.default();
      converted.default("a");
      converted.update("a", 1);
      converted.remove("a");
      assert.deepEqual(log, [
        ["get", "agent:a"],
        ["default", undefined],
        ["default", "agent:a"],
        ["update", "agent:a", 1],
        ["remove", "agent:a"],
      ]);
      assert.deepEqual(converted.list(), [{ id: "original" }]);
    } else if (domain === "provider") {
      assert.equal(converted.list, editor.list);
      converted.get("p");
      converted.add({ sourceConnection: { type: "credential", id: "c" } });
      converted.update("p", 1);
      converted.remove("p");
      converted.models.set("p", []);
      converted.models.update("p", "m", 2);
      converted.models.remove("p", "m");
      assert.deepEqual(log, [
        ["get", "provider:p"],
        [
          "add",
          { sourceConnection: { type: "credential", id: "credential:c" } },
        ],
        ["update", "provider:p", 1],
        ["remove", "provider:p"],
        ["models.set", "provider:p", []],
        ["models.update", "provider:p", "model:m", 2],
        ["models.remove", "provider:p", "model:m"],
      ]);
    } else if (domain === "model") {
      converted.list();
      converted.list("p");
      converted.get("p", "m");
      converted.update("p", "m", 1);
      converted.remove("p", "m");
      converted.default.set("p", "m");
      converted.provider.get("p");
      assert.equal(converted.default.get, editor.default.get);
      assert.equal(converted.provider.list, editor.provider.list);
      assert.deepEqual(log, [
        ["get", "provider:p", "model:m"],
        ["update", "provider:p", "model:m", 1],
        ["remove", "provider:p", "model:m"],
        ["default.set", "provider:p", "model:m"],
        ["provider.get", "provider:p"],
      ]);
    } else if (domain === "integration") {
      converted.get("i");
      converted.update("i", 1);
      converted.remove("i");
      converted.method.list("i");
      converted.method.update("input");
      converted.method.remove("i", "method");
      assert.deepEqual(log, [
        ["get", "integration:i"],
        ["update", "integration:i", 1],
        ["remove", "integration:i"],
        ["method.list", "integration:i"],
        ["method.update", { implementation: "input" }],
        [
          "method.remove",
          "integration:i",
          { schema: "Method2", value: "method" },
        ],
      ]);
      assert.deepEqual(converted.list(), [{ id: "original" }]);
    } else {
      assert.deepEqual(converted.list(), [["server", { command: "inert" }]]);
      converted.get("server");
      converted.set("server", { command: "inert" });
      assert.equal(converted.update, editor.update);
      assert.equal(converted.remove, editor.remove);
      assert.deepEqual(log, [
        ["get", "server"],
        [
          "set",
          "server",
          { schema: "ServerConfig", value: { command: "inert" } },
        ],
      ]);
    }
  });
}

test("original Host and pinned Effect entry retain source hashes after extraction", async () => {
  assert.equal(sha(await readFile(new URL(hostPath, root))), originalSha);
  assert.equal(
    sha(await readFile(new URL(effectPath, root))),
    receipt.installEntries.find((row) => row.path === effectPath)?.sha256,
  );
  assert.equal(typeof Scope.Scope, "function");
});

for (const domain of Object.keys(domains)) {
  test(`patched actual Host ${domain} preserves fixed editor adapter expression`, () => {
    const ast = ts.createSourceFile(
      "arrow.js",
      patchedArrows.get(domain),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    );
    const arrow = ast.statements[0].expression;
    assert.ok(ts.isArrowFunction(arrow));
    const call = arrow.body;
    assert.equal(
      call.expression.getText(ast),
      "observeNativeTransformRegistration",
    );
    assert.equal(call.arguments.length, 7);
    assert.deepEqual(
      call.arguments.slice(0, 6).map((node) => node.getText(ast)),
      [
        "Effect",
        "Scope",
        "control",
        "inventoryHandle",
        JSON.stringify(domain),
        "callback",
      ],
    );
    const publish = call.arguments[6];
    assert.ok(ts.isArrowFunction(publish));
    assert.equal(publish.parameters[0].name.getText(ast), "guarded");
    const originalBody = extracted
      .get(domain)
      .replace(/^\(callback\) => /u, "");
    assert.equal(
      publish.body.getText(ast).replace(/\bguarded\(/gu, "callback("),
      originalBody,
    );
  });
}
function scriptedControl({ failure = "guard", permissive = false } = {}) {
  const token = Object.freeze({}),
    log = [];
  let replayHeld = !permissive;
  const control = {
    inventoryBegin(handle, kind, identity) {
      log.push(["begin", handle, kind, identity]);
      return Effect.succeed(token);
    },
    inventoryTransformPublication(...args) {
      log.push(["publication", ...args]);
      return failure === "publication"
        ? Effect.fail(new Error("publication_failed"))
        : Effect.void;
    },
    inventoryGuard(value) {
      log.push(["guard", value]);
      return failure === "guard"
        ? Effect.fail(new Error("native_permission_inventory_unverified"))
        : Effect.void;
    },
    inventoryTransformReplay(value) {
      log.push(["replay", value]);
      if (replayHeld) throw new Error("native_permission_inventory_unverified");
    },
    inventoryRegistered(value) {
      log.push(["registered", value]);
      return Effect.void;
    },
    inventoryEnd(value, reason) {
      return Effect.sync(() => {
        log.push(["end", value, reason]);
      });
    },
  };
  return {
    token,
    log,
    control,
    holdReplay: () => {
      replayHeld = true;
    },
  };
}
for (const domain of Object.keys(domains)) {
  for (const failure of ["publication", "guard"]) {
    test(`patched actual Host ${domain}: ${failure} failure before State construction, same-token cleanup`, async () => {
      const fixture = stateCanary(),
        script = scriptedControl({ failure }),
        handle = Object.freeze({});
      const callback = () => fixture.counts.callback++;
      const scope = await Effect.runPromise(Scope.make());
      try {
        const route = makeRoute(
          domain,
          fixture.state,
          {
            Effect,
            Scope,
            control: script.control,
            inventoryHandle: handle,
            observeNativeTransformRegistration,
          },
          patchedArrows,
        );
        await assert.rejects(
          Effect.runPromise(
            route(callback).pipe(Effect.provideService(Scope.Scope, scope)),
          ),
          failure === "publication"
            ? /publication_failed/u
            : /inventory_unverified/u,
        );
        assert.deepEqual(fixture.counts, {
          construct: 0,
          state: 0,
          callback: 0,
          control: 0,
        });
        const publication = script.log.find(([name]) => name === "publication");
        assert.deepEqual(publication, [
          "publication",
          script.token,
          domain,
          "transform",
          callback,
          undefined,
          scope,
        ]);
        assert.deepEqual(script.log[0], [
          "begin",
          handle,
          "transform",
          JSON.stringify([domain, "transform"]),
        ]);
        assert.deepEqual(script.log.at(-1), ["end", script.token, "failed"]);
        assert.equal(
          script.log.some(([name]) => name === "registered"),
          false,
        );
        assert.equal(
          script.log.some(([name]) => name === "guard"),
          failure === "guard",
        );
      } finally {
        await Effect.runPromise(Scope.close(scope, Exit.void));
      }
    });
  }
  test(`patched actual Host ${domain}: scripted isolated permissive registration then held synchronous replay`, async () => {
    const fixture = stateCanary(),
      script = scriptedControl({ failure: null, permissive: true });
    const scope = await Effect.runPromise(Scope.make());
    const route = makeRoute(
      domain,
      fixture.state,
      {
        Effect,
        Scope,
        control: script.control,
        inventoryHandle: {},
        observeNativeTransformRegistration,
      },
      patchedArrows,
    );
    try {
      await Effect.runPromise(
        route(() => fixture.counts.callback++).pipe(
          Effect.provideService(Scope.Scope, scope),
        ),
      );
      assert.equal(fixture.counts.state, 1);
      assert.equal(fixture.counts.callback, 1);
      script.holdReplay();
      assert.throws(() => fixture.replay(), /inventory_unverified/u);
      assert.equal(fixture.counts.callback, 1);
      assert.deepEqual(
        script.log.slice(0, 5).map(([name]) => name),
        ["begin", "publication", "guard", "replay", "registered"],
      );
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }
    assert.deepEqual(script.log.at(-1), ["end", script.token, "disposed"]);
  });
}

for (const spec of producerSpecs) {
  for (const scenario of [
    "original-source",
    "foreign-callback",
    "same-shape",
    "origin-callback",
    "foreign-source",
    "foreign-scope",
    "closed-scope",
  ]) {
    test(`actual Control + inert ${spec.domain} producer: ${scenario} held before State`, async () => {
      await runControl(spec, ({ c, h, p, scope }) =>
        Effect.gen(function* () {
          const fixture = stateCanary(),
            events = [];
          const observed = { ...c };
          for (const method of [
            "inventoryBegin",
            "inventoryTransformPublication",
            "inventoryGuard",
            "inventoryEnd",
          ]) {
            observed[method] = (...args) =>
              c[method](...args).pipe(
                Effect.tap((result) =>
                  Effect.sync(() => events.push({ method, args, result })),
                ),
              );
          }
          const route = makeRoute(
            spec.domain,
            fixture.state,
            {
              Effect,
              Scope,
              control: observed,
              inventoryHandle: h,
              observeNativeTransformRegistration,
            },
            patchedArrows,
          );
          let actualCallback;
          const ctx = {
            [spec.domain]: {
              transform(callback) {
                actualCallback = callback;
                return route(callback);
              },
            },
          };
          let effect;
          if (scenario === "original-source") effect = p.plugin.effect(ctx);
          else {
            const declaration = p.make(ctx);
            const callback = declaration.hooks[0].callback;
            assert.equal(p.publication(callback), declaration);
            actualCallback = callback;
            if (scenario === "foreign-callback")
              actualCallback = () => fixture.counts.callback++;
            if (scenario === "foreign-source")
              actualCallback = (yield* Effect.promise(() =>
                producer(spec),
              )).make(ctx).hooks[0].callback;
            if (scenario === "same-shape")
              actualCallback = new Function(
                `return (${callback.toString()});`,
              )();
            if (scenario === "origin-callback") {
              const ast = ts.createSourceFile(
                "origin.js",
                p.original,
                ts.ScriptTarget.Latest,
                true,
                ts.ScriptKind.JS,
              );
              let expression;
              function visit(node) {
                if (
                  ts.isCallExpression(node) &&
                  ts.isPropertyAccessExpression(node.expression) &&
                  node.expression.name.text === "transform"
                )
                  expression = node.arguments[0].getText(ast);
                ts.forEachChild(node, visit);
              }
              visit(ast);
              assert.ok(expression);
              actualCallback = new Function(`return (${expression});`)();
            }
            if (
              [
                "foreign-callback",
                "same-shape",
                "origin-callback",
                "foreign-source",
              ].includes(scenario)
            )
              assert.equal(p.publication(actualCallback), undefined);
            if (scenario === "closed-scope")
              yield* Scope.close(scope, Exit.void);
            effect = route(actualCallback);
          }
          const callScope =
            scenario === "foreign-scope" ? yield* Scope.make() : scope;
          const exit = yield* Effect.exit(
            effect.pipe(Effect.provideService(Scope.Scope, callScope)),
          );
          if (callScope !== scope) yield* Scope.close(callScope, Exit.void);
          assert.equal(exit._tag, "Failure");
          assert.match(
            Cause.pretty(exit.cause),
            /native_permission_inventory_unverified/u,
          );
          assert.deepEqual(fixture.counts, {
            construct: 0,
            state: 0,
            callback: 0,
            control: 0,
          });
          const began = events.find(
            (event) => event.method === "inventoryBegin",
          );
          assert.ok(began);
          assert.equal(began.args[1], "transform");
          const ended = events.find((event) => event.method === "inventoryEnd");
          assert.deepEqual(ended?.args, [began.result, "failed"]);
          const publication = events.find(
            (event) => event.method === "inventoryTransformPublication",
          );
          assert.equal(Boolean(publication), scenario === "original-source");
          if (publication) {
            assert.equal(publication.args[3], actualCallback);
            assert.equal(publication.args[5], scope);
            assert.ok(p.publication(actualCallback));
          }
          assert.throws(
            () => c.inventoryTransformReplay(began.result),
            /inventory_unverified/u,
          );
        }),
      );
    });
  }
}
for (const domain of Object.keys(domains)) {
  for (const phase of ["construct", "effect"]) {
    test(`isolated scripted ${domain} publish ${phase} failure retires original token`, async () => {
      const script = scriptedControl({ failure: null });
      let constructed = 0;
      const state = {
        transform() {
          constructed++;
          if (phase === "construct") throw Error("scripted_publish_failure");
          return Effect.fail(new Error("scripted_publish_failure"));
        },
      };
      const route = makeRoute(
        domain,
        state,
        {
          Effect,
          Scope,
          control: script.control,
          inventoryHandle: {},
          observeNativeTransformRegistration,
        },
        patchedArrows,
      );
      await assert.rejects(
        Effect.runPromise(
          Effect.scoped(route(() => assert.fail("callback executed"))),
        ),
        /scripted_publish_failure/u,
      );
      assert.equal(constructed, 1);
      assert.deepEqual(script.log.at(-1), ["end", script.token, "failed"]);
      assert.equal(
        script.log.some(([name]) => name === "registered"),
        false,
      );
    });
  }
}
for (const [label, callback, domain] of [
  ["non-function", {}, "agent"],
  ["async", async () => {}, "agent"],
  ["generator", function* () {}, "agent"],
  [
    "proxy",
    new Proxy(() => {}, {
      apply() {
        assert.fail("proxy invoked");
      },
    }),
    "agent",
  ],
  ["unknown-domain", () => {}, "unknown"],
]) {
  test(`bridge rejects ${label} before token or fixed publisher`, async () => {
    const script = scriptedControl();
    const effect = observeNativeTransformRegistration(
      Effect,
      Scope,
      script.control,
      {},
      domain,
      callback,
      () => assert.fail("publisher invoked"),
    );
    await assert.rejects(
      Effect.runPromise(Effect.scoped(effect)),
      /inventory_unverified/u,
    );
    assert.deepEqual(script.log, []);
  });
}
test("current invocation, copied pure closure and original source bytes remain exact after tests", async () => {
  await verifyLiveSources();
  for (const row of copied) {
    assert.equal(
      sha(await readFile(new URL(row.path, import.meta.url))),
      row.sha256,
    );
  }
  assert.equal(sha(await readFile(new URL(hostPath, root))), originalSha);
  for (const spec of producerSpecs) {
    const path = `node_modules/@opencode/core/dist/chunks/config-${spec.chunk}.js`;
    assert.equal(
      sha(await readFile(new URL(path, root))),
      receipt.installEntries.find((row) => row.path === path)?.sha256,
    );
  }
});
