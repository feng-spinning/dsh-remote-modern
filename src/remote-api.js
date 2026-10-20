import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import WebSocket from 'ws';

// The gateway supplies credentials only in memory; none are returned to the UI.
export function remoteCall(upstream, cookie, endpoint, args, signal = AbortSignal.timeout(15000)) {
  return new Promise((resolve, reject) => {
    const rpcId = randomUUID();
    const body = JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload: { args } });
    const req = request({
      host: '127.0.0.1', port: upstream.port, path: '/api/' + endpoint, method: 'POST', signal,
      headers: { host: upstream.authority, cookie, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    }, res => {
      let bytes = 0;
      const chunks = [];
      res.on('error', reject);
      res.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 8 * 1024 * 1024) req.destroy(new Error('远端响应过大'));
        else chunks.push(chunk);
      });
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) throw new Error(`远端 API 返回 HTTP ${res.statusCode}`);
          const reply = JSON.parse(Buffer.concat(chunks));
          if (reply.rpcId !== rpcId || reply.type !== 'server-response') throw new Error('远端 RPC 响应不匹配');
          if (!reply.result?.ok) throw new Error(reply.result?.error?.message || '远端 API 调用失败');
          resolve(reply.result.value);
        } catch (error) { reject(error); }
      });
    });
    req.on('error', reject); req.end(body);
  });
}

export function remoteFirst(upstream, cookie, endpoint, args, signal = AbortSignal.timeout(15000)) {
  return new Promise((resolve, reject) => {
    const streamId = randomUUID();
    const ws = new WebSocket(`ws://127.0.0.1:${upstream.port}/api/remote.mux`, {
      headers: { host: upstream.authority, cookie, origin: 'http://' + upstream.authority }, maxPayload: 8 * 1024 * 1024,
    });
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; signal.removeEventListener('abort', abort);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'cancel', streamId }));
        ws.close();
      } else ws.terminate();
      error ? reject(error) : resolve(value);
    };
    const abort = () => finish(signal.reason || new Error('远端读取已取消'));
    signal.addEventListener('abort', abort, { once: true });
    ws.on('error', error => finish(error));
    ws.on('close', () => finish(new Error('远端数据流提前关闭')));
    ws.on('open', () => ws.send(JSON.stringify({ type: 'open', streamId, endpoint, payload: { args } })));
    ws.on('message', raw => {
      try {
        const frame = JSON.parse(raw);
        if (frame.streamId !== streamId) return;
        if (frame.type === 'item') finish(null, frame.value);
        else if (frame.type === 'error') finish(new Error(frame.error?.message || '远端读取失败'));
        else if (frame.type === 'end') finish(new Error('远端没有返回数据'));
      } catch (error) { finish(error); }
    });
    if (signal.aborted) abort();
  });
}
