# Next runtime increment proposal

Revision: proposal 1 · 2026-09-27 · Status: planning recommendation, not execution authority.

Author: bounded fresh planner `/root/next_runtime_planner_r1`. Requested routing: Astra/high; actual runtime identity unverified. The coordinator remains the sole orchestrator, integrator and ledger writer. This proposal changes neither the task-plan SSOT nor source code.

## Recommendation

Take one small production-boundary increment: **bridge-owned runtime-info validation and redacted observation results, exercised by the existing pinned client with injected synthetic fetch**. Then move directly to an isolated host-lifecycle probe once its concrete filesystem/process/configuration/network boundary is reviewed. Do not spend further increments adding synthetic product features while real runtime ownership remains unresolved.

The immediate increment closes a demonstrated gap: the pinned client returns `{version: "synthetic-v2"}` unchanged despite declaring `ServerInfo`. It creates reusable bridge code and verifies its integration with the actual installed client without promoting that client into the production dependency graph or granting it access to an ambient service. It does not establish an operational host or finish S-01, AC-2, AC-6, or the product.

No new user choice blocks this bounded implementation after the coordinator revises/registers the plan and contract and obtains the required peer reviews. Existing overall implementation authorization is sufficient for those local edits. Persistent user-data choices and any new privileged runtime boundary remain separate holds.

## Input binding and observed baseline

- SSOT: `docs/runs/build-delivery/plan.md`, revision 5, SHA-256 `d948d3b3ac16fd325e381defffd6cff7101ba7dccb94969c17db5738b16d44a3`.
- Contract: `docs/runs/build-delivery/contract.json`, SHA-256 `064248d8e9743d7823753cef30c2e95a1644feec1dbbaa69ccdc83b7a491d8fd`.
- Product/design inputs: `docs/product/prd.md` v0.2; `docs/engineering/workbench-architecture.md`; `docs/engineering/verification.md`; `docs/operations/local-release-monitoring.md`. Their authored draft labels do not replace the current plan's recorded adoption and exact document bindings.
- Reviewed reports: `code-review-r1.json`, `design-qa-r1.json`, and `next-increment-research-r1.md` in this run directory. The coordinator reports all 12 registered rev-5 checks passed. This planning task did not rerun them or independently audit every check's execution environment.
- `apps/local-bridge/src/server.ts` exposes only synthetic `/api/snapshot`, `/api/events`, and `/health`; it rejects mutation prefixes and non-GET requests. There is no OpenCode production adapter and no bootstrap/Origin/Host/WS security implementation in this server.
- `packages/contracts/src/index.ts` intentionally fixes `source` to `synthetic-fixture`. Keep that marker: native info must not be substituted into a synthetic snapshot.
- `apps/local-bridge/scripts/operations-drill.mjs` demonstrates fixture redaction and loss/restart plus synthetic crash/backup/scheduler models. Its own final limitation states that production diagnostics, journal, DB migration, rollback and scheduler are not implemented.
- `spikes/sdk-ui/verify.mjs` already checks pinned manifests and Tool UI provenance, runs the strict client probe, and reports host lifecycle `NOT READY`. Preserve these assertions and limitations.
- Installed `@opencode/client@2.0.18` public `ServerInfo` declaration has `version: string`, `pid: number`, `urls: string[]`, and `paths: {tmp: string}`. Runtime validation must treat returned values as `unknown` despite those static types.
- Installed `@opencode/sdk` declarations expose `OpenCode.create`, `close`, and async disposal. This is API-shape evidence only. Cached installation and an existing lockfile do not establish fresh registry availability, host startup, config isolation or native binary availability.

## Options and tradeoff

| Option | Value now | Additional effects and uncertainty | Decision |
| --- | --- | --- | --- |
| Bridge-owned info validator, existing injected client probe | Closes observed unchecked-response boundary; provides safe states for later local diagnostics; compiles into actual bridge build | Local source/build artifacts and synthetic test execution only; does not remove the host lifecycle blocker | Implement once as the next bounded increment |
| Isolated embedded SDK host lifecycle | Resolves a major dependency for genuine product behavior, shutdown ownership and local monitoring | May initialize storage/config, load code, create processes or sockets, or attempt network access; exact package/runtime resources and isolation remain unresolved | Highest-value subsequent probe, after a concrete reviewed effect manifest |
| Attach to discovered user service | Quick access to a real response | May inspect user service/session/config state, confuses ownership, cannot safely assume termination authority | Do not use as a shortcut; a later explicit attach mode needs its own contract |
| Wire live native reads into today's browser bridge | Visible native status | Existing server lacks required control-channel security and would expose new sensitive runtime data | No-go until S-08 control-channel checks and applicable recovery gates pass |

The embedded candidate follows the architecture's current preference for explicit bridge ownership; it is not selected as proven compatible. A service-client alternative is considered only if the embedded probe shows a concrete lifecycle or compatibility failure. The validator remains reusable in either choice.

## Proposed bounded acceptance (add AC-8 to the run contract)

**AC-8 Runtime-info boundary:** The bridge owns a side-effect-free validator and a one-read observation wrapper. The actual pinned client plus injected fetch feeds that exact implementation. Missing/wrong required fields never produce a validated result, rejected reads never produce health success, and raw responses/errors never appear in diagnostics. Every invocation performs at most one injected read and no retry. Evidence is explicitly synthetic and cannot assert a live host, compatible runtime, authentication, or ready mutations.

Acceptance details:

1. Input is `unknown`. Validate the four required public fields above and their nested types. Apply documented bounded field/array limits as app admission limits, not alleged SDK limits. Reject null, arrays, missing fields, wrong primitives, non-finite/non-positive/non-integer PID and oversized required fields. Keep version validation separate from version compatibility: a structurally valid version does not establish supported runtime behavior.
2. Permit additional native fields only by dropping them; never spread the input into the returned value. Return a new minimal value containing the accepted version only; do not return PID, URLs, filesystem paths, unknown fields, stack, response text or credential-like metadata. The observation is not a control capability and must not use native PID for process ownership or native URLs for requests.
3. Suggested result discrimination: `info_validated` with minimal normalized info, `invalid_response` with `INVALID_SCHEMA`, and `read_failed` with `RUNTIME_UNAVAILABLE`. These are boundary observations, not `host_running` or `sourceHealth=available`. A transport/HTTP failure has no proven authentication meaning; do not invent `AUTH_REQUIRED` from arbitrary rejected values. Later authenticated adapters can add evidence-backed classification under their reviewed contract.
4. The wrapper accepts an explicitly supplied zero-argument `() => Promise<unknown>` read function. It creates no client, performs no default fetch, discovery, startup, subscription, retry, logging, persistence or browser request. Rejection is caught and reduced to a fixed code. No `any`, type assertion from unknown to trusted response, or unchecked SDK cast may bypass the boundary.
5. Return a fixed allowlisted diagnostic projection containing only observation kind, fixed code when present, and an explicitly synthetic provenance tag supplied by the probe. Do not serialize raw error messages or the accepted version into general diagnostics. Tests seed secret/path/HTML/prompt canaries in unknown fields, URLs, paths and thrown errors and assert they are absent from every emitted result/report projection under test.
6. The existing synthetic info failure must be demonstrated through the actual client followed by the bridge validator: client resolution alone remains successful, bridge admission becomes `invalid_response`. Include valid response, malformed JSON, transport failure and non-2xx through the same adapter path, with exact request counts and the existing ambient-fetch sentinel. Pure-validator checks additionally cover null/array/wrong nested types, each missing required field, boundaries and unexpected fields.
7. No HTTP route, renderer behavior, event contract, snapshot, data directory, package manifest, lockfile or dependency version changes. The bridge HTTP fixture remains synthetic and mutations remain denied. Normal import of the validator module has no side effect.

This is a local monitoring foundation only: a reusable trustworthy observation and safe diagnostic projection. A status panel, persistent incident log, process health, recoverable journal, S-09, and operational release monitoring remain unimplemented acceptance, not deferred product scope.

## Exact proposed files and ownership

All paths below are repository-relative. New files are expressly proposed, not claimed to exist.

| Owner | Files | Purpose and dependency |
| --- | --- | --- |
| Coordinator | `docs/runs/build-delivery/plan.md`, `contract.json`, evidence packets/reports and run ledger | Adopt revised scope, add AC-8/check mappings, bind reviews and evidence; preserve full product objective |
| Bounded design author | **new** `docs/engineering/runtime-info-boundary.md` | Compact backend schema/error/redaction contract matching AC-8; no new host or browser API authority. Register as `design_spec` and review before implementation |
| Engineer | **new** `apps/local-bridge/src/runtime-info.ts` | Pure validation, one-read wrapper and fixed diagnostic projection; no SDK imports or other new dependency |
| Test engineer, after implementation shape is agreed | **new** `apps/local-bridge/src/runtime-info.test.ts` | Behavior and rejection/redaction tests using existing Node test runner; flat path is included by existing `src/*.test.ts` target |
| Engineer, after bridge API exists | **new** `spikes/sdk-ui/runtime-info-probe.ts`; `spikes/sdk-ui/verify.mjs`; `spikes/sdk-ui/tsconfig.client-probe.json` | Invoke the exact bridge source implementation from the existing isolated spike, execute with its existing `tsx`, and add the probe to strict compilation. Keep the original `client-probe.mjs` and `.types.ts` unchanged as baseline regression evidence |
| Independent reviewer roles | Report-only handoffs to coordinator | `plan_reviewer`, `design_spec_reviewer`, and final `reviewer`; no self-approval or source repairs by final reviewers |

The cross-directory spike import is test-only; production imports remain confined to the bridge. No new production module/project boundary or SDK dependency is introduced. Existing bridge build includes `src/**/*.ts`; existing test target includes flat `src/*.test.ts`. If the probe cannot compile against that source under the existing cached toolchain, return the precise incompatibility; do not duplicate the validator into the spike, add an unreviewed package or weaken strict typing.

## Ordered execution and gates

1. Coordinator updates the SSOT to the next revision and contract with AC-8, this bounded ownership and checks. Save the existing rev-5 result as historical evidence; do not relabel it current after source changes.
2. Author the compact runtime-info boundary document. Register its exact version/hash with the design bundle. An independent `design_spec_reviewer` checks unknown handling, minimal output, fixed failure states, synthetic provenance, no activation path and diagnostic redaction. Existing PRD scope remains unchanged; use its current binding rather than seeking another product-scope approval.
3. A fresh `plan_reviewer` reviews the final revised plan/contract and new document binding. Resolve material findings before implementation. The coordinator runs current product and design-spec handoffs and prepares bounded implementation packets. Document and plan revisions must settle before dependent work.
4. Engineer and test engineer implement the owned files in dependency order. Test engineer fixes expectations independently from the produced outputs. Demonstrate the observed invalid-response risk and the corrected boundary; a syntax failure is not a RED case. No specialist starts services or performs host research as a side task.
5. Run the focused checks and full registered current-source checks below. Inspect the production bridge output and browser bundle boundary result; ensure the new module imports no SDK/client and has no auto-execution path. Save sanitized outputs and exact source/lock/toolchain hashes.
6. Independent code review judges the actual source and negative cases. UI source is unchanged; retain only the prior bounded shell judgment where its binding remains valid. If the run requires a refreshed design gate after fingerprints change, obtain that bounded review without expanding its claims. Any later visible UI change requires fresh implemented-state design QA.
7. Register outcome as bounded AC-8 evidence and partial AC-2/4/6 progress. Do not finish the overall build-delivery run or mark PRD AC-01–18 complete. Next owner prepares the isolated host lifecycle contract described below.

Coordinator gate commands (run only after corresponding artifacts exist and are registered):

```sh
python3 .solopreneur/harness.py plan build-delivery --file docs/runs/build-delivery/plan.md --contract docs/runs/build-delivery/contract.json
python3 .solopreneur/harness.py handoff build-delivery --gate product
python3 .solopreneur/harness.py handoff build-delivery --gate design_spec
```

Peer-review reports and artifact registration use the repository run protocol; these commands do not create approval or prove product correctness by themselves.

## Exact verification proposal and effects

Add one named required check `runtime-info-boundary` with argv `['node', '--import', 'tsx', '--test', 'apps/local-bridge/src/runtime-info.test.ts']`, cwd `.` and acceptance IDs `AC-2`, `AC-4`, `AC-6`, `AC-8`. It is executable only after the proposed file is created. This focused unit check opens no sockets and writes no data. The existing `sdk-client-probe` check gains AC-8 coverage through `verify.mjs`; its command stays unchanged. The probe runner must explicitly execute and strictly compile the new probe, so merely adding a file cannot satisfy acceptance.

Retain these 12 current contract commands and run them once against the settled source fingerprint where the run protocol requires current evidence. Do not broaden/repeat after passing unless further changes or findings invalidate them.

| Check | Exact command | Effects/interpretation |
| --- | --- | --- |
| integrity | `python3 docs/design/validate_system.py` | Static token/component validation |
| install | `pnpm install --frozen-lockfile` | Existing contract operation; may write dependency state and contact registry. Preserve its existing authorization and report clean/frozen/cache conditions honestly. No new package resolution is part of AC-8; absent cache is a blocker for the bounded spike, not permission to install its dependencies |
| lint | `pnpm nx run-many -t lint --skip-nx-cache` | Local tooling; check bridge import boundary |
| format | `pnpm nx run-many -t format-check --skip-nx-cache` | Local tooling, no format mutation |
| typecheck | `pnpm nx run-many -t typecheck --skip-nx-cache` | Static workspace type evidence |
| tests | `pnpm nx run-many -t test --skip-nx-cache` | Includes existing loopback HTTP fixture tests plus new pure checks; preserve synthetic scope |
| e2e | `pnpm nx run workbench-web:e2e --skip-nx-cache` | Existing browser/fixture processes and local ports, synthetic data only |
| boundaries | `pnpm nx run workbench-web:boundaries --skip-nx-cache` | Existing graph/negative/bundle checks; no server/client package in browser graph |
| operational-drills | `pnpm nx run local-bridge:operations-drill --skip-nx-cache` | Existing loopback bridge, temporary marker files and owned synthetic child process; not a real SDK host or durable production recovery |
| hooks | `python3 docs/runs/build-delivery/check_hooks.py` | Existing hook fixture/applicability evidence |
| build | `pnpm nx run-many -t build --skip-nx-cache` | Local `dist`/compiler artifacts, no publication |
| sdk-client-probe | `pnpm --dir spikes/sdk-ui run check` | Cached pinned client, injected fetch, compiler/SSR/probe subprocesses. No network, service discovery, host start, user files, session/tool calls or persistent data |

The focused check does not replace the integration probe. A real client fetch injected with synthetic responses does not prove network containment for arbitrary SDK code. The ambient-fetch sentinel detects that one API path only; do not label it an OS network sandbox.

## Subsequent host-lifecycle gate: concrete scope to prepare

Prepare this immediately after AC-8, or perform only read-only dependency/config-path investigation while AC-8 is implemented. Do not run it under revision 5 or this proposal. The next packet should own a small new `spikes/sdk-ui/host-lifecycle-probe.mjs` and a dedicated check command only after package inspection establishes a working launch path. No actual command is invented here because required runtime resources/configuration switches have not been verified.

Minimum reviewable contract before execution:

- **Exact host and client artifacts:** independently record pinned manifests, lock integrity and required native/runtime resources. Distinguish installed-cache proof from fresh tarball availability; do not auto-install or substitute the reserved landing-page package. Registry access/install, if needed, gets a stated destination and scope before execution.
- **Owned filesystem root:** create one uniquely marked temporary probe root with explicit children for workspace, data, configuration, cache and temporary resources. All content is synthetic. Record the exact root and child paths before startup, expected writes and cleanup policy. Production storage location and retention stay unselected.
- **Configuration and credentials:** use a minimal allowlisted environment and verified SDK path/config options. Redirecting HOME/XDG alone does not prove isolation; inspect all fallback/project discovery, credential, plugin/MCP and setup paths and disable ambient discovery/activation. Do not read/copy the user's existing auth store or attach to their service. If this cannot be enforced, stop before calling `create`.
- **Network and executable boundary:** prefer embedded/in-memory transport with no listening port and deny outbound provider/MCP/update/telemetry traffic through a verifiable boundary. Identify required executable/native resources and any startup subprocesses. If a loopback listener or spawned service is necessary, name its permitted address/port strategy and ownership proof in the plan. No service exposed on a wildcard address. Configuration claims alone are not evidence of OS containment.
- **Calls:** owned embedded host start; one `server.info()` through AC-8 validation; explicit `close` in `finally`; shutdown observation. No discovery/ensure/stop of ambient services, session create/list/prompt, permission decisions, tool/RPC, workspace import, event subscription or real project access. Each added native API needs its own justified scope. A later session/event recovery experiment is needed for full S-01/S-09; info+close is only their first lifecycle subcase.
- **Termination:** bounded startup/read/close timeouts and a supervisor that can terminate only the process tree proven to belong to this probe. Never kill by port or PID alone. Record start identity and observed exit/remaining process state. A timed-out `close()` is `unknown` until actual termination is observed. No recursive removal while a process may still write; preserve a sanitized failure manifest and report the orphan condition.
- **Success/failed-start effects:** record before/after owned-root manifests and process/socket observations; assert the expected scope and cleanup. Do not claim absence of writes outside the root merely from checking that root. Use the reviewed isolation mechanism or explicitly mark external effects unverified and keep integration disabled. At least normal startup/close and bounded startup/close failure behavior need evidence; no automatic retry into the user's service.
- **Diagnostics:** fixed local status/error codes, hashes, timings, resource ownership and versions; no raw paths/credentials/prompts or SDK exception dumps in general logs. Local redacted reports only, no telemetry.

The architecture author owns the concrete boundary contract; independent `design_spec_reviewer` and `plan_reviewer` approve its exact version before host code/execution. Any new privileges that existing authorization does not cover are presented to the user as a concrete final execution request after the reviewable code and manifest are ready. Do not ask the user to reapprove ordinary local implementation or the full PRD.

## Unresolved choices and no-go boundaries

| Choice or uncertainty | Proposed treatment | Blocks |
| --- | --- | --- |
| Product data location, original-content retention and backup/deletion policy | Ask the user once with concrete path/retention options before durable user-data behavior; reuse any already answered decision | Real session persistence, user-data migration/export/retention. Does not block AC-8 or an isolated disposable synthetic root |
| Default work root | User-selected path; do not substitute app checkout | Real workspace creation/import flows needing that default, not validator or empty synthetic probe |
| Embedded SDK vs owned service client | Technical decision based on lifecycle probe under existing architecture; do not require a product preference without a consequential tradeoff | Production runtime adapter and startup/recovery integration |
| SDK config/resource isolation and process/network effects | Read-only inspection then exact owned-root/call/effect manifest; surface any uncovered privileged boundary concretely | All real host startup or attachment |
| Provider credentials/live model access | Excluded from this next increment; later existing-runtime use needs explicit target/context and transmission boundary | First credential-dependent real conversation; not local metadata validation or isolated host probe |
| OS/browser support and background delivery | Current local-browser baseline; record tested environment, do not silently choose native packaging | Generalized release/support claims and S-10 completion |

Do not enable live browser SDK reads/mutations merely because info validates or host startup succeeds. S-08 bootstrap/Origin/Host/WS and hostile-preview isolation, minimum real deny admission and applicable S-09 recovery remain prerequisite evidence for their dependent surfaces. Keep storage/retention holds, mutation denial and synthetic UI labels intact. Do not introduce accounts, external telemetry, persistent services, subscriptions, a native shell, real-project test data, destructive cleanup outside the marked probe root, or remote publication.

The full path remains: validated bridge boundary → isolated host lifecycle evidence → secure control channel and recovery foundation → first real workspace/session/conversation slice with confirmed storage → remaining PRD flows → complete integrated acceptance and reproducible local build → production local monitoring/recovery drills and independent release judgment. This ordering does not remove or postpone any approved feature from the release target.

## Planning-task outcome

Only this proposal was written. No SSOT, contract, source, package manifest, lockfile or ledger was changed. No tests, SDK calls, services, browsers, installs or operational drills were started by this specialist. Repository and cached declaration reads support the file/API claims above; inherited check/review results retain their stated limits.
