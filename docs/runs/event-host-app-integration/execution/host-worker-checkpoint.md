HOST freeze는 완료됐습니다. Main의 fixture 종료 방식은 확정한 API와 일치합니다.

- `observeIdle()`은 SIGKILL 전 direct JS handle 증거만 제공합니다.
- SIGKILL 후 production `stop()`은 계속 `exited:false`, `cleanup:"incomplete"`입니다.
- DB는 `event-host.sqlite`입니다.
- HOST 최종 검증은 mocked tests **56/56**, ESLint 통과입니다.

이전 checkpoint의 네 파일과 SHA256은 그대로입니다. 실제 runtime 검증은 아직 수행하지 않았습니다.
