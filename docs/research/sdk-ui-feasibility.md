# SDK/UI 기술 타당성: 첫 번째 제한적 spike

확인일: 2026-09-26 KST. 대상: S-01/S-07의 **패키지 세대 및 합성 데이터 경계**. Node v26.8.2, pnpm 11.17.0, macOS에서 수행했다. 제품 앱, 실제 OpenCode host/service, 모델 호출, 브라우저 화면은 만들거나 실행하지 않았다.

## 판정

새 OpenCode v2 client와 assistant-ui의 외부 상태 경로는 **각각의 기본 동작을 확인했다**. 두 라이브러리 사이의 실제 이벤트 변환·연결까지 검증한 것은 아니다. 고정한 `@opencode/client@2.0.18`의 생성된 `server.info()` 메서드는 합성 custom `fetch`를 통해 `GET /api/info`를 호출했다. `@assistant-ui/react@0.15.22`의 `ExternalStoreRuntime`은 합성 메시지와 도구 호출 fallback을 SSR로 렌더링했다. 실제 host 수명, 사용자 설정 격리, live 이벤트, Tool UI의 assistant-ui 내부 카드 dispatch는 **미검증**이다.

`@assistant-ui/react-opencode@0.2.25`는 npm manifest에서 구세대 `@opencode-ai/sdk ^1.18.31`에 의존한다. [현재 OpenCode 어댑터 quickstart](https://www.assistant-ui.com/docs/runtimes/opencode/quickstart)는 로컬 서버와 그 client를 전제로 한다. 이 어댑터를 새 `@opencode/sdk` 또는 `@opencode/client`의 검증된 호환 어댑터로 간주하지 않는다. [새 SDK 공식 문서](https://opencode.ai/v2/docs/build/sdk)는 별도 패키지의 embedded host를 설명한다.

## 고정 의존성과 실제 검사

| 경계 | 버전 및 검사 결과 | 한계 |
| --- | --- | --- |
| OpenCode host | `@opencode/sdk@2.0.18` 설치, `.` export 및 `@opencode/client@2.0.18` 의존성 확인, `OpenCode.create` 타입 검사 | host import/start/close는 수행하지 않음. 실제 자격 증명·설정·플러그인 접근 여부 미확인 |
| OpenCode client | `@opencode/client@2.0.18`; `OpenCode.make({baseUrl, fetch})`의 생성 API가 합성 응답을 받음 | custom fetch에서만 수행. 실제 service, 인증, 이벤트 구독·재연결 없음 |
| assistant-ui | `@assistant-ui/react@0.15.22`, `react/react-dom@19.2.4`; `ExternalStoreRuntime`의 합성 text와 tool fallback SSR 통과 | `Tools({toolkit})` 등록은 타입 검사만 통과. SSR thread에서는 등록 카드 대신 fallback이 나타났으므로 카드 dispatch 성공이라고 주장하지 않음 |
| Tool UI | 공식 registry `link-preview` 소스의 Zod parser와 실제 `LinkPreview` 컴포넌트 단독 SSR 통과 | 브라우저 클릭, CSS, 키보드, 승인 callback, assistant-ui 메시지 안의 카드 렌더링 미확인 |

Tool UI는 [공식 Quick Start](https://www.tool-ui.com/docs/quick-start)의 안내대로 앱으로 소스를 복사해 사용하는 registry 구성이다. 이 spike는 외부 agent CLI나 shadcn CLI를 실행하지 않았다. [`link-preview` registry JSON](https://www.tool-ui.com/r/link-preview.json)을 `spikes/sdk-ui/vendor/tool-ui/`에 저장해 SHA-256 `448c466f90f38775e758882c3df6afcbbf935ddd54262d4cc1725dde1cf24028`로 고정했다. 내부 파일은 JSON 원문과 byte 단위로 대조한다. `schema.ts`는 [upstream commit `49a870286facdbf28160cd647f0d337ebdc9b275`](https://github.com/assistant-ui/tool-ui/tree/49a870286facdbf28160cd647f0d337ebdc9b275)의 동일 경로와 byte 단위로 비교했고, 같은 commit의 [MIT license](https://github.com/assistant-ui/tool-ui/blob/49a870286facdbf28160cd647f0d337ebdc9b275/LICENSE.md)를 보관했다. registry 전체와 commit 전체가 동일하다고 추정하지 않는다. 출처와 비교 범위는 `provenance.json`에 기록했다.

실제 발견: Tool UI의 `safeParseSerializableLinkPreview`는 `javascript:alert(1)` URL을 받아들인다. 실제 컴포넌트의 `sanitizeHref`를 거친 SSR 결과에서는 클릭 가능한 `role="link"`, `tabindex`, 해당 URL의 `href`가 나오지 않았다. 따라서 **schema 통과와 안전한 탐색은 별도 조건**이며, 브라우저 상호작용과 다른 컴포넌트에 대한 보안 결론은 보류한다. 잘못된 일반 문자열 URL은 parser에서 거부됐다.

## 재현과 안전 경계

`spikes/sdk-ui/package.json`에 직접 의존성을 정확한 버전으로 기록하고 `pnpm-lock.yaml`에 전이 의존성을 고정했다. 설치는 `pnpm install --frozen-lockfile --ignore-scripts`로 재현한다. 최초 lock 생성에도 `--ignore-scripts`를 사용했다. pnpm 11의 공급망 정책 검증이 새 OpenCode 2.0.18 관련 전이 패키지 12개의 `minimumReleaseAgeExclude`를 `pnpm-workspace.yaml`에 자동 기록했다. 이 목록은 이 spike 폴더에만 있으며 전역 설정을 바꾸지 않았다. 설치 후에는 저장소 루트에서 다음 단일 명령을 실행한다.

```sh
cd /Users/hyukjaechoi/Projects/oh-my-own-code/spikes/sdk-ui
pnpm install --frozen-lockfile --ignore-scripts
cd /Users/hyukjaechoi/Projects/oh-my-own-code
node spikes/sdk-ui/verify.mjs
```

검증기는 네트워크에 접속하거나 설치/파일 생성을 하지 않는다. 고정 버전, lock, vendored registry 내용과 license를 확인하고, TypeScript 검사와 실제 UI 합성 SSR 및 client custom-fetch probe를 실행한다. Node 코드에서 가짜 `.invalid` URL을 사용하지만 `fetch`는 합성 함수로 완전히 교체돼 실제 요청이 없다. 재현 단계에서 설치는 공개 npm registry 접속이 필요하다. 개인 설정, 계정, 토큰, 작업 파일, 유료 모델 프롬프트를 사용하지 않았다.

pnpm `exec`는 이 환경에서 lock 공급망 정책을 다시 온라인 검사하려다 sandbox DNS 오류로 지연됐다. 검증기는 설치된 TypeScript/tsx를 Node로 직접 호출하므로 로컬 실행에 DNS가 필요 없다. 이는 패키지 부재나 타입 오류의 증거가 아니다.

## 다음 분리 검사

- **S-01 host:** 실제 `OpenCode.create()` 전에 설치 버전의 config/credential/plugin 탐색 경로와 환경 override를 문서·소스로 확인해야 한다. 임시 홈/설정/캐시/프로젝트 디렉터리와 네트워크 차단을 적용하고, 호출이 그 경계 밖을 읽지 않는다는 격리 근거를 마련한 후 무프롬프트 시작·종료·잔존 프로세스와 session 조회를 시험한다. 현재 `Service.ensure`도 사용자 service를 발견/시작할 수 있으므로 호출하지 않았다. [client 문서](https://opencode.ai/v2/docs/build/client/)의 이벤트가 live-only이고 replay/자동 reconnect가 없다는 조건은 실제 단절 시험이 필요하다.
- **S-07 UI:** 실제 browser에서 `Tools({toolkit})`가 도구 결과를 Tool UI 카드로 dispatch하는지, fallback/스키마 불일치, 취소·재접속·stale action, 키보드/접근성을 확인한다. 지금은 타입 등록과 단독 SSR까지만 확인됐다. 외부 상태의 `onCancel`, `onEdit`, `setMessages`, `queue`, 승인/질문 callback은 제공하지 않았고 동작을 주장하지 않는다. [ExternalStoreRuntime 공식 문서](https://www.assistant-ui.com/docs/runtimes/custom/external-store)는 이 기능들이 앱 callback에 따라 켜진다고 설명한다.
- **S-02–S-06, S-08–S-10:** 프로젝트 import/세션, 병렬·worktree, 권한·도구 부작용, 직접 호출, 저장/복구, 보안 경계, 패키징과 운영 체제 수준 격리는 이 spike에서 실행하지 않았다. 각 계약의 별도 설계·실행 검증이 필요하다.

이 결과는 S-01/S-07의 설계 선택을 좁히는 근거이며 PRD AC-01–18의 수용이나 출시 판정이 아니다.
