# 비교 화면 구현 결과

2026-10-03 · Plan revision 1 · D1/D2 수정 파일 고정 · 새 독립 review 대기

진입 파일은 `preview/index.html`입니다. 로컬 서버 주소는 `http://127.0.0.1:4187/preview/index.html`입니다. `?app=1&candidate=A&scene=empty&theme=light`로 App only 화면을 엽니다. `candidate=A|B|C`, `scene=empty|conversation|permission|artifact`, `theme=light|dark`, `view=screen|foundations|components`, `family=<32 family key>`를 사용할 수 있습니다.

## 구현 범위

- A Quiet Dock: 216px sidebar, 44px header, 가운데 empty composer, 대화 하단 dock.
- B Threadline: 200px sidebar, 40px header와 32px context bar, 대화 뒤 한 개의 composer, 작성으로 이동.
- C Rail Workbench: 56px rail, 256px modal session drawer, 40px header, 경계선 한 개의 하단 shelf.
- 공통 한국어 fixture와 읽기 전용 TypeScript 예시. 네 scene, Light/Dark, Foundations, 32 component family의 계약된 상태를 표시합니다.
- 후보/scene/theme/view 선택, 검색 filter, session 선택, agent/model 메뉴, slash draft 삽입, tool disclosure, drawer, 설명 dialog, Browser/Terminal/File tab, inspector 닫기와 pointer/keyboard resize가 로컬 UI로 연결됩니다.
- draft는 같은 후보에서 scene을 바꿔도 유지됩니다. 후보마다 draft를 따로 유지합니다. 첨부 예시는 외부 control에서 추가하거나 chip에서 제거합니다.
- 보내기, 중지, 권한 응답, 세션/작업 공간 효과, 연결/설치, 복사는 실행 성공을 만들지 않습니다. 설명 dialog에 실행 요청을 보내지 않았다고 표시합니다. 파일 선택, upload, backend, filesystem 접근이 없습니다.
- 메뉴 Arrow/Home/End, Tab dismiss, Escape return, dialog/drawer Tab trap과 focus return, artifact tab Arrow/Home/End, resize Arrow/Home/End를 구현했습니다. 좁은 inspector overlay는 배경 main/navigation을 inert 처리합니다.
- 600px 미만 pane에서는 context를 설정/Context control로 모읍니다. 900px 미만 stage에서는 sidebar를 숨기고 inspector를 별도 pane으로 표시합니다. C rail은 600px 미만에서 header 탐색 control로 바뀝니다.

## 기존 구현의 실제 확인 결과 (수정 전 증거)

`evidence/capture-metrics.json`: Chromium, 전용 `omoc-compact-preview-worker` session, headless, viewport 1280×800, DPR1, visualViewport.scale1. 3 후보 × 4 scene × 2 theme = 24개 실제 screenshot을 저장했습니다. 각 stage는 1280×800이고 transform은 none입니다. 선택된 contract의 sidebar/header/inspector 값과 같았습니다.

| 실제 composer geometry | A | B | C |
| --- | --- | --- | --- |
| 한 줄 shell | 72 | 52 | 68 |
| 세 줄 input | 72 | 72 | 72 |
| 세 줄 shell | 120 | 92 | 108 |
| 세 줄 + attachment shell | 160 | 132 | 148 |
| Send target | 32 | 32 | 32 |

`evidence/interaction-observations.json`: 실제 keyboard를 사용해 C drawer 검색에서 로컬 세션만 남는 것, Escape 후 session title focus, agent menu ArrowDown/Enter 선택, dialog Escape 후 Send focus를 관찰했습니다. 합성 composition event 동안 Enter로 dialog가 열리지 않았습니다.

A/B/C의 권한 card는 1280×800, 640×800, 320×640, 1280×440에서 초기 settled scroll 후 전부 보입니다. scope와 거절 warning을 유지합니다. 640/320/짧은 높이의 screenshot 9개를 저장했습니다. document 가로 overflow는 없습니다. B의 짧은 화면에서는 composer 끝부분에 스크롤로 접근합니다. 이는 document-flow 후보의 동작입니다.

실제 DOM에서 모든 후보의 32 family를 순회했습니다. family마다 선언된 state 수와 rendered specimen 수가 같습니다. 추가 gallery capture는 Foundations, composer, permission, navigation, extensions 다섯 개입니다. 모든 family의 screenshot을 만들지는 않았습니다.

`node --check preview/app.js` 통과. `node preview/validate.mjs` 통과: 475 token, 6 candidate/mode, 2850 resolved 값, 32 family, 23 설치된 Lucide source icon, 오류 0. 이는 source parsing/inventory입니다. 제품 test suite를 실행하지 않았습니다. 생성된 palette를 따로 만들지 않았고 remote dependency를 사용하지 않습니다.

## 한계와 다음 작업

실제 한국어 IME 입력은 확인하지 않았습니다. composition event-path만 확인했습니다. native browser 200% zoom, forced-colors, reduced-motion emulation, screen reader는 실행하지 않았습니다. 해당 CSS와 IME guard는 구현했습니다. 640px 유효 폭의 reflow를 실제로 확인했지만 이를 native 200% zoom 검증이라고 부르지 않습니다.

pointer/keyboard inspector resize, artifact tab 이동, 모든 gallery state의 접근성은 구현되어 있으나 각각의 실제 입력 동작을 전부 관찰하지 않았습니다. 캡처와 작성자의 관찰은 독립 rendered review 또는 code gate가 아닙니다. 자체 승인하지 않았습니다. Figma 또는 앱 source를 수정하지 않았습니다.

기존 전용 browser session은 종료했습니다. 아래 수정 증거와 현재 source hash를 사용해 새 독립 reviewer가 판단해야 합니다.


## D1/D2 수정과 현재 확인 결과

D1: textarea의 `outline:none!important`를 제거했습니다. 실제 textarea에 선택된 후보/theme의 focus token으로 2px outline과 2px offset을 표시합니다. C의 resting shelf에는 기존 borderless 구조를 유지합니다.

D2: Composer 상태를 실제 textarea, Send/Stop, agent/model/Context button과 설명에 적용했습니다. sending/unknown/stale의 Send를 disabled 처리합니다. stopping의 Stop은 disabled이며 중지 응답 대기 이유를 연결합니다. running/stopping/sending에서는 context 선택을 disabled 처리합니다. archived textarea는 disabled가 아닌 read-only입니다. error는 실제 `::before` edge에 resolved `component.field.invalidBorder`를 적용하고 textarea의 `aria-invalid`와 고유 `aria-describedby`로 구체적인 오류를 연결합니다. C의 error edge도 표시합니다. Unknown은 초안을 유지하며 Enter로 다시 실행하지 않습니다. error + focus specimen은 실제 Composer를 사용합니다.

`repair-check.py`를 실제 설치된 agent-browser CLI로 실행했습니다. 전용 session은 `omoc-preview-repair-worker`이며 종료했습니다. Chromium, headless, DPR1, CSS scale1입니다. browser 관찰 28개 그룹을 `evidence/repaired-observations.json`에 저장했습니다.

- A/B/C 모두 실제 Tab 또는 Shift+Tab으로 textarea focus-visible, 2px outline, 2px offset을 확인했습니다. 기본 shell은 72/52/68px입니다.
- 세 줄 shell은 120/92/108px, 세 줄+첨부는 160/132/148px입니다. 최대 input은 144px이고 최대+첨부 shell은 232/204/220px입니다. overflow는 auto입니다.
- A/B/C × Light/Dark의 실제 내부 disabled/read-only, Stop label, busy 상태, 설명 연결, error pseudo-element의 computed color를 확인했습니다. Unknown과 archived에서 실제 Enter를 눌러 실행 dialog가 열리지 않는 것을 확인했습니다. Unknown draft는 유지됐습니다.
- A/B/C selected + focus는 `aria-current=page`와 2px/2px outline을 함께 유지합니다. Composer error + focus는 실제 textarea의 오류 상태와 focus, error edge 및 설명을 유지합니다.
- `node --check preview/app.js` 통과. `node preview/validate.mjs` 통과: 475 token, 6 candidate/mode, 2850 resolved 값, 32 family, 23 local icon, 오류 0. 현재 결과는 `evidence/static-validation.json`에 있습니다.

새 screenshot은 `evidence/repaired-C-textarea-focus-light.png`, `repaired-C-textarea-focus-dark.png`와 `repaired-A|B|C-composer-states-light|dark.png`의 총 8개입니다. C focus는 1280×800입니다. Gallery는 상태를 실제 크기로 모두 표시하기 위해 1280px 폭과 더 긴 viewport를 사용했습니다. Gallery image는 1280×800 App screenshot 검증을 대신하지 않습니다. 크기와 hash는 `evidence/repaired-capture-binding.json`에 있습니다.

기존 38개 screenshot은 변경하지 않았습니다. 이 파일은 수정 전 증거입니다. `evidence/historical-capture-binding.json`에 기존 source hash와 38개 image hash/크기를 보존했습니다. 기존 증거를 현재 D1/D2의 검증으로 사용하면 안 됩니다. 수정 후 전체 scene/reflow/menu/IME 관찰을 다시 실행하지 않았습니다. 이전 관찰과 현재 증거의 binding 한계를 구분합니다.

현재 구현/검사 script hash는 `evidence/source-sha256.json`입니다. 물리적 한국어 IME, native 200% zoom, forced-colors, reduced-motion, screen reader는 이번 수정에서도 확인하지 않았습니다. 수정은 preview 경로에만 있습니다. Production/Figma/ledger는 변경하지 않았고 새 dependency를 추가하지 않았습니다. 작성자의 수정과 관찰은 독립 승인으로 간주하지 않습니다. 새 독립 code/render review가 다음 단계입니다.
