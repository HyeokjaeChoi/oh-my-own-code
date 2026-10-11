# 데스크톱 에이전트 워크벤치 기능 조사

**조사일:** 2026-09-28  
**대상:** OpenCode v2 사이드카를 앱이 소유하는 macOS/Windows Electron 앱 `oh-my-own-code`; UI는 assistant-ui + Tool UI 사용  
**근거 범위:** 주요 업체의 공식 공개 문서와 저장소 정적 점검. 경쟁 앱 직접 조작, 패키징된 앱 실행, OS 보안 시험, SDK 런타임 검증은 하지 않았다.

## 핵심 결론

요청한 기능은 선택적인 장식이 아니라 제품의 핵심 범위다. Codex와 Cursor는 데스크톱 코딩 워크벤치의 작업 흐름을 폭넓게 문서화한다. Claude Code Desktop도 브라우저·터미널·파일·워크트리·skills·MCP를 포함한 통합 코딩 화면을 제공한다고 문서화한다. OpenCode는 이 제품의 실행 기반이므로 중요하다. v2 SDK가 세션, 이벤트, 권한, 워크트리, 도구, 확장 상태를 노출하지만 그 API가 곧 화면 기능이 되는 것은 아니다. 공통 흐름은 참고하되, 각 벤더의 화면이나 API가 우리 앱에서 그대로 동작한다고 가정하면 안 된다.

현재 Electron 앱에는 아직 워크벤치가 구현되지 않았다. PRD/UX는 목표를 정의하지만 Electron 렌더러는 임시 런타임 상태만 보여준다. 별도의 웹 워크벤치는 합성 데이터를 읽기만 한다. 실제 메시지 작성기, 워크스페이스 관리자, 우측 아티팩트 패널, 실행 중인 도구와의 상호작용, skill/MCP 목록이 모두 빠져 있다. 따라서 입력 컴포저 누락은 더 큰 기능 수직 흐름이 미완성이라는 신호다.

## 조사 방식과 근거 표기

2026-09-28에 OpenAI, Anthropic, Anomaly(OpenCode), Cursor의 공식 문서를 확인하고 관련 로컬 제품 문서와 소스를 대조했다. **문서화됨**은 검토한 공식 출처가 해당 기능을 직접 설명한다는 뜻이다. **확인되지 않음**은 제한된 조사에서 공식 근거를 찾지 못했다는 뜻이며, 해당 제품에 기능이 없다는 증명은 아니다. 제품군 안에서도 앱·CLI·서버/SDK 기능을 분리했다. 아래 제품 권고는 1인 로컬 앱에 맞춘 분석자의 판단이다.

## 벤더 기능 비교

| 기능 | Codex app | Claude Code / Claude Desktop | OpenCode Desktop 및 v2 | Cursor |
| --- | --- | --- | --- | --- |
| **프로젝트/작업공간 진입** | 프로젝트가 에이전트 대화를 묶고 CLI/IDE의 기록과 설정을 이어받는다. [Codex 앱 소개](https://openai.com/index/introducing-the-codex-app/) | **Claude Code Desktop:** 로컬/SSH 세션과 사이드바, 세션 시작 시 워크트리 선택을 문서화한다. **Claude Desktop chat:** 일반 대화 표면이다. [Claude Code Desktop](https://code.claude.com/docs/en/desktop) | macOS/Windows 데스크톱 앱과 기본 로컬 CLI 사이드카가 문서화되어 있다. [OpenCode v2 소개](https://opencode.ai/v2/docs) · [데스크톱 문제 해결](https://dev.opencode.ai/docs/troubleshooting/) | Agents Window에서 에이전트 작업공간을 다룬다. [Worktrees](https://cursor.com/docs/configuration/worktrees) |
| **Import: 기존 폴더/저장소/worktree 등록** | 프로젝트에서 작업하는 흐름은 문서화되어 있지만 임의 폴더를 앱 목록에 등록하고 유지하는 동작은 이번 출처에서 확인되지 않았다. [Codex 앱 소개](https://openai.com/index/introducing-the-codex-app/) | **Claude Code Desktop:** 세션 시작 화면에서 기존 폴더/저장소를 선택할 수 있다. 이것은 세션의 작업 폴더 선택 근거이며, 지속적인 프로젝트 등록·목록 관리 계약과는 구분한다. [Claude Code Desktop](https://code.claude.com/docs/en/desktop) | CLI는 프로젝트 디렉터리에서 시작하고 Desktop은 최근 프로젝트를 보유한다. 임의 폴더를 영속 목록에 등록하는 완전한 Desktop 계약은 확인되지 않았다. [OpenCode 소개](https://opencode.ai/v2/docs) · [Desktop 문제 해결](https://dev.opencode.ai/docs/troubleshooting/) | worktree 문서는 기존 저장소에서 에이전트용 체크아웃을 만드는 것을 설명한다. 임의의 별도 폴더 import/등록은 해당 출처에서 확인되지 않았다. [Worktrees](https://cursor.com/docs/configuration/worktrees) |
| **Create: 일반 폴더 / Git worktree** | **Git worktree:** 병렬 에이전트를 위한 격리 worktree를 built-in으로 지원한다. **일반 폴더 생성:** 해당 앱 문서에서 확인되지 않았다. [Codex 앱 소개](https://openai.com/index/introducing-the-codex-app/) | **Git worktree:** 세션 시작 시 worktree 옵션이 문서화되어 있다. **일반 폴더 생성:** 확인되지 않았다. [Claude Code Desktop](https://code.claude.com/docs/en/desktop) | **Git worktree:** SDK에 `worktree.create`가 있다. **일반 폴더 생성:** 이 API로 보장되지 않으며 별도 앱 파일시스템 동작이 필요하다. SDK 전략/플러그인 경계도 확인해야 한다. [SDK](https://opencode.ai/v2/docs/build/sdk) · [Plugin/worktree 전략](https://opencode.ai/v2/docs/build/plugins) | **Git worktree:** Agents Window에서 별도 체크아웃을 생성한다. **일반 폴더 생성:** worktree 문서에서 확인되지 않았다. [Worktrees](https://cursor.com/docs/configuration/worktrees) |
| **Remove from app list / archive** | 프로젝트/작업 목록에서 제거하거나 archive만 하는 동작은 검토한 출처에서 확인되지 않았다. 파일 삭제와 동일하다고 가정하지 않는다. | 세션은 사이드바에서 archive할 수 있다. 문서는 이 archive 동작으로 worktree를 제거한다고 설명한다. 일반 폴더의 단순 목록 제외/보관과 물리 삭제를 분리하는 계약은 확인되지 않았다. [Claude Code Desktop](https://code.claude.com/docs/en/desktop) | SDK의 `session.delete`와 `worktree.remove`가 있지만, 두 API는 앱의 프로젝트 목록에서만 숨기는 별도 동작을 입증하지 않는다. 독립적인 Desktop 목록 제거는 확인되지 않았다. [Commands](https://opencode.ai/v2/docs/commands) · [SDK](https://opencode.ai/v2/docs/build/sdk) | `/delete-worktree`는 worktree를 삭제한다. 단순히 앱 목록에서 숨기는/archive하는 동작은 검토한 worktree 문서에서 별도로 확인되지 않았다. [Worktrees](https://cursor.com/docs/configuration/worktrees) |
| **Physical delete: 파일시스템/worktree 삭제** | worktree 물리 삭제와 dirty 파일 처리의 구체적 보장은 출처에서 확인되지 않았다. | Claude Code Desktop 문서는 세션 archive 시 worktree를 제거한다고 설명한다. 사용자가 선택한 임의 폴더를 삭제하거나 dirty 자료를 강제 삭제하는 일반 계약은 확인되지 않았다. [Claude Code Desktop](https://code.claude.com/docs/en/desktop) | SDK `worktree.remove`는 기록된 제거 전략을 통해 worktree를 삭제하며, 강제 여부를 인자로 받는다. `session.delete`는 session 및 자식 기록을 제거하는 동작이지 원본 프로젝트 디렉터리 삭제와 같지 않다. 이것이 임의 폴더 삭제 버튼으로 제공된다는 뜻은 아니다. [SDK](https://opencode.ai/v2/docs/build/sdk) · [Commands](https://opencode.ai/v2/docs/commands) | `/delete-worktree`로 격리 checkout을 제거한다. 임의로 import한 폴더를 디스크에서 삭제하는 동작은 해당 출처에서 확인되지 않았다. [Worktrees](https://cursor.com/docs/configuration/worktrees) |
| **우측 아티팩트 패널** | 인앱 브라우저와 페이지 주석, 여러 터미널 탭, PDF/스프레드시트/슬라이드/문서 미리보기, 계획·출처·아티팩트 요약 패널을 문서화했다. [Codex 제품 업데이트](https://openai.com/ca-ES/index/codex-for-almost-everything/) | **Claude Code Desktop:** 로컬 앱 브라우저와 HTML/PDF/이미지/비디오 미리보기, 세션 디렉터리 터미널, 파일 편집, diff와 패널 배치. **Claude Desktop chat:** 생성된 문서/코드/웹/다이어그램을 오른쪽 아티팩트 패널에 표시하며 Code 탭과 구분된다. [Claude Code Desktop](https://code.claude.com/docs/en/desktop) · [Claude 아티팩트](https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them) | v2 도구 문서는 Desktop 앱에 연결된 브라우저 제어를 설명한다. 로컬 파일·diff·터미널·browser 전체를 포괄하는 Desktop 우측 패널 목록은 확인하지 못했다. [Tools](https://opencode.ai/v2/docs/tools/) | Browser는 인라인 패널 또는 별도 창이며 동작 로그/스크린샷을 보여준다. worktree 결과는 Agents Window에서 검토한다. 일반 문서 미리보기 목록은 확인되지 않았다. [Browser](https://cursor.com/docs/agent/tools/browser) · [Worktrees](https://cursor.com/docs/configuration/worktrees) |
| **도구 호출·승인·결과** | 명령/파일/네트워크/연결 도구 승인과 diff·주석·아티팩트 기반 결과 검토 흐름을 문서화한다. Remote/CLI 설명을 전부 로컬 앱 동작이라고 가정하지 않는다. [Codex 앱 소개](https://openai.com/index/introducing-the-codex-app/) · [Codex 업데이트](https://openai.com/ca-ES/index/codex-for-almost-everything/) | **Claude Code:** browser 권한 카드의 allow once/always/deny, CLI 권한 모드, 세션 상태. **Claude Desktop chat 아티팩트**는 도구 실행 상태의 증거가 아니다. [Claude Code Desktop](https://code.claude.com/docs/en/desktop) | 세션 prompt/command/interrupt/wait, 이벤트 구독, permission 목록/응답과 세션별 규칙 API가 있다. 이는 실행 기반이며 Desktop UI가 완성됐다는 근거는 아니다. [SDK](https://opencode.ai/v2/docs/build/sdk) · [Plugin API](https://opencode.ai/v2/docs/build/plugins) · [Permissions](https://opencode.ai/v2/docs/permissions) | Browser 동작은 기본적으로 승인이 필요하고 수동/허용 목록/자동 실행 모드를 선택할 수 있다. 대화에 도구 동작/스크린샷이 표시된다. [Browser](https://cursor.com/docs/agent/tools/browser) · [실행 모드](https://cursor.com/docs/agent/security/run-modes) |
| **Skills / MCP / plugin 목록** | plugin이 skills, 앱/MCP, 선택적 UI를 묶을 수 있고 앱에서 skill 관리 화면을 제공한다. [Plugin 아키텍처](https://developers.openai.com/plugins/concepts/plugins) · [Codex plugin 도움말](https://help.openai.com/en/articles/20001256-plugins-in-chatgpt-and-codex) | **Claude Code Desktop:** composer slash 메뉴에서 skill을 찾고, MCP connector를 UI/설정에서 구성해 Code 세션에서 사용한다. Claude Desktop chat의 로컬 MCP 확장은 별도 표면이다. [Claude Code Desktop](https://code.claude.com/docs/en/desktop) · [MCP](https://code.claude.com/docs/en/mcp) · [Skills](https://code.claude.com/docs/en/skills) | v2는 project/home skills를 찾아 on-demand로 불러오고, 설정에서 로컬/원격 MCP와 plugin을 관리한다. plugin API에서 MCP 연결 상태와 skill 등록을 조회/변경할 수 있지만 완성된 관리 화면은 별도 작업이다. [Skills](https://opencode.ai/docs/skills) · [MCP](https://opencode.ai/v2/docs/mcp-servers) · [Plugin API](https://opencode.ai/v2/docs/build/plugins) | Customize에서 plugin, skill, MCP, rule, subagent, command, hook을 한 곳에 목록화하고 scope별 관리한다. [Customize Cursor](https://cursor.com/docs/customize-cursor) |

### 비교 결과의 범위

- **공통 사용자 기준선:** 프로젝트/작업공간 선택, 새 작업 또는 기존 작업 재개, 대화와 실행 동작 파악, 결과 확인, 위험 동작 제어는 여러 공식 문서에서 반복된다.
- **모든 제품에 공통인 필수 조건은 아님:** 확장 마켓플레이스, 원격/클라우드 워크스페이스, 호스팅 PR 연동, 컴퓨터 제어, 계정별 connector, 벤더 인증은 차별 기능 또는 벤더 전용 범위다.
- **표면을 혼동하면 안 됨:** Claude Desktop의 아티팩트는 Claude Code의 로컬 프로젝트 패널이 아니다. OpenCode SDK 기능이 Desktop 화면에 자동으로 나타나는 것도 아니다. Codex Remote/CLI 설명이 모든 로컬 데스크톱 동작을 증명하지 않는다.
- **OpenCode의 제약:** 서버/SDK는 세션·워크트리·이벤트 API를 제공하지만 임의 폴더 import, 파일 미리보기, 우측 패널 구성은 별도의 앱 계약이 필요하다. SDK만으로 제품 흐름을 추론하면 안 된다.

## 현재 저장소 구현 범위

PRD와 UX는 목표 기능을 정하며 구현 증거가 아니다. 현재 문서는 이전에 승인된 제품 범위와 Electron v0.6 수정본을 구분한다. 후자는 통합 스펙 인덱스 기준 독립 리뷰와 진행 승인을 기다리고 있다. ADR-0002는 사용자가 Electron/macOS/Windows/app-owned sidecar를 선택한 사실을 기록하지만, 패키징된 런타임 검증이나 수정 문서 집합의 승인을 뜻하지 않는다.

| 요청한 동작 | 제품 목표 | 저장소에서 실제 확인한 상태 |
| --- | --- | --- |
| **Import** 기존 폴더/저장소/worktree | PRD F-01, UX 프로젝트 연결, 아키텍처 workspace API 제안 | **Electron 미구현.** 폴더 선택/경로 API나 workspace 상태가 없다. 브라우저 fixture는 실제 경로가 없는 가짜 workspace를 표시한다. [renderer.tsx](../../apps/desktop-app/src/renderer.tsx) · [desktop-bridge.d.ts](../../apps/desktop-app/src/desktop-bridge.d.ts) · [fixture.ts](../../apps/local-bridge/src/fixture.ts) |
| **Create** 폴더/worktree | PRD F-02, UX 생성 흐름 | **미구현.** Electron preload는 런타임 snapshot만 노출하고 main도 해당 IPC만 처리한다. create/import 명령은 없다. [preload.cjs](../../apps/desktop-app/src/preload.cjs) · [main.mjs](../../apps/desktop-app/src/main.mjs) |
| **앱 목록에서 제거/archive** | PRD F-03은 목록 제거/archive와 디스크 삭제를 구분 | **미구현.** Electron에 프로젝트 목록, archive 상태, workspace 영속화 흐름이 없다. |
| **물리 삭제** 디렉터리/worktree | PRD F-03은 경로·busy/dirty 검사·삭제 확인을 요구 | **미구현.** Electron 삭제 명령이나 확인 흐름이 없다. 디렉터리 삭제가 안전하거나 지원된다고 안내할 근거가 없다. |
| **우측 아티팩트 패널**: 브라우저·파일·diff·터미널·계획·자식·실행 기록 | PRD F-10~12, F-15~16, UX right-panel 계약 | **Electron 미구현.** 패널 컴포넌트나 타입 기반 artifact API가 연결되어 있지 않다. 웹 fixture의 `previewLink`는 비활성 링크 카드이지 브라우저/로컬 파일 패널이 아니다. [renderer.tsx](../../apps/desktop-app/src/renderer.tsx) · [AssistantTranscript.tsx](../../apps/workbench-web/src/widgets/session-workspace/ui/AssistantTranscript.tsx) |
| **Composer / 실제 대화** | PRD F-05에서 assistant-ui 사용 명시, UX에 composer/thread 상호작용 정의 | **미구현.** Electron은 임시 연결 상태 화면이다. 웹의 assistant-ui 외부 스토어 runtime은 `onNew`가 no-op여서 메시지를 보내지 못한다. [renderer.tsx](../../apps/desktop-app/src/renderer.tsx) · [AssistantTranscript.tsx](../../apps/workbench-web/src/widgets/session-workspace/ui/AssistantTranscript.tsx) |
| **실제 도구 호출·결과·승인** | PRD F-08~09가 Tool UI와 검증된 실제 도구 출력/권한 상태 연결을 요구 | **웹은 합성 표시만, Electron은 미구현.** 웹은 fake snapshot에서 schema 검증된 미리보기 카드와 비활성 fallback만 보여준다. 실시간 승인 동작이나 도구 호출 IPC가 없다. [AssistantTranscript.tsx](../../apps/workbench-web/src/widgets/session-workspace/ui/AssistantTranscript.tsx) · [WorkbenchPage.tsx](../../apps/workbench-web/src/pages/workbench/ui/WorkbenchPage.tsx) · [main.mjs](../../apps/desktop-app/src/main.mjs) |
| **Skills/MCP 등록·목록** | PRD F-07/F-13~14, UX 설정/확장 진입점 | **두 workbench 모두 미구현.** source/scope, 활성/연결 상태, 도구 목록/오류를 보여주는 UI나 Electron API가 없다. |

Electron main process가 앱 소유 sidecar를 시작·감독하고 임시 세션/런타임 요약을 제공하는 것은 현재 bootstrap 범위다. 이것은 실제 프로젝트 워크벤치가 아니다. 웹 워크벤치는 pairing 기반의 합성 fixture다. 정적 코드는 연결되지 않은 API와 화면을 확인해 주지만, 패키지 앱 실행, OS별 sidecar 감독, 권한 강제, 파일시스템 안전성을 입증하지 않는다.

## 이 앱에 필요한 제품 기준선

아래는 공식 문서의 반복 패턴과 현재 명시된 제품 목표를 종합한 권고다. 이 조사 문서에서 PRD/UX를 수정하지는 않는다. 해당 수정은 현재 문서의 review-required/approval 상태에 맞춰 별도 검토해야 한다.

| 영역 | 최소한 제공할 동작 | 중요한 구분과 실패 상태 |
| --- | --- | --- |
| **Workspace 관리자** | 최근 workspace 목록; 기존 폴더/저장소/worktree import; 일반 폴더 또는 Git worktree 생성; 열기/선택; 앱 목록 제거/archive; 소유 worktree 또는 확인된 import 폴더의 별도 물리 삭제 | Import는 읽기 중심 등록이며 setup 명령을 실행하지 않는다. Archive/list remove는 파일을 지우지 않는다. 물리 삭제는 대상 경로, 활성 세션, dirty/untracked 상태, 원본 저장소를 검사한다. SDK가 지원하지 않는 동작은 지원한다고 가장하지 않는다. |
| **세션과 workspace 연결** | 실제 작업 디렉터리, 원본 저장소, 브랜치/worktree, 활성 런타임 표시. 명시된 workspace에서 세션 생성/재개 | 프로젝트, worktree, 세션, 대화, 실행은 별도 객체다. 선택만 바꿨다고 실행 중 프로세스의 작업 경로가 바뀌면 안 된다. |
| **대화와 도구** | 실제 assistant-ui composer/transcript, 스트리밍, 중단, 지원되는 경우 후속 입력 대기/steering, 첨부, 슬래시 동작, 오류/재시도 규칙, 재연결 상태. OpenCode v2 세션/이벤트를 하나의 소유된 타입 어댑터로 연결 | 화면 카드가 권한이 아니다. assistant-ui 메시지는 실제 세션 이벤트를 반영한다. 재접속에서 중복 생성/실행을 막고 런타임 근거가 없으면 상태를 확인 불가로 둔다. |
| **Tool UI** | 실제 OpenCode 도구/MCP 이벤트를 schema 검증 후 Tool UI 컴포넌트로 표시. 진행·입력/승인·결과·오류·상세정보 지원. 전용 렌더러가 없는 tool에는 일반 fallback 제공 | 도구 출력, 사용자 질문, 권한 요청은 다른 상태다. Allow 버튼은 실행/권한 API를 호출하고 결과를 확인해야 한다. UI가 실행 완료를 직접 선언하면 안 된다. |
| **우측 아티팩트 패널** | 크기 조절/접기 가능한 브라우저, 터미널, 파일/이미지/PDF, diff/Git 리뷰, 계획, 자식 에이전트, 실행 기록. 도구/파일 링크로 알맞은 아티팩트를 열고 선택 작업을 바꿀 때 상태를 예측 가능하게 복원 | 브라우저/HTML 미리보기에는 privileged preload나 sidecar 비밀을 주지 않는다. 터미널은 실제 workspace PTY이며 수명/소유권을 표시한다. 포트 없음·오래된 결과·충돌·권한 거절·미지원 파일을 표현한다. |
| **확장 및 도구 관리** | 한곳에서 skill 목록(source/scope/설명/호출), MCP 등록(server 연결 상태/도구 목록/활성·비활성/검사/오류), plugin/hook 목록(source/로드 상태), 검색, 전역/프로젝트 범위 확인 | 설정됨·발견됨·활성·연결·로드·실행 가능은 각각 구분한다. 비밀은 마스킹한다. 설정 편집은 연결 성공이 아니다. 초기 기준선에 marketplace는 필요하지 않다. |
| **신뢰와 복구** | 누가 어느 세션/worktree에서 도구를 호출했는지, 적용 권한, 사용자 결정, 확인된 결과를 기록한다. 재접속 후 OpenCode 실제 상태와 대조한다. | Ask/allow/deny 및 한 번/기억 범위는 실제 권한 적용과 일치해야 한다. 중단 요청은 프로세스 종료 확인이 아니다. 복구할 수 없는 이벤트 공백을 임의로 채우지 않는다. |

### 권장 전달 순서

1. **런타임/도메인 계약:** workspace/root/worktree/session/run/tool/extension ID, 소유권, 상태 전이를 정하고 app-owned OpenCode v2 client와 타입 기반 최소 권한 IPC를 연결한다. 재연결 가능한 이벤트 흐름을 포함한다. browser bridge를 데스크톱 권한 경계로 사용하지 않는다.
2. **쓸 수 있는 핵심 수직 흐름:** workspace 선택/생성/import, 실제 assistant-ui composer와 대화, prompt 전송/스트리밍/중단, 실제 권한 확인을 거친 도구 결과의 Tool UI 렌더링을 연결한다. 목록 제거/archive와 물리 삭제를 분리하고 파괴적 컨트롤은 합성 디렉터리 검증 뒤 노출한다. 이렇게 하면 컴포저 누락을 해결하면서 실제 경로를 갖는 대화를 완성할 수 있다.
3. **아티팩트 워크벤치:** 터미널·diff/파일 뷰 다음 브라우저 패널을 추가한다. 브라우저 제어 전에 터미널/서버 수명, 소유권, 프리뷰 격리를 정의한다. 가짜 다중 탭 틀보다 실제 도구 결과와 연계를 우선한다.
4. **확장 관리자:** skills/MCP 목록·등록·범위·실제 활성 상태, 연결 확인, MCP 도구 목록, 명시적 활성/비활성 동작을 제공한다. plugin/hook 정보는 OpenCode v2가 보고하거나 앱이 직접 소유하는 부분만 표시한다. 벤더 로그인 UI는 만들지 않는다.
5. **플랫폼 검증:** macOS와 Windows 패키지 각각에서 경로/삭제/프로세스 수명주기를 확인한다. 정적 검사나 브라우저 pairing으로 네이티브 파일 선택기, sidecar 종료, 파일시스템 안전성을 증명할 수 없다.

이는 권고안이며 승인된 릴리스 계획의 개정이 아니다. 핵심 의존성은 workspace identity → session binding → 실제 assistant-ui runtime → 실제 Tool UI/권한 매핑 → 아티팩트 연결 → 확장 설정/상태다.

## 출처

아래 링크는 조사일(2026-09-28)에 확인한 업체 공식 자료다. 제품 문서는 바뀔 수 있다. 업체 자료가 서로 다른 제품 표면을 설명하면 비교표에서도 구분했다.

### OpenAI / Codex

- [Introducing the Codex app](https://openai.com/index/introducing-the-codex-app/) — 프로젝트, 병렬 대화, worktree, skills 화면 및 보안 프레이밍 (2026-02-02; Windows 업데이트 2026-03-04).
- [Codex for (almost) everything](https://openai.com/ca-ES/index/codex-for-almost-everything/) — 인앱 브라우저, 다중 터미널, 파일 미리보기, 요약 패널, plugins (2026-04-16, OpenAI 공식 카탈루냐어 문서).
- [Codex app documentation](https://learn.chatgpt.com/docs/app) — 현재 앱, 로컬 파일, browser, terminal, worktree, 확장 문서 목록.
- [Plugins in ChatGPT and Codex](https://help.openai.com/en/articles/20001256-plugins-in-chatgpt-and-codex) 및 [plugin architecture](https://developers.openai.com/plugins/concepts/plugins) — plugin 목록과 구성 방식.

### Anthropic / Claude

- [Claude Code Desktop](https://code.claude.com/docs/en/desktop) — 로컬 코딩 UI, 세션/worktree, browser/file/terminal/diff, skills 및 MCP connector.
- [Claude Code skills](https://code.claude.com/docs/en/skills), [MCP](https://code.claude.com/docs/en/mcp) — CLI/runtime 기능. Claude Desktop chat UI에 똑같이 있다고 보장하는 근거는 아니다.
- [Claude Desktop artifacts](https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them) — 생성형 chat 아티팩트 패널. Claude Code와 별도 표면.

### Anomaly / OpenCode

- [OpenCode v2 소개](https://opencode.ai/v2/docs), [Desktop 문제 해결](https://dev.opencode.ai/docs/troubleshooting/) — 앱 제공, 로컬 CLI sidecar, 앱 상태/복구.
- [OpenCode v2 SDK](https://opencode.ai/v2/docs/build/sdk), [도구](https://opencode.ai/v2/docs/tools/), [권한](https://opencode.ai/v2/docs/permissions) — 세션, 이벤트, worktree, browser 도구, 권한 동작 기반.
- [OpenCode v2 skills](https://opencode.ai/docs/skills), [MCP servers](https://opencode.ai/v2/docs/mcp-servers), [plugin API](https://opencode.ai/v2/docs/build/plugins) — 확장 탐색/설정 API.

### Cursor

- [Worktrees](https://cursor.com/docs/configuration/worktrees) — 격리 체크아웃, 검토/적용/삭제.
- [Browser](https://cursor.com/docs/agent/tools/browser), [실행 모드](https://cursor.com/docs/agent/security/run-modes) — 인라인 브라우저, 동작/로그/스크린샷 및 승인 제어.
- [Customize Cursor](https://cursor.com/docs/customize-cursor) — 통합 확장 목록과 범위별 관리.

### 저장소에서 확인한 문서와 코드

- 제품 요구사항: [`docs/product/prd.md`](../product/prd.md), 특히 F-01~18과 §6 assistant-ui/Tool UI.
- UX: [`docs/design/specs/workbench-ux.md`](../design/specs/workbench-ux.md), 우측 패널·workspace·대화/도구 상태.
- 아키텍처와 승인 상태: [`docs/engineering/workbench-architecture.md`](../engineering/workbench-architecture.md), [`docs/engineering/spec-index.md`](../engineering/spec-index.md), [`docs/decisions/0002-desktop-runtime.md`](../decisions/0002-desktop-runtime.md).
- Electron: [`renderer.tsx`](../../apps/desktop-app/src/renderer.tsx), [`main.mjs`](../../apps/desktop-app/src/main.mjs), [`preload.cjs`](../../apps/desktop-app/src/preload.cjs), [`sidecar-supervisor.mjs`](../../apps/desktop-app/src/sidecar-supervisor.mjs).
- 합성 웹 워크벤치: [`WorkbenchPage.tsx`](../../apps/workbench-web/src/pages/workbench/ui/WorkbenchPage.tsx), [`AssistantTranscript.tsx`](../../apps/workbench-web/src/widgets/session-workspace/ui/AssistantTranscript.tsx), [`fixture.ts`](../../apps/local-bridge/src/fixture.ts).
