"""Prepare retry-safe Figma batches from the frozen draft contract. No Figma writes."""
import argparse, collections, hashlib, json, pathlib, re
ROOT=pathlib.Path(__file__).resolve().parents[5]
OUT=pathlib.Path(__file__).resolve().parents[1]
SOURCE=ROOT/'docs/runs/desktop-design-candidates/synthesis/design-systems.json'
D=json.loads(SOURCE.read_text()); TOKENS=D['common']['tokens']; INDEX={t['path']:t for t in TOKENS}
assert len(INDEX)==len(TOKENS)==475
assert dict(collections.Counter(t['layer'] for t in TOKENS))=={'primitive':119,'semantic':171,'component':185}
TYPE={'color':'COLOR','dimension':'FLOAT','number':'FLOAT','duration':'FLOAT','fontFamily':'STRING','string':'STRING','shadow':'STRING'}
def selected(t,c,mode):
 v=c['tokenOverrides'].get(t['path'],t['value'])
 return v[mode] if isinstance(v,dict) else v
def resolve(path,c,mode,seen=()):
 assert path not in seen, ('cycle',path)
 t=INDEX[path];v=selected(t,c,mode)
 if isinstance(v,str) and re.fullmatch(r'\{[^}]+\}',v):
  ref=v[1:-1];assert INDEX[ref]['type']==t['type'];assert {'semantic':'primitive','component':'semantic'}[t['layer']]==INDEX[ref]['layer']
  return resolve(ref,c,mode,seen+(path,))
 assert t['layer']=='primitive', ('literal outside primitive',path)
 return v
def scopes(t):
 p=t['path'];typ=t['type']
 if t['layer']=='primitive':return []
 if typ in ('shadow','string','fontFamily','duration'):return []
 if typ=='color':
  if any(s in p.lower() for s in ('border','divider','focus')):return ['STROKE_COLOR']
  if any(s in p.lower() for s in ('foreground','secondary','placeholder','text.','content','muted')):return ['TEXT_FILL','SHAPE_FILL','STROKE_COLOR']
  return ['FRAME_FILL','SHAPE_FILL']
 if p.endswith('.weight'):return ['FONT_WEIGHT']
 if p.endswith('.size') and any(s in p for s in ('.type.','.control.','.field.','.composer.','.message.','.code.','.tool.','.tooltip.','.permission.','.status.')):return ['FONT_SIZE']
 if p.endswith('.line'):return ['LINE_HEIGHT']
 if 'radius' in p.lower():return ['CORNER_RADIUS']
 if any(s in p.lower() for s in ('padding','gap','inset','gutter','space','offset')):return ['GAP']
 if any(s in p.lower() for s in ('stroke','focuswidth')):return ['STROKE_FLOAT']
 return ['WIDTH_HEIGHT']
P={'contractSha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest(),'pages':D['figmaProjection']['pages'],'candidates':D['candidates'],'tokens':[{**t,'figmaType':TYPE[t['type']],'scopes':scopes(t),'css':'--draft-compact-'+t['path'].replace('.','-')} for t in TOKENS],'components':D['common']['components'],'profiles':D['common']['stateProfiles'],'foundations':D['common']['foundations'],'responsive':D['common']['responsive'],'icons':json.loads(pathlib.Path('/private/tmp/omoc-figma-references/lucide-icons.json').read_text())['icons'],'resolved':{c['id']:{m:{p:resolve(p,c,m) for p in INDEX} for m in ['light','dark']} for c in D['candidates']}}
assert len(P['icons'])==23
for f in P['components'].values():
 n=1
 for vals in f['figma']['variantAxes'].values():n*=len(vals)
 assert n<=30
(OUT/'prepared-contract.json').write_text(json.dumps(P,ensure_ascii=False,indent=2)+'\n')
report={'status':'local preparation only; zero Figma writes','tokens':475,'projectionVariables':1187,'layers':dict(collections.Counter(t['layer'] for t in TOKENS)),'resolutions':6,'collections':7,'candidateSets':96,'iconComponents':23,'textStyles':27,'variantsPerCandidate':sum(__import__('math').prod(len(v) for v in f['figma']['variantAxes'].values()) for f in P['components'].values()),'largestVariantSet':max(__import__('math').prod(len(v) for v in f['figma']['variantAxes'].values()) for f in P['components'].values()),'contractSha256':P['contractSha256'],'aliasValidation':'all references exist, are acyclic, same-type and one-layer directed','cssMapping':'explicit proposed --draft-compact-* names; production variables unchanged'}
(OUT/'preparation-validation.json').write_text(json.dumps(report,indent=2)+'\n')
parser=argparse.ArgumentParser();parser.add_argument('--stage',choices=['variables','styles','pages','icons','components','foundations','showcase','screens','audit','fix-components','selected-audit','exploratory','fix-screens','fix-foundations']);parser.add_argument('--candidate',default='A');parser.add_argument('--layer',default='primitive');parser.add_argument('--families',default='');parser.add_argument('--mode',default='Light');parser.add_argument('--offset',type=int,default=0);parser.add_argument('--limit',type=int,default=80);args=parser.parse_args()
if args.stage:
 statepath=OUT/'state.json';state=json.loads(statepath.read_text()) if statepath.exists() else {'entities':{}}
 config={'candidate':args.candidate,'layer':args.layer,'families':args.families.split(',') if args.families else [],'state':state,'offset':args.offset,'limit':args.limit,'mode':args.mode}
 modules=[OUT/'scripts'/f'{n}.js' for n in ['helpers',args.stage]]
 Q={'pages':P['pages'],'candidates':[{'id':c['id'],'name':c['name'], 'layout':c['layout'] if c['id']==args.candidate else {},'tokenOverrides':c['tokenOverrides'] if c['id']==args.candidate and args.stage=='variables' else {},'componentOverrides':c['componentOverrides'] if c['id']==args.candidate and args.stage=='components' else {}} for c in P['candidates']]}
 if args.stage=='variables':
  defs=[t for t in P['tokens'] if t['layer']==args.layer][args.offset:args.offset+args.limit]
  refs={ref for t in defs for ref in re.findall(r'\{([^}]+)\}',str(selected(t,next(c for c in D['candidates'] if c['id']==args.candidate),'light'))+str(selected(t,next(c for c in D['candidates'] if c['id']==args.candidate),'dark')))}
  Q['tokens']=defs+[{'path':t['path'],'layer':t['layer']} for t in P['tokens'] if t['path'] in refs and t['layer']!=args.layer]
 else:Q['tokens']=[]
 Q['resolved']={args.candidate:{m:{k:v for k,v in P['resolved'][args.candidate][m].items() if not k.startswith('primitive.')} for m in ['light','dark'] if m=='light' or args.stage in ['styles','foundations']}}
 if args.stage in ['components','screens','showcase','icons']:Q['resolved'][args.candidate]['light']={k:v for k,v in Q['resolved'][args.candidate]['light'].items() if isinstance(v,(int,float))}
 Q['components']={k:v for k,v in P['components'].items() if k in config['families']} if args.stage=='components' else {}
 Q['profiles']={}
 if args.stage=='components':
  Q['components']={k:{field:v[field] for field in ['tokenPrefix','states','figma','behavior']} for k,v in Q['components'].items()}
  groups=set(re.findall(r'"profile":\s*"([^.]+)\.',json.dumps(Q['components'])))
  if any('Intent' in f['figma']['variantAxes'] for f in Q['components'].values()):groups.add('primary')
  pending=list(groups)
  while pending:
   group=pending.pop();Q['profiles'][group]=P['profiles'][group]
   for dep in re.findall(r'"extends":\s*"([^.]+)\.',json.dumps(P['profiles'][group])):
    if dep not in groups:groups.add(dep);pending.append(dep)

 Q['icons']=P['icons'] if args.stage=='icons' else {}
 if args.stage=='pages':Q={'pages':P['pages'],'candidates':[{'id':args.candidate}], 'resolved':{args.candidate:{'light':{}}}}
 if args.stage=='selected-audit':
  Q['tokens']=[[t['path'],t['figmaType'],t['scopes'],None if args.mode=='scopes' else t['value']] for t in P['tokens'][args.offset:args.offset+args.limit]] if args.layer=='components' else []
  Q['resolved']={args.candidate:{'light':{}}}
  Q['components']={k:{'axes':v['figma']['variantAxes']} for k,v in P['components'].items()}
 # Only actual dependencies enter each bounded connector payload. The connector limit is 50000 characters.
 config['state']={'entities':{k:v for k,v in state.get('entities',{}).items() if k in (['icons'] if args.stage=='components' else ['componentSets'] if args.stage in ['screens','showcase','audit','fix-components','selected-audit','fix-screens','fix-foundations'] else [])}}
 if 'componentSets' in config['state']['entities']:config['state']['entities']['componentSets']=[{k:s[k] for k in ['id','family','candidate']} for s in config['state']['entities']['componentSets'] if s['candidate']==args.candidate]
 code='const D='+json.dumps(Q,ensure_ascii=False,separators=(',',':'))+';\nconst CFG='+json.dumps(config,separators=(',',':'))+';\n'+modules[0].read_text()+'\ntry {\n'+modules[1].read_text()+'\n} catch(error) { return result({executionError:String(error),stack:error.stack,stage:'+json.dumps(args.stage)+'}); }'
 assert len(code)<=50000, ('connector payload limit',args.stage,len(code))
 path=OUT/f'next-{args.stage}.js';path.write_text(code);print(json.dumps({'script':str(path),'bytes':len(code.encode()),'validation':report}))
else:print(json.dumps(report))
