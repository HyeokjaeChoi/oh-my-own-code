**최소 child 후보를 확인했습니다.** `LayerNode.compile()`로 필요한 서비스만 구성하고, **실제 `WriteTool.Plugin.effect()`를 등록**하는 경로입니다. 소스만 확인했습니다. Native 실행, 수정, 보고서 저장, 승인은 하지 않았습니다.

아래 경로의 기준점은 모두 다음입니다.

```text
/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules
```

1. **실제 실행 경로**

   `WriteTool.Plugin.effect({ tool })` → `Tool.Service.snapshot().execute()` → built-in `permission.assert({ action: "edit", ... })` → `FileMutation.writeTextPreservingBom()` → Native local driver의 `fs.writeFile()`.

   등록된 도구는 `write`, 입력은 **`{ path, content }`**, options는 `{ codemode: false, permission: "edit" }`입니다. 권한 확인은 파일 쓰기 전에 있습니다.  
   근거: [write 구현](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/chunks/config-5m3ds5v3.js:52), [snapshot 실행](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/chunks/config-yw6qsgb4.js:191).

2. **Permission 처리**

   `forSession(sessionID)` 또는 `list()`로 pending 요청을 읽습니다. 응답은 `reply({ requestID, reply: "once" | "reject" })`입니다.

   configured deny는 pending을 만들기 전에 실패합니다. 메시지 없는 `reject`는 `Permission.DeclinedError`를 **defect**로 전달하므로, 실행 결과는 `Effect.exit()`로 받아야 합니다.  
   근거: [assert/reply](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/chunks/config-vgpkvtp0.js:221).

3. **전체 Instance graph를 피해야 하는 이유**

   `Instance.layer()`는 전체 location graph를 구성합니다. `AppNodeBuilder.build()`는 unbound `Instance`와 `LocationServiceMap`을 연결하며, location 생성 시 다시 `Instance.layer()`를 사용합니다.

   특히 **`Project.resolve(input, _options)`는 options를 무시하고 상위 `.git`/`.hg`를 탐색합니다.** `discovery: false`만으로 이를 차단할 수 없습니다.  
   근거: [Instance.layer](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/chunks/config-ph8yj3s6.js:237), [AppNodeBuilder](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/effect/app-node-builder.js:382), [Project.resolve](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/chunks/config-pd1wrm5b.js:253).

다음은 Main이 child로 옮길 수 있는 구성안입니다. `paths`는 parent가 검증한 절대 경로입니다. **아직 실행 검증하지 않은 코드입니다.**

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const modules =
  "/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/" +
  "resources/opencode/event-host/darwin-arm64/node_modules";

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
  { Tool }, { Permission }, { Agent }, { Location }, { Bus },
  { Database }, { SessionStore }, { SessionProjector },
  { SessionEvent }, { SessionSchema }, { SessionMessage },
  { FileAccess }, { FileMutation }, { Environment },
  { Formatter }, { WriteTool }, { upsertProject }, { Slug },
] = await Promise.all([
  "tool", "permission", "agent", "location", "bus",
  "database/database", "session/store", "session/projector",
  "session/event", "session/schema", "session/message",
  "file-access", "file-mutation", "environment/index",
  "formatter", "tool/plugin/write", "project/sql", "util/slug",
].map(core));

const { Project } = await pinned("@opencode/schema/dist/project.js");
const { AbsolutePath } = await pinned("@opencode/schema/dist/schema.js");

export function nativeProbe(paths) {
  const directory = AbsolutePath.make(paths.workspace);
  const projectID = Project.ID.make("permission-tool-probe");
  const location = {
    directory,
    project: { id: projectID, directory, canonical: directory },
  };
  const resource = "permission-target.txt";
  const target = join(directory, resource);

  // Use the actual Native local driver. Omit Workspace connection/polling.
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

  const layer = LayerNode.compile(LayerNode.group([
    Database.node, Bus.node, SessionStore.node, SessionProjector.node,
    Agent.node, Tool.node, Permission.node,
    FileAccess.node, FileMutation.node, Environment.node, Formatter.node,
  ]), {
    replacements: [
      Global.node.replace(Global.layerWith({
        home: paths.home,
        data: paths.data,
        config: paths.config,
        state: paths.state,
        cache: paths.cache,
        tmp: paths.tmp,
        bin: join(paths.cache, "bin"),
        log: join(paths.data, "log"),
        repos: join(paths.data, "repos"),
      })),
      Database.node.replace(Database.configured({ path: paths.database })),
      Bus.node.replace(Bus.configured({ persist: true })),
      Location.node.replace(Layer.succeed(Location.Service, location)),
      Environment.node.replace(localEnvironment),
    ],
  });

  const program = Effect.gen(function* () {
    const { db } = yield* Database.Service;
    const bus = yield* Bus.Service;
    const store = yield* SessionStore.Service;
    const agents = yield* Agent.Service;
    const tools = yield* Tool.Service;
    const permissions = yield* Permission.Service;
    const agent = Agent.ID.make("permission-tool-probe");

    yield* upsertProject(db, { id: projectID, canonical: directory });

    yield* agents.transform((editor) => editor.update(agent, (entry) => {
      entry.permissions = [
        { action: "*", resource: "*", effect: "deny" },
        { action: "edit", resource, effect: "ask" },
      ];
    }));

    // This exact built-in reads only ctx.tool.transform during registration.
    yield* WriteTool.Plugin.effect({ tool: { transform: tools.transform } });
    assert.deepEqual((yield* tools.list()).map((item) => item.id), ["write"]);

    const results = [];
    for (const mode of ["once", "reject", "deny"]) {
      const sessionID = SessionSchema.ID.create();
      const messageID = SessionMessage.ID.create();
      const callID = Tool.CallID.make(`call_${mode}`);
      const content = `permission-tool-${mode}\n`;
      const before = yield* Effect.promise(() => readFile(target));

      // Same durable creation event/projector used by Session.Service.create.
      yield* bus.publish(SessionEvent.Created, {
        sessionID,
        projectID,
        location: { directory },
        slug: Slug.create(),
        title: `permission-tool-${mode}`,
        agent,
        permissions: [{
          action: "edit",
          resource,
          effect: mode === "deny" ? "deny" : "ask",
        }],
        version: "2.0.18",
      }, { location: { directory } });
      assert.ok(yield* store.get(sessionID));

      // Do not pass deny rules into snapshot: that can remove write itself.
      const snapshot = yield* tools.snapshot();
      assert.ok(snapshot.definitions.some((item) => item.name === "write"));

      const fiber = yield* snapshot.execute({
        sessionID, agent, messageID,
        call: {
          id: callID,
          name: "write",
          input: { path: resource, content },
        },
      }).pipe(Effect.exit, Effect.forkScoped);

      if (mode !== "deny") {
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
          type: "tool", messageID, id: callID,
        });
        assert.ok(
          (yield* Effect.promise(() => readFile(target))).equals(before),
        );
        yield* permissions.reply({ requestID: request.id, reply: mode });
      }

      const exit = yield* Fiber.join(fiber).pipe(Effect.timeout("3 seconds"));
      const after = yield* Effect.promise(() => readFile(target));
      assert.equal(Exit.isSuccess(exit), mode === "once");
      assert.ok(after.equals(mode === "once" ? Buffer.from(content) : before));
      assert.equal((yield* permissions.forSession(sessionID)).length, 0);
      assert.equal((yield* permissions.list()).length, 0);
      results.push({ mode, settled: true });
    }
    return results;
  });

  return Effect.scoped(program.pipe(Effect.provide(layer)));
}
```

이 구성의 경계는 다음과 같습니다.

- **실제 서비스 유지:** `Tool`, `Permission`, `FileAccess`, `FileMutation`, `SessionStore`, `SessionProjector`, Native local filesystem driver.
- **탐색 경로 제외:** `Config`, `InstructionDiscovery`, `Project.Service`, plugin supervisor, ModelsDev, watcher, fff를 graph에 넣지 않습니다. 따라서 이 구성에서는 해당 disable 옵션도 필요하지 않습니다.
- **Formatter:** 실제 `Formatter.node`를 유지합니다. 초기 formatter 목록은 비어 있습니다. formatter plugin을 등록하지 않으므로 `file()`은 `false`를 반환하는 경로입니다.
- **Session 범위:** 실제 DB Session과 durable event projection을 사용합니다. **`Session.Service.create()` 자체를 검증하는 구성은 아닙니다.** Project FK는 먼저 production `upsertProject()`로 충족합니다. 근거: [Session 생성](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/chunks/config-zyp346xr.js:172), [Created projector](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/chunks/config-hs7fxsaf.js:278).
- **남은 검증:** pinned Bun에서 import, SQLite migration, layer acquisition, scoped registration/finalization이 함께 성공하는지는 capability run이 필요합니다. local driver는 symlink를 통한 범위 이탈을 막는 보안 경계가 아닙니다. parent의 경로·실행 guard가 계속 필요합니다.
- production startup의 `models.fetch:false`, `fs.filewatcher:false`, `fs.fff:false`, `config.project:false`는 확인했습니다. 이는 위 최소 graph의 필수 설정이 아닙니다. [production startup](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/event-host-child.mjs:328).

`ctx.tool.execute`는 사용하지 않습니다. server/RPC 대안도 현재 후보에는 필요하지 않습니다.

