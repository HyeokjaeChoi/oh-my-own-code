const created=[];
const vs=await figma.variables.getLocalVariablesAsync();
const V=Object.fromEntries(vs.map(v=>[v.name.replaceAll('/','.'),v]));
const ST=Object.fromEntries((await figma.getLocalTextStylesAsync()).map(s=>[s.name.split('/')[1].toLowerCase(),s]));
const colls=await figma.variables.getLocalVariableCollectionsAsync();
for(const [family,style] of [['Noto Sans KR','Regular'],['Noto Sans KR','Medium'],['Noto Sans KR','Bold'],['IBM Plex Mono','Regular']])await figma.loadFontAsync({family,style});
function track(n){created.push(n.id);return n;}
function paint(n,prop,path){n[prop]=[figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:0,g:0,b:0}},'color',V[path])];}
function bound(n,field,path){n.setBoundVariable(field,V[path]);}
function padding(n,path){for(const f of ['paddingTop','paddingBottom','paddingLeft','paddingRight'])bound(n,f,path);}
function mode(n,name){for(const c of colls)if(c.name!=='Primitives')n.setExplicitVariableModeForCollection(c,c.modes.find(m=>m.name===name).modeId);}
function stack(parent,name,width=480,direction='VERTICAL'){const n=track(figma.createAutoLayout());n.name=name;parent.appendChild(n);n.resize(width,100);n.layoutMode=direction;n.layoutSizingHorizontal='FIXED';n.layoutSizingVertical='HUG';n.fills=[];bound(n,'itemSpacing','semantic.space.card-gap');return n;}
async function txt(parent,value,role='body',color='semantic.color.text.primary',width){const n=track(figma.createText());n.name=value.slice(0,60);parent.appendChild(n);await n.setTextStyleIdAsync(ST[role].id);n.characters=value;paint(n,'fills',color);if(width){n.resize(width,30);n.textAutoResize='HEIGHT';}else n.textAutoResize='WIDTH_AND_HEIGHT';return n;}
async function board(parent,title,desc,width=900){const b=stack(parent,title,width);padding(b,'semantic.space.section-gap');bound(b,'itemSpacing','semantic.space.section-gap');paint(b,'fills','semantic.color.surface');bound(b,'cornerRadius','semantic.radius.card');b.x=80;b.y=80;await txt(b,title,'heading',undefined,width-64);await txt(b,desc,'body','semantic.color.text.secondary',width-64);return b;}
function allNodes(n){return [n,...('children'in n?n.children.flatMap(allNodes):[])];}
function bindingIds(value){if(!value||typeof value!=='object')return [];if(value.type==='VARIABLE_ALIAS')return [value.id];return Object.values(value).flatMap(bindingIds);}
function record(n){return {id:n.id,name:n.name,type:n.type,width:n.width,height:n.height,bindingIds:[...new Set([...bindingIds(n.boundVariables),...bindingIds(n.fills),...bindingIds(n.strokes)])],characters:n.type==='TEXT'?n.characters:undefined,textStyleId:n.type==='TEXT'?n.textStyleId:undefined};}
