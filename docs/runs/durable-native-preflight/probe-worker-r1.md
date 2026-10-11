허용된 파일 3개만 수정했습니다. **Node 테스트 72/72와 형식 검사가 통과했습니다.** Native, Bun, Electron은 실행하지 않았습니다.

- [native-preflight-probe.mjs](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/scripts/native-preflight-probe.mjs): fresh bootstrap, 정상 재시작, idle Native `SIGKILL` 재시작, Native-only pending 거부 시나리오를 저장했습니다.
- [p7-storage-owner-host.mjs](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/scripts/fixtures/p7-storage-owner-host.mjs): 실제 OS verifier·packaged witness·production preflight를 opt-in으로 연결했습니다. production API는 변경하지 않았습니다.
- [native-preflight-probe.test.mjs](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/scripts/fixtures/native-preflight-probe.test.mjs): 새 Node helper 테스트 13개를 추가했습니다. 기존 fixture 테스트 59개도 통과했습니다.

Main 전달 사항:

- legacy 기본 동작은 유지했습니다. `start`·`blocked-start` 응답에 `preflightScope: "historical-fresh-only-helper"`를 추가했습니다.
- 공개 inbox 생산 경로는 `session.synthetic({resume:false})`와 `session.inbox.list`입니다. app registry intent는 기록하지 않습니다.
- 실제 production acceptance, inspector EOF/deadline 등 추가 runtime 검증, 최종 독립 검토는 아직 필요합니다.

Main 실행 명령 (`apps/desktop-app`에서):

```sh
node scripts/native-preflight-probe.mjs --out docs/runs/durable-native-preflight/evidence/native-r1
```

SHA256, 위 파일 순서:

```text
38a48fd681dc042bb6b3c26490464204520aad93c158642ac32646c5dc1ddfb3
cfabdd9eaf7b0ee46da08e9ccb4246430c27b6c79e705a6378d6a7cd784ebf17
9b4a5ef9a3a4bfe2b1dcf36be141b910d77f81c98cf4352b741e6cf5bddcf5ca
```
