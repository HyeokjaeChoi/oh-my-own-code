# Author 01a10752-9558-77b1-8b0d-3d79c7aa5ae9

**판정: 현재 고정된 OpenCode v2.0.18 packaged CLI의 `serve`에는 durable event history를 켜는 지원 flag, config 또는 ENV 경로가 없습니다.** 내부 저장 기능은 있습니다. 그러나 CLI가 그 옵션을 서버에 전달하지 않습니다.

plan revision 6과 storage contract v5의 SHA-256은 지정 packet과 일치했습니다. 아래 소스 기준은 모두 commit `cd9a14a6b688d4021bee381dfd39d2cef9c0f862`입니다.

**1. CLI에서 저장 옵션이 끊기는 정확한 경로**

| 단계 | 확인한 동작 | commit 경로와 줄 |
|---|---|---|
| CLI 명령 | `serve` 옵션은 hostname, port, cors, service, stdio입니다. persistence flag가 없습니다. | [commands.ts L515–527](https://github.com/anomalyco/opencode/blob/cd9a14a6b688d4021bee381dfd39d2cef9c0f862/packages/cli/src/commands/commands.ts#L515-L527) |
| 명령 handler | 위 옵션만 `ServerProcess.run`에 전달합니다. | [serve.ts L6–15](https://github.com/anomalyco/opencode/blob/cd9a14a6b688d4021bee381dfd39d2cef9c0f862/packages/cli/src/commands/handlers/serve.ts#L6-L15) |
| CLI 서버 시작 | `start`에 전달하는 객체에 `events`가 없습니다. ENV에서 읽는 config도 별도 `config` 객체로 전달합니다. | [server-process.ts L87–126](https://github.com/anomalyco/opencode/blob/cd9a14a6b688d4021bee381dfd39d2cef9c0f862/packages/cli/src/server-process.ts#L87-L126) |
| 서버 옵션 | `events.persist?: boolean`이 실제로 존재합니다. | [options.ts L21–25](https://github.com/anomalyco/opencode/blob/cd9a14a6b688d4021bee381dfd39d2cef9c0f862/packages/server/src/options.ts#L21-L25) |
| 서버 조립 | `options.events?.persist`를 `Bus.configured`에 전달합니다. config 내용은 별도 `Config.configured`에 전달합니다. | [routes.ts L115–130](https://github.com/anomalyco/opencode/blob/cd9a14a6b688d4021bee381dfd39d2cef9c0f862/packages/server/src/routes.ts#L115-L130) |
| Bus 저장 | 값이 없으면 `persist=false`입니다. sequence는 저장하지만 event payload 삽입은 `persist` 조건에 따릅니다. | [bus.ts L203](https://github.com/anomalyco/opencode/blob/cd9a14a6b688d4021bee381dfd39d2cef9c0f862/packages/core/src/bus.ts#L203), [L404–429](https://github.com/anomalyco/opencode/blob/cd9a14a6b688d4021bee381dfd39d2cef9c0f862/packages/core/src/bus.ts#L404-L429) |

일반 config schema에는 `events.persist`가 없습니다. service config도 hostname, port, password, cors, env만 받습니다. 따라서 `OPENCODE_CONFIG_CONTENT`나 service의 임의 ENV 설정으로 서버 시작 옵션을 추가할 수 없습니다. [일반 config L25–110](https://github.com/anomalyco/opencode/blob/cd9a14a6b688d4021bee381dfd39d2cef9c0f862/packages/schema/src/config.ts#L25-L110), [service config L14–24](https://github.com/anomalyco/opencode/blob/cd9a14a6b688d4021bee381dfd39d2cef9c0f862/packages/cli/src/services/service-config.ts#L14-L24)

**2. 최신 probe 실패는 이 경로와 일치합니다**

저장된 [native-r1 evidence](/Users/hyukjaechoi/Projects/oh-my-own-code/docs/runs/durable-workbench-storage/evidence/native-r1/native-storage-evidence.json:3033)의 결과는 다음과 같습니다.

- packaged native version: `2.0.18`
- binary SHA-256: `6759c7f86f807d63d3984ca1970f9fa663ee303a35bb344eb223c71e200a96bf`
- `after: 0`, `follow: false`
- 반환값: `log.synced`, sequence `2` 한 개
- 실패: `Native historical log stream rejected`

`log.synced.seq`는 최신 sequence를 표시합니다. 저장된 payload 개수를 증명하지 않습니다. history는 `EventTable`에서 읽고, marker는 별도로 생성합니다. 따라서 sequence가 2여도 payload가 없을 수 있습니다. [bus.ts L764–783](https://github.com/anomalyco/opencode/blob/cd9a14a6b688d4021bee381dfd39d2cef9c0f862/packages/core/src/bus.ts#L764-L783), [L828–869](https://github.com/anomalyco/opencode/blob/cd9a14a6b688d4021bee381dfd39d2cef9c0f862/packages/core/src/bus.ts#L828-L869)

`after: 0`은 sequence 0을 제외합니다. cursor를 생략하면 시작값은 `-1`입니다. **이 차이는 저장되지 않은 payload를 복구하지 못합니다.** 또한 이번 저장 증거만으로 history 구간 이후의 restart/crash acceptance가 통과했다고 판단할 수 없습니다.

**3. 동일한 OpenCode engine을 유지하는 구체적인 대안**

공식 npm registry에서 `@opencode/sdk`, `@opencode/server`, `@opencode/core`, `@opencode/client`의 **2.0.18 배포를 확인했습니다.** SDK/server/core tarball은 다운로드 후 registry의 SHA-512 integrity와 대조했습니다. 설치나 실행은 하지 않았습니다. [SDK metadata](https://registry.npmjs.org/@opencode%2Fsdk/2.0.18), [Server metadata](https://registry.npmjs.org/@opencode%2Fserver/2.0.18), [Core metadata](https://registry.npmjs.org/@opencode%2Fcore/2.0.18)

| 대안 | 정적으로 가능한 구성 | 주요 tradeoff |
|---|---|---|
| **공식 server package를 시작하는 별도 wrapper** | `@opencode/server/process`의 `start`에 `events: { persist: true }`, 영속 `database.path`를 직접 전달합니다. `lifecycle`은 생략합니다. | 기존 HTTP client 경계를 유지할 수 있습니다. 대신 packaged CLI executable에서 package 기반 engine host로 바뀝니다. child 수명, 인증, 경로, runtime과 native dependency packaging을 앱이 책임져야 합니다. |
| **공식 Promise SDK host** | `@opencode/sdk`의 `OpenCode.create`에 `events: { persist: true }`와 영속 `database.path`를 전달합니다. | 같은 OpenCode core/server를 사용하지만 HTTP listener가 없는 in-process host입니다. 시작 시 자동 recovery가 실행됩니다. 현재 pending 실행 금지 조건을 그대로 만족하지 않습니다. |
| **Effect SDK와 recovery service 교체** | `@opencode/sdk/effect`의 두 번째 `embed` 인자에 `overrides`를 전달할 수 있습니다. `SessionRestart.Service`만 자동 sweep을 하지 않는 closed Layer로 교체하는 구조가 가능합니다. | engine package 수정 없이 가능한 주입 경로입니다. 그러나 기본 recovery 의미를 앱이 변경합니다. 별도 설계와 검증이 필요합니다. CLI 설정 해결책은 아닙니다. |

server wrapper의 근거는 [`start(options, lifecycle?, transform?)` L46–50](https://github.com/anomalyco/opencode/blob/cd9a14a6b688d4021bee381dfd39d2cef9c0f862/packages/server/src/process.ts#L46-L50)와 위 `routes.ts`입니다.

SDK는 `ServerOptions`에서 hostname/port/password만 제외한 옵션을 받고, `...server`를 embedded routes에 전달합니다. 기본 DB는 `:memory:`이므로 영속 경로를 명시해야 합니다. **SDK host는 CLI binary를 시작하는 client wrapper가 아닙니다. 자체 OpenCode engine host입니다.** [host.ts L17–45](https://github.com/anomalyco/opencode/blob/cd9a14a6b688d4021bee381dfd39d2cef9c0f862/packages/sdk/src/internal/host.ts#L17-L45)

Effect의 override 경로는 확인했습니다. 다만 root Promise `OpenCode.create`는 두 번째 `embed` 인자를 노출하지 않습니다. [Effect create L36–42](https://github.com/anomalyco/opencode/blob/cd9a14a6b688d4021bee381dfd39d2cef9c0f862/packages/sdk/src/effect/opencode.ts#L36-L42), [root wrapper L10](https://github.com/anomalyco/opencode/blob/cd9a14a6b688d4021bee381dfd39d2cef9c0f862/packages/sdk/src/opencode.ts#L10), [Layer replacement L80–90](https://github.com/anomalyco/opencode/blob/cd9a14a6b688d4021bee381dfd39d2cef9c0f862/packages/util/src/effect/layer-node.ts#L80-L90)

세 대안 모두 단일 OpenCode engine 소유자를 유지하는 설계 후보입니다. **현재 packaged CLI bytes를 그대로 사용하는 acceptance는 새 host에 이전되지 않습니다.** 변경한 실행 artifact와 dependency 집합에 대한 새 증거가 필요합니다.

**4. 추가 질문: unmanaged `serve`의 nonfresh 시작**

**확인한 소스 경로에서는 unmanaged `serve`가 기존 DB를 열 때 suspended execution recovery sweep을 자동 호출하지 않습니다.**

- default foreground mode는 `serviceOptions=undefined`입니다.
- 이 경우 `start`에 `lifecycle=undefined`를 전달합니다.
- 서버 boot는 `lifecycle`이 있을 때만 `installRestartContinuity`를 호출합니다.
- `SessionRestart` 구현은 호출 전까지 inert 상태라고 명시합니다. 실제 pending background 처리와 `execution.resume`은 그 Effect 안에 있습니다. [CLI L58–60, L127–142](https://github.com/anomalyco/opencode/blob/cd9a14a6b688d4021bee381dfd39d2cef9c0f862/packages/cli/src/server-process.ts#L58-L142), [server boot L93–108](https://github.com/anomalyco/opencode/blob/cd9a14a6b688d4021bee381dfd39d2cef9c0f862/packages/server/src/process.ts#L93-L108), [restart.ts L46–61, L192–230](https://github.com/anomalyco/opencode/blob/cd9a14a6b688d4021bee381dfd39d2cef9c0f862/packages/core/src/session/execution/restart.ts#L46-L230)

반면 SDK host는 `resumeSuspendedSessions`를 시작합니다. `ServerFetch.make`도 시작합니다. 따라서 두 경로를 unmanaged `serve`와 같은 startup 정책으로 취급하면 안 됩니다. [SDK host L49–52](https://github.com/anomalyco/opencode/blob/cd9a14a6b688d4021bee381dfd39d2cef9c0f862/packages/sdk/src/internal/host.ts#L49-L52), [ServerFetch L41–47](https://github.com/anomalyco/opencode/blob/cd9a14a6b688d4021bee381dfd39d2cef9c0f862/packages/server/src/fetch.ts#L41-L47)

이것은 **읽기 전용 안전성 증명이 아닙니다.** DB 초기화는 WAL 설정과 migration을 수행합니다. 이후 prompt는 기본적으로 execution을 깨웁니다. config/plugin/filesystem 부작용도 별도 검증 대상입니다. [database.ts L35–47](https://github.com/anomalyco/opencode/blob/cd9a14a6b688d4021bee381dfd39d2cef9c0f862/packages/core/src/database/database.ts#L35-L47), [Session.prompt L146–175](https://github.com/anomalyco/opencode/blob/cd9a14a6b688d4021bee381dfd39d2cef9c0f862/packages/core/src/session/session.ts#L146-L175)

**후속 changed-concern 검증 후보**

현재 worker의 fixture 흐름에 추가하거나 실행하지 않았습니다. 독립 설계에서 다음 조건을 먼저 고정할 수 있습니다.

1. unmanaged mode, 단일 owner, 이전 child 종료 확인, 명시한 DB 경로와 격리된 config를 사용합니다.
2. synthetic nonfresh 저장소에 suspended claim, queued/steer inbox, pending shell/subagent 상태를 각각 포함합니다.
3. startup과 허용한 read만 수행하는 동안 실행 시작·resume·inbox 소비·background 완료 처리·외부 효과가 없는지 확인합니다.
4. DB bootstrap 변경과 실행 상태 변경을 구분합니다. 읽기 전용 판정에는 config/plugin/filesystem 초기화도 포함합니다.
5. event persistence 검증은 별도로 수행합니다. payload가 restart 후 반환되는지, cursor 경계와 marker가 맞는지 확인합니다.

현재 production의 [fresh-only preflight](/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/sidecar-supervisor.mjs:575)는 수정하거나 우회하지 않았습니다. repo source, docs, ledger, fixture를 변경하지 않았으며, 모든 신규 다운로드는 이 chat의 `work/`에만 저장했습니다. Native/Electron/provider/UI 실행과 개인 데이터 접근은 하지 않았습니다.

