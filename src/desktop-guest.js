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
