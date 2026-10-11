X=await context();const page=await pageAt(D.pages[1]);const sets={};for(const s of CFG.state.entities.componentSets)sets[s.family]=await figma.getNodeByIdAsync(s.id);
const iconNames={};for(const i of CFG.state.entities.icons||[])iconNames[i.name.split(' / ').at(-1)]=i.id;
// Exact icon IDs from the persisted ledger; never guess an ID.
const iconState=await figma.getNodeByIdAsync('83:231'),fileIcon=await figma.getNodeByIdAsync('83:189'),puzzleIcon=await figma.getNodeByIdAsync('83:228'),settingsIcon=await figma.getNodeByIdAsync('83:224'),alertIcon=await figma.getNodeByIdAsync('83:208');
function swap(n,component){n.swapComponent(component);touch(n);for(const d of n.findAll())touch(d);const key=n.componentPropertyReferences?.mainComponent;if(key){const owner=n.parent;let a=owner;while(a&&!['COMPONENT','COMPONENT_SET'].includes(a.type))a=a.parent;const own=a?.parent?.type==='COMPONENT_SET'?a.parent:a;if(own){own.editComponentProperty(key,{defaultValue:component.id});touch(own)}}}
for(const [family,set] of Object.entries(sets)){
for(const v of set.children){
if(family==='navigation'){
v.itemSpacing=0;touch(v);for(const r of v.children)if(r.type==='FRAME'&&['고정됨','최근'].includes(r.name))touch(r);
for(const n of v.findAll(n=>n.type==='INSTANCE'&&n.name.endsWith('Plus'))){const label=n.parent.name;if(label==='Extensions')swap(n,puzzleIcon);else if(!['새 세션','Plus'].includes(label))swap(n,fileIcon)}
}
if(family==='sessionRow')for(const n of v.findAll(n=>n.type==='INSTANCE'&&n.name.endsWith('Plus')))swap(n,fileIcon);
if(family==='extensions')for(const n of v.findAll(n=>n.type==='INSTANCE'&&n.name.endsWith('Plus')))swap(n,puzzleIcon);
if(family==='select')for(const n of v.findAll(n=>n.type==='INSTANCE'&&n.name.endsWith('Plus')))swap(n,settingsIcon);
if(['status','error','toast'].includes(family))for(const n of v.findAll(n=>n.type==='INSTANCE'&&n.name.endsWith('Plus')))swap(n,alertIcon);
if(family==='commands')for(const n of v.findAll(n=>n.type==='INSTANCE'&&n.name.endsWith('Plus')))swap(n,iconState);
if(family==='composer'){
for(const n of v.findAll(n=>n.type==='INSTANCE'&&n.name.endsWith('Plus')))if(n.parent.name==='명령')swap(n,iconState);
for(const r of v.findAll(n=>n.type==='FRAME'&&(n.name.startsWith('기본 에이전트')||n.name.startsWith('기본 모델')))){
const label=r.children.find(n=>n.type==='TEXT');if(!label)continue;label.textTruncation='DISABLED';label.maxLines=null;label.textAutoResize='WIDTH_AND_HEIGHT';r.primaryAxisSizingMode='AUTO';touch(r);touch(label);
}
}
if(family==='shell'){
const icon=v.children.find(n=>n.type==='INSTANCE'&&n.name.endsWith('PanelLeft'));if(icon){icon.visible=false;touch(icon);const k=icon.componentPropertyReferences?.visible;if(k){set.editComponentProperty(k,{defaultValue:false});touch(set)}}
}
}
}
return result({fixed:['Command glyph','FileText session icons','Puzzle extensions','fit-content full agent/model labels','navigation consecutive 32px rows','desktop A header no redundant nav trigger']});
