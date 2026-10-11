# Embedded-host probe planning assessment — r1

**Decision:** Prepare a separately reviewed conditional plan; **do not run the real SDK host yet**. The static report and available environment do not establish enforceable filesystem, network, socket, process, and resource containment.

## Bounded target, if later approved

One disposable child imports only the already installed `@opencode/sdk@2.0.18` Promise API, creates one embedded host, calls `server.info()` once, applies the existing pure admission logic, closes once, and exits. No service discovery, sessions, workspace/project selection, tools, provider operations, MCP, shell, PTY, plugin registration, event streaming, persistent database, listener, or retry. This tests only that package/runtime/OS/sandbox lifecycle and proves no full product readiness, auth, supported-version contract, recovery, or general host safety.

## Required controls before requesting host-execution approval

- Freeze exact Node realpath/version/architecture/digest, package and lock hashes, resolved dependency/native closure, runner/profile hashes, and an offline immutable package snapshot. Missing inputs mean `not_run`; no install/download or registry/user package-manager config.
- Run from a dedicated child with an explicit clean environment and unpredictable owner-only temporary root. Redirect HOME, all XDG roots, `TMPDIR`/`TMP`/`TEMP`, `OPENCODE_CONFIG_DIR`, and `OPENCODE_TEST_HOME` inside the root; use empty bin/PATH and exclude inherited credentials, proxies, telemetry, `NODE_OPTIONS`, `NODE_PATH`, `DYLD_*`, and other `OPENCODE_*` values.
- Use explicit config `{}` (`config.content` is a string), config file/directory under the root, `project:false`, in-memory DB, disabled model fetch/snapshot, file watcher/search acceleration, and event persistence; no plugins or instances. Keep SDK logging discarded. Do not set version values to coerce a match.
- Before SDK import, independently evidence an OS-level policy that denies network/loopback/DNS/listen, outside-root reads/writes, child exec/fork, PTY/device access, unrelated process signalling, and uncontrolled IPC, while permitting only frozen runtime/package inputs and scratch writes. Use identical SDK-free canaries; process and resource enforcement must be external. Environment variables, process groups, Node permissions, fetch sentinels, and the Codex workspace sandbox are insufficient substitutes.
- Enforce startup/request/close/absolute timeouts, output and memory/scratch ceilings, no retries, exact-child termination and wait, owner-identity checked cleanup, no symlink following, bounded schema-only redacted evidence. If a limit cannot be enforced or an unexpected effect occurs, stop and preserve only a safe cleanup record.

## User approval boundary

The real SDK import/start is withheld until the exact profile, runner, read/write allowlists, effect budget, package/runtime hashes, timeout/termination/cleanup procedures, independent code/security review, and passing SDK-free canary results are reviewable. Then request explicit approval for precisely one startup, one in-memory info request, orderly close, and the documented temporary/native/runtime effects. Failed or inconclusive containment is a hard `NO-RUN`, regardless of approval.

## Remaining uncertainty

macOS `sandbox-exec` availability alone does not prove the policy. The exact allowable system/runtime reads, process/IPC/native containment and hard resource limits must be tested. Transitive initialization and suspended-session recovery remain dynamically unverified. The SDK's reported PID/URLs are not process ownership or authority; use the supervisor spawn identity instead.

## Routing and review

The static source retrieval was assigned to a fresh `code_explorer` at the coordinator-requested route `gpt-6-luna/high`. This planning assessment was prepared from that report and an independent fresh `planner` recommendation requested at `gpt-6-astra/high`. The metadata records requested settings only; runtime model identity is unverified. Next, independently review the SDK-free preflight plan and implementation. The primary remains the only run-ledger writer. Preserve `build-delivery` revision 7 and keep its product run active.
