지정된 **두 파일만 구현했습니다**. API는 `createGitIndexKernel()` → `prepare/publish/abort/close`입니다. 계약·freeze·plan3/designv3 hash를 확인했습니다. ledger 기록이나 재위임은 하지 않았습니다.

- `node --test …/git-index-kernel.test.mjs …/git-index-contract.test.mjs`: **6/6 통과**
- 실제 bundled Bun 1.4.2 synthetic: **52/52 통과**, child exit `0`
- ESLint·Prettier·구문 검사 통과
- index·HEAD·worktree·source·Bun 전후 hash 증거를 [report.json](/private/var/folders/7p/c3mr9tdj7v73lv27dw9r5dkr0000gn/T/omoc-git-index-kernel-IIVpSh/report.json)에 보존했습니다.

| 파일 | Bytes | SHA256 |
|---|---:|---|
| [kernel](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/host/git-index-kernel.mjs) | 42813 | `f8119861f91605403126ebfd1e1d1e7ccdb8b74d830c4b5f429635dd79a7d766` |
| [tests](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/host/git-index-kernel.test.mjs) | 30952 | `6db237fb7ecd111c8974901cc30aac7edabf4eee4f95795cc5f7c21d1f77e12e` |

FFI errno, xattr 처리, ACL 변수 오류를 수정했습니다. `rawBytes`는 header를 제외한 body 길이이며, body 합계에 별도 128MiB 한도를 적용합니다. 비선택 protected 항목은 정확히 보존합니다.

실제 128MiB 경계·ACL 주입 검사는 미실행입니다. 통합 probe·build·CODE/RENDER는 Main 담당입니다.
