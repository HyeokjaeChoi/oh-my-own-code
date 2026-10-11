# 브리지 pairing client contract

**v0.8 · 2026-09-28 · 제안 · 구현 및 브라우저 시험 전 검증 필요**

이 문서는 `browser-bridge-security.md` v0.4의 bounded implementation을 위해 API wire schema와 현재 workbench의 pairing UI 상태를 고정한다. 상위 문서의 trust boundary, read-only authority, loopback/Host/Origin 규칙, 브라우저 한계, 같은 기기 프로세스 위험은 그대로 유지한다. 본 범위는 synthetic fixture뿐이다.

이 bounded increment의 나열된 API route에서는 본 v0.8 문서가 상위 v0.4 문서의 공통 처리 순서 및 예시 상태 매핑보다 우선한다. 상위 문서의 나머지 security control과 effect boundary는 그대로 적용한다.

## 공통 HTTP 규칙

요청 거부는 다음 우선순위로 평가해 동일 요청이 항상 같은 상태와 코드를 받도록 한다. (1) peer/Host, (2) URL과 path (`400 REQUEST_INVALID`, `404 NOT_FOUND`), (3) 등록 path의 method (`405 METHOD_NOT_ALLOWED`), (4) Origin/Fetch Metadata/preflight (`403 HOST_DENIED` 또는 `ORIGIN_DENIED`), (5) content type/body 크기/JSON object schema (`400 REQUEST_INVALID`, 초과는 `413 REQUEST_TOO_LARGE`), (6) credentials, (7) 허용된 효과. 앞 단계에서 거부하면 뒤 단계의 credential 검증이나 상태 변경을 수행하지 않는다.

선택된 status/body를 정한 다음, response decoration을 위해서만 peer/Host/Origin/Fetch-Metadata 검사를 별도로 완료한다. 이 decoration-only pass는 status, code, route classification을 바꾸거나 credential 검증/상태 변경을 수행하지 않는다. 정확한 configured Origin이 허용되고 Host와 metadata가 통과한 경우, 그 요청에서 이미 선택된 400/404/405를 포함한 응답에 정확한 ACAO와 `Vary: Origin`을 붙인다. 이 독립 검사가 거부되면 status/body는 선택된 값 그대로 두되 ACAO를 생략한다. 따라서 valid trusted-Origin unknown path는 readable 404, invalid-Origin unknown path는 동일 404지만 opaque; valid-Origin unsupported method는 readable 405, invalid-Origin이면 opaque 405다.

- API base URL은 `VITE_BRIDGE_ORIGIN`으로 UI 빌드/실행 시 제공한다. 개발 UI origin `http://127.0.0.1:4200`은 bridge origin `http://127.0.0.1:4318`에서 허용하고, E2E UI `http://127.0.0.1:5420`은 test fixture bridge `http://127.0.0.1:5318`에서 허용한다. 브라우저 요청은 bridge로 직접 간다. Proxy는 허용하지 않는다.
- 모든 browser fetch는 `credentials: "omit"`, `cache: "no-store"`, `redirect: "error"`를 사용한다. Capability는 `Authorization: Bearer <43-char-base64url>`에만 담는다. Bootstrap code는 `POST /api/v1/pair` body에만 담는다. 어느 secret도 query, fragment, URL, cookie, browser storage, service worker, referrer, bundle, clipboard 자동 복사, console, log, trace, HAR에 두지 않는다.
- JSON 요청은 `Content-Type: application/json` 또는 `application/json; charset=utf-8`만 허용하고 body 최대 크기는 4 KiB다. UTF-8 JSON object 이외, 중복 JSON key, 예상하지 않은 필드는 거부한다. 빈 control body는 정확히 `{}`다. GET/HEAD/OPTIONS에는 body를 받지 않는다.
- Origin이 있는 요청은 정확한 startup allowlist tuple이어야 하며 `Sec-Fetch-Site`는 `same-origin` 또는 allowlisted dev UI의 `same-site`만 허용한다. `cross-site`, `none`, 누락, 중복, 알 수 없는 값은 거부한다. Origin 없는 API read는 production same-origin `Sec-Fetch-Site: same-origin`일 때만 허용한다. Origin 없는 preflight, pair, heartbeat, revoke는 거부한다.
- CORS preflight는 정확한 허용 Origin, 허용된 `Sec-Fetch-Site`, 등록된 route/method, 아래 표의 route-specific request header subset을 모두 확인한다. CORS 처리에는 두 응답 정책이 있다. Peer/Host/Origin/Fetch-Metadata admission을 통과한 exact configured Origin의 모든 response(성공 및 application error)는 정확한 `Access-Control-Allow-Origin`과 `Vary: Origin`을 포함하여 trusted UI가 고정 오류 status/body를 읽게 한다. Rejected Host, Origin, Fetch Metadata, preflight 또는 untrusted Origin에는 ACAO를 보내지 않는다. 이 경우 browser JavaScript는 bridge status/body 대신 generic fetch failure만 본다. `Access-Control-Allow-Credentials`와 wildcard는 금지한다. Early `400/404/405` status precedence does not bypass the decoration-only check above.
- Preflight header set은 exact route별로 고정한다: pair POST=`content-type`만; heartbeat/revoke POST=`authorization, content-type`; snapshot/events GET=`authorization`만. `Access-Control-Request-Headers`는 대소문자 무시 부분집합이어야 하며 빈 값은 허용하고 중복/미지정 header는 `403 ORIGIN_DENIED`로 거부한다. `Access-Control-Request-Method`가 해당 등록 method와 일치하지 않는 preflight도 `403 ORIGIN_DENIED`다. preflight 요청에는 `Authorization` 또는 body가 없어야 하며, 실제 OPTIONS에 둘 중 하나가 있으면 `400 REQUEST_INVALID`다. Pair POST의 Authorization도 금지하고 존재하면 `400 REQUEST_INVALID`다. 이 increment에는 domain mutation route를 등록하지 않는다. `/api/*`, 표에 없는 `/api/v1/*`(legacy 및 임의 mutation 경로 포함)는 모두 credential 검사 전 `404 NOT_FOUND`이며 부작용이 없다. 등록 path에 허용되지 않은 method는 credential 검사 전 `405 METHOD_NOT_ALLOWED`다.
- 모든 JSON/error response는 `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`를 설정한다. Error shape는 `{ "error": { "code": "<fixed-code>", "requestId": "<opaque-id>", "message": "<fixed-safe-text>" } }`다. Error body/header/log에 code, bearer, request body, raw exception, response text, full filesystem path를 포함하지 않는다.

## Endpoint wire schemas

| Route | Request | Success | Authority/effect |
|---|---|---|---|
| `POST /api/v1/pair` | 허용 Origin; `{ "code": "<43-char-base64url>" }`; authorization 없음 | `200` `{ "capability": "<43-char-base64url>", "idleTimeoutSeconds": 900, "absoluteTimeoutSeconds": 28800 }` | 현재 일회 code를 atomic consume하고 read-only capability 하나 생성. 요청 응답은 no-store. |
| `POST /api/v1/pair/heartbeat` | 허용 Origin; bearer; `{}` | `204`, body 없음 | 그 capability의 idle activity만 갱신. |
| `POST /api/v1/pair/revoke` | 허용 Origin; bearer; `{}` | `204`, body 없음 | 그 capability만 revoke하고 그 stream(이 increment에는 없음)을 종료. 다른 capability 불변. |
| `GET /api/v1/snapshot` | 허용 Origin 또는 명시한 production same-origin 예외; bearer; body 없음 | `200` `SyntheticSnapshotSchema` object | 현재 synthetic fixture snapshot 읽기 전용. |
| `GET /api/v1/events` | snapshot과 같은 인증 규칙 | `200` bounded JSON event array | 끝나는 고정 fixture array; event stream/WebSocket 아님. |
| `OPTIONS` on the above paths | 정확한 허용 Origin, `Access-Control-Request-Method`, optional `Access-Control-Request-Headers`; no bearer/body | `204`, body 없음, route별 CORS headers | preflight only, 상태 변경 없음. `OPTIONS`를 통한 API data 접근 금지. |

Bootstrap과 capability token은 32-byte CSPRNG를 unpadded base64url로 인코딩하므로 길이가 정확히 43자다. Code는 대소문자를 구분한다. Input의 양끝 ASCII whitespace만 제거할 수 있고 내부 공백/비ASCII/다른 길이는 거부한다. Capability는 어떠한 whitespace도 허용하지 않는다.

### 거부 코드와 상태

| HTTP | 고정 코드 | 의미 |
|---|---|---|
| 400 | `REQUEST_INVALID` | 잘못된 content type/body/schema 또는 중복 헤더/잘못된 credential syntax |
| 401 | `BOOTSTRAP_INVALID` | 없는·틀린·만료·소비된 code; 남은 횟수나 code digest를 밝히지 않음 |
| 401 | `AUTH_REQUIRED` | bearer 누락 또는 문법상 올바르지만 등록되지 않은 capability |
| 401 | `AUTH_EXPIRED` | idle 또는 absolute expiry |
| 401 | `AUTH_REVOKED` | 이미 revoke되었거나 bridge epoch 종료 |
| 403 | `HOST_DENIED` / `ORIGIN_DENIED` | peer, Host, Origin 또는 Fetch Metadata 정책 불일치 |
| 404 | `NOT_FOUND` | 등록하지 않은 path. route 목록·서비스 상세를 노출하지 않음 |
| 405 | `METHOD_NOT_ALLOWED` | 등록된 path의 미지원 method; credentials는 검사하지 않음 |
| 413 | `REQUEST_TOO_LARGE` | 4 KiB 초과 body; 처리 전에 종료 |
| 429 | `BOOTSTRAP_RATE_LIMITED` | 현재 code의 다섯 번째 실패; code 소비됨. 사용자가 터미널에서 `pair` 입력해 새 code 발급 |

Pair request와 response가 network timeout/error로 끝나면 UI는 code가 소비되었을 가능성을 가정한다. 같은 code를 자동 재시도하지 않고 사용자가 터미널에 `pair`를 입력해 새 code를 발급하도록 안내한다. HTTP 200 response body가 schema를 벗어나면 capability를 사용하지 않고 `pair_outcome_unknown`으로 전환한다. Code가 소비되었을 수 있으므로 새 terminal code를 요청하고 자동 재시도하지 않는다. Trusted Origin의 정상 admission 후 application error는 ACAO를 포함하므로 UI가 status/body를 읽을 수 있다. 반대로 거부된 preflight/Origin은 ACAO가 없으므로 JS가 403을 읽을 수 없고, POST 자체가 전송되지 않았을 수도 있다. 이를 generic fetch rejection으로 처리하고 원인을 단정하지 않는 안내를 표시하며, 보수적으로 code가 소비됐을 수 있다고 간주한다.

Pair route는 body schema를 credentials보다 먼저 검증한다. `code` 누락/null/문자열 이외, 추가 field, malformed JSON은 `400 REQUEST_INVALID`이며 입력 오류로 처리한다. Empty string, 유효한 문자열 형식이 아닌 code, 틀린/만료/이미 소비된 code는 `401 BOOTSTRAP_INVALID`; 해당 code의 다섯 번째 실패는 `429 BOOTSTRAP_RATE_LIMITED`다. Pair의 bootstrap code가 누락되면 schema 오류(`400`)다. Read/control route에서 bearer 누락은 `401 AUTH_REQUIRED`; 중복 Authorization header, 잘못된 scheme 또는 token syntax는 `400 REQUEST_INVALID`; 문법상 유효하나 알 수 없는 token은 `401 AUTH_REQUIRED`다. 중복 Host는 `403 HOST_DENIED`; 중복 Origin 또는 Fetch Metadata, Authorization 또는 Content-Type은 `403 ORIGIN_DENIED` 또는 `400 REQUEST_INVALID`로 분류하며, 구현은 아래 테스트의 단일 기대값을 고정한다: Host/Origin/Fetch Metadata는 각각 Host/Origin 정책 거부, Authorization/Content-Type은 request invalid. Unknown path는 `404`, 등록 path의 unsupported method는 `405`이고 둘 다 credential 검증 전 처리한다.

## Pairing UI 상태와 전이

| 상태 | 화면/행동 | 전이와 사용자 안내 |
|---|---|---|
| `disconnected` | 읽기 가능한 label이 붙은 password code input, Pair 버튼, launcher에서 받은 code 입력 안내 | submit 가능; code가 비어 있거나 길이/문자가 틀리면 inline validation 및 input focus |
| `pairing` | input을 요청 전 즉시 비움; Pair 비활성; `aria-live="polite"` 진행 상태 | 한 번에 하나만 전송; Pair가 focused 상태에서 disabled 되면 focus를 진행 상태로 옮겨 keyboard focus를 잃지 않음; timeout/연결 오류 또는 5xx는 `pair_outcome_unknown` |
| `pair_outcome_unknown` | credential은 보관하지 않음; “브리지에서 code가 이미 사용됐을 수 있어요. 터미널에서 `pair`를 입력해 새 code를 발급하세요.” | 사용자가 확인하면 input으로 복귀; 자동 재시도 없음 |
| `pair_rejected` | 입력 code를 비운 상태에서 고정된 safe message와 다시 입력할 수 있는 form 표시 | `400 REQUEST_INVALID`는 형식/schema 문제로 설명하고 input에 focus; `401 BOOTSTRAP_INVALID`는 만료/사용/불일치를 구분하지 않고 새 code 발급 또는 재입력을 안내; `429 BOOTSTRAP_RATE_LIMITED`는 현재 code를 잠금 처리하고 terminal `pair` 재발급을 안내; 어떠한 code 값도 보존하지 않음 |
| `authenticated_loading` | capability는 현재 component memory에만; “읽기 전용 데이터 연결 중” | snapshot/event 동시 요청. 일반 network/read 오류면 cap을 유지하고 재시도 허용; stale response는 무시 |
| `connected` | synthetic/read-only 배지, data source 설명, Disconnect 버튼 | 마지막 snapshot/event read와 heartbeat가 모두 성공 상태일 때만; heartbeat 5분마다; event fixture는 한 번의 finite JSON read; domain mutation 없음 |
| `heartbeat_failed` | 기존 데이터는 유지하되 연결 확인 필요 badge와 Retry 표시 | transport/error/5xx이면 자동 timer를 멈추고 capability를 memory에 유지; Retry는 heartbeat 성공 후 snapshot/events를 다시 읽고 connected로 복귀; terminal auth 응답이면 `terminal_auth_failed` |
| `read_failed` | 데이터 대신 고정된 network/read 오류와 Retry | network/status 5xx는 cap 유지하고 Retry; code/bearer/raw body 출력 안 함 |
| `terminal_auth_failed` | data 제거, cap 메모리에서 삭제, 새 pairing 안내 | `AUTH_EXPIRED`/`AUTH_REVOKED`/epoch 종료는 연결 복구를 주장하지 않음; 새 code 필요 |
| `revoking` | 중복 조작을 막고 진행 상태 표시; in-flight read abort, generation을 증가시켜 늦은 결과 무효화 | 204면 cap 삭제 후 `disconnected`; 실패/응답 유실이어도 cap을 즉시 local memory에서 제거 |
| `local_disconnect_unconfirmed` | disconnected UI로 돌아가되 “이 탭의 자격은 지웠지만 브리지에서 폐기를 확인하지 못했습니다. 전체 자격을 즉시 무효화하려면 브리지 프로세스를 종료하세요.” 표시 | server revoke 미확인, revoke의 terminal 401 포함 모든 실패에 사용. 서버측 revoke를 확인한 것처럼 말하지 않음; 재연결에는 새 pairing code 필요 |

Code는 network 요청을 만들기 전에 state에서 비운다. Capability는 React/component memory에만 두며 reload 후 복구하지 않는다. Pair submit은 중복 방지한다. Pair mapping은 trusted-Origin의 readable `400`→`pair_rejected` (input error), `401 BOOTSTRAP_INVALID`→`pair_rejected` (fresh code), `429`→`pair_rejected` (terminal reissue), readable unexpected `403/404/405/413` or other non-200 status below 500→`pair_rejected` (generic bridge/configuration error; never infer code validity), valid-schema `200`→`authenticated_loading`; malformed `200`, fetch rejection/timeout, or any `5xx`→`pair_outcome_unknown`이다. A malformed `200` may follow consumed code, so always instruct a fresh terminal code and never retry automatically. Host/Origin/Fetch-Metadata/preflight denial is sent without ACAO and therefore appears to browser fetch as a rejection; the UI never claims a specific denial cause. Pair `401`은 capability의 terminal authentication 실패가 아니다.

| Operation/result | Capability/data/timer | Next state and action |
|---|---|---|
| Pair valid `200` with valid schema | accept capability in memory; start no timer until initial reads succeed | `authenticated_loading`; concurrently read snapshot/events; focus connection heading on success |
| Pair readable `400/401/429` | no capability; submitted code already erased | `pair_rejected`; apply exact safe copy above; focus code input or Pairing heading as stated |
| Pair readable unexpected non-200 status below 500 (including `403/404/405/413`) | no capability; never retry automatically | `pair_rejected`; generic bridge/configuration message and safe manual retry; focus Pairing heading/code input |
| Pair malformed `200`, fetch rejection/timeout, or any `5xx` | code may be consumed; retain no credential | `pair_outcome_unknown`; request fresh terminal code; no automatic retry |
| Initial/read `200` valid schema | retain capability and render current data | `connected`; start heartbeat; focus connection heading on initial success |
| Read any status 401 | clear capability and data; stop heartbeat; abort in-flight work; do not depend on error code being parseable | `terminal_auth_failed`; use fixed auth copy, require new pairing; focus Pairing heading then code input |
| Read any status other than 200 or 401, a 200 with malformed success body, or transport failure | retain capability; do not render unvalidated response; heartbeat cadence remains unless it independently failed | `read_failed`; safe error + Retry; no raw status body/credential; preserve focus or focus Retry if prior control vanished |
| Heartbeat valid empty `204` | retain capability/data; renew idle lease; resume 5-minute timer | If current UI is `connected`, remain connected; if it is `read_failed`, keep its error and Retry and do not claim connected. If recovering from `heartbeat_failed`, remain there while Retry fetches fresh snapshot/events; enter `connected` only after both validate. Announce lease renewed without stealing focus. |
| Heartbeat any status 401 | clear capability/data; stop timer and abort pending work; do not depend on error code being parseable | `terminal_auth_failed`; fixed auth copy and fresh pairing; focus Pairing heading then code input |
| Heartbeat any other status, malformed response, network failure, or 5xx | retain capability/data; stop automatic timer to avoid repeating an unconfirmed renewal | `heartbeat_failed`; Retry performs heartbeat then a fresh snapshot/events read; enter `connected` only if all succeed, otherwise show the corresponding read/heartbeat failure; resume cadence only after successful heartbeat |
| Revoke valid empty `204` | immediately clear capability/data, abort work and stop timers | `disconnected`; announce disconnected and focus Pairing heading/code input |
| Revoke any other response (including all 401), unexpected body, malformed response, timeout, network failure, or 5xx | immediately clear capability/data, abort work and stop timers; do not retain secret to retry | `local_disconnect_unconfirmed`; state explicitly server revoke was not confirmed; focus Pairing heading/code input |

No unexpected status is treated as success. A CORS-blocked response is a fetch rejection (for pair, uncertain outcome; for read, recoverable read failure; for heartbeat, heartbeat failure; for revoke, unconfirmed local disconnect), never an inferred server status. Disconnect, unmount, terminal auth failure and revoke abort relevant requests/timers and increment the generation so late responses cannot restore cleared state. Only capability-auth 401 on read/heartbeat enters `terminal_auth_failed`; revoke always follows its operation-specific local-disconnect rule. UI는 launcher code 출력, bridge startup, pairing 완료를 OpenCode host readiness나 SDK auth로 표시하지 않는다.

Keyboard/focus contract: form validation error keeps/focuses the code input and associates its inline error with `aria-describedby`. Pair progress announces through the polite live region; if disabling Pair removes active focus, move focus to that progress status. On pair completion, focus the Pairing heading or code input after rejection/uncertain outcome, and the connection-status heading only after a valid pair plus initial reads. Terminal capability auth failure and explicit disconnect clear rendered data and focus the Pairing heading then code input. A recoverable read error focuses Retry only if its transition removed the active control; otherwise preserve focus. A heartbeat recovery Retry keeps its loading/error status focused and does not announce connection until fresh reads validate. Every status transition has a concise screen-reader announcement and works keyboard-only at narrow viewport size. UI는 launcher code 출력, bridge startup, pairing 완료를 OpenCode host readiness나 SDK auth로 표시하지 않는다.

Code/capability를 포함할 수 있는 Playwright trace, HAR, request/response body/header logging은 끈다. Visual QA capture는 input clear 이후 상태에서만 수행한다. 허용된 검사 산출물은 pass/fail, fixed error code, stage, redacted status/counter뿐이며 credential value/digest는 저장하지 않는다.

## 필수 경계 시험

- Request contract cases: pair missing/null/non-string/empty/malformed/unknown/duplicate/extra fields, malformed credentials and duplicate headers, deterministic validation precedence, unsupported method before credentials, all unlisted and mutation paths as 404, pair/OPTIONS forbidden credentials/body, exact route-specific preflight method/header cases, pair request/response success schema, wrong body size, every status/error mapping, no-store/ACAO/Vary headers. Assert exact ACAO+Vary for every allowed-Origin application success/error, and no ACAO for denied Host/Origin/metadata/preflight.
- Fetch Metadata cases: allowlisted Origin+`same-origin`, allowlisted dev Origin+`same-site`, Origin-omitted production `same-origin` read, and denied missing/duplicate/malformed/`cross-site`/`none` on pair/control/preflight/read as applicable.
- Pairing lifecycle: successful one-time code, concurrent double spend exactly one success, five failures locks only current code, `pair` code reissue preserves active capabilities, capability hashes only, independent two-tab expiry/revoke, heartbeat renewal, bridge restart invalidates all in-memory capabilities.
- Browser flow: real Chromium dev-origin OPTIONS/pair/read/revoke direct to bridge; trusted-origin JS can read invalid-code and expired-capability application 401 status/body; an unrelated origin gets no ACAO and JS receives only fetch rejection without HTTP status/body; revoke of tab A leaves tab B read valid; no trace/HAR/code/token capture; every legacy/mutation/unknown path gets its fixed status with zero effects.
- UI transitions: code clears before pending request, duplicate submit ignored, readable pair `400`/`401`/`429`/unexpected status/malformed `200`/network/`5xx` each map to specified form or uncertain state; malformed `200` and 5xx explicitly require fresh code; CORS-blocked failure is generic/uncertain and never guessed; pair `401` does not trigger capability terminal auth; initial read failure preserves cap and supports retry, capability terminal auth clears cap, failed revoke (including revoke 401) uses unconfirmed copy, heartbeat failure stops timer and offers Retry, heartbeat success while `read_failed` does not clear that error, heartbeat recovery requires successful refresh before connected, pair pending focus moves to live status when disabling control would drop focus, late response after disconnect ignored, focus destination/aria feedback works keyboard-only at narrow viewport.

These are future implementation checks. Passing static design review does not establish browser enforcement, OS isolation, SDK safety, or full product readiness.
