**Source-complete checkpoint를 완료했습니다.** 지정한 두 파일만 수정했습니다.

- 준비 60회와 전환 100회를 분리했습니다. 두 구간 모두 네 지표의 10%·last-batch 기준을 적용합니다.
- 준비 단계는 매 20회 뒤에 기록합니다. 중간 실패, 합산 160회 raw 관측값과 `>10%` flag를 보존합니다.
- warmup, raw 100회, p95, provenance, guards를 유지했습니다. Diagnostic은 `acceptance.eligible=false`입니다.
- Native·build·foreground·delegation은 실행하지 않았습니다. docs·ledger·report는 변경하지 않았습니다.

정확한 경로와 SHA-256:

```text
/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/scripts/p6-performance.mjs
adaaa3f838c7e4168e01b0c8291be3b0190479741ebe58737b49cff0c76409e3

/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/scripts/fixtures/workbench-host.test.mjs
46731922b37cdd276ef2eba372c3a8e6e0a837fc95e19cfc1e160953d163268e
```

최종 검사: **test 30/30, syntax, lint, format 모두 통과**했습니다. 아래 명령은 저장소 root에서 실행했습니다.

```sh
node --import tsx --test apps/desktop-app/scripts/fixtures/workbench-host.test.mjs
node --check apps/desktop-app/scripts/p6-performance.mjs
node --check apps/desktop-app/scripts/fixtures/workbench-host.test.mjs
pnpm exec eslint --config apps/desktop-app/eslint.config.mjs apps/desktop-app/scripts/p6-performance.mjs apps/desktop-app/scripts/fixtures/workbench-host.test.mjs
pnpm exec prettier --check apps/desktop-app/scripts/p6-performance.mjs apps/desktop-app/scripts/fixtures/workbench-host.test.mjs
```

Main은 checkpoint 이후 coherent build와 현재 필수 검사 8개를 실행해야 합니다. Normal argv는 그대로입니다. **아직 실행하지 않았습니다.**

```sh
node apps/desktop-app/scripts/p6-performance.mjs --out docs/runs/frontend-architecture-redesign/execution/p6-performance-native-r2
```
