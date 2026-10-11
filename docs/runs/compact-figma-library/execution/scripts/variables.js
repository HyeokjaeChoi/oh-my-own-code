// Idempotent collection and token batch, derived from supplied variable helpers.
await loadFonts();
const layer=CFG.layer,cn=collectionName(layer),cols=await figma.variables.getLocalVariableCollectionsAsync();
let co=cols.find(c=>c.name===cn);const created=[];
if(!co){co=figma.variables.createVariableCollection(cn);created.push(co.id);co.renameMode(co.modes[0].modeId,layer==='primitive'?'Base':'Light')}
if(layer!=='primitive'&&!co.modes.some(m=>m.name==='Dark'))co.addMode('Dark');
const all=await figma.variables.getLocalVariablesAsync();const defs=D.tokens.filter(t=>t.layer===layer);
const items=[];
for(const t of defs){let v=all.find(v=>v.name===name(t.path)&&v.variableCollectionId===co.id);if(!v){v=figma.variables.createVariable(name(t.path),co,t.figmaType);created.push(v.id);all.push(v)}
for(const mode of co.modes){let val=C.tokenOverrides[t.path]??t.value;if(val&&typeof val==='object')val=val[mode.name.toLowerCase()];const rp=ref(val);if(rp){const rt=D.tokens.find(t=>t.path===rp),rc=cols.find(c=>c.name===collectionName(rt.layer));const rv=all.find(v=>v.name===name(rp)&&v.variableCollectionId===rc?.id);if(!rv)throw new Error('Alias target absent: '+rp);val=figma.variables.createVariableAlias(rv)}else if(t.figmaType==='COLOR')val=colors(val);v.setValueForMode(mode.modeId,val)}
v.scopes=t.scopes;v.setVariableCodeSyntax('WEB',`var(${t.css})`);v.description='DRAFT proposed CSS mapping; not an installed production token. Source '+t.path;items.push({id:v.id,path:t.path,values:v.valuesByMode})}
return result({collection:{id:co.id,name:co.name,modes:co.modes,count:items.length},createdEntityIds:created,mutatedEntityIds:[co.id,...items.map(v=>v.id)],variables:items});
