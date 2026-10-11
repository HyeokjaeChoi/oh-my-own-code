**Canonical final source report**

저장소: `/Users/hyukjaechoi/Projects/oh-my-own-code`  
수정 범위: 아래 3개 파일만. 이번 요청에서는 수정과 테스트를 추가로 수행하지 않았습니다.

```text
path: apps/desktop-app/scripts/fixtures/workbench-host.mjs
bytes: 169900
SHA256: edbee694335f64083c2b476aaad9cb4c19893ef87b71833631ed05f9302c34a6

path: apps/desktop-app/scripts/fixtures/workbench-host.test.mjs
bytes: 294419
SHA256: d1ab6be950d24c0ee2cfa496fde0b30a13e8b38df5d996b67044038a4ebc26c4

path: apps/desktop-app/scripts/e2e-git-index.mjs
bytes: 26932
SHA256: 06933a1dfaf0da58a978d5961ac46c4039ce7f6bcbdbe20b7adfabc3bf5bdf10
```

**구현 결과**

- synthetic stage/unstage, SHA1/SHA256, absent index와 existing unborn index를 지원합니다.
- 실제 public helper와 private storage validator로 target·receipt를 검증합니다. admission digest는 `expectedRevision`을 포함합니다.
- stale·expired·lock·unsupported·denied·unknown·retained original key를 검사합니다.
- confirmed lookup 후에도 대기 중인 Apply 호출이 종료될 때까지 workspace를 막습니다. 다른 workspace의 읽기와 draft 선택은 유지합니다.
- hidden runner는 실제 renderer/preload와 UI controls를 사용하도록 작성했습니다. 출력은 `git-index-evidence.json`입니다.

**실행한 RED → GREEN**

구현 전에 다음 명령을 실행했습니다.

```sh
node --test --test-name-pattern='Index fixture' apps/desktop-app/scripts/fixtures/workbench-host.test.mjs
```

RED: **22개 실패**, exit 1. `setGitIndexState` API가 없어서 실패했습니다. 테스트는 exact target, digest, revision floor, backup, refusal, duplicate, deferred call 계약을 검사합니다. 구현 후 같은 검사 **22/22 통과**입니다.

추가 controller 검사에서 confirmed receipt의 `host-registry` 증거 누락도 확인하고 수정했습니다. 최종 Index 관련 검사와 capture 검사 **29/29 통과**입니다.

**실행한 최종 검사**

아래 명령은 모두 저장소 root에서 실행했습니다.

```sh
setopt pipefail
node --test --test-reporter=tap apps/desktop-app/scripts/fixtures/workbench-host.test.mjs | tail -n 10
```

결과: **381 tests / 381 pass / 0 fail / 0 skipped**, exit 0.

```sh
node node_modules/eslint/bin/eslint.js --config apps/desktop-app/eslint.config.mjs apps/desktop-app/scripts/fixtures/workbench-host.mjs apps/desktop-app/scripts/fixtures/workbench-host.test.mjs apps/desktop-app/scripts/e2e-git-index.mjs

node node_modules/prettier/bin/prettier.cjs --check apps/desktop-app/scripts/fixtures/workbench-host.mjs apps/desktop-app/scripts/fixtures/workbench-host.test.mjs apps/desktop-app/scripts/e2e-git-index.mjs

node --check apps/desktop-app/scripts/fixtures/workbench-host.mjs
node --check apps/desktop-app/scripts/fixtures/workbench-host.test.mjs
node --check apps/desktop-app/scripts/e2e-git-index.mjs
```

모두 **exit 0**입니다. 최종 hash 확인에서도 public producer와 Renderer freeze는 각각 **7/7 일치**했습니다.

**입력과 한계**

계약 입력으로 assignment, `AGENTS.md`, `solo-specialist`·`solo-implement`, 읽을 당시 revision 3인 `plan.md`, `fixture-packet-r1.json`, producer·renderer freeze, `renderer-worker-final-r1.md`를 읽었습니다. **DESIGNv3 본문은 읽지 않았습니다.** packet의 version·hash 참조를 사용했습니다.

runner 실행, Electron·Bun·Native·Git·provider 실행, build, 위임, ledger 수정, 독립 승인은 수행하지 않았습니다. synthetic fixture는 실제 publication이나 Main confirmation dialog의 증거가 아닙니다. Main의 revision 4 및 scratch PASS는 보고로 받았으며 직접 재검증하지 않았습니다.
