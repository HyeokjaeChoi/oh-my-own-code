from pathlib import Path
import hashlib
import json

ROOT=Path('/Users/hyukjaechoi/Projects/oh-my-own-code')
RUN=ROOT/'docs/runs/full-product-coverage-audit'
WORK=Path('/Users/hyukjaechoi/Documents/Codex/2026-10-03/oh-my-own-code-continuation/work')
load=lambda p:json.loads(p.read_text())
dump=lambda p,v:p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
inputs=load(RUN/'input.json')

def normalize(row):
    row=json.loads(json.dumps(row))
    for name in ['sourceRefs','runtimeRefs']:
        for ref in row.get(name,[]):
            path=ROOT/ref['path']
            assert path.is_file(),ref['path']
            ref['sha256']=hashlib.sha256(path.read_bytes()).hexdigest()
            if 'limits' in ref and isinstance(ref['limits'],str):ref['limits']=[ref['limits']]
    row.setdefault('limits',['Factual source/evidence coverage recommendation; not full-clause, platform or release approval.'])
    return row

clauses=[];raws={}
for label in ['workspace','execution','tools']:
    raw=load(RUN/f'{label}-research-raw-r1.json');raws[label]=raw
    for group in raw['groups']:
        for row in group['clauses']:
            row['groupId']=group['id'];row=normalize(row)
            if (row['groupId'],row['clauseIndex'])==('F-11',3):
                row['requirementKind']='non_goal'
                row['notes']=row['gaps'];row['gaps']=[]
                row['limits'].append('Source/document verification of explicit non-goal only; runtime behavior is not asserted.')
            clauses.append(row)
clauses+=load(WORK/'full-product-main-f16-f18-report-r1.json')['clauses']
clauses.sort(key=lambda x:(x['groupId'],x['clauseIndex']))
assert len(clauses)==83
cross=[]
for label,section in [('workspace','pathLifecycle'),('execution','authorityDelegation')]:
    candidates=raws[label]['crossCutting']
    if label=='workspace':
        candidates=[dict(c,section='pathLifecycle',paragraphIndex=c['clauseIndex']) for item in candidates if item['id']=='section4' for c in item['clauses']]
    for n,para in enumerate(inputs['crossCuttingSections'][section].split('\n\n')[1:]):
        row=next(x for x in candidates if x.get('section')==section and x.get('paragraphIndex')==n)
        row['exactParagraph']=para
        cross.append(normalize(row))
cross+=load(WORK/'full-product-main-section7-r1.json')+load(WORK/'full-product-main-section8-r1.json')
scenarios=load(WORK/'full-product-scenarios-draft-r1.json')
for row in scenarios:
    related=[c for c in clauses if c['groupId'] in row['features']]
    refs={x['path']:x for c in related for x in c['sourceRefs']}
    runtimes={x['path']:x for c in related for x in c['runtimeRefs']}
    row['sourceRefs']=list(refs.values());row['runtimeRefs']=list(runtimes.values())
    row['gaps']=[f'{c["groupId"]}:{c["clauseIndex"]} '+gap for c in related for gap in c['gaps']]+['No complete current continuous scenario execution on both supported platforms.']
platforms=load(WORK/'full-product-platform-report-r1.json')
report={'schemaVersion':2,'source_sha256':inputs['sourceAuthority']['source_sha256'],'prd_sha256':inputs['prd']['sha256'],'meaning':'Audit coverage only. No whole-product acceptance or scope reduction. Exact source presence and historical scoped execution remain separate.','clauses':clauses,'crossCutting':cross,'integratedScenarios':scenarios,'platforms':platforms,'coordinatorInterpretations':[{'clause':'F-11:3','change':'Source-only verification of explicit IDE non-goal; no runtime claim or missing implementation task. Raw researcher wording retained in tools-research-raw-r1.json.'}]}
dump(RUN/'coverage-matrix.json',report)

items=[]
def item(id,groups,outcome,nextAction,dependsOn=(),extra=()):
    keys=[[c['groupId'],c['clauseIndex']] for c in clauses if c['groupId'] in groups and c['gaps']]+list(extra)
    evidence=sorted({ref['path'] for c in clauses if c['groupId'] in groups for ref in c['sourceRefs']})
    items.append({'id':id,'featureGroups':groups,'outcome':outcome,'nextAction':nextAction,'dependsOn':list(dependsOn),'clauseKeys':keys,'evidence':evidence or ['docs/runs/full-product-coverage-audit/coverage-matrix.json'],'scopeRule':'Complete missing requirements; a bounded increment does not complete the whole group. Major new API/runtime/security ownership gets one applicable initial design review; ordinary accepted-scope fixes use routine flow.'})
item('B01',['F-01'],'Re-importing an already registered canonical path opens/reuses the existing workspace without new reservation or identity_conflict.','Reproduce actual durable duplicate-import behavior using production registry/service and contained synthetic path. Fix only if reproduced; check original operation identity, folder preservation and no duplicate Native activation.',extra=[['F-01',1]])
items[-1]['clauseKeys']=[['F-01',1]]
item('B02',[],'Windows runtime ownership, filesystem publication and checked Git platform support track starts explicitly; no macOS-only implementation is presented as Windows support.','Design and implement exact Windows EventHost/lifetime/descriptor/Git adapters with equivalent authority, then obtain actual native Windows execution. Platform prerequisite blocks only dependent Windows verification, not unrelated macOS implementation.')
item('B03',['F-01','F-02','F-03'],'Complete chosen root/direct path/naming/import/worktree creation and distinct unregister/history/physical deletion workflows.','Resolve current Documents-only reservation behavior against original PRD; define lifecycle API once, UUIDv7/local-date naming, safe source/ref/setup and nonforced deletion proofs; implement one complete creation flow before deletion.',dependsOn=['B01'])
item('B04',['F-04'],'Complete session organization, unread/recent reopen and two independently running paths with durable lineage.','Use current lifecycle/recovery and fill missing metadata/UI; execute two-session isolation and actual reopen scenarios.',dependsOn=['B03'])
item('B05',['F-05','F-06'],'Complete rich conversation/context/attachments/retry/edit-fork/queue and truthful requested/default/observed model/effort/input capabilities.','Implement a useful Markdown/code/copy increment under accepted presentation architecture, then add reviewed context and runtime contracts; preserve no replay and explicit input support. Actual provider prerequisites stay separate.')
item('B06',['F-09'],'Complete effective permission presets/rules/remember/revoke and policy transitions at actual execution boundaries.','First prove same synthetic file tool once/reject/policy-deny effects. Define new preset/transition/expiry contract once before enabling mode changes; preserve upper deny and actual-exit holds.')
item('B07',['F-07'],'Fresh scoped delegation, child tree/result collection/concurrency/queue/individual-all cancellation and inherited effective authority.','Do not relax subagent deny speculatively. Review bounded delegation execution contract once, then implement two fresh independent child tasks plus one failure and real state recovery.',dependsOn=['B06'])
item('B08',['F-08'],'Complete tool-name/version/schema renderer registry, questions/selections/approval and schema-based direct calls with shared authority.','Add closed caller/tool/request/policy correlation and safe rich renderers; implement schema form→actual permitted tool call with cancel/record and unknown fallback.',dependsOn=['B06','B07'])
item('B09',['F-12'],'Actual workspace terminals and project build/lint/test/dev actions with tabs, ownership, output, exit and orphan proof.','Introduce reviewed PTY/process ownership contract once, then actual synthetic terminal start/input/resize/stop/close and dev action with unchanged paths.',dependsOn=['B06'])
item('B10',['F-10'],'Isolated browser/artifact tabs with real local preview, navigation, media/PDF and devserver connection.','Define untrusted content boundary once; implement local devserver preview and inert artifact rendering, then verify bridge/navigation/popup isolation and external-open fallback.',dependsOn=['B09'])
item('B11',['F-11'],'Complete file search and current file/diff/feedback/Git integration with actual execution-channel and platform evidence.','Add bounded source search with exact target and cancellation; verify current mounted file editing/diff/line-feedback plus Git stage/commit/branch/restore through the real execution channel. Preserve supported-repository limitations and obtain Windows proof after B02.',dependsOn=['B02'])
item('B12',['F-13'],'Searchable runtime/app command palette with source/arguments/targets/errors and supported operations.','Connect actual runtime command metadata and literal execution, then register real app operations in one palette; no fake unsupported actions.',dependsOn=['B05','B08','B09','B10'])
item('B13',['F-14'],'Close Hooks/extension editing and activation gaps with truthful current Native state and existing external auth guidance.','Check pinned Native capabilities without project autoload; implement missing supported contract or explicit app-owned safe adapter after one changed-boundary review; rerun only affected current integration evidence.',dependsOn=['B06','B08'])
item('B14',['F-15'],'In-product plans/checklists/version approval and independent review findings with actual verification linkage.','Build actual plan domain/UI and version→execution binding; distinguish implementer/reviewer identity, unresolved findings and rerun evidence.',dependsOn=['B07','B09'])
item('B15',['F-16'],'Reliable timeline/filter/result navigation plus provided usage/context/model, setting comparison and learning assessment.','Extend one authoritative projection, persist/gap-bind real events, show missing metrics honestly, and implement synthetic+delegated learning question/answer/evidence flow.',dependsOn=['B05','B07','B08','B14'])
item('B16',['F-17'],'Complete reconnect/event-gap and local history export/import/retention/app-data deletion with scoped privacy.','Define data transfer/redaction/confirmation/retention boundaries once; preserve raw Native identity and no replay; implement local contained roundtrip and deletion-scope proofs.',dependsOn=['B04','B15'])
item('B17',['F-18'],'Complete shortcut/help/theme/font/density/accessibility/notifications and user registered local recurring jobs.','Implement inert user settings and notification queue first, then reviewed scheduler with exact target/permission, pause/resume/history and explicit missed runs without backfill.',dependsOn=['B06','B09','B12','B15','B16'])
item('B18',[],'All18 clauses and seven integrated scenarios independently accepted on macOS and Windows with current coherent source.','After component implementation, run actual continuous UI/effect/recovery scenarios and fresh product/code/render/release review; do not turn old narrow passes into whole-product approval.',dependsOn=[x['id'] for x in items])
dump(RUN/'remaining-backlog.json',{'schemaVersion':2,'source_sha256':report['source_sha256'],'prd_sha256':report['prd_sha256'],'items':items,'executionPolicy':'Dependency order and parallel platform track; no requirement deferred or removed. B01 is a defect candidate until an actual reproducer confirms it. Source reading is not runtime proof.'})
print(json.dumps({'clauses':len(clauses),'crossCutting':len(cross),'backlog':len(items)},ensure_ascii=False))
