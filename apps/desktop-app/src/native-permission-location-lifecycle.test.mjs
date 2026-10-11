import { copyPermissionControlSources } from "../scripts/native-permission-test-fixture.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, test } from "node:test";
import { mkdtemp, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { NATIVE_PERMISSION_OVERLAY_RECIPE } from "./native-permission-overlay-contract.mjs";
import { planNativePermissionOverlay } from "../scripts/native-permission-overlay.mjs";
const namespace = await (
  await import("node:fs/promises")
).realpath(await mkdtemp(join(tmpdir(), "omoc-location-node-")));
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
await copyPermissionControlSources(namespace);
const Control = await import(
  pathToFileURL(join(namespace, "native-permission-control.mjs")).href
);
const {
  Effect,
  Cause,
  Context,
  Layer,
  LayerMap,
  MutableHashMap,
  Option,
  Duration,
  Exit,
  Scope,
  Deferred,
  Fiber,
} = await import(
  pathToFileURL(join(namespace, "node_modules/effect/dist/index.js")).href
);
const { Node: RealNode } = await import(
  pathToFileURL(
    join(namespace, "node_modules/@opencode/util/dist/effect/app-node.js"),
  ).href
);
after(() => rm(namespace, { recursive: true, force: true }));
for (const label of [
  "workspace",
  "failed",
  "partial",
  "one",
  "two",
  "interrupt",
  "overflow",
])
  await (
    await import("node:fs/promises")
  ).mkdir(join(namespace, "roots", label), { recursive: true });
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
const localCompilerPath =
  "node_modules/@opencode/util/dist/effect/layer-node.js";
const compilerOutput = outputs.find((x) => x.path === localCompilerPath);
await writeFile(
  join(namespace, "observed-layer-node.mjs"),
  compilerOutput.content
    .toString()
    .replace(
      'export * as LayerNode from "./layer-node.js";',
      'export * as LayerNode from "./observed-layer-node.mjs";',
    ),
);
const ObservedLayerNode = await import(
  pathToFileURL(join(namespace, "observed-layer-node.mjs")).href
);
async function source(name) {
  const path = `node_modules/@opencode/core/dist/chunks/${name}`;
  return (
    outputs.find((x) => x.path === path)?.content.toString("utf8") ??
    readFile(new URL(path, root), "utf8")
  );
}
const factorySource = await source("config-zs6xvgsc.js"),
  locationSource = await source("config-vyy061a2.js");
class MapService extends Context.Service()("location-node/Map") {}
class Lifecycle extends Context.Service()("location-node/Lifecycle") {}
class Location extends Context.Service()("location-node/Location") {}
class Project extends Context.Service()("location-node/Project") {}
class Instance extends Context.Service()("location-node/Instance") {}
const node = { replace: (value) => value };
function extracted(text, start, end, deps, result) {
  const a = text.indexOf(start),
    b = text.indexOf(end, a);
  assert.ok(a >= 0 && b > a);
  return new Function(
    ...Object.keys(deps),
    text.slice(a, b) + `\nreturn ${result};`,
  )(...Object.values(deps));
}
function factory(
  count,
  {
    fail = false,
    closeFail = false,
    onCandidate,
    onFinalizer,
    onBuilt,
    onGlobalBuild,
    control,
    compiled = false,
  } = {},
) {
  const bound = extracted(
    locationSource,
    "var layer = (ref, options)",
    "var boundNode2 =",
    {
      Effect,
      Layer,
      Service80: Location,
      Service81: Project,
      WorkbenchControl: Effect.map(Control.Service, (service) => ({
        ...service,
        locationProjectCandidate: (handle) =>
          Effect.gen(function* () {
            count.candidate++;
            if (onCandidate) yield* onCandidate();
            return yield* service.locationProjectCandidate(handle);
          }),
      })),
      LocationBuildScope: Control.LocationBuildScope,
    },
    "layer",
  );
  const nativeLayer = (ref) =>
    Layer.effect(
      Lifecycle,
      Effect.gen(function* () {
        count.build++;
        yield* Effect.addFinalizer(() =>
          (onFinalizer?.() ?? Effect.void).pipe(
            Effect.andThen(
              Effect.sync(() => {
                count.finalizer++;
                if (closeFail) throw new Error("synthetic_close_failed");
              }),
            ),
          ),
        );
        yield* Location;
        if (onBuilt) yield* onBuilt();
        if (fail)
          return yield* Effect.fail(new Error("synthetic_build_failed"));
        return {
          shutdown: Effect.sync(() => {
            count.shutdown++;
          }),
        };
      }),
    ).pipe(
      Layer.provideMerge(bound(ref, {})),
      Layer.provide(ProjectLayer(count)),
    );
  const global = compiled
    ? ObservedLayerNode.make({
        name: "test/global-control",
        tag: RealNode.tags.values.global,
        layer: Layer.effect(
          Control.Service,
          Effect.sync(() => {
            onGlobalBuild?.();
            return control;
          }),
        ),
        deps: [],
      })
    : undefined;
  const layer2 = (ref, options) => {
    if (!compiled) return nativeLayer(ref);
    const local = ObservedLayerNode.make({
      name: "test/local-location",
      tag: RealNode.tags.values.location,
      layer: nativeLayer(ref),
      deps: [global],
    });
    const instanceOutput = outputs
      .find((x) => x.path.endsWith("/config-ph8yj3s6.js"))
      .content.toString();
    const actualInstance = extracted(
      instanceOutput,
      "function layer2(ref, options = {})",
      "\nexport {",
      {
        performance: globalThis.performance,
        LayerNode: ObservedLayerNode,
        Node: RealNode,
        Layer,
        Effect,
        Context,
        graph2: local,
        vanillaReplacements: [],
        node84: ObservedLayerNode.unbound(
          Location,
          RealNode.tags.values.location,
        ),
        node5: ObservedLayerNode.unbound(
          Project,
          RealNode.tags.values.location,
        ),
        boundNode2: () => Layer.empty,
        bound2: () => Layer.empty,
        Service22: Lifecycle,
      },
      "layer2",
    );
    return actualInstance(ref, { ...options, replacements: [] });
  };
  return extracted(
    factorySource,
    "function buildLocationServiceMap2",
    "\nexport {",
    {
      Effect,
      Context,
      Layer,
      LayerMap,
      MutableHashMap,
      Option,
      Duration,
      Exit,
      Scope,
      Service52: MapService,
      Service22: Lifecycle,
      Service47: Instance,
      node49: node,
      node54: node,
      canonical3: (ref) => ref,
      layer2,
      WorkbenchControl: Control.Service,
      LocationBuildScope: Control.LocationBuildScope,
    },
    "buildLocationServiceMap2",
  )();
}
function ProjectLayer(count) {
  return Layer.succeed(Project, {
    resolve: (directory) =>
      Effect.sync(() => {
        count.resolve++;
        return { id: "unexpected-project", directory, canonical: directory };
      }),
  });
}
const counters = () => ({
  build: 0,
  resolve: 0,
  candidate: 0,
  shutdown: 0,
  finalizer: 0,
});
async function run(body) {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* body(yield* Control.Service);
      }),
    ).pipe(
      Effect.provide(
        Control.configured({ runtimeEpoch: "location-node", bootHolds: [] }),
      ),
      Effect.timeout("5 seconds"),
    ),
  );
}
// Each NON-VCS directory has its actual Native SHA1 project identity. This
// test-only aggregate reads every known synthetic project under one real gate.
const projectIds = [
  "workspace",
  "failed",
  "partial",
  "one",
  "two",
  "interrupt",
  "overflow",
].map((label) =>
  createHash("sha1")
    .update(`directory:${join(namespace, "roots", label)}`)
    .digest("hex"),
);
const snapshot = (control) =>
  control.transaction(projectIds, (tx) =>
    Effect.map(
      Effect.all(projectIds.map((id) => control.locationSnapshot(tx, id))),
      (rows) => ({
        generation: rows[0].generation,
        unknownBuilding: rows[0].unknownBuilding,
        incomplete: rows.some((row) => row.incomplete),
        locations: rows
          .flatMap((row) => row.locations)
          .sort((a, b) => a.incarnation - b.incarnation),
      }),
    ),
  );

test("actual cache factory registers resolved ready location and retains finalizing on invalidate", async () => {
  await run((control) =>
    Effect.gen(function* () {
      const count = counters();
      const mapContext = yield* Layer.build(factory(count));
      const map = Context.get(mapContext, MapService);
      const ref = { directory: join(namespace, "roots", "workspace") };
      yield* map.contextEffect(ref);
      const ready = yield* snapshot(control);
      assert.equal(ready.locations.length, 1);
      assert.equal(ready.locations[0].state, "ready");
      assert.equal(ready.unknownBuilding, 0);
      yield* map.invalidate(ref);
      const finalizing = yield* snapshot(control);
      assert.equal(finalizing.locations.length, 1);
      assert.equal(finalizing.locations[0].state, "finalizing");
      assert.equal(finalizing.incomplete, true);
      assert.equal(count.shutdown, 1);
    }),
  );
});

test("actual failed Native build retains unproved incarnation instead of dropping context", async () => {
  await run((control) =>
    Effect.gen(function* () {
      const count = counters();
      const map = Context.get(
        yield* Layer.build(factory(count, { fail: true })),
        MapService,
      );
      assert.ok(
        Exit.isFailure(
          yield* Effect.exit(
            map.contextEffect({
              directory: join(namespace, "roots", "failed"),
            }),
          ),
        ),
      );
      const value = yield* snapshot(control);
      assert.equal(value.locations.length, 1);
      assert.equal(value.locations[0].state, "finalizing");
      assert.equal(value.incomplete, true);
    }),
  );
});

test("actual candidate observation sees unknown build before its first IO and holds no project lock", async () => {
  await run((control) =>
    Effect.gen(function* () {
      let observed = false;
      const count = counters();
      const onCandidate = () =>
        Effect.gen(function* () {
          const value = yield* snapshot(control);
          assert.equal(value.unknownBuilding, 1);
          assert.equal(value.incomplete, true);
          yield* control.transaction(["independent"], () => Effect.void);
          observed = true;
        });
      const map = Context.get(
        yield* Layer.build(factory(count, { onCandidate })),
        MapService,
      );
      yield* map.contextEffect({
        directory: join(namespace, "roots", "workspace"),
      });
      assert.equal(observed, true);
    }),
  );
});

for (const closeFail of [false, true])
  test(`actual owner scope close retains unproved finalizing entry (finalizer failure=${closeFail})`, async () => {
    await run((control) =>
      Effect.gen(function* () {
        const owner = yield* Scope.make();
        const count = counters();
        let sawFinalizing = false;
        const onFinalizer = () =>
          Effect.gen(function* () {
            const value = yield* snapshot(control);
            assert.equal(value.locations[0].state, "finalizing");
            sawFinalizing = true;
          });
        const map = Context.get(
          yield* Layer.build(factory(count, { closeFail, onFinalizer })).pipe(
            Effect.provideService(Scope.Scope, owner),
          ),
          MapService,
        );
        yield* map.contextEffect({
          directory: join(namespace, "roots", "workspace"),
        });
        yield* Effect.exit(Scope.close(owner, Exit.void));
        const retained = yield* snapshot(control);
        assert.equal(sawFinalizing, true);
        assert.equal(retained.locations.length, 1);
        assert.equal(retained.locations[0].state, "finalizing");
        assert.equal(retained.locations[0].scopeObserved, true);
        assert.equal(retained.incomplete, true);
      }),
    );
  });

test("actual cache hit reuses incarnation; invalidated replacement never erases old one", async () => {
  await run((control) =>
    Effect.gen(function* () {
      const count = counters(),
        ref = { directory: join(namespace, "roots", "workspace") };
      const map = Context.get(yield* Layer.build(factory(count)), MapService);
      yield* map.contextEffect(ref);
      yield* map.contextEffect(ref);
      assert.equal(count.resolve, 0);
      assert.equal(count.candidate, 1);
      yield* map.invalidate(ref);
      yield* map.contextEffect(ref);
      const value = yield* snapshot(control);
      assert.equal(count.resolve, 0);
      assert.equal(count.candidate, 2);
      assert.equal(value.locations.length, 2);
      assert.equal(
        value.locations.filter((x) => x.state === "ready").length,
        1,
      );
      assert.equal(value.incomplete, true);
    }),
  );
});

test("actual AppNodeBuilder replacement declares Control before constructing location map", async () => {
  const { LayerNode } = await import(
    pathToFileURL(
      join(namespace, "node_modules/@opencode/util/dist/effect/layer-node.js"),
    ).href
  );
  const { makeGlobalNode, Node } = await import(
    pathToFileURL(
      join(namespace, "node_modules/@opencode/util/dist/effect/app-node.js"),
    ).href
  );
  const path = "node_modules/@opencode/core/dist/effect/app-node-builder.js";
  const text =
    outputs.find((x) => x.path === path)?.content.toString("utf8") ??
    (await readFile(new URL(path, root), "utf8"));
  const node54 = LayerNode.unbound(MapService, Node.tags.values.global),
    node49 = LayerNode.unbound(Instance, Node.tags.values.global);
  const instances = makeGlobalNode({
    service: Instance,
    layer: Layer.succeed(Instance, {}),
    deps: [],
  });
  const count = counters();
  const build = extracted(
    text,
    "function build(root, replacements",
    "\nexport {",
    {
      LayerNode,
      makeGlobalNode,
      Service52: MapService,
      node54,
      node49,
      instances,
      buildLocationServiceMap2: () => factory(count),
      workbenchControlNode: Control.node,
    },
    "build",
  );
  class Probe extends Context.Service()("location-node/BuilderProbe") {}
  const entry = makeGlobalNode({
    service: Probe,
    layer: Layer.effect(
      Probe,
      Effect.map(MapService, (map) => ({ map })),
    ),
    deps: [node54],
  });
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const probe = yield* Probe;
        yield* probe.map.contextEffect({
          directory: join(namespace, "roots", "workspace"),
        });
        assert.equal(count.resolve, 0);
        assert.equal(count.candidate, 1);
      }),
    ).pipe(
      Effect.provide(
        build(entry, [
          Control.node.replace(
            Control.configured({ runtimeEpoch: "builder-node", bootHolds: [] }),
          ),
        ]),
      ),
      Effect.timeout("5 seconds"),
    ),
  );
});

test("actual invalidation during unresolved build cannot publish late ready context", async () => {
  await run((control) =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make(),
        release = yield* Deferred.make();
      const count = counters();
      const onCandidate = () =>
        Deferred.succeed(entered, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
        );
      const map = Context.get(
          yield* Layer.build(factory(count, { onCandidate })),
          MapService,
        ),
        ref = { directory: join(namespace, "roots", "workspace") };
      const pending = yield* Effect.forkChild(map.contextEffect(ref));
      yield* Deferred.await(entered);
      yield* map.invalidate(ref);
      yield* Deferred.succeed(release, undefined);
      const exit = yield* Fiber.await(pending);
      assert.ok(Exit.isFailure(exit));
      const value = yield* snapshot(control);
      assert.equal(value.unknownBuilding, 1);
      assert.equal(value.locations.length, 0);
      assert.equal(value.incomplete, true);
      assert.equal(count.build, 0);
    }),
  );
});
test("actual registration capacity failure blocks before candidate observation and invalidates graph", async () => {
  await run((control) =>
    Effect.gen(function* () {
      for (let i = 0; i < 32; i++)
        yield* control.locationBegin({ directory: `/retained-${i}` });
      const count = counters(),
        map = Context.get(yield* Layer.build(factory(count)), MapService);
      assert.ok(
        Exit.isFailure(
          yield* Effect.exit(
            map.contextEffect({
              directory: join(namespace, "roots", "overflow"),
            }),
          ),
        ),
      );
      assert.deepEqual(count, counters());
      const status = yield* control.transaction(["project"], (tx) =>
        control.inspect(tx, "project"),
      );
      assert.equal(status.runtimeHeld, true);
    }),
  );
});

test("partial Native Layer failure marks finalizing before acquired service cleanup", async () => {
  await run((control) =>
    Effect.gen(function* () {
      let stateDuringCleanup;
      const onFinalizer = () =>
        Effect.gen(function* () {
          stateDuringCleanup = (yield* snapshot(control)).locations[0]?.state;
        });
      const count = counters(),
        map = Context.get(
          yield* Layer.build(
            factory(count, {
              fail: true,
              onFinalizer,
              control,
              compiled: true,
            }),
          ),
          MapService,
        );
      const exit = yield* Effect.exit(
        map.contextEffect({ directory: join(namespace, "roots", "partial") }),
      );
      assert.ok(Exit.isFailure(exit));
      assert.equal(count.finalizer, 1, Cause.pretty(exit.cause));
      assert.equal(stateDuringCleanup, "finalizing");
    }),
  );
});

test("actual compiled local cache preserves shared service reuse across location incarnations", async () => {
  await run((control) =>
    Effect.gen(function* () {
      let globals = 0;
      const count = counters();
      const map = Context.get(
        yield* Layer.build(
          factory(count, {
            compiled: true,
            control,
            onGlobalBuild: () => globals++,
          }),
        ),
        MapService,
      );
      yield* map.contextEffect({ directory: join(namespace, "roots", "one") });
      yield* map.contextEffect({ directory: join(namespace, "roots", "two") });
      assert.equal(globals, 1);
      assert.equal(count.build, 2);
      const value = yield* snapshot(control);
      assert.equal(value.locations.length, 2);
      assert.ok(value.locations.every((x) => x.state === "ready"));
    }),
  );
});
test("actual compiled local interruption records finalizing before acquired finalizer", async () => {
  await run((control) =>
    Effect.gen(function* () {
      let observed;
      const count = counters(),
        map = Context.get(
          yield* Layer.build(
            factory(count, {
              compiled: true,
              control,
              onBuilt: () => Effect.interrupt,
              onFinalizer: () =>
                snapshot(control).pipe(
                  Effect.tap((value) =>
                    Effect.sync(() => {
                      observed = value.locations[0]?.state;
                    }),
                  ),
                ),
            }),
          ),
          MapService,
        );
      const exit = yield* Effect.exit(
        map.contextEffect({ directory: join(namespace, "roots", "interrupt") }),
      );
      assert.ok(Exit.isFailure(exit));
      assert.ok(Cause.hasInterruptsOnly(exit.cause));
      assert.equal(count.finalizer, 1);
      assert.equal(observed, "finalizing");
    }),
  );
});

test("actual Native Location layer consumes checked candidate metadata without Project.resolve or fallback", async () => {
  const candidate = {
    id: "checked-nonvcs-project",
    directory: "/synthetic/checked",
    canonical: "/synthetic/checked",
    vcs: undefined,
  };
  const layer = extracted(
    locationSource,
    "var layer = (ref, options)",
    "var boundNode2 =",
    {
      Effect,
      Layer,
      Service80: Location,
      Service81: Project,
      WorkbenchControl: Control.Service,
      LocationBuildScope: Control.LocationBuildScope,
    },
    "layer",
  );
  for (const denied of [false, true]) {
    let resolutions = 0,
      candidates = 0;
    const program = Effect.scoped(
      Layer.build(layer({ directory: candidate.directory }, {})),
    ).pipe(
      Effect.provideService(Control.Service, {
        locationProjectCandidate: () => {
          candidates++;
          return denied
            ? Effect.fail(Error("candidate_denied"))
            : Effect.succeed(candidate);
        },
        locationBind: () => Effect.void,
      }),
      Effect.provideService(Control.LocationBuildScope, Object.freeze({})),
      Effect.provideService(Project, {
        resolve: () =>
          Effect.sync(() => {
            resolutions++;
            return candidate;
          }),
      }),
    );
    const result = await Effect.runPromise(Effect.exit(program));
    assert.equal(
      resolutions,
      0,
      "readonly Location binding cannot invoke mutating Project.resolve",
    );
    assert.equal(candidates, 1);
    if (denied) assert.ok(Exit.isFailure(result));
    else
      assert.equal(
        Context.get(result.value, Location).project.id,
        candidate.id,
      );
  }
});
