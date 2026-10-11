// Read-only exact Native-r4 reuse after one evidence-output root addition; no runtime execution.
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {join} from "node:path";
import {captureProvenance} from "../../../apps/desktop-app/scripts/build-provenance.mjs";
const root=process.cwd();
const hash=(bytes)=>createHash("sha256").update(bytes).digest("hex");
const reportBytes=await readFile(new URL("./evidence/native-r4/configuration-mcp-evidence.json",import.meta.url));
assert.equal(hash(reportBytes),"85389222a0e45ca0cb58704fc16c0689fb52a5c45c93a7a2836f368fc4a4dc47");
const report=JSON.parse(reportBytes);
assert.equal(report.result,"pass");
assert.deepEqual(report.afterCleanup,report.before);
assert.equal(report.cases.length,9);
assert.ok(report.cases.every(x=>x.result==="pass"));
assert.equal(report.cleanup.length,2);
for (const x of report.cleanup) {
 assert.equal(x.exited,true); assert.equal(x.nativeExitConfirmed,true);
 assert.deepEqual(x.exit,{code:0,signal:null});
 assert.equal(x.cleanup.explicitStopConfirmed,true);
 assert.equal(x.cleanup.fallbackDisconnect,false);
 assert.equal(x.cleanup.helperExitConfirmed,true);
 assert.deepEqual(x.nativeStopResult.nativeExit,{code:0,signal:null});
}
assert.equal(report.observers.length,2);
for (const x of report.observers) {
 assert.deepEqual(x.target,x.attached);
 assert.equal(x.event.event,"NOTE_EXIT");assert.equal(x.event.pid,x.target.pid);
 assert.equal(x.event.filter,"EVFILT_PROC");assert.equal(x.exited,true);
 assert.deepEqual(x.exit,{code:0,signal:null});
}
for(const x of report.before.hashes) assert.equal(hash(await readFile(x.path)),x.sha256);
const wrapper="apps/desktop-app/scripts/run-evidence.mjs";
const original=await readFile(new URL("./evidence/run-evidence-before-r9.mjs",import.meta.url),"utf8");
const oldRow=report.before.provenance.selectedScriptsAndFixtures.files.find(x=>x.path===wrapper);
assert.ok(oldRow);assert.equal(hash(original),oldRow.sha256);
const currentWrapper=await readFile(join(root,wrapper),"utf8");
const needle='  "docs/runs/configuration-instructions/evidence",';
assert.equal(original.split(needle).length,2);
assert.equal(currentWrapper,original.replace(needle,needle+'\n  "docs/runs/configuration-mcp/evidence",'));
const current=await captureProvenance(root,{script:"smoke",mode:"dev",platform:"darwin"});
const row=current.selectedScriptsAndFixtures.files.find(x=>x.path===wrapper);
assert.equal(row.sha256,hash(currentWrapper));
assert.equal(row.size,Buffer.byteLength(currentWrapper));
const normalized=structuredClone(current);
normalized.selectedScriptsAndFixtures.files=normalized.selectedScriptsAndFixtures.files.map(x=>x.path===wrapper?oldRow:x);
normalized.selectedScriptsAndFixtures.sha256=report.before.provenance.selectedScriptsAndFixtures.sha256;
normalized.currentRelevantSource=report.before.provenance.currentRelevantSource;
assert.deepEqual(normalized,report.before.provenance);
console.log(JSON.stringify({result:"pass",nativeReexecuted:false,cases:9,authority:"Actual Native-r4; exact unchanged production/build/resources/probe/helper/observer and only allowlisted output-root addition; read-only verification"}));
