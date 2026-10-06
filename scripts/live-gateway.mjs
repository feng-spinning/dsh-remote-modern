// Integration fixture: point the plugin's gateway at an already-running dsh
// backend, bypassing only the SSH transport. Useful for exercising the remote
// UI locally without touching a real server.
//
//   node scripts/live-gateway.mjs 'http://127.0.0.1:PORT/?token=TOKEN' [socksPort]
//
// The first argument must be an isolated loopback dsh authenticated URL. With
// a second argument, the upstream is reached through that local SOCKS port
// (the same shape the SSH transport produces). The authenticated gateway entry
// URL is written to .fixture-gateway.json.
import { Gateway } from '../src/gateway.js';
import { writeFile } from 'node:fs/promises';
import { createSocksForward } from '../lib/socks.js';
const upstream = new URL(process.argv[2]);
if (upstream.hostname !== '127.0.0.1' || !upstream.searchParams.get('token')) throw new Error('Expected an isolated loopback dsh authenticated URL');
const gateway = await new Gateway().start();
const forward = process.argv[3] ? await createSocksForward(0, Number(process.argv[3]), Number(upstream.port)) : null;
await gateway.attach({ port: forward?.server.address().port || Number(upstream.port), endpoint: { port: Number(upstream.port), token: upstream.searchParams.get('token') } });
await writeFile(new URL('../.fixture-gateway.json', import.meta.url), JSON.stringify({ url: gateway.entryUrl(), origin: gateway.origin }), { mode: 0o600 });
console.log('Real dsh gateway fixture ready:', gateway.origin);
process.on('SIGINT', async () => { await gateway.close(); if (forward) { for (const socket of forward.sockets) socket.destroy(); forward.server.close(); } process.exit(0); });
