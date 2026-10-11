# 실제 화면 비교: OhMyOwnCode / ChatGPT / Claude

검사일: 2026-10-09. 방식: Computer Use의 실제 화면 및 접근성 트리 확인. 읽기 전용 비교. 제품 코드 수정이나 독립 승인 보고서가 아니다.

## 판단

현재 OhMyOwnCode의 디자인을 seamless하다고 판정할 수 없다. 기능 검증과 화면의 사용성 판단을 분리해야 한다. 최신 첨부 펼침 상태에서 Composer가 메시지 작성, 파일 조사, 검증 설명, 실행 관리까지 맡아 작업의 우선순위가 흐려진다. 기본 상태 전체가 항상 펼쳐져 있다는 뜻은 아니다.

## 확인한 출처와 한계

| 출처 | 실제 확인 | 한계 |
| --- | --- | --- |
| https://stack-line.dev/#work | 게시된 제품 스크린샷의 사이드바와 작업 공간/세션 제어 | 최신 Context 빌드와 다른 이전 화면. 현재 구현의 증거로 사용하지 않음 |
| 실행 중인 OhMyOwnCode | 임시 bootstrap 안내 화면 | 최신 workbench 화면이 아님. 새 production Main 실행 없음 |
| 최신 Context 원본 PNG | 아래 2개 원본의 첨부/미리보기 펼침 상태 | 전체 상태나 전환 동작을 이 두 장만으로 단정하지 않음 |
| Claude Desktop | 로그인된 새 대화 화면, sidebar, Composer, 모델/모드 제어 | 첨부 메뉴가 실제 열린 상태는 확인하지 못함. 기존 대화 열람/프롬프트 전송 없음. 개인 기록 제목 보존하지 않음 |
| https://chatgpt.com/ | 실제 Web 새 대화 및 + 메뉴 | 네이티브 Desktop 동작의 증거가 아님 |
| https://chatgpt.com/ko-KR/download/ | 공식 Desktop 페이지와 공개 이미지 | 홍보 이미지. 설치된 앱의 전체 흐름 검증이 아님 |
| https://mobbin.com/screens/44ae986b-cc6f-412f-a5db-bd13f0842f9c?section=key_screens | ChatGPT Web 전체 화면, 1512×945 | Mobbin의 Desktop은 viewport 분류. 네이티브 macOS 앱으로 부르지 않음. 다른 highlight 동영상은 재생 불가 |
| https://refero.design/search?query=Claude | 공개 Claude light/dark 미리보기; 앞선 ChatGPT 검색의 홈/설정/대화 미리보기 | 상세 화면은 로그인 제한. 전체 흐름 검사라고 주장하지 않음 |
| https://mobbin.com/screens/99c635d2-abaf-44bc-9831-8226a52adb5e?section=key_screens | Replit editor, canvas 및 속성/작업 패널 구분 | 공개 레퍼런스 화면. 실제 편집 실행 없음 |

설치된 ChatGPT는 Computer Use에서 보호되는 앱 식별자로 노출되어 직접 접근이 차단됐다. 다른 경로로 우회하지 않았다.

최신 제품 원본 경로(저장소 /Users/hyukjaechoi/Projects/oh-my-own-code 기준):

- docs/runs/conversation-context/evidence/hidden-r1/conversation-context/000-light-1440-zoom1-values-0.png
- docs/runs/conversation-context/evidence/hidden-r1/conversation-context/004-light-1440-zoom1-final-send-control.png

## 차이와 수정 우선순위

1. **Composer 범위 축소.** ChatGPT와 Claude의 새 대화는 입력과 주 행동이 먼저 보인다. 제품은 메시지, 첨부 chip, 전송을 기본 표면으로 두고 파일 조사/긴 메타데이터/실행 관리는 별도 펼침 또는 문맥 패널로 옮기는 것이 적절하다.
2. **첨부 정보 단계화.** 파일명·종류·요약 상태를 먼저 보여주고 hash/version/상세 검증은 요청 시 제공한다. 오류와 전송 차단 이유는 즉시 보이게 유지한다. 안전 조건을 숨기거나 약화하지 않는다.
3. **행동의 시각적 우선순위.** 여러 full-width 박스/버튼이 같은 강도로 노출된다. 전송을 주 행동으로, 조사/제거/취소는 해당 항목 옆의 보조 행동으로 정리한다. 취소 의미와 unknown/no-replay 상태는 보존한다.
4. **내비게이션 역할 분리.** 게시된 이전 화면은 검색·프로젝트·세션·관리 행동이 혼재한다. Claude/ChatGPT처럼 생성, 탐색, 최근 기록, 설정을 분리하는 방향을 현재 workbench에도 대조해야 한다. 이전 화면만 보고 현재 sidebar 결함으로 확정하지 않는다.
5. **복잡한 도구는 작업 패널에 배치.** Replit은 복잡성을 없애기보다 canvas/대화/속성 영역으로 나눈다. 개발 도구의 특성을 유지하면서 대화 입력창을 작은 관리 콘솔로 만들지 않는 방향이 적절하다.

## 다음 검증

독립 RENDER 리뷰에 현재 밀도/계층/단계적 노출 문제를 별도 확인하도록 전달했다. 기능/geometry PASS를 디자인 PASS로 간주하지 않는다. 수정 시 기본, 첨부, 오류, unknown, 실행 중, 좁은 폭, 200% 확대의 실제 화면으로 확인한다. 현재 frozen CODE/RENDER 입력을 몰래 변경하지 않는다. 이 감사는 재설계 구현 완료나 gate 통과를 의미하지 않는다.
