import test from 'node:test';
import assert from 'node:assert/strict';
import bootstrap from '../src/remote-bootstrap.cjs';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
test('bootstrap only reuses the current data home and unchanged runtime installation', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-runtime-'));
  try {
    mkdirSync(join(root, 'lib'));
    const bin = join(root, 'lib/bin.js');
    writeFileSync(bin, '// fixture');
    writeFileSync(join(root, 'package.json'), JSON.stringify({version:bootstrap.VERSION}));
    const identity = bootstrap.cliIdentity(bin);
    const ep = {version:bootstrap.VERSION, pid:process.pid, childPid:process.pid, cli:identity.cli, cliFingerprint:identity.fingerprint};
    const current = {...ep,dataHome:bootstrap.dataHome};
    assert.equal(bootstrap.reusableEndpoint(ep, bin), false);
    assert.equal(bootstrap.reusableEndpoint({...current,dataHome:bootstrap.dataHome + '-isolated'}, bin), false);
    assert.equal(bootstrap.reusableEndpoint(current, bin), true);
    assert.equal(bootstrap.reusableEndpoint({...current,version:'0.2.0-rc.2'}, bin), false);
    assert.equal(bootstrap.reusableEndpoint({...current,cliFingerprint:undefined}, bin), false);
    writeFileSync(bin, '// replacement installation');
    assert.equal(bootstrap.reusableEndpoint(current, bin), false);
    writeFileSync(join(root, 'package.json'), JSON.stringify({version:'future'}));
    assert.equal(bootstrap.cliIdentity(bin), null);
    assert.equal(bootstrap.reusableEndpoint(current, bin), false);
  } finally { rmSync(root, { recursive:true, force:true }); }
});

test('attach refuses a live stale endpoint without replacing it or stopping its owner', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-stale-'));
  try {
    const file = join(root, 'endpoint.json');
    const original = JSON.stringify({version:'0.2.0-rc.2',pid:process.pid,childPid:process.pid,dataHome:root});
    writeFileSync(file, original);
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../src/remote-bootstrap.cjs', import.meta.url))], {
      env:{...process.env, DSH_REMOTE_MODERN_ROOT:root, DSH_HOME:root}, encoding:'utf8', timeout:10000, windowsHide:true,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /backend is stale after a runtime upgrade/);
    assert.equal(readFileSync(file,'utf8'), original);
    process.kill(process.pid, 0);
  } finally { rmSync(root, {recursive:true,force:true}); }
});
