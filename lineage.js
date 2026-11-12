// Session lineage (2026-11-13): a session refreshed from a handoff (nightly, context cap, idle park, Refresh now) is the
// same piece of work in a new conversation. Every generation of it shares one lineage id, so the token board shows one row
// per logical session instead of one per conversation.
// Stored next to the handoff, <handoffs>/<session name>/lineage.json:
//   { lid, name, machine, gens: [{ sid, gen, start, end, why }] }   (start/end in ms; end is set when the next one takes over)
// The handoff itself carries the id too (a "Lineage:" line under its title), so a session started by hand from it can keep it.
// Backfill (once): the refresh log's DONE lines (old → new, by name) and sessions with the same name on the same Mac.
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const slug = n => String(n).replace(/[^\p{L}\p{N}_.()-]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'session';
const fileOf = (dir, name) => path.join(dir, slug(name), 'lineage.json');
const newLid = () => 'L-' + crypto.randomBytes(5).toString('hex');

function read(dir, name) { try { return JSON.parse(fs.readFileSync(fileOf(dir, name), 'utf8')); } catch { return null; } }
function write(dir, l) { const f = fileOf(dir, l.name); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(l, null, 1)); return l; }

// every lineage under <dir>: [{ lid, name, machine, gens }]
function all(dir) {
  const out = []; let ds = []; try { ds = fs.readdirSync(dir); } catch { return out; }
  for (const d of ds) { try { const l = JSON.parse(fs.readFileSync(path.join(dir, d, 'lineage.json'), 'utf8')); if (l && l.lid && Array.isArray(l.gens)) out.push(l); } catch { } }
  return out;
}
// sid → { lid, gen, name, why }
function index(dir) {
  const m = new Map();
  for (const l of all(dir)) for (const g of l.gens) m.set(g.sid, { lid: l.lid, gen: g.gen, name: l.name, why: g.why || '', start: g.start || 0, end: g.end || 0 });
  return m;
}

// a refresh swapped `from` for `to`: the new one is the next generation of the old one's lineage
function record(dir, { name, machine, from, to, why, at = Date.now(), fromStart = 0 }) {
  const l = read(dir, name) || { lid: newLid(), name, machine, gens: [] };
  if (!l.gens.some(g => g.sid === from)) l.gens.push({ sid: from, gen: (l.gens.reduce((n, g) => Math.max(n, g.gen), 0) || 0) + 1, start: fromStart || 0, end: at, why: l.gens.length ? 'restarted outside a Mesh refresh' : 'first' });
  const old = l.gens.find(g => g.sid === from); if (!old.end) old.end = at;
  if (!l.gens.some(g => g.sid === to)) l.gens.push({ sid: to, gen: old.gen + 1, start: at, end: 0, why });
  l.machine = l.machine || machine; write(dir, l);
  const g = l.gens.find(x => x.sid === to); return { lid: l.lid, gen: g.gen };
}
// the lineage a session belongs to (or a new one with this session as generation 1)
function ensure(dir, { name, machine, sid, start = Date.now() }) {
  const l = read(dir, name) || { lid: newLid(), name, machine, gens: [] };
  let g = l.gens.find(x => x.sid === sid);
  if (!g) { g = { sid, gen: (l.gens.reduce((n, x) => Math.max(n, x.gen), 0) || 0) + 1, start, end: 0, why: l.gens.length ? 'restarted by hand' : 'first' }; l.gens.push(g); write(dir, l); }
  return { lid: l.lid, gen: g.gen };
}
// the "Lineage:" line in a handoff (kept when the handoff is rewritten: the next refresh puts it back)
function stamp(handoff, lid, gen, prevSid) {
  try {
    let t = fs.readFileSync(handoff, 'utf8'); const line = `Lineage: ${lid} · generation ${gen}${prevSid ? ` (after ${prevSid.slice(0, 8)})` : ''}`;
    t = /^Lineage: L-[0-9a-f]+.*$/m.test(t) ? t.replace(/^Lineage: L-[0-9a-f]+.*$/m, line) : t.replace(/^(#[^\n]*\n)?/, m => m + line + '\n');
    fs.writeFileSync(handoff, t); return true;
  } catch { return false; }
}

// One-time backfill. logs: refresh log files. known: [{ sid, name, machine, first, last }] sessions of this Mac (usage db).
// Chains from DONE lines ("DONE  <name>: <old13> → <new13> in"), then every session of this Mac whose name is a
// lineage's name joins it (manual restarts, and generations named by Claude's own title before Mesh renamed them are
// caught by the chain). Returns what it did, for the report.
function backfill(dir, { logs = [], known = [], machine, since = 0 }) {
  const byPrefix = p => known.filter(k => k.sid.startsWith(p.replace(/-$/, '')));
  const lines = [];
  for (const f of logs) {
    const started = {};                    // "START <name> (<engine>, <why>)" comes before its DONE line
    try { for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
      const s = /^\S+ \S+ START (.+) \([^(),]*, ([^()]+)\)$/.exec(l); if (s) started[s[1]] = s[2];
      const m = /^(\S+ \S+) DONE\s+(.+?): (\S+) → (\S+) in /.exec(l); if (m) lines.push({ at: Date.parse(m[1].replace(' ', 'T')) || 0, name: m[2], from: m[3], to: m[4], why: started[m[2]] || 'refresh' });
    } } catch { } }
  lines.sort((a, b) => a.at - b.at);
  const made = new Map(), unresolved = [];
  const get = name => made.get(name) || made.set(name, read(dir, name) || { lid: newLid(), name, machine, gens: [] }).get(name);
  for (const x of lines) {
    if (x.at < since) continue;
    const f = byPrefix(x.from), t = byPrefix(x.to);
    if (f.length !== 1 || t.length !== 1) { unresolved.push(`${x.name}: ${x.from} → ${x.to}`); continue; }
    const l = get(x.name), add = (k, why) => { if (!l.gens.some(g => g.sid === k.sid)) l.gens.push({ sid: k.sid, gen: 0, start: k.first || 0, end: 0, why }); };
    add(f[0], 'restarted outside a Mesh refresh'); add(t[0], 'refresh');
    const tg = l.gens.find(g => g.sid === t[0].sid); tg.start = tg.start || x.at; const fg = l.gens.find(g => g.sid === f[0].sid); fg.end = x.at;
    tg.why = x.why;
  }
  // same name, same Mac: the same work restarted by hand
  const names = new Set([...made.keys(), ...all(dir).map(l => l.name)]);
  for (const k of known) {
    if (!k.name || !names.has(k.name) || k.machine !== machine || (k.last || 0) < since) continue;
    const l = get(k.name); if (!l.gens.some(g => g.sid === k.sid)) l.gens.push({ sid: k.sid, gen: 0, start: k.first || 0, end: k.last || 0, why: 'same name' });
  }
  for (const l of made.values()) {
    l.gens.sort((a, b) => (a.start || 0) - (b.start || 0)); l.gens.forEach((g, i) => { g.gen = i + 1; if (i === 0) g.why = 'first'; });
    write(dir, l);
  }
  return { lineages: made.size, gens: [...made.values()].reduce((n, l) => n + l.gens.length, 0), unresolved };
}

// a generation ended without a successor yet (idle park): its end time
function close(dir, name, sid, at = Date.now()) { const l = read(dir, name); const g = l && l.gens.find(x => x.sid === sid); if (g) { g.end = at; write(dir, l); } }

module.exports = { slug, all, index, record, ensure, stamp, close, backfill, read, fileOf };
