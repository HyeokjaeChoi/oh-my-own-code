import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
export const root = path.dirname(fileURLToPath(import.meta.url));
export const runRoot = path.dirname(root);
export const repo = path.resolve(root, '../../../..');
export const NODE = '/Users/hyukjaechoi/.nvm/versions/node/v24.14.1/bin/node';
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const canonical = v => JSON.stringify(v, function (k, x) {
  return x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x;
});
export const readJSON = p => JSON.parse(fs.readFileSync(p, 'utf8'));
export function identity(file) {
  const s = fs.lstatSync(file);
  assert(s.isFile() && !s.isSymbolicLink() && s.nlink === 1, `Not a single regular file: ${file}`);
  return { size: s.size, sha256: sha(fs.readFileSync(file)) };
}
export function guardPath(file, roots, { missing = false } = {}) {
  assert(typeof file === 'string' && path.isAbsolute(file) && !file.includes('://') && !file.split(path.sep).includes('..'), 'Unsafe path spelling');
  const target = path.normalize(file);
  assert(roots.some(r => target === r || target.startsWith(r + path.sep)), 'Path outside owned roots');
  const parts = target.split(path.sep).filter(Boolean); let current = path.parse(target).root;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    if (!fs.existsSync(current)) {
      // lstat catches dangling links which existsSync treats as missing.
      try { fs.lstatSync(current); assert.fail('Dangling link'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      assert(missing, 'Path missing'); return target;
    }
    const s = fs.lstatSync(current);
    assert(!s.isSymbolicLink() && (s.isDirectory() || s.isFile()), 'Link or special path');
    if (s.isFile()) assert(s.nlink === 1 && i === parts.length - 1, 'Hard link or non-directory ancestor');
    if (roots.some(r => current === r || current.startsWith(r + path.sep))) {
      assert(s.uid === process.getuid() && (s.mode & 0o022) === 0, 'Wrong owner or writable mode');
    }
  }
  assert(fs.realpathSync(target) === target, 'Noncanonical path'); return target;
}
export function tree(directory) {
  const files = {}; const links = {};
  function visit(dir) {
    for (const name of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, name), rel = path.relative(root, file), stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) {
        const dest = fs.realpathSync(file);
        assert(dest.startsWith(directory + path.sep), 'Dependency link escapes tree');
        links[rel] = { target: fs.readlinkSync(file), target_sha256: stat.isFile() ? identity(dest).sha256 : fs.statSync(dest).isFile() ? identity(dest).sha256 : null };
      } else if (stat.isDirectory()) visit(file);
      else files[rel] = identity(file);
    }
  }
  visit(directory); return { files, links };
}
export function immutableSnapshot() {
  const policy = readJSON(path.join(runRoot, 'prototype-input-policy.json'));
  const inputs = {};
  // input-manifest excludes itself; its byte hash is recorded in each evidence binding and by Main.
  for (const file of policy.required_input_paths_before_checks) {
    if (file.endsWith('/input-manifest.json')) continue;
    inputs[file] = identity(path.join(repo, file));
  }
  const sourceFile = path.join(repo, policy.p7_source_freeze), source = readJSON(sourceFile).source;
  assert(Object.keys(source).length === 35, 'Expected P7 source35');
  const p7 = {};
  for (const [file, expected] of Object.entries(source)) {
    p7[file] = identity(path.join(repo, file)); assert.equal(p7[file].sha256, expected, `P7 changed: ${file}`);
  }
  const base = 'apps/desktop-app/dist/packages/OhMyOwnCode-darwin-arm64/OhMyOwnCode.app/Contents';
  const launch = {};
  for (const suffix of ['Resources/app.asar', 'Resources/opencode/darwin-arm64/opencode', 'MacOS/OhMyOwnCode']) {
    const file = `${base}/${suffix}`; launch[file] = identity(path.join(repo, file));
  }
  const baselinePath = path.join(repo,'docs/runs/durable-workbench-storage/evidence/native-r1/native-storage-evidence.json');
  let baseline;
  function find(v) { if (!v || typeof v !== 'object') return; if (v.launchArtifacts) baseline = v.launchArtifacts; for (const child of Object.values(v)) find(child); }
  find(readJSON(baselinePath)); assert(baseline?.files.length === 3);
  for (const f of baseline.files) assert.equal(launch[f.path].sha256, f.sha256, 'Current launch differs from retained P7 bytes');
  return { inputs, p7, launch, p7_freeze: identity(sourceFile), launch_baseline: identity(baselinePath) };
}
export function verifyInputs({ engine = false } = {}) {
  if (engine) { assert.equal(globalThis.Bun?.version, '1.4.2'); assert.equal(process.execPath, path.join(root, 'runtime/bun-package/package/bin/bun')); }
  else { assert.equal(process.execPath, NODE); assert.equal(process.versions.node, '24.14.1'); }
  const manifest = readJSON(path.join(root, 'input-manifest.json'));
  assert.equal(canonical(immutableSnapshot()), canonical(manifest.inventory), 'Frozen input/P7/launch mismatch');
  const runtime = readJSON(path.join(root, 'runtime-manifest.json'));
  for (const [file, expected] of Object.entries(runtime.preparation_assets)) assert.deepEqual(identity(path.join(root,file)),expected);
  assert.equal(canonical(tree(path.join(root, 'node_modules'))), canonical(runtime.dependencies));
  assert.equal(canonical(tree(path.join(root, 'runtime'))), canonical(runtime.engine_assets));
  for (const [file, expected] of Object.entries(runtime.controller_assets)) assert.deepEqual(identity(file), expected);
  return { input_manifest_sha256: identity(path.join(root, 'input-manifest.json')).sha256,
    runtime_manifest_sha256: identity(path.join(root, 'runtime-manifest.json')).sha256,
    inventory_sha256: sha(canonical(manifest.inventory)) };
}
export function requireRuntimeInputs(options) {
  const contract = readJSON(path.join(runRoot, 'contract.json'));
  const policy = readJSON(path.join(runRoot, 'prototype-input-policy.json'));
  for (const p of policy.required_input_paths_before_checks) assert(contract.environment_files.includes(p), 'Main must register all actual inputs first');
  const approved = readJSON(path.join(runRoot, 'design-review-v3.json'));
  const design = contract.documents.find(d => d.gate === 'design_spec');
  assert.equal(approved.verdict,'pass'); assert.equal(approved.design_version,'3');
  assert.equal(design.version,'3'); assert.equal(design.sha256,sha(fs.readFileSync(path.join(runRoot,'design.txt'))));
  // Main registers actual frozen inputs. Routine source/input adjustments do not repeat ENTRY.
  verifyInputs(options);
}
export function freeze() {
  assert.equal(process.execPath, NODE);
  const receipt = readJSON(path.join(root, 'preparation/install-receipt.json'));
  const lock = readJSON(path.join(root, 'package-lock.json'));
  for (const [p, item] of Object.entries(lock.packages)) if (p) {
    assert(item.resolved?.startsWith('https://registry.npmjs.org/') && item.integrity?.startsWith('sha512-'), 'Nonpublic lock dependency');
  }
  const dependencies = tree(path.join(root, 'node_modules'));
  const preparation_assets = Object.fromEntries(['preparation/prepare.py','preparation/bun.tgz','preparation/bun-package-metadata.json','preparation/install-receipt.json','preparation/static-tests.mjs'].map(p => [p,identity(path.join(root,p))]));
  const runtime = { schema_version: 1, preparation_assets, engine: { version: '1.4.2', package: '@oven/bun-darwin-aarch64', archive_integrity: receipt.bun_integrity, path: path.join(root, 'runtime/bun-package/package/bin/bun') },
    controller: { path: NODE, version: '24.14.1', npm_version: receipt.npm_version },
    controller_assets: { [NODE]: identity(NODE), [receipt.npm_cli]: identity(receipt.npm_cli) },
    lock_packages: lock.packages, dependencies, engine_assets: tree(path.join(root, 'runtime')),
    special_assets: Object.fromEntries(Object.entries(dependencies.files).filter(([p]) => /\.(node|wasm)$|migration|sqlite|darwin|native/.test(p))),
    scripts_executed: false, runtime_executed: false };
  fs.writeFileSync(path.join(root, 'runtime-manifest.json'), JSON.stringify(runtime, null, 2) + '\n');
  fs.writeFileSync(path.join(root, 'input-manifest.json'), JSON.stringify({ schema_version: 1,
    exclusion: 'input-manifest.json excludes itself; evidence and Main bind its final bytes separately. Outputs and preparation cache are not inputs.',
    inventory: immutableSnapshot() }, null, 2) + '\n');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv[2], '--prepare-freeze', 'Preparation-only invocation'); freeze();
  console.log('Preparation manifests frozen; no runtime executed');
}
