# PRD to issue slices

Start from an approved product or feature spec. Read the complete source and its linked decisions before proposing execution work.

Each issue should deliver a narrow, complete path through the layers it needs, such as contract, service, UI, analytics, and validation. A completed issue must be demonstrable or independently verifiable and fit in one fresh implementation context. Do not create one issue per technical layer.

For every proposed issue record:

- a user-outcome title;
- the parent PRD or issue;
- what the issue makes work;
- observable acceptance criteria;
- blockers by issue identifier or draft number;
- relevant validation and evidence;
- explicit exclusions when adjacent scope is tempting.

Order blockers before dependants. Work can start at the frontier: every issue whose blockers are complete. Merge slices that cannot provide separate evidence; split slices that need unrelated decisions or cannot fit a fresh context.

Use expand-migrate-contract only for a genuine wide mechanical change that cannot remain green as a vertical slice. Add the new form compatibly, migrate bounded groups, then remove the old form after all migrations complete.

Present the issue graph before remote publication when publication was not already requested. If GitHub issue creation is authorized, create issues in dependency order, use native sub-issue or blocking links when available, and record the resulting URLs in the run report. Do not close or rewrite a parent PRD issue unless requested.
