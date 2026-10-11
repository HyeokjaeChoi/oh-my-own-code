# Per-project MCP connections

Only the public OpenAI Docs MCP is shared by default. Choose account-based services when needed for actual product work. All `mcp/presets/` templates have `enabled = false`; that directory is not itself Codex configuration. Configuration generation and OAuth authentication are separate steps.

OpenAI Docs MCP searches/reads documentation; it does not execute the OpenAI API. Default endpoint: `https://developers.openai.com/mcp`. [Official setup](https://developers.openai.com/learn/docs-mcp)

## Selection

| Stage / preset | Work | Default scope / authentication |
| --- | --- | --- |
| Design implementation — `figma` | Align specific Figma frames, variables, components with code | OAuth, accessible Figma files |
| Mobile development — `expo` | SDK docs, EAS failures, simulator checks | OAuth, Expo account; extra setup for local features |
| Database development — `supabase` | Schema, migration state, logs, advisors | OAuth, specified project, read-only |
| First launch — `applaunchflow` | Screenshots, localization, promotional assets from actual app captures | OAuth, connected AppLaunchFlow account |
| Analytics — `posthog` | Activation, funnels, retention, experiment results | OAuth, specified project, read-only |
| Error investigation — `sentry` | Connect crashes, exceptions, release problems to code | OAuth, specified organization/project |
| Subscription implementation/analysis — `revenuecat` | Product catalog, entitlements, subscriptions | OAuth; explicit read-only access requires a separate API v2 key |

These selections follow the handoff's division of responsibilities. An available connection does not imply a purchase or activation for every product. Endpoint evidence appears below and in [research sources](research-sources.md).

## Apply and authenticate

From the Solopreneur root, apply only needed connections. Replace `/path/to/my-app` with the actual registered product directory outside the toolkit.

```sh
python3 scripts/solo.py mcp-list
python3 scripts/solo.py mcp-enable /path/to/my-app figma
python3 scripts/solo.py mcp-enable /path/to/my-app supabase --set SUPABASE_PROJECT_REF=your-dev-project-ref
python3 scripts/solo.py mcp-enable /path/to/my-app posthog --set POSTHOG_PROJECT_ID=12345
python3 scripts/solo.py mcp-enable /path/to/my-app sentry --set SENTRY_ORG=your-org --set SENTRY_PROJECT=your-project
```

Commands generate the selected project's `.codex/config.toml` and store selections in `.solopreneur/managed.json`. They do not obtain tokens or log in. `--set` values are URL project identifiers, not secrets. The tool substitutes preset `__NAME__` placeholders; do not assume Codex expands environment variables in URLs.

Trust the target project in Codex before OAuth authentication. For example, with Supabase enabled:

```sh
cd /path/to/my-app
codex mcp get supabase
codex mcp login supabase
codex
```

Check `/mcp` in a new session, then verify access with a small read such as listing development-project table names. Use each preset's server name for login. Do not use `codex mcp add` here; it registers in user settings. Codex reads trusted project `.codex/config.toml`; MCP settings are shared across app, CLI, and IDE. [Codex MCP docs](https://learn.chatgpt.com/docs/extend/mcp)

If a server is missing in a new session after `mcp-enable`, check config location, project trust, and existing same-name plugins/MCPs. Choose one connection if an official plugin already provides the service. Do not automatically delete existing user settings or OAuth accounts.

To remove an optional connection, run `python3 scripts/solo.py mcp-disable /path/to/my-app figma` from the Solopreneur root. Other project settings and stored OAuth credentials remain.

## Service configuration rationale

### Figma

Official remote endpoint `https://mcp.figma.com/mcp` supports Codex. Provide a specific file URL/node and read relevant frames/variables. Figma MCP can write to the canvas, so it is not a read-only connection. Compare repo design tokens and UI, then make requested Figma changes within scope. [Remote installation](https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/), [capabilities](https://developers.figma.com/docs/figma-mcp-server/)

### Expo

`https://mcp.expo.dev/mcp` uses OAuth and an Expo account. Remote access supports docs/build investigation. Local simulator capture/tapping additionally requires SDK 54+, project `expo-mcp`, CLI login with the same account, and an MCP-enabled development server. [Expo MCP docs](https://docs.expo.dev/mcp/)

```sh
# Run in the actual Expo app when local simulator features are needed.
pnpm expo install expo-mcp --dev
pnpm expo whoami
# Run pnpm expo login if not authenticated.
EXPO_UNSTABLE_MCP_SERVER=1 pnpm expo start
```

Reconnect MCP after starting/stopping the development server. Local iOS features target the macOS simulator; local results such as captures pass through Expo's remote server. Check the installed SDK and current official support. [Local features and data flow](https://docs.expo.dev/mcp/)

### Supabase

The preset combines `project_ref`, `read_only=true`, and `features=database,docs,debugging,development`. OAuth grants selected-organization access, restricted here to one project; account management, deployment, and branching are excluded by default. `read_only=true` executes queries as a read-only Postgres user. Prefer repo migrations for schema changes, verified against a development database. [Supabase MCP configuration](https://supabase.com/docs/guides/ai-tools/mcp)

Connect a development project first. When production evidence is requested, name the production project explicitly and use only necessary queries. Local Supabase CLI MCP at `http://localhost:54321/mcp` is an alternative after actually starting the local environment. This preset does not create a local database or connect to production. [Scope and security guidance](https://supabase.com/docs/guides/ai-tools/mcp)

### PostHog

`https://mcp.posthog.com/mcp` routes to US/EU based on the OAuth account. The preset uses `project_id`, `readonly=true`, `mode=cli`, and analytics features. `readonly` excludes write tools; project scoping removes context-switch tools. `mode=cli` exposes a small surface for on-demand tool discovery. PostHog uses `readonly`, unlike Supabase's `read_only`. [Advanced configuration](https://posthog.com/docs/model-context-protocol/faq)

Service usage charges still apply independently of MCP connection calls; some tools may incur PostHog AI charges. For weekly reviews, start with needed insights, dashboards, and event results. Do not default to arbitrary personal data or full session replay collection. [MCP costs](https://posthog.com/docs/model-context-protocol)

### Sentry

OAuth endpoint `https://mcp.sentry.dev/mcp/ORG/PROJECT` scopes the product. The official server selects matching context and hides unnecessary discovery tools. Scoping does not imply read-only permissions. Complete evidence analysis and code fixes for error investigations; issue state changes and automated fixes follow the task's authorized scope. [Official connection guide](https://mcp.sentry.dev/)

### RevenueCat

Codex supports OAuth at `https://mcp.revenuecat.ai/mcp`. The preset declares only a remote connection, without an npm bridge or secret key. Check scopes on the authorization screen and confirm the project ID when multiple products are visible. [MCP setup](https://www.revenuecat.com/docs/tools/mcp/setup)

For strictly read-only analysis, create a dedicated read-only API v2 secret key in RevenueCat and use separate configuration that passes it through the Codex environment. Never write the actual key in configuration.

```toml
# Separately managed project example; do not also add the OAuth preset.
[mcp_servers.revenuecat]
url = "https://mcp.revenuecat.ai/mcp"
bearer_token_env_var = "REVENUECAT_MCP_READ_ONLY_KEY"
enabled = true
```

Configure read-only permissions in RevenueCat; Codex's `bearer_token_env_var` reads the bearer from that environment variable. Review differences before sync if manually editing tool-generated config. [RevenueCat permissions](https://www.revenuecat.com/docs/tools/mcp/setup), [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp)

### AppLaunchFlow

`https://mcp.applaunchflow.com/mcp` uses hosted Streamable HTTP and OAuth 2.1/PKCE. No separate local MCP server or API key installation is required. Generate screenshots, copy, localization, and promotional assets from actual app captures; retain their app version and locale. Connection and asset generation are separate from store submission. Service project/export limits still apply. [Official connection](https://www.applaunchflow.com/app-store-screenshots-mcp), [operating guide](https://www.applaunchflow.com/blog/app-store-screenshots-mcp-guide-2026)

The separately advertised screenshot capture skill targets SwiftUI/Flutter. It was not automatically installed for this setup's Expo apps; prepare actual simulator captures through the Expo workflow. [Capture skill description](https://www.applaunchflow.com/app-store-screenshots-mcp)

## Connections not added

- **GitHub MCP:** Start with `gh` and repo documents for Issues/PRs/Projects. If a separate MCP interface proves useful, choose the official server's read-only/toolset configuration. [Server configuration](https://github.com/github/github-mcp-server/blob/main/docs/server-configuration.md)
- **Vercel MCP:** CLI/Git integration is sufficient for initial deployments by design. Add official OAuth MCP when recurring deployment-log investigation warrants it. The service is supported. [Official MCP](https://vercel.com/docs/agent-resources/vercel-mcp)
- **Context7 / general docs MCP:** Omitted by default because they overlap official document lookup. Evaluate when version-specific library documentation becomes a bottleneck.
- **Filesystem / memory / sequential-thinking MCP:** Codex file/search/planning tools and repo Markdown cover current work.
- **Refero / Appkittie / Superwall / OneSignal / Postback / AppsFlyer:** Retain handoff adoption criteria; no guessed account endpoints were added.
- **Store accounts / ads / social publishing:** Select once the first product, channel, and publishing task are defined. The scaffold contains no production-account authentication or deployment/publishing hook.

Check overlap with existing connections per selected service; disable unused MCPs per project. Documentation/endpoints were verified on 2026-09-13. Actual OAuth connectivity and live tool calls require account authentication.
