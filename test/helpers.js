import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function until(fn, timeout = 4000) {
  const deadline = Date.now() + timeout;
  while (!(await fn())) { if (Date.now() > deadline) throw new Error('Condition timed out'); await sleep(10); }
}
export async function fakeBackend() {
  const calls = [];
  const server = createServer((req, res) => {
    calls.push({ path: req.url, cookie: req.headers.cookie, host: req.headers.host, origin: req.headers.origin, method: req.method });
    if (req.url === '/?token=remote-secret') { res.writeHead(303, { location: './', 'set-cookie': 'remote_session=private; HttpOnly; SameSite=Strict' }); res.end(); }
    else if (req.headers.cookie !== 'remote_session=private') { res.writeHead(401); res.end('unauthorized'); }
    else { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ executionHost: 'remote', path: req.url })); }
  });
  const sockets = new Set();
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.on('upgrade', (req, socket) => {
    calls.push({ path: req.url, cookie: req.headers.cookie, host: req.headers.host, origin: req.headers.origin, upgrade: true });
    if (req.headers.cookie !== 'remote_session=private') { socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n'); return; }
    const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const payload = Buffer.from('remote-event'); socket.write(Buffer.concat([Buffer.from([0x81, payload.length]), payload]));
    socket.on('data', () => {});
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return { calls, port, endpoint: { port, token: 'remote-secret', version: '0.2.0-rc.2' }, async close() { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); } };
}
export async function login(gateway) {
  const result = await fetch(gateway.entryUrl(), { redirect: 'manual' });
  return result.headers.get('set-cookie').split(';')[0];
}
