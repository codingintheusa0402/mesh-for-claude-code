// What each MCP server is doing (2026-11-01): reads the live sessions' transcripts for MCP tool calls
// (tool names `mcp__<server>__<tool>`), pairs each call with its result, and keeps the images a result returned
// (Blender "look" renders, browser screenshots …). The renderer shows one dockable panel per server
// (renderer/mcp-panels.js). Only the end of each transcript is read, cached by file size.
const fs = require('fs'), crypto = require('crypto');

const TAIL = 4 * 1024 * 1024, KEEP_H = 6, PER_SERVER = 80, MAX_IMAGES = 160;

function createMcpActivity({ findTranscript }) {
  const files = new Map();      // file → { size, calls }
  const images = new Map();     // image id → { mime, data }   (newest last; capped)

  const textOf = c => typeof c === 'string' ? c : Array.isArray(c) ? c.filter(b => b && b.type === 'text').map(b => b.text).join('\n') : '';
  const short = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  function keepImage(b) {
    const src = b && b.source; if (!src || src.type !== 'base64' || !src.data) return null;
    const id = crypto.createHash('sha1').update(src.data.slice(0, 4096) + src.data.length).digest('hex').slice(0, 16);
    if (!images.has(id)) { images.set(id, { mime: src.media_type || 'image/png', data: src.data }); while (images.size > MAX_IMAGES) images.delete(images.keys().next().value); }
    return id;
  }
  function inputSummary(inp) {
    if (!inp || typeof inp !== 'object') return '';
    const k = ['command', 'code', 'query', 'url', 'prompt', 'text', 'path', 'file_path', 'name', 'action', 'selector'].find(x => typeof inp[x] === 'string');
    return short(k ? `${k}: ${inp[k]}` : JSON.stringify(inp), 400);
  }
  function parse(file) {
    let st; try { st = fs.statSync(file); } catch { return []; }
    const c = files.get(file); if (c && c.size === st.size) return c.calls;
    const start = Math.max(0, st.size - TAIL), len = st.size - start, buf = Buffer.alloc(len);
    const fd = fs.openSync(file, 'r'); try { fs.readSync(fd, buf, 0, len, start); } finally { fs.closeSync(fd); }
    const lines = buf.toString('utf8').split('\n'); if (start > 0) lines.shift();
    const byId = new Map(), calls = [], since = Date.now() - KEEP_H * 3600e3;
    for (const l of lines) {
      if (!l || l.indexOf('mcp__') < 0 && l.indexOf('tool_result') < 0) continue;
      let j; try { j = JSON.parse(l); } catch { continue; }
      const t = Date.parse(j.timestamp || '') || 0; if (t < since) continue;
      const content = j.message && Array.isArray(j.message.content) ? j.message.content : [];
      for (const b of content) {
        if (b.type === 'tool_use' && typeof b.name === 'string' && b.name.startsWith('mcp__')) {
          const parts = b.name.split('__'), call = { id: b.id, server: parts[1] || '?', tool: parts.slice(2).join('__') || '?', t, input: inputSummary(b.input), state: 'running' };
          byId.set(b.id, call); calls.push(call);
        } else if (b.type === 'tool_result' && byId.has(b.tool_use_id)) {
          const call = byId.get(b.tool_use_id), parts = Array.isArray(b.content) ? b.content : [b.content];
          call.state = b.is_error ? 'error' : 'done'; call.done = t;
          call.result = short(textOf(b.content), 700);
          call.images = parts.filter(p => p && p.type === 'image').map(keepImage).filter(Boolean);
        }
      }
    }
    files.set(file, { size: st.size, calls });
    return calls;
  }
  // sessions: [{ sid, name }] (the live ones) → [{ id, calls: [...] newest first, last }]
  function activity(sessions) {
    const servers = new Map();
    for (const s of sessions || []) {
      const f = findTranscript(s.sid); if (!f) continue;
      for (const c of parse(f)) {
        let v = servers.get(c.server); if (!v) servers.set(c.server, v = { id: c.server, calls: [], last: 0, sessions: {} });
        v.calls.push({ ...c, sid: s.sid, session: s.name }); v.last = Math.max(v.last, c.t); v.sessions[s.sid] = s.name;
      }
    }
    return [...servers.values()].map(v => ({ ...v, sessions: Object.values(v.sessions), calls: v.calls.sort((a, b) => b.t - a.t).slice(0, PER_SERVER) })).sort((a, b) => b.last - a.last);
  }
  const image = id => { const im = images.get(id); return im ? `data:${im.mime};base64,${im.data}` : null; };
  return { activity, image };
}

module.exports = { createMcpActivity };
