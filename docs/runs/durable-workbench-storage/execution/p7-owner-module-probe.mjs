import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") throw new Error("Native macOS probe only");
const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire("/Users/hyukjaechoi/Projects/oh-my-own-code/package.json");
const requireDesktop = createRequire("/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/package.json");
const root = await mkdtemp(join(tmpdir(), "omoc-owner-probe-"));
const processes = [];
const focus = [];
const evidence = { date: "2026-10-04", platform: process.platform, electronVersion: requireDesktop("electron/package.json").version, scope: "Actual frozen storage-lock module compatibility research; zero BrowserWindows/native/provider. Process birth/boot tokens are synthetic; prior app exit is proved by retained parent process handles. Not full P7 acceptance.", scenarios: [] };
const env = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LANG: "en_US.UTF-8", TMPDIR: root };
const entry = join(root, "owner.mjs");
await writeFile(entry, `import { app } from "electron";
import { realpathSync } from "node:fs";
import { createElectronOwnerKernel, createStorageOwner, createProcessVerifier } from "/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/host/storage-lock.mjs";
if (process.platform === "darwin") app.setActivationPolicy("prohibited");
for (const name of ["sessionData", "logs", "crashDumps"]) app.setPath(name, process.env.OMOC_PROFILE_ROOT + "/" + name);
const canonical = realpathSync(process.env.OMOC_LOCK_ROOT);
const kernel = createElectronOwnerKernel(app);
const got = kernel.acquire(canonical);
const identity = { pid: process.pid, platform: "darwin", bootId: "synthetic-boot", startToken: "owned-" + process.env.OMOC_NONCE };
process.stdout.write(JSON.stringify({ got, pid: process.pid, identity }) + "\\n");
if (!got) app.exit(0);
else {
 if (process.env.OMOC_OVERRIDE_ROOT) app.setPath("userData", process.env.OMOC_OVERRIDE_ROOT);
 const proven = JSON.parse(process.env.OMOC_PROVEN_EXITED ?? "[]");
 const verifier = createProcessVerifier({ captureCurrent: () => identity, inspect: (expected) => {
  if (expected.pid === process.pid && expected.startToken === identity.startToken) return { state: "alive", identity, evidence: "os_identity" };
  if (proven.some((known) => Object.keys(known).every((key) => known[key] === expected[key]))) return { state: "exited", identity: expected, evidence: "owned_exit" };
  return { state: "unverified" };
 }});
 const owner = createStorageOwner({ root: canonical, kernel, processVerifier: verifier });
 const acquired = await owner.acquire({ initialize: process.env.OMOC_INITIALIZE === "true" });
 if (acquired.state !== "ready") { process.stdout.write(JSON.stringify({ ownerFailure: acquired }) + "\\n"); app.exit(2); }
 if ((await owner.assertOwned(owner.getNonce())).state !== "ready") app.exit(3);
 app.on("second-instance", () => process.stdout.write(JSON.stringify({ secondInstance: true }) + "\\n"));
 app.whenReady().then(() => process.stdout.write(JSON.stringify({ ready: true, windows: 0, owner: acquired }) + "\\n"));
 setInterval(() => {}, 1000);
}
`, { mode: 0o600 });

function launch(lockRoot, profileRoot, overrideRoot, nonce, initialize = true, proven = []) {
 const child = spawn(requireDesktop("electron"), [entry], { env: { ...env, OMOC_LOCK_ROOT: lockRoot, OMOC_PROFILE_ROOT: profileRoot, OMOC_NONCE: nonce, OMOC_INITIALIZE: String(initialize), OMOC_PROVEN_EXITED: JSON.stringify(proven), ...(overrideRoot && { OMOC_OVERRIDE_ROOT: overrideRoot }) }, stdio: ["ignore", "pipe", "pipe"] });
 processes.push(child);
 child.events = [];
 child.stderrText = "";
 let tail = "";
 child.stdout.on("data", (bytes) => {
  tail += bytes.toString();
  while (tail.includes("\n")) {
   const index = tail.indexOf("\n"); const line = tail.slice(0,index); tail=tail.slice(index+1);
   try { child.events.push(JSON.parse(line)); } catch { /* Non-JSON platform output is not ownership evidence. */ }
  }
  if (child.events.length > 32) child.kill("SIGTERM");
 });
 child.stderr.on("data", (bytes) => { child.stderrText = (child.stderrText + bytes.toString()).slice(-2000); });
 return child;
}
async function event(child, key) {
 const deadline = Date.now() + 10000;
 while (Date.now() < deadline) {
  const result = child.events.find(value => key in value);
  if (result) return result;
  if (child.exitCode !== null || child.signalCode !== null) throw new Error("Probe exited without evidence: " + JSON.stringify(child.events.find(e=>e.ownerFailure) ?? {}) + ": " + child.stderrText);
  await new Promise(resolve => setTimeout(resolve, 20));
 }
 throw new Error("Ownership probe timeout");
}
async function stop(child, signal="SIGTERM") {
 if (child.exitCode !== null || child.signalCode !== null) return;
 const exited = once(child, "exit"); child.kill(signal);
 let timer;
 try { await Promise.race([exited, new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("Probe exit unconfirmed")),5000);})]); }
 finally { clearTimeout(timer); }
}
async function profile(name) {
 const path=join(root,name); await mkdir(path);
 for (const sub of ["sessionData","logs","crashDumps"]) await mkdir(join(path,sub));
 return path;
}

let observer;
try {
 const moduleCache=join(here,"swift-module-cache");await mkdir(moduleCache,{recursive:true});
 const binary=join(here,"p7-focus-observer");
 await new Promise((resolve,reject)=>execFile("/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swiftc",["-sdk","/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX27.0.sdk","-module-cache-path",moduleCache,join(here,"p7-focus-observer.swift"),"-o",binary],{env,maxBuffer:100000},error=>error?reject(error):resolve()));
 observer=spawn(binary,[],{env,stdio:["ignore","pipe","pipe"]});
 let focusTail="";
 observer.stdout.on("data",bytes=>{focusTail+=bytes.toString();while(focusTail.includes("\n")){const i=focusTail.indexOf("\n");try{focus.push(JSON.parse(focusTail.slice(0,i)));}catch{}focusTail=focusTail.slice(i+1);}});
 const waitFocusDeadline=Date.now()+5000;
 while(!focus.length&&Date.now()<waitFocusDeadline)await new Promise(resolve=>setTimeout(resolve,20));
 assert.ok(focus.length,"OS frontmost observer must start before Electron probes");
 const shared=join(root,"canonical-store-owner");const different=join(root,"different-store-owner");await mkdir(shared,{mode:0o700});await mkdir(different,{mode:0o700});
 const a=launch(shared,await profile("a-session"),await profile("a-ephemeral-profile"),"owner-A");
 assert.equal((await event(a,"got")).got,true);await event(a,"ready");
 const b=launch(shared,await profile("b-session"),undefined,"owner-B");
 assert.equal((await event(b,"got")).got,false);await stop(b);
 evidence.scenarios.push({name:"same-store remains locked after first owner changes userData",pass:true});
 const c=launch(different,await profile("c-session"),undefined,"owner-C");
 assert.equal((await event(c,"got")).got,true);await event(c,"ready");
 evidence.scenarios.push({name:"independent canonical store gets independent ownership",pass:true});
 await stop(c);await stop(a,"SIGKILL");
 const prior = (await event(a,"got")).identity;
 const recovered=launch(shared,await profile("recovered-session"),undefined,"owner-D",false,[prior]);
 assert.equal((await event(recovered,"got")).got,true);await event(recovered,"ready");
 evidence.scenarios.push({name:"frozen owner module reclaims dirty controlled app after parent confirmed exact owned process exit",pass:true});
 await stop(recovered);
 await new Promise(resolve=>setTimeout(resolve,150));
 evidence.focus={samples:focus.length,changedSamples:focus.filter(sample=>sample.changed).length,applicationNamesRecorded:false};
 assert.equal(evidence.focus.changedSamples,0,"OS frontmost application changed during background probe");
 evidence.result="pass";
 evidence.limits=["No native child ownership/recovery or production process-birth adapter tested","No Windows or power-loss evidence","No production app window/activation behavior tested","Kernel acquisition plus PID absence alone does not prove unknown child teardown"];
} catch(error) {
 evidence.result="failed";evidence.error=error.message;
} finally {
 let allExited=true;
 for(const child of processes){try{await stop(child);}catch{allExited=false;}}
 if(observer){try{await stop(observer);}catch{allExited=false;}}
 evidence.ownedProcessesExited=allExited;
 if(allExited)await rm(root,{recursive:true,force:false});
 await writeFile(join(here,"p7-owner-module-probe-evidence.json"),JSON.stringify(evidence,null,2)+"\n");
 console.log(JSON.stringify(evidence));
 if(evidence.result!=="pass"||!allExited)process.exitCode=1;
}
