fixture의 v2 전환을 완료했습니다.

변경 파일:

- [workbench-host.mjs](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/scripts/fixtures/workbench-host.mjs): v2 검증, sender/frame 검사, read 취소, 중복 처리, redacted receipt와 lookup.
- [e2e-workbench-states.mjs](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/scripts/e2e-workbench-states.mjs): 기존 UI 검사 유지. 캡처 전후 숨김·비활성 검사와 unknown receipt 검증 추가.
- [session-history-probe.mjs](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/scripts/fixtures/session-history-probe.mjs): service 전용 `trustedTestAdapter` 명시.
- [workbench-host.test.mjs](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/scripts/fixtures/workbench-host.test.mjs): fixture 검사 8개 추가.

**확인:** 8/8 통과. 변경 파일의 ESLint, Prettier, 구문 검사 통과. lookup은 추가 업무 효과를 만들지 않으며 unknown을 accepted로 바꾸지 않습니다.

**남은 의존성:** host·renderer 통합, 최신 build gate, 독립 code review. native 실행과 캡처는 하지 않았습니다. 출력 경로 `docs/runs/frontend-architecture-redesign/execution/p4-p5-foundation-native-r1`과 runner 보호 검사는 유지했습니다.
