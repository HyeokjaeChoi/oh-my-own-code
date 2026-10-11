// Read-only verification of the actual r4 build after Native output-path-only retry.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { captureProvenance } from '../../../apps/desktop-app/scripts/build-provenance.mjs';
const original = JSON.parse(await readFile(new URL('./actual-build-r4.json', import.meta.url), 'utf8'));
assert.equal(original.exit_code, 0);
assert.equal(original.inputs_changed, false);
assert.equal(original.source_sha256, '709299e9a85286bc7fceb34f300d46b4fd1d16b4faf33b1503b76c3d628235ad');
const current = await captureProvenance(process.cwd(), {script:'smoke', mode:'dev', platform:'darwin'});
console.log(JSON.stringify({result:'pass', authority:'Read-only exact-byte reuse of actual r4 build; no build executed', buildStampSha256:current.buildStampSha256, originalRecordedAt:original.recorded_at}));
