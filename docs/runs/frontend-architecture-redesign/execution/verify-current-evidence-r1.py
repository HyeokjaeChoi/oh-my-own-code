"""Validate existing evidence continuity. This does not rerun product checks."""
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("omoc_harness", ROOT / ".solopreneur/harness.py")
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)


def read(name):
    path = harness.local(ROOT, name, exists=True)
    assert path.stat().st_size <= 64 * 1024 * 1024, "Evidence exceeds bound"
    return json.loads(path.read_text())


pins = read(str((HERE / "current-evidence-files-r1.json").relative_to(ROOT)))
assert len(pins) == 63, "Expected exact report and capture set"
for name, digest in pins.items():
    path = harness.local(ROOT, name, exists=True)
    assert harness.sha(path) == digest, "Evidence changed: " + name

correction = read("docs/runs/projection-fixture-v5/run.json")
assert correction["status"] == "complete"
baseline = correction["baseline"]
current = harness.inventory(ROOT)
assert harness.digest(baseline) == "3770a81d225bf29ea36016e03d602660986aa002b0c0710d20ee79698f441e8f"
assert harness.digest(current) == "f48537341385759b230d48129447e850051d03642964a9bbb10dd111b2314a5e"
assert harness.changed_paths(baseline, current) == ["apps/desktop-app/src/workbench-projection.test.mjs"]

prior_count = 0
for run in ("durable-workbench-storage", "durable-native-preflight"):
    state = read("docs/runs/" + run + "/run.json")
    contract = read("docs/runs/" + run + "/contract.json")
    assert state["status"] == "complete"
    for name, attempts in state["checks"].items():
        check = attempts[-1]
        assert check["exit_code"] == 0 and not check["inputs_changed"]
        assert not check["timed_out"] and not check["interrupted"]
        assert check["source_sha256"] == harness.digest(baseline)
        assert check["environment_sha256"] == harness.environment_fingerprint(ROOT, contract)
        assert check["argv"] == contract["checks"][name]["argv"]
        assert check["contract_sha256"] == harness.review_contract_digest(contract)
        assert check["plan_sha256"] == state["plan"]["sha256"]
        prior_count += 1
assert prior_count == 21

static = read(str((HERE / "current-parent-static-checks-r1.json").relative_to(ROOT)))
assert set(static) == {"unit", "ui-typecheck", "ui-lint", "ui-format"}
for check in static.values():
    assert check["exit_code"] == 0 and not check["inputs_changed"]
    assert not check["timed_out"] and not check["interrupted"]
    assert check["source_sha256"] == harness.digest(current)
    assert check["environment_sha256"] == harness.environment_fingerprint(ROOT, {"environment_files": ["pnpm-lock.yaml"]})

performance = read(str((HERE / "final-performance-current-r1/ui-states/performance-evidence.json").relative_to(ROOT)))
assert performance["result"] == "pass" and performance["failures"] == []
assert performance["teardown"] == "test process exit confirmed"
assert performance["provenance"]["before"] == performance["provenance"]["after"]
assert harness.sha(ROOT / "apps/desktop-app/dist/build-provenance.json") == performance["provenance"]["before"]["buildStampSha256"]
stamp = performance["provenance"]["before"]["buildStamp"]
for entry in stamp["inputs"]["files"] + stamp["artifacts"]["files"]:
    path = harness.local(ROOT, entry["path"], exists=True)
    assert path.stat().st_size == entry["size"]
    assert path.stat().st_mode & 0o7777 == entry["mode"]
    assert harness.sha(path) == entry["sha256"], "Build input/artifact changed"
for name, count in (("input", 20), ("menu", 20), ("panel", 20), ("shell", 100), ("projection", 100)):
    summary = performance["summary"][name]
    assert summary["count"] == count
    assert summary["p95"] <= summary["p95GoalMs"]
assert harness.inventory(ROOT) == current, "Source changed during verification"
for name, digest in pins.items():
    assert harness.sha(harness.local(ROOT, name, exists=True)) == digest
print(json.dumps({"result": "pass", "kind": "existing-evidence-continuity", "priorChecksReused": prior_count, "freshStaticChecks": len(static), "pinnedEvidenceFiles": len(pins), "freshPerformance": "pass", "newProductCheckExecutions": 0, "limits": "No new production Main, provider, OS IME, screen reader, Windows or power-loss proof."}))
