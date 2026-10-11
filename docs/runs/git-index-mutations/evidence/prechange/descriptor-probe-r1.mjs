// THROWAWAY owned-synthetic syscall feasibility; not a production publisher.
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {dlopen,ptr,toArrayBuffer} from 'bun:ffi';
assert.equal(Bun.version,'1.4.2');assert.equal(process.platform,'darwin');assert.equal(process.arch,'arm64');
const hash=b=>createHash('sha256').update(b).digest('hex');
const repo='/Users/hyukjaechoi/Projects/oh-my-own-code';
const resources=join(repo,'apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64');
const manifest=JSON.parse(fs.readFileSync(join(resources,'manifest.json')));
const pin=manifest.entries.find(x=>x.path==='runtime/bun');assert.ok(pin);assert.equal(hash(fs.readFileSync(process.execPath)),pin.sha256);
const git='/Library/Developer/CommandLineTools/usr/bin/git';assert.equal(hash(fs.readFileSync(git)),'738d0159292a08341abe63a7decd0715ff34d67d532e17349902a6dc42f60ae7');
const root=fs.mkdtempSync(join(tmpdir(),'omoc-git-index-descriptor-'));fs.chmodSync(root,0o700);const home=join(root,'home');fs.mkdirSync(home,{mode:0o700});
const env={PATH:'/usr/bin:/bin',HOME:home,XDG_CONFIG_HOME:home,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_SYSTEM:'/dev/null',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',GIT_NO_LAZY_FETCH:'1',LC_ALL:'C'};
function command(cwd,args,input,extra={}){const r=spawnSync(git,['-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false',...args],{cwd,env:{...env,...extra},input,timeout:8000});assert.equal(r.status,0,'Synthetic fixedGit command failed');return r.stdout;}
const lib=dlopen('/usr/lib/libSystem.B.dylib',{openat:{args:['i32','ptr','i32','u64','u64','u64','u64','u64','u64'],returns:'i32'},renameatx_np:{args:['i32','ptr','i32','ptr','u32'],returns:'i32'},__error:{args:[],returns:'ptr'}});const n=lib.symbols;const errno=()=>new Int32Array(toArrayBuffer(n.__error(),0,4))[0];
const c={...fs.constants,O_CLOEXEC:0x1000000};const cs=s=>Buffer.from(s+'\0');const nofollow=c.O_NOFOLLOW|c.O_NONBLOCK|c.O_CLOEXEC;
const stat=fd=>fs.fstatSync(fd,{bigint:true});const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino;const open=(parent,name,flags,mode=0)=>n.openat(parent,ptr(cs(name)),flags,0,0,0,0,0,mode);
const results=[];
for(const format of ['sha1','sha256']){
 const work=join(root,format);fs.mkdirSync(work,{mode:0o700});command(work,['init','-q','--object-format='+format]);
 fs.writeFileSync(join(work,'a.txt'),'SYNTHETIC original\n');fs.writeFileSync(join(work,'untouched.txt'),'SYNTHETIC sentinel\n');command(work,['add','--','a.txt','untouched.txt']);
 const gd=join(work,'.git'),ip=join(gd,'index');const original=fs.readFileSync(ip),head=fs.readFileSync(join(gd,'HEAD')),sentinel=fs.readFileSync(join(work,'untouched.txt'));
 const proposed=join(root,format+'.proposed.index');fs.writeFileSync(proposed,original,{flag:'wx',mode:0o600});const oid=command(work,['hash-object','-w','--stdin'],Buffer.from('SYNTHETIC proposed\n')).toString().trim();command(work,['update-index','--add','--cacheinfo','100644,'+oid+',a.txt'],undefined,{GIT_INDEX_FILE:proposed});const next=fs.readFileSync(proposed);
 const parent=fs.openSync(gd,c.O_RDONLY|c.O_DIRECTORY|nofollow),identity=stat(parent);const held=open(parent,'index',c.O_RDWR|nofollow);assert.ok(held>=0);assert.ok(same(stat(held),fs.lstatSync(ip,{bigint:true})));
 const lock=open(parent,'index.lock',c.O_RDWR|c.O_CREAT|c.O_EXCL|nofollow,0o600);assert.ok(lock>=0);const collision=open(parent,'index.lock',c.O_RDWR|c.O_CREAT|c.O_EXCL|nofollow,0o600);assert.equal(collision,-1);assert.equal(errno(),17);
 const backup='synthetic-'+format+'.git-index.backup';const stage=open(parent,backup,c.O_RDWR|c.O_CREAT|c.O_EXCL|nofollow,0o600);assert.ok(stage>=0);fs.writeFileSync(stage,next);fs.fsyncSync(stage);assert.equal(hash(fs.readFileSync(ip)),hash(original));assert.ok(same(identity,fs.lstatSync(gd,{bigint:true})));
 assert.equal(n.renameatx_np(parent,ptr(cs(backup)),parent,ptr(cs('index')),2),0);fs.fsyncSync(stage);fs.fsyncSync(parent);
 assert.equal(hash(fs.readFileSync(ip)),hash(next));assert.equal(hash(fs.readFileSync(join(gd,backup))),hash(original));assert.equal(hash(fs.readFileSync(join(gd,'HEAD'))),hash(head));assert.equal(hash(fs.readFileSync(join(work,'untouched.txt'))),hash(sentinel));assert.equal(fs.readFileSync(join(work,'a.txt'),'utf8'),'SYNTHETIC original\n');
 const lockIdentity=stat(lock);assert.ok(same(lockIdentity,fs.lstatSync(join(gd,'index.lock'),{bigint:true})));fs.unlinkSync(join(gd,'index.lock'));
 const renamed=gd+'-moved';fs.renameSync(gd,renamed);fs.mkdirSync(gd,{mode:0o700});assert.equal(same(identity,fs.lstatSync(gd,{bigint:true})),false,'Named root drift must be detected before further publication');
 for(const fd of [stage,lock,held,parent])fs.closeSync(fd);
 results.push({objectFormat:format,exclusiveLockCollision:true,originalIndexBeforePublishUnchanged:true,swapOriginalBackupExact:true,newIndexExact:true,worktreeAndHeadUntouched:true,namedRootDriftDetected:true});
}
lib.close();assert.equal(hash(fs.readFileSync(process.execPath)),pin.sha256);assert.equal(hash(fs.readFileSync(git)),'738d0159292a08341abe63a7decd0715ff34d67d532e17349902a6dc42f60ae7');
const report={status:'pass',root,engineSha256:pin.sha256,engineVersion:Bun.version,results,limits:['Throwaway ownedsynthetic syscall feasibility only, not production publisher or independent acceptance','No durable intent/IPC/owner fencing implemented','No object publisher, source fullmanifest or ref/linkedworktree/crash proof','Named root drift detected here; no claim to exclude all OS races','All synthetic namespaces retained; no real repository/private project used']};const reportPath=join(root,'report.json');fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({status:'pass',report:reportPath,formats:results.length}));
