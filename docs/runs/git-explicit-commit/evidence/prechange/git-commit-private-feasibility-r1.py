from pathlib import Path
import hashlib, json, os, subprocess, tempfile
GIT='/Library/Developer/CommandLineTools/usr/bin/git'
root=Path(tempfile.mkdtemp(prefix='omoc-commit-feasibility-'))
env={k:os.environ[k] for k in ['PATH','TMPDIR','LANG'] if k in os.environ}
env.update(HOME=str(root/'home'),XDG_CONFIG_HOME=str(root/'home/config'),GIT_CONFIG_NOSYSTEM='1',GIT_CONFIG_GLOBAL='/dev/null',GIT_TERMINAL_PROMPT='0',GIT_AUTHOR_NAME='Synthetic User',GIT_AUTHOR_EMAIL='synthetic@example.invalid',GIT_COMMITTER_NAME='Synthetic User',GIT_COMMITTER_EMAIL='synthetic@example.invalid',GIT_AUTHOR_DATE='1700000000 +0000',GIT_COMMITTER_DATE='1700000000 +0000')
(root/'home').mkdir()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
before=sha(Path(GIT));results=[]
try:
 for fmt in ['sha1','sha256']:
  repo=root/fmt;repo.mkdir()
  def git(*args,input=None,okay=True):
   r=subprocess.run([GIT,*args],cwd=repo,env=env,input=input,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=10)
   if okay:assert r.returncode==0,(args,r.returncode)
   return r
  git('init','-q','-b','main','--object-format='+fmt)
  tree=git('write-tree').stdout.strip().decode()
  message='명시적 commit\r\n\r\n본문\n'.encode()
  commit=git('commit-tree',tree,input=message).stdout.strip().decode()
  body=git('cat-file','commit',commit).stdout
  assert body.split(b'\n\n',1)[1]==message
  assert b'Synthetic User <synthetic@example.invalid> 1700000000 +0000' in body
  git('update-ref','-m','commit: synthetic owned feasibility','HEAD',commit,'0'*len(commit))
  head=(repo/'.git/HEAD').read_bytes();ref=(repo/'.git/refs/heads/main').read_bytes()
  assert head==b'ref: refs/heads/main\n' and ref==(commit+'\n').encode()
  logs=[repo/'.git/logs/HEAD',repo/'.git/logs/refs/heads/main']
  assert all(p.is_file() and p.read_bytes().split(b' ')[0]==b'0'*len(commit) for p in logs)
  prior={str(p.relative_to(repo)):sha(p) for p in [repo/'.git/HEAD',repo/'.git/refs/heads/main',*logs]}
  bad=git('update-ref','HEAD',commit,'1'*len(commit),okay=False);assert bad.returncode!=0
  assert prior=={str(p.relative_to(repo)):sha(p) for p in [repo/'.git/HEAD',repo/'.git/refs/heads/main',*logs]}
  results.append({'format':fmt,'status':'pass','commit_oid':commit,'tree_oid':tree,'exact_utf8_crlf_message_preserved':True,'unborn_HEAD_update_created_both_reflogs':True,'wrong_old_oid_refused_and_ref_log_HEAD_unchanged':True})
 report={'status':'pass','synthetic_root':str(root),'results':results,'git_before':before,'git_after':sha(Path(GIT)),'limits':['Only Git commands on fresh owned private repositories; no original publisher, descriptor locking, journal, crash or independent acceptance proof.','Identity is explicitly synthetic and must not become a user default.']}
 assert report['git_before']==report['git_after']
except BaseException as error:
 report={'status':'fail','synthetic_root':str(root),'completed':results,'error_type':type(error).__name__,'git_before':before,'git_after':sha(Path(GIT))}
 (root/'report.json').write_text(json.dumps(report,indent=2)+'\n');raise
(root/'report.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'status':report['status'],'report':str(root/'report.json'),'cases':len(results)}))
