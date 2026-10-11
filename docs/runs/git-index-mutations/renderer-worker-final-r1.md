EARLY ACTUAL hook이 준비됐습니다. 아래 이름을 유지합니다.

**Actions**

```ts
toggleGitIndexPath(path: string)
selectGitIndexAction(action: "stage" | "unstage")
previewGitIndex(): Promise<boolean>
cancelGitIndexPreview()
applyGitIndex(): Promise<boolean>
```

**Selectors** — 모두 `(state)`를 받습니다.

```text
gitIndex
canSelectGitIndexPaths
canPreviewGitIndex
currentGitIndexPreview
canApplyGitIndex
```

**UI hooks / labels**

| Hook | 값 |
|---|---|
| `data-git-index-state` | `empty`, `loading`, `available`, `unavailable`, `stale` |
| `data-git-index-preview` | `current`, `historical` |
| `data-git-index-status` | 상태 안내 요소 |
| `data-git-index-entries` | 선택 항목의 mode/OID 전후 목록 |
| `data-git-index-result` | `pending`, `unknown`, `applied`, `denied` |

```text
Index 경로 선택: <path>  ← checkbox aria-label
Index 작업             ← select aria-label
Index 변경 미리보기
Index 미리보기 취소
Index 변경 적용
```

최종 검사도 완료했습니다. Node **1,172/1,172 통과**. TypeScript·ESLint·Prettier는 exit 0. FSD는 **82 sources / 68 negative / 16 positive 통과**입니다.

저장소: `/Users/hyukjaechoi/Projects/oh-my-own-code`

```text
path | bytes | SHA256
apps/desktop-app/src/renderer/entities/workbench/model/store.ts | 237649 | b671c562aad59124c6caa7b1f60aeb5fcb9460f46a7b911f3bcfa1320218a6d5
apps/desktop-app/src/renderer/entities/workbench/model/controller.ts | 123568 | eefec480dd8ae5d30e291adb7ce410d3b90b2fd3ddfa8e99e2942e5fad1011f6
apps/desktop-app/src/renderer/entities/workbench/index.ts | 2703 | c7f97998db3d4474f1594adec07d6f2951fbe60c8001faf1d9a2a8184b888878
apps/desktop-app/src/renderer/shared/api/index.ts | 2599 | 3fe15a3089187b0d73d175511eb69ba37a008495b5fe68d66d55475fd35272fa
apps/desktop-app/src/renderer/features/git-review/index.tsx | 25679 | e65901e093aaefb7521bce9058066660451d2e4dde2d1a4f429518639cc95280
apps/desktop-app/src/renderer/features/git-review/review.module.css | 2824 | 9b3cc5e78c6fe8e40cf49d0ec9ddf1ffee1824fb758ced63471af11fb273e185
apps/desktop-app/src/workbench-store.test.mjs | 481634 | 87a4e515a7113a05c3f87f1d62d1900c69805bd9878082820e13aa07293a8afb
```

지정된 7개 파일만 수정했습니다. Runtime·UI·build·Bun·Native 검증과 독립 CODE/RENDER 승인은 수행하지 않았습니다. Ledger 기록과 ancestor 메시지도 보내지 않았습니다.
