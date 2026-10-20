import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('native sidebar reuses DSH component/store, merges host identities, preserves prompt text and restores methods on unload', async () => {
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  let plugin, activePanel = null;
  const entries = [], cleanup = [], calls = [];
  const nativeComponent = () => null;
  const nativeStore = { create: () => ({}) };
  const originals = [{ component: nativeComponent, options: {}, store: nativeStore, locale: 'workspace', children: { 'sidebar.workspaces.session.menu.item': { kind: 'list', scope: 'root' } } }];
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: value => [typeof value === 'function' ? value() : value, () => {}], useEffect: () => {}, useRef: () => ({ current: null }),
    useMemo: fn => fn(), useSyncExternalStore: (subscribe, get) => { const dispose = subscribe(() => {}); dispose(); return get(); },
  };
  const navigation = Object.create(Object.fromEntries(['startSession', 'forkSession', 'archiveSession', 'unarchiveSession', 'pinSession', 'unpinSession']
    .map(name => [name, function(...args) { calls.push({ endpoint: name, args }); }])));
  const ctx = {
    uiWorkspace: new Proxy(navigation, { get: (target, key, receiver) => typeof target[key] === 'function' ? target[key].bind(receiver) : target[key] }),
    layout: { panelInfo: { getSnapshot: () => ({ activePanelId: activePanel }) } },
    slots: {
      entries: name => name === 'sidebar.workspaces' ? originals : [], subscribe: () => () => {},
      inject: (_name, register) => register(), register: (options, component) => {
        assert.equal(options.children, undefined, 'must not redeclare native child slots');
        const entry = { options, component }; entries.push(entry); return () => entries.splice(entries.indexOf(entry), 1);
      },
      onEntryError: () => () => {},
    },
    effect: fn => { const dispose = fn(); if (dispose) cleanup.push(dispose); },
    on: () => assert.fail('Cordis lifecycle must use effect disposers'),
    connection: { rpc: { async call(_channel, endpoint, payload) {
      calls.push({ endpoint, payload });
      if (endpoint === 'sshRemote/list') return { ok: true, value: { hosts: [{ id: 'r1', target: 'dahua', state: 'connected' }], warnings: [] } };
      if (endpoint === 'sshRemote/catalog') return { ok: true, value: {
        items: [{ workspaceId: 'w1', title: 'Remote folder', path: '/tpu', sessionIds: ['same'] }],
        sessions: [{ sessionId: 'same', title: 'Remote session', updatedAt: 1 }], pinnedSessionIds: [], archivedSessionIds: [],
      } };
      if (endpoint === 'sshRemote/action' && payload.endpoint === 'session/search') return { ok: false, error: { message: 'session search is disabled: openAt never' } };
      return { ok: true, value: {} };
    } } },
  };
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: module => { plugin = module.factory(name => name === 'react' ? React : { writeClipboard: async () => true }); } } },
    React, URL, localStorage: { getItem: () => null, setItem: () => {} }, setInterval: () => 1, clearInterval: () => {}, setTimeout: () => 1,
  });
  const originalRpc = ctx.connection.rpc.call, originalStart = Object.getPrototypeOf(navigation).startSession;
  for (let cycle = 0; cycle < 2; cycle++) {
    plugin.apply(ctx);
    await new Promise(resolve => setImmediate(resolve));
    const entry = originals[0];
    assert.equal(entry.store, nativeStore);
    assert.equal(entry.locale, 'workspace');
    const wrapper = entry.component({
      useWorkspaces: select => select({ items: [{ workspaceId: 'w1', title: 'Local folder', sessionIds: ['same'] }], pinnedSessionIds: [], archivedSessionIds: [] }),
      useSessions: select => select({ ids: ['same'], byId: { same: { id: 'same', title: 'Local session', retainedBy: {} } } }),
      usePanelInfo: select => select({ activePanelId: activePanel }),
      searchSessions: async () => ({ items: [{ sessionId: 'same' }], hasMore: false }),
    });
    const rendered = wrapper.type(wrapper.props), native = rendered.children[0];
    assert.equal(native.type, nativeComponent);
    const workspaces = native.props.useWorkspaces();
    assert.deepEqual(Array.from(workspaces.items, item => item.workspaceId), ['w1', 'ssh_r1_w1']);
    assert.equal(native.props.useSessions().byId.same.title, 'Local session');
    assert.equal(native.props.useSessions().byId.ssh_r1_same.title, 'Remote session');
    assert.equal((await native.props.searchSessions('session')).items[0].sessionId, 'same');
    const payload = { args: { request: { content: [{ type: 'text', text: 'Read dsh://sessions/s?hostId=local' }] } } };
    await ctx.connection.rpc.call('/api', 'session/prompt', payload);
    assert.equal(ctx.connection.rpc.call, originalRpc);
    assert.equal(payload.args.request.content.length, 1);
    activePanel = 'ssh-remote-modern';
    const before = calls.filter(call => call.endpoint === 'startSession').length;
    ctx.uiWorkspace.startSession();
    assert.equal(calls.filter(call => call.endpoint === 'startSession').length, before);
    for (const dispose of cleanup.toReversed()) dispose();
    assert.equal(entry.component, nativeComponent);
    cleanup.length = 0; activePanel = null;
    assert.equal(Object.hasOwn(navigation, 'startSession'), false);
    assert.equal(Object.getPrototypeOf(navigation).startSession, originalStart);
  }
});
