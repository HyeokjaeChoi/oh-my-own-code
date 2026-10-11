# Routine implementation observations

Entry PLAN r2 and DESIGN_SPEC v2 PASS, handoff verified, routine classification. No entry review renewed for accepted implementation.

- Initial unsupported backend_engineer handoff alias was rejected before spawn/ledger dispatch. Corrected to actual engineer alias.
- Main initial lint found unqualified structuredClone in three test sites; fixed globalThis qualification. Main lint second invocation passed.
- First moving-source service integration:79/80 pass. Owned drift repair with identical existing metadata and zero session delta was incorrectly refused. Storage writer corrected semantic validation to check resulting committed state, while first fork-to-direct requires changed metadata. Focused actual reproducer passed after correction; original failure preserved service-integration-first.log.
- Added order/origin regression first used a guessed p:m catalog ID. Actual catalog IDs are SHA256 opaque IDs. Corrected test to consume actual catalog response. First failed fixture assumption preserved service-order-origin.log; corrected two cases pass service-order-origin-second.log. No production check weakened.
- Actual prechange parser was bundled with its original dependency closure before source edits. Direct marker-validator proof is preparatory only. Actual writer/checkpoint/reopen compatibility belongs to storage tests/Native probe; no fake parser or raw relocated import.
- No Native instruction/hidden runtime or build invocation yet at this note. Source is still integrating across disjoint writers; interim passing tests are not final coherent source acceptance.

- Static preflight caught an existing trust boundary before Native execution: hydration resets workspace.trusted=false. Kept that boundary. Added actual service/registry checkpoint/reopen regression (service-restart-trust-r1.log PASS): no entry calls at startup, untrusted read denied, existing explicit session.create/confirmTrust grants trust, original session read returns preserved direct registration without put/remove. Probe must separately label the explicit trust/new-session effect before read-only original registration reconciliation. UI explains existing path/new session effect and never claims stored metadata is a current Native observation. No new trust API or automatic mutation.
- Coherent producer+storage Node suite at that stage263/263 PASS, with original failed fixture assumptions preserved. Added restart regression after that suite; final contracted aggregate will include it.
- Renderer final owned337/337 PASS and static checks; Main will execute final integrated contract after fixture source freeze. Storage final118/118 PASS and current4hashes match returned report. Both writers closed after preserving reports.
