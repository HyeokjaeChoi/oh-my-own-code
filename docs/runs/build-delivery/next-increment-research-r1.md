# Next increment research — read-only OpenCode bridge

Checked on 2026-09-27. This is a research handoff for the next approved plan slice; it is not runtime evidence or permission to enable SDK mutations.

## Repository facts

- `apps/local-bridge/src/server.ts` serves schema-validated synthetic snapshot, event, and health reads on loopback. Mutation routes and non-GET methods are denied. It does not start or connect to an OpenCode host/client.
- `packages/contracts/src/index.ts` marks the data source as `synthetic-fixture`; mutation operation names are contract declarations, not implemented capabilities.
- The web app reads that synthetic API with credentials omitted and caching disabled. Its event projection reconciles sequence gaps and reports unknown status; current browser tests exercise an inert validated preview, including malformed payload fallback.
- Current security, recovery, and ops evidence is synthetic. It does not establish hostile-preview isolation, native event behavior, durable recovery, or production diagnostics.

The repository has an SDK client synthetic-fetch spike but no actual OpenCode server/client startup. The current bounded increment extends only the synthetic-fetch check. The real-runtime probe described later is a future research candidate, not an approved task: startup, discovery, event subscription, network access, process creation/cleanup, file access, and persistence each require a separate scope, isolation review, and explicit plan before execution. Current S-08 bootstrap/Origin/Host/WebSocket/hostile-preview checks and S-09 recovery evidence still gate browser routes, file access, preview execution, and mutations. The PRD's broader AC-01–18 are not fulfilled by the current synthetic interface.

## Official SDK findings

- The package candidate for a client-only probe is `@opencode/client@2.0.18`. The current `@opencode/sdk` npm landing page reports its default version as `0.0.0-reserved`, while the existing local spike lockfile pins `@opencode/sdk@2.0.18` and its cached installed manifest contains working exports and dependencies. This discrepancy means fresh registry availability of the pinned host package is unverified; do not infer either that the v2 host package is absent or that it can be freshly installed. Package versions are released independently, so verify exact tarball availability and pin client/server versions separately before a runtime probe.
- The generated client exposes read APIs such as server info, session listing, and pending permission listing. Its event connection is live-only: disconnects can lose events, reconnect/replay is not automatic, and a slow subscriber can stall other consumers. The API reference marks event and permission routes experimental/volatile. This transport does not provide our durable cursor, snapshot reconciliation, redaction, or recovery guarantees.
- `Service.discover()` is a passive discovery candidate. `Service.ensure()` can start a service and `Service.stop()` stops a registered service. Keep ensure/stop out of a passive read-only client probe. Embedded `OpenCode.create()` has its own host lifecycle and must be closed. Do not let a probe silently attach to or alter an ambient user service.
- SDK permission rules, typed routes, and plugin hooks are not OS-level process or filesystem isolation. The bridge remains responsible for admission, path/target checks, redaction, receipts, and uncertain-effect reconciliation.

Official references:

- [OpenCode v2 SDK guide](https://opencode.ai/v2/docs/build/sdk)
- [OpenCode v2 client guide](https://opencode.ai/v2/docs/build/client)
- [OpenCode v2 API reference](https://opencode.ai/v2/docs/api/)
- [OpenCode v2 permissions](https://opencode.ai/v2/docs/permissions)
- [OpenCode v2 plugin hooks](https://opencode.ai/v2/docs/build/plugins/)
- [Client package page](https://www.npmjs.com/package/%40opencode/client)
- [Reserved SDK package page](https://www.npmjs.com/package/%40opencode/sdk)
- [OpenCode releases](https://github.com/anomalyco/opencode/releases)

## Current approved increment

1. Reuse the existing `spikes/sdk-ui/client-probe.mjs`; it already pins `@opencode/client@2.0.18` and asserts that synthetic `server.info()` performs exactly one `GET /api/info` with no network request. The useful next increment is a strict TypeScript probe and explicit transport-failure, non-success HTTP, and malformed-JSON cases, without adding dependencies to the root workspace, bridge, or renderer.

The exact owned files are `spikes/sdk-ui/client-probe.mjs`, `spikes/sdk-ui/client-probe.types.ts`, `spikes/sdk-ui/tsconfig.client-probe.json`, and `spikes/sdk-ui/verify.mjs`. The existing check command must compile the new type file and run each synthetic success/failure case; it fails closed if any case or typecheck fails. Package manifests, lockfile, and dependency versions stay unchanged. If the cached toolchain or packages are unavailable, do not install or contact a registry; record the check as blocked. Existing host/UI assertions remain regression checks only.

## Future candidate — separate plan/review required

A possible real-runtime probe would need an isolated installation and workspace, verified exact package availability, and a reviewed process/config/credential/network boundary before any startup, discovery, event subscription, or cleanup operation. The allowed effects and cleanup process are unresolved. No such runtime actions, HTTP requests, file access or writes, or persistent storage are authorized by this research or the current plan revision.

Confidence is high for the current source/spec gap and medium for exact host package registry availability and real runtime behavior. The existing SDK/UI spike already includes both v2 packages in its frozen lockfile and cached install; this research performed no package installation, started no real runtime, and accessed no user project data.
