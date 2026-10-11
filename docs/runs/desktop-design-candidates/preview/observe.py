import pathlib,json
exec(pathlib.Path(__file__).with_name('capture.py').read_text().split("ROOT.joinpath('evidence').mkdir")[0])
notes=[]
call('set','viewport','1280','800')
for candidate in 'ABC':
 call('open',f'{BASE}?app=1&candidate={candidate}&scene=permission')
 notes.append(js("JSON.stringify({kind:'permission-visible',candidate:preview.state.candidate,card:document.querySelector('.permission').getBoundingClientRect().toJSON(),scroll:document.querySelector('.content').scrollTop,content:document.querySelector('.content').getBoundingClientRect().toJSON(),composer:document.querySelector('.composer').getBoundingClientRect().toJSON()})"))
 call('open',f'{BASE}?app=1&candidate={candidate}&scene=conversation')
 call('fill','textarea','첫 번째 줄\n두 번째 줄\n세 번째 줄')
 notes.append(js("JSON.stringify({kind:'three-lines',candidate:preview.state.candidate,input:document.querySelector('textarea').getBoundingClientRect().height,composer:document.querySelector('.composer').getBoundingClientRect().height})"))
 js("preview.state.attachment=true;preview.render();true")
 notes.append(js("JSON.stringify({kind:'three-lines-attachment',candidate:preview.state.candidate,composer:document.querySelector('.composer').getBoundingClientRect().height})"))
# Real keyboard and locally functional controls.
call('open',f'{BASE}?app=1&candidate=C&scene=conversation')
call('click','.sessiontitle')
call('fill','.drawer input','로컬')
notes.append(js("JSON.stringify({kind:'search',visibleSessions:[...document.querySelectorAll('.drawer [data-session]')].filter(x=>x.getClientRects().length).map(x=>x.dataset.session)})"))
call('press','Escape')
notes.append(js("JSON.stringify({kind:'drawer-escape-return',focus:document.activeElement.className,drawer:!!document.querySelector('.drawer')})"))
call('click','[data-action="agent"]')
call('press','ArrowDown');call('press','Enter')
notes.append(js("JSON.stringify({kind:'menu-keyboard-selection',agent:preview.state.agent,focus:document.activeElement.textContent,menu:!!document.querySelector('.popover')})"))
call('click','[data-action="effect"].send');call('press','Tab');call('press','Escape')
notes.append(js("JSON.stringify({kind:'dialog-escape-return',dialog:!!document.querySelector('.overlay'),focus:document.activeElement.getAttribute('aria-label')})"))
# IME event-path probe only, not native Korean input validation.
notes.append(js("JSON.stringify((()=>{const t=document.querySelector('textarea');t.focus();t.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'한'}));t.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'Enter',isComposing:true}));const result={kind:'synthetic-ime-guard',dialog:!!document.querySelector('.overlay')};t.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'한'}));return result})())"))
for width,height in [(640,800),(320,640),(1280,440)]:
 call('set','viewport',str(width),str(height))
 for candidate in 'ABC':
  call('open',f'{BASE}?app=1&candidate={candidate}&scene=permission')
  notes.append(js("JSON.stringify({kind:'reflow',candidate:preview.state.candidate,viewport:[innerWidth,innerHeight],documentWidth:document.documentElement.scrollWidth,textareaWidth:document.querySelector('textarea').clientWidth,card:document.querySelector('.permission').getBoundingClientRect().toJSON(),content:document.querySelector('.content').getBoundingClientRect().toJSON(),scope:document.querySelector('.permission .scope').textContent,warning:document.querySelector('.permission p').nextElementSibling.textContent,contextButtons:[...document.querySelectorAll('.compact-context')].filter(x=>x.getClientRects().length).length})"))
  call('screenshot',str(ROOT/'evidence'/f'{candidate}-permission-{width}x{height}.png'))
call('set','viewport','1280','800')
ROOT.joinpath('evidence','interaction-observations.json').write_text(json.dumps({'observations':notes,'limits':['Physical Korean IME not tested; synthetic composition events only.','Native browser 200 percent zoom, forced-colors and reduced-motion emulation not executed. CSS implementation is source-reviewed; 640 effective-width reflow captured.','These are author observations, not independent approval.']},ensure_ascii=False,indent=2))
print(json.dumps(notes,ensure_ascii=False,indent=2))
