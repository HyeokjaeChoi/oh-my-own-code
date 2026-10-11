# Confirmed persistent workspace direction

User instruction on 2026-10-03, received during the temporary session-lifecycle
increment: "워크스페이스를 codex처럼 ~/Documents/OhMyOwnCode/{session-id} 로 만들고 그 하위에 남기도록".

The next storage increment must create app-owned workspaces under
`~/Documents/OhMyOwnCode/{session-id}` and retain their project files and
conversation state after application exit. Existing imported project folders
remain at their original paths. The instruction resolves the parent storage
location hold; it does not authorize moving imported data or automatic expiry.
Use explicit user deletion rather than time-based retention by default.

The current independently approved temporary session-lifecycle contract remains
the bounded implementation baseline. Before persistent storage implementation,
register the focused recovery/data ownership contract, including stable session
IDs, fork/workspace relationships, atomic app metadata, isolated sidecar state,
startup recovery, missing paths and separation of conversation/file deletion.
Preserve disposable test profiles. Do not silently reuse personal credentials.

This is direct user authority for the next increment, not a claim that storage
or restart recovery has already been implemented.
