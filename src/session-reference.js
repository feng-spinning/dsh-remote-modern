// Host identity travels with the session ID; never guess a host from an ID.
export function sessionReference(sessionId, hostId = 'local') {
  if (typeof sessionId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(sessionId)) throw new Error('无效的 Session ID');
  if (typeof hostId !== 'string' || !hostId || hostId.length > 256) throw new Error('无效的主机标识');
  return `dsh://sessions/${sessionId}?hostId=${encodeURIComponent(hostId)}`;
}

export function parseSessionReference(value) {
  if (typeof value !== 'string' || !/^dsh:\/\/sessions\/[a-zA-Z0-9_-]{1,128}\?/.test(value)) throw new Error('无效的 DSH 会话链接');
  let url;
  try { url = new URL(value); } catch { throw new Error('请使用带 hostId 的 dsh://sessions/ 会话链接'); }
  const sessionId = url.pathname.slice(1);
  const hostId = url.searchParams.get('hostId');
  if (url.protocol !== 'dsh:' || url.hostname !== 'sessions' || url.username || url.password || url.port || url.hash
    || !hostId || [...url.searchParams.keys()].some(key => key !== 'hostId') || url.searchParams.getAll('hostId').length !== 1) {
    throw new Error('无效的 DSH 会话链接');
  }
  return { sessionId, hostId, reference: sessionReference(sessionId, hostId) };
}

export function findSessionReferences(text) {
  const refs = new Map();
  for (const match of String(text).matchAll(/dsh:\/\/sessions\/[a-zA-Z0-9_-]{1,128}\?[a-zA-Z0-9_.~%:@+&=-]+/g)) {
    const ref = parseSessionReference(match[0].replace(/[.,;:，。；：!?！？]+$/, ''));
    refs.set(ref.reference, ref);
  }
  return [...refs.values()];
}

function textParts(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(part => part?.type === 'text' && typeof part.text === 'string'
    && !part.text.startsWith('\n<dsh_session_references>\n')).map(part => part.text).join('\n');
}

// Only human/assistant text, never credentials, tool outputs, reasoning or binary attachments.
export function referenceExcerpt(snapshot, maxChars = 24000) {
  const messages = [];
  for (const record of snapshot.records || []) {
    const event = record.event;
    if (!event || !['user/message', 'assistant/message'].includes(event.type)) continue;
    const data = event.data ?? event;
    // DSH also stores runtime context, skills and agent instructions as
    // user/message events. Only actual user submissions are conversation text.
    if (event.type === 'user/message' && data.source?.kind !== 'user') continue;
    const text = textParts(data.content ?? data.message?.content ?? data.text);
    if (text) messages.push({ role: event.type === 'user/message' ? 'user' : 'assistant', text, seq: event.seq });
  }
  let remaining = maxChars;
  const selected = [];
  let truncated = !!snapshot.hasMore;
  for (const message of messages.toReversed()) {
    if (remaining <= 0) { truncated = true; break; }
    const text = message.text.length > remaining ? message.text.slice(-remaining) : message.text;
    if (text.length < message.text.length) truncated = true;
    selected.unshift({ ...message, text });
    remaining -= text.length;
  }
  return { messages: selected, truncated, cursor: snapshot.cursor, beforeSeq: snapshot.records?.[0]?.event?.seq };
}
