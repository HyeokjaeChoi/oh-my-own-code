**지정한 5개 파일 수정과 동결을 완료했습니다.**

kernel은 factory가 발급한 `owner.assertOpened`만 받습니다. 마지막 일반 `check()` 뒤에는 pure helper로 private 상태를 검사합니다. root asset 1개와 child allowlist 2개를 추가했습니다. Main4는 동결 hash와 일치합니다.

검증 결과:

- **실제 RED 2개:** 원래 r1에서 권한 취소 뒤 [stage 생성](/private/tmp/omoc-correction-stage-red-r2/synthetic-55wMaW/failed-case.json), [publish 교체](/private/tmp/omoc-correction-publish-red-r2/synthetic-RhudpF/failed-case.json)를 재현했습니다.
- **[GREEN 12/12](/private/tmp/omoc-correction-kernel-green-r2/synthetic-BrynHy/verification.json):** 모두 FD 정리 통과. Node 집계는 **14/14**입니다.
- **[Staging 1/1](/private/tmp/omoc-correction-staging-green-r2.log):** 실제 child byte·고정 asset 복사와 unknown import 거부 통과.
- 소유 5개 파일 lint·format 통과. 기존 regression 구간은 byte 단위로 유지했습니다.

최종 SHA-256은 다음과 같습니다. 전체 경로와 크기는 [동결 기록](/private/tmp/omoc-correction-kernel-green-r2/owned-five-freeze.json)에 있습니다.

| 파일 | SHA-256 |
|---|---|
| `host/configuration-save-kernel.mjs` | `3984812e18d5e2e27fe653020ce743688d21619d061a96ce16a36ef23bc2aab4` |
| `host/configuration-save-kernel.test.mjs` | `0ad8a66951d44b4636918edbfcac27223d6bb33d529bb338c04ad6b7b06a6b53` |
| `src/event-host-resources.mjs` | `7fa98577861f8638345f554284f2541b1d7efcaf7beb5dbf9bcece0ad0213975` |
| `scripts/stage-event-host.mjs` | `235e2459c819e88cdcb0b5e0c8a067f5fa9e43231422abc848c24d37d3f9eed0` |
| `scripts/stage-event-host.test.mjs` | `2cb12b9730ef9009c1dcf45bd3487a52a086f9f12c9a6c8c4824c5d48cb777e6` |

검증 범위는 기존 pinned Bun의 contained kernel fixture와 Node staging입니다. Native·server·Electron·build·provider·production Main은 실행하지 않았습니다. 문서·ledger 작성과 자체 승인은 없습니다. 전체 contract 검사와 독립 CODE 검토는 Main에 남깁니다.
