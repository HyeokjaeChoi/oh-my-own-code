import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { root, runRoot, readJSON, guardPath, canonical, sha, verifyInputs, requireRuntimeInputs } from './freeze.mjs';
import { CASES, analyzeLog } from './probe.mjs';
const fixture = readJSON(path.join(root,'cases/idle-history.json'));
const paths = readJSON(path.join(root,'cases/paths.json'));
const auth = readJSON(path.join(root,'cases/api-auth.json'));
export function verifyEvidence(e, current) {
  assert(CASES.includes(e.case)); assert.equal(e.status,'PASS'); assert.equal(e.namespace_retained,true);
  assert.equal(canonical(e.before),canonical(current)); assert.equal(canonical(e.after),canonical(current));
  guardPath(e.namespace,[path.join(root,'runtime-output')]);
  assert(e.journal.some(x => x.type === 'authenticated-ready' && Number.isInteger(x.pid) && x.engine === '1.4.2'));
  const exits = e.journal.filter(x => x.observed === 'ChildProcess.exit');
  const ready = e.journal.filter(x => x.type === 'authenticated-ready');
  assert.equal(exits.length,ready.length); assert.equal(new Set(ready.map(x => x.pid)).size,ready.length);
  for (const r of ready) assert.equal(exits.filter(x => x.pid === r.pid).length,1);
  for (const x of exits) {
    assert((x.code === 0 && x.signal === null) || (e.case === 'owned-sigkill-reopen' && x.signal === 'SIGKILL'));
    if (x.code === 0) {
      const stopped = e.journal.filter(r => r.type === 'scope-closed' && r.pid === x.pid);
      assert.equal(stopped.length,1); assert(!stopped[0].observation.observerGap && stopped[0].observation.live === 0 && stopped[0].observation.handles.every(h => h.exited));
    }
  }
  if (e.case === 'owned-sigkill-reopen') {
    assert.equal(exits.filter(x => x.signal === 'SIGKILL').length,1);
    const eligible = e.journal.find(x => x.type === 'idle-kill-eligible'); assert(eligible);
    assert(!eligible.observation.observerGap && eligible.observation.live === 0 && eligible.observation.handles.every(x => x.exited));
  }
  const result = e.result; assert(result);
  if (e.case === 'runtime') assert(result.scoped_start && result.authenticated_ready);
  else if (e.case === 'guards') {
    assert.equal(result.negative.paths.length,paths.negative.length);
    result.negative.paths.forEach((row,i) => { assert.equal(row.label,paths.negative[i]); assert(row.rejected && row.native_calls === 0 && row.spawns === 0); });
    assert.equal(result.negative.closed_api_rejected,paths.prohibited.length + 1); assert.equal(result.negative.rejected_native_calls,0); assert.equal(result.negative.rejected_spawns,0);
    assert.equal(result.auth.length,auth.rows.length);
    result.auth.forEach((r,i) => { assert.equal(r.label,auth.rows[i].label); assert.equal(r.status,auth.rows[i].status); assert.equal(r.allow_origin_match,auth.rows[i].allow_origin); });
  } else {
    assert(result.acknowledged && result.template_seq0 === 0);
    const verifySnapshot = s => {
      assert(s.exclusive_cursor_verified); assert.equal(s.mapping.id,result.ids.importedID);
      assert.equal(s.mapping.location.directory,path.join(e.namespace,'workspace'));
      assert.equal(s.info.id,s.mapping.id); assert.equal(s.info.projectID,s.mapping.projectID);
      assert.equal(canonical(s.transcript.messages),canonical(fixture.messages)); assert.equal(canonical(s.messages.data),canonical(fixture.messages));
      const recomputed = analyzeLog([...s.log.events,s.log.marker],result.ids.importedID,fixture.messages.length);
      assert.equal(canonical(recomputed),canonical(s.log));
      assert.equal(s.sentinel_sha256,sha(fixture.sentinel));
      const sentinel = guardPath(path.join(e.namespace,'workspace/keep.txt'),[e.namespace]); assert.equal(sha(fs.readFileSync(sentinel)),s.sentinel_sha256);
    };
    verifySnapshot(result.before);
    if (['normal-reopen','owned-sigkill-reopen'].includes(e.case)) {
      assert.equal(ready.length,2); assert(result.committed_prefix_equal && result.no_bootstrap_duplicate);
      verifySnapshot(result.after); assert.equal(canonical(result.after),canonical(result.before));
    } else assert.equal(ready.length,1);
  }
}
export function final() {
  requireRuntimeInputs(); const before = verifyInputs();
  for (const name of CASES) {
    const p = path.join(runRoot,'evidence',`${name}-r1`,'result.json');
    guardPath(p,[path.join(runRoot,'evidence')]); verifyEvidence(readJSON(p),before);
  }
  const after = verifyInputs(); assert.equal(canonical(before),canonical(after));
  return { phase1_only:true,required_cases:CASES,immutable:true,P7_complete:false,production_accepted:false };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  requireRuntimeInputs(); const name = process.argv[process.argv.indexOf('--case')+1];
  assert(['inputs','final'].includes(name)); console.log(JSON.stringify(name === 'inputs' ? verifyInputs() : final()));
}
