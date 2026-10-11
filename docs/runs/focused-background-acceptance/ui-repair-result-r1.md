# Fresh bounded UI repair

Child 01a104a2-11cc-7862-8e67-cedc201f7b57 Euclid. Requested Sol/medium, not runtime attestation. Implementation result, not independent gate.

수정을 완료했습니다. 변경 파일은 두 개입니다.

- `/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/renderer/widgets/conversation/index.tsx`
- `/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/renderer/pages/workbench/index.tsx`

**중지 정책:** 연결됨, 유효한 대상, `running`, 비보관, 비대기 상태에서만 중지합니다. 버튼과 runtime `onCancel`에 같은 조건을 적용했습니다. 연결된 실행은 이전 전송 결과가 `unknown`이어도 중지할 수 있습니다.

**접근성:** 현재 세션 기록에 `role="log"`와 `aria-busy`를 추가했습니다. 기록은 `aria-live="off"`로 두고, 짧은 상태 문구만 `polite`로 알립니다. 토큰마다 알리지 않으며, `idle`을 완료로 표현하지 않습니다. [W3C ARIA23](https://www.w3.org/WAI/WCAG21/Techniques/aria/ARIA23)을 참고했습니다.

**실제 검사:**

- Desktop TypeScript: 통과.
- 변경 파일 ESLint·Prettier: 통과.
- Renderer 경계: 통과 — source 43개, negative fixture 68개, positive fixture 16개.
- 기존 `workbench-projection.test.mjs`와 `workbench-store.test.mjs`: **47/47 통과**.

CSS, store, controller, DTO, 의존성, 검사 스크립트, ledger, 보고서는 수정하지 않았습니다. archived readOnly, drafts, IME, 메뉴, permission, selectedA 배치 코드도 유지했습니다.

Native·GUI·build는 실행하지 않았습니다. 실제 중지 callback, live DOM, 배치 및 OS screen-reader 출력은 후속 검증 대상입니다. 두 writer 완료 후 main의 통합 build와 독립 검토가 필요합니다. 최종 승인은 수행하지 않았습니다.
