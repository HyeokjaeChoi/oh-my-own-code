const pages=[];for(const n of D.pages){let p=figma.root.children.find(p=>p.name===n);if(!p){p=touch(figma.createPage());p.name=n}pages.push({id:p.id,name:p.name})}return result({pages});
