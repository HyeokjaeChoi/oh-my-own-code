// Read-only current-byte verification of the actual successful MCP r1 build.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {captureProvenance} from '../../../apps/desktop-app/scripts/build-provenance.mjs';
const original=JSON.parse(await readFile(new URL('./actual-build-r1.json',import.meta.url),'utf8'));
assert.equal(original.exit_code,0);
assert.deepEqual(original.argv,['pnpm','exec','nx','run','desktop-app:build','--skip-nx-cache']);
const log=await readFile(new URL('./evidence/build-actual-r1.log',import.meta.url));
assert.equal(createHash('sha256').update(log).digest('hex'),original.log_sha256);
assert.ok(log.toString().includes('Successfully ran target build for project desktop-app'));
const current=await captureProvenance(process.cwd(),{script:'smoke',mode:'dev',platform:'darwin'});
assert.equal(current.buildStampSha256,original.build_stamp_sha256);
console.log(JSON.stringify({result:'pass',authority:'Read-only exact current production inputs/artifacts/resources of actual r1 build; no build rerun',buildStampSha256:current.buildStampSha256,actualBuildExit:original.exit_code}));
