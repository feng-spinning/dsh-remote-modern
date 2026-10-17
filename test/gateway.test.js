import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request, createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { connect } from 'node:net';
import { Gateway } from '../src/gateway.js';
import { fakeBackend, login, sleep } from './helpers.js';

test('a browser reset during an upstream WebSocket handshake is handled', async t => {
  let accepted, upstream;
  const pending=new Promise(resolve=>accepted=resolve);
  const server=createServer((req,res)=>{res.writeHead(303,{'set-cookie':'fixture=yes',location:'/'});res.end();});
  server.on('upgrade',(req,socket)=>{upstream=socket;socket.on('error',()=>{});accepted();});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  const gateway=await new Gateway().start();
  t.after(()=>new Promise(resolve=>{upstream?.destroy();server.closeAllConnections();server.close(resolve);}));t.after(()=>gateway.close());
  await gateway.attach({port,endpoint:{port,token:'fixture'}});
  const cookie=await login(gateway), address=new URL(gateway.origin);
  const browser=connect(Number(address.port),'127.0.0.1');browser.on('error',()=>{});
  await new Promise(resolve=>browser.once('connect',resolve));
  browser.write(`GET /mux HTTP/1.1\r\nHost: ${address.host}\r\nCookie: ${cookie}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`);
  await pending; browser.resetAndDestroy();
  await sleep(50);
});

test('an upstream reset during a streamed response does not crash the host and the gateway can reattach', async t => {
  let upstream;
  const server = createServer((req,res) => {
    if (req.url.startsWith('/?token=')) {res.writeHead(303,{'set-cookie':'fixture=yes',location:'/'});res.end();return;}
    res.writeHead(200,{'content-type':'text/event-stream'}); res.write('data: connected\n\n'); upstream=res.socket;
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  const gateway=await new Gateway().start();
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  t.after(()=>gateway.close());
  await gateway.attach({port,endpoint:{port,token:'fixture'}});
  const cookie=await login(gateway);
  const response=await fetch(gateway.origin+'/events',{headers:{cookie}});
  const reader=response.body.getReader();
  await reader.read();
  const failed=assert.rejects(reader.read());
  upstream.resetAndDestroy();
  await failed;
  const replacement=await fakeBackend();t.after(()=>replacement.close());
  await gateway.attach(replacement);
  assert.equal((await fetch(gateway.origin,{headers:{cookie}})).status,200);
});

test('gateway authenticates locally and rewrites authority/cookies without leaking remote token', async t => {
  const backend = await fakeBackend(), gateway = await new Gateway().start();
  t.after(() => backend.close()); t.after(() => gateway.close());
  assert.equal((await fetch(gateway.origin)).status, 403);
  assert.equal((await fetch(gateway.origin + '/?sshAuth=' + encodeURIComponent('é'.repeat(64)), { redirect: 'manual' })).status, 403);
  assert.equal((await fetch(gateway.entryUrl(), { redirect: 'manual', headers: { origin: 'https://evil.example' } })).status, 403);
  const cookie = await login(gateway);
  assert.equal(cookie.includes('remote-secret'), false);
  await gateway.attach(backend);
  const response = await fetch(gateway.origin + '/api/workspace/list', { method: 'POST', headers: { cookie, origin: gateway.origin, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 200); assert.equal(response.headers.has('set-cookie'), false);
  const call = backend.calls.at(-1);
  assert.equal(call.host, `127.0.0.1:${backend.port}`); assert.equal(call.origin, `http://127.0.0.1:${backend.port}`); assert.equal(call.cookie, 'remote_session=private');
  assert.equal((await response.json()).executionHost, 'remote');
  assert.equal((await fetch(gateway.origin, { headers: { cookie, origin: 'https://evil.example' } })).status, 403);
});
test('disconnect returns 503 and never replays a mutation when attached again', async t => {
  const backend = await fakeBackend(), gateway = await new Gateway().start();
  t.after(() => backend.close()); t.after(() => gateway.close());
  const cookie = await login(gateway); await gateway.attach(backend);
  gateway.detach(); const count = backend.calls.length;
  assert.equal((await fetch(gateway.origin + '/api/mutate', { method: 'POST', headers: { cookie }, body: 'do work' })).status, 503);
  assert.equal(backend.calls.length, count); const url = gateway.entryUrl();
  await gateway.attach(backend); assert.equal(gateway.entryUrl(), url);
  assert.equal(backend.calls.some(c => c.path === '/api/mutate'), false);
});
test('WebSocket handshake and event bytes are forwarded under remote authentication', async t => {
  const backend = await fakeBackend(), gateway = await new Gateway().start();
  t.after(() => backend.close()); t.after(() => gateway.close());
  const cookie = await login(gateway); await gateway.attach(backend);
  const data = await new Promise((resolve, reject) => {
    const req = request(gateway.origin + '/api/remote.mux', { headers: { cookie, origin: gateway.origin, connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': randomBytes(16).toString('base64') } });
    req.on('upgrade', (res, socket, head) => { socket.on('error', reject); if (head.length) { resolve(head); socket.destroy(); } else socket.once('data', bytes => { resolve(bytes); socket.destroy(); }); });
    req.setTimeout(3000, () => req.destroy(new Error('WebSocket timeout'))); req.on('error', reject); req.end();
  });
  assert.match(data.toString(), /remote-event/); assert.equal(backend.calls.at(-1).upgrade, true);
});
