import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, symlink, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Gateway } from '../src/gateway.js';
import { login, until } from './helpers.js';
const project = resolve(import.meta.dirname, '..');
const root = await mkdtemp(join(project, '.test-supervisor-'));
const packageRoot = process.env.DSH_TEST_CLI_PACKAGE || join(process.env.APPDATA, 'npm/node_modules/@deepseek-ai/dsh');
const nodeModules = join(root, 'runtime/0.2.0-rc.2/node_modules/@deepseek-ai');
await mkdir(nodeModules, { recursive: true });
await symlink(packageRoot, join(nodeModules, 'dsh'), 'junction');
const bootstrap = join(project, 'src/remote-bootstrap.cjs');
const existingHome = join(root, 'existing-dsh-home');
await mkdir(join(existingHome, 'storages'), { recursive: true });
const existingWorkspace = JSON.stringify({ version: 1, workspaces: [] });
await writeFile(join(existingHome, 'storages/workspace.json'), existingWorkspace);
const children = new Set();
const attach = () => new Promise((resolveResult, reject) => {
  const child = spawn(process.execPath, [bootstrap], { env: { ...process.env, DSH_HOME: existingHome, DSH_REMOTE_MODERN_ROOT: root }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output = '', error = '';
  children.add(child); child.stdout.on('data', data => output += data); child.stderr.on('data', data => error += data);
  child.on('error', reject); child.on('exit', code => {
    children.delete(child);
    if (code !== 0) reject(new Error(error || 'Attach failed'));
    else {
      const line = output.split('\n').find(line => line.startsWith('DSH_SSH_READY '));
      if (!line) reject(new Error('No ready record'));
      else resolveResult(JSON.parse(line.slice(14)));
    }
  });
});
let endpoint, gateway;
try {
  endpoint = await attach();
  assert.equal(endpoint.dataHome, existingHome);
  assert.equal(await readFile(join(existingHome, 'storages/workspace.json'), 'utf8'), existingWorkspace);
  await assert.rejects(readFile(join(root, 'state/profiles/web/package.json')));
  process.kill(endpoint.pid, 0); process.kill(endpoint.childPid, 0);
  gateway = await new Gateway().start();
  await gateway.attach({ endpoint, port: endpoint.port });
  const cookie = await login(gateway);
  const response = await fetch(gateway.origin, { headers: { cookie } });
  assert.equal(response.status, 200); assert.match(await response.text(), /__DSH_BOOT__/);
  const [again, concurrent] = await Promise.all([attach(), attach()]);
  assert.equal(again.pid, endpoint.pid); assert.equal(concurrent.childPid, endpoint.childPid);
  await gateway.close(); gateway = null;
  assert.equal((await fetch(`http://127.0.0.1:${endpoint.port}/?token=${encodeURIComponent(endpoint.token)}`, { redirect: 'manual' })).status, 303);
  await writeFile(join(project, 'supervisor-evidence.json'), JSON.stringify({ passed: true, version: endpoint.version, supervisorSurvivedAttachExit: true, sameSupervisorOnConcurrentReattach: true, backendSurvivedGatewayClose: true }, null, 2));
  console.log('PASS: real dsh supervisor persists, concurrent reattach reuses identity, and gateway closure preserves backend.');
} finally {
  await gateway?.close();
  for (const child of children) child.kill();
  if (endpoint) {
    try { process.kill(endpoint.childPid); } catch {}
    await new Promise(resolveDelay => setTimeout(resolveDelay, 300));
    try { process.kill(endpoint.pid); } catch {}
  }
  if (!resolve(root).startsWith(project + '\\') && !resolve(root).startsWith(project + '/')) throw new Error('Unsafe test cleanup path');
  await rm(root, { recursive: true, force: true });
}
