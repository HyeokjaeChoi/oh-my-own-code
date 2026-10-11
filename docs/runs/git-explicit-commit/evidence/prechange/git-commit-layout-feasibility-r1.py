from pathlib import Path
import hashlib, json, os, subprocess, tempfile
GIT='/Library/Developer/CommandLineTools/usr/bin/git';root=Path(tempfile.mkdtemp(prefix='omoc-commit-layout-'))
env={k:os.environ[k] for k in ['PATH','TMPDIR','LANG'] if k in os.environ};env.update(HOME=str(root/'home'),XDG_CONFIG_HOME=str(root/'home/config'),GIT_CONFIG_NOSYSTEM='1',GIT_CONFIG_GLOBAL='/dev/null',GIT_TERMINAL_PROMPT='0',GIT_AUTHOR_NAME='Synthetic User',GIT_AUTHOR_EMAIL='synthetic@example.invalid',GIT_COMMITTER_NAME='Synthetic User',GIT_COMMITTER_EMAIL='synthetic@example.invalid',GIT_AUTHOR_DATE='1700000000 +0000',GIT_COMMITTER_DATE='1700000000 +0000');(root/'home').mkdir()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def git(repo,*args,data=None):
 r=subprocess.run([GIT,*args],cwd=repo,env=env,input=data,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=10);assert r.returncode==0,(args,r.returncode);return r.stdout.strip().decode()
before=sha(Path(GIT));results=[]
try:
 for fmt in ['sha1','sha256']:
  main=root/(fmt+'-main');main.mkdir();git(main,'init','-q','-b','main','--object-format='+fmt)
  tree=git(main,'write-tree');first=git(main,'commit-tree',tree,data=b'initial\n');git(main,'update-ref','HEAD',first,'0'*len(first))
  linked=root/(fmt+'-linked');git(main,'worktree','add','-q','-b','linked',str(linked))
  gitdir=Path(git(linked,'rev-parse','--absolute-git-dir'));common=main/'.git';main_paths=[common/'HEAD',common/'refs/heads/main',common/'logs/HEAD',common/'logs/refs/heads/main'];original={str(p):sha(p) for p in main_paths}
  index=gitdir/'index';index_before=sha(index)
  marker=root/(fmt+'-hook-called');hook=common/'hooks/reference-transaction';hook.write_text('#!/bin/sh\nprintf called > '+str(marker)+'\n');hook.chmod(0o700)
  signer=root/(fmt+'-signer-called');sign=common/'hooks/synthetic-signer';sign.write_text('#!/bin/sh\nprintf called > '+str(signer)+'\nexit 1\n');sign.chmod(0o700)
  second=git(linked,'-c','commit.gpgSign=true','-c','gpg.program='+str(sign),'commit-tree',tree,'-p',first,'--no-gpg-sign',data=b'next\n')
  git(linked,'-c','core.hooksPath=/dev/null','update-ref','-m','commit: explicit synthetic','HEAD',second,first)
  assert not marker.exists() and not signer.exists()
  assert (common/'refs/heads/linked').read_text()==second+'\n'
  assert (gitdir/'HEAD').read_text()=='ref: refs/heads/linked\n'
  assert (gitdir/'logs/HEAD').read_text().splitlines()[-1].startswith(first+' '+second+' ')
  assert (common/'logs/refs/heads/linked').read_text().splitlines()[-1].startswith(first+' '+second+' ')
  assert sha(index)==index_before and original=={str(p):sha(p) for p in main_paths}
  # Existing reflogs are updated even with logAllRefUpdates=false.
  count=lambda p:len(p.read_bytes().splitlines())
  logpaths=[gitdir/'logs/HEAD',common/'logs/refs/heads/linked'];counts=[count(p) for p in logpaths]
  third=git(linked,'commit-tree',tree,'-p',second,data=b'third\n')
  git(linked,'-c','core.hooksPath=/dev/null','-c','core.logAllRefUpdates=false','update-ref','HEAD',third,second)
  assert [count(p) for p in logpaths]==[n+1 for n in counts]
  # No reflogs are created when disabled and physically absent.
  empty=root/(fmt+'-nolog');empty.mkdir();git(empty,'init','-q','-b','main','--object-format='+fmt)
  et=git(empty,'write-tree');ec=git(empty,'commit-tree',et,data=b'no log\n');git(empty,'-c','core.logAllRefUpdates=false','update-ref','HEAD',ec,'0'*len(ec))
  assert not (empty/'.git/logs').exists()
  results.append({'format':fmt,'status':'pass','linked_common_branch_log_and_private_HEAD_log':True,'other_worktree_HEAD_branch_logs_index_preserved':True,'reference_hook_and_signer_canaries_not_called':True,'log_disabled_existing_logs_updated':True,'log_disabled_absent_logs_not_created':True})
 report={'status':'pass','synthetic_root':str(root),'results':results,'git_before':before,'git_after':sha(Path(GIT)),'limits':['Private synthetic Git roots only; not original publisher/locking/journal/crash proof.','Suppression flags must be independently preserved by any future production command.']};assert report['git_before']==report['git_after']
except BaseException as error:
 report={'status':'fail','synthetic_root':str(root),'completed':results,'error_type':type(error).__name__,'git_before':before,'git_after':sha(Path(GIT))};(root/'report.json').write_text(json.dumps(report,indent=2)+'\n');raise
(root/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'status':report['status'],'report':str(root/'report.json'),'cases':len(results)}))
