// These tests pin the retained strict proof machinery; production runs non-strict.
process.env.OMOC_PERMISSION_PROOF_STRICT = "1";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdtemp, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { copyPermissionControlSources } from "../scripts/native-permission-test-fixture.mjs";
import { NATIVE_PERMISSION_OVERLAY_RECIPE } from "./native-permission-overlay-contract.mjs";
import test, { after } from "node:test";
import ts from "typescript";

// Exact original Bus expressions only. No Native/core or schema module import.
// Session type identities, event ID and unused physical dependencies are explicit
// standins. This proves the Agent branch, not arbitrary listeners or startup.
const root = new URL(
  "../runtime-event-host/.generated/install/",
  import.meta.url,
);
const receipt = JSON.parse(await readFile(new URL("../receipt.json", root)));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function source(path, expected) {
  const bytes = await readFile(new URL(path, root));
  const rows = receipt.installEntries.filter((row) => row.path === path);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sha256, expected);
  assert.equal(sha(bytes), expected);
  return ts.createSourceFile(
    path,
    bytes.toString("utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
}
const bus = await source(
  "node_modules/@opencode/core/dist/chunks/config-vhejgqwc.js",
  "d1c57ce84aa8014e8e2f2ba09fae01912941dc2ef614821556bd6e2b7726ccc4",
);
const session = await source(
  "node_modules/@opencode/schema/dist/session-event.js",
  "f1e5e1652c97ebdde3fd945bca43bf7bc77ff77e949b36307ca1d9af850ff07c",
);
const agent = await source(
  "node_modules/@opencode/schema/dist/agent.js",
  "c18ebdc0462ffb0625c286b6ab8a1f6f25081f395ca06b53553ba3d3147dd25e",
);
const lifecycle = await source(
  "node_modules/@opencode/core/dist/chunks/config-11jgdds2.js",
  "ca0f6134bc21197f76ca12fede197b08f41eb4ad736db99bf3beed4eed03f992",
);
for (const ast of [bus, session, agent, lifecycle])
  assert.equal(ast.parseDiagnostics.length, 0);
function one(ast, predicate) {
  const matches = [];
  function visit(node) {
    if (predicate(node)) matches.push(node);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(matches.length, 1);
  return matches[0];
}
function variable(ast, name) {
  return one(
    ast,
    (node) => ts.isVariableDeclaration(node) && node.name.getText(ast) === name,
  ).initializer.getText(ast);
}
function fn(name, tree = bus) {
  return one(
    tree,
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === name,
  ).getText(tree);
}
const sessionTypes = new Set();
function scanTypes(node) {
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.expression.getText(session) === "Event" &&
    ["durable", "ephemeral"].includes(node.expression.name.text)
  ) {
    const input = node.arguments[0];
    assert.ok(ts.isObjectLiteralExpression(input));
    const type = input.properties.find(
      (property) =>
        ts.isPropertyAssignment(property) &&
        property.name.getText(session) === "type",
    );
    assert.ok(type && ts.isStringLiteral(type.initializer));
    assert.ok(type.initializer.text.startsWith("session."));
    sessionTypes.add(type.initializer.text);
  }
  ts.forEachChild(node, scanTypes);
}
scanTypes(session);
assert.ok(sessionTypes.size > 0);
assert.equal(sessionTypes.has("agent.updated"), false);
const agentEvent = new Function(
  "ephemeral",
  `return (${variable(agent, "Updated")});`,
)((input) => {
  assert.deepEqual(input, { type: "agent.updated", schema: {} });
  return Object.freeze({ type: input.type, durable: undefined });
});
const listener = one(
  lifecycle,
  (node) =>
    ts.isCallExpression(node) &&
    node.expression.getText(lifecycle) === "bus.listen",
).arguments[0].getText(lifecycle);
for (const row of receipt.installEntries.filter(
  (row) =>
    row.path.startsWith("node_modules/effect/") && row.path.endsWith(".js"),
))
  assert.equal(sha(await readFile(new URL(row.path, root))), row.sha256);
const { Clock, Context, Effect, Option, PubSub, Scheduler } = await import(
  "../runtime-event-host/.generated/install/node_modules/effect/dist/index.js"
);
function patched(tree) {
  const row = NATIVE_PERMISSION_OVERLAY_RECIPE.files.find((entry) =>
    entry.path.endsWith(tree.fileName),
  );
  assert.ok(row);
  let text = tree.text;
  assert.equal(sha(text), row.beforeSha256);
  for (const edit of row.edits) {
    assert.equal(text.split(edit.find).length, 2);
    text = text.replace(edit.find, edit.replace);
  }
  assert.equal(sha(text), row.afterSha256);
  return ts.createSourceFile(
    tree.fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
}
let patchedBus = patched(bus);
if (process.env.AGENT_NOTIFICATION_RECHECK_RED === "1") {
  patchedBus = ts.createSourceFile(
    bus.fileName,
    patchedBus.text.replaceAll(
      "              workbenchControl.captureAgentNotificationListeners(listeners);",
      "",
    ),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
}
const patchedLifecycle = patched(lifecycle);
const namespace = await mkdtemp(join(tmpdir(), "omoc-agent-notification-"));
await symlink(
  fileURLToPath(new URL("node_modules", root)),
  join(namespace, "node_modules"),
  "dir",
);
await copyPermissionControlSources(namespace);
const control = await import(
  pathToFileURL(join(namespace, "native-permission-control.mjs")).href
);
after(() => rm(namespace, { recursive: true, force: true }));
async function fixture({ service, currentBus = bus } = {}) {
  const calls = [];
  let captures = 0;
  const denied = () => {
    calls.push("forbidden");
    throw new Error("unexpected_physical_or_durable_effect");
  };
  class LocationService extends Context.Service()("test/Location") {}
  const deps = {
    Effect,
    workbenchControl: service && {
      captureAgentNotificationListeners(listeners) {
        const snapshot = service.captureAgentNotificationListeners(listeners);
        captures++;
        return snapshot;
      },
    },
    agentMetadataEvent2: agentEvent,
    Option,
    Clock,
    PubSub,
    live: await Effect.runPromise(PubSub.unbounded()),
    Location: { Service: LocationService },
    Event: { ID: { create: () => "evt_synthetic_agent" } },
    SessionEvent: {
      All: {
        cases: Object.fromEntries([...sessionTypes].map((type) => [type, {}])),
      },
    },
    db: new Proxy({}, { get: denied }),
    SessionTable: new Proxy({}, { get: denied }),
    eq: denied,
    AbsolutePath: { make: denied },
    InvalidDurableEventError2: class extends Error {},
    durableLocks: { withLock: denied },
    commitDurableEvent: denied,
    observe: denied,
  };
  const result = new Function(
    ...Object.keys(deps),
    `"use strict";
    const sessions = new Map(), routes = new WeakMap(), listeners = [];
    const pubsub = { typed: new Map(), live };
    const isSessionEvent = (${variable(bus, "isSessionEvent")});
    const prepareRoutes = (${variable(bus, "prepareRoutes")});
    ${fn("notify", currentBus)} ${fn("publishEvent", currentBus)} ${fn("publish", currentBus)}
    return { publish, pubsub, listeners };
  `,
  )(...Object.values(deps));
  const originalListener = new Function(
    "Effect",
    "isSessionEvent",
    "canonical3",
    "location",
    "project",
    "scope",
    service
      ? `
      var agentMetadataListeners2 = new WeakSet;
      ${fn("isAgentMetadataListener2", patchedLifecycle)}
      const lifecycleListener2 = (${variable(patchedLifecycle, "lifecycleListener2")});
      agentMetadataListeners2.add(lifecycleListener2);
      return { listener: lifecycleListener2, accepts: isAgentMetadataListener2 };
    `
      : `return (${listener});`,
  )(
    Effect,
    (event) => sessionTypes.has(event.type),
    denied,
    {},
    { activate: denied },
    undefined,
  );
  if (service) {
    assert.equal(variable(patchedLifecycle, "lifecycleListener2"), listener);
    service.bindAgentNotificationSource({
      accepts: originalListener.accepts,
      sourceSha256: sha(patchedLifecycle.text),
    });
    result.listeners.push(originalListener.listener);
  } else result.listeners.push(originalListener);
  const foreignListener = new Function(
    "Effect",
    "isSessionEvent",
    "canonical3",
    "location",
    "project",
    "scope",
    `return (${listener});`,
  )(
    Effect,
    (event) => sessionTypes.has(event.type),
    denied,
    {},
    { activate: denied },
    undefined,
  );
  return { ...result, calls, captures: () => captures, foreignListener };
}
test("original Agent notification bypasses Session routing and durable effects", async () => {
  const f = await fixture();
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const live = yield* PubSub.subscribe(f.pubsub.live);
        const typed = yield* PubSub.unbounded();
        f.pubsub.typed.set("agent.updated", typed);
        const typedEvents = yield* PubSub.subscribe(typed);
        const event = yield* f.publish(agentEvent, {});
        assert.equal(event.type, "agent.updated");
        assert.deepEqual(event.data, {});
        assert.equal(yield* PubSub.take(live), event);
        assert.equal(yield* PubSub.take(typedEvents), event);
        assert.deepEqual(f.calls, []);
        yield* PubSub.shutdown(typed);
      }),
    ),
  );
  await Effect.runPromise(PubSub.shutdown(f.pubsub.live));
});
test("Agent ephemeral event rejects a durable commit hook before routing", async () => {
  const f = await fixture();
  await assert.rejects(
    Effect.runPromise(
      f.publish(agentEvent, {}, { commit: () => assert.fail("must not run") }),
    ),
  );
  assert.deepEqual(f.calls, []);
  await Effect.runPromise(PubSub.shutdown(f.pubsub.live));
});
test("original Bus invokes arbitrary listeners: no blanket listener safety claim", async () => {
  const f = await fixture();
  f.listeners.push(() => Effect.fail(new Error("scripted_listener_refusal")));
  await assert.rejects(
    Effect.runPromise(f.publish(agentEvent, {})),
    /scripted_listener_refusal/u,
  );
  assert.deepEqual(f.calls, []);
  await Effect.runPromise(PubSub.shutdown(f.pubsub.live));
});

function withPatched(body) {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const service = yield* control.Service;
        const f = yield* Effect.promise(() =>
          fixture({ service, currentBus: patchedBus }),
        );
        try {
          yield* body(f, service);
        } finally {
          yield* PubSub.shutdown(f.pubsub.live);
        }
      }).pipe(
        Effect.provide(
          control.configured({
            runtimeEpoch: "agent_notice_test",
            bootHolds: [],
          }),
        ),
        Effect.timeout("5 seconds"),
      ),
    ),
  );
}
test("fixed Agent Bus uses original listener source and the same Control before metadata disclosure", async () => {
  await withPatched((f) =>
    Effect.gen(function* () {
      const live = yield* PubSub.subscribe(f.pubsub.live);
      const event = yield* f.publish(agentEvent, {});
      assert.equal(yield* PubSub.take(live), event);
      assert.deepEqual(f.calls, []);
    }),
  );
});
test("fixed Agent Bus refuses same-type substituted definition before listeners or publication", async () => {
  await withPatched((f) =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(f.publish({ ...agentEvent }, {}));
      assert.equal(exit._tag, "Failure");
      assert.deepEqual(f.calls, []);
    }),
  );
});
test("fixed Agent Bus refuses unknown, same-body foreign and proxy listeners before invocation", async () => {
  for (const scenario of ["unknown", "same-body", "proxy"]) {
    await withPatched((f) =>
      Effect.gen(function* () {
        let calls = 0;
        const unknown = () => {
          calls++;
          return Effect.void;
        };
        f.listeners.push(
          scenario === "same-body"
            ? f.foreignListener
            : scenario === "proxy"
              ? new Proxy(unknown, {
                  apply() {
                    calls++;
                    return Effect.void;
                  },
                })
              : unknown,
        );
        const exit = yield* Effect.exit(f.publish(agentEvent, {}));
        assert.equal(exit._tag, "Failure");
        assert.equal(calls, 0);
        assert.equal(f.captures(), 0);
        assert.deepEqual(f.calls, []);
      }),
    );
  }
});
test("fixed Agent Bus rejects late unknown listener on actual scheduler yield before constructing it", async () => {
  await withPatched((f) =>
    Effect.gen(function* () {
      let inserted = false,
        called = 0;
      // Use the same genuine Control; only record the synchronous capture seam.
      // The real budget scheduler inserts an unknown listener after first capture.
      const scheduler = new Scheduler.MixedScheduler();
      const shouldYield = scheduler.shouldYield.bind(scheduler);
      scheduler.shouldYield = (fiber) => {
        const result = shouldYield(fiber);
        if (result && f.captures() > 0 && !inserted) {
          inserted = true;
          f.listeners.push(() => {
            called++;
            return Effect.void;
          });
        }
        return result;
      };
      // A snapshot is deliberately large enough for a real cooperative yield;
      // each repeated callback remains the source-created original listener.
      f.listeners.push(...Array(30).fill(f.listeners[0]));
      const exit = yield* Effect.exit(
        f
          .publish(agentEvent, {})
          .pipe(
            Effect.provideService(Scheduler.MaxOpsBeforeYield, 16),
            Effect.provideService(Scheduler.Scheduler, scheduler),
          ),
      );
      assert.ok(f.captures() > 0);
      assert.equal(inserted, true);
      assert.equal(exit._tag, "Failure");
      assert.equal(called, 0);
    }),
  );
});
test("fixed Agent Bus refuses publication after Control closure", async () => {
  await withPatched((f, service) =>
    Effect.gen(function* () {
      yield* service.closeRoots();
      const exit = yield* Effect.exit(f.publish(agentEvent, {}));
      assert.equal(exit._tag, "Failure");
      assert.deepEqual(f.calls, []);
    }),
  );
});
