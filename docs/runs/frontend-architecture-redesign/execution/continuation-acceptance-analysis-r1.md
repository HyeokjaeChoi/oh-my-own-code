| 기준 | 현재 근거 | 남은 상태 |
|---|---|---|
| **A1 경계** | P7 boundaries/bundle, desktop·UI 정적 검사. 현재 static 4개는 `current-parent-static-checks-r1.json`에 저장됨 | 해당 새 JSON은 이 reader가 재확인하지 않음. Parent 근거 연결 필요 |
| **A2 단일 상태·탐색** | P7 renderer-unit, 현재 Parent unit, 완료된 `projection-fixture-v5` 독립 PASS | 현재 Parent acceptance binding 필요 |
| **A3 bounded read·재실행 금지** | P7 storage-unit/admission, renderer lookup·unknown 보존, Native pending denial | 21개 기존 기록의 continuity 검증과 Parent 연결 필요 |
| **A4 기존 동작 보존** | 현재 unit, hidden renderer, storage/native preflight/lifetime 함수 검증 | 명시적인 계층별 검증 범위로 계약 수정 필요. Production Main 전체 E2E는 미검증 |
| **A5 접근성·한국어** | Hidden UI keyboard·focus return·synthetic composition·contrast 표본 | Computed focus contrast, 실제 OS IME·Screen Reader는 미검증 |
| **A6 실제 화면 품질** | 현재 hidden UI r5와 독립 rendered PASS, 승인된 Selected A 치수 | P7 새 상태의 narrow/200%는 미검증. 현재 Parent rendered 판정 필요 |
| **A7 성능·플랫폼 근거** | Fresh performance PASS, 100회 올바른 전환, 단계별 resource PASS, 종료 확인. 기존 package/native 근거 | 성능 기록 등록 필요. Foreground·Production Main startup·Windows는 미검증 |

남은 실행 항목은 **4개**입니다.

1. **Evidence continuity 검증을 완료합니다.**  
   [current-evidence-reuse-r1.json](/Users/hyukjaechoi/Projects/oh-my-own-code/docs/runs/frontend-architecture-redesign/execution/current-evidence-reuse-r1.json)의 전체 `3770…` baseline과 현재 source 차이가 `workbench-projection.test.mjs` 하나인지 확인합니다. 21개 terminal 기록의 argv·environment·artifact binding을 유지합니다. 재사용을 새 실행으로 기록하지 않습니다.

2. **Parent 계약의 검사 방법을 정리합니다.**  
   [contract.json](/Users/hyukjaechoi/Projects/oh-my-own-code/docs/runs/frontend-architecture-redesign/contract.json)의 A1–A7은 유지합니다. 예전 `workbench/sessions/smoke` 명령은 accepted-function/hidden-renderer 범위로 명시합니다. 현재 hidden UI와 [fresh performance](/Users/hyukjaechoi/Projects/oh-my-own-code/docs/runs/frontend-architecture-redesign/execution/final-performance-current-r1/ui-states/performance-evidence.json)를 연결합니다.

3. **현재 Parent outcome과 최종 독립 판정을 연결합니다.**  
   [run.json](/Users/hyukjaechoi/Projects/oh-my-own-code/docs/runs/frontend-architecture-redesign/run.json)에 현재 static·unit·재사용·성능 근거를 연결합니다. 완료된 projection correction과 기존 focused 판정을 재사용하되, 초기 P3 review를 현재 Parent 최종 판정으로 사용하지 않습니다. 초기 plan/design entry를 반복할 필요는 없습니다.

4. **검증 한계를 outcome에 명시합니다.**  
   A4 전체 Production Main E2E, A5 실제 OS 입력·보조기술, P7 narrow/200%, foreground·Windows는 `unverified`로 남깁니다. 성능 PASS를 zero growth·leak 부재로 확대하지 않습니다. 이는 추가 작업 요청이 아니라 현재 판정의 범위입니다.
