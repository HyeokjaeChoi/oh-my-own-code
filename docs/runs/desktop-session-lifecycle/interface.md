# Desktop session lifecycle contract

Version 3. Additions to desktop-workbench-core interface v2; existing request
and security contracts remain in force. Preload continues forwarding only the
same closed workbench operation entrypoint and compatible runtimeSnapshot.

## Requests and results

All five lifecycle mutations include workspaceId, sessionId and requestId, using
the existing opaque app-ID syntax. Unknown/extra keys and invalid primitives
fail before effects. requestId is 1–128 bounded identifier characters. Each
result is WorkbenchResult<WorkbenchSnapshot> on known success, or a fixed
failure, including CANCELLED/BUSY/UNKNOWN_OUTCOME. Unknown outcomes never imply
an accepted fork/delete. No automatic replay.

- session.rename: also title, trimmed nonempty string, at most120 characters,
  no control characters. Calls session.update({sessionID,title}), then get to
  verify identity, location and title. The actual snapshot is authoritative.
- session.pin: also pinned:boolean. Main changes its app registry field.
- session.archive: also archived:boolean. Main changes app presentation state;
  true hides the session from ordinary navigation. It remains readable.
- session.fork: optional title with the same validation; no arbitrary before
  message ID in this increment. Calls session.fork({sessionID}) for a complete
  history fork, validates the returned new ID and location, registers a new
  opaque ID, applies/read-backs baseline permissions and optional rename.
  Return the child selection; retain parent linkage as an opaque app ID.
  The exact typed InvalidRequestError with kind empty_session is a definitive
  no-effect rejection: return fixed EMPTY_SESSION, retain the idle parent and
  store that failure for duplicates. No generic error or timeout is treated
  as proof of no effect.
- session.remove: no extra fields. Native confirmation defaults to cancellation
  and identifies the session title plus affected workspace. After confirmation,
  recheck identity/path/active inbox; only then call session.remove({sessionID}).
  In addition to refusing registered descendants, query the authoritative SDK
  session.list({limit:100, cursor?}) before confirmation
  and again immediately before remove. Use no directory/search filter that
  could hide children. Inspect both parentID and fork.sessionID in every item;
  the SDK does not set parentID for history forks. Any item referencing the
  target through either field blocks removal with HAS_DESCENDANTS. Malformed
  non-null lineage values fail closed. Proving
  no children requires exhausting cursor.next, including empty pages with a
  next cursor. Malformed pages, repeated/invalid cursors, read failures or a
  defensive limit of 100 pages fail closed with DESCENDANTS_UNVERIFIED. An
  unknown fork can have created a child not present in the app registry.
  Verify absence only through the installed typed SessionNotFoundError from
  session.get for that exact target, or an exhaustive validated SDK list scan
  with the same bounded cursor rules. A generic get error or one-page list
  absence never proves deletion. If absence cannot be verified after dispatch,
  retain an UNKNOWN_OUTCOME receipt and block replay; do not erase registration.
  Never remove workspace folders or other registered sessions. Return the same
  workspace and an existing nonarchived session or no selected session.
- diagnostics.list: workspaceId?:string, sessionId?:string. A supplied session
  requires its workspace; validate current registration and ownership. This
  read is not a lifecycle mutation and has no requestId.

The five lifecycle mutation types (rename/pin/archive/fork/remove) are distinct
from diagnostics.list. Both target and workspace are locked during a mutation;
reject active, stopping, unknown or locked sessions. Re-read active/inbox before
SDK mutations, and again after native confirmation. Archived sessions must be
restored before message.send/command.run; a fixed ARCHIVED_SESSION code conveys
that condition. No change to permission modes, subagent policy or auth.

Store bounded lifecycle receipts independently of live session records so
removal does not erase duplicate protection. Fingerprint the full normalized
operation. An exact duplicate of a known-success receipt returns a current safe
snapshot without another effect. An exact duplicate of a known failure or
cancellation returns the same fixed failure without another effect or dialog.
An in-flight duplicate returns BUSY. An exact duplicate of an unknown receipt
returns the fixed UNKNOWN_OUTCOME failure, never an ordinary successful
snapshot. No deterministic reconciliation is introduced in this increment, so
that unknown receipt remains unknown for the runtime lifetime. Different
content under the same request ID fails DUPLICATE_CONFLICT. Fail with
LIMIT_REACHED at capacity, rather than evicting receipt IDs and permitting
re-execution. A request for a removed/foreign session cannot use a receipt from
another target. The renderer creates a new ID only for a new user action.

## DTO additions

WorkbenchSession adds optional pinned:boolean, archived:boolean and
parentSessionId:string. The production host supplies booleans; optional fields
keep existing fixture/consumer compatibility. Missing fields mean false/no
known parent. App organization is explicitly temporary, not SDK persistence.

WorkbenchDiagnostics is:

```
{
  startedAt: number,
  observedOperations: number,
  errors: number,
  unknownOutcomes: number,
  droppedEvents: number,
  events: {
    id: string, timestamp: number, operation: string,
    workspaceId?: string, sessionId?: string,
    status: 'ok'|'error'|'unknown'|'cancelled',
    durationMs: number, code?: string
  }[]
}
```

Retain at most500 mutation observations, plus aggregate counts and a visible
dropped-record count. A session-filtered read returns matching events but
clearly labels aggregate counters as app-wide. Use a monotonic duration clock
and bounded finite values. No prompt/body/tool result, raw path, URL, auth,
credential, stack or SDK error text may enter this DTO. Malformed/unowned
requests are not permitted to inject arbitrary IDs/operation strings into
records. This is local app observation, not durable event replay, actual model
token usage or estimated provider billing.

## Renderer interaction

Navigation provides a labelled text search and active/archived view. Pinning
orders sessions before unpinned entries without changing selected IDs. Session
actions are accessible buttons/menu with Escape close and focus return; rename
uses a labelled form and nonempty validation. Avoid nested interactive buttons.
Distinguish history fork from +new empty session. A restored session can be
selected; archive/remove picks a valid same-workspace successor, clears stale
projection and does not leak the previous draft into another session.

Archived selection is read-only; main enforces this even for stale UI requests.
Busy/unknown sessions show unavailable actions. Removal's dialog comes from
main and is never represented as complete until authoritative success. Failed
fork/removal does not optimistically erase or create sessions. Local activity is
a separate right-panel feature with filter, empty, loading and error states,
mapped through the public typed bridge API. Existing file/catalog behavior,
safe Tool UI, composer visibility and keyboard navigation remain intact.
