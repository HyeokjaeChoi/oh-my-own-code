from pathlib import Path
import os, subprocess, tempfile, hashlib, json, struct
GIT=Path('/Library/Developer/CommandLineTools/usr/bin/git')
root=Path(tempfile.mkdtemp(prefix='omoc-git-mutation-plumbing-'))
home=root/'home';home.mkdir(mode=0o700)
env={'PATH':'/usr/bin:/bin','HOME':str(home),'XDG_CONFIG_HOME':str(home),'GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_SYSTEM':'/dev/null','GIT_CONFIG_GLOBAL':'/dev/null','GIT_TERMINAL_PROMPT':'0','GIT_OPTIONAL_LOCKS':'0','GIT_NO_LAZY_FETCH':'1','LC_ALL':'C','GIT_AUTHOR_NAME':'SYNTHETIC','GIT_AUTHOR_EMAIL':'synthetic@example.invalid','GIT_COMMITTER_NAME':'SYNTHETIC','GIT_COMMITTER_EMAIL':'synthetic@example.invalid','GIT_AUTHOR_DATE':'@1000000000 +0000','GIT_COMMITTER_DATE':'@1000000000 +0000'}
initial=hashlib.sha256(GIT.read_bytes()).hexdigest()
def git(repo,*args,data=None):
 r=subprocess.run([str(GIT),'-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-c','commit.gpgSign=false','-c','maintenance.auto=false',*args],cwd=repo,env=env,input=data,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=8)
 if r.returncode: raise RuntimeError('Fixed synthetic Git command failed: '+args[0]+' exit '+str(r.returncode))
 return r.stdout
results=[]
for fmt,n in [('sha1',20),('sha256',32)]:
 repo=root/fmt;repo.mkdir(mode=0o700);git(repo,'init','-q','--object-format='+fmt)
 (repo/'a.txt').write_bytes(b'SYNTHETIC original\n');(repo/'b.txt').write_bytes(b'SYNTHETIC untouched\n')
 git(repo,'add','--','a.txt','b.txt');git(repo,'commit','-qm','SYNTHETIC baseline')
 before=git(repo,'ls-files','--stage','-z');oldhead=git(repo,'rev-parse','HEAD').strip()
 new=git(repo,'hash-object','-w','--stdin',data=b'SYNTHETIC selected\n').strip().decode()
 git(repo,'update-index','--add','--cacheinfo','100644,'+new+',a.txt')
 after=git(repo,'ls-files','--stage','-z');assert before.split(b'\0')[1]==after.split(b'\0')[1]
 data=(repo/'.git/index').read_bytes();assert data[:4]==b'DIRC';assert struct.unpack('>I',data[4:8])[0]==2
 offset=12;stats=[]
 for i in range(struct.unpack('>I',data[8:12])[0]):
  end=data.index(b'\0',offset+42+n);name=data[offset+42+n:end].decode();stat=struct.unpack('>10I',data[offset:offset+40]);stats.append({'path':name,'stat':list(stat)});offset+=((end+1-offset+7)//8)*8
 selected=next(x for x in stats if x['path']=='a.txt');assert selected['stat'][:6]==[0]*6 and selected['stat'][7:]==[0]*3
 # Cached replacement must not falsely mark a different original worktree clean.
 assert git(repo,'diff','--name-only','--','a.txt').strip()==b'a.txt'
 git(repo,'reset','-q','HEAD','--','a.txt');assert git(repo,'ls-files','--stage','-z')==before
 tree=git(repo,'write-tree').strip().decode();commit=git(repo,'commit-tree',tree,'-p',oldhead.decode(),data=b'SYNTHETIC explicit commit\n').strip()
 git(repo,'update-ref','refs/heads/synthetic-new',commit.decode(),'0'*(2*n));assert git(repo,'rev-parse','refs/heads/synthetic-new').strip()==commit
 # Failed old-value CAS leaves ref unchanged. No output includes stderr/config.
 r=subprocess.run([str(GIT),'update-ref','refs/heads/synthetic-new',oldhead.decode(),'0'*(2*n)],cwd=repo,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=8);assert r.returncode!=0;assert git(repo,'rev-parse','refs/heads/synthetic-new').strip()==commit
 results.append({'objectFormat':fmt,'cacheinfoZeroStat':True,'untouchedEntryExact':True,'differentWorktreeDetected':True,'unstageOriginalIndexRestored':True,'commitTreeExplicitIdentity':True,'refCreateAndConflictCAS':True,'indexStats':stats})
assert initial==hashlib.sha256(GIT.read_bytes()).hexdigest()
report={'status':'pass','root':str(root),'gitSha256':initial,'source':'owned synthetic repos only, private feasibility, not original publication or independent acceptance','results':results,'limits':['No anchored original index/ref/worktree publication','No production mutation service or durable admission','No helper/crash/packed-ref/linked-worktree race proof','Not an approved architecture boundary']}
(root/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'status':'pass','report':str(root/'report.json'),'formats':len(results)}))
