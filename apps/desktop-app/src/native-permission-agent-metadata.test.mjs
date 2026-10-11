import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdtemp, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test, { after } from "node:test";
import ts from "typescript";
import { NATIVE_PERMISSION_OVERLAY_RECIPE as recipe } from "./native-permission-overlay-contract.mjs";
import { copyPermissionControlSources } from "../scripts/native-permission-test-fixture.mjs";
import {
  observeNativeTransformRegistration,
  BUILTIN_PLUGIN_ORDER,
} from "./native-permission-inventory.mjs";

// Bounded source extraction only. No Native/core module imports. Scripted Bus
// is NOT evidence of listener safety or whole startup safety. ID/Name are
// identity standins; the default factory, Agent editor/Layer and State are real.
const root = new URL(
  "../runtime-event-host/.generated/install/",
  import.meta.url,
);
const receipt = JSON.parse(await readFile(new URL("../receipt.json", root)));
const sha = (b) => createHash("sha256").update(b).digest("hex");
const sources = new Map();
const liveSourcePins = await Promise.all(
  [
    "./native-permission-control.mjs",
    "./native-permission-inventory.mjs",
    "./native-permission-graph.mjs",
    "./native-permission-overlay-contract.mjs",
  ].map(async (p) => ({
    path: p,
    sha256: sha(await readFile(new URL(p, import.meta.url))),
  })),
);
async function pinned(p) {
  const rows = receipt.installEntries.filter((r) => r.path === p);
  assert.equal(rows.length, 1, p);
  const bytes = await readFile(new URL(p, root));
  assert.equal(sha(bytes), rows[0].sha256, p);
  sources.set(p, { text: bytes.toString("utf8"), sha256: sha(bytes) });
  return bytes.toString("utf8");
}
const chunks = "node_modules/@opencode/core/dist/chunks/";
const names = {
  producer: "az9r17tx",
  agent: "tats7t1r",
  state: "rdw6cm16",
  merge: "vgpkvtp0",
  host: "76n1dez8",
};
const original = {};
for (const [key, chunk] of Object.entries(names))
  original[key] = await pinned(`${chunks}config-${chunk}.js`);
const schema = await pinned("node_modules/@opencode/schema/dist/agent.js");
const events = await pinned("node_modules/@opencode/schema/dist/event.js");
const schemaHelpers = await pinned(
  "node_modules/@opencode/schema/dist/schema.js",
);
const defineBytes = await pinned(
  "node_modules/@opencode/plugin/dist/effect/plugin.js",
);
assert.equal(
  JSON.parse(await pinned("node_modules/effect/package.json")).version,
  "4.0.0-rc.112",
);
await Promise.all(
  receipt.installEntries
    .filter(
      (r) =>
        r.path.startsWith("node_modules/effect/") && r.path.endsWith(".js"),
    )
    .map((r) => pinned(r.path)),
);
const {
  Effect,
  Scope,
  Exit,
  Context,
  Layer,
  Array: EArray,
  Schema,
  SchemaGetter,
  Option,
  Cause,
} = await import(
  "../runtime-event-host/.generated/install/node_modules/effect/dist/index.js"
);
function ast(text) {
  const a = ts.createSourceFile(
    "inert.js",
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  assert.equal(a.parseDiagnostics.length, 0);
  return a;
}
function selections(text, wanted) {
  const a = ast(text),
    found = [];
  for (const node of a.statements) {
    if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
      wanted.includes(node.name?.text)
    )
      found.push(node.getText(a).replace(/^export /u, ""));
    if (ts.isVariableStatement(node))
      for (const d of node.declarationList.declarations)
        if (wanted.includes(d.name.getText(a)))
          found.push(`var ${d.getText(a)};`);
  }
  assert.equal(found.length, wanted.length, wanted.join(","));
  return found.join("\n");
}
function find(text, predicate) {
  const a = ast(text),
    result = [];
  function walk(n) {
    if (predicate(n)) result.push(n.getText(a));
    ts.forEachChild(n, walk);
  }
  walk(a);
  assert.equal(result.length, 1);
  return result[0];
}
// Every unknown free dependency fails at first access, including construction.
function compile(text, inputs = {}) {
  const allowed = {
    Map,
    Set,
    WeakMap,
    WeakSet,
    Object,
    Error,
    undefined,
    ...inputs,
  };
  const env = new Proxy(allowed, {
    has: () => true,
    get(target, key) {
      if (key === Symbol.unscopables) return undefined;
      if (!Object.hasOwn(target, key))
        throw Error(`unknown original dependency: ${String(key)}`);
      return target[key];
    },
  });
  return new Function("env", `with(env) { ${text} }`)(env);
}
function patched(p, text) {
  const entry = recipe.files.find((r) => r.path === p);
  if (!entry) return text;
  assert.equal(sha(text), entry.beforeSha256);
  for (const edit of entry.edits) {
    assert.equal(text.split(edit.find).length - 1, 1);
    text = text.replace(edit.find, () => edit.replace);
  }
  assert.equal(sha(text), entry.afterSha256);
  return text;
}
const stateNames = [
  "CurrentGroup",
  "CurrentBatch",
  "disable",
  "run",
  "batch2",
  "shutdown2",
  "group2",
  "create3",
];
function stateFrom(text) {
  return compile(
    `${selections(text, stateNames)}; return {create3,batch2,shutdown2,group2};`,
    { Effect, Scope, Exit, Context },
  );
}
const rawState = stateFrom(original.state);
const stateText = patched(`${chunks}config-${names.state}.js`, original.state);
const currentState = stateFrom(stateText);
const identity = Object.freeze({ make: (value) => value });
const helpers = compile(
  `${selections(schemaHelpers, ["statics", "optional"])}; return {statics,optional};`,
  { Schema, SchemaGetter, Option },
);
const ephemeral = compile(
  `${selections(events, ["ephemeral"])}; return ephemeral;`,
  { Schema, ID: Schema.String, Location: { Ref: Schema.Unknown }, ...helpers },
);
const updated = compile(`${selections(schema, ["Updated"])}; return Updated;`, {
  ephemeral,
});
const defaultExpression = find(
  schema,
  (n) =>
    ts.isPropertyAssignment(n) &&
    n.name.getText() === "default" &&
    ts.isArrowFunction(n.initializer),
);
const defaultFactory = compile(`return ({${defaultExpression}}).default;`, {
  Name: identity,
});
const merge2 = compile(
  `${selections(original.merge, ["merge2"])}; return merge2;`,
);
const define = compile(
  `${selections(defineBytes, ["define"])}; return define;`,
);
const privateNames = [
  "fixedHookDeclarations2",
  "fixedHookPublications2",
  "isFixedHookDeclaration2",
  "getFixedHookPublication2",
  "fixedHookBundle2",
  "fixedHookDeclaration2",
];
function producer() {
  const text = patched(
    `${chunks}config-${names.producer}.js`,
    original.producer,
  );
  return {
    ...compile(
      `${selections(text, ["Plugin34", "PROMPT_EXPLORE", "PROMPT_TITLE", "PROMPT_SUMMARY", ...privateNames])}; return {plugin:Plugin34,make:fixedHookDeclaration2,accepts:isFixedHookDeclaration2,publication:getFixedHookPublication2};`,
      {
        Effect,
        define,
        ID10: identity,
        Name3: identity,
        defaultID2: "build",
        merge2,
      },
    ),
    sha256: sha(text),
  };
}
function route(text, agents, extra = {}) {
  const expression = find(
    text,
    (n) =>
      ts.isPropertyAssignment(n) &&
      n.name.getText() === "transform" &&
      ts.isArrowFunction(n.initializer) &&
      ts.isPropertyAssignment(n.parent.parent) &&
      n.parent.parent.name.getText() === "agent",
  );
  return compile(`return (${expression.slice(expression.indexOf(":") + 1)});`, {
    agents,
    ID10: identity,
    mutable: (v) => v,
    ...extra,
  });
}
function fixture(state = rawState, notificationControl) {
  const notifications = [],
    states = [];
  const Bus = class extends Context.Service()("test/ScriptedAgentBus") {};
  const GlobalService = class extends Context.Service()(
    "test/ScriptedGlobal",
  ) {};
  const result = compile(
    `${selections(original.agent, ["SHELL_OUTPUT_GLOB", "TOOL_OUTPUT_GLOB", "Service62", "layer"])}; return {Service:Service62,layer};`,
    {
      Context,
      Layer,
      Effect,
      Array: EArray,
      path,
      Service83: Bus,
      Global: { Service: GlobalService },
      Agent: { Event: { Updated: updated } },
      ID10: identity,
      defaultID2: "build",
      Info14: { default: defaultFactory },
      create3(options) {
        const s = state.create3(options);
        states.push(s);
        return s;
      },
    },
  );
  const layer = result.layer.pipe(
    Layer.provide(
      Layer.succeed(Bus, {
        publish(type, data) {
          return Effect.sync(() => {
            if (notificationControl)
              notificationControl.captureAgentNotificationListeners([
                scriptedNotificationListener,
              ]);
            assert.equal(type, updated);
            assert.deepEqual(data, {});
            notifications.push({
              type: type.type,
              durability: type.durability,
              data,
            });
          });
        },
      }),
    ),
    Layer.provide(
      Layer.succeed(GlobalService, {
        data: "/scripted/data",
        tmp: "/scripted/tmp",
        config: "/scripted/config",
      }),
    ),
  );
  return { ...result, layer, notifications, states };
}
const namespace = await mkdtemp(join(tmpdir(), "omoc-agent-metadata-"));
after(() => rm(namespace, { recursive: true, force: true }));
await symlink(
  fileURLToPath(new URL("node_modules", root)),
  join(namespace, "node_modules"),
);
const copied = await copyPermissionControlSources(namespace);
const Control = await import(
  pathToFileURL(join(namespace, "native-permission-control.mjs"))
);
const order = ["build", "general", "explore", "compaction", "title", "summary"];
async function withAgent(body, state = rawState) {
  const f = fixture(state);
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const agents = yield* f.Service;
        return yield* body({ f, agents });
      }).pipe(Effect.provide(f.layer)),
    ),
  );
}
function assertDefaults(rows) {
  assert.deepEqual(
    rows.map((r) => r.id),
    order,
  );
  assert.deepEqual(
    rows.map((r) => r.name),
    ["Build", "General", "Explore", "Compaction", "Title", "Summary"],
  );
  assert.deepEqual(
    rows.map((r) => [r.mode, r.hidden]),
    [
      ["primary", false],
      ["subagent", false],
      ["subagent", false],
      ["primary", true],
      ["primary", true],
      ["primary", true],
    ],
  );
  const defaults = defaultFactory("build").permissions;
  const extra = [
    "/scripted/data/shell/*/*",
    "/scripted/data/tool-output/*",
    "/scripted/tmp/*",
    "/scripted/config/*",
  ].map((resource) => ({
    action: "external_directory",
    resource,
    effect: "allow",
  }));
  assert.deepEqual(rows[0].permissions, [
    ...defaults,
    ...extra,
    { action: "question", resource: "*", effect: "allow" },
  ]);
  assert.deepEqual(rows[1].permissions, [
    ...defaults,
    ...extra,
    { action: "question", resource: "*", effect: "deny" },
    { action: "subagent", resource: "*", effect: "deny" },
  ]);
  assert.deepEqual(rows[2].permissions, [
    ...defaults,
    ...extra,
    ...[
      ["*", "*", "deny"],
      ["grep", "*", "allow"],
      ["glob", "*", "allow"],
      ["webfetch", "*", "allow"],
      ["websearch", "*", "allow"],
      ["read", "*", "allow"],
      ["read", "*.env", "ask"],
      ["read", "*.env.*", "ask"],
      ["read", "*.env.example", "allow"],
      ["subagent", "*", "deny"],
      ["external_directory", "*", "ask"],
    ].map(([action, resource, effect]) => ({ action, resource, effect })),
    ...extra,
  ]);
  assert.deepEqual(rows[3].permissions, [...defaults, ...extra]);
  for (const row of rows.slice(4))
    assert.deepEqual(row.permissions, [
      ...defaults,
      ...extra,
      { action: "*", resource: "*", effect: "deny" },
    ]);
  assert.deepEqual(rows[0].request, { settings: {}, headers: {}, body: {} });
  assert.match(rows[2].system, /file search specialist/);
  assert.match(rows[4].system, /title generator/);
  assert.match(rows[5].system, /Summarize what was done/);
}
test("closed dependency vocabulary throws on unknown access", () =>
  assert.throws(
    () => compile("return unknownDependency();"),
    /unknown original dependency/,
  ));
test("source-owned callback is byte-exact, synchronous, private and frozen", () => {
  const p = producer(),
    d = p.make({});
  assert.equal(Object.isFrozen(p.plugin), true);
  assert.equal(Object.isFrozen(d), true);
  const expression = find(
    original.producer,
    (n) =>
      ts.isCallExpression(n) &&
      n.expression.getText() === "ctx.agent.transform",
  );
  const a = ast(expression),
    call = a.statements[0].expression;
  assert.equal(d.hooks[0].callback.toString(), call.arguments[0].getText(a));
  assert.equal(d.hooks[0].callback.constructor, Function);
  assert.equal(p.publication(d.hooks[0].callback, "opencode.agent"), d);
  assert.equal(
    p.publication(() => {}, "opencode.agent"),
    undefined,
  );
  assert.equal(p.accepts(d, "opencode.agent"), true);
});
for (const [label, state] of [
  ["original", rawState],
  ["current recipe", currentState],
])
  test(`${label} actual Agent Layer + Host adapter + State: defaults, replay, disposal isolation and ephemeral notification`, () =>
    withAgent(
      ({ f, agents }) =>
        Effect.gen(function* () {
          assert.deepEqual(yield* agents.list(), []);
          assert.equal(f.notifications.length, 0);
          const scope = yield* Scope.make(),
            p = producer();
          const transform = route(original.host, agents);
          const bundle = yield* p.plugin
            .effect({ agent: { transform } })
            .pipe(Effect.provideService(Scope.Scope, scope));
          assert.ok(bundle);
          assertDefaults(yield* agents.list());
          assert.deepEqual(yield* agents.select(), {
            id: "build",
            info: yield* agents.get("build"),
          });
          assert.equal((yield* agents.resolve()).id, "build");
          assert.deepEqual(f.notifications, [
            { type: "agent.updated", durability: "ephemeral", data: {} },
          ]);
          const first = yield* agents.list();
          yield* agents.reload();
          const second = yield* agents.list();
          assertDefaults(second);
          assert.notEqual(first[0], second[0]);
          const other = yield* Scope.make();
          const registration = yield* agents
            .transform((e) =>
              e.update("extra", (r) => {
                r.name = "Extra";
              }),
            )
            .pipe(Effect.provideService(Scope.Scope, other));
          assert.equal((yield* agents.list()).length, 7);
          yield* Scope.close(scope, Exit.void);
          assert.deepEqual(
            (yield* agents.list()).map((r) => r.id),
            ["extra"],
          );
          yield* registration.dispose;
          const count = f.notifications.length;
          yield* registration.dispose;
          yield* Scope.close(other, Exit.void);
          assert.equal(f.notifications.length, count);
          assert.deepEqual(yield* agents.list(), []);
        }),
      state,
    ));

test("original State batch/run and shutdown notification behavior with pinned Effect", async () => {
  for (const state of [rawState, currentState]) {
    const notifications = [],
      scope = await Effect.runPromise(Scope.make());
    const s = state.create3({
      initial: () => ({ count: 0 }),
      editor: (v) => v,
      notify: (v) => Effect.sync(() => notifications.push(v.count)),
    });
    try {
      await Effect.runPromise(
        state
          .batch2(
            s.transform((v) => {
              v.count++;
            }),
          )
          .pipe(Effect.provideService(Scope.Scope, scope)),
      );
      assert.equal(s.get().count, 1);
      assert.deepEqual(notifications, [1]);
      await Effect.runPromise(state.shutdown2(Scope.close(scope, Exit.void)));
      assert.deepEqual(notifications, [1]);
      assert.equal(s.get().count, 1);
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }
  }
});
test("original and current recipe State.run correction is explicitly bound", () => {
  assert.match(original.state, /yield\* Exit.asVoidAll/);
  const entry = recipe.files.find(
    (r) => r.path === `${chunks}config-${names.state}.js`,
  );
  if (entry) {
    assert.notEqual(stateText, original.state);
    assert.equal(sha(stateText), entry.afterSha256);
  } else assert.equal(stateText, original.state);
});

// This predicate and listener are deliberate standins. Their hash is NOT a
// graph source pin or a claim about the actual Bus/LocationLifecycle listener.
const scriptedNotificationListener = () => Effect.void;
const scriptedNotificationSource = Object.freeze({
  accepts: (listener) => listener === scriptedNotificationListener,
  sourceSha256: sha("agent-metadata-test scripted listener predicate v1"),
});
async function runControl(body, { bindNotification = true } = {}) {
  const p = producer();
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const c = yield* Control.Service;
        const h = yield* c.locationBegin({
          directory: "/agent-metadata-scripted",
        });
        yield* c.locationBind(h, {
          directory: "/agent-metadata-scripted",
          project: { id: "project" },
        });
        yield* c.locationReady(h);
        yield* c.inventoryPlan(
          h,
          BUILTIN_PLUGIN_ORDER.pre.map((id) => ({ id })),
          BUILTIN_PLUGIN_ORDER.post.map((id) => ({ id })),
          [{}],
        );
        c.inventoryHookSource(
          p.plugin,
          (v) => p.accepts(v, p.plugin.id),
          (cb) => p.publication(cb, p.plugin.id),
          p.sha256,
        );
        const descriptor = Object.freeze({
          id: p.plugin.id,
          effect: () => Effect.void,
        });
        yield* c.inventoryToolResolve(h, p.plugin, descriptor);
        const parent = yield* c.inventoryBegin(h, "plugin", p.plugin.id),
          scope = yield* Scope.make();
        yield* c.inventoryToolActivation(parent, descriptor, scope);
        yield* Scope.addFinalizer(scope, c.inventoryEnd(parent, "disposed"));
        try {
          return yield* body({ c, h, p, parent, scope });
        } finally {
          yield* Scope.close(scope, Exit.void);
        }
      }).pipe(
        Effect.provide(
          Control.configured(
            { runtimeEpoch: "agent-metadata", bootHolds: [] },
            (service) => {
              if (bindNotification)
                service.bindAgentNotificationSource(scriptedNotificationSource);
            },
          ),
        ),
      ),
    ),
  );
}
function controlledAgent({ c, h }) {
  return Effect.gen(function* () {
    const f = fixture(currentState, c);
    const agents = yield* f.Service.pipe(Effect.provide(f.layer));
    const events = [],
      tokens = [];
    let registrations = 0,
      result;
    const observedControl = {
      ...c,
      inventoryBegin(...args) {
        return c.inventoryBegin(...args).pipe(
          Effect.tap((token) =>
            Effect.sync(() => {
              tokens.push(token);
              events.push("begin");
            }),
          ),
        );
      },
      inventoryTransformPublication(...args) {
        return c
          .inventoryTransformPublication(...args)
          .pipe(
            Effect.tap(() => Effect.sync(() => events.push("publication"))),
          );
      },
      inventoryTransformMetadata(...args) {
        return c
          .inventoryTransformMetadata(...args)
          .pipe(Effect.tap(() => Effect.sync(() => events.push("metadata"))));
      },
      inventoryTransformReplay(...args) {
        c.inventoryTransformReplay(...args);
        events.push("replay");
      },
      inventoryRegistered(...args) {
        return c
          .inventoryRegistered(...args)
          .pipe(Effect.tap(() => Effect.sync(() => events.push("registered"))));
      },
    };
    const observed = {
      ...agents,
      transform(cb) {
        registrations++;
        events.push("state");
        return agents.transform(cb);
      },
    };
    const nativeRoute = route(
      patched(`${chunks}config-${names.host}.js`, original.host),
      observed,
      {
        Effect,
        Scope,
        control: observedControl,
        inventoryHandle: h,
        observeNativeTransformRegistration,
      },
    );
    const transform = (callback) =>
      nativeRoute(callback).pipe(
        Effect.tap((value) =>
          Effect.sync(() => {
            result = value;
          }),
        ),
      );
    return {
      f,
      agents,
      events,
      tokens,
      transform,
      ctx: { agent: { transform } },
      registrations: () => registrations,
      result: () => result,
    };
  });
}
test("actual copied Control + current helper publishes fixed Agent metadata and gates every State replay", () =>
  runControl((input) =>
    Effect.gen(function* () {
      const { c, p, scope } = input,
        x = yield* controlledAgent(input);
      const bundle = yield* p.plugin
        .effect(x.ctx)
        .pipe(Effect.provideService(Scope.Scope, scope));
      assert.equal(p.accepts(bundle, p.plugin.id), true);
      assert.equal(x.registrations(), 1);
      assert.deepEqual(x.events, [
        "begin",
        "publication",
        "metadata",
        "state",
        "replay",
        "registered",
      ]);
      assertDefaults(yield* x.agents.list());
      assert.equal(x.f.notifications.length, 1);
      const first = yield* x.agents.list();
      x.f.states[0].invalidate();
      assertDefaults(yield* x.agents.list());
      assert.equal(x.events.filter((e) => e === "replay").length, 2);
      assert.notEqual((yield* x.agents.list())[0], first[0]);
      assert.equal(
        x.f.notifications.length,
        1,
        "synchronous get replays without Bus notification",
      );
      yield* x.agents.reload();
      assert.equal(x.events.filter((e) => e === "replay").length, 3);
      assert.equal(x.f.notifications.length, 2);
      assert.equal((yield* x.agents.select()).id, "build");
      yield* c.inventoryRegistered(input.parent);
      yield* x.agents.reload();
      assertDefaults(yield* x.agents.list());
      yield* x.result().dispose;
      assert.deepEqual(yield* x.agents.list(), []);
      assert.throws(
        () => c.inventoryTransformReplay(x.tokens[0]),
        /inventory_unverified/,
      );
      const count = x.f.notifications.length;
      yield* x.result().dispose;
      assert.equal(x.f.notifications.length, count);
      yield* Scope.close(scope, Exit.void);
      assert.deepEqual(yield* x.agents.list(), []);
    }),
  ));
for (const scenario of [
  "foreign",
  "same-shape",
  "foreign-source",
  "cross-scope",
  "disposed",
  "finalizing",
  "parent-ended",
  "unbound-notification",
]) {
  test(`actual Control refuses ${scenario} before State registration`, () =>
    runControl(
      (input) =>
        Effect.gen(function* () {
          const { c, h, p, parent, scope } = input,
            x = yield* controlledAgent(input);
          let cb = p.make(x.ctx).hooks[0].callback,
            callScope = scope;
          if (scenario === "foreign")
            cb = () => assert.fail("foreign callback ran");
          if (scenario === "same-shape")
            cb = compile(`return (${cb.toString()});`);
          if (scenario === "foreign-source")
            cb = producer().make(x.ctx).hooks[0].callback;
          if (scenario === "cross-scope") callScope = yield* Scope.make();
          if (scenario === "disposed") yield* Scope.close(scope, Exit.void);
          if (scenario === "finalizing") yield* c.locationFinalizing(h);
          if (scenario === "parent-ended")
            yield* c.inventoryEnd(parent, "disposed");
          const result = yield* Effect.exit(
            x.transform(cb).pipe(Effect.provideService(Scope.Scope, callScope)),
          );
          if (callScope !== scope) yield* Scope.close(callScope, Exit.void);
          assert.equal(result._tag, "Failure");
          assert.match(Cause.pretty(result.cause), /inventory_unverified/);
          assert.equal(x.registrations(), 0);
          assert.deepEqual(x.f.notifications, []);
          assert.deepEqual(yield* x.agents.list(), []);
          if (x.tokens[0])
            assert.throws(
              () => c.inventoryTransformReplay(x.tokens[0]),
              /inventory_unverified/,
            );
        }),
      { bindNotification: scenario !== "unbound-notification" },
    ));
}
for (const scenario of [
  "finalizing",
  "parent-disposed",
  "parent-failed",
  "registration-disposed",
  "scope-disposed",
]) {
  test(`registered Agent State replay refuses ${scenario} before rebuilding defaults`, () =>
    runControl((input) =>
      Effect.gen(function* () {
        const { c, h, p, parent, scope } = input,
          x = yield* controlledAgent(input);
        yield* p.plugin
          .effect(x.ctx)
          .pipe(Effect.provideService(Scope.Scope, scope));
        assertDefaults(yield* x.agents.list());
        const before = x.f.notifications.length,
          replayCount = x.events.filter((e) => e === "replay").length;
        if (scenario === "finalizing") yield* c.locationFinalizing(h);
        if (scenario === "parent-disposed")
          yield* c.inventoryEnd(parent, "disposed");
        if (scenario === "parent-failed")
          yield* c.inventoryEnd(parent, "failed");
        if (scenario === "registration-disposed") yield* x.result().dispose;
        if (scenario === "scope-disposed") yield* Scope.close(scope, Exit.void);
        assert.throws(
          () => c.inventoryTransformReplay(x.tokens[0]),
          /inventory_unverified/,
        );
        if (["registration-disposed", "scope-disposed"].includes(scenario)) {
          assert.deepEqual(yield* x.agents.list(), []);
        } else {
          x.f.states[0].invalidate();
          assert.throws(() => x.f.states[0].get(), /inventory_unverified/);
          assert.equal(x.f.notifications.length, before);
        }
        assert.equal(
          x.events.filter((e) => e === "replay").length,
          replayCount,
        );
      }),
    ));
}
test("closing actual Scope refuses replay before any registration finalizer runs", () =>
  runControl((input) =>
    Effect.gen(function* () {
      const { p, scope } = input,
        x = yield* controlledAgent(input);
      yield* p.plugin
        .effect(x.ctx)
        .pipe(Effect.provideService(Scope.Scope, scope));
      assertDefaults(yield* x.agents.list());
      const replayCount = x.events.filter((e) => e === "replay").length;
      let checked = false;
      // LIFO: this real Scope finalizer runs BEFORE helper/State/parent cleanup.
      // The original State.get path is synchronous and must reject a closed scope.
      yield* Scope.addFinalizer(
        scope,
        Effect.sync(() => {
          checked = true;
          assert.equal(scope.state._tag, "Closed");
          x.f.states[0].invalidate();
          assert.throws(() => x.f.states[0].get(), /inventory_unverified/);
          assert.equal(
            x.events.filter((e) => e === "replay").length,
            replayCount,
          );
        }),
      );
      yield* Scope.close(scope, Exit.void);
      assert.equal(checked, true);
    }),
  ));
test("closing actual Scope refuses prepublication before parent finalizer runs", () =>
  runControl((input) =>
    Effect.gen(function* () {
      const { p, scope } = input,
        x = yield* controlledAgent(input);
      let checked = false;
      yield* Scope.addFinalizer(
        scope,
        Effect.gen(function* () {
          checked = true;
          assert.equal(scope.state._tag, "Closed");
          const result = yield* Effect.exit(
            p.plugin
              .effect(x.ctx)
              .pipe(Effect.provideService(Scope.Scope, scope)),
          );
          assert.equal(result._tag, "Failure");
          assert.match(Cause.pretty(result.cause), /inventory_unverified/);
          assert.equal(x.registrations(), 0);
          assert.deepEqual(x.f.notifications, []);
          assert.deepEqual(yield* x.agents.list(), []);
        }),
      );
      yield* Scope.close(scope, Exit.void);
      assert.equal(checked, true);
    }),
  ));

// Fault injection into the actual owned Effect Scope, restored before cleanup.
// This is adversarial input coverage, not a substitute Scope implementation.
function corruptScope(scope, scenario) {
  const saved = Object.getOwnPropertyDescriptor(scope, "state");
  let accesses = 0;
  const denied = () => {
    accesses++;
    throw Error("scope accessor/proxy executed");
  };
  let descriptor;
  switch (scenario) {
    case "missing-state":
      break;
    case "accessor-state":
      descriptor = { get: denied };
      break;
    case "proxy-state":
      descriptor = {
        value: new Proxy({}, { get: denied, getOwnPropertyDescriptor: denied }),
      };
      break;
    case "null-state":
      descriptor = { value: null };
      break;
    case "primitive-state":
      descriptor = { value: 42 };
      break;
    case "missing-tag":
      descriptor = { value: {} };
      break;
    case "inherited-tag":
      descriptor = { value: Object.create({ _tag: "Open" }) };
      break;
    case "accessor-tag":
      descriptor = {
        value: Object.defineProperty({}, "_tag", { get: denied }),
      };
      break;
    case "unknown-tag":
      descriptor = { value: { _tag: "Unknown" } };
      break;
    default:
      assert.fail("unknown corruption scenario");
  }
  if (descriptor)
    Object.defineProperty(scope, "state", {
      configurable: true,
      ...descriptor,
    });
  else delete scope.state;
  return {
    accesses: () => accesses,
    restore() {
      Object.defineProperty(scope, "state", saved);
    },
  };
}
for (const scenario of [
  "missing-state",
  "accessor-state",
  "proxy-state",
  "null-state",
  "primitive-state",
  "missing-tag",
  "inherited-tag",
  "accessor-tag",
  "unknown-tag",
]) {
  for (const phase of ["prepublication", "replay"]) {
    test(`actual Scope ${scenario} is refused at ${phase} without accessor/proxy execution`, () =>
      runControl((input) =>
        Effect.gen(function* () {
          const { c, p, scope } = input;
          let corruption;
          const observed =
            phase === "prepublication"
              ? {
                  ...c,
                  inventoryTransformMetadata(token) {
                    return Effect.suspend(() => {
                      corruption = corruptScope(scope, scenario);
                      return c
                        .inventoryTransformMetadata(token)
                        .pipe(
                          Effect.ensuring(
                            Effect.sync(() => corruption.restore()),
                          ),
                        );
                    });
                  },
                }
              : c;
          const x = yield* controlledAgent({ ...input, c: observed });
          if (phase === "prepublication") {
            const result = yield* Effect.exit(
              p.plugin
                .effect(x.ctx)
                .pipe(Effect.provideService(Scope.Scope, scope)),
            );
            assert.equal(result._tag, "Failure");
            assert.match(Cause.pretty(result.cause), /inventory_unverified/);
            assert.equal(x.registrations(), 0);
            assert.deepEqual(x.f.notifications, []);
            assert.deepEqual(yield* x.agents.list(), []);
          } else {
            yield* p.plugin
              .effect(x.ctx)
              .pipe(Effect.provideService(Scope.Scope, scope));
            assertDefaults(yield* x.agents.list());
            const replayCount = x.events.filter((e) => e === "replay").length;
            corruption = corruptScope(scope, scenario);
            try {
              x.f.states[0].invalidate();
              assert.throws(() => x.f.states[0].get(), /inventory_unverified/);
              assert.equal(
                x.events.filter((e) => e === "replay").length,
                replayCount,
              );
              assert.equal(x.f.notifications.length, 1);
            } finally {
              corruption.restore();
            }
            assertDefaults(yield* x.agents.list());
          }
          assert.ok(corruption);
          assert.equal(corruption.accesses(), 0);
        }),
      ));
  }
}
test("foreign tokens and same-shape token cannot authorize metadata or replay", () =>
  runControl(({ c }) =>
    Effect.gen(function* () {
      for (const token of [{}, Object.freeze({}), new Proxy({}, {})]) {
        assert.throws(
          () => c.inventoryTransformReplay(token),
          /inventory_unverified/,
        );
        const result = yield* Effect.exit(c.inventoryTransformMetadata(token));
        assert.equal(result._tag, "Failure");
        assert.match(Cause.pretty(result.cause), /inventory_unverified/);
      }
    }),
  ));
for (const domain of ["provider", "model", "integration", "mcp"])
  test(`Agent callback cannot enter ${domain} transform route`, () =>
    runControl(({ c, h, p, scope }) =>
      Effect.gen(function* () {
        let state = 0;
        const cb = p.make({}).hooks[0].callback;
        const result = yield* Effect.exit(
          observeNativeTransformRegistration(
            Effect,
            Scope,
            c,
            h,
            domain,
            cb,
            () => {
              state++;
              return Effect.succeed({ dispose: Effect.void });
            },
          ).pipe(Effect.provideService(Scope.Scope, scope)),
        );
        assert.equal(result._tag, "Failure");
        assert.match(Cause.pretty(result.cause), /inventory_unverified/);
        assert.equal(state, 0);
      }),
    ));
test("default raw allow does not grant Control execution; inventory remains incomplete", () =>
  runControl(({ c }) =>
    Effect.gen(function* () {
      assert.equal(defaultFactory("build").permissions[0].effect, "allow");
      const result = yield* Effect.exit(
        c.transaction(["project"], (tx) => c.assertExecution(tx, "project")),
      );
      assert.equal(result._tag, "Failure");
      const snapshot = yield* c.transaction(["project"], (tx) =>
        c.inventorySnapshot(tx, "project"),
      );
      assert.equal(snapshot.complete, false);
    }),
  ));
test("original receipt and copied Control closure stay exact", async () => {
  for (const row of liveSourcePins)
    assert.equal(
      sha(await readFile(new URL(row.path, import.meta.url))),
      row.sha256,
      row.path,
    );
  for (const [p, row] of sources)
    assert.equal(sha(await readFile(new URL(p, root))), row.sha256, p);
  for (const row of copied)
    assert.equal(
      sha(await readFile(new URL(row.path, import.meta.url))),
      row.sha256,
      row.path,
    );
});
