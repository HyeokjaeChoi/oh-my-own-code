# Author 01a1075e-39f1-7300-b422-1267bc0e2555

**권고: 공식 `@opencode/server/process` wrapper를 격리된 prototype으로 검증하십시오.** OpenCode `2.0.18`을 유지하고, 기존 `@opencode/client`의 HTTP 경계를 유지합니다. 이번 결과는 계획 분석입니다. 구현 승인이나 P7 완료 판정이 아닙니다.

읽기와 정적 hash 검사만 수행했습니다. 파일 변경, 위임, 설치, OpenCode/Electron/GUI/provider 실행은 하지 않았습니다.

- plan rev6, contract v5, packet의 SHA-256이 일치합니다.
- `coherent-source-freeze-v5-r8.json`의 **35개 파일 모두 일치**합니다.
- 현재 contract는 **11개 required checks**입니다. Main이 보고한 10개 PASS와 `native-storage` FAIL을 함께 유지합니다.
- `native-r1`의 유일한 failed requirement는 `native-event-history`입니다. 정상 종료·owned SIGKILL 이후 transcript, sentinel, mapping 근거는 보존합니다.
- historical owner proof와 production nonfresh fresh-only preflight는 별도 hold입니다.

**후보 비교**

| 후보 | 판단 | 이유와 남은 비용 |
|---|---|---|
| 공식 server wrapper | 우선 검증 | `events.persist:true`, 절대 DB 경로, HTTP listener를 직접 설정할 수 있습니다. runtime, native dependencies, 인증, child 종료 근거가 필요합니다. |
| Promise SDK | 이번 범위에서 제외 | embedded host이며 startup에서 `resumeSuspendedSessions`를 시작합니다. 현재 HTTP·no-auto-replay 조건과 맞지 않습니다. |
| Effect SDK override | 후속 대안 | recovery service 교체가 가능하지만 startup 의미와 host 경계가 바뀝니다. 별도 설계가 필요합니다. |
| CLI upgrade | 해결책으로 채택하지 않음 | 저장된 `2.0.22` 소스도 CLI에서 events 옵션을 전달하지 않고 Bus 기본값은 false입니다. routine upgrade만으로 해결되지 않습니다. |

공식 server `start`는 Promise 함수가 아니라 **`Scope`가 필요한 Effect**입니다. wrapper는 scoped runtime을 계속 유지하고, 종료 시 그 scope를 닫아야 합니다. `lifecycle`을 생략해도 전체 startup이 안전하거나 읽기 전용이라는 뜻은 아닙니다.

**제안 실행 범위와 ownership**

새 run의 기준 경로는 `docs/runs/opencode-event-host-feasibility/`입니다. 아래 파일은 **신규 제안 경로**이며 아직 만들지 않았습니다.

| 담당 | 소유 파일 | 순서 |
|---|---|---|
| Main | `plan.md`, `contract.json`, `design.txt`, decision register, ledger | run 등록과 독립 plan/design review |
| 단일 prototype writer | `prototype/package.json`, lockfile, `host.mjs`, `probe.mjs`, `freeze.mjs`, `verify.mjs` | review 이후 구현 |
| 같은 writer | `prototype/runtime-manifest.json`, `prototype/input-manifest.json`, `prototype/cases/**` | 입력·runtime·fixture 고정 |
| 독립 readers | review 결과 | 구현자는 자신의 결과를 승인하지 않음 |
| Main | `evidence/**`, 최종 통합 판정 | 정확한 hash와 결과 등록 |

`apps/**`, root dependencies, 기존 registry/journal, packaged CLI, 기존 P7 fixture는 수정하지 않습니다. prototype은 하나의 OpenCode engine만 시작합니다.

`docs/runs/**`는 harness의 source inventory에서 제외됩니다. 따라서 `environment_files`에 다음을 **개별 경로로** 등록해야 합니다.

- prototype source와 각 case 파일
- `package.json`과 lockfile
- runtime/input manifest

manifest에는 runtime executable hash, package integrity, 설치된 runtime 파일·native binary·WASM·migration asset의 inventory를 기록합니다. 각 check의 시작과 끝에서 실제 파일을 manifest와 비교합니다. 결과 파일은 입력 manifest에 포함하지 않습니다.

**Acceptance와 실행 명령**

아래는 새 contract에 등록할 **제안 명령**입니다. 기존 실행 가능한 명령이라는 뜻은 아닙니다. 모든 check의 `cwd`는 새 run 디렉터리입니다. `node` runner도 절대 경로와 hash로 고정합니다. 실제 engine child runtime은 `runtime-manifest.json`에서 읽습니다.

| ID | 통과 조건 | 제안 명령 |
|---|---|---|
| EH-01 | 기존 35파일 freeze 유지, prototype 입력·runtime·dependency inventory 일치 | `node prototype/verify.mjs --case inputs` |
| EH-02 | 고정 runtime에서 공식 package import, scoped start, 인증된 ready, 종료 성공 | `node prototype/probe.mjs --case runtime` |
| EH-03 | loopback·인증·config·permission·경로 격리 검증 | `node prototype/probe.mjs --case isolation` |
| EH-04 | 단일 child ownership, 중복 시작 차단, exact exit 확인 | `node prototype/probe.mjs --case ownership` |
| EH-05 | 실제 nonempty history, sequence 0, exclusive cursor, head·payload hash 검증 | `node prototype/probe.mjs --case events` |
| EH-06 | 정상 종료 후 같은 DB/session/event history·sentinel 유지 | `node prototype/probe.mjs --case normal-reopen` |
| EH-07 | owned SIGKILL 후 commit된 history·sentinel 유지 | `node prototype/probe.mjs --case owned-sigkill-reopen` |
| EH-08 | synthetic nonfresh startup에서 queued/suspended 실행과 소비 없음 | `node prototype/probe.mjs --case startup-adversarial` |
| EH-09 | 고정 runtime/native assets를 포함한 격리 배포 디렉터리에서 동일 동작 | `node prototype/probe.mjs --case staged-runtime` |
| EH-10 | 전체 결과·종료 근거·hash binding 검증, missing/unsupported는 실패 | `node prototype/verify.mjs --case final` |

의존성 준비는 Main의 검토된 실행 단계에서만 합니다. 준비 방식은 isolated manifest와 lockfile을 먼저 고정하고 `npm ci --ignore-scripts`를 사용합니다. 필요한 native install/build hook은 정확한 package·script·출력으로 사전에 등록합니다. 실패했다고 root dependency를 추가하거나 package/runtime version을 자동 변경하지 않습니다.

**핵심 검증 요구**

1. **Runtime와 build**
   - Node 후보는 `node:sqlite`, `node:ffi`와 native PTY import를 실제로 검증해야 합니다. 기존 Node 테스트 PASS는 server import 증거가 아닙니다.
   - Bun은 별도 conditional imports와 FFI/PT​Y 경로를 사용합니다. Node 실패를 Bun PASS로 바꾸지 않습니다.
   - 동일 OpenCode `2.0.18`을 유지합니다. Bun 후보를 포함한다면 실행 전에 정확한 version/hash를 고정합니다.
   - 첫 성공 후 같은 runtime 하나로 나머지 checks를 수행합니다.
   - EH-09는 standalone staging 증거입니다. Electron package acceptance나 Windows runtime 증거로 이전하지 않습니다.

2. **인증·config·격리**
   - `127.0.0.1`, `port:0`, 임시 random password를 사용합니다. 공식 `start`는 password가 없으면 실패합니다.
   - password는 argv·로그·manifest에 넣지 않습니다. 제한된 parent-child IPC로 전달합니다.
   - 기존 `OpenCode.make({baseUrl, headers})`의 Basic authentication 경계를 사용합니다.
   - missing/wrong credentials, 허용되지 않은 Origin, pairing/ticket 우회 경로를 검증합니다.
   - synthetic HOME/XDG/config/cache/tmp와 절대 DB 경로를 사용합니다. 개인 환경과 credentials를 상속하지 않습니다.
   - `config.project:false`, contained config, `models.fetch:false`, filewatcher/fff 비활성화를 명시합니다.
   - permission deny와 plugin/MCP/provider 미설정을 검증합니다. 설정만으로 외부 효과 차단을 입증했다고 판정하지 않습니다.

3. **Ownership와 종료**
   - parent가 직접 child를 시작하고 실제 `ChildProcess` exit handle을 보존합니다.
   - spawn intent → child identity 기록 → 인증된 ready 순서를 기록합니다.
   - 정상 종료는 scope close → 실제 child exit → disposable cleanup 순서입니다.
   - SIGKILL은 이 실행이 소유한 child에만 적용합니다. PID absence·port close·IPC EOF를 exit proof로 사용하지 않습니다.
   - 종료 미확인이나 spawn-registration gap은 hold입니다. 같은 DB에 다음 child를 시작하지 않습니다.
   - 이 parent-observed proof는 standalone historical owner proof를 해결하지 않습니다.

4. **Event history**
   - 공식 HTTP API로 provider 없는 session 생성·metadata 변경 등 실제 durable event를 만듭니다. 가짜 event를 주입하지 않습니다.
   - full history는 `after`를 생략하고 `follow:false`로 조회합니다.
   - sequence 0을 확인합니다. `after:0`은 sequence 0을 제외해야 합니다.
   - 각 cursor `c`의 결과는 `seq > c`여야 합니다. head 이후에는 payload가 없어야 합니다.
   - payload와 `log.synced` marker를 분리합니다. marker-only는 실패입니다.
   - event ID/type/aggregateID/seq/payload의 canonical hash와 알려진 event 집합을 비교합니다.
   - native manifest가 비지원 event를 건너뛸 수 있으므로 무조건 연속 sequence를 요구하지 않습니다. 알려진 필수 event가 사라지면 실패합니다.
   - 정상 종료와 SIGKILL 후 같은 session의 commit된 history prefix, transcript hash, `keep.txt` 실제 내용, synthetic mapping을 비교합니다. crash 직전 미확정 요청을 성공으로 간주하지 않습니다.

5. **Startup adversarial**
   - queued prompt, steer inbox, suspended claim, pending shell/subagent를 case별 synthetic store로 준비합니다.
   - supported API로 생성할 수 없는 상태는 `unsupported/unseedable`로 기록합니다. SQLite table 수정으로 채우지 않습니다.
   - 보존된 seed의 별도 copy에서 startup과 명시된 read만 수행합니다.
   - 실행 시작/resume, inbox 소비, background 완료 처리, permission 승인, provider 요청 시도, 새 tool child, workspace sentinel 변경을 확인합니다.
   - 짧은 지연뿐 아니라 startup·첫 read·반복 read·bounded idle·shutdown 구간을 검사합니다.
   - DB migration/WAL 초기화 변경과 실행 상태 변경을 분리합니다. DB byte 변화만으로 replay 여부를 판정하지 않습니다.
   - auth-free PASS의 범위만 보고합니다. **production fresh-only preflight는 해제하지 않습니다.**

설계 초안은 다음과 같습니다.

:::writing{variant="document" id="58421"}
OpenCode event host feasibility — design draft v1

목적:
공식 OpenCode 2.0.18 server package가 persisted event history를 제공하는지 격리된 synthetic 환경에서 확인한다.

구조:
Probe parent → 단일 server wrapper child → 공식 OpenCode server/core.
Probe client → 기존 @opencode/client → 인증된 loopback HTTP.
Renderer와 app runtime은 연결하지 않는다.

Server 설정:
start에 events.persist=true, 절대 synthetic database.path,
config.project=false, contained config.directory,
models.fetch=false, hostname=127.0.0.1, port=0, 임시 password를 전달한다.
lifecycle과 transform은 생략한다.
Effect Scope를 서버 수명 동안 유지하고 종료 시 닫는다.

데이터 소유:
OpenCode가 native DB, transcript, inbox, event history를 소유한다.
앱 registry와 journal의 권한은 기존 계약을 유지한다.
Prototype mapping은 synthetic 검증 입력이며 앱 authority를 대체하지 않는다.

Startup:
기존 production preflight를 변경하지 않는다.
Prototype의 nonfresh reopen은 소유와 종료가 확인된 synthetic namespace에만 적용한다.
startup/read 과정에서 자동 replay, resume, permission approval을 허용하지 않는다.

실패:
marker-only history, 필수 event 누락, runtime import 실패,
경로 escape, 인증 우회, 자동 실행, 종료 미확인은 실패 또는 hold로 남긴다.
실패한 namespace와 원본 bytes를 보존한다.
자동 migration, cutover, engine patch, version fallback은 하지 않는다.

증거:
source/runtime/dependency hashes, exact commands, HTTP event hashes,
normal exit와 owned SIGKILL exit, DB/WAL inventory,
sentinel 확인, outbound/tool-effect 관찰과 coverage 한계를 기록한다.
Process crash 증거를 power-loss 보장으로 표현하지 않는다.

완료 범위:
독립 plan/design/code review와 EH checks는 feasibility 결과만 승인한다.
PRD v0.6 F-01–18과 P7 S1–S5, 기존 11 checks, package/native gates는 유지한다.
현재 packaged CLI acceptance를 새 host에 이전하지 않는다.
:::

**남은 consequential decisions**

| 결정 | 다음 작업에 미치는 영향 |
|---|---|
| 정확한 Node 후보와 Bun 비교 포함 여부 | EH-02 전에 runtime bytes와 후보 수를 고정해야 합니다. |
| native install hook·asset 수집 방식 | EH-09의 재현성과 packaging 비용을 결정합니다. |
| suspended/shell/subagent fixture 생성 가능 범위 | 생성·관찰할 수 없는 case는 EH-08 coverage 부족으로 남습니다. |
| provider 요청 시도·외부 효과 관찰 방식 | “credentials 없음”과 “실행 시도 없음”을 구분할 수 있어야 합니다. |
| 향후 packaged CLI를 wrapper로 교체할지 | 이번 prototype에서는 결정하지 않습니다. PRD/ADR의 실행 artifact 변경 검토와 새 acceptance가 필요합니다. |
| historical lifetime proof와 production nonfresh preflight | 기존 hold를 유지합니다. event persistence 성공만으로 해제하지 않습니다. |

**Main의 다음 단계는 이 초안을 새 run에 등록하고 독립 plan/design review를 받는 것입니다.** 이미 제시된 분석·격리 prototype 범위에 추가 사용자 permission barrier를 추론하지 않습니다.

