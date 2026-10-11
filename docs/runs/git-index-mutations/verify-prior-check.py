"""Fail closed unless the actual prior check still binds current code and artifacts."""
from pathlib import Path
import hashlib
import importlib.util
import json
import subprocess
import sys

root = Path(__file__).resolve().parents[3]
run = root / 'docs/runs/git-index-mutations'
spec = importlib.util.spec_from_file_location('run_harness', root / '.solopreneur/harness.py')
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)
proof = json.loads((run / 'prior-check-proof-r1.json').read_text())
name = sys.argv[1]
attempt = proof['attempts'][name]
original = proof['original_contract']['checks'][name]
assert attempt['exit_code'] == 0 and not attempt['inputs_changed']
assert not attempt['timed_out'] and not attempt['interrupted']
assert all(attempt[k] == original[k] for k in ('argv', 'cwd', 'scope'))
assert h.source_fingerprint(root) == attempt['source_sha256'] == proof['source_sha256']
assert {f: h.sha(root / f) for f in proof['environment_files']} == proof['environment_files']
assert h.environment_fingerprint(root, proof['original_contract']) == attempt['environment_sha256']
for path, expected in proof['evidence_files'].items():
    assert h.sha(root / path) == expected, path
# Re-read the actual source/config/lock/resources/build and selected script inventories.
code = "import {captureProvenance} from './apps/desktop-app/scripts/build-provenance.mjs'; console.log(JSON.stringify(await captureProvenance(process.cwd(),{script:'git-index',mode:'dev',platform:process.platform})));"
current = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', code], cwd=root, timeout=60))
ui = json.loads((run / 'evidence/hidden-r2/git-index/manifest.json').read_text())
assert current == ui['provenance'] and ui['status'] == 'pass' and ui['provenanceVerifiedAfter']
reader = json.loads((run / 'evidence/reader-regression-r1/report.json').read_text())
git = reader['executableBefore']
assert hashlib.sha256(Path(git['path']).read_bytes()).hexdigest() == git['sha256']
for component in git['components']:
    st = Path(component['path']).stat()
    actual = dict(dev=str(st.st_dev), ino=str(st.st_ino), uid=str(st.st_uid), gid=str(st.st_gid), mode=st.st_mode, size=str(st.st_size), mtimeNs=str(st.st_mtime_ns), ctimeNs=str(st.st_ctime_ns))
    assert all(str(actual[k]) == str(component[k]) for k in actual), component['path']
assert h.source_fingerprint(root) == proof['source_sha256']
assert {f: h.sha(root / f) for f in proof['environment_files']} == proof['environment_files']
print(json.dumps({'status': 'pass', 'action': 'verified_prior_actual_check', 'name': name, 'original_recorded_at': attempt['recorded_at'], 'source_sha256': proof['source_sha256'], 'new_test_execution': False}))
