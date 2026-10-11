import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const repo='/Users/hyukjaechoi/Projects/oh-my-own-code';
const require=createRequire(join(repo,'apps/desktop-app/package.json'));
const {_electron:electron}=require('@playwright/test');
const root=await fs.realpath(await fs.mkdtemp(join(tmpdir(),'omoc-feedback-select-diagnostic-')));
const report={root,scope:'Synthetic DOM browser-selection serialization only; no product flow/render acceptance'};
let app,child;
try{
 app=await electron.launch({executablePath:require('electron'),args:[join(repo,'apps/desktop-app/scripts/fixtures/workbench-host.mjs'),`--user-data-dir=${join(root,'profile')}`],env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:root,TMPDIR:root,TMP:root,TEMP:root,OMOC_UI_TEST_ROOT:root}});
 child=app.process();
 report.hidden=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>({visible:w.isVisible(),focused:w.isFocused(),focusable:w.isFocusable()})));
 assert.ok(report.hidden.every(w=>!w.visible&&!w.focused&&!w.focusable));
 const page=await app.firstWindow();
 report.cases=await page.evaluate(()=>['\uFEFFSYNTHETIC TEXT\r\n\r\nExact whitespace.\r\n','path / literal with wrapped chars '.repeat(8),'plain\nlast\n'].map(text=>{
  const e=document.createElement('pre');e.style.cssText='white-space:pre-wrap;user-select:text;width:150px';e.textContent=text;document.body.append(e);
  const r=document.createRange();r.selectNodeContents(e);const s=getSelection();s.removeAllRanges();s.addRange(r);
  const result={selected:s.toString(),expected:e.textContent,cloned:r.cloneContents().textContent,css:getComputedStyle(e).userSelect};s.removeAllRanges();e.remove();return result;
 }));
}finally{
 if(app){const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));await app.evaluate(({app})=>app.quit()).catch(()=>{});report.exit=await Promise.race([exited,new Promise((_,reject)=>setTimeout(()=>reject(Error('owned exit unproved')),10000).unref())]);assert.equal(report.exit.code,0);await fs.rm(root,{recursive:true});}
 await fs.writeFile(join(repo,'docs/runs/version-bound-line-feedback/evidence/selection-browser-diagnostic-r2.json'),JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify(report));
