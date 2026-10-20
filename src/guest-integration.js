// This function is bundled into the remote UI by the authenticated gateway.
// It uses the remote page's own services, never a Desktop preload or Node.
export function installGuestNavigation(ctx) {
  let revision = -1, busy = false;
  const controller = new AbortController();
  const navigate = async () => {
    if (busy || controller.signal.aborted) return;
    busy = true;
    try {
      const response = await fetch('/_dsh/navigation', { signal: controller.signal });
      if (!response.ok) throw new Error('远端导航连接不可用');
      const target = await response.json();
      if (target.revision === revision) return;
      if (ctx.workspaces.list.getSnapshot().phase !== 'ready') return;
      if (target.sessionId) ctx.uiWorkspace.openSession(target.sessionId);
      else if (target.workspaceId) await ctx.uiWorkspace.openWorkspace(target.workspaceId, undefined, { agentPreset: undefined });
      revision = target.revision;
    } catch (error) {
      if (!controller.signal.aborted) console.warn('DSH SSH navigation:', error.message);
    } finally { busy = false; }
  };
  ctx.effect(() => {
    const timer = setInterval(navigate, 300);
    return () => { clearInterval(timer); controller.abort(); };
  });
  void navigate();
}

export function integrateGuestBundle(source, kind) {
  const moduleId = `@deepseek-ai/dsh-client-ui-${kind}`;
  const start = source.indexOf(`id: "${moduleId}"`);
  if (start < 0) throw new Error(`远端插件 ${moduleId} 格式不兼容`);
  const next = source.indexOf('window.__ModuleLoader__.load(', start + 1);
  const end = next < 0 ? source.length : next;
  const prefix = source.slice(0, start), suffix = source.slice(end);
  source = source.slice(start, end);
  if (kind === 'workspace') {
    const marker = 'exports.apply = apply;';
    if (!source.includes(marker)) throw new Error('远端工作区插件结构已改变，请更新 dsh-remote-modern');
    return prefix + source.replace(marker, `exports.apply = function(ctx, ...args) { const result = apply(ctx, ...args); (${installGuestNavigation.toString()})(ctx); return result; };`) + suffix;
  }
  if (kind === 'layout') {
    // Preserve the official center/right panes and their resizers. Only the
    // duplicated remote sidebar is collapsed; the Desktop sidebar stays local.
    const patterns = [/const sidebarCollapsed = [^;]+;/, /const sidebarPreference = [^;]+;/, /const collapsedWidth = [^;]+;/];
    if (!patterns.every(pattern => pattern.test(source))) throw new Error('远端布局插件结构已改变，请更新 dsh-remote-modern');
    return prefix + source.replace(patterns[0], 'const sidebarCollapsed = true;')
      .replace(patterns[1], 'const sidebarPreference = 0;').replace(patterns[2], 'const collapsedWidth = 0;') + suffix;
  }
  return prefix + source + suffix;
}
