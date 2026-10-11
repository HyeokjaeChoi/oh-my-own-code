kernel source를 최종 고정했습니다. 추가로 확인된 kernel defect는 없습니다. owned 6개 중 3개만 수정했습니다. Main 파일은 수정하지 않았습니다.

- 동일 core에 `branchRestore.prepare/publish/abort/close`와 공유 token lane을 구현했습니다.
- 실제 producer freeze: **9/9 일치**
- 기존 kernel 검사: **Node 7/7**, 내부 commit **82/82**, index **52/52 PASS**
- branch/restore synthetic **101개 PASS**, 별도 bounded-pattern 검사 PASS
- 실제 manager create PASS. select는 Main의 raw blob proof 누락으로 쓰기 전에 `unknown/object_conflict`. 따라서 새 전체 suite는 아직 **RED**입니다.
- owned 6개 Prettier·ESLint PASS

정확한 source, 검사 결과, log 경로는 [최종 checkpoint](/private/tmp/omoc-kernel-final-checkpoint-ih5mtjja/checkpoint.json)에 저장했습니다.

| 파일 | 최종 SHA256 |
|---|---|
| `git-metadata-kernel.mjs` | `7c68c8587593ebe938dd3727392eda8c9e96220f66c615a269388291fd18645d` |
| `git-metadata-kernel.test.mjs` | `c10e2ce131c8eb72198685dae2eab2c5a4aab0af724cbdd80256dce4dbe05d7b` |
| `git-index-kernel.test.mjs` | `aa0270748863e57fc903f660f196e5ac250eb2503eb4bbefe417988255d88f1c` |
| `git-commit-kernel.test.mjs` | `57b9002793643a1ca4192e49f35c5b749e3d727f9872199a22740db8cb73f9b9` |
| `git-branch-restore-kernel.mjs` | `f8402c66a0cc450c3e1027157de948797d4148d7225e0caa24c2faaeadbf4419` |
| `git-branch-restore-kernel.test.mjs` | `201b5cf788ec06ef70f5db86484054232366b114ae922aba54e5ac428e8ecde6` |

한계도 유지했습니다. bulk 8개는 적용됐습니다. 128개는 기존 10초 제한에서 `unknown/deadline`이며 원본은 유지됐습니다. C-quoted·escaped·POSIX class attribute pattern은 안전하게 거부합니다. 독립 CODE와 최종 build/publication 검증은 Main 단계에 남아 있습니다.
