"""Persist actual returned IDs immediately after each MCP call; never infer IDs."""
import argparse,json,pathlib,datetime
OUT=pathlib.Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('response');p.add_argument('--candidate',default='A');p.add_argument('--stage',required=True);a=p.parse_args()
raw=json.loads(pathlib.Path(a.response).read_text());result=raw.get('structuredContent')
if not isinstance(result,dict) or not any(k in result for k in ['affectedNodeIds','variables','pages','screens','executionError']):
 result=None
 for c in raw.get('content',[]):
  if c.get('type')=='text':
   try:
    z=json.loads(c['text'])
    if isinstance(z,dict):result=z;break
   except json.JSONDecodeError:pass
if result is None:result={**raw,'executionError':raw.get('structuredContent',{}).get('error','No complete structured payload; connector may have truncated its response.')}
if raw.get('isError') and not result.get('executionError'):result['executionError']=str(raw.get('structuredContent',{}).get('error') or raw.get('content',[]))
(OUT/'evidence'/('parsed-'+pathlib.Path(a.response).name)).write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
sp=OUT/'state.json';state=json.loads(sp.read_text()) if sp.exists() else {'runId':'compact-figma-library','scope':'full-library additive draft','fileKey':'e6QYqEsmA3FHB6A2ohNr2o','entities':{},'completedSteps':[],'responses':[]}
e=state['entities'];state['responses'].append({'stage':a.stage,'candidate':a.candidate,'path':str(pathlib.Path(a.response)),'at':datetime.datetime.now(datetime.timezone.utc).isoformat()});state['lastAffectedNodeIds']=result.get('affectedNodeIds',[])
if 'collection' in result:
 e.setdefault('collections',{})[result['collection']['name']]=result['collection']
 for v in result.get('variables',[]):e.setdefault('variables',{})[result['collection']['name']+' / '+v['path']]=v
for key in ['pages','icons','textStyles','effectStyles','screens','foundations','showcases']:
 if key in result:
  target=e.setdefault(key,[])
  for item in result[key]:
   if isinstance(item,dict):
    item={**item,'candidate':a.candidate};target[:]=[i for i in target if i['id']!=item['id']];target.append(item)
for item in result.get('componentSets',[]):
 item={**item,'candidate':a.candidate};target=e.setdefault('componentSets',[]);target[:]=[i for i in target if i['id']!=item['id']];target.append(item)
if result.get('executionError') or raw.get('isError'):state['lastError']=result.get('executionError') or raw
else:
 step=a.stage+':'+a.candidate
 if step not in state['completedSteps']:state['completedSteps'].append(step)
state['status']='actual mutations recorded; independent review pending'
sp.write_text(json.dumps(state,ensure_ascii=False,indent=2)+'\n');pathlib.Path('/private/tmp/design-system-state-compact-figma-library.json').write_text(sp.read_text())
print(json.dumps({'stage':a.stage,'candidate':a.candidate,'affectedNodes':len(state['lastAffectedNodeIds']),'collections':len(e.get('collections',{})),'variables':len(e.get('variables',{})),'sets':len(e.get('componentSets',[])),'screens':len(e.get('screens',[])),'error':result.get('executionError'),'state':str(sp)}))
