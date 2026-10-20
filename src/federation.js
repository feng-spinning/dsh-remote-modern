import { parseSessionReference, referenceExcerpt, expandSessionReferences } from './session-reference.js';

const allowedActions = new Set(['workspace/create', 'workspace/rename', 'workspace/pinSession', 'workspace/unpinSession',
  'workspace/archiveSession', 'workspace/unarchiveSession', 'directoryPicker/list', 'session/rename']);

export class Federation {
  constructor(manager, local) { this.manager = manager; this.local = local; this.catalogs = new Map(); }
  async host(hostId) {
    const host = (await this.manager.list()).hosts.find(host => `ssh:${host.target}` === hostId || host.id === hostId);
    if (!host) throw new Error('会话引用的 SSH 主机未配置');
    return host;
  }
  async gateway(hostId, connect = false) {
    const host = await this.host(hostId);
    if (connect && this.manager.status(host.id).state !== 'connected') {
      await this.manager.connect(host.id);
      const deadline = Date.now() + 30000;
      while (this.manager.status(host.id).state !== 'connected' && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 150));
      }
    }
    const entry = this.manager.connections.get(host.id);
    if (entry?.state !== 'connected') throw new Error(`${host.label} 尚未连接，请连接后重试`);
    return { host, gateway: entry.gateway };
  }
  async catalog(id) {
    const { host, gateway } = await this.gateway(id);
    const cached = this.catalogs.get(id);
    if (cached?.pending) return cached.pending;
    if (cached?.revision === this.manager.status(host.id).revision && Date.now() - cached.time < 4000) return cached.value;
    const pending = Promise.all([gateway.first('workspace/follow', {}), gateway.call('session/list', { _request: {} })])
      .then(([frame, sessions]) => {
        if (frame.type !== 'baseline') throw new Error('远端工作区基线格式不兼容');
        const value = { ...frame.value, sessions: sessions.items.map(session => ({
          sessionId: session.sessionId, title: session.projections?.values?.title || '新会话',
          updatedAt: session.updatedAt, blank: session.blank, parentSessionId: session.parentSessionId,
          running: session.running, cwd: session.cwd, formatStatus: session.formatStatus,
        })), hostId: `ssh:${host.target}`, id: host.id, label: host.label };
        this.catalogs.set(id, { value, time: Date.now(), revision: this.manager.status(host.id).revision });
        return value;
      }).catch(error => { this.catalogs.delete(id); throw error; });
    this.catalogs.set(id, { pending });
    return pending;
  }
  async action({ hostId, endpoint, args }) {
    if (!allowedActions.has(endpoint)) throw new Error('不支持的远端工作区操作');
    const { gateway } = await this.gateway(hostId);
    const result = await gateway.call(endpoint, args);
    this.catalogs.clear();
    return result;
  }
  async read(input) {
    const ref = parseSessionReference(typeof input === 'string' ? input : input.reference);
    const maxMessages = Math.min(100, Math.max(1, Number(input?.maxMessages) || 40));
    const request = { address: { kind: 'session', sessionId: ref.sessionId }, maxMessages };
    let snapshot, label = '本地';
    if (ref.hostId === 'local') {
      snapshot = await this.local.first('session/follow', { request });
    } else {
      const remote = await this.gateway(ref.hostId, true);
      label = remote.host.label;
      snapshot = await remote.gateway.first('session/follow', { request });
    }
    if (snapshot.type !== 'snapshot') throw new Error('会话历史格式不兼容');
    return { ...ref, label, ...referenceExcerpt(snapshot) };
  }
  expand(content) { return expandSessionReferences(content, ref => this.read(ref)); }
}
