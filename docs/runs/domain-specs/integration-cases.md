# Integration review probes

Coordinator's cross-document probes, not executed tests or independent verdicts.

1. User opens an imported repository containing hostile setup/plugin configuration. Import must not execute it; activation requires explicit trust and capability validation.
2. Two sessions share a directory while another session deletes it. A UI selection or app mutex alone is insufficient against external processes and symlink replacement; state the enforceable boundary and remaining hold.
3. A tool performs its side effect and the bridge crashes before storing a receipt. Reopening must not replay the mutation as a safe retry.
4. A parent reduces permissions while a child and pending approval are active. Block new work and invalidate stale grants; report running effects that cannot be revoked.
5. User changes to read/plan mode while arbitrary shell or untrusted plugin code exists. A prompt or visual label cannot enforce the promise; require a real boundary or hold the capability.
6. A tool-ui action arrives twice or belongs to a different session/policy revision. The server rejects/reconciles; schema validity alone is not authorization.
7. A preview page is a malicious local server. Separate origin and credential design must prevent control API access; ports alone do not isolate cookie scope.
8. Native command list contains a name colliding with an app action. Source and target remain visible; unknown slash text never becomes a shell command.
9. SDK fork contains history. Default specialist delegation must not call it fresh or infer model/permission inheritance without observation.
10. Terminal tabs close while processes remain. Deletion and stop-all use actual process ownership and termination evidence, not tab presence.
11. Subscriptions reconnect without replay. State requery can recover current state but must not invent a complete historic event trail.
12. A fixture/mock passes. Live SDK, real provider, UI E2E, policy enforcement and Figma access stay separately unverified.
13. Local schedule misses runs while service is off. Reopen shows missed execution and does not silently backfill tool effects.
14. Logs/exports contain files, prompts, environment or credentials. Default metadata collection is allowlisted; user-facing export preview must define scope.
15. Inline permission UI steals keyboard focus from every session. Only modal dialogs trap focus; inline requests remain reachable in normal navigation.

Root integration changed the UX wording in case 15 before final independent review. PRD and shared harness remain unchanged.
