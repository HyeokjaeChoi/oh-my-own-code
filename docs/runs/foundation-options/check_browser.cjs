const {chromium}=require('/Users/hyukjaechoi/.nvm/versions/node/v24.14.1/lib/node_modules/designlang/node_modules/playwright');
const fs=require('fs'),http=require('http'),path=require('path'),assert=require('assert');
const root=path.resolve('docs/design/explorations/foundation-options');
const evidence=path.resolve('docs/runs/foundation-options/captures'); fs.mkdirSync(evidence,{recursive:true});
(async()=>{
 const server=http.createServer((req,res)=>{const f=path.join(root,req.url==='/'?'index.html':decodeURIComponent(req.url.split('?')[0]));if(!f.startsWith(root+path.sep)){res.writeHead(403);return res.end();} try{res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'})[path.extname(f)]||'application/octet-stream');res.end(fs.readFileSync(f));}catch{res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let browser; const errors=[],results=[];
 try{
  browser=await chromium.launch({headless:true}); const page=await browser.newPage({viewport:{width:1440,height:1080},deviceScaleFactor:1});
  page.on('pageerror',e=>errors.push(String(e))); page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
  await page.goto('http://127.0.0.1:'+server.address().port); await page.waitForSelector('[data-preset]');
  const data=JSON.parse(fs.readFileSync(path.join(root,'presets.json')));
  for(const p of data.presets){
   await page.click('button[data-preset="'+p.id+'"]');
   for(const mode of ['light','dark']){
    if(await page.locator('html').getAttribute('data-mode')!==mode)await page.click('#mode-switch');
    assert.equal(await page.locator('html').getAttribute('data-preset'),p.id);assert.equal(await page.locator('html').getAttribute('data-mode'),mode);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:path.join(evidence,p.id+'-'+mode+'.png'),fullPage:true});results.push(p.id+' '+mode);
   }
  }
  await page.click('#compare-toggle'); assert.deepEqual(await page.evaluate(()=>{const ids=[...document.querySelectorAll('[id]')].map(e=>e.id);return ids.filter((id,i)=>ids.indexOf(id)!==i)}),[]); await page.waitForSelector('#comparison:not([hidden])'); await page.screenshot({path:path.join(evidence,'comparison.png'),fullPage:true});
  for(const card of await page.locator('.comparison-card').all()){const a=await card.locator('.workbench').boundingBox(),b=await card.locator('.wb-composer').boundingBox();assert(b.y+b.height<=a.y+a.height+1,'comparison composer clipped');}
  await page.focus('[data-choose="instrument"]');await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>document.activeElement.id),'preview-heading');
  await page.click('#compare-toggle');await page.click('#copy-selection');assert((await page.locator('#selection-output').textContent()).length>10);
  await page.setViewportSize({width:768,height:1024});assert(await page.locator('#workbench-host .wb-detail').isVisible());assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(evidence,'tablet.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  for(const p of data.presets){await page.click('button[data-preset="'+p.id+'"]');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  await page.screenshot({path:path.join(evidence,'mobile.png'),fullPage:true});
  await page.focus('button[data-preset="clear"]');await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>document.activeElement.dataset.preset),'clear');
  await page.focus('#mode-switch');await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'compare-toggle');
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(evidence,'browser-results.json'),JSON.stringify({results,viewports:[[1440,1080],[768,1024],[390,844]],errors,limits:'Synthetic preview checks; no production, backend, screen-reader or vendor-parity test.'},null,2));
  console.log('PASS: all preset/mode switches, comparison, selection output, focus, desktop/mobile overflow, console; captures saved.');
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exit(1)});
