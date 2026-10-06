// Diagnostic: check whether a remote host exposes DEEPSEEK_API_KEY to a
// non-interactive SSH shell. Runs the connector's own `modelEnvironment()`
// logic on the remote host in memory; nothing is written to the remote host
// and only `keyPresent: <boolean>` comes back.
//
//   node scripts/verify-remote-environment.mjs <ssh-alias-or-user@host>
//
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { defaultSshExecutable, runtimePrelude, sshOptions, validateTarget } from '../src/tunnel.js';

const host = process.argv[2];
if (!host) {
  console.error('usage: node scripts/verify-remote-environment.mjs <ssh-alias-or-user@host>');
  process.exit(2);
}
validateTarget(host);

const source = await readFile(new URL('../src/remote-bootstrap.cjs', import.meta.url), 'utf8');
const method = source.slice(source.indexOf('function modelEnvironment()'), source.indexOf('\nfunction endpoint()'));
const code = `const path=require('node:path'), os=require('node:os'); const {spawnSync}=require('node:child_process'); const state=process.env.DSH_HOME||path.join(os.homedir(),'.dsh');\n${method}\nconsole.log('MODEL_ENV_CHECK '+JSON.stringify({keyPresent:!!modelEnvironment().DEEPSEEK_API_KEY}));`;
const child = spawn(defaultSshExecutable(), [...sshOptions({ probe: true }), '--', host, runtimePrelude + 'node'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
child.stdin.end(code);
let output = '';
child.stdout.on('data', c => output += c);
child.stderr.on('data', c => process.stderr.write(c));
child.on('error', e => { throw e; });
child.on('exit', status => {
  if (status !== 0) process.exitCode = 1;
  const line = output.split('\n').find(l => l.startsWith('MODEL_ENV_CHECK '));
  if (!line) throw new Error('Missing environment check');
  console.log(line);
});
