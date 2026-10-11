import subprocess,json,pathlib
ROOT=pathlib.Path('/Users/hyukjaechoi/Projects/oh-my-own-code/docs/runs/composer-room/execution')
def run(*args):
 p=subprocess.run(['agent-browser','--session','composer-room-worker',*args],text=True,capture_output=True)
 if p.returncode: raise RuntimeError(p.stdout+p.stderr)
 return p.stdout.strip()
def ev(js):
 v=json.loads(run('eval',js));return json.loads(v) if isinstance(v,str) else v
base='http://127.0.0.1:4188/preview/index.html?app=1'
measure='''JSON.stringify({candidate:document.querySelector('#stage').dataset.candidate,theme:document.querySelector('#stage').dataset.theme,viewport:[innerWidth,innerHeight],composer:document.querySelector('.composer').getBoundingClientRect().toJSON(),input:document.querySelector('textarea').getBoundingClientRect().toJSON(),toolbar:document.querySelector('.toolbar')?.getBoundingClientRect().toJSON(),hint:document.querySelector('.hint')?.getBoundingClientRect().toJSON(),overflow:getComputedStyle(document.querySelector('textarea')).overflowY,scrollHeight:document.querySelector('textarea').scrollHeight,documentWidth:document.documentElement.scrollWidth})'''
out={}
for candidate in ['A','B','C']:
 run('open',base+'&candidate='+candidate)
 out[candidate+'-empty']=ev(measure)
 assert out[candidate+'-empty']['input']['height']==(72 if candidate=='A' else 24)
run('open',base+'&candidate=A&theme=dark');out['A-dark']=ev(measure);run('screenshot',str(ROOT/'chrome-A-empty-dark.png'))
run('fill','textarea','첫 번째 줄\n두 번째 줄\n세 번째 줄');out['three-lines']=ev(measure);assert out['three-lines']['composer']['height']==120
run('fill','textarea','\n'.join('입력 '+str(i) for i in range(12)));out['cap']=ev(measure);assert out['cap']['input']['height']==144 and out['cap']['composer']['height']==192 and out['cap']['overflow']=='auto'
run('open',base+'&candidate=A&attachment=1');out['attachment']=ev(measure);assert out['attachment']['composer']['height']==160
run('set','viewport','640','440');out['short-narrow-attachment']=ev(measure);assert out['short-narrow-attachment']['hint']['bottom']<=440 and out['short-narrow-attachment']['toolbar']['bottom']<=440
run('screenshot',str(ROOT/'chrome-A-short-narrow-attachment.png'))
run('open',base+'&candidate=A&view=components&family=composer');out['states']=ev('''JSON.stringify([...document.querySelectorAll('[data-composer-state]')].map(n=>({state:n.dataset.composerState,inputHeight:n.querySelector('textarea').getBoundingClientRect().height,readonly:n.querySelector('textarea').readOnly,sendDisabled:n.querySelector('.send').disabled,reason:n.parentElement.querySelector('.state-reason')?.textContent})))''')
assert all(x['inputHeight']>=72 for x in out['states'])
assert next(x for x in out['states'] if x['state']=='unknown')['sendDisabled']
assert next(x for x in out['states'] if x['state']=='archived')['readonly']
for scene in ['permission','artifact']:
 run('set','viewport','1280','800');run('open',base+'&candidate=A&scene='+scene);out[scene]=ev(measure)
 assert out[scene]['hint']['bottom']<=800
ROOT.joinpath('browser-observations.json').write_text(json.dumps(out,ensure_ascii=False,indent=2))
run('open',base+'&candidate=A')
print('PASS: A120/72/32, B/C24 minimum, 3 lines120, cap144/192+scroll, attachment160, 640x440 bounds, unknown/archived/state helpers, permission/artifact bounds')
