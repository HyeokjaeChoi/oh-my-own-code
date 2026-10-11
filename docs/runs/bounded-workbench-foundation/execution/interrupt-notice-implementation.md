수정했습니다. interrupt 안내에 operation ID·scope·revision을 추가했습니다. 새 current-scope snapshot이 `idle`을 확인하면 안내만 지웁니다. pending effect·unknown hold는 유지하며, 다른 scope의 늦은 receipt는 현재 안내를 바꾸지 않습니다.

변경한 파일은 두 개입니다.

- `/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/renderer/entities/workbench/model/store.ts`
- `/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/workbench-store.test.mjs`

실제 검사 결과:

- Node 테스트: store·projection·session·navigation **86/86 통과**. 새 회귀 테스트 6개 포함.
- desktop-app typecheck: exit 0.
- 두 파일 ESLint·Prettier: exit 0.
- 초기 테스트 실행은 없는 loader 경로 때문에 실패했습니다. 이후 계약의 `--import tsx`로 실행했습니다.

GUI·native·provider 실행과 report·ledger 수정은 하지 않았습니다. 독립 검토와 background native 검증은 main의 후속 작업입니다.
