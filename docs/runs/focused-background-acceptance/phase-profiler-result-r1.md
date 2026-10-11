**Source-complete checkpoint를 완료했습니다.** 지정한 두 파일만 수정했습니다. Native 실행과 build는 하지 않았습니다.

- `phase-task`: initial → input 20 → menu 20 → panel 20 → switch 25/50/75/100을 별도로 측정합니다.
- `phase-control`: 같은 build의 task report를 검증한 뒤, UI 변경 없이 evaluate·frame·GC/CDP 호출 수와 경과 시간을 맞춥니다.
- 입력은 4 MiB, 구간은 120초, 전체 구간 시간은 600초, 작업당 frame은 4096개로 제한합니다. Symlink, 잘못된 schema, 변경된 입력, source·fixture·build 불일치를 거부합니다.
- 기존 warmup, baseline, primary 100회, 10% 기준, raw sample, cleanup 구간은 **원본과 동일한 코드**임을 확인했습니다.
- Phase에는 snapshot이 없습니다. 결과는 `diagnostic-only` 또는 `fail`이며, `acceptance.eligible=false`입니다.

새 test-only Node API는 다음과 같습니다.

```js
validatePhaseTaskReport(report, expectedIdentity)
readPhaseTaskReport(input, expectedIdentity, allowedRoot?)
assertPhaseTaskUnchanged(input, expectedIdentity, sha256, allowedRoot?)
runPhaseDiagnostic({ page, resources, identity, controlInput?, measureAction? })
```

관측값은 `report.phaseDiagnostic`의 `controlPlan.stages`, `resources`, `comparison`에 저장합니다. 시간 차이와 polling·실행 코드 차이를 한계로 기록합니다.

**검사 결과:** unit test 27/27, 두 파일 syntax, owned lint, format 모두 통과했습니다. 실행한 명령은 다음과 같습니다.

```sh
node --import tsx --test apps/desktop-app/scripts/fixtures/workbench-host.test.mjs
node --check apps/desktop-app/scripts/p6-performance.mjs
node --check apps/desktop-app/scripts/fixtures/workbench-host.test.mjs
pnpm exec eslint --config apps/desktop-app/eslint.config.mjs apps/desktop-app/scripts/p6-performance.mjs apps/desktop-app/scripts/fixtures/workbench-host.test.mjs
pnpm exec prettier --check apps/desktop-app/scripts/p6-performance.mjs apps/desktop-app/scripts/fixtures/workbench-host.test.mjs
```

Main은 **두 writer의 checkpoint와 coherent build가 끝난 뒤**, 아래 명령을 순서대로 실행하십시오. 두 실행 사이에는 source 변경, rebuild, 다른 Native 측정을 넣지 마십시오. 출력 경로는 미사용 상태를 확인했습니다.

```sh
cd /Users/hyukjaechoi/Projects/oh-my-own-code

node apps/desktop-app/scripts/p6-performance.mjs --out docs/runs/frontend-architecture-redesign/execution/p6-worker-phase-task-20261004-114300-r1 --analysis phase-task

node apps/desktop-app/scripts/p6-performance.mjs --out docs/runs/frontend-architecture-redesign/execution/p6-worker-phase-control-20261004-114300-r1 --analysis phase-control --task-report docs/runs/frontend-architecture-redesign/execution/p6-worker-phase-task-20261004-114300-r1/ui-states/performance-evidence.json
```

기존 primary 실패로 task가 exit 1이어도, 진단 완료와 provenance가 유효하면 control 입력 검증은 통과할 수 있습니다. 일반 acceptance는 별도 실행이 필요합니다.

최종 source SHA-256:

```text
p6-performance.mjs
588dbe7f5eb203d5550f8f8f2e3f2a89243c3411efeb84bc3fc204f1fdf4732a

fixtures/workbench-host.test.mjs
ddc9648003fbbc1fbac2f4c968b938366187f68c86759c9eb4c194f5a04ca808
```

Native 측정과 독립 code gate는 Main의 다음 단계입니다.
