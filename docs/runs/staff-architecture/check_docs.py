"""Check local document integrity and preserve already approved source snapshots."""
from pathlib import Path
import hashlib,json,re
root=Path(__file__).resolve().parents[3]
r=root/'docs/runs/staff-architecture'
for path,want in json.loads((r/'preserved-baseline.json').read_text()).items():
 assert hashlib.sha256((root/path).read_bytes()).hexdigest()==want, f'Protected snapshot changed: {path}'
a=(root/'AGENTS.md').read_text();managed=a.split('<!-- solopreneur:begin -->',1)[1].split('<!-- solopreneur:end -->',1)[0]
assert hashlib.sha256(managed.encode()).hexdigest()==(r/'managed-block.sha256').read_text().strip()
files=[root/'AGENTS.md',root/'docs/engineering/architecture-entry.md',root/'docs/decisions/0001-workbench-platform.md']
for p in files:
 text=p.read_text();assert text.strip()
 for link in re.findall(r'\]\(([^)]+)\)',text):
  if '://' in link or link.startswith('#'):continue
  target=link.split('#',1)[0]
  assert (p.parent/target).exists(),f'Broken local link: {p.name}: {target}'
assert 'docs/engineering/architecture-entry.md' in a.split('<!-- solopreneur:end -->',1)[1]
assert '../decisions/0001-workbench-platform.md' in files[1].read_text()
print('PASS: project entry links resolve; managed block and approved baseline preserved. Architecture quality and implementation enforcement require separate review/evidence.')
