'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');
const html=fs.readFileSync('guest/game/index.html','utf8');
const source=html.match(/<script>([\s\S]*?)<\/script>/)[1];
new vm.Script(source);
function harness({width=393,height=600,dpr=2.75,coarse=true,fullscreen=true,lock='success',loader='success'}={}){
  const elements={};
  for(const id of ['player','stage','game','canvas','status','message','fullscreen','display-hint','progress']){
    elements[id]={style:{},clientWidth:width,clientHeight:height,disabled:false,hidden:false,events:{},addEventListener(n,f){this.events[n]=f},focus(){this.focused=true}};
  }
  const events={};
  let fullscreenCalls=0,lockCalls=0,loads=0;
  const document={fullscreenElement:null,getElementById:id=>elements[id],createElement:()=>({}),addEventListener(n,f){events[n]=f},body:{appendChild(s){document.loader=s}},async exitFullscreen(){document.fullscreenElement=null;if(events.fullscreenchange)events.fullscreenchange()}};
  if(fullscreen)elements.player.requestFullscreen=async()=>{fullscreenCalls++;document.fullscreenElement=elements.player;if(events.fullscreenchange)events.fullscreenchange()};
  const module={};
  const context={document,window:{devicePixelRatio:dpr,matchMedia:()=>({matches:coarse}),addEventListener(n,f){events[n]=f},visualViewport:{addEventListener(){}}},screen:{orientation:{async lock(value){assert.equal(value,'landscape');lockCalls++;if(lock==='reject')throw Error('unsupported')}}},getComputedStyle:()=>({paddingTop:'0px',paddingBottom:'0px'}),ResizeObserver:class{observe(){}},createUnityInstance(c,config,progress){loads++;document.config=config;progress(.5);return loader==='success'?Promise.resolve({Module:module}):Promise.reject(Error('load error'))}};
  vm.createContext(context);vm.runInContext(source,context);
  return {elements,document,context,events,module,stats:()=>({fullscreenCalls,lockCalls,loads}),run:s=>vm.runInContext(s,context)};
}
const settle=()=>new Promise(r=>setImmediate(r));
(async()=>{
  const p=harness();assert.equal(p.elements.game.style.width,'393px');assert.equal(p.elements.game.style.height,'245.625px');
  p.document.loader.onload();await settle();assert.equal(p.document.config.devicePixelRatio,2.75);assert.equal(p.module.devicePixelRatio,2.75);assert.equal(p.elements.status.style.display,'none');
  assert.equal(p.document.config.matchWebGLToCanvasSize,true);
  assert.equal(p.document.config.cacheControl(),'no-store');
  p.elements.stage.clientWidth=915;p.elements.stage.clientHeight=412;p.events.resize();assert.equal(p.elements.game.style.width,'659.2px');assert.equal(p.elements.game.style.height,'412px');
  assert.equal(p.module.devicePixelRatio,2.75);
  await p.elements.fullscreen.events.click();assert.equal(p.stats().fullscreenCalls,1);assert.equal(p.stats().lockCalls,1);assert.equal(p.elements.fullscreen.textContent,'Exit fullscreen');assert.equal(p.elements.fullscreen.disabled,false);
  await p.elements.fullscreen.events.click();assert.equal(p.document.fullscreenElement,null);assert.equal(p.elements.fullscreen.textContent,'Fullscreen');
  await Promise.all([p.elements.fullscreen.events.click(),p.elements.fullscreen.events.click()]);assert.equal(p.stats().fullscreenCalls,2);
  const desktop=harness({width:3840,height:2400,dpr:3,coarse:false});desktop.document.loader.onload();await settle();
  const pixels=3840*2400*desktop.module.devicePixelRatio**2;assert.ok(pixels<=4000000.001);await desktop.elements.fullscreen.events.click();assert.equal(desktop.stats().lockCalls,0);
  const unsupported=harness({fullscreen:false});await unsupported.elements.fullscreen.events.click();assert.match(unsupported.elements['display-hint'].textContent,/unavailable/);assert.equal(unsupported.elements.fullscreen.disabled,false);
  const lockRejected=harness({lock:'reject'});await lockRejected.elements.fullscreen.events.click();assert.match(lockRejected.elements['display-hint'].textContent,/sideways/);assert.equal(lockRejected.document.fullscreenElement,lockRejected.elements.player);
  const rejected=harness();rejected.elements.player.requestFullscreen=async()=>{throw Error('denied')};await rejected.elements.fullscreen.events.click();assert.match(rejected.elements['display-hint'].textContent,/not available/);assert.equal(rejected.elements.fullscreen.disabled,false);
  const failed=harness({loader:'reject'});failed.document.loader.onload();await settle();assert.equal(failed.elements.status.style.display,'grid');assert.equal(failed.elements.progress.hidden,true);assert.match(failed.elements.message.textContent,/could not load/);
  const scriptFailed=harness();scriptFailed.document.loader.onerror();assert.equal(scriptFailed.elements.progress.hidden,true);
  const low=harness({width:320,height:200,dpr:1});assert.equal(low.run('renderPixelRatio'),1);
  assert.match(html,/<span id="display-hint" role="status"><\/span>/);assert.ok(!html.includes('For the largest view, play fullscreen.'));assert.ok(!html.includes('SummSessionControl'));assert.match(html,/100dvh/);assert.match(html,/orientation:portrait/);assert.match(html,/Turn your phone sideways/);
  const fullscreenToolbar=html.match(/#player:fullscreen #toolbar\s*\{([^}]+)\}/);
  assert.ok(fullscreenToolbar,'Fullscreen toolbar rule remains explicit');
  assert.match(fullscreenToolbar[1],/position:relative/,'Fullscreen control reserves a row outside the game canvas');
  assert.doesNotMatch(fullscreenToolbar[1],/position:(absolute|fixed)/);
  const manifest=JSON.parse(fs.readFileSync('guest/publication-manifest.json'));
  for(const entry of manifest.files.filter(f=>f.path.includes('/Build/'))){
    const hash=crypto.createHash('sha256').update(fs.readFileSync('guest/'+entry.path)).digest('hex');assert.equal(hash,entry.sha256,entry.path+' changed');
  }
  console.log('PASS: JavaScript syntax, portrait and landscape fit, 2.75x phone DPI, 4 MP limit, 1x displays, fullscreen enter/exit, repeated taps, rejected/unsupported fullscreen and orientation lock, loader success and failures, and all 4 rebuilt player hashes match the publication manifest.');
})().catch(e=>{console.error(e);process.exitCode=1});

// Keep the softer palette and legibility checks in the existing publication gate.
require('./palette.test.cjs');
