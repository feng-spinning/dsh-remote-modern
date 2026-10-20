import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { Gateway } from '../src/gateway.js';
import { login } from './helpers.js';

test('authenticated remote API reads cancel streams, correlate replies and fail on disconnect', async t => {
  const requests = [], streams = [];
  const server=createServer(async(req,res)=>{
    if(req.url==='/?token=fixture'){res.writeHead(303,{'set-cookie':'auth=private',location:'/'});res.end();return;}
    assert.equal(req.headers.cookie,'auth=private');
    let raw='';for await(const chunk of req) raw+=chunk;
    const message=JSON.parse(raw);
    requests.push(message);
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify({type:'server-response',rpcId:message.rpcId,result:{ok:true,value:{items:[]}}}));
  });
  const sockets=new Set();
  server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});
  const wss=new WebSocketServer({noServer:true});
  server.on('upgrade',(req,socket,head)=>{
    assert.equal(req.headers.cookie,'auth=private');
    wss.handleUpgrade(req,socket,head,ws=>{
      ws.on('message',raw=>{
        const message=JSON.parse(raw);streams.push(message);
        if(message.type==='open') ws.send(JSON.stringify({type:'item',streamId:message.streamId,value:{type:'baseline',value:{items:[]}}}));
      });
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port, gateway=await new Gateway().start();
  t.after(async()=>{await gateway.close();for(const socket of sockets)socket.destroy();wss.close();await new Promise(r=>server.close(r));});
  await gateway.attach({port,endpoint:{port,token:'fixture'}});
  assert.deepEqual(await gateway.call('session/list',{_request:{}}),{items:[]});
  assert.equal(requests[0].method,'session/list');
  assert.deepEqual(requests[0].payload,{args:{_request:{}}});
  assert.deepEqual(await gateway.first('workspace/follow',{}),{type:'baseline',value:{items:[]}});
  await new Promise(r=>setTimeout(r,20));
  assert.ok(streams.some(s=>s.type==='cancel'));
  const cookie=await login(gateway);
  gateway.navigate({sessionId:'session-a',workspaceId:'w1'});
  assert.equal((await(await fetch(gateway.origin+'/_dsh/navigation',{headers:{cookie}})).json()).sessionId,'session-a');
  assert.equal((await fetch(gateway.origin+'/_dsh/navigation')).status,403);
  assert.throws(()=>gateway.navigate({sessionId:'../other'}));
  gateway.detach();assert.throws(()=>gateway.call('session/list',{}),/断开/);
});

test('remote prompt expansion forwards exactly once and refuses unresolved references without sending the prompt',async t=>{
  const prompts=[];
  const server=createServer(async(req,res)=>{
    if(req.url.startsWith('/?token=')){res.writeHead(303,{'set-cookie':'auth=fixture'});res.end();return;}
    let raw='';for await(const chunk of req)raw+=chunk;
    const message=JSON.parse(raw);prompts.push(message);
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({type:'server-response',rpcId:message.rpcId,result:{ok:true,value:{accepted:true}}}));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
  const gateway=await new Gateway({expand:async content=>{
    if(content[0].text==='missing')throw Error('referenced host offline');
    return [...content,{type:'text',text:'resolved remote history'}];
  }}).start();
  t.after(async()=>{await gateway.close();server.closeAllConnections();await new Promise(r=>server.close(r));});
  await gateway.attach({port,endpoint:{port,token:'fixture'}});
  const cookie=await login(gateway);
  const send=async text=>(await(await fetch(gateway.origin+'/api/session/prompt',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({
    type:'client-request',rpcId:'request-id',method:'session/prompt',payload:{args:{request:{requestId:'stable-id',sessionId:'session-r',mode:'queue',content:[{type:'text',text}]}}},
  })})).json()).result;
  assert.equal((await send('read local')).ok,true);
  assert.equal(prompts.length,1);assert.equal(prompts[0].payload.args.request.requestId,'stable-id');
  assert.equal(prompts[0].payload.args.request.content[1].text,'resolved remote history');
  const rejected=await send('missing');assert.equal(rejected.ok,false);assert.match(rejected.error.message,/offline/);
  assert.equal(prompts.length,1);
});
