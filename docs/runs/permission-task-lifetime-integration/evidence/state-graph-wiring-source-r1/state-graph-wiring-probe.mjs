import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const product='/Users/hyukjaechoi/Projects/oh-my-own-code/';
const install=product+'apps/desktop-app/runtime-event-host/.generated/install/';
const receipt=JSON.parse(await readFile(install+'../receipt.json','utf8'));
const sha=x=>createHash('sha256').update(x).digest('hex');
async function pinned(path){const rows=receipt.installEntries.filter(x=>x.path===path);assert.equal(rows.length,1);const bytes=await readFile(install+path);assert.equal(sha(bytes),rows[0].sha256,path);return bytes.toString();}
let runtimeFiles=0;
for(const row of receipt.installEntries.filter(x=>/^node_modules\/(effect|fast-check|pure-rand)\//u.test(x.path)&&x.path.endsWith('.js'))){await pinned(row.path);runtimeFiles++;}
const {Brand,Context,Effect,Layer}=await import(pathToFileURL(install+'node_modules/effect/dist/index.js'));
const path='node_modules/@opencode/util/dist/effect/layer-node.js';
let text=await pinned(path);
const before=sha(text);
const {NATIVE_PERMISSION_OVERLAY_RECIPE:recipe}=await import(pathToFileURL(product+'apps/desktop-app/src/native-permission-overlay-contract.mjs'));
const row=recipe.files?.find(x=>x.path===path)??recipe.find?.(x=>x.path===path);
assert.ok(row);
assert.equal(before,row.beforeSha256);
for(const edit of row.edits){assert.equal(text.split(edit.find).length-1,1);text=text.replace(edit.find,edit.replace);}
assert.equal(sha(text),row.afterSha256);
text=text.replace('import { Brand, Context, Effect, Layer } from "effect";','').replace('export * as LayerNode from "./layer-node.js";','').replaceAll('export function ','function ');
const nodes=Function('Brand','Context','Effect','Layer',text+'\nreturn {tags,group,compile};')(Brand,Context,Effect,Layer);
const tags=nodes.tags({global:[],location:['global']});
class Control extends Context.Service()('probe/Control'){}
class Worktree extends Context.Service()('probe/Worktree'){}
class Build extends Context.Service()('probe/Build'){}
const counts={control:0,original:0,decorator:0,controlClosed:0,originalClosed:0};
const ownedControl={};const handle={};const originalTransform=()=>Effect.void;
const controlLayer=Layer.effect(Control,Effect.acquireRelease(Effect.sync(()=>{counts.control++;return ownedControl;}),()=>Effect.sync(()=>counts.controlClosed++)));
const controlNode=tags.make('global')({service:Control,layer:Layer.effect(Control,Effect.die('unconfigured')),deps:[]});
const original=tags.make('location')({service:Worktree,layer:Layer.effect(Worktree,Effect.acquireRelease(Effect.sync(()=>{counts.original++;return {transform:originalTransform};}),()=>Effect.sync(()=>counts.originalClosed++))),deps:[]});
// Identity map creates a supported distinct node while preserving original wiring.
// The replacement's dependency therefore cannot recursively replace itself.
const originalDependency=original.mapLayer(layer=>layer);
const adapter=tags.make('location')({service:Worktree,layer:Layer.effect(Worktree,Effect.gen(function*(){const control=yield* Control;const build=yield* Build;const service=yield* Worktree;assert.equal(control,ownedControl);assert.equal(build,handle);assert.equal(service.transform,originalTransform);counts.decorator++;return {...service,control,build};})),deps:[controlNode,originalDependency]});
const replacements=[controlNode.replace(controlLayer),original.replace(adapter)];
const layer=nodes.compile(nodes.group([controlNode,original]),{replacements,shared:tags.values.global});
await Effect.runPromise(Effect.scoped(Effect.gen(function*(){const ctx=yield* Layer.build(layer);assert.equal(Context.get(ctx,Control),ownedControl);assert.equal(Context.get(ctx,Worktree).control,ownedControl);assert.equal(Context.get(ctx,Worktree).build,handle);assert.deepEqual(counts,{control:1,original:1,decorator:1,controlClosed:0,originalClosed:0});})).pipe(Effect.provideService(Build,handle)));
assert.deepEqual(counts,{control:1,original:1,decorator:1,controlClosed:1,originalClosed:1});
const report={schema_version:1,scope:'receipt-pinned actual LayerNode implementation and real pinned Effect, scripted Control/Worktree/Build; no Native module or runtime',beforeSha256:before,afterSha256:row.afterSha256,runtimeFiles,counts,passed:true,productionChanged:false};
await writeFile(new URL('./state-graph-wiring-probe-r1.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
