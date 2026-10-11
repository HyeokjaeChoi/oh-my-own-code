import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { root, guardPath, requireRuntimeInputs } from './freeze.mjs';

// Server imports occur only after guarded IPC initialization. This file is not imported in preparation.
assert.equal(globalThis.Bun?.version, '1.4.2', 'Fixed Bun required');
assert.equal(process.execPath, path.join(root, 'runtime/bun-package/package/bin/bun'));
const handles = new Map(); let nextHandle = 0, observerGap = false, scope, fiber, Effect, Scope, Exit, Fiber;
let initialized = false, closing = false;
const send = msg => { if (process.connected) process.send(msg); };
function observe(handle, kind) {
  if (!handle) { observerGap = true; return handle; }
  const id = ++nextHandle, record = { id, kind, pid: handle.pid ?? null, exited: false };
  handles.set(id, record);
  if (typeof handle.once === 'function') {
    handle.once('exit', (code, signal) => Object.assign(record, { exited: true, code, signal }));
    handle.once('error', () => { observerGap = true; });
  } else if (handle.exited?.then) {
    handle.exited.then(code => Object.assign(record, { exited: true, code, signal: handle.signalCode ?? null }), () => { observerGap = true; });
  } else observerGap = true;
  return handle;
}
function installObserver() {
  for (const key of ['spawn', 'exec', 'execFile', 'fork']) {
    const original = cp[key]; cp[key] = function (...args) { return observe(original.apply(this, args), `node.${key}`); };
  }
  const nodeSpawnSync = cp.spawnSync;
  cp.spawnSync = function (...args) {
    const result = nodeSpawnSync.apply(this,args);
    const exited = Number.isInteger(result.status) || typeof result.signal === 'string';
    handles.set(++nextHandle,{ id:nextHandle,kind:'node.spawnSync',pid:result.pid ?? null,exited,code:result.status,signal:result.signal });
    if (!exited) observerGap = true; return result;
  };
  for (const key of ['execSync','execFileSync']) cp[key] = () => { observerGap = true; throw new Error('No direct sync descendant exit proof'); };
  const spawn = Bun.spawn, spawnSync = Bun.spawnSync;
  Bun.spawn = function (...args) { return observe(spawn.apply(this, args), 'Bun.spawn'); };
  Bun.spawnSync = function (...args) {
    const result = spawnSync.apply(this, args);
    handles.set(++nextHandle, { id: nextHandle, kind: 'Bun.spawnSync', pid: result.pid ?? null, exited: result.exitCode !== undefined, code: result.exitCode, signal: result.signalCode ?? null });
    if (result.exitCode === undefined) observerGap = true; return result;
  };
  syncBuiltinESMExports();
  assert.notEqual(Bun.spawn, spawn); assert.notEqual(Bun.spawnSync, spawnSync);
}
function observation() {
  return { scope: 'direct JS ChildProcess/Bun handles only; not arbitrary native/OS descendants', observerGap, handles: [...handles.values()], live: [...handles.values()].filter(h => !h.exited).length };
}
async function stop(reason) {
  if (closing) return; closing = true;
  try {
    if (fiber) await Effect.runPromise(Fiber.interrupt(fiber));
    if (scope) await Effect.runPromise(Scope.close(scope, Exit.void));
    const state = observation(); send({ type: 'scope-closed', pid:process.pid, reason, observation: state });
    // A direct descendant without exit proof leaves the process alive for controller HOLD.
    if (state.observerGap || state.live) { send({ type: 'hold', reason: 'descendant-exit-unconfirmed' }); return; }
    process.exit(0);
  } catch { send({ type: 'hold', reason: 'scope-close-unconfirmed' }); }
}
async function initialize(input) {
  assert(!initialized); initialized = true;
  requireRuntimeInputs({ engine: true });
  assert(input && Object.keys(input).sort().join(',') === 'namespace,password,type');
  assert(typeof input.password === 'string' && /^[a-f0-9]{64}$/.test(input.password));
  const namespace = guardPath(input.namespace, [path.join(root, 'runtime-output')]);
  const owned = name => guardPath(path.join(namespace, name), [namespace]);
  const workspace = owned('workspace'), config = owned('config'), database = guardPath(path.join(namespace, 'data/server.sqlite'), [namespace], { missing: true });
  assert.equal(process.cwd(), workspace);
  const expected = { HOME: owned('home'), XDG_CONFIG_HOME: config, XDG_DATA_HOME: owned('data'), XDG_STATE_HOME: owned('state'), XDG_CACHE_HOME: owned('cache'), TMPDIR: owned('tmp'), OPENCODE_CONFIG_DIR: config };
  for (const [key, value] of Object.entries(expected)) assert.equal(process.env[key], value);
  const allowed = new Set([...Object.keys(expected), 'PATH', 'LANG', 'LC_ALL', 'NODE_CHANNEL_FD', 'NODE_CHANNEL_SERIALIZATION_MODE']);
  for (const key of Object.keys(process.env)) assert(allowed.has(key), 'Ambient child environment');
  installObserver();
  ({ Effect, Scope, Exit, Fiber } = await import('effect'));
  const { start } = await import('@opencode/server/process');
  scope = await Effect.runPromise(Scope.make());
  const content = JSON.stringify({ plugins: [], mcp: {}, providers: {}, instructions: [], permissions: [{ action: '*', resource: '*', effect: 'deny' }], update: 'disable', share: 'disabled' });
  fiber = Effect.runFork(start({ events: { persist: true }, hostname: '127.0.0.1', port: 0,
    password: input.password, database: { path: database }, config: { directory: config, project: false, content },
    models: { fetch: false }, fs: { filewatcher: false, fff: false } }).pipe(Effect.provideService(Scope.Scope, scope)));
  const result = await Effect.runPromise(Fiber.join(fiber));
  assert.equal(result.address._tag, 'TcpAddress'); assert(Number.isInteger(result.address.port) && result.address.port > 0);
  send({ type: 'ready', pid: process.pid, port: result.address.port, engine: Bun.version, observation: observation() });
}
process.on('message', input => {
  if (input?.type === 'init') initialize(input).catch(() => { send({ type: 'startup-failed' }); void stop('startup-failure'); });
  else if (input?.type === 'stop') void stop('requested');
  else if (input?.type === 'observe' && initialized && !closing) send({ type: 'observation', pid: process.pid, observation: observation() });
  else { send({ type: 'hold', reason: 'unexpected-ipc' }); void stop('ipc-failure'); }
});
process.on('disconnect', () => void stop('ipc-disconnect'));
process.on('SIGTERM', () => void stop('SIGTERM'));
process.on('SIGINT', () => void stop('SIGINT'));
setTimeout(() => { if (!initialized) void stop('init-timeout'); }, 10000).unref();
