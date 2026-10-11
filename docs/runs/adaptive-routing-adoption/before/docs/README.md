# Project docs

Complete only the documents needed by the reviewed plan. Copy `*-template.md` under the actual feature, experiment, release, or run name. Blank fields and generated ledgers do not represent completed decisions or verification.

| Need | Document |
|---|---|
| Customer, problem, goals | [Product brief](product/brief.md) |
| Feature scope and acceptance criteria | [Feature spec](specs/feature-template.md) |
| Key choices and rationale | [Decision record](decisions/decision-template.md) |
| Current flow and reference evidence | [Design research](design/research-template.md) |
| Semantic tokens, component states, platform rules | [Design system](design/system.md) |
| Independent implemented-screen evidence | [Design review](design/review-template.md) |
| Architecture, dependencies, risks, implementation slices | [Engineering plan](engineering/plan-template.md) |
| Event contracts and metric definitions | [Events](analytics/events.md) |
| Hypothesis, variants, results, next decision | [Experiment record](experiments/experiment-template.md) |
| Subscription products and access | [Subscription model](monetization/subscriptions.md) |
| Store positioning, metadata, keywords, native experiments | [ASO brief](growth/aso.md) |
| Real captures, screenshot storyboard, localization, exports | [Store assets](launch/store-assets.md) |
| Existing combined ASO/asset record | [Store listing](launch/store-listing.md) |
| Landing page or campaign message and measurement | [Marketing brief](marketing/brief.md) |
| Validation, rollout, recovery, observation | [Release record](releases/release-template.md) |
| Monitoring signals, triage, recovery | [Operations runbook](operations/runbook-template.md) |

New work should use the separate ASO and store-asset documents; `launch/store-listing.md` remains available for products that already use the combined format.

The confirmed execution plan is `docs/runs/<run-id>/plan.md`, paired with a schema v2 `contract.json` of acceptance IDs, exact checks, document versions, and approvals, with revision, decisions, acceptance criteria, open questions/dependency holds, assignments, checks, and change history. Every handoff references its current path/version. Product/design documents retain their domain ownership and are linked from that task-plan SSOT. Register PRDs for independent product review and design contracts, including backend API/schema/security/state/error contracts, for independent design-spec review before dependent implementation; store bound JSON reports in the run directory. Product specs stay under `docs/specs/`; technical plans and tasks stay under `docs/engineering/`. Implemented-screen QA remains a separate review.

The planner stores active plan, review, check, and outcome evidence under `docs/runs/<run-id>/`. Follow the portable [harness protocol](../.solopreneur/docs/harness.md) and [role catalog](../.solopreneur/docs/agent-catalog.md). Keep product intent in repository Markdown and link GitHub Issues/PRs to it. Exclude API keys, passwords, signing keys, private environment files, and raw customer data.
