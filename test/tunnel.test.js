import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { openTunnel } from '../src/tunnel.js';
import { until } from './helpers.js';

test('upgrade notice ends a local SSH carrier even when forwarded channels keep it alive', async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
  let kills = 0, closes = 0;
  child.kill = () => { kills++; queueMicrotask(() => child.emit('close', null)); };
  child.stdin.once('data', () => queueMicrotask(() => child.stdout.write('DSH_SSH_READY '+JSON.stringify({version:'0.2.1-rc.2',port:12345,token:'fixture'})+'\n')));
  const phases = [];
  const tunnel = await openTunnel({target:'fixture'},{spawnProcess:()=>child,onProgress:p=>phases.push(p),onClose:()=>closes++});
  try {
    child.stdout.write('DSH_SSH_PROGRESS upgrading\n');
    await until(()=>closes===1);
    assert.equal(kills,1);
    assert.deepEqual(phases,['upgrading']);
  } finally { tunnel.close(); child.stdout.destroy(); child.stderr.destroy(); child.stdin.destroy(); }
});
