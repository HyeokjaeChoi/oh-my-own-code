"""Exact applicability proof for the UI-only closed-target projection repair."""
from pathlib import Path
import hashlib, importlib.util, json, re, stat, subprocess, sys
root = Path(__file__).resolve().parents[3]
run = root / 'docs/runs/git-branch-restore'
proof_path = run / 'evidence/react-preview-fix-r1/proof.json'
proof = json.loads(proof_path.read_text())
spec = importlib.util.spec_from_file_location('h', root / '.solopreneur/harness.py')
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)
sha = lambda value: hashlib.sha256(value).hexdigest()
current = h.inventory(root)
assert set(current) == set(proof['originalSources'])
changed = []
for path, original in proof['originalSources'].items():
    if path in proof['allowedChanges']:
        allowed = proof['allowedChanges'][path]
        assert original['sha256'] == allowed['before']
        assert current[path] == {**original, 'sha256': allowed['after']}, path
        changed.append(path)
    else:
        assert current[path] == original, 'Changed reused dependency: ' + path
assert len(changed) == 4
assert h.digest(proof['originalSources']) == proof['originalSourceSha256']
prior_environment = h.environment_fingerprint(root, {'environment_files': proof['originalEnvironmentFiles']})
for old in proof['passedChecks'].values():
    assert old['source_sha256'] == proof['originalSourceSha256']
    assert old['exit_code'] == 0 and not old['inputs_changed']
    assert old['environment_sha256'] == prior_environment
phase = sys.argv[1]
assert phase in ['kernel', 'unit', 'publication']
if phase == 'kernel':
    old = proof['passedChecks']['kernel']
    paths = re.findall(r'Synthetic evidence: ([^\n]+/report\.json)', old['stdout'])
    for line in old['stdout'].splitlines():
        try:
            data = json.loads(line)
        except (ValueError, TypeError):
            continue
        if isinstance(data, dict) and 'priorActualNativeReports' in data:
            for pin in data['priorActualNativeReports']:
                assert sha(Path(pin['path']).read_bytes()) == pin['sha256']
                paths.append(pin['path'])
    assert len(set(paths)) == 3
    reports = []
    for path in dict.fromkeys(paths):
        report = json.loads(Path(path).read_text())
        assert report['process']['exitCode'] == 0
        assert all(x['status'] == 'pass' for x in report['evidence'])
        for pin in report.get('sources', report.get('ownedSources')):
            assert sha(Path(pin['path']).read_bytes()) == pin['sha256']
        binary = report['runtimeBinary']
        expected = binary.get('sha256', binary.get('before'))
        assert binary.get('after', expected) == expected
        assert sha(Path(binary['path']).read_bytes()) == expected
        reports.append({'path': path, 'sha256': sha(Path(path).read_bytes()), 'cases': len(report['evidence'])})
    assert sum(x['cases'] for x in reports) == 242
    print(json.dumps({'priorActualNativeReports': reports, 'newKernelExecution': False, 'reusedNativeCases': 242, 'exactOnlyChangedUIPaths': changed}))
elif phase == 'unit':
    argv = ['node', '--import', 'tsx', '--test', '--test-concurrency=1', '--test-reporter=spec',
            'apps/desktop-app/src/workbench-store.test.mjs',
            'apps/desktop-app/scripts/fixtures/workbench-host.test.mjs',
            'apps/desktop-app/scripts/build-provenance.test.mjs',
            'apps/desktop-app/scripts/run-evidence.test.mjs']
    print(json.dumps({'priorActualUnitFiles': 23, 'newAffectedUnitArgv': argv, 'reusedOtherUnitFiles': 19, 'exactOnlyChangedUIPaths': changed}), flush=True)
    result = subprocess.run(argv, cwd=root, timeout=300)
    assert result.returncode == 0
else:
    pin = proof['priorPublication']
    raw = (root / pin['path']).read_bytes()
    assert sha(raw) == pin['sha256']
    report = json.loads(raw)
    assert report['status'] == 'pass' and report['before'] == report['after']
    assert report['exit']['exited'] and report['exit']['status'] == 0
    assert report['matrix']['result'] == 'pass' and len(report['matrix']['observations']) == 34
    identity = report['before']
    for name in ['engine', 'git']:
        expected = identity[name]
        assert sha(Path(expected['components'][-1]['path']).read_bytes()) == expected['sha256']
        for component in expected['components']:
            actual = Path(component['path']).lstat()
            assert not stat.S_ISLNK(actual.st_mode)
            for field, value in [('dev', actual.st_dev), ('ino', actual.st_ino), ('mode', actual.st_mode), ('uid', actual.st_uid)]:
                assert str(value) == component[field], (name, component['path'], field)
    code = '''import {eventHostForResources,verifyEventHostResources,resourceFileSha256} from './apps/desktop-app/src/event-host-resources.mjs';
import {resolve} from 'node:path';
const d=eventHostForResources(resolve('./apps/desktop-app/dist/resources'),'darwin','arm64');
await verifyEventHostResources(d);
console.log(JSON.stringify({manifest:await resourceFileSha256(d.manifestPath)}));'''
    result = subprocess.run(['node', '--input-type=module', '-e', code], cwd=root, text=True, capture_output=True, check=True, timeout=60)
    assert json.loads(result.stdout)['manifest'] == identity['manifest']
    for path, expected in identity['assets'].items():
        assert sha((root / 'apps/desktop-app/src' / path).read_bytes()) == expected
    print(json.dumps({'priorPublication': pin, 'actualCases': 34, 'newPublicationExecution': False, 'hostKernelNativeSourcesAndIdentitiesUnchanged': True, 'exactOnlyChangedUIPaths': changed}))
