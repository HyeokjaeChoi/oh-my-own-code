X=await context();const page=await pageAt(D.pages[1]),sets={};for(const s of CFG.state.entities.componentSets)sets[s.family]=await figma.getNodeByIdAsync(s.id);
const labels={pending:'승인 대기',submitting:'응답 중 · 예시',approved:'허용 응답 확인 예시',denied:'거절 응답 확인 예시',error:'응답 오류 예시',unknown:'결과 알 수 없음 · 자동 재전송 없음',stale:'오래된 요청 · 최신 상태 확인 필요',expired:'만료됨 · 응답할 수 없음','focus-visible':'승인 대기',sending:'전송 응답 대기',stopping:'중지 응답 대기 · 중지 버튼 비활성',unavailable:'현재 연결에서 사용할 수 없습니다',archived:'보관된 세션 · 읽기 전용'};
const fixedFamilies=[];for(const [family,set] of Object.entries(sets)){
const deleteKeys=new Set();for(const v of set.children){const st=v.name.match(/(?:^|, )State=([^,]+)/)?.[1]||v.name.match(/(?:^|, )Data=([^,]+)/)?.[1];
for(const t of v.findAll(n=>n.type==='TEXT')){const refs=t.componentPropertyReferences,key=refs?.characters;if(!key)continue;const field=key.split('#')[0];
if(field==='Status'||(field==='Label'&&family==='toolSummary')){
const next={...refs};delete next.characters;t.componentPropertyReferences=next;deleteKeys.add(key);
t.characters=family==='toolSummary'?(st==='completed'?'read_file · 완료 · 파일 3개':'read_file · '+({expanded:'완료 · 파일 3개',pending:'대기 중',running:'실행 중',error:'오류',unknown:'결과 알 수 없음',stale:'이전 결과','focus-visible':'완료 · 파일 3개'}[st]||st)):(family==='composer'?labels[st]||'':labels[st]||({loading:'불러오는 중',running:'실행 중',disabled:'사용할 수 없음',empty:'확인된 항목 없음'}[st]||'현재 상태'));touch(t);}
}
if(family==='code'){v.primaryAxisSizingMode='AUTO';touch(v);}
if(family==='artifactTabs'){fill(v,'component.shell.background');if(v.strokes.length){v.strokes=[];touch(v)}const file=v.children.find(n=>n.type==='FRAME'&&n.name==='File');if(st==='focus-visible'&&file)stroke(file,'component.control.focus',2);}
}
for(const key of deleteKeys){if(set.componentPropertyDefinitions[key]){set.deleteComponentProperty(key);touch(set)}}if(deleteKeys.size)fixedFamilies.push(family);
}
// Gallery Text prop defaults are explicit fixture inputs, independently from the State axis.
for(const frame of page.children.filter(n=>n.type==='FRAME'&&n.name.includes('Component specimens'))){
for(const cell of frame.findAll(n=>n.type==='FRAME'&&n.name.startsWith('Variant / '))){const ins=cell.children.find(n=>n.type==='INSTANCE');if(!ins)continue;const mc=await ins.getMainComponentAsync();if(mc?.parent?.id!==sets.composer.id)continue;const st=mc.name.match(/State=([^,]+)/)?.[1];const key=Object.keys(ins.componentProperties).find(k=>k.split('#')[0]==='Draft');if(key){ins.setProperties({[key]:st==='multiline'?'첫 번째 줄\n두 번째 줄\n세 번째 줄':st==='empty'?'작업을 요청하세요. /로 명령 보기':'권한 흐름을 정리해 주세요.'});touch(ins);for(const n of ins.findAll())touch(n)}}
}
return result({fixedFamilies,fixes:['state-specific status text survives variant changes','actual multiline draft','code hugs its copy control','only selected File tab has selection fill'],sets:32});
