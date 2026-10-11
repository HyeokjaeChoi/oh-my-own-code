# Event contracts and key metrics

Status: Draft / Instrumentation not implemented

PostHog project / region / environment:

Updated:

## Identity and collection

- Anonymous identification and login linking:
- Internal/test user exclusions:
- Client / server emission ownership and deduplication:
- Allowed properties and personal data/secret exclusions:
- Replay consent / masking / retention policy:

## Events

Names below are examples. Select only needed rows after defining core product actions, then confirm triggers and emission ownership. These events are not necessarily implemented or collected.

| Event | Exact meaning and trigger | Emitter | Allowed properties | Deduplication key/rule | Status |
|---|---|---|---|---|---|
| `signup_completed` | Confirmed account creation; define for the product | TBD | TBD | TBD | Candidate |
| `core_action_completed` | Rename to the actual action delivering first/repeated product value | TBD | TBD | TBD | Candidate |
| `paywall_viewed` | Actual paywall exposure | TBD | TBD | TBD | Subscription candidate |
| `subscription_activated` | Authoritative entitlement activation; distinct from purchase button clicks | TBD | TBD | TBD | Subscription candidate |

## Metrics

| Metric | Cohort | Numerator | Denominator | Time window and timezone | Exclusions |
|---|---|---|---|---|---|
| Activation | TBD | TBD | TBD | TBD | TBD |
| Retention | TBD | TBD | TBD | TBD | TBD |

## Implementation/analysis evidence

SDK/server implementation location, query or dashboard link, sample verification date, known gaps or instrumentation changes:
