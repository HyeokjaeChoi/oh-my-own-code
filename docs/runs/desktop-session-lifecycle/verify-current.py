"""Execute contracted checks and retain this increment's own evidence."""
from pathlib import Path
import json
import os
import subprocess
import sys

root = Path(__file__).resolve().parents[3]
run = root / "docs/runs/desktop-session-lifecycle"
contract = json.loads((run / "contract.json").read_text())
names = sys.argv[1:] or [
    "unit", "typecheck", "lint", "format", "build", "bundle", "boundaries",
    "electron-e2e", "electron-session-e2e", "electron-ui-states",
    "package-macos", "packaged-lifecycle",
]
if any(name not in contract["checks"] for name in names):
    raise SystemExit("Only registered check names are accepted")
env = os.environ.copy()
env["OMOC_EVIDENCE_DIR"] = str(run)
cached_zip = Path("/Users/hyukjaechoi/Library/Caches/electron/235c213c7408ef4aea75a9198d5a560f6350da37f588d406a87dc41ce21292fb/electron-v44.4.4-darwin-arm64.zip")
if cached_zip.is_file():
    env["OMOC_ELECTRON_ZIP_DIR"] = str(cached_zip.parent)
for name in names:
    result = subprocess.run(
        [sys.executable, ".solopreneur/harness.py", "check", "desktop-session-lifecycle", "--name", name, "--timeout", "240"],
        cwd=root, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    (run / f"current-{name}.log").write_text(result.stdout)
    print(json.dumps({"check": name, "exit_code": result.returncode}), flush=True)
    if result.returncode:
        print(result.stdout[-8000:], flush=True)
        raise SystemExit(result.returncode)
