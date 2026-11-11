'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.SUMM_PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'../guest');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'publication-manifest.json'),'utf8'));
const projectPath=new URL(manifest.publicUrl).pathname;
const endpoint=require('../guest/session-control.js').statusUrlFor(manifest.publicUrl+'session-control.js');
const state=(enabled,id='01234567-89ab-cdef-0123-456789abcdef')=>({schema:1,enabled,sessionId:id,updatedAt:new Date().toISOString(),closesAt:null});
let current=state(false),offline=false,server,browser;
(async()=>{
  server=http.createServer((req,res)=>{
    const requestPath=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(!requestPath.startsWith(projectPath)){res.writeHead(404);return res.end();}
    let relative=requestPath.slice(projectPath.length);
    if(!relative||relative.endsWith('/'))relative+='index.html';
    const file=path.resolve(root,relative);
    if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
    try{res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':'application/octet-stream');res.end(fs.readFileSync(file));}
    catch{res.writeHead(404);res.end();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}${projectPath}`;
  browser=await chromium.launch({headless:true,executablePath:process.env.SUMM_EDGE||'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',args:['--enable-unsafe-swiftshader']});
  const context=await browser.newContext({viewport:{width:1280,height:800}});
  await context.route(endpoint+'?*',route=>offline?route.abort():route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*','Cache-Control':'no-store'},body:JSON.stringify(current)}));
  const page=await context.newPage(),requests=[],errors=[];
  page.on('request',r=>requests.push(r.url()));page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'game/index.html?release=local-switch-test');await page.waitForURL('**/session-ended.html?reason=closed');
  assert.equal(requests.filter(u=>u.includes('/Build/')).length,0,'Closed entry must not download Unity');
  assert.ok(await page.locator('h1').innerText()==='Play is paused');
  await page.screenshot({path:path.join(process.env.TEMP||__dirname,'summ-switch-paused.png')});
  current=state(true);await page.goto(base+'game/');
  await page.waitForFunction(()=>typeof unityInstance!=='undefined'&&!!unityInstance,{},{timeout:120000});
  assert.equal(await page.locator('#status').evaluate(el=>getComputedStyle(el).display),'none');
  offline=true;await page.waitForTimeout(6000);assert.ok(await page.evaluate(()=>typeof unityInstance!=='undefined'&&!!unityInstance),'Brief offline state must not end active play');
  offline=false;current=state(false);const stopStarted=Date.now();
  await page.waitForURL('**/session-ended.html?reason=closed',{timeout:10000});
  const stopMs=Date.now()-stopStarted;
  assert.equal(await page.locator('canvas').count(),0,'Stop must unload the game document');
  assert.equal(await page.evaluate(()=>typeof unityInstance),'undefined');
  current=state(true);await page.goto(base+'game/');
  await page.waitForFunction(()=>typeof unityInstance!=='undefined'&&!!unityInstance,{},{timeout:120000});
  current=state(true,'ffffffff-ffff-ffff-ffff-ffffffffffff');
  await page.waitForURL('**/session-ended.html?reason=replaced',{timeout:10000});
  const buildCount=requests.filter(u=>u.includes('/Build/')).length;
  offline=true;await page.goto(base+'game/');await page.waitForURL('**/session-ended.html?reason=unreachable');
  assert.equal(requests.filter(u=>u.includes('/Build/')).length,buildCount);
  offline=false;await context.route('**/session-control.js',r=>r.abort());
  await page.goto(base+'game/');await page.waitForURL('**/session-ended.html?reason=unreachable');
  assert.equal(requests.filter(u=>u.includes('/Build/')).length,buildCount);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({result:'PASS',closedEntryNoBuild:true,openLoadsUnity:true,explicitStopUnloads:true,activeNetworkFailureContinuesPlay:true,mockedStopMs:stopMs,newSessionEndsOldTab:true,offlineEntryBlocked:true,missingGateScriptBlocksEntry:true,runtimeErrors:errors,remoteEndpoint:'mocked; no live GitHub state changed'},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));});