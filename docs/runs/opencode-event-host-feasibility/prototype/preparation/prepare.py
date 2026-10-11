import os,json,pathlib,subprocess,urllib.request,hashlib,base64,tarfile,shutil
root=pathlib.Path(__file__).resolve().parent.parent
cfg=json.loads((root/'installer-config.json').read_text())
node=pathlib.Path(cfg['node']); home=root/'preparation/home';tmp=root/'preparation/tmp';cache=root/'preparation/cache'
for p in [home,tmp,cache]: p.mkdir(mode=0o700,exist_ok=True)
env={'PATH':str(node.parent)+':/usr/bin:/bin','LANG':'C','LC_ALL':'C','HOME':str(home),'TMPDIR':str(tmp),'npm_config_cache':str(cache),'npm_config_userconfig':str(root/'user.npmrc'),'npm_config_globalconfig':str(root/'global.npmrc'),'npm_config_registry':cfg['registry'],'npm_config_ignore_scripts':'true','npm_config_audit':'false','npm_config_fund':'false','npm_config_workspaces':'false'}
os.environ.clear();os.environ.update(env)
assert subprocess.check_output([str(node),'--version'],env=env,text=True).strip()=='v24.14.1'
npm=(node.parent/'npm').resolve()
def run(args): subprocess.run([str(node),str(npm),*args,'--ignore-scripts','--audit=false','--fund=false','--workspaces=false'],cwd=root,env=env,check=True)
run(['install','--package-lock-only'])
lock=json.loads((root/'package-lock.json').read_text())
for key,item in lock['packages'].items():
 if not key: continue
 u=item.get('resolved',''); assert u.startswith('https://registry.npmjs.org/')
 assert item.get('integrity','').startswith('sha512-'),key
run(['ci'])
url='https://registry.npmjs.org/@oven%2fbun-darwin-aarch64/1.4.2'
meta=json.load(urllib.request.urlopen(url));dist=meta['dist'];assert dist['tarball'].startswith('https://registry.npmjs.org/')
archive=urllib.request.urlopen(dist['tarball']).read();actual='sha512-'+base64.b64encode(hashlib.sha512(archive).digest()).decode();assert actual==dist['integrity']
(root/'preparation/bun-package-metadata.json').write_text(json.dumps(meta,indent=2)+'\n');(root/'preparation/bun.tgz').write_bytes(archive)
out=root/'runtime/bun-package';out.mkdir(parents=True,mode=0o700,exist_ok=True)
with tarfile.open(root/'preparation/bun.tgz') as tf:
 for m in tf.getmembers():
  parts=pathlib.PurePosixPath(m.name).parts
  assert not m.name.startswith('/') and '..' not in parts and not m.issym() and not m.islnk() and (m.isfile() or m.isdir()),m.name
 tf.extractall(out,filter='data')
for p in out.rglob('*'):
 assert not p.is_symlink(); assert p.resolve().is_relative_to(out.resolve())
 if p.is_file(): assert p.stat().st_nlink==1
bun=out/'package/bin/bun';assert bun.is_file();bun.chmod(0o700)
(root/'preparation/install-receipt.json').write_text(json.dumps({'env':env,'node_version':'24.14.1','npm_version':subprocess.check_output([str(node),str(npm),'--version'],env=env,text=True).strip(),'node_sha256':hashlib.sha256(node.read_bytes()).hexdigest(),'npm_cli':str(npm),'npm_cli_sha256':hashlib.sha256(npm.read_bytes()).hexdigest(),'bun_integrity':actual,'bun_sha256':hashlib.sha256(bun.read_bytes()).hexdigest(),'scripts_executed':False,'bun_executed':False},indent=2)+'\n')
print('Contained installation complete; Bun not executed')
