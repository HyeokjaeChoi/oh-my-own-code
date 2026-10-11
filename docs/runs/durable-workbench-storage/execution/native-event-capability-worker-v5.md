# Author 01a10751-5ea6-7423-b18b-a8ec8b3ad821

수정 완료했습니다. **S2의 Native event-history 요구는 미충족 상태입니다.** marker-only 응답은 `unsupported`로 기록하며, 최종 결과는 `fail`, CLI 종료 코드는 `1`로 유지합니다.

- `nonemptyRequiredEventHistory=false`, `eventLogAcceptance=false`를 기록합니다.
- transcript, normal restart, SIGKILL, inbox, owner, migration 관찰을 계속합니다. 독립 단계의 실패도 최종 보고서에 남깁니다.
- 실제 이벤트가 있으면 correlation, sequence order, hash 비교를 유지합니다. malformed SDK stream은 계속 거부합니다.
- 전체 이력 조회에서 `after`를 생략하고 sequence 0을 허용합니다. **이 변경은 persistence 부재를 해결하지 않습니다.**
- history transfer, normal reopen, SIGKILL reopen 후 `keep.txt`를 실제로 읽어야 sentinel 보존을 기록합니다.
- distinct production rename, metadata, original receipt 검사와 cleanup을 유지했습니다. 기존 r7 오류 보고서는 수정하지 않았습니다.

원인 근거는 upstream commit `cd9a14a6b688d4021bee381dfd39d2cef9c0f862`입니다. `packages/server/src/routes.ts:114`는 `options.events?.persist`를 Bus에 전달하지만, `packages/cli/src/server-process.ts:99–145`는 해당 옵션을 전달하지 않습니다. CLI flags(`commands/commands.ts:515–527`), service config(`services/service-config.ts:14–23`), config schema에도 설정이 없습니다. [고정 commit의 createRoutes](https://github.com/anomalyco/opencode/blob/cd9a14a6b688d4021bee381dfd39d2cef9c0f862/packages/server/src/routes.ts#L114)

다운로드한 primary source의 `packages/core/src/bus.ts:203`은 persistence 기본값이 `false`임을 확인합니다. 같은 파일의 `:371`, `:778`, `:835`는 sequence 시작값과 exclusive cursor를 확인합니다. 기존 실패 증거는 repo의 `docs/runs/durable-workbench-storage/evidence/native-r1/native-storage-evidence.json:3034–3064`입니다.

**검증:** Node **24.14.1**, 테스트 **54/54 통과**. 기존 51개 테스트를 유지하고 회귀 테스트 3개를 추가했습니다. 허용된 3개 파일의 Prettier, ESLint, syntax 검사도 통과했습니다.

최종 SHA-256입니다. 경로는 repo 기준입니다.

```text
apps/desktop-app/scripts/p7-storage-probe.mjs
4c41d788ddf2836bd8aa0cc451cc75ed68e82fb702b4743d95d03474d94caedd

apps/desktop-app/scripts/fixtures/p7-storage-owner-host.mjs
2f736fec8209f734699c33f10283b17f5c2772da137c4a6da57d6ae4472b4c4f

apps/desktop-app/scripts/fixtures/workbench-host.test.mjs
1ce550dbb311939fbc27b72ebb571e452d9df97623aa7a208e078aa86557aaa1
```

Native/Electron/UI/provider/build/package는 실행하지 않았습니다. production/deps/types/docs/ledger도 수정하지 않았습니다. Native 재실행과 독립 최종 gate는 Main에 남아 있습니다.

