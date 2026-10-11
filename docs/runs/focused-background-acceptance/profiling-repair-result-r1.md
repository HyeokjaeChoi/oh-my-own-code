# Source checkpoint, not native acceptance

**SOURCE-COMPLETE CHECKPOINT입니다.** 구현과 검사 준비를 완료했습니다. native 실행과 최종 gate 판정은 하지 않았습니다.

수정한 파일은 지정한 네 파일뿐입니다.

- `e2e-workbench-states.mjs`: manual reconnect → connected DOM 확인 → archived assertion 순서로 수정했습니다. disconnected·archived의 mutation 시도 없음, connected·running·unknown의 interrupt, status/log/busy, 세 번의 token update, readOnly draft 선택을 검사합니다.
- `fixtures/workbench-host.mjs`: mutation 시도·dispatch·거절을 별도로 셉니다. disconnected·archived 효과를 거절합니다.
- `fixtures/workbench-host.test.mjs`: 기존 13개를 보존하고 진단·admission 회귀 검사를 추가했습니다.
- `p6-performance.mjs`: primary 100회 뒤에 실행하는 선택적 진단을 추가했습니다. 기존 목표, 10% 기준, 실패 표본, provenance, self-script hash, 출력 guard, 종료 확인 후 cleanup을 유지했습니다.

검사 결과: **unit 21/21, ESLint, 네 파일의 `node --check`, Prettier 모두 통과**했습니다.

MAIN은 UI writer 완료 후 source를 고정하고 coherent build를 만든 다음, 아래 두 명령을 실행할 수 있습니다. 실행 위치는 `/Users/hyukjaechoi/Projects/oh-my-own-code`입니다. 두 출력 경로는 현재 미사용입니다.

```sh
node apps/desktop-app/scripts/p6-performance.mjs --out docs/runs/frontend-architecture-redesign/execution/p6-worker-retainers-20261004-021454 --analysis repeat-retainers
```

```sh
node apps/desktop-app/scripts/p6-performance.mjs --out docs/runs/frontend-architecture-redesign/execution/p6-worker-no-observer-20261004-021454 --analysis repeat-retainers-no-observer
```

두 모드는 primary 100회를 그대로 실행합니다. 이후 idle 대조 구간과 별도 200회 전환을 측정합니다. 두 번째 모드는 **추가 표본에서만** MutationObserver를 생략합니다. 시간과 DOM 조건은 같습니다. mutation 사이의 관찰 범위 차이는 결과에 명시합니다.

진단 API는 다음과 같습니다.

```js
parsePerformanceOptions(argv)
captureSyntheticHeap(cdp, baselineGraph, previousGraph)
summarizeSyntheticHeap(snapshot, baselineGraph, previousGraph)
```

진단은 node 생존·제거 수, self bytes, strong incoming reference, root reference chain의 **types·SHA256**을 반환합니다. raw heap은 메모리에서 처리하며 저장하지 않습니다. 상한은 snapshot 64 MiB, nodes 400,000, edges 2,000,000, 출력 groups 32, root path 표본 256개·깊이 16입니다. 누락 수와 잘림을 명시합니다.

남은 확인 사항은 다음과 같습니다.

- 추가 반복에서 새 node가 다음 batch에도 생존하는가?
- 두 모드에서 생존 수와 reference 집계가 달라지는가?
- idle·snapshot·CDP instrumentation·warmup/JIT 영향과 product retention을 구분할 근거가 있는가?

**r1의 +13.1455% 원인은 아직 미확정입니다.** 이번 checkpoint는 실제 측정 근거를 수집할 준비입니다. self bytes와 reference chain은 dominator retained size나 leak 확정 근거와 같지 않습니다.

현재 `p6-performance.mjs` SHA256:

```text
cd223bf189404613d29948e14e33d45abe9207a496177229c2e56df1507aca41
```
