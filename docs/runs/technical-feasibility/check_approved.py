import hashlib,json,subprocess
from pathlib import Path
EXPECTED = {'docs/design/specs/workbench-ux.md': 'bfe3425f8334b91f882368e3e6670ec965dfd6361cf4cd71ee7af76890f61d43', 'docs/engineering/workbench-architecture.md': '4a031f5c8cd194c315b92df8ac468600d5b769387c2271d8c04810fbc4959cba', 'docs/engineering/verification.md': 'dba31b7266df9dcd93f6477342e07f77bef9897c42578048c4c38c024f62feee', 'docs/operations/local-release-monitoring.md': 'f0d88e1836f230da09f7afe093d4320298d8d191845abae69ad4a0d4ef17263b', 'docs/engineering/spec-index.md': '771c023836af77cdc8633d05729caef176ef62b4804f9aafbd762679d1d1db93', 'docs/product/prd.md': '597e64d100ea67b878762fde160b3a6d5c2f1275662661094dadfe0dad270dfb'}
for path,digest in EXPECTED.items():
 assert hashlib.sha256(Path(path).read_bytes()).hexdigest()==digest,path
r=json.loads(Path('docs/runs/technical-feasibility/spec-approval.json').read_text())
assert r['user_message']=='승인.' and r['platform']=='local-browser'
assert {d['path']:d['sha256'] for d in r['documents']}=={p:h for p,h in EXPECTED.items() if p!='docs/product/prd.md'}
for run,gate in [('prd-expansion','product'),('domain-specs','design_spec')]:
 subprocess.run(['python3','.solopreneur/harness.py','handoff',run,'--gate',gate],check=True)
print('Approved inputs unchanged; prior product/design handoffs ready; local-browser approval recorded.')
