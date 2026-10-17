// Linux process lifecycle test. The copied bootstrap only substitutes its
// global CLI path to isolate the fixture from the machine's installed DSH.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { until, sleep } from './helpers.js';
if (process.platform !== 'linux') throw new Error('Run this integration test on Linux (uses /proc process ownership).');
const root = await mkdtemp(join(tmpdir(), 'dsh-upgrade-'));
const globalDir = join(root,'global');
await mkdir(join(globalDir,'lib'),{recursive:true});
await mkdir(join(root,'bootstrap'));
const manifest = join(globalDir,'package.json');
await writeFile(manifest, JSON.stringify({version:'0.2.1-rc.2'}));
await writeFile(join(globalDir,'lib/bin.js'), `
const fs = require('node:fs');
const http = require('node:http');
fs.appendFileSync(process.env.DSH_REMOTE_MODERN_ROOT+'/starts', process.pid+'\\n');
const server = http.createServer((req,res)=>res.end('fixture '+process.pid));
server.listen(0,'127.0.0.1',()=>console.log('dsh web: http://127.0.0.1:'+server.address().port+'/?token=fixture'));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
`);
const source = (await readFile(new URL('../src/remote-bootstrap.cjs',import.meta.url),'utf8'))
  .replace("const globalCli = path.resolve(path.dirname(process.execPath), '../lib/node_modules/@deepseek-ai/dsh/lib/bin.js');", "const globalCli = path.join(root, 'global/lib/bin.js');");
assert.ok(source.includes("const globalCli = path.join(root, 'global/lib/bin.js');"));
const file = join(root,'bootstrap',createHash('sha256').update(source).digest('hex')+'.cjs');
await writeFile(file,source);
const watchers = [];
let latest;
function connect() {
  const child = spawn(process.execPath,[file,'--watch'],{env:{...process.env,DSH_HOME:join(root,'home'),DSH_REMOTE_MODERN_ROOT:root},stdio:['pipe','pipe','pipe']});
  const record = {child,output:'',error:'',exit:null}; watchers.push(record);
  child.stdout.on('data',data=>{
    record.output += data;
    const line = record.output.split('\n').find(line=>line.startsWith('DSH_SSH_READY '));
    if(line) record.endpoint = JSON.parse(line.slice(14));
  });
  child.stderr.on('data',data=>record.error+=data);
  child.on('exit',code=>{record.exit=code;});
  child.stdin.on('error',()=>{});
  return record;
}
async function ready(record) {
  await until(()=>{ if(record.exit !== null) throw new Error(record.error || 'attach exited'); return !!record.endpoint; },20000);
  return record.endpoint;
}
try {
  const first = connect(), peer = connect();
  const [before, same] = await Promise.all([ready(first),ready(peer)]); latest=before;
  assert.equal(before.pid,same.pid);
  assert.ok(before.supervisorStart && before.childStart);
  const privateCopy = join(root,'runtime/0.2.1-rc.2/node_modules/@deepseek-ai/dsh');
  await mkdir(privateCopy,{recursive:true});
  await cp(globalDir,privateCopy,{recursive:true});
  // npm's in-place replacement can leave the manifest unreadable temporarily.
  await writeFile(manifest,'{');
  await until(()=>first.exit===75 && peer.exit===75,16000);
  const replacement=connect(), concurrent=connect();
  await sleep(3000);
  assert.equal(replacement.endpoint,undefined);
  process.kill(before.childPid,0); // wait for a complete install before stopping
  await writeFile(manifest,JSON.stringify({version:'0.2.1-rc.2',installRevision:2}));
  const [after, shared] = await Promise.all([ready(replacement),ready(concurrent)]); latest=after;
  assert.notEqual(after.pid,before.pid);
  assert.equal(after.pid,shared.pid);
  assert.notEqual(after.cliFingerprint,before.cliFingerprint);
  assert.match(replacement.output+concurrent.output,/DSH_SSH_PROGRESS restarting/);
  assert.equal((await readFile(join(root,'starts'),'utf8')).trim().split('\n').length,2);
  assert.equal(await (await fetch('http://127.0.0.1:'+after.port)).text(),'fixture '+after.childPid);
  replacement.child.stdin.end(); concurrent.child.stdin.end();
  await until(()=>replacement.exit===0 && concurrent.exit===0,7000);
  process.kill(after.childPid,0);
  console.log('PASS: upgrade detection, incomplete-install wait, verified automatic restart, concurrent single replacement, and detach persistence.');
} finally {
  for(const w of watchers) {w.child.stdin.end(); if(w.exit===null) w.child.kill();}
  if(latest) {try{process.kill(latest.pid,'SIGTERM');}catch{}}
  await sleep(500);
  await rm(root,{recursive:true,force:true});
}
