# Host integration finding: staged first session identity

Host writer reported an actual workspace.create then session.create test failure. Workspace creation reserves appSessionId and persists workspace.folderSessionId, but completes without a Native session. Later registry.reserve(session.create,{workspaceId}) allocates a fresh UUID. Reusing the original ID is also denied because a prior workspace operation reservation already references it.

Contract section1 requires the first session identity to remain reserved when a workspace precedes its first session. Main assigned the active fresh registry correction worker (01a106c5-7992-7952-a8df-7acedeb1c33d), owning only registry source/test, to preserve exact legitimate reserved identity without arbitrary cross-operation collision or deleted-session reuse. No public API shape change. Host must not privately mint or adopt a replacement mapping.

Required regressions include staged creation/reopen, exact folderSessionId for first actual session, fresh IDs for additional sessions, concurrent reservation identity exclusion, tombstone exclusion and capacity accounting. This is an existing contract implementation repair, not scope reduction or new user approval.
