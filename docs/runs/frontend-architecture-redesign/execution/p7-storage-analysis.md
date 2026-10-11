**P7은 native database와 host journal을 함께 보존해야 합니다.** Renderer 목록 저장만으로는 재시작 복구를 보장할 수 없습니다.

분석만 수행했습니다. source, docs, ledger는 수정하지 않았습니다. 위임하거나 화면에 앱을 열지 않았습니다. 요청한 `Sol/high`는 판단 기준으로 적용했습니다. 실제 model이나 sandbox 상태를 확인했다는 뜻은 아닙니다.

읽은 `plan.md`는 revision 6이며, packet의 SHA-256과 일치했습니다:
`d94e9d2d07e6f7b215fa79301836087b70d24500e0da7f233ae6887c321d7560`

### 확인한 사실

| 실제 동작 | 근거 |
|---|---|
| `HOME`, config, data, cache, state, tmp를 하나의 임시 root에 둡니다. 종료를 확인한 뒤 root 전체를 삭제합니다. | [sidecar-supervisor.mjs:18](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/sidecar-supervisor.mjs:18), [cleanup:106](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/sidecar-supervisor.mjs:106) |
| 시작할 때마다 임시 workspace와 새 native session을 생성합니다. 영속 저장소를 붙이면 불필요한 session이 계속 생깁니다. | [sidecar-supervisor.mjs:92](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/sidecar-supervisor.mjs:92), [session creation:239](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/sidecar-supervisor.mjs:239) |
| Electron `userData`, `sessionData`, logs, crash dumps도 임시이며 삭제됩니다. | [ephemeral-profile.mjs:5](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/ephemeral-profile.mjs:5) |
| workspace, session, receipt는 메모리 `Map`입니다. 앱 session ID는 native 생성 결과를 받은 뒤 할당합니다. | [workbench-service.mjs:131](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/workbench-service.mjs:131), [addSession:245](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/workbench-service.mjs:245) |
| snapshot의 대화는 native `message.list`에서 읽은 최대 100개 메시지의 projection입니다. 완전한 대화 저장본이 아닙니다. | [workbench-service.mjs:358](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/workbench-service.mjs:358) |
| `workspace.create`는 현재 폴더 선택을 요구합니다. unregister는 메모리 등록만 제거합니다. `session.remove`는 native 대화를 삭제합니다. | [creation/unregister:995](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/workbench-service.mjs:995), [session removal:905](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/workbench-service.mjs:905) |
| SDK `2.0.18`의 create/prompt는 지정 ID를 받습니다. fork는 대상 ID를 받지 않습니다. command는 `void`를 반환합니다. | 설치된 `@opencode/client/dist/promise/generated/types.d.ts`: 3705, 5299, 5385; `client.d.ts`: 35, 43, 48–49 |

**macOS native 검증 결과:**

- database: `XDG_DATA_HOME/opencode/opencode.db`
- SQLite journal mode: `wal`
- 정상 종료 후에도 `opencode.db-wal`, `opencode.db-shm`이 남았습니다.
- 분리한 durable data 경로에서 native session ID, location, metadata, 합성 대화 기록, queued inbox가 재시작 후 유지됐습니다.
- `SIGKILL` 후 재시작에서도 합성 대화 기록과 queued inbox가 유지됐습니다.
- 같은 native session ID로 다시 create하면 **기존 session을 반환**했습니다. 다른 title은 적용되지 않았습니다.
- `synthetic({resume:false})`는 inbox에 남았습니다. 즉시 transcript에 기록되는 것은 아닙니다.
- database에 `credential`, `account`, `migration` table이 있습니다. `user_version`은 `0`이므로 그것만으로 native schema 호환성을 판단할 수 없습니다.

실제 provider 실행, 전원 손실, Windows runtime은 검증하지 않았습니다.

### English proposed contract

:::writing{variant="document" id="73142"}
P7 durable storage contract — proposed

1. Ownership and paths

Main owns durable app metadata and operation receipts. OpenCode owns its native database, transcript, inbox and event history. Renderer state is a disposable projection.

Resolve Documents with app.getPath("documents"). Create managed workspaces at Documents/OhMyOwnCode/{stableAppSessionId}. Allocate and journal that ID before folder creation or native dispatch. Rename does not move the folder. Additional sessions and forks can share the workspace; they do not copy it. If workspace creation precedes session creation, reserve the first session ID in the workspace record.

Keep imported paths in place. Unregister removes registration only. Confirmed conversation deletion removes native conversation data only. Neither action deletes project files.

Use a private, stable app storage root outside the ephemeral Electron profile and project folders. Resolve it before ephemeral path overrides. Use local app-data storage; verify the Windows resolver before release. Record canonical paths in the manifest. A changed Documents location does not move existing workspaces automatically.

2. Schema

Use versioned, validated records:

Manifest: schemaVersion, storeId, nativeVersion, storageGeneration, canonical storage paths.

Workspace: workspaceId, ownership(managed/imported/legacy), canonicalPath, folderSessionId?, registrationState, trust binding and revision.

Session: appSessionId, workspaceId, nativeSessionId?, parentSessionId?, lifecycleState, pinned, archived, lastViewedAt and last-observed native metadata.

Receipt: originalRuntimeEpoch, operationId, P4 canonical digest, immutable operation kind and scope, admission/delivery/effect states, dispatch steps, correlated native IDs, result references and revision.

Tombstone: removed identity, confirming receipt and revision.

Migration: migrationId, source/destination identities, inventory and hashes, phase, native mapping verification and cutover generation.

Do not store a second transcript in app metadata. Do not put credentials, message bodies or stale renderer snapshots in the receipt journal.

3. Journal and commit order

Use one serialized, append-only journal for app registry changes, receipt transitions and tombstones. Each record has a schema version, sequence, bounded payload, previous hash and checksum. Checkpoints are derived from the journal.

Flush admission before any effect. Flush a dispatch-intent record before each native or filesystem effect, including policy, agent and model changes. Flush correlated results before reporting durable success. A crash after dispatch intent means “may have executed”, even if dispatch did not occur.

Publish checkpoints through a flushed temporary file and atomic replacement in the same filesystem. Keep the previous valid generation. Verify file and directory flush behavior on each OS. Do not claim power-loss durability from rename or process-crash tests alone.

Native SQLite and the app journal are separate commit domains. This contract does not claim one atomic transaction or exactly-once native execution.

4. Native storage and cleanup

Keep XDG_DATA_HOME and XDG_STATE_HOME in the durable native namespace. Preserve the complete native database set, including WAL files. Main must not edit native SQLite tables or infer its schema version from PRAGMA user_version.

Keep process roots, HOME/profile, cache, tmp and Electron session data disposable. Preserve the minimal child environment and do not inherit personal credentials or configuration. Cleanup can remove only verified disposable roots after owned-process exit. It must never traverse a durable root, imported path or migration source under retention.

Separate sidecar startup from session creation. Reopen registered native sessions; do not create a bootstrap session on every launch.

5. Locking

Acquire one exclusive lock for the canonical store before journal recovery or sidecar launch. Record an owner nonce, host identity and owned child identity. Serialize app writes under that owner.

A second instance must not write or start another sidecar. Lock age, heartbeat expiry and PID absence alone do not permit lock takeover. Reclaim only after proving that the old owner and its recorded child are gone. Otherwise expose recovery status and block mutations. Release the lock only after confirmed owned-child exit.

6. Recovery

Validate schema, checksums, references, paths, permissions and native-version compatibility before effects. Missing or denied paths stay registered as unavailable. Do not recreate, relocate or delete them automatically.

Restore unresolved receipts and resource holds across epochs. A new epoch does not clear uncertainty. Lookup must distinguish the current transport epoch from the original receipt key. Missing records, idle state, title matches and queue absence do not prove no effect.

For native create, persist the planned native ID and operation metadata before dispatch. Recover through exact identity and metadata checks. Never replay create to discover its result. Fork and command remain unknown when exact correlation is unavailable.

Retain unresolved receipts and dedup tombstones. Enforce admission limits before effects. Namespace retirement requires an explicit host recovery action and must retain unresolved holds.

Preserve corrupt journal bytes. Do not silently discard an invalid tail or rewrite an unsupported version. Recovery can expose a validated prefix, but mutations remain blocked until the recovery decision is recorded.

Verify native startup behavior for pending inbox items before claiming safe execution recovery. This contract does not permit automatic replay, resume or permission approval.

7. Migration and rollback

Migration is explicit. Pin the source against cleanup before quiescing it. The current stop-and-delete API is insufficient for this step.

Copy managed files and complete stopped native storage into staging. Verify inventories, hashes, native history, lineage and path mappings before cutover. Do not overwrite a collision. Do not rewrite native SQLite location fields.

Use SDK location or transfer operations only after proving that they preserve required history, lineage and pending state. Session export/import alone is not proof of complete native-state migration.

Journal each phase. Interrupted migration preserves source and destination and returns to recovery. If source data is already absent, report that limitation. Rollback must preserve both copies, new durable data and unresolved receipts. Older code that cannot read the schema must refuse writes.
:::

### 실제 호환성 위험과 다음 의존성

1. **P7 소유 경로에 `sidecar-supervisor.mjs`를 추가해야 합니다.** 환경 분리, 시작 시 session 생성 제거, migration source 보존은 이 파일의 변경이 필요합니다.

2. **P4 lookup 계약에 과거 receipt key를 표현할 방법이 필요합니다.** 현재 transport epoch와 receipt의 original epoch를 구분해야 합니다. 새 epoch로 unresolved 작업을 우회해서는 안 됩니다.

3. **Native ID가 digest 검사를 대신하지 않습니다.** 같은 ID로 다른 입력을 보내도 기존 session이 반환됩니다. 앱 journal의 digest 검사와 native metadata 검사가 필요합니다. Prompt의 지정 ID 동작은 별도 native 검증이 남았습니다.

4. **`session.export`는 `info`와 `messages`를 반환합니다.** 이것만으로 inbox, durable events, permissions, credentials까지 완전하게 이전했다고 주장할 수 없습니다. `session.move`도 위치 변경 완료와 pending 실행 영향을 검증해야 합니다.

5. **영속 inbox의 실행 재개 정책은 미검증입니다.** 이번 검증은 합성 데이터와 인증 없는 runtime을 사용했습니다. 실제 설정이 있는 runtime의 시작 시 자동 실행 여부는 별도 gate입니다.

6. **Windows 검증은 남아 있습니다.** Documents 경로, native database 위치, lock 회수, ACL, atomic replacement 및 flush를 Windows에서 확인해야 합니다. macOS 결과로 대체할 수 없습니다.

### 로컬 acceptance 명령

아래 명령은 repository root에서 실행했으며 통과했습니다.

```sh
node --test apps/desktop-app/src/sidecar-supervisor.test.mjs apps/desktop-app/src/ephemeral-profile.test.mjs apps/desktop-app/src/workbench-service.test.mjs
```

**36/36 통과.**

```sh
node --input-type=module -e 'import { probeSessionHistory } from "./apps/desktop-app/scripts/fixtures/session-history-probe.mjs"; console.log(await probeSessionHistory(process.cwd()));'
```

실제 SDK에서 합성 history fork, 등록되지 않은 fork 자식 보호, 중복 효과 방지, project-file sentinel 보존을 확인했습니다. Electron 창은 실행하지 않습니다.

Durable restart와 `SIGKILL` 검증은 저장하지 않은 inline Node fixture로 실행했습니다. **현재 repository에는 P7 crash-recovery acceptance script가 없습니다.** 다음 구현에서 script를 등록하고 다음 crash 지점을 검증해야 합니다:

- admission flush 전후, dispatch intent 전후
- 폴더 생성 후 ownership 기록 전
- native create 후 app mapping commit 전
- native 결과 수신 후 receipt flush 전
- checkpoint 교체 중
- migration copy·검증·cutover 사이
- 재시작 시 unresolved receipt, missing path, denied Documents, lock 충돌
- rename·unregister·conversation deletion 후 원본 sentinel 보존

**다음 단계는 계약의 독립 검토입니다.** 이번 결과는 저장 방식의 실행 가능성을 뒷받침하지만, P7 구현이나 restart recovery 완료를 의미하지 않습니다.
