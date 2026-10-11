# Subscription model

Status: Draft / RevenueCat and store settings unverified

Supported platforms / RevenueCat project / sandbox identifiers:

## Products and access

| Entitlement | Features | Apple product ID | Google product/base plan | Offering/package | Status |
|---|---|---|---|---|---|
| TBD | TBD | TBD | TBD | TBD | Not configured |

Actual store price/currency/period/trial settings and verification date:

Free features and paid access boundary:

## Accounts and state

- App user ID source and anonymous→logged-in linking:
- Restore / cross-device / account switching policy:
- Client entitlement refresh and offline/stale handling:
- Backend paid resource access checks and authoritative source:

| Scenario | Expected access/screen | Actual observation and environment |
|---|---|---|
| New purchase and restore | TBD | Unverified |
| Canceled but still valid | TBD | Unverified |
| Expired/refunded | TBD | Unverified |
| Login/logout/account switch | TBD | Unverified |

## If using webhooks

Authentication, secret storage location name (no values), sandbox distinction, deduplication key, state reconciliation for delayed/out-of-order delivery, failure observation and replay:

## Measurement

Paywall exposure→purchase→active entitlement event definitions, client/server deduplication, and RevenueCat/PostHog integration:
