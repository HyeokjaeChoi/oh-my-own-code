// Adapted from figma-generate-library createVariableCollection/createSemanticTokens/
// createComponentWithVariants/bindVariablesToComponent/createDocumentationPage helpers.
// Changes: exact-name read before create, external state, one page switch, all IDs,
// candidate modes, sparse meaningful family bodies, and actual source aliases.
const ids=new Set(),errors=[];
const touch=n=>{ids.add(n.id);return n};
const C=D.candidates.find(c=>c.id===CFG.candidate),R=D.resolved[CFG.candidate].light;
const colors=h=>{const s=h.slice(1);return {r:parseInt(s.slice(0,2),16)/255,g:parseInt(s.slice(2,4),16)/255,b:parseInt(s.slice(4,6),16)/255,a:s.length===8?parseInt(s.slice(6,8),16)/255:1}};
const ref=v=>typeof v==='string'&&/^\{[^}]+\}$/.test(v)?v.slice(1,-1):null;
const name=p=>p.replaceAll('.','/');
const collectionName=(layer,candidate=CFG.candidate)=>layer==='primitive'?'DRAFT Compact / Primitive':`DRAFT Compact / ${candidate} / ${layer==='semantic'?'Semantic':'Component'}`;
async function loadFonts(){const fs=await figma.listAvailableFontsAsync();for(const family of ['Noto Sans KR','IBM Plex Mono'])for(const style of family==='Noto Sans KR'?['Regular','Medium','Bold']:['Regular','Medium','SemiBold']){if(!fs.some(f=>f.fontName.family===family&&f.fontName.style===style))throw new Error('Unavailable font: '+family+' '+style);await figma.loadFontAsync({family,style})}}
async function pageAt(n){let p=figma.root.children.find(p=>p.name===n);if(!p){p=touch(figma.createPage());p.name=n}await figma.setCurrentPageAsync(p);return p}
async function context(){await loadFonts();const all=await figma.variables.getLocalVariablesAsync(),cols=await figma.variables.getLocalVariableCollectionsAsync();const vars={};for(const layer of ['primitive','semantic','component']){const co=cols.find(c=>c.name===collectionName(layer));for(const v of all.filter(v=>v.variableCollectionId===co?.id))vars[v.name.replaceAll('/','.')]=v}const ts=await figma.getLocalTextStylesAsync(),es=await figma.getLocalEffectStylesAsync();return {vars,cols,ts,es}}
let X;
function paint(p){const h=R[p]||'#000000';if(!X.vars[p]&&!R[p])throw new Error('Missing color '+p);const col=colors(h),raw={type:'SOLID',color:{r:col.r,g:col.g,b:col.b},opacity:col.a};return X.vars[p]?figma.variables.setBoundVariableForPaint(raw,'color',X.vars[p]):raw}
function fill(n,p){n.fills=[paint(p)];touch(n)}
function stroke(n,p,width=1){n.strokes=[paint(p)];n.strokeWeight=width;touch(n)}
function bound(n,field,p){const v=X.vars[p];if(!v)throw new Error('Missing bind '+p);n.setBoundVariable(field,v);touch(n)}
function modes(n,mode='Light'){for(const layer of ['semantic','component']){const co=X.cols.find(c=>c.name===collectionName(layer));n.setExplicitVariableModeForCollection(co.id,co.modes.find(m=>m.name===mode).modeId)}touch(n)}
function al(parent,n,w,h,dir='VERTICAL',pad=0,gap=0){const f=touch(figma.createAutoLayout());f.name=n;f.layoutMode=dir;f.resize(w,h);f.primaryAxisSizingMode='FIXED';f.counterAxisSizingMode='FIXED';f.paddingTop=f.paddingBottom=f.paddingLeft=f.paddingRight=pad;f.itemSpacing=gap;f.fills=[];f.clipsContent=false;parent.appendChild(f);modes(f);return f}
async function text(parent,str,role='UI',color='semantic.color.text.primary',width){const t=touch(figma.createText());parent.appendChild(t);t.name=str.slice(0,40);const style=X.ts.find(s=>s.name===`DRAFT Compact / ${CFG.candidate} / ${role}`);if(!style)throw new Error('Missing text style '+role);await t.setTextStyleIdAsync(style.id);t.characters=str;t.textAutoResize='WIDTH_AND_HEIGHT';fill(t,color);if(width){t.textAutoResize='HEIGHT';t.resize(width,t.height)}return t}
function shape(parent,n,w,h,p){const q=touch(figma.createRectangle());q.name=n;q.resize(w,h);parent.appendChild(q);fill(q,p);return q}
function result(extra={}){return {affectedNodeIds:[...ids],errors,...extra}}
function measure(n){return {id:n.id,name:n.name,type:n.type,width:n.width,height:n.height,x:n.x,y:n.y}}
function profile(spec){let out={};if(spec.extends){const [group,key]=spec.extends.split('.');out=profile(D.profiles[group][key])}return {...out,...spec}}
function stateStyle(f,props){const st=props.State||props.Data||props.Layout;let spec=f.states[st]||{};let out={};if(spec.profile){const [group,key]=spec.profile.split('.');out={...profile(D.profiles[group].default||{}),...profile(D.profiles[group][key])}}if(props.Intent==='primary')out={...profile(D.profiles.primary.default),...profile(D.profiles.primary[st]||{})};if(props.Intent==='danger')out.foreground='{component.status.dangerForeground}';return {...out,...spec}}
function combos(axes){return Object.entries(axes).reduce((r,[k,vs])=>r.flatMap(p=>vs.map(v=>({...p,[k]:v}))),[{}])}
function styleBody(n,f,s){const p=f.tokenPrefix;if(X.vars[p+'.background'])fill(n,p+'.background');else n.fills=[];if(s.background)fill(n,ref(s.background));if(s.borderColor)stroke(n,ref(s.borderColor),s.borderWidth||1);if(s.outlineColor)stroke(n,ref(s.outlineColor),R[ref(s.outlineWidth)]||2);if(X.vars[p+'.radius'])bound(n,'cornerRadius',p+'.radius');if(X.vars[p+'.padding'])for(const prop of ['paddingTop','paddingBottom','paddingLeft','paddingRight'])bound(n,prop,p+'.padding')}
