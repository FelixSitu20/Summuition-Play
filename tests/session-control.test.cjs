'use strict';
const assert=require('node:assert/strict');
const control=require('../guest/session-control.js');
const TEST_STATUS_URL=control.statusUrlFor('https://felixsitu20.github.io/Renamed-Game/session-control.js');
const BASE=Date.parse('2026-11-11T10:00:00Z');
const id='01234567-89ab-cdef-0123-456789abcdef';
const record=(patch={})=>({schema:1,enabled:true,sessionId:id,updatedAt:new Date(BASE).toISOString(),closesAt:null,...patch});
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function harness(first=record()){
  let now=BASE,next=0,reply=first;
  const tasks=new Map(),events={allowed:0,denied:[],statuses:[],requests:[]};
  const setTimeout=(fn,ms)=>{tasks.set(++next,{fn,at:now+ms});return next;};
  const clearTimeout=id=>tasks.delete(id);
  const fetch=async(url,options)=>{
    events.requests.push({url,options});
    if(reply instanceof Error)throw reply;
    if(typeof reply==='function')return reply(url,options);
    return {ok:true,json:async()=>reply};
  };
  const gate=control.create({statusUrl:TEST_STATUS_URL,fetch,now:()=>now,setTimeout,clearTimeout,AbortController,
    onAllowed:()=>events.allowed++,onDenied:r=>events.denied.push(r),onStatus:s=>events.statuses.push(s)});
  async function advance(ms){const target=now+ms;for(;;){const due=[...tasks].filter(([,t])=>t.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;tasks.delete(due[0]);now=due[1].at;due[1].fn();await flush();}now=target;await flush();}
  return {gate,events,tasks,advance,set:r=>reply=r,jump:ms=>now+=ms};
}
(async()=>{
  assert.equal(TEST_STATUS_URL,'https://raw.githubusercontent.com/FelixSitu20/Renamed-Game/session-control/session.json');
  assert.equal(control.statusUrlFor('http://127.0.0.1:4321/Another-Name/session-control.js?v=1'),'https://raw.githubusercontent.com/FelixSitu20/Another-Name/session-control/session.json');
  assert.throws(()=>control.statusUrlFor('https://example.com/other.js'));
  assert.throws(()=>control.statusUrlFor('https://example.com/%2Fbad/session-control.js'));
  assert.equal(control.validate(record(),BASE),'open');
  assert.equal(control.validate(record({enabled:false}),BASE),'closed');
  assert.equal(control.validate(record({closesAt:new Date(BASE).toISOString()}),BASE),'expired');
  for(const patch of [{schema:2},{enabled:'true'},{sessionId:'bad'},{updatedAt:'bad'},{closesAt:'invalid'}])assert.throws(()=>control.validate(record(patch),BASE));
  const p=harness();p.gate.start();p.gate.start();await flush();assert.equal(p.events.allowed,1);assert.ok(p.gate.isActive());
  const req=p.events.requests[0];assert.equal(req.options.cache,'no-store');assert.equal(req.options.credentials,'omit');assert.equal(req.options.redirect,'error');assert.ok(req.url.startsWith(TEST_STATUS_URL+'?check='));
  await p.advance(3000);assert.equal(p.events.requests.length,2);assert.notEqual(req.url,p.events.requests[1].url);
  p.set(record({enabled:false}));await p.advance(3000);assert.deepEqual(p.events.denied,['closed']);assert.equal(p.gate.isActive(),false);p.set(record());p.gate.recheck();await p.advance(60000);assert.equal(p.events.allowed,1);assert.equal(p.events.requests.length,3);
  const closed=harness(record({enabled:false}));closed.gate.start();await flush();assert.equal(closed.events.allowed,0);assert.deepEqual(closed.events.denied,['closed']);
  const outage=harness();outage.gate.start();await flush();outage.set(Error('offline'));await outage.advance(60000);assert.ok(outage.gate.isActive());assert.deepEqual(outage.events.denied,[]);outage.set(record({enabled:false}));await outage.advance(3000);assert.deepEqual(outage.events.denied,['closed']);
  const recovered=harness();recovered.gate.start();await flush();recovered.set(Error('brief hiccup'));await recovered.advance(6000);recovered.set(record());await recovered.advance(3000);await recovered.advance(9000);assert.ok(recovered.gate.isActive());assert.equal(recovered.events.allowed,1);
  const missing=harness(Error('network'));missing.gate.start();await flush();assert.deepEqual(missing.events.denied,['unreachable']);assert.equal(missing.events.allowed,0);
  const bad=harness(record({closesAt:'bad'}));bad.gate.start();await flush();assert.deepEqual(bad.events.denied,['unreachable']);
  const replacement=harness();replacement.gate.start();await flush();replacement.set(record({sessionId:'ffffffff-ffff-ffff-ffff-ffffffffffff'}));await replacement.advance(3000);assert.deepEqual(replacement.events.denied,['replaced']);
  const expiry=harness(record({closesAt:new Date(BASE+5000).toISOString()}));expiry.gate.start();await flush();await expiry.advance(5000);assert.deepEqual(expiry.events.denied,['expired']);
  const suspended=harness();suspended.gate.start();await flush();suspended.jump(60000);suspended.gate.recheck();await flush();assert.deepEqual(suspended.events.denied,[]);assert.ok(suspended.gate.isActive());
  const blocked=harness((_u,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('timeout')))));blocked.gate.start();await blocked.advance(4000);assert.deepEqual(blocked.events.denied,['unreachable']);
  const racing=harness();let resolve;racing.set(()=>new Promise(r=>resolve=r));racing.gate.start();racing.gate.recheck();assert.equal(racing.events.requests.length,1);racing.gate.stop();resolve({ok:true,json:async()=>record()});await flush();assert.equal(racing.events.allowed,0);assert.deepEqual(racing.events.denied,['closed']);
  const serverError=harness(()=>Promise.resolve({ok:false}));serverError.gate.start();await flush();assert.deepEqual(serverError.events.denied,['unreachable']);
  let clockRead=0,boundaryAllowed=0,boundaryDenied=[];
  const boundary=control.create({statusUrl:TEST_STATUS_URL,fetch:async()=>({ok:true,json:async()=>record({closesAt:new Date(BASE+2).toISOString()})}),now:()=>BASE+[0,1,3][Math.min(clockRead++,2)],setTimeout:()=>0,clearTimeout(){},AbortController,onAllowed:()=>boundaryAllowed++,onDenied:r=>boundaryDenied.push(r)});
  boundary.start();await flush();assert.equal(boundaryAllowed,0);assert.deepEqual(boundaryDenied,['expired']);
  console.log('PASS: 18 session-control cases covering open/stop, blocked start, no credentials, cache-busting, outages/recovery, expiry, changed session, suspended tab, request timeout, idempotence and stop/load race.');
})().catch(error=>{console.error(error);process.exitCode=1;});