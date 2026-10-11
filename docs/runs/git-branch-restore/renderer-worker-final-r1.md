구현했습니다. **real9pin 9/9 hash 일치**를 먼저 확인했고, 지정된 8개 파일만 수정했습니다.

- branch 생성·실제 checkout 선택·INDEX/HEAD 복원을 public API에 연결했습니다.
- 전체 변경 Preview, 손실·mode·digest·nullable backup, 원래 작업 결과를 표시합니다.
- stale·ABA·late ACK를 차단합니다. lookup 성공 후에도 실제 호출 종료까지 hold를 유지합니다.
- **Node 1,402/1,402**, `tsc`, scoped ESLint, Prettier, Renderer boundaries가 통과했습니다.

Fixture 진입점은 [branch-restore.tsx](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/renderer/features/git-review/branch-restore.tsx:54)입니다.

- Actions: `editGitBranchRestore`, `toggleGitRestorePath`, `selectGitBranchRestoreDraft`, `previewGitBranchRestore`, `cancelGitBranchRestorePreview`, `applyGitBranchRestore`
- Controls: `data-git-branch-restore-control`
- Commands: `data-git-branch-restore-command`
- 관찰 hooks: `state/action/held/scope/status/preview/path/metadata/result/operation/io-held`

재위임·runtime·build·Native·UI 실행은 하지 않았습니다. 독립 CODE/RENDER 검토와 실제 화면 검증은 Main 단계에 남습니다.

<details>
<summary>최종 SHA-256 — apps/desktop-app/src 기준</summary>

```text
renderer/entities/workbench/model/store.ts
56d534bd790aac11a0e0dbc8f7ddd2ad0b74971fbd2759f6ce8909ef8831aebe

renderer/entities/workbench/model/controller.ts
0a0c91ab1fbb3e3edb45bdb5d28002633c295b1c155f9ea92cf4ff6e47713b7f

renderer/entities/workbench/index.ts
4a4d60096f6a71e88096b14bcd266d8dd3736ef9d9da2ee9f6ec1bbe20c9c14e

renderer/shared/api/index.ts
c2b88ffd8beafae8e21f23edbaebe117270ead2ad10b2662992ce44ca37ca711

renderer/features/git-review/index.tsx
3bdda0c0c8b840c36ba4370cd38bf4c6b2da3cb4b1800f330f1dcb3a14e8e490

renderer/features/git-review/review.module.css
0905b53505b02d98eef3d2ec3d5925e754f334d57caae6093c9c3af212d26b1a

renderer/features/git-review/branch-restore.tsx
ac475361a66e511fdb83f32a1e645934f9dcfd8023719835934c166900ec55de

workbench-store.test.mjs
81c3072b22d664494f6ae75383ebafa7865aebfeace744c716a9e75c37f54cf1
```

</details>
