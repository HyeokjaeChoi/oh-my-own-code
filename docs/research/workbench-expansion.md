# Workbench capability evidence

Checked: 2026-09-26. Primary documentation review only; no package installation, runtime call, credentials, benchmark, or UI test. Package versions and implementation commits are not pinned. Requirements in the PRD are product decisions, not claims that these APIs implement them today.

## OpenCode v2

- [SDK](https://opencode.ai/v2/docs/build/sdk): `@opencode/sdk` embeds the host; `@opencode/client` connects to a service. Do not equate the older `@opencode-ai/sdk/v2` export with this generation.
- [API reference](https://opencode.ai/v2/docs/api): documented operations include `worktree.list/create/remove/refresh`, `session.update` with permissions, `command.list`, `session.command`, forms and permission replies, filesystem, PTY, shell and VCS reads. Session removal includes children. Fork copies history. Worktree creation runs project setup. No dedicated worktree import or arbitrary tool-execute endpoint was established in this bounded inspection. Session import is transcript import, not worktree import. API routes are marked experimental.
- [Plugins](https://opencode.ai/v2/docs/build/plugins/): worktree creation accepts a parent directory; strategies receive a suggested destination after naming/collision handling and may return a different existing destination. Canonical project plugins drive create/refresh; removal uses the recorded owner. Exact default name format was not established. Permission rules are inherited when children are created; live propagation was not established. Permission hooks cannot override explicit deny. Hooks and plugin RPC offer extension points, not proof that an app adapter is implemented.
- [Client](https://opencode.ai/v2/docs/build/client/): subscriptions are live-only without automatic replay/reconnection. Service discovery/start/stop belongs to the native service entry point; browser client compatibility does not grant filesystem/process access.

Implications to validate in design: safe import without automatic execution of project plugins; canonical root and selected parent enforcement; preview/confirmation before setup scripts; fresh delegation versus history fork; effective permission transitions; command callbacks versus TUI-only shortcuts; lifecycle cleanup and reconnect reconciliation. SDK failures must not silently trigger a different strategy.

## UI composition

- [assistant-ui OpenCode runtime](https://www.assistant-ui.com/docs/runtimes/opencode/overview) and [quickstart](https://www.assistant-ui.com/docs/runtimes/opencode/quickstart): the install example depends on `@opencode-ai/sdk`; this does not establish compatibility with the new generation. The runtime projects sessions into threads and supports tool/conversation surfaces.
- [ExternalStoreRuntime](https://www.assistant-ui.com/docs/runtimes/custom/external-store): provides a route for application-owned state. A custom OpenCode v2 adapter is a candidate, not validated compatibility.
- [Tool UI quick start](https://www.tool-ui.com/docs/quick-start): registry components are copied into the app and registered as assistant-ui tool renderers. Colocated schemas validate outputs. Interactive components can return user choices. A rendered approval card is not runtime authorization. Its example AI SDK/OpenAI backend is illustrative; this project retains OpenCode as the execution backend.

## Common app patterns used as reference

- [Codex worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees): app-managed workspaces and task context are distinct; project roots and cleanup behavior need explicit UI. We do not copy its storage path, cleanup policy or snapshot guarantees.
- [Codex terminal](https://learn.chatgpt.com/docs/integrated-terminal): project-scoped terminal and reusable actions.
- [Codex slash commands](https://learn.chatgpt.com/docs/reference/slash-commands): searchable composer actions and capability-dependent availability. Command names are UX references, not OpenCode API guarantees.
- [Claude Code desktop](https://code.claude.com/docs/en/desktop): sessions, permissions, browser/diff/file/terminal panes and keyboard navigation are useful common interaction patterns. Vendor authentication, cloud execution and proprietary integrations are outside this product.
- [OpenCode CLI](https://opencode.ai/v2/docs/cli): terminal entry point reference; CLI feature availability is not evidence of an identical browser SDK operation.

No exhaustive competitive parity or full source-code audit was performed. The PRD defines a finite target inventory so that “desktop-like” cannot be satisfied by a chat-only mockup or interpreted as every proprietary feature. SDK naming takes priority where the selected version exposes it; ordinary-directory fallback uses the user-requested date plus UUIDv7 format. Naming details and actual support must be verified against the pinned version before implementation.
