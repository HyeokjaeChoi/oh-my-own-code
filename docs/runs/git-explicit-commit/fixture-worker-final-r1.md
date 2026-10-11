**SOURCE ONLY 구현을 완료했습니다. 3개 파일의 수정을 중지했습니다.**

- Frozen 16개 + Storage 8개 pin: 모두 일치
- Node 테스트: **438/438 통과**, 새 Commit 검사 57개
- 3개 파일 구문 검사, scoped ESLint, Prettier: 통과
- 실제 runner 실행과 독립 CODE/RENDER 검토: Main 담당

최종 SHA256입니다.

| 파일 | SHA256 |
|---|---|
| [workbench-host.mjs](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/scripts/fixtures/workbench-host.mjs) | `f5560d9b26040590032a2fd0e98fee9ef6fb1a87720936586a1d6d1ada13442b` |
| [workbench-host.test.mjs](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/scripts/fixtures/workbench-host.test.mjs) | `8fa769345c8db130539f497e99cded2a2ff3f5a0b72900c11610a1ab381c1e85` |
| [e2e-git-commit.mjs](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/scripts/e2e-git-commit.mjs) | `3ca6e9c4416575af83ca490e6ecc179ba9230ccb399d3fb2bddcc4f9dc7ea595` |

검사 명령은 다음과 같습니다. 기준 경로는 repo입니다.

```sh
node --test --test-reporter=spec apps/desktop-app/scripts/fixtures/workbench-host.test.mjs
node --check apps/desktop-app/scripts/fixtures/workbench-host.mjs
node --check apps/desktop-app/scripts/fixtures/workbench-host.test.mjs
node --check apps/desktop-app/scripts/e2e-git-commit.mjs
```

아래 명령의 기준 경로는 `apps/desktop-app`입니다.

```sh
node ../../node_modules/eslint/bin/eslint.js scripts/fixtures/workbench-host.mjs scripts/fixtures/workbench-host.test.mjs scripts/e2e-git-commit.mjs
node ../../node_modules/prettier/bin/prettier.cjs --check scripts/fixtures/workbench-host.mjs scripts/fixtures/workbench-host.test.mjs scripts/e2e-git-commit.mjs
```

Fixture maps는 synthetic입니다. 실제 publication·Native dialog·Event Host OS lifetime은 증명하지 않습니다. BOM·CRLF 보존은 Node controller 테스트로 확인했습니다. Hidden runner는 HTML `textarea`의 실제 입력값을 검사합니다.
