X=await context();const page=await pageAt(D.pages[0]);const frames=[];
const plus=await figma.getNodeByIdAsync('83:152');
for(const root of page.children.filter(n=>n.type==='FRAME'&&n.name.includes('/ A / Foundations /'))){const mode=root.name.endsWith('Dark')?'Dark':'Light';const type=root.children.find(n=>n.name==='Typography roles');if(type){type.primaryAxisSizingMode='AUTO';touch(type)}
if(!root.children.find(n=>n.name==='Glyph and actual target samples')){
const titleIndex=root.children.findIndex(n=>n.type==='TEXT'&&n.characters.startsWith('Targets'));
const row=al(root,'Glyph and actual target samples',1216,88,'HORIZONTAL',0,24);root.insertChild(titleIndex+1,row);modes(row,mode);
for(const [g,t] of [[16,28],[18,32],[20,36],[16,44]]){const cell=al(row,'Glyph '+g+' / Target '+t,160,88,'VERTICAL',0,8);modes(cell,mode);const box=al(cell,'Actual target '+t,t,t,'HORIZONTAL',0,0);box.counterAxisAlignItems=box.primaryAxisAlignItems='CENTER';stroke(box,'semantic.color.border.interactive');bound(box,'cornerRadius','component.control.radius');modes(box,mode);const icon=touch(plus.createInstance());box.appendChild(icon);icon.resize(g,g);for(const n of icon.findAll())touch(n);await text(cell,g+'px glyph / '+t+'px target','Meta','semantic.color.text.secondary');}
const radii=al(root,'Radius hierarchy samples',1216,76,'HORIZONTAL',0,24);root.insertChild(titleIndex+3,radii);modes(radii,mode);for(const name of ['control','field','composer','card','menu','dialog']){const cell=al(radii,name,120,76,'VERTICAL',0,8);modes(cell,mode);const box=al(cell,name,56,40);stroke(box,'semantic.color.border.interactive');bound(box,'cornerRadius','semantic.radius.'+name);modes(box,mode);await text(cell,name+' '+R['semantic.radius.'+name],'Meta','semantic.color.text.secondary');}
}
root.primaryAxisSizingMode='AUTO';touch(root);frames.push({...measure(root),mode});}
return result({foundations:frames});
