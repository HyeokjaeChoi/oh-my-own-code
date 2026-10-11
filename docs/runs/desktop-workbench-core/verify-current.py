"""Run the existing exact check contract and retain compact execution evidence."""
from pathlib import Path
import json
import os
import subprocess
import sys

root = Path(__file__).resolve().parents[3]
run = root / "docs/runs/desktop-workbench-core"
names = sys.argv[1:] or [
    "unit", "typecheck", "lint", "format", "build", "bundle", "boundaries",
    "electron-e2e", "package-macos",
]
contract = json.loads((run / "contract.json").read_text())
if any(name not in contract["checks"] for name in names):
    raise SystemExit("Only check names from the existing contract are accepted")
env = os.environ.copy()
cached_zip = Path("/Users/hyukjaechoi/Library/Caches/electron/235c213c7408ef4aea75a9198d5a560f6350da37f588d406a87dc41ce21292fb/electron-v44.4.4-darwin-arm64.zip")
if cached_zip.is_file():
    env["OMOC_ELECTRON_ZIP_DIR"] = str(cached_zip.parent)
for name in names:
    process = subprocess.run(
        [sys.executable, ".solopreneur/harness.py", "check", "desktop-workbench-core", "--name", name, "--timeout", "240"],
        cwd=root, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    (run / f"current-{name}.log").write_text(process.stdout)
    print(json.dumps({"check": name, "exit_code": process.returncode}), flush=True)
    if process.returncode:
        print(process.stdout[-8000:], flush=True)
        raise SystemExit(process.returncode)
