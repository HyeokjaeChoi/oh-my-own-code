지정된 **8개 파일의 bounded storage 구현을 완료했습니다.** producer 7개 해시는 최종 확인에서도 freeze와 일치했습니다.

실제 API는 [workbench-git-index-storage.mjs](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/host/workbench-git-index-storage.mjs)에 있습니다.

- `gitIndexTargetAdmission(apply)` → exact8 target
- `gitIndexBackupId(epoch, operationId)` → 원래 key의 backup 이름
- `validGitIndexUpdatedResult(receipt, admittedTarget, originalDigest)` → 독립된 완료 검증
- admission·dispatch·completion validator를 기존 registry/journal에 연결했습니다.

marker flush, stage→publish 순서, target 일치, 결과 digest, backup null 규칙을 강제합니다. reopen·완료된 unknown은 실행 권한을 얻지 못합니다.

검증 결과:

- 핵심 Node 테스트: **353/353 PASS**
- 기존 storage 통합·lock 테스트: **250/250 PASS**
- ESLint·Prettier: **exit 0**
- 실제 archived parser 19개 파일과 bundle 해시 확인. 새 marker 거부 및 byte 보존 확인.
- 초기 RED와 descriptor 실패를 수정했습니다. format 8개 경고, lint 4개 오류, 실패 주입 fixture의 조기 `writer_poisoned`도 수정했습니다.

최종 파일 증거입니다. 공통 경로는 `/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/host/`입니다.

| 파일 | bytes | SHA256 |
|---|---:|---|
| workspace-registry.mjs | 63781 | `d036f7327ad743cc546fcf7e74b77a1484b4a3ea00cb7c4cfa4012389e83ced9` |
| workspace-registry.test.mjs | 247607 | `7983da0c729818c196165efb8cd877a7d02757c4d2b4b11f3a7917cbe313582b` |
| storage-journal.mjs | 57380 | `c1dd284f2b2249bf155cee76356418d8b8f606b32e31822be57abd55a7d461fb` |
| storage-journal.test.mjs | 74125 | `656c9a2e4fc6b2ae60c86ccb38eedffcb3335dfe18bd7516cec1b370e06a1301` |
| workbench-admission.mjs | 24612 | `f911e13d25e5ed826dbc2e807d3bea61d52500afe89fb25cd1163c2f6ab2cc79` |
| workbench-receipts.mjs | 8376 | `5cdf3d8e088e403a549d79efa16bcf236db6138489832f9456b3e454d8376ad8` |
| workbench-git-index-storage.mjs | 7030 | `6aba81920310092d2977f87dee3344ba44687e6540feb5bcb1fa26f9034608cf` |
| workbench-git-index-storage.test.mjs | 5110 | `78f90d402a76a67118bdaf1d63d3f8f9780009dfccbc6aae9592e863f0577946` |

runtime probe·build·UI 검증·ledger 쓰기·재귀 위임은 실행하지 않았습니다. 독립 CODE/RENDER 검토는 Main의 후속 작업입니다.
