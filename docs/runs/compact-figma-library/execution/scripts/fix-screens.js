X=await context();const page=await pageAt(D.pages[2]),screens=[];
for(const root of page.children.filter(n=>n.type==='FRAME')){
const mode=root.name.endsWith('Dark')?'Dark':'Light',thread=root.findOne(n=>n.type==='FRAME'&&n.name==='Conversation document');if(!thread)continue;
const user=thread.children.find(n=>n.type==='INSTANCE'&&n.name.startsWith('userMessage'));
if(user){const index=thread.children.indexOf(user),row=al(thread,'User message end alignment',thread.width,user.height,'HORIZONTAL',0,0);thread.insertChild(index,row);const flex=al(row,'Flexible start space',4,user.height);flex.layoutSizingHorizontal='FILL';row.appendChild(user);user.layoutAlign='INHERIT';touch(user);modes(row,mode);modes(flex,mode);touch(thread)}
for(const code of thread.children.filter(n=>n.type==='INSTANCE'&&n.name.startsWith('code'))){code.primaryAxisSizingMode='AUTO';touch(code)}
screens.push({id:root.id,name:root.name,threadHeight:thread.height,instances:root.findAll(n=>n.type==='INSTANCE'&&n.parent?.name==='Conversation document').map(n=>({id:n.id,name:n.name,width:n.width,height:n.height}))});
}
return result({fixedScreens:screens});
