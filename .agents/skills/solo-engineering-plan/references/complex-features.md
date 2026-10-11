# Complex feature traceability

Use when intertwined platforms, migrations, entitlement risk, external contracts, or several dependent slices justify explicit traceability. This is a local adaptation of Spec Kit; it does not require that CLI or its filesystem conventions.

Keep product intent under `docs/specs/<feature>/spec.md`: user journeys, numbered requirements, acceptance scenarios, assumptions, and measurable outcomes. Put technical architecture, contracts, migration/recovery, and verification in `docs/engineering/<feature>/plan.md`; put stable task IDs, owners, paths, dependencies, and evidence in `docs/engineering/<feature>/tasks.md`. Add research, data-model, or contract files only where they resolve real uncertainty. The run plan links these files without duplicating their full contents.

Slice vertically so a user journey can be implemented and verified coherently. Mark tasks parallel only when inputs are available and file ownership is independent. Separate runtime business KPIs from acceptance checks a build can actually establish. Do not mark implementation complete merely because a requirements checklist passes.

The independent plan reviewer checks conflicting requirements, uncovered acceptance criteria, missing dependencies, speculative complexity, and unsupported assumptions before implementation. After implementation, compare present behavior with the same intent; append traceable remaining tasks without changing prior IDs. Keep the task file unchanged when no gap remains. Record actual tests, visual evidence, release state, and measured outcomes separately.

Source decision and pinned paths: shared `docs/research/architecture-speckit.md` in the toolkit, or `.solopreneur/docs/research/architecture-speckit.md` in an applied product. Source code and installers were not copied.
