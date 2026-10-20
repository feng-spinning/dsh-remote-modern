import { RemoteManager } from './manager.js';
import { Federation } from './federation.js';
export const name = 'ssh-remote-modern';
export const inject = ['connection'];
export async function apply(ctx) {
  const manager = new RemoteManager();
  return install(ctx, manager);
}
export async function install(ctx, manager) {
  await manager.init();
  const federation = new Federation(manager, {
    async first(endpoint, args) {
      const controller = new AbortController();
      const session = ctx.get('sessionController');
      if (!session) throw new Error('本机会话服务尚未就绪');
      try {
        for await (const value of session.follow(args.request, controller.signal)) return value;
        throw new Error('本机会话没有返回历史');
      } finally { controller.abort(); }
    },
  });
  manager.expand = content => federation.expand(content);
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
        case 'action': value = await federation.action(payload); break;
        case 'readReference': value = await federation.read(payload); break;
        case 'expandReferences': value = await federation.expand(payload?.content); break;
        case 'navigate': {
          const { gateway } = await federation.gateway(payload?.id);
          gateway.navigate(payload); value = null; break;
        }
        default: throw new Error('未知的 SSH 操作');
      }
      return { ok: true, value };
    } catch (e) { return { ok: false, error: { code: 'ssh-remote', message: e.message, details: {} } }; }
  };
  for (const endpoint of ['list', 'save', 'probe', 'connect', 'disconnect', 'catalog', 'action', 'readReference', 'expandReferences', 'navigate']) {
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
