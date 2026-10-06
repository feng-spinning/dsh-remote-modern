import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { randomBytes } from 'node:crypto';
import { Gateway } from '../src/gateway.js';
import { fakeBackend, login } from './helpers.js';

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
