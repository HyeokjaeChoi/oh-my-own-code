---
name: solo-analytics-experiment
description: Define product events, analyze a funnel or retention cohort, or design and assess a PostHog experiment.
---

# Analytics and experiments

Use PostHog for product behavior and experiments; keep Sentry responsible for reliability. Start from the decision the analysis should support. Read `docs/analytics/events.md` or `docs/experiments/experiment-template.md` only for the requested mode. Use `solo-analytics-instrumentation` when the task is to implement or audit event emission rather than analyze product data.

- Event design: define the semantic trigger, emission owner, identity, deduplication rule, allowed properties, and environment. Assign one owner to revenue and entitlement facts so client callbacks and server events do not double count them. Keep event contracts shared across web/mobile/API where semantics match. Exclude secrets and unnecessary personal data; replay capture follows the product's consent and masking choices.
- Funnel or retention analysis: state source, project, time range, timezone, cohort eligibility, denominator, exclusions, and event definitions. Check instrumentation changes and missing/doubled events before explaining a movement. Describe association as association; use absolute counts alongside rates.
- Experiment: define hypothesis, eligible population, assignment unit, exposure, primary outcome, guardrail, and decision horizon. Compare users by assignment or valid exposure, not by later conversion or retention. Inspect allocation imbalance and variant contamination. Record method, sample size, uncertainty, and inconclusive results; do not invent significance or an uplift target.

With no connected dataset, produce definitions, a query, or an analysis plan and label it as unexecuted. With data, preserve query/filter provenance in the artifact. Include source project, query or dashboard identifier, period, timezone, data freshness, and absolute counts. Traffic or flag mutations follow the user's requested scope and existing authorization; analysis alone does not launch an experiment.

For an active run, the primary agent registers analysis outputs with `python3 .solopreneur/harness.py artifact <run-id> --file <path>`, saves the read-only `analytics_analyst` review, and registers `review <run-id> --gate analysis --reviewer analytics_analyst --verdict ... --evidence <review-path>`. A passing analysis gate confirms the reasoning and provenance were reviewed; it does not make unobserved provider data real.

Use the current [PostHog experiment documentation](https://posthog.com/docs/experiments) for provider-specific configuration and statistics. Prefer the smallest next learning step when traffic cannot support a useful experiment.
