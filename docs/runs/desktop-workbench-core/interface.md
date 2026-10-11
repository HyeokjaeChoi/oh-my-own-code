# Desktop workbench IPC interface

Version: 2. This is the shared implementation contract for desktop-workbench-core revision 2.

Keep `window.desktopBridge.runtimeSnapshot()` backward compatible. Add `workbench(request)` as a closed, typed discriminated request union, not an arbitrary channel/SDK dispatcher, and optional `onWorkbenchChanged(listener)` returning an unsubscribe function. Main admits the exact app top frame for every request. Main validates argument count, plain JSON object shape, allowed keys, bounded strings, IDs and operation-specific constraints before any effects.

Every result is `{ok: true, value: T}` or `{ok: false, code: string, message: string}`. Errors use fixed app messages, never raw SDK errors, auth headers, endpoint/password or stack traces. Main-generated opaque IDs identify registered workspace/session records. Renderer selection is not authorization; every session must belong to the stated registered workspace.

Before accepting any prompt or command, main applies and reads back the exact baseline rules `[{action:'*',resource:'*',effect:'ask'},{action:'external_directory',resource:'*',effect:'deny'},{action:'subagent',resource:'*',effect:'deny'}]`. The initial sidecar-created session is included. Missing/mismatched policy or failed read-back returns `POLICY_UNVERIFIED`; no prompt/command is attempted. Recheck after any agent/model selection and immediately before sending. User trust in a workspace is separate from per-tool authorization; no remembered/bulk approval or renderer-provided rule is accepted. Rejecting a request through OpenCode v2 also rejects the session's other pending requests; UI wording and invalidation must reflect that broader documented effect. Unit tests assert no send on unverified/changed policy and no reuse of rejected or obsolete request IDs.

Do not invoke location-scoped SDK catalog APIs for an untrusted import: they may activate project configuration. Return explicit unavailable catalog state until session creation has obtained native trust confirmation. Direct bounded filesystem listing/preview remains independent of SDK discovery.

## Requests

- `{type: 'snapshot', workspaceId?: string, sessionId?: string}` returns a sanitized authoritative snapshot for the pair. A missing pair returns the workspace/session lists and temporary default. Do not make unknown IDs select another session.
- `{type: 'workspace.import'}` invokes a native directory picker and registers its canonical location without SDK discovery; cancellation is an explicit cancelled result.
- `{type: 'workspace.create', name?: string}` invokes a native parent picker and creates only an exclusive direct child. Names cannot contain separators, parent segments, controls or platform-reserved forms. Blank name uses yyyy-mm-dd-UUIDv7. No implicit git init.
- `{type: 'workspace.remove', workspaceId: string}` removes app registration only, refuses active execution, and does not delete disk contents.
- `{type: 'session.create', workspaceId: string, title?: string}` requires explicit native trust confirmation for imported paths before client session creation; bind the returned session to that workspace.
- `{type: 'message.send', workspaceId: string, sessionId: string, requestId: string, text: string, agent?: string, model?: string}` sends once through the pinned session API. Validate supported catalog selections. `model` is an opaque ID returned by the catalog; main maps it to the SDK's actual shape. Keep a bounded request receipt cache; duplicates never repeat side effects, busy/unknown outcomes are explicit.
- `{type: 'session.interrupt', workspaceId: string, sessionId: string}` requests cancellation through the exact supported API; stopping is not proof of stopped. Reconcile actual session status.
- `{type: 'permission.respond', workspaceId: string, sessionId: string, requestId: string, decision: 'once'|'reject'}` validates the current pending request and ownership. No bulk/remembered approval in this increment.
- `{type: 'catalog.list', workspaceId: string, sessionId?: string}` returns dynamic commands, skills, MCP, agents and models only through inspected available APIs. Each collection has status `available` or `unavailable` and entries; empty available arrays are not errors. Do not dump configs/secrets. Do not start a configured MCP merely to list it.
- `{type: 'command.run', workspaceId: string, sessionId: string, requestId: string, name: string, arguments: string}` dispatches only a listed runtime command with checked arguments and the same request/busy rules. Slash text is never shell code. Local panel/new-session actions are handled explicitly by the renderer.
- `{type: 'file.list', workspaceId: string, path?: string}` and `{type: 'file.read', workspaceId: string, path: string}` accept bounded relative paths only. Main revalidates canonical containment and symlinks; read only regular files with size limits. Deny sensitive configuration/credential names and binary formats in this text-first increment. Return actual file labels, content/entries and truncation/unsupported states. Never execute HTML.

## Snapshot DTO

Backend owns `src/desktop-bridge.d.ts` and the request validation module. Freeze this shared shape for the UI:

```
WorkbenchSnapshot {
  revision: number;
  state: 'connected'|'disconnected'|'unavailable';
  temporary: true;
  workspaces: {id, name, path, kind: 'folder'|'repository'|'worktree', trusted, temporary}[];
  sessions: {id, workspaceId, title, status: 'idle'|'running'|'stopping'|'unknown'}[];
  selectedWorkspaceId?: string;
  selectedSessionId?: string;
  messages: {id, role: 'user'|'assistant', text: string,
    tools: {id, name, status: 'pending'|'running'|'completed'|'error', input: string, output: string}[]}[];
  permissions: {id, sessionId, title, detail}[];
  error?: {code, message};
}
```

Catalog entries have `{id, name, description?, status?}`; the catalog is `{commands, skills, mcp, agents, models}`, each `{status, entries}`. File list returns `{path, entries: {name,path,type:'file'|'directory'}[]}`; file read returns `{path, content, truncated}`. Workspace import/create/remove and session creation return a new snapshot. Send/interrupt/permission/command return a receipt `{requestId?: string, status: 'accepted'|'duplicate'|'stopping'|'decided'|'unknown'}`; subsequent authoritative snapshots provide actual outcome.

Default snapshot is for the app-created temporary workspace/session. Keep the legacy runtimeSnapshot sessionId as a non-authoritative identifier for compatibility with its existing consumers and smoke tests. New workbench requests use main-registered IDs and validate ownership; knowledge of either ID grants no capability. Expose the authenticated client only inside the trusted runtime object for main, never through either preload API. Do not change existing startup identity/version verification or process cleanup semantics.

## Renderer and tests

Use assistant-ui ExternalStoreRuntime with real onNew/onCancel callbacks and immutable server message IDs. Per-session drafts and a request generation token prevent cross-session leakage. Tool UI uses existing @workbench/ui public exports when its declared schema matches; otherwise provide an inert escaped detail view. Notifications may trigger coalesced refresh; bounded polling is an honest fallback and must not be called durable event replay. Retain partial message text and explicit error/unknown states rather than fabricate completion.

Backend creates `workbench-service.test.mjs` and `workbench-contract.test.mjs`. Renderer creates a pure projection/selection helper and `workbench-projection.test.mjs`. Exact SDK wire calls are established from installed declarations and tested with representative fixture payloads; tests must not import/start a real host or use real user files. Primary owns `scripts/e2e-workbench.mjs`, dependency declarations, final validation and build evidence.

Renderer implementation lives under `src/renderer/` plus the existing `renderer.tsx` entry. Host implementation stays in the existing main-side modules. Only the public `desktop-bridge.d.ts` DTO declaration may cross that source boundary as a type dependency. The primary's required `check-renderer-boundaries.mjs` covers resolved project/slice/public-API/host boundaries with positive and negative fixtures, including type-only imports and alias/relative bypasses.
