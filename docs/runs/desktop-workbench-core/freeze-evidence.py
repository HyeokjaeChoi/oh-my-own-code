"""Freeze observed evidence and register it using the public ledger CLI."""
from pathlib import Path
import importlib.util
import json
import struct
import subprocess
import sys

root = Path(__file__).resolve().parents[3]
run = root / "docs/runs/desktop-workbench-core"
spec = importlib.util.spec_from_file_location("local_harness", root / ".solopreneur/harness.py")
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)
state = json.loads((run / "run.json").read_text())
contract = json.loads((run / "contract.json").read_text())
inventory = harness.inventory(root)
source = harness.source_fingerprint(root)
environment = harness.environment_fingerprint(root, contract)
changes = harness.changed_paths(state["baseline"], inventory)
deleted = [name for name in changes if name not in inventory]
checks = {}
for name, definition in contract["checks"].items():
    latest = state["checks"][name][-1]
    current = latest["exit_code"] == 0 and latest["source_sha256"] == source and latest["environment_sha256"] == environment and not latest.get("inputs_changed")
    if definition["required"] and not current:
        raise SystemExit(f"Required check is not current: {name}")
    checks[name] = {key: latest.get(key) for key in ["exit_code", "recorded_at", "source_sha256", "environment_sha256", "inputs_changed", "timed_out"]}
    checks[name]["current"] = current

def save(name, value):
    (run / name).write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")

for name in ["integration-files.json", "verification-summary.json", "report.md"]:
    previous = run / name
    historical = run / ("previous-" + name)
    if previous.exists() and not historical.exists():
        historical.write_bytes(previous.read_bytes())
save("integration-files.json", {"source_sha256": source, "changed_paths": changes, "deleted_paths": deleted, "files": {name: inventory[name] for name in changes if name in inventory}})
save("verification-summary.json", {"source_sha256": source, "environment_sha256": environment, "checks": checks})
real = json.loads((run / "electron-evidence.json").read_text())
synthetic = json.loads((run / "ui-states-evidence.json").read_text())
development = json.loads((run / "final-lifecycle-dev.log").read_text().strip())
packaged = json.loads((run / "final-lifecycle-packaged.log").read_text().strip())
package = json.loads((run / "package-source-match.json").read_text())
for evidence in [real, synthetic, development, packaged, package]:
    assert evidence["result"] == "pass"
assert packaged["appAsarSha256"] == package["appAsarSha256"]
save("supplementary-verification.json", {
    "source_sha256": source,
    "ui_states": {"argv": ["node", "apps/desktop-app/scripts/e2e-workbench-states.mjs"], "exit_code": 0, "evidence": "docs/runs/desktop-workbench-core/ui-states-evidence.json", "provider_execution": False},
    "development_lifecycle": development,
    "packaged_lifecycle": packaged,
    "package_source_match": package,
})
captures = []
for item in [*[{"path": p, "provenance": "Actual packaged-source Electron renderer with owned OpenCode sidecar and disposable files; no provider credentials", "state": Path(p).stem} for p in real["screenshots"]], *synthetic["screenshots"]]:
    path = Path(item["path"])
    raw = path.read_bytes()
    assert raw[:8] == b"\x89PNG\r\n\x1a\n"
    width, height = struct.unpack(">II", raw[16:24])
    captures.append({**item, "path": str(path.relative_to(root)), "pixel_width": width, "pixel_height": height, "sha256": harness.sha(path)})
save("capture-manifest.json", {"source_sha256": source, "captures": captures})

report = f"""# Desktop workbench core: verified integration

Date: 2026-09-29. Plan revision 2. Interface version 2.

## Delivered behavior

The actual Electron application now has workspace import/create/list removal,
session switching, an assistant-ui composer and transcript, validated message,
interrupt and once/reject permission operations, runtime catalogs/slash commands,
and contained read-only file preview. Schema-compatible results render through
the owned Tool UI component; unknown results remain inert escaped text.

The runtime client and credentials stay in main. Untrusted locations require
native trust confirmation before SDK activation. Exact baseline permission
write/read-back gates execution. Project files survive registration removal and
app cleanup. The app-owned default workspace and metadata remain temporary.

## Repairs from independent review

An omitted model selection now preserves runtime/session/agent defaults and
variant instead of switching to the first catalog model. Regression tests
failed on the original behavior and pass after the repair. Permission queues
scroll independently so the composer/cancel controls stay visible. Desktop
navigation controls now change actual visibility. Tool UI styles are mapped to
the existing desktop tokens, and stale cancellation notices clear at idle.
See review-resolutions.md for findings, evidence and the retained new-folder
trust behavior submitted for independent adjudication.

## Observed verification

- 47/47 unit/component tests passed. Typecheck, ESLint, Prettier, build, renderer
  bundle inspection and dependency boundaries passed on the current source.
- The real workbench Electron E2E passed: isolated sidecar startup, closed IPC,
  session identity and drafts, safe preview, catalog/error states, IME handling,
  authentic AUTH_REQUIRED without fabricated replies, and owned cleanup.
- Development and packaged Electron lifecycle tests passed: wrong sender,
  subframe isolation, malformed IPC, navigation denial, crash/disconnect,
  restart, startup failure/timeout/service collision, quit and temporary cleanup.
- Additional actual-renderer tests use an explicitly synthetic main process to
  verify onNew/cancel, once/reject, schema-safe Tool UI and escaped markup, slash
  dispatch, unknown receipts, navigation and full composer/cancel visibility.
  They do not prove provider or tool execution in OpenCode.
- The latest macOS package was launched by the packaged lifecycle suite, and
  all {package['matchedFiles']} files in its application archive match the build.
  OpenCode resource identity is verified against the installed pinned package.

All nine required checks have current source/environment bindings in
verification-summary.json. Supplementary evidence and actual command arguments
are in supplementary-verification.json. The code/design final gate reports and
run.json determine final gate status; check execution alone is not that review.

The final inventory includes {len(changes)} changed paths and {len(deleted)} deletions
against the original run baseline, not against the repository's largely
untracked Git status. capture-manifest.json records actual pixel dimensions and
provenance for {len(captures)} captures. Renderer output is about 619 kB before
compression and emits a chunk-size warning; latency was not benchmarked.

## Local application

`apps/desktop-app/dist/packages/OhMyOwnCode-darwin-arm64/OhMyOwnCode.app`

```sh
open "/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/dist/packages/OhMyOwnCode-darwin-arm64/OhMyOwnCode.app"
```

Application archive SHA-256: `{package['appAsarSha256']}`.
Full package hashes are in package-inspection.json. No signing, notarization,
installer publication, payment or external telemetry was performed.

## Limits and remaining parent work

This is the bounded core increment, not a complete F-01–18 product release.
Existing provider credentials were not read or inherited; successful provider
execution is unverified. Native directory pickers were substituted within the
owned test process; physical OS picker interaction is not claimed. Native
Windows package/runtime evidence is still required from Windows.

The full parent scope retains durable storage/recovery and retention choice,
complete worktree/create/delete and session lifecycle, richer conversation
context, permission modes/delegation, browser/PTY/Git panels, harness/MCP
configuration, automation and remaining monitoring/release acceptance. The
earlier restricted-launch and quota failures are retained in previous-report.md
and historical logs; current native execution and the fresh reader route
succeeded after the user's continuation.
"""
(run / "report.md").write_text(report)

def cli(*args):
    result = subprocess.run([sys.executable, ".solopreneur/harness.py", *args], cwd=root, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if result.returncode:
        raise SystemExit(result.stdout)

artifacts = [name for name in changes if name in inventory]
report_files = ["report.md", "review-resolutions.md", "integration-files.json", "verification-summary.json", "supplementary-verification.json", "capture-manifest.json", "electron-evidence.json", "ui-states-evidence.json", "package-inspection.json", "package-source-match.json", "final-lifecycle-dev.log", "final-lifecycle-packaged.log", "final-ui-states.log", "model-default-before.log", "model-default-after.log", "ui-states-layout-regression.log", "final-code-review-cli.md", "design-review-cli.md"]
artifacts.extend("docs/runs/desktop-workbench-core/" + name for name in report_files)
artifacts.extend(capture["path"] for capture in captures)
for path in dict.fromkeys(artifacts):
    cli("artifact", "desktop-workbench-core", "--file", path)
base = "apps/desktop-app/"
coverage = {
    "AC-1": {"status": "verified", "artifacts": [base + "src/workbench-service.mjs", base + "src/workbench-service.test.mjs"], "checks": ["unit", "electron-e2e"]},
    "AC-2": {"status": "verified", "artifacts": [base + "src/renderer/features/conversation/index.tsx", base + "scripts/e2e-workbench-states.mjs", "docs/runs/desktop-workbench-core/ui-states-evidence.json"], "checks": ["unit", "typecheck", "electron-e2e"]},
    "AC-3": {"status": "verified", "artifacts": [base + "src/host/workbench-files.mjs", base + "src/renderer/features/explorer/index.tsx", "docs/runs/desktop-workbench-core/ui-states-evidence.json"], "checks": ["unit", "electron-e2e"]},
    "AC-4": {"status": "verified", "artifacts": [base + "src/main.mjs", base + "src/preload.cjs", "docs/runs/desktop-workbench-core/supplementary-verification.json"], "checks": ["unit", "typecheck", "lint", "format", "build", "bundle", "boundaries", "electron-e2e"]},
    "AC-5": {"status": "verified", "artifacts": ["docs/runs/desktop-workbench-core/report.md", "docs/runs/desktop-workbench-core/package-source-match.json", "docs/runs/desktop-workbench-core/capture-manifest.json"], "checks": ["package-macos", "build", "bundle", "electron-e2e"]},
}
save("outcome.json", {"schema_version": 2, "acceptance": coverage, "changed_paths": changes, "deleted_paths": deleted})
cli("outcome", "desktop-workbench-core", "--file", "docs/runs/desktop-workbench-core/outcome.json")
for gate in ["code", "design"]:
    result = subprocess.run([sys.executable, ".solopreneur/harness.py", "review-input", "desktop-workbench-core", "--gate", gate], cwd=root, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
    # Preserve the helper's exact JSON, without inventing a review result.
    json.loads(result.stdout)
    (run / f"final-{gate}-binding.json").write_text(result.stdout)
print(json.dumps({"source_sha256": source, "changed_paths": len(changes), "artifacts_registered": len(set(artifacts)), "captures": len(captures), "final_bindings": ["code", "design"]}))
