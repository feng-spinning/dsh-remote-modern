import { RemoteManager } from './manager.js';
import { Federation } from './federation.js';
import { localHistory } from './session-reader.js';
import { registerReaderTool } from './reader-tool.js';
export const name = 'ssh-remote-modern';
export const inject = ['connection', 'tools', 'sessionController'];
export async function apply(ctx) {
  const manager = new RemoteManager();
  return install(ctx, manager);
}
export async function install(ctx, manager) {
  await manager.init();
  const federation = new Federation(manager, localHistory(ctx));
  manager.read = (input, signal) => federation.readPage(input, signal);
  ctx.effect(() => registerReaderTool(ctx, (input, exec) => federation.readPage(input, exec.signal)));
  const dispatch = async (endpoint, payload) => {
    try {
      let value;
      switch (endpoint) {
        case 'list': value = await manager.list(); break;
        case 'save': value = await manager.save(payload); break;
        case 'connect': value = await manager.connect(payload?.id); break;
        case 'probe': value = await manager.probe(payload?.id); break;
        case 'disconnect': await manager.disconnect(payload?.id); value = null; break;
        case 'catalog': value = await federation.catalog(payload?.id); break;
        case 'directory': {
          const { gateway } = await federation.gateway(payload?.id, true);
          value = await gateway.call('directoryPicker/list', { path: payload?.path }); break;
        }
        case 'action': value = await federation.action(payload); break;
        case 'readReference': value = await federation.read(payload); break;
        case 'readPage': value = await federation.readPage(payload); break;
        case 'navigate': {
          const { gateway } = await federation.gateway(payload?.id);
          gateway.navigate(payload); value = null; break;
        }
        default: throw new Error('未知的 SSH 操作');
      }
      return { ok: true, value };
    } catch (e) { return { ok: false, error: e.rpcError || { code: 'ssh-remote', message: e.message, details: {} } }; }
  };
  for (const endpoint of ['list', 'save', 'probe', 'connect', 'disconnect', 'catalog', 'directory', 'action', 'readReference', 'readPage', 'navigate']) {
    ctx.effect(() => ctx.connection.fetch.register({
      path: '/api/sshRemote/' + endpoint, methods: ['POST'], requestBody: 'buffered',
      async fetch(request) {
        let message;
        try { message = await request.json(); } catch { return new Response('Invalid JSON', { status: 400 }); }
        if (message.type !== 'client-request' || typeof message.rpcId !== 'string' || message.method !== 'sshRemote/' + endpoint) return new Response('Invalid RPC envelope', { status: 400 });
        const result = await dispatch(endpoint, message.payload);
        return Response.json({ type: 'server-response', rpcId: message.rpcId, result });
      },
    }), 'ssh-remote-modern: ' + endpoint);
  }
  ctx.effect(() => () => manager.close());
}
