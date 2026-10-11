# Durable duplicate import correction
Revision: 1 · 2026-10-09 · Routine bugfix

## Outcome and source authority
Restore unchanged PRD F-01 canonical-path deduplication in the actual durable import path. Current audit and completed git-branch-restore source is eb5206617abea9f3c157b71628c4aadcebedd1b16e11f91ce62705f7152a1ef1. Actual production service + production registry synthetic reproducer duplicate-import-red-r2 returns RUNTIME_ERROR on second path selection while preserving original bytes; no Native/provider call. Initial r1 was a fixture startup failure and is not defect evidence. Keep both attempts.

## Bounded implementation and decisions
Existing workspace identity, canonical path, ownership, name, trust revision and sessions must remain unchanged on repeat import, including symlink alias and managed paths. Keep one durable operation record per new request, same-key deduplication and canonical original digest. Reusing a workspace may still need a private reservation for that new operation under the current durable API; do not bypass dispatch/completion or invent a public API. Preserve managed folderSessionId as first actual session identity. No Native activation from import. At100 registrations allow reimport but reject a101st distinct target. Recovery/unresolved paths cannot regain mutation authority through reimport.

This is an ordinary fix inside accepted canonical registration and durable journal contracts. No new API/schema, filesystem strategy, native runtime or trust policy. No repeated PLAN/DESIGN entry gate. If implementation requires such a changed boundary, hold only that change and escalate classification.

## Ownership and acceptance
Main edits workbench-service.mjs, host/workspace-registry.mjs and their existing integration/registry tests only. Main alone ledger. Separate fresh CODE reviewer, no edits/delegation. No product UI change so no rendered review. All runtime evidence synthetic Node filesystem + actual production modules; stubbed Native does not prove actual Native activation/restart.
DUP1: repeat canonical import, alias, same key and checkpoint/reopen yield one existing workspace and confirmed original-key receipts, no new sessions/Native effects or original file changes.
DUP2: ownership/trust/name/managed first-session lineage and capacity/recovery holds remain correct; no forged mapping or changed same-key payload accepted.
DUP3: unchanged durable storage/service regression suite, scoped lint/format and explicit source/evidence freeze; separate CODE pass then integrate.

## Sequence
Register routine run after audit finish. Add meaningful integration RED at original source. Apply smallest coordinated service/registry correction. Run targeted GREEN then affected full suites/static checks. Preserve failures and exact source/outcome, obtain independent CODE, finish this bounded correction and continue the next remaining full18 increment.
