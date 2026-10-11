import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const repo='/Users/hyukjaechoi/Projects/oh-my-own-code';
const {openWorkspaceRegistry}=await import(pathToFileURL(join(repo,'apps/desktop-app/src/host/workspace-registry.mjs')));
const {createWorkbenchService}=await import(pathToFileURL(join(repo,'apps/desktop-app/src/workbench-service.mjs')));
const root=await fs.realpath(await fs.mkdtemp(join(tmpdir(),'omoc-duplicate-import-repro-')));
const directory=join(root,'private'), documentsPath=join(root,'Documents'), selected=join(root,'imported');
for(const p of [directory,documentsPath,selected])await fs.mkdir(p);
await fs.writeFile(join(selected,'sentinel.txt'),'synthetic-original\r\n');
const registry=await openWorkspaceRegistry({directory,documentsPath,storeId:'synthetic',runtimeEpoch:'epoch'});
let picks=0,nativeCalls=0;
const client=new Proxy({}, {get(){nativeCalls++;throw new Error('No Native call allowed');}});
const runtime={snapshot:()=>({state:'connected'}),workbenchContext:()=>({client}),workspace:root};
const service=createWorkbenchService({registry,runtimeReady:Promise.resolve(runtime),runtimeEpoch:'epoch',bootstrap:false,pickDirectory:async()=>{picks++;return selected;},deadlineMs:3000});
const request=id=>({version:2,runtimeEpoch:'epoch',operationId:id,operation:{type:'workspace.import'}});
const report={root,synthetic:true,productionServiceAndRegistry:true,nativeProviderExecution:false};
try{
 const first=await service.handle(request('first'),'sender');
 const second=await service.handle(request('second'),'sender');
 Object.assign(report,{first,second,picks,nativeCalls,registryStatus:registry.status(),workspaces:registry.readView().workspaces,originalBytesPreserved:(await fs.readFile(join(selected,'sentinel.txt'),'utf8'))==='synthetic-original\r\n'});
 await fs.writeFile(new URL('./duplicate-import-red-r1.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
 assert.equal(first.ok,true,JSON.stringify(first));
 assert.equal(second.ok,true,JSON.stringify(second));
 assert.equal(second.value.selectedWorkspaceId,first.value.selectedWorkspaceId);
 assert.equal(registry.readView().workspaces.length,1);
}finally{service.close();await service.drain();await registry.close();console.log(JSON.stringify({retainedSyntheticRoot:root,report:new URL('./duplicate-import-red-r1.json',import.meta.url).pathname}));}
