// Auth-free saved canary. Uses the production graph factory and pinned engine.
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { PassThrough } from "node:stream";

const report = {
  schema_version: 1,
  result: "fail",
  phase: "guard",
  cases: [
    "overlay_forwarding",
    "fixed_config",
    "fixed_plugin_source",
    "sdk_registration_denied",
    "inert_wellknown",
    "control_boot",
    "permission_held",
    "saved_held",
    "coordinator_held",
    "session_execution_held",
    "lease_component_runtime",
    "session_content_held",
    "session_policy_held",
    "session_inbox_held",
    "session_shell_held",
    "session_misc_held",
    "session_factory_held",
    "tool_snapshot_held",
    "tool_raw_held",
  ].map((name) => ({ name, result: "fail" })),
};
const pass = (name) => {
  report.cases.find((entry) => entry.name === name).result = "pass";
};
let Effect, Scope, Exit, scope;
try {
  assert.equal(process.argv.length, 4);
  const [root, resources] = process.argv.slice(2);
  assert.equal(globalThis.Bun?.version, "1.4.2");
  assert.equal(process.platform, "darwin");
  assert.equal(process.arch, "arm64");
  assert.equal(process.execPath, join(resources, "runtime/bun"));
  assert.match(basename(root), /^omoc-permission-graph-[A-Za-z0-9]+$/u);
  assert.equal(await fs.realpath(root), root);
  assert.equal(
    await fs.readFile(join(root, ".permission-graph-probe-owned"), "utf8"),
    "synthetic permission graph probe v1\n",
  );
  for (const name of [
    "",
    "home",
    "config",
    "data",
    "state",
    "cache",
    "tmp",
    "workspace",
  ]) {
    const path = join(root, name),
      stat = await fs.lstat(path);
    assert.equal(await fs.realpath(path), path);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
    assert.equal(stat.uid, process.getuid());
    assert.equal(stat.mode & 0o077, 0);
  }
  assert.equal(process.env.HOME, join(root, "home"));
  assert.equal(process.env.XDG_CONFIG_HOME, join(root, "config"));
  assert.equal(process.env.XDG_DATA_HOME, join(root, "data"));
  assert.equal(process.cwd(), join(root, "workspace"));
  let loopbackOrigin;
  let deniedNetwork = 0;
  const fetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    if (!loopbackOrigin || url.origin !== loopbackOrigin) {
      deniedNetwork++;
      return Promise.reject(new Error("probe_network_denied"));
    }
    return fetch(input, init);
  };
  const nonce = "a".repeat(64);
  const marker = join(root, "unapproved-plugin-ran");
  const malicious = join(root, "unapproved-plugin.mjs");
  await fs.writeFile(
    malicious,
    `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'unapproved');export default {};\n`,
    { flag: "wx", mode: 0o600 },
  );
  const unapproved = JSON.stringify({
    plugins: [malicious],
    model: "unapproved-model",
  });
  await fs.mkdir(join(root, "workspace/.opencode/plugins"), {
    recursive: true,
    mode: 0o700,
  });
  await fs.writeFile(join(root, "workspace/opencode.json"), unapproved, {
    mode: 0o600,
  });
  await fs.writeFile(join(root, "config/opencode.json"), unapproved, {
    mode: 0o600,
  });
  await fs.copyFile(
    malicious,
    join(root, "workspace/.opencode/plugins/unapproved.mjs"),
    fs.constants.COPYFILE_EXCL,
  );
  report.phase = "verified_factory";
  const { createNativePermissionGraph } = await import(
    pathToFileURL(join(resources, "native-permission-graph.mjs")).href
  );
  const graph = await createNativePermissionGraph({
    root: resources,
    nonce,
    runtimeEpoch: "permission-graph-probe",
    bootHolds: [
      {
        projectId: "permission-gate-probe",
        originalOperationKey: "original-epoch:original-operation",
      },
    ],
  });
  assert.ok(Object.isFrozen(graph) && Object.isFrozen(graph.overrides));
  const pinned = (file) =>
    import(pathToFileURL(join(resources, "node_modules", file)).href);
  const core = (name) => pinned(`@opencode/core/dist/${name}.js`);
  const effect = await pinned("effect/dist/index.js");
  ({ Effect, Scope, Exit } = effect);
  const { Layer, Option, Stream, Deferred, Fiber, Context } = effect;
  const [
    { SessionExecution },
    { SessionStore },
    { SessionRunCoordinator },
    ControlRuntime,
    { Session },
    { SessionShell },
    { Tool },
    { execute3 },
  ] = await Promise.all([
    core("session/execution"),
    core("session/store"),
    core("session/run-coordinator"),
    import(
      pathToFileURL(join(resources, "native-permission-control.mjs")).href
    ),
    core("session"),
    core("session/shell"),
    core("tool"),
    core("chunks/config-3w5fmr99"),
  ]);
  let actualExecution, actualStore, actualControl;
  let actualSession, actualTool;
  const capture = (service, assign) =>
    Layer.tap((context) =>
      Effect.sync(() => assign(Context.get(context, service))),
    );
  const actualControlNode = ControlRuntime.configured({
    runtimeEpoch: "permission-graph-probe",
    bootHolds: [
      {
        projectId: "permission-gate-probe",
        originalOperationKey: "original-epoch:original-operation",
      },
    ],
  }).pipe(
    capture(ControlRuntime.Service, (value) => {
      actualControl = value;
    }),
  );
  const [
    { start },
    { Database },
    { make },
    { LayerNode },
    { ConfigPluginSource },
    { SdkPlugins },
    { WellKnown },
    { Bus },
  ] = await Promise.all([
    pinned("@opencode/server/dist/process.js"),
    core("database/database"),
    pinned("@opencode/client/dist/promise/client.js"),
    pinned("@opencode/util/dist/effect/layer-node.js"),
    core("config/plugin/source"),
    core("plugin/sdk"),
    core("wellknown"),
    core("bus"),
  ]);
  let acquired = 0,
    listened = 0,
    transformed = 0,
    cleaned = 0;
  const database = join(root, "data/probe.sqlite");
  const tap = Database.configured({ path: database }).mapLayer((layer) =>
    layer.pipe(
      Layer.tap(() =>
        Effect.sync(() => {
          acquired++;
        }),
      ),
    ),
  );
  scope = await Effect.runPromise(Scope.make());
  report.phase = "server_start";
  const password = "synthetic-graph-probe-only";
  const server = await Effect.runPromise(
    start(
      {
        hostname: "127.0.0.1",
        port: 0,
        password,
        app: { version: "2.0.18" },
        database: { path: database },
        config: {
          directory: join(root, "config"),
          project: false,
          content: "{}",
        },
        models: { fetch: false },
        events: { persist: true },
        fs: { filewatcher: false, fff: false },
      },
      {
        onListen: () => {
          listened++;
          return Effect.succeed(
            Effect.sync(() => {
              cleaned++;
            }),
          );
        },
      },
      (app) => {
        transformed++;
        return app;
      },
      [
        ...graph.overrides.slice(1),
        ControlRuntime.node.replace(actualControlNode),
        Database.node.replace(tap),
        SessionStore.node.replace(
          SessionStore.node.mapLayer((layer) =>
            layer.pipe(
              capture(SessionStore.Service, (value) => {
                actualStore = value;
              }),
            ),
          ),
        ),
        Session.node.replace(
          Session.node.mapLayer((layer) =>
            layer.pipe(
              capture(Session.Service, (value) => {
                actualSession = value;
              }),
            ),
          ),
        ),
        Tool.node.replace(
          Tool.node.mapLayer((layer) =>
            layer.pipe(
              capture(Tool.Service, (value) => {
                actualTool = value;
              }),
            ),
          ),
        ),
        SessionExecution.node.replace(
          SessionExecution.node.mapLayer((layer) =>
            layer.pipe(
              capture(SessionExecution.Service, (value) => {
                actualExecution = value;
              }),
            ),
          ),
        ),
      ],
    ).pipe(Effect.provideService(Scope.Scope, scope)),
  );
  assert.equal(server.address._tag, "TcpAddress");
  assert.ok(server.address.port > 0);
  assert.equal(acquired, 1);
  assert.equal(listened, 1);
  assert.equal(transformed, 1);
  pass("overlay_forwarding");
  loopbackOrigin = `http://127.0.0.1:${server.address.port}`;
  const client = make({
    baseUrl: loopbackOrigin,
    headers: {
      Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
    },
    fetch: globalThis.fetch,
  });
  report.phase = "config_read";
  const entries = await client.config.get({
    location: { directory: join(root, "workspace") },
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].type, "document");
  assert.equal(entries[0].info.plugins.length, 1);
  assert.equal(
    entries[0].info.plugins[0].package,
    join(resources, "builtins/workbench-skills"),
  );
  assert.equal(entries[0].info.plugins[0].options.nonce, nonce);
  assert.equal(entries[0].info.model, undefined);
  await assert.rejects(fs.lstat(marker), { code: "ENOENT" });
  pass("fixed_config");
  // Seed through the real SDK/Native store, without prompt/provider execution.
  report.phase = "coordinator_held";
  const session = await client.session.create({
    location: { directory: join(root, "workspace") },
    title: "Contained held coordinator",
  });
  assert.equal(typeof session.id, "string");
  assert.ok(
    actualExecution && actualStore && actualControl && actualSession && actualTool,
  );
  assert.equal(typeof execute3, "function");
  const heldEntry = (effect) =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(effect);
      assert.ok(Exit.isFailure(exit));
      assert.ok(
        exit.cause.reasons.some(
          (reason) =>
            reason._tag === "Fail" &&
            reason.error?.message === "native_permission_held",
        ),
      );
    });
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const info = yield* actualStore.get(session.id);
        assert.equal(info.id, session.id);
        assert.equal(info.location.directory, join(root, "workspace"));
        let callbacks = 0;
        const canary = () =>
          Effect.sync(() => {
            callbacks++;
          });
        const coordinator = yield* SessionRunCoordinator.make({
          started: canary,
          drain: canary,
          settled: canary,
        }).pipe(
          Effect.provideService(ControlRuntime.Service, actualControl),
          Effect.provideService(SessionStore.Service, actualStore),
        );
        yield* heldEntry(coordinator.run(session.id, true, "probe"));
        yield* heldEntry(coordinator.wake(session.id, "probe"));
        assert.deepEqual([...(yield* coordinator.active)], []);
        assert.equal(yield* coordinator.isActive(session.id), false);
        assert.equal(
          yield* coordinator.interrupt(session.id, "user", {
            awaitSettlement: true,
          }),
          false,
        );
        yield* coordinator.awaitIdle(session.id);
        assert.equal(callbacks, 0);
        pass("coordinator_held");
        yield* heldEntry(actualExecution.resume(session.id, true, "probe"));
        yield* heldEntry(actualExecution.wake(session.id, "probe"));
        assert.deepEqual([...(yield* actualExecution.active)], []);
        assert.equal(yield* actualExecution.isActive(session.id), false);
        assert.equal(
          yield* actualExecution.interrupt(session.id, {
            reason: "user",
            awaitSettlement: true,
          }),
          false,
        );
        yield* actualExecution.awaitIdle(session.id);
        yield* actualControl.transaction([info.projectID], (tx) =>
          Effect.gen(function* () {
            assert.deepEqual(
              yield* actualControl.leaseSnapshot(tx, info.projectID),
              [],
            );
          }),
        );
        pass("session_execution_held");
        const sessionID = session.id;
        const beforeInfo = JSON.stringify(yield* actualStore.get(sessionID));
        const beforeMessages = yield* actualStore.messages({ sessionID });
        const beforeInbox = yield* actualSession.inbox(sessionID);
        const beforeEnvironment = yield* actualSession.environment({
          sessionID,
        });
        report.phase = "session_content_held";
        yield* heldEntry(
          actualSession.prompt({
            sessionID,
            text: "must not prepare or admit",
            resume: false,
          }),
        );
        yield* heldEntry(
          actualSession.synthetic({
            sessionID,
            text: "must not admit",
            resume: false,
          }),
        );
        yield* heldEntry(actualSession.compact({ sessionID }));
        pass("session_content_held");
        report.phase = "session_policy_held";
        yield* heldEntry(
          actualSession.setPermissions({ sessionID, permissions: [] }),
        );
        yield* heldEntry(
          actualSession.switchAgent({ sessionID, agent: "must-not-select" }),
        );
        yield* heldEntry(
          actualSession.switchModel({
            sessionID,
            model: { providerID: "must-not-contact", id: "must-not-select" },
          }),
        );
        pass("session_policy_held");
        report.phase = "session_inbox_held";
        for (const name of ["cancelInbox", "steerInbox", "queueInbox"])
          yield* heldEntry(
            actualSession[name]({ sessionID, inboxID: "must-not-mutate" }),
          );
        pass("session_inbox_held");
        report.phase = "session_shell_held";
        yield* heldEntry(
          actualSession.shell({ sessionID, command: "must-not-execute" }),
        );
        // No Instance/Shell provider is supplied. The real direct Shell function
        // must reject through actual Store+Control before acquiring either one.
        yield* heldEntry(
          SessionShell.start({
            session: info,
            command: "must-not-execute",
          }).pipe(
            Effect.provideService(ControlRuntime.Service, actualControl),
            Effect.provideService(SessionStore.Service, actualStore),
          ),
        );
        pass("session_shell_held");
        report.phase = "session_misc_held";
        yield* heldEntry(actualSession.view({ sessionID, idle: 0 }));
        yield* heldEntry(
          actualSession.rename({ sessionID, title: "must-not-rename" }),
        );
        yield* heldEntry(
          actualSession.setMetadata({
            sessionID,
            metadata: { mustNotPersist: true },
          }),
        );
        yield* heldEntry(
          actualSession.skill({
            sessionID,
            skill: "must-not-load",
            resume: false,
          }),
        );
        yield* heldEntry(
          actualSession.revert.stage({
            sessionID,
            messageID: "must-not-stage",
            files: [],
          }),
        );
        yield* heldEntry(actualSession.revert.clear(sessionID));
        yield* heldEntry(actualSession.revert.commit(sessionID));
        pass("session_misc_held");
        report.phase = "session_factory_held";
        yield* heldEntry(actualSession.fork({ sessionID }));
        yield* heldEntry(actualSession.remove(sessionID));
        yield* heldEntry(
          actualSession.generate({ sessionID, prompt: "must-not-generate" }),
        );
        yield* heldEntry(
          actualSession.command({ sessionID, command: "must-not-load" }),
        );
        yield* heldEntry(actualSession.background(sessionID));
        yield* heldEntry(
          actualSession.move({ sessionID, directory: join(root, "workspace") }),
        );
        yield* heldEntry(
          actualSession.environment({
            sessionID,
            variables: { MUST_NOT_PERSIST: "synthetic" },
          }),
        );
        assert.equal(
          JSON.stringify(yield* actualStore.get(sessionID)),
          beforeInfo,
        );
        assert.deepEqual(
          yield* actualStore.messages({ sessionID }),
          beforeMessages,
        );
        assert.deepEqual(yield* actualSession.inbox(sessionID), beforeInbox);
        assert.deepEqual(
          yield* actualSession.environment({ sessionID }),
          beforeEnvironment,
        );
        assert.deepEqual(yield* actualSession.get(sessionID), info);
        yield* actualSession.wait(sessionID);
        assert.equal(
          yield* actualSession.interrupt(sessionID, { reason: "user" }),
          false,
        );
        pass("session_factory_held");
        report.phase = "tool_snapshot_held";
        // No registrations or positive snapshot are needed. On the pinned Tool
        // path, rules.findLast precedes catalog2 and definition2, even with an
        // empty inventory (the unconditional "execute" permission check).
        let permissionCallbacks = 0;
        const permissions = [];
        Object.defineProperty(permissions, "findLast", {
          get() {
            permissionCallbacks++;
            throw new Error("probe_tool_permissions_reached");
          },
        });
        yield* heldEntry(actualTool.snapshot(permissions));
        assert.equal(permissionCallbacks, 0);
        pass("tool_snapshot_held");
        report.phase = "tool_raw_held";
        let schemaCallbacks = 0, toolCallbacks = 0;
        const rawTool = {
          get input() {
            schemaCallbacks++;
            throw new Error("probe_tool_input_schema_reached");
          },
          get output() {
            schemaCallbacks++;
            throw new Error("probe_tool_output_schema_reached");
          },
          execute: () => {
            toolCallbacks++;
            throw new Error("probe_tool_callback_reached");
          },
        };
        // Actual exported guarded raw function, with the captured graph services
        // and an own data sessionID for the already stored synthetic session.
        yield* heldEntry(
          execute3(rawTool, {}, { sessionID }).pipe(
            Effect.provideService(ControlRuntime.Service, actualControl),
            Effect.provideService(SessionStore.Service, actualStore),
          ),
        );
        assert.equal(schemaCallbacks, 0);
        assert.equal(toolCallbacks, 0);
        assert.equal(JSON.stringify(yield* actualStore.get(sessionID)), beforeInfo);
        assert.deepEqual(yield* actualStore.messages({ sessionID }), beforeMessages);
        pass("tool_raw_held");
      }).pipe(Effect.timeout("5 seconds")),
    ),
  );
  await Effect.runPromise(Scope.close(scope, Exit.void));
  scope = undefined;
  assert.equal(cleaned, 1);
  report.phase = "minimal_sources";
  const layer = LayerNode.compile(
    LayerNode.group([ConfigPluginSource.node, SdkPlugins.node, WellKnown.node]),
    {
      replacements: [
        ...graph.overrides,
        Database.node.replace(Database.configured({ path: database })),
        Bus.node.replace(Bus.configured({ persist: false })),
      ],
    },
  );
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const sources = yield* ConfigPluginSource.Service;
        const expected = [
          {
            type: "add",
            target: join(resources, "builtins/workbench-skills"),
            options: { nonce },
          },
        ];
        assert.deepEqual(yield* sources.operations(), expected);
        const changed = yield* sources.operations();
        changed[0].options.nonce = "changed";
        assert.deepEqual(yield* sources.operations(), expected);
        const timeout = yield* sources
          .changes()
          .pipe(Stream.take(1), Stream.runCollect, Effect.timeoutOption(20));
        assert.ok(Option.isNone(timeout));
        pass("fixed_plugin_source");
        const sdk = yield* SdkPlugins.Service;
        let unknownRan = false;
        const registered = yield* Effect.exit(
          sdk.register({
            id: "unapproved",
            effect: Effect.sync(() => {
              unknownRan = true;
            }),
          }),
        );
        assert.ok(Exit.isFailure(registered));
        assert.equal(unknownRan, false);
        assert.deepEqual(sdk.all(), []);
        pass("sdk_registration_denied");
        const known = yield* WellKnown.Service;
        assert.deepEqual(yield* known.entries(), []);
        assert.deepEqual(known.snapshot(), []);
        assert.deepEqual(yield* known.resolve({}, {}), []);
        assert.equal(yield* known.refresh(), false);
        assert.ok(
          Exit.isFailure(
            yield* Effect.exit(known.add("https://unapproved.invalid")),
          ),
        );
        assert.ok(
          Exit.isFailure(
            yield* Effect.exit(known.remove("https://unapproved.invalid")),
          ),
        );
        pass("inert_wellknown");
      }).pipe(Effect.provide(layer)),
    ),
  );
  // Real patched Permission and Saved providers share the same initialized node.
  // Existing-session/Shell refusal is checked above; positive execution remains unavailable.
  const [{ Permission }, { PermissionSaved }, { Location }, Control] =
    await Promise.all([
      core("permission"),
      core("permission/saved"),
      core("location"),
      import(
        pathToFileURL(join(resources, "native-permission-control.mjs")).href
      ),
    ]);
  const projectID = "permission-gate-probe";
  const directory = join(root, "workspace");
  const permissionLayer = LayerNode.compile(
    LayerNode.group([Permission.node, PermissionSaved.node, Control.node]),
    {
      replacements: [
        ...graph.overrides,
        Database.node.replace(Database.configured({ path: database })),
        Bus.node.replace(Bus.configured({ persist: false })),
        Location.node.replace(
          Layer.succeed(Location.Service, {
            directory,
            project: { id: projectID, directory, canonical: directory },
          }),
        ),
      ],
    },
  );
  const held = (effect) =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(effect);
      assert.ok(Exit.isFailure(exit));
      assert.ok(
        exit.cause.reasons.some(
          (reason) =>
            reason._tag === "Fail" &&
            reason.error?.message === "native_permission_held",
        ),
      );
    });
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const control = yield* Control.Service;
        const permissions = yield* Permission.Service;
        const saved = yield* PermissionSaved.Service;
        yield* control.transaction([projectID], (tx) =>
          Effect.gen(function* () {
            const state = yield* control.inspect(tx, projectID);
            assert.equal(state.runtimeEpoch, "permission-graph-probe");
            assert.equal(state.state, "boot_held");
            assert.deepEqual(state.bootHolds, [
              {
                projectId: projectID,
                originalOperationKey: "original-epoch:original-operation",
              },
            ]);
            // Successful locked reads validate the SAME current-Fiber capability owner.
            assert.deepEqual(yield* permissions.listLocked(tx), []);
            assert.deepEqual(yield* saved.listLocked(tx, { projectID }), []);
            yield* held(control.assertExecution(tx, projectID));
          }),
        );
        pass("control_boot");
        const input = {
          sessionID: "ses_permission_gate_probe",
          action: "read",
          resources: ["synthetic-target.txt"],
          save: ["synthetic-target.txt"],
        };
        yield* held(permissions.ask(input));
        yield* held(permissions.assert(input));
        yield* held(
          permissions.reply({
            requestID: "per_permission_gate_probe",
            reply: "once",
          }),
        );
        assert.deepEqual(yield* permissions.list(), []);
        pass("permission_held");
        yield* held(
          saved.add({
            projectID,
            action: "read",
            resources: ["synthetic-target.txt"],
          }),
        );
        yield* saved.remove("per_absent_permission_gate_probe");
        assert.deepEqual(yield* saved.list({ projectID }), []);
        yield* control.transaction([projectID], (tx) =>
          held(
            saved.addLocked(tx, {
              projectID,
              action: "read",
              resources: ["synthetic-target.txt"],
            }),
          ),
        );
        assert.deepEqual(yield* saved.list({ projectID }), []);
        pass("saved_held");
      }).pipe(Effect.provide(permissionLayer)),
    ),
  );
  report.phase = "lease_component_runtime";
  const { createNativeLeaseRegistry } = await import(
    pathToFileURL(join(resources, "native-permission-leases.mjs")).href
  );
  const registry = createNativeLeaseRegistry({
    runtimeEpoch: "component-probe",
  });
  const stream = new PassThrough();
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          // Raw component compatibility only: no Native execution admission.
          const origin = registry.origins.admit({
            origin: {
              runtimeEpoch: "component-probe",
              operationId: "synthetic",
              digest: "a".repeat(64),
            },
            workspaceId: "component",
            appSessionId: "component",
            nativeSessionId: "component",
            projectId: "component",
            locationIncarnation: "component",
            modeGeneration: 1,
            inventoryGeneration: 1,
            inputDigest: "b".repeat(64),
          });
          const componentScope = registry.origins.createScope({
            cause: origin,
            inboxes: [],
          });
          const lease = registry.admit({
            scope: componentScope,
            projectId: "component",
            locationIncarnation: "component",
            sessionId: "component",
            kind: "filesystem",
            modeGeneration: 1,
            inventoryGeneration: 1,
            parentLeaseId: null,
          });
          const slot = registry.reserve(lease, "io");
          registry.bindIO(slot, stream);
          const captured = yield* Deferred.make();
          const finish = yield* Deferred.make();
          const task = yield* Effect.forkChild(
            registry.capture(lease).pipe(
              Effect.tap(() => Deferred.succeed(captured, undefined)),
              Effect.andThen(Deferred.await(finish)),
            ),
          );
          yield* Deferred.await(captured);
          registry.start(lease, task);
          const proofEffect = registry.observe(lease);
          registry.cancel(lease);
          assert.equal(registry.inspect(lease).state, "cancelling");
          assert.throws(() => registry.settle(lease, {}));
          yield* Deferred.succeed(finish, undefined);
          yield* Fiber.await(task);
          stream.destroy();
          const proof = yield* proofEffect;
          assert.equal(registry.settle(lease, proof), true);
          assert.equal(registry.inspect(lease).state, "settled");
        }).pipe(Effect.timeout("5 seconds")),
      ),
    );
    pass("lease_component_runtime");
  } finally {
    stream.destroy();
    registry.close();
  }
  assert.equal(deniedNetwork, 0);
  await assert.rejects(fs.lstat(marker), { code: "ENOENT" });
  report.result = "pass";
  report.phase = "complete";
} catch {
  report.result = "fail";
} finally {
  if (scope) {
    try {
      await Effect.runPromise(Scope.close(scope, Exit.void));
    } catch {
      report.result = "fail";
    }
  }
  try {
    writeFileSync(3, JSON.stringify(report));
  } catch {
    // A closed parent report channel cannot be repaired by exporting raw diagnostics.
  }
}
process.exitCode = report.result === "pass" ? 0 : 1;
