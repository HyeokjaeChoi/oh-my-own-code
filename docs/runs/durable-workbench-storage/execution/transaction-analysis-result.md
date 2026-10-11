# Fresh preparatory transaction analysis

Child 01a104a4-598c-78d2-a59a-83a4f8ba4e4a Meitner. Requested Sol/high, not runtime attestation. Proposal only, not acceptance or source authority.

**권고: operation별 candidate에서 변경하고, completion flush 뒤 `committed root`를 한 번 교체하십시오.** 이 root에 registry, native mapping, tombstone, redacted receipt, revision을 함께 넣습니다. snapshot과 lookup은 candidate를 읽지 않습니다.

이번 결과는 준비 ANALYSIS입니다. plan rev3/storage-contract v3와 기존 독립 pass를 전제로 했습니다. `plan-r4-draft.md`는 DRAFT이며, P7 consumer는 P6 완료까지 대기합니다. 파일 변경·테스트·GUI·provider 실행·위임·entry binding 계산은 하지 않았습니다. 전체 소스가 고정됐다는 주장도 하지 않습니다.

아래에서 **S**는 [workbench-service.mjs](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/workbench-service.mjs), **A**는 [workbench-admission.mjs](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/host/workbench-admission.mjs)입니다.

**1. 실제 변경 지점**

| 지점 | 현재 동작 | 필요한 분리 |
|---|---|---|
| S:137–140, 185–187 | workspace/session/lifecycle Map, revision, 기본 선택을 별도로 보유 | 하나의 committed view와 candidate |
| S:353–409, 433–445 | workspace/session 등록, native mapping, startup 선택을 즉시 변경 | reservation과 최종 등록을 구분 |
| S:449–500, 502–595 | `base()`가 revision 증가. `refresh()`가 title/status/messages/permissions/error 변경 | snapshot은 읽기 전용. native projection은 별도 임시 상태 |
| S:699–820 | send receipt, lock/generation, policy 상태, running/awaiting/unknown 변경 | receipt 초안·candidate·실행 hold 분리 |
| S:954–1120 | lifecycle receipt, rename/pin/archive, fork child, session 삭제, 기본 선택 변경 | 검증된 delta와 receipt를 함께 completion에 넣기 |
| S:1153–1220 | 폴더 생성, unregister, trust 갱신, native session 생성 | 효과 전 reservation/dispatch, 효과 후 atomic completion |
| S:1235–1300 | interrupt 상태, permission 무효화, unknown 변경 | dispatch 단계의 안전 hold와 completion 상태 분리 |
| A:264–367 | ledger record를 직접 수정하고 timeout/lookup/projectReceipt가 같은 객체 사용 | 공개 receipt와 실행 중 receipt 초안 분리 |

추가로 S:1112, 1341의 성공 diagnostic도 flush 뒤 기록해야 합니다. flush 전에 `status:"ok"`를 노출하면 completion의 공개 시점이 다시 갈라집니다.

**2. 작은 구현 방식**

권고하는 첫 구현은 **제한된 metadata table 복사**입니다. 현재 한도는 workspace 100개, session 200개입니다. metadata 객체를 candidate로 복사하고, receipt Map은 컨테이너를 복사하되 변경할 receipt만 별도 객체로 만듭니다. 변경 가능한 중첩 `Map`·`Set`은 공유하지 않습니다. transcript와 permission 상세는 journal 대상에서 제외합니다.

순서는 다음과 같습니다.

1. A에서 operation identity와 mutation slot을 **동기적으로 예약**합니다. journal flush 대기 중에도 duplicate/conflict와 BUSY를 처리합니다.
2. admission을 flush합니다. managed identity는 폴더/native create 전에 별도 reservation으로 flush합니다.
3. candidate를 준비합니다. 모든 handler와 `workspace/session/recheck/safeSnapshot/projectReceipt`가 같은 candidate view를 사용합니다.
4. 각 외부 효과 전에 dispatch intent를 flush합니다.
5. 결과를 검증하여 **receipt 초안 + 필요한 delta/mapping/tombstone + 다음 revision**을 만듭니다.
6. registry가 현재 root에 적용할 다음 root를 미리 구성·검증합니다. **completion 한 건을 append하고 flush합니다.**
7. 성공하면 `await` 없는 구간에서 root 포인터를 한 번 교체합니다. 그 뒤 첫 정상 DTO와 별도 receipt를 반환합니다.

completion 이후 공개 작업에는 추가 I/O, 사용자 callback, 실패 가능한 재검증을 넣지 않습니다. admission·dispatch·completion의 root 적용은 같은 registry 직렬화 경로를 사용합니다. candidate가 오래된 전체 root를 덮어써서 중간에 등록된 BUSY rejection이나 다른 receipt를 잃어서는 안 됩니다.

이는 [storage-contract:38–46](/Users/hyukjaechoi/Projects/oh-my-own-code/docs/runs/durable-workbench-storage/storage-contract.md:38)의 flush 순서와 single completion 요구를 구현합니다.

대안은 수정 대상만 복사하는 **copy-on-write**입니다. 할당량은 줄지만, 현재처럼 직접 객체 필드를 바꾸는 경로가 많아 alias 누락 위험이 큽니다. 첫 checkpoint에는 metadata 복사가 더 단순합니다. read mutex만 추가하거나 handler 완료 후 append하는 방식은 이 요구를 충족하지 않습니다.

**3. 읽기·취소·늦은 결과 처리**

- 읽기는 ready 이후 committed view와 해당 resource의 activity generation을 고정합니다. `refresh()`는 임시 projection을 만들고 committed Session 객체를 수정하지 않습니다.
- mutation 전부터 진행 중이던 읽기도 반환 직전에 generation, identity, trust binding, service 상태를 확인합니다. 대상이 변경되면 projection을 버리고 `READ_BUSY`를 반환합니다. 자동 재실행은 하지 않습니다.
- mutation이 진행 중이면 snapshot은 이전 committed metadata와 정직한 busy/unknown 상태를 보여줄 수 있습니다. candidate title, 신규 mapping, 삭제 결과는 노출하지 않습니다.
- lookup은 ready와 SDK lane에 의존하지 않습니다. flushed admission/dispatch 사실 또는 flushed completion만 읽습니다. timeout에 따른 live unknown 표시는 별도 overlay이며 완료 증거가 아닙니다.
- storage 대기로 P4 전체 budget을 늘리지 않습니다. dispatch flush 후 live/poison/capacity를 다시 확인합니다. SDK lane은 **실제 호출부터 실제 promise settlement까지** 유지합니다.
- renderer timeout 후에도 같은 live host operation의 late create/fork/rename/send/reply는 completion까지 진행할 수 있습니다. mutation slot은 먼저 해제하지 않습니다. service 종료, writer poison, identity 폐기는 finalization을 막습니다.

현재 보존할 근거는 A:100–162, 322–367과 [P4 계약:10–16](/Users/hyukjaechoi/Projects/oh-my-own-code/docs/runs/bounded-workbench-foundation/read-receipt-contract.md:10)입니다.

특히 S:729, 755–769의 policy/agent/model 효과는 prompt 전에 발생합니다. `dispatched` prompt flag만으로 `none`을 결정하면 안 됩니다. **단계별 flushed intent와 실제 호출 수를 따로 추적**하십시오. send/command/interrupt/reply의 ACK는 계속 `delivery:"accepted", effect:"pending"`입니다. idle이나 inbox 부재로 terminal receipt를 만들지 않습니다.

flush 실패 시에는 이전 root를 유지하고 writer를 서비스 전체에서 poison합니다. candidate lock 해제와 unknown hold 해제를 구분합니다. 뒤의 native/files/policy/model 효과는 모두 차단합니다. 기존에 effect가 있었거나 durable dispatch ambiguity가 있으면 `none`으로 되돌리지 않습니다.

**4. owned-module API checkpoint**

다음은 **제안 API**이며 현재 존재하는 export라는 주장이 아닙니다.

```text
storage-journal
  append(allowlistedRecord) -> Promise<{ sequence, hash }>
  recover()                -> validated records + closed recovery status
  status()                 -> healthy | recovery_required

workspace-registry
  reserve({ key, digest, type, scope, identities? })
  dispatch({ key, step, targets })
  begin({ key, expectedRevision? }) -> isolated candidate
  complete({ key, candidate, receipt }) -> committed view
  readView()               -> detached/read-only committed view
  lookup({ originalRuntimeEpoch, operationId })
  status()
```

`complete()`가 validation, 직렬화, flush, root publication을 끝까지 소유해야 합니다. integrator가 append 성공 후 여러 공개 Map을 따로 갱신하는 API는 피하십시오. candidate에는 allowlisted metadata delta만 전달합니다. raw request, snapshot, message text, SDK argument는 전달하지 않습니다.

소유 범위는 다음과 같습니다.

- journal/registry worker: `/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/host/` 아래 `storage-journal.mjs`, `workspace-registry.mjs`와 각 테스트.
- owner worker: 같은 디렉터리의 `storage-lock.mjs`와 테스트. 기존 owner contract를 유지합니다.
- 이후 single integration writer: S, A, [workbench-receipts.mjs](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/host/workbench-receipts.mjs), 관련 startup 연결.

redactor의 allowlist는 유지합니다. private digest는 durable identity record에 필요하지만 공개 receipt에는 넣지 않습니다. [IPC:4–17](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/host/workbench-ipc.mjs:4)의 sender/frame 검증과 cancellation 전달도 유지합니다.

**5. 실제로 결정해야 할 사항**

- **revision 의미:** S:453의 읽기별 증가를 없애고 completion에서 확정한 revision을 쓰는 것을 권고합니다. 같은 revision의 최신 transient projection을 P6 renderer가 처리할 수 있는지는 통합 시 확인해야 합니다.
- **부분 성공:** native create/fork는 성공했지만 뒤 policy 검증이 실패한 경우, 정확히 검증된 mapping만 unknown receipt와 함께 **사용 불가 상태**로 completion에 넣는 것을 권고합니다. 미확인 metadata는 공개하지 않습니다. completion flush도 실패하면 mapping은 공개하지 않습니다.
- **완전한 tail 뒤 flush 실패:** 정상 JSONL/checksum만으로 과거 flush 성공 여부를 알 수 없습니다. replay에서의 record 채택과 effects 재개 허용을 구분하는 recovery 기준을 checkpoint에서 확정해야 합니다. 실패 후 자동 재append나 별도 “성공 marker”로 해결하지 않습니다.

현재 wire에는 `RECOVERY_REQUIRED` 오류가 없습니다. 내부 recovery status를 기존 API처럼 제시하지 말고, 기존 `UNAVAILABLE`/unknown 응답과 향후 P7 recovery DTO의 연결을 명시해야 합니다.

**6. 의미 있는 동시 실행·장애 검증**

| 검증 시점 | 확인할 결과 |
|---|---|
| snapshot SDK read 시작 → rename/create/remove → completion flush 정지 | 기존 읽기도 candidate를 노출하지 않음. snapshot/lookup 완료 사실이 갈라지지 않음 |
| native effect 성공 → completion partial write/flush 실패 | 이전 registry 유지, mapping/tombstone/confirmed receipt 미공개, 이후 요청 effect 호출 0 |
| 첫 policy 성공 → model/다음 policy dispatch flush 실패 | 앞 단계 호출은 보존, 뒤 단계 호출 0, prompt 0, receipt는 unknown |
| admission/첫 dispatch flush 실패 | dialog/files/native 호출 수 확인. no-call 증거와 durable intent ambiguity를 구분 |
| timeout → 늦은 ACK → completion flush 정지/성공 | timeout 응답은 unknown, slot 유지, 성공 flush 뒤 같은 identity만 갱신, 재dispatch 없음 |
| read cancel/마지막 subscriber 종료, SDK가 abort 무시 | actual lane 유지, late projection 폐기, lookup capacity 유지 |
| create/fork policy 실패 또는 permission reply 실패 | 새 session의 사용 차단, invalidation/unknown hold 유지, idle 관찰로 hold 해제 금지 |
| completion 준비 중 다른 identity의 BUSY rejection | completion publication이 그 receipt를 덮어쓰지 않음 |
| completion 직전/직후 crash와 재시작 | receipt와 delta는 함께 존재하거나 함께 미완료. nested original epoch lookup과 digest conflict 유지 |
| 완전한 record 뒤 flush 오류, checkpoint 오류 | bytes 보존, 원래 flush 성공 주장 없음, 명시한 recovery 정책 적용 |

이 검증은 기존 [late finalization:459](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/host/workbench-admission.test.mjs:459), [actual SDK4/lookup8:687](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/host/workbench-admission.test.mjs:687), [late ACK:873](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/host/workbench-admission.test.mjs:873) 회귀 항목에 storage 장애를 겹쳐 확인하는 방식입니다. 이번에는 실행하지 않았습니다. 요청된 Sol/high는 routing metadata로만 취급했습니다.
