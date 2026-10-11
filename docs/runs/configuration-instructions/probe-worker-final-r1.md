`untrusted` fixture와 hidden UI 검사를 추가하고 다시 freeze했습니다.

- trust 안내와 세 동작 비활성 상태를 검사합니다.
- 저장된 metadata를 현재 Native 관측으로 표시하지 않는지 검사합니다.
- 자동 entry 읽기·변경 0회와 `narrow 200%` 프레임을 추가했습니다.
- **Node 87/87 PASS**, 7개 파일의 문법·ESLint·Prettier PASS.
- 실제 hidden UI/runtime 실행은 Main에 남아 있습니다.

변경된 SHA-256입니다. 나머지 4개 파일은 이전 hash와 같습니다.

| 파일 | SHA-256 |
|---|---|
| `fixtures/workbench-host.mjs` | `87e990e5a6dc76bdcc5fcee0f94ef4015c035576aa6070325c81ab40610496df` |
| `fixtures/workbench-host.test.mjs` | `34887ef223791c0622c651a2bf2a244bd737a08b37777968329ee7924aad8027` |
| `e2e-workbench-states.mjs` | `ea9b601718f53ffe77fb8f45274b4cc8d49a9ce4d9790fac17fb38bda61a3e3c` |
