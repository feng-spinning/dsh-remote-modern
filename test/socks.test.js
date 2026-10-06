import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, connect } from 'node:net';
import { createSocksForward } from '../lib/socks.js';
test('SOCKS negotiates fragmented replies and forwards bytes to the declared loopback port', async t => {
  const sockets = new Set(); let destination;
  const socks = createServer(socket => {
    sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket));
    let phase = 0, bytes = Buffer.alloc(0);
    socket.on('data', chunk => {
      bytes = Buffer.concat([bytes, chunk]);
      if (phase === 0 && bytes.length >= 3) { bytes = bytes.subarray(3); phase = 1; socket.write(Buffer.from([5])); setTimeout(() => socket.write(Buffer.from([0])), 5); }
      if (phase === 1 && bytes.length >= 10) {
        destination = bytes.readUInt16BE(8); bytes = bytes.subarray(10); phase = 2;
        socket.write(Buffer.from([5, 0, 0, 1])); setTimeout(() => socket.write(Buffer.from([127, 0, 0, 1, 0, 1])), 5);
      }
      if (phase === 2 && bytes.length) { socket.write(bytes); bytes = Buffer.alloc(0); }
    });
  });
  await new Promise(resolve => socks.listen(0, '127.0.0.1', resolve));
  const forward = await createSocksForward(0, socks.address().port, 54321);
  t.after(async () => { for (const socket of [...sockets, ...forward.sockets]) socket.destroy(); await Promise.all([new Promise(resolve => socks.close(resolve)), new Promise(resolve => forward.server.close(resolve))]); });
  const echo = await new Promise((resolve, reject) => {
    const client = connect(forward.server.address().port, '127.0.0.1', () => client.write('remote bytes'));
    client.on('error', reject); client.setTimeout(3000, () => { client.destroy(); reject(new Error('timeout')); });
    client.once('data', bytes => { resolve(bytes.toString()); client.destroy(); });
  });
  assert.equal(destination, 54321); assert.equal(echo, 'remote bytes');
});
