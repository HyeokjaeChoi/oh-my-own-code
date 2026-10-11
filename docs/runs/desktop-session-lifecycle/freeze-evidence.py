"""Freeze actual current checks, deliverables and captures before independent review."""
from pathlib import Path
import importlib.util
import json
import struct
import subprocess
import sys

root = Path(__file__).resolve().parents[3]
run = Path(__file__).resolve().parent
run_id = run.name
spec = importlib.util.spec_from_file_location("local_harness", root / ".solopreneur/harness.py")
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)
state = json.loads((run / "run.json").read_text())
contract = json.loads((run / "contract.json").read_text())
inventory = harness.inventory(root)
source = harness.source_fingerprint(root)
environment = harness.environment_fingerprint(root, contract)
changes = harness.changed_paths(state["baseline"], inventory)
deleted = [path for path in changes if path not in inventory]

def save(name, value):
    (run / name).write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")

def cli(*args):
    result = subprocess.run([sys.executable, ".solopreneur/harness.py", *args], cwd=root, text=True, capture_output=True)
    if result.returncode:
        raise SystemExit(result.stdout + result.stderr)
    return result.stdout

checks = {}
for name, definition in contract["checks"].items():
    latest = state["checks"].get(name, [{}])[-1]
    current = latest.get("exit_code") == 0 and latest.get("source_sha256") == source and latest.get("environment_sha256") == environment and not latest.get("inputs_changed")
    if definition["required"] and not current:
        raise SystemExit("Required check is not current: " + name)
    checks[name] = {key: latest.get(key) for key in ("exit_code", "recorded_at", "source_sha256", "environment_sha256", "inputs_changed", "timed_out")}
    checks[name]["current"] = current
save("verification-summary.json", {"source_sha256": source, "environment_sha256": environment, "checks": checks})
save("integration-files.json", {"source_sha256": source, "changed_paths": changes, "deleted_paths": deleted, "files": {path: inventory[path] for path in changes if path in inventory}})

captures = []
for path in sorted(run.glob("*.png")):
    raw = path.read_bytes()
    assert raw[:8] == b"\x89PNG\r\n\x1a\n"
    width, height = struct.unpack(">II", raw[16:24])
    captures.append({"path": str(path.relative_to(root)), "pixel_width": width, "pixel_height": height, "sha256": harness.sha(path), "provenance": "Synthetic test-only main with production Electron renderer/preload" if "synthetic" in path.name else "Actual Electron renderer and app-owned OpenCode sidecar with disposable data; native dialogs substituted in test process", "state": path.stem})
if not captures:
    raise SystemExit("Actual UI captures missing")
save("capture-manifest.json", {"source_sha256": source, "captures": captures})
package = json.loads((run / "package-source-match.json").read_text())
assert package["result"] == "pass"
assert harness.sha(Path(package["archive"])) == package["appAsarSha256"]
if not (run / "report.md").is_file():
    raise SystemExit("Write the actual implementation report before freezing")

artifacts = [path for path in changes if path in inventory]
artifacts += [str(Path(package["archive"]).relative_to(root))]
artifacts += [str(path.relative_to(root)) for path in run.iterdir() if path.name in ("report.md", "verification-summary.json", "integration-files.json", "capture-manifest.json", "package-source-match.json", "package-inspection.json", "electron-evidence.json", "ui-states-evidence.json", "session-lifecycle-evidence.json") or path.name.startswith("current-") and path.suffix == ".log"]
artifacts += [capture["path"] for capture in captures]
artifacts = [path for path in artifacts if (root / path).stat().st_size > 0]
for path in dict.fromkeys(artifacts):
    cli("artifact", run_id, "--file", path)
base = "apps/desktop-app/"
coverage = {
    "AC-1": {"status": "verified", "artifacts": [base + "src/workbench-service.mjs", base + "src/workbench-session.test.mjs"], "checks": ["unit", "electron-session-e2e"]},
    "AC-2": {"status": "verified", "artifacts": [base + "src/renderer/features/sessions/index.tsx", "docs/runs/desktop-session-lifecycle/capture-manifest.json"], "checks": ["unit", "typecheck", "electron-session-e2e", "electron-ui-states"]},
    "AC-3": {"status": "verified", "artifacts": [base + "src/renderer/features/activity/index.tsx", base + "src/workbench-session.test.mjs"], "checks": ["unit", "electron-session-e2e"]},
    "AC-4": {"status": "verified", "artifacts": ["docs/runs/desktop-session-lifecycle/verification-summary.json"], "checks": ["unit", "typecheck", "lint", "format", "build", "bundle", "boundaries", "electron-e2e", "electron-ui-states", "packaged-lifecycle"]},
    "AC-5": {"status": "verified", "artifacts": ["docs/runs/desktop-session-lifecycle/report.md", "docs/runs/desktop-session-lifecycle/package-source-match.json", "docs/runs/desktop-session-lifecycle/capture-manifest.json"], "checks": ["package-macos", "packaged-lifecycle"]},
}
save("outcome.json", {"schema_version": 2, "acceptance": coverage, "changed_paths": changes, "deleted_paths": deleted})
cli("outcome", run_id, "--file", str((run / "outcome.json").relative_to(root)))
for gate in ("code", "design"):
    binding = cli("review-input", run_id, "--gate", gate)
    json.loads(binding)
    (run / f"final-{gate}-binding.json").write_text(binding)
print(json.dumps({"source_sha256": source, "changed_paths": len(changes), "captures": len(captures), "checks": len(checks)}))
