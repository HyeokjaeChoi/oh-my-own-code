---
name: solo-project-start
description: Start a new product or development engagement by clarifying its name, starting material, target outcome, and technical scope; require approved PRD and design resources for development-only implementation.
---

# Start a project

Use this for a new product idea or a new development engagement. For a task inside an already active project, use `$solo-orchestrate` directly. This skill selects the path; `$solo-orchestrate` owns the run, plan SSOT, clean-context assignments, reviews, and ledger. Read the relevant reference below only after identifying the starting point.

## Intake and setup

Inspect answers already supplied. Ask for a human-readable project name, an **existing parent directory outside the Solopreneur toolkit** for a new product (or the exact external Git root for an existing product), a short description or spec path, the desired stopping point, and any fixed platform or deadline. Do not silently choose a destination. Show the resolved absolute `<parent>/<slug>` path before setup and resolve ambiguity about the intended location. Present the work choices in plain language:

- **Starting material:** idea to explore; existing product brief/PRD/spec; or existing codebase.
- **Target outcome:** decision one-pager; approved PRD and coordinated specs; verified working product; or authorized release plus initial monitoring and metric follow-up.
- **Build slice:** full stack, frontend, backend, mobile, design, or another stated scope. A slice is independent of the start and end points.

Ask focused follow-ups only for choices that affect the next stage. Challenge vague audience, problem, success signal, scope, or constraints until the next deliverable is defensible. Do not require answers for distant stages or interpret silence as approval. Record confirmed choices and unanswered dependency holds in the current run plan.

Before `new` or `apply` changes files, use `$solo-orchestrate` to create and independently review a compact kickoff/setup plan in the current Solopreneur workspace. For a new independent repository, derive a lowercase slug from the approved project name, verify the chosen external parent already exists and `<parent>/<slug>` does not, then run `python3 scripts/solo.py new <slug> --parent <parent>` from the Solopreneur source. Keep the human name separately in product documents. For an existing independent external Git root, inspect it and run `python3 scripts/solo.py apply <absolute-project-path> --dry-run` before applying managed files; resolve conflicts without overwriting local edits. The toolkit keeps only a path registry for bulk sync, never a product directory. The launcher `solo.py start` opens a separate CLI session, so do not use it as a way to continue this conversation. Continue as coordinator in the product workspace, read its `AGENTS.md`, and create/review a product-stage plan there. If the location or import would change an existing repository materially, clarify that choice first.

Use [idea-to-launch.md](references/idea-to-launch.md) for an idea, an unvalidated opportunity, a supplied brief/PRD needing further specs, or design-only creation from approved product direction; start at the first missing approved stage. Use [development-entry.md](references/development-entry.md) when the requested outcome is coding from a supplied contract or codebase. Development-only coding requires a completed approved PRD and separate relevant design resources; an existing repository alone is not sufficient. For a request ending at a decision or spec, stop there and report the next decision; do not perform later stages. Existing user authorization governs routine execution, while the named content approval checkpoints in the idea path require an explicit user answer tied to the reviewed artifact version. User sign-off and independent specialist review are separate evidence.
