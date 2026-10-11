---
name: solo-subscription-check
description: Define or audit RevenueCat product mappings, entitlements, purchase and restore flows, or subscription webhooks.
---

# Subscription check

Check the requested subscription behavior against `docs/monetization/subscriptions.md` and the current implementation. Execute reviewed purchase, entitlement, and webhook contracts with sandbox tests. Establish the relevant platform, environment, entitlement identifiers, store-product mapping, and identity model. Keep account configuration that was not inspected marked unverified.

For client access, inspect the named active entitlement instead of treating a successful button tap, local boolean, or renewal preference as proof of access. Cancellation and expiration represent different states. Check the purchase/restore and login/logout behavior relevant to the change, including stale or unavailable status. See [RevenueCat CustomerInfo](https://www.revenuecat.com/docs/customers/customer-info) for current SDK behavior.

For paid server resources, inspect how the backend obtains authoritative entitlement state and enforces access for the authenticated user. A client-supplied entitlement flag must not authorize server access. Keep secret API keys on the server; use the provider's public SDK keys only in their intended client context.

For webhook work, verify the configured authentication mechanism, environment routing, duplicate handling, and reconciliation of delayed events. Use [RevenueCat webhooks](https://www.revenuecat.com/docs/integrations/webhooks) for the current delivery contract and available verification methods. Avoid deriving current subscription state solely from event arrival order.

Choose validation cases from the behavior being changed: purchase, restore/reinstall, account switch, cancellation before expiration, refund/expiration, offline status, or duplicate delivery. Use sandbox transactions or fixtures for development and label what was actually exercised.

Return concrete access or revenue risks with code/config evidence and the smallest correction. Escalate unresolved billing policy, event ordering/idempotency, account-state, or conflicting-evidence judgment to the coordinator and independent code review. Update the subscription mapping or state table if requested. For an active run, the coordinator executes sandbox or fixture checks through `python3 .solopreneur/harness.py check <run-id> --name <name>` and registers the updated subscription document with `artifact`. Give monetization implementation to the scoped engineer and code-gate it through the independent reviewer; neither a local test nor SDK return value proves live store configuration. A check does not change live products, prices, subscriber entitlements, or accounts; an explicit implementation or operations request defines those actions.
