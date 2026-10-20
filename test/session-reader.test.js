import test from 'node:test';
import assert from 'node:assert/strict';
import { readSessionPage } from '../src/session-reader.js';
import { apply as installRemoteReader } from '../src/remote-reader.js';
import { ReaderBroker } from '../src/reader-broker.js';

const reference = 'dsh://sessions/source?hostId=local';
const user = (seq, text, kind = 'user') => ({ event: { type: 'user/message', seq, data: { source: { kind }, content: [{ type: 'text', text }] } } });

test('reader upgrade handles DSH already-installed and verifies the running revision', async () => {
  const calls = [];
  let installed = false, removed = false;
  const gateway = { async call(endpoint, args) {
    calls.push({ endpoint, args });
    if (endpoint === 'sshSessionReader/status') return { revision: installed ? 'new' : 'old' };
    if (endpoint === 'pluginManager/installBundle') {
      if (!removed) return { application: 'failed', error: { code: 'already-installed' } };
      installed = true; return { application: 'applied' };
    }
    if (endpoint === 'pluginManager/removeBundle') { removed = true; return { application: 'applied' }; }
    return [];
  } };
  const broker = new ReaderBroker(gateway, 'ssh:dahua', async () => ({}));
  try {
    await broker.start({ readerPath: '/fixture/new', readerRevision: 'new' });
    assert.deepEqual(calls.slice(0, 5).map(x => x.endpoint), [
      'sshSessionReader/status', 'pluginManager/installBundle', 'pluginManager/removeBundle',
      'pluginManager/installBundle', 'sshSessionReader/status',
    ]);
    assert.equal(calls[2].args.name, 'dsh-remote-session-reader');
    assert.ok(calls.some(x => x.endpoint === 'sshSessionReader/hello'));
  } finally { broker.close(); }
  const stale = new ReaderBroker({ call: async endpoint => endpoint === 'sshSessionReader/status' ? { revision: 'old' } : { application: 'applied' } }, 'ssh:dahua', async () => ({}));
  try { await assert.rejects(stale.start({ readerPath: '/fixture/new', readerRevision: 'new' }), /尚未加载新版本/); }
  finally { stale.close(); }
});
function historyTransport(records, rawPageSize = 25) {
  const page = before => {
    const older = records.filter(r => r.event.seq < before), selected = older.slice(-rawPageSize);
    return { records: selected, hasMore: selected.length < older.length };
  };
  return {
    first: async () => ({ type: 'snapshot', cursor: records.at(-1).event.seq, ...page(Infinity) }),
    call: async (_endpoint, { request }) => page(request.beforeSeq),
  };
}
test('reader traverses injected/tool-only pages and reconstructs long text without gaps or duplicates', async () => {
  const records = [user(0, 'oldest'), ...Array.from({ length: 80 }, (_, i) => user(i + 1, 'system', 'runtime')),
    user(81, 'x'.repeat(70000)), user(82, 'latest')];
  const transport = historyTransport(records, 10);
  let cursor, pages = [];
  do {
    const page = await readSessionPage({ reference, cursor, limit: 2 }, transport);
    pages.push(page); cursor = page.nextCursor;
    assert.ok(page.messages.reduce((n, message) => n + message.text.length, 0) <= 24000);
  } while (cursor);
  const all = pages.flatMap(page => page.messages).sort((a, b) => a.seq - b.seq || a.start - b.start);
  assert.equal(all.map(message => message.text).join(''), 'oldest' + 'x'.repeat(70000) + 'latest');
  assert.equal(pages.at(-1).hasMore, false);
  assert.ok(pages.length >= 3);
  await assert.rejects(readSessionPage({ reference: reference.replace('local', 'ssh%3Adahua'), cursor: pages[0].nextCursor }, transport), /Invalid session cursor/);
});
test('remote reader mailbox requires exact current-session authorization and never treats local as Linux', async () => {
  const routes = new Map(), cleanup = [];
  let tool;
  const ctx = {
    tools: { register: definition => { tool = definition; return () => {}; } },
    connection: { fetch: { register: definition => { routes.set(definition.path, definition.fetch); return () => {}; } } },
    sessionController: { follow: async function*() { assert.fail('local reference must use Desktop, not Linux history'); } },
    effect: fn => { cleanup.push(fn()); },
  };
  installRemoteReader(ctx);
  const key = 'a'.repeat(64);
  const call = async (method, args = {}) => {
    const result = await routes.get('/api/sshSessionReader/' + method)(new Request('http://fixture/api', {
      method: 'POST', body: JSON.stringify({ type: 'client-request', rpcId: 'r', method: 'sshSessionReader/' + method, payload: { args: { key, ...args } } }),
    }));
    return (await result.json()).result;
  };
  const exec = { agent: { session: { id: 'target' } }, signal: new AbortController().signal };
  await call('hello', { hostId: 'ssh:dahua' });
  await assert.rejects(tool.execute({ reference }, exec), /Paste/);
  await call('authorize', { sessionId: 'target', references: [reference] });
  const pending = tool.execute({ reference }, exec);
  const poll = await call('poll');
  assert.equal(poll.value[0].input.reference, reference);
  const wrong = await call('complete', { key: 'b'.repeat(64), id: poll.value[0].id, value: { messages: ['forged'] } });
  assert.equal(wrong.ok, false);
  await call('complete', { id: poll.value[0].id, value: { messages: ['actual Desktop text'] } });
  assert.deepEqual(await pending, { messages: ['actual Desktop text'] });
  await assert.rejects(tool.execute({ reference }, { ...exec, agent: { session: { id: 'other' } } }), /Paste/);
  for (const dispose of cleanup.toReversed()) dispose();
});
