# Projection fixture v5 correction
Revision: 1 | Date: 2026-10-08 | Work class: routine

Outcome: restore the existing assistant-ui/Tool UI static rendering regression against the accepted closed v5 snapshot contract. Reproduced parent unit failure: snapshot rejected and null.messages read. Existing typed clock/recovery/retained requirements remain unchanged.

Primary owns only apps/desktop-app/src/workbench-projection.test.mjs. Add the required positive observation sequence, ready recovery and empty retained handles; assert snapshot admission before renderer dispatch. Preserve real installed assistant-ui, LinkPreview validation, escaped unsafe fallback and permission UI assertions. No production source, DTO, dependencies, Native, GUI, provider or private data changes.

Checks: actual SSR regression, affected parent unit suite, targeted lint and formatting. Independent fresh code reviewer inspects the narrow change after checks. No new plan/design review: existing accepted v5 design is reused. Failure evidence and successful checks are preserved. Rollback restores only the fixture. No consequential unresolved decision blocks this correction. Continue parent acceptance mapping separately; this run does not approve or finish the parent product.
