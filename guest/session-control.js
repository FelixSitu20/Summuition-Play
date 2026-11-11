/* Summuition supervised-session gate. Public signals only; never put credentials here. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.SummSessionControl=factory(root.document.currentScript.src);
})(typeof window!=='undefined'?window:globalThis,function(scriptUrl){
  'use strict';
  // A renamed project site keeps this file at /<repository>/session-control.js.
  // Only the public status location is derived; write access remains on GitHub.
  function statusUrlFor(source){
    const url=new URL(source);
    const match=url.pathname.match(/^\/([A-Za-z0-9_.-]+)\/session-control\.js$/);
    if(!/^https?:$/.test(url.protocol)||!match)throw Error('Unsupported session script location');
    return 'https://raw.githubusercontent.com/FelixSitu20/'+match[1]+'/session-control/session.json';
  }
  const STATUS_URL=scriptUrl?statusUrlFor(scriptUrl):null;
  function validate(record,now){
    if(!record||record.schema!==1||typeof record.enabled!=='boolean'||
       typeof record.sessionId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(record.sessionId)||
       !Number.isFinite(Date.parse(record.updatedAt)))throw Error('Invalid session state');
    if(record.enabled&&record.closesAt!==null&&!Number.isFinite(Date.parse(record.closesAt)))throw Error('Invalid session end');
    if(record.enabled&&record.closesAt!==null&&Date.parse(record.closesAt)<=now)return 'expired';
    return record.enabled?'open':'closed';
  }
  function create(options){
    const o=options||{};
    const statusUrl=o.statusUrl||STATUS_URL;
    if(!statusUrl)throw Error('Session status URL is required');
    const env=o.environment||globalThis;
    const fetcher=o.fetch||env.fetch.bind(env);
    const now=o.now||(()=>Date.now());
    const schedule=o.setTimeout||env.setTimeout.bind(env);
    const cancel=o.clearTimeout||env.clearTimeout.bind(env);
    const Controller=o.AbortController||env.AbortController;
    const pollMs=3000,timeoutMs=4000;
    let started=false,allowed=false,ended=false,sessionId=null,closesAt=0;
    let pollTimer=null,deadlineTimer=null,inflight=null,sequence=0;
    function tell(text){if(o.onStatus)o.onStatus(text);}
    function terminate(reason){
      if(ended)return;
      ended=true;allowed=false;
      cancel(pollTimer);cancel(deadlineTimer);
      if(inflight)inflight.abort();
      if(o.onDenied)o.onDenied(reason);
    }
    function armDeadline(){
      cancel(deadlineTimer);
      if(!allowed||ended||!Number.isFinite(closesAt))return;
      const remaining=closesAt-now();
      if(remaining<=0){terminate('expired');return;}
      deadlineTimer=schedule(()=>{
        if(now()>=closesAt)terminate('expired');
        else armDeadline();
      },remaining);
    }
    async function check(){
      if(ended||inflight)return;
      cancel(pollTimer);
      if(allowed&&now()>=closesAt){terminate('expired');return;}
      const controller=new Controller();inflight=controller;
      const timeout=schedule(()=>controller.abort(),timeoutMs);
      try{
        const response=await fetcher(statusUrl+'?check='+now()+'-'+(++sequence),{
          method:'GET',mode:'cors',credentials:'omit',cache:'no-store',redirect:'error',
          referrerPolicy:'no-referrer',signal:controller.signal
        });
        if(ended)return;
        if(!response.ok)throw Error('Status unavailable');
        const record=await response.json();
        if(ended)return;
        const state=validate(record,now());
        if(state!=='open'){terminate(state);return;}
        if(sessionId&&sessionId!==record.sessionId){terminate('replaced');return;}
        // A stale cached OPEN can never extend a session beyond an optional owner-selected end.
        sessionId=record.sessionId;closesAt=record.closesAt===null?Infinity:Date.parse(record.closesAt);
        if(!allowed){allowed=true;armDeadline();if(!ended&&o.onAllowed)o.onAllowed();}
        else armDeadline();
        if(!ended)tell('Session open.');
      }catch(error){
        if(!ended){
          if(!allowed){terminate('unreachable');return;}
          tell('The session connection is unavailable. Play continues while we retry.');
          armDeadline();
        }
      }finally{
        cancel(timeout);inflight=null;
        if(!ended)pollTimer=schedule(check,pollMs);
      }
    }
    function start(){if(started||ended)return;started=true;tell('Checking whether play is open...');check();}
    function recheck(){if(started&&!ended)check();}
    function isActive(){return allowed&&!ended;}
    return {start,recheck,isActive,stop:()=>terminate('closed')};
  }
  return {create,validate,STATUS_URL,statusUrlFor};
});