# Workbench desktop design foundation v2

**설계 계약 채택: 2026-10-09 KST. 구현·렌더 검증 진행 중.**

현재 원본은 [design-v2](../runs/design-foundation-v2/design-v2.md)와 [실행 계획](../runs/design-foundation-v2/plan.md)이다. 최초 PLAN과 DESIGN_SPEC 독립 검토를 통과했다. 이 문서와 토큰 변경만으로 실제 UI 완료나 RENDER 통과를 뜻하지 않는다. 이전 Foundation의 실행 전 설명·치수·개수는 현재 계약으로 대체한다. 이전 원본은 해당 run의 prechange source에 보존했다. 기능·권한·영수증·복구 계약은 변경하지 않는다.

## 제품 원칙

**대화가 중심이고, 도구는 현재 작업의 문맥에서 연다.** 사용자는 로컬 코드 작업의 요청, 진행, 결과와 실행 근거를 읽는다. 기본 화면에서 전체 관리 기능을 해석할 필요가 없어야 한다. 시스템 sans, 중립색, 글자와 간격으로 위계를 만든다. 장식용 그라디언트·광채·유리 효과는 쓰지 않는다.

[실제 레퍼런스 조사](../runs/design-foundation-v2/reference-audit-r1.md)는 Claude Desktop, ChatGPT Web/Mobbin Desktop viewport, 공식 Desktop 이미지와 Refero 공개 미리보기의 확인 범위를 구분한다. Mobbin viewport를 네이티브 앱으로 부르지 않는다. 미관찰 메뉴·전환이나 독점 토큰을 재현했다고 주장하지 않는다. 이전 공개 제품 스크린샷은 최신 구현 증거가 아니다.

## 영역과 정보 계층

| 영역      | 맡는 일                                         | 기본 노출                               |
| --------- | ----------------------------------------------- | --------------------------------------- |
| 탐색      | Workspace 선택, 새 세션, 검색, 최근 세션        | 현재 위치와 작업 시작; 관리는 보조 메뉴 |
| 대화      | 메시지, 도구 실행, 권한 요청, 결과              | 주 읽기 영역                            |
| Composer  | 메시지 작성, 간단한 선택/첨부 요약, 전송·중단   | 가장 가까운 주 행동 하나                |
| 문맥 작업 | 요청 설정, 첨부 조사, 분기 준비, 현재 실행 요청 | 명시적으로 열며 Composer form 밖에 배치 |
| 상세 패널 | 파일·변경·설정·활동                             | 현재 작업에 필요한 경우만 열기          |

설정 필드, 파일 경로 조사, 대기열 관리는 입력창 안에 쌓지 않는다. 첨부명·상태와 요청값 요약은 접힌 상태에서도 알 수 있어야 한다. version/hash/전체 출처는 선택 가능한 상세 정보로 제공한다. **오류·만료·unknown·전송 차단·신뢰/복구·권한 판단을 접힌 상세 안에만 숨기지 않는다.** 요청값과 Native 보고값은 서로 다른 근거다.

분기 준비를 열면 경계, 편집 입력, 생성·닫기가 먼저 보이고 해당 작업으로 포커스가 이동한다. 파일 확인과 현재 실행 제어는 별도 작업이다. 분기는 자동 전송이나 파일 복원이 아니다. 닫기·접기·Escape는 작성 내용을 버리거나 요청을 재실행하지 않는다.

## 토큰 원본과 표현

manifest.json이 원본이며 tokens.css는 validate_system.py::generated_css의 결정적 출력이다. Primitive → Semantic → Component 참조 방향을 유지한다. 현재 토큰은 223개(Primitive 81, Semantic 85, Component 57)다. components.json의 기존 6계열/44 variant와 PermissionRequest.runtimeStateMap은 유지한다. 새 앱 조합 규칙은 compositionContracts로 구분한다. Figma 동기화는 실행하지 않았다.

| 항목      | 규칙                                                                                  |
| --------- | ------------------------------------------------------------------------------------- |
| 면        | Light #ffffff/탐색 #fafafa; Dark #171717/탐색 #262626                                 |
| 글자      | 기본 #171717/#ffffff; 보조 #555555/#c6c6c6                                            |
| 강조      | 주 행동은 역상 중립색; 상태 의미색과 키보드 포커스 파랑은 역할별 사용                 |
| 글꼴      | 기존 시스템 sans와 한국어 fallback; 코드·경로는 기존 monospace; 새 font 다운로드 없음 |
| 크기      | 대화16/24, UI14/20, 보조13/20, 작은 label12/18, section16/24, 빈 화면 제목22/28       |
| 간격      | 4/8/12/16/24/32; 관련 조작8, 패널 안쪽16, 작업 그룹24                                 |
| 형태      | 컨트롤8, 묶음12, Composer24; 그림자는 실제 overlay에만 필요할 때                      |
| 폭        | 읽기 최대768; 탐색256; gutter24. 좁은 화면에서 가용폭에 맞춤                          |
| 조작 영역 | dense desktop32, standard40, coarse44. 권한 결정 버튼44 및 사이 간격8 유지            |

본문·행동 전경/배경 대비4.5:1, 실제 입력 경계와 포커스3:1 이상을 검증한다. 강한 입력 border를 모든 행과 그룹에 반복하지 않는다. 장식용 구분선은 조작 경계를 대신하지 않는다. Disabled 정보도 필요한 차단 사유를 보이는 문구로 설명한다.

## 공통 제어와 상태

`@workbench/ui`의 Button은 native button의 event/ref/disabled/type을 유지하는 state-free primitive다. intent는 primary/secondary/quiet/danger, size는 compact/standard다. 기본 type은 button이다. 효과의 허용·중복·unknown 판단은 기존 도메인 소유자에게 남는다. 기존 ActionMenu/ModalSheet/StatusBadge와 Tool UI를 재사용한다. 전역 descendant button 스타일로 라이브러리 내부를 덮지 않는다.

Primary는 현재 작업의 확정 행동 하나다. Secondary는 해당 작업의 조정, quiet는 탐색·펼침·메타데이터, danger는 실제 위험 행동에만 쓴다. 로딩은 반복 제출을 막고 레이블을 보존한다. 선택·hover·focus는 구별되며 focus는2px 링과2px 간격으로 reflow 없이 표시한다. Icon-only 제어에는 접근 가능한 이름이 필요하다.

권한 적용은 실행 완료가 아니다. PermissionRequest의 실제 레이블·행동은 components.json의 runtimeStateMap에서 가져온다. 현재 revision pending만 결정 가능하며, 정책 거절은 UI가 해제하지 않는다. 일치하는 적용 receipt만 허용/거절 적용을 확인한다. unknown/만료/취소는 같은 요청을 재전송하지 않는다. 대기열 취소 ACK는 취소 요청의 수락이며 비실행 보장이 아니다. 복구·held 상태에서도 허용되는 inert 초안 편집과 탐색을 유지한다.

## 반응형과 검증

900px 이상은 중앙 읽기 폭이 유지될 때 선택 상세 패널을 병렬 표시한다.600–899px는 기존 좁은 상세 화면,320–599px는 단일 주 화면과 호출 가능한 탐색/상세를 사용한다. 항상 돌아오는 경로와 포커스 복귀가 있어야 한다.200%에서 실제 선택값·범위·최종 전송/중단을 확인한다. 긴 한국어·코드·경로는 선택과 전체 값 확인이 가능해야 한다.

Tab/ShiftTab, Enter/Space 펼침, Escape 복귀, IME·Enter/ShiftEnter 작성 동작을 보존한다. 닫힌/inert 영역에는 포커스가 들어가지 않는다. Reduced motion에서 불필요한 전환은 제거한다. 관찰 상태를 매 poll마다 live region에 반복하지 않는다.

변경한 기존 Context/runtime-options assertion을 최종 build에서 실제 실행한다. Foundation 기본/첨부/상세/분기/실행/unknown·held 화면을 원본 native PNG로 확인한다. Source/build/script 전후 hash와 소유 hidden-window 종료를 기록한다. Geometry 통과는 디자인 통과가 아니다. 독립 CODE와 실제 RENDER에 미해결 주요 문제가 없어야 foundation을 완료로 부른다. Synthetic Main은 Native/provider/Windows 실행 근거가 아니다.
