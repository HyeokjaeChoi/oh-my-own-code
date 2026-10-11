// Skill helpers createVariableCollection/createSemanticTokens are prepended at execution.
const existing = await figma.variables.getLocalVariablesAsync();
if(existing.length) throw new Error('Expected empty variable graph; inspect before retry.');
const maps={}, collections={};
for(const layer of ['primitive','semantic','component']) {
 const title={primitive:'Primitives',semantic:'Semantic',component:'Component'}[layer];
 const modes=layer==='primitive'?['Value']:['Light','Dark'];
 const {collection,modeIds}=await createVariableCollection(title,modes);
 collections[layer]={id:collection.id,name:title,modes:modeIds};
 for(const t of manifest.tokens.filter(t=>t.layer===layer)) {
  const values={};
  for(const mode of modes){let value=layer==='primitive'?t.value:t.value[mode.toLowerCase()];
   if(typeof value==='string' && value.startsWith('{')) value={type:'VARIABLE_ALIAS',id:maps[value.slice(1,-1)].id};
   else if(['dimension','duration'].includes(t.type))value=parseFloat(value);
   values[mode]=value;
  }
  const r=await createSemanticTokens(collection,modeIds,[{name:t.path.replaceAll('.','/'),type:t.type==='color'?'COLOR':t.type==='fontFamily'?'STRING':'FLOAT',values,scopes:t.figmaScopes,codeSyntax:{WEB:`var(${t.css})`}}]);
  maps[t.path]=Object.values(r.variables)[0];
 }
}
for(const [family,style] of [['Noto Sans KR','Regular'],['Noto Sans KR','Medium'],['Noto Sans KR','Bold'],['IBM Plex Mono','Regular']]) await figma.loadFontAsync({family,style});
const styles={};
for(const role of ['body','caption','label','heading','code']){
 const s=figma.createTextStyle();s.name=`Type/${role[0].toUpperCase()+role.slice(1)}`;
 s.fontName={family:role==='code'?'IBM Plex Mono':'Noto Sans KR',style:role==='heading'?'Bold':role==='label'?'Medium':'Regular'};
 for(const [field,part] of [['fontFamily','family'],['fontSize','size'],['fontWeight','weight'],['lineHeight','line']])s.setBoundVariable(field,maps[`semantic.type.${part}.${role}`]);
 styles[role]={id:s.id,name:s.name,boundVariables:s.boundVariables};
}
return {collections,variables:Object.fromEntries(Object.entries(maps).map(([path,v])=>[path,{id:v.id,name:v.name,type:v.resolvedType,valuesByMode:v.valuesByMode,scopes:v.scopes,codeSyntax:v.codeSyntax}])),styles,createdNodeIds:[]};
