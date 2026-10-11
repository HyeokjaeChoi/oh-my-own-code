const page=figma.root.children.find(p=>p.name===family);
if(page.children.length)throw new Error('Expected empty family page; inspect before retry.');
const specs=contract.variants.filter(v=>v.family===family);
const card=['ToolCall','PermissionRequest'].includes(family);
const axes=family==='Button'?{Intent:['primary','quiet','danger'],State:['default','hover','pressed','focus','disabled','loading']}:{State:specs.map(v=>v.name)};
// Skill helper performs the single page switch for this call.
const result=await createComponentWithVariants({name:family,description:specs[0].behavior,variantAxes:axes,baseProps:{width:card?400:family==='Input'?280:family==='NavigationItem'?220:136,height:40,layoutMode:'VERTICAL',fills:[]},page});
const set=result.componentSet;created.push(set.id,...result.variants.map(n=>n.id));paint(set,'fills','semantic.color.surface');set.strokes=[];
const labelProp=set.addComponentProperty('Label','TEXT',family==='Button'?'계속':family==='NavigationItem'?'작업':family==='Input'?'경로':'');
for(let i=0;i<specs.length;i++){
 const spec=specs[i],c=result.variants[i],b=spec.bindings;c.description=spec.content+' '+spec.behavior;c.primaryAxisAlignItems='MIN';c.counterAxisAlignItems='MIN';c.clipsContent=false;c.layoutSizingVertical='HUG';
 const focus=!!b.focusRing;
 let target=c;
 if(family==='Input'){
  const label=await txt(c,spec.properties.label,'label');label.componentPropertyReferences={characters:labelProp};
  if(focus){const ring=stack(c,'Focus ring',284);paint(ring,'fills',b.focusGapBackground);padding(ring,b.focusGapWidth);paint(ring,'strokes',b.focusRing);bound(ring,'strokeWeight',b.focusWidth);bound(ring,'cornerRadius','semantic.radius.control');ring.strokeAlign='OUTSIDE';target=stack(ring,'Field',280,'HORIZONTAL');c.resize(284,80);}else target=stack(c,'Field',280,'HORIZONTAL');
 }else if(focus){
  paint(c,'fills',b.focusGapBackground||'semantic.color.surface');padding(c,b.focusGapWidth||'semantic.stroke.focus');paint(c,'strokes',b.focusRing);bound(c,'strokeWeight',b.focusWidth);c.strokeAlign='OUTSIDE';bound(c,'cornerRadius','semantic.radius.control');
  target=stack(c,'Control',family==='NavigationItem'?220:136,'HORIZONTAL');c.resize((family==='NavigationItem'?220:136)+4,44);
 }
 paint(target,'fills',b.background);if(b.border){paint(target,'strokes',b.border);target.strokeWeight=1;}if(b.radius)bound(target,'cornerRadius',b.radius);else if(family==='NavigationItem')bound(target,'cornerRadius','semantic.radius.control');
 if(b.height){bound(target,'height',b.height);target.layoutSizingVertical='FIXED';target.layoutMode='HORIZONTAL';target.primaryAxisAlignItems='CENTER';target.counterAxisAlignItems='CENTER';}
 if(b.padding)padding(target,b.padding);
 if(b.paddingX){bound(target,'paddingLeft',b.paddingX);bound(target,'paddingRight',b.paddingX);bound(target,'paddingTop','semantic.space.control-gap');bound(target,'paddingBottom','semantic.space.control-gap');}
 if(!card&&!b.paddingX){bound(target,'paddingLeft',family==='Button'?'semantic.space.panel-padding':'semantic.space.card-gap');bound(target,'paddingRight',family==='Button'?'semantic.space.panel-padding':'semantic.space.card-gap');}
 bound(target,'itemSpacing','semantic.space.control-gap');
 if(family==='Input'){
  target.primaryAxisAlignItems='MIN';

  const label=await txt(target,spec.properties.placeholder,'body',b.placeholder,250);
  const p=set.addComponentProperty('Placeholder '+spec.name,'TEXT',spec.properties.placeholder);label.componentPropertyReferences={characters:p};
  if(spec.visual.errorText)await txt(c,spec.visual.errorText,'caption','semantic.color.danger.foreground',280);
 }else if(card){
  target.layoutMode='VERTICAL';bound(target,'itemSpacing','semantic.space.card-gap');
  await txt(target,family==='ToolCall'?'파일 읽기 · read_file':'파일 수정 권한 요청','label',b.foreground,368);
  const badge=stack(target,'Status',150,'HORIZONTAL');paint(badge,'fills',b.statusBackground);bound(badge,'cornerRadius','semantic.radius.badge');padding(badge,'semantic.space.control-gap');await txt(badge,spec.properties.statusLabel,'caption',b.statusForeground,130);
  if(family==='ToolCall'){
   await txt(target,'출처  개발 에이전트\n대상  src/workbench/session.ts','body',b.foreground,368);
   await txt(target,'입력  { path: "src/workbench/session.ts" }\n출력  민감한 값은 [마스킹]','code',b.foreground,368);
   await txt(target,spec.name==='success'?'결과  읽기 완료 · 근거 보기':spec.name==='error'?'결과  접근 실패 · 경로와 권한 확인':'결과  아직 확인되지 않음','body',b.foreground,368);
  }else{
   await txt(target,'세션 local-001 · 요청 permission-014\n능력  파일 쓰기 · 범위  이 요청 1회\n대상  /workspace/oh-my-own-code/src/workbench/session.ts\n기간  이번 요청 응답까지\n영향  대상 파일 내용을 변경합니다.','body',b.foreground,368);
   await txt(target,spec.name==='approved'?'승인 전달됨 · 실행 결과는 아직 확인되지 않았습니다.':spec.name==='stale'?'이 요청은 만료되었습니다. 현재 요청을 다시 확인하세요.':spec.name==='sending'?'결정을 전달하고 있습니다. 중복 응답할 수 없습니다.':spec.name==='denied'?'요청을 거절했습니다. 실행 완료를 의미하지 않습니다.':'범위와 대상을 확인한 후 결정하세요.','caption',b.foreground,368);
   for(const label of spec.visual.actions){const a=stack(target,'Action '+label,368,'HORIZONTAL');paint(a,'fills','component.color.button.quiet.background');bound(a,'height','semantic.size.control-height');a.layoutSizingVertical='FIXED';a.primaryAxisAlignItems='CENTER';bound(a,'cornerRadius','semantic.radius.control');await txt(a,label,'label','component.color.button.quiet.foreground');}
  }
 }else{
  const value=spec.properties.label||spec.properties.statusLabel||spec.content;
  if(spec.properties.busy)await txt(target,'◌','label',b.foreground);
  const t=await txt(target,value,'label',b.foreground);if(['Button','NavigationItem'].includes(family))t.componentPropertyReferences={characters:labelProp};
 }
 if(spec.visual.feedbackUnderline){const ts=target.findAll(n=>n.type==='TEXT');for(const t of ts)t.textDecoration='UNDERLINE';}
 if(spec.visual.feedbackInsetStrokePx){paint(target,'strokes',b.foreground);target.strokeWeight=spec.visual.feedbackInsetStrokePx;target.strokeAlign='INSIDE';}
}
// Fixed documentation grid geometry; source component visual values remain bound.
const cols=card?2:family==='Button'?6:3;const cellW=card?440:family==='Input'?320:family==='NavigationItem'?260:176;
const maxH=Math.max(...result.variants.map(c=>c.height));
for(let i=0;i<result.variants.length;i++){const c=result.variants[i];c.x=24+(i%cols)*cellW;c.y=48+Math.floor(i/cols)*(maxH+64);}
set.resize(cols*cellW+48,Math.ceil(specs.length/cols)*(maxH+64)+48);set.x=80;set.y=340;
const header=await board(page,family,`${specs.length} variants · Light/Dark\n${specs[0].behavior}`,Math.max(760,set.width));header.x=80;header.y=40;
const dark=stack(page,'Dark examples',card?460:800);dark.x=set.x+set.width+80;dark.y=340;padding(dark,'semantic.space.section-gap');paint(dark,'fills','semantic.color.surface');mode(dark,'Dark');await txt(dark,'Dark · examples','heading');
for(const c of result.variants){const ins=track(c.createInstance());dark.appendChild(ins);}
return {family,pageId:page.id,setId:set.id,variantCount:set.children.length,createdNodeIds:created,variants:set.children.map(c=>({id:c.id,name:c.name,nodes:allNodes(c).map(record)})),documentation:record(header),darkFrameId:dark.id,bounds:{width:set.width,height:set.height}};
