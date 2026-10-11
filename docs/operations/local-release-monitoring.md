# 로컬 출시·운영·관찰 계약

**v0.4 · 2026-09-28 · Electron macOS/Windows app-owned sidecar · review required**

대상은 PRD v0.6의 한 사용자·한 기기 macOS/Windows Electron 워크벤치와 sandboxed renderer, trusted Electron main/preload boundary, app-owned OpenCode v2 `serve` sidecar, 로컬 DB다. Electron은 사용자가 명시적으로 선택했으며, exact package/OS lifecycle evidence는 아직 없다. 검증 계약과 UX 명세를 함께 판정한다. 로컬 앱도 사용자가 설정한 원격 모델/MCP에는 연결할 수 있다. 운영 신호·개인 지표는 **기기 안에만 저장**하며 Sentry, PostHog, 계정, 외부 telemetry·자동 업로드를 추가하지 않는다.

This is the local desktop release/operations design. Packaging, data path, retention defaults, SDK/UI versions, OS notifications, and background behavior require runtime evidence. This personal unsigned build does not establish public distribution, signing/notarization, or update-service readiness. Documents and mocks are not release evidence.

## 로컬 수명과 소유

| 단계 | 소유 동작 | 완료·실패의 근거 |
| --- | --- | --- |
| 첫 실행 | 작업 루트·로컬 DB/객체 저장 위치·보존 설정을 사용자에게 공개하고 설정한다. Electron main process launches and supervises the app-owned OpenCode `serve` process and exposes only its narrow typed renderer API through preload. | Exact packaged Electron/OS sender, payload and sidecar lifecycle checks; no sidecar credential exposed to renderer or preview |
| 정상 시작 | DB schema와 백업 상태 확인 → migration 필요 여부 판정 → host adapter 시작/연결 → native ID 매핑·process registry·pending approval 재조회 → snapshot 제공. | `sourceHealth`, schema version, native 연결, `snapshotRevision`을 별도 표시. 일부 실패를 전체 성공으로 덮지 않음 |
| 실행 중 | bridge가 경로·정책 admission과 side effect 일지를 소유하고 UI는 관측 상태를 표시한다. Workspace mutex는 앱 요청만 직렬화한다. | `accepted`와 `effect_confirmed`, `interrupt_requested`와 `terminated`를 분리; 실제 파일/프로세스 조회로 확인 |
| UI 탭 종료 | 탭 연결만 끊는다. bridge/native/PTY/dev server가 계속 돌면 각각 소유 상태와 수명을 유지하거나 종료 시도를 기록한다. | 탭 부재를 process 종료 증거로 쓰지 않음; 재접속 snapshot에서 실제 상태 확인 |
| bridge 종료 | 신규 mutation admission 중지, 진행 중 작업·자식·process의 종료 요청과 실제 확인/불확실 상태 기록, DB flush·backup 무결성 확인. | 강제 종료·crash면 `unknown`/`orphaned`를 남기며 과거 mutation을 재실행하지 않음 |
| 재시작 | 새 이벤트 구독→저장 cursor→snapshot/native 조회→저장 event 재생·dedupe→차이·gap 표시. | 순서가 바뀐 낮은 revision으로 상태가 후퇴하지 않음; native 미제공 구간은 `history_gap` |

bridge/실행 서비스가 꺼진 동안 자동화는 실행되지 않는 잠정 계약이다. **UI 탭만 닫아도 bridge가 살아 있으면 scheduler는 계속 실행한다.** 사용자 요청 중단도 실제 `terminated` 확인 전까지 `interrupt_requested`다. provider 인증·원격 모델·MCP 수명은 기존 런타임의 소유이고, 앱은 연결 상태와 실패 원인만 관찰한다. `AUTH_REQUIRED`·`AUTH_FAILED`를 bridge 건강과 혼동하지 않는다.

## 업데이트·migration·되돌리기

1. 업데이트 후보마다 앱 commit/build, lock hash, OpenCode v2/assistant-ui/tool-ui 고정 버전, DB schema, 대상 OS/선택 shell, 이전 빌드와의 export/import 호환성을 기록한다. 자동 업데이트는 범위에 없으며 실제 배포 방식은 S-10 뒤 정한다.
2. 업데이트 전 진행 중 run·자식·PTY·dev server·job due 상태를 조회한다. 활성 side effect가 있으면 종료와 영수증 대조를 완료하거나 업데이트를 보류한다. 단순 탭 닫기는 종료 조건이 아니다.
3. 데이터 저장소를 기기 내부의 접근 제한 경로에 두고, migration 전에 schema version·checksum을 적은 로컬 백업을 만든다. 백업에는 secret을 새로 복사하지 않고, 백업의 접근 권한·보존/삭제 범위를 설정에서 밝힌다.
4. migration은 versioned transaction으로 적용하고 결과 schema·row 수·foreign key/native mapping·샘플 snapshot을 검사한다. 실패하면 이전 데이터 백업으로 **읽기 전용 복구**를 제공하고 mutation admission을 닫는다. 실패 중 생성된 파일/프로세스 효과는 별도 대조한다.
5. 구버전 앱으로의 rollback은 그 빌드가 현재 schema를 읽을 수 있다고 입증된 경우에만 허용한다. 스키마를 되돌릴 수 없으면 업데이트 전 백업과 이전 빌드를 짝지어 복구하고, 업데이트 이후의 새 기록·효과가 빠질 수 있음을 먼저 명시한다.
6. bridge/host 버전과 DB가 어긋나면 새 실행을 막고 sourceHealth에 이유를 띄운다. 구버전 host로 새 schema를 추측해 쓰거나 자동 복구를 위해 과거 tool call을 재전송하지 않는다.
7. 실제 사용자 프로젝트 파일·Git commit·외부 provider/MCP 부작용은 앱 DB rollback으로 되돌아가지 않는다. 복구 화면은 로컬 기록 복원과 외부 효과 재확인을 별도 항목으로 제시한다.

업데이트·rollback 연습은 작은 합성 DB와 repo에서 실제 백업/복원, 중간 kill, 이전 빌드 재시작, 재조회 결과까지 확인한다. 결정하지 않은 데이터 경로/기본 보존 일수/패키징을 숫자로 채우지 않는다.

## 보존·삭제·비밀 경계

로컬 DB에는 ID·시각·상태·출처·마스킹된 payload 등 재동기화와 진단에 필요한 최소 메타데이터를 둔다. 원본 프롬프트, 전체 첨부, 프로젝트 파일 내용, 원본 도구 출력은 일반 event에 넣지 않는다. 사용자가 별도 선택한 원문 객체는 로컬 보존 정책을 적용한다. 저장 위치, 사용량, 보존 기간, 삭제 대상, 백업 잔존 여부를 설정에서 보여주며 기본 기간 값은 구현 전에 사용자·플랫폼 선택으로 확정한다.

기록 삭제는 프로젝트 디스크 삭제와 다른 transaction이다. 진행 중 run/권한/자식과 연결된 증거는 안전 종료와 삭제 범위 재확인을 거친다. 보존 만료도 현재 실행의 idempotency/permission 근거를 깨뜨리지 않도록 안전 시점을 정의해야 한다. 외부 provider, MCP, Git remote, 사용자가 만든 export 파일은 앱의 로컬 삭제가 지우지 못한다고 명시한다.

보이는 내용의 GC 후에도 실행 namespace가 유효한 동안 최소 `operation/digest/status` tombstone은 보존해 이전 mutation·승인을 다시 실행하지 않게 한다. 이 최소 근거까지 삭제할 때는 namespace와 pending/capability를 무효화하고 오래된 ID/키를 거절한다. 전체 초기화는 활성 실행을 종료·대조한 뒤 installation epoch를 교체하며, 재가져온 자료에는 새 앱 ID를 부여하고 과거 작업을 replay하지 않는다. 이러한 절차와 남는 외부 효과를 삭제 확인 화면에 보여준다.

export는 schema/앱·SDK 버전, 선택 범위, 원문 포함 여부, 마스킹 필드, 예상 크기, 대상 경로, 외부 보존 한계를 미리 보여준다. secret·provider credential·환경 변수 원문·임의 프로젝트 디렉터리는 기본 제외한다. 임시 파일→checksum 검증→원자적 이동→목적 파일 재조회까지 성공 조건이다. import는 크기·checksum·schema·경로 이탈·ID 중복을 검사해 새 앱 ID와 provenance를 부여하고, 실행 중 process·권한 승인·과거 side effect를 되살리지 않는다.

로그·진단 자료는 명시적 allowlist의 `objectId`, operation ID, source/error code, effectState, policy revision, 버전, duration, count만 기본 수집한다. 절대 경로는 기본 해시/상대 표기로 충분한지 검토하고, 사용자가 복구를 위해 전체 경로가 필요한 화면에서만 노출한다. 명령 인자·첨부 이름·프롬프트·도구 입력/출력·환경 변수·Authorization header·bootstrap fragment·provider 응답 원문은 로그에 남기지 않는다. 예외 stack은 경로/토큰을 마스킹해 경계를 보존한다. UI의 진단 export는 포함 범위와 마스킹 샘플을 미리 보여주고 사용자가 고른 로컬 파일에만 쓴다. 자동 업로드나 외부 알림은 없다.

진단 fixture에는 토큰 모양 문자열, 환경 변수, 실제처럼 보이는 경로, 프롬프트, HTML, 도구 출력에 각각 표식을 심어 DB/event/PTY 로그/알림/export에서 검색한다. 마스킹 성공은 샘플 한 곳이 아니라 모든 출력 경계에서 확인한다. 비밀이 유출된 실제 사건이면 노출 경로와 파일을 닫고 credential 소유자에게 회전을 안내하되 앱이 원격 계정을 임의 변경하지 않는다.

## 로컬 신호와 대응

모든 신호의 목적지는 로컬 상태 패널·앱 내 알림·선택적 로컬 진단 일지다. OS 알림이 허용되어도 민감 본문은 빼고, 거절되면 앱 안의 대기를 유지한다. 한 명의 사용자가 운영 소유자이며, 복구 판단이 모호하면 해당 기능의 신규 mutation을 멈추고 코디네이터/분석 역할에 재현 근거를 넘긴다. 외부 수신자·서버·대시보드는 없다.

| 신호·출처 | 발동 조건과 범위 | 즉시 대응·회복 확인 |
| --- | --- | --- |
| bridge/host 연결 건강: `sourceHealth`, `/snapshot` | 시작/재연결 시 불가, 또는 마지막 성공 이후 상태 조회 실패. 단일 UI 탭의 네트워크 오류와 host 종료를 구별. | 새 mutation 보류, bridge/host 실제 process와 자격 상태 확인, 재구독·snapshot 재조회. 정상 health와 현재 객체 대조 뒤 해제 |
| 효과 불명: `tool_calls.effectState`, operation 일지 | `dispatched` 이후 receipt 없이 crash/timeout, 또는 snapshot과 일지 불일치가 1건이라도 발생. | 자동 retry 금지, 대상 파일/Git/process/native 영수증 수동 대조, `unknown` 유지 또는 근거로 `reconciled`; 영향별 새 operation만 허용 |
| 권한 불일치: pending/revision/native 조회 | 오래된 승인 적용 시도, 정책 축소 뒤 새 위험 도구 1회, native와 bridge effective revision 불일치. | 위험 실행 admission 닫기, 자식/pending까지 재조회, 저장 규칙 취소·재평가. 허용 밖 side effect 0회와 revision 영수증 확인 전 재개 금지 |
| 경로 변동·삭제 위험: `PATH_CHANGED`, `DIRTY_WORKTREE`, `ACTIVE_OWNER` | destructive 요청 직전 identity/dirty/소유 값 변화 1건. | 작업 중단, 실제 경로·Git·process 재검사, 사용자에게 새 check 보여줌. 이전 token 폐기와 자료 보존 확인 |
| 이벤트 구멍: `history_gap`, cursor/snapshot | app sequence hole 또는 native 비활성 구간 1건. | 현 상태 재조회, 누락 구간 표시, 과거 사실 생성 금지. 새 이벤트와 snapshot 일치 확인; gap 자체는 남김 |
| 프로세스 잔존: registry와 OS 조회 | stop 요청 후 exit 미확인, 재시작 뒤 소유 불명 process 1개. | PID만 믿지 않고 시작 시각·cwd·소유 ref 대조, orphan 표시·수동 중단 경로 제공. 실제 종료 확인 전 `exited` 금지 |
| migration/저장소: schema·checksum/쓰기 오류 | 업데이트 검사 실패, transaction 실패, 백업 검증 실패 1건. | mutation 잠금·읽기 전용, 원본/백업 보호, 이전 호환 빌드로 복구. schema와 snapshot·row 무결성 확인 |
| 자동화: due-slot ledger | 예정 시각에 bridge 비활성, paused, 중복 slot, 실패/unknown. | `missed`를 기록하고 소급 실행하지 않음; 사용자가 새 실행을 명시해야 함. 같은 slot effect 1회 이하와 다음 due 확인 |
| 비밀/진단 누출: allowlist 검증 | 토큰/원문 fixture가 event/log/알림/export에서 1회 발견. | 해당 export/진단 경로 중단, 로컬 파일 범위 조사·삭제, 마스킹 수정과 전 경계 재검증. 외부 provider 자료는 별도 안내 |

알림에는 `작업/세션 ID`, 상태, 시각, 복구 화면 링크만 넣는다. 민감 파일명·명령·본문을 푸시/OS 알림에 넣지 않는다. 숫자 임계값은 근거가 없는 가용성/SLA로 만들지 않고, 자료 손실·권한·중복 효과는 **단일 사건**으로 출시 차단한다. 일반 지연은 같은 기기·버전·작업 종류의 기준 분포를 수집한 뒤 정상 변동과 비교한다.

### 진단 기록의 최소 형태

진단은 실제 사건과 통제된 시험을 구별해 로컬에 기록한다.

| 필드 | 기록 규칙 |
| --- | --- |
| 사건 식별 | 임의 로컬 incident ID, 시작/발견/회복 시각, `real` 또는 `synthetic` |
| 환경 | 앱 build/commit, schema, SDK/UI 버전, OS/Electron version, local desktop artifact |
| 대상 | project/workspace/session/run/child/tool/permission/job의 앱 ID; native ID는 별도 매핑 |
| 증상 | 사용자가 본 상태, 오류 code, sourceHealth, effectState, 정책 revision, 일지 sequence |
| 영향 | 파일·Git·process·외부 provider/MCP 부작용의 `none/confirmed/unknown`, 관련 작업 수 |
| 근거 | 마스킹된 영수증, snapshot revision, 비교한 전후 digest와 로컬 evidence 경로 |
| 조치 | admission 보류, 재조회, 종료 확인, backup/rollback, 사용자 재실행 여부와 담당자 |
| 종결 | 회복 조건의 실제 확인, 남은 history gap·orphan·외부 보존, 후속 AC/검사 |

`unknown`을 0건으로 계산하지 않는다. 동일 사건의 여러 event는 operation ID와 sourceRef로 묶어 중복 사고처럼 세지 않는다. 진단 export에는 이 필드들의 허용값과 마스킹 결과를 먼저 보여주고 원본 로그 전체를 기본 포함하지 않는다.

## 복구 절차

1. 사용자는 상태 패널에서 대상 `project/workspace/session/run/child/tool/permission/job`, sourceHealth, 앱·SDK 버전, 마지막 확인된 operation과 effectState를 확인한다.
2. 읽기만 가능한 snapshot·파일/Git/process/native pending 조회로 실제 상태를 재구성한다. 앱 기록과 외부 상태가 다르면 어느 쪽이 권위인지 [아키텍처](../engineering/workbench-architecture.md)의 객체별 소유 규칙을 따른다.
3. mutation이 `unknown`이면 같은 idempotency key로 실행을 다시 보내지 않는다. 파일 hash·Git index/HEAD·process identity·permission receipt 등 해당 작업의 효과를 확인하고, 확인 불가이면 자료를 보존한 채 사용자가 새 작업을 명시하게 한다.
4. permission 전환은 `requested → admitting_paused → draining → applied → effective`의 현재 단계와 영향받는 자식/pending을 확인한다. `transitioning`은 UI 설명일 뿐 정책 권위 상태가 아니다. 적용 실패면 이전 effective 규칙을 명확히 표시하고 위험 호출은 보류한다.
5. 누락 이벤트는 현재 snapshot과 영속화된 app event까지 재생한 뒤 `history_gap`으로 남긴다. 읽기 목록을 복원했다고 과거 도구의 전체 event trail을 복원했다고 말하지 않는다.
6. 복구 후 원인, 영향 범위, 이미 발생한 side effect, 수행한 조치, 현재 소스 버전, 회복 근거, 잔여 불확실성을 로컬 incident 기록에 남긴다. 같은 실패를 막는 AC/검증 케이스와 담당자를 연결한다.

안전한 완화는 위험 기능의 admission 중단, 관련 job pause, UI 읽기 전용, 문제 버전의 업데이트 보류다. rollback은 백업·schema/빌드 호환과 외부 효과를 확인한 뒤 선택한다. provider 장애는 `AUTH_REQUIRED`/`AUTH_FAILED`/원격 불가 원인으로 남기고 로컬 데이터 손상으로 취급하지 않는다.

통제된 운영 연습은 후속 구현 run에서 같은 합성 fixture로 실행한다. bridge만 종료했을 때 job이 `missed`가 되는지, UI 탭만 닫고 bridge가 살아 있을 때 다음 slot이 실행되는지 각각 본다. 업데이트 중 migration을 중단한 뒤 이전 schema의 읽기 전용 복구가 되는지 확인한다. `effect-then-crash`에서는 effect counter와 `unknown`을 대조한다. preview 공격과 secret canary 결과는 별도 보안 근거로 보존한다. 연습이 실패하면 재현·완화·재시험을 완료할 때까지 그 빌드를 출시 후보로 올리지 않는다.

## 자동화 수명과 놓친 일정

각 `Job`은 `jobId`, workspace, schedule, timezone, `policyRevision`, paused, `nextDueAt`, `lastRunId`를 갖고 due slot을 `jobId + schedule revision + 예정 시각`으로 식별한다. 실행 직전에 경로 identity, effective policy, credential 상태를 재검사한다. 같은 slot의 동시 dispatch는 하나의 operation key만 생성하며 `dispatched` 뒤 crash는 effect `unknown`으로 보관한다.

bridge가 꺼져 있던 기간의 slot은 재시작 시 `missed`로 기록하고 **자동 소급 실행하지 않는다**. paused 중 due는 실행하지 않으며 상태와 다음 예정 시각을 보여준다. 사용자가 `재개`하면 다음 미래 slot부터 적용한다. 과거 slot을 수행하려면 대상·권한·효과를 보여주는 별도의 명시적 실행이 필요하다. DST/시간대 변경과 시계 뒤로 이동도 같은 slot을 다시 실행시키지 않아야 한다. OS 백그라운드 보장은 S-10과 패키징 선택 전 주장하지 않는다.

## 출시 체크리스트와 판정

- [ ] S-01–10을 고정 버전·OS·합성 fixture에서 수행하고 capability, adapter, 보류 결론을 기록했다. S-10에 따라 실제 플랫폼 수명·알림·데이터 경로를 확정했다.
- [ ] AC-01–18 각각의 성공/실패와 PRD 7개 통합 흐름이 [검증 계약](../engineering/verification.md)의 현재 소스 근거로 통과했다. UI E2E, 실제 SDK, 권한/경로 부작용은 별도 증거다.
- [ ] 형식/lint/type/unit/integration/E2E/hook의 실제 명령, 종료 코드, 실행 환경, 건너뛴 이유가 구현 run에 기록됐다. 패키지 스크립트 미존재를 통과로 쓰지 않았다.
- [ ] 악성 preview, untrusted import, 정책 우회, 경로 race, 중복 승인, dispatch 뒤 crash, orphan, missed job, secret fixture의 단일 사건 차단을 확인했다.
- [ ] 백업·migration 실패·읽기 전용 복구·이전 빌드 rollback을 합성 데이터에서 실제 연습했고, 사용자 데이터/외부 effect 한계를 화면에서 설명한다.
- [ ] 로컬 로그·export/알림의 마스킹, 보존·삭제 범위, 원격 provider/MCP 전송 대상이 사용자에게 확인 가능하다.
- [ ] 독립 제품·코드·디자인 검토의 중대한 미해결 지적이 없고, 패키징·버전·권한 강제·경로 안전성의 결정이 확인됐다.

권한 우회, 잘못된 경로 변경·삭제, 데이터 유실, 중복 부작용, 프리뷰의 bridge 접근, 비밀 유출은 출시 차단이다. S-05의 읽기/계획 강제나 S-02의 경로 제약을 입증하지 못하면 해당 모드/전략을 활성화하지 않고 필수 AC의 출시 완료도 주장하지 않는다. 문서 승인과 코드·런타임 출시 판정은 별개다.

## 개인 활용·학습 지표

제품 목적은 개인 실제 작업과 하네스 이해다. 분모는 고정한 관측 창에 **시작한 모든 시도**이며, 완료·실패·사용자 취소·진행 중을 별도로 보고한다. 진행 중 시도를 성공률에서 임의 제외할 때는 보류 건수와 사유를 함께 표시한다. 모두 기기에 로컬로 기록하며 합성/실제 작업을 구별한다. 첫 사용 전 기준선과 관측 기간은 비어 있으며, 소수 시도는 통계적 효과나 시간 절감 주장에 쓰지 않는다.

| 지표 | 분모·관측 창 | 분자·기록 방법 | 판정과 미상 |
| --- | --- | --- | --- |
| CLI 없이 정상 흐름 | PRD 시나리오 1–4 각각에서 관측 창에 시작한 모든 시도 수; 같은 앱 빌드의 개인 평가 창을 날짜로 고정 | 각 시나리오를 끝까지 완료했고 별도 CLI 조작이 없던 시도 수; 실패·취소·진행 중과 앱 밖으로 간 이유·단계도 기록 | 목표는 1–4의 각 흐름을 완료할 수 있음. 첫 빌드의 분모·기준 시간은 아직 없음 |
| 흐름 소요·회복 | 시작/종료 시각이 있는 시도 수; 동일 작업 유형·버전 창 | 시도별 elapsed time, 오류 후 정상 상태까지 시간, 복구 실패 건수 | 평균 절감률을 약속하지 않음; 중단·대기·원격 provider 지연을 구분 |
| 잘못 이해한 상태 | 실행 전 사용자가 다음 상태를 예측해 기록한 시도 수; 버전별 창 | 실제 상태/권한/부작용과 달랐던 예측 수 및 이유 | 빈 예측은 분모 밖으로 따로 보고; UI 문구 개선의 단서이지 시장 지표가 아님 |
| 학습 문항 | 합성 읽기 예제와 실제 위임 작업에서 4문항씩 답한 평가 세트 수; 동일 설명 버전 | 각 세트에서 모델·도구, 권한 실행 근거, 부모·자식 관계, 요청/기본/관측 차이를 근거와 함께 채점 | **각 세트 4개 중 3개 이상, 권한 근거 문항 필수**. 숨겨진 사고 과정 복원·cache/성능 추정은 목표 아님 |
| 근거 신뢰성 | 완료로 표시된 run·검증·리뷰 항목 수; 빌드별 창 | 현재 `sourceRevision`·명령/영수증/독립 verdict로 뒷받침되는 항목 수 | 분모 0은 미측정, 증거 누락은 `no_evidence`; 목표 비율은 실측 전 설정하지 않음 |

개인 지표 기록은 사용자가 전체 원문을 내보내지 않아도 검토할 수 있는 로컬 요약으로 만든다. 익명 집계나 상업 KPI를 만들지 않는다. 평가 실패는 설명·상태 표현·복구 흐름의 개선 대상으로 남기며 승인 없이 제품 범위를 줄이지 않는다.
