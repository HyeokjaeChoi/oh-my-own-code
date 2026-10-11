```json
{
  "repository": "/Users/hyukjaechoi/Projects/oh-my-own-code",
  "status": "구현 완료. 독립 review 승인 전.",
  "changedFiles": [
    {
      "path": "apps/desktop-app/src/host/storage-journal.mjs",
      "sha256": "96003d08f4500175f14584bc4db8fb6c23778d692e9ffb3a3b6ca7f6736eb45e"
    },
    {
      "path": "apps/desktop-app/src/host/workspace-registry.mjs",
      "sha256": "65d148087e24f31a4c293339da9513eed6252267e8978796a278a759183f323a"
    },
    {
      "path": "apps/desktop-app/src/host/storage-journal.test.mjs",
      "sha256": "57dd199cb51ad1b5c83c388e50983479f908fd571d72dd819988ec061b2dbae5"
    },
    {
      "path": "apps/desktop-app/src/host/workspace-registry.test.mjs",
      "sha256": "77386050936941332a7c47e9ca221835f85a1fedecf175d1d9776a549f77084b"
    }
  ],
  "checks": {
    "cwd": "/Users/hyukjaechoi/Projects/oh-my-own-code",
    "nodeVersion": "v26.8.2",
    "tests": {
      "command": "node --test apps/desktop-app/src/host/storage-journal.test.mjs apps/desktop-app/src/host/workspace-registry.test.mjs",
      "result": "118 PASS, 0 FAIL, exit 0",
      "durationMs": 9310.149875,
      "sourceStability": "최종 실행 전후 4개 파일의 SHA-256 일치"
    },
    "lint": {
      "command": "pnpm exec eslint --config apps/desktop-app/eslint.config.mjs apps/desktop-app/src/host/storage-journal.mjs apps/desktop-app/src/host/workspace-registry.mjs apps/desktop-app/src/host/storage-journal.test.mjs apps/desktop-app/src/host/workspace-registry.test.mjs",
      "result": "PASS, exit 0"
    },
    "format": {
      "command": "pnpm exec prettier --check apps/desktop-app/src/host/storage-journal.mjs apps/desktop-app/src/host/workspace-registry.mjs apps/desktop-app/src/host/storage-journal.test.mjs apps/desktop-app/src/host/workspace-registry.test.mjs",
      "result": "PASS, exit 0"
    },
    "workerLogPaths": [],
    "logNote": "별도 로그 파일은 작성하지 않았습니다. 결과는 도구 출력에 있습니다."
  },
  "publicExports": {
    "addedToStorageJournal": [
      "instructionStep(type)",
      "validateInstructionDispatch(identity, dispatch, sessions)",
      "validateInstructionCompletion(operation, payload, sessions, features)"
    ],
    "extended": [
      "validateStorageIdentity(value)",
      "validateStorageReceipt(value)",
      "validateRegistryDelta(value)",
      "validateJournalPayload(value)",
      "openStorageJournal(options)"
    ],
    "registry": "openWorkspaceRegistry(options)와 반환 API의 기존 signature 유지"
  },
  "semantics": {
    "feature": "configuration_instructions_v1",
    "operationSteps": {
      "configuration.instructions.apply": "native.instructions.put",
      "configuration.instructions.remove": "native.instructions.remove"
    },
    "receipts": {
      "instruction_registered": ["kind", "workspaceId", "sessionId", "digest", "sourceVersion"],
      "instruction_removed": ["kind", "workspaceId", "sessionId"]
    },
    "metadata": "optional closed instructionRegistration. registered는 key/digest/sourceVersion/origin을 포함합니다. origin=fork만 inheritedFromSessionId를 요구합니다. absent는 state/key만 허용합니다.",
    "validation": [
      "marker가 새 admission과 metadata보다 먼저 기록됩니다. pre-marker expectedRevision 의미를 유지합니다.",
      "instruction step은 해당 operation과 기존 active session의 nativeSessionId에 연결되어야 합니다.",
      "confirmed completion은 dispatched/accepted receipt와 최종 metadata가 정확히 일치해야 합니다.",
      "동일 direct 재등록과 이미 absent인 제거는 빈 delta를 허용합니다.",
      "첫 fork-to-direct apply와 변경된 digest/sourceVersion은 실제 metadata delta를 요구합니다.",
      "일반 metadata 작업은 instruction 소유권을 만들거나 변경하거나 지울 수 없습니다.",
      "확인된 fork만 부모의 committed metadata를 복사합니다. registered origin은 immediate parent를 기록합니다. absent도 복사하며, metadata가 없으면 생성하지 않습니다.",
      "unknown과 실패한 completion flush는 새 소유권이나 origin을 공개하지 않습니다.",
      "readView와 checkpoint/reopen은 optional metadata를 보존합니다. 부모의 이후 변경은 child origin을 바꾸지 않습니다.",
      "기존 Native metadata mapping은 변경하지 않았습니다."
    ]
  },
  "legacyParser": {
    "path": "docs/runs/configuration-instructions/evidence/prechange/legacy-storage-journal.bundle.mjs",
    "sha256": "1b6cf5048680e3e246e4efa8da4299e7e25008972f3604d2e5bf0f9fead98f33",
    "result": "실제 고정 bundle이 unsupported_version으로 거부합니다. checkpoint 호출도 거부하며 journal/checkpoint bytes를 보존합니다."
  },
  "limits": {
    "recordBytes": 4194304,
    "operations": 2048,
    "workspaces": 100,
    "sessions": 200,
    "executionScope": "소유한 Node 테스트와 lint/format만 실행했습니다.",
    "notExecuted": ["Main aggregate", "Native runtime", "UI", "build", "독립 code review"]
  },
  "producerDefects": "소유한 최종 검사에서 추가 결함을 발견하지 못했습니다.",
  "nextDependency": "Main의 coherent freeze 후 affected aggregate 실행과 독립 code review"
}
```
