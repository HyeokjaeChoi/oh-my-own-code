---
name: solo-analytics-instrumentation
description: Implement or audit product analytics events, identity, consent, and delivery across web, mobile, and API code.
---

# Analytics instrumentation

Start from the product decision and metric the events must support. Read `docs/analytics/events.md` and the relevant feature spec. Define or confirm each event's semantic trigger, emitter, identity state, allowed properties, deduplication rule, environment, and downstream owner before editing code.

Keep matching event names and property contracts shared across platforms, while placing SDK calls in platform-specific adapters. Assign one authoritative emitter for facts such as purchases, entitlement activation, and server-completed work. Client intent, provider callbacks, and backend confirmation are different events unless the documented model deliberately unifies them.

Exclude secrets and unnecessary personal data. Apply the product's consent, replay masking, retention, internal-user exclusion, and environment separation rules. Do not put server keys in clients or accept client-supplied revenue or entitlement state as authoritative.

Implement the smallest path that captures the documented trigger. Verify payload shape and identity before and after login, relevant retry or duplicate behavior, and development/production routing. Prefer a provider debug view, controlled transport capture, or adapter test that observes the emitted event. A function call in source is not proof that PostHog received or stored it; record delivery as unverified when the connected environment cannot be inspected.

Update `docs/analytics/events.md` with implementation locations and current status. For an active run, the coordinator executes local or integration checks through `python3 .solopreneur/harness.py check <run-id> --name <name>` and registers the updated contract with `artifact`. Record event samples with private values removed, observation method, environment, revision, result, and unresolved provider-side verification. Do not create dashboards, flags, experiments, or production traffic changes unless they are included in the request and authorization.
