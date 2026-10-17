// Uploaded over the same SSH process that owns forwarding. Never prints tokens
// except the private READY record consumed by the connector.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const VERSION = '0.2.1-rc.2';
const root = process.env.DSH_REMOTE_MODERN_ROOT || path.join(os.homedir(), '.dsh-remote-modern');
const runtime = path.join(root, 'runtime', VERSION);
// Backend lifecycle belongs to this connector; user data belongs to the
// existing remote dsh installation, including credentials and conversations.
const state = path.resolve(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'));
const endpointFile = path.join(root, 'endpoint.json');
function installedCli() {
  const candidates = [path.join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), path.resolve(path.dirname(process.execPath), '../lib/node_modules/@deepseek-ai/dsh/lib/bin.js')];
  for (const bin of candidates) {
    try { if (fs.existsSync(bin) && JSON.parse(fs.readFileSync(path.resolve(bin, '../../package.json'), 'utf8')).version === VERSION) return bin; } catch {}
  }
  return null;
}
const delay = ms => new Promise(r => setTimeout(r, ms));
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
function cliIdentity(bin) {
  if (!bin) return null;
  try {
    const cli = fs.realpathSync(bin);
    const manifest = path.resolve(cli, '../../package.json');
    const contents = fs.readFileSync(manifest);
    if (JSON.parse(contents).version !== VERSION) return null;
    const fingerprint = createHash('sha256').update(contents).update(fs.readFileSync(cli))
      .update(String(fs.statSync(manifest).mtimeMs)).digest('hex');
    return { cli, fingerprint };
  } catch { return null; }
}
function reusableEndpoint(ep, bin = installedCli()) {
  const identity = cliIdentity(bin);
  return !!identity && ep?.version === VERSION && ep.dataHome === state &&
    ep.cli === identity.cli && ep.cliFingerprint === identity.fingerprint && alive(ep.pid) && alive(ep.childPid);
}
function modelEnvironment() {
  const env = { ...process.env, DSH_HOME: state };
  if (env.DEEPSEEK_API_KEY || process.platform !== 'linux') return env;
  const shell = env.SHELL || '/bin/bash';
  if (!['bash', 'zsh'].includes(path.basename(shell))) return env;
  // Match the user's existing terminal configuration. A dedicated descriptor
  // keeps the credential out of startup banners, stdout, logs and SSH replies.
  const result = spawnSync(shell, ['-ic', 'printf "%s" "${DEEPSEEK_API_KEY:-}" >&3'], {
    env, stdio: ['ignore', 'ignore', 'ignore', 'pipe'], timeout: 10000,
  });
  if (result.status === 0 && result.output?.[3]?.length) env.DEEPSEEK_API_KEY = result.output[3].toString();
  return env;
}
function endpoint() { try { return JSON.parse(fs.readFileSync(endpointFile, 'utf8')); } catch { return null; } }
function writeEndpoint(value) {
  const temp = endpointFile + '.' + process.pid;
  fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(temp, endpointFile);
}
async function serve() {
  const bin = installedCli();
  if (!bin) throw new Error('No matching dsh CLI is installed');
  const identity = cliIdentity(bin);
  if (!identity) throw new Error('The dsh installation changed before startup; reconnect to retry.');
  const child = spawn(process.execPath, [bin, '--profile', 'web', '--no-open', '--host', '127.0.0.1', '--port', '0'], {
    env: modelEnvironment(), stdio: ['ignore', 'pipe', 'pipe'],
  });
  let buffer = '';
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
      const match = /^dsh web: (http:\/\/127\.0\.0\.1:\d+\/?\?token=[^\s]+)/.exec(line);
      if (match) {
        const url = new URL(match[1]);
        writeEndpoint({ version: VERSION, dataHome: state, cli: identity.cli, cliFingerprint: identity.fingerprint, pid: process.pid, childPid: child.pid, port: Number(url.port), token: url.searchParams.get('token') });
        process.stdout.write('Remote Web backend ready\n');
      } else process.stdout.write(line + '\n');
    }
  });
  child.stderr.pipe(process.stderr);
  child.on('error', e => { console.error(e.message); process.exitCode = 1; });
  child.on('exit', code => {
    if (endpoint()?.pid === process.pid) fs.rmSync(endpointFile, { force: true });
    process.exitCode = code || 0;
  });
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
}
async function attach() {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Remote Node.js >=24 is required; install it before connecting.');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const lock = path.join(root, 'attach.lock');
  const deadline = Date.now() + 300000;
  for (;;) {
    try { fs.mkdirSync(lock, { mode: 0o700 }); fs.writeFileSync(path.join(lock, 'pid'), String(process.pid)); break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let owner; try { owner = Number(fs.readFileSync(path.join(lock, 'pid'), 'utf8')); } catch {}
      let age;
      try { age = Date.now() - fs.statSync(lock).mtimeMs; } catch (statError) { if (statError.code === 'ENOENT') continue; throw statError; }
      if ((owner && !alive(owner)) || (!owner && age > 10000)) { fs.rmSync(lock, { recursive: true, force: true }); continue; }
      if (Date.now() > deadline) throw new Error('Timed out waiting for another backend installation');
      await delay(500);
    }
  }
  try {
    let ep = endpoint();
    if (reusableEndpoint(ep)) {
      // Readiness is also checked by the client through the forwarded HTTP carrier.
      console.log('DSH_SSH_READY ' + JSON.stringify(ep)); return;
    }
    if (ep && (alive(ep.pid) || alive(ep.childPid))) {
      throw new Error('Remote dsh backend is stale after a runtime upgrade. Stop the connector-owned supervisor recorded in ~/.dsh-remote-modern/endpoint.json, then reconnect. Closing the Desktop view alone does not restart it.');
    }
    if (!installedCli()) {
      console.log('DSH_SSH_PROGRESS installing');
      fs.mkdirSync(runtime, { recursive: true, mode: 0o700 });
      const install = spawnSync('npm', ['install', '--prefix', runtime, '--no-audit', '--no-fund', '--save-exact', `@deepseek-ai/dsh@${VERSION}`], {
        stdio: ['ignore', 'ignore', 'inherit'], timeout: 600000,
      });
      if (install.error || install.status !== 0) throw new Error('Private dsh installation failed: ' + (install.error?.message || install.status));
    }
    fs.mkdirSync(state, { recursive: true, mode: 0o700 });
    const log = fs.openSync(path.join(root, 'backend.log'), 'a', 0o600);
    const supervisor = spawn(process.execPath, [__filename, '--serve'], { detached: true, stdio: ['ignore', log, log] });
    fs.closeSync(log); supervisor.unref();
    console.log('DSH_SSH_PROGRESS starting');
    for (let i = 0; i < 180; i++) {
      ep = endpoint();
      if (ep?.pid === supervisor.pid && alive(ep.childPid)) { console.log('DSH_SSH_READY ' + JSON.stringify(ep)); return; }
      if (!alive(supervisor.pid)) throw new Error('Remote backend failed to start; inspect ~/.dsh-remote-modern/backend.log');
      await delay(500);
    }
    throw new Error('Remote backend startup timed out; inspect ~/.dsh-remote-modern/backend.log');
  } finally { fs.rmSync(lock, { recursive: true, force: true }); }
}
if (require.main === module) (process.argv.includes('--serve') ? serve() : attach()).catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { VERSION, attach, serve, installedCli, cliIdentity, reusableEndpoint, dataHome: state };
