from pathlib import Path
import importlib.util,json,copy,sys
root=Path('/Users/hyukjaechoi/Projects/oh-my-own-code');p=root/'docs/runs/full-product-coverage-audit'
spec=importlib.util.spec_from_file_location('coverage_checker',p/'check-coverage.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
original=m.read
records=[]
for case in ['section-headings-only','collapsed-clauses','unmapped-personal-metrics']:
 def edited(path):
  v=copy.deepcopy(original(path))
  if case=='section-headings-only':
   if path.name=='input.json': v['crossCuttingSections']={k:s.split('\n\n')[0] for k,s in v['crossCuttingSections'].items()}
   if path.name=='coverage-matrix.json':v['crossCutting']=[]
  if case=='collapsed-clauses':
   if path.name=='input.json':
    for g in v['groups']:g['clauses']=[g['exactCriteria']]
   if path.name=='coverage-matrix.json':
    inputs=original(p/'input.json'); by={}; rows=[]
    for r in v['clauses']:by.setdefault(r['groupId'],r)
    for g in inputs['groups']:
     r=by[g['id']];r.update(clauseIndex=0,exactClause=g['exactCriteria']);r.pop('requirementKind',None);rows.append(r)
    v['clauses']=rows
   if path.name=='remaining-backlog.json':
    for row in v['items']:row['clauseKeys']=[[g,0] for g,n in row['clauseKeys']]
  if case=='unmapped-personal-metrics' and path.name=='remaining-backlog.json':
   for row in v['items']:row['crossCuttingKeys']=[k for k in row.get('crossCuttingKeys',[]) if k!=['integratedAcceptance',3]]
  return v
 m.read=edited
 try:m.matrix(m.inputs()); result={'case':case,'rejected':False}
 except ValueError as e:result={'case':case,'rejected':True,'reason':str(e)}
 records.append(result)
 m.read=original
out=Path(sys.argv[1]);out.write_text(json.dumps({'cases':records,'sourceUnmodified':True},indent=2)+'\n');print(json.dumps(records))
if sys.argv[2]=='green':assert all(r['rejected'] for r in records)
