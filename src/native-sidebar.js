const remoteKey = (host, id) => `ssh_${host.id}_${id}`;
function remoteIdentity(key) {
  if (typeof key !== 'string') return null;
  const host = snapshot.hosts.find(host => key.startsWith(`ssh_${host.id}_`));
  return host ? { host, id: key.slice(`ssh_${host.id}_`.length), hostId: `ssh:${host.target}` } : null;
}

function mergedWorkspaceView(workspaces, sessions, model, remoteActive) {
  const items = [...workspaces.items], byId = { ...sessions.byId }, ids = [...sessions.ids];
  const pinnedSessionIds = [...workspaces.pinnedSessionIds], archivedSessionIds = [...workspaces.archivedSessionIds];
  if (remoteActive) for (const [id, session] of Object.entries(byId))
    byId[id] = { ...session, retainedBy: { ...session.retainedBy, mainView: 0 } };
  for (const host of model.hosts) {
    const catalog = model.catalogs[host.id];
    if (!catalog) continue;
    const key = id => remoteKey(host, id);
    items.push(...catalog.items.map(workspace => ({
      ...workspace, workspaceId: key(workspace.workspaceId), sessionIds: workspace.sessionIds.map(key),
    })));
    pinnedSessionIds.push(...catalog.pinnedSessionIds.map(key));
    archivedSessionIds.push(...catalog.archivedSessionIds.map(key));
    for (const session of catalog.sessions) {
      const id = key(session.sessionId);
      ids.push(id);
      byId[id] = { ...session, id, title: session.title, displayTitle: session.title,
        origin: session.origin, parentId: session.parentSessionId && key(session.parentSessionId),
        retainedBy: { mainView: remoteActive && model.selection?.hostId === `ssh:${host.target}` && model.selection?.sessionId === session.sessionId ? 1 : 0 } };
    }
  }
  return {
    workspaces: { ...workspaces, items, pinnedSessionIds, archivedSessionIds },
    sessions: { ...sessions, ids, byId },
  };
}

// Only the host badge is added to the official workspace rows. Fonts, spacing,
// icons, menus, sorting, search, expansion and dialogs belong to DSH.
function useHostBadges(container, model) {
  useEffect(() => {
    const root = container.current;
    if (!root) return;
    const update = () => {
      for (const row of root.querySelectorAll('[data-row-key^="workspace:ssh_"]')) {
        const identity = remoteIdentity(row.getAttribute('data-row-key').slice('workspace:'.length));
        if (!identity) continue;
        let badge = row.querySelector('[data-ssh-host-badge]');
        if (!badge) {
          badge = document.createElement('span');
          badge.dataset.sshHostBadge = '';
          Object.assign(badge.style, { display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: 'var(--dsw-alias-label-secondary, #888)', flexShrink: '0', marginLeft: '6px' });
          const label = document.createElement('span'), dot = document.createElement('span');
          Object.assign(dot.style, { width: '7px', height: '7px', borderRadius: '50%', flexShrink: '0' });
          badge.append(label, dot);
          row.insertBefore(badge, row.lastElementChild);
        }
        if (badge.firstChild.textContent !== identity.host.target) badge.firstChild.textContent = identity.host.target;
        badge.lastChild.style.background = identity.host.state === 'connected' ? '#16a05b' : '#999';
        badge.title = identity.host.state === 'connected' ? 'SSH 已连接' : 'SSH 未连接';
      }
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { childList: true, subtree: true });
    return () => { observer.disconnect(); for (const badge of root.querySelectorAll('[data-ssh-host-badge]')) badge.remove(); };
  }, [container, model.hosts]);
}

function NativeWorkspaceAdapter({ Original, ...props }) {
  const model = useModel(), container = useRef(null);
  const workspaces = props.useWorkspaces(x => x), sessions = props.useSessions(x => x), panelInfo = props.usePanelInfo(x => x);
  const remoteActive = panelInfo.activePanelId === 'ssh-remote-modern';
  const merged = React.useMemo(() => mergedWorkspaceView(workspaces, sessions, model, remoteActive), [workspaces, sessions, model.catalogs, model.hosts, model.selection, remoteActive]);
  useHostBadges(container, model);
  const workspaceOperation = (method, original) => async (key, value) => {
    const remote = remoteIdentity(key);
    if (!remote) return original(key, value);
    if (method === 'insertBefore') {
      const before = remoteIdentity(value);
      if (value !== undefined && before?.host.id !== remote.host.id) return;
      return workspaceAction(remote.hostId, 'workspace/insertBefore', { workspaceId: remote.id, beforeWorkspaceId: before?.id });
    }
    return workspaceAction(remote.hostId, 'workspace/' + method, { workspaceId: remote.id, ...(method === 'rename' ? { title: value } : {}) });
  };
  return h('div', { ref: container, style: { display: 'contents' }, 'data-ssh-native-workspaces': true },
    h(Original, {
      ...props,
      requestAddWorkspace: () => emit({ workspaceChooser: { local: props.requestAddWorkspace } }),
      useWorkspaces: (select = x => x) => select(merged.workspaces),
      useSessions: (select = x => x) => select(merged.sessions),
      usePanelInfo: (select = x => x) => select(remoteActive ? { ...panelInfo, activePanelId: null } : panelInfo),
      open: key => {
        const remote = remoteIdentity(key);
        if (remote) void openRemote(remote.host, { sessionId: remote.id });
        else openLocal(key);
      },
      startSession: (key, options) => {
        const remote = remoteIdentity(key);
        if (remote) void openRemote(remote.host, { workspaceId: remote.id });
        else props.startSession(key, options);
      },
      renameWorkspace: workspaceOperation('rename', props.renameWorkspace),
      deleteWorkspace: workspaceOperation('delete', props.deleteWorkspace),
      insertWorkspaceBefore: workspaceOperation('insertBefore', props.insertWorkspaceBefore),
      searchSessions: async (query, signal) => {
        const local = await props.searchSessions(query, signal);
        const remotes = await Promise.all(model.hosts.filter(host => host.state === 'connected').map(async host => {
          let result;
          try { result = await call('action', { hostId: 'ssh:' + host.target, endpoint: 'session/search', args: { request: { query } } }); }
          catch (error) {
            // DSH deployments may disable their full-text index. The native
            // component still searches the merged titles and workspace labels.
            if (error.message.includes('session search is disabled')) return { items: [], hasMore: false };
            throw error;
          }
          return { ...result, items: result.items.map(item => ({ ...item, sessionId: remoteKey(host, item.sessionId) })) };
        }));
        return { ...local, items: [...local.items, ...remotes.flatMap(result => result.items)], hasMore: local.hasMore || remotes.some(result => result.hasMore) };
      },
    }),
    model.error && h('div', { role: 'alert', style: { fontSize: 12, padding: 8, color: '#bd553a' } }, model.error));
}

function installNativeSidebar(ctx) {
  // DSH permits only one declaration of each child slot. Decorate the existing
  // component seat so its store, child authority and lifecycle stay intact.
  const installed = new Map();
  const watch = (name, decorate, id) => {
    ctx.effect(() => {
      let restore;
      const invalidate = base => {
        // A transient, unelected entry uses the public registry notification.
        // It declares no children and is removed before React can mount it.
        const dispose = ctx.slots.register({ name, ...base.options, priority: 10000 }, () => null);
        dispose();
      };
      const sync = () => {
        const base = ctx.slots.entries(name).find(entry => entry.options.priority !== 10000 && (id === undefined || entry.options.id === id));
        if (!base || installed.get(name + '/' + id) === base) return;
        restore?.(); installed.set(name + '/' + id, base);
        const original = base.component, decorated = decorate(original);
        base.component = decorated;
        restore = () => { if (base.component === decorated) base.component = original; };
        invalidate(base);
      };
      const unsubscribe = ctx.slots.subscribe(name, sync);
      sync();
      return () => {
        unsubscribe(); restore?.();
        const base = installed.get(name + '/' + id);
        if (base && ctx.slots.entries(name).includes(base)) invalidate(base);
      };
    });
  };
  watch('sidebar.workspaces', Original => props => h(NativeWorkspaceAdapter, { ...props, Original }));
  for (const name of ['sidebar.workspaces.session.menu.item', 'sidebar.workspaces.session.row.action']) {
    for (const id of name.endsWith('menu.item') ? ['pin', 'archive', 'fork', 'session-id'] : ['pin', 'archive']) {
      watch(name, Original => function NativeSessionAction(props) {
        const model = useModel();
        const remote = remoteIdentity(props.sessionId);
        const catalog = remote && model.catalogs[remote.host.id];
        const overrides = {
          copySessionId: key => { const r = remoteIdentity(key); return copyReference(r?.id || key, r?.hostId || 'local'); },
        };
        if (remote && catalog) {
          overrides.usePinned = select => select(new Set(catalog.pinnedSessionIds.map(id => remoteKey(remote.host, id))));
          overrides.useArchived = select => select(new Set(catalog.archivedSessionIds.map(id => remoteKey(remote.host, id))));
          overrides.useSessionAccess = () => remote.host.state === 'connected';
        }
        return h(Original, { ...props, ...overrides });
      }, id);
    }
  }
  watch('shell.overlay', Original => props => h(Original, { ...props, renameSession: async (key, title) => {
    const remote = remoteIdentity(key);
    return remote ? workspaceAction(remote.hostId, 'session/rename', { sessionId: remote.id, title }) : props.renameSession(key, title);
  } }), 'workspace.session-rename');
  for (const method of ['archiveSession', 'unarchiveSession', 'pinSession', 'unpinSession']) {
    patchClientMethod(ctx, ctx.uiWorkspace, method, original => async function(key, options) {
      const remote = remoteIdentity(key);
      if (!remote) return original.call(this, key, options);
      try {
        return await workspaceAction(remote.hostId, 'workspace/' + method, { sessionId: remote.id, ...options });
      } catch (error) {
        if (method === 'archiveSession') { error.name = 'WorkspaceArchiveError'; }
        throw error;
      }
    });
  }
  patchClientMethod(ctx, ctx.uiWorkspace, 'forkSession', original => async function(key, onCreated, options) {
    const remote = remoteIdentity(key);
    if (!remote) return original.call(this, key, onCreated, options);
    const result = await workspaceAction(remote.hostId, 'session/fork', { sessionId: remote.id, increaseTitle: true, ...options });
    await openRemote(remote.host, { sessionId: result.sessionId });
    onCreated?.(remoteKey(remote.host, result.sessionId));
    return result;
  });
}
