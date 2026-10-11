// Saved synthetic child: pinned production Tool/Permission/FileMutation only.
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, basename } from "node:path";
import { pathToFileURL } from "node:url";

let phase = "guard";
const cases = [];
const report = { schema_version: 1, result: "fail", cases };
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
try {
  assert.equal(process.argv.length, 4);
  const [root, resources] = process.argv.slice(2);
  assert.equal(globalThis.Bun?.version, "1.4.2");
  assert.equal(process.platform, "darwin");
  assert.equal(process.arch, "arm64");
  assert.equal(process.execPath, join(resources, "runtime/bun"));
  assert.match(basename(root), /^omoc-permission-tool-[A-Za-z0-9]+$/u);
  assert.equal(await fs.realpath(root), root);
  assert.equal(
    await fs.readFile(join(root, ".permission-probe-owned"), "utf8"),
    "synthetic permission probe v1\n",
  );
  for (const dir of [
    "",
    "home",
    "config",
    "data",
    "state",
    "cache",
    "tmp",
    "workspace",
  ]) {
    const path = join(root, dir),
      stat = await fs.lstat(path);
    assert.equal(await fs.realpath(path), path);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
    assert.equal(stat.uid, process.getuid());
    assert.equal(stat.mode & 0o077, 0);
  }
  assert.equal(process.env.HOME, join(root, "home"));
  assert.equal(process.env.XDG_DATA_HOME, join(root, "data"));
  assert.equal(process.env.XDG_CONFIG_HOME, join(root, "config"));
  const workspace = join(root, "workspace");
  assert.equal(process.cwd(), workspace);
  // No HTTP client is needed by this minimal graph. This is not an OS sandbox.
  globalThis.fetch = () => Promise.reject(new Error("probe_network_denied"));
  phase = "imports";
  const modules = join(resources, "node_modules");
  const pinned = (file) => import(pathToFileURL(join(modules, file)).href);
  const core = (name) => pinned(`@opencode/core/dist/${name}.js`);
  const util = (name) => pinned(`@opencode/util/dist/${name}.js`);
  const { Effect, Layer, Fiber, Exit } = await pinned("effect/dist/index.js");
  const { ChildProcessSpawner } = await pinned(
    "effect/dist/unstable/process/ChildProcessSpawner.js",
  );
  const { LayerNode } = await util("effect/layer-node");
  const { makeLocationNode } = await util("effect/app-node");
  const { CrossSpawnSpawner } = await util("cross-spawn-spawner");
  const { Global } = await util("global");
  const [
    { Tool },
    { Permission },
    { Agent },
    { Location },
    { Bus },
    { Database },
    { SessionStore },
    { SessionProjector },
    { SessionEvent },
    { SessionSchema },
    { SessionMessage },
    { FileAccess },
    { FileMutation },
    { Environment },
    { Formatter },
    { WriteTool },
    { upsertProject },
    { Slug },
  ] = await Promise.all(
    [
      "tool",
      "permission",
      "agent",
      "location",
      "bus",
      "database/database",
      "session/store",
      "session/projector",
      "session/event",
      "session/schema",
      "session/message",
      "file-access",
      "file-mutation",
      "environment/index",
      "formatter",
      "tool/plugin/write",
      "project/sql",
      "util/slug",
    ].map(core),
  );
  const { Project } = await pinned("@opencode/schema/dist/project.js");
  const { AbsolutePath } = await pinned("@opencode/schema/dist/schema.js");
  const directory = AbsolutePath.make(workspace);
  const projectID = Project.ID.make("permission-tool-probe");
  const location = {
    directory,
    project: { id: projectID, directory, canonical: directory },
  };
  // Real Native local filesystem driver, without Workspace connection/discovery.
  const localEnvironment = makeLocationNode({
    service: Environment.Service,
    layer: Layer.effect(
      Environment.Service,
      Effect.map(ChildProcessSpawner, (spawner) => ({
        files: Environment.makeFiles(Environment.makeLocalDriver(spawner)),
        spawner,
      })),
    ),
    deps: [CrossSpawnSpawner.node],
  });
  const layer = LayerNode.compile(
    LayerNode.group([
      Database.node,
      Bus.node,
      SessionStore.node,
      SessionProjector.node,
      Agent.node,
      Tool.node,
      Permission.node,
      FileAccess.node,
      FileMutation.node,
      Environment.node,
      Formatter.node,
    ]),
    {
      replacements: [
        Global.node.replace(
          Global.layerWith({
            home: join(root, "home"),
            data: join(root, "data"),
            config: join(root, "config"),
            state: join(root, "state"),
            cache: join(root, "cache"),
            tmp: join(root, "tmp"),
            bin: join(root, "cache/bin"),
            log: join(root, "data/log"),
            repos: join(root, "data/repos"),
          }),
        ),
        Database.node.replace(
          Database.configured({ path: join(root, "data/probe.sqlite") }),
        ),
        Bus.node.replace(Bus.configured({ persist: true })),
        Location.node.replace(Layer.succeed(Location.Service, location)),
        Environment.node.replace(localEnvironment),
      ],
    },
  );
  phase = "acquire";
  const resource = "permission-target.txt";
  const target = join(workspace, resource);
  const baseline = Buffer.from("synthetic-before-permission\n");
  const content = "synthetic-after-native-write\n";
  const program = Effect.gen(function* () {
    const { db } = yield* Database.Service;
    const bus = yield* Bus.Service;
    const store = yield* SessionStore.Service;
    const agents = yield* Agent.Service;
    const tools = yield* Tool.Service;
    const permissions = yield* Permission.Service;
    const agent = Agent.ID.make("permission-tool-probe");
    phase = "prepare";
    // Synthetic project/session preparation uses production functions and projector.
    // It does not verify Session.Service.create or the product startup path.
    yield* upsertProject(db, { id: projectID, canonical: directory });
    yield* agents.transform((editor) =>
      editor.update(agent, (entry) => {
        entry.permissions = [
          { action: "*", resource: "*", effect: "deny" },
          { action: "edit", resource, effect: "ask" },
        ];
      }),
    );
    const permissionExits = [];
    // Observe the real assertion's unmodified Exit before Tool.Error flattens it.
    // This observer makes no policy decision and performs no filesystem effect.
    const observedPermissions = {
      ...permissions,
      assert: (input) =>
        permissions.assert(input).pipe(
          Effect.onExit((exit) =>
            Effect.sync(() => {
              permissionExits.push(exit);
            }),
          ),
        ),
    };
    yield* WriteTool.Plugin.effect({
      tool: { transform: tools.transform },
    }).pipe(Effect.provideService(Permission.Service, observedPermissions));
    assert.deepEqual(
      (yield* tools.list()).map((item) => item.id),
      ["write"],
    );
    for (const mode of ["once", "reject", "policy_deny"]) {
      phase = mode;
      // Explicit setup reset. Expected tool bytes differ from baseline in ALL cases.
      yield* Effect.promise(() =>
        fs.writeFile(target, baseline, { mode: 0o600 }),
      );
      const before = yield* Effect.promise(() => fs.readFile(target));
      assert.ok(before.equals(baseline));
      const sessionID = SessionSchema.ID.create();
      const messageID = SessionMessage.ID.create();
      const callID = Tool.CallID.make(`call_${mode}`);
      yield* bus.publish(
        SessionEvent.Created,
        {
          sessionID,
          projectID,
          location: { directory },
          slug: Slug.create(),
          title: `permission-tool-${mode}`,
          agent,
          permissions: [
            {
              action: "edit",
              resource,
              effect: mode === "policy_deny" ? "deny" : "ask",
            },
          ],
          version: "2.0.18",
        },
        { location: { directory } },
      );
      const session = yield* store.get(sessionID);
      assert.equal(session?.id, sessionID);
      const snapshot = yield* tools.snapshot();
      assert.ok(snapshot.definitions.some((item) => item.name === "write"));
      const observedBefore = permissionExits.length;
      const fiber = yield* snapshot
        .execute({
          sessionID,
          agent,
          messageID,
          call: {
            id: callID,
            name: "write",
            input: { path: resource, content },
          },
        })
        .pipe(Effect.exit, Effect.forkScoped);
      let pendingSeen = false;
      if (mode !== "policy_deny") {
        const request = yield* Effect.gen(function* () {
          for (;;) {
            const pending = yield* permissions.forSession(sessionID);
            if (pending.length) {
              assert.equal(pending.length, 1);
              return pending[0];
            }
            assert.equal(fiber.pollUnsafe(), undefined);
            yield* Effect.sleep("10 millis");
          }
        }).pipe(Effect.timeout("2 seconds"));
        assert.equal(request.action, "edit");
        assert.deepEqual(request.resources, [resource]);
        assert.deepEqual(request.source, {
          type: "tool",
          messageID,
          id: callID,
        });
        assert.ok(
          (yield* Effect.promise(() => fs.readFile(target))).equals(before),
        );
        pendingSeen = true;
        yield* permissions.reply({ requestID: request.id, reply: mode });
      }
      const exit = yield* Fiber.join(fiber).pipe(Effect.timeout("3 seconds"));
      assert.equal(Exit.isSuccess(exit), mode === "once");
      assert.equal(permissionExits.length, observedBefore + 1);
      const assertion = permissionExits.at(-1);
      const expectedTag =
        mode === "policy_deny"
          ? "Permission.BlockedError"
          : "Permission.DeclinedError";
      if (mode === "once") assert.equal(Exit.isSuccess(assertion), true);
      else {
        assert.equal(Exit.isFailure(assertion), true);
        assert.ok(
          assertion.cause.reasons.some(
            (reason) => (reason.error ?? reason.defect)?._tag === expectedTag,
          ),
        );
      }
      const after = yield* Effect.promise(() => fs.readFile(target));
      assert.ok(
        after.equals(mode === "once" ? Buffer.from(content) : baseline),
      );
      assert.equal((yield* permissions.forSession(sessionID)).length, 0);
      assert.equal((yield* permissions.list()).length, 0);
      cases.push({
        name: mode,
        result: "pass",
        pendingSeen,
        beforeSha256: hash(before),
        afterSha256: hash(after),
        requestedSha256: hash(content),
        nativeAssertion: mode === "once" ? "success" : expectedTag,
        settled: true,
      });
    }
    yield* permissions.close;
  });
  await Effect.runPromise(Effect.scoped(program.pipe(Effect.provide(layer))));
  report.result = "pass";
  phase = "complete";
} catch (error) {
  report.error = "native_permission_probe_failed";
  report.failureKind = ["AssertionError", "TypeError", "SyntaxError"].includes(
    error?.name,
  )
    ? error.name
    : "Other";
  process.exitCode = 1;
} finally {
  report.phase = phase;
  writeFileSync(3, JSON.stringify(report));
}
