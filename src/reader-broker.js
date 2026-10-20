import { randomBytes } from 'node:crypto';
import { findSessionReferences } from './session-reference.js';

// Desktop carries a narrow, read-only mailbox over the already-authenticated
// SSH channel. No reverse port, local credential or general RPC is exposed.
export class ReaderBroker {
  constructor(gateway, hostId, read) {
    this.gateway = gateway; this.hostId = hostId; this.read = read;
    this.key = randomBytes(32).toString('hex'); this.controller = new AbortController();
  }
  call(method, args = {}, signal = this.controller.signal) {
    return this.gateway.call('sshSessionReader/' + method, { ...args, key: this.key }, signal);
  }
  async start(endpoint) {
    let status;
    try { status = await this.gateway.call('sshSessionReader/status', {}, this.controller.signal); } catch { /* First connection installs the companion. */ }
    if (status?.revision !== endpoint.readerRevision) {
      const install = () => this.gateway.call('pluginManager/installBundle', {
          spec: endpoint.readerPath, options: { enabled: true, requestId: crypto.randomUUID() },
        }, AbortSignal.any([this.controller.signal, AbortSignal.timeout(120000)]));
      let result = await install();
      // DSH rc.2 requires removing an existing directory-installed bundle
      // before replacing it. Only this connector's companion is touched.
      if (result.error?.code === 'already-installed') {
        const removed = await this.gateway.call('pluginManager/removeBundle', { name: 'dsh-remote-session-reader' },
          AbortSignal.any([this.controller.signal, AbortSignal.timeout(120000)]));
        if (removed.error || removed.application === 'failed') throw new Error('无法更新远端会话读取组件：' + (removed.error?.code || 'remove failed'));
        result = await install();
      }
      if (result.error || result.application === 'failed') throw new Error('无法安装远端会话读取组件：' + (result.error?.diagnostic || result.error?.code || 'install failed'));
      status = await this.gateway.call('sshSessionReader/status', {}, this.controller.signal);
      if (status?.revision !== endpoint.readerRevision) throw new Error('远端会话读取组件尚未加载新版本，请重新连接。');
    }
    await this.call('hello', { hostId: this.hostId });
    this.pump();
  }
  async authorize(request) {
    const references = findSessionReferences(request.content?.filter(p => p.type === 'text').map(p => p.text).join('\n')).map(ref => ref.reference);
    if (references.length) await this.call('authorize', { sessionId: request.sessionId, references });
  }
  async pump() {
    if (this.controller.signal.aborted) return;
    try {
      const requests = await this.call('poll');
      await Promise.all(requests.map(async request => {
        let value, error;
        try { value = await this.read(request.input, this.controller.signal); }
        catch (reason) { error = reason.message; }
        await this.call('complete', { id: request.id, ...(error ? { error } : { value }) });
      }));
    } catch { /* A disconnected gateway fails closed; reconnect creates a new broker. */ }
    if (!this.controller.signal.aborted) this.timer = setTimeout(() => this.pump(), 1000);
  }
  close() { this.controller.abort(); clearTimeout(this.timer); }
}
