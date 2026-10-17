import { createServer, request as httpRequest } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';

const constantEqual = (a, b) => {
  if (typeof a !== 'string') return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
const cookieValue = (cookie, name) => (cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(name + '='))?.slice(name.length + 1);
const HOP_HEADERS = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'];
export class Gateway {
  #secret = randomBytes(32).toString('hex');
  #cookieName = 'dsh_ssh_' + randomBytes(6).toString('hex');
  #remoteCookie = '';
  #upstream;
  #sockets = new Set();
  constructor() {
    this.server = createServer((req, res) => this.#handle(req, res));
    this.server.on('connection', socket => { this.#sockets.add(socket); socket.once('close', () => this.#sockets.delete(socket)); });
    this.server.on('upgrade', (req, socket, head) => this.#upgrade(req, socket, head));
  }
  async start() {
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(0, '127.0.0.1', resolve); });
    this.origin = `http://127.0.0.1:${this.server.address().port}`;
    return this;
  }
  entryUrl() { return `${this.origin}/?sshAuth=${this.#secret}`; }
  async attach(tunnel) {
    const upstream = { port: tunnel.port, authority: `127.0.0.1:${tunnel.endpoint.port}` };
    const cookies = await new Promise((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port: upstream.port, method: 'GET', path: '/?token=' + encodeURIComponent(tunnel.endpoint.token), headers: { host: upstream.authority } }, res => {
        res.resume();
        if (![302, 303].includes(res.statusCode) || !res.headers['set-cookie']?.length) { reject(new Error(`远端 dsh 浏览器认证未完成 (HTTP ${res.statusCode})`)); return; }
        resolve(res.headers['set-cookie'].map(c => c.split(';')[0]).join('; '));
      });
      req.setTimeout(15000, () => req.destroy(new Error('远端认证超时'))); req.on('error', reject); req.end();
    });
    this.#remoteCookie = cookies;
    this.#upstream = upstream;
  }
  detach() { this.#upstream = undefined; this.#remoteCookie = ''; }
  #trusted(req) {
    return req.headers.host === new URL(this.origin).host && (!req.headers.origin || req.headers.origin === this.origin) && req.headers['sec-fetch-site'] !== 'cross-site';
  }
  #authorized(req) { return this.#trusted(req) && constantEqual(cookieValue(req.headers.cookie, this.#cookieName), this.#secret); }
  #headers(req, upgrade = false) {
    const headers = { ...req.headers, host: this.#upstream.authority, cookie: this.#remoteCookie };
    if (headers.origin) headers.origin = 'http://' + this.#upstream.authority;
    delete headers.authorization;
    if (!upgrade) for (const key of HOP_HEADERS) delete headers[key];
    return headers;
  }
  #handle(req, res) {
    const url = new URL(req.url, this.origin);
    if (req.method === 'GET' && url.pathname === '/' && constantEqual(url.searchParams.get('sshAuth'), this.#secret) && this.#trusted(req)) {
      res.writeHead(302, { location: '/', 'set-cookie': `${this.#cookieName}=${this.#secret}; Path=/; HttpOnly; SameSite=Strict`, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }); res.end(); return;
    }
    if (!this.#authorized(req)) { res.writeHead(403); res.end('SSH gateway authentication required'); return; }
    if (!this.#upstream) { res.writeHead(503, { 'retry-after': '2' }); res.end('SSH disconnected; reconnecting. No local execution fallback.'); return; }
    const upstream = this.#upstream;
    const proxy = httpRequest({ host: '127.0.0.1', port: upstream.port, path: req.url, method: req.method, headers: this.#headers(req) }, remote => {
      const headers = { ...remote.headers, 'referrer-policy': 'no-referrer' };
      delete headers['set-cookie'];
      for (const key of HOP_HEADERS) delete headers[key];
      if (headers.location?.startsWith('http://' + upstream.authority)) headers.location = headers.location.replace('http://' + upstream.authority, this.origin);
      res.writeHead(remote.statusCode, headers); remote.pipe(res);
    });
    proxy.on('error', () => { if (!res.headersSent) { res.writeHead(502); res.end('SSH upstream unavailable'); } else res.destroy(); });
    req.on('aborted', () => proxy.destroy()); res.on('close', () => { if (!res.writableFinished) proxy.destroy(); });
    req.pipe(proxy);
  }
  #upgrade(req, socket, head) {
    // The browser can reset an upgraded socket before the upstream handshake
    // finishes (especially during SSH replacement). Handle errors immediately.
    socket.on('error', () => socket.destroy());
    if (!this.#authorized(req) || !this.#upstream) { socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); return; }
    const proxy = httpRequest({ host: '127.0.0.1', port: this.#upstream.port, path: req.url, method: 'GET', headers: this.#headers(req, true) });
    socket.once('close', () => proxy.destroy());
    proxy.on('upgrade', (res, remote, remoteHead) => {
      this.#sockets.add(remote); remote.once('close', () => this.#sockets.delete(remote));
      socket.write(`HTTP/1.1 ${res.statusCode} ${res.statusMessage}\r\n`);
      for (const [key, value] of Object.entries(res.headers)) if (key !== 'set-cookie') socket.write(`${key}: ${value}\r\n`);
      socket.write('\r\n'); if (remoteHead.length) socket.write(remoteHead); if (head.length) remote.write(head);
      remote.on('error', () => socket.destroy()); socket.on('error', () => remote.destroy());
      remote.on('close', () => socket.destroy()); socket.on('close', () => remote.destroy());
      socket.pipe(remote); remote.pipe(socket);
    });
    proxy.on('response', res => { res.resume(); socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n'); });
    proxy.on('error', () => socket.destroy()); proxy.end();
  }
  async close() { this.detach(); for (const socket of this.#sockets) socket.destroy(); await new Promise(resolve => this.server.close(resolve)); }
}
