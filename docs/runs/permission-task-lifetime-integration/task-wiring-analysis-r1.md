# 실제 task handoff 연결 분석 r1

기준: integration `plan.md` revision 2, task-lifetime `design-contract-r2.md`, 검토된 `workspace-mutation-supplement-r1.md`. 이 문서는 구현 순서 분석이다. plan/design/CODE 판정이나 feature 완료 선언이 아니다. Full F09/full18과 B06 전체 범위는 유지한다.

## 1. 다음 구현의 결론

**먼저 실제 Main → 인증된 EventHost child → 같은 Native Control 인스턴스의 private 경로를 연결한다. 현재 그 경로의 prepare 결과는 held여야 한다. 이어 기존 backlog의 trusted inventory와 effective mode compiler를 구현한 뒤 성공 prepare를 연결한다.**

현재 source로 성공한 `task.prepare`를 만드는 것은 불가능하다. `validateTaskIdentity()`는 실제 양수 mode/inventory generation과 실제 location ID를 요구한다. Control은 그 mode/inventory를 소유하지 않는다. `inspect()`의 project generation은 0이고 state는 항상 `boot_held`이다. `assertExecution()`은 항상 실패한다. 이 값을 1로 채우거나 location UUID를 Main에서 만들면 source의 사실을 위조한다.

held 경로의 완료 기준은 **실제 호출이 같은 Control까지 도달하고, Native mutation·task append·handoff arm·SDK effect 전에 거부되는 것**이다. 이것을 성공 prepare, task-lifetime 통합 완료, F09 완료로 보고하면 안 된다. 이 경로를 만든 뒤 별도 helper를 더 쌓지 말고 아래 선행 작업으로 이동한다.

## 2. 실제 연결 지점과 누락

아래 source 경로는 repository 기준이다. 전체 root는 `/Users/hyukjaechoi/Projects/oh-my-own-code`이다.

| 현재 지점 | 확인한 사실 | 최소 변경 |
| --- | --- | --- |
| `apps/desktop-app/src/workbench-service.mjs`의 `send()` | cached `contextIO.acquire()`가 두 policy 호출보다 앞선다. `finally`에서 release한다. 현재 prompt에는 reserved `id`가 없다. | acquire 직후 실제 prompt input을 detach하고 `permissionPromptInputDigest()`로 capture한다. 첫 mutation 전에 private prepare를 호출한다. 실패하면 policy도 호출하지 않는다. |
| 같은 파일 `call()` / `owner.beforeEffect` / `methodStep()` | stage별 `registry.dispatch()`만 한다. `recordTask()`와 private handoff 연결은 없다. | 실제 method identity와 detached args를 stage에 묶는다. durable dispatch 이후 task/handoff 절차를 수행한다. generic caller가 stage를 지정하지 못하게 한다. |
| `host/workbench-admission.mjs`의 `sdk()` | `beforeEffect`를 await한 뒤 `fn(...args,{signal})`을 직접 호출한다. lane과 actual Promise를 그동안 유지한다. | actual invocation 한 지점에 private invoke wrapper를 적용한다. `beforeEffect` 안에서 `invoke(handle,()=>{})`를 끝내면 ALS가 실제 fetch까지 이어지지 않는다. |
| `event-host-supervisor.mjs`의 `startEventHost()` | `nativeTaskRequests.wrapFetch()`와 `workbenchContext().nativeTaskRequests`가 있다. issue/invoke 호출자는 아직 없다. parent 수신은 nonce와 실제 child PID를 대조한다. | task private call을 기존 `send()`/`bounded()`/`live()`/owner fence에 연결한다. 응답은 current child + request ID + original/stage correlation을 확인한다. |
| `event-host-protocol.mjs`의 `validateHostMessage()` | task 메시지는 없다. 일반 cap은 16KiB이다. | 닫힌 task request/result 변형을 추가한다. held 응답에는 가짜 task identity를 넣지 않는다. |
| `event-host-child.mjs`의 `prepareHeldEventHostStart()` / `runEventHostChild()` | graph를 만들고 `graph.overrides`만 start에 전달한다. task handler가 없다. | graph가 제공하는 private facade를 child closure에 보관한다. ready/closing/nonce 검사를 거쳐 그 facade만 호출한다. |
| `native-permission-graph.mjs`의 `createNativePermissionGraph()` | `control.node.replace(control.configured(...))`를 만들고 overrides만 반환한다. | 같은 configured Layer가 획득한 Control에 연결되는 bounded private facade를 함께 반환한다. 두 번째 kernel/runtime을 만들지 않는다. |
| `native-permission-control.mjs`의 `kernel()` / `configured()` | location lifecycle은 있다. lease registry도 하나 있다. task prepare, handoff, inventory, mode/compiler API는 없다. | Control 내부에 private task entry를 둔다. 지금은 prerequisite 부재를 거부한다. 후속 성공 경로는 같은 `leases.origins`와 handoff store를 사용한다. |
| `native-permission-overlay-contract.mjs` / `scripts/native-permission-overlay-recipe.mjs` | recipe 파일은 contract를 재수출한다. Session prompt는 `guard(original)`만 적용한다. guard는 실제 body/step을 검증하지 않는다. | contract의 정확한 patch를 변경한다. HTTP ticket context와 실제 Session method/body를 같은 Control의 final verifier에 연결한다. |
| `main.mjs` → `openWorkspaceRegistry()` | production registry 생성에 `taskAuthoritySource`가 전달되지 않는다. | sole writer 생성 시 Main-owned synchronous verifier closure를 전달한다. child가 registry를 열거나 쓰지 않는다. |

`event-host-resources.mjs`에는 최신 변경으로 `native-permission-task-handoff.mjs`, `permission-input-digest.mjs`, `wire-id.mjs`, `host/workbench-task-storage.mjs`가 포함됐다. pure dependency packaging은 연결의 선행 작업을 줄인다. graph/child/Control 연결이나 runtime acceptance를 증명하지는 않는다. Main contract/ALS request 모듈은 Main에 둔다.

## 3. 지금 구현할 가장 작은 단위

새 파일의 unattached helper 대신 위 기존 파일을 수정한다. 다음 이름은 **제안할 private API**이며 현재 export가 아니다.

1. `createNativePermissionGraph()`가 `{overrides, taskControl}`을 반환하게 한다. `taskControl.prepare(request)`와 `close(reason)`은 child 전용 facade이다. Control Layer 획득 전에 호출하면 거부한다. `configured()`의 trusted factory callback으로 실제 획득된 service를 붙일 수 있다. callback은 IPC input이 아니다. graph-global Control에 Session/Plugin 의존성을 역으로 넣지 않는다.
2. `prepareHeldEventHostStart()`가 그 facade를 `runEventHostChild()`의 closure로 전달한다. start는 기존 동일 overrides를 사용한다. child의 `task-prepare`는 facade의 실제 Control entry를 호출한다. 별도 mock Control, 전역 mutable export, 두 번째 `Effect.runPromise(configured Layer)`로 service를 만들지 않는다.
3. protocol에 `{type:'task-prepare',nonce,requestId,request}`와 bounded 결과를 추가한다. 현재 결과는 `{status:'held',reason:'inventory_unverified'|'policy_unverified'|'identity_unverified'|'runtime_unavailable'}` 중 실제 이유이다. 성공 identity와 함께 쓰는 nullable/dummy generation 필드는 만들지 않는다. input은 original key/digest/type, 등록된 workspace/session target, prompt input digest 등 작은 metadata만 포함한다. 각 originKind는 닫힌 변형으로 검증한다.
4. supervisor의 private `nativeTasks.prepare()`를 `workbenchContext()`에 연결한다. Main service의 `send()`가 acquisition/digest capture 후 이를 실제 호출한다. held이면 기존 failure 흐름으로 끝내며 두 policy와 selection/prompt를 실행하지 않는다. 일반 read와 disjoint scope를 불필요하게 전역 잠그지 않는다.
5. close/disconnect/owner loss/timeout은 facade와 Main correlation 권한을 즉시 폐기한다. 늦은 응답을 성공으로 채택하지 않는다. 실행 또는 reservation 여부가 불명확하면 hold를 유지한다. 현재 held 경로는 reservation 생성 전에 거부하므로 task root를 조작할 필요가 없다.

이 단위는 **실제 wiring의 거부 경로**이다. `task-arm`에 임의 identity를 보내서 positive handoff 테스트를 통과시키는 것은 이 단위의 완료 기준이 아니다. 기존 transient store의 isolated 테스트는 그대로 component 증거로만 둔다.

## 4. 성공 prepare 전에 필요한 순서

기존 B06과 accepted design 작업을 다음 순서로 배치한다. 새 initial review나 범위 축소를 추가하지 않는다.

| 순서 | 기존 작업과 exact 선행 조건 | 이후 열리는 작업 |
| --- | --- | --- |
| A | 위 actual held private path + 기존 cached input capture | 실제 호출 거부의 Node 검증 |
| B | accepted `permission-control-design/design-contract-r4.md` §3, §5, §11의 complete trusted tool/plugin/hook inventory와 실제 location/session/project mapping. source 검증은 modules.load 이전이다. locationSnapshot의 complete/ready/incarnation을 사용한다. Main catalog나 DTO 목록은 대체물이 아니다. | 실제 inventory generation을 읽는 read-only prepare |
| C | 같은 contract의 effective policy compiler, persisted mode/floor/compiler version, Agent별 exact rules/readback. 기존 `policy()`의 BASELINE_POLICY blind write를 shared compiler verifier로 교체한다. 두 stage는 유지한다. | 실제 modeGeneration과 정책 digest를 갖는 identity |
| D | task-lifetime r2의 private reservation/prepare + same journal verifier + exact argument/stage handoff + final Native consumption을 함께 연결한다. workspace mutation은 보충 계약의 closed targetKind/완전한 affected set을 사용한다. | durable task root와 bound handoff; 실행은 계속 held 가능 |
| E | 실제 coordinator/promotion/title/expansion/RPC/IO lifetime 연결. 모든 effect category에 final gate/lease 적용. scoped write는 기존 descriptor root broker 작업을 완료한다. bootstrap/create/import/fork 및 recovery도 각 실제 경로를 완료한다. | accepted 조건을 모두 갖춘 scope만 후속 activation 검증 대상 |
| F | 기존 coherent affected checks와 fresh independent CODE, 그 뒤 별도 contained Native 실행 조건을 충족 | 실제 실행 증거. Full F09/full18 판정은 전체 acceptance 이후 |

B와 C는 메타데이터/컴파일 작업으로 진행할 수 있지만, unknown hook 실행이나 tool setup으로 completeness를 시험하면 안 된다. `assertExecution()`을 먼저 완화하지 않는다. generation은 실제 owner가 등록·변경·무효화를 추적한 counter여야 한다. 단순히 default mode를 문자열로 정하고 generation=1을 붙이는 것은 C가 아니다.

**D는 B/C보다 먼저 성공할 수 없다.** 현 `validateTaskIdentity()`/origin constraints를 완화하거나 placeholder로 통과시키지 않는다. accepted task design은 실제 generations를 이미 요구한다. 순서를 바꾸면 이 요구를 충족할 수 있다. root broker는 execution activation의 별도 조건이다. 실행을 열지 않는 metadata prepare의 모든 작업을 broker 뒤로 미룰 필요는 없다.

## 5. D에서 고정할 실제 순서와 API

최소 제안 API는 `nativeTasks.prepare`, `arm`, `revoke`, `invoke`, current-child observation delivery이다. 모두 supervisor/child/Control의 기존 owner에 붙인다. renderer/public SDK에 task authority method를 추가하지 않는다.

1. Main admission은 immutable `currentScope().record`와 original key/digest를 보존한다. `send()`는 checked cache pin으로 최종 prompt input `{sessionID,text,delivery?,files?}`을 detach한다. `permissionPromptInputDigest()`의 own-field presence, BOM/CRLF, file order/URI bytes를 그대로 보존한다. 첫 policy 이전이다. 다른 Native mutation family도 첫 effect 전에 해당 typed input을 capture한다.
2. private prepare는 실제 stored Native session/project와 current registered ready location/incarnation, B/C generations를 확인한다. prompt ID는 pinned 실제 `SessionMessage2.ID.create()`로 예약한다. Main이 UUID나 Session ID를 대신 만들지 않는다. Native inbox reconcile/admit/prepare2/revert/wake나 hook은 아직 호출하지 않는다. origin/input reservation은 같은 `leases.origins` owner로 연결한다.
3. metadata IPC의 prompt digest는 **Main이 계산한 expected digest**이다. 이를 Native가 돌려주는 것만으로 Native의 raw-input 비교가 증명되지는 않는다. Native의 독립 계산은 실제 HTTP body가 도착한 final entry에서 수행해야 한다. r2 §5의 prepare 단계에서 독립 raw 비교까지 요구하는 해석을 구현하려면, 같은 HTTP body를 effect 없이 검사하는 private transport seam이 추가로 필요하다. metadata-only prepare에 raw body가 있다고 주장하지 않는다. 이 부분을 미연결 상태로 두고 성공 prepare의 전체 수용을 선언하지 않는다. raw attachment IPC 전송으로 해결하지 않는다.
4. 첫 stage의 `owner.beforeEffect`가 기존 `registry.dispatch()`를 flush한다. **현재 `applyTaskRecord()`는 task.prepare 전에 `operation.dispatches.length > 0`을 요구한다.** 따라서 private read-only reservation 다음, 첫 stage intent flush 다음에 `registry.recordTask({kind:'task.prepare',...})`를 쓴다. prepare/input/bound 기록이 flush되기 전에는 arm/Native effect가 없다. private reservation만으로 dispatch 전 task.prepare를 append하는 계획은 현재 parser와 맞지 않는다.
5. `openWorkspaceRegistry({taskAuthoritySource})`의 Main-owned verifier는 미리 검증한 current child 응답을 동기적으로 소비한다. callback 안에서 IPC/await를 하지 않는다. 원본 registry identity, task sequence, mapping, stage/binding을 대조한다. 디스크 replay는 live capability를 복원하지 않는다. `recordTask()`가 registry revision과 per-root sequence를 배정한다. Main은 임의 revision을 보내지 않는다.
6. 각 stage는 exact detached actual args의 digest를 사용한다. prompt `inputDigest`와 stage argument digest는 다른 역할이다. shared `taskBindingDigest()`는 binding 해시이며 임의 stage 해시의 대체물이 아니다. stage digest producer/verifier 알고리즘을 같은 변경에서 고정한다. AbortSignal/transport option은 payload digest에 넣지 않는다. 실제 method semantics에 영향을 주는 field는 빠뜨리지 않는다.
7. durable stage intent와 해당 handoff 기록이 flush된 다음 child가 `createNativeTaskHandoffs().arm()`을 호출한다. expiresAt은 child의 monotonic clock으로 준비한다. Main은 이를 자기 clock으로 만들지 않는다. arm ACK 이후에만 `nativeTaskRequests.issue(handoffId)`를 한다. Main deadline과 child 5초 expiry는 각각 검사한다. 응답 유실은 재arm/재전송 허가가 아니다.
8. `host.sdk()`의 **실제 fn 호출**을 `nativeTaskRequests.invoke(handle,()=>fn(...args,{signal}))`로 감싼다. 안정된 method wrapper identity를 보존한다. Main의 request context는 실제 SDK Promise가 끝날 때 비활성화된다. detached delayed fetch는 거부된다. 이것은 root settlement가 아니다.
9. authenticated HTTP handler가 ticket을 읽어 private Effect context로 전달한다. observed server `service-status-f78xgav9.js`의 `session.prompt` handler는 `ctx.payload.id`를 이미 Native로 전달한다. 따라서 Main은 실제 reserved ID를 같은 SDK prompt payload에 넣는다. SDK serialization이 이를 보존하는지는 별도 Node 검증한다. ticket/header 소유만으로 body authority를 만들지 않는다.
10. recipe의 actual Session entry는 같은 Control에서 실제 method/args, original, reserved ID, registered location/incarnation, generations를 대조하고 한 번 consume한다. prompt는 `admission.reconcile()`보다도 앞에서 검사한다. `prepare2`, revert `commit2`, `admission.admit`, `execution.wake` 전에 실패해야 한다. 기존 generic `guard`만으로는 부족하다. body에 extra agents/skills/metadata/resume가 들어오면 명시된 Main input과 다른 인자로 거부한다. absent/undefined normalization도 producer와 일치시킨다.
11. 두 policy stage는 `native.policy.before_selection` → agent/model selection → `native.policy.after_selection` 순서이다. 각 intent와 handoff가 별도이다. phase/stage 기대 순서도 검사한다. `setPermissions`, `switchAgent`, `switchModel`의 final Native method에 모두 같은 검증이 필요하다. 첫 policy stage만 특별 허용하는 bypass는 없다.

현재 handoff target은 session 2개를 항상 요구하고 originKind/targetKind 변형이 없다. 따라서 workspace mutation과 parentless bootstrap에 그대로 쓸 수 없다. D에서 `native-permission-task-handoff.mjs`의 target validator를 accepted closed identity variants와 함께 변경한다. workspace target에는 두 session field를 금지한다. bootstrap은 실제 reservation/binding 전후를 구분한다. store에 별도 pending inbox Map을 추가하지 않는다.

## 6. lifetime 연결의 완료 조건

- `createNativeLeaseRegistry()`는 이미 `origins`와 observer를 하나씩 만든다. Control에서 이것을 사용한다. 별도 `createNativeOriginScopes()`를 만들어 입력을 이중 소유하지 않는다. `origins.admit/bindInbox/createScope/promote`, `reserveOrigin/captureReservation/startReservation/observeReservation/settleReservation`을 실제 entry에 연결한다.
- pinned `config-qs9wxzz9.js`의 `drain()`은 promotion 전 `plugins.awaitActivation`, stale cleanup, `prepareContext()`를 수행한다. 실제 coordinator start부터 원본 reservation/Fiber capture가 필요하다. runStep 직전 guard만으로는 늦다.
- pinned `config-7stqpyhf.js`의 `promote`는 기존 count 소비자를 갖는다. exact promoted ID batch를 같은 session serialization 안에서 검증·전이하고 runner count 사용을 함께 수정한다. 별도 사전 조회의 첫 inbox만 귀속시키지 않는다. project gate → session/inbox lock 순서를 유지한다.
- title `FiberMap.run(titles,sessionID,title.generate(...),{onlyIfMissing:true})` 전에 child lease와 실제 Fiber를 확보한다. 기존 tracked title 재사용 또는 no-new-task를 확인한다. parent ACK 뒤에도 살아 있는 title은 root settlement를 막는다.
- `config-yp2x3t23.js`의 `make16`, internal start/settlement→pendingWake restart에도 fresh admission을 적용한다. HTTP request Fiber를 coordinator Fiber로 잘못 등록하지 않는다. root의 후속 promotion은 immutable scope version으로 확장한다.
- 각 original RPC도 `reserveOrigin(...,'rpc')` 계열의 실제 reservation으로 추적한다. actual RPC 끝, pending→cancelled 또는 promoted→settled, 모든 carrying lease/child/IO 완료, handoff completed/revoked가 모두 필요하다. ACK, Main finally, session idle, interrupt ACK는 대체 증거가 아니다.
- `createNativeTaskObserver().observe()`는 현재 process slot이 하나라도 있으면 `complete:false`를 만든다. direct child observer의 live=0이나 scope-closed를 task proof로 합성하지 않는다. process final settlement 작업은 기존 accepted backlog에 남는다.
- durable `task_proof`를 먼저 flush하고 일치하는 `task.settle`을 뒤에 쓴다. task 증명 수신이 original ACK보다 빠를 수 있다. original completion/lookup 결과를 바꾸지 않는다. loss는 `registry.invalidateTaskAuthority()`와 private revocation으로 live distinction을 없앤다. replay/recovery는 r2의 별도 proof 조건을 유지한다.

## 7. 최소 의미 있는 tests

이번 분석에서는 테스트를 실행하지 않았다. 아래는 다음 구현에서 기존 test 파일에 추가할 항목이다.

| 변경 단위 | 기존 파일 | 실제 검증 |
| --- | --- | --- |
| A: 실제 held path | `workbench-service.test.mjs`, `event-host-supervisor.test.mjs`, `event-host-child.test.mjs`, `native-permission-graph.test.mjs`, `native-permission-control.test.mjs` | cached acquisition/digest capture → supervisor private send → child handler → 동일 acquired Control entry의 held 응답. policy/selection/prompt/arm/recordTask 효과 count=0. 두 Control 인스턴스 사용 시 실패하도록 identity 검사. |
| protocol/loss | `event-host-protocol.test.mjs`, `event-host-supervisor.test.mjs` | 16KiB 초과/extra field/foreign nonce/PID/requestId/중복·늦은 response 거부. owner await 중 disconnect와 closing이면 신규 SDK effect 없음. |
| ordering | `workbench-service.test.mjs`, `host/workspace-registry.test.mjs`, `host/workbench-task-storage.test.mjs` | 첫 dispatch flush를 pause하면 task.prepare/arm/SDK가 진행하지 않음. task marker/prepare/input/handoff 각 flush 실패도 종속 effect 없음. 두 policy의 실제 fn invocation과 readback 순서 확인. |
| final entry | `native-permission-session-entry.test.mjs`, `native-permission-coordinator-admission.test.mjs`, `native-permission-task-handoff.test.mjs`, `native-permission-task-request.test.mjs` | 기존 pinned source 추출+실제 pinned Effect로 실제 Session 함수를 검사. forged body/ID/stage/generation/method는 reconcile/prepare2/commit/admit/wake 이전 실패. SDK fetch capture로 reserved ID/header가 실제 직렬화된 요청에 보존됨을 확인. standalone handoff store 성공만으로 통합 PASS 금지. |
| original lifetime | `native-permission-origin-scopes.test.mjs`, `native-permission-leases.test.mjs`, `native-permission-task-observer.test.mjs` | ACK 전후 실제 Fiber, queue+steer batch, title child, delayed IO, RPC timeout, promotion/cancel race. pending/promoted/reservation 하나라도 남으면 proof/settle 불가. |
| workspace mutation | storage/registry/origin 기존 tests | session 없는 진짜 workspace operation, empty workspace, 완전한 affected sets, stale membership, wrong kind/session substitution, oversize, reopen hold. session lease를 발급하지 않음. |

현재 available B/C 구현이 없는 상태에서 positive test에 generation/inventory를 stub한 것은 component test로만 표시한다. 실제 held-path test는 production Control을 사용한다. 이후 B/C의 실제 producer가 준비되면 그 결과를 쓰는 integration test로 대체한다. 기존 테스트 fixture의 가짜 identity를 production prepare 결과로 보고하지 않는다.

## 8. 확인 범위와 freshness

read-only source/Node hash 계산만 수행했다. server/Native/Bun/Electron/build/UI/network/private originals는 사용하지 않았다. 쓰기 경로는 이 보고서 하나이다. routing profile은 OS sandbox attestation이 아니다. 사용자의 report write 허용에 따라 이 파일만 저장했다.

packet의 profile/bootstrap/skill/roles 4개 hash와 plan hash는 현재 bytes와 일치했다. storage-source-freeze-r3의 storage/helper/registry/journal 및 각 test 6개 hash도 일치했다. workspace supplement의 `workspace-design-review-r1.json`은 pass이며 consumer 구현 승인과는 구분된다. Main337/storage604/native73 green은 사용자가 전달한 결과이며 이 분석의 실행 결과가 아니다.

검사 시점 주요 SHA-256:

```text
9626e6cff07337c47baeeb8e64510bca2fff94a1cd6853b91e1cd58c4225faa9  workbench-service.mjs
b8688ef63ad33f06553fcc5c60ded4005c37eb61b225f8d617244e44d79d4e9e  event-host-protocol.mjs
39b0975fdcd3ee6a96e5e2db5ce78d46b8247c772be9151331b87a03a72643ef  event-host-child.mjs
f18aa41b79b396e4485ec268498f41876ab3ed7cf2195f6aa049c19e6e17cbf8  event-host-supervisor.mjs
26e455fbdd9d42af2cf78867574bb220142d962b448f64ab51f242522fc88d07  native-permission-graph.mjs
b260dd5292944737908ad7935da504c93b45e16a9d7e3cd59e0e450f44329d18  native-permission-control.mjs
9826fac25e1cc1475e6fcae3d98fbaf2aa13deeba0221c9fc4673261bed40d86  native-permission-overlay-contract.mjs
```

병행 작업 중 source는 변할 수 있다. 이 hash는 검사 시점의 사실이며 전체 source freeze나 새 CODE verdict가 아니다. production 연결에 필요한 파일은 Main service/admission/main, protocol/supervisor/child, graph/Control, existing handoff, overlay contract와 해당 기존 tests이다. 저장 parser를 다시 설계하거나 second pending owner를 추가할 필요는 없다. 성공 prepare는 실제 B/C producer와 raw-body final verification 연결이 충족된 뒤에만 주장한다.
