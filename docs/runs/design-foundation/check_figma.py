"""Compare recorded live Figma exports with the frozen local design contract."""
import json
import hashlib
from pathlib import Path

ROOT=Path(__file__).resolve().parents[3]
RUN=ROOT/'docs/runs/design-foundation'
def read(p): return json.loads(p.read_text())
m=read(ROOT/'docs/design/tokens/manifest.json')
c=read(ROOT/'docs/design/components.json')
f=read(RUN/'figma-foundations.json')
source=read(ROOT/'docs/design/figma-source.json')
assert source['placement_verified'] and source['project_id']=='660860312'
assert source['file_key']=='e6QYqEsmA3FHB6A2ohNr2o'
assert not source['invites_sent'] and not source['library_published']
assert set(f['variables'])=={t['path'] for t in m['tokens']}
ids={p:v['id'] for p,v in f['variables'].items()}
for t in m['tokens']:
 v=f['variables'][t['path']]; col=f['collections'][t['layer']]
 assert v['scopes']==t['figmaScopes'],t['path']
 assert v['codeSyntax']['WEB']==f"var({t['css']})",t['path']
 assert v['type']==('COLOR' if t['type']=='color' else 'STRING' if t['type']=='fontFamily' else 'FLOAT')
 for mode,mid in col['modes'].items():
  expected=t['value'] if t['layer']=='primitive' else t['value'][mode.lower()]
  actual=v['valuesByMode'][mid]
  if isinstance(expected,str) and expected.startswith('{'):assert actual=={'type':'VARIABLE_ALIAS','id':ids[expected[1:-1]]},t['path']
  elif t['type']=='color':
   rgb=[int(expected[i:i+2],16)/255 for i in (1,3,5)]
   assert all(abs(actual[k]-n)<0.00001 for k,n in zip('rgb',rgb)),t['path']
  elif t['type'] in ('dimension','duration'):assert actual==float(expected.removesuffix('px').removesuffix('ms')),t['path']
  else:assert actual==expected,t['path']
assert set(f['styles'])=={'body','caption','label','heading','code'}
for role,s in f['styles'].items():
 for field,part in [('fontFamily','family'),('fontSize','size'),('fontWeight','weight'),('lineHeight','line')]:
  assert s['boundVariables'][field]['id']==ids[f'semantic.type.{part}.{role}']
for family,count in c['families'].items():
 actual=read(RUN/f'figma-{family}.json')
 assert actual['family']==family and actual['variantCount']==count
 specs=[s for s in c['variants'] if s['family']==family]
 for spec,v in zip(specs,actual['variants']):
  expected_name=(f"Intent={spec['properties']['intent']}, State={spec['properties']['state']}" if family=='Button' else f"State={spec['name']}")
  assert v['name']==expected_name
  serialized=json.dumps(v['nodes'])
  for binding,path in spec['bindings'].items():
   if path: assert ids[path] in serialized,(family,spec['name'],binding)
  assert all(n['width']>0 and n['height']>0 for n in v['nodes'])
shots=read(RUN/'visual-evidence.json')
assert set(shots['families'])==set(c['families'])
assert shots['foundations'] and shots['review_scope']=='Figma design artifacts only'
for name, expected_hash in shots['captures'].items():
 assert hashlib.sha256((RUN/name).read_bytes()).hexdigest()==expected_hash,name
audit=read(RUN/'figma-final-audit.json')
assert {a['family'] for a in audit}==set(c['families'])
for a in audit:
 assert not a['unboundPaints'],a['family']
 assert len(a['variants'])==c['families'][a['family']]
 assert a['modes'][f['collections']['semantic']['id']]==f['collections']['semantic']['modes']['Dark']
 assert a['modes'][f['collections']['component']['id']]==f['collections']['component']['modes']['Dark']
 for v in a['variants']:
  for t in v['properties']:
   for ref in t['references'].values():assert ref in a['properties'],(a['family'],ref)
print(f"PASS: dedicated placement; {len(m['tokens'])} variables, aliases, scopes, CSS; 5 text styles; 44 variants and expected variable IDs present; capture references present. Property-level binding judgment and visual review are separate.")
