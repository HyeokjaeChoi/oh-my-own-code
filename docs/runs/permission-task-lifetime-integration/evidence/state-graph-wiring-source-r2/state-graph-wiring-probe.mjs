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
const {Brand,Context,Effect,Layer,Exit,Scope}=await import(pathToFileURL(install+'node_modules/effect/dist/index.js'));
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
const ownedControl={};const handle={};const otherHandle={};const allowedHandles=new Set([handle,otherHandle]);const originalTransform=()=>Effect.void;
const controlLayer=Layer.effect(Control,Effect.acquireRelease(Effect.sync(()=>{counts.control++;return ownedControl;}),()=>Effect.sync(()=>counts.controlClosed++)));
const controlNode=tags.make('global')({service:Control,layer:Layer.effect(Control,Effect.die('unconfigured')),deps:[]});
const original=tags.make('location')({service:Worktree,layer:Layer.effect(Worktree,Effect.acquireRelease(Effect.sync(()=>{counts.original++;return {transform:originalTransform};}),()=>Effect.sync(()=>counts.originalClosed++))),deps:[]});
// Identity map creates a supported distinct node while preserving original wiring.
// The replacement's dependency therefore cannot recursively replace itself.
const originalDependency=original.mapLayer(layer=>layer);
const adapter=tags.make('location')({service:Worktree,layer:Layer.effect(Worktree,Effect.gen(function*(){const control=yield* Control;const build=yield* Build;const service=yield* Worktree;assert.equal(control,ownedControl);assert.ok(allowedHandles.has(build));assert.equal(service.transform,originalTransform);counts.decorator++;return {...service,control,build};})),deps:[controlNode,originalDependency]});
const missingControl=original.mapLayer(originalLayer=>Layer.effect(Worktree,Effect.gen(function*(){const control=yield* Effect.serviceOption(Control);if(control._tag==='None')return yield* Effect.fail('missing_control_dependency');return yield* Worktree;})).pipe(Layer.provide(originalLayer)));
const missingLayer=nodes.compile(nodes.group([controlNode,original]),{replacements:[controlNode.replace(controlLayer),original.replace(missingControl)],shared:tags.values.global});
const missingExit=await Effect.runPromiseExit(Effect.scoped(Layer.build(missingLayer)));
assert.ok(Exit.isSuccess(missingExit),'earlier root output is available by ordered provideMerge');
const absentLayer=nodes.compile(original,{replacements:[controlNode.replace(controlLayer),original.replace(missingControl)],shared:tags.values.global});
const absentExit=await Effect.runPromiseExit(Effect.scoped(Layer.build(absentLayer)));
assert.ok(Exit.isFailure(absentExit),'mapLayer without Control dependency or earlier root refuses');
// Reset synthetic counters after closed negative graph; no product mutation.
for(const key of Object.keys(counts))counts[key]=0;
const replacements=[controlNode.replace(controlLayer),original.replace(adapter)];
const layer=nodes.compile(nodes.group([controlNode,original]),{replacements,shared:tags.values.global});
await Effect.runPromise(Effect.scoped(Effect.gen(function*(){const ctx=yield* Layer.build(layer);assert.equal(Context.get(ctx,Control),ownedControl);assert.equal(Context.get(ctx,Worktree).control,ownedControl);assert.equal(Context.get(ctx,Worktree).build,handle);assert.deepEqual(counts,{control:1,original:1,decorator:1,controlClosed:0,originalClosed:0});})).pipe(Effect.provideService(Build,handle)));
assert.deepEqual(counts,{control:1,original:1,decorator:1,controlClosed:1,originalClosed:1});
const singleCounts={...counts};
for(const key of Object.keys(counts))counts[key]=0;
await Effect.runPromise(Effect.scoped(Effect.gen(function*(){
 const memo=Layer.makeMemoMapUnsafe();const rootScope=yield* Scope.Scope;
 const global=yield* Layer.buildWithMemoMap(controlLayer,memo,rootScope);
 assert.equal(Context.get(global,Control),ownedControl);
 const first=yield* Scope.make();const second=yield* Scope.make();
 const graph=()=>nodes.compile(nodes.group([controlNode,original]),{replacements,shared:tags.values.global});
 const a=yield* Layer.buildWithMemoMap(graph(),memo,first).pipe(Effect.provideService(Build,handle));
 const b=yield* Layer.buildWithMemoMap(graph(),memo,second).pipe(Effect.provideService(Build,otherHandle));
 assert.equal(Context.get(a,Worktree).control,Context.get(b,Worktree).control);
 assert.notEqual(Context.get(a,Worktree),Context.get(b,Worktree));
 assert.equal(Context.get(a,Worktree).build,handle);assert.equal(Context.get(b,Worktree).build,otherHandle);
 assert.deepEqual(counts,{control:1,original:2,decorator:2,controlClosed:0,originalClosed:0});
 yield* Scope.close(first,Exit.void);
 assert.equal(counts.originalClosed,1);assert.equal(counts.controlClosed,0);
 yield* Scope.close(second,Exit.void);
 assert.equal(counts.originalClosed,2);assert.equal(counts.controlClosed,0);
})));
assert.deepEqual(counts,{control:1,original:2,decorator:2,controlClosed:1,originalClosed:2});
class Activation extends Context.Service()('probe/Activation'){}
let beforeFiber;let afterFiber;let keyLost=false;
await Effect.runPromise(Effect.withFiber(fiber=>{beforeFiber=fiber;return Effect.withFiber(inner=>{afterFiber=inner;return Effect.serviceOption(Activation).pipe(Effect.map(option=>{keyLost=option._tag==='None';}));}).pipe(Effect.provide(Context.empty()));}).pipe(Effect.provideService(Activation,{})));
assert.equal(beforeFiber,afterFiber);assert.equal(keyLost,false);
let replaceLosesKey=false;
await Effect.runPromise(Effect.serviceOption(Activation).pipe(Effect.map(option=>{replaceLosesKey=option._tag==='None';}),Effect.updateContext(()=>Context.empty()),Effect.provideService(Activation,{})));
assert.equal(replaceLosesKey,true);
const report={schema_version:1,scope:'receipt-pinned actual LayerNode implementation and real pinned Effect, scripted Control/Worktree/Build; no Native module or runtime',beforeSha256:before,afterSha256:row.afterSha256,runtimeFiles,singleCounts,twoLocationsCounts:counts,passed:true,orderedRootContextAvailable:Exit.isSuccess(missingExit),missingDependencyRefused:Exit.isFailure(absentExit),provideRetainsActivationContext:!keyLost,updateContextDropsActivationContext:replaceLosesKey,providePreservesSameFiber:beforeFiber===afterFiber,productionChanged:false};
await writeFile(new URL('./state-graph-wiring-probe-r4.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
