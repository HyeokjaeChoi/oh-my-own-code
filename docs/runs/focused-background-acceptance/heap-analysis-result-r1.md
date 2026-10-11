**초기 heap 증가의 원인은 아직 확정할 수 없습니다. Production 수정 근거도 부족합니다. 다음 조치는 측정 구간을 분리하는 작은 진단입니다.**

저장된 원래 100회 측정은 모두 실패했습니다.

| 측정 | `JSHeapUsedSize` 증가 |
|---|---:|
| 원본 r1 | 13.146% |
| 안정 observer 진단 | 13.100% |
| 안정 no-observer 진단 | 13.086% |

근거: [원본 r1](/Users/hyukjaechoi/Projects/oh-my-own-code/docs/runs/frontend-architecture-redesign/execution/p6-performance-native-r1/ui-states/performance-evidence.json:2656), [observer](/Users/hyukjaechoi/Projects/oh-my-own-code/docs/runs/frontend-architecture-redesign/execution/p6-worker-retainers-20261004-021454/ui-states/performance-evidence.json:2656), [no-observer](/Users/hyukjaechoi/Projects/oh-my-own-code/docs/runs/frontend-architecture-redesign/execution/p6-worker-no-observer-stable-r2/ui-states/performance-evidence.json:2656).

- **초기 증가를 session switch에만 귀속할 수 없습니다.** Baseline 이후에 input·menu·panel 측정을 각각 20회 실행하고, 그다음 switch를 시작합니다. 중간 heap 측정이 없어 각 구간의 기여를 구분할 수 없습니다. [측정 순서](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/scripts/p6-performance.mjs:805)

- **측정 코드 자체의 보유 객체가 있습니다.** Renderer globals는 long-task 배열, 구간 배열, `PerformanceObserver`를 보유합니다. Observer는 나중에 disconnect하지만 참조는 남습니다. 반면 raw sample 배열과 heap graph는 Node 측에 있으므로 renderer heap 증가로 직접 계산하면 안 됩니다. 각 `MutationObserver`도 `finally`에서 disconnect합니다. 이 구조는 조사 후보이며, 약 1 MB 증가를 설명하는 증거는 아닙니다. [Renderer 계측](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/scripts/p6-performance.mjs:732), [observer 정리](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/scripts/p6-performance.mjs:511)

- **추가 구간은 JIT·warmup 가능성과 양립하지만, 초기 원인을 증명하지 않습니다.** 추가 100→200회 heap은 observer에서 9,100,960→9,091,808 B, no-observer에서 9,154,384→9,215,348 B였습니다. 지속 신규 `selfBytes`는 493,196/495,988 B이며 큰 그룹은 주로 `code`입니다. 그러나 이 객체들은 초기 100회 **이후** cohort입니다. 이름은 hash이며 `dominator retained size`도 없으므로 특정 함수나 store의 소유량으로 해석할 수 없습니다. [Heap 요약의 한계](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/scripts/p6-performance.mjs:293)

- **Snapshot은 추가 진단의 교란 요인입니다.** Snapshot 전후에 post-GC heap이 약 0.28 MB 늘어난 기록이 있습니다. Snapshot은 초기 100회가 끝난 뒤 시작하므로 초기 실패의 원인으로 사용할 수 없습니다. `no-observer`도 추가 구간에서만 observer를 제거합니다. 1초 idle은 반복 구간과 시간이 같지 않고, controller polling도 계속됩니다. [진단 순서와 한계](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/scripts/p6-performance.mjs:971)

- **지속적인 transcript 축적을 뒷받침하는 근거는 없습니다.** Store는 선택 때 snapshot을 비우고 새 snapshot으로 교체합니다. DOM listener는 221개로 유지됐고 pending read는 관측 시점마다 0으로 돌아왔습니다. 이는 일부 축적 가설을 약화하지만, React 객체·store subscription·실제 provider 작업의 누수 부재를 증명하지 않습니다. [Store 전환](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/renderer/entities/workbench/model/store.ts:194)

두 안정 진단은 저장된 source·fixture·launch-artifact digest가 같습니다. Build stamp는 서로 다르지만 각 실행 내부에서는 유지됐습니다. 측정 중 stamp가 바뀐 첫 no-observer 실행은 신뢰 비교에서 제외하고 보존해야 합니다.

**권고하는 다음 조치**

Main이 `/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/scripts/p6-performance.mjs`만 소유하는 별도 진단을 진행하십시오.

1. 기존 warmup과 작업 순서를 복제합니다. Input·menu·panel 직후와 switch 25/50/75/100회에 같은 post-GC resource 측정을 추가합니다.
2. 같은 build의 별도 renderer에서 경과 시간과 GC/CDP 호출을 맞춘 no-switch control을 둡니다. 이 단계에서는 heap snapshot을 사용하지 않습니다.
3. 증가가 발생한 구간을 먼저 찾습니다. 반복 switch에 추가 증가가 남을 때만 그 구간의 객체 소유 경로를 조사합니다.

이 진단은 기존 acceptance 측정을 대체하지 않습니다. 원래 100회 raw sample, 실패, 10% 기준, p95 목표를 유지하십시오. Baseline·warmup·기준 변경은 구현 전에 독립 검토를 받는 plan amendment가 필요합니다. 현재 증거로 cache·store·dependency 변경을 권고하지 않습니다.

이번 작업은 파일 읽기와 저장된 증거 분석만 수행했습니다. 수정, 검증 실행, native 실행, delegation, ledger·report 기록은 하지 않았습니다.
