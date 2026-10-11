**R3 구현 완료. 지정한 두 파일을 동결했습니다.**

- private `checkRoot` 옵션을 추가했습니다. 생략할 수 있으며, 공급하면 함수여야 합니다.
- callback은 실제 held root의 frozen `{workspaceId, workspacePath, dev, ino}`를 받습니다. 동기 반환값이 정확히 `true`여야 합니다.
- 순서는 `checkRoot → check() → checkRoot → 실제 descriptor·경로 재검증`입니다.
- 기존 descriptor 정리, ancestor 검사, token·backup 처리와 guard 없는 동작을 유지했습니다. request·DTO·storage 변경과 재귀 호출은 없습니다.

**검증:** RED 확인 후 새 경계 10개 GREEN. 실제 owner 연결, root 교체, Promise 거부, 취소, 재진입, legacy 저장을 확인했습니다. Node import 검사와 두 파일의 lint·format도 통과했습니다.

- [RED 증거](/private/tmp/omoc-root-object-red.Z0AwLw/synthetic-2pbxxG/failed-case.json)
- [최종 GREEN 증거](/private/tmp/omoc-root-object-green.xafzib/synthetic-4vHpQF/verification.json)

최종 SHA-256:

| 변경 파일 | SHA-256 |
|---|---|
| [configuration-save-kernel.mjs](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/host/configuration-save-kernel.mjs) | `f9c8138eff6be29d4caad57641ce87134e83b3fcaa4e2d26f0c7063cd4c874fd` |
| [configuration-save-kernel.test.mjs](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/host/configuration-save-kernel.test.mjs) | `056acaf0600085fc2f0fe809b673ac2ac3dac8577a494ccb46d3f16a5c48715c` |

owner의 예외는 기존 규칙에 따라 `unknown/io_failed`로 처리합니다. 정확한 `true`가 아닌 반환값은 `unknown/path_denied`입니다.

Main의 test-only freeze r2 업데이트를 반영했습니다. 전체 coherent suite와 독립 CODE 검토는 Main에 남깁니다. 전체 검사에서는 `OMOC_KERNEL_CASE_PREFIX`를 해제해야 합니다. Native·server·Electron·build·provider·productionMain은 실행하지 않았습니다.
