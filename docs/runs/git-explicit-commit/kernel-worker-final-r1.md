kernel6 구현과 최종 검증을 완료했습니다. 현재 kernel 범위에서 확인한 blocker는 없습니다.

- API: `createGitMetadataKernel({check?, timeoutMs?}) → {index, commit, close}`. 두 policy는 한 core와 kind-bound token을 공유합니다.
- DS2 parent-listing guard 유지. linked worktree에서 불필요한 상위 디렉터리 쓰기 권한을 요구하던 결함을 수정했습니다.
- Node **7/7**, pinned Bun commit/shared **82/82**, index **52/52** 통과.
- Prettier·ESLint 통과. frozen9 실제 bytes·SHA256 일치.

증거: [commit/shared report](/private/var/folders/7p/c3mr9tdj7v73lv27dw9r5dkr0000gn/T/omoc-git-commit-kernel-0VDDAX/report.json), [index report](/private/var/folders/7p/c3mr9tdj7v73lv27dw9r5dkr0000gn/T/omoc-git-index-kernel-qlJbmi/report.json). 보고서의 source pin은 현재 파일과 일치합니다.

최종 SHA256:

```text
git-metadata-kernel.mjs
ee148ee77098b1bdc4265f497d42953fa8f0cdb7ac224827bbbd6613c0249f6d
git-metadata-kernel.test.mjs
c10e2ce131c8eb72198685dae2eab2c5a4aab0af724cbdd80256dce4dbe05d7b
git-index-kernel.mjs
40f1b6adbbcf1b571ea03ff01e7c32e2a68d28c5350f1a60cfea6457c41730bb
git-index-kernel.test.mjs
aa0270748863e57fc903f660f196e5ac250eb2503eb4bbefe417988255d88f1c
git-commit-kernel.mjs
ccd5b04f81fbd2e675ab10599dddfc3a1519dc119e4562bf8ffeb12e7213e482
git-commit-kernel.test.mjs
57b9002793643a1ca4192e49f35c5b749e3d727f9872199a22740db8cb73f9b9
```

검증 명령은 repo root 기준입니다.

```sh
node --test --test-concurrency=1 apps/desktop-app/src/host/git-{index,metadata,commit}-kernel.test.mjs
node_modules/.bin/prettier --check apps/desktop-app/src/host/git-{metadata,index,commit}-kernel{,.test}.mjs
node_modules/.bin/eslint --config apps/desktop-app/eslint.config.mjs apps/desktop-app/src/host/git-{metadata,index,commit}-kernel{,.test}.mjs
```

검증 범위는 승인된 synthetic namespace입니다. Main의 packed fixture 진단, 전체 통합 검증, 독립 CODE 승인은 남아 있습니다. Main 파일·docs·ledger는 수정하지 않았습니다.
