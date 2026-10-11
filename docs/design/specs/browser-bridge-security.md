# 브라우저와 로컬 브리지 보안 계약

**v0.4 · 2026-09-28 · 제안 · 구현 전 검증 필요**

## 목적과 보안 경계

이 문서는 신뢰된 로컬 Workbench UI가 loopback bridge에 연결되는 경계와, 프로젝트 프리뷰·원격 페이지·다른 브라우저 출처가 bridge 기능이나 자격 증명을 사용할 수 없도록 하는 앱 소유 계약을 정의한다. 기준은 `docs/engineering/workbench-architecture.md` §1·§5와 `docs/engineering/verification.md` AC-10/S-08이다.

브라우저 경계는 OS 격리나 같은 사용자 권한으로 실행된 악성 프로세스에 대한 인증을 제공하지 않는다. Origin, Host, CORS, loopback 바인딩, bearer capability는 각각 필요한 방어층이며 어느 하나만으로 신뢰를 증명하지 않는다. 프리뷰 콘텐츠와 프로젝트 파일·MCP·도구 결과는 항상 신뢰하지 않는다. SDK 실행 권한은 이 계약으로 부여하지 않는다. 모든 mutation은 별도 승인·정책·런타임 검증을 통과하기 전까지 거부한다.

## 신뢰된 UI와 수신 요청

### 바인딩과 출처 등록

- bridge는 IPv4 `127.0.0.1`에만 바인딩한다. `0.0.0.0`, 인터페이스 자동 탐색, 임의 포트 포워딩은 금지한다. IPv6 loopback은 지원 OS별 검증 후 별도 설계 변경으로 추가한다.
- bridge 시작 전에 신뢰된 UI의 완전한 origin을 launcher 설정에 고정한다. Origin은 scheme, host, port의 정확한 tuple로 비교한다. 프로덕션은 bridge와 같은 origin으로 UI를 제공하는 구성을 우선한다. 개발 모드는 명시적으로 승인된 `http://127.0.0.1:<고정 개발 포트>`만 추가할 수 있다. 포트 0 사용 시 선택된 포트를 신뢰 설정과 동일한 launcher가 생성·고정해야 한다.
- 요청의 `Host`는 bridge가 실제 수신한 로컬 포트의 정확한 authority와 일치해야 한다. `127.0.0.1` 외 hostname, `localhost`, 다른 포트, userinfo, 예상하지 않은 IPv6 표기, 중복 Host 헤더, 잘못된 포트·헤더 형식은 거부한다. 프록시 헤더(`Forwarded`, `X-Forwarded-Host`)로 이를 덮어쓸 수 없다.
- 요청 종류를 먼저 정적 UI 자원, credential 없는 CORS preflight, bootstrap 교환, capability revoke/heartbeat, 일반 API read, stream, 금지된 domain mutation으로 분류한다. production bridge에서 제공하는 정적 UI/asset에는 인증을 요구하지 않으며 해당 handler는 manifest의 정적 파일만 반환한다. development UI는 bridge의 정적 handler를 사용하지 않고 별도의 명시 허용 origin에서 제공한다. trusted UI 응답에 CSP `frame-ancestors 'none'`을 적용한다.
- 브라우저는 same-origin GET/HEAD에 `Origin`을 생략할 수 있다. 일반 read/stream은 하나의 허용 Origin이 있으면 정확히 일치시킨다. `Origin`이 생략된 경우에 한해 브라우저가 설정하는 `Sec-Fetch-Site: same-origin`, 정확한 Host, 유효 bearer capability를 모두 요구한다. `same-site`, `cross-site`, `none`, 누락, `null`, opaque 또는 잘못된 Fetch Metadata는 생략 예외를 받지 않는다. same-origin GET에 없는 Origin을 JavaScript가 덧붙일 수 있다고 가정하지 않는다.
- bootstrap 교환과 revoke/heartbeat는 `Origin`을 필수로 요구하며 생략 예외를 적용하지 않는다. `Origin: null`, 중복, 구문 오류 또는 시작 시 허용 목록에 없는 값은 거부한다. 들어온 Origin을 응답 헤더에 반사하거나 와일드카드 허용을 하지 않는다.
- Host 검사는 모든 브라우저 요청에, Origin과 Fetch Metadata 검사는 아래 정책표의 요청 종류에 적용한다. 서버는 연결의 peer 주소도 loopback인지 확인한다. 요청 헤더 누락 시 브라우저 기본값을 추정하지 않고 fail-closed한다.
- 애플리케이션이 다른 origin에서 제공되는 설치형 shell 또는 reverse proxy 모드를 나중에 지원하려면 명시적인 별도 origin 등록과 동일한 위협 검토를 거쳐야 한다. 임의의 동적 origin 등록은 금지한다.

### 요청 파이프라인과 브라우저 정책

브라우저 요청은 아래 경로별 정책표를 사용한다. 경로 분기는 고정 allowlist에만 일치하며 한 경로의 예외를 다른 endpoint나 임의 URL에 전파하지 않는다.

| 종류 | 예시 method/path | Origin | Capability | 동작 |
|---|---|---|---|---|
| 초기 trusted document | production `GET/HEAD /` | 허용 Origin이면 정확히 일치; Origin 생략 시 `Sec-Fetch-Site: none`, `Sec-Fetch-Mode: navigate`, `Sec-Fetch-Dest: document` 모두 필수 | 불필요 | 해당 metadata를 만족하는 top-level 문서만 정적 반환; cross-site link 차단 |
| 정적 asset | production `GET/HEAD /assets/<manifest-path>` | 허용 Origin이면 정확히 일치; 생략 시 `Sec-Fetch-Site: same-origin`, mode는 `same-origin`, `cors`, `no-cors` 중 하나, dest는 `script`, `style`, `image`, `font` 중 하나 | 불필요 | manifest 정적 자원만 반환; API handler 진입 금지 |
| CORS preflight | `OPTIONS /api/v1/<fixed-route>` | 단일 허용 Origin 필수 | 불필요 | route에 허용된 method/header만 최소 CORS 응답, 상태 변경 없음 |
| Pairing | `POST /api/v1/pair` | 단일 허용 Origin 필수 | bootstrap code | 일회 교환; 원자 소비 후 읽기 capability 발급 |
| Revoke/heartbeat | `POST /api/v1/pair/revoke`, `/heartbeat` | 단일 허용 Origin 필수 | 해당 tab capability | control-plane 예외: 해당 capability 폐기 또는 인증된 activity만 기록 |
| 일반 read | 명시된 `GET/HEAD /api/v1/...` | 허용 Origin은 정확히 일치; 생략은 `Sec-Fetch-Site: same-origin`인 production same-origin 요청만 | 필수 | schema 검증된 읽기만 실행 |
| Event stream | `GET /api/v1/events` | 일반 read와 동일: allowlisted Origin 일치 또는 production `same-origin` Fetch Metadata 생략 예외 | 필수 | 인증 read stream, 만료 시 종료 |
| domain mutation/미등록 경로 | 모든 기타 쓰기·실행 요청 | 적용 가능한 Host/Origin 검사 후 | 있어도 불허 | `MUTATION_DENIED` 또는 `FEATURE_DISABLED`, 부작용 0회 |

Event stream에는 일반 read와 같은 Origin/Fetch Metadata 규칙을 적용한다. Origin 없는 요청은 production same-origin에서 `Sec-Fetch-Site: same-origin`인 fetch만 허용하며 development origin의 정상 CORS fetch는 명시 허용된 Origin을 반드시 보내야 한다.

모든 요청의 공통 처리 순서는 (1) loopback peer와 listener/Host 검증, (2) exact route/method 분류, (3) 그 route 행에서 정한 Origin·Fetch Metadata 규칙, (4) 그 route 행의 credential 규칙, (5) 크기/content/schema 검사, (6) 해당 행에 명시된 동작 실행이다. 공통 절차는 Origin이나 bearer를 일괄 요구하지 않으며 정책표의 정확한 예외를 따른다. `pair`, `revoke`, `heartbeat`는 제한된 authentication-control 동작만 허용한다. 그 외 domain mutation과 실행은 항상 거부한다. 모든 거부 경로는 SDK 호출, process 실행, 파일 변경, domain 데이터 변경 0회여야 한다. Pair code는 단일 원자 연산으로 소비한다. 응답 유실 후 새 수동 pairing을 요구한다. Revoke는 해당 capability와 그 stream만 종료한다.

브라우저 `fetch`는 `credentials: "omit"`을 사용한다. bridge는 쿠키 기반 인증, 사용자명/비밀번호 인증, `Access-Control-Allow-Credentials: true`, 임의 Origin 반사, `*` CORS를 사용하지 않는다. 브라우저 same-origin 호출에는 CORS 응답을 요구하지 않는다. cross-origin 개발 호출의 preflight는 credential 없이 정확한 Origin, method, 허용 header를 검사한 뒤에만 응답한다. CORS는 브라우저 편의 정책이며 인증·CSRF·Host 검사를 대체하지 않는다.

POST/기타 비안전 method에는 JSON content type, 제한된 body 크기와 schema 검증을 요구한다. Pair에는 bootstrap code와 exact Origin, revoke/heartbeat에는 capability와 exact Origin, 모든 domain mutation에는 deny policy를 적용한다. GET/HEAD/OPTIONS는 부작용이 없어야 한다. 알 수 없는 method, content-type 우회, 중복 보안 헤더, 과도한 body는 안정된 오류로 거부한다. 프레임워크 기본 동작을 검증하지 않은 채 CSRF 방어로 간주하지 않는다.

## Bootstrap과 capability 수명

### Bootstrap 코드 발급·교환

- Architecture §5에서 후보로 제시한 fragment 전달은 폐기한다. 유일한 pairing 흐름은 신뢰된 launcher가 대화형 로컬 터미널에 CSPRNG로 생성한 256-bit one-time bootstrap code를 표시하고 사용자가 UI에 직접 입력하는 것이다. 다른 implicit/fragment 경로를 혼용하지 않는다. URL path/query/fragment, clipboard 자동 복사, environment, process argv, cookie, browser storage, log로 전달하지 않는다.
- Code 상태는 `issued → consumed | expired | locked | revoked`다. bridge epoch별 하나만 활성화한다. TTL 120초, 최대 5회 실패다. 각 실패는 현재 code counter만 올리고 다섯 번째 실패는 그 code를 locked로 소비한다. 전역 peer lockout은 없다. 새 code는 대화형 launcher에서 재발급하며 이전 code를 폐기한다. 비교값은 hash로 저장하고 constant-time 비교를 사용한다.
- UI는 고정된 bridge origin의 전용 `POST` JSON 교환 요청에 코드를 보낸다. 이 경로에도 정확한 Host/Origin 검사를 적용한다. 응답에는 `Cache-Control: no-store`, `Pragma: no-cache`, 제한적 `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`를 적용한다. 입력과 응답 본문은 access/error/analytics 로그에서 제거한다.
- 교환은 단일 원자 연산으로 유효 code를 `consumed`로 전이하고 CSPRNG 256-bit capability 하나를 발급한다. 동시 요청 중 하나만 성공한다. 응답 유실 뒤 code를 재사용하지 않고 새 수동 pairing을 요구한다. 응답은 pairing UI에서만 메모리로 전달한다. capability는 URL, history, referrer, cookie, local/session storage, IndexedDB, Cache API, service worker, 정적 bundle, clipboard, 로그, export, 오류 telemetry에 저장하지 않는다.
- bootstrap 코드는 bridge 사용자를 인증하지 않는다. 사용자의 로컬 터미널 접근과 신뢰된 UI 사용을 전제로 하는 기기 내 pairing 절차다. OS 로그인 경계를 넘는 접근 통제로 표시하지 않는다.

### Capability 권한·폐기

- 최초 구현에서 capability는 정확한 신뢰 UI origin에 대해 발급된 per-tab 임의 bearer다. UI는 현재 탭의 메모리에만 두며 `Authorization: Bearer …` header로 보낸다. preview iframe, worker, 다른 tab, 다른 origin, 프로젝트가 제공한 코드로 전달하지 않는다.
- 서버는 원 capability 대신 해시를 저장한다. capability는 읽기 전용 API 범위와 현재 bridge 실행 epoch로 한정한다. 모든 mutation, 명령 실행, SDK 호출은 capability가 있어도 별도 admission 정책이 허용하기 전까지 거부한다.
- Capability 상태는 `active → idle_expired | absolute_expired | revoked | bridge_epoch_ended`이며 종결 상태에서 복구되지 않는다. 절대 만료는 발급 후 8시간, idle 만료는 마지막 인증된 non-stream API 동작 후 15분이다. 오래 걸리는 요청과 이벤트 수신은 activity가 아니다. 활성 탭은 capability로 5분마다 `POST /api/v1/pair/heartbeat`를 보내 idle timer를 갱신한다. Heartbeat는 exact Origin을 요구하고 별도 side effect는 없다.
- Revoke, bridge 재시작/epoch 종료, 절대·idle 만료 시 즉시 폐기한다. 잘못된 bearer나 Origin 요청은 기존 capability를 폐기하지 않는다. Revoke는 해당 capability의 새 요청을 막고 연결된 stream을 종료한다. 만료로 종료된 stream은 다음 연결에서 `AUTH_EXPIRED`를 반환한다. 탭 닫힘은 서버가 반드시 관측할 수 없으므로 종료만으로 폐기를 보장한다고 주장하지 않는다.
- capability 응답은 `Cache-Control: no-store`이며 browser cache/history 저장을 금지하도록 응답 정책을 적용한다. 인증 오류는 credential을 포함하지 않는 `AUTH_REQUIRED`, `AUTH_EXPIRED`, `AUTH_REVOKED` 등 안정된 코드로 반환한다.

## 프리뷰·이벤트·오류 처리

### 프리뷰 격리

- 모든 embedded preview는 trusted UI와 다른 origin이어야 하며 iframe은 `sandbox="allow-scripts"`만 허용한다. `allow-same-origin`, forms, popups, downloads, modals, pointer lock, presentation, top-navigation 등은 금지한다. sandbox는 top navigation과 popup을 막지만 iframe 자체의 후속 navigation 전체를 부모 UI가 가로채거나 차단한다고 주장하지 않는다. sandbox의 opaque origin은 bridge API에서 거부되며 trusted UI 응답의 `frame-ancestors 'none'`은 trusted UI가 iframe으로 렌더링되는 것을 막는다. 다른 origin과 최소 sandbox를 강제하지 못하면 embedded preview는 비활성화한다.
- 앱은 embedded preview의 최초 URL과 사용자가 시작한 각 명시적 열기 동작을 검사한다. `http:`/`https:` 외 scheme, credential URL, `blob:`, `data:`, `javascript:`, `file:`, `srcdoc` preview는 거부한다. iframe 내부의 후속 redirect/self-navigation은 브라우저 sandbox·trusted UI framing 정책·bridge Origin/Host/capability admission으로 제한되며 앱이 매 이동을 관측하거나 선제 차단하지 않는다. trusted UI origin으로 향하는 응답은 framing 거부되고 bridge API 요청은 유효 출처/credential이 없으면 거부되어야 한다. 이 강제 결과를 실제 브라우저에서 시험한다.
- 외부 브라우저 열기는 별도 앱 제어 채널을 제공하지 않는다. 사용자가 승인한 최초 URL만 검사하고 `noopener,noreferrer`로 연다. 이후 redirect/navigation은 앱이 관측하거나 제어할 수 없으며 외부 페이지는 계속 신뢰하지 않는다. capability는 외부 탭에 전달하지 않으며, 외부 탭이 bridge에 접근해도 server-side Host/Origin/Fetch Metadata/capability 검사를 통과하지 못해야 한다. 외부 브라우저 navigation 전체 차단이 제품 요구가 되면 이를 지원하는 별도 native/managed-browser boundary를 설계할 때까지 external-open 기능을 비활성화한다.
- trusted UI에는 CSP `frame-ancestors 'none'`을 설정한다. bridge credential과 bootstrap 코드는 preview iframe, preview URL, query/fragment, referrer, `postMessage` payload에 절대 넣지 않는다. Parent/preview `postMessage`는 MVP에서 비활성화한다. 필요해지면 별도 명세·리뷰를 거친다. 차단/CSP 실패는 성공으로 표시하지 않는다.
- same-site cookie 공유를 인증 수단으로 사용하지 않으므로 preview가 bridge host에 요청해도 유효한 capability가 없어야 한다. 악성 preview의 fetch/form/navigation/WebSocket 시도가 실제 API 효과 0회인지 후속 S-08에서 관측한다.

### 이벤트 전달

- 최초 구현은 인증된 `fetch` 기반의 스트리밍 응답(SSE 형식의 event frames)을 사용한다. `EventSource`는 임의 Authorization header를 보내기 어려우므로 사용하지 않는다.
- WebSocket은 이 버전에서 사용하지 않는다. 향후 사용하려면 upgrade handshake의 Origin/Host 검사, header bearer 전달, 재연결·폐기·message schema·rate limit을 별도 설계·리뷰·런타임 시험으로 통과해야 한다. capability를 URL query나 subprotocol에 넣는 방식은 금지한다.
- 스트림은 capability 만료·폐기·연결 해제 시 종료한다. 이벤트 payload는 redacted app event만 제공하고 secrets, 전체 prompt, credential, 임의 파일 내용을 넣지 않는다. 재접속은 cursor와 snapshot을 대조하며 누락을 보장된 replay로 표시하지 않고 기존 `history_gap` 계약을 따른다.

### 안정된 거부 동작

| 조건 | 오류 코드 예시 | 기대 동작 |
|---|---|---|
| peer 또는 Host가 비허용 | `HOST_DENIED` | 처리 전 거부, endpoint·상태 비노출 |
| 초기 document/asset/read/stream에 정의한 Fetch Metadata 예외를 벗어난 Origin 누락·opaque·비허용 값 | `ORIGIN_DENIED` | 처리 전 거부, Origin 반사 금지 |
| pairing 코드 없음/만료/재사용 | `BOOTSTRAP_INVALID` | capability 발급 없음; 실패 제한 적용 |
| 해당 bootstrap code 5회 실패로 잠김 | `BOOTSTRAP_RATE_LIMITED` | 현재 code 폐기, 사용자가 launcher에서 새 code 발급 |
| capability 누락/오류 | `AUTH_REQUIRED` | API 자료 제공 없이 거부 |
| capability 만료/폐기 | `AUTH_EXPIRED` / `AUTH_REVOKED` | stream 종료 및 다시 pair하도록 안내; 무효 credential은 다른 tab을 폐기하지 않음 |
| 잘못된 schema/method/body | `REQUEST_INVALID` | handler side effect 0회 |
| 현재 범위에서 금지된 mutation | `MUTATION_DENIED` | SDK/process/filesystem 변경 0회 |
| 기능 미구현 또는 비활성 | `FEATURE_DISABLED` | 기능이 실행된 것처럼 가장하지 않음 |

오류 응답은 request correlation ID만 허용하고 입력, 코드, bearer, 전체 경로, 원본 body를 포함하지 않는다. 거부 사유는 사용자에게 필요한 범위로 설명하되 내부 경로·credential 상태·서비스 구조를 공격자에게 과도하게 노출하지 않는다.

## 보안 검증 행렬

정적 설계 검토는 런타임 안전 증거가 아니다. 아래 라이브 시험은 별도의 승인된 구현 run에서 합성 fixture와 실제 브라우저/로컬 bridge를 대상으로 실행하고, 요청·거부·side-effect counter·process/API 상태를 함께 기록해야 한다.

| ID | 시험 | 기대 결과 | 필요한 증거 |
|---|---|---|---|
| BB-01 | launcher가 직접 연 초기 document(`none/navigate/document`), same-origin asset(fetch metadata allowlist), Origin 생략 same-origin GET/HEAD, 유효 capability read/stream | static 자원은 credential 없이 제공; API read/stream은 browser `same-origin` metadata와 bearer로 성공 | browser 생성 headers, document/asset/API 응답, capability scope, side effect 0 |
| BB-02 | endpoint별 금지된 누락, `null`, opaque, 잘못된 형식, 중복, 다른 port/host Origin 및 cross-site navigation | `ORIGIN_DENIED`; 상태 비노출. BB-01에 지정된 static/API 생략 예외만 허용 | request class별 raw headers, 응답 코드, handler 진입/효과 counter 0 |
| BB-03 | `localhost`, 외부 Host alias, 다른 port, userinfo, 중복 Host 및 비-loopback peer | 연결/요청 거부 | 실제 bound address와 peer/Host 관측, 효과 0 |
| BB-04 | 외부 Origin simple form/fetch/preflight 및 DNS-rebinding Host; 명시 허용된 dev Origin preflight와 credential-bearing read | 외부 origin 거부; 허용 dev preflight만 최소 header/method로 성공하고 유효 capability 없는 read는 거부 | browser network log, exact CORS headers, admission 및 효과 관측 |
| BB-05 | bootstrap code 만료·재사용·5회 실패·재발급·동시 교환·응답 유실 후 재시도 | 정확히 하나만 소비/발급; 실패 5회면 해당 code만 잠김; 유실은 새 수동 pairing 필요 | 상태 전이·요청 순서, capability hash, code 로그 부재 |
| BB-06 | query/fragment/history/referrer/cookie/storage/cache/service-worker/bundle/log 유출 검사 | 코드와 capability가 지정 위치 모두에 없음 | 브라우저 저장소·history·network·bundle·log 검사 |
| BB-07 | missing/wrong/expired/revoked bearer, 무자격 실패와 다른 tab, idle 중 stream, heartbeat, 유휴/절대 만료, bridge restart, 한 tab revoke와 다른 tab 동시 read | revoke 성공 응답 후 target tab 차단/stream 종료, 다른 tab capability는 유효; 만료 stream 다음 연결은 `AUTH_EXPIRED` | capability별 상태, revoke receipt, expiry/stream close, effect 0 |
| BB-08 | embedded initial URL의 비허용 scheme/trusted UI origin, sandbox top-navigation/popup 시도, iframe self-navigation 후 trusted UI URL 응답, UI framing, external-open의 최초 URL 검사와 이후 navigation, bridge fetch/form/WebSocket | 금지된 최초 URL/top-navigation/popup은 차단; iframe이 trusted UI를 렌더링하지 못함; external 이후 이동은 앱이 통제하지 않음을 확인; 모든 출처 불일치 bridge 요청은 거부, side effect 0 | 실제 iframe sandbox/CSP/origin, redirect chain, browser frame tree와 network log, bridge admission 및 API/파일/process 전후 |
| BB-09 | 권한 있는 UI의 중복/잘못된 content type/body size/지원하지 않는 method | `REQUEST_INVALID`; mutation 0 | 요청 schema, handler admission, SDK/process/filesystem counter 0 |
| BB-10 | 사용 중인 스트림 reconnect 및 cursor 누락 | snapshot 대조와 `history_gap`; 누락 event를 꾸며내지 않음 | app sequence, reconnect cursor, snapshot 및 UI 상태 |

BB-01부터 BB-10까지는 현재 설계 상태에서는 **미실행**이다. BBS-1..3 통과나 설계 리뷰는 S-08, AC-10 또는 OS 수준의 격리를 완료했다는 뜻이 아니다. Canary나 실제 SDK 호출은 이 설계 검증의 일부가 아니다.

## 한계와 구현 게이트

- 악성 같은 사용자 프로세스는 loopback 포트에 접속하거나 사용자 권한으로 브라우저 프로필/프로세스에 접근할 수 있다. capability는 이 위협에서 완전한 기기 인증을 제공하지 않는다. OS sandbox, 별도 사용자, 서명 launcher 같은 추가 경계는 지원 목표와 증거를 정한 별도 ADR 대상이다.
- 악성 브라우저 확장, 신뢰 UI의 XSS, compromised dependency, 로컬 관리자/root, 브라우저 취약점은 이 계약만으로 해결되지 않는다. CSP, dependency provenance, patch 관리, OS 권한 통제는 후속 구현·운영 계약이다.
- 브라우저 Origin/Host 동작, loopback 취급, mixed content, private-network access 정책은 브라우저·OS 버전별 검증이 필요하다. 주소 차단이나 CORS만으로 공격 불가를 단정하지 않는다.
- 후속 구현은 endpoint 추가 전에 이 문서와 architecture §5를 반영한 schema·admission 경계를 만들고, 정적 단위 시험 이후 실제 로컬 bridge와 브라우저에서 BB-01..10 및 S-08을 실행해야 한다. 실패한 preview 분리는 preview 기능을 비활성화한다. 인증 경계가 불확실하면 bridge API와 SDK mutation은 닫힌 상태를 유지한다.

## 변경 이력

- v0.1: browser-to-bridge Host/Origin, 수동 bootstrap, 메모리 전용 capability, preview 분리, 인증 이벤트 스트림 및 후속 검증 경계를 정의.
- v0.2: 리뷰 결과에 따라 browser-valid Origin 예외, endpoint별 credential policy, lifecycle limit, mandatory preview separation 및 redirect/framing 거부를 구체화.
- v0.3: common admission 절차를 route policy에 통합하고, initial document/asset Fetch Metadata, development preflight, revoke 격리 시험, 최신 hash-bound review packet 요구를 구체화.
- v0.4: embedded preview와 external-open의 실제 제어 경계를 구분하고, 앱이 관측할 수 없는 후속 navigation 차단을 보장하지 않도록 수정.
