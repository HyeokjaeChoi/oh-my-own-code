허용된 **8개 경로만 수정**하여 구현했습니다.

- 새 marker를 admission 전에 저장합니다.
- stage → publish 순서와 동일 target을 강제합니다.
- receipt를 원래 digest·target·backup ID에 연결합니다.
- reopen·unknown·duplicate에서는 dispatch와 성공 상태 승격을 막습니다.
- 실제 archived parser의 24개 source와 bundle hash를 검증했습니다. 구 parser의 거부 후 모든 저장 파일 byte가 유지됐습니다.

**검증:** 신규 50개를 포함한 Node 테스트 **458/458 통과**. 지정한 8개 파일의 ESLint·Prettier 통과. verify9 **9/9 일치**.

최종 integration과 independent CODE review는 Main의 범위입니다. runtime·재위임·self-approval은 실행하지 않았습니다.

파일은 모두 `apps/desktop-app/src/host/` 아래입니다.

| 파일 | 최종 SHA-256 |
|---|---|
| `workspace-registry.mjs` | `ed1b0e828234620b1e47ba74385b61c4bad436c1b589c8ef06813cfc01d883f0` |
| `workspace-registry.test.mjs` | `9371915fb36e43ca976f0d11f771d69dcd13274537dfac7a08895ee0fc69ec7e` |
| `storage-journal.mjs` | `40da3ff8b7dc6a736eb5a60a70dc263ec889ab2674448244c14b0f2f353eeef3` |
| `storage-journal.test.mjs` | `a4b5f3dc6482cf00b81bda6caa55847e57d0e42c505cedb0d9c28c4a19e85437` |
| `workbench-admission.mjs` | `0e68cc662511d85a854e41ff73b1ddef99a0ecaba71007c17d5696f2b5ad115f` |
| `workbench-receipts.mjs` | `4da23c5027c1496c3cc26904cd3af5b99ef691e833f828ff58a297b0d1ea4a28` |
| [workbench-git-branch-restore-storage.mjs](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/host/workbench-git-branch-restore-storage.mjs) | `ebd5216d84808398939166aafd84233f00c4b4a9a49ed1c4b318feace8dc09f6` |
| [workbench-git-branch-restore-storage.test.mjs](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/host/workbench-git-branch-restore-storage.test.mjs) | `d74c49df7bc8b9313de8dab3f80013faa811db043583837c945880fb5936f869` |
