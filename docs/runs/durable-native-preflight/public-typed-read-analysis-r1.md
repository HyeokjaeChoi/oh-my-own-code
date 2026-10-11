**A는 공개 API로 구성할 수 있습니다. B는 조건부 증명 후보입니다. 다만 B의 공식 타입은 “Database/SqlClient만 제공”하는 조건과 맞지 않으며, 읽기 전용 실행 성공도 아직 확인하지 않았습니다. production nonfresh hold는 유지됩니다.**

설치된 `@opencode/core` **2.0.18** 소스를 확인했습니다. packet의 skill/profile/plan/contract hash도 현재 파일과 일치합니다. 파일 수정, 테스트, Bun/Node 실행, DB 접근, 서비스 시작은 하지 않았습니다.

**1. A: 직접 projection은 기존 parent·orphan 누락을 막습니다.**

공개 `@opencode/core/session/sql`은 `SessionTable`, `SessionPendingTable`, `SessionInboxTable`을 export합니다. `SessionTable`의 실제 이름은 `session_v2`입니다. `@opencode/core/kv/sql`은 `KVTable`을 export합니다. package의 wildcard export로 접근할 수 있으므로 candidate가 private chunk를 import할 필요는 없습니다. 아래 chunk 링크는 설치 구현의 근거입니다. [공개 Session exports](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/session/sql.js:14), [wildcard export](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/package.json:29)

| 조회 | 확인할 수 있는 사실 | 필수 조건 |
|---|---|---|
| Session의 `id`, `parent_id`, `time_suspended`, fork 두 필드 | 전체 Session ID와 선택한 상태 필드 | filter/join/offset 없이 최대 201행. 201행이면 거부 |
| Pending의 `id`, limit 1 | 전역 pending row 존재 | 반환 행 수로 판단 |
| Inbox의 `id`, limit 1 | 전역 inbox row 존재 | Session과 join하지 않음 |
| KV의 `key`, limit 1 | 전역 KV row 존재 | value를 읽거나 decode하지 않음 |

`parent_id`는 일반 text column입니다. 직접 조회하면 `""`도 보존됩니다. 따라서 `parent_id !== null`로 검사하면 빈 문자열 parent도 거부할 수 있습니다. `time_suspended`도 truthiness 대신 SQL `NULL` 여부로 검사해야 합니다. 전역 Pending/Inbox 조회는 orphan row도 포함합니다. [Session·Pending·Inbox 정의](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/chunks/config-bjtzbw4r.js:15), [KV 정의](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/chunks/config-3hepkmqq.js:7)

**행의 존재와 ID의 유효성은 별개입니다.** Pending/Inbox에서 반환된 `id`가 빈 문자열이나 `NULL`이어도 행이 있으면 거부해야 합니다. Session ID는 별도로 형식·중복·registry 양방향 일치를 검사해야 합니다.

Drizzle의 explicit selection은 선택한 column만 SQL에 넣고, `limit`도 SQL에 넣습니다. Pending payload와 KV value를 decode할 필요는 없습니다. [selection·limit 생성](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/drizzle-orm/sqlite-core/dialect.js:212)

**2. A에는 fork decoding과 partial-row 공백이 남습니다.**

`fork_boundary`는 JSON text column입니다. `.all()`의 mapper는 SQL `NULL`을 `null`로 반환하고, 문자열 `"null"`도 `JSON.parse()` 후 `null`로 반환합니다. 따라서 **`.all()` 결과만으로 두 저장 표현을 구분할 수 없습니다.** `$type()`도 runtime Schema 검증은 아닙니다. [row mapper](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/chunks/config-emrn6kk6.js:62), [JSON decoder](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/drizzle-orm/sqlite-core/columns/text.js:43)

공개 `.values()` 경로는 column mapper를 적용하지 않고 driver row 배열을 반환합니다. 소스상 이 경로는 SQL `NULL`과 문자열 `"null"`을 구분할 수 있습니다. custom SQL은 필요하지 않습니다. 다만 column 순서·길이·runtime type을 직접 검증해야 합니다. [공개 `.values()`](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/chunks/config-wd87259q.js:93), [mapper 우회](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/chunks/config-22h6bjd1.js:72)

또한 다음 한계가 있습니다.

- fork 두 필드를 읽어도 lineage의 유효성이 자동 검증되지는 않습니다. 공식 boundary는 `before`/`through`와 `messageID` 구조입니다. [Boundary Schema](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/schema/dist/session-fork.js:4)
- ID-only 조회는 table의 다른 필수 column, constraint, index를 검증하지 않습니다. 빈 table에서 이 공백은 더 큽니다.
- 선택한 Session 필드는 `resume_attempts`, `time_compacting` 등을 검사하지 않습니다. 이 필드의 생략을 전체 lifecycle 검증으로 표현하면 안 됩니다.
- `session_message`에도 미완료 assistant와 `running` compaction 상태가 있습니다. 두 queue의 전역 부재와 KV 부재는 **해당 저장 위치의 부재**를 증명합니다. 모든 transcript 상태의 정상성을 증명하지는 않습니다. [message 상태 조회](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/chunks/config-hs7fxsaf.js:208)
- 행 수 제한은 문자열 크기·JSON 크기·실행 시간 제한이 아닙니다. B의 table 목록과 migration ID 조회에는 행 수 제한도 없습니다.

누락 table/column, decode 오류, defect, interruption은 모두 검사 실패여야 합니다. 이를 빈 결과로 바꾸면 false negative가 생깁니다.

**3. B: 읽기 전용 성공이 증명할 수 있는 범위는 좁고 명확합니다.**

`apply(db)`는 먼저 table 이름을 조회합니다.

- `session` 또는 `session_v2`가 있으면 전체 generated migrations로 `applyOnly`를 호출합니다.
- 다른 사용자 table만 있으면 defect로 실패합니다.
- 사용자 table이 없으면 schema bootstrap, ledger 생성, migration ID 기록을 시도합니다.

`applyOnly`는 ledger의 `CREATE TABLE IF NOT EXISTS` → `SELECT id` → 완료 ID skip 순서입니다. 미완료 migration은 transaction 안에서 `up(tx)`를 실행한 뒤 **반드시 ledger INSERT**를 실행합니다. generated 목록은 **48개**입니다. [apply·applyOnly 전체 분기](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/chunks/config-hkzp38b2.js:21), [generated 목록](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/chunks/config-fzbr8qt8.js:147)

따라서 다음 조건을 모두 만족한 **실제 `Exit.Success`**라면, 소스상 다음 추론이 가능합니다.

> 엄격한 READONLY 연결이 ledger INSERT를 거부하고, 공식 effect를 수정하거나 실패를 숨기지 않았다면, 성공한 호출에서는 미완료 migration transaction이 완료될 수 없다. 이 설치 버전의 48개 ID가 이미 기록되어 skip된 경로여야 한다.

같은 source·migration 목록·DB 파일 집합·bytes·관찰 격리를 유지하면, 다음 `apply`도 같은 skip 판단을 합니다. 단, 이것은 **“미완료 `up` 실행이 필요하지 않다”**는 증명입니다. `apply` 호출이나 ledger DDL statement 자체가 사라진다는 뜻은 아닙니다.

**READONLY 연결에서 기존 ledger에 대한 `CREATE TABLE IF NOT EXISTS`가 성공하는지는 이번에 실행하지 않았습니다.** 소스만으로 runtime acceptance를 확정할 수 없습니다.

**4. B에는 공식 타입 불일치와 위험한 migration이 있습니다.**

공식 선언은 `Migration.up`, `apply`, `applyOnly` 모두 `Global.Service`를 요구합니다. Database와 SqlClient만 제공하는 구성으로는 이 요구 타입이 해소되지 않습니다. [공식 타입](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/types/database/migration.d.ts:7)

runtime에서는 모든 ID가 완료되어 있으면 `Global.Service` lookup에 도달하지 않을 수 있습니다. 그러나 `20260805200742_import_legacy_credentials`가 미완료이면 다음 순서입니다.

1. `Global.Service`를 가져옵니다.
2. `global.data/auth.json`을 읽습니다.
3. 내용을 decode합니다.
4. credential/KV 쓰기를 시도합니다.

**파일 읽기는 SQL 쓰기 거부보다 먼저입니다.** Global을 제공하면 SQLite READONLY만으로 이 접근을 막을 수 없습니다. 정확히 Global이 없는 context에서는 service lookup이 실패하므로 해당 파일 읽기에 도달하지 않지만, 이것은 공식 타입 요구를 충족하는 구성은 아닙니다. [credential migration](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/chunks/config-a6k6eb26.js:34)

48개 `up` 정의에서 이 migration만 외부 파일 읽기 경로를 확인했습니다. 다른 migration은 SQL 중심입니다. 그래도 읽기 전용 실패 경로에는 다음 동작이 도달할 수 있습니다.

- `BEGIN deferred`, rollback과 migration 로그.
- `foreignKeys:false` migration의 connection PRAGMA 변경 및 복원.
- `up` 내부의 schema 조회.
- READONLY가 깨졌을 때 실행될 destructive SQL.

실제 destructive 정의에는 Session/event 이력 삭제와 table 삭제가 있습니다. **쓰기 가능한 복사본으로 fallback하면 이 후보의 의미가 바뀝니다.** [이력 삭제](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/chunks/config-9a4afbnw.js:5), [Session table 재구성·삭제](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/chunks/config-sdp7kfr6.js:119), [transaction 처리](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/chunks/config-rx4f2zay.js:48)

**5. import와 acquisition도 완전히 inert하지 않습니다.**

확인한 구체 경로는 다음과 같습니다.

- **Global import:** HOME/XDG 경로를 계산하고 `Flock.setGlobal({state})`로 모듈 상태를 변경합니다. import만으로 directory를 만들지는 않습니다. Global layer acquisition은 `mkdir`와 `realpath`를 수행합니다. [Global](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/util/dist/global.js:12)
- **Drizzle import:** query class prototype에 Effect wrapper를 설치합니다. 기본 acquisition은 no-op cache/logger와 DB 객체를 구성합니다. 기본 Database layer는 별도이며 PRAGMA와 migration을 실행하므로 사용하면 안 됩니다. `layerFromClient`도 같은 초기화 경로입니다. [prototype 변경](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/drizzle-orm/effect-core/query-effect.js:4), [기본 Database 초기화](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/chunks/config-yds56wag.js:35)
- **SQLite acquisition:** Bun 구현은 네 flags를 constructor에 전달하고 close finalizer를 등록합니다. `disableWAL:true`는 WAL 설정 statement를 생략합니다. 하지만 layer 출력에는 **SqlClient와 Native 모두** 포함됩니다. “외부 context는 Database/SqlClient만”이라는 조건에는 별도 출력 제한이 필요합니다. [Bun acquisition](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/database/sqlite.bun.js:59), [layer 출력 타입](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/types/database/sqlite.bun.d.ts:13)
- **간접 native addon import:** `Reactivity` barrel → `AtomRpc` → `RpcClient` → `RpcSerialization` → `msgpackr` 경로가 있습니다. Bun 조건의 `msgpackr/node-index.js`는 import 시 `msgpackr-extract`를 require하려고 합니다. 그 loader는 filesystem 탐색과 `.node` 로드를 할 수 있습니다. **`MSGPACKR_NATIVE_ACCELERATION_DISABLED=true`를 첫 import 전에 설정해야 이 소스 경로가 skip됩니다.** [Reactivity barrel](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/effect/dist/unstable/reactivity/index.js:28), [native addon 시도](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/msgpackr/node-index.js:10), [loader filesystem 탐색](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/node-gyp-build-optional-packages/node-gyp-build.js:31)

HTTP/RPC 정의도 간접 import됩니다. 확인한 경로에서 import나 SQLite acquisition만으로 provider 요청 또는 HTTP 요청을 실행하는 근거는 없었습니다. 이것을 “네트워크 관련 모듈이 전혀 로드되지 않는다”로 표현하면 틀립니다.

Bun 구현의 flags 동작을 Node/workerd로 일반화할 수도 없습니다. Node 구현은 `create`/`readwrite`를 constructor에 전달하지 않고, workerd는 path로 DB를 열지 못합니다. [Node 구현](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/database/sqlite.node.js:53), [workerd path 거부](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/database/sqlite.workerd.js:98)

**6. ledger와 schema completeness는 B 성공으로 검증되지 않습니다.**

설치 소스에서 공식 `MigrationTable`/`__drizzle_migrations` Drizzle table export는 찾지 못했습니다. 공식 `Migration` 타입은 migration 정의 타입이며 ledger row 타입이 아닙니다. ledger는 migrator가 직접 SQL로 처리합니다.

완료 판단은 **ID membership만** 사용합니다. `time_completed`, migration 내용 hash, table/column/index/constraint 일치를 확인하지 않습니다. 추가·미지 ID도 거부하지 않습니다. 따라서 48개 ID가 기록되어 있어도 손상된 schema는 skip될 수 있습니다. [완료 판단](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/chunks/config-hkzp38b2.js:43)

구체적인 남은 반례는 다음과 같습니다.

- ledger에 모든 ID가 있지만, Pending/Inbox에는 `id` column만 남은 빈 table이 존재: A의 ID-only 조회와 B skip은 전체 schema 정상성을 증명하지 못합니다.
- legacy `session` table과 현재 table이 함께 존재하며 KV가 비어 있음: B는 현재 schema migration을 skip할 수 있지만, 별도 legacy data migration은 여전히 required입니다. [legacy 판정](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64/node_modules/@opencode/core/dist/database/v1-migration.bun.js:390)
- selected Session 필드는 정상처럼 보이지만 transcript 상태가 불완전함: A가 읽지 않은 row 내용은 검증 범위 밖입니다.

따라서 A+B는 선택한 상태와 migrator skip 판단을 확인하는 후보입니다. **임의로 손상된 DB의 전체 schema·lifecycle 검증기는 아닙니다.**

**7. 필요한 synthetic probe는 다음과 같습니다. 이번에는 실행하지 않았습니다.**

초기 architecture 승인 이후, 원본 경로를 받지 않는 별도 inspector에 synthetic 복사본만 제공해야 합니다.

| probe | 필요한 관찰 |
|---|---|
| 정상 current schema + 48개 완료 ledger | 네 flags로 공개 `apply` 실행. 기존 ledger DDL acceptance, 실제 `Exit.Success`, `up`·ledger INSERT 미실행 확인 |
| 완료 ID 하나 누락 | 검사 실패. READONLY 쓰기 차단 확인. writable fallback 없음 |
| credential migration ID만 누락 + Global 없음 | service lookup 실패. `auth.json` 접근 시도 없음 |
| ledger 없음 / empty ledger / 두 legacy ledger 형식 / empty DB / Session 없는 nonempty DB | 각 분기가 거부됨. 오류를 성공·빈 결과로 변환하지 않음 |
| 빈 parent, child/root claim, orphan Pending/Inbox, malformed KV value | 모두 탐지. Pending/Inbox/KV의 payload/value decode 없음 |
| SQL `NULL`, JSON `"null"`, malformed·불완전 fork | `.all()`과 `.values()`의 차이 확인. 선택한 정책에 따른 명시적 거부 |
| 전부 완료된 ledger + 손상 schema·미완료 transcript | 제한된 검사 통과를 전체 호환성으로 보고하지 않음 |
| 정상 종료·실패·interruption | scoped close와 process 종료 확인. DB/WAL/SHM의 생성·변경·삭제 및 외부 파일/네트워크 접근 기록 확인 |

source·migration 목록·Bun 조건·복사본 전체 파일 집합을 고정해야 합니다. native addon 차단 변수도 첫 import 전에 고정해야 합니다. SQL 오류와 defect를 포함한 전체 실패를 검사 결과로 받아야 합니다.

**최종 판정은 A의 공개 조회 가능, B의 조건부 skip 증명 가능, B의 공식 context 타입 불일치, import 시 native addon 경로 존재입니다. READONLY DDL acceptance와 파일 부작용은 synthetic probe가 필요한 미검증 항목입니다.**
