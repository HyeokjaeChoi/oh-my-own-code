# ADR-0003: Per-turn revert writes files outside the permission ruleset

**Status:** Accepted · **Date:** 2026-10-17 · **Scope:** `session.revert` and `session.revert.clear` (UI label "되돌리기" / "다시 적용")

## Problem

Reverting a turn restores workspace files from OpenCode's private snapshot (`session.revert.stage` / `.clear`). Those writes are internal to the server. They are not tool calls, so they are never evaluated against the session permission ruleset (`deny * *` base, `read_plan` / `scoped_edit` modes, path deny rules), and the deny floor and the permission overlay's path rules do not apply to them.

## Decision and rationale

Revert is allowed outside the permission ruleset. It undoes changes that were already permitted, and the snapshot lives in the app data directory, never in the user's `.git`. The guard is moved to the main process (`workbench-service` lifecycle), where the renderer cannot skip it:

- The workspace must be trusted.
- The session must be idle with an empty inbox (`idleIdentity`), so a revert never races a run.
- The target must be a user message of that session, checked with `session.message.get`; a hidden message cannot be re-staged.
- A native confirmation dialog (default deny, `confirmSessionRevert`) is required for both revert and reapply. The reapply dialog warns that edits made after the revert to the same files are overwritten.
- The renderer sends only a message id. It never passes paths or a file list, and `commit` is never exposed: the next prompt or compaction commits server-side.
- A failure after dispatch can leave only some files restored. It is reported as `UNKNOWN_OUTCOME` and locks the session like any other unresolved effect.
- Without a git repository nothing is restored. The snapshot DTO says so (`revert.filesRestored: false`) so the UI can tell the user.

## Alternatives and impact

Routing the restore through tool calls (so the ruleset applies) was rejected: it would need a new tool and would make "undo" depend on the current permission mode. A renderer-side confirmation was rejected because the renderer is not trusted to gate file writes. Ignored files, files over 2 MB and external edits made after a turn are not restored; this is snapshot behavior and is stated in the dialog.

## Revisit conditions

OpenCode adds a permission check to snapshot restore, or exposes a dry-run of the restore plan that lets the dialog list the exact files before confirming.
