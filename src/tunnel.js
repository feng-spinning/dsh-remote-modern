import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createSocksForward } from '../lib/socks.js';

export function validateTarget(target) {
  if (typeof target !== 'string' || !/^[a-zA-Z0-9_][a-zA-Z0-9_.@:\[\]-]{0,254}$/.test(target)) throw new Error('请输入 SSH config 别名或 user@host，不含命令或空格');
  return target;
}
export function defaultSshExecutable() {
  if (process.platform === 'win32') {
    const native = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'OpenSSH', 'ssh.exe');
    if (existsSync(native)) return native;
  }
  return 'ssh';
}
export function sshOptions({ probe = false } = {}) {
  const args = ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15', '-o', 'PermitLocalCommand=no', '-o', 'RemoteCommand=none', '-o', 'ControlMaster=no', '-o', 'ControlPath=none'];
  if (probe) args.push('-o', 'ClearAllForwardings=yes');
  return args;
}
// Non-interactive SSH normally skips nvm's shell initialization. Locate an
// existing compatible Node without sourcing user scripts or editing PATH files.
export const runtimePrelude = 'for dsh_node_candidate in "$(command -v node 2>/dev/null || true)" "$HOME"/.nvm/versions/node/*/bin/node "$HOME"/.local/bin/node /usr/local/bin/node /usr/bin/node; do if test -x "$dsh_node_candidate"; then case "$("$dsh_node_candidate" --version)" in v2[4-9].*|v[3-9][0-9].*) export PATH="$(dirname "$dsh_node_candidate"):$PATH"; break;; esac; fi; done; ';
export async function probeHost(host, { sshExecutable = defaultSshExecutable(), spawnProcess = spawn } = {}) {
  validateTarget(host.target);
  const command = runtimePrelude + 'printf "os="; uname -s; printf "arch="; uname -m; printf "node="; if command -v node >/dev/null 2>&1; then node --version; else printf "missing\\n"; fi; printf "npm="; if command -v npm >/dev/null 2>&1; then npm --version; else printf "missing\\n"; fi; printf "base64="; if command -v base64 >/dev/null 2>&1; then printf "present\\n"; else printf "missing\\n"; fi; printf "backend="; if test -r "$HOME/.dsh-remote-modern/endpoint.json"; then printf "present\\n"; else printf "absent\\n"; fi';
  const args = sshOptions({ probe: true });
  if (host.port) args.push('-p', String(host.port));
  args.push('--', host.target, command);
  return new Promise((resolve, reject) => {
    const child = spawnProcess(sshExecutable, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = '', error = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('SSH 检测超时')); }, 30000);
    child.stdout.on('data', chunk => { output = (output + chunk).slice(-4096); });
    child.stderr.on('data', chunk => { error = (error + chunk).slice(-2048); });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) { reject(new Error(error || 'SSH 检测失败')); return; }
      const facts = Object.fromEntries(output.trim().split(/\r?\n/).filter(line => line.includes('=')).map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
      const ready = facts.os === 'Linux' && Number(/^v(\d+)/.exec(facts.node)?.[1]) >= 24 && facts.npm !== 'missing' && facts.base64 === 'present';
      resolve({ facts, ready, message: ready ? 'SSH 和运行前提已就绪；未改动远端文件' : 'SSH 可连接，但运行前提尚未满足；未改动远端文件' });
    });
  });
}
export async function unusedPort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve)); return port;
}
export async function bootstrapCommand() {
  const { createHash } = await import('node:crypto');
  const files = {};
  for (const name of ['remote-reader.js', 'reader-tool.js', 'session-reader.js', 'session-reference.js']) {
    files[name] = await readFile(new URL('./' + name, import.meta.url), 'utf8');
  }
  const revision = createHash('sha256').update('0.2.1:content-named-modules').update(JSON.stringify(files)).digest('hex');
  files['remote-reader.js'] = files['remote-reader.js'].replace("'development'", JSON.stringify(revision));
  // Profile reconciliation reloads changed entry URLs. Give the companion and
  // its dependencies content-qualified names so an upgrade cannot reuse the
  // previous Node module graph under the same installed package directory.
  const packaged = Object.fromEntries(Object.entries(files).map(([name, source]) => [
    `${revision}-${name}`, source.replace(/from '\.\/([^']+)'/g, (_match, dependency) => `from './${revision}-${dependency}'`),
  ]));
  packaged['package.json'] = JSON.stringify({ name: 'dsh-remote-session-reader', version: '0.2.1', type: 'module',
    main: `./${revision}-remote-reader.js`, engines: { dsh: '0.2.1-rc.2' },
    dsh: { manifestVersion: 1, bundle: { patch: './cordis.patch.yml' } } });
  packaged['cordis.patch.yml'] = `- insert:\n    - id: ssh-session-reader\n      name: ./${revision}-remote-reader.js\n      inject: [connection, tools, sessionController]\n`;
  const source = Buffer.from(`const readerBundle = ${JSON.stringify({ revision, files: packaged })};\n` + await readFile(new URL('./remote-bootstrap.cjs', import.meta.url), 'utf8'));
  const hash = (await import('node:crypto')).createHash('sha256').update(source).digest('hex');
  const shell = `set -eu; umask 077; ${runtimePrelude}command -v node >/dev/null || { echo 'Remote Node.js >=24 is required' >&2; exit 127; }; mkdir -p "$HOME/.dsh-remote-modern/bootstrap"; IFS= read -r payload; printf '%s' "$payload" | base64 -d > "$HOME/.dsh-remote-modern/bootstrap/${hash}.cjs"; exec node "$HOME/.dsh-remote-modern/bootstrap/${hash}.cjs" --watch`;
  return { command: "sh -c '" + shell.replaceAll("'", "'\\''") + "'", payload: source.toString('base64') + '\n' };
}
export async function openTunnel(host, { onProgress = () => {}, onClose = () => {}, spawnProcess = spawn, timeout = 720000, sshExecutable = defaultSshExecutable(), signal } = {}) {
  validateTarget(host.target);
  if (host.port != null && (!Number.isInteger(host.port) || host.port < 1 || host.port > 65535)) throw new Error('无效的 SSH 端口');
  const socksPort = await unusedPort();
  const boot = await bootstrapCommand();
  // Verify our SOCKS forwarding through gateway authentication rather than
  // failing on an unrelated RemoteForward inherited from the user's config.
  const args = [...sshOptions(), '-D', `127.0.0.1:${socksPort}`, '-o', 'ExitOnForwardFailure=no', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3'];
  if (host.port) args.push('-p', String(host.port));
  args.push('--', host.target, boot.command);
  const child = spawnProcess(sshExecutable, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let forward, closed = false, stderr = '';
  const abort = () => child.kill();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  child.once('close', () => signal?.removeEventListener('abort', abort));
  child.stdin.on('error', () => {});
  child.stdin.write(boot.payload);
  const ready = new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('远端安装或启动超时')); }, timeout);
    const fail = e => { clearTimeout(timer); reject(e); };
    child.on('error', fail);
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-3000); });
    child.stdout.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 65536) { child.kill(); fail(new Error('SSH 启动响应过长')); return; }
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim(); buffer = buffer.slice(index + 1);
        if (line.startsWith('DSH_SSH_PROGRESS ')) {
          const phase = line.slice(17);
          onProgress(phase);
          // OpenSSH may stay alive after the remote command exits while an
          // existing WebSocket keeps a forwarding channel open. End our local
          // carrier explicitly so the manager reconnects even in that case.
          if (phase === 'upgrading') child.kill();
        }
        if (line.startsWith('DSH_SSH_READY ')) {
          try {
            const endpoint = JSON.parse(line.slice(14));
            if (endpoint.version !== '0.2.1-rc.2' || !Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535 || typeof endpoint.token !== 'string' || !endpoint.token) throw new Error('远端后端返回了不兼容的 endpoint');
            clearTimeout(timer); resolve(endpoint);
          } catch (e) { child.kill(); fail(e); }
        }
      }
    });
    child.on('close', code => { fail(new Error(`SSH 已关闭 (${code})。${stderr.replace(/token=[^\s]+/g, 'token=[redacted]')}`)); if (!closed) onClose(); });
  });
  try {
    const endpoint = await ready;
    forward = await createSocksForward(0, socksPort, endpoint.port);
    return { endpoint, port: forward.server.address().port, close() {
      closed = true;
      for (const socket of forward.sockets) socket.destroy();
      forward.server.close(); child.kill();
    } };
  } catch (e) { closed = true; child.kill(); throw e; }
}
