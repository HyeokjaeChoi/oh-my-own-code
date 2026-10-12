// These tests pin the retained strict proof machinery; production runs non-strict.
process.env.OMOC_PERMISSION_PROOF_STRICT = "1";
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
  observeNativeSdkRegistration,
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
// Capture this invocation's source, rather than pinning a historical report
// forever. The harness/review binding owns revision provenance; this check owns
// source stability during the test and copied original closure verification.
const repository = new URL("../../../", import.meta.url);
const liveSourceRows = await Promise.all(
  [
    "apps/desktop-app/src/native-permission-sdk-host.test.mjs",
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
// Import only the pure copied Control closure, resolving its pinned Effect/util.
const namespace = await mkdtemp(join(tmpdir(), "omoc-sdk-host-test-"));
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
const sdkPath = "node_modules/@opencode/core/dist/chunks/config-ppzgkaaq.js";
const sdkOriginal = await readFile(new URL(sdkPath, root), "utf8");
assert.equal(
  sha(sdkOriginal),
  receipt.installEntries.find((row) => row.path === sdkPath)?.sha256,
);
// Extract the unchanged private lists, register/run primitives and service routes.
// No AISDK layer or Native module is acquired. The list owner is original source,
// not scripted getters/setters. Only inspection accessors are test-owned.
assert.equal(
  sha(sdkOriginal),
  "070409f56769cf4bd845dc6adc94c51a51f4818947a6b821809b21e367c5acc5",
);
const sdkTree = ts.createSourceFile(
  sdkPath,
  sdkOriginal,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.JS,
);
assert.equal(sdkTree.parseDiagnostics.length, 0);
const sdkDeclarations = new Map();
let sdkService;
function scanSdk(node) {
  if (ts.isVariableDeclaration(node)) {
    const name = node.name.getText(sdkTree);
    if (["sdkHooks", "languageHooks", "register", "run"].includes(name)) {
      assert.equal(sdkDeclarations.has(name), false, name);
      sdkDeclarations.set(name, node.parent.parent.getText(sdkTree));
    }
    if (
      name === "service" &&
      node.initializer?.getText(sdkTree).startsWith("Service70.of(")
    ) {
      assert.equal(sdkService, undefined);
      sdkService = node.initializer.arguments[0];
    }
  }
  ts.forEachChild(node, scanSdk);
}
scanSdk(sdkTree);
assert.equal(sdkDeclarations.size, 4);
const sdkRoutes = ["hook", "runSDK", "runLanguage"].map((name) => {
  const rows = sdkService.properties.filter(
    (node) => node.name?.getText(sdkTree) === name,
  );
  assert.equal(rows.length, 1, name);
  return rows[0].getText(sdkTree);
});
function originalSdkLists() {
  return new Function(
    "Effect",
    "Scope",
    `
    "use strict";
    ${[...sdkDeclarations.values()].join("\n")}
    return {
      aisdk: {${sdkRoutes.join(",\n")}},
      rows: (name) => (name === "sdk" ? sdkHooks : languageHooks).slice(),
    };
  `,
  )(Effect, Scope);
}
const producerSpecs = [
  { chunk: "pezzyds3", variable: "VercelPlugin2", name: "sdk", helpers: [] },
  {
    chunk: "8pbmndb6",
    variable: "GoogleVertexPlugin2",
    name: "language",
    helpers: [
      "resolveProject",
      "resolveLocation",
      "vertexEndpoint",
      "replaceVertexVars",
    ],
  },
];
async function producer(spec) {
  const path = `node_modules/@opencode/core/dist/chunks/config-${spec.chunk}.js`;
  const original = await readFile(new URL(path, root), "utf8");
  assert.equal(
    sha(original),
    receipt.installEntries.find((row) => row.path === path)?.sha256,
  );
  const patched = applyRecipe(path, original);
  const deps = {
    Effect,
    ID12: trap,
    process: trap,
    isAISDK2: trap,
    packageName2: trap,
  };
  const loaded = new Function(
    ...Object.keys(deps),
    `${defineSource}\n${selectedDeclarations(patched, [spec.variable, ...spec.helpers, ...privateNames])}\nreturn {plugin:${spec.variable},make:fixedHookDeclaration2,accepts:isFixedHookDeclaration2,publication:getFixedHookPublication2};`,
  )(...Object.values(deps));
  const id = loaded.plugin.id;
  assert.ok(Object.isFrozen(loaded.plugin));
  return {
    ...loaded,
    accepts: (value) => loaded.accepts(value, id),
    publication: (callback) => loaded.publication(callback, id),
    path,
    sha256: sha(patched),
  };
}
function hostArrow(source) {
  const ast = ts.createSourceFile(
    hostPath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  assert.equal(ast.parseDiagnostics.length, 0);
  const found = [];
  function visit(node) {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(ast) === "hook" &&
      ts.isArrowFunction(node.initializer) &&
      ts.isPropertyAssignment(node.parent.parent) &&
      node.parent.parent.name.getText(ast) === "aisdk"
    )
      found.push(node.initializer.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(found.length, 1);
  assert.doesNotMatch(found[0], /hooks\.register|import\s*\(/u);
  return found[0];
}
const originalArrow = hostArrow(original);
const patchedArrow = hostArrow(applyRecipe(hostPath, original));
function route(aisdk, overrides = {}, expression = patchedArrow) {
  const deps = {
    Effect,
    Scope,
    aisdk,
    mutable: (value) => ({ ...value }),
    observeNativeSdkRegistration,
    ...overrides,
  };
  return new Function(
    ...Object.keys(deps),
    `"use strict";return (${expression});`,
  )(...Object.values(deps));
}
function sdkCanary() {
  const counts = { construct: 0, register: 0, callback: 0, dispose: 0 };
  const rows = [];
  const register = (name) => (callback) => {
    counts.construct++;
    return Effect.sync(() => {
      counts.register++;
      rows.push({ name, callback });
      return { dispose: Effect.sync(() => counts.dispose++) };
    });
  };
  return {
    counts,
    rows,
    aisdk: { hook: { sdk: register("sdk"), language: register("language") } },
  };
}
function scriptedControl({ failure, permissive = false } = {}) {
  const token = Object.freeze({}),
    log = [];
  let held = !permissive;
  return {
    token,
    log,
    hold: () => {
      held = true;
    },
    control: {
      inventoryBegin(...args) {
        log.push(["begin", ...args]);
        return failure === "begin"
          ? Effect.fail(Error("begin_failed"))
          : Effect.succeed(token);
      },
      inventoryHookPublication(...args) {
        log.push(["publication", ...args]);
        return failure === "publication"
          ? Effect.fail(Error("publication_failed"))
          : Effect.void;
      },
      inventoryGuard(value) {
        log.push(["guard", value]);
        return held
          ? Effect.fail(Error("native_permission_inventory_unverified"))
          : Effect.void;
      },
      inventoryRegistered(value) {
        log.push(["registered", value]);
        return Effect.void;
      },
      inventoryEnd(...args) {
        return Effect.sync(() => {
          log.push(["end", ...args]);
        });
      },
    },
  };
}
async function runControl(spec, body) {
  const p = await producer(spec);
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const c = yield* Control.Service;
        const h = yield* c.locationBegin({ directory: "/sdk-host-scripted" });
        yield* c.locationBind(h, {
          directory: "/sdk-host-scripted",
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
          Control.configured({ runtimeEpoch: "sdk-host", bootHolds: [] }),
        ),
      ),
    ),
  );
}

for (const name of ["sdk", "language"]) {
  test(`original Host ${name} bypass reproducer enters AISDK without Control`, async () => {
    const f = sdkCanary();
    const script = scriptedControl();
    await Effect.runPromise(
      Effect.scoped(
        route(
          f.aisdk,
          { control: script.control, inventoryHandle: {} },
          originalArrow,
        )(name, () => {
          f.counts.callback++;
          return Effect.void;
        }),
      ),
    );
    assert.equal(f.counts.construct, 1);
    assert.equal(f.counts.register, 1);
    assert.equal(f.counts.callback, 0);
    assert.deepEqual(script.log, []);
  });
  for (const failure of ["begin", "publication"]) {
    test(`patched Host ${name}: ${failure} failure precedes SDK effect construction, original token cleanup`, async () => {
      const f = sdkCanary(),
        script = scriptedControl({ failure }),
        handle = Object.freeze({}),
        options = Object.freeze({ providerID: "p" });
      const callback = () => {
        f.counts.callback++;
        return Effect.void;
      };
      const scope = await Effect.runPromise(Scope.make());
      try {
        await assert.rejects(
          Effect.runPromise(
            route(f.aisdk, {
              control: script.control,
              inventoryHandle: handle,
            })(name, callback, options).pipe(
              Effect.provideService(Scope.Scope, scope),
            ),
          ),
          failure === "begin" ? /begin_failed/u : /publication_failed/u,
        );
        assert.deepEqual(f.counts, {
          construct: 0,
          register: 0,
          callback: 0,
          dispose: 0,
        });
        assert.deepEqual(script.log[0], [
          "begin",
          handle,
          "hook",
          JSON.stringify(["aisdk", name]),
        ]);
        if (failure === "publication") {
          assert.deepEqual(script.log[1], [
            "publication",
            script.token,
            "aisdk",
            name,
            callback,
            options,
            scope,
          ]);
          assert.deepEqual(script.log.at(-1), ["end", script.token, "failed"]);
        }
        assert.deepEqual(
          script.log.map((row) => row[0]),
          failure === "begin" ? ["begin"] : ["begin", "publication", "end"],
        );
      } finally {
        await Effect.runPromise(Scope.close(scope, Exit.void));
      }
    });
  }
}

// Scripted held Control only: metadata may register, but replay must fail.
for (const name of ["sdk", "language"]) {
  test(`scripted ${name}: replay guard failure after original list registration, callback0`, async () => {
    const sdk = originalSdkLists();
    const script = scriptedControl();
    const scope = await Effect.runPromise(Scope.make());
    let callbackCalls = 0;
    let result;
    try {
      result = await Effect.runPromise(
        route(sdk.aisdk, {
          control: script.control,
          inventoryHandle: {},
        })(name, () => {
          callbackCalls++;
          assert.fail("callback constructed");
        }).pipe(Effect.provideService(Scope.Scope, scope)),
      );
      assert.equal(sdk.rows(name).length, 1);
      assert.equal(callbackCalls, 0);
      assert.deepEqual(
        script.log.map((row) => row[0]),
        ["begin", "publication", "registered"],
      );
      const event = { model: {}, options: {}, sdk: {}, language: {} };
      for (let replay = 0; replay < 2; replay++) {
        await assert.rejects(
          Effect.runPromise(
            sdk.aisdk[name === "sdk" ? "runSDK" : "runLanguage"](event),
          ),
          /inventory_unverified/u,
        );
        assert.equal(callbackCalls, 0);
      }
      assert.deepEqual(
        script.log.filter((row) => row[0] === "guard"),
        [
          ["guard", script.token],
          ["guard", script.token],
        ],
      );
      await Effect.runPromise(result.dispose);
      await Effect.runPromise(result.dispose);
      assert.deepEqual(sdk.rows(name), []);
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }
    assert.deepEqual(sdk.rows(name), []);
    assert.equal(callbackCalls, 0);
    assert.deepEqual(script.log.at(-1), ["end", script.token, "disposed"]);
  });
}

// Only this explicitly scripted permissive adapter can execute a synthetic
// callback. Real Control below remains held; no original producer callback runs.
for (const name of ["sdk", "language"]) {
  for (const options of [
    undefined,
    { providerID: "p" },
    { providerID: "other" },
  ]) {
    test(`original/patched ${name} conversion and filtering: ${JSON.stringify(options)} (scripted permissive only)`, async () => {
      const outcomes = [];
      for (const expression of [originalArrow, patchedArrow]) {
        const f = sdkCanary(),
          script = scriptedControl({ permissive: true }),
          scope = await Effect.runPromise(Scope.make());
        const event = {
          model: { providerID: "p", id: "model" },
          package: "synthetic-package",
          options: { synthetic: true },
          sdk: { synthetic: "sdk" },
          language: { synthetic: "language" },
        };
        const oldOther = event[name === "sdk" ? "language" : "sdk"];
        let output;
        function callback(value) {
          assert.equal(this, undefined);
          f.counts.callback++;
          output = value;
          assert.notEqual(value.model, event.model);
          assert.deepEqual(value.model, event.model);
          assert.equal(value.options, event.options);
          assert.equal(value.sdk, event.sdk);
          if (name === "language") assert.equal(value.language, event.language);
          else assert.equal(value.package, event.package);
          return Effect.sync(() => {
            value[name] = { synthetic: "replacement" };
          });
        }
        try {
          await Effect.runPromise(
            route(
              f.aisdk,
              { control: script.control, inventoryHandle: {} },
              expression,
            )(name, callback, options).pipe(
              Effect.provideService(Scope.Scope, scope),
            ),
          );
          assert.equal(f.rows[0].name, name);
          assert.notEqual(f.rows[0].callback, callback);
          await Effect.runPromise(f.rows[0].callback(event));
          const filtered = options?.providerID === "other";
          assert.equal(f.counts.callback, filtered ? 0 : 1);
          if (!filtered) {
            assert.deepEqual(
              Object.keys(output),
              name === "sdk"
                ? ["model", "package", "options", "sdk"]
                : ["model", "options", "sdk", "language"],
            );
            assert.equal(event[name], output[name]);
          }
          assert.equal(event[name === "sdk" ? "language" : "sdk"], oldOther);
          outcomes.push(event);
          if (expression === patchedArrow) {
            assert.deepEqual(script.log[1].slice(0, 6), [
              "publication",
              script.token,
              "aisdk",
              name,
              callback,
              options,
            ]);
            assert.deepEqual(
              script.log.slice(0, 4).map((row) => row[0]),
              filtered
                ? ["begin", "publication", "registered"]
                : ["begin", "publication", "registered", "guard"],
            );
            if (!filtered) {
              script.hold();
              await assert.rejects(
                Effect.runPromise(f.rows[0].callback(event)),
                /inventory_unverified/u,
              );
              assert.equal(f.counts.callback, 1);
            }
          }
        } finally {
          await Effect.runPromise(Scope.close(scope, Exit.void));
        }
        if (expression === patchedArrow) {
          assert.deepEqual(script.log.at(-1), [
            "end",
            script.token,
            "disposed",
          ]);
          assert.equal(f.counts.dispose, 1);
        }
      }
      assert.deepEqual(outcomes[0], outcomes[1]);
    });
  }
}

test("patched publish preserves the byte-exact original Host wrapper and named bridge arguments", () => {
  const ast = ts.createSourceFile(
    "arrow.js",
    patchedArrow,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const arrow = ast.statements[0].expression;
  const call = arrow.body;
  assert.equal(call.expression.getText(ast), "observeNativeSdkRegistration");
  assert.equal(call.arguments.length, 8);
  assert.deepEqual(
    call.arguments.slice(0, 7).map((n) => n.getText(ast)),
    [
      "Effect",
      "Scope",
      "control",
      "inventoryHandle",
      "name",
      "callback",
      "options",
    ],
  );
  const publish = call.arguments[7];
  assert.equal(publish.parameters[0].name.getText(ast), "guarded");
  assert.equal(
    publish.body
      .getText(ast)
      .replace(/Reflect\.apply\(guarded,/gu, "Reflect.apply(callback,"),
    originalArrow.slice(originalArrow.indexOf("=>") + 3),
  );
});

for (const spec of producerSpecs) {
  test(`real Control + original AISDK ${spec.name}: metadata registers, every replay stays held`, async () => {
    await runControl(spec, ({ c, h, p, scope }) =>
      Effect.gen(function* () {
        const sdk = originalSdkLists();
        const declaration = p.make();
        const row = declaration.hooks.find(
          (item) => item.domain === "aisdk" && item.name === spec.name,
        );
        assert.ok(row);
        assert.equal(p.accepts(declaration), true);
        assert.equal(p.publication(row.callback), declaration);
        const events = [];
        const guards = [];
        const observed = { ...c };
        for (const method of [
          "inventoryBegin",
          "inventoryHookPublication",
          "inventoryGuard",
          "inventoryRegistered",
          "inventoryEnd",
        ]) {
          observed[method] = (...args) => {
            if (method === "inventoryGuard") guards.push(args);
            return c[method](...args).pipe(
              Effect.tap((result) =>
                Effect.sync(() => events.push({ method, args, result })),
              ),
            );
          };
        }
        const aisdk = { hook: { ...sdk.aisdk.hook } };
        const originalRegister = aisdk.hook[spec.name];
        aisdk.hook[spec.name] = (callback) => {
          assert.deepEqual(
            events.map((event) => event.method),
            ["inventoryBegin", "inventoryHookPublication"],
          );
          assert.deepEqual(sdk.rows(spec.name), []);
          events.push({ method: "originalRegister", callback });
          return originalRegister(callback);
        };
        const exit = yield* Effect.exit(
          route(aisdk, { control: observed, inventoryHandle: h })(
            spec.name,
            row.callback,
            row.options,
          ).pipe(Effect.provideService(Scope.Scope, scope)),
        );
        assert.equal(events[0]?.method, "inventoryBegin");
        assert.equal(events[1]?.method, "inventoryHookPublication");
        assert.deepEqual(events[1].args, [
          events[0].result,
          "aisdk",
          spec.name,
          row.callback,
          row.options,
          scope,
        ]);
        assert.equal(
          exit._tag,
          "Success",
          exit._tag === "Failure" ? Cause.pretty(exit.cause) : undefined,
        );
        const result = exit.value;
        const began = events[0];
        assert.deepEqual(events[1].args, [
          began.result,
          "aisdk",
          spec.name,
          row.callback,
          row.options,
          scope,
        ]);
        assert.deepEqual(
          events.map((event) => event.method),
          [
            "inventoryBegin",
            "inventoryHookPublication",
            "originalRegister",
            "inventoryRegistered",
          ],
        );
        const [wrapper] = sdk.rows(spec.name);
        assert.equal(typeof wrapper, "function");
        assert.equal(wrapper, events[2].callback);
        assert.notEqual(wrapper, row.callback);
        assert.deepEqual(
          sdk.rows(spec.name === "sdk" ? "language" : "sdk"),
          [],
        );
        // Original callbacks remain behind the real held guard. The event contains
        // only inert data; SDK dependencies are traps and no SDK is acquired.
        const event = {
          model: { providerID: "inert", id: "inert" },
          package: "inert-no-sdk-import",
          options: {},
          sdk: trap,
          language: {},
        };
        assert.equal(guards.length, 0);
        for (let replay = 0; replay < 2; replay++) {
          const replayExit = yield* Effect.exit(
            sdk.aisdk[spec.name === "sdk" ? "runSDK" : "runLanguage"](event),
          );
          assert.equal(replayExit._tag, "Failure");
          assert.match(
            Cause.pretty(replayExit.cause),
            /native_permission_inventory_unverified/u,
          );
          const directExit = yield* Effect.exit(wrapper(event));
          assert.equal(directExit._tag, "Failure");
          assert.match(
            Cause.pretty(directExit.cause),
            /native_permission_inventory_unverified/u,
          );
        }
        assert.equal(guards.length, 4);
        assert.ok(
          guards.every((args) => args.length === 1 && args[0] === began.result),
        );
        yield* Scope.close(scope, Exit.void);
        assert.deepEqual(sdk.rows(spec.name), []);
        yield* result.dispose;
        yield* result.dispose;
        yield* Scope.close(scope, Exit.void);
        assert.deepEqual(sdk.rows(spec.name), []);
        assert.ok(
          events.some(
            (event) =>
              event.method === "inventoryEnd" &&
              event.args[0] === began.result &&
              event.args[1] === "disposed",
          ),
        );
        // The original run expression sees an empty original list after disposal.
        assert.equal(
          yield* sdk.aisdk[spec.name === "sdk" ? "runSDK" : "runLanguage"](
            event,
          ),
          event,
        );
        assert.equal(guards.length, 4);
        const staleExit = yield* Effect.exit(wrapper(event));
        assert.equal(staleExit._tag, "Failure");
        assert.match(
          Cause.pretty(staleExit.cause),
          /native_permission_inventory_unverified/u,
        );
        assert.equal(guards.length, 5);
        assert.deepEqual(guards.at(-1), [began.result]);
      }),
    );
  });
}

for (const spec of producerSpecs) {
  for (const scenario of [
    "foreign-callback",
    "same-shape",
    "foreign-source",
    "foreign-options",
    "cross-scope",
    "closed-scope",
  ]) {
    test(`real Control + inert ${spec.name} producer: ${scenario} stops before AISDK construction`, async () => {
      await runControl(spec, ({ c, h, p, scope }) =>
        Effect.gen(function* () {
          const f = sdkCanary(),
            events = [],
            attempts = [];
          const observed = { ...c };
          for (const method of [
            "inventoryBegin",
            "inventoryHookPublication",
            "inventoryGuard",
            "inventoryRegistered",
            "inventoryEnd",
          ]) {
            observed[method] = (...args) => {
              attempts.push({ method, args });
              return c[method](...args).pipe(
                Effect.tap((result) =>
                  Effect.sync(() => events.push({ method, args, result })),
                ),
              );
            };
          }
          const declaration = p.make();
          assert.equal(p.accepts(declaration), true);
          const row = declaration.hooks.find(
            (row) => row.domain === "aisdk" && row.name === spec.name,
          );
          assert.ok(row);
          assert.equal(p.publication(row.callback), declaration);
          let callback = row.callback;
          if (scenario === "foreign-callback")
            callback = () => {
              f.counts.callback++;
              return Effect.void;
            };
          if (scenario === "same-shape")
            callback = new Function(`return (${callback.toString()});`)();
          if (scenario === "foreign-source")
            callback = (yield* Effect.promise(() => producer(spec)))
              .make()
              .hooks.find((row) => row.name === spec.name).callback;
          if (
            ["foreign-callback", "same-shape", "foreign-source"].includes(
              scenario,
            )
          )
            assert.equal(p.publication(callback), undefined);
          if (scenario === "closed-scope") yield* Scope.close(scope, Exit.void);
          const callScope =
            scenario === "cross-scope" ? yield* Scope.make() : scope;
          const effect = route(f.aisdk, {
            control: observed,
            inventoryHandle: h,
          })(
            spec.name,
            callback,
            scenario === "foreign-options" ? {} : row.options,
          );
          const exit = yield* Effect.exit(
            effect.pipe(Effect.provideService(Scope.Scope, callScope)),
          );
          if (callScope !== scope) yield* Scope.close(callScope, Exit.void);
          assert.equal(exit._tag, "Failure");
          assert.match(
            Cause.pretty(exit.cause),
            /native_permission_inventory_unverified/u,
          );
          assert.deepEqual(f.counts, {
            construct: 0,
            register: 0,
            callback: 0,
            dispose: 0,
          });
          const began = events.find((e) => e.method === "inventoryBegin");
          assert.ok(began);
          assert.equal(began.args[1], "hook");
          assert.deepEqual(
            events.find((e) => e.method === "inventoryEnd")?.args,
            [began.result, "failed"],
          );
          assert.equal(
            attempts.some((e) => e.method === "inventoryRegistered"),
            false,
          );
          assert.deepEqual(
            attempts.map((e) => e.method),
            ["inventoryBegin", "inventoryHookPublication", "inventoryEnd"],
          );
          assert.equal(
            events.some((e) => e.method === "inventoryHookPublication"),
            false,
          );
        }),
      );
    });
  }
}
for (const name of ["sdk", "language"])
  for (const phase of ["construct", "effect"]) {
    test(`scripted ${name} publish ${phase} failure cleans original token`, async () => {
      const script = scriptedControl({ permissive: true });
      let constructed = 0;
      const fail = () => {
        constructed++;
        if (phase === "construct") throw Error("scripted_publish_failure");
        return Effect.fail(Error("scripted_publish_failure"));
      };
      await assert.rejects(
        Effect.runPromise(
          Effect.scoped(
            route(
              { hook: { sdk: fail, language: fail } },
              { control: script.control, inventoryHandle: {} },
            )(name, () => assert.fail("callback executed")),
          ),
        ),
        /scripted_publish_failure/u,
      );
      assert.equal(constructed, 1);
      assert.deepEqual(script.log.at(-1), ["end", script.token, "failed"]);
      assert.equal(
        script.log.some((row) => row[0] === "registered"),
        false,
      );
    });
  }
test("invocation source and original pinned bytes stay stable after extraction tests", async () => {
  await verifyLiveSources();
  for (const row of copied)
    assert.equal(
      sha(await readFile(new URL(row.path, import.meta.url))),
      row.sha256,
    );
  for (const path of [
    hostPath,
    sdkPath,
    effectPath,
    definePath,
    ...producerSpecs.map(
      (spec) =>
        `node_modules/@opencode/core/dist/chunks/config-${spec.chunk}.js`,
    ),
  ]) {
    assert.equal(
      sha(await readFile(new URL(path, root))),
      receipt.installEntries.find((row) => row.path === path)?.sha256,
      path,
    );
  }
});
