import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { root, NODE, canonical, sha, readJSON, guardPath, verifyInputs, requireRuntimeInputs } from './freeze.mjs';
const rules = readJSON(path.join(root, 'cases/paths.json'));
const fixture = readJSON(path.join(root, 'cases/idle-history.json'));
const authCase = readJSON(path.join(root, 'cases/api-auth.json'));
export const CASES = ['runtime', 'guards', 'events', 'normal-reopen', 'owned-sigkill-reopen'];
const ownedRoot = path.join(root, 'runtime-output');
function keys(value, allowed) { assert(value && typeof value === 'object' && !Array.isArray(value)); for (const k of Object.keys(value)) assert(allowed.includes(k), 'Closed payload key denied'); }
function metadata(m) { assert.equal(canonical(m), canonical(fixture.metadata), 'Closed metadata required'); }
function permissions(p) { assert.equal(canonical(p), canonical(fixture.permissions), 'Deny rules required'); }
export function validateImport(input, namespace, sessionID) {
  keys(input, ['info', 'messages', 'location']); keys(input.info, ['id','projectID','cost','tokens','time','title','metadata','permissions','location','outcome']);
  assert.equal(input.info.id, sessionID); assert(/^ses_[a-zA-Z0-9_]+$/.test(sessionID));
  assert.equal(input.location.directory, path.join(namespace, 'workspace'));
  assert.equal(canonical(input.info.location), canonical(input.location));
  guardPath(input.location.directory, [namespace]); metadata(input.info.metadata); permissions(input.info.permissions);
  assert(typeof input.info.projectID === 'string' && input.info.projectID.length > 0 && input.info.projectID.length <= 128 && !input.info.projectID.includes('..') && !input.info.projectID.includes('://'));
  assert.equal(input.info.cost, 0); assert.equal(canonical(input.info.tokens), canonical({ input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }));
  keys(input.info.time, ['created','updated','idle']);
  for (const t of Object.values(input.info.time)) assert(Number.isSafeInteger(t) && t > 0);
  assert(input.info.time.idle); assert.equal(input.info.title, fixture.title);
  assert.equal(input.info.outcome, 'succeeded');
  assert.equal(canonical(input.messages), canonical(fixture.messages));
  assert(input.messages.length > 0 && input.messages.length <= fixture.max_messages);
  for (const m of input.messages) { keys(m, ['id','type','time','text','metadata']); assert.equal(m.type, 'synthetic'); assert(Buffer.byteLength(m.text) <= fixture.max_text_bytes); }
}
export function validateAPI(method, input, namespace, ids) {
  assert(rules.methods.includes(method), 'API outside closed list');
  for (const name of rules.mutable) guardPath(path.join(namespace, name), [namespace]);
  guardPath(path.join(namespace, 'data/server.sqlite'), [namespace], { missing: true });
  if (method === 'server.info') { assert.equal(input, undefined); return; }
  if (method === 'session.create') {
    keys(input, ['id','title','metadata','permissions','location']); assert(ids.has(input.id));
    assert.equal(input.title, fixture.title); metadata(input.metadata); permissions(input.permissions);
    assert.equal(canonical(input.location), canonical({ directory: path.join(namespace, 'workspace') })); return;
  }
  if (method === 'session.import') { validateImport(input, namespace, input.info.id); assert(ids.has(input.info.id)); return; }
  const allowed = { 'session.get':['sessionID'], 'session.export':['sessionID','sanitize'], 'session.update':['sessionID','title','metadata','permissions'], 'session.log':['sessionID','after','follow'], 'message.list':['sessionID','limit','order'] };
  keys(input, allowed[method]); assert(ids.has(input.sessionID), 'Session not owned');
  if (method === 'session.update') { assert.equal(input.title, fixture.renamed_title); metadata(input.metadata); permissions(input.permissions); }
  if (method === 'session.export') assert.equal(input.sanitize, false);
  if (method === 'session.log') { assert.equal(input.follow, false); if ('after' in input) assert(Number.isSafeInteger(input.after) && input.after >= 0); }
  if (method === 'message.list') { assert.equal(input.limit, fixture.max_messages + 1); assert.equal(input.order, 'asc'); }
}
export function verifyMessagePage(page) {
  keys(page, ['data','cursor']); keys(page.cursor, ['previous','next']);
  assert.equal(canonical(page.data), canonical(fixture.messages));
  // Official handler returns an opaque endpoint cursor even for a non-full page.
  // Completeness comes from the exact full export comparison, not cursor absence.
  for (const cursor of Object.values(page.cursor)) assert(typeof cursor === 'string' && cursor.length > 0 && cursor.length <= 4096);
}
export function analyzeLog(items, sessionID, expectedGaps = 0) {
  assert(items.length <= rules.max_events); const events = items.filter(x => x.type !== 'log.synced'), markers = items.filter(x => x.type === 'log.synced');
  assert(events.length > 0, 'Marker-only history is not persisted event evidence'); assert.equal(markers.length, 1);
  const seen = new Set(); let previous = -1, gaps = 0;
  for (const e of events) {
    assert(typeof e.id === 'string' && !seen.has(e.id)); seen.add(e.id);
    assert.equal(e.durable?.aggregateID, sessionID); assert.equal(e.durable?.version, 1);
    assert(Number.isSafeInteger(e.durable.seq) && e.durable.seq > previous); gaps += e.durable.seq - previous - 1; previous = e.durable.seq;
    assert.equal(e.data?.sessionID, sessionID); assert(Object.keys(e.data).length > 1 && e.type.startsWith('session.'));
  }
  assert.equal(events[0].durable.seq, 0, 'Full history must include actual seq0');
  assert.equal(events[0].type, 'session.created'); assert.equal(gaps, expectedGaps, 'Undocumented sequence gap');
  assert.equal(markers[0].aggregateID, sessionID); assert.equal(markers[0].seq, previous);
  return { events, marker: markers[0], hashes: events.map(e => sha(canonical(e))), head: previous, gaps };
}
function mkdir(file) { guardPath(file, [ownedRoot], { missing: true }); fs.mkdirSync(file, { recursive: true, mode: 0o700 }); guardPath(file, [ownedRoot]); }
function namespace() {
  mkdir(ownedRoot); const ns = path.join(ownedRoot, randomUUID()); mkdir(ns);
  for (const name of rules.mutable) mkdir(path.join(ns, name));
  fs.writeFileSync(path.join(ns, 'workspace/keep.txt'), fixture.sentinel, { mode: 0o600, flag: 'wx' });
  return ns;
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function waitForObservedIdle(observe, timeoutMs, pause = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const observation = await observe(Math.max(1, deadline - Date.now()));
    assert(!observation.observerGap, 'Descendant observation gap; HOLD');
    if (observation.live === 0 && observation.handles.every(h => h.exited)) return observation;
    assert(Date.now() < deadline, 'Descendant exit unconfirmed; HOLD');
    await pause(Math.min(50, Math.max(1, deadline - Date.now())));
  }
}
async function bounded(promise, ms, label) {
  let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), ms); })]); } finally { clearTimeout(timer); }
}
class Engine {
  constructor(ns, journal) { this.ns = ns; this.journal = journal; this.password = randomBytes(32).toString('hex'); this.observation = null; this.uncertain = false; this.pending = 0; this.scopedClosed = false; this.disconnected = false; }
  async start() {
    requireRuntimeInputs(); const runtime = readJSON(path.join(root, 'runtime-manifest.json'));
    guardPath(runtime.engine.path,[path.join(root,'runtime')]); guardPath(path.join(root,'host.mjs'),[root]);
    for (const n of rules.mutable) guardPath(path.join(this.ns, n), [this.ns]);
    guardPath(path.join(this.ns, 'data/server.sqlite'), [this.ns], { missing: true });
    const childEnv = { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', HOME: path.join(this.ns,'home'), XDG_CONFIG_HOME:path.join(this.ns,'config'), XDG_DATA_HOME:path.join(this.ns,'data'), XDG_STATE_HOME:path.join(this.ns,'state'), XDG_CACHE_HOME:path.join(this.ns,'cache'), TMPDIR:path.join(this.ns,'tmp'), OPENCODE_CONFIG_DIR:path.join(this.ns,'config') };
    this.child = spawn(runtime.engine.path, [path.join(root, 'host.mjs')], { cwd:path.join(this.ns,'workspace'), env:childEnv, stdio:['ignore','ignore','ignore','ipc'], serialization:'json' });
    // Attach exit proof immediately; port, EOF and PID absence are never used as substitutes.
    this.exit = new Promise(resolve => { this.child.once('exit',(code, signal) => { this.exitRecord = { pid:this.child.pid, code, signal, observed:'ChildProcess.exit' }; this.journal.push(this.exitRecord); resolve(this.exitRecord); }); });
    this.child.once('error', () => { this.uncertain = true; });
    this.child.on('disconnect', () => { this.disconnected = true; });
    this.child.on('message', msg => {
      if (msg?.observation) this.observation = msg.observation;
      if (msg?.type === 'scope-closed') { this.scopedClosed = true; this.journal.push(msg); }
      if (msg?.type === 'hold') this.uncertain = true;
    });
    const ready = this.message('ready', rules.startup_timeout_ms);
    this.child.send({ type:'init', namespace:this.ns, password:this.password });
    const r = await ready; assert.equal(r.pid,this.child.pid); assert.equal(r.engine,'1.4.2');
    this.baseUrl = `http://127.0.0.1:${r.port}`;
    const { OpenCode } = await import('@opencode/client');
    this.ids = new Set();
    this.client = OpenCode.make({ baseUrl:this.baseUrl, headers:{ Authorization:this.auth() }, fetch: (url, init) => this.fetchGuard(url, init) });
    await this.call('server.info'); this.ready = true;
    this.journal.push({ type:'authenticated-ready', pid:this.child.pid, engine:r.engine });
  }
  auth() { return 'Basic '+Buffer.from('opencode:'+this.password).toString('base64'); }
  message(type, ms) {
    return new Promise((resolve,reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error('IPC timeout')); },ms);
      const message = m => { if (m?.type === type) { cleanup(); resolve(m); } else if (m?.type === 'hold' || m?.type === 'startup-failed') { cleanup(); reject(new Error('Engine hold')); } };
      const exit = () => { cleanup(); reject(new Error('Exit before IPC response')); };
      const disconnect = () => { cleanup(); reject(new Error('IPC disconnected')); };
      const cleanup = () => { clearTimeout(timer); this.child.off('message',message); this.child.off('exit',exit); this.child.off('disconnect',disconnect); };
      this.child.on('message',message); this.child.once('exit',exit); this.child.once('disconnect',disconnect);
    });
  }
  checkPaths() { for (const n of rules.mutable) guardPath(path.join(this.ns,n),[this.ns]); guardPath(path.join(this.ns,'data/server.sqlite'),[this.ns],{ missing:true }); }
  async fetchGuard(url, init = {}) {
    this.checkPaths(); const u = new URL(url); assert.equal(u.origin,this.baseUrl); assert(!u.username && !u.password);
    const method = init.method ?? 'GET'; const p = u.pathname;
    const ids = [...this.ids];
    const allowed = (method === 'GET' && p === '/api/info') || (method === 'POST' && ['/api/session','/api/experimental/session/import'].includes(p)) || ids.some(id =>
      (['GET','PATCH'].includes(method) && p === `/api/session/${id}`) || (method === 'GET' && [`/api/experimental/session/${id}/export`,`/api/experimental/session/${id}/log`,`/api/session/${id}/message`].includes(p)));
    assert(allowed,'HTTP route outside closed API');
    // All requests come through validated methods or the exact Basic/CORS table.
    return fetch(u,{ ...init, redirect:'error', signal:init.signal ?? AbortSignal.timeout(rules.request_timeout_ms) });
  }
  async call(method,input) {
    assert(this.child?.connected && !this.disconnected && !this.exitRecord && !this.uncertain,'IPC/ownership uncertain; HOLD');
    validateAPI(method,input,this.ns,this.ids); this.stage = method; this.pending++;
    try {
      const [group,name] = method.split('.');
      const opts = { signal:AbortSignal.timeout(rules.request_timeout_ms) };
      if (method === 'session.log') {
        const items = []; for await (const item of this.client.session.log(input,opts)) { items.push(item); assert(items.length <= rules.max_events); }
        this.journal.push({type:'api-ack',method}); return items;
      }
      const result = await this.client[group][name](...(input === undefined ? [opts] : [input,opts]));
      this.journal.push({type:'api-ack',method}); return result;
    } catch (e) { this.uncertain = true; throw e; } finally { this.pending--; }
  }
  async observeIdle() {
    assert(this.ready && this.pending === 0 && !this.uncertain && !this.disconnected && !this.exitRecord);
    return waitForObservedIdle(async remainingMs => {
      assert(this.child.connected && !this.disconnected && !this.exitRecord && !this.uncertain);
      const reply = this.message('observation',remainingMs); this.child.send({ type:'observe' });
      const m = await reply; assert.equal(m.pid,this.child.pid);
      return m.observation;
    }, rules.observer_timeout_ms);
  }
  async stop(kill = false) {
    if (this.exitRecord) return this.exitRecord;
    if (kill) {
      const observation = await this.observeIdle(); this.journal.push({ type:'idle-kill-eligible', pid:this.child.pid, observation });
      assert(this.child.kill('SIGKILL')); const exited = await bounded(this.exit,rules.stop_timeout_ms,'SIGKILL exit unconfirmed');
      assert.equal(exited.signal,'SIGKILL'); return exited;
    }
    if (this.child.connected) this.child.send({ type:'stop' });
    try { const exited = await bounded(this.exit,rules.stop_timeout_ms,'Scope stop timeout'); assert(this.scopedClosed && !this.uncertain && this.observation?.live === 0 && !this.observation?.observerGap); assert.equal(exited.code,0); return exited; }
    catch (e) {
      this.uncertain = true;
      // Only the exact owned handle may be forced. No PID discovery, cleanup or reuse.
      if (!this.exitRecord) { this.child.kill('SIGKILL'); await bounded(this.exit,rules.stop_timeout_ms,'Owned exit unconfirmed').catch(() => {}); }
      throw e;
    }
  }
}
async function authMatrix(engine) {
  const rows = [];
  for (const row of authCase.rows) {
    engine.checkPaths(); const headers = {};
    if (row.auth !== 'missing') headers.Authorization = row.auth === 'valid' ? engine.auth() : 'Basic '+Buffer.from('opencode:wrong-fixture-password').toString('base64');
    const origin = row.origin === 'controlled' ? engine.baseUrl : row.origin === 'none' ? undefined : row.origin;
    if (origin) headers.Origin = origin;
    const response = await engine.fetchGuard(engine.baseUrl + authCase.endpoint,{ method:authCase.method, headers });
    const allow = response.headers.get('access-control-allow-origin'); const matched = origin ? allow === origin : false;
    await response.body?.cancel();
    assert.equal(response.status,row.status); assert.equal(matched,row.allow_origin); if (!row.allow_origin) assert.equal(allow,null);
    rows.push({ label:row.label,status:response.status,allow_origin_match:matched });
  }
  return rows;
}
export function negativeGuards(ns) {
  const sibling = path.join(path.dirname(ns), randomUUID()); mkdir(sibling);
  const file = path.join(sibling,'file'); fs.writeFileSync(file,'synthetic',{ mode:0o600 });
  const symlink = path.join(sibling,'symlink'), dangling = path.join(sibling,'dangling'), hard = path.join(sibling,'hard'), mode = path.join(sibling,'wrong-mode');
  fs.symlinkSync(file,symlink); fs.symlinkSync(path.join(sibling,'absent'),dangling); fs.linkSync(file,hard); fs.writeFileSync(mode,'fixture',{ mode:0o666 }); fs.chmodSync(mode,0o666);
  const cases = [[path.join(ns,'workspace')+'/../data',[ns]], [sibling,[ns]], ['file://'+file,[sibling]], [symlink,[sibling]], [dangling,[sibling]], [hard,[sibling]], [mode,[sibling]]];
  const results = cases.map(([p,roots],i) => { assert.throws(() => guardPath(p,roots,{ missing:true })); return { label:rules.negative[i], rejected:true, native_calls:0, spawns:0 }; });
  for (const method of rules.prohibited) assert.throws(() => validateAPI(method,{},ns,new Set()));
  assert.throws(() => validateAPI('session.create',{ id:'ses_owned',title:fixture.title,metadata:fixture.metadata,permissions:fixture.permissions,location:{ directory:sibling } },ns,new Set(['ses_owned'])));
  return { paths:results, closed_api_rejected:rules.prohibited.length + 1, rejected_native_calls:0,rejected_spawns:0, fixtures_retained:sibling };
}
async function seed(engine) {
  const templateID = 'ses_'+randomBytes(16).toString('hex'), importedID = 'ses_'+randomBytes(16).toString('hex');
  engine.ids.add(templateID); engine.ids.add(importedID);
  await engine.call('session.create',{ id:templateID,title:fixture.title,metadata:fixture.metadata,permissions:fixture.permissions,location:{ directory:path.join(engine.ns,'workspace') } });
  const exported = await engine.call('session.export',{ sessionID:templateID,sanitize:false }); assert.equal(exported.messages.length,0);
  const info = { id:importedID,projectID:exported.info.projectID,cost:0,tokens:exported.info.tokens,time:{ created:fixture.messages[0].time.created,updated:fixture.messages[0].time.created,idle:fixture.messages[0].time.created },title:fixture.title,metadata:fixture.metadata,permissions:fixture.permissions,location:{ directory:path.join(engine.ns,'workspace') },outcome:'succeeded' };
  const imported = await engine.call('session.import',{ info,messages:fixture.messages,location:info.location }); assert.equal(imported.id,importedID);
  await engine.call('session.update',{ sessionID:importedID,title:fixture.renamed_title,metadata:fixture.metadata,permissions:fixture.permissions });
  return { templateID,importedID };
}
async function capture(engine, id) {
  const info = await engine.call('session.get',{ sessionID:id });
  assert.equal(info.id,id); assert.equal(info.title,fixture.renamed_title); assert.equal(canonical(info.location),canonical({ directory:path.join(engine.ns,'workspace') })); metadata(info.metadata); permissions(info.permissions); assert(info.time.idle);
  const transcript = await engine.call('session.export',{ sessionID:id,sanitize:false });
  assert.equal(canonical(transcript.messages),canonical(fixture.messages));
  const messages = await engine.call('message.list',{ sessionID:id,limit:fixture.max_messages+1,order:'asc' });
  verifyMessagePage(messages);
  const full = await engine.call('session.log',{ sessionID:id,follow:false }); // intentionally omit after
  const log = analyzeLog(full,id,fixture.messages.length);
  assert(log.events.some(e => e.type === 'session.renamed' && e.data.title === fixture.renamed_title));
  const cursor = 0, tail = await engine.call('session.log',{ sessionID:id,after:cursor,follow:false });
  const tailEvents = tail.filter(x => x.type !== 'log.synced');
  assert(tailEvents.every(e => e.durable.seq > cursor));
  assert.equal(canonical(tailEvents),canonical(log.events.filter(e => e.durable.seq > cursor)));
  assert.equal(canonical(tail.filter(x => x.type === 'log.synced')),canonical([log.marker]));
  const sentinel = guardPath(path.join(engine.ns,'workspace/keep.txt'),[engine.ns]); assert.equal(fs.readFileSync(sentinel,'utf8'),fixture.sentinel);
  return { info,transcript,messages,log,sentinel_sha256:sha(fs.readFileSync(sentinel)),mapping:{ id,location:info.location,projectID:info.projectID },exclusive_cursor_verified:true };
}
export async function runCase(name,out) {
  assert(CASES.includes(name));
  guardPath(path.resolve(out),[path.join(path.dirname(root),'evidence')],{ missing:true });
  requireRuntimeInputs(); const before = verifyInputs();
  const ns = namespace(), journal = []; let engine, result, failure = false, diagnostic = null;
  try {
    if (name === 'guards') result = { negative:negativeGuards(ns) };
    engine = new Engine(ns,journal); await engine.start();
    if (name === 'guards') result.auth = await authMatrix(engine);
    else if (name !== 'runtime') {
      const ids = await seed(engine), snapshot = await capture(engine,ids.importedID);
      const template = analyzeLog(await engine.call('session.log',{ sessionID:ids.templateID,follow:false }),ids.templateID,0);
      result = { acknowledged:true,ids,before:snapshot,template_seq0:template.events[0].durable.seq };
      if (['normal-reopen','owned-sigkill-reopen'].includes(name)) {
        await engine.stop(name === 'owned-sigkill-reopen');
        const previous = engine; engine = new Engine(ns,journal); await engine.start(); engine.ids = new Set(previous.ids);
        const reopened = await capture(engine,ids.importedID);
        assert.equal(canonical(reopened),canonical(snapshot),'Reopen must preserve exact committed events/transcript/mapping/sentinel without duplicates');
        result.after = reopened; result.committed_prefix_equal = true; result.no_bootstrap_duplicate = true;
      }
    } else result = { scoped_start:true,authenticated_ready:true };
    await engine.stop();
  } catch (error) { failure = true; diagnostic = { stage:engine?.stage ?? 'startup', name:['AssertionError','TypeError','InvalidRequestError','Error'].includes(error?.name) ? error.name : 'Error', code:error?.code === 'ERR_ASSERTION' ? 'ERR_ASSERTION' : null, source_line:Number(/probe\.mjs:(\d+):\d+/.exec(error?.stack ?? '')?.[1]) || null, assertion_operator:['strictEqual','deepStrictEqual','==','!='].includes(error?.operator) ? error.operator : null }; if (engine?.child && !engine.exitRecord) await engine.stop().catch(() => {}); }
  const after = verifyInputs(); assert.equal(canonical(before),canonical(after));
  const evidence = { schema_version:1,case:name,status:failure ? 'HOLD' : 'PASS',namespace:ns,namespace_retained:true,before,after,journal,diagnostic,result:failure ? null : result,
    limitation:'Direct JS handles only; no OS confinement, queued recovery, provider safety, pairing/PTY, power-loss, production adoption or P7 completion proof.' };
  const output = guardPath(path.resolve(out),[path.join(path.dirname(root),'evidence')],{ missing:true }); fs.mkdirSync(output,{ recursive:true,mode:0o700 });
  guardPath(output,[path.join(path.dirname(root),'evidence')]); fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(evidence,null,2)+'\n',{ flag:'wx',mode:0o600 });
  if (failure) throw new Error('HOLD; namespace retained; no runtime pass'); return evidence;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.execPath,NODE); assert.equal(process.versions.node,'24.14.1');
  const name = process.argv[process.argv.indexOf('--case')+1], out = process.argv[process.argv.indexOf('--out')+1];
  await runCase(name,out);
}
