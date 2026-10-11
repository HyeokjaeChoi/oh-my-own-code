import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { root, readJSON, guardPath, canonical } from '../freeze.mjs';
import { validateAPI, validateImport, analyzeLog, negativeGuards, verifyMessagePage, waitForObservedIdle } from '../probe.mjs';
import { verifyEvidence } from '../verify.mjs';
const fixture = readJSON(path.join(root,'cases/idle-history.json'));
const ns = path.join(root,'runtime-output','static-fixture');
fs.mkdirSync(ns,{recursive:true,mode:0o700});
for (const name of readJSON(path.join(root,'cases/paths.json')).mutable) fs.mkdirSync(path.join(ns,name),{recursive:true,mode:0o700});
let count = 0;
function test(name,fn) { fn(); count++; console.log(name); }
test('Reject seven local path adversaries and closed API violations with no transport', () => {
  const result = negativeGuards(ns); assert.equal(result.paths.length,7); assert.equal(result.closed_api_rejected,11); assert.equal(result.rejected_native_calls,0);
});
test('Allow owned missing database without admitting symlinks', () => guardPath(path.join(ns,'data/server.sqlite'),[ns],{missing:true}));
const id = 'ses_static_owned';
const payload = { info:{id,projectID:'synthetic',cost:0,tokens:{input:0,output:0,reasoning:0,cache:{read:0,write:0}},time:{created:1,updated:1,idle:1},title:fixture.title,metadata:fixture.metadata,permissions:fixture.permissions,location:{directory:path.join(ns,'workspace')},outcome:'succeeded'},messages:fixture.messages,location:{directory:path.join(ns,'workspace')} };
test('Bounded text-only import accepted', () => validateImport(payload,ns,id));
test('Attachment, live job and foreign ID import rejected', () => {
  const attached = structuredClone(payload); attached.messages[0].files=[{source:{type:'uri',uri:'file:///private'}}]; assert.throws(() => validateImport(attached,ns,id));
  const live = structuredClone(payload); live.messages[0].type='shell'; live.messages[0].status='running'; assert.throws(() => validateImport(live,ns,id));
  assert.throws(() => validateImport(payload,ns,'ses_other'));
});
test('Non-deny permission and extra create payload rejected', () => {
  const good = { id,title:fixture.title,metadata:fixture.metadata,permissions:fixture.permissions,location:payload.location };
  validateAPI('session.create',good,ns,new Set([id]));
  assert.throws(() => validateAPI('session.create',{...good,permissions:[{action:'*',resource:'*',effect:'allow'}]},ns,new Set([id])));
  assert.throws(() => validateAPI('session.create',{...good,model:{id:'remote',providerID:'remote'}},ns,new Set([id])));
});
test('Official endpoint cursor is valid on an exact complete exported transcript', () => {
  verifyMessagePage({data:fixture.messages,cursor:{next:'owned-static-next',previous:'owned-static-previous'}});
  assert.throws(() => verifyMessagePage({data:fixture.messages,cursor:{next:123}}));
  assert.throws(() => verifyMessagePage({data:[],cursor:{next:'owned-static-next'}}));
});
// Fabricated data below is parser unit input only, never runtime or persisted-event evidence.
const e0={id:'evt_fixture0',created:1,type:'session.created',durable:{aggregateID:id,seq:0,version:1},data:{sessionID:id,projectID:'synthetic'}};
const e2={id:'evt_fixture2',created:2,type:'session.renamed',durable:{aggregateID:id,seq:2,version:1},data:{sessionID:id,title:'synthetic'}};
const marker={type:'log.synced',aggregateID:id,seq:2};
test('Reject marker-only history and undeclared gaps', () => { assert.throws(() => analyzeLog([marker],id)); assert.throws(() => analyzeLog([e0,e2,marker],id,0)); });
test('Accept only explicitly reserved imported-message sequence gap', () => { const log=analyzeLog([e0,e2,marker],id,1); assert.equal(log.head,2); assert.equal(log.hashes.length,2); });
test('Reject missing seq0, duplicate events, foreign IDs and wrong marker head', () => {
  assert.throws(() => analyzeLog([e2,marker],id));
  assert.throws(() => analyzeLog([e0,e0,marker],id));
  assert.throws(() => analyzeLog([e0,e2,{...marker,aggregateID:'ses_foreign'}],id,1));
  assert.throws(() => analyzeLog([e0,e2,{...marker,seq:3}],id,1));
});
test('Final verifier cannot accept incomplete runtime evidence', () => assert.throws(() => verifyEvidence({case:'runtime',status:'PASS',namespace_retained:true,before:{},after:{},namespace:ns,journal:[],result:{}},{})));
console.log(JSON.stringify({static_tests:count,server_imported:false,bun_executed:false,runtime_claims:false}));

let observed = 0;
const settled = await waitForObservedIdle(async () => ({observerGap:false,live:observed++ ? 0 : 1,handles:[{exited:observed > 1}]}),100,async () => {});
assert.equal(settled.live,0); assert.equal(observed,2);
await assert.rejects(waitForObservedIdle(async () => ({observerGap:true,live:0,handles:[]}),100));
await assert.rejects(waitForObservedIdle(async () => ({observerGap:false,live:1,handles:[{exited:false}]}),1));
console.log('Bounded descendant settlement requires exact exit evidence; gaps/timeouts hold');
