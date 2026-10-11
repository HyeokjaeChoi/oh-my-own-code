"""Prepare exact review inputs; never infer or manufacture a verdict."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys

root = Path(__file__).resolve().parents[3]
core = root / "docs/runs/desktop-workbench-core"
run = root / "docs/runs/desktop-session-lifecycle"

def cli(*args):
    result = subprocess.run([sys.executable, ".solopreneur/harness.py", *args], cwd=root, text=True, capture_output=True, check=True)
    return result.stdout

# The returned reviewer text used Markdown escapes despite the JSON request.
# Remove only those three presentation escapes, preserving every verdict/value.
raw = (core / "post-fix-review.json").read_text()
normalized = raw.replace("\\_", "_").replace("\\[", "[").replace("\\]", "]")
reviews = json.loads(normalized)
for gate in ("code", "design"):
    previous = json.loads((core / f"final-{gate}-binding.json").read_text())
    assert reviews[gate]["reviewed"] == previous
(core / "post-fix-review.normalized.json").write_text(json.dumps(reviews, indent=2) + "\n")

state = json.loads((core / "run.json").read_text())
for artifact in state["artifacts"]:
    path = root / artifact["path"]
    if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != artifact["sha256"]:
        raise SystemExit("Unresolved artifact mismatch: " + artifact["path"])

for gate in ("code", "design"):
    binding = cli("review-input", "desktop-workbench-core", "--gate", gate)
    json.loads(binding)
    (core / f"reconciled-{gate}-binding.json").write_text(binding)
binding = cli("review-input", "desktop-session-lifecycle", "--gate", "plan")
json.loads(binding)
(run / "plan-binding.json").write_text(binding)
print("Verified all registered core artifact hashes; prepared corrected code/design and next plan bindings.")
