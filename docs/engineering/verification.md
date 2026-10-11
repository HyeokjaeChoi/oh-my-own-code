# 개인 에이전트 워크벤치 검증 계약

**v0.5 · 2026-09-28 · Electron macOS/Windows app-owned sidecar · review required**

이 문서는 [PRD v0.6 Electron desktop amendment](../product/prd.md)의 AC-01–18, [실행 아키텍처](workbench-architecture.md)의 앱 계약과 S-01–10, [UX 명세](../design/specs/workbench-ux.md)의 표시·접근성 조건을 검증 가능한 행동으로 바꾼다. [domain-specs 계획 revision 2](../runs/domain-specs/plan.md)과 [통합 사례](../runs/domain-specs/integration-cases.md)는 역사적 설계 입력이다. 현재 작업 순서와 승인 상태는 [desktop bootstrap 계획 revision 18](../workplans/desktop-app-bootstrap/plan.md)과 그 계약이 정의한다. 여기의 검사·명령·증거는 **미래 구현 계획**이며 현재 실행 결과가 아니다.

## 증거의 층위와 판정

| 층위 | 검증 목적 | 통과로 주장할 수 있는 것 |
| --- | --- | --- |
| 순수 규칙 단위 | 경로 보호 분류, 상태 전이, ID/스키마·마스킹, 일정 슬롯 계산 | 해당 입력에 대한 결정. OS·SDK·실제 파일 부작용은 제외 |
| bridge 통합 | 임시 합성 repo/SQLite/프로세스에서 요청, 동시성, 영수증과 side effect 대조 | 사용한 OS·구현 경계의 실제 효과와 복구. mock만으로 권한 강제 주장 금지 |
| UI E2E | 실제 renderer에서 assistant-ui/tool-ui와 synthetic bridge를 연결해 사용 흐름·키보드·좁은 화면 확인 | 관측된 renderer 흐름. 백엔드 정책 강제는 별도 통합 근거 필요 |
| Desktop E2E | Packaged Electron app startup, main/preload/renderer sender boundary, preview isolation, app-owned OpenCode v2 `serve` lifecycle, close/restart and exact child reaping on macOS and Windows | Separate observed behavior of the exact packaged Electron build on each OS only; browser bridge tests and cross-build output are not desktop/other-OS proof |
| 고정 버전 SDK spike | OpenCode v2, UI 라이브러리의 실제 API·수명·권한·중단 확인 | 시험한 버전·환경의 native 행동. 다른 버전 일반화 금지 |
| 운영·릴리스 | 패키징·마이그레이션·재시작·오류 주입 후 복구 확인 | 특정 빌드의 출시 판단 자료. 문서 검토로 대체 불가 |

각 결과에는 `AC/S-ID`, fixture digest, 앱 commit·패키지 lock hash·SDK/UI 버전, OS/브라우저, 실행 명령, 시작 상태, 실제 side effect 전후 값, 종료 코드, 로그/화면 근거 경로, 미검증 경계를 남긴다. `Evidence`의 `sourceRevision`과 현재 소스가 다르면 `recheck_required`; 명령이 실행되지 않았으면 `not_run` 또는 `no_evidence`다. agent 발화, 초록 아이콘, mock의 성공만으로 `passed`가 되지 않는다. 실패가 변경 전부터 있었는지 기준 revision에서 확인해 따로 기록한다.

작업이 위험한 규칙·상태·권한을 바꾸면 실제 실패 행동을 먼저 재현하고 동일 대상에서 수정 후 통과를 본다. syntax/setup 오류는 유효한 RED가 아니다. fixture의 기대값은 구현 결과에서 복사하지 않는다. 모든 편집에 동일한 E2E 묶음이나 일괄 coverage 목표를 강요하지 않는다.

## AC별 수용 시나리오

표의 `성공 / 실패`는 **각각 별개의 시나리오**다. `효과`는 파일·프로세스·권한·원격 호출의 전후 관찰을 뜻한다. `합성`은 실제 사용자 자료를 복제하지 않는 임시 fixture다.

| AC | 성공·실패 시나리오 | 경계와 예상 효과 | 필수 증거·합성 fixture |
| --- | --- | --- | --- |
| AC-01 | 성공: 일반 폴더, Git repo, 외부 worktree를 등록하고 canonical 중복을 합친다. 실패: 깨진 worktree·접근 거절·악성 setup/plugin 파일을 가진 repo를 가져오거나 승인 뒤 설정 digest가 바뀐다. | bridge 경로/Git inspector + UI E2E; 성공은 등록 레코드만 증가, 실패는 실행·파일 이동·Git init 0회. trust는 config/plugin/setup digest에 묶이고 외부 변경 시 활성화 전 무효화. | `S-03`; symlink alias, broken `.git` pointer, setup/plugin·Git fsmonitor/helper/hook marker를 가진 합성 repo와 digest 교체. 표식 부재와 경로/원본/branch/쓰기 상태 화면. |
| AC-02 | 성공: 빈 이름은 선택된 작업 루트의 자식에 UUIDv7 fallback 또는 확인된 SDK 기본 이름으로 만들고 branch를 재조회한다. 실패: 동일 이름 동시 요청·권한 거절·setup 실패·전략의 부모 경로 이탈. | bridge + 실제 파일/Git + `S-02`; `targetPath`는 정확한 새 경로이며 `parentPath/desiredName`과 배타적, 기존 경로는 import. 충돌 덮어쓰기 0회, setup 실패는 생성 경로 보존·`created_setup_failed`. | 고정 시각/UUID seed, 쓰기 거절 부모, 목적지 바꾸는 strategy, 두 동시 생성. 요청·실제 경로와 marker/content 전후, SDK 버전. |
| AC-03 | 성공: 등록 해제·기록 삭제는 디스크를 보존한다. 깨끗한 worktree, dirty/untracked 손실을 별도 승인한 force worktree, import된 일반 폴더의 물리 삭제는 각각 확인한 절대 경로만 제거하고 branch는 기본 유지한다. 실패: 기본 비강제 dirty 삭제, 활성 자식/프로세스, 원본/작업 루트 자체와 조상·중첩 프로젝트·변경된 symlink를 거절한다. | bridge/Git/OS 통합 + 확인 UI; force는 손실 파일 목록·절대 경로 재확인 필수. 취소·실패 시 파일 유지, 실제 삭제 직전 identity·소유·dirty 재검사. 앱 mutex 밖 외부 writer 차단 보장은 주장하지 않음. | `S-02/09`; dirty/untracked worktree, import 일반 폴더, 보호 트리, 두 세션, 외부 rename/symlink 교체, 종료되지 않은 server. delete-check digest, 확인 target·force 여부, 종료 증거, 파일/branch 전후. |
| AC-04 | 성공: 다른 workspace의 두 세션을 병렬 실행·전환·재시작해 draft, unread, 승인 소속을 유지한다. 실패: 한 경로 소실·늦은 이벤트가 다른 세션 카드에 도착한다. | app projection/bridge/실브라우저 E2E; 다른 입력·승인 적용 0회, 사라진 경로는 `missing`. | 두 서로 다른 nonce의 합성 대화, event reorder, 재시작 snapshot, 각 `sessionId/workspaceId` 화면·DB 대조. |
| AC-05 | 성공: 전송 컨텍스트 미리보기, 지원 입력, 스트림·편집 후 분기·중단을 확인한다. 실패: 과대/불허 첨부와 미지원 입력을 전송 전 막고, side effect 뒤 메시지 재시도는 과거 도구를 재실행하지 않는다. | UI E2E + bridge/native `S-07/09`; 실패는 원격 전송·중복 파일 변경 0회, 중단 요청과 종료 확인 분리. | 합성 첨부, 제한 경로, 계수 파일을 쓰는 도구, provider 호출 계수·run/branch ID·효과 전후. |
| AC-06 | 성공: 런타임 목록에서 agent/model/effort를 택해 요청·기본·관측과 다음 적용 경계를 표시한다. 실패: 미지원 effort와 실행 중 경계 불일치를 조용히 대체하지 않는다. | 고정 SDK `S-01` + UI; 미지원 값은 dispatch 0회, 관측 전 성공 표시 0회. | 능력 목록이 바뀌는 fake catalog와 실제 고정 SDK 응답, run config snapshot·UI 문구. |
| AC-07 | 성공: 빈 컨텍스트 두 자식을 병렬 실행해 각각 결과를 회수한다. 실패: 한 자식 실패·대기열 초과·부모 중단에서도 다른 결과와 종료 상태를 섞지 않는다. | app orchestrator + native `S-04`; history fork는 fresh로 표시하지 않고, child 권한·payload 전달을 실제 관측. | 서로 다른 nonce/파일 범위의 두 자식, fork에만 남은 과거 표식, 권한 축소, 동시성 1/2 설정; tree·native payload·effect 확인. |
| AC-08 | 성공: 검증된 schema 도구 카드와 직접 호출이 동일 권한·취소·일지 경로를 지나간다. 실패: 미등록/schema 불일치 카드가 안전한 일반 표시로 남고 중복/타 세션 action을 거절한다. | bridge admission + tool-ui E2E + `S-06/07`; 거절 시 도구 효과 0회, untrusted HTML 실행 0회. | 알려진/알 수 없는 도구, XSS 문자열, 같은 `toolCallId` 중복·다른 policy revision action, effect counter·DOM 확인. |
| AC-09 | 성공: 단일 승인과 저장 규칙 취소, `requested → admitting_paused → draining → applied → effective` 축소를 자식까지 확인한다. 실패: 시스템 deny·중복/만료 승인·이전 revision pending·임의 shell/plugin 우회를 차단한다. | 실제 side effect를 보는 bridge/native `S-05`; 축소 중 새 위험 실행 0회, 이미 발생한 효과는 보존·표시. 강제 불가능한 preset은 비활성. | 허용 경로 안팎 marker, 진행 중 취소 불가 호출, pending child, 두 승인자 race, policy revision별 영수증. |
| AC-10 | 성공: 로컬 dev server와 파일/URL 프리뷰를 열고 포트·소유 process·실패·외부 열기를 구분한다. 실패: 악성 preview 페이지가 bridge API/credential에 닿지 못하고 임베드 차단을 성공으로 표시하지 않는다. | 실제 브라우저 보안 시험 `S-08` + UI E2E; 제어 API 부작용 0회, server stop은 실제 종료 근거 필요. | preview의 fetch/WS/postMessage 시도, 다른 origin과 host 공유 cookie 실험, CSP/Origin/Host/자격 결과·process 재조회. |
| AC-11 | 성공: 파일 버전 일치 저장·정확한 workspace stage/commit과 확인된 diff를 본다. 실패: 외부 편집 충돌·다른 worktree 선택·복원 전 digest 변경을 거절한다. | 임시 두 worktree Git 통합 + UI; 원본/타 worktree 변경 0회, 충돌 자료 보존. | 같은 이름 다른 내용의 파일, 외부 writer, staged/unstaged/기준 branch, index/HEAD/file hash 전후. |
| AC-12 | 성공: 여러 PTY 탭에서 cwd·주체·resize·입출력·종료 코드를 확인한다. 실패: 탭 닫기 뒤 살아 있는 process와 재시작 뒤 orphan을 종료로 오표시하지 않는다. | OS process registry + PTY/UI `S-09`; stop 후 실제 exit 확인, 고아는 명시적 수동 경로. | 오래 실행되는 합성 child process, 탭 종료, bridge crash; process identity·종료 코드·출력 redaction. |
| AC-13 | 성공: app/runtime/project/skill 명령을 출처와 인자 도움말로 선택해 실제 target에 실행한다. 실패: 동일 이름 충돌·잘못된 인자·busy·취소와 모르는 `/` 문자열을 shell로 보내지 않는다. | command registry + native `S-06` + 팔레트 E2E; 실패 시 shell/process 생성 0회. | 충돌 이름 `status`, 인자 schema 불일치, marker shell 명령, command receipt/출처/target 화면. |
| AC-14 | 성공: 구성 초안→검증→diff→명시 적용→reload→active 조회, MCP 연결/해제를 추적한다. 실패: 변환 미지원 포맷·인증 실패·악성 plugin을 자동 실행/연결하지 않는다. | 합성 구성 통합 + 고정 native `S-03/06`; 실패는 active 설정 불변, 설치·process 시작 0회. | 합성 AGENTS/skills/hooks/MCP/plugin, 비밀 더미, reload 오류; 파일 hash·active config 조회·process 목록. |
| AC-15 | 성공: 승인된 계획 버전, 명령 종료 코드, 독립 리뷰 지적/재검증을 해당 run에 연결한다. 실패: agent의 `완료` 발화나 과거 sourceRevision의 통과 증거를 현재 통과로 만들지 않는다. | Evidence 저장 규칙 단위 + UI E2E; 잘못된 검증 성공 상태 0건. | v1/v2 소스, 실패/통과 exitCode, 미해결 리뷰, 증거 누락; 현재 revision과 badge 비교. |
| AC-16 | 성공: 시간순 필터와 원본 링크, `reported/estimated/unavailable` usage, 합성 학습 답·근거를 본다. 실패: 누락 usage·청구액 추정·역순 이벤트를 확정값/완전 기록으로 표시하지 않는다. | event projection 단위 + UI E2E; 민감 원문 일반 event 저장 0건. | out-of-order/duplicate/gap event, 미제공 token, 합성 예상/오답; DB row·화면·redaction 대조. |
| AC-17 | 성공: 새 구독→cursor→snapshot/native 재조회→dedupe 후 재열기, 선택 범위 export/import·삭제를 확인한다. 실패: dispatch 뒤 crash·누락 live event·손상 archive·삭제된 실행 namespace의 오래된 키에서 자동 재실행/가짜 이력/부분 덮어쓰기를 막는다. | bridge crash·DB migration/export 통합 `S-09` + UI; effect unknown 유지, 복구 불가 구간 명시. 내용 GC는 최소 operation/digest/status tombstone을 유지하고 full reset은 종료·대조 뒤 installation epoch를 교체한다. | effect counter 뒤 receipt 전 kill, event hole, checksum/경로 이탈 archive, secret marker, 오래된 ID/키; 효과 횟수·manifest·파일 hash. |
| AC-18 | 성공: 키보드/스크린리더·설정·비밀 없는 알림과 로컬 job pause/resume을 쓴다. 실패: 서비스 중단 중 due slot은 `missed`, 알림 거절은 앱 안 pending, 같은 slot 중복 이벤트는 1회만 처리한다. | 실제 UI 접근성 + scheduler/clock 통합 `S-10`; missed 자동 backfill 0회, 비밀 본문 알림 0건. | 고정 timezone/DST clock, 중단/재시작, notification denied, reduced motion, 좁은 viewport; due ledger·focus·접근성 tree. |

## 횡단 위험과 출시 통합 흐름

PRD 7개 통합 시나리오는 AC별 검사와 별도로 실제 화면에서 순서대로 수행한다: (1) 빈 이름 생성→대화→프리뷰→재열기, (2) 외부 worktree→두 세션/자식→diff/검증/commit, (3) 허용·사용자 거절·정책 거절·기억 취소·축소, (4) 명령→tool-ui→PTY/서버→프리뷰, (5) 위험 삭제 차단→종료→재검사, (6) 단절/재시작/이중 승인→gap·중복 방지, (7) 구성/MCP→증거→export/import/삭제→job 미실행. 각 흐름은 실행한 기능 전체의 현재 버전 증거를 가리키며 한 흐름의 통과로 다른 AC의 실패를 덮지 않는다.

보안 회귀 묶음은 preview-origin/Host/WS/CSRF/credential 누출, 경로 symlink·rename·중첩, 사용자/시스템 deny, schema action 재전송, untrusted 설정 무실행, 로그·export 마스킹을 다룬다. 순수 단위 검사는 분기 판단을 빠르게 확인하지만 **허용되지 않은 파일 변경이 실제로 없었다는 관측**은 합성 repo와 OS 경계에서 해야 한다. Workspace mutex는 앱 요청끼리만 직렬화한다; 외부 프로세스 race의 잔여 위험과 지원 OS별 조건부 파일 조작 가능 여부를 출시 판단에 남긴다.

### 합성 fixture 설계와 관찰점

아래 fixture는 후속 구현 run에서만 만든다. 실제 사용자 저장소·프롬프트·credential은 복사하지 않는다.

1. `plain-folder`: 일반 폴더에 표시 이름과 다른 실제 절대 경로를 둔다.
2. `repo-source`: 원본 Git repo의 HEAD, dirty, untracked, ignored 파일을 분리한다.
3. `worktree-a/b`: 같은 repo의 다른 branch와 동일 파일명의 다른 내용을 둔다.
4. `external-worktree`: 앱이 생성하지 않은 기존 worktree와 깨진 metadata 변형을 둔다.
5. `alias-path`: 같은 경로의 symlink·대소문자 alias와 상위/하위 등록 경로를 둔다.
6. `hostile-import`: 읽기만 해도 실행될 수 있는 setup/plugin 선언에 marker 쓰기 명령을 둔다.
7. `name-collision`: 고정 시각·UUID 생성기와 두 동시 요청으로 동일 목적지를 경쟁시킨다.
8. `escape-strategy`: worktree strategy가 요청 부모 밖 목적지를 제안하게 만든다.
9. `path-race`: delete-check 뒤 부모 rename·symlink 교체·외부 편집을 주입한다.
10. `effect-counter`: tool·shell·job 실행마다 파일 counter를 늘려 재실행 횟수를 관찰한다.
11. `effect-then-crash`: counter 변경 후 영수증 쓰기 전에 bridge를 중지한다.
12. `pending-race`: 같은 권한 요청에 두 결정·만료·이전 revision 응답을 보낸다.
13. `child-isolation`: 부모에만 있는 history nonce와 각 자식별 입력 nonce를 둔다.
14. `bad-schema`: 카드 입력/출력의 누락 필드, 큰 payload, HTML/script 문자열을 둔다.
15. `evil-preview`: preview origin에서 bridge fetch·WS·postMessage를 시도한다.
16. `event-hole`: native 구독을 끊고 sequence gap, 중복, 역순 app event를 만든다.
17. `orphan-pty`: 탭을 닫고 bridge를 죽여 살아 있는 child process를 남긴다.
18. `archive-corrupt`: export checksum 오류, path traversal, 중복 native/app ID를 넣는다.
19. `secret-canary`: token·환경 변수·프롬프트 모양의 무해한 문자열을 각 출력 경계에 심는다.
20. `clock-slots`: timezone/DST/시계 역행과 bridge 중단 구간에 due slot을 만든다.

fixture마다 생성 스크립트의 digest와 예상 side effect를 시험 전에 고정한다. marker가 나타나지 않았다는 사실만으로 안전을 주장하지 않고, 그 공격 입력이 실제 admission 또는 renderer 경계를 통과하려 했다는 요청/거절 근거도 함께 남긴다. 시험 중 생긴 로컬 임시 파일과 process는 종료·제거를 확인하되 실패 조사에 필요한 hash/영수증은 보존 범위에 따라 기록한다.

### 상태·권위 불변식

- `AppProject`는 등록 관계이며 `Workspace`는 실제 경로다. 여러 `Session`이 같은 `Workspace`를 쓰면 삭제 소유 검사에 모두 포함된다.
- 앱 UUIDv7와 native ID는 별개다. native ID 누락은 새 세션으로 몰래 대체하지 않고 `orphaned` 매핑과 이유를 남긴다.
- `requested`, `effective`, `observed`는 다른 값이며 UI는 적용·관측 전 성공을 앞당기지 않는다.
- `Idempotency-Key`는 caller, session/workspace, operation kind 범위와 payload digest를 함께 검사한다.
- 동일 키·동일 입력 재전송은 기존 operation을 반환하고 다른 입력은 `IDEMPOTENCY_CONFLICT`다.
- `PATH_CHANGED`에서 이전 delete-check·restore token은 폐기하고 새 확인을 받는다.
- `POLICY_DENY`, `USER_DENY`, `AUTH_REQUIRED`, `AUTH_FAILED`는 서로 다른 원인과 복구 조작으로 표시한다.
- 정책 축소의 `requested/admitting_paused/draining/applied/effective`는 UI의 단일 `전환 중` 라벨과 별개다.
- 새 자식의 history·권한·모델은 관측된 payload로 설명하고, 기존 자식에 부모 확대가 자동 전파된다고 가정하지 않는다.
- 자동화의 `missed`는 원래 due slot의 기록이며 `completed`나 새 실행으로 변형하지 않는다.

### 판정 시 놓치기 쉬운 구분

- import 성공과 trust/activation 승인은 다른 operation이다. import fixture의 무실행을 별도 계수로 확인한다.
- worktree 생성 성공과 setup 성공은 다른 상태다. setup 실패 뒤 경로·branch·dirty 자료가 남아 있는지 본다.
- 등록 해제, 기록 삭제, 물리 삭제는 서로 다른 대상·영수증을 남긴다.
- UI 탭 닫기, stop 요청, OS process exit는 각각 다른 근거다.
- 직접 도구 호출과 agent 호출은 caller가 달라도 동일 실행 정책을 지나야 한다.
- preview를 외부 브라우저에서 열 수 있음은 앱 안 preview 성공의 대체 근거가 아니다.
- native live stream 재연결은 과거 누락 event의 완전한 replay를 의미하지 않는다.
- mock 통과, 실제 SDK 호출, 실제 브라우저 E2E, OS side effect 차단, Figma 접근은 별도 상태로 기록한다.

동시성·crash 묶음은 같은 caller/session/workspace/operation kind 범위의 동일 `Idempotency-Key` 재요청과 다른 payload 충돌, 다른 session의 키 독립성, 두 동시 생성, delete-check 뒤 identity 변경, 결정 CAS, dispatch 뒤 receipt 전 kill, event 역순/중복/누락, process orphan을 포함한다. `202`는 접수일 뿐이며 receipt·실제 상태 재조회 전 UI 성공 금지다. 효과가 불확실하면 `unknown`과 수동 대조를 유지하고 mutation 자동 retry를 금지한다.

접근성 E2E는 브라우저 개발 모드와 **실제 macOS·Windows용 Electron 패키지 각각**에서 키보드만으로 핵심 흐름을 수행하고 inline 권한 카드에서는 일반 탭 이동, 모달에서만 focus trap, 닫힘 후 focus 복원, 세션 이름이 포함된 상태 알림, 긴 절대 경로·명령의 전체 값 접근, 좁은 화면과 reduced motion을 확인한다. 브라우저 검사만으로 데스크톱 접근성을 대체하지 않는다. 단순 DOM 존재·자동 검사만으로 스크린리더 경험을 통과 처리하지 않는다.

## 실행 순서와 미래 체크 연결

현재 저장소에는 앱 패키지 스크립트가 확정되지 않았다. 구현 첫 slice에서 `package.json`의 실제 이름·실행 환경을 확정한 뒤 아래 **제안 명령**을 조정하고 run 계획에 등록한다. 지금 명령이 존재하거나 실행됐다는 주장이 아니다.

| 계획 체크 | 미래 명령 예시와 트리거 | 남길 결과 |
| --- | --- | --- |
| 형식·정적 분석 | `pnpm format:check`, `pnpm lint`, `pnpm typecheck`; 영향 slice의 PR 전 | 각각 명령·exitCode·commit·lock hash. 스크립트 미존재는 N-A 사유와 구현 작업으로 기록 |
| 규칙 회귀 | `pnpm vitest run <risk-test-file>`; 경로/정책/상태/스케줄 로직 수정 때 | 위험별 RED 재현과 GREEN, fixture 버전, 영향 경계 |
| bridge 통합 | `pnpm vitest run <integration-test-file>`; side effect·adapter·DB 수정 때 | 실제 임시 파일/프로세스/DB 전후, SDK mock 여부 |
| UI E2E | `pnpm e2e <journey>`; 사용자 흐름·assistant-ui/tool-ui/접근성 변경과 릴리스 전 | 브라우저/viewport/빌드, 화면·접근성 근거, bridge 효과 연결 |
| 호환성 spike | S-01–10별 고정 패키지/OS 실험 명령을 구현 run에 등록 | SDK 호출·side effect·불가 능력과 대안 판정; fixture 통과와 별개 |
| hook 연동 | pre-commit에 빠른 형식/영향 단위, pre-push/CI에 lint/type/영향 통합·E2E 선택; 실제 hook 설치와 실행을 별도 확인 | hook 트리거·실행 명령·skip/실패 기록. hook 파일 존재만으로 자동 실행 주장 금지 |

코디네이터가 후속 구현 run에서 체크 이름을 등록하고 `python3 .solopreneur/harness.py check <run-id> --name <check-name>`으로 실제 결과를 남긴다. RED는 의도한 행동 경로가 실패한 근거이지 완료 게이트가 아니다. 수정 후 같은 체크 이름의 GREEN과 영향 회귀를 기록한다. 포맷/lint/type/unit/integration/E2E는 각각 선택·수동·N-A 및 이유로 표시하고, 독립 코드·디자인 검토와 릴리스 시나리오를 별도 판정한다.

출시 차단은 권한 우회, 잘못된 경로 변경·삭제, 데이터 손실, 중복 부작용, 프리뷰의 bridge 접근, 증거 없는 성공 표시, 미해결 중대한 독립 검토 지적이다. S-01–10 중 기능의 강제 경계를 확정하지 못한 항목은 해당 기능의 출시 수용 기준을 통과시킬 수 없다. Electron과 macOS/Windows 대상은 확정되었습니다. 정확한 버전 pin, 실행 가능한 스크립트, 플랫폼별 런타임 결과는 아직 검증되지 않았습니다.
