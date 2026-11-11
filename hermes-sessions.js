// Hermes Agent sessions as full Mesh sessions (2026-11-07): bubble, live terminal, phone, mirror, rename, usage.
// Mesh starts each one in a tmux pane (so it survives app restarts and quiet updates) as
//   hermes chat --continue "<name>" --create-if-missing --yolo --accept-hooks
// and records pane -> name in <userData>/hermes-panes.json. The name finds Hermes' session id in ~/.hermes/state.db
// once; after that the id is kept (a /title rename or a context rollover to a child session doesn't lose it).
// What the session is doing comes from the shell hook ~/.hermes/agent-hooks/mesh_hook.py: ~/.hermes/mesh/<sid>.json.
// Tokens, model and the recent log come from state.db (read-only, sqlite3 CLI).
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const HOME = os.homedir();
const HH = process.env.HERMES_HOME || path.join(HOME, '.hermes');
const DB = path.join(HH, 'state.db');
const STATE = path.join(HH, 'mesh');
const BIN = ['/usr/bin/sqlite3', '/opt/homebrew/bin/sqlite3'].find(p => fs.existsSync(p)) || 'sqlite3';
const q = s => "'" + String(s).replace(/'/g, "''") + "'";
const TMUX = ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux'].find(p => fs.existsSync(p)) || 'tmux';
const TMUX_ENV = { ...process.env, LANG: 'en_US.UTF-8', LC_CTYPE: 'en_US.UTF-8' };

// Hermes' status bar shows the context in use, e.g. "~387K/1M · [████░░] ~37%": state.db has no per-call prompt size
const NUM = (n, u) => parseFloat(n) * ({ K: 1e3, M: 1e6 }[String(u).toUpperCase()] || 1);
function parseCtx(screen) {
  const lines = String(screen || '').split('\n').reverse();
  for (const l of lines) {
    if (!l.includes('%')) continue;   // only the status bar line, not numbers in the conversation
    const m = l.match(/~?\s*([\d.]+)\s*([KM]?)\s*\/\s*([\d.]+)\s*([KM])\b/i);
    if (m) { const used = NUM(m[1], m[2]), max = NUM(m[3], m[4]); if (max > 0 && used <= max * 1.05) return { used: Math.round(used), max: Math.round(max) }; }
  }
  return null;
}
const capture = pane => new Promise(res => execFile(TMUX, ['capture-pane', '-p', '-t', pane], { timeout: 4000, env: TMUX_ENV }, (e, so) => res(e ? '' : so)));

function sql(query) {
  return new Promise(res => execFile(BIN, ['-readonly', '-json', DB, query], { timeout: 8000, maxBuffer: 16e6 }, (err, so) => {
    if (err) return res(null);
    try { res(so.trim() ? JSON.parse(so) : []); } catch { res(null); }
  }));
}

module.exports = function createHermes({ userData }) {
  const REG = path.join(userData, 'hermes-panes.json');
  let reg = {}; try { reg = JSON.parse(fs.readFileSync(REG, 'utf8')) || {}; } catch { }
  const save = () => { try { fs.writeFileSync(REG, JSON.stringify(reg, null, 1)); } catch { } };
  const live = new Map();           // sid -> { row, msgs, usage, at }
  let lastRead = 0, reading = null; const gone = {}, ctxOf = {};   // ctxOf: pane -> { used, max, at }

  // a name no earlier Hermes session has, so --continue creates a new one instead of resuming an old one
  async function freshName(name) {
    name = String(name || 'Hermes').replace(/[\r\n"]/g, ' ').trim().slice(0, 80) || 'Hermes';
    const rows = await sql(`select title from sessions where title like ${q(name + '%')}`) || [];
    const used = new Set(rows.map(r => r.title)); let n = name, i = 2;
    while (used.has(n)) n = `${name} ${i++}`;
    return n;
  }
  function add(paneId, info) { reg[paneId] = { ...info, at: Date.now() }; save(); }
  function forget(paneId) { if (reg[paneId]) { delete reg[paneId]; save(); } }
  const has = paneId => !!reg[paneId];
  const sidOf = paneId => reg[paneId] && reg[paneId].sid;

  // Hermes moves a long conversation into a child session (parent_session_id) when it compacts: follow it
  async function newest(sid) {
    for (let i = 0; i < 20; i++) {
      const r = await sql(`select id from sessions where parent_session_id=${q(sid)} order by started_at desc limit 1`);
      if (!r || !r.length) return sid; sid = r[0].id;
    }
    return sid;
  }

  async function read(paneList) {
    const alive = new Map(paneList.map(p => [p.id, p]));
    let changed = false;
    // a pane closed: forget it only after it has been missing from several reads of a pane list that has panes in it
    // (2026-11-07: right after an app restart the list was still empty, and a running session was dropped)
    if (paneList.length) for (const id of Object.keys(reg)) {
      if (alive.has(id)) { delete gone[id]; continue; }
      if ((gone[id] = (gone[id] || 0) + 1) >= 5 && Date.now() - reg[id].at > 60e3) { delete reg[id]; delete gone[id]; changed = true; }
    }
    for (const [id, r] of Object.entries(reg)) {
      if (!alive.has(id)) continue;
      if (!r.sid) {
        const rows = await sql(`select id from sessions where title=${q(r.name)} order by started_at desc limit 1`);
        if (rows && rows.length) { r.sid = rows[0].id; changed = true; }
      }
      if (r.sid) { const n = await newest(r.sid); if (n !== r.sid) { r.sid = n; changed = true; } }
    }
    if (changed) save();
    // context from each pane's status bar (kept when a read misses it, e.g. while a dialog covers the bar)
    for (const [id, r] of Object.entries(reg)) {
      if (!alive.has(id)) continue;
      const c = parseCtx(await capture(id)); if (c) ctxOf[id] = { ...c, at: Date.now() };
    }
    const sids = Object.values(reg).map(r => r.sid).filter(Boolean);
    if (!sids.length) { live.clear(); return; }
    const inn = sids.map(q).join(',');
    const rows = await sql(`select id,title,model,started_at,last_activity_at,message_count,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,reasoning_tokens,api_call_count from sessions where id in (${inn})`) || [];
    const msgs = await sql(`select * from (select session_id,role,substr(coalesce(content,''),1,400) as content,tool_name,substr(coalesce(tool_calls,''),1,300) as tool_calls,timestamp from messages where session_id in (${inn}) and active=1 order by id desc limit ${40 * sids.length}) order by timestamp`) || [];
    const usage = await sql(`select session_id,model,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens from session_model_usage where session_id in (${inn})`) || [];
    live.clear();
    for (const row of rows) live.set(row.id, { row, msgs: msgs.filter(m => m.session_id === row.id).slice(-40), usage: usage.filter(u => u.session_id === row.id) });
  }

  function hookState(sid) {
    try { return JSON.parse(fs.readFileSync(path.join(STATE, sid.replace(/[^\w.-]/g, '_') + '.json'), 'utf8')); } catch { return null; }
  }

  // session entries in the collector's shape (claude ~/.claude/sessions/<pid>.json), keyed by the pane's shell pid
  async function sessions(paneList) {
    if (!Object.keys(reg).length) return [];
    if (Date.now() - lastRead > 2500 && !reading) { lastRead = Date.now(); reading = read(paneList).finally(() => { reading = null; }); }
    if (!live.size && reading) await reading;
    const out = [], byId = new Map(paneList.map(p => [p.id, p])), seen = new Set();
    for (const [paneId, r] of Object.entries(reg)) {
      const p = byId.get(paneId); if (!p || !r.sid || seen.has(r.sid)) continue;   // one entry per Hermes session
      seen.add(r.sid);
      const L = live.get(r.sid), h = hookState(r.sid);
      const fresh = h && Date.now() / 1000 - h.at < 900;
      // busy only while the hook says so and it said so recently (a killed turn never sends post_llm_call)
      const status = !fresh ? 'idle' : h.state === 'waiting' ? 'waiting' : h.state === 'busy' && Date.now() / 1000 - h.at < 600 ? 'busy' : 'idle';
      out.push({
        pid: p.pid, sessionId: r.sid, cwd: r.cwd, kind: 'hermes', engine: 'hermes', status, pane: paneId, tty: p.tty,
        name: (L && L.row.title) || r.name, nameSource: 'user', startedAt: L ? Math.round(L.row.started_at * 1000) : r.at,
        updatedAt: L && L.row.last_activity_at ? Math.round(L.row.last_activity_at * 1000) : r.at, hermes: L || null, hook: h,
        ctx: ctxOf[paneId] && Date.now() - ctxOf[paneId].at < 10 * 60e3 ? ctxOf[paneId] : null,
      });
    }
    return out;
  }
  return { add, forget, has, sidOf, sessions, freshName, list: () => ({ ...reg }) };
};
module.exports.sql = sql;
module.exports.parseCtx = parseCtx;
