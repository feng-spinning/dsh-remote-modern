import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../src/desktop-guest.js', import.meta.url), 'utf8');
const Guest = vm.runInNewContext(source + '\nDesktopRemoteGuest');
function fixture() {
  const releases = [], errors = [], elements = [], external = [];
  let next = 0;
  const bridge = {
    async acquire(workspace) { return { lease: String(++next), partition: workspace }; },
    async release(lease) { releases.push(lease); },
    onOpenRequested(_lease, callback) { bridge.openRequested = callback; return () => { bridge.openRequested = null; }; },
  };
  const document = { createElement(name) {
    assert.equal(name, 'webview');
    const handlers = new Map();
    const element = { attributes: {}, dataset: {}, style: {}, navigations: [],
      setAttribute(k, v) { this.attributes[k] = v; },
      addEventListener(k, fn, options) { handlers.set(k, { fn, options }); },
      fire(k, event) { const h = handlers.get(k); if (h?.options?.once) handlers.delete(k); h?.fn(event); },
      async loadURL(url) { this.navigations.push(url); },
      remove() { this.removed = true; },
    };
    elements.push(element);
    return element;
  } };
  const container = { append(element) { this.child = element; } };
  const guest = new Guest(bridge, document, e => errors.push(e), u => external.push(u));
  return { bridge, guest, container, releases, errors, elements, external };
}
const first = { id: 'host-a', label: 'A', url: 'http://127.0.0.1:1234/?sshAuth=first' };

test('Desktop guest starts with an approved lease, authenticates once and retains the same document on reopening', async () => {
  const f = fixture();
  await f.guest.open(f.container, first);
  const e = f.elements[0];
  assert.equal(e.attributes.src, 'about:blank#1');
  assert.equal(e.attributes.partition, 'dsh-remote-modern:host-a');
  assert.equal(e.attributes.preload, undefined);
  assert.deepEqual(e.navigations, []);
  e.fire('dom-ready');
  e.fire('dom-ready');
  await f.guest.open(f.container, first);
  assert.deepEqual(e.navigations, [first.url]);
  assert.equal(f.elements.length, 1);
  f.bridge.openRequested('https://example.org');
  assert.deepEqual(f.external, ['https://example.org']);
  f.guest.close();
  assert.equal(e.removed, true);
  assert.deepEqual(f.releases, ['1']);
});

test('closing during an asynchronous lease acquisition releases it without creating a guest', async () => {
  const f = fixture();
  let resolve;
  f.bridge.acquire = () => new Promise(r => { resolve = r; });
  const pending = f.guest.open(f.container, first);
  f.guest.close();
  resolve({ lease: 'late', partition: 'p' });
  await pending;
  assert.equal(f.elements.length, 0);
  assert.deepEqual(f.releases, ['late']);
});

test('switching hosts drops the previous guest and ignores its late events', async () => {
  const f = fixture();
  await f.guest.open(f.container, first);
  const old = f.elements[0];
  await f.guest.open(f.container, { ...first, id: 'host-b', url: 'http://127.0.0.1:4321/' });
  old.fire('dom-ready');
  old.fire('did-fail-load', { isMainFrame: true, errorCode: -105 });
  assert.deepEqual(old.navigations, []);
  assert.deepEqual(f.errors, []);
  assert.equal(old.removed, true);
  assert.deepEqual(f.releases, ['1']);
  f.elements[1].fire('did-fail-load', { isMainFrame: true, errorCode: -105, errorDescription: 'offline' });
  assert.match(f.errors[0], /offline/);
  f.guest.close();
  f.guest.close();
  assert.deepEqual(f.releases, ['1', '2']);
});
