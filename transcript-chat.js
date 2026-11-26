// A session's conversation as chat messages, for the chat theme (renderer/chat-theme.js, 2026-11-15).
// Reads only the end of the transcript (they grow to tens of MB) and caches per file size.
//   chatFor(file, n) → [{ id, t: epoch ms, k: 'u' (your prompt) | 'a' (reply) | 'tool', x: text,
//                        imgs?: [{ key }], files?: [{ p, name, size }] }], oldest first
// Skipped: meta lines, sidechains (sub-agents), tool results, system reminders and hook output.
// Attachments (2026-11-26): a prompt's pasted pictures (image blocks, kept in the transcript as base64) become
// imgs keys 'b:<uuid>:<block>'; file paths at the start or end of a prompt (the chat room's + button, a drop or a paste
// puts them there) and any pasted-image path become imgs 'f:<path>' (pictures) or files with their size (-1 = missing).
//   mediaFor(file, key, full) → { url (data URL), w, h } | null: the picture, scaled down (thumb 480 px, full 2400 px).
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_BYTES = 2 * 1024 * 1024, MAX_TEXT = 4000;
const cache = new Map();   // file → { size, out }

// one line per tool call: its name and the most telling bit of its input
function toolLine(b) {
  const i = b.input || {}, name = String(b.name || 'tool').replace(/^mcp__([^_]+(?:_[^_]+)*)__/, '$1 · ');
  const pick = i.description || i.command || i.file_path || i.path || i.pattern || i.query || i.url || i.skill || i.prompt || i.subject || '';
  const s = String(typeof pick === 'string' ? pick : JSON.stringify(pick)).replace(/\s+/g, ' ').trim();
  return s ? name + '  ' + s.slice(0, 140) : name;
}

// a prompt's text and the indexes of its image blocks
function userText(c) {
  if (typeof c === 'string') return { x: c, imgs: [] };
  if (!Array.isArray(c)) return { x: '', imgs: [] };
  const parts = [], imgs = [];
  c.forEach((b, i) => {
    if (!b) return;
    if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
    else if (b.type === 'image' && b.source && b.source.type === 'base64') imgs.push(i);
  });
  return { x: parts.join('\n'), imgs };
}

const IMG_EXT = /\.(png|jpe?g|gif|webp|heic|bmp|tiff?)$/i, PASTE_RE = /[\\/]claude-mesh-paste[\\/]/;
const HOME = os.homedir();
const expand = p => p.replace(/^~(?=\/)/, HOME);
// whitespace-separated tokens, quoted ones kept whole, with their positions
function tokens(x) {
  const out = [], re = /"([^"\n]+)"|'([^'\n]+)'|(\S+)/g; let m;
  while ((m = re.exec(x))) out.push({ v: m[1] || m[2] || m[3], a: m.index, b: m.index + m[0].length });
  return out;
}
const pathLike = v => /^(\/|~\/)[^\0]*[^/]\.[A-Za-z0-9]{1,8}$/.test(v) && !/^\/\//.test(v) && v.length < 1024;
// attached files: the run of paths at the start, the run at the end, and pasted pictures anywhere
function attachments(x) {
  const tk = tokens(x), take = new Set();
  for (let i = 0; i < tk.length && pathLike(tk[i].v); i++) take.add(i);
  for (let i = tk.length - 1; i >= 0 && pathLike(tk[i].v); i--) take.add(i);
  tk.forEach((t, i) => { if (pathLike(t.v) && PASTE_RE.test(t.v)) take.add(i); });
  if (!take.size) return null;
  let rest = '', at = 0; const imgs = [], files = [];
  tk.forEach((t, i) => {
    if (!take.has(i)) return;
    rest += x.slice(at, t.a); at = t.b;
    const p = expand(t.v); let st = null; try { st = fs.statSync(p); } catch { }
    if (st && !st.isFile()) { rest += t.v; return; }                     // a folder stays text
    if (st && IMG_EXT.test(p)) imgs.push({ key: 'f:' + p });
    else files.push({ p, name: path.basename(p), size: st ? st.size : -1 });
  });
  rest += x.slice(at);
  return { x: rest.replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim(), imgs, files };
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
    if ((j.type !== 'user' && j.type !== 'assistant') || j.isSidechain || j.isCompactSummary || !j.message) continue;
    const t = Date.parse(j.timestamp) || 0, id = j.uuid || String(out.length);
    if (j.isMeta) {   // "[Image: source: <path>]" after a prompt: the picture's file, used when the prompt carries no image block
      const u = userText(j.message.content), m = /^\[Image: source: (.+)\]$/.exec(u.x.trim()), last = out[out.length - 1];
      if (m && last && last.k === 'u' && !(last.imgs || []).some(i => i.key.startsWith('b:'))) (last.imgs = last.imgs || []).push({ key: 'f:' + m[1].trim() });
      continue;
    }
    if (j.type === 'user') {
      const u = userText(j.message.content);
      let x = u.x.trim(); if (!x && !u.imgs.length) continue;
      const cmd = /<command-name>\/?([^<]+)<\/command-name>/.exec(x);
      if (cmd) { const a = /<command-args>([\s\S]*?)<\/command-args>/.exec(x); x = '/' + cmd[1].trim() + (a && a[1].trim() ? ' ' + a[1].trim() : ''); }
      else if (/^\s*<(local-command|system-reminder|bash-|task-notification|user-prompt-submit-hook)/.test(x) || /^Caveat: The messages below/.test(x)) continue;
      else if (/^\[Request interrupted/.test(x)) { out.push({ id, t, k: 'tool', x: 'Interrupted' }); continue; }
      x = x.replace(/<\/?pasted_content[^>]*>/g, '').replace(/\[Image #\d+\]/g, '').replace(/[ \t]{2,}/g, ' ').trim();
      const item = { id, t, k: 'u', x };
      if (u.imgs.length) item.imgs = u.imgs.map(i => ({ key: 'b:' + id + ':' + i }));
      const at = attachments(x);
      if (at) { item.x = at.x; if (at.imgs.length) item.imgs = (item.imgs || []).concat(at.imgs); if (at.files.length) item.files = at.files; }
      if (!item.x && !item.imgs && !item.files) continue;
      item.x = item.x.slice(0, MAX_TEXT);
      out.push(item);
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

// ---------- pictures ----------
const MAX_SCAN = 64 * 1024 * 1024, MAX_FILE = 40 * 1024 * 1024;
const media = new Map(); let mediaBytes = 0;        // key|full → result, at most ~40 MB of data URLs
// the base64 data of image block `i` of the message `uuid` (searched backwards from the end of the transcript)
function blockData(file, uuid, i) {
  let st; try { st = fs.statSync(file); } catch { return null; }
  const fd = fs.openSync(file, 'r'), needle = Buffer.from('"uuid":"' + uuid + '"'), CH = 8 * 1024 * 1024;
  const read = (pos, len) => { const b = Buffer.alloc(len); const n = fs.readSync(fd, b, 0, len, pos); return b.subarray(0, n); };
  try {
    let hit = -1;
    for (let end = st.size; end > 0 && st.size - end < MAX_SCAN && hit < 0;) {
      const start = Math.max(0, end - CH), k = read(start, end - start).lastIndexOf(needle);
      if (k >= 0) hit = start + k; else if (start === 0) break; else end = start + needle.length;
    }
    if (hit < 0) return null;
    let s0 = 0;                                                        // the line's start: the newline before the hit
    for (let end = hit; end > 0;) { const start = Math.max(0, end - CH), nl = read(start, end - start).lastIndexOf(10); if (nl >= 0) { s0 = start + nl + 1; break; } end = start; if (hit - start > 48e6) return null; }
    let e0 = st.size;                                                  // and its end
    for (let pos = hit; pos < st.size;) { const c = read(pos, Math.min(CH, st.size - pos)), nl = c.indexOf(10); if (nl >= 0) { e0 = pos + nl; break; } pos += c.length; }
    if (e0 - s0 > 48e6) return null;
    const j = JSON.parse(read(s0, e0 - s0).toString('utf8')), b = j.message && Array.isArray(j.message.content) && j.message.content[i];
    return b && b.type === 'image' && b.source && b.source.data ? { data: Buffer.from(b.source.data, 'base64'), mt: b.source.media_type || 'image/png' } : null;
  } catch { return null; } finally { fs.closeSync(fd); }
}
function encode(buf, mt, full) {
  const { nativeImage } = require('electron');
  let img = nativeImage.createFromBuffer(buf); if (img.isEmpty()) return null;
  const { width: w, height: h } = img.getSize(), max = full ? 2400 : 480;
  if (full && buf.length <= 3e6 && w <= max && h <= max && /^image\/(png|jpeg|gif|webp)$/.test(mt)) return { url: `data:${mt};base64,${buf.toString('base64')}`, w, h };
  const scale = Math.min(1, max / Math.max(w, h));
  if (scale < 1) img = img.resize({ width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)), quality: 'good' });
  let out = img.toJPEG(full ? 88 : 80);
  if (!full && out.length > 220e3) out = img.resize({ width: Math.round(img.getSize().width * .7), quality: 'good' }).toJPEG(72);
  return { url: 'data:image/jpeg;base64,' + out.toString('base64'), w, h };
}
const mimeOf = p => ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff' })[path.extname(p).slice(1).toLowerCase()] || 'image/png';
function fileImage(p, full) {
  p = expand(String(p || '')); if (!IMG_EXT.test(p)) return null;
  let st; try { st = fs.statSync(p); } catch { return null; } if (!st.isFile() || st.size > MAX_FILE) return null;
  try { return encode(fs.readFileSync(p), mimeOf(p), full); } catch { return null; }
}
// a picture named by a chat item of this transcript (only keys the transcript itself produced)
function mediaFor(file, key, full) {
  key = String(key || ''); full = !!full;
  const ck = file + '|' + key + '|' + (full ? 1 : 0); if (media.has(ck)) { const v = media.get(ck); media.delete(ck); media.set(ck, v); return v; }
  if (!file || !chatFor(file, 400).some(m => (m.imgs || []).some(i => i.key === key))) return null;
  let r = null;
  if (key.startsWith('b:')) { const m = /^b:(.+):(\d+)$/.exec(key), d = m && blockData(file, m[1], +m[2]); if (d) try { r = encode(d.data, d.mt, full); } catch { } }
  else if (key.startsWith('f:')) r = fileImage(key.slice(2), full);
  if (r) { media.set(ck, r); mediaBytes += r.url.length; while (mediaBytes > 40e6 && media.size > 1) { const [k0, v0] = media.entries().next().value; media.delete(k0); mediaBytes -= v0.url.length; } }
  return r;
}

module.exports = { chatFor, mediaFor, fileImage, attachments };
