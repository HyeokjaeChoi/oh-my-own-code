# Product stack and adoption criteria

Baseline: all 28 sections of the 2026-09-13 handoff. These are starting preferences, not completed account connections, subscriptions, or deployments. Record product decisions in its `docs/decisions/`.

## Defaults

| Area | Preference | Scope |
|---|---|---|
| Product and execution | Repo Markdown + GitHub Issues / Projects | Intent in Markdown, progress in Projects, implementation in Issues / PRs |
| Development | Codex | Do not automatically add other AI development subscriptions |
| Design | Figma + repo design tokens | Define token source and export direction per product |
| Web | Next.js + Tailwind + shadcn/ui + Radix | Products needing web |
| Mobile | React Native + Expo + Expo Router + NativeWind | Products needing mobile |
| API | Consider Hono first | When a separate API is needed; do not scaffold a server for every product |
| Workspace | pnpm + Turborepo | Multiple apps/packages |
| Auth / DB / Storage | Supabase | Connect only needed services |
| Product analytics | PostHog | Events, funnels, retention, flags, experiments |
| Error monitoring | Sentry | Crashes, exceptions, performance issues |
| Subscriptions | RevenueCat | Products with paid entitlements and purchases |
| Notifications and links | Expo Notifications + Expo Router | When needed; direct universal/app links for ordinary sharing |
| Launch assets | AppLaunchFlow | Handoff priority candidate; verify integration/export support before use |
| Landing pages | Next.js; optional AppView | Adopt templates after checking license if they save time |
| Hosting | Prefer Vercel | Verify current plan terms for commercial use |

Preferences alone do not authorize creating dependencies, paid plans, organization accounts, or remote projects. Start with the first product's required platforms and user flows.

## Structure when a monorepo is needed

```text
apps/
  web/                 # Next.js when needed
  mobile/              # Expo when needed
  api/                 # Hono when needed
packages/
  design-tokens/       # semantic tokens, export contracts
  api/                 # API contracts / client
  validation/          # boundary validation, e.g. Zod
  analytics/           # event contracts
  config/              # shared development configuration
  icons/               # shared assets
  ui-web/              # web implementation
  ui-mobile/           # mobile implementation
```

Share types, schemas, API contracts, tokens, event definitions, and pure business rules. Keep web/mobile UI, navigation, and platform interactions platform-specific. This is structural guidance, not a claim that these apps exist or run.

## Evaluate when a real bottleneck appears

| Candidate | Adoption evidence |
|---|---|
| Refero | Recurring UI/flow research cost; serves a different purpose from Figma |
| Superwall | Paywall variants and remote experiments constrain subscription optimization |
| AppsFlyer OneLink / Postback | Active paid acquisition needs attribution or revenue linkage |
| OneSignal | Segmentation/journey operations exceed Expo push capabilities |
| Appkittie | Subscribe only for a bounded research sprint; cancel after the sprint |
| One ASO SaaS | Native store tools cannot support recurring keyword/rank/competitor analysis |
| Postiz | Scheduled social publishing is a demonstrated recurring cost |
| Cloudflare services | Observed cost/performance problems justify migration and operational complexity |
| Braze / Customer.io | Lifecycle marketing becomes a core channel and event-driven messaging or segmentation/journeys require it |

Avoid redundant subscriptions: Mixpanel/Amplitude alongside PostHog, ongoing Mobbin alongside Refero, or multiple paid screenshot tools alongside AppLaunchFlow. Use BrandBird only as a free utility; do not add a paid subscription. Start design research with Figma Community, Land-book, and free web references before adding subscriptions. Follow the [external skill ecosystem policy](skill-catalog.md#external-skill-ecosystem-policy) when considering workflow packages.

For initial ASO, prefer native store tools from the handoff: Apple's Product Page Optimization, Custom Product Pages, and App Analytics; Google's store listing experiments and custom store listings. Verify current availability when preparing a product's experiment.

## Decisions still needed per product

- Target customer, problem, core flow, platforms, and locales.
- Figma token source/export direction, formats, and semantic names.
- Activation/retention definitions and event ownership.
- Entitlements, store products, offerings, account switching, and restore policy.
- Service IDs per environment, login permissions, domains, app identifiers, and deployment targets.
- Spending limits, paid-service rationale, and plan review date.

Preserve handoff prices as historical research. Do not reuse them as current prices, terms, or quotes. Before purchasing, check official pricing/contract pages and record source, date, and billing unit.
