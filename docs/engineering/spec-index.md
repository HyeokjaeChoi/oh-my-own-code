# oh-my-own-code 통합 스펙

**Spec set v0.12 · 2026-09-28 · Electron selected for macOS/Windows · review required**

[PRD v0.6](../product/prd.md)를 디자인·개발·검증·개인 운영 계약으로 구체화하며 18개 기능군 전체를 유지한다. Electron은 사용자가 명시적으로 선택했다. 이전 진행 승인은 구 해시 문서 묶음에만 적용된다. 현재 문서는 새 독립 검토와 현재 문서 집합의 명시적 진행 승인이 끝나기 전까지 구현 근거가 아니다.

## 문서와 책임

| 문서 | 정하는 내용 | 정하지 않는 것 |
| --- | --- | --- |
| [사용 경험](../design/specs/workbench-ux.md) | 화면 구성, 조작·상태·오류 표현, 접근성, UI 라이브러리 책임, 의미 기반 토큰 계약 | 실제 제품 렌더링·키보드·스크린리더 검증 결과 |
| [디자인 시스템](../design/system.md) 및 [컴포넌트 계약](../design/components.json) | 저장소 토큰 원본, 6개 기반 계열·44개 variant, content·상태·Light/Dark·motion, 런타임 권한 문구 원본 | 구현된 앱의 실제 렌더링과 접근성 동작 |
| [엔지니어링](workbench-architecture.md) | 실행 계층·저장·API·이벤트·권한·경로·복구 계약과 기술 검증 순서 | 검증되지 않은 SDK 호환성·강제 보안 보장 |
| [검증](verification.md) | AC-01~18의 성공·실패 판정, 합성 자료, 단위·통합·E2E·검토 증거 | 아직 실행하지 않은 테스트의 통과 |
| [출시·운영](../operations/local-release-monitoring.md) | 개인 로컬 출시·복구·관찰·사용/학습 지표 | SaaS 운영·외부 telemetry·청구·상용 성장 지표 |

이 인덱스는 승인 대상 파일 집합과 의존 관계를 묶는다. 중복된 실행 계획은 만들지 않으며 작업 배정·진행의 SSOT는 위 run plan이다. wire/API/영속 상태 식별자는 엔지니어링 문서, 표시·조작 의미는 UX 문서, 검증 판정은 verification 문서, 운영 대응과 지표는 operations 문서가 소유한다. 모순은 해석으로 덮지 않고 해당 계약을 수정·재검토한다.

## 공통 불변 조건

- 작업 폴더·Git worktree·세션·실행·자식·도구 호출을 구별한다. 앱의 ID와 SDK ID는 매핑하며 같은 값이라고 가정하지 않는다.
- 화면의 성공 표시는 실행 계층이 확인한 상태를 따른다. 요청 전송, 승인 클릭, 중단 요청은 각각 실제 적용·완료·종료와 다르다.
- 목록 제거·보관·대화 삭제·파일/워크트리 물리 삭제는 서로 다른 동작이다. 활성 작업과 데이터 손실 위험을 확인하기 전 삭제하지 않는다.
- 권한 축소와 경로 삭제는 신규 호출, 대기 승인, 자식과 프로세스를 함께 고려한다. 진행 중 부작용을 소급 취소했다고 표시하지 않는다.
- 새 위임은 필요한 자료를 전달하는 새 컨텍스트가 기본이며 대화 복사 fork와 구별한다. UI가 실제 런타임 격리의 증거는 아니다.
- 도구와 브라우저 콘텐츠는 신뢰되지 않은 입력이다. 렌더링 결과·직접 도구 실행·슬래시 명령으로 승인 경계를 우회하지 못한다.
- assistant-ui는 대화 상호작용, tool-ui는 검증된 도구 결과/선택 UI를 맡으며 실행·권한은 로컬 계층이 소유한다. 두 번째 모델 실행 루프를 추가하지 않는다.
- 누락 이벤트는 누락으로 남긴다. 재접속·재시도·앱 재시작이 이미 일어난 부작용을 자동 반복시키지 않는다.
- 개인용 로컬 저장·관찰을 기본으로 한다. 벤더 인증 UI와 외부 분석/모니터링 서비스는 추가하지 않는다.

## PRD 추적표

모든 행은 구현·검증해야 할 목표다. 문서 존재 자체로 구현 완료 처리하지 않는다.

| PRD | 주 계약 | 검증에서 확인할 핵심 |
| --- | --- | --- |
| AC-01 import | UX + Engineering | 경로 식별·중복·손상·읽기 권한·무실행 import |
| AC-02 생성 | UX + Engineering | SDK 우선 이름·date/UUIDv7 fallback·부모 경계·경쟁 생성 |
| AC-03 삭제 | UX + Engineering | 대상 확인·busy/dirty 차단·강제 삭제 별도 확인·원본 보존 |
| AC-04 작업 | UX + Engineering | 두 병렬 세션 분리·보관/복원·재시작·깨진 경로 |
| AC-05 대화 | UX + Engineering | 스트리밍·첨부·컨텍스트·수정/분기·중단·부작용 재시도 |
| AC-06 선택 | UX + Engineering | model/agent/effort 지원값·요청값·적용 경계 |
| AC-07 자식 | UX + Engineering | 새 컨텍스트·둘 이상 병렬·실패/결과 회수·개별/전체 중단 |
| AC-08 도구 | UX + Engineering | rich/generic UI·스키마 검증·직접 호출·권한·오류 |
| AC-09 권한 | UX + Engineering | 허용/거절/deny·유효 정책·실행 중 전환·낡은 승인·자식 |
| AC-10 프리뷰 | UX + Engineering | 실제 로컬 앱·파일·임베드 실패·origin 분리·server 생명주기 |
| AC-11 변경 검토 | UX + Engineering | 외부 파일 충돌·diff·Git 선택·복원·소유 경로 보호 |
| AC-12 터미널 | UX + Engineering | 실제 PTY·입력/리사이즈/종료·주체 구별·고아 프로세스 |
| AC-13 명령 | UX + Engineering | native 목록/인자/실행·앱 명령·충돌·오류·busy |
| AC-14 구성 | UX + Engineering | 출처·편집/검증/적용·MCP 연결·비신뢰 plugin/인증 없음 |
| AC-15 계획/리뷰 | UX + Engineering | 문서 버전 승인·진행·독립 리뷰·실제 검사 결과 |
| AC-16 관찰/학습 | UX + Operations | 근거 연결·미제공 usage·합성/실제 사례·학습 점수 |
| AC-17 복구/데이터 | Engineering + Operations | 누락/재조회·중복 방지·export/import·보존/삭제 범위 |
| AC-18 편의/자동화 | UX + Operations | 키보드·설정·알림·반복 작업·중단 기간 미실행 |

각 행의 구체적인 사례·증거 형식은 verification 문서에 연결한다. 외부 서비스 없이 검증할 수 없는 모델 호출은 별도 live 검증으로 분리하고 mock 성공과 실제 실행 성공을 혼동하지 않는다.

## 다음 단계의 승인 경계

### 통합한 주요 설계 결정

| 결정 | 제안/계약 | 아직 증명하지 않은 부분 |
| --- | --- | --- |
| 실행 경계 | UI와 로컬 bridge를 분리하고 앱 작업·SDK 호출의 권한/경로 검증을 같은 진입점에 둔다. | SDK 내부 우회 차단, 임의 shell/plugin 격리와 OS 수준 강제 |
| 엔진·저장 | App-owned OpenCode v2 `serve` sidecar + version-matched `@opencode/client` + local SQLite | Exact CLI/client version, per-OS packaging, readiness/auth/lifecycle probes remain required |
| 상태 | 요청값·유효값·관측값을 구분하고, 확인할 수 없는 부작용은 `unknown`으로 남긴다. | native 기록·receipt의 실제 가용성과 복구 범위 |
| 생성 | `targetPath`는 정확한 새 경로, `parentPath`/`desiredName`은 부모 아래 생성이다. 기존 경로는 import로 분리한다. | SDK 기본 이름·전략의 실제 부모 경로 강제·setup 분리 |
| 재시도 | 호출 주체·작업 범위·동작 종류별 멱등 키를 사용한다. 이미 dispatch한 변경은 자동 재실행하지 않는다. | crash 직후 상태를 각 도구/파일/Git 단위로 대조하는 구현 |
| 접근성 | 모달만 focus를 가두고 대화 안의 권한 카드는 일반 키보드 이동에 참여한다. | 실제 렌더링·키보드·스크린리더 검증 |

### 기술 검증과 의존 관계

엔지니어링 문서의 S-01~10은 실행 전 확인할 목록이며 완료된 연구 결과가 아니다. 스펙 승인 뒤 별도의 검토된 실행 계획 아래 **합성 임시 자료를 쓰는 최소 검증용 프로토타입**을 만들 수 있다. 이 제한된 spike를 제품 기능 완성과 혼동하지 않는다.

| 검증 묶음 | 의존하는 제품 동작 | 확인해야 할 결정 |
| --- | --- | --- |
| S-01 / S-07 | 실행 엔진과 assistant-ui·tool-ui 연결 | 정확한 SDK/UI 버전, host/client, 상태 어댑터 |
| S-02 / S-03 | import·생성·setup·삭제 | 무실행 import, 부모 경로 강제, 네이밍·삭제 전략 |
| S-04 / S-05 / S-06 | 자식·직접 도구·권한·명령 | 빈 컨텍스트, 실제 권한 강제/전환, native/앱 명령 경계 |
| S-08 / S-09 | 로컬 제어·프리뷰·복구 | credential 격리, 악성 preview 차단, 누락·중복·crash 처리 |
| S-10 | OS 파일 선택·알림·데스크톱 수명 | Electron main/preload boundary, app-owned OpenCode `serve` lifecycle, native dialog/notification, separate packaged macOS and Windows evidence |

이 스펙 집합을 검토·승인한 뒤, 승인된 범위의 기술 검증과 디자인 준비를 진행한다. SDK 패키지/호환성·권한·경로 안전성 등 해당 검증을 통과하기 전에는 그에 의존하는 구현을 완료할 수 없다. 실패하면 대안과 영향 범위를 제시하며 필수 기능을 묵시적으로 삭제하지 않는다.

The user explicitly confirmed an installed Electron desktop-app target for macOS and Windows and an app-owned OpenCode v2 `serve` sidecar. Current Electron product/design/architecture contracts require fresh independent reviews and explicit approval of this exact integrated document set before implementation. Figma connection is user-reported; access to a specific file is not verified.

## 승인 대상 버전

아래 도메인 문서와 디자인 소스의 SHA256으로 구현 입력을 고정한다. 이 인덱스 자체의 해시는 run contract에 기록하여 자기 참조를 피한다.

| 문서 | 버전 | SHA256 |
| --- | --- | --- |
| `docs/product/prd.md` | 0.6 | `1fc42c79ced241772b77fb06c38e6e855fbfbf2308d09ace51f0eaf7a0c2bbe3` |
| `docs/design/specs/workbench-ux.md` | 0.6 | `1f59e6f83aca0c077a4db10cc8c65f7e27e5f177ae0aa32dc6508f4134c97525` |
| `docs/engineering/workbench-architecture.md` | 0.6 | `d07aa9234632541056bbe3b96756f2fe7081214f4590397fe0260fd01c31ccae` |
| `docs/engineering/verification.md` | 0.5 | `4c1e60680cf7b20b02efb35230e8af1588b558b80adab8c15442639c49ead696` |
| `docs/operations/local-release-monitoring.md` | 0.4 | `fe97cb8a4c69e2331b74e3c8263387132ae466150a721e9838a107a95a60e163` |
| `docs/design/system.md` | 2026-09-27 | `4697eb4961952ee85a4732ed77e5addbb17058a8b3d12485aa56158324f661a5` |
| `docs/design/components.json` | component-contract-v3 | `76460f0cc7099ef6b628ce654994d89fc75e5e863d33c103daae8049493f2ed2` |
| `docs/decisions/0002-desktop-runtime.md` | 0002 | `1ebaa6585f7e56e1361d174fec25a7cdd080fd4f283067c72ca1d5111f7dcb65` |
