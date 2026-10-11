지정한 두 파일의 수정과 **source freeze**를 완료했습니다. 기존 17개 case 뒤에 `tool_snapshot_held`, `tool_raw_held`를 추가했습니다.

- [native-permission-graph-native.mjs](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/scripts/fixtures/native-permission-graph-native.mjs)
  SHA256: `db3db9f72b204585e2b0109db24824f0f60f43cb55c64bc9a07dd33d7124d8b3`
- [native-permission-graph-probe.test.mjs](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/scripts/native-permission-graph-probe.test.mjs)
  SHA256: `e0515cc955d2f7173ec91f2802065c873473b2eb822a2a564c18ab0402a4aef4`

검증 결과:

- 기존 baseline 6개 존재, owned 2개 원본 바이트 보존 확인.
- 구현 전 RED 2개 확인.
- `node --test --test-name-pattern='source-only' apps/desktop-app/scripts/native-permission-graph-probe.test.mjs`: **3/3 PASS**.
- 두 파일의 `node --check`: **PASS**.

**통합 제한:** 현재 runner는 17개 case만 허용합니다. coordinator가 19개 case와 새 phase를 closed protocol에 반영해야 합니다. runner는 수정하지 않았습니다.

Native fixture, child process, Bun, server, Electron, build, provider는 실행하지 않았습니다. 실제 held 동작은 아직 미검증입니다. 독립 CODE review와 fresh preexec CODE 후 coherent batch가 필요합니다.
