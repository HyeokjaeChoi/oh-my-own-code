import importlib.util, json, subprocess
from pathlib import Path
root = Path.cwd()
runroot = Path("docs/runs/configuration-save")
spec = importlib.util.spec_from_file_location("harness", root / ".solopreneur/harness.py")
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)
run = json.loads((runroot / "run.json").read_text())
contract = json.loads((runroot / "contract.json").read_text())
current = h.inventory(root)
source = h.digest(current)
changed = h.changed_paths(run["baseline"], current)
checks = {name: rows[-1] for name, rows in run["checks"].items()}
assert set(checks) == set(contract["checks"])
for row in checks.values():
    assert row["exit_code"] == 0 and not row["inputs_changed"]
    assert row["source_sha256"] == source
    assert row["plan_sha256"] == run["plan"]["sha256"]
    assert row["contract_sha256"] == h.review_contract_digest(contract)
    assert row["environment_sha256"] == h.environment_fingerprint(root, contract)
hidden = runroot / "evidence/hidden-r4/ui-states"
ui = json.loads((hidden / "ui-states-evidence.json").read_text())
nativepath = runroot / "evidence/kernel-r3/configuration-save-evidence.json"
native = json.loads(nativepath.read_text())
assert ui["result"] == native["result"] == "pass"
assert ui["teardown"] == {"exited": True, "code": 0}
assert native["identitiesUnchanged"] and native["before"] == native["afterCleanup"]
assert len(native["cases"]) == 7
assert all(row["exited"] and row["nativeExitConfirmed"] for row in native["cleanup"])
def write(name, data):
    path = runroot / name
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    return path
freeze = write("source-freeze-r6.json", {"schema_version": 1, "source_sha256": source,
    "changed_paths": changed, "deleted_paths": [p for p in changed if p not in current],
    "paths": {p: current[p] for p in changed if p in current},
    "authority": "Actual current included-file inventory versus run baseline, not Git diff. r5 independent reports preserved; only correction concerns need fresh final review."})
actual = write("actual-checks-r6.json", {"schema_version": 1, "source_sha256": source, "checks": checks,
    "actual_build_log": str(runroot / "evidence/contract-build-r6.log"),
    "actual_native_log": str(runroot / "evidence/contract-kernel-r6-attempt2.log"),
    "reuse": "Current build/kernel checks validate exact actual revision6 bytes after runner spelling/contract argv corrections; not new execution."})
oldsummary = json.loads((runroot / "verification-summary-r5.json").read_text())
summary = write("verification-summary-r6.json", {**oldsummary, "source_sha256": source,
    "changed_path_count": len(changed), "checks": sorted(checks), "hidden_captures": len(ui["screenshots"]),
    "save_states": ui["configurationSaveStates"], "hidden_teardown": ui["teardown"],
    "native_cleanup": native["cleanup"], "actual_kernel_report": str(nativepath),
    "actual_hidden_report": str(hidden / "ui-states-evidence.json"),
    "corrections": ["CS-R5-001 speculative saved receipt suppressed on completion failure/timeout; actual service/registry regressions pass", "R5-DESIGN-01 catalog saving introduction corrected", "R5-DESIGN-02 actual full visibility asserted for each target/control/result/version/backup frame at760/2x and360/2x"],
    "notes": str(runroot / "correction-notes-r6.md")})
outcome = json.loads((runroot / "outcome-r5.json").read_text())
for row in outcome["acceptance"].values():
    row["artifacts"] = [str(freeze), str(summary)]
outcome["changed_paths"] = changed
outcome["deleted_paths"] = [p for p in changed if p not in current]
outpath = write("outcome-r6.json", outcome)
artifacts = [freeze, actual, summary, runroot / "correction-notes-r6.md", runroot / "verify-native-evidence-r6.mjs", nativepath,
    hidden / "ui-states-evidence.json", hidden / "manifest.json", runroot / "evidence/completion-correction-r6.log",
    runroot / "evidence/contract-build-r6.log", runroot / "evidence/contract-kernel-r6-attempt2.log"]
artifacts += sorted(hidden.glob("*.png"))
artifacts += sorted((runroot / "evidence").glob("contract-*-r6-attempt3.log"))
artifacts = [path for path in artifacts if path.stat().st_size]
existing = {item["path"]: item["sha256"] for item in run["artifacts"]}
for path in artifacts:
    if existing.get(str(path)) == h.sha(path):
        continue
    subprocess.run(["python3", ".solopreneur/harness.py", "artifact", "configuration-save", "--file", str(path)], check=True, stdout=subprocess.DEVNULL)
subprocess.run(["python3", ".solopreneur/harness.py", "outcome", "configuration-save", "--file", str(outpath)], check=True)
print(json.dumps({"source":source, "changed":len(changed), "checks":len(checks), "captures":len(ui["screenshots"]), "new_pins":len(artifacts)}))
