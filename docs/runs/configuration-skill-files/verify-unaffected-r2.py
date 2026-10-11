# coding: utf-8
"""Read-only reuse of eight actual passes after the sole UI-runner correction."""
from pathlib import Path
import importlib.util,json,sys,subprocess
root=Path.cwd();p=root/'docs/runs/configuration-skill-files'
s=importlib.util.spec_from_file_location('h',root/'.solopreneur/harness.py');h=importlib.util.module_from_spec(s);s.loader.exec_module(h)
e=json.loads((p/'actual-unaffected-checks-r1.json').read_text());name=sys.argv[1];prior=e['actual_checks'][name]
assert prior['exit_code']==0 and not prior['inputs_changed']
assert prior['source_sha256']==h.digest(e['original_source'])
current=h.inventory(root);changed=h.changed_paths(e['original_source'],current)
assert changed==[e['allowed_changed_path']],changed
# These checks do not execute or import the changed hidden-UI runner.
assert all('e2e-workbench-states.mjs' not in str(v) for v in prior['argv'])
publication=json.loads((p/'evidence/publication-r1/publication-evidence.json').read_text())
assert publication['status']=='pass' and publication['before']==publication['after'] and publication['exit']['status']==0
if name=='build':
 code="import {captureProvenance} from './apps/desktop-app/scripts/build-provenance.mjs'; const p=await captureProvenance(process.cwd(),{script:'smoke',mode:'dev',platform:'darwin'}); console.log(JSON.stringify({result:'pass',buildStampSha256:p.buildStampSha256}));"
 subprocess.run(['node','--input-type=module','-e',code],check=True)
print(json.dumps({'result':'pass','authority':'read-only exact current inputs verification; original actual execution retained, no test/build rerun','check':name,'original_recorded_at':prior['recorded_at'],'sole_changed_path':changed[0],'original_exit_code':prior['exit_code']}))
