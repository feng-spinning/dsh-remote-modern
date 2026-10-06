window.__ModuleLoader__.load({id:"dsh-remote-modern",factory:(require)=>{
const React=require("react");
// Build wraps this module in dsh's public lazy module factory. React is supplied
// by the host platform table; no private runtime or DOM injection is required.
const h = React.createElement;
const { useState, useEffect, useRef, useSyncExternalStore } = React;
let snapshot = { hosts: [], warnings: [], active: null, picker: false, error: '', probes: {}, probing: null };
const listeners = new Set();
const emit = patch => { snapshot = { ...snapshot, ...patch }; for (const listener of listeners) listener(); };
const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
const useModel = () => useSyncExternalStore(subscribe, () => snapshot);
let call;
const phaseText = { installing: '正在安装远端 dsh', starting: '正在启动远端后端', ssh: '正在建立 SSH 隧道' };
const stateText = { connected: '已连接', connecting: '连接中', reconnecting: '正在重连', disconnected: '未连接' };
const button = { border: '1px solid var(--border-color, #ddd)', borderRadius: 8, padding: '7px 12px', background: 'transparent', color: 'inherit', cursor: 'pointer', font: 'inherit' };
const inputStyle = { width: '100%', boxSizing: 'border-box', background: 'transparent', color: 'inherit', border: '1px solid #9995', borderRadius: 8, padding: '10px 12px', font: 'inherit' };
const panel = { fontFamily: 'inherit', color: 'var(--text-primary, #242424)' };
async function refresh() {
  try {
    const result = await call('list');
    const active = snapshot.active;
    emit({ hosts: result.hosts, warnings: result.warnings, ...(active && result.hosts.some(host => host.id === active.id && host.state === 'connected') ? { active: { ...active, ready: true } } : {}) });
  }
  catch (e) { emit({ error: e.message }); }
}
async function connect(host) {
  emit({ error: '' });
  try { const active = await call('connect', { id: host.id }); emit({ active, picker: false }); await refresh(); }
  catch (e) { emit({ error: e.message }); }
}
function Dot({ state }) {
  return h('span', { 'aria-hidden': true, style: { display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: state === 'connected' ? '#16a05b' : state === 'reconnecting' || state === 'connecting' ? '#cc9130' : '#999', marginRight: 8 } });
}
function HostList() {
  const model = useModel();
  return h('div', null,
    h('button', { style: { ...button, width: '100%', textAlign: 'left', marginBottom: 12 }, onClick: () => emit({ active: null, picker: false }) }, '⌂  本地', h('small', { style: { display: 'block', opacity: 0.65, marginTop: 4 } }, '使用本机工作区和会话')),
    model.hosts.map(host => h('div', { key: host.id, style: { padding: '13px 0', borderTop: '1px solid #9993', display: 'flex', alignItems: 'center', gap: 12 } },
      h('div', { style: { flex: 1, minWidth: 0 } }, h('strong', null, h(Dot, { state: host.state }), host.label),
        h('div', { style: { fontSize: 12, opacity: 0.65, marginTop: 5 } }, host.target, ' · ', phaseText[host.phase] || stateText[host.state]),
        host.error && h('div', { role: 'alert', style: { fontSize: 12, color: '#bd553a', marginTop: 6, overflowWrap: 'anywhere' } }, host.error)),
      h('button', { style: button, disabled: model.probing === host.id, onClick: async () => {
        emit({ probing: host.id, error: '' });
        try { const result = await call('probe', { id: host.id }); emit({ probes: { ...snapshot.probes, [host.id]: result } }); }
        catch (e) { emit({ error: e.message }); } finally { emit({ probing: null }); }
      } }, model.probing === host.id ? '检测中…' : '只读检测'),
      h('button', { style: button, onClick: () => connect(host) }, host.state === 'connected' ? '打开' : host.state === 'connecting' || host.state === 'reconnecting' ? '查看连接' : '连接'),
      host.state !== 'disconnected' && h('button', { style: button, onClick: async () => {
        try { await call('disconnect', { id: host.id }); if (snapshot.active?.id === host.id) emit({ active: null }); await refresh(); } catch (e) { emit({ error: e.message }); }
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
    h('p', { style: { fontSize: 12, opacity: 0.6, lineHeight: 1.7 } }, '首次连接会在远端 ~/.dsh-remote-modern 创建独立运行目录，优先复用已有 dsh 0.2.0-rc.2，否则安装该版本。远端需要 Node.js 24+；安装时需要 npm 和网络。请先在终端完成 SSH 密钥及主机指纹确认。模型账户需在远端设置，本机凭据不会自动复制。'),
    model.error && h('p', { role: 'alert', style: { color: '#bd553a', overflowWrap: 'anywhere' } }, model.error));
}
function Launcher({ owner }) {
  const model = useModel();
  const active = model.hosts.find(h => h.id === model.active?.id);
  return h('button', { title: '远程连接', 'aria-label': '远程连接', style: { ...button, width: '100%', textAlign: 'left', border: 0, padding: owner?.wide ? '7px 12px' : '7px 4px', fontSize: owner?.wide ? 14 : 10, whiteSpace: 'nowrap' }, onClick: () => emit({ picker: true }) }, owner?.wide && h(Dot, { state: active?.state }), owner?.wide ? model.active?.label || '远程连接' : 'SSH');
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
function Overlay() {
  const model = useModel();
  const activeHost = model.hosts.find(h => h.id === model.active?.id);
  const desktop = location.protocol === 'file:' || location.protocol === 'dsh-app:';
  const native = desktop && !!window.dshSSHRemote;
  const [frameEpoch, setFrameEpoch] = useState(0);
  useEffect(() => { setFrameEpoch(x => x + 1); }, [model.active?.id]);
  useEffect(() => {
    if (!model.picker) return;
    const close = event => { if (event.key === 'Escape') emit({ picker: false }); };
    window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close);
  }, [model.picker]);
  return h(React.Fragment, null,
    model.active && h('div', { style: { ...panel, position: 'fixed', inset: 0, top: desktop && document.documentElement.dataset.platform === 'win32' ? 'var(--dsh-windows-titlebar-height, 40px)' : 0, zIndex: 1800, background: 'var(--bg-primary, #fafafa)', display: 'flex', flexDirection: 'column' } },
      h('div', { style: { height: 46, padding: '0 16px', display: 'flex', alignItems: 'center', gap: 14, borderBottom: '1px solid #9993', flexShrink: 0 } },
        h('button', { style: button, onClick: () => emit({ picker: true }) }, h(Dot, { state: activeHost?.state }), model.active.label, ' ▾'),
        h('span', { role: 'status', style: { fontSize: 12, opacity: 0.65, flex: 1 } }, phaseText[activeHost?.phase] || stateText[activeHost?.state] || '连接中', ' · SSH 远端'),
        h('button', { style: button, onClick: () => setFrameEpoch(x => x + 1) }, '刷新视图'),
        h('button', { style: button, onClick: () => emit({ active: null }) }, '返回本地')),
      model.error && h('div', { role: 'alert', style: { padding: 10, color: '#bd553a' } }, model.error),
      native && model.active.ready ? h(NativeRemote, { active: model.active, visible: !model.picker, epoch: frameEpoch })
      : desktop && !native ? h('div', { style: { margin: 'auto', textAlign: 'center', maxWidth: 440, padding: 24 } },
        h('h2', null, model.active.label),
        h('p', { style: { lineHeight: 1.8, opacity: 0.65 } }, '远端后端通过独立浏览器窗口打开。连接由 Desktop 插件维护，关闭浏览器后远端会话仍会保留。'),
        h('a', { href: model.active.url, target: '_blank', rel: 'noopener noreferrer', style: { ...button, display: 'inline-block' } }, '打开远端工作区'))
      : model.active.ready ? h('iframe', { key: `${model.active.id}-${frameEpoch}`, title: `${model.active.label} 远端工作区`, src: model.active.url, style: { flex: 1, width: '100%', border: 0 }, allow: 'clipboard-read; clipboard-write', referrerPolicy: 'no-referrer' })
      : h('div', { style: { margin: 'auto', maxWidth: 520, padding: 24, textAlign: 'center' } },
        h('h2', null, phaseText[activeHost?.phase] || '正在连接远端'),
        h('p', { style: { opacity: 0.6 } }, '断线期间等待 SSH 恢复，操作不会转到本机执行。'),
        activeHost?.error && h('p', { role: 'alert', style: { color: '#bd553a', overflowWrap: 'anywhere' } }, activeHost.error))),
    model.picker && h('div', { style: { position: 'fixed', inset: 0, zIndex: 20000, background: '#0005', display: 'flex', alignItems: 'center', justifyContent: 'center' }, onClick: event => { if (event.target === event.currentTarget) emit({ picker: false }); } },
      h('div', { role: 'dialog', 'aria-modal': true, 'aria-label': '远程连接', style: { ...panel, background: 'var(--bg-primary, #fafafa)', borderRadius: 14, boxShadow: '0 20px 90px #0004', width: 'min(640px, 94vw)', maxHeight: '85vh', overflow: 'auto' } },
        h('div', { style: { display: 'flex', justifyContent: 'flex-end', padding: '12px 16px 0' } }, h('button', { style: button, autoFocus: true, 'aria-label': '关闭远程连接', onClick: () => emit({ picker: false }) }, '关闭')),
        h(HostsPage))));
}
function apply(ctx) {
  call = async (endpoint, payload = {}) => {
    const result = await ctx.connection.rpc.call('/api', 'sshRemote/' + endpoint, payload);
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  };
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: 'ssh-remote-modern', order: 5 }, Launcher));
  ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'ssh-remote-modern', order: 16, label: '远程连接' }, HostsPage));
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'ssh-remote-modern', order: 1 }, Overlay));
  const timer = setInterval(refresh, 2000);
  ctx.on('dispose', () => { clearInterval(timer); emit({ active: null, picker: false }); });
  void refresh();
}

return {name:"ssh-remote-modern-client",inject:["slots","connection"],apply};
}});
