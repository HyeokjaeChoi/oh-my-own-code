# Full product continuation coverage
Date: 2026-10-03

Build-delivery revision19 and PRD v0.6 remain authoritative. This is a navigation checklist, not a replacement plan, deferral, or completion claim. Foundation gates precede dependent feature execution.

| Feature/acceptance | PRD capability | Current continuation dependency |
| --- | --- | --- |
| F-01 / AC-01 | 프로젝트·워크트리 import | P4/P5 state/receipt safety; P7 durable identity where relevant; independent feature evidence still required |
| F-02 / AC-02 | 새 디렉터리·워크트리 생성 | P4/P5 state/receipt safety; P7 durable identity where relevant; independent feature evidence still required |
| F-03 / AC-03 | 등록 해제·실제 삭제 | P4/P5 state/receipt safety; P7 durable identity where relevant; independent feature evidence still required |
| F-04 / AC-04 | 작업 관리·병렬 세션 | P4/P5 state/receipt safety; P7 durable identity where relevant; independent feature evidence still required |
| F-05 / AC-05 | 대화·컨텍스트 | P4/P5 state/receipt safety; P7 durable identity where relevant; independent feature evidence still required |
| F-06 / AC-06 | agent·model·추론 옵션 | P4/P5 state/receipt safety; P7 durable identity where relevant; independent feature evidence still required |
| F-07 / AC-07 | 서브에이전트 호출·관찰 | P4/P5 state/receipt safety; P7 durable identity where relevant; independent feature evidence still required |
| F-08 / AC-08 | 도구 호출·Tool UI | P4/P5 state/receipt safety; P7 durable identity where relevant; independent feature evidence still required |
| F-09 / AC-09 | 권한 확인·모드 전환 | P4/P5 state/receipt safety; P7 durable identity where relevant; independent feature evidence still required |
| F-10 / AC-10 | 우측 브라우저·산출물 프리뷰 | P4/P5 state/receipt safety; P7 durable identity where relevant; independent feature evidence still required |
| F-11 / AC-11 | 파일·diff·Git 검토 | P4/P5 state/receipt safety; P7 durable identity where relevant; independent feature evidence still required |
| F-12 / AC-12 | 터미널·실행 액션 | P4/P5 state/receipt safety; P7 durable identity where relevant; independent feature evidence still required |
| F-13 / AC-13 | 내장·슬래시·커맨드 팔레트 | P4/P5 state/receipt safety; P7 durable identity where relevant; independent feature evidence still required |
| F-14 / AC-14 | 하네스 구성 관리 | P4/P5 state/receipt safety; P7 durable identity where relevant; independent feature evidence still required |
| F-15 / AC-15 | 계획·작업 목록·리뷰 | P4/P5 state/receipt safety; P7 durable identity where relevant; independent feature evidence still required |
| F-16 / AC-16 | 기록·학습·사용량 | P4/P5 state/receipt safety; P7 durable identity where relevant; independent feature evidence still required |
| F-17 / AC-17 | 복구·로컬 데이터 | P4/P5 state/receipt safety; P7 durable identity where relevant; independent feature evidence still required |
| F-18 / AC-18 | 일상 작업 편의·로컬 자동화 | P4/P5 state/receipt safety; P7 durable identity where relevant; independent feature evidence still required |

P6 requires recorded OS/CPU/build/viewport/DPR/zoom, representative bounded transcript and sample count. Measure input/menu/panel/switch/store-to-capture separately from network/polling, and listener/request/heap trend after100 switches. Hidden test windows cannot prove foreground user-perceived latency; state the measurement boundary. No OS focus changes or visible launches. Native Windows runtime, authenticated provider execution and external distribution are distinct capability gates.

Completed foundation checkpoint: bounded-workbench-foundation planrev7 finished with seven exact checks0, current r3 captures28, independent code/design/design_spec pass. This closes only P4/P5 runtime foundations, not any full F01–18 end-to-end acceptance. P6 worker admitted next. Main read-only reuse scan: apps/local-bridge/src contains server/browser-admission/runtime-info/fixture only; packages/contracts enums mention git.commit/config.apply but no reusable Git/PTY/automation implementation was found by scoped file/name search. Do not treat those effect names or synthetic previewLink fixture as delivered desktop features. Future capability design still needs concrete app-owned implementation and security/effect admission.
