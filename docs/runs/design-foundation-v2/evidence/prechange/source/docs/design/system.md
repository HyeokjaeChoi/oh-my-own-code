# oh-my-own-code 디자인 시스템 · ChatGPT-inspired Workbench Foundation

**상태:** 저장소 디자인 계약 · 2026-09-27  
**기준:** docs/runs/component-polish/plan.md (현재 컴포넌트 수정 작업계획 SSOT), docs/runs/chatgpt-foundation/plan.md (Foundation 결정 이력), docs/design/research/chatgpt-observations.md, 기존 docs/design/specs/workbench-ux.md.

## 방향과 근거의 한계

**조용한 대화 캔버스, 분명한 실행 근거.** 사용자는 여러 로컬 작업과 에이전트의 문맥을 읽고 도구 실행·권한 범위·검증 근거를 판단한다. 공개된 로그아웃 ChatGPT 화면에서 관찰한 좁고 조용한 탐색 영역, 넓은 대화 캔버스, 중앙의 둥근 작성기, 글자·여백 중심의 위계를 참고한다. 이 제품의 도구·권한·검증 화면은 자체 요구에 따라 설계하며 ChatGPT의 미관찰 인증 화면을 재현했다고 주장하지 않는다. 관찰 치수와 근거는 연구 기록에 있다.

중립색이 기본이다. 행동 강조는 짙은 중립색의 채운 버튼, 상태 강조는 필요한 위치의 의미색, 포커스는 접근성을 위한 파랑이다. 장식용 줄무늬·그라디언트·광채를 쓰지 않는다. 모든 메시지나 행에 테두리를 그리지 않는다. 면, 정렬, 여백과 글꼴 크기로 먼저 구조를 만든다. 테두리는 입력 경계, 실제 분리선, 포커스·오류·범위 확인 등 기능적 이유가 있을 때만 쓴다. 권한 결정·도구 실행·검증 결과는 서로 다른 단계이며 같은 성공 표시로 합치지 않는다.

현재 계약은 Light/Dark, 한국어 UI와 원문 명령·경로·코드, 웹의 여섯 기초 컴포넌트 계열을 다룬다. 계정·구독·결제는 현재 제품 범위 밖이다. 인증 누락과 실패는 런타임의 ‘외부 설정 필요’ / ‘인증 실패’ 상태로 드러낸다. 저장소에는 아직 실행 제품이 없으며 정적 미리보기는 제품 동작의 증거가 아니다.

## 원본과 동기화

docs/design/tokens/manifest.json이 값·타입·Light/Dark alias·CSS 이름·Figma 적용 의도의 원본이다. tokens/tokens.css는 validate_system.py::generated_css의 결정적 출력이다. docs/design/components.json은 여섯 계열, **44개의 정확한 variant**, 콘텐츠 제약과 상태별 token binding의 원본이다. **저장소 원본 → CSS / Figma 변수·스타일·컴포넌트**의 단방향 흐름이며 역방향 자동 동기화는 없다. Figma 변경은 원본 JSON을 다시 수정·검증한 뒤 반영한다. 현재 이 문서 변경만으로 Figma가 동기화된 것은 아니다.

각 token은 path, layer, type, value, css, figmaScopes를 갖는다. Primitive는 전역 raw 값이고 Figma picker에서 숨긴다. Semantic은 모드별로 primitive를 참조하고, Component는 semantic을 참조한다. 참조 문법은 {semantic.color.surface}다. 색상은 color variable, px 치수와 number는 수치 variable, 글꼴은 Figma의 family 이름으로 매핑한다. CSS는 px/ms를 보존한다. 현재 manifest는 **Primitive 61 / Semantic 65 / Component 37, 총 163개**다. Tokens Studio와의 값·참조 문법 호환은 의도이며 플러그인 import 성공을 뜻하지 않는다.

## 색, 면, 경계

| 역할 | Light | Dark | 사용 |
| --- | --- | --- | --- |
| semantic.color.canvas | #ffffff | #171717 | 중앙 대화 캔버스. 메시지는 기본적으로 이 면 위에 평평하게 놓는다. |
| semantic.color.surface.subtle | #fafafa | #3d3d3d | Light 탐색 부모면, Dark 선택 탐색 항목 또는 필요한 낮은 단계의 면. 전체 메시지 카드를 반복해서 채우지 않는다. |
| semantic.color.surface | #ffffff | #262626 | 작성기·입력·독립 컨트롤의 면. Dark 탐색 부모면과 기본 탐색 항목에도 사용한다. |
| semantic.color.text.primary | #171717 | #ffffff | 본문·제목·핵심 범위. |
| semantic.color.text.secondary | #555555 | #e8e8e8 | 메타데이터·보조 설명. |
| semantic.color.action.background | #171717 | #ffffff | 가장 중요한 확정 행동 하나. |
| semantic.color.focus | #0b5fc4 | #a9c9ff | focus-visible 링과 동등한 키보드 표시. |
| semantic.color.border.default | #767676 | #c6c6c6 | 입력·검증 가능한 구조 경계가 필요한 경우에만. |

이 값은 우리 제품을 위해 선택한 토큰이며 ChatGPT의 독점 토큰을 추출한 값이 아니다. 탐색 영역이 캔버스와 구분되도록 작은 명도 차이를 쓰고, 도구·권한 근거의 경계는 의미를 확인해야 할 때만 그린다. 테두리 token이 components.json에 결합되어 있어도 모든 인스턴스에 항상 stroke를 그리라는 뜻은 아니다. ToolCall의 요약 행은 평평하게 둘 수 있지만 원본/대상/결과를 접고 펼치는 독립 상세 영역은 범위를 드러낼 수 있다. PermissionRequest는 승인 대상·범위와 실행 결과를 혼동하지 않도록 독립 영역 경계를 허용한다. 위험·오류는 색뿐 아니라 텍스트, 아이콘, 결과 설명으로 구분한다.

검증기는 두 모드에서 주요 글자·행동·상태 전경/배경 4.5:1, 경계·포커스 3:1 이상을 검사한다. 기본 경계 token은 이 대비 기준을 지키므로 강하게 보일 수 있다. 그 때문에 경계 사용량을 줄이는 것이 중요하다. Disabled는 WCAG 대비 예외이지만 필수 정보를 흐린 색만으로 전달하지 않는다. 포커스 링은 표면색으로 된 2px 바깥 간격 뒤 2px 링을 두며, 상호작용 상태가 색 변화만으로 전달되지 않도록 한다.

permission.pending는 판단 대기, permission.denied는 거절 또는 정책 차단을 뜻하며 화면 문구에서 원인을 구별한다. verification.passed/failed/unknown은 실제 검증 결과의 분류다. PermissionRequest의 backend `applied`만 현재 요청 revision의 적용 영수증으로 확인된 경우 선택한 결정을 표시한다. 런타임 문구·상태·행동은 `components.json`의 `runtimeStateMap`에서만 가져오며, 각 visual variant의 sample label은 정적 시안 전용으로 제품 런타임에 표시하지 않는다. 승인 적용 확인은 도구 실행 완료가 아니다. `decision_sending`은 두 결정을 비활성화하고, dispatched 뒤 응답이 불명확하면 중립 `unknown`/“결정 상태 확인 필요”로 남긴다. 같은 요청을 자동 재전송하지 않는다. `denied`는 `USER_DENY`와 `POLICY_DENY` 원인을 각각 “사용자가 거절함”과 “정책에서 차단함”으로 표현한다. `expired`와 `cancelled`는 과거 요청의 종료 상태이며 새 응답을 허용하지 않는다. 전송 결과 오류가 side effect 없이 끝났더라도 같은 revision의 현재 `pending`을 다시 조회한 뒤에만 응답을 허용한다. 만료·취소·불명은 읽기 전용 상태 확인만 제공하며 새 pending이 관측된 경우에만 새 요청의 결정을 허용한다. ToolCall/success는 실행 계층이 완료를 확인한 뒤에만 사용한다. 연결 단절 후 확인하지 못한 구간은 성공으로 채우지 않는다.

## 글꼴, 공간, 형태

본문은 16/24px, 제목은 24/28px, 보조 설명은 13/20px, 레이블은 16/22px, 코드는 13/20px(크기/줄 높이)이다. 제목은 700, 레이블 500, 본문 400을 기본으로 한다. 공개 화면에서는 시스템 sans 계열이 관찰되었지만 정확한 폰트 파일과 Figma family는 확인하지 못했다. Figma에서 실제 제공되는 Noto Sans KR Regular/Medium/Bold를 디자인 대체 family로 유지한다. 결정적 CSS 생성기는 이 원시값을 -apple-system, BlinkMacSystemFont, system-ui, Segoe UI, Noto Sans KR, sans-serif stack으로 매핑해 웹에서 시스템 글꼴을 우선한다. Figma와 웹은 각 플랫폼의 글꼴 렌더링이 다르며 관찰 화면의 정확한 폰트 파일을 복제했다는 뜻이 아니다. 한국어 폴백과 줄바꿈은 두 화면에서 검토한다. 명령·경로·코드는 IBM Plex Mono 400과 monospace 폴백을 사용한다. 글꼴 라이선스나 배포 권한은 이 문서가 증명하지 않는다.

4px 배수의 여백을 사용한다. 컨트롤 간격 8px, 밀접한 관련 항목 12px, 패널 안쪽 16px, 큰 섹션 사이 32px를 출발점으로 삼는다. 일반 컨트롤 시각 높이는 40px이고 클릭/터치 대상은 최소 44×44px다. 컨트롤 radius 12px, 독립 상세 영역 16px, badge는 pill이다. 작성기는 내용과 조작을 하나의 둥근 표면에 담되 과한 그림자·중첩 테두리를 피한다. 그림자가 필요하면 실제 떠 있는 메뉴·오버레이의 깊이에 한정한다.

1280×720 공개 화면 관찰에서는 약 260px 탐색 영역과 약 770px의 중앙 작성기가 확인되었다. 이 치수는 **미리보기 비교 기준**이며 모든 화면의 고정폭이 아니다. 데스크톱에서는 탐색 너비를 약 260px에서 시작하고 대화 읽기 폭과 작성기 최대 폭을 약 770px로 맞춘다. 좁은 화면에서는 가용폭에서 안전 영역과 좌우 여백을 뺀 폭으로 줄인다. 긴 한국어 문장과 경로는 안전하게 줄바꿈하고 코드·경로는 선택과 전체 값 보기를 제공한다. 200% 확대에서 작성기·권한 범위·핵심 행동이 잘리면 실패다.

320–599px는 한 열, 탐색과 세부 정보는 별도 호출 가능한 패널로 전환한다. 600–899px에서는 세부 패널을 접고, 900px부터 병렬 패널을 허용하되 중앙 읽기 폭을 지킨다. 브라우저 safe area inset을 반영하며 오버레이가 현재 권한 대상과 승인 범위를 가리지 않게 한다. 설치형의 OS 메뉴·파일 선택기·알림·창 전환은 플랫폼 관례를 따르고 웹 탐색을 그대로 복제하지 않는다. 공유되는 것은 의미 token과 콘텐츠 계약이며 웹·모바일 내비게이션 구현은 별개다.

## 컴포넌트·상태·흐름

| 계열 | Variant | 적용 기준 |
| --- | ---: | --- |
| Button | 18 | primary/quiet/danger × default/hover/pressed/focus/disabled/loading. 한 영역의 주요 행동을 분명히 하고 중복 제출을 막는다. |
| Input | 5 | default/hover/focus/disabled/error. 레이블·40px 컨트롤·피드백 하나를 내용에 맞게 세로로 쌓는다. 오류 메시지가 일반 도움말을 대체하며 placeholder를 보조 문구로 반복하지 않는다. 포커스 링은 배치를 밀지 않는 외곽 오버레이이다. |
| StatusBadge | 6 | queued/running/waiting/success/error/unknown. 높이 24px, 글자 너비에 좌우 8px씩 더한 HUG 폭, 가운데 정렬 한 줄 레이블을 사용한다. ToolCall과 PermissionRequest 내부 상태도 같은 규격으로 맞춘다. |
| NavigationItem | 4 | default/hover/selected/focus. 부모 폭을 채우는 40px 행과 12px 시작 여백, 왼쪽 정렬을 사용한다. 선택 상태는 면 색과 700 weight 레이블(기본 500 weight)로 표시하고 현재 위치는 aria-current로 나타내며 실행 성공과 혼동하지 않는다. |
| ToolCall | 6 | queued/running/waiting/success/error/unknown. 기본 요약은 테두리 없이 도구와 문자 상태를 먼저 보여 준다. 펼친 상세 영역만 실제 그룹 경계가 필요할 때 기능적 테두리를 쓸 수 있다. 로컬 펼침 동작과 런타임 결과로 이동하는 근거 링크는 별개이다. 유효한 결과 대상이 없으면 비활성 안내를 표시한다. 각 상태는 `StatusBadge` 인스턴스를 중첩하며 배지 자체가 치수와 색 토큰을 소유한다. |
| PermissionRequest | 5 | pending/sending/approved/denied/stale. 권한 대상·정확한 범위만 절제된 경계로 묶고 세션·요청·능력·범위·대상·기간·결과를 보인다. 허용은 기존 primary Button, 거절·새로고침은 기존 quiet Button을 합성한다. 각 상태는 `StatusBadge` 인스턴스를 중첩해 공통 치수와 자체 색 토큰을 사용한다. 40px 시각 버튼을 유지하되 제품 구현에서는 44px 이상 실제 조작 영역을 배정한다. Figma만으로 실제 조작 영역을 검증했다고 주장하지 않는다. |

입력 필드 그룹은 고정 높이로 자르지 않는다. 레이블, 40px 컨트롤, 피드백 슬롯 하나를 세로로 두고 내용이 없으면 슬롯도 표시하지 않는다. error+focus는 오류 테두리·오류 설명·`aria-invalid`를 유지하며 같은 컨트롤 바깥에 focus-visible 링을 겹친다. 이 링은 레이아웃 폭이나 높이를 바꾸지 않는다.

상태 배지는 단일 줄의 보이는 텍스트를 필수로 한다. 너비는 실제 글꼴 렌더링 폭에 좌우 8px씩 더해 결정하고 레이블이 길어져도 고정 폭으로 남는 공간을 만들지 않는다. ToolCall과 PermissionRequest는 별도 색 프레임을 만들지 않고 실제 StatusBadge 인스턴스를 중첩한다. 배지는 명시적인 label과 의미 tone을 받으며 배지 자신의 배경·전경 바인딩을 사용한다. 상태색 외에 텍스트를 유지한다. 적용 영수증을 받은 PermissionRequest의 `approved` display variant는 neutral/info tone을 사용하고 사용자가 선택한 결정(허용 또는 거절)을 구체적인 레이블로 적는다. 권한 결정이 적용됐다는 사실은 도구나 세션 작업 완료를 뜻하지 않는다.

선택 내비게이션이 기본·hover와 실제 면에서 구별되는지 Light/Dark 부모 표면 위에서 함께 확인한다. Dark 탐색 부모면과 기본 항목은 `surface #262626`, hover는 `canvas #171717`, selected는 `surface.subtle #3d3d3d`를 사용한다. 기본 항목은 부모면과 같고 hover·selected는 부모면 및 서로와 구별된다. 이 모드별 바인딩은 NavigationItem에만 적용하며 전역 semantic 값은 바꾸지 않는다. 기본과 hover 레이블은 500 weight, selected/current 레이블은 700 weight를 사용한다. focus는 겹쳐진 기본 또는 선택 상태의 weight를 보존하며 배치를 바꾸지 않는다. 선택은 기본 500 대비 700 weight 레이블로도 구별하고 장식용 줄무늬를 추가하지 않는다. selected+focus는 선택 색·700 weight 글자·`aria-current="page"`를 유지하고 외곽 focus-visible 링을 겹친다.

ToolCall 요약에는 공통 바깥 테두리를 반복하지 않는다. 도구명, 문자 상태, 출처·대상·결과의 정보 위계를 유지한다. 모든 상태는 보이는 자식에 맞춰 세로로 늘어나고 마지막 자식 뒤에 16px 하단 여백을 유지한다. 표시 대상과 입력의 `path`는 모든 상태와 Light/Dark 예시에서 정확히 같아야 하며 긴 경로는 자르지 않고 줄바꿈한다. 접기/펼치기는 별도 키보드 동작과 확장 의미를 가지며, 실제 런타임 결과로 이동하는 행동은 유효한 runtime-provided 결과 대상이 있을 때만 보인다. 디자인 예시의 근거 링크는 로컬에 존재하는 예시만 사용하고 `#` 또는 가짜 URL을 만들지 않는다. 상세 입력/출력은 민감 정보를 마스킹하며 알 수 없는 schema는 안전한 일반 텍스트로 표현한다.

PermissionRequest의 backend 상태·원인·receipt 대 UI copy/행동 매핑은 `components.json`의 `componentContracts.PermissionRequest.runtimeStateMap`이 필수 단일 기준이다. 다섯 visual variant의 sample label은 정적 미리보기 전용이며 런타임 표시값으로 사용할 수 없다. 런타임 레이블과 행동은 상태·선택 결정·거절 원인·현재 revision·적용 receipt에 맞춰 이 맵에서 정한다. 기존 5개 시각 variant를 재사용한다.

| Backend 상태 / 근거 | 시각 variant 및 레이블 | 행동 |
| --- | --- | --- |
| 현재 revision의 `pending` | pending · 승인 대기 | primary 허용 + quiet 사용자 거절. 정책 차단이면 허용 없음 |
| `decision_sending` | sending · 결정 전송 중 | 중복 결정을 막기 위해 양쪽 비활성화 |
| 일치하는 적용 영수증의 `applied` | approved · 허용 결정 적용 확인 또는 거절 결정 적용 확인 | 결정 버튼 없음. 실행 결과와는 별도 |
| `denied` + `USER_DENY` / `POLICY_DENY` | denied · 사용자가 거절함 / 정책에서 차단함 | 결정 버튼 없음; 정책 차단은 허용 불가 |
| `expired` / `cancelled` | stale · 요청 만료됨 / 요청 취소됨 | 과거 요청 재응답 없이 읽기 전용 재조회 |
| `unknown`, 오래된 revision, 전송 뒤 불명 | stale · 결정 상태 확인 필요 | 읽기 전용 대조. 같은 결정을 다시 보내지 않음 |
| 전송 실패 + `effectState=none` | 같은 revision의 새 조회가 pending이면 pending, 아니면 stale | 최신 pending을 확인하기 전까지 결정을 보내지 않음 |

적용 영수증은 사용자가 선택한 결정을 반영해야 하며 `accepted`/HTTP 202는 적용 근거가 아니다. `dispatched` 뒤 응답이 불확실하면 `unknown`으로 유지한다. 280px 폭에서 정확한 경로·범위를 줄이지 않고 필요하면 행동을 아래 행으로 쌓는다. 기존 Button은 시각 높이 40px을 유지하며 실제 조작 영역은 최소 44px 높이, 서로 최소 8px 간격이다. 중첩된 별도 focusable wrapper를 만들지 않는다. Figma는 이 런타임 조건의 증거가 아니다.

`components.json`의 `composedStates`는 독립된 Variant 수를 늘리지 않고 겹치는 상태를 정의한다. 오류 입력에 `focus-visible`이 오면 오류 테두리·설명·`aria-invalid`를 유지한 채 바깥 포커스 링을 더한다. 선택된 탐색 항목이 키보드 포커스를 받으면 선택 면·글자와 `aria-current="page"`를 유지한 채 같은 링을 더한다. Figma 컴포넌트 설명과 실제 화면 검수에서도 두 조합을 확인한다.

빈 대화는 다음 동작을 제안하되 전송·실행을 가장하지 않는다. 로딩은 대상과 현재 단계를 알리고, 오류는 원인·영향·이미 일어난 부작용·안전한 재시도 조건을 알린다. 권한 요청은 보이는 범위와 현재 세션을 확인한 뒤 응답하게 한다. `decision_sending`은 결정 전송 중, `applied`는 영수증을 확인한 선택 결정 적용, `USER_DENY`는 사용자의 거절, `POLICY_DENY`는 정책 차단, `expired`와 `cancelled`는 종료 요청, `unknown`은 결정 효과 확인 필요로 표시한다. 전송 뒤 unknown은 승인/거절 버튼을 숨기며 최신 상태 조회만 허용한다. 실행 결과는 별도 ToolCall로 나타낸다. 등록되지 않은 도구 schema는 안전한 일반 표현을 사용한다. 알 수 없는 결과는 ‘확인할 수 없는 구간’, 제공되지 않은 사용량은 ‘정보 없음’이라고 적는다.

Tab 순서는 전역 탐색→작업 헤더→대화/작성기→활성 세부 패널이다. Inline 권한 영역은 일반 Tab 흐름에 남고 초점을 가두지 않는다. 별도 모달일 때만 제목으로 초점을 옮기고 trap/복귀를 적용한다. 패널을 닫으면 열었던 컨트롤로 초점을 돌려준다. Esc가 실행 취소 또는 권한 거절이 되어서는 안 된다. Hover는 포인터 보조 피드백이며 모든 기능이 키보드·터치로 가능해야 한다. 스크린리더 알림은 권한 대기·중단 확인·완료·실패·연결 복구처럼 의미가 바뀔 때 작업 식별자를 포함해 간결하게 전한다. 스트리밍 토큰마다 대화 전체를 다시 읽지 않는다.

## 움직임과 검증

primitive.motion.fast 120ms는 hover/focus, standard 180ms는 상태·상세 내용 변화, panel 240ms는 패널 등장에 쓴다. 확인된 도구 결과의 상세 영역은 180ms 동안 opacity 0→1과 4px 이내의 이동으로 나타날 수 있다. 애니메이션만으로 실행 완료를 암시하지 않는다. prefers-reduced-motion: reduce에서는 변위·반복을 제거하고 상태 문구는 유지한다.

python3 docs/design/validate_system.py는 token 타입·모드·참조 누락/순환/계층·중복 이름·CSS 일치·대비·정확한 44 variant를 검사한다. 이 검사는 문서와 색 대비의 정적 조건을 확인하며 렌더 결과나 Figma 실제 바인딩을 증명하지 않는다. 독립 design_spec_reviewer의 계약 검토와 coordinator의 handoff 후에 이 원본을 미리보기와 Figma에 적용한다. 이후 실제 UI는 키보드, 스크린리더, 반응형, 축소 동작을 별도 실측한다.

## 결정 기록과 마이그레이션

| 날짜 | 결정·근거 | 영향 |
| --- | --- | --- |
| 2026-09-26 | 승인/실행/검증을 분리하고 stale 권한 행동을 비활성화 | PermissionRequest, ToolCall, StatusBadge 의미와 런타임 연결 유지 |
| 2026-09-27 | 공개 로그아웃 화면의 대화 중심 구조와 사용자의 선택을 반영해 중립 Light/Dark로 이동 | 기존 파란 행동색은 중립 채움으로, 푸른 회색 면은 무채색으로 갱신; focus/info의 파랑은 유지 |
| 2026-09-27 | 본문 16px·제목 24/28px 및 넓은 중앙 작성기 기준 채택 | 이전 14px 본문·20px 제목을 쓰는 미리보기/텍스트 스타일 재검토; 웹 시스템 서체와 Figma Noto Sans KR의 줄바꿈·높이 확인 |
| 2026-09-27 | 장식 줄무늬와 반복 카드·경계를 제거하고 경계를 상태/구조에 한정 | components.json의 경계 binding은 유지하되 각 렌더러가 stroke 표시 조건을 명시해야 함 |
| 2026-09-27 | 저장소 JSON 원본, CSS/Figma 단방향 산출 | Figma Light/Dark 변수, 타입 스타일, 버튼·입력·탐색·도구·권한 컴포넌트 색/크기 재동기화 필요; 라이브러리 발행 별도 |

designlang이 차단 페이지에서 생성한 수치는 이 결정을 뒷받침하지 않는다. 연구 폴더의 README를 먼저 읽고 해당 산출물을 제품 디자인 근거로 쓰지 않는다.
