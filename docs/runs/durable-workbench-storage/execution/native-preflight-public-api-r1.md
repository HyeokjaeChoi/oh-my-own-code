**현재 공개 API 조합만으로는 nonfresh startup이 안전하게 실행되지 않는다는 완전한 증명을 만들 수 없습니다.** 읽기 전용 inspector 구성과 여러 pending 상태의 탐지는 가능합니다. 그러나 schema migration, orphan inbox, 손상된 parent 표현에 증명 공백이 있습니다. S2/S4와 전체 P7은 열린 상태로 유지해야 합니다.

설치된 `@opencode/core`와 `@opencode/server`의 manifest는 모두 `2.0.18`입니다. 아래 결과는 소스 읽기 결과입니다. 실행, 파일 변경, 승인 판정은 하지 않았습니다.

1. **읽기 전용 replacement graph는 공개 API로 구성할 수 있습니다.**

   필요한 root는 다음과 같습니다.

   ```text
   LayerNode.group([
     Database.node,
     SessionStore.node,
     KV.node
   ])
     └─ Database.node.replace(closedReadonlyDatabaseLayer)
          └─ Database.Service { db }
               └─ EffectDrizzleSqlite.makeWithDefaults()
                    └─ sqliteLayer(copiedFilename,
                         readonly:true,
                         readwrite:false,
                         create:false,
                         disableWAL:true)
   ```

   `replace(Layer)`는 기존 node의 의존성을 제거합니다. `compile`은 acquisition 전에 replacement를 해결합니다. 따라서 기본 Database의 `Global.node`, PRAGMA, migration 경로를 제외할 수 있습니다. 단, **Database를 root에 포함해야** 외부 read effect에서 `Database.Service`를 사용할 수 있습니다. SessionStore/KV만 root로 두면 Database는 내부 의존성으로 숨겨집니다. [LayerNode 소스:23–32, 74–148](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/util/dist/effect/layer-node.js:23)

   SQLite acquisition은 복사본 연결을 열고 close finalizer를 등록합니다. `disableWAL:true`는 `journal_mode=WAL` 실행을 생략합니다. Drizzle acquisition은 query 객체와 기본 no-op cache/logger를 만듭니다. SessionStore/KV acquisition은 Database를 받아 메서드를 구성하며, 자체 조회나 mutation을 실행하지 않습니다. [SQLite:59–74](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/database/sqlite.bun.js:59), [Drizzle:22–40](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/chunks/config-qe76k2zv.js:22)

   다만 이 소스는 Bun/SQLite의 실제 WAL/SHM 생성·변경 여부나 파일 접근 격리를 증명하지 않습니다. 해당 동작은 이번 조사에서 실행 검증하지 않았습니다.

2. **Session/KV 검사는 정상적인 공식 상태에 대해 보수적인 거부 조건을 제공합니다.**

   - `SessionStore.list({limit:201})`에 다른 filter를 넣지 않으면 모든 location과 root/child session을 대상으로 조회합니다. 계약상 session 상한이 200이므로 201개가 반환되면 거부해야 합니다.
   - `listSuspended()`는 `time_suspended IS NOT NULL AND parent_id IS NULL`만 조회합니다. child claim은 포함하지 않습니다.
   - `KV.scan({prefix:"",limit:1})`는 전체 key 범위를 대상으로 실제로 최대 2개 row를 읽습니다. entry가 하나라도 있으면 거부할 수 있습니다.
   - `Job.pendingBackground`는 decode 실패 항목을 걸러냅니다. 따라서 빈 결과로 malformed marker 부재를 증명할 수 없습니다. 모든 KV entry 거부가 이 공백을 줄입니다.

   [SessionStore:64–128](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/chunks/config-sd0msgcy.js:64), [KV:36–54](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/chunks/config-vtnt34eh.js:36), [Job:330–362](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/chunks/config-30xg31xn.js:330)

   Native ID 집합과 committed registry ID 집합은 **양방향으로 정확히 일치**해야 합니다. title, idle 표시는 mapping 근거가 아닙니다.

3. **parent와 fork DTO에 정확한 표현 한계가 있습니다.**

   `fromRow`는 truthy `parent_id`만 `parentID`로 노출합니다. 따라서 raw `parent_id=""`는 DTO에서 사라집니다. 동시에 `listSuspended`의 `parent_id IS NULL` 조건에서도 제외됩니다. 이 row에 claim이 있으면 제안한 두 검사가 모두 놓칠 수 있습니다.

   `fork`도 `fork_session_id`와 `fork_boundary`가 모두 truthy일 때만 노출됩니다. 불완전한 lineage 필드는 DTO만으로 식별할 수 없습니다. [변환:20–61](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/chunks/config-cmkj70ft.js:20)

   공식 fork projector는 정확히 `parent_id:null`, `fork_session_id:parentID`, `fork_boundary:boundary`를 저장합니다. 따라서 정상 공식 fork는 child 거부 조건에 걸리지 않습니다. [fork projector:118–150](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/chunks/config-hs7fxsaf.js:118)

   이 차이는 정상 공개 API로 생성된 상태와 임의로 손상된 DB에 대한 증명을 구분해야 하는 이유입니다.

4. **`Inbox.list`는 직접 read로 사용할 수 있지만, 전역 부재 증명은 부족합니다.**

   `SessionInbox.list(db, sessionID)`는 해당 session의 모든 inbox row를 읽습니다. Bus나 executor acquisition은 필요하지 않습니다. 반대로 `SessionInbox.node`는 Database와 Bus를 요구하므로 inspector에는 불필요합니다. [Inbox:156–159, 230–231, 269–271](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/chunks/config-7stqpyhf.js:269)

   공개 목록 함수에는 global enumeration과 limit이 없습니다. 모든 알려진 session을 검사해도, 존재하지 않는 session ID에 연결된 orphan inbox row는 찾지 못합니다. schema에는 foreign key 선언이 있지만, 선언 자체가 복사본의 실제 무결성을 증명하지는 않습니다. [schema:83–93](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/chunks/config-bjtzbw4r.js:83)

   `listSuspended`와 Inbox 목록도 API 자체에는 결과 상한이 없습니다. KV 조회는 제한된 row 수에도 전체 value를 decode합니다. 따라서 row 수 제한만으로 메모리·시간 상한을 증명할 수 없습니다.

5. **`V1Migration.status()`는 legacy migration 검사입니다. schema migration 검사가 아닙니다.**

   Bun 구현은 Database만 요구합니다. 내부에서 `sqlite_master`의 `session` table 존재와 KV의 `migration.v1-v2`를 읽습니다. migration을 실행하지는 않습니다. 따라서 “앱이 직접 SQL을 작성하지 않는다”는 조건에는 맞지만, **공식 API 내부에도 introspection이 전혀 없다**고 표현하면 틀립니다. [status:390–403, helper:817–833](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/database/v1-migration.bun.js:390)

   중요한 제한은 다음과 같습니다.

   - `session` table이 없으면 바로 `completed`입니다.
   - table이 있으면 비어 있어도 completed marker가 없는 경우 `required`입니다.
   - 새 inspector의 `runtimeState`는 `idle`입니다. 과거 프로세스의 running/error를 복원하지 않습니다.
   - 모든 KV entry를 거부하면 완료된 legacy migration marker가 있는 store도 거부됩니다.
   - Node 조건에서는 status가 무조건 `completed`인 noop 구현입니다. Bun 조건을 정확히 고정해야 합니다. [noop:1–8](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/database/v1-migration.noop.js:1)

   별도 schema migrator는 `migration` ledger를 읽고 미완료 `up`을 실행합니다. 확인한 공개 migration surface는 `apply`와 `applyOnly`이며, 읽기 전용 status/dry-run은 없습니다. **현재 read predicates 통과로 schema migration 불필요를 증명할 수 없습니다.** [schema migrator:21–101](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/chunks/config-hkzp38b2.js:21)

6. **lifecycle 생략은 자동 restart continuity 호출만 막습니다. 서버 초기화를 inert하게 만들지는 않습니다.**

   `ServerProcess.start(options)`는 lifecycle이 있을 때만 `resumeSuspendedSessions`를 설치합니다. 없으면 그대로 `boot`를 실행합니다. 현재 child 호출도 options 하나만 전달합니다. [ServerProcess:86–134, 196–197](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/server/dist/process.js:86), [현재 호출:300–315](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/event-host-child.mjs:300)

   그러나 `createRoutes`는 Database, Job, Session, Credential, PermissionSaved, plugin 관련 서비스, SessionRestart 등을 구성하고 `V1Migration.layer`도 merge합니다. `start`의 transform 인자는 HTTP effect 변환이며 이 service graph replacement 통로가 아닙니다. [routes:75–149](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/server/dist/chunks/service-status-74x861p1.js:75)

   기본 Database acquisition은 PRAGMA, checkpoint, schema migration을 수행합니다. `V1Migration.layer`는 scoped migration fiber를 시작합니다. 따라서 기본 startup에는 **migration 실행 경로가 항상 존재**합니다. [Database:35–77](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/chunks/config-yds56wag.js:35), [V1 layer/run:405–435](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/database/v1-migration.bun.js:405)

   acquisition과 실제 실행은 구분해야 합니다. Job은 빈 메모리 상태로 시작하며 자동 recovery 조회를 하지 않습니다. SessionExecution coordinator도 acquisition만으로 drain을 시작하지 않습니다. restart layer는 recovery effect를 반환하지만 acquisition에서 호출하지 않습니다. [executor:68–135](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/chunks/config-y8cm73x9.js:68), [restart:253–355](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/session/execution/restart.js:253)

   추가 초기화 효과도 있습니다. Global은 directory를 생성합니다. Credential acquisition 자체는 DB 조회를 실행하지 않지만 서비스는 생성됩니다. location graph는 필요할 때 acquisition하는 구조입니다. `models.fetch:false`는 자동 catalog refresh fiber를 막습니다. 따라서 provider 요청이 즉시 실행된다고 단정할 근거는 없지만, **provider/credential 서비스를 전혀 구성하지 않는 서버 시작**이라는 주장은 성립하지 않습니다. [Global:45–53](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/util/dist/global.js:45), [Credential:53–76](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/chunks/config-rtyr3d5h.js:53), [location map:19–64](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/chunks/config-zs6xvgsc.js:19)

7. **provider 없이 만들 수 있는 synthetic pending fixture는 있습니다. 이번 조사에서는 생성하지 않았습니다.**

   | fixture | 공개 API와 제한 |
   |---|---|
   | root/child claim | 기존 synthetic session에 `SessionStore.claim(id)` |
   | pending inbox | Database + Bus + 공식 SessionProjector를 구성하고 `SessionInbox.admit` 또는 `admitCompaction` 호출 |
   | queued synthetic | `Session.synthetic({…,resume:false})`; 기본 resume 동작을 반드시 억제 |
   | malformed/terminal job marker | `KV.set("job.background/…", value)` |
   | 실제 durable running job marker | `Job.start`에 로컬 Effect를 제공하고 `Job.background`; provider 불필요 |
   | extra/unmapped session | 공식 create/event API로 session을 만들고 fixture registry에는 mapping을 넣지 않음 |

   Inbox admission은 model을 resolve하거나 executor를 깨우지 않습니다. 공식 projector가 event를 저장해야 durable inbox fixture가 됩니다. `Session.synthetic`는 `resume:false`가 없으면 wake할 수 있습니다. [admission:168–203](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/chunks/config-7stqpyhf.js:168), [synthetic:214–233](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/chunks/config-9qsysn39.js:214), [Job persistence/start:107–191, 250–275](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/chunks/config-30xg31xn.js:107)

   `claim` fixture는 탐지 검증용입니다. 실제 provider turn 중 crash 증거를 대신하지 않습니다. 또한 KV에 migration 값을 넣는 것만으로는 legacy table이 없는 DB의 `required` 상태를 만들 수 없습니다.

가장 작은 architecture 제약은 **복사본만 읽는 세 root inspector**, exact mapping 비교, 모든 child/claim/inbox/KV 거부, Bun 조건 고정입니다. 원본의 stopped 상태·전체 파일 집합·hash·owner·registry binding과 inspector 종료 증거는 공개 DB API 밖에서 확보해야 합니다.

**positive startup 허용에는 추가 근거가 필요합니다.** schema compatibility와 orphan/손상 상태를 판별하는 공개 기능, 또는 그 상태가 발생할 수 없음을 증명하는 엄격한 생성·보존 provenance가 필요합니다. 이 공백이 남으면 nonfresh hold를 유지해야 합니다. synthetic override로 restart 완료를 정의할 근거는 없습니다.
