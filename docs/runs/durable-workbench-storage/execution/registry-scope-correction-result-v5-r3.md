**JR-V5-R2-01과 HOST-first-session 수정을 완료했습니다. 독립 검토는 대기 중입니다.**

- **Session 범위:** 기존 변경은 admitted `sessionId`에 결합합니다. 새 mapping과 partial mapping은 `reservation.appSessionId`에 결합합니다. Fork의 정확한 parent와 child, `workspace.remove`의 전체 범위를 유지합니다.
- **첫 session ID:** 정상 완료된 managed workspace 생성 reservation만 기존 `folderSessionId`를 넘겨줍니다. 추가 session은 새 UUID를 받습니다. 다른 reservation과 충돌하거나 tombstone이 있는 ID는 재사용하지 않습니다.
- **Recovery:** Checkpoint 없는 tail은 mapping이나 성공을 자동 공개하지 않습니다. 두 unknown hold를 유지합니다. 동일 ID의 capacity 중복 계산도 차단합니다.

실패 재현을 먼저 실행했습니다.

- JR-V5-R2-01: 수정 전 **6개 실패**. 잘못된 대상이 거부되지 않았습니다.
- HOST-first-session: 수정 전 **3개 실패**. 첫 session이 다른 UUID를 받았습니다.
- 최종 검사는 append 전 거부, journal bytes·metadata·receipt 불변, 정상 대상 변경, checkpoint/reopen, 동시 요청, 삭제 ID와 다른 reservation 충돌을 확인했습니다.

최종 실행 결과는 다음과 같습니다. 모두 exit code **0**입니다.

```text
node --import tsx --test apps/desktop-app/src/host/workspace-registry.test.mjs apps/desktop-app/src/host/storage-journal.test.mjs
→ 93 passed, 0 failed, 0 skipped

pnpm exec eslint --config apps/desktop-app/eslint.config.mjs apps/desktop-app/src/host/workspace-registry.mjs apps/desktop-app/src/host/workspace-registry.test.mjs
→ 통과

pnpm exec prettier --check apps/desktop-app/src/host/workspace-registry.mjs apps/desktop-app/src/host/workspace-registry.test.mjs
→ 통과
```

최종 SHA256입니다.

```text
/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/host/workspace-registry.mjs
00cfee265a5ccc062b603bc2a059974f285286d93cd7d5a823598251bcfec928

/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/host/workspace-registry.test.mjs
b072dda81819d8cffeaa359e2d616cbf40da58b0bbd0904963f936443b295f07
```

수정은 위 두 파일뿐입니다. Public API·DTO·signature는 유지했습니다. Journal 두 파일과 plan·contract의 SHA256은 시작 값과 같습니다. Host의 staged 테스트는 지정된 부분만 읽었습니다. Native·UI·provider·실제 개인 Documents는 사용하지 않았습니다.

보고서와 ledger는 저장하지 않았습니다. **Main이 이 결과를 저장하고 Host suite를 실행한 뒤, 독립 reviewer가 승인해야 합니다.**
