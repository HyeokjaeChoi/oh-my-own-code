구현을 완료했습니다. **Owned tests 48/48, ESLint, Prettier 검사가 통과했습니다.** 독립 code review와 최종 승인은 수행하지 않았습니다.

변경한 파일은 다음 4개뿐입니다.

```text
/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/host/storage-journal.mjs
/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/host/storage-journal.test.mjs
/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/host/workspace-registry.mjs
/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/host/workspace-registry.test.mjs
```

**API checkpoint**

`workspace-registry.mjs`는 `openWorkspaceRegistry(options)`를 export합니다.

```js
options = {
  directory,       // 이미 존재하는 canonical private directory
  storeId,
  documentsPath,   // host가 제공하는 Documents 경로
  runtimeEpoch,    // 현재 transport epoch
  io?,             // journal fault-test 의존성
  pathIO?,         // filesystem fault-test 의존성
  recoveryReason?
};
```

반환 API는 다음과 같습니다.

| API | 입력과 동작 |
|---|---|
| `begin(identity)` | `{runtimeEpoch, operationId, type, digest, workspaceId?, sessionId?, expectedRevision?, rejectionCode?}`. Admission을 flush합니다. |
| `reserve(request)` | `{runtimeEpoch, operationId, ownership?, canonicalPath?, workspaceId?, name?, plannedNativeSessionId?}`. 안정된 ID를 먼저 기록합니다. |
| `dispatch(request)` | `{runtimeEpoch, operationId, step, nativeSessionId?}`. Effect intent를 flush합니다. |
| `complete(request)` | `{runtimeEpoch, operationId, receipt, delta, verifiedNativeSessionIds?}`. Receipt와 delta를 한 record로 flush한 뒤 공개합니다. |
| `materializeManaged(key)` | 예약된 managed folder만 만듭니다. 각 mkdir 전에 dispatch intent를 flush합니다. |
| `readView()` | 복사된 metadata, recovery, retained keys, revision과 observation sequence를 반환합니다. |
| `lookup(key)` | 원래 `{runtimeEpoch, operationId}`로 조회합니다. Native 호출은 없습니다. |
| `status()` | Store 상태, recovery reason, revision과 journal 상태를 반환합니다. |
| `checkpoint()` | 명시적 checkpoint를 만듭니다. |
| `recordOwnerIntent(input)` | Closed owner-intent variant를 기록합니다. |
| `recordMigrationPhase(input)` | Closed migration-phase variant를 기록합니다. 파일을 복사하거나 이동하지 않습니다. |
| `recover(decision)` | 검증된 tail의 명시적 adoption만 허용합니다. |
| `close()` | Queue를 기다리고 journal handle을 닫습니다. |

`delta`는 다음 closed shape입니다.

```js
{ workspaces: [], sessions: [], tombstones: [] }
```

`storage-journal.mjs`의 정확한 named exports는 다음과 같습니다.

```js
openStorageJournal
STORAGE_LIMITS
STORE_RECOVERY_REASONS
RESOURCE_RECOVERY_REASONS
DISPATCH_STEPS
storageError
validateStorageIdentity
validateStorageReceipt
validateRegistryDelta
validateJournalPayload
```

`openStorageJournal({directory, storeId, io?, recoveryReason?})`는 `append`, `checkpoint`, `readRecords`, `status`, `recover`, `close`를 반환합니다. Registry와 별도의 journal writer를 동시에 열면 안 됩니다.

**종료와 재개방 조건**

- **Checkpoint는 명시적입니다.** `complete()`와 `close()`는 자동 checkpoint를 만들지 않습니다.
- 정상 종료 순서는 `await registry.checkpoint()` → `await registry.close()`입니다.
- Journal을 열기 전에 Main이 exclusive store ownership을 확보해야 합니다.
- Owner release와 native child 종료 확인은 Main의 책임입니다.
- 재개방은 checkpoint를 검증합니다. 이후 tail은 checksum이 유효해도 자동으로 confirmed completion이 되지 않습니다.
- 검증된 admission·reservation·dispatch는 보수적인 unknown hold로 유지합니다. Candidate mapping과 tombstone은 공개하지 않습니다.
- 손상된 bytes를 자르거나 다시 쓰지 않습니다. Writer failure 이후 추가 쓰기도 차단합니다.
- `owner_conflict`와 `owner_unverified`에서는 journal을 열지 않습니다.

명시적 tail adoption은 아래 조건을 모두 요구합니다.

```js
await registry.recover({
  action: "adopt_validated_tail",
  expectedSequence: registry.status().journal.sequence,
  expectedHash: registry.status().journal.hash,
  ownerVerified: true,
  preflightVerified: true,
});
```

두 boolean은 trusted host의 검증 결과입니다. Renderer 입력을 그대로 전달하면 안 됩니다. Corrupt tail과 실패한 checkpoint는 이 API로 자동 복구하지 않습니다.

**실행 가능한 통합 예**

아래 코드는 repository root에서 `node --input-type=module`로 실행할 수 있습니다. Synthetic native ID만 사용합니다.

```js
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWorkspaceRegistry } from "./apps/desktop-app/src/host/workspace-registry.mjs";

const root = await fs.realpath(
  await fs.mkdtemp(join(tmpdir(), "p7-api-demo-")),
);
const directory = join(root, "private");
const documentsPath = join(root, "Documents");
await fs.mkdir(directory);
await fs.mkdir(documentsPath);

const options = {
  directory, documentsPath,
  storeId: "fixture-store",
  runtimeEpoch: "epoch-1",
};
const key = { runtimeEpoch: "epoch-1", operationId: "create-1" };
let registry;

try {
  registry = await openWorkspaceRegistry(options);
  await registry.begin({
    ...key, type: "workspace.create", digest: "a".repeat(64),
  });
  const reserved = await registry.reserve({
    ...key, ownership: "managed",
    plannedNativeSessionId: "fixture-native-1",
  });
  await registry.materializeManaged(key);

  const dispatch = await registry.dispatch({
    ...key, step: "native.create",
    nativeSessionId: "fixture-native-1",
  });
  if (dispatch.status !== "dispatched")
    throw new Error("Duplicate effect must not run");

  // Synthetic verified result. 실제 native/provider 호출은 없습니다.
  await registry.complete({
    ...key,
    receipt: {
      ...key, type: "workspace.create",
      admission: "dispatched", delivery: "accepted",
      effect: "confirmed", revision: 0, evidence: [],
    },
    verifiedNativeSessionIds: ["fixture-native-1"],
    delta: {
      workspaces: [{
        ...reserved.workspace, registrationState: "registered",
      }],
      sessions: [{
        appSessionId: reserved.appSessionId,
        workspaceId: reserved.workspace.workspaceId,
        nativeSessionId: "fixture-native-1",
        lifecycleState: "active", pinned: false, archived: false,
      }],
      tombstones: [],
    },
  });

  await registry.checkpoint();
  await registry.close();
  registry = await openWorkspaceRegistry({
    ...options, runtimeEpoch: "epoch-2",
  });
  console.log(registry.status().state);         // ready
  console.log(registry.lookup(key).receipt.effect); // confirmed
} finally {
  await registry?.close();
  await fs.rm(root, { recursive: true, force: true });
}
```

이 예도 실행했습니다. 결과는 `ready`, current epoch `epoch-2`, original-key lookup `confirmed`였습니다. 실제 통합에서는 fixture digest 대신 기존 P4 canonical digest를 전달해야 합니다.

**실제 검사**

Repository root에서 실행했습니다.

```sh
node --test apps/desktop-app/src/host/storage-journal.test.mjs apps/desktop-app/src/host/workspace-registry.test.mjs

node_modules/.bin/eslint --config apps/desktop-app/eslint.config.mjs apps/desktop-app/src/host/storage-journal.mjs apps/desktop-app/src/host/storage-journal.test.mjs apps/desktop-app/src/host/workspace-registry.mjs apps/desktop-app/src/host/workspace-registry.test.mjs

node_modules/.bin/prettier --check apps/desktop-app/src/host/storage-journal.mjs apps/desktop-app/src/host/storage-journal.test.mjs apps/desktop-app/src/host/workspace-registry.mjs apps/desktop-app/src/host/workspace-registry.test.mjs
```

48개 테스트는 partial write, flush/checkpoint 실패, paused publication, concurrent BUSY 기록, corruption/version/identity 충돌, original-epoch hold, 2048/2049 retained-key 제한, partial mapping, 중복 completion, 경로 충돌·symlink·denied·missing과 sentinel 보존을 검증합니다.

남은 경계는 Main 통합입니다. `readView()`는 host-local metadata projection이며 완전한 service DTO는 아닙니다. Native mapping 검증, transport admission, bootstrap·clock 통합, OS ownership과 전체 acceptance는 Main이 처리해야 합니다. Windows directory flush, power-loss durability와 handle-relative 경로 race 보호는 검증하지 않았습니다. Journal 압축과 자동 정리는 없으며, 재개방 시 전체 파일을 읽습니다.
