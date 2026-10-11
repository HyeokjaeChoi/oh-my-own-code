---
name: solo-monitoring
description: Define, implement, or audit Sentry monitoring, service health signals, alerts, and incident recovery for a specific product path.
---

# Monitoring and reliability

Scope monitoring around a user journey or operational failure that needs detection and response. Use Sentry for exceptions and performance; use PostHog for product behavior. Read the relevant architecture, release record, and `docs/operations/` runbook when present.

For each selected signal, define what it detects, source, environment, ownership, actionable context, threshold or anomaly condition, notification destination, and response. Prefer a small set of symptoms tied to user impact over broad logging. Scrub secrets and unnecessary personal data, preserve useful error causes and correlation identifiers, and avoid high-cardinality tags.

When implementing instrumentation, capture failures at the boundary that can add context or recovery state. Avoid duplicate reporting at every layer and avoid swallowing errors after capture. For performance work, identify the measured transaction or operation and compare on the same environment and traffic basis.

Write or update a focused runbook under `docs/operations/` using the project convention or `runbook-template.md`. Include detection, triage queries, safe mitigations, rollback or forward-fix path, escalation or owner, and the evidence that confirms recovery. Test alerts or failure capture in a safe development/staging path when available; distinguish local SDK invocation, provider ingestion, alert delivery, and incident recovery because each is a separate claim.

Collect routine operations evidence. Escalate ambiguous incident causes, recovery choices, or go/no-go judgment to the coordinator or `bug_analyst`; do not escalate every routine observation. For an active run, the coordinator registers the runbook with `python3 .solopreneur/harness.py artifact <run-id> --file <runbook-path>` and executes safe monitoring checks through `check <run-id> --name <name>`. Record revision, environment, controlled trigger, observed event or trace identifier without private data, alert result, and unverified stages. Do not change production alerts, retention, integrations, or incident state unless included in the request and authorization.
