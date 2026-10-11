"""Check current renderer evidence and unchanged host proofs without replay."""
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("omoc_harness", ROOT / ".solopreneur/harness.py")
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)
CURRENT = "a33e66c6ce194d95711bff6eac3073b78eaa123ea37be8f11a361a0cd118a65c"
PRIOR = "3770a81d225bf29ea36016e03d602660986aa002b0c0710d20ee79698f441e8f"


def read(name):
    path = harness.local(ROOT, name, exists=True)
    assert path.stat().st_size <= 64 * 1024 * 1024
    return json.loads(path.read_text())


pins = read(str((HERE / "current-evidence-files-r3.json").relative_to(ROOT)))
assert len(pins) == 77
for name, digest in pins.items():
    path = harness.local(ROOT, name)
    assert path.is_file() and not path.is_symlink()
    assert harness.sha(path) == digest, "Evidence changed: " + name

baseline = read("docs/runs/projection-fixture-v5/run.json")["baseline"]
current = harness.inventory(ROOT)
assert harness.digest(baseline) == PRIOR and harness.digest(current) == CURRENT
assert harness.changed_paths(baseline, current) == [
    "apps/desktop-app/scripts/e2e-workbench-states.mjs",
    "apps/desktop-app/src/renderer/pages/workbench/shell.module.css",
    "apps/desktop-app/src/workbench-projection.test.mjs",
]
# Exact difference proves host/native algorithms, policy, DTO, owner, registry,
# journal, probe scripts, dependencies and pure store/fixture units unchanged.
reused = {
    "durable-workbench-storage": {"storage-unit", "renderer-unit"},
    "durable-native-preflight": {
        "preflight-unit", "host-regression", "packaging-unit",
        "preflight-native", "reader-lifecycle",
    },
}
historical = 0
for run, reusable in reused.items():
    state = read("docs/runs/" + run + "/run.json")
    contract = read("docs/runs/" + run + "/contract.json")
    assert state["status"] == "complete"
    assert reusable <= set(state["checks"])
    for name, attempts in state["checks"].items():
        check = attempts[-1]
        assert check["exit_code"] == 0 and not check["inputs_changed"]
        assert not check["timed_out"] and not check["interrupted"]
        assert check["source_sha256"] == PRIOR
        assert check["environment_sha256"] == harness.environment_fingerprint(ROOT, contract)
        assert check["argv"] == contract["checks"][name]["argv"]
        assert check["contract_sha256"] == harness.review_contract_digest(contract)
        assert check["plan_sha256"] == state["plan"]["sha256"]
        historical += 1
assert historical == 21
# The other historical renderer/build checks remain historical, not current.
checks = read(str((HERE / "current-direct-checks-r3.json").relative_to(ROOT)))
assert {check["name"] for check in checks} == {
    "projection", "boundaries", "typecheck", "format", "lint", "build",
    "bundle", "package", "package-inspect",
}
for check in checks:
    assert check["exit_code"] == 0 and check["source_sha256"] == CURRENT
    assert harness.sha(harness.local(ROOT, check["stdout_stderr_path"])) == check["log_sha256"]

ui = read(str((HERE / "final-hidden-current-r3/ui-states/ui-states-evidence.json").relative_to(ROOT)))
assert ui["result"] == "pass" and ui["teardown"] == {"exited": True, "code": 0}
assert len(ui["screenshots"]) == 51
states = {state["state"]: state for state in ui["p7StorageStates"]}
pending = states["pending-inbox-bootstrap-narrow-200"]
assert all(pending[key] for key in (
    "retainedOriginalKeyLookup", "keyboardRetry", "unchangedDraft", "mutationAttemptsUnchanged",
))
location = states["durable-documents-location-narrow-200"]
assert all(location[key] for key in ("fullPathSelectable", "scrollReachable", "escapeReturnsFocus"))
for capture in ui["screenshots"]:
    assert capture.get("osWindowVisible", False) is False
    assert capture.get("osWindowFocused", False) is False
    assert capture.get("osWindowFocusable", False) is False
    if "narrow-200" in capture["path"] and "desktop-p7-" in capture["path"]:
        assert capture["zoomFactor"] == 2
        assert capture["viewport"]["width"] <= 380

performance = read(str((HERE / "final-performance-current-r2/ui-states/performance-evidence.json").relative_to(ROOT)))
assert performance["result"] == "pass" and performance["failures"] == []
assert performance["teardown"] == "test process exit confirmed"
assert performance["provenance"]["before"] == performance["provenance"]["after"]
stamp = performance["provenance"]["before"]["buildStamp"]
assert harness.sha(ROOT / "apps/desktop-app/dist/build-provenance.json") == performance["provenance"]["before"]["buildStampSha256"]
for entry in stamp["inputs"]["files"] + stamp["artifacts"]["files"]:
    path = harness.local(ROOT, entry["path"], exists=True)
    assert path.stat().st_size == entry["size"]
    assert path.stat().st_mode & 0o7777 == entry["mode"]
    assert harness.sha(path) == entry["sha256"]
for name, count in (("input", 20), ("menu", 20), ("panel", 20), ("shell", 100), ("projection", 100)):
    summary = performance["summary"][name]
    assert summary["count"] == count and summary["p95"] <= summary["p95GoalMs"]
assert harness.inventory(ROOT) == current
for name, digest in pins.items():
    assert harness.sha(harness.local(ROOT, name)) == digest
print(json.dumps({
    "result": "pass", "kind": "current-renderer-and-unchanged-host-evidence",
    "historicalCheckRecordsValidated": historical,
    "unchangedAlgorithmChecksReused": sum(len(names) for names in reused.values()),
    "freshStaticBuildPackageChecks": len(checks), "freshHiddenCaptures": 51,
    "freshPerformance": "pass", "productProcessesStartedByThisVerifier": 0,
    "limits": "No current production Main GUI, real provider/private data, Windows, power-loss, OS IME or Screen Reader claim.",
}))
