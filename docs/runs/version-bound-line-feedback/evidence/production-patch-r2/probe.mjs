import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
const root='/Users/hyukjaechoi/Projects/oh-my-own-code';
const output=join(root,'docs/runs/version-bound-line-feedback/evidence/production-patch-r2');
await fs.mkdir(output);
const namespace=await fs.realpath(await fs.mkdtemp(join(output,'synthetic-')));
const repo=join(namespace,'repo');await fs.mkdir(repo);
const GIT='/Library/Developer/CommandLineTools/usr/bin/git';
const env={HOME:namespace,PATH:'/Library/Developer/CommandLineTools/usr/bin:/usr/bin:/bin',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',GIT_AUTHOR_NAME:'Synthetic',GIT_AUTHOR_EMAIL:'synthetic@example.invalid',GIT_COMMITTER_NAME:'Synthetic',GIT_COMMITTER_EMAIL:'synthetic@example.invalid',LC_ALL:'C'};
const setup=(...args)=>{const r=spawnSync(GIT,args,{cwd:repo,env,encoding:'utf8'});assert.equal(r.status,0,'synthetic setup failed');};
const sha=async path=>createHash('sha256').update(await fs.readFile(path)).digest('hex');
const modules=['apps/desktop-app/src/host/workbench-git.mjs','apps/desktop-app/src/renderer/shared/line-feedback/index.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all([...modules.map(x=>join(root,x)),GIT,fileURLToPath(import.meta.url)].map(async p=>[p,await sha(p)])));
const before=await hashes();
const {createWorkbenchGitReader}=await import(pathToFileURL(join(root,modules[0])));
const {formatLineFeedback}=await import(pathToFileURL(join(root,modules[1])));
const reader=createWorkbenchGitReader();
const scope={runtimeEpoch:'feedback-proof',sender:{},trusted:false,trustRevision:0,check(){}};
const workspace={id:'feedback-proof',path:repo};
const report={schema_version:1,status:'running',retainedSyntheticRoot:namespace,sourceAndExecutableBefore:before,results:[],limits:['Standalone production reader + actual fixed Git + formatter on owned synthetic source only.','Clock fields are explicit synthetic standalone values, not durable service clock acceptance.','No Electron/provider/private project or production Main invocation; not a new independent CODE/G2 verdict.']};
try{
 setup('init','-b','main');
 const lines=['static int target(void) {',...Array.from({length:24},(_,i)=>`  int value${i} = ${i};`),'}'];
 const baseline=lines.join('\r\n')+'\r\n';
 await fs.writeFile(join(repo,'sample.c'),baseline);
 await fs.writeFile(join(repo,'한글 이름.txt'),'old\n');
 setup('add','--','sample.c','한글 이름.txt');setup('commit','-m','synthetic baseline');
 async function selected(path,side,start,end,expected){
  const observed=await reader.review(workspace,scope);assert.equal(observed.status,'available',observed.reason);
  const detail=await reader.diff(workspace,{type:'git.diff.read',workspaceId:workspace.id,observationId:observed.observationId,path,mode:'unstaged'},scope);
  assert.equal(detail.status,'available',detail.reason);
  const source={kind:'git',observation:{...detail,runtimeEpoch:scope.runtimeEpoch,revision:0}};
  if(expected===undefined){assert.throws(()=>formatLineFeedback(source,{side,start,end},'synthetic comment'),/INVALID_LINE_RANGE/);}
  else {const formatted=formatLineFeedback(source,{side,start,end},'synthetic comment');assert.equal(formatted.excerpt,expected);assert.equal(formatted.reference.sourceDigest,detail.sourceDigest);assert.equal(formatted.reference.observationId,observed.observationId);}
  return {path,patchBytes:Buffer.byteLength(detail.patch),functionContextPresent:/^@@.*target/m.test(detail.patch),expectedExcerptConfirmed:true,originalIdentityChecked:expected!==undefined};
 }
 const changed=[...lines];changed[18]='  int value17 = 170;';await fs.writeFile(join(repo,'sample.c'),changed.join('\r\n')+'\r\n');
 report.results.push({id:'real-production-CRLF-function-context',...await selected('sample.c','new',19,19,changed[18]+'\r\n')});
 await fs.writeFile(join(repo,'sample.c'),'changed without newline');
 report.results.push({id:'real-production-no-newline',...await selected('sample.c','new',1,1,'changed without newline')});
 await fs.writeFile(join(repo,'sample.c'),baseline);await fs.chmod(join(repo,'sample.c'),0o755);
 report.results.push({id:'real-production-mode-only-no-lines',...await selected('sample.c','new',1,1,undefined)});
 await fs.writeFile(join(repo,'한글 이름.txt'),'new\n');
 report.results.push({id:'real-production-quoted-UTF8-path',...await selected('한글 이름.txt','new',1,1,'new\n')});
 report.status='pass';
}catch(error){report.status='fail';report.error=String(error);process.exitCode=1;}
finally{await reader.close();report.readerCloseAwaited=true;report.sourceAndExecutableAfter=await hashes();report.sourceAndExecutableStable=JSON.stringify(before)===JSON.stringify(report.sourceAndExecutableAfter);if(!report.sourceAndExecutableStable){report.status='fail';process.exitCode=1;}await fs.writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});}
process.stdout.write(JSON.stringify({status:report.status,cases:report.results.length,report:join(output,'report.json')})+'\n');
