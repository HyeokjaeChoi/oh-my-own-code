"""Capture this isolated proposal with one explicitly named browser session.
No app test suite, backend, network service or production source is used.
"""
import subprocess,json,pathlib
ROOT=pathlib.Path(__file__).resolve().parent
CLI='/Users/hyukjaechoi/.nvm/versions/node/v24.14.1/bin/agent-browser'
SESSION='omoc-compact-preview-worker'
BASE='http://127.0.0.1:4187/preview/index.html'
def call(*args,input=None):
 p=subprocess.run([CLI,'--session',SESSION,*args],input=input,text=True,capture_output=True)
 if p.returncode: raise RuntimeError(p.stderr+p.stdout)
 return p.stdout.strip()
def js(code):
 raw=call('eval','--stdin',input=code)
 try:
  v=json.loads(raw)
  return json.loads(v) if isinstance(v,str) else v
 except ValueError:return raw
ROOT.joinpath('evidence').mkdir(exist_ok=True)
call('set','viewport','1280','800')
rows=[]
measurement="""JSON.stringify({viewport:[innerWidth,innerHeight],dpr:devicePixelRatio,zoom:visualViewport.scale,candidate:preview.state.candidate,scene:preview.state.scene,theme:preview.state.theme,stage:{width:document.querySelector('#stage').clientWidth,height:document.querySelector('#stage').clientHeight,transform:getComputedStyle(document.querySelector('#stage')).transform},sidebar:document.querySelector('.sidebar').getBoundingClientRect().width,header:document.querySelector('.appheader').getBoundingClientRect().height,composer:document.querySelector('.composer').getBoundingClientRect().height,input:document.querySelector('textarea').getBoundingClientRect().height,toolbar:document.querySelector('.toolbar')?.getBoundingClientRect().height||0,send:document.querySelector('.send').getBoundingClientRect().height,inspector:document.querySelector('.inspector')?.getBoundingClientRect().width||0,bodyOverflow:document.documentElement.scrollWidth>innerWidth})"""
for candidate in 'ABC':
 for theme in ['light','dark']:
  for scene in ['empty','conversation','permission','artifact']:
   call('open',f'{BASE}?app=1&candidate={candidate}&theme={theme}&scene={scene}')
   call('wait','--fn','!!window.preview')
   row=js(measurement)
   name=f'{candidate}-{scene}-{theme}.png'
   call('screenshot',str(ROOT/'evidence'/name))
   row['screenshot']='evidence/'+name
   rows.append(row)
   print(candidate,scene,theme,row['composer'],flush=True)
# Source-based gallery traversal on actual DOM. No self approval.
gallery=[]
for candidate in 'ABC':
 call('open',f'{BASE}?app=1&candidate={candidate}&theme=light&view=components')
 gallery.append(js("JSON.stringify(Object.keys(preview.components()).map(f=>{preview.state.family=f;preview.render();return {family:f,states:Object.keys(preview.components()[f].states).length,specimens:document.querySelectorAll('[data-spec-family]').length}}))"))
for view,family in [('foundations','composer'),('components','composer'),('components','permission'),('components','navigation'),('components','extensions')]:
 call('open',f'{BASE}?app=1&candidate=A&view={view}&family={family}&theme=light')
 call('screenshot',str(ROOT/'evidence'/f'A-{view}-{family}-light.png'))
ROOT.joinpath('evidence','capture-metrics.json').write_text(json.dumps({'session':SESSION,'rows':rows,'gallery':gallery,'method':'Actual Chromium CDP rendering through installed agent-browser; headless; viewport1280x800; DPR1; visualViewport.scale1. Author observation only.'},ensure_ascii=False,indent=2))
