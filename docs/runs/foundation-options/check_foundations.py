import json, hashlib, pathlib, re
root=pathlib.Path.cwd(); dest=root/'docs/design/explorations/foundation-options'
for p,h in json.loads((root/'docs/runs/foundation-options/baseline.json').read_text()).items():
 assert hashlib.sha256((root/p).read_bytes()).hexdigest()==h, p
data=json.loads((dest/'presets.json').read_text()); assert len(data['presets'])==4
assert len({p['id'] for p in data['presets']})==4
def luminance(hex):
 rgb=[int(hex[i:i+2],16)/255 for i in (1,3,5)]
 return sum((v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4)*w for v,w in zip(rgb,[.2126,.7152,.0722]))
def contrast(a,b):
 x,y=sorted([luminance(a),luminance(b)]); return (y+.05)/(x+.05)
for p in data['presets']:
 assert p['name'] and p['rationale'] and p['tradeoff']
 for mode in ['light','dark']:
  t=p['modes'][mode]; assert all(k in t for k in ['primitive','semantic','component'])
  flat={k+'.'+n:v for k,d in t.items() for n,v in d.items()}
  def resolve(k,seen=()):
   assert k not in seen, k
   v=flat[k]
   return resolve(v[1:-1],seen+(k,)) if isinstance(v,str) and v.startswith('{') else v
  for k in flat: resolve(k)
  for layer,parent in [('semantic','primitive'),('component','semantic')]:
   assert all(isinstance(v,str) and v.startswith('{'+parent+'.') for v in t[layer].values())
  for fg,bg,minratio in [('text','canvas',4.5),('text','surface',4.5),('muted','surface',4.5),('onAccent','accent',4.5),('warningText','warningBg',4.5),('successText','successBg',4.5),('dangerText','dangerBg',4.5),('focus','canvas',3),('focus','surface',3)]:
   a,b=resolve('semantic.'+fg),resolve('semantic.'+bg)
   assert contrast(a,b)>=minratio, (p['id'],mode,fg,bg,contrast(a,b))
for name in ['index.html','styles.css','app.js','presets.json','research.md']: assert (dest/name).stat().st_size>0
research=(dest/'research.md').read_text()
for vendor in ['ChatGPT','Claude','OpenCode','Grok']: assert vendor in research
assert len(re.findall(r'https://',research))>=8
print('PASS: four two-mode alias sets, candidate contrast pairs, research coverage, preview assets and frozen baseline hashes.')
