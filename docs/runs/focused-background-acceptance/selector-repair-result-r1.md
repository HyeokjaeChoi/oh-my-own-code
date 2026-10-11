수정을 완료했습니다. **Source-complete checkpoint**입니다.

- 변경 파일: `apps/desktop-app/scripts/e2e-workbench-states.mjs:1158`
- 중단 접수 문구로 `status`를 선택합니다. 단일 요소와 표시 여부를 확인합니다.
- 두 `status`와 기존 검사를 유지했습니다. 다른 `status` selector는 범위가 지정되었거나 복수 요소 관찰용입니다.
- packet의 plan·contract·profile·skill hash가 일치합니다.
- 기존 r2 실패 로그를 보존했습니다.

실행한 검사: 모두 **exit 0**입니다.

```text
node --check apps/desktop-app/scripts/e2e-workbench-states.mjs
pnpm exec eslint --config apps/desktop-app/eslint.config.mjs apps/desktop-app/scripts/e2e-workbench-states.mjs
pnpm exec prettier --check apps/desktop-app/scripts/e2e-workbench-states.mjs
```

변경 파일의 SHA-256:

```text
511340b6b12321dab162ff1260a580793f9a3fbcd7d8f06fc4aea814a07e7852
```

Native 실행, activation, build, delegation, ledger·report 쓰기는 수행하지 않았습니다. 실제 UI 통과는 아직 미확인입니다. 다음 단계는 main의 source freeze, hidden native 검사와 독립 review입니다.
