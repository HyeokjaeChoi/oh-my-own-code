**JR-V5-R3-01 수정 완료했습니다.** Registry 파일 2개만 수정했습니다.

검증된 `terminal rejected / effect:none / zero-dispatch / 빈 delta` 이력에서만 첫 실제 session이 정확한 `folderSessionId`를 유지합니다. 이전 identity, reservation, dedup receipt는 보존합니다. Unknown, dispatched, 미완료 reservation, 다른 workspace, mapping, tombstone 충돌과 불확실한 tail의 hold는 유지합니다. Public API·DTO·schema·signature는 변경하지 않았습니다.

검증 결과:

- 수정 전: 재현 테스트 **2개 실패**, 원인은 예상한 ID 불일치.
- 수정 후: 관련 테스트 **17/17 통과**.
- Registry + journal Node 테스트: **101/101 통과**.
- 소유 파일 ESLint와 Prettier 검사: **통과**.
- Fork parent, mapping scope, capacity 회귀 검사: **통과**.

검증한 최종 SHA-256입니다. 파일 위치는 `/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/host/`입니다.

| 파일 | SHA-256 |
|---|---|
| `workspace-registry.mjs` | `8b2b144fd32f430b04bfd0fb5beabc9b7ede30cb565c3fd3f529d199914822b7` |
| `workspace-registry.test.mjs` | `b6cb19090718d41d27ad2806c2aaa98a5cfc646b85481261e6f69a614e7526f5` |
| `storage-journal.mjs` — 변경 없음 | `3040d498efd42f80f14b2c9509baea3d27a692e53ee9ccceabb13261627d8e9d` |
| `storage-journal.test.mjs` — 변경 없음 | `74222ef71960bf5c3bcec1862edce788248ba53e43d110c08e4b2b38c12a4776` |

Freeze JSON·docs·ledger는 수정하지 않았습니다. Native·UI·provider·private store·delegation은 사용하지 않았습니다. Global checks와 독립 review 판정은 main 단계에 남아 있습니다.
