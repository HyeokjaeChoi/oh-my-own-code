import assert from "node:assert/strict";
import { after, test } from "node:test";
import { copyFile, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { NATIVE_PERMISSION_OVERLAY_RECIPE } from "./native-permission-overlay-contract.mjs";
import { planNativePermissionOverlay } from "../scripts/native-permission-overlay.mjs";

const namespace = await mkdtemp(join(tmpdir(), "omoc-tool-entry-node-"));
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
  "wire-id.mjs",
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
const Admission = await import(
  pathToFileURL(join(namespace, "native-permission-coordinator-admission.mjs"))
    .href
);
const { Effect, Context, Layer, Exit } = await import(
  pathToFileURL(join(namespace, "node_modules/effect/dist/index.js")).href
);
after(() => rm(namespace, { recursive: true, force: true }));
const root = new URL(
  "../runtime-event-host/.generated/install/",
  import.meta.url,
);
const inputs = await Promise.all(
  NATIVE_PERMISSION_OVERLAY_RECIPE.files.map(async ({ path }) => ({
    path,
    content: await readFile(new URL(path, root)),
  })),
);
const outputs = planNativePermissionOverlay(
  NATIVE_PERMISSION_OVERLAY_RECIPE,
  inputs,
).files;
async function source(name) {
  const path = `node_modules/@opencode/core/dist/chunks/${name}`;
  return (
    outputs.find((entry) => entry.path === path)?.content.toString("utf8") ??
    readFile(new URL(path, root), "utf8")
  );
}
const raw = await source("config-3w5fmr99.js");
const toolSource = await source("config-yw6qsgb4.js");
class Store extends Context.Service()("node-tool/Store") {}
class Hooks extends Context.Service()("node-tool/Hooks") {}
class Image extends Context.Service()("node-tool/Image") {}
class Location extends Context.Service()("node-tool/Location") {}
class Tools extends Context.Service()("node-tool/Tools") {}
const row = () => ({
  id: "session",
  projectID: "project",
  location: { directory: "/checked/workspace" },
});
function extracted(text, start, end, deps, result) {
  const a = text.indexOf(start),
    b = text.indexOf(end, a);
  assert.ok(a >= 0 && b > a);
  return new Function(
    ...Object.keys(deps),
    text.slice(a, b) + `\nreturn ${result};`,
  )(...Object.values(deps));
}
const counters = () => ({
  decode: 0,
  execute: 0,
  encode: 0,
  hook: 0,
  schema: 0,
  catalog: 0,
  image: 0,
  progress: 0,
});
function rawExecution(count) {
  return extracted(
    raw,
    "var execute3 =",
    "var decodeInput =",
    {
      Effect,
      WorkbenchControl: Control.Service,
      WorkbenchSessionStore: Store,
      createCoordinatorAdmission: Admission.createCoordinatorAdmission,
      toolSessionID: Admission.toolSessionID,
      decodeInput: (_tool, input) =>
        Effect.sync(() => {
          count.decode++;
          return input;
        }),
      encodeOutput: (_schema, value) =>
        Effect.sync(() => {
          count.encode++;
          return value;
        }),
      normalizeContent2: (content) => content,
      Tool: { Error: class extends Error {} },
    },
    "execute3",
  );
}
function toolLayer(count, execute3, registerNested) {
  return extracted(
    toolSource,
    "var layer = Layer.effect",
    "var whollyDisabled =",
    {
      Effect,
      Layer,
      Service59: Tools,
      Service61: Hooks,
      Service60: Image,
      WorkbenchControl: Control.Service,
      WorkbenchSessionStore: Store,
      WorkbenchLocation: Location,
      createCoordinatorAdmission: Admission.createCoordinatorAdmission,
      toolSessionID: Admission.toolSessionID,
      execute3,
      normalizeContent2: (content) => content,
      create3: () => ({
        get: () => ({
          tools: new Map([
            ["direct", { name: "direct", options: { codemode: false } }],
            ["nested", { name: "nested" }],
          ]),
          namespaces: new Map(),
        }),
        transform: () => Effect.void,
        reload: () => Effect.void,
      }),
      create2: (_inventory, callback) => {
        registerNested(callback);
        return { name: "execute" };
      },
      catalog2: () => {
        count.catalog++;
        return {};
      },
      definition2: (tool) => {
        count.schema++;
        return { name: tool.name };
      },
      whollyDisabled: () => false,
      Tool: {
        CallID: { make: (value) => value },
        Error: class extends Error {},
      },
    },
    "layer",
  );
}
async function run(body, { missing = false, storeGet = row, scopeCheck } = {}) {
  let program = Effect.scoped(
    Effect.gen(function* () {
      const original = yield* Control.Service;
      const control = {
        ...original,
        assertExecution: (tx, id) =>
          scopeCheck?.() === true
            ? Effect.void
            : original.assertExecution(tx, id),
      };
      return yield* body(control).pipe(
        Effect.provideService(Control.Service, control),
      );
    }),
  ).pipe(
    Effect.provide(
      Control.configured({ runtimeEpoch: "epoch", bootHolds: [] }),
    ),
  );
  if (!missing)
    program = program.pipe(
      Effect.provideService(Store, { get: () => Effect.sync(storeGet) }),
    );
  return Effect.runPromiseExit(program);
}
function refused(exit, message) {
  assert.ok(Exit.isFailure(exit));
  if (message)
    assert.ok(
      exit.cause.reasons.some((reason) => reason.error?.message === message),
      String(exit.cause),
    );
}
const context = () => ({
  sessionID: "session",
  agent: "agent",
  messageID: "message",
  id: "call",
  progress: () => Effect.void,
});
const call = () => ({
  sessionID: "session",
  agent: "agent",
  messageID: "message",
  call: { id: "call", name: "direct", input: {} },
});

test("held raw actual execute refuses before decode, tool callback and output schema", async () => {
  const count = counters(),
    execute = rawExecution(count);
  const tool = {
    output: {},
    execute: () =>
      Effect.sync(() => {
        count.execute++;
        return { output: {}, content: [] };
      }),
  };
  refused(
    await run(() => execute(tool, {}, context())),
    "native_permission_held",
  );
  assert.deepEqual(count, counters());
});

test("held actual Tool.snapshot refuses before catalog and definition schema callbacks", async () => {
  const count = counters();
  const layer = toolLayer(count, rawExecution(count), () => {});
  const exit = await run(() =>
    Effect.gen(function* () {
      const tools = yield* Tools;
      yield* tools.snapshot();
    }).pipe(
      Effect.provide(layer),
      Effect.provideService(Hooks, {
        trigger: () =>
          Effect.sync(() => {
            count.hook++;
            return {};
          }),
      }),
      Effect.provideService(Image, {
        normalize: () =>
          Effect.sync(() => {
            count.image++;
          }),
      }),
      Effect.provideService(Location, { project: { id: "project" } }),
    ),
  );
  refused(exit, "native_permission_held");
  assert.deepEqual(count, counters());
});

for (const mode of ["direct", "nested", "direct-accessor"])
  test(`held actual ${mode} entry refuses before hook construction`, async () => {
    const count = counters();
    let accessorCalls = 0;
    let nested,
      allow = true;
    const layer = toolLayer(count, rawExecution(count), (callback) => {
      nested = callback;
    });
    const exit = await run(
      () =>
        Effect.gen(function* () {
          const tools = yield* Tools;
          const snapshot = yield* tools.snapshot();
          allow = false;
          Object.assign(count, counters());
          if (mode.startsWith("direct")) {
            const input = call();
            if (mode === "direct-accessor")
              Object.defineProperty(input, "call", {
                enumerable: true,
                get() {
                  accessorCalls++;
                  return { id: "call", name: "direct", input: {} };
                },
              });
            yield* snapshot.execute(input);
          } else yield* nested("nested", {}, {}, context());
        }).pipe(
          Effect.provide(layer),
          Effect.provideService(Hooks, {
            trigger: (_domain, _event, value) => {
              count.hook++;
              return Effect.succeed(value);
            },
          }),
          Effect.provideService(Image, {}),
          Effect.provideService(Location, { project: { id: "project" } }),
        ),
      { scopeCheck: () => allow },
    );
    refused(exit, "native_permission_held");
    assert.equal(accessorCalls, 0);
    assert.deepEqual(count, counters());
  });

test("raw entry with missing store service cannot call schema or callback", async () => {
  const count = counters();
  refused(
    await run(
      () =>
        rawExecution(count)(
          {
            execute: () =>
              Effect.sync(() => {
                count.execute++;
                return { content: [] };
              }),
          },
          {},
          context(),
        ),
      { missing: true },
    ),
  );
  assert.deepEqual(count, counters());
});

for (const kind of ["accessor", "proxy", "missing", "mismatch", "changed"])
  test(`raw actual execution refuses ${kind} scope without callback access`, async () => {
    const count = counters();
    let traps = 0,
      gets = 0;
    const ctx =
      kind === "accessor"
        ? Object.defineProperty({}, "sessionID", {
            enumerable: true,
            get() {
              traps++;
              return "session";
            },
          })
        : kind === "proxy"
          ? new Proxy(context(), {
              getOwnPropertyDescriptor() {
                traps++;
                throw new Error("trap");
              },
            })
          : kind === "missing"
            ? {}
            : context();
    const tool = new Proxy(
      {},
      {
        get() {
          traps++;
          throw new Error("tool access");
        },
      },
    );
    const storeGet = () => {
      gets++;
      return kind === "mismatch"
        ? { ...row(), id: "foreign" }
        : kind === "changed" && gets > 1
          ? { ...row(), projectID: "changed" }
          : row();
    };
    refused(await run(() => rawExecution(count)(tool, {}, ctx), { storeGet }));
    assert.equal(traps, 0);
    assert.deepEqual(count, counters());
  });

test("raw Tool guard does not hold project gate across callback effects", async () => {
  const count = counters();
  const exit = await run(
    (control) =>
      rawExecution(count)(
        {
          execute: () =>
            control.transaction(["project"], () =>
              Effect.sync(() => {
                count.execute++;
                return { content: [] };
              }),
            ),
        },
        {},
        context(),
      ),
    { scopeCheck: () => true },
  );
  assert.ok(Exit.isSuccess(exit));
  assert.equal(count.execute, 1);
  assert.equal(count.decode, 1);
});
