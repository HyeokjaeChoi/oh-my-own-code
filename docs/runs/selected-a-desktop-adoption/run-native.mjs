// Each attempt is immutable. Existing production evidence runner retains provenance.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
const out = `docs/runs/frontend-architecture-redesign/execution/selected-a-${Date.now()}-${randomUUID()}`;
const result = spawnSync(
  process.execPath,
  [
    "apps/desktop-app/scripts/run-evidence.mjs",
    "--out",
    out,
    "--script",
    "ui-states",
  ],
  { stdio: "inherit" },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
