import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import ts from '/Users/hyukjaechoi/Projects/oh-my-own-code/node_modules/typescript/lib/typescript.js';
const repo='/Users/hyukjaechoi/Projects/oh-my-own-code/';
const base=repo+'apps/desktop-app/runtime-event-host/.generated/';
const receipt=JSON.parse(await readFile(base+'receipt.json','utf8'));
const hash=b=>createHash('sha256').update(b).digest('hex');
for(const r of receipt.installEntries.filter(x=>x.path.startsWith('node_modules/effect/')&&x.path.endsWith('.js'))) assert.equal(hash(await readFile(base+'install/'+r.path)),r.sha256);
const { Effect, Context, Layer, Scope, Exit, Deferred, Duration, Schedule, Option }=await import(base+'install/node_modules/effect/dist/index.js');
const sources=[];
async function ast(chunk){const p=`node_modules/@opencode/core/dist/chunks/config-${chunk}.js`;const b=await readFile(base+'install/'+p);const r=receipt.installEntries.filter(x=>x.path===p);assert.equal(r.length,1);assert.equal(hash(b),r[0].sha256);sources.push({path:p,sha256:hash(b)});return ts.createSourceFile(p,b.toString(),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);}
function variable(a,name){const matches=[];function walk(n){if(ts.isVariableDeclaration(n)&&n.name.getText(a)===name)matches.push(n.initializer.getText(a));ts.forEachChild(n,walk);}walk(a);assert.equal(matches.length,1,name);return matches[0];}
function evaluate(text,deps){return new Function(...Object.keys(deps),`"use strict";return (${text});`)(...Object.values(deps));}
const retentionAst=await ast('gd4qta3r');
const cleanup3=evaluate(variable(retentionAst,'cleanup3'),{Effect,Duration,Option});
const outputAst=await ast('g4xer9vd');const shellAst=await ast('hbtt76ya');
const results=[];
for(const [name,a,fn,dir,retention] of [['ToolOutput',outputAst,'cleanup','DIRECTORY3','RETENTION3'],['Shell',shellAst,'cleanup2','DIRECTORY2','RETENTION2']]){
 for(const blocked of [false,true]){
  class FS extends Context.Service()('synthetic/FS/'+name+blocked){};
  class GlobalService extends Context.Service()('synthetic/Global/'+name+blocked){};
  const entered=Deferred.makeUnsafe(),removed=Deferred.makeUnsafe(),never=Deferred.makeUnsafe();const calls=[];let interrupted=0;
  const read=items=>Effect.gen(function*(){calls.push('read');yield* Deferred.succeed(entered,undefined);if(blocked)yield* Deferred.await(never).pipe(Effect.onInterrupt(()=>Effect.sync(()=>interrupted++)));return items;});
  const fs={readDirectory:()=>read(['tool_abcdefabcdef','ignored']),readDirectoryEntries:p=>read(p.endsWith('/shell')?[{type:'directory',name:'project'}]:[{type:'file',name:'sh_abcdefabcdef.out'},{type:'file',name:'ignored'}]),stat:p=>Effect.sync(()=>{calls.push('stat:'+p);return {mtime:Option.some(new Date(0))};}),remove:p=>Effect.gen(function*(){calls.push('remove:'+p);yield* Deferred.succeed(removed,undefined);})};
  const deps={Effect,Layer,Duration,Schedule,FSUtil:{Service:FS},Global:{Service:GlobalService},path,cleanup3,[retention]:Duration.days(7),[dir]:evaluate(variable(a,dir),{})};
  deps[fn]=evaluate(variable(a,fn),deps);
  const layer=evaluate(variable(a,'cleanupLayer'),deps);
  const scope=await Effect.runPromise(Scope.make());
  const context=Context.make(FS,fs).pipe(Context.add(GlobalService,{data:'/synthetic-native-data'}));
  try{await Effect.runPromise(Layer.buildWithScope(layer,scope).pipe(Effect.provide(context),Effect.timeout('5 seconds')));await Effect.runPromise(Deferred.await(blocked?entered:removed).pipe(Effect.timeout('5 seconds')));}
  finally{await Effect.runPromise(Scope.close(scope,Exit.void).pipe(Effect.timeout('5 seconds')));}
  assert.equal(scope.state._tag,'Closed');
  if(blocked){assert.equal(interrupted,1);assert.equal(calls.filter(x=>x.startsWith('remove:')).length,0);}else assert.equal(calls.filter(x=>x.startsWith('remove:')).length,1);
  results.push({name,blocked,calls,interrupted,actualScopeClosed:true,noTaskOrPermissionAuthorityProvided:true,physicalFilesystemCalls:0});
 }
}
const report={scope:'original cleanup acquisition with real pinned Effect, scripted FS/Global only',sources,results,pass:results.length,actualNativeImports:false,runtimeAcceptance:false,findings:['Both original cleanup nodes schedule filesystem retention during acquisition without waiting for a Task or execution grant.','Closing actual Scope interrupts a blocked scripted read before removal; later cancellation does not undo already executed removal.'],limits:['No actual filesystem read/stat/remove through Native; FSUtil and Global are standins.','No source patch, execution grant, startup isolation or inventory completeness claim.']};
await writeFile(new URL('maintenance-acquisition-observation-r1.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({pass:report.pass,physicalFilesystemCalls:0,actualNativeImports:false}));
