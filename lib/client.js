window.__ModuleLoader__.load({id:"dsh-remote-modern",factory:(require)=>{
const React=require("react");
const {writeClipboard,Modal,MenuItemButton}=require("@deepseek-ai/dsh-client-ui-primitives");
// Host identity travels with the session ID; never guess a host from an ID.
function sessionReference(sessionId, hostId = 'local') {
  if (typeof sessionId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(sessionId)) throw new Error('无效的 Session ID');
  if (typeof hostId !== 'string' || !hostId || hostId.length > 256) throw new Error('无效的主机标识');
  return `dsh://sessions/${sessionId}?hostId=${encodeURIComponent(hostId)}`;
}

function parseSessionReference(value) {
  if (typeof value !== 'string' || !/^dsh:\/\/sessions\/[a-zA-Z0-9_-]{1,128}\?/.test(value)) throw new Error('无效的 DSH 会话链接');
  let url;
  try { url = new URL(value); } catch { throw new Error('请使用带 hostId 的 dsh://sessions/ 会话链接'); }
  const sessionId = url.pathname.slice(1);
  const hostId = url.searchParams.get('hostId');
  if (url.protocol !== 'dsh:' || url.hostname !== 'sessions' || url.username || url.password || url.port || url.hash
    || !hostId || [...url.searchParams.keys()].some(key => key !== 'hostId') || url.searchParams.getAll('hostId').length !== 1) {
    throw new Error('无效的 DSH 会话链接');
  }
  return { sessionId, hostId, reference: sessionReference(sessionId, hostId) };
}

function findSessionReferences(text) {
  const refs = new Map();
  for (const match of String(text).matchAll(/dsh:\/\/sessions\/[a-zA-Z0-9_-]{1,128}\?[a-zA-Z0-9_.~%:@+&=-]+/g)) {
    const ref = parseSessionReference(match[0].replace(/[.,;:，。；：!?！？]+$/, ''));
    refs.set(ref.reference, ref);
  }
  return [...refs.values()];
}

function textParts(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(part => part?.type === 'text' && typeof part.text === 'string'
    && !part.text.startsWith('\n<dsh_session_references>\n')).map(part => part.text).join('\n');
}

// Only human/assistant text, never credentials, tool outputs, reasoning or binary attachments.
function referenceExcerpt(snapshot, maxChars = 24000) {
  const messages = [];
  for (const record of snapshot.records || []) {
    const event = record.event;
    if (!event || !['user/message', 'assistant/message'].includes(event.type)) continue;
    const data = event.data ?? event;
    // DSH also stores runtime context, skills and agent instructions as
    // user/message events. Only actual user submissions are conversation text.
    if (event.type === 'user/message' && data.source?.kind !== 'user') continue;
    const text = textParts(data.content ?? data.message?.content ?? data.text);
    if (text) messages.push({ role: event.type === 'user/message' ? 'user' : 'assistant', text, seq: event.seq });
  }
  let remaining = maxChars;
  const selected = [];
  let truncated = !!snapshot.hasMore;
  for (const message of messages.toReversed()) {
    if (remaining <= 0) { truncated = true; break; }
    const text = message.text.length > remaining ? message.text.slice(-remaining) : message.text;
    if (text.length < message.text.length) truncated = true;
    selected.unshift({ ...message, text });
    remaining -= text.length;
  }
  return { messages: selected, truncated, cursor: snapshot.cursor, beforeSeq: snapshot.records?.[0]?.event?.seq };
}

// Uses the Desktop-owned guest lease, partition and sandbox policy.
class DesktopRemoteGuest {
  constructor(bridge, document, onError, openExternal) {
    this.bridge = bridge;
    this.document = document;
    this.onError = onError;
    this.openExternal = openExternal;
    this.generation = 0;
  }
  async open(container, active) {
    if (this.element && this.target === active.url) return;
    this.close();
    const generation = this.generation;
    const reservation = await this.bridge.acquire('dsh-remote-modern:' + active.id);
    if (generation !== this.generation) {
      await this.bridge.release(reservation.lease);
      return;
    }
    this.lease = reservation.lease;
    this.target = active.url;
    const element = this.document.createElement('webview');
    this.element = element;
    element.setAttribute('name', reservation.lease);
    element.setAttribute('partition', reservation.partition);
    element.setAttribute('allowpopups', '');
    element.setAttribute('src', 'about:blank#' + reservation.lease);
    element.setAttribute('aria-label', active.label + ' 远端工作区');
    element.dataset.sidebarBrowserFrame = 'webview';
    Object.assign(element.style, { display: 'flex', flex: '1', width: '100%', height: '100%', minWidth: '0', minHeight: '0', border: '0' });
    this.unsubscribe = this.bridge.onOpenRequested(reservation.lease, url => this.openExternal(url));
    element.addEventListener('dom-ready', () => {
      if (generation !== this.generation) return;
      this.ready = true;
      void element.loadURL(active.url).catch(error => {
        if (generation === this.generation && error.code !== 'ERR_ABORTED') this.onError('远端页面加载失败：' + error.message);
      });
    }, { once: true });
    element.addEventListener('did-fail-load', event => {
      if (generation === this.generation && event.isMainFrame && event.errorCode !== -3) this.onError('远端页面加载失败：' + event.errorDescription);
    });
    element.addEventListener('render-process-gone', () => {
      if (generation === this.generation) this.onError('远端页面进程已退出，请刷新视图。');
    });
    container.append(element);
  }
  close() {
    this.generation++;
    this.ready = false;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.element?.remove();
    this.element = undefined;
    this.target = undefined;
    if (this.lease) {
      void this.bridge.release(this.lease).catch(error => this.onError('远端视图释放失败：' + error.message));
      this.lease = undefined;
    }
  }
}

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

// Build wraps this module in dsh's public lazy module factory. React is supplied
// by the host platform table; no private runtime or DOM injection is required.
const h = React.createElement;
const { useState, useEffect, useRef, useSyncExternalStore } = React;
let snapshot = { hosts: [], warnings: [], active: null, remoteVisible: false, picker: false, error: '', probes: {}, probing: null, catalogs: {}, notice: '' };
const listeners = new Set();
const emit = patch => { snapshot = { ...snapshot, ...patch }; for (const listener of listeners) listener(); };
const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
const useModel = () => useSyncExternalStore(subscribe, () => snapshot);
let call;
const phaseText = { installing: '正在安装远端 dsh', starting: '正在启动远端后端', upgrading: '检测到远端升级，正在重连', restarting: '正在重启升级后的远端后端', ssh: '正在建立 SSH 隧道' };
const stateText = { connected: '已连接', connecting: '连接中', reconnecting: '正在重连', disconnected: '未连接' };
const button = { border: '1px solid var(--border-color, #ddd)', borderRadius: 8, padding: '7px 12px', background: 'transparent', color: 'inherit', cursor: 'pointer', font: 'inherit' };
const inputStyle = { width: '100%', boxSizing: 'border-box', background: 'transparent', color: 'inherit', border: '1px solid #9995', borderRadius: 8, padding: '10px 12px', font: 'inherit' };
const panel = { fontFamily: 'inherit', color: 'var(--text-primary, #242424)' };
async function refresh() {
  try {
    const result = await call('list');
    const active = snapshot.active;
    const host = active && result.hosts.find(host => host.id === active.id);
    emit({ hosts: result.hosts, warnings: result.warnings, ...(active ? { active: { ...active, ready: host?.state === 'connected', revision: host?.revision || 0 } } : {}) });
    if (active?.target && host?.state === 'connected' && (!active.ready || active.revision !== host.revision)) await call('navigate', { id: host.id, ...active.target });
    void refreshCatalogs();
  }
  catch (e) { emit({ error: e.message }); }
}
async function connect(host) {
  emit({ error: '' });
  try { await call('connect', { id: host.id }); emit({ picker: false }); await refresh(); }
  catch (e) { emit({ error: e.message }); }
}
function Dot({ state }) {
  return h('span', { 'aria-hidden': true, style: { display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: state === 'connected' ? '#16a05b' : state === 'reconnecting' || state === 'connecting' ? '#cc9130' : '#999', marginRight: 8 } });
}
function HostList() {
  const model = useModel();
  return h('div', null,
    h('button', { style: { ...button, width: '100%', textAlign: 'left', marginBottom: 12 }, onClick: () => { emit({ remoteVisible: false, picker: false }); uiContext.layout.selectPanel(null); } }, '⌂  本地', h('small', { style: { display: 'block', opacity: 0.65, marginTop: 4 } }, '本机和 SSH 工作区都显示在左侧栏')),
    model.hosts.map(host => h('div', { key: host.id, style: { padding: '13px 0', borderTop: '1px solid #9993', display: 'flex', alignItems: 'center', gap: 12 } },
      h('div', { style: { flex: 1, minWidth: 0 } }, h('strong', null, h(Dot, { state: host.state }), host.label),
        h('div', { style: { fontSize: 12, opacity: 0.65, marginTop: 5 } }, host.target, ' · ', phaseText[host.phase] || stateText[host.state]),
        host.error && h('div', { role: 'alert', style: { fontSize: 12, color: '#bd553a', marginTop: 6, overflowWrap: 'anywhere' } }, host.error)),
      h('button', { style: button, disabled: model.probing === host.id, onClick: async () => {
        emit({ probing: host.id, error: '' });
        try { const result = await call('probe', { id: host.id }); emit({ probes: { ...snapshot.probes, [host.id]: result } }); }
        catch (e) { emit({ error: e.message }); } finally { emit({ probing: null }); }
      } }, model.probing === host.id ? '检测中…' : '只读检测'),
      h('button', { style: button, onClick: () => connect(host) }, host.state === 'connected' ? '显示工作区' : host.state === 'connecting' || host.state === 'reconnecting' ? '查看连接' : '连接'),
      host.state !== 'disconnected' && h('button', { style: button, onClick: async () => {
        try { await call('disconnect', { id: host.id }); if (snapshot.active?.id === host.id) emit({ active: null, remoteVisible: false }); await refresh(); } catch (e) { emit({ error: e.message }); }
      } }, '断开'))),
    Object.entries(model.probes).map(([id, result]) => h('div', { key: id, role: 'status', style: { fontSize: 12, padding: 12, borderRadius: 8, background: '#9991', marginTop: 8 } },
      h('strong', null, model.hosts.find(host => host.id === id)?.label, '：', result.message),
      h('div', { style: { marginTop: 5, opacity: 0.65 } }, Object.entries(result.facts).map(([key, value]) => `${key}: ${value}`).join(' · ')))),
    !model.hosts.length && h('p', { style: { opacity: 0.65 } }, '还没有 SSH 主机。添加已有 SSH config 别名，或 user@host。'),
    model.warnings.map((warning, i) => h('p', { key: i, role: 'alert', style: { fontSize: 12, color: '#bd553a' } }, warning)));
}
function HostsPage() {
  const model = useModel();
  const [target, setTarget] = useState(''), [label, setLabel] = useState(''), [port, setPort] = useState(''), [saving, setSaving] = useState(false);
  return h('div', { style: { ...panel, maxWidth: 720, padding: 20 } },
    h('h2', { style: { fontSize: 22, margin: '0 0 8px' } }, '远程连接'),
    h('p', { style: { opacity: 0.65, fontSize: 13, lineHeight: 1.7 } }, '通过 SSH 使用远端工作区。会话、工具、终端与文件操作在所选主机运行，关闭窗口后远端后端仍会保留。'),
    h(HostList),
    h('form', { onSubmit: async event => {
      event.preventDefault(); setSaving(true); emit({ error: '' });
      try { await call('save', { target, label, port }); setTarget(''); setLabel(''); setPort(''); await refresh(); }
      catch (e) { emit({ error: e.message }); } finally { setSaving(false); }
    }, style: { borderTop: '1px solid #9993', marginTop: 16, paddingTop: 16 } },
      h('h3', { style: { fontSize: 15, marginTop: 0 } }, '添加 SSH 主机'),
      h('label', { style: { display: 'block', fontSize: 13, marginBottom: 12 } }, 'SSH 别名或 user@host', h('input', { 'aria-label': 'SSH 别名或 user@host', required: true, value: target, placeholder: 'research-server', onChange: e => setTarget(e.target.value), style: { ...inputStyle, marginTop: 6 } })),
      h('div', { style: { display: 'flex', gap: 12 } },
        h('label', { style: { flex: 1, fontSize: 13 } }, '显示名称', h('input', { 'aria-label': '显示名称', value: label, onChange: e => setLabel(e.target.value), style: { ...inputStyle, marginTop: 6 } })),
        h('label', { style: { width: 110, fontSize: 13 } }, '端口（可选）', h('input', { 'aria-label': 'SSH 端口', type: 'number', min: 1, max: 65535, value: port, onChange: e => setPort(e.target.value), style: { ...inputStyle, marginTop: 6 } }))),
      h('button', { type: 'submit', disabled: saving, style: { ...button, marginTop: 12 } }, saving ? '保存中…' : '添加主机')),
    h('p', { style: { fontSize: 12, opacity: 0.6, lineHeight: 1.7 } }, '首次连接会在远端 ~/.dsh-remote-modern 创建独立运行目录，优先复用已有 dsh 0.2.1-rc.2，否则安装该版本。远端需要 Node.js 24+；安装时需要 npm 和网络。请先在终端完成 SSH 密钥及主机指纹确认。模型账户需在远端设置，本机凭据不会自动复制。'),
    model.error && h('p', { role: 'alert', style: { color: '#bd553a', overflowWrap: 'anywhere' } }, model.error));
}
function DesktopGuestRemote({ active, epoch, bridge }) {
  const container = useRef(null);
  useEffect(() => {
    const guest = new DesktopRemoteGuest(bridge, document, error => emit({ error }), url => window.open(url, '_blank', 'noopener,noreferrer'));
    void guest.open(container.current, active).catch(error => { guest.close(); emit({ error: error.message }); });
    return () => guest.close();
  }, [bridge, active.id, active.url, epoch]);
  return h('div', { ref: container, style: { display: 'flex', flex: 1, minHeight: 0, minWidth: 0 }, 'aria-label': `${active.label} Desktop 远端视图` });
}
function NativeRemote({ active, visible, epoch }) {
  const container = useRef(null);
  const previousEpoch = useRef(epoch);
  useEffect(() => {
    const bridge = window.dshSSHRemote;
    if (!visible) { void bridge.hide().catch(e => emit({ error: e.message })); return; }
    let live = true;
    const bounds = () => {
      const box = container.current.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    };
    const resize = () => { if (live) void bridge.bounds(bounds()).catch(e => emit({ error: e.message })); };
    const open = async () => {
      try { if (previousEpoch.current !== epoch) await bridge.close(); previousEpoch.current = epoch; if (live) await bridge.open(active.url, bounds()); }
      catch (e) { if (live) emit({ error: e.message }); }
    };
    void open();
    const observer = new ResizeObserver(resize);
    observer.observe(container.current);
    return () => { live = false; observer.disconnect(); void bridge.hide().catch(() => {}); };
  }, [active.id, active.url, visible, epoch]);
  return h('div', { ref: container, style: { flex: 1, minHeight: 0, position: 'relative' }, 'aria-label': `${active.label} 原生远端工作区` });
}
function RemoteMain() {
  const model = useModel();
  const activeHost = model.hosts.find(h => h.id === model.active?.id);
  const desktop = location.protocol === 'file:' || location.protocol === 'dsh-app:';
  const guestBridge = desktop && window.dshDesktop?.protocolVersion === 1 && window.dshDesktop.browser;
  const native = desktop && !!window.dshSSHRemote;
  const [frameEpoch, setFrameEpoch] = useState(0);
  useEffect(() => { setFrameEpoch(x => x + 1); }, [model.active?.id, model.active?.revision]);
  if (!model.active) return h('div', { style: { padding: 30 } }, '从左侧栏选择 SSH 工作区或会话');
  return h('div', { style: { ...panel, width: '100%', height: '100%', minHeight: 0, minWidth: 0, background: 'var(--dsw-alias-bg-base, #fafafa)', display: 'flex', flexDirection: 'column' } },
      model.error && h('div', { role: 'alert', style: { padding: 10, color: '#bd553a' } }, model.error),
      guestBridge && model.active.ready ? h(DesktopGuestRemote, { active: model.active, epoch: frameEpoch, bridge: guestBridge })
      : native && model.active.ready ? h(NativeRemote, { active: model.active, visible: model.remoteVisible && !model.picker, epoch: frameEpoch })
      : desktop && !native && !guestBridge ? h('div', { style: { margin: 'auto', textAlign: 'center', maxWidth: 440, padding: 24 } },
        h('h2', null, model.active.label),
        h('p', { style: { lineHeight: 1.8, opacity: 0.65 } }, '远端后端通过独立浏览器窗口打开。连接由 Desktop 插件维护，关闭浏览器后远端会话仍会保留。'),
        h('a', { href: model.active.url, target: '_blank', rel: 'noopener noreferrer', style: { ...button, display: 'inline-block' } }, '打开远端工作区'))
      : model.active.ready ? h('iframe', { key: `${model.active.id}-${frameEpoch}`, title: `${model.active.label} 远端工作区`, src: model.active.url, style: { flex: 1, width: '100%', border: 0 }, allow: 'clipboard-read; clipboard-write', referrerPolicy: 'no-referrer' })
      : h('div', { style: { margin: 'auto', maxWidth: 520, padding: 24, textAlign: 'center' } },
        h('h2', null, phaseText[activeHost?.phase] || '正在连接远端'),
        h('p', { style: { opacity: 0.6 } }, '断线期间等待 SSH 恢复，操作不会转到本机执行。'),
        activeHost?.error && h('p', { role: 'alert', style: { color: '#bd553a', overflowWrap: 'anywhere' } }, activeHost.error)));
}
function Overlay() {
  const model = useModel();
  useEffect(() => {
    if (!model.picker) return;
    const close = event => { if (event.key === 'Escape') emit({ picker: false }); };
    window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close);
  }, [model.picker]);
  return model.picker && h('div', { style: { position: 'fixed', inset: 0, zIndex: 20000, background: '#0005', display: 'flex', alignItems: 'center', justifyContent: 'center' }, onClick: event => { if (event.target === event.currentTarget) emit({ picker: false }); } },
      h('div', { role: 'dialog', 'aria-modal': true, 'aria-label': '远程连接', style: { ...panel, background: 'var(--bg-primary, #fafafa)', borderRadius: 14, boxShadow: '0 20px 90px #0004', width: 'min(640px, 94vw)', maxHeight: '85vh', overflow: 'auto' } },
        h('div', { style: { display: 'flex', justifyContent: 'flex-end', padding: '12px 16px 0' } }, h('button', { style: button, autoFocus: true, 'aria-label': '关闭远程连接', onClick: () => emit({ picker: false }) }, '关闭')),
        h(HostsPage)));
}
function apply(ctx) {
  call = async (endpoint, payload = {}) => {
    const result = await ctx.connection.rpc.call('/api', 'sshRemote/' + endpoint, payload);
    if (!result.ok) throw Object.assign(new Error(result.error.message), { rpcError: result.error });
    return result.value;
  };
  installUnifiedClient(ctx, writeClipboard);
  ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'ssh-remote-modern', order: 16, label: '远程连接' }, HostsPage));
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'ssh-remote-modern', order: 1 }, Overlay));
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'ssh-remote-modern' }, RemoteMain));
  ctx.effect(() => {
    const timer = setInterval(refresh, 2000);
    return () => { clearInterval(timer); emit({ active: null, remoteVisible: false, picker: false }); };
  });
  void refresh();
}

return {name:"ssh-remote-modern-client",inject:["slots","connection","workspaces","sessions","uiWorkspace","layout","remote"],apply};
}});
