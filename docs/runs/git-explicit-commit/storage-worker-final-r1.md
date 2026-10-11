`storage8` 구현을 완료했습니다. **8개 파일의 쓰기를 중단했습니다.**

- Node 테스트 **427개 통과**. 새 commit 테스트 50개 포함.
- ESLint·Prettier 통과.
- frozen 소스 9개 hash 재확인 완료.
- 실제 legacy parser의 21개 파일·124166-byte bundle을 검증하고 import했습니다. 새 marker를 `unsupported_version`으로 거부하며 저장소의 모든 파일명과 bytes를 보존합니다.
- marker 선행 flush, 정확한 stage→publish, 원래 digest·backup 상관 검증, 복사 분리, timeout·reopen·tail adoption의 재실행 및 성공 승격 차단을 구현했습니다.

최종 SHA256입니다. 경로 기준은 `/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/host/`입니다.

```text
workspace-registry.mjs
eb21c61ac5cacdd0e73f034368ee5206f2a24413114d22cbe4792dfe0eb7cbfb
workspace-registry.test.mjs
0c8c9cbef48c8e1c31fc1d54ec675edc0d14c7a82e6b06dc1550c31ed73fd950
storage-journal.mjs
289e3af859f1cce31d8cd60fd6691b452b9558b4f25d2b8d74ff13c2d5e7e7c4
storage-journal.test.mjs
41d20ed6b6662bca9cc2b23b1b1016d1f4594496beed382c3978c7bd656f7a7d
workbench-admission.mjs
cd0b6c1ee8a5b6f3c16c0aae492d61620e0878c87d8aeb1452195ce5c551ded4
workbench-receipts.mjs
f510d487ff77dccde26c53ab54e032ff2942b47b0f347c85eb5d7c60455b60d1
workbench-git-commit-storage.mjs
371507679f7c3017e4d18600ec42168eb847be43f2862ec6cc2ecd2c80f5b4f5
workbench-git-commit-storage.test.mjs
3cf36d5fa457476045525340be813141e503b48bcc63c6f124fd82179dcbeb6e
```

427개 테스트의 재실행 명령:

```sh
node --test apps/desktop-app/src/host/{workspace-registry,storage-journal,workbench-git-commit-storage,workbench-git-index-storage,workbench-file-storage,workbench-agent-storage,workbench-skill-runtime-storage,workbench-receipts,workbench-admission,workbench-configuration}.test.mjs
```

Main manager/service, kernel, public/private 계약, docs·ledger는 수정하지 않았습니다. Bun·Git·Electron·Native·provider 실행과 build는 하지 않았습니다. 최종 독립 CODE 검토는 Main에 남아 있습니다.
