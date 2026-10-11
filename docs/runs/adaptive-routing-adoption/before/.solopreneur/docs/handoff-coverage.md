# Handoff coverage audit

Audited all 28 sections of the archived `handoff (1).md` against the current toolkit on 2026-09-13. Reading and retaining the full handoff does not mean every recommendation was installed or every product action completed.

**Implemented** means reusable local files or tooling exist. **Policy** means a preference or adoption condition is recorded. **Deferred** means actual product work requires a defined product, environment, account, or requested release. These states can coexist for one section.

| Section | Coverage | Evidence and boundary |
|---|---|---|
| 1. Solo founder context | Policy | AGENTS and stack preserve Codex-first work, low subscription overlap, and platform boundaries. |
| 2. Near-final stack | Policy + implemented presets | Stack defaults and optional MCP configurations exist; apps/accounts are not installed. |
| 3. Product management | Implemented + deferred | Product/spec/decision documents and GitHub Issue/PR forms exist; no remote Projects board was created. |
| 4. AI and skills | Implemented + policy | AGENTS, 24 skills, 26 model-agnostic roles, lifecycle hooks, the run ledger, and bulk application exist. Actual external source adaptations are recorded in the research reports. |
| 5. Design | Policy + implemented preparation | Design research/system/QA skills and roles, templates, token boundaries, and Figma MCP preset exist; actual product tokens, Figma libraries, and rendered verification require a product. |
| 6. Web, mobile, API, monorepo | Policy | Preferred stack and shared-package boundaries exist; no runnable Next.js/Expo/Hono monorepo was generated. |
| 7. Supabase | Implemented preset + deferred | Project-scoped read-only MCP preset exists; no authentication, database, or app auth implementation. |
| 8. Hosting | Policy | Vercel preference, commercial-terms check, and evidence-based migration criteria; no deployment. |
| 9. Analytics/observability | Implemented preparation | Separate instrumentation, analytics/experiments, and monitoring skills/roles plus PostHog/Sentry presets and event/runbook templates; no live SDK or dashboards. |
| 10. Monetization | Implemented preparation | RevenueCat preset, subscription skill/template, Superwall adoption condition; no products, entitlement implementation, or purchases. |
| 11. Push, links, attribution | Policy | Expo defaults and conditional AppsFlyer/OneSignal adoption; no push setup or associated domains. |
| 12. App launch/ASO | Implemented preparation | Separate ASO and real-screenshot asset skills/roles, launch templates, AppLaunchFlow preset, and native-ASO preference; no product captures, exports, or submissions. |
| 13. Landing | Policy + implemented workflow | Marketing skill/role and landing brief cover positioning, copy, CTA, and measurement; Next.js and optional AppView remain defaults. No product landing was deployed. |
| 14. Visual asset alternatives | Policy | BrandBird free-only rule; no asset generation. |
| 15. Market research | Policy + implemented workflow | Product/web/design research roles and evidence workflows exist; Appkittie remains a bounded optional subscription with cancellation. No purchase. |
| 16. Social/content | Policy + implemented workflow | Marketing workflow covers launch content and experiments; Postiz remains deferred until scheduling is needed. |
| 17. Excluded services | Policy | Avoid overlapping coding/analytics/reference subscriptions; lifecycle tools remain conditional. |
| 18. Changed conclusions | Policy + presets | AppLaunchFlow prioritized, AppView optional, Postback deferred until paid growth. |
| 19. Final stack flow | Policy + preparation | Service roles span product, design, development, launch, and growth; integrations are not running end to end. |
| 20. Cost estimates | Historical only | Original numbers retained in archive, not recalculated or represented as current prices. |
| 21. Cost optimization | Policy | Distinct service roles, minimal overlap, add tools for real bottlenecks. |
| 22. Adoption phases | Policy | Foundation preferences, first-release tools, then conditional monetization, paid growth, and market intelligence; no universal install-all phase. |
| 23. Codex workflow | Implemented | model-inheriting entry planning/review routes through 26 roles and 24 skills, with factual retrieval, observation-only QA, and durable evidence gates from idea to monitored iteration. Use stages appropriate to the request. |
| 24. Decision summary | Policy | Stack and adoption criteria preserve the main choices. |
| 25. Pricing caveats | Policy | Verify official pricing and terms at purchase time; no current cost guarantee. |
| 26. Research sources | Recorded | Original source list retained; sources actually used for setup are documented separately. Five named ecosystems now have pinned actual-source reports; unrelated listed vendors are not implied to have received source review. |
| 27. Next actions | Partially implemented | Codex baseline complete. Event/subscription/design/launch templates and presets prepare later work; actual apps, tokens, integrations, screenshots, and KPI validation remain deferred. |
| 28. Operating philosophy | Policy + implementation | Codex-centered repository workflows with specific service roles and conditional additions. |

## Initial baseline and current expansion

The initial setup read the handoff but supplied only six original product skills, three roles, and general ecosystem policies. It did not inspect the actual gstack, Matt Pocock, ECC, Superpowers, or Spec Kit repositories. That was insufficient for the user's intended source-derived agent harness; the current expansion corrects it.

The current work inspected actual repository instructions, agents, hooks, packaging/integration code, scripts, and licenses at pinned commits. It adopted selected mechanisms into native Codex roles, scoped skills, command hooks, and executable local evidence tooling:

- [gstack and Matt Pocock](research/gstack-matt.md): demand/scope review, ordered plan reviews, dependency-aware slices, and rendered design evidence.
- [ECC and Superpowers](research/ecc-superpowers.md): code exploration, root-cause diagnosis, meaningful test cycles, independent reviews, durable context, and completion evidence.
- [Spec Kit](research/architecture-speckit.md): optional spec/plan/task traceability for large or complex features.

All six handoff ecosystem distinctions remain in the [skill catalog](skill-catalog.md#external-skill-ecosystem-policy). Claude-specific material was reconstructed for native Codex tooling; vendor installers and whole bundles were not run. The [stack](stack.md) retains the restored free-research, BrandBird, Appkittie, lifecycle-service, and native-ASO conditions.

The earlier expansion fixed role models and efforts, but the 2026-09-24 policy supersedes that routing. All 26 shared roles now omit model and effort, and the primary and fresh specialists inherit the current conversation settings unless the user explicitly requests a supported override.

## Example workflow mapping

| Handoff example | Current implementation |
|---|---|
| product-review | `solo-product-spec`, product_research, product_manager |
| ui-review | `solo-design-review`, independent design_qa; research/system roles prepare inputs |
| engineering-review | `solo-engineering-plan`, independent plan_reviewer, `solo-code-review`, reviewer |
| tdd | `solo-tdd`, test_engineer; conditional on behavior and risk |
| debugging | `solo-debugging`, bug_analyst; reproduce, isolate, patch, verify |
| aso | `solo-aso`, aso_specialist |
| app-store-screenshots | `solo-store-launch`, store_assets; actual captures and exports |
| release | `solo-release`, release_engineer |
| analytics-review | `solo-analytics-experiment`, analytics_analyst |
| Subscription/monetization | `solo-subscription-check`, monetization_engineer |
| Marketing/landing | `solo-marketing`, marketing_specialist, engineer |
| Monitoring and iteration | `solo-monitoring`, reliability_engineer; analytics feeds the next reviewed plan |

The full handoff is retained unchanged. Local workflow implementation does not imply product creation, account authentication, service purchases, a deployed application, or measured KPIs. See [harness operation](harness.md) and [runtime activation](codex-runtime.md).
