"""Static document integrity only; does not execute the product or its tests."""
from pathlib import Path
import hashlib
import importlib.util
import json
import re

root = Path(__file__).resolve().parents[3]
run = root / "docs/runs/domain-specs"
files = [
    "docs/design/specs/workbench-ux.md",
    "docs/engineering/workbench-architecture.md",
    "docs/engineering/verification.md",
    "docs/operations/local-release-monitoring.md",
    "docs/engineering/spec-index.md",
]
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
assert sha(root / "docs/product/prd.md") == "597e64d100ea67b878762fde160b3a6d5c2f1275662661094dadfe0dad270dfb", "Approved PRD changed"
contract = json.loads((run / "contract.json").read_text())
assert {d["path"] for d in contract["documents"]} == set(files)
for doc in contract["documents"]:
    assert sha(root / doc["path"]) == doc["sha256"], doc["path"]
    assert doc["gate"] == "design_spec" and doc["version"] == "0.1"
for file in files:
    path = root / file
    text = path.read_text()
    assert text.strip(), file
    for link in re.findall(r"\]\(([^)]+)\)", text):
        if "://" in link or link.startswith("#"):
            continue
        target = link.split("#", 1)[0].strip("<>")
        assert (path.parent / target).exists(), (file, target)
for file in (files[0], files[2], files[4]):
    text = (root / file).read_text()
    for i in range(1, 19):
        assert re.search(r"AC-%02d(?!\d)" % i, text), (file, i)
index = (root / files[4]).read_text()
for file in files[:4]:
    assert sha(root / file) in index, "Index manifest hash missing: " + file
spec = importlib.util.spec_from_file_location("harness", root / ".solopreneur/harness.py")
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)
state = json.loads((run / "run.json").read_text())
assert harness.changed_paths(state["baseline"], harness.inventory(root)) == sorted(files), "Unexpected source changes"
print("PASS: approved PRD preserved; five exact document hashes; local file links; 18 acceptance IDs in UX/verification/index; four-domain index manifest; exact source-change boundary.")
print("LIMIT: text integrity only; no semantic, SDK, UI, runtime, permission, Figma, or live-test attestation.")
