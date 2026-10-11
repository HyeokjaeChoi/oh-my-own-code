const page=figma.root.children.find(p=>p.name===pageName);await figma.setCurrentPageAsync(page);
if(page.children.length)throw new Error('Expected empty documentation page');
const b=await board(page,pageName,description,960);
if(pageName==='Cover'){
 await txt(b,'oh-my-own-code','heading');await txt(b,'조용한 작업대, 분명한 실행 근거.','heading');
 await txt(b,'WORKBENCH FOUNDATION / 01','code','semantic.color.text.secondary');
 await txt(b,'개인 개발자를 위한 에이전트 워크벤치.\n작업 · 도구 · 권한 · 검증을 한 흐름으로 읽습니다.','body',undefined,800);
 await txt(b,'Light + Dark  ·  Noto Sans KR + IBM Plex Mono\n6 component families · 44 variants','body',undefined,800);
}else if(pageName==='Foundations'){
 for(const theme of ['Light','Dark']){
  const panel=stack(b,theme,896);padding(panel,'semantic.space.panel-padding');mode(panel,theme);paint(panel,'fills','semantic.color.canvas');
  await txt(panel,theme,'heading');
  for(const key of ['surface','canvas','text.primary','text.secondary','action.background','success.background','warning.background','danger.background']){
   const row=stack(panel,key,864,'HORIZONTAL');const sw=track(figma.createRectangle());row.appendChild(sw);sw.name=key;sw.resize(32,32);paint(sw,'fills','semantic.color.'+key);bound(sw,'cornerRadius','semantic.radius.control');await txt(row,key,'code');
  }
  for(const role of ['heading','body','label','caption','code'])await txt(panel,role==='code'?'const task = await client.session.create()':`${role} · 에이전트의 실행 근거를 확인하세요`,role,undefined,864);
 }
}else if(pageName==='Getting Started'){
 for(const [title,body] of [['원본과 사용','저장소 manifest → CSS와 Figma. 변경은 JSON에서 시작합니다. 이 파일은 새로운 소유 디자인 원본이며 아직 게시된 Library가 아닙니다.'],['상태를 읽는 법','선택, 승인 전달, 작업 완료, 검증 통과를 구분합니다. 상태색과 함께 정확한 텍스트를 사용합니다.'],['사용 원칙','Components 페이지에서 instance를 사용하세요. Light/Dark는 Semantic과 Component 컬렉션 모드를 함께 바꿉니다. 컴포넌트를 detach하지 않습니다.'],['검증 범위','이 파일은 Foundation입니다. 실제 앱의 키보드·스크린리더·반응형 검증과 Code Connect는 구현 후 진행합니다.']]){await txt(b,title,'heading');await txt(b,body,'body',undefined,896);}
}else {
 await txt(b,'Interaction & layout','heading');await txt(b,'8px control gap · 12px card gap · 16px panel padding · 32px section gap\n40px visual controls; implementation hit area ≥44×44px.\nCard width 280–720px. Narrow screens stack actions below scope.','body',undefined,896);
 await txt(b,'Motion','heading');await txt(b,'120ms feedback · 180ms state changes · 240ms panels\nReduced motion: remove movement and repetition; preserve state text.','body',undefined,896);
 await txt(b,'Permission safety','heading');await txt(b,'승인 전달은 작업 완료가 아닙니다.\n만료된 요청은 허용/거절 대신 최신 상태 확인을 제공합니다.\n실제 권한 경계 검증은 런타임의 책임입니다.','body',undefined,896);
}
return {page:{id:page.id,name:page.name},board:record(b),createdNodeIds:created,nodes:allNodes(b).map(record)};
