from pathlib import Path
import os,json,subprocess,tempfile,hashlib,stat
base=Path(tempfile.mkdtemp(prefix='omoc-branch-restore-prep-',dir='/private/tmp')); home=base/'home';home.mkdir();hooks=base/'empty-hooks';hooks.mkdir()
git='/Library/Developer/CommandLineTools/usr/bin/git'
env={'PATH':'/Library/Developer/CommandLineTools/usr/bin:/usr/bin:/bin','HOME':str(home),'XDG_CONFIG_HOME':str(home),'GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null','GIT_CONFIG_SYSTEM':'/dev/null','GIT_TERMINAL_PROMPT':'0','GIT_AUTHOR_NAME':'Synthetic Branch Probe','GIT_AUTHOR_EMAIL':'synthetic@example.invalid','GIT_COMMITTER_NAME':'Synthetic Branch Probe','GIT_COMMITTER_EMAIL':'synthetic@example.invalid','GIT_AUTHOR_DATE':'1700000000 +0000','GIT_COMMITTER_DATE':'1700000000 +0000','LC_ALL':'C','LANG':'C'}
common=['-c','core.hooksPath='+str(hooks),'-c','commit.gpgSign=false','-c','tag.gpgSign=false','-c','credential.helper=','-c','core.fsmonitor=false','-c','core.untrackedCache=false','-c','gc.auto=0','-c','maintenance.auto=false']
def run(root,*args,ok=True):
 p=subprocess.run([git,*common,'-C',str(root),*args],env=env,capture_output=True,timeout=20)
 if ok and p.returncode:raise RuntimeError((args,p.returncode))
 return p

def inv(root):
 out={}
 for p in sorted(root.rglob('*')):
  if p.is_file():out[str(p.relative_to(root))]={'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size,'mode':stat.S_IMODE(p.stat().st_mode)}
 return out

def repo(name,format='sha1'):
 r=base/name;r.mkdir();run(r,'init','-q','-b','main','--object-format='+format)
 (r/'ordinary.txt').write_bytes(b'old\n');(r/'deleted.txt').write_bytes(b'remove\n');(r/'.gitignore').write_bytes(b'ignored.txt\n')
 run(r,'add','--all');run(r,'commit','-q','-m','synthetic base')
 run(r,'switch','-q','-c','target');(r/'ordinary.txt').write_bytes(b'new\n');(r/'deleted.txt').unlink();(r/'added.txt').write_bytes(b'added\n');run(r,'add','--all');run(r,'commit','-q','-m','synthetic target');run(r,'switch','-q','main');return r
rows=[]
for fmt in ['sha1','sha256']:
 r=repo('create-'+fmt,fmt);before=inv(r);head=run(r,'rev-parse','HEAD').stdout.strip();run(r,'branch','created');after=inv(r)
 changed=sorted(k for k in set(before)|set(after) if before.get(k)!=after.get(k));assert changed==['.git/logs/refs/heads/created','.git/refs/heads/created'];assert run(r,'rev-parse','created').stdout.strip()==head
 rows.append({'case':'create-current-head-'+fmt,'pass':True,'changed_paths':changed,'head_index_worktree_unchanged':True})
 r=repo('switch-'+fmt,fmt);(r/'untracked.txt').write_bytes(b'preserve\n');(r/'ignored.txt').write_bytes(b'ignored preserve\n');(r/'empty-directory').mkdir();before=inv(r);run(r,'switch','-q','--no-overwrite-ignore','target');after=inv(r);changed=sorted(k for k in set(before)|set(after) if before.get(k)!=after.get(k));assert (r/'ordinary.txt').read_bytes()==b'new\n' and not (r/'deleted.txt').exists() and (r/'added.txt').read_bytes()==b'added\n';assert (r/'untracked.txt').read_bytes()==b'preserve\n' and (r/'ignored.txt').read_bytes()==b'ignored preserve\n' and (r/'empty-directory').is_dir()
 rows.append({'case':'clean-switch-'+fmt,'pass':True,'changed_paths':changed,'preserved_untracked_ignored_empty_directory':True})
 r=repo('dirty-'+fmt,fmt);(r/'ordinary.txt').write_bytes(b'local dirty\n');before=inv(r);p=run(r,'switch','-q','--no-overwrite-ignore','target',ok=False);after=inv(r);assert p.returncode!=0 and before==after
 rows.append({'case':'conflicting-dirty-switch-'+fmt,'pass':True,'exit':p.returncode,'all_bytes_modes_unchanged':True})
 r=repo('untracked-'+fmt,fmt);(r/'added.txt').write_bytes(b'untracked collision\n');before=inv(r);p=run(r,'switch','-q','--no-overwrite-ignore','target',ok=False);after=inv(r);assert p.returncode!=0 and before==after
 rows.append({'case':'untracked-target-collision-'+fmt,'pass':True,'exit':p.returncode,'all_bytes_modes_unchanged':True})
 r=repo('restore-'+fmt,fmt);(r/'ordinary.txt').write_bytes(b'staged\n');run(r,'add','ordinary.txt');(r/'ordinary.txt').write_bytes(b'local unstaged\n');idx=(r/'.git/index').read_bytes();run(r,'restore','--worktree','--','ordinary.txt');assert (r/'ordinary.txt').read_bytes()==b'staged\n';index_bytes_preserved=(r/'.git/index').read_bytes()==idx
 run(r,'restore','--source=HEAD','--worktree','--','ordinary.txt');assert (r/'ordinary.txt').read_bytes()==b'old\n';rows.append({'case':'restore-index-versus-head-'+fmt,'pass':True,'index_bytes_preserved_by_native':index_bytes_preserved,'source_contents_differ':True})
 r=repo('occupied-'+fmt,fmt);linked=base/('linked-'+fmt);run(r,'worktree','add','-q',str(linked),'target');before=inv(r);p=run(r,'switch','-q','--no-overwrite-ignore','target',ok=False);after=inv(r);assert p.returncode!=0 and before==after;head=(r/'.git/worktrees'/linked.name/'HEAD').read_text();assert head=='ref: refs/heads/target\n';rows.append({'case':'other-worktree-target-occupied-'+fmt,'pass':True,'exit':p.returncode,'all_bytes_modes_unchanged':True,'occupancy_head_relative':'.git/worktrees/'+linked.name+'/HEAD'})
report={'status':'preparatory_behavior_only','cases':rows,'count':len(rows),'fixed_git':{'path':git,'sha256':hashlib.sha256(Path(git).read_bytes()).hexdigest(),'version':subprocess.run([git,'--version'],env=env,capture_output=True,check=True).stdout.decode().strip()},'retained_synthetic_root':str(base),'limits':['Known-byte app-owned synthetic Git commands only, not production private snapshot/publisher/kernel/admission/receipt/UI proof.','No original project, credential, provider, productionMain, Electron or Bun invocation.','No accepted branch/restore design/API/implementation or independent approval.','File identity/ctime changes beyond content/mode inventory are not proved absent.']}
(base/'report.json').write_text(json.dumps(report,indent=2)+'\n');Path('work/branch-restore-preparation-r1.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'count':len(rows),'report':str(base/'report.json'),'status':report['status']}))
