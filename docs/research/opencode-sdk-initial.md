# oh-my-own-code — SDK 초기 조사

확인일: 2026-09-26 KST. 공개 공식 자료에 대한 읽기 전용 조사다. 패키지 설치, 서버 실행, 구현 및 배포는 하지 않았다. 담당: 새 `web_researcher` 컨텍스트 `/root/own_code_sdk_research`; 메인 세션이 주요 SDK·클라이언트·API·manifest 근거를 추가 확인하고 정리했다. 제품 원페이저나 확정 아키텍처가 아니다.

## SDK v2의 의미부터 구분

기존 `@opencode-ai/sdk`의 공개 `dev` manifest는 확인 시 버전 `1.18.32`와 `./v2` 하위 export를 함께 표시한다. 따라서 `@opencode-ai/sdk/v2`가 패키지 major 2를 뜻하지는 않는다. 별도로 현재 공식 OpenCode v2 문서는 새 `@opencode/sdk`와 `@opencode/client`를 설명한다. 브랜치 값은 npm 최신 배포 확인 결과가 아니며, 이번에 새 패키지 버전이나 commit을 고정하지 않았다. [공식 package manifest](https://github.com/anomalyco/opencode/blob/dev/packages/sdk/js/package.json), [v2 SDK](https://opencode.ai/v2/docs/build/sdk)

## 확인한 실행 기반과 한계

| 영역 | 공식 문서에서 확인한 사실 | 아직 보장할 수 없는 것 |
| --- | --- | --- |
| 앱 내부 실행 | `@opencode/sdk`는 내부 router로 API를 호출하는 host를 만들며 자체 HTTP listener가 필요 없다. 세션, 이벤트, 플러그인 및 worktree 접근을 제공한다. `close()` 또는 자원 관리 구문으로 종료한다. | 모델 호출까지 오프라인이라는 의미가 아니다. 정확한 배포 버전의 안정성을 검증하지 않았다. |
| 세션·승인 | 생성 시 agent/model/location/permissions를 지정할 수 있고, prompt, inbox, interrupt, idle 대기, 질문 form, 권한 응답 및 MCP API가 있다. 모델 참조는 provider와 id 및 선택적 variant를 가진다. `fork`는 대화를 복사하는 기능이다. | 문서에 experimental 표기가 있다. 깨끗한 자식 컨텍스트의 정확한 계약과 최대 병렬 수는 실험하지 않았다. |
| 네트워크 연결 | `@opencode/client`는 HTTP client다. 브라우저용 진입점과 Node의 로컬 service 관리가 분리된다. 인증 헤더와 버전 호환 조건을 지정할 수 있다. | 원격 배포의 TLS·인증 기본값·접근 통제는 확인하지 않았다. |
| 실행 기록 | client당 이벤트 연결을 공유하며 구독은 live-only다. 재생과 자동 재연결은 제공되지 않고 느린 소비자가 다른 구독자에 영향을 줄 수 있다. | 스트림만으로 단절 없는 실행 이력이나 복구를 보장할 수 없다. |
| 확장·권한 | 플러그인은 agent/model/tool 변환, 권한 hook과 durable JSON 저장소를 제공한다. 도구의 취소 신호는 실제 작업에 연결해야 한다. 명시적 deny는 최종이며 자식 권한은 생성 시 상속된다. | 규칙이 OS sandbox를 증명하지 않는다. 부모 규칙 변경이 기존 자식에게 소급된다는 보장도 확인하지 않았다. |
| Cloudflare | 별도 workerd 진입점이 Durable Object SQLite와 durable events를 사용하며 로컬 filesystem/process 서비스를 대체한다. | 일반 로컬 저장 경로·백업·암호화 또는 모든 서버리스 환경에 대한 지원 증거가 아니다. |

근거: [내장 SDK와 worktree](https://opencode.ai/v2/docs/build/sdk), [세션·권한·MCP API](https://opencode.ai/v2/docs/api), [JavaScript client와 이벤트](https://opencode.ai/v2/docs/build/client/), [플러그인](https://opencode.ai/v2/docs/build/plugins/), [Cloudflare 실행](https://opencode.ai/v2/docs/build/sdk/cloudflare/). 표의 미확인 사항은 지원 불가 판정이 아니라 이번 조사에서 확인하지 않은 범위다.

## 제품 방향이 정해진 뒤 검증할 질문

1. 사용자가 뜻한 SDK 세대와 정확한 실행 패키지·서버 버전은 무엇인가?
2. 새 세션에 부모 대화를 복사하지 않고 역할 지침과 승인된 자료만 전달하는 흐름이 실제로 성립하는가?
3. 동시 작업의 파일 변경을 어떻게 분리하고, 공유 작업 공간의 충돌을 어떻게 관찰할 것인가?
4. 이벤트 연결이 끊겨도 실행 결과와 승인·검증 기록을 복구할 수 있는가?
5. 선택한 환경에서 로컬 데이터와 자격 증명은 어디에 저장되며, provider별 variant와 취소가 의도대로 작동하는가?

이 질문들은 이후 기술 검증 항목이다. 제품 기능, 플랫폼, 고객 수요 또는 구현 승인을 대신하지 않는다. 사용 대상과 가장 먼저 해결할 문제, 프로젝트 생성 위치가 정해지면 경쟁 대안과 최소 제품 범위를 조사해 의사결정용 원페이저로 이어간다.
