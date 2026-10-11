**수정 완료. 네 파일은 안정된 상태입니다.** JR-V5-01..04와 승인된 `lookupIdentity()` 추가만 반영했습니다.

- JR01: 두 policy stage를 allowlist에 추가했습니다. 기존 `native.policy`와 duplicate의 effect 차단을 유지했습니다.
- JR02: `session.remove` tombstone을 admitted `sessionId`에 결합했습니다. Workspace 전체 제거 범위는 유지했습니다.
- JR03: committed session과 unresolved reservation을 함께 계산합니다. 첫 effect 전에 200개 제한을 적용하며, 중복은 한 번만 계산합니다.
- JR04: optional property의 존재 여부를 검사합니다. `null`, `false`, `0`, `""`, 명시적 `undefined`를 거부합니다.

`lookupIdentity({runtimeEpoch, operationId})`는 원래 identity `{runtimeEpoch, operationId, type, digest, workspaceId?, sessionId?}`의 **defensive copy** 또는 `undefined`를 반환합니다. 잘못된 key는 `invalid_record`로 거부합니다. Flush 완료된 현재 root와 검증된 checkpoint identity만 반환합니다. 재개방 후 uncertain tail identity는 명시적 adoption 전까지 반환하지 않습니다. Journal append, effect, observation tick은 없으며 wire lookup·DTO·`readView()`에 digest를 추가하지 않습니다.

기존 public signatures, 입력·DTO·schema 구조는 유지했습니다. 반환 API에는 승인된 메서드만 추가했습니다.

실제 검증 결과:

- 수정 전 네 결함 재현: 26개 중 24개 실패, 대조 테스트 2개 통과.
- 추가 메서드 구현 전: 관련 테스트 3개 실패.
- 최종 owned tests: **77/77 통과** — 기존 48개 + 신규 29개.
- 네 파일 ESLint: 통과.
- 네 파일 Prettier: 통과.
- 실행 환경: Node.js `v26.8.2`.

변경 경로와 최종 SHA-256:

```json
{
  "/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/host/storage-journal.mjs": "3040d498efd42f80f14b2c9509baea3d27a692e53ee9ccceabb13261627d8e9d",
  "/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/host/storage-journal.test.mjs": "74222ef71960bf5c3bcec1862edce788248ba53e43d110c08e4b2b38c12a4776",
  "/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/host/workspace-registry.mjs": "2314b38de9f57e60a64063f99a9c08777a4d8a84bb527d693b8f799ca34528c2",
  "/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/host/workspace-registry.test.mjs": "6afb7f67fe9c4de7c325416cd96488e3c068ba5f4e5b475e24f40256c726f58c"
}
```

다른 source, dependency, docs, report, ledger는 수정하지 않았습니다. Native/provider, GUI, 실제 Documents는 사용하지 않았습니다. 독립 검토나 자체 승인은 수행하지 않았습니다. Main의 freeze와 새 독립 검토를 기다립니다.
