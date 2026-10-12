# Oh My Own Code — agent instructions

Respond to the user in Korean. Keep code, identifiers, paths and commands in their original form.

## Workflow (replaces the former Solopreneur harness)

1. **Plan** — read the PRD row (`docs/product/prd.md`) and current status (`docs/engineering/backlog-status.md`); state scope briefly.
2. **Implement** — a cheaper model (Sonnet/Haiku) implements on its own branch/worktree with focused tests; verify in the real app (launch it), not only unit tests.
3. **Review per major stage only** — one fresh-context Opus review at the end of each large stage (not every small fix); fix critical/major findings, then merge. Minors go to `backlog-status.md`.
4. **Final** — Playwright e2e against the real app, including an actual chat round-trip.

Priority: a working product first. Prefer simple, conventional safety (Native/OpenCode permission prompts, `external_directory` deny, path containment, git hardening) over elaborate proof machinery. `docs/runs/**` is historical evidence only.

## Checks (all must pass before merge)

```sh
TMPDIR=<private dir> ./node_modules/.bin/nx run desktop-app:test --skip-nx-cache
./node_modules/.bin/nx run desktop-app:typecheck
./node_modules/.bin/nx run desktop-app:lint
./node_modules/.bin/nx run desktop-app:format-check
./node_modules/.bin/nx run desktop-app:boundaries
```

Permission tests are sensitive to a shared `$TMPDIR`; use a private one when running suites in parallel.

## Code rules

- The shipping app is `apps/desktop-app` (Electron main `src/*.mjs` + `src/host/*`, renderer `src/renderer/` with Feature-Sliced Design). `apps/workbench-web` is an older scaffold.
- Renderer ↔ main only through closed, validated IPC (`src/workbench-contract.mjs` or a dedicated `desktop:v1:*` channel with its own validator).
- One owner per state; don't duplicate authoritative permission/execution/message state across stores.
- Smallest change that meets the requirement; no speculative abstractions; no new dependencies without user approval.
- Never weaken: permission deny floor (`external_directory`), path containment/symlink checks, native confirmation for destructive actions, secret redaction.
- Keep secrets out of tracked files, logs and renderer bundles.
