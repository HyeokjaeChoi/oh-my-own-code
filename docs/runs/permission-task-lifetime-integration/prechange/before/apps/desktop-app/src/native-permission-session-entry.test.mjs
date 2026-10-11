import assert from "node:assert/strict";
import { after, test } from "node:test";
import { copyFile, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { NATIVE_PERMISSION_OVERLAY_RECIPE } from "./native-permission-overlay-contract.mjs";
import { planNativePermissionOverlay } from "../scripts/native-permission-overlay.mjs";

const namespace = await mkdtemp(join(tmpdir(), "omoc-session-entry-node-"));
await symlink(
  fileURLToPath(
    new URL(
      "../runtime-event-host/.generated/install/node_modules",
      import.meta.url,
    ),
  ),
  join(namespace, "node_modules"),
  "dir",
);
for (const name of [
  "native-permission-control.mjs",
  "native-permission-control-input.mjs",
  "native-permission-leases.mjs",
  "native-permission-origin-scopes.mjs",
  "permission-control-canonical.mjs",
  "native-permission-task-observer.mjs",
  "native-permission-coordinator-admission.mjs",
])
  await copyFile(new URL(`./${name}`, import.meta.url), join(namespace, name));
const Control = await import(
  pathToFileURL(join(namespace, "native-permission-control.mjs")).href
);
const { createCoordinatorAdmission } = await import(
  pathToFileURL(join(namespace, "native-permission-coordinator-admission.mjs"))
    .href
);
const { Effect, Context, Scope, DateTime, Fiber, Exit } = await import(
  pathToFileURL(join(namespace, "node_modules/effect/dist/index.js")).href
);
after(() => rm(namespace, { recursive: true, force: true }));
const originalRoot = new URL(
  "../runtime-event-host/.generated/install/",
  import.meta.url,
);
const chunk = (name) => `node_modules/@opencode/core/dist/chunks/${name}`;
const input = await Promise.all(
  NATIVE_PERMISSION_OVERLAY_RECIPE.files.map(async ({ path }) => ({
    path,
    content: await readFile(new URL(path, originalRoot)),
  })),
);
const outputs = planNativePermissionOverlay(
  NATIVE_PERMISSION_OVERLAY_RECIPE,
  input,
).files;
async function checkedSource(name) {
  const path = chunk(name);
  const output = outputs.find((entry) => entry.path === path);
  return output
    ? output.content.toString("utf8")
    : readFile(new URL(path, originalRoot), "utf8");
}
const source = await checkedSource("config-9qsysn39.js");
const start = source.indexOf('var make15 = Effect.fn("Session.make")');
const end = source.indexOf("\nexport {", start);
assert.ok(start >= 0 && end > start);
// Exact Native function, with explicit inert dependency stand-ins under Node.
// No Native imports, SQL, filesystem preparation, provider or shell is run.
const tags = Object.fromEntries(
  [
    "Service83",
    "Service84",
    "Service50",
    "Service47",
    "Service44",
    "Service46",
  ].map((name) => [
    name,
    class extends Context.Service()(`node-session/${name}`) {},
  ]),
);
class FS extends Context.Service()("node-session/FS") {}
const row = () => ({
  id: "session",
  projectID: "project",
  location: { directory: "/checked/workspace" },
  time: {},
});
function factory(count) {
  const deps = {
    Effect,
    Scope,
    DateTime,
    Fiber,
    ...tags,
    FSUtil: { Service: FS },
    WorkbenchControl: Control.Service,
    createCoordinatorAdmission,
    prepare2: () =>
      Effect.sync(() => {
        count.prepare++;
        return { type: "user" };
      }),
    SessionMessage2: { ID: { create: () => "message" } },
    SessionEvent2: new Proxy({}, { get: (_target, key) => key }),
  };
  return new Function(
    ...Object.keys(deps),
    source.slice(start, end) + "\nreturn make15;",
  )(...Object.values(deps));
}
const held = (exit) => {
  assert.ok(Exit.isFailure(exit));
  assert.ok(
    exit.cause.reasons.some(
      (reason) =>
        reason._tag === "Fail" &&
        reason.error?.message === "native_permission_held",
    ),
  );
};
async function run(body) {
  const count = { prepare: 0, mutation: 0 };
  const store = {
    get: () => Effect.sync(row),
    message: () => Effect.succeed(undefined),
  };
  const mutate = () =>
    Effect.sync(() => {
      count.mutation++;
      return { id: "inbox" };
    });
  const services = {
    Service83: { publish: mutate },
    Service84: {},
    Service50: store,
    Service47: {},
    Service44: {
      wake: mutate,
      resume: mutate,
      awaitIdle: () => Effect.void,
      interrupt: () => Effect.succeed(false),
    },
    Service46: {
      reconcile: () => Effect.succeed(undefined),
      admit: mutate,
      list: () => Effect.succeed([]),
      cancel: mutate,
      steer: mutate,
      queue: mutate,
      admitCompaction: mutate,
    },
  };
  let program = Effect.scoped(
    Effect.gen(function* () {
      const sessions = yield* factory(count)();
      yield* body(sessions.forSession("session"), count);
    }),
  );
  for (const [name, value] of Object.entries(services))
    program = program.pipe(Effect.provideService(tags[name], value));
  program = program.pipe(
    Effect.provideService(FS, {}),
    Effect.provide(
      Control.configured({ runtimeEpoch: "entry-node", bootHolds: [] }),
    ),
    Effect.timeout("5 seconds"),
  );
  await Effect.runPromise(program);
}

test("actual checked Native prompt refuses before preparation and admission", async () => {
  await run((session, count) =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        session.prompt({ id: "message", text: "synthetic", resume: false }),
      );
      assert.equal(
        count.prepare,
        0,
        "Native preparation must not run while boot-held",
      );
      assert.equal(
        count.mutation,
        0,
        "Native inbox admission must not run while boot-held",
      );
      held(exit);
      assert.deepEqual(count, { prepare: 0, mutation: 0 });
    }),
  );
});

test("actual checked existing-session mutation methods all refuse before original callbacks", async () => {
  const cases = [
    ["view", { idle: 0 }],
    ["rename", { title: "synthetic" }],
    ["setMetadata", { metadata: {} }],
    ["setPermissions", { permissions: [] }],
    ["switchAgent", { agent: "synthetic" }],
    ["switchModel", { model: { providerID: "synthetic", id: "synthetic" } }],
    ["synthetic", { text: "synthetic", resume: false }],
    ["shell", { command: "must-not-run" }],
    ["skill", { skill: "must-not-load" }],
    ["compact", {}],
    ["resume"],
    ["cancelInbox", "inbox"],
    ["steerInbox", "inbox"],
    ["queueInbox", "inbox"],
  ];
  await run((session, count) =>
    Effect.gen(function* () {
      for (const [method, arg] of cases)
        held(yield* Effect.exit(session[method](arg)));
      held(
        yield* Effect.exit(
          session.revert.stage({ messageID: "message", files: [] }),
        ),
      );
      held(yield* Effect.exit(session.revert.clear()));
      held(yield* Effect.exit(session.revert.commit()));
      assert.deepEqual(count, { prepare: 0, mutation: 0 });
    }),
  );
});

test("held sessions retain read-only access and cancellation intent", async () => {
  await run((session, count) =>
    Effect.gen(function* () {
      assert.deepEqual(yield* session.get(), row());
      assert.deepEqual(yield* session.inbox(), []);
      assert.equal(yield* session.message("absent"), undefined);
      yield* session.wait();
      assert.equal(yield* session.interrupt({ reason: "user" }), false);
      assert.deepEqual(count, { prepare: 0, mutation: 0 });
    }),
  );
});

test("actual checked direct SessionShell refuses before Instance or Shell acquisition", async () => {
  const text = await checkedSource("config-kyw5qrb7.js");
  const begin = text.indexOf('var start2 = Effect.fn("SessionShell.start")');
  const finish = text.indexOf("\nexport {", begin);
  assert.ok(begin >= 0 && finish > begin);
  const deps = {
    Effect,
    WorkbenchControl: Control.Service,
    WorkbenchSessionStore: tags.Service50,
    createCoordinatorAdmission,
    Service47: tags.Service47,
  };
  const startShell = new Function(
    ...Object.keys(deps),
    text.slice(begin, finish) + "\nreturn start2;",
  )(...Object.values(deps));
  let reads = 0;
  const store = {
    get: (id) =>
      Effect.sync(() => {
        assert.equal(id, "session");
        reads++;
        return row();
      }),
  };
  // Deliberately no Instance or Shell service. Missing gates would fail with a
  // different error instead of the actual shared Control's held refusal.
  const exit = await Effect.runPromise(
    Effect.exit(
      startShell({
        session: { id: "session", location: { directory: "/must-not-use" } },
        command: "must-not-execute",
      }),
    ).pipe(
      Effect.provideService(tags.Service50, store),
      Effect.provide(
        Control.configured({ runtimeEpoch: "entry-shell-node", bootHolds: [] }),
      ),
      Effect.timeout("5 seconds"),
    ),
  );
  held(exit);
  assert.equal(reads, 2);
});
