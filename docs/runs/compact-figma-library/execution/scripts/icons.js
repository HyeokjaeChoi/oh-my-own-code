X=await context();const page=await pageAt(D.pages[0]),icons=[];
let y=Math.max(80,...page.children.map(n=>n.y+n.height+80));
for(const [label,svg] of Object.entries(D.icons)){const n='DRAFT Compact / Icon / '+label;let comp=page.findOne(node=>node.type==='COMPONENT'&&node.name===n);
if(!comp){comp=touch(figma.createComponent());comp.name=n;comp.resize(16,16);comp.fills=[];page.appendChild(comp);comp.x=80+icons.length*40;comp.y=y;const vector=touch(figma.createNodeFromSvg(svg));comp.appendChild(vector);vector.x=vector.y=0;for(const node of [vector,...vector.findAll()]){touch(node);if('strokes' in node&&node.strokes.length)node.strokes=node.strokes.map(p=>p.type==='SOLID'?figma.variables.setBoundVariableForPaint(p,'color',X.vars['semantic.color.text.secondary']):p)}comp.description='Installed lucide-react SVG, 16px visual glyph, 1.75 source stroke. Reusable INSTANCE_SWAP component; not a variant per icon.'}
icons.push(measure(comp))}
return result({icons,count:icons.length});
