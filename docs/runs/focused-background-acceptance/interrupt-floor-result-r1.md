**source-complete**입니다. planrev5와 packet의 입력 hash가 일치합니다.

수정한 파일은 두 개입니다.

- [controller.ts](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/renderer/entities/workbench/model/controller.ts:260): snapshot revision이 confirmed floor보다 낮으면 interrupt를 차단합니다.
- [workbench-store.test.mjs](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/workbench-store.test.mjs:1280): `unknown` 유무 두 경우를 검사합니다.

수정 전 두 회귀 검사 모두 실제 controller에서 실패했습니다. 수정 후 낮은 snapshot에서는 전송 **0회**, floor의 현재 snapshot에서는 **1회**입니다. 기존 receipt와 draft도 유지됩니다.

실행한 검사 모두 exit 0입니다.

```text
node --import tsx --test apps/desktop-app/src/workbench-store.test.mjs
87/87 PASS

pnpm exec tsc -p apps/desktop-app/tsconfig.json --noEmit
PASS

pnpm exec eslint --config apps/desktop-app/eslint.config.mjs apps/desktop-app/src/renderer/entities/workbench/model/controller.ts apps/desktop-app/src/workbench-store.test.mjs
PASS

pnpm exec prettier --check apps/desktop-app/src/renderer/entities/workbench/model/controller.ts apps/desktop-app/src/workbench-store.test.mjs
PASS
```

SHA-256:

```text
controller.ts
2c89fea1bc218f70e03fa7a6ad9b9d66941257fbdadf5c48fea772f7be30b8a1

workbench-store.test.mjs
ec57345a7c6b62e6f8930e9a3a9f5b73468a2e601d592082cc1e439d33508a13
```

Native/build/foreground/delegation 실행 및 ledger/report 작성은 하지 않았습니다. 최종 independent review는 coordinator 단계에 남아 있습니다.
