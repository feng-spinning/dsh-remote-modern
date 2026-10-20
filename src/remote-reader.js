import { randomUUID } from 'node:crypto';
import { readSessionPage, localHistory } from './session-reader.js';
import { parseSessionReference } from './session-reference.js';
import { registerReaderTool } from './reader-tool.js';

export const name = 'ssh-session-reader';
export const inject = ['connection', 'tools', 'sessionController'];
export const readerRevision = 'development';
export function apply(ctx) {
  const brokers = new Map(), grants = new Map(), pending = new Map();
  const local = localHistory(ctx);
  function broker(key) {
    const value = brokers.get(key);
    if (!value || Date.now() - value.seen > 30000) throw new Error('Desktop session reader is disconnected. Reconnect SSH in Desktop.');
    return value;
  }
  async function dispatch(method, args) {
    if (method === 'status') return { version: 1, revision: readerRevision };
    if (method === 'hello') {
      if (!/^[a-f0-9]{64}$/.test(args.key) || !args.hostId?.startsWith('ssh:')) throw new Error('Invalid reader registration');
      const old = brokers.get(args.key);
      brokers.set(args.key, { ...old, seen: Date.now(), hostId: args.hostId });
      return { version: 1 };
    }
    const owner = broker(args.key);
    owner.seen = Date.now();
    if (method === 'authorize') {
      const references = args.references.map(value => parseSessionReference(value).reference);
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(args.sessionId) || references.length > 20) throw new Error('Invalid session reader authorization');
      const previous = grants.get(args.sessionId);
      grants.set(args.sessionId, { key: args.key, references: new Set([
        ...(previous?.key === args.key ? previous.references : []), ...references,
      ]) });
      return null;
    }
    if (method === 'poll') return [...pending.values()].filter(item => item.key === args.key && !item.delivered).map(item => {
      item.delivered = true;
      return { id: item.id, input: item.input };
    });
    if (method === 'complete') {
      const item = pending.get(args.id);
      if (!item || item.key !== args.key) return null;
      item.finish(args.error ? new Error(args.error) : null, args.value);
      return null;
    }
    throw new Error('Unknown reader operation');
  }
  for (const method of ['status', 'hello', 'authorize', 'poll', 'complete']) ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/sshSessionReader/' + method, methods: ['POST'], requestBody: 'buffered',
    async fetch(request) {
      const message = await request.json();
      if (message.type !== 'client-request' || message.method !== 'sshSessionReader/' + method) return new Response('Invalid RPC', { status: 400 });
      let result;
      try { result = { ok: true, value: await dispatch(method, message.payload?.args || {}) }; }
      catch (error) { result = { ok: false, error: { code: 'ssh-reader', message: error.message, details: {} } }; }
      return Response.json({ type: 'server-response', rpcId: message.rpcId, result });
    },
  }));
  ctx.effect(() => registerReaderTool(ctx, async (input, exec) => {
    const reference = parseSessionReference(input.reference);
    const grant = grants.get(exec.agent?.session.id);
    // "local" always means the Desktop origin, never the Linux backend.
    if (reference.hostId !== 'local' && [...brokers.values()].some(b => b.hostId === reference.hostId))
      return readSessionPage(input, local, exec.signal);
    if (!grant?.references.has(reference.reference)) throw new Error('Paste this complete session link in the current Desktop conversation before reading it.');
    broker(grant.key);
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const finish = (error, value) => {
        clearTimeout(timer); exec.signal.removeEventListener('abort', abort); pending.delete(id);
        error ? reject(error) : resolve(value);
      };
      const abort = () => finish(new Error('Session read cancelled'));
      const timer = setTimeout(() => finish(new Error('Desktop session reader timed out. Reconnect SSH and retry.')), 30000);
      pending.set(id, { id, key: grant.key, input, finish, delivered: false });
      exec.signal.addEventListener('abort', abort, { once: true });
      if (exec.signal.aborted) abort();
    });
  }));
  ctx.effect(() => () => {
    for (const item of pending.values()) item.finish(new Error('Session reader unloaded'));
    brokers.clear(); grants.clear();
  });
}
