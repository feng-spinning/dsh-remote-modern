let uiContext;
let writeHostClipboard;
let refreshingCatalogs = false;
const rowStyle = { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, width: '100%', border: 0, borderRadius: 10, padding: '9px 10px', background: 'transparent', color: 'inherit', cursor: 'pointer', font: 'inherit', textAlign: 'left' };
const storageKey = 'dsh-remote-modern:workspaces:v2';
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
function UtilityDialogs() {
  const model = useModel();
  const [busy, setBusy] = useState(false);
  if (model.workspaceChooser) return h(Modal, {
    open: true, title: '添加工作区', onClose: () => emit({ workspaceChooser: null }),
  }, h(MenuItemButton, { onSelect: () => {
    const local = model.workspaceChooser.local; emit({ workspaceChooser: null }); local();
  } }, 'Local · 本地'),
  h(MenuItemButton, { onSelect: () => emit({ workspaceChooser: { ...model.workspaceChooser, remote: true } }) }, 'Remote · SSH'),
  model.workspaceChooser.remote && h(React.Fragment, null,
    model.hosts.map(host => h(MenuItemButton, { key: host.id, disabled: busy, onSelect: () => {
      setBusy(true);
      void (async () => {
        try {
          await call('connect', { id: host.id });
          const directory = await call('directory', { id: host.id });
          emit({ workspaceChooser: null, directory: { hostId: 'ssh:' + host.target, ...directory }, error: '' });
        } catch (error) { emit({ error: error.message }); } finally { setBusy(false); }
      })();
    } }, host.label + (busy ? ' · 连接中…' : ''))),
    h(MenuItemButton, { onSelect: () => emit({ workspaceChooser: null, picker: true }) }, '管理 SSH 主机')),
  model.error && h('p', { role: 'alert' }, model.error));
  const modal = model.manualCopy || model.directory;
  if (!modal) return null;
  const close = () => emit({ manualCopy: null, directory: null });
  const run = async fn => { setBusy(true); try { await fn(); } catch (error) { emit({ error: error.message }); } finally { setBusy(false); } };
  const loadDirectory = async (hostId, path) => {
    let value;
    if (hostId === 'local') {
      const result = await uiContext.remote.directoryPicker.list(path || undefined);
      if (!result.ok) throw new Error(result.error.message); value = result.value;
    } else value = await call('action', { hostId, endpoint: 'directoryPicker/list', args: { path: path || undefined } });
    emit({ directory: { hostId, ...value } });
  };
  return h(Modal, { open: true, onClose: close, title: model.manualCopy ? '复制会话链接' : '添加工作区' },
      model.manualCopy && h(React.Fragment, null, h('p', null, '选择以下链接，按 Ctrl+C 复制：'), h('input', { readOnly: true, autoFocus: true, value: model.manualCopy, onFocus: e => e.target.select(), style: inputStyle })),
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
      model.error && h('p', { role: 'alert', style: { color: '#bd553a', fontSize: 13 } }, model.error));
}

function installUnifiedClient(ctx, writeClipboard) {
  uiContext = ctx;
  writeHostClipboard = writeClipboard;
  ctx.effect(() => ctx.slots.onEntryError((slot, entry, error) => {
    if (slot === 'sidebar.workspaces' || slot === 'main' && entry.options.key === 'ssh-remote-modern') emit({ error: 'SSH 界面加载失败：' + error.message });
  }));
  try { emit({ catalogs: JSON.parse(localStorage.getItem(storageKey) || '{}') }); } catch { emit({ catalogs: {} }); }
  installNativeSidebar(ctx);
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
}
