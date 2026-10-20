let uiContext;
let writeHostClipboard;
let localWorkspaces, localSessions;
let refreshingCatalogs = false;
const rowStyle = { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, width: '100%', border: 0, borderRadius: 10, padding: '9px 10px', background: 'transparent', color: 'inherit', cursor: 'pointer', font: 'inherit', textAlign: 'left' };
const ellipsis = { minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const storageKey = 'dsh-remote-modern:workspaces:v2';
const foldedKey = 'dsh-remote-modern:folded:v1';
function readFolded() {
  try { return JSON.parse(localStorage.getItem(foldedKey) || '{}'); } catch { return {}; }
}
function patchClientMethod(ctx, service, name, wrap) {
  const own = Object.getOwnPropertyDescriptor(service, name);
  let owner = service, descriptor;
  while (owner && !(descriptor = Object.getOwnPropertyDescriptor(owner, name))) owner = Object.getPrototypeOf(owner);
  // Cordis wraps service method reads with a context-bound Proxy. Capture the
  // raw descriptor instead, so restoring it cannot retain a disposed context.
  const wrapped = wrap(descriptor.value);
  ctx.effect(() => {
    Object.defineProperty(service, name, { configurable: true, writable: true, value: wrapped, enumerable: own?.enumerable ?? false });
    return () => {
      if (Object.getOwnPropertyDescriptor(service, name)?.value !== wrapped) return;
      if (own) Object.defineProperty(service, name, own);
      else Reflect.deleteProperty(service, name);
    };
  });
}
function rememberCatalogs() {
  try { localStorage.setItem(storageKey, JSON.stringify(snapshot.catalogs || {})); } catch { /* Storage may be unavailable in private browsers. */ }
}
async function refreshCatalogs() {
  if (refreshingCatalogs) return;
  refreshingCatalogs = true;
  try {
    const results = await Promise.allSettled(snapshot.hosts.filter(host => host.state === 'connected').map(async host => [host.id, await call('catalog', { id: host.id })]));
    const catalogs = { ...snapshot.catalogs };
    for (const result of results) {
      if (result.status === 'fulfilled') catalogs[result.value[0]] = result.value[1];
      else emit({ error: result.reason.message });
    }
    emit({ catalogs }); rememberCatalogs();
  } finally { refreshingCatalogs = false; }
}
function FolderIcon({ remote }) {
  return h('span', { style: { display: 'inline-flex', position: 'relative', flexShrink: 0 } },
    h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': true },
      h('path', { d: 'M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v2M3 7h17a1 1 0 0 1 1 1l-2 11H3L2 9a2 2 0 0 1 1-2Z' })),
    remote && h('span', { style: { position: 'absolute', right: -2, bottom: -3, color: '#089cbd', fontSize: 10, lineHeight: 1 } }, '⊕'));
}
async function copyReference(sessionId, hostId) {
  const text = sessionReference(sessionId, hostId);
  let copied = false;
  try {
    // Always run in the Desktop top document, outside the isolated guest.
    copied = writeHostClipboard ? await writeHostClipboard(text) : false;
    if (!copied && navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); copied = true; }
  } catch { /* A manual copy field is still available below. */ }
  if (copied) {
    emit({ notice: '会话链接已复制', manualCopy: null });
    setTimeout(() => emit({ notice: '' }), 2500);
  } else emit({ manualCopy: text, error: '' });
}
async function openRemote(host, target = {}) {
  emit({ error: '', selection: { hostId: `ssh:${host.target}`, ...target } });
  try {
    const active = await call('connect', { id: host.id });
    emit({ active: { ...active, ready: active.state === 'connected', target }, remoteVisible: true, picker: false });
    uiContext.layout.selectPanel('ssh-remote-modern');
    if (active.state === 'connected') await call('navigate', { id: host.id, ...target });
    await refresh();
  } catch (error) { emit({ error: error.message }); }
}
function openLocal(sessionId, workspaceId) {
  emit({ remoteVisible: false, selection: { hostId: 'local', sessionId, workspaceId }, error: '' });
  if (sessionId) uiContext.uiWorkspace.openSession(sessionId);
  else void uiContext.uiWorkspace.openWorkspace(workspaceId, undefined, { agentPreset: undefined }).catch(error => emit({ error: error.message }));
}
async function workspaceAction(hostId, endpoint, request) {
  if (hostId === 'local') {
    const [namespace, method] = endpoint.split('/');
    const result = await uiContext.remote[namespace][method](request);
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  }
  const result = await call('action', { hostId, endpoint, args: { request } });
  await refreshCatalogs();
  return result;
}
function UnifiedWorkspaces() {
  const model = useModel();
  const local = useSyncExternalStore(localWorkspaces.subscribe, localWorkspaces.getSnapshot);
  const sessions = useSyncExternalStore(localSessions.subscribe, localSessions.getSnapshot);
  const [collapsed, setCollapsed] = useState(readFolded);
  const [expanded, setExpanded] = useState({});
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [menu, setMenu] = useState(null);
  useEffect(() => {
    if (!menu) return;
    const close = event => { if (!event.target.closest?.('[data-ssh-session-menu]')) setMenu(null); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menu]);
  const localCatalog = { ...local, sessions: Object.values(sessions.byId || {}).map(s => ({
    ...s, sessionId: s.sessionId || s.id, title: s.displayTitle,
  })), hostId: 'local', label: '本地' };
  const groups = [localCatalog, ...model.hosts.filter(host => model.catalogs?.[host.id]).map(host => ({
    ...model.catalogs[host.id], host, hostId: `ssh:${host.target}`, label: host.label,
  }))];
  const action = async (fn) => { setMenu(null); try { await fn(); } catch (error) { emit({ error: error.message }); } };
  return h('div', { 'data-ssh-unified-workspaces': true, style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', fontSize: 14 } },
    h('div', { style: { display: 'flex', alignItems: 'center', padding: '12px 10px 6px', gap: 6 } },
      h('span', { style: { flex: 1, fontSize: 12, opacity: 0.6 } }, '工作区'),
      h('button', { style: { ...button, border: 0, padding: 4 }, title: showArchived ? '显示普通会话' : '显示归档会话', 'aria-label': '切换归档会话', onClick: () => setShowArchived(x => !x) }, showArchived ? '▣' : '☷'),
      h('button', { style: { ...button, border: 0, padding: 4 }, title: '添加工作区', 'aria-label': '添加工作区', onClick: () => emit({ directory: { hostId: 'local', path: '', entries: [] } }) }, '+')),
    h('input', { 'aria-label': '筛选工作区和会话', placeholder: '搜索工作区和会话', value: query, onChange: e => setQuery(e.target.value), style: { ...inputStyle, width: 'calc(100% - 16px)', margin: '0 8px 6px', padding: '6px 9px', fontSize: 12, borderColor: '#9992' } }),
    h('div', { style: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 5px' } },
      groups.map(group => {
        const hostId = group.hostId;
        const byId = Object.fromEntries((group.sessions || []).map(s => [s.sessionId, s]));
        const assigned = new Set(group.items.flatMap(w => w.sessionIds));
        const items = [...group.items];
        const ungrouped = (group.sessions || []).filter(s => !s.blank && !s.parentSessionId && !assigned.has(s.sessionId)).map(s => s.sessionId);
        if (ungrouped.length) items.push({ workspaceId: '_ungrouped', title: '未分组', sessionIds: ungrouped });
        return items.map(workspace => {
          const key = hostId + '/' + workspace.workspaceId;
          let rows = workspace.sessionIds.map(id => byId[id]).filter(s => s && !s.blank && !s.parentSessionId
            && (showArchived === (group.archivedSessionIds || []).includes(s.sessionId)));
          const title = workspace.title || workspace.path?.split(/[\\/]/).filter(Boolean).at(-1) || '工作区';
          if (query && !title.toLowerCase().includes(query.toLowerCase())) rows = rows.filter(s => sessionTitle(s).toLowerCase().includes(query.toLowerCase()));
          if (query && !rows.length && !title.toLowerCase().includes(query.toLowerCase())) return null;
          const pinned = new Set(group.pinnedSessionIds);
          rows.sort((a, b) => Number(pinned.has(b.sessionId)) - Number(pinned.has(a.sessionId)) || b.updatedAt - a.updatedAt);
          const opened = collapsed[key] === false || !!query;
          const visible = expanded[key] || query ? rows : rows.slice(0, 5);
          return h('div', { key, style: { marginBottom: 5 } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 1 } },
              h('button', { style: rowStyle, title: `${workspace.path || title}${group.host ? ' · ' + group.label : ''}`, 'aria-expanded': opened,
                onClick: () => setCollapsed(old => {
                  const next = { ...old, [key]: old[key] === false };
                  try { localStorage.setItem(foldedKey, JSON.stringify(next)); } catch { /* Optional UI preference. */ }
                  return next;
                }),
                onDoubleClick: () => workspace.workspaceId !== '_ungrouped' && (group.host ? void openRemote(group.host, { workspaceId: workspace.workspaceId }) : openLocal(null, workspace.workspaceId)) },
                h('span', { style: { fontSize: 10, opacity: 0.5 } }, opened ? '▾' : '▸'),
                h(FolderIcon, { remote: !!group.host }), h('span', { style: ellipsis }, title),
                group.host && h('span', { style: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, opacity: 0.7 } }, group.label, h(Dot, { state: group.host.state }))),
              workspace.workspaceId !== '_ungrouped' && h('button', { style: { ...button, border: 0, padding: '4px 6px', opacity: 0.6 }, title: `${title} 新会话`, 'aria-label': `${title} 新会话`, onClick: () => group.host ? void openRemote(group.host, { workspaceId: workspace.workspaceId }) : openLocal(null, workspace.workspaceId) }, '+')),
            opened && visible.map(session => {
              const selected = model.selection?.hostId === hostId && model.selection?.sessionId === session.sessionId;
              const sessionKey = hostId + '/' + session.sessionId;
              return h('div', { key: session.sessionId, style: { position: 'relative' } },
                h('div', { style: { display: 'flex', alignItems: 'center', borderRadius: 10, background: selected ? 'var(--dsw-alias-interactive-bg-hover, #9992)' : 'transparent' } },
                  h('button', { style: { ...rowStyle, paddingLeft: 27, fontSize: 13 }, title: sessionTitle(session),
                    onClick: () => group.host ? void openRemote(group.host, { sessionId: session.sessionId, workspaceId: workspace.workspaceId }) : openLocal(session.sessionId, workspace.workspaceId),
                    onContextMenu: e => { e.preventDefault(); setMenu(sessionKey); } },
                    h('span', { style: ellipsis }, pinned.has(session.sessionId) ? '· ' + sessionTitle(session) : sessionTitle(session)),
                    session.running && h('span', { title: '运行中', style: { color: '#16a05b' } }, '●')),
                  h('button', { 'aria-label': `${sessionTitle(session)} 会话菜单`, 'data-ssh-session-menu': true, style: { ...button, border: 0, padding: '4px 7px', opacity: 0.6 }, onClick: () => setMenu(menu === sessionKey ? null : sessionKey) }, '···')),
                menu === sessionKey && h('div', { 'data-ssh-session-menu': true, role: 'menu', style: { padding: 5, margin: '2px 4px 6px 24px', border: '1px solid #9993', borderRadius: 10, background: 'var(--dsw-specific-menu, #fff)', boxShadow: '0 4px 18px #0001' } },
                  h('button', { role: 'menuitem', style: rowStyle, onClick: () => action(() => copyReference(session.sessionId, hostId)) }, '复制 Session ID'),
                  h('button', { role: 'menuitem', style: rowStyle, onClick: () => { setMenu(null); emit({ rename: { hostId, sessionId: session.sessionId, title: sessionTitle(session) } }); } }, '重命名'),
                  !showArchived && h('button', { role: 'menuitem', style: rowStyle, onClick: () => action(() => workspaceAction(hostId, pinned.has(session.sessionId) ? 'workspace/unpinSession' : 'workspace/pinSession', { sessionId: session.sessionId })) }, pinned.has(session.sessionId) ? '取消置顶' : '置顶会话'),
                  h('button', { role: 'menuitem', style: rowStyle, onClick: () => action(() => workspaceAction(hostId, showArchived ? 'workspace/unarchiveSession' : 'workspace/archiveSession', { sessionId: session.sessionId })) }, showArchived ? '恢复会话' : '归档会话')));
            }),
            opened && rows.length > 5 && !query && h('button', { style: { ...rowStyle, paddingLeft: 27, fontSize: 12, opacity: 0.6 }, onClick: () => setExpanded(old => ({ ...old, [key]: !old[key] })) }, expanded[key] ? '收起' : `展开其余 ${rows.length - 5} 个会话`));
        });
      }),
      model.hosts.filter(host => host.state !== 'disconnected' && !model.catalogs?.[host.id]).map(host => h('div', { key: host.id, style: { padding: 12, fontSize: 12, opacity: 0.6 } }, h(Dot, { state: host.state }), host.label, ' · ', phaseText[host.phase] || '加载工作区…'))),
    model.notice && h('div', { role: 'status', style: { padding: 8, fontSize: 12 } }, model.notice),
    model.error && h('div', { role: 'alert', style: { padding: 8, fontSize: 12, color: '#bd553a', overflowWrap: 'anywhere' } }, model.error,
      h('button', { style: { ...button, padding: 3, marginLeft: 5 }, onClick: () => emit({ error: '' }) }, '关闭')));
}
function sessionTitle(session) {
  return session.title || session.displayTitle || session.projections?.values?.title || session.projectionValues?.title || '新会话';
}
function UtilityDialogs() {
  const model = useModel();
  const [busy, setBusy] = useState(false);
  const modal = model.manualCopy || model.rename || model.directory || model.referenceInput !== undefined;
  if (!modal) return null;
  const close = () => emit({ manualCopy: null, rename: null, directory: null, referenceInput: undefined });
  const run = async fn => { setBusy(true); try { await fn(); } catch (error) { emit({ error: error.message }); } finally { setBusy(false); } };
  const loadDirectory = async (hostId, path) => {
    let value;
    if (hostId === 'local') {
      const result = await uiContext.remote.directoryPicker.list(path || undefined);
      if (!result.ok) throw new Error(result.error.message); value = result.value;
    } else value = await call('action', { hostId, endpoint: 'directoryPicker/list', args: { path: path || undefined } });
    emit({ directory: { hostId, ...value } });
  };
  return h('div', { style: { position: 'fixed', inset: 0, background: '#0004', zIndex: 21000, display: 'grid', placeItems: 'center' } },
    h('div', { role: 'dialog', 'aria-modal': true, style: { ...panel, width: 'min(560px,90vw)', maxHeight: '85vh', overflow: 'auto', background: 'var(--dsw-alias-bg-base, #fff)', borderRadius: 16, padding: 22 } },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: 16 } },
        h('strong', null, model.manualCopy ? '复制会话链接' : model.rename ? '重命名会话' : model.directory ? '添加工作区' : '打开会话链接'),
        h('button', { style: button, onClick: close }, '关闭')),
      model.manualCopy && h(React.Fragment, null, h('p', null, '选择以下链接，按 Ctrl+C 复制：'), h('input', { readOnly: true, autoFocus: true, value: model.manualCopy, onFocus: e => e.target.select(), style: inputStyle })),
      model.rename && h('form', { onSubmit: e => { e.preventDefault(); void run(async () => { await workspaceAction(model.rename.hostId, 'session/rename', { sessionId: model.rename.sessionId, title: model.rename.title }); close(); }); } },
        h('input', { 'aria-label': '会话名称', autoFocus: true, value: model.rename.title, style: inputStyle, onChange: e => emit({ rename: { ...model.rename, title: e.target.value } }) }),
        h('button', { style: { ...button, marginTop: 12 }, disabled: busy }, '保存')),
      model.referenceInput !== undefined && h('form', { onSubmit: e => { e.preventDefault(); void run(async () => {
        const ref = parseSessionReference(model.referenceInput);
        if (ref.hostId === 'local') openLocal(ref.sessionId);
        else {
          const host = snapshot.hosts.find(host => 'ssh:' + host.target === ref.hostId);
          if (!host) throw new Error('链接中的 SSH 主机尚未配置');
          await openRemote(host, { sessionId: ref.sessionId });
        } close();
      }); } },
        h('input', { 'aria-label': '会话链接', autoFocus: true, value: model.referenceInput, placeholder: 'dsh://sessions/…?hostId=…', style: inputStyle, onChange: e => emit({ referenceInput: e.target.value }) }),
        h('button', { style: { ...button, marginTop: 12 }, disabled: busy }, '打开')),
      model.directory && h(React.Fragment, null,
        h('select', { 'aria-label': '工作区所在主机', value: model.directory.hostId, style: inputStyle, onChange: e => emit({ directory: { hostId: e.target.value, path: '', entries: [] } }) },
          h('option', { value: 'local' }, '本地'),
          model.hosts.filter(host => host.state === 'connected').map(host => h('option', { key: host.id, value: 'ssh:' + host.target }, host.label))),
        h('form', { style: { display: 'flex', gap: 8, margin: '12px 0' }, onSubmit: e => { e.preventDefault(); void run(() => loadDirectory(model.directory.hostId, model.directory.path)); } },
          h('input', { 'aria-label': '工作区路径', placeholder: '输入目录路径，或点击浏览', style: inputStyle, value: model.directory.path, onChange: e => emit({ directory: { ...model.directory, path: e.target.value } }) }),
          h('button', { style: button, disabled: busy }, '浏览')),
        h('div', { style: { maxHeight: 280, overflow: 'auto' } },
          model.directory.crumbs?.map(crumb => h('button', { key: crumb.path, style: { ...button, border: 0, fontSize: 12 }, onClick: () => run(() => loadDirectory(model.directory.hostId, crumb.path)) }, crumb.name + ' /')),
          model.directory.entries?.filter(entry => !entry.hidden).map(entry => h('button', { key: entry.path, style: rowStyle, onClick: () => run(() => loadDirectory(model.directory.hostId, entry.path)) }, h(FolderIcon, {}), entry.name))),
        h('button', { disabled: busy || !model.directory.path, style: { ...button, marginTop: 14 }, onClick: () => run(async () => {
          await workspaceAction(model.directory.hostId, 'workspace/create', { path: model.directory.path }); close();
        }) }, '添加此目录')),
      model.error && h('p', { role: 'alert', style: { color: '#bd553a', fontSize: 13 } }, model.error)));
}

function installUnifiedClient(ctx, writeClipboard) {
  uiContext = ctx;
  writeHostClipboard = writeClipboard;
  localWorkspaces = { subscribe: listener => ctx.workspaces.list.subscribe(listener), getSnapshot: () => ctx.workspaces.list.getSnapshot() };
  localSessions = { subscribe: listener => ctx.sessions.list.subscribe(listener), getSnapshot: () => ctx.sessions.list.getSnapshot() };
  ctx.effect(() => ctx.slots.onEntryError((slot, entry, error) => {
    if (entry.component === UnifiedWorkspaces || slot === 'main' && entry.options.key === 'ssh-remote-modern') emit({ error: 'SSH 界面加载失败：' + error.message });
  }));
  try { emit({ catalogs: JSON.parse(localStorage.getItem(storageKey) || '{}') }); } catch { emit({ catalogs: {} }); }
  ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register({ name: 'sidebar.workspaces', priority: -20 }, UnifiedWorkspaces));
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'ssh-remote-dialogs', order: 2 }, UtilityDialogs));
  // The native New Chat button and shortcut use this service. Explicit local
  // workspace requests stay local; the global button follows the visible host.
  patchClientMethod(ctx, ctx.uiWorkspace, 'startSession', originalStart => function(workspaceId, options) {
    if (workspaceId === undefined && ctx.layout.panelInfo.getSnapshot().activePanelId === 'ssh-remote-modern') {
      const host = snapshot.hosts.find(host => host.id === snapshot.active?.id);
      const catalog = host && snapshot.catalogs[host.id];
      const target = snapshot.selection;
      const remoteWorkspace = target?.workspaceId !== '_ungrouped' && target?.workspaceId
        || catalog?.items.find(workspace => workspace.sessionIds.includes(target?.sessionId))?.workspaceId;
      if (host && remoteWorkspace) return openRemote(host, { workspaceId: remoteWorkspace });
      emit({ error: '请先从左侧选择一个 SSH 工作区，再创建远端会话。' });
      return;
    }
    return originalStart.call(this, workspaceId, options);
  });
  // Expand references before the local request leaves the Desktop carrier.
  // The remote equivalent lives in the SSH gateway, including browser clients.
  const rpc = ctx.connection.rpc;
  patchClientMethod(ctx, rpc, 'call', original => async function(channel, endpoint, payload, signal) {
    if (channel === '/api' && endpoint === 'session/prompt' && payload?.args?.request) {
      const request = payload.args.request;
      try {
        if (findSessionReferences(request.content?.filter(p => p.type === 'text').map(p => p.text).join('\n')).length) {
          const content = await call('expandReferences', { content: request.content });
          signal?.throwIfAborted();
          payload = { ...payload, args: { ...payload.args, request: { ...request, content } } };
          const result = await original.call(this, channel, endpoint, payload, signal);
          if (!result.ok) emit({ error: '会话引用发送失败：' + result.error.message });
          return result;
        }
      } catch (error) {
        emit({ error: '会话引用发送失败：' + error.message });
        return { ok: false, error: { code: 'ssh-remote/reference', message: error.message, details: {} } };
      }
    }
    return original.call(this, channel, endpoint, payload, signal);
  });
}
