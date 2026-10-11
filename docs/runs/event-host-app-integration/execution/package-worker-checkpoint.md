패키지 작업을 완료했습니다. **Node-only 테스트 56/56, ESLint, Prettier가 통과했습니다.**

- 실제 resources: **38,390 entries / 35,119 files / symlink 31개 / 399,253,718 bytes**
- formatted child·protocol·resources module과 staged 파일의 hash가 모두 일치합니다.
- full manifest는 **9,344,572 bytes**입니다. report에는 전체 파일 검증 후 **562-byte summary**만 넣습니다. 기존 **4MiB 제한은 유지**했습니다.
- fixture 누락, npm alias 이름 비교, protocol asset 누락, manifest 중복 출력을 수정했습니다.

API는 확정했습니다.

- `eventHostForResources(...)` → `{root, enginePath, hostPath, manifestPath}`
- `verifyEventHostResources(...)` → 검증된 full manifest 자체
- `snapshotEventHostResources(...)` → `{algorithm, manifestSha256, inventorySha256, entryCount, fileCount, symlinkCount, totalBytes, versions, target, manifestPath, sha256}`

변경 파일은 다음 13개입니다.

- [event-host-resources.mjs](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/event-host-resources.mjs)
- [prepare-event-host.mjs](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/scripts/prepare-event-host.mjs), [stage-event-host.mjs](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/scripts/stage-event-host.mjs), [stage-event-host.test.mjs](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/scripts/stage-event-host.test.mjs)
- [build.mjs](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/scripts/build.mjs), [build-provenance.mjs](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/scripts/build-provenance.mjs), [fixture](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/scripts/build-provenance-test-fixture.mjs), [tests](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/scripts/build-provenance.test.mjs), [inspector](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/scripts/inspect-packaged-bundle.mjs)
- [package.json](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/runtime-event-host/package.json), [package-lock.json](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/runtime-event-host/package-lock.json), [installer-pins.json](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/runtime-event-host/installer-pins.json)
- [.gitignore](/Users/hyukjaechoi/Projects/oh-my-own-code/.gitignore)

Checkpoint SHA256 — 정렬된 `path + NUL + fileSHA256 + newline`의 hash:

`8f9e70209c441215e1386182180e81572d2f8b1921ec8ebb74f0d78ea5baafe8`

Resource summary SHA256:

`2110d7e7f8865d68822cac448607849407023fc6732ada76160481a6af0fbc60`

Bun·server·native·Electron·UI·전체 build는 실행하지 않았습니다. 독립 review와 실제 Native report의 최종 크기 검증은 Main에 남아 있습니다.
