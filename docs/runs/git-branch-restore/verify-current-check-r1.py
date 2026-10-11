from pathlib import Path
import hashlib,importlib.util,json,sys
root=Path(__file__).resolve().parents[3];p=Path(__file__).resolve().parent;folder=p/'evidence/declaration-format-r1'
spec=importlib.util.spec_from_file_location('br_harness',root/'.solopreneur/harness.py');h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
proof=json.loads((folder/'proof.json').read_text());name=sys.argv[1];assert name in ['kernel','unit']
old=(folder/'before.d.mts').read_bytes();new=(folder/'after.d.mts').read_bytes();assert hashlib.sha256(old).hexdigest()==proof['beforeSha256'];assert hashlib.sha256(new).hexdigest()==proof['afterSha256'];assert old.count(proof['exactOld'].encode())==1 and old.replace(proof['exactOld'].encode(),proof['exactNew'].encode())==new;assert (root/proof['allowedPath']).read_bytes()==new
current=h.inventory(root);original=proof['originalSources'];assert h.digest(original)==proof['originalSourceSha256'];assert set(current)==set(original)
changed=[path for path in current if current[path]!=original[path]];assert changed==[proof['allowedPath']],changed
attempt=proof['passedChecks'][name];assert attempt['source_sha256']==proof['originalSourceSha256'] and attempt['exit_code']==0 and not attempt['inputs_changed'] and not attempt['timed_out'] and not attempt['interrupted']
if name=='kernel':
 import re
 reports=re.findall(r'Synthetic evidence: ([^\n]+/report\.json)',attempt['stdout']);assert len(reports)==3
 total=0
 for path in reports:
  report=json.loads(Path(path).read_text());assert report['process']['exitCode']==0
  for pin in report.get('sources',report.get('ownedSources',[])):
   src=Path(pin['path']);assert hashlib.sha256(src.read_bytes()).hexdigest()==pin['sha256']
  binary=report['runtimeBinary'];expected=binary.get('sha256',binary.get('before'));assert expected and binary.get('after',expected)==expected;assert hashlib.sha256(Path(binary['path']).read_bytes()).hexdigest()==expected
  total+=len(report['evidence'])
 assert total==242,total
print(json.dumps({'result':'pass','check':name,'newRuntimeExecution':False,'currentSourceSha256':h.digest(current),'priorSourceSha256':proof['originalSourceSha256'],'onlyChange':changed,'exactDeclarationEditVerified':True,'priorArgv':attempt['argv'],'priorExit':attempt['exit_code'],'proof':'evidence/declaration-format-r1/proof.json'}))
