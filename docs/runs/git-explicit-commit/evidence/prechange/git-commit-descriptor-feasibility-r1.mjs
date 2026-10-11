import * as fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {dlopen,FFIType,ptr} from 'bun:ffi';
const root=fs.mkdtempSync(join(tmpdir(),'omoc-commit-descriptor-'));
const meta=join(root,'metadata'),refs=join(meta,'refs/heads'),logs=join(meta,'logs/refs/heads');
fs.mkdirSync(refs,{recursive:true,mode:0o700});fs.mkdirSync(logs,{recursive:true,mode:0o700});
const lib=dlopen('/usr/lib/libSystem.B.dylib',{renameatx_np:{args:[FFIType.i32,FFIType.ptr,FFIType.i32,FFIType.ptr,FFIType.u32],returns:FFIType.i32}});
const flags=fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW;
const fds=[meta,refs,logs].map(p=>fs.openSync(p,flags));
const c=s=>Buffer.from(s+'\0');const observations=[];
try{
 const [m,r,l]=fds;const head=join(meta,'HEAD');fs.writeFileSync(head,'ref: refs/heads/main\n',{flag:'wx',mode:0o600});
 for(const [role,fd,parent,exists] of [['reference',r,refs,true],['branch_log',l,logs,true],['reference_absent',r,refs,false],['branch_log_absent',l,logs,false]]){
  const stage='.omoc-git-commit-synthetic-'+role+'.backup',name=role.includes('absent')?'new':'main';const old='old-'+role+'\n',next='new-'+role+'\n';
  if(exists)fs.writeFileSync(join(parent,name),old,{flag:'wx',mode:0o600});
  fs.writeFileSync(join(meta,stage),next,{flag:'wx',mode:0o600});
  if(fs.fstatSync(m).dev!==fs.fstatSync(fd).dev)throw Error('cross_device');
  const a=c(stage),b=c(name);if(lib.symbols.renameatx_np(m,ptr(a),fd,ptr(b),exists?2:4)!==0)throw Error('rename_failed');
  fs.fsyncSync(m);fs.fsyncSync(fd);
  if(fs.readFileSync(join(parent,name),'utf8')!==next)throw Error('target_mismatch');
  if(exists){if(fs.readFileSync(join(meta,stage),'utf8')!==old)throw Error('backup_mismatch');}else if(fs.existsSync(join(meta,stage)))throw Error('invented_backup');
  if(fs.readFileSync(head,'utf8')!=='ref: refs/heads/main\n')throw Error('head_changed');
  observations.push({role,status:'pass',sameDevice:true,crossParentFd:true,backup:exists?'exact_original':'absent'});
 }
 fs.writeFileSync(join(root,'report.json'),JSON.stringify({status:'pass',observations,root,limits:['Owned synthetic descriptors only; not production commit kernel/artifact/locking/journal/crash acceptance.','fsync execution does not establish power-loss durability.']},null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({status:'pass',report:join(root,'report.json'),cases:observations.length}));
}catch(error){fs.writeFileSync(join(root,'report.json'),JSON.stringify({status:'fail',observations,root,error_type:error.name},null,2)+'\n',{flag:'wx'});throw error;}
finally{for(const fd of fds)fs.closeSync(fd);lib.close();}
