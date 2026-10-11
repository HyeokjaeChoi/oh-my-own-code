"""Bounded author browser observations for D1/D2. No independent approval."""
import subprocess,json,pathlib,hashlib
ROOT=pathlib.Path(__file__).resolve().parent
CLI='/Users/hyukjaechoi/.nvm/versions/node/v24.14.1/bin/agent-browser'
SESSION='omoc-preview-repair-worker'
BASE='http://127.0.0.1:4187/preview/index.html'
def call(*args,input=None):
 p=subprocess.run([CLI,'--session',SESSION,*args],input=input,text=True,capture_output=True)
 if p.returncode:raise RuntimeError(p.stderr+p.stdout)
 return p.stdout.strip()
def js(code):
 v=json.loads(call('eval','--stdin',input=code))
 return json.loads(v) if isinstance(v,str) else v
notes=[]
call('set','viewport','1280','800')
for c in 'ABC':
 call('open',f'{BASE}?app=1&candidate={c}&scene=conversation&theme=light')
 call('focus','[data-action="attach"]')
 # A textarea is immediately before its attach control; B/C immediately after.
 call('press','Shift+Tab' if c=='A' else 'Tab')
 focus=js("JSON.stringify({candidate:preview.state.candidate,active:document.activeElement.tagName,focusVisible:document.activeElement.matches(':focus-visible'),outline:getComputedStyle(document.activeElement).outlineWidth,offset:getComputedStyle(document.activeElement).outlineOffset,color:getComputedStyle(document.activeElement).outlineColor,expected:preview.tokens()['semantic.color.focus'],composer:document.querySelector('.composer').getBoundingClientRect().height,viewport:[innerWidth,innerHeight],dpr:devicePixelRatio,scale:visualViewport.scale})")
 assert focus['composer']=={'A':72,'B':52,'C':68}[c],focus
 assert focus['active']=='TEXTAREA' and focus['focusVisible'] and focus['outline']=='2px' and focus['offset']=='2px',focus
 notes.append({'kind':'keyboard-focus',**focus})
 if c=='C':call('screenshot',str(ROOT/'evidence/repaired-C-textarea-focus-light.png'))
 call('fill','textarea','첫 번째 줄\n두 번째 줄\n세 번째 줄')
 geometry=js("JSON.stringify({candidate:preview.state.candidate,input:document.querySelector('textarea').getBoundingClientRect().height,composer:document.querySelector('.composer').getBoundingClientRect().height})")
 assert geometry['input']==72 and geometry['composer']=={'A':120,'B':92,'C':108}[c],geometry
 notes.append({'kind':'three-line-geometry',**geometry})
 js("preview.state.attachment=true;preview.render();true")
 attached=js("JSON.stringify({candidate:preview.state.candidate,composer:document.querySelector('.composer').getBoundingClientRect().height})")
 assert attached['composer']=={'A':160,'B':132,'C':148}[c],attached
 notes.append({'kind':'attachment-geometry',**attached})
 call('fill','textarea','\n'.join(['줄']*10))
 maximum=js("JSON.stringify({candidate:preview.state.candidate,input:document.querySelector('textarea').getBoundingClientRect().height,composer:document.querySelector('.composer').getBoundingClientRect().height,overflow:getComputedStyle(document.querySelector('textarea')).overflowY})")
 assert maximum['input']==144 and maximum['composer']=={'A':232,'B':204,'C':220}[c] and maximum['overflow']=='auto',maximum
 notes.append({'kind':'max-attachment-geometry',**maximum})
for c in 'ABC':
 call('open',f'{BASE}?app=1&candidate={c}&view=components&family=navigation&theme=light')
 selected=js("JSON.stringify((()=>{const b=document.querySelector('.navrow.selected.spec-focus');return {current:b.getAttribute('aria-current'),outline:getComputedStyle(b).outlineWidth,offset:getComputedStyle(b).outlineOffset}})())")
 assert selected['current']=='page' and selected['outline']=='2px' and selected['offset']=='2px',selected
 notes.append({'kind':'selected-focus','candidate':c,**selected})
 for theme in ['light','dark']:
  call('set','viewport','1280','800')
  call('open',f'{BASE}?app=1&candidate={c}&view=components&family=composer&theme={theme}')
  rows=js("""JSON.stringify([...document.querySelectorAll('[data-spec-family="composer"]')].map(root=>{const x=root.querySelector('.composer'),t=x.querySelector('textarea'),send=x.querySelector('.send'),help=document.getElementById(t.getAttribute('aria-describedby'));return {state:root.dataset.specState,inputDisabled:t.disabled,readOnly:t.readOnly,invalid:t.getAttribute('aria-invalid'),draft:t.value,sendDisabled:send.disabled,sendName:send.getAttribute('aria-label'),context:[...root.querySelectorAll('[data-action="agent"],[data-action="model"],[data-action="context"]')].map(b=>({action:b.dataset.action,disabled:b.disabled,description:b.getAttribute('aria-describedby')})),edge:getComputedStyle(x,'::before').borderTopColor,edgeDisplay:getComputedStyle(x,'::before').display,invalidToken:preview.tokens()['component.field.invalidBorder'],help:help?.textContent,helpId:help?.id,sendHelp:send.getAttribute('aria-describedby'),busy:x.getAttribute('aria-busy'),outline:getComputedStyle(t).outlineWidth,focusClass:t.classList.contains('spec-focus')};}))""")
  for r in rows:
   s=r['state']
   if s in ['sending','unknown','stale','stopping','archived','unavailable']:assert r['sendDisabled'] and r['sendHelp']==r['helpId'] and r['help'],r
   if s in ['running','stopping','sending']:assert len(r['context'])==3 and all(x['disabled'] and x['description']==r['helpId'] for x in r['context']),r
   if s=='archived':assert r['readOnly'] and not r['inputDisabled'],r
   if s in ['error','error-focus-visible']:assert r['invalid']=='true' and r['help'] and r['edgeDisplay']!='none',r
   if s=='unknown':assert r['draft'] and '반복하지' in r['help'],r
   if s=='focus-visible' or s=='error-focus-visible':assert r['outline']=='2px' and r['focusClass'],r
  # Resolve expected hex through the browser to compare computed RGB, not token spelling.
  edge=js("JSON.stringify((()=>{const p=document.createElement('span');p.style.color=preview.tokens()['component.field.invalidBorder'];document.body.append(p);const color=getComputedStyle(p).color;p.remove();return color})())")
  assert all(r['edge']==edge for r in rows if r['state'] in ['error','error-focus-visible']),rows
  call('focus','[data-spec-state="unknown"] textarea');call('press','Enter')
  unknown=js("JSON.stringify({draft:document.querySelector('[data-spec-state=unknown] textarea').value,dialog:!!document.querySelector('.overlay')})")
  assert unknown['draft'] and not unknown['dialog'],unknown
  call('focus','[data-spec-state="archived"] textarea');call('press','Enter')
  assert not js("JSON.stringify(!!document.querySelector('.overlay'))")
  notes.append({'kind':'composer-child-states','candidate':c,'theme':theme,'states':rows,'unknownEnter':unknown})
  height=js("JSON.stringify(document.querySelector('.gallery').scrollHeight+32)")
  call('set','viewport','1280',str(height))
  js("document.querySelector('.gallery').scrollTop=0;document.activeElement.blur();true")
  call('screenshot',str(ROOT/'evidence'/f'repaired-{c}-composer-states-{theme}.png'))
  notes.append({'kind':'gallery-capture','candidate':c,'theme':theme,'viewport':[1280,height],'dpr':js('JSON.stringify(devicePixelRatio)'),'scale':js('JSON.stringify(visualViewport.scale)')})
call('set','viewport','1280','800')
call('open',f'{BASE}?app=1&candidate=C&scene=empty&theme=dark')
call('focus','[data-action="attach"]');call('press','Tab')
call('screenshot',str(ROOT/'evidence/repaired-C-textarea-focus-dark.png'))
notes.append({'kind':'dark-C-focus','details':js("JSON.stringify({active:document.activeElement.tagName,focusVisible:document.activeElement.matches(':focus-visible'),outline:getComputedStyle(document.activeElement).outlineWidth,offset:getComputedStyle(document.activeElement).outlineOffset})")})
call('close')
ROOT.joinpath('evidence/repaired-observations.json').write_text(json.dumps({'session':SESSION,'observations':notes,'meaning':'Actual CLI-driven Chromium author observations. No independent approval. No physical IME/native 200% zoom/forced-colors/reduced-motion check.'},ensure_ascii=False,indent=2))
print(f'Passed: {len(notes)} observation groups; 8 repaired captures; dedicated session closed.')
