// When each prompt and each reply was made, from a session's transcript (2026-11-01). The terminal shows these times in a
// column beside the `>` prompt lines and `⏺` reply lines (term-stamps.js, Mac app and phone).
// 2026-11-16: the first read covers the last 64 MB (was 8 MB: a session full of screenshots and long tool output — GCX
// Mesh, 54 MB — had only its last ~40 minutes inside 8 MB, so its older prompts showed no time). After that only the
// bytes appended since the last read are parsed, so a growing transcript costs almost nothing to keep up to date.
// Lines over 512 KB (pasted images, huge tool results) are skipped without parsing: they never hold a prompt line.
const fs = require('fs');

const FIRST_BYTES = 64 * 1024 * 1024, BIG_LINE = 512 * 1024, KEEP = 3000;
const cache = new Map();   // file → { size, out }

// the same normalisation the phone applies to a terminal line: no markdown marks, single spaces, lower case
const norm = s => String(s || '').replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/[`*_#>❯⏺•●]/g, '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 80);

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(b => b && b.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n');
}

function parse(lines, out) {
  for (const l of lines) {
    if (!l || l.length > BIG_LINE || (l.indexOf('"type":"user"') < 0 && l.indexOf('"type":"assistant"') < 0)) continue;
    let j; try { j = JSON.parse(l); } catch { continue; }
    if ((j.type !== 'user' && j.type !== 'assistant') || j.isMeta || j.isSidechain || !j.timestamp || !j.message) continue;
    const raw = textOf(j.message.content); if (!raw) continue;
    if (j.type === 'user' && /^\s*<(command-|local-command|system-reminder|bash-|task-notification)/.test(raw)) continue;
    const x = norm(raw.split('\n').find(s => s.trim()) || ''); if (x.length < 2) continue;
    const t = Date.parse(j.timestamp); if (!t) continue;
    out.push({ t, k: j.type === 'user' ? 'u' : 'a', x });
  }
}

function readRange(file, start, end) {
  const len = end - start, buf = Buffer.alloc(len);
  const fd = fs.openSync(file, 'r'); try { fs.readSync(fd, buf, 0, len, start); } finally { fs.closeSync(fd); }
  return buf.toString('utf8');
}

// → [{ t: epoch ms, k: 'u' (prompt) | 'a' (reply), x: normalised first words }], oldest first
function stampsFor(file) {
  if (!file) return [];
  let st; try { st = fs.statSync(file); } catch { return []; }
  const c = cache.get(file);
  if (c && c.size === st.size) return c.out;
  let out, size;
  if (c && st.size > c.size) {                                   // grew: parse only the complete lines appended since
    const text = readRange(file, c.size, st.size), cut = text.lastIndexOf('\n');
    if (cut < 0) return c.out;                                    // no complete new line yet
    out = c.out.slice(); parse(text.slice(0, cut).split('\n'), out); size = c.size + Buffer.byteLength(text.slice(0, cut + 1));
  } else {                                                       // first read, or the file was replaced
    const start = Math.max(0, st.size - FIRST_BYTES), text = readRange(file, start, st.size), cut = text.lastIndexOf('\n');
    const lines = text.slice(0, cut + 1).split('\n'); if (start > 0) lines.shift();   // the first line may be cut
    out = []; parse(lines, out); size = start + Buffer.byteLength(text.slice(0, cut + 1));
  }
  const res = out.length > KEEP ? out.slice(-KEEP) : out;
  cache.set(file, { size, out: res });
  return res;
}

module.exports = { stampsFor, norm };
