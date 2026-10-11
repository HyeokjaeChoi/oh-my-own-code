통합 메모를 반영했습니다. **최종 테스트 63개와 lint·syntax 검사가 모두 통과했습니다.**

Kernel adapter는 Main이 동기적으로 획득한 **같은 canonical root**를 재사용합니다. 두 번째 singleton 요청은 없습니다. 다른 root, 잃어버린 lock, release한 lock은 거절합니다.

변경 파일은 기존 두 개뿐입니다.

```text
apps/desktop-app/src/host/storage-lock.mjs
apps/desktop-app/src/host/storage-lock.test.mjs
```

Frozen API의 이름과 인자는 유지합니다.

```js
createElectronOwnerKernel(app)
createProcessVerifier({ captureCurrent, inspect })
createStorageOwner({ root, kernel, processVerifier, io?, nonce? })

// owner handle
status()
getNonce()
acquire({ initialize })
assertOwned(nonce)
markSpawnIntent(nonce)
recordChild(nonce, identity)
release(nonce)
```

Main의 연결 순서는 다음과 같습니다.

```js
// Main이 동기적으로 canonicalRoot를 준비한 뒤, app.ready 전에 실행합니다.
const kernel = createElectronOwnerKernel(app);
if (!kernel.acquire(canonicalRoot)) return ownerConflict;

// 같은 adapter와 root를 async record 검증에 전달합니다.
const owner = createStorageOwner({
  root: canonicalRoot,
  kernel,
  processVerifier: createProcessVerifier({ captureCurrent, inspect }),
});
const result = await owner.acquire({ initialize: freshRootProvisioned });
```

Repository root에서 실행한 최종 명령은 모두 exit `0`입니다.

```sh
node --test --test-reporter=dot apps/desktop-app/src/host/storage-lock.test.mjs
node_modules/.bin/eslint --config apps/desktop-app/eslint.config.mjs apps/desktop-app/src/host/storage-lock.mjs apps/desktop-app/src/host/storage-lock.test.mjs
node --check apps/desktop-app/src/host/storage-lock.mjs
node --check apps/desktop-app/src/host/storage-lock.test.mjs
```

최종 SHA-256:

```text
storage-lock.mjs
1f59890078087cf487a65454271e16f375c0a200f0a6054a94444b1cf7a65fae

storage-lock.test.mjs
644b8d5efd3b3343673514043164b4781380656f9307ada90fdee42a4a51f2e9
```

검증은 합성 임시 root와 주입한 adapter에 한정됩니다. 실제 OS identity helper, production Electron/native 호환성, 독립 gate는 Main이 담당합니다. Main·OS helper·docs·reports·ledger는 수정하지 않았으며, 자체 승인도 하지 않았습니다.
