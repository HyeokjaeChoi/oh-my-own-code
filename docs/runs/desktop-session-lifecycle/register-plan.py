"""Register the next bounded plan through the project ledger."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys

root = Path(__file__).resolve().parents[3]
run = root / "docs/runs/desktop-session-lifecycle"
core = json.loads((root / "docs/runs/desktop-workbench-core/contract.json").read_text())
checks = core["checks"]
checks["unit"]["argv"] += ["apps/desktop-app/src/workbench-session.test.mjs", "apps/desktop-app/src/session-navigation.test.mjs"]
checks["unit"]["scope"] = "Session lifecycle, receipt safety, diagnostics redaction, navigation projection and existing core regressions"
checks["unit"]["acceptance_ids"] = ["AC-1", "AC-2", "AC-3", "AC-4"]
checks["electron-session-e2e"] = {
    "argv": ["node", "apps/desktop-app/scripts/e2e-session-lifecycle.mjs"], "cwd": ".",
    "scope": "Actual Electron session organization/fork/delete and local diagnostics with disposable sidecar data and project-file sentinels",
    "acceptance_ids": ["AC-1", "AC-2", "AC-3", "AC-4", "AC-5"], "required": True,
}
checks["electron-ui-states"] = {
    "argv": ["node", "apps/desktop-app/scripts/e2e-workbench-states.mjs"], "cwd": ".",
    "scope": "Existing actual-renderer synthetic tool/permission/unknown-state and layout regressions",
    "acceptance_ids": ["AC-2", "AC-4"], "required": True,
}
checks["packaged-lifecycle"] = {
    "argv": ["node", "apps/desktop-app/scripts/e2e-smoke.mjs", "packaged", "darwin"], "cwd": ".",
    "scope": "Current native macOS package launch, sender isolation, sidecar crash/restart and owned cleanup",
    "acceptance_ids": ["AC-4", "AC-5"], "required": True,
}
contract = {
    "schema_version": 2,
    "acceptance": [
        {"id": "AC-1", "description": "Checked, idempotent session lifecycle without project-file deletion"},
        {"id": "AC-2", "description": "Usable actual desktop session organization and correct selection/draft state"},
        {"id": "AC-3", "description": "Bounded redacted local execution observations with honest limits"},
        {"id": "AC-4", "description": "Current native and static regressions preserve existing architecture and security"},
        {"id": "AC-5", "description": "Verified macOS package, captures and independent final reviews with parent gaps retained"},
    ],
    "checks": checks,
    "documents": [{"path": "docs/runs/desktop-session-lifecycle/interface.md", "gate": "design_spec", "version": "3", "sha256": hashlib.sha256((run / "interface.md").read_bytes()).hexdigest()}],
    "user_approvals": [], "environment_files": ["pnpm-lock.yaml"],
    "decision_register": [
        {"id": "autonomous-continuation", "statement": "Continue authorized local implementation using the selected Electron/sidecar architecture.", "status": "confirmed", "source": "User explicitly enabled full approval mode and requested autonomous remaining work; earlier product platform choices remain.", "impact": "Reversible local implementation and disposable tests; no publication or personal credential use.", "blocks": [], "resolution": "Deliver the bounded session lifecycle increment, preserving all F-01-18 parent requirements."},
        {"id": "temporary-session-organization", "statement": "Keep session pin/archive and observation data in the existing temporary runtime.", "status": "assumption", "source": "Permanent data path/retention remains an unresolved parent choice.", "impact": "No silent permanent storage; organization is explicitly lost with the temporary runtime.", "blocks": [], "resolution": "Use reversible app metadata; durable data selection/recovery stays in the parent backlog."},
        {"id": "native-history-deletion", "statement": "Implement user-triggered native-confirmed conversation deletion, not filesystem deletion.", "status": "delegated", "source": "Approved PRD F-03/F-04 and autonomous implementation instruction.", "impact": "App UI must show the exact target and preserve project directories; development uses disposable sessions only.", "blocks": [], "resolution": "Default-cancel native dialog, idle/ownership rechecks, descendant guard and duplicate receipts before/after exact SDK removal."},
    ],
}
(run / "contract.json").write_text(json.dumps(contract, indent=2) + "\n")
def cli(*args):
    result = subprocess.run([sys.executable, ".solopreneur/harness.py", *args], cwd=root, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if result.returncode:
        raise SystemExit(result.stdout)
    return result.stdout
print(cli("plan", "desktop-session-lifecycle", "--file", "docs/runs/desktop-session-lifecycle/plan.md", "--contract", "docs/runs/desktop-session-lifecycle/contract.json"), end="")
binding = cli("review-input", "desktop-session-lifecycle", "--gate", "plan")
json.loads(binding)
(run / "plan-binding.json").write_text(binding)
print("Plan binding prepared. Register the independent entry review before preparing dispatch packets.")
