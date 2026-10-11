X=await context();const page=await pageAt(D.pages[2+D.candidates.indexOf(C)]),sets={};
for(const s of CFG.state.entities?.componentSets||[])if(s.candidate===CFG.candidate)sets[s.family]=await figma.getNodeByIdAsync(s.id);
if(Object.keys(sets).length!==32)throw new Error('Complete all 32 candidate families before screens');
function component(family,values={}){const set=sets[family];return set.children.find(v=>Object.entries(values).every(([k,val])=>v.name.split(', ').includes(k+'='+val)))||set.defaultVariant||set.children[0]}
function instance(parent,family,values={},w,h){const n=touch(component(family,values).createInstance());parent.appendChild(n);n.name=family+' / '+Object.values(values).join(' ');if(w||h)n.resize(w||n.width,h||n.height);modes(n);for(const d of n.findAll())touch(d);return n}
function setString(ins,key,value){const match=Object.keys(ins.componentProperties).find(k=>k.split('#')[0]===key);if(match){ins.setProperties({[match]:value});touch(ins);for(const n of ins.findAll())touch(n)}}
function hug(n){n.primaryAxisSizingMode='AUTO';touch(n);return n}
function fixedPlace(n,x,y){n.layoutPositioning='ABSOLUTE';n.x=x;n.y=y;touch(n)}
async function compFrame(scene,mode){
const nm=`DRAFT Compact / ${CFG.candidate} / ${scene} / ${mode}`;let root=page.children.find(n=>n.name===nm&&n.type==='FRAME');if(root)return {frame:root,created:false};
root=touch(figma.createFrame());root.name=nm;root.resize(1280,800);root.clipsContent=true;page.appendChild(root);root.x=80+(mode==='Dark'?1360:0);root.y=80+['Empty','Permission','Artifact'].indexOf(scene)*880;modes(root,mode);fill(root,'component.shell.background');
const side=R['component.navigation.width'],head=R['component.shell.headerHeight'],inspect=scene==='Artifact'?R['component.inspector.width']:0,pane=1280-side-inspect;
const nav=instance(root,'navigation',{Layout:C.id==='C'?'collapsed':'expanded',Data:'ready'},side,800);nav.x=0;nav.y=0;
const main=al(root,'Main pane',pane,800,'VERTICAL',0,0);main.x=side;main.y=0;main.clipsContent=true;
const header=instance(main,'shell',{State:'default'},pane,head);setString(header,'Session','권한 흐름 점검');setString(header,'Connection','로컬 연결 예시');
if(C.id==='B'){const bar=al(main,'Session context',pane,32,'HORIZONTAL',0,4);bar.paddingLeft=bar.paddingRight=scene==='Artifact'?24:40;bar.counterAxisAlignItems='CENTER';const a=instance(bar,'select',{State:'default'},96,28);setString(a,'Label','기본 에이전트');const model=instance(bar,'select',{State:'default'},84,28);setString(model,'Label','기본 모델');const flex=al(bar,'Flexible space',4,28);flex.layoutSizingHorizontal='FILL';await text(bar,'작성으로 이동','Meta','semantic.color.text.secondary')}
const gutter=C.id==='B'?(scene==='Artifact'?24:48):32,threadW=Math.min(R['component.message.maxWidth'],pane-gutter*2),tx=C.id==='A'?(pane-threadW)/2:gutter;
const view=al(main,'Scrollable conversation viewport',pane,1,'VERTICAL',0,0);view.layoutSizingVertical='FILL';view.clipsContent=true;
async function composerBlock(parent,state){const block=hug(al(parent,'Composer and help',threadW,94,'VERTICAL',0,0));instance(block,'composer',{State:state},threadW);const hint=await text(block,'Enter 보내기 · Shift+Enter 줄바꿈 · 실행 연결 없음','Meta','semantic.color.text.secondary',threadW);block.itemSpacing=4;hint.textAlignHorizontal='CENTER';return block}
if(scene==='Empty'){
const block=hug(al(view,'Empty entry',threadW,120,'VERTICAL',0,16));block.layoutPositioning='ABSOLUTE';block.x=tx;
const title=await text(block,C.layout.empty.title,C.id==='C'?'Title':'Empty title','semantic.color.text.primary',threadW);if(C.id==='A')title.textAlignHorizontal='CENTER';
if(C.id!=='C')await composerBlock(block,'empty');
block.y=C.id==='A'?368-head-block.height/2:C.id==='B'?144-head-32:112-head;
}else{
const thread=hug(al(view,'Conversation document',threadW,600,'VERTICAL',0,20));thread.layoutPositioning='ABSOLUTE';thread.x=tx;thread.y=32;
const user=instance(thread,'userMessage',{State:'default'},C.id==='A'?Math.min(threadW*.9,560):threadW);if(C.id==='A')user.layoutAlign='MAX';
instance(thread,'assistantMessage',{State:'default'},threadW);
instance(thread,'toolSummary',{State:'completed'},Math.min(threadW,400));
if(scene==='Permission'){
// Current-request viewport: compact completed tool + complete pending permission.
// Earlier conversation remains in the editable document above the current view.
const card=instance(thread,'permission',{State:'pending'},Math.min(threadW,640));
if(C.id==='B')await composerBlock(thread,'empty');
const available=view.height-(C.id==='B'?24:24);thread.y=Math.min(32,available-thread.height);const minCardTop=card.y; if(thread.y+minCardTop<12)thread.y=12-minCardTop;
}else{
instance(thread,'code',{State:'default'},threadW,170);instance(thread,'evidence',{State:'default'},200,32);if(C.id==='B')await composerBlock(thread,'empty');
}
}
if(C.id==='A'&&scene!=='Empty'){const dock=al(main,'Bottom dock',pane,110,'VERTICAL',0,0);dock.paddingLeft=dock.paddingRight=tx;dock.paddingBottom=16;await composerBlock(dock,'empty');}
if(C.id==='C')instance(main,'composer',{State:'empty'},pane,68);
if(scene==='Artifact'){
const panel=al(root,'File inspector',inspect,800,'VERTICAL',0,0);panel.x=1280-inspect;panel.y=0;fill(panel,'component.inspector.background');stroke(panel,'component.inspector.border');panel.strokeTopWeight=panel.strokeRightWeight=panel.strokeBottomWeight=0;
const title=al(panel,'Inspector header',inspect,40,'HORIZONTAL',12,8);title.paddingTop=title.paddingBottom=0;title.counterAxisAlignItems='CENTER';await text(title,'아티팩트','Label');instance(panel,'artifactTabs',{State:'selected'},inspect,40);const body=al(panel,'File body',inspect,400,'VERTICAL',16,16);instance(body,'filePreview',{State:'default'},inspect-32,260);
}
for(const n of root.findAll())if(['FRAME','INSTANCE'].includes(n.type))modes(n,mode);
return {frame:root,created:true};
}
const screens=[];for(const scene of ['Empty','Permission','Artifact'])for(const mode of ['Light','Dark']){const {frame,created}=await compFrame(scene,mode);screens.push({...measure(frame),scene,mode,created,instances:frame.findAll(n=>n.type==='INSTANCE').map(n=>({id:n.id,name:n.name,explicitVariableModes:n.explicitVariableModes})),textCount:frame.findAll(n=>n.type==='TEXT').length,nodeTypes:frame.findAll().reduce((out,n)=>(out[n.type]=(out[n.type]||0)+1,out),{}),imageNodes:frame.findAll(n=>'fills' in n&&Array.isArray(n.fills)&&n.fills.some(p=>p.type==='IMAGE')).map(measure)})}
return result({candidate:CFG.candidate,screens,count:screens.length});
