import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('unified sidebar binds official model methods and local submissions resolve references before the carrier', async () => {
  const source=await readFile(new URL('../lib/client.js',import.meta.url),'utf8');
  let plugin, rejectRead=false;
  const entries=[], cleanup=[], calls=[];
  const React={
    createElement:(type,props,...children)=>({type,props,children}),
    useState:value=>[typeof value==='function'?value():value,()=>{}],useEffect:()=>{},useRef:()=>({current:null}),
    useSyncExternalStore:(subscribe,get)=>{const dispose=subscribe(()=>{});dispose();return get();},
  };
  const workspaceModel={
    snapshot:{items:[{workspaceId:'w1',title:'Local folder',sessionIds:['s1']}],pinnedSessionIds:[],archivedSessionIds:[]},
    listeners:new Set(),
    getSnapshot(){return this.snapshot;},
    subscribe(listener){this.listeners.add(listener);return()=>this.listeners.delete(listener);},
  };
  const navigation = Object.create({ startSession(...args) { calls.push({endpoint:'local-new',args}); } });
  const ctx={
    // Service reads return a different bound method on every access, as in Cordis.
    uiWorkspace:new Proxy(navigation,{get:(target,key,receiver)=>typeof target[key]==='function'?target[key].bind(receiver):target[key]}),
    layout:{panelInfo:{getSnapshot:()=>({activePanelId:activePanel})}},
    workspaces:{list:workspaceModel},sessions:{list:{
      getSnapshot:()=>({byId:{s1:{id:'s1',displayTitle:'Local session',updatedAt:1,blank:false}}}),
      subscribe:()=>()=>{},
    }},
    slots:{inject:(_name,register)=>register(),register:(options,component)=>{entries.push({options,component});return()=>{};},onEntryError:()=>()=>{}},
    effect:fn=>{const dispose=fn();if(dispose)cleanup.push(dispose);},on:()=>assert.fail('Cordis cleanup must use effect, not an un-emitted dispose event'),
    connection:{rpc:{async call(_channel,endpoint,payload){
      calls.push({endpoint,payload});
      if(endpoint==='sshRemote/list')return{ok:true,value:{hosts:[],warnings:[]}};
      if(endpoint==='sshRemote/expandReferences')return rejectRead?{ok:false,error:{message:'offline'}}:{ok:true,value:[...payload.content,{type:'text',text:'remote history'}]};
      return{ok:true,value:{accepted:true}};
    }}},
  };
  let activePanel=null;
  vm.runInNewContext(source,{
    window:{__ModuleLoader__:{load:module=>{plugin=module.factory(name=>name==='react'?React:{writeClipboard:async()=>true});}}},
    React,URL,localStorage:{getItem:()=>null,setItem:()=>{}},setInterval:()=>1,clearInterval:()=>{},setTimeout:()=>1,
  });
  const original=ctx.connection.rpc.call;
  const originalStart=Object.getPrototypeOf(navigation).startSession;
  plugin.apply(ctx);
  const sidebar=entries.find(entry=>entry.options.name==='sidebar.workspaces');
  assert.equal(sidebar.options.priority,-20);
  assert.match(JSON.stringify(sidebar.component()),/Local folder/);
  ctx.uiWorkspace.startSession();
  assert.equal(calls.filter(call=>call.endpoint==='local-new').length,1);
  activePanel='ssh-remote-modern';
  ctx.uiWorkspace.startSession();
  assert.equal(calls.filter(call=>call.endpoint==='local-new').length,1,'remote new chat must never fall through to local');
  ctx.uiWorkspace.startSession('explicit-local-workspace');
  assert.equal(calls.filter(call=>call.endpoint==='local-new').length,2);
  const payload={args:{request:{requestId:'stable',sessionId:'local-target',content:[{type:'text',text:'Read dsh://sessions/remote-id?hostId=ssh%3Aresearch'}]}}};
  await ctx.connection.rpc.call('/api','session/prompt',payload);
  const submitted=calls.find(call=>call.endpoint==='session/prompt');
  assert.equal(submitted.payload.args.request.requestId,'stable');
  assert.equal(submitted.payload.args.request.content[1].text,'remote history');
  assert.equal(payload.args.request.content.length,1);
  rejectRead=true;
  assert.equal((await ctx.connection.rpc.call('/api','session/prompt',payload)).ok,false);
  assert.equal(calls.filter(call=>call.endpoint==='session/prompt').length,1);
  for(const dispose of cleanup.toReversed())dispose();
  assert.equal(ctx.connection.rpc.call,original);
  assert.equal(Object.hasOwn(navigation,'startSession'),false);
  assert.equal(Object.getPrototypeOf(navigation).startSession,originalStart);
  cleanup.length=0;
  calls.length=0;
  rejectRead=false;
  plugin.apply(ctx);
  await ctx.connection.rpc.call('/api','session/prompt',payload);
  assert.equal(calls.filter(call=>call.endpoint==='sshRemote/expandReferences').length,1);
  assert.equal(calls.filter(call=>call.endpoint==='session/prompt').length,1);
  for(const dispose of cleanup.toReversed())dispose();
  assert.equal(ctx.connection.rpc.call,original);
});
