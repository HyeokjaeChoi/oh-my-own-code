# Fresh implementation result

Child 01a1048b-07c5-7b21-bf96-2748ca47954a Tesla. Requested Sol/medium; not runtime attestation. Implementation only, no independent gate or runtime measurements.

허용된 4개 파일에 구현했습니다. **Unit tests 57/57과 static checks가 통과했습니다. UI/performance 실행은 source freeze 뒤 main 작업으로 남겼습니다.**

변경 경로:

- `/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/scripts/p6-performance.mjs`
- `/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/scripts/fixtures/workbench-host.mjs`
- `/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/scripts/fixtures/workbench-host.test.mjs`
- `/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/scripts/e2e-workbench-states.mjs`

추가 API는 `runPerformance(argv)`, `fixture.enablePerformanceSessions()`, `transport.metrics()`입니다. 두 세션의 transcript를 분리했습니다. Scope, cancellation, deduplication, clone isolation, 요청 수 테스트를 추가했습니다.

Harness는 warmup, 입력·메뉴·패널 각각 20회, 세션 전환 100회, raw samples, p50/p95/max, 두 cold DOM 시간, CDP resource batches, long tasks와 bundle 비교를 기록합니다. 기존 unknown/activity captures와 assertions를 보존했습니다. Streaming/disconnected/archived/inspector 및 접근성 관찰을 추가했습니다.

실제 검증 명령은 repository root에서 실행했습니다:

```text
node --import tsx --test apps/desktop-app/src/workbench-store.test.mjs apps/desktop-app/scripts/fixtures/workbench-host.test.mjs
pnpm exec eslint --config apps/desktop-app/eslint.config.mjs apps/desktop-app/scripts/p6-performance.mjs apps/desktop-app/scripts/fixtures/workbench-host.mjs apps/desktop-app/scripts/fixtures/workbench-host.test.mjs apps/desktop-app/scripts/e2e-workbench-states.mjs
pnpm exec prettier --check apps/desktop-app/scripts/p6-performance.mjs apps/desktop-app/scripts/fixtures/workbench-host.mjs apps/desktop-app/scripts/fixtures/workbench-host.test.mjs apps/desktop-app/scripts/e2e-workbench-states.mjs
```

네 파일 각각의 `node --check`도 통과했습니다. 구현 전 새 테스트 2개는 API 부재로 실패했고, 구현 후 모두 통과했습니다.

**Raw runtime measurements와 실행 evidence는 아직 없습니다.** 실험 실행과 `p6-worker-*` 디렉터리 생성도 없었습니다. 계약 실행 시 저장할 경로는 다음과 같습니다:

```text
/Users/hyukjaechoi/Projects/oh-my-own-code/docs/runs/frontend-architecture-redesign/execution/p6-performance-native-r1/ui-states/performance-evidence.json
/Users/hyukjaechoi/Projects/oh-my-own-code/docs/runs/frontend-architecture-redesign/execution/p6-performance-native-r1/ui-states/performance-manifest.json
```

한계는 명시했습니다. 요청 수는 logical reads 계측입니다. Cold DOM 관찰은 늦은 연결에 따른 상한값입니다. 과거 gzip 방식, screen-reader announcements, 지원되지 않는 long tasks는 미검증으로 기록합니다. Production 코드·dependencies·reports·ledger는 수정하지 않았습니다. 최종 gate 승인도 하지 않았습니다.
