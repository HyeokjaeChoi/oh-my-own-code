**정적 API 근거는 확인했습니다. F-07/F-08/F-09의 실제 실행 수용 근거는 확보되지 않았습니다.** 파일 변경, provider 실행, native probe, 앱 실행은 하지 않았습니다. 활성 구현 소스의 정확성도 평가하지 않았습니다.

기준은 설치된 `@opencode/client@2.0.18`입니다. 아래는 **English API facts**이며, 반환 타입은 실제 실행 결과와 구분합니다.

| 기능 | Exact method / arguments / declared result |
|---|---|
| 새 세션 | `session.create({id?, title?, agent?, model?, location?, metadata?, permissions?}) → Promise<SessionInfo>`. `model = {id, providerID, variant?}`, `location = {directory}`. **No `parentID` or history input is serialized.** |
| 자식 조회 | `session.list({parentID, limit?, cursor?, ...}) → {data: SessionInfo[], cursor: {previous?, next?}}`. `SessionInfo` includes optional `parentID`, `fork`, `outcome`, `permissions`. |
| 작업 전달 | `session.prompt({sessionID, text, id?, files?, agents?, skills?, metadata?, delivery?, resume?}) → SessionInboxUser`. **An inbox item is not a completed execution result.** |
| 관찰 | `session.get({sessionID}) → SessionInfo`; `session.active() → Record<string, {type:"running"}>`; `session.log({sessionID, after?, follow?}) → AsyncIterable<SessionLogItem>`; `session.wait({sessionID}) → void`. |
| 중단 | `session.interrupt({sessionID, resume?}) → {interrupted:boolean}`; `session.inbox.cancel({sessionID, inboxID}) → void`. **No recursive/all-children flag is exposed here.** |
| 직접 RPC | `rpc.call({rpcID, method, location?, input?}) → {output?:any}`. `client.rpc(definition)[method](input, options?)` returns `result.output`. **No general tool catalog/schema-discovery/tool-execute endpoint was found in this public client.** |
| 규칙 변경 | `session.update({sessionID, permissions?, title?, metadata?}) → void`. Rule: `{action:string, resource:string, effect:"allow"|"deny"|"ask"}`. |
| 승인 요청 | `permission.create({sessionID, action, resources, id?, save?, metadata?, source?, agent?}) → {id, effect}`. |
| 요청 조회·응답 | `permission.list({sessionID}) → PermissionRequest[]`; `permission.get({sessionID, requestID}) → PermissionRequest`; `permission.reply({sessionID, requestID, decision:"once"|"always"|"reject", message?}) → void`. |
| 저장 규칙 취소 | `permission.saved.list({projectID?}) → PermissionSavedInfo[]`; `permission.saved.remove({id}) → void`. Saved entry includes `id`, `projectID`, `action`, `resource`, created/updated timestamps; **no expiry field is exposed**. |

근거 줄 번호:

- 생성·조회·반환 타입: [client.d.ts L32–78](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/node_modules/@opencode/client/dist/promise/generated/client.d.ts:32), [SessionInfo L2788–2814](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/node_modules/@opencode/client/dist/promise/generated/types.d.ts:2788).
- 실제 요청 생성: [session create L252–267, update/prompt L329–361](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/node_modules/@opencode/client/dist/chunks/contract-n8g24fq8.js:252).
- 관찰·중단: [log/interrupt L520–535](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/node_modules/@opencode/client/dist/chunks/contract-n8g24fq8.js:520), [입력 타입 L6117–6139](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/node_modules/@opencode/client/dist/promise/generated/types.d.ts:6117).
- 권한 요청·취소: [L881–935](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/node_modules/@opencode/client/dist/chunks/contract-n8g24fq8.js:881), [공개 반환 타입 L152–166](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/node_modules/@opencode/client/dist/promise/generated/client.d.ts:152).
- RPC 전송: [L994–1003](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/node_modules/@opencode/client/dist/chunks/contract-n8g24fq8.js:994), [typed wrapper L43–57](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/node_modules/@opencode/client/dist/chunks/contract-1tbj6z39.js:43).

**미확인 기능과 최소 probe/adapter 후보**

1. **F-07 — native fresh child**
   - `create()`에 `parentID`가 없습니다. 독립 세션 생성 API와 native 부모–자식 생성 계약을 같다고 볼 수 없습니다.
   - `prompt.agents`의 존재만으로 새 컨텍스트 생성·권한 상속·결과 회수를 확정할 수 없습니다.
   - 후보: 승인된 격리 fixture에서 부모에 고유 marker를 넣고, 두 자식의 native `parentID`, 초기 context, 개별 중단, 한 자식 실패를 저장합니다. 앱의 별도 위임 mapping 후보는 native 관계와 구분해야 합니다. 선택 판단은 coordinator에 이관합니다.

2. **F-08 — known-schema direct tool**
   - RPC는 확장 전송 수단입니다. 공개 client에서 tool 실행 계약이나 자동 schema 발견 계약은 확인되지 않았습니다.
   - 후보: 고정된 `Rpc.PortableDefinition`과 부작용 없는 단일 fixture method로 입력 검증·거절·결과·취소 한계를 저장합니다. 실제 tool 연결에는 동일 권한·기록 경계를 명시한 별도 승인 계약이 필요합니다.

3. **F-09 — execution-boundary permissions**
   - 규칙 전달·수정·조회·삭제 API는 확인됐습니다. preset 이름, 유효 규칙 병합 순서, wildcard 의미, 활성 도구 중단, 기존 대기 요청 재평가, 자식 전파는 client 타입으로 증명되지 않습니다.
   - 후보: 무해한 fixture action으로 부모 deny와 자식 요청 충돌, 생성 시 상속, 확대 비전파, 선택한 자식의 축소, 저장 규칙 취소 후 재요청, stale/duplicate reply를 각각 저장합니다.
   - **Permission metadata does not prove OS isolation.**

추가 경계: `{signal}`은 `fetch`에 전달됩니다. 서버 작업 중단 완료를 의미하지 않습니다. 일반 이벤트 연결에는 자동 재연결 루프가 없지만, 별도로 `session.log({after, follow})`가 있습니다. 해당 로그의 복구 범위는 실제 probe가 필요합니다. [signal L32–45](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/node_modules/@opencode/client/dist/chunks/contract-n8g24fq8.js:32), [event 종료 L20–47](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/node_modules/@opencode/client/dist/chunks/contract-frbwqjmf.js:20).

저장된 spike는 합성 client 응답 근거입니다. 권한·병렬 자식·직접 호출 수용은 포함하지 않습니다. [저장된 조사 L7, L41–45](/Users/hyukjaechoi/Projects/oh-my-own-code/docs/research/sdk-ui-feasibility.md:41). 당시 문서의 상속 설명도 pinned runtime 검증과 구분해야 합니다. [문서 조사 L3–10](/Users/hyukjaechoi/Projects/oh-my-own-code/docs/research/workbench-expansion.md:3).

위 후보는 실행하지 않았습니다. 기능 계약 선택과 수용 판단은 coordinator 및 지정 판단 역할에 이관합니다.
