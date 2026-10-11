from pathlib import Path
import json,hashlib
p=Path('apps/desktop-app/src/native-permission-overlay-contract.mjs')
s=p.read_text();root=Path('apps/desktop-app/runtime-event-host/.generated/install')
control='import { Service as WorkbenchControl, node as workbenchControlNode } from "../../../../../native-permission-control.mjs";\n'
helper='import { createCoordinatorAdmission, toolSessionID } from "../../../../../native-permission-coordinator-admission.mjs";\n'
store='import { Service50 as WorkbenchSessionStore, node52 as workbenchSessionStoreNode } from "./config-sd0msgcy.js";\n'
location='import { Service80 as WorkbenchLocation, node84 as workbenchLocationNode } from "./config-vyy061a2.js";\n'
files=[]
def file(name,edits):
 path='node_modules/@opencode/core/dist/chunks/'+name;b=(root/path).read_bytes();t=b.decode()
 for a,z in edits:
  assert t.count(a)==1,(name,a,t.count(a));t=t.replace(a,z)
 files.append({'path':path,'beforeSha256':hashlib.sha256(b).hexdigest(),'afterSha256':hashlib.sha256(t.encode()).hexdigest(),'edits':[{'find':a,'replace':z} for a,z in edits]})
file('config-3w5fmr99.js',[
 ('// src/tool/runtime.ts',control+helper+store+'// src/tool/runtime.ts'),
 ('var execute3 = (tool, input, context) => Effect.gen(function* () {\n  const decoded', 'var execute3 = (tool, input, context) => Effect.gen(function* () {\n  const sessionID = toolSessionID(context);\n  const control = yield* WorkbenchControl;\n  const store = yield* WorkbenchSessionStore;\n  yield* createCoordinatorAdmission({ control, store })(sessionID, () => Effect.void);\n  const decoded')
])
a='''  const beforeExecute = (name, input, context) => hooks.trigger("tool", "execute.before", {
    tool: name,
    sessionID: context.sessionID,
    agent: context.agent,
    messageID: context.messageID,
    id: context.id,
    input
  });'''
z='''  const beforeExecute = (name, input, context) => Effect.gen(function* () {
    const sessionID = toolSessionID(context);
    yield* enter(sessionID, () => Effect.void);
    return yield* hooks.trigger("tool", "execute.before", {
      tool: name,
      sessionID,
      agent: context.agent,
      messageID: context.messageID,
      id: context.id,
      input
    });
  });'''
file('config-yw6qsgb4.js',[
 ('// src/tool.ts',control+helper+store+location+'// src/tool.ts'),
 ('  const hooks = yield* Service61;','  const control = yield* WorkbenchControl;\n  const store = yield* WorkbenchSessionStore;\n  const location = yield* WorkbenchLocation;\n  const enter = createCoordinatorAdmission({ control, store });\n  const hooks = yield* Service61;'),
 (a,z),
 ('execute3(tool, input, context).pipe(Effect.map', 'execute3(tool, input, context).pipe(Effect.provideService(WorkbenchControl, control), Effect.provideService(WorkbenchSessionStore, store), Effect.map'),
 ('snapshot: Effect.fn("Tool.snapshot")((permissions) => Effect.sync(() => {','snapshot: Effect.fn("Tool.snapshot")((permissions) => control.transaction([location.project.id], (tx) => control.assertExecution(tx, location.project.id)).pipe(Effect.andThen(Effect.sync(() => {'),
 ('    }))\n  });','    }))))\n  });'),
 ('  deps: [node63, node62]','  deps: [node63, node62, workbenchControlNode, workbenchSessionStoreNode, workbenchLocationNode]')
])
needle='  ],\n};\nfor (const file of recipe.files)'
assert needle in s
s=s.replace(needle, ''.join('    '+json.dumps(f,ensure_ascii=False,indent=2).replace('\n','\n    ')+',\n' for f in files)+needle)
p.write_text(s)
Path('docs/runs/permission-tool-entry-guard/new-overlay-pins-r1.json').write_text(json.dumps(files,indent=2)+'\n')
