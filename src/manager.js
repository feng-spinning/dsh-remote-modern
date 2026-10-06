import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { discoverSshConfigHosts } from '../lib/ssh-config.js';
import { Gateway } from './gateway.js';
import { openTunnel, validateTarget, probeHost } from './tunnel.js';

export class RemoteManager {
  constructor({ home = process.env.DSH_HOME || join(homedir(), '.dsh'), connector = openTunnel, discover = discoverSshConfigHosts, sshExecutable } = {}) {
    this.directory = join(home, 'ssh-remote-modern'); this.connector = connector; this.discover = discover; this.sshExecutable = sshExecutable;
    this.connections = new Map(); this.hosts = []; this.saving = Promise.resolve(); this.disposed = false;
  }
  async init() {
    try { this.hosts = JSON.parse(await readFile(join(this.directory, 'hosts.json'), 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (!Array.isArray(this.hosts)) throw new Error('SSH 主机配置格式错误');
  }
  async list() {
    const discovered = await this.discover();
    const hosts = new Map(discovered.hosts.map(h => [h.sshTarget, { id: createHash('sha256').update(h.sshTarget).digest('hex').slice(0, 20), target: h.sshTarget, label: h.label, source: 'ssh-config' }]));
    for (const host of this.hosts) hosts.set(host.target, { ...host, source: 'saved' });
    return { hosts: [...hosts.values()].map(host => ({ ...host, ...this.status(host.id) })), warnings: discovered.errors };
  }
  status(id) {
    const entry = this.connections.get(id);
    return { state: entry?.state || 'disconnected', phase: entry?.phase || '', error: entry?.error || '', connectedAt: entry?.connectedAt || null };
  }
  async save(input) {
    const target = validateTarget(input?.target);
    const label = (input.label || target).trim().slice(0, 80);
    const port = input.port == null || input.port === '' ? undefined : Number(input.port);
    if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) throw new Error('SSH 端口应在 1–65535 之间');
    const host = { id: createHash('sha256').update(target).digest('hex').slice(0, 20), target, label, ...(port ? { port } : {}) };
    // Serialize complete read-modify-write transactions, including different hosts.
    this.saving = this.saving.catch(() => {}).then(async () => {
      const index = this.hosts.findIndex(h => h.id === host.id);
      if (index < 0) this.hosts.push(host); else this.hosts[index] = host;
      await mkdir(this.directory, { recursive: true });
      const file = join(this.directory, 'hosts.json');
      await writeFile(file + '.tmp', JSON.stringify(this.hosts, null, 2), { mode: 0o600 }); await rename(file + '.tmp', file);
    });
    await this.saving; return host;
  }
  async connect(id) {
    if (this.disposed) throw new Error('插件已停止');
    const host = (await this.list()).hosts.find(h => h.id === id);
    if (!host) throw new Error('未找到主机');
    let entry = this.connections.get(id);
    if (!entry) {
      entry = { host, gateway: await new Gateway().start(), state: 'connecting', phase: 'ssh', attempt: 0, stopped: false };
      // Recheck after asynchronous gateway allocation so simultaneous connect calls
      // converge on one owner instead of leaking a second SSH process.
      const existing = this.connections.get(id);
      if (existing) { await entry.gateway.close(); entry = existing; }
      else this.connections.set(id, entry);
    }
    if (!entry.pending && entry.state !== 'connected') this.#attempt(entry);
    return { ...this.status(id), url: entry.gateway.entryUrl(), id, label: host.label };
  }
  async probe(id) {
    const host = (await this.list()).hosts.find(h => h.id === id);
    if (!host) throw new Error('未找到主机');
    return probeHost(host, { sshExecutable: this.sshExecutable });
  }
  #attempt(entry) {
    if (entry.stopped || entry.pending) return;
    clearTimeout(entry.timer);
    entry.state = entry.connectedAt || entry.attempt ? 'reconnecting' : 'connecting'; entry.phase = 'ssh'; entry.attempt++;
    entry.controller = new AbortController();
    entry.pending = (async () => {
      let tunnel;
      try {
        tunnel = await this.connector(entry.host, {
          sshExecutable: this.sshExecutable,
          signal: entry.controller.signal,
          onProgress: phase => { entry.phase = phase; },
          onClose: () => {
            if (entry.stopped) return;
            entry.gateway.detach(); entry.tunnel?.close(); entry.tunnel = undefined;
            entry.state = 'reconnecting'; entry.phase = 'ssh';
            this.#retry(entry);
          },
        });
        if (entry.stopped) { tunnel.close(); return; }
        await entry.gateway.attach(tunnel);
        if (entry.stopped) { tunnel.close(); entry.gateway.detach(); return; }
        entry.tunnel = tunnel; entry.state = 'connected'; entry.phase = ''; entry.error = ''; entry.attempt = 0; entry.connectedAt = new Date().toISOString();
      } catch (e) {
        tunnel?.close(); entry.gateway.detach(); entry.error = e.message;
        entry.state = entry.stopped ? 'disconnected' : 'reconnecting';
        if (!entry.stopped) this.#retry(entry);
      } finally { entry.pending = undefined; }
    })();
  }
  #retry(entry) {
    if (entry.stopped || entry.timer) return;
    const cap = Math.min(10000, 500 * 2 ** Math.min(entry.attempt, 5));
    entry.timer = setTimeout(() => { entry.timer = undefined; this.#attempt(entry); }, cap * (0.5 + Math.random() * 0.5));
    entry.timer.unref?.();
  }
  async disconnect(id) {
    const entry = this.connections.get(id); if (!entry) return;
    entry.stopped = true; clearTimeout(entry.timer); entry.controller?.abort(); entry.tunnel?.close(); entry.gateway.detach();
    await entry.gateway.close(); this.connections.delete(id);
    // Closing the local transport never stops the persistent remote backend.
  }
  async close() { this.disposed = true; await Promise.all([...this.connections.keys()].map(id => this.disconnect(id))); }
}
