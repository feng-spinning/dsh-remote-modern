import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionReference, parseSessionReference, findSessionReferences, referenceExcerpt } from '../src/session-reference.js';
import { Federation } from '../src/federation.js';
import { integrateGuestBundle } from '../src/guest-integration.js';

const history = text => ({ type: 'snapshot', cursor: 8, hasMore: false, records: [
  { event: { type: 'user/message', seq: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } } },
  { event: { type: 'tool/result', seq: 2, data: { content: 'private tool output' } } },
  { event: { type: 'assistant/message', seq: 3, data: { content: [{ type: 'reasoning', text: 'hidden reasoning' }, { type: 'text', text: 'answer' }] } } },
] });
test('references preserve host identity, reject malformed IDs and deduplicate only exact host/session pairs', () => {
  const local = sessionReference('session-same');
  const remote = sessionReference('session-same', 'ssh:user@research');
  assert.equal(parseSessionReference(remote).hostId, 'ssh:user@research');
  assert.deepEqual(findSessionReferences(`${local}\n${remote}\n${local}.`).map(r => r.hostId), ['local', 'ssh:user@research']);
  assert.deepEqual(findSessionReferences(`读取${local}。只能使用工具，再读（${remote}），然后总结。`).map(r => r.hostId), ['local', 'ssh:user@research']);
  assert.throws(() => findSessionReferences('dsh://sessions/s?hostId=local&hostId=other'));
  for (const value of ['dsh://sessions/../../secret?hostId=local', 'https://sessions/s?hostId=local', 'dsh://sessions/s', 'dsh://sessions/s?hostId=local&hostId=other', 'dsh://user@sessions/s?hostId=local']) assert.throws(() => parseSessionReference(value));
});
test('excerpts include user/assistant text only, keep recent content and report truncation', () => {
  const value = referenceExcerpt(history('hello'), 7);
  assert.equal(value.messages.map(m => m.text).join(''), 'oanswer');
  assert.equal(value.truncated, true);
  assert.equal(JSON.stringify(value).includes('hidden reasoning'), false);
  assert.equal(JSON.stringify(value).includes('private tool output'), false);
  const raw = history('hello');
  raw.records.push({ event: { type: 'user/message', data: { source: { kind: 'skill-catalog' }, content: 'injected catalog'.repeat(5000) } } });
  raw.records[0].event.data.content.push({ type: 'text', text: '\n<dsh_session_references>\nalready expanded history' });
  assert.deepEqual(referenceExcerpt(raw).messages.map(m => m.text), ['hello', 'answer']);
});
test('cross-host reads route identical session IDs independently and unknown hosts never fall back to local', async () => {
  const calls = [];
  const manager = {
    list: async () => ({ hosts: [{ id: 'r1', target: 'research', label: 'Research' }] }),
    status: () => ({ state: 'connected', revision: 1 }),
    connections: new Map([['r1', { state: 'connected', gateway: { first: async (endpoint,args) => { calls.push(['remote',endpoint,args]); return history('remote'); } } }]]),
  };
  const federation = new Federation(manager, { first: async (endpoint,args) => { calls.push(['local',endpoint,args]); return history('local'); } });
  const local = await federation.read(sessionReference('same'));
  const remote = await federation.read(sessionReference('same','ssh:research'));
  assert.equal(local.messages[0].text, 'local');
  assert.equal(remote.messages[0].text, 'remote');
  await assert.rejects(federation.read(sessionReference('same','ssh:missing')), /未配置/);
  assert.deepEqual(calls.map(c=>c[0]), ['local','remote']);
});
test('guest integration changes only the intended module in combined bundles and rejects incompatible layouts', () => {
  const other='window.__ModuleLoader__.load({id: "other", factory:()=>{exports.apply = apply;}});\n';
  const workspace='window.__ModuleLoader__.load({id: "@deepseek-ai/dsh-client-ui-workspace", factory:()=>{exports.apply = apply;}});\n';
  const layout='window.__ModuleLoader__.load({id: "@deepseek-ai/dsh-client-ui-layout", factory:()=>{const sidebarCollapsed = false; const sidebarPreference = 280; const collapsedWidth = 56; exports.apply = apply;}});\n';
  let source=integrateGuestBundle(other+workspace+layout,'workspace');
  source=integrateGuestBundle(source,'layout');
  assert.ok(source.startsWith(other));
  assert.equal(source.match(/installGuestNavigation/g).length, 1);
  assert.match(source,/const sidebarPreference = 0;/);
  assert.throws(()=>integrateGuestBundle(other,'workspace'),/不兼容/);
  assert.throws(()=>integrateGuestBundle(layout.replace('sidebarPreference','changed'),'layout'),/结构已改变/);
});
