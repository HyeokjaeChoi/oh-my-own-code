**source-complete**입니다. planrev5와 packet의 SHA-256 일치를 확인했습니다.

수정 파일은 두 개입니다.

- [controller.ts](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/renderer/entities/workbench/model/controller.ts): 현재 epoch·선택 대상·등록·연결·`running`·미보관 조건을 만족한 `session.interrupt`만 `unknown` 차단을 통과합니다.
- [workbench-store.test.mjs](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/workbench-store.test.mjs): 허용 시 전송 1회, 거부 시 0회, 기존 receipt·draft 보존을 검사합니다.

Repo 루트에서 실행한 검사는 모두 exit 0입니다.

```text
node --import tsx --test apps/desktop-app/src/workbench-store.test.mjs
→ 85/85 PASS

pnpm exec tsc -p apps/desktop-app/tsconfig.json --noEmit
→ PASS

pnpm exec eslint --config apps/desktop-app/eslint.config.mjs apps/desktop-app/src/renderer/entities/workbench/model/controller.ts apps/desktop-app/src/workbench-store.test.mjs
→ PASS

pnpm exec prettier --check apps/desktop-app/src/renderer/entities/workbench/model/controller.ts apps/desktop-app/src/workbench-store.test.mjs
→ PASS

node apps/desktop-app/scripts/check-renderer-boundaries.mjs
→ PASS: sourceFiles 43, boundaryFixtures 68, positiveFixtures 16
```

SHA-256 checkpoint:

```text
controller.ts
25f0b713a0db950e8c7e13fd0d654c1281123d6aa532cadba919e975dcd4e37a

workbench-store.test.mjs
d5ab20de5f5d9b9f063d0c162036b96c9a98d276bc97515c36e76e7ff8634507
```

Native/build/foreground 실행, delegation, ledger/report 수정은 하지 않았습니다. 최종 independent gate는 남아 있습니다.
