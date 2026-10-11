# Workbench 실행 아키텍처와 계약

**v0.6 · 2026-09-28 · Electron app-owned sidecar · independent review required**

이 문서는 [PRD v0.6 Electron desktop amendment](../product/prd.md)의 F-01~18을 구현하기 위한 앱 소유 계약이다. [desktop bootstrap 계획 revision 18과 계약](../workplans/desktop-app-bootstrap/plan.md)이 이 증분 작업의 순서와 승인 상태를 정의한다. 과거 domain-specs 계획은 역사적 입력이며 현재 승인 근거가 아니다. [UX 명세](../design/specs/workbench-ux.md)는 사용자에게 보이는 상태·조작의 기준이며, 여기서는 그 상태를 확정할 실행 근거를 정한다. 아래 `PROPOSED`는 앱이 만들어야 할 계약이지 OpenCode API의 존재나 실행 검증을 뜻하지 않는다. 패키지 설치, 런타임 호출, 보안 시험은 아직 수행하지 않았다.

## 1. 경계와 선택

| 계층 | 소유 책임 | 신뢰 수준 |
| --- | --- | --- |
| Electron main + preload | 앱 창, trusted local API/bridge, OS dialog/notification adapter, narrow host API admission, exact sidecar lifecycle | Main is the trusted local authority; renderer content is never trusted by origin alone; exact package/runtime enforcement remains to be verified |
| Sandboxed renderer | assistant-ui 대화, tool-ui 카드, 작업 문맥·검토·접근성 | 표시와 사용자 의사 입력. Node, shell, filesystem, child-process capability 없음 |
| Electron main local service modules | 요청 검증, 경로·권한 게이트, 실행 조정, 일지·복구, OpenCode client/adapter | 유일한 앱 실행 진입점. 자기 호출에도 같은 검증; no separate loopback service for desktop renderer |
| App-owned OpenCode v2 `serve` child | SDK-supported sessions/tools/events and native runtime behavior | Electron main starts and owns the exact child; renderer and preview never receive its URL credential |
| App operation modules | import, file/Git changes, direct tools, scheduler and explicit native gaps | Electron main admission and audit path; browser-only bridge is not desktop authority |
| 프로젝트 내용·preview·MCP·도구 결과 | 파일, 스크립트, 플러그인, 웹 콘텐츠와 출력 | 신뢰하지 않는 입력. 권한이나 renderer 선택의 근거 아님 |

Delivery target is an **installed Electron desktop app for macOS and Windows** with an app-owned OpenCode v2 `serve` sidecar. The user selected Electron after the comparison recorded in ADR-0002. Electron main is the trusted local API/bridge, owns the window and exact sidecar lifecycle, and runs the version-matched client. The versioned, narrow preload API replaces browser HTTP origin pairing for desktop requests. Do not expose sidecar credentials to renderer-wide code or untrusted preview contents. The main process is the sole authority for files, Git, PTY, process, permissions, audit, and recovery. Keep the existing HTTP bridge only as a separate explicitly supported browser mode; it is not part of packaged desktop request routing. No cloud API, Supabase, account/RBAC, or external telemetry is added. Existing remote-model/MCP boundaries remain unchanged.

OpenCode v2 runtime contract is an app-owned foreground `opencode serve` sidecar. Electron main connects only to its exact child using the version-matched [`@opencode/client`](https://opencode.ai/v2/docs/build/client/) API. Do not use the embedded SDK host or a shared-service helper because the user confirmed app-owned sidecar lifecycle. Main keeps server credentials private, verifies readiness and identity, and owns startup, shutdown, and reaping. The desktop UI calls typed main-process service modules through preload; it does not call an HTTP bridge directly. Pin the CLI and client versions together and check the experimental [HTTP API](https://opencode.ai/v2/docs/api) against the packaged server after the exact document set is approved. Electron is selected in ADR-0002; package compatibility remains unverified.

## 2. 정규 객체·저장·권위

앱 ID는 UUIDv7 형식의 불변 ID이며 native ID와 별도다. `AppProject`는 원본·일반 폴더를, `Workspace`는 실제 실행 경로(원본 checkout, 일반 폴더, Git worktree)를, `Session`은 대화·실행 소속을 뜻한다. `Run`은 사용자 요청의 한 실행 시도, `ChildDelegation`은 부모가 승인한 위임, `ToolCall`은 하나의 실제 도구 실행, `PermissionRequest`는 그 실행을 묻는 승인, `PolicyRevision`은 적용 가능한 규칙 스냅샷, `Artifact`는 경로 또는 산출물 참조, `Command`는 출처 있는 동작 정의다. 여러 Session이 Workspace를 참조할 수 있으므로 경로와 세션을 동의어로 쓰지 않는다.

| 로컬 기록 `PROPOSED` | 필수 필드·제약 | 권위·보존 |
| --- | --- | --- |
| `projects` | `projectId`, `displayName`, `sourceKind`, `canonicalRoot`, `importedAt`, `trustState` | 앱이 등록 관계를 소유. 실제 경로 존재는 재검사 |
| `workspaces` | `workspaceId`, `projectId`, `kind`, `canonicalPath`, `sourceRepoPath?`, `branch?`, `ownerStrategy?`, `setupState`, `pathIdentity` | Git·파일시스템 조회가 존재·상태의 권위 |
| `sessions` | `sessionId`, `workspaceId`, `nativeSessionId?`, `parentSessionId?`, `title`, `archived`, `pinned`, `unreadCursor`, `draft`, `viewState` | 앱 메타데이터와 native session을 명시적으로 매핑 |
| `runs` | `runId`, `sessionId`, `caller`, `requestedConfig`, `effectiveConfig?`, `state`, `startedAt`, `endedAt?`, `nativeTurnRef?` | native 상태 조회가 실행 완료의 권위 |
| `delegations` | `delegationId`, `parentRunId`, `childSessionId?`, `contextMode`, `payloadDigest`, `scope`, `queueState`, `resultRef?` | 앱 큐가 배치 소유; child 실행은 native 조회 |
| `tool_calls` | `toolCallId`, `runId`, `nativeCallRef?`, `schemaId?`, `inputDigest`, `target`, `effectClass`, `state`, `receipt?`, `policyRevision` | side effect와 결과를 별개 기록 |
| `permission_requests` | `requestId`, `nativeRequestRef?`, `toolCallId`, `policyRevision`, `scope`, `status`, `expiresAt?`, `decisionReceipt?` | native pending 조회와 앱의 결정 일지 모두 대조 |
| `policy_revisions` | `revision`, `sessionId`, `parentRevision?`, `rulesDigest`, `effectiveAt?`, `state` | 적용 확인된 revision만 effective |
| `events` | `eventId`, monotonic app sequence, `source`, `sourceRef`, `occurredAt?`, `observedAt`, `type`, `objectId`, `payloadVersion`, `redactedPayload`, `sourceDigest` | 앱이 관측한 사실. native 미제공 구간은 복원 불가 |
| `artifacts`/`commands`/`jobs` | owner IDs, provenance, path/schema digest, lifecycle, lastEvidence | 산출물·명령·자동화의 출처와 수명 추적 |

실제 구현은 bridge 전용 로컬 SQLite의 transaction + schema migration을 제안한다. DB 경로·보존 설정은 UI에서 공개한다. secret, 원본 환경 변수, 전체 첨부/도구 출력은 일반 event payload에 저장하지 않는다. 원문이 필요한 경우 사용자 선택 범위의 별도 로컬 객체 저장과 보존 정책을 적용하고 export 기본값에서는 제외한다. schema migration 전 백업·검증, 실패 시 이전 schema로 읽기 전용 복구가 필요하다. 로컬 DB는 SDK의 세션 저장소를 대신하지 않으며 native ID가 사라지면 `orphaned` 매핑과 이유를 남긴다.

표시용 기록의 보존 만료와 재실행 방지 기록의 수명은 분리한다. 내용 원문을 지워도 아직 유효한 실행 namespace에서는 operation ID·입력 digest·최종/unknown 상태의 최소 tombstone을 유지한다. 이 최소 기록까지 지우려면 해당 session/workspace의 실행 namespace를 폐기하고 pending 요청·capability를 무효화한다. 폐기된 namespace의 옛 ID/키 요청은 새 작업으로 접수하지 않고 거절한다. 전체 앱 데이터 초기화는 실제 실행을 먼저 종료·대조하고 새 설치 epoch를 만든다. 다시 import하면 새 ID로 명시적 실행을 시작하며 과거 native 요청을 replay하지 않는다. tombstone은 사용자에게 삭제 범위와 함께 설명하고 원문이나 자격 증명을 담지 않는다.

각 객체 조회는 `requested`(사용자가 요청), `effective`(bridge/native 확인), `observed`(실행 이벤트/결과)를 별도 필드로 낸다. 시간순 기록에는 `observedAt`을 기본으로 쓰고 native timestamp는 별도로 보존한다. 사용량은 native 제공값만 `reported`, 계산값은 `estimated`, 미제공은 `unavailable`로 표시한다. 계획·리뷰·검증은 agent 텍스트와 다른 `Evidence` 객체(`command`, `exitCode`, `sourceRevision`, `reviewer`, `verdict`, `artifactRef`)가 있어야 통과로 표시한다.

## 3. bridge API와 이벤트 `PROPOSED`

API는 앱 소유 `/api/v1`이며 OpenCode 경로가 아니다. 모든 쓰기는 `requestId`(호출 상관관계), `Idempotency-Key`, `expectedRevision` 또는 `If-Match`를 받는다. 응답은 `{operationId, state, object, revision, evidenceRefs, error?}` 형식이다. `202`는 접수이며 성공이 아니다. side effect 완료는 검증 영수증과 조회 결과가 맞을 때만 `succeeded`다. 멱등 키는 로컬 호출 주체·session 또는 workspace 범위·operation 종류로 namespace를 나눈다. 동일 범위의 동일 키·동일 digest 재요청은 기존 operation을 돌려주고, 동일 키·다른 입력은 `IDEMPOTENCY_CONFLICT`다.

| 사용자 동작 | app endpoint 제안 | 실행 경계 |
| --- | --- | --- |
| 경로 검토·등록·생성·제거 | `POST /paths/inspect`, `/projects/import`, `/workspaces`, `/workspaces/{id}/delete-check`, `/workspaces/{id}/delete`; `DELETE /projects/{id}/registration` | 경로 canonicalization, trust, 최종 identity·dirty 재검사 |
| 작업·대화·위임 | `/sessions`, `/sessions/{id}/runs`, `/runs/{id}/interrupt`, `/delegations`, `/delegations/{id}/interrupt` | native 매핑, 모델 입력, child scope, 실제 종료 확인 |
| 도구·권한 | `/tools/catalog`, `/tool-calls`, `/permission-requests/{id}/decision`, `/policies/{id}/transition` | schema, caller, native pending ID, 현재 revision, effect 정책 |
| 프리뷰·파일·Git·터미널 | `/previews`, `/files`, `/git/operations`, `/terminals`, `/processes` | 경로·version·프로세스 주체·실제 상태 |
| 명령·구성·계획 | `/commands/catalog`, `/commands/execute`, `/configuration/drafts`, `/configuration/apply`, `/plans`, `/evidence` | 출처·인자·검증·적용 조회 |
| 복구·기록·자동화 | `/snapshot`, `/events`, `/exports`, `/imports`, `/retention`, `/jobs`, `/jobs/{id}/pause` | 보존·redaction·권한·스케줄 상태 |

`GET /snapshot`은 DB 매핑, native session/worktree/pending request, bridge process registry를 조회해 `{snapshotRevision, sourceHealth, objects, gaps}`를 낸다. `GET /events?after=<seq>`는 앱이 영속화한 event만 재생한다. WebSocket/SSE는 live 알림이며 cursor 순서·중복 제거 뒤 snapshot과 대조한다. native 구독이 [live-only이며 자동 재생·재접속을 보장하지 않는다는 문서](https://opencode.ai/v2/docs/build/client/) 때문에 native 누락을 앱 event로 꾸며 채우지 않는다. 앱 일지 sequence에도 hole이 있거나 native 중단 기간이 있으면 `history_gap(from,to,reason)`을 영속화한다.

이벤트 envelope는 `{eventId, appSeq, type, objectType, objectId, projectId?, workspaceId?, sessionId?, runId?, childId?, nativeRef?, policyRevision?, operationId?, observedAt, payloadVersion, payload}`다. `accepted`, `started`, `approval_pending`, `effect_confirmed`, `interrupt_requested`, `terminated`, `failed`, `unknown`, `reconciled`는 다른 type이다. UI는 object ID로 분리된 projection을 만들고 active tab 전환으로 다른 세션의 draft/approval을 재사용하지 않는다. 앱 event는 관측 근거 링크를 제공하되 보안 강제의 증거 자체는 아니다.

### Desktop IPC and preview boundary

Electron's main process is the trusted desktop host and owns the app window, the exact app-launched OpenCode v2 `serve` child, its readiness/authentication lifecycle, and the version-matched `@opencode/client` connection. It must never attach to a pre-existing ambient server. The renderer uses a closed, versioned schema through a narrow preload `contextBridge`; enable context isolation and renderer sandboxing, disable Node integration, and expose named functions only. No arbitrary channel, Node object, shell, filesystem, process API, or sidecar URL/credential crosses into renderer. Main validates sender, frame, lifecycle, and payload shape; unexpected navigation and child windows are denied by default. Preview content runs without the privileged preload or sidecar credential and uses a separate browsing context. Exact Electron, Chromium, server, and packager versions plus per-OS behavior remain unverified until the approved probes run.

The renderer adapter is injected by the desktop bootstrap and has the same public app contract as the browser test adapter, but it does not inherit HTTP Origin/CORS pairing as its security proof. The selected host mediates messages to the app-owned OpenCode v2 `serve` process. Preview is a separate untrusted surface with no privileged host API or sidecar capability; allowed navigation, local URL behavior, CSP and external open actions are checked independently. Dev mode and packaged mode are separate trust configurations. A failed sidecar start leaves the app in a visible unavailable state and exposes no fallback direct renderer-to-sidecar credential.

### 상태 전이와 조회 권위

상태 값은 UI 문구와 1:1일 필요는 없지만 아래 의미를 합치지 않는다. 각 transition은 `operationId`, 이전/새 revision, 근거 source를 일지에 남긴다.

| 객체 | 허용하는 주요 전이 | 성공 판정과 충돌 처리 |
| --- | --- | --- |
| 프로젝트/경로 | `inspecting → connected|read_only|denied|missing`; `creating → created|created_setup_failed|failed`; `connected → deleted` | 파일 identity/Git 상태 조회 후 연결. `created_setup_failed`는 디렉터리 존재를 보존 |
| 세션 | `draft → queued → running → awaiting_approval|interrupt_requested|completed|failed|unknown`; `interrupt_requested → terminated|unknown` | native session/turn 재조회로 종료 판정. 접수만으로 완료 금지 |
| 자식 위임 | `queued → running → awaiting_approval|partial|completed|failed|interrupt_requested`; 이후 `terminated|unknown` | 부모와 별도 결과·오류. 부모 종료가 child 실제 종료를 증명하지 않음 |
| 도구 | `admission_pending → approval_pending|running|denied`; `running → effect_confirmed|failed|cancel_unconfirmed|unknown` | receipt와 후속 관측이 있어야 effect 확인. 오류는 부분 효과를 포함 가능 |
| 권한 요청 | `pending → decision_sending → applied|denied|expired|cancelled|unknown` | native pending ref·revision CAS. terminal 상태 뒤 재응답 불가 |
| 정책 | `effective → requested → admitting_paused → draining → applied → effective`; 중간 `transition_failed` | 모든 영향 scope 적용 증거 필요. 불확실하면 신규 위험 호출 보류 |
| 검증/리뷰 | `not_run → running → passed|failed|no_evidence`; 수정 시 `recheck_required` | 현재 source revision과 실행/독립 검토 증거 필요 |
| 프로세스/연결 | `starting → running|failed`; `running → stop_requested → exited|orphaned|unknown`; 연결 `connected → disconnected → resyncing → connected|gap` | OS PID만으로 소유 증명 불가. 종료 코드/실제 process 재조회 |
| 자동화 | `scheduled → running → completed|failed|unknown`; `scheduled → paused|missed` | due slot과 job revision 묶음. miss는 소급 실행 금지 |

이 표의 `denied`는 정책 차단과 사용자 거절을 원인 코드에서 분리한다. 요청을 취소하거나 UI 탭을 닫아도 이미 진행 중인 도구 상태가 바뀌었다고 추정하지 않는다. `unknown`은 실패를 감추는 임시 성공이 아니라 영향 확인을 기다리는 별도 종착/복구 상태다.

## 4. 오류·멱등·복구 계약

오류는 `{code, message, objectId, operationId, retryable, effectState: none|confirmed|unknown, evidenceRefs, recoveryAction}`으로 낸다. `POLICY_DENY`, `USER_DENY`, `AUTH_REQUIRED`, `AUTH_FAILED`, `PATH_MISSING`, `PATH_ESCAPE`, `PATH_CHANGED`, `DIRTY_WORKTREE`, `ACTIVE_OWNER`, `CONFLICT`, `INVALID_SCHEMA`, `UNSUPPORTED_CAPABILITY`, `RUNTIME_UNAVAILABLE`, `CANCEL_UNCONFIRMED`, `PARTIAL_SETUP`, `EFFECT_UNKNOWN`, `GAP_DETECTED`를 구별한다. 4xx/5xx만 보고 재시도하지 않는다.

변경 작업은 `planned → validated → admitted → dispatched → reconciled → succeeded|failed|unknown`으로 기록한다. `dispatched` 뒤 crash가 나면 side effect가 발생했을 수 있으므로 **자동 재실행하지 않고 `unknown`**으로 복구한다. bridge는 native operation ID, 경로·Git 상태, 파일 version, 프로세스 ID, permission receipt 등 작업별 관측값으로 대조한다. 충분한 영수증이 없으면 사용자가 영향과 상태를 확인한 새 operation만 허용한다. 단순 조회·검색만 안전하게 자동 재시도한다. 중단은 `interrupt_requested`와 `terminated`를 분리하고 부분 결과·취소 불가 도구를 그대로 남긴다.

브라우저 연결이 끊겨도 bridge/native 실행은 별도 수명으로 유지되거나 실제 종료 상태를 기록한다. 재접속 순서는 새 이벤트 구독 시작 → 저장 cursor 확보 → snapshot/native 재조회 → 앱 event 재생·중복 제거 → 두 소스 비교 → 누락 구간 표시다. 이벤트 순서가 바뀌어도 낮은 revision으로 상태를 되돌리지 않는다. bridge 자체 재시작 시 process registry를 OS 상태와 대조하고 소유권을 입증하지 못한 프로세스는 `orphaned`로 표시해 수동 종료 경로를 준다.

## 5. 로컬 실행·경로·프리뷰 보안

**Browser-test-only scope:** the browser bridge's loopback/capability pairing, fragment bootstrap, tab-held authorization header, CSRF, `Origin`/`Host`, WebSocket upgrade, and request schema form a separate browser-mode proposal and do not authorize or define the Electron host contract. They require a separate reviewed browser security mode before use. Electron desktop mode uses main's typed preload API and in-process service modules; the renderer and preview receive no OpenCode sidecar URL credential or bearer secret. Main authenticates only to the exact app-owned child and keeps that credential in its private process boundary. Never put credentials in a static bundle, URL query, cookie, log, export, or preview. Provider credentials remain in the existing runtime's storage and are not returned to UI. A single-user local app does not solve same-device malware or OS privilege risks.

프리뷰는 제어 UI와 분리된 origin으로 취급한다. **포트만 다른 localhost는 쿠키의 host 범위를 공유할 수 있으므로** 제어 credential을 host 공유 쿠키에 싣지 않고, 프리뷰 문서/iframe에 capability·bridge URL·parent 접근·postMessage 명령을 주지 않는다. 불신 HTML은 sandbox/CSP와 별도 격리 origin에서 제공하고 bridge CORS는 명시적 UI origin만 허용한다. URL 프리뷰의 외부 사이트나 dev server가 bridge에 요청해도 origin·capability 모두 통과하지 못해야 한다. 실제 브라우저 격리, iframe 임베드 차단, navigation과 로컬 자원 노출은 구현 전/후 공격 시나리오로 입증한다. 외부 브라우저 열기는 프리뷰 성공이 아니다.

경로는 `realpath`·파일 identity·Git common directory/worktree metadata로 분류한다. 존재하지 않는 생성 대상은 존재하는 부모를 정규화하고 자식 이름을 제한한다. 경로 입력 시 symlink, 대소문자, 중첩 프로젝트, mount·rename 경쟁을 검사한다. bridge가 소유한 Workspace 단위 변경 mutex는 앱 요청끼리만 조정한다. **외부 편집기·셸·다른 프로세스는 막지 못한다.** 따라서 destructive 작업 직전에 부모/대상 identity와 dirty/untracked 상태를 다시 읽고 가능한 파일 디스크립터·원자적 rename/조건부 쓰기 등 플랫폼 수단으로 검사와 변경 간 간격을 좁힌다. OS 수준 격리를 확보하지 못한 외부 경쟁 쓰기까지 안전하다고 주장하지 않는다. identity가 바뀌면 중단하고 `PATH_CHANGED`를 반환한다.

프로젝트의 실행 신뢰는 경로만이 아니라 검토한 configuration/plugin/setup 내용의 digest에 묶는다. 외부 편집으로 그 내용이 바뀌면 기존 실행 신뢰는 무효이며 차이 확인 전 재로딩·활성화하지 않는다. 초기 metadata/Git 검사도 저장소가 지정한 hook, fsmonitor, 외부 helper나 plugin을 실행하지 않는 경로로 구현·검증한다. 이 무실행 경계는 S-03의 검증 대상이다.

모든 파일 저장은 읽은 내용의 digest/mtime/identity를 version으로 받아 현재 version과 비교한 뒤 쓰며, 외부 변경은 충돌로 보존한다. Git stage/unstage/restore/commit/branch는 정확한 workspace Git root·HEAD·index 상태를 재확인한다. restore와 물리 삭제는 preview token에 포함된 경로·상태 digest가 달라지면 재확인을 요구한다. 원본 저장소 루트, 홈/파일시스템 루트, 설정된 작업 루트 자체와 그 상위, 중첩 등록 경로, 다른 session이 사용하는 경로를 물리 삭제에서 막는다. 무결성이 불확실할 때 앱은 성공으로 확정하지 않는다.

## 6. 권한 정책과 도구 admission

`PolicyRevision`은 file read/write, shell/process, network/MCP, allowed paths/domains, confirmation scope의 규칙 집합이다. `요청마다 확인`, `범위 내 편집 허용`, `읽기/계획`, `사용자 정의`는 이 집합의 preset이며 런타임과 app adapter의 실제 강제 경계가 확인되어야 활성화한다. OS sandbox와 도구 정책은 별개다. 시스템의 명시적 deny는 앱 승인으로 뒤집지 못한다. 도구 결과·웹 페이지·저장소 텍스트는 정책 변경 명령으로 해석하지 않는다.

모든 실행은 `identify caller → validate schema/target → policy admission → pending approval? → dispatch → receipt`를 통과한다. app file/Git/process/PTY/direct tool action과 native 도구·plugin/RPC·child 호출을 같은 경계에 포함한다. **임의 shell/plugin을 읽기/계획 모드에서 실행시키지 않는다.** 일반 명령 문자열이나 도구 이름만으로 비변경성을 판별할 수 없기 때문이다. 읽기 전용으로 격리·검증된 제한된 도구만 허용하며, 런타임 내부 우회 경로를 막거나 감지할 수 없다면 해당 preset/직접 실행을 비활성화하고 구현을 보류한다. native permission hook이 explicit deny를 override하지 못한다는 [plugin 문서](https://opencode.ai/v2/docs/build/plugins/)의 한계와 실제 부작용 시험을 함께 확인한다.

승인 요청은 `requestId + nativeRequestRef + toolCallId + policyRevision + exact target/args + expiresAt`으로 고정한다. 결정 API는 `pending`인 최신 요청에만 compare-and-set으로 한 번 적용하고 native pending 조회/receipt로 반영을 확인한다. 같은 결정의 재전송은 기존 receipt, 반대 결정이나 만료·종료 요청은 충돌이다. batch 결정은 요청 ID·revision의 고정 목록이며 나중에 생성된 요청을 포함하지 않는다. 기억 규칙은 native가 정확한 범위·조회·취소를 제공할 때만 활성화하고 저장 상태를 다시 읽는다. 카드의 질문/선택 응답은 form/tool response이며 permission decision이 아니다.

정책 변경은 `requested → admitting_paused → draining → applied → effective`다. 축소 시 새 도구 admission을 먼저 막고 pending 승인은 무효화 또는 새 revision으로 재검토한다. 활성 호출의 실제 종료를 확인하거나 해당 호출의 완료까지 `draining`을 유지한다. UI의 '전환 중'은 requested/admitting_paused/draining의 표시 범주이며 별도 wire 상태가 아니다. 즉시 중단 불가능한 호출을 종료했다고 표시하지 않는다. native session permission update가 성공해도 자식·MCP·직접 도구에 동일 revision이 적용됐다는 증거가 없으면 `effective`로 승격하지 않는다. 실패 시 이전 유효 정책을 유지하되, 축소 요청 뒤 정책이 불확실한 경우 새 위험 호출은 계속 막는다. 확대는 사용자에게 범위·적용 시점을 확인한 뒤 새 revision을 적용하며 기존 자식에 자동 전파하지 않는다.

새 child의 effective policy는 부모 snapshot과 사용자 지정 범위의 교집합이다. 부모 축소 시 활성 자식별 상태·pending·tool을 조회해 보류/중단·재평가하고 결과를 기록한다. 부모의 deny를 child 승인이나 재위임이 우회할 수 없다. concurrency는 사용자 한도와 실제 bridge/runtime capacity의 작은 쪽으로 제한하고 초과 위임은 FIFO 대기·취소 가능 상태로 둔다.

## 7. 기능별 native/API/adapter 결합

이 표의 `native`는 **문서에 열거된 동작**이다. 구현 버전에서 동작·매개변수·부작용을 다시 확인해야 한다. `adapter`는 이 앱이 책임질 제안이다. [OpenCode API](https://opencode.ai/v2/docs/api), [SDK](https://opencode.ai/v2/docs/build/sdk), [plugin](https://opencode.ai/v2/docs/build/plugins/)은 근거 문서다.

| PRD | native 문서 근거 | app adapter `PROPOSED`와 완료 조건 |
| --- | --- | --- |
| F-01 / AC-01 | worktree list/refresh는 저장 inventory·발견 기능; 전용 worktree import는 확인되지 않음 | 실행 없는 경로/Git 검사 후 등록. 중복 canonical identity 통합. plugin/setup은 신뢰 확인 전 미실행 |
| F-02 / AC-02 | worktree.create는 projectID를 요구하고 canonical plugin/setup을 로드 | 사용자 부모 경로·ref·branch·setup 확인, 제약 가능한 strategy만 선택. 일반 폴더는 원자적 mkdir + 날짜/UUIDv7 fallback |
| F-03 / AC-03 | worktree.remove는 기록된 strategy 사용; session delete는 child를 포함 | 등록 해제·대화 삭제·물리 삭제를 서로 다른 operation으로 구현. 마지막 경로/dirty/활성 소유 재검사, branch 보존 |
| F-04 / AC-04 | session list/create/update/delete/fork | 앱 title·pinned·archived·draft·unread·workspace 매핑; 최소 두 병렬 session과 재시작 복구 |
| F-05 / AC-05 | session message/interrupt/fork, message/context 조회 | 첨부·참조 검증, 대기 메시지, 재시도는 새 run/branch. 이전 effect 자동 재실행 금지 |
| F-06 / AC-06 | agent/model list, session agent/model 전환, context 조회 | requested/default/observed와 다음 적용 경계 기록; 미지원 effort 차단 |
| F-07 / AC-07 | session.fork는 history 복사; child 관련 native 동작은 버전 확인 | fresh child는 빈 native session + 명시적 payload/parent mapping. 두 child 병렬·개별 실패·취소·결과 회수 |
| F-08 / AC-08 | 도구는 session 실행에 포함; plugin tools/RPC 확장점 | schema 검증된 직접 실행 adapter 또는 검증된 RPC. 일반 도구 카드 fallback과 별도 permission 게이트 |
| F-09 / AC-09 | session.update permissions, pending/list/reply/remove saved permission | revision 전환·재평가·중복/만료 CAS, native 실제 강제·child 전파 검증 |
| F-10 / AC-10 | shell/PTY는 실행 통로 | process registry로 dev server 수명 관리; 격리 preview URL/산출물 renderer와 실패·외부 열기 |
| F-11 / AC-11 | filesystem read/list/find/write, VCS status/branches/diff 읽기 | version-checked 편집과 Git 변경 명령. stage/restore/commit/branch 대상·영수증 검증 |
| F-12 / AC-12 | PTY create/list/get/update/remove/connect, shell 실행·출력 | terminal owner, cwd, IO·resize·exit·orphan 복구; tab 닫기와 process 종료 분리 |
| F-13 / AC-13 | command.list, session.command, skill.list | 출처별 registry, schema/인자·busy 확인, 앱 명령 라우팅. TUI 전용 명령은 미지원 |
| F-14 / AC-14 | config 조회/reload, MCP list/add/connect/disconnect, plugin list | 구성 파일별 출처·draft/diff/검증·적용 확인, 설치/업데이트는 명시 동작, 인증 UI 없음 |
| F-15 / AC-15 | session message·tool 결과 | 앱 plan version/approval/checklist/review/evidence; 자기 보고와 검증 결과 분리 |
| F-16 / AC-16 | session statistics/context와 event stream | 로컬 event 일지, 제공/추정/미제공 usage, 설정 비교, 합성 학습 답·근거 |
| F-17 / AC-17 | session export/import는 대화 기록용; native event는 live-only | snapshot 재조회·gap, 앱 범위 export/import·retention·삭제, 불확실 effect 재실행 금지 |
| F-18 / AC-18 | 전용 앱 scheduler/OS 알림은 확인되지 않음 | 로컬 job scheduler·pause/resume·missed log, 비밀 없는 알림, 설정/키보드 도움말 |

### 경로 생성·제거의 구체 계약

`POST /workspaces`는 `{kind, sourceProjectId?, targetPath?, parentPath?, desiredName?, startingRef?, newBranch?, setupApproval?, initGit?}`을 받는다. `targetPath`는 새로 만들 정확한 절대 경로이며 `parentPath`/`desiredName`과 동시에 받지 않는다. 기존 폴더 연결은 import operation으로 분리한다. 명시 경로는 정확히 그 위치, 생략은 사용자가 지정한 작업 루트 아래 자식이다. SDK가 선택 버전에서 기본 이름을 제공하고 부모 경로를 강제할 수 있으면 그 경로를 쓴다. 기본 네이밍을 확인할 수 없는 일반 폴더 등만 현지 날짜 `yyyy-mm-dd-<소문자 표준 UUIDv7 전체>`를 사용한다. 최초 날짜·ID는 operation에 고정하고 충돌만 새 ID로 제한 재시도한다. SDK 실행 실패를 네이밍 부재로 해석하거나 다른 전략으로 전환하지 않는다. plugin strategy가 목적지를 바꿀 수 있으므로 요청 부모 경로를 **실행 전에 강제**할 수 없는 strategy는 제공하지 않는다. 결과 경로·branch를 재조회한다. setup 실패는 `created_setup_failed`로 남기고 자동 삭제하지 않는다.

`delete-check`는 `{workspaceId, canonicalPath, pathIdentity, sourceKind, ownerStrategy, dirtyPaths, untrackedPaths, activeSessions, activeChildren, terminals, servers, nestedProjects, branchPolicy, checkRevision}`을 반환한다. UI 확인은 이 목록·절대 경로·강제 여부를 받지만 실행 허가는 아니다. `delete`는 동일 checkRevision, 별도 destructive confirmation, 비강제 기본값으로 시작하고 마지막 identity·dirty·소유를 재검사한다. 원본 repo/보호 경로, 활성 실행·다른 session, 중첩 경로는 거절한다. force는 dirty/untracked 손실 목록과 경로 재확인이 있어야 한다. 기록된 strategy 제거 실패 뒤 임의 `rm -rf`로 가지 않는다. 일반 import 폴더의 실제 제거도 별도 확인한 adapter가 책임진다. 취소·등록 해제·기록 삭제는 파일 제거를 호출하지 않는다.

### 대화 UI와 카드 결합

assistant-ui는 thread/composer/stream/render를 맡고, app projection이 `sessionId`, `runId`, message/part ID, queued input, interrupt state를 공급한다. 공식 OpenCode runtime의 [현재 quickstart](https://www.assistant-ui.com/docs/runtimes/opencode/quickstart)는 구세대 패키지 예시이므로 새 v2에 곧바로 맞는다고 보지 않는다. 불일치 시 [ExternalStoreRuntime](https://www.assistant-ui.com/docs/runtimes/custom/external-store)로 app projection을 연결한다. 모델 실행은 OpenCode 하나만 소유한다.

[tool-ui](https://www.tool-ui.com/docs/quick-start)는 등록한 도구명+버전+출력 schema가 검증된 경우에만 diff/표/진행/미디어/질문 renderer를 고른다. 입력·출력은 사이즈 제한과 비밀 마스킹을 거치고 untrusted HTML을 실행하지 않는다. 알 수 없거나 schema 불일치인 도구는 텍스트 일반 카드로 표시한다. 선택/질문 callback은 `toolCallId + response schema`; permission 버튼은 `PermissionRequest`의 최신 native ref를 사용한다. 재접속 뒤 오래된 action은 비활성화하고 최신 상태로 이동한다. renderer는 실행 권한을 갖지 않는다.

### 명령·구성·터미널·자동화

`Command`는 `{commandId, source: app|runtime|project|skill, name, argumentSchema, targetKinds, availability, effectClass}`다. 이름 충돌 시 source-qualified 선택을 요구한다. `/` 문자열을 shell로 넘기지 않는다. 앱 new/open/worktree/model/permissions/plan/review/compact/status/mcp/help는 개별 app action에 매핑하며 runtime command는 실제 list/execute 계약이 맞는 항목만 노출한다. 취소·busy·인자 오류는 operation 상태로 반환한다.

구성 변경은 `draft → validate → diff → user apply → native reload → observed active`다. AGENTS/instructions, skills, agents, hooks, tools, MCP, plugin 각각 파일 출처와 적용 위치를 기록한다. 외부 포맷은 검증된 변환기가 없으면 실행하지 않는다. MCP 등록/연결, plugin 설치/업데이트, process 시작은 사용자에게 경로·영향을 보여주는 명시적 operation이다. 자격 증명이 없으면 외부 설정 경로와 `AUTH_REQUIRED`를 반환한다.

Terminal은 `{terminalId, workspaceId, owner: user|agent, cwd, processRef, state, exitCode?, policyRevision}`이다. user 직접 입력과 agent 호출은 별개 caller 및 admission을 통과한다. PTY 출력은 길이 제한·마스킹·backpressure 후 스트리밍한다. 탭 닫기는 viewState만 바꾸고 stop은 실제 프로세스 신호 후 종료 확인을 기다린다. build/lint/test/dev는 프로젝트 스크립트의 출처·cwd·인자를 보여주고 각 실행의 exitCode와 sourceRevision을 Evidence로 남긴다.

자동화 `Job`은 `{jobId, workspaceId, schedule, timezone, policyRevision, paused, nextDueAt, lastRunId?}`다. bridge가 살아 있는 동안만 scheduler가 실행한다는 잠정 계약이며 OS 상주 보장은 패키징 선택까지 보류한다. 시작 직전 경로·policy·자격 상태를 재검사한다. bridge가 꺼진 구간의 due는 `missed`로 남기고 소급 실행하지 않는다. 동일 due slot은 단일 operation key로 묶으며 crash 후 effect unknown을 재실행하지 않는다. 알림은 job/session ID와 상태만 표시하고 민감 본문은 넣지 않는다.

### 로컬 export/import·보존

앱 export는 먼저 manifest를 만든다: schema version, 앱/SDK 버전, 선택된 project/session/event/artifact 범위, 파일 원문 포함 여부, 마스킹된 필드, 예상 크기, 대상 경로와 외부 provider/MCP 보존 한계. 실제 아카이브에는 secret, provider credential, 환경 변수 원문, 임의 프로젝트 전체 디렉터리를 기본 포함하지 않는다. 완성 파일은 임시 경로에 만들고 checksum 검증 뒤 원자적으로 목적지로 옮긴다. export 성공은 대상 파일 재조회로 확인한다. native session export는 그 자체로 앱의 workspace·policy·일지를 보존하지 않으므로 별도 manifest와 매핑한다.

import는 미리보기 단계에서 schema·checksum·크기·경로 탈출·중복 native/app ID를 검사한다. 기존 프로젝트 경로를 임의로 덮어쓰지 않고 새 앱 ID와 provenance를 부여하며, 불러온 외부 경로는 존재·identity·trust를 다시 검사한다. native session import가 대화 기록용이라는 점을 표시하고 실행 중 process, 권한 승인, 과거 부작용을 복원했다고 주장하지 않는다. 부분 import 실패는 어떤 앱 객체가 생성됐는지 기록하고, 실행을 자동 시작하지 않는다. 보존 기간 만료 또는 앱 데이터 삭제는 앱 DB/객체 저장소와 외부 파일·provider·MCP 보존 범위를 구별한다. 기록 삭제는 프로젝트 파일 삭제와 다른 transaction이며 진행 중 실행·권한과 연결된 증거는 안전한 종료·범위 확인 뒤 제거한다.

## 8. 구현 전 spike와 판정

아래 spike는 모두 **고정 패키지 버전·commit·OS·작은 합성 임시 저장소**에서 실시한다. 문서/API 명세 확인, side effect 관찰, 오류 및 재시작 근거를 기록하고 데스크톱 패키징 기준에서 정확한 OS와 프로세스 효과를 밝힌다. 실패는 기능 삭제가 아니라 지정한 어댑터 대안의 별도 검토로 이어진다. 근거 없는 native 호출은 구현에 넣지 않는다.

| ID | 합격 증거 | 실패 시 결정 |
| --- | --- | --- |
| S-01 host | The fixed app-owned OpenCode v2 `serve` binary and version-matched `@opencode/client`: per-OS identity/readiness/auth, session/event recovery, failure, shutdown and child reaping on the exact process | If a required behavior fails, hold engine integration and return an evidence-backed change proposal; do not silently substitute embedded host/shared service/client behavior |
| S-02 worktree | 기본 이름·parent 강제·strategy 목적지·setup 승인·dirty/remove 실패를 합성 repo에서 확인 | 제약 가능한 custom strategy 설계; 강제 불가 전략 비노출, F-02/03 구현 보류 |
| S-03 import | 일반 폴더/저장소/외부 worktree 인식이 plugin/setup 실행 없이 가능한지 추적 | 실행 없는 app 경로/Git inspector 사용 후 신뢰한 경우만 runtime load |
| S-04 child | 빈 세션 위임과 history fork의 실제 payload·권한 상속·중단·결과 회수 차이를 확인 | app fresh-child orchestrator 사용; 정책 상속 강제 불가면 위임 실행 보류 |
| S-05 policy | deny, 사용자 거절, 저장/취소, 실행 중 축소, pending 재평가, child, shell/plugin 우회를 실제 파일 side effect로 확인 | 격리된 tool runner/admission 확장. 우회 차단 불가 모드는 비활성화하고 release 차단 |
| S-06 direct tools/commands | 도구 schema·직접 실행 경로와 command.list/session.command 인자·취소/충돌 확인 | 검증된 plugin RPC 또는 app action adapter; TUI 전용은 미노출 |
| S-07 UI | 고정 assistant-ui/tool-ui 버전에서 v2 stream·tool schema·선택/승인·중단/재접속·접근성 실제 연결 | ExternalStoreRuntime 기반 adapter 및 검증된 일반 카드 경로 |
| S-08 bridge/preview | In browser-test-only mode, test browser bootstrap/origin/host/WS/cookie behavior. In Electron mode, separately test main/preload sender and payload admission, sidecar credential non-disclosure, preview isolation, navigation and file path escape | Keep the mode boundary explicit; any failed host admission or preview isolation blocks the affected desktop capability and release |
| S-09 recovery | dispatch 뒤 crash, live event 누락, 중복 승인, process orphan에서 영수증 대조와 unknown 표기 확인 | 작업별 reconciliation 보강; side effect 재실행 위험 남으면 해당 mutation 보류 |
| S-10 platform | Verify Electron window/process lifecycle, native dialog, notification, close/restart and macOS/Windows behavior | Packaged Electron E2E and lifecycle evidence on both OSes; independent runs on actual macOS and Windows systems |

## 9. 순서 있는 세로 구현 단위

각 단위는 해당 사용자 흐름, 오류 경로, 실제 실행 근거가 함께 작동해야 완료다. 모든 F-01~18이 **동일 출시 목표**이며 순서는 범위 축소가 아니다. 각 slice의 수정 경로는 구현 시작 시 계획에 배정하고 독립 검토를 거친다.

1. **실행 기반:** S-01/08/09와 패키징 선택. bridge bootstrap, DB/migration, native ID mapping, event/snapshot, error/idempotency, 권한 기본 deny 경계. 로컬 재시작·중복 요청에 잘못된 성공/재실행이 없어야 한다.
2. **경로에서 첫 대화까지:** S-02/03/07. F-01/02/04/05/06과 F-17 기본 복구, assistant-ui·tool-ui의 실제 메시지 흐름. 빈 이름 자동 생성, import 무실행, setup 실패, 두 세션 전환, 중단·재열기 확인.
3. **위임과 통제:** S-04/05/06. F-07/08/09/13/14/15와 F-16 기록 기초. 두 fresh child와 fork 차이, 직접 tool, 모드 축소, 대기 승인, 구성 재로딩·검증 증거를 하나의 세션 문맥에서 확인.
4. **검토와 개발 실행:** F-10/11/12 및 F-03 실제 삭제. 프리뷰 격리, file version 충돌, Git stage/commit/restore, PTY/dev server, active/dirty/path-changed 삭제 차단을 동일 workspace에서 확인.
5. **일상 사용과 출시:** F-16/17/18 완성. export/import/retention, 학습 답·근거, 사용량 출처, 설정·접근성·알림, scheduler pause/missed. AC-01~18과 PRD의 7개 통합 시나리오를 실제 지원 환경에서 독립 검토 후 판정.

## 10. 남은 결정과 문서 효력

Electron and app-owned OpenCode v2 `serve` sidecar are selected/confirmed, while exact package versions and compatibility, work root, data location/retention, native permission/worktree/tool extension remain unverified. S-01 validates the fixed binary/client pair without reopening the host type. Preserve the approved product scope while recording observations, alternatives, cost, and risk for each remaining decision. Cross-review this document with UX/verification/operations; it is not implementation authority until current independent `design_spec_reviewer` and architecture reviews pass and the exact integrated set is explicitly approved. Static document review does not prove OS-level path protection, real permission enforcement, SDK compatibility, or preview isolation.
