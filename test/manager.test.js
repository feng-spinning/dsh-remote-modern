import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RemoteManager } from '../src/manager.js';
import { fakeBackend, until } from './helpers.js';
import { validateTarget, bootstrapCommand, sshOptions, runtimePrelude } from '../src/tunnel.js';
const emptyDiscovery = async () => ({ hosts: [], errors: [] });

test('connect pooling, stable gateway, reconnect and remote lifetime survive disconnect', async t => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-ssh-test-')), backend = await fakeBackend();
  let opened = 0, closed = 0, transportClose;
  const manager = new RemoteManager({ home, discover: emptyDiscovery, connector: async (host, options) => {
    opened++; transportClose = options.onClose; return { ...backend, close() { closed++; } };
  } });
  t.after(() => rm(home, { recursive: true, force: true })); t.after(() => backend.close()); t.after(() => manager.close());
  await manager.init(); const host = await manager.save({ target: 'research', label: '科研服务器' });
  const [first, second] = await Promise.all([manager.connect(host.id), manager.connect(host.id)]);
  await until(() => manager.status(host.id).state === 'connected');
  assert.equal(opened, 1); assert.equal(first.url, second.url);
  transportClose(); await until(() => manager.status(host.id).state === 'connected' && opened === 2);
  assert.equal((await manager.connect(host.id)).url, first.url);
  assert.equal(JSON.stringify(await manager.list()).includes('remote-secret'), false);
  await manager.disconnect(host.id); assert.equal(manager.status(host.id).state, 'disconnected'); assert.ok(closed >= 2);
  assert.equal((await fetch(`http://127.0.0.1:${backend.port}/?token=remote-secret`, { redirect: 'manual' })).status, 303);
  const restored = new RemoteManager({ home, discover: emptyDiscovery }); await restored.init(); assert.equal((await restored.list()).hosts[0].target, 'research'); await restored.close();
});
test('save transactions preserve concurrently added hosts and invalid destinations fail before spawn', async t => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-ssh-test-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const manager = new RemoteManager({ home, discover: emptyDiscovery }); await manager.init();
  await Promise.all(['a', 'b', 'c'].map(target => manager.save({ target })));
  assert.equal((await manager.list()).hosts.length, 3);
  for (const target of ['-oProxyCommand=bad', 'user@host; rm -rf /', 'host\ncommand', 'host command']) assert.throws(() => validateTarget(target));
  assert.equal(validateTarget('user@host-name'), 'user@host-name');
  await assert.rejects(manager.save({ target: 'a', port: 70000 }));
  const boot = await bootstrapCommand(); assert.match(boot.command, /sh -c/); assert.ok(Buffer.from(boot.payload.trim(), 'base64').toString().includes("VERSION = '0.2.0-rc.2'"));
  assert.ok(sshOptions({ probe: true }).includes('ClearAllForwardings=yes'));
  assert.match(runtimePrelude, /\.nvm\/versions\/node/);
});
test('disconnect cancels an in-flight SSH startup instead of leaving a process owner', async t => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-ssh-test-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  let cancelled = false;
  const manager = new RemoteManager({ home, discover: emptyDiscovery, connector: async (host, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => { cancelled = true; reject(new Error('cancelled')); }, { once: true });
  }) });
  await manager.init(); const host = await manager.save({ target: 'slow-host' }); await manager.connect(host.id);
  await manager.disconnect(host.id); await until(() => cancelled);
  assert.equal(manager.connections.size, 0);
});
