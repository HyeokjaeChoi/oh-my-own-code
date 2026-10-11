# Browser-to-bridge security contract

Revision: 2 · 2026-09-28 · Status: proposed

## Confirmed outcome

Produce an implementation-ready security design for how the trusted local workbench UI may connect to its loopback bridge while untrusted project previews, remote pages, and unrelated browser origins cannot use bridge APIs. The existing bootstrap, mutation-denial, preview, and S-08 contracts remain authoritative. This bounded run is design-only: it must not add endpoints, start services, create credentials, or enable OpenCode SDK calls.

## Requirements and scope

- Resolve the open browser/bridge design choices in `docs/engineering/workbench-architecture.md` §5 for the currently selected browser workbench.
- Specify exact Host and request-class admission (including browser-generated Origin behavior), bootstrap/revocation paths, per-tab capability lifecycle, credential transport, CSRF defense, mandatory preview separation, and event-stream transport.
- Distinguish browser-origin protections from same-device process access, OS identity, and the still-blocked real SDK lifecycle.
- Give observable positive/negative verification cases and label which require a later live browser/security run.
- Create one reviewed design contract at `docs/design/specs/browser-bridge-security.md`; register its exact version/hash before design review.

## Non-goals

- No bridge/browser implementation, launcher change, endpoint exposure, SDK import/start, canary, process, filesystem mutation, credential creation, or network test.
- No claim that localhost binding, CORS, Origin, Host, or bearer tokens alone provide OS-level isolation or protect against same-user processes/extensions.
- No WebSocket activation in this increment. The design may choose a safe authenticated event transport for the first implementation and defer unsupported transports.

## Decisions and assumptions

- User-authorized outcome: continue building the local OpenCode SDK workbench, with the security bootstrap before browser-triggered actions.
- Existing approved documents: `docs/engineering/workbench-architecture.md`, `docs/engineering/verification.md`, `docs/design/specs/workbench-ux.md`, and PRD v0.2.
- The bridge remains loopback-only; all SDK mutations remain disabled until later runtime and security gates pass.
- The coordinator may choose a conservative browser pairing and credential protocol if it avoids URL/history/referrer/cookie/log leakage and records residual local-process risks.
- No unanswered user choice blocks this design-only increment.

## Acceptance criteria

- **BBS-1 Design completeness:** the document defines trusted UI origin, exact Host/Origin rules, bootstrap and capability states, expiry/revocation, CSRF, preview isolation, event transport, and deny/error behavior without conflicting with approved specs.
- **BBS-2 Secret handling:** the document identifies every credential location/transport and excludes URL query, cookie, persistent browser storage, static bundles, logs, referrers, and preview contexts; it states same-device residual risk.
- **BBS-3 Verification readiness:** the document provides a bounded positive/negative test matrix and separates static assertions from tests that require the real local bridge/browser; passing design review is not runtime security proof.

## Ordered work and ownership

1. Coordinator authors `docs/design/specs/browser-bridge-security.md` using the approved architecture/verification contracts.
2. A fresh independent `design_spec_reviewer` reviews the exact document for threat-boundary coherence, implementability, state/error coverage, and unsupported security claims.
3. Coordinator resolves findings, updates the plan/contract when acceptance concerns change, obtains a fresh plan review if its binding changes, and reviews the final document again at its exact hash.
4. Coordinator registers the final document and outcome, then records the design handoff. Any implementation consuming it belongs to a later reviewed feature run.

## Ownership

| Role | Ownership |
|---|---|
| Coordinator | This plan, contract, design document, ledger, outcome |
| `plan_reviewer` | Read-only review of this plan and contract |
| `design_spec_reviewer` | Read-only review of `docs/design/specs/browser-bridge-security.md` |

## Verification and gates

- Independent plan review before document authoring.
- Independent `design_spec` review after exact document registration.
- Static consistency against the approved architecture and verification specifications.
- No runtime or browser check is required for this design-only run; later implementation has separate security/E2E gates.

## Change history

- Revision 1: establish a bounded design-only increment to resolve the open local browser/bridge trust boundary before any browser-triggered SDK action.
- Revision 2: incorporate independent design review findings on same-origin request headers, endpoint-specific bootstrap/revoke policies, capability lifecycle, and mandatory preview-origin isolation.
