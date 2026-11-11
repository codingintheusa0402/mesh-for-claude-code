// When each prompt and each reply was made, from a session's transcript (2026-11-01). The phone terminal shows these
// times in a column beside the `>` prompt lines and `⏺` reply lines (phone.js termStamps).
// Reads only the end of the transcript (they grow to tens of MB) and caches per file size.
const fs = require('fs');

const MAX_BYTES = 8 * 1024 * 1024;
const cache = new Map();   // file → { size, out }

// the same normalisation the phone applies to a terminal line: no markdown marks, single spaces, lower case
const norm = s => String(s || '').replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/[`*_#>❯⏺•●]/g, '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 80);

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(b => b && b.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n');
}

// → [{ t: epoch ms, k: 'u' (prompt) | 'a' (reply), x: normalised first words }], oldest first
function stampsFor(file) {
  if (!file) return [];
  let st; try { st = fs.statSync(file); } catch { return []; }
  const c = cache.get(file); if (c && c.size === st.size) return c.out;
  const start = Math.max(0, st.size - MAX_BYTES), len = st.size - start, buf = Buffer.alloc(len);
  const fd = fs.openSync(file, 'r'); try { fs.readSync(fd, buf, 0, len, start); } finally { fs.closeSync(fd); }
  const lines = buf.toString('utf8').split('\n'); if (start > 0) lines.shift();   // first line may be cut
  const out = [];
  for (const l of lines) {
    if (!l || (l.indexOf('"type":"user"') < 0 && l.indexOf('"type":"assistant"') < 0)) continue;
    let j; try { j = JSON.parse(l); } catch { continue; }
    if ((j.type !== 'user' && j.type !== 'assistant') || j.isMeta || j.isSidechain || !j.timestamp || !j.message) continue;
    const raw = textOf(j.message.content); if (!raw) continue;
    if (j.type === 'user' && /^\s*<(command-|local-command|system-reminder|bash-|task-notification)/.test(raw)) continue;
    const x = norm(raw.split('\n').find(s => s.trim()) || ''); if (x.length < 2) continue;
    const t = Date.parse(j.timestamp); if (!t) continue;
    out.push({ t, k: j.type === 'user' ? 'u' : 'a', x });
  }
  const res = out.slice(-1500);
  cache.set(file, { size: st.size, out: res });
  return res;
}

module.exports = { stampsFor, norm };
