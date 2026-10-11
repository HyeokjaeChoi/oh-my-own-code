# Harness research sources

Verified: 2026-09-13. The complete handoff, official product documentation, local Codex CLI 0.154.0 behavior, and five upstream repositories at fixed commits were inspected for this harness. Downloaded repository installers, hooks, packages, plugins, and scripts were not executed. Authenticated accounts, subscriptions, live service calls, and product execution were not verified. Historical handoff prices are not current price guarantees.

| Source | Applied information |
| --- | --- |
| Original user handoff (1,163 lines and 28 sections, fully reviewed; toolkit-root archive is intentionally not distributed) | Codex-first operation, minimal SaaS duplication, Next.js/Expo/Hono, repository product records, and conditional adoption of GitHub, Figma, Supabase, PostHog, Sentry, RevenueCat, and AppLaunchFlow |
| [Rethinking skills and prompts for GPT-6 Astra](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra) (2026-09-11, full body reviewed) | Short precise skill triggers, selective reading, completion criteria, persistence, less excessive process |
| [Using Claude Code: Spending your effort](https://x.com/trq212/article/2103576349499855160), published 2026-09-25; full text checked 2026-09-26; [reading and adaptation note](research/spending-effort.md) | Specification questions, bounded feedback loops, cause-specific retries and independent risk-based verification; Claude effort/cache results are not treated as Codex guarantees |
| [`garrytan/gstack` at `71f6048e8ada25180e61438abc1d98cb151fe9a7`](https://github.com/garrytan/gstack/tree/71f6048e8ada25180e61438abc1d98cb151fe9a7); [inspection report](research/gstack-matt.md) | Demand and scope challenge, ordered plan reviews, design/browser evidence, Codex host generation limits, and runtime layers rejected from the adaptation |
| [`mattpocock/skills` at `3cca18b368ae95cdbdebbff572ccafa662551015`](https://github.com/mattpocock/skills/tree/3cca18b368ae95cdbdebbff572ccafa662551015); [inspection report](research/gstack-matt.md) | Context-sized vertical issue slices, blocker graphs, expand-migrate-contract sequencing, public-seam testing, and separate standards/spec review |
| [`affaan-m/everything-claude-code` at `8321021c54d670126ce3b2969d5deb880b4b0c2a`](https://github.com/affaan-m/everything-claude-code/tree/8321021c54d670126ce3b2969d5deb880b4b0c2a); [inspection report](research/ecc-superpowers.md) | Bounded file/code exploration, iterative retrieval, diagnosis/review roles, and the gap between Claude lifecycle claims and the smaller native Codex hook projection |
| [`obra/superpowers` at `b36e0829c6d0140e93cfef2ca599b1b07d4a7797`](https://github.com/obra/superpowers/tree/b36e0829c6d0140e93cfef2ca599b1b07d4a7797); [inspection report](research/ecc-superpowers.md) | Reproduce-first debugging, meaningful RED/GREEN evidence, plan execution checkpoints, and independent completion review without adopting the whole plugin |
| [`github/spec-kit` at `d848fb4e18f44640ad6b42e60a280551ee90cdce`](https://github.com/github/spec-kit/tree/d848fb4e18f44640ad6b42e60a280551ee90cdce); [inspection report](research/architecture-speckit.md) | Requirement, plan, and task traceability for large or complex features; deterministic artifact checks and Codex integration boundaries |
| [Codex configuration](https://learn.chatgpt.com/docs/config-file/config-basic) and [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference) | Trusted project configuration, precedence, explicit primary model/effort, role settings, MCP settings, and CLI override behavior |
| [Codex custom agents](https://learn.chatgpt.com/docs/agent-configuration/subagents) | Native role TOML fields, model/effort selection, concurrency, and the distinction between a role and a thread label |
| [Codex hooks](https://learn.chatgpt.com/docs/hooks) | Supported lifecycle events and command-handler behavior, separate hook trust, and limits of advisory workflow controls |
| [Codex skills](https://learn.chatgpt.com/docs/build-skills) and [AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md) | `.agents/skills` discovery, narrow skill metadata, progressive references, and repository instruction boundaries |
| [OpenAI Docs MCP](https://developers.openai.com/learn/docs-mcp) | Public read-only endpoint `https://developers.openai.com/mcp` |
| [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp) | Project config, Streamable HTTP, OAuth, enabled, bearer environment variables; also checked the local official Codex manual chapter |
| [Figma remote server](https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/) | Codex support, remote endpoint, authentication, plugin alternative |
| [Figma MCP overview](https://developers.figma.com/docs/figma-mcp-server/) | Design context, variables, canvas writes |
| [Supabase MCP](https://supabase.com/docs/guides/ai-tools/mcp) | OAuth, project_ref, read_only, feature groups, local MCP, production access scope |
| [Expo MCP](https://docs.expo.dev/mcp/) | OAuth endpoint, Expo account, SDK 54+ local features, expo-mcp/development server setup, remote routing of screenshots |
| [Expo + Codex](https://docs.expo.dev/agents/codex/) | Official Expo plugin alternative and avoiding duplicate connections |
| [PostHog MCP](https://posthog.com/docs/model-context-protocol) | Official endpoint, regional routing, MCP versus internal AI billing |
| [PostHog advanced configuration](https://posthog.com/docs/model-context-protocol/faq) | project_id, readonly, mode=cli, features, project scoping |
| [PostHog Codex setup](https://posthog.com/docs/model-context-protocol/codex) | Native Codex OAuth and official plugin alternative |
| [Sentry MCP](https://mcp.sentry.dev/) | OAuth endpoint, organization/project URL scoping, reduced discovery tools |
| [RevenueCat MCP setup](https://www.revenuecat.com/docs/tools/mcp/setup) | Codex OAuth, official hosted endpoint, read-only API v2 key alternative |
| [AppLaunchFlow hosted MCP](https://www.applaunchflow.com/app-store-screenshots-mcp) | Remote endpoint, OAuth, plan limits, separate capture skill's SwiftUI/Flutter scope |
| [AppLaunchFlow MCP guide](https://www.applaunchflow.com/blog/app-store-screenshots-mcp-guide-2026) | Asset creation from actual captures and existing-asset editing workflow |
| [GitHub MCP server configuration](https://github.com/github/github-mcp-server/blob/main/docs/server-configuration.md) | Optional read-only/tool scoping |
| [Vercel MCP](https://vercel.com/docs/agent-resources/vercel-mcp) | Official OAuth MCP and Codex support; deferred by default to avoid CLI duplication |

The handoff informs product choices; official service docs support technical configuration; the pinned source reports explain selective workflow adaptations and licenses. Default, optional, and deferred selections are implementation judgments, not automatic installation or endorsement of upstream bundles or vendor subscriptions. See the portable [harness protocol](harness.md), [role catalog](agent-catalog.md), and [skill catalog](skill-catalog.md) for the implemented result.
