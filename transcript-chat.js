// A session's conversation as chat messages, for the chat theme (renderer/chat-theme.js, 2026-11-15).
// Reads only the end of the transcript (they grow to tens of MB) and caches per file size.
//   chatFor(file, n) → [{ id, t: epoch ms, k: 'u' (your prompt) | 'a' (reply) | 'tool', x: text }], oldest first
// Skipped: meta lines, sidechains (sub-agents), tool results, system reminders and hook output.
const fs = require('fs');

const MAX_BYTES = 2 * 1024 * 1024, MAX_TEXT = 4000;
const cache = new Map();   // file → { size, out }

// one line per tool call: its name and the most telling bit of its input
function toolLine(b) {
  const i = b.input || {}, name = String(b.name || 'tool').replace(/^mcp__([^_]+(?:_[^_]+)*)__/, '$1 · ');
  const pick = i.description || i.command || i.file_path || i.path || i.pattern || i.query || i.url || i.skill || i.prompt || i.subject || '';
  const s = String(typeof pick === 'string' ? pick : JSON.stringify(pick)).replace(/\s+/g, ' ').trim();
  return s ? name + '  ' + s.slice(0, 140) : name;
}

function userText(c) {
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  const parts = [];
  for (const b of c) {
    if (!b) continue;
    if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
    else if (b.type === 'image') parts.push('[image]');
  }
  return parts.join('\n');
}

function chatFor(file, n) {
  n = Math.max(1, Math.min(400, +n || 150));
  if (!file) return [];
  let st; try { st = fs.statSync(file); } catch { return []; }
  const c = cache.get(file); if (c && c.size === st.size) return c.out.slice(-n);
  const start = Math.max(0, st.size - MAX_BYTES), len = st.size - start, buf = Buffer.alloc(len);
  const fd = fs.openSync(file, 'r'); try { fs.readSync(fd, buf, 0, len, start); } finally { fs.closeSync(fd); }
  const lines = buf.toString('utf8').split('\n'); if (start > 0) lines.shift();   // the first line may be cut
  const out = [];
  for (const l of lines) {
    if (!l || (l.indexOf('"type":"user"') < 0 && l.indexOf('"type":"assistant"') < 0)) continue;
    let j; try { j = JSON.parse(l); } catch { continue; }
    if ((j.type !== 'user' && j.type !== 'assistant') || j.isMeta || j.isSidechain || j.isCompactSummary || !j.message) continue;
    const t = Date.parse(j.timestamp) || 0, id = j.uuid || String(out.length);
    if (j.type === 'user') {
      let x = userText(j.message.content).trim(); if (!x) continue;
      const cmd = /<command-name>\/?([^<]+)<\/command-name>/.exec(x);
      if (cmd) { const a = /<command-args>([\s\S]*?)<\/command-args>/.exec(x); x = '/' + cmd[1].trim() + (a && a[1].trim() ? ' ' + a[1].trim() : ''); }
      else if (/^\s*<(local-command|system-reminder|bash-|task-notification|user-prompt-submit-hook)/.test(x) || /^Caveat: The messages below/.test(x)) continue;
      else if (/^\[Request interrupted/.test(x)) { out.push({ id, t, k: 'tool', x: 'Interrupted' }); continue; }
      x = x.replace(/<\/?pasted_content[^>]*>/g, '').trim(); if (!x) continue;
      out.push({ id, t, k: 'u', x: x.slice(0, MAX_TEXT) });
    } else {
      const cs = Array.isArray(j.message.content) ? j.message.content : [];
      cs.forEach((b, i) => {
        if (!b) return;
        if (b.type === 'text' && b.text && b.text.trim()) out.push({ id: id + ':' + i, t, k: 'a', x: b.text.trim().slice(0, MAX_TEXT) });
        else if (b.type === 'tool_use') out.push({ id: id + ':' + i, t, k: 'tool', x: toolLine(b) });
      });
    }
  }
  const res = out.slice(-400);
  cache.set(file, { size: st.size, out: res });
  if (cache.size > 40) cache.delete(cache.keys().next().value);
  return res.slice(-n);
}

module.exports = { chatFor };
