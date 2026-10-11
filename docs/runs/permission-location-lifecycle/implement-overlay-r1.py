from pathlib import Path
import json,hashlib
root=Path('apps/desktop-app/runtime-event-host/.generated/install');files=[]
def patch(path,edits):
 b=(root/path).read_bytes();s=b.decode()
 for a,z in edits:
  assert s.count(a)==1,(path,a,s.count(a));s=s.replace(a,z)
 files.append({'path':path,'beforeSha256':hashlib.sha256(b).hexdigest(),'afterSha256':hashlib.sha256(s.encode()).hexdigest(),'edits':[{'find':a,'replace':z} for a,z in edits]})
prelude='import { Service as WorkbenchControl, node as workbenchControlNode, LocationBuildScope } from "../../../../../native-permission-control.mjs";\n'
cache='node_modules/@opencode/core/dist/chunks/config-zs6xvgsc.js'
a='''      return Layer.fromBuild((memoMap, scope) => Effect.suspend(() => Layer.buildWithMemoMap(layer2(ref, { replacements: bindings }), memoMap, scope)).pipe(Effect.onExit((exit) => {'''
z='''      return Layer.fromBuild((memoMap, scope) => Effect.gen(function* () {
        yield* Scope.addFinalizer(scope, () => build.handle ? tracked(control.locationScopeObserved(build.handle)) : Effect.void);
        build.handle = yield* tracked(control.locationBegin(ref));
        if (Option.getOrUndefined(MutableHashMap.get(builds, ref)) !== build) {
          yield* tracked(control.locationFinalizing(build.handle));
          return yield* Effect.fail(new Error("native_permission_location_invalidated"));
        }
        const context = yield* Layer.buildWithMemoMap(layer2(ref, { replacements: bindings }), memoMap, scope).pipe(Effect.provideService(LocationBuildScope, build.handle));
        yield* Scope.addFinalizer(scope, () => tracked(control.locationFinalizing(build.handle)));
        return context;
      }).pipe(Effect.onExit((exit) => {'''
patch(cache,[
 ('// src/location-services.ts',prelude+'// src/location-services.ts'),
 ('import { Context, Duration, Effect, Exit, Layer, LayerMap, MutableHashMap, Option } from "effect";','import { Context, Duration, Effect, Exit, Layer, LayerMap, MutableHashMap, Option, Scope } from "effect";'),
 ('    const owner = yield* Effect.scope;','    const owner = yield* Effect.scope;\n    const control = yield* WorkbenchControl;\n    const tracked = (effect) => effect.pipe(Effect.onExit((exit) => Exit.isFailure(exit) ? control.invalidate("location_lifecycle_unverified") : Effect.void));'),
 (a,z),
 ('              build.close = lifecycle.shutdown;','              yield* tracked(control.locationReady(build.handle));\n              build.close = tracked(control.locationFinalizing(build.handle)).pipe(Effect.andThen(lifecycle.shutdown));'),
 ('                return yield* lifecycle.shutdown;','                return yield* tracked(control.locationFinalizing(build.handle)).pipe(Effect.andThen(lifecycle.shutdown));'),
 ('        return Exit.isFailure(exit) ? finish.pipe','        const guardedFinish = build.handle && Exit.isFailure(exit) ? tracked(control.locationFinalizing(build.handle)).pipe(Effect.andThen(finish)) : finish;\n        return Exit.isFailure(exit) ? guardedFinish.pipe'),
 ('Effect.asVoid) : finish;','Effect.asVoid) : guardedFinish;'),
 ('''        MutableHashMap.remove(builds, key);
        return inner.invalidate(key).pipe(Effect.andThen(build?.close ?? Effect.void));''','''        const finalize = build?.handle ? tracked(control.locationFinalizing(build.handle)) : Effect.void;
        return finalize.pipe(Effect.andThen(Effect.suspend(() => {
          MutableHashMap.remove(builds, key);
          return inner.invalidate(key).pipe(Effect.andThen(build?.close ?? Effect.void));
        })));''')])
patch('node_modules/@opencode/core/dist/chunks/config-vyy061a2.js',[
 ('// src/location.ts',prelude+'// src/location.ts'),
 ('  const project = yield* Service81;','  const control = yield* WorkbenchControl;\n  const handle = yield* LocationBuildScope;\n  const project = yield* Service81;'),
 ('  return Service80.of({','  yield* control.locationBind(handle, { directory: ref.directory, workspaceID: ref.workspaceID, project: { id: resolved.id } });\n  return Service80.of({'),
 ('  deps: [node85]','  deps: [node85, workbenchControlNode]')])
patch('node_modules/@opencode/core/dist/effect/app-node-builder.js',[
 ('// src/effect/app-node-builder.ts',prelude+'// src/effect/app-node-builder.ts'),
 ('replacements: [node54.replace(buildLocationServiceMap2(bindings)), ...bindings]','replacements: [node54.replace(makeGlobalNode({ service: Service52, layer: buildLocationServiceMap2(bindings), deps: [workbenchControlNode] })), ...bindings]')])
p=Path('apps/desktop-app/src/native-permission-overlay-contract.mjs');s=p.read_text();needle='  ],\n};\nfor (const file of recipe.files)';assert needle in s
parts=[]
for f in files:
 text=json.dumps(f,indent=2)
 # Same existing recipe convention: these are generated Native import strings,
 # not runtime host imports. Keep the closed staging scanner truthful.
 original=f['edits'][0]['replace'];expr=[]
 for line in original.splitlines():
  if line.startswith('import '):
   left,right=line.split(' from ',1);path=json.loads(right[:-1]);expr.append(json.dumps(left+' from ')+' + JSON.stringify('+json.dumps(path)+') + ";\\n"')
  else:expr.append(json.dumps(line))
 text=text.replace(json.dumps(original),' + '.join(expr))
 parts.append('    '+text.replace('\n','\n    ')+',\n')
s=s.replace(needle,''.join(parts)+needle);p.write_text(s)
Path('docs/runs/permission-location-lifecycle/new-overlay-pins-r1.json').write_text(json.dumps(files,indent=2)+'\n')
