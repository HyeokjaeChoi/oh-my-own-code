**추천은 epoch별 witness와 owner 내부 연결 지점 하나입니다.** 기존 `inspect(expected)`에는 nonce를 몰래 넣지 않습니다. OS lifetime 확인과 Native inbox preflight는 독립된 조건으로 유지합니다.

[native-preflight finding](/Users/hyukjaechoi/Projects/oh-my-own-code/docs/runs/durable-workbench-storage/execution/native-preflight-authority-finding-v5.md)을 읽었습니다. **Lifetime proof가 완성되어도 nonfresh Native namespace는 검증된 preflight 없이는 zero spawn입니다.** 빈 retained receipts도 이 조건을 해제하지 않습니다.

1. **최소 proof binding**

   `createStorageOwner`에 선택적 `lifetimeWitness` dependency 하나를 **명시적으로 추가**하는 안을 권합니다. 이는 작은 constructor 확장입니다. 기존 owner handle, `inspect(expected)`, identity tuple, owner.json version5, recovery DTO는 유지할 수 있습니다.

   Owner가 kernel 획득 후 검증한 record에서 다음 context를 전달합니다.

   ```text
   canonicalRoot, rootIdentity, ownerNonce, role, exactProcessIdentity
   ```

   Witness verifier는 이 context 전체에 맞는 registration과 exit proof만 사용합니다. `inspect(expected)`가 owner.json을 따로 읽거나, identity만으로 여러 generation의 proof를 검색하게 하지 않습니다.

   **Nonce는 owner generation을 연결합니다. OS identity가 아닙니다.** 현재 hashed birth seconds/microseconds도 비교용 token입니다. 그 hash로 historical kernel lookup을 할 수 있다고 설명하면 안 됩니다.

2. **정확한 순서**

   - **App:** kernel 획득 → 이전 owner 검증 → 새 nonce와 exact app identity 준비 → attach 전후 identity 일치 확인 → flushed registration ACK → owner candidate 저장 → ready 공개.
   - **Child:** flushed spawn intent → owned spawn → exact child capture → attach 전후 identity 일치 확인 → flushed ACK → `recordChild` 저장 → 나머지 Native startup 조건 확인.
   - **종료:** 정확한 child exit와 durable child proof 확인 → 기존 owner release → witness는 app의 실제 `NOTE_EXIT`까지 관찰 → app proof와 terminal seal 저장 → witness 종료.

   ACK, release, IPC EOF, clean marker는 exit proof가 아닙니다. Attach 뒤 두 번째 identity 확인이 실패하면 ACK를 보내지 않습니다.

   **Spawn-registration gap은 계속 hold입니다.** `spawnIntent=true, child=null`을 witness 정보로 자동 채우거나 해제하지 않습니다.

3. **Release 뒤 살아 있는 witness의 권한**

   Witness는 Electron singleton이나 journal writer가 아닙니다. 권한은 **자신의 root identity와 nonce에 속한 별도 evidence directory**로 제한합니다.

   새 app이 kernel을 획득해도 이전 app이 살아 있거나 필요한 proof가 미완성이면 takeover하지 않습니다. 이전 witness는 자기 generation의 proof만 마무리할 수 있습니다. 새 owner record와 journal에는 접근하지 않습니다.

   Terminal seal 전에는 추가 registration을 닫습니다. 필요한 app·child proof를 모두 저장한 뒤 write handle을 닫고 종료합니다. **Helper 자신의 역사적 exit proof까지 재귀적으로 요구할 필요는 없습니다.** Helper에는 store mutation 권한이 없기 때문입니다. 실제 helper 종료와 누수는 별도 check로 확인합니다.

4. **파일·실패·retention**

   - Root와 directory descriptor를 고정하고 UID, permission, regular-file, symlink·hard-link, 크기를 확인합니다.
   - Registration과 exit 파일을 분리하고 immutable publication, file flush, directory flush, poison guard를 사용합니다.
   - Wrong root/nonce/role/identity, partial file, unsupported protocol, flush 실패는 차단합니다. Checksum은 손상 확인 수단이며 kernel provenance 인증은 아닙니다.
   - Helper crash나 timeout은 `owner_unverified`입니다. Missing PID나 replacement로 보충하지 않습니다. 정확한 이전 exit proof가 있으면 그것은 이전 lifetime만 입증합니다.
   - 현재·미완료 evidence는 보존합니다. 새 owner만 kernel 아래에서 완료된 과거 generation을 정리합니다. 수량·크기 상한에 도달하면 차단하며, age로 unresolved proof를 삭제하지 않습니다.

5. **후속 변경 범위와 남은 한계**

   기존 제안 경로 중 핵심은 [storage-lock.mjs](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/host/storage-lock.mjs)의 contextual hook, 별도 witness module/helper, 기존 Host integrator의 lifecycle 연결입니다. Frozen owner module 변경에는 별도 ownership handoff가 필요합니다.

   Check에는 generation mismatch, ACK 이전 효과 차단, release 뒤 proof publication 경쟁, helper crash, incomplete seal, retention 상한, packaged helper bytes를 포함해야 합니다. Standalone restart 검사는 parent exit-handle 증거를 recovery adapter에 주입하지 않아야 합니다.

   **남는 한계는 registration gap, helper 동시 crash, 기존 record의 missing proof, Windows runtime입니다.** Observer만으로 모든 crash point의 자동 복구를 보장할 수 없습니다. 그 요구에는 launch broker 등의 별도 process ownership 설계가 필요합니다.

현재 disjoint integration은 계속 진행할 수 있습니다. 이번 결과는 OS lifetime 분석만이며, 파일 변경·실행 검사·gate 판정은 하지 않았습니다.
