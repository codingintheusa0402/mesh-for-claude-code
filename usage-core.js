// Token usage history (2026-11-04): adds up the usage fields of the Claude Code logs (~/.claude/projects/**/*.jsonl)
// into a local SQLite file, so monthly numbers survive after old logs are cleaned up. Holds counts and session names only,
// never prompt or reply text. Runs in its own low-priority process (usage-proc.js); only appended bytes are read.
//   usage    hourly totals per machine / session / model (the history; rolled up to days and weeks when shown)
//   sessions name, folder, project and bubble colour of each session
//   msgs     one row per API reply: how a re-logged reply is counted once, and which prompt it belongs to (a byte position
//            in the log, so the heaviest turns can quote it live; the text itself is never saved). Pruned after 40 days,
//            except each session's heaviest turns.
//   files    how far each log has been read
// Each Mac counts only what ran on it (see foreign()) and pulls the other's totals over the phone-server link.
const fs = require('fs'), path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { createFolders } = require('./project-folders');
const LINEAGE = require('./lineage');
// projects that are one piece of work under several names (local/usage-projects.json: [{ "match": "^ticket-reporter$", "project": "Ticket Reporter" }])
let PROJECT_ALIAS = []; try { PROJECT_ALIAS = JSON.parse(fs.readFileSync(path.join(__dirname, 'local', 'usage-projects.json'), 'utf8')).map(x => [new RegExp(x.match, 'i'), x.project]); } catch { }
// fixed daily budgets per session (local/usage-budgets.json: { "<session name>": <tokens> }); without one a session's budget is 2× its 7-day average
let BUDGETS = {}; try { BUDGETS = JSON.parse(fs.readFileSync(path.join(__dirname, 'local', 'usage-budgets.json'), 'utf8')); } catch { }
const aliasProject = p => { for (const [re, to] of PROJECT_ALIAS) if (re.test(p || '')) return to; return p; };

const HOUR = 3600e3, DAY = 864e5, KEEP_MS = 40 * DAY, CHUNK = 1 << 20, MAX_LINE = 4 << 20, PROJECT_SLOTS = 7;
const isClaude = m => /claude|fable|mythos|opus|sonnet|haiku/i.test(String(m || ''));       // anything else ran through Ollama and doesn't touch Claude's limit
const family = m => { m = String(m || '').toLowerCase(); for (const f of ['fable', 'mythos', 'opus', 'sonnet', 'haiku']) if (m.includes(f)) return f; return 'other'; };
const tokOf = r => r.inp + r.out + r.cr + r.cw;

function openUsage({ file, home, machine, projects = path.join(home, '.claude', 'projects'), handoffs = '', refreshLogs = [] }) {
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
    CREATE TABLE IF NOT EXISTS usage(hour INTEGER, machine TEXT, sid TEXT, model TEXT, inp INTEGER, out INTEGER, cr INTEGER, cw INTEGER, turns INTEGER, PRIMARY KEY(hour, machine, sid, model)) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS sessions(machine TEXT, sid TEXT, name TEXT, titled INTEGER DEFAULT 0, cwd TEXT, project TEXT, color TEXT, headless INTEGER DEFAULT 0, typed INTEGER DEFAULT 0, last_at INTEGER DEFAULT 0, PRIMARY KEY(machine, sid)) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS msgs(id TEXT PRIMARY KEY, file INTEGER, turn INTEGER, sid TEXT, at INTEGER, model TEXT, inp INTEGER, out INTEGER, cr INTEGER, cw INTEGER) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS msgs_sid ON msgs(sid);
    CREATE TABLE IF NOT EXISTS files(id INTEGER PRIMARY KEY, path TEXT UNIQUE, size INTEGER, offset INTEGER, turn INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT);
    CREATE TABLE IF NOT EXISTS folders(cwd TEXT PRIMARY KEY, project TEXT);`);
  // lineage (2026-11-13): every generation of a refreshed session shares lid; lname is the lineage's name
  for (const c of ['lid TEXT', 'lname TEXT', 'gen INTEGER', 'why TEXT']) { try { db.exec(`ALTER TABLE sessions ADD COLUMN ${c}`); } catch { } }
  const q = {
    file: db.prepare('SELECT * FROM files WHERE path = ?'), fileNew: db.prepare('INSERT INTO files(path, size, offset) VALUES(?, 0, 0)'), fileSet: db.prepare('UPDATE files SET size = ?, offset = ?, turn = ? WHERE id = ?'),
    msg: db.prepare('SELECT * FROM msgs WHERE id = ?'),
    msgSet: db.prepare('INSERT INTO msgs(id, file, turn, sid, at, model, inp, out, cr, cw) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET inp = excluded.inp, out = excluded.out, cr = excluded.cr, cw = excluded.cw'),
    add: db.prepare('INSERT INTO usage(hour, machine, sid, model, inp, out, cr, cw, turns) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(hour, machine, sid, model) DO UPDATE SET inp = inp + excluded.inp, out = out + excluded.out, cr = cr + excluded.cr, cw = cw + excluded.cw, turns = turns + excluded.turns'),
    sess: db.prepare('INSERT INTO sessions(machine, sid, last_at) VALUES(?,?,?) ON CONFLICT(machine, sid) DO UPDATE SET last_at = MAX(last_at, excluded.last_at)'),
    kvGet: db.prepare('SELECT v FROM kv WHERE k = ?'), kvSet: db.prepare('INSERT INTO kv(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v'),
  };
  const kv = (k, d) => { const r = q.kvGet.get(k); if (!r) return d; try { return JSON.parse(r.v); } catch { return d; } };
  const setKv = (k, v) => q.kvSet.run(k, JSON.stringify(v));
  const folders = createFolders({ findTranscript: () => null, home });
  const pause = () => new Promise(r => setImmediate(r));
  let progress = null, scanning = false;

  // ---- reading the logs ----
  function logs() {
    const out = [];
    const walk = (d, depth) => { let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of es) { const p = path.join(d, e.name); if (e.isDirectory()) { if (depth < 4) walk(p, depth + 1); } else if (e.name.endsWith('.jsonl')) out.push(p); } };
    walk(projects, 0); return out;
  }
  // <project>/<session>.jsonl, or <project>/<session>/subagents/agent-x.jsonl (a sub-agent counts for its session)
  const sidOf = f => { const r = path.relative(projects, f).split(path.sep); return r.length > 2 ? r[1] : path.basename(f, '.jsonl'); };
  // session histories are merged between the Macs, so a log here can hold lines that ran there: each line's folder says where
  const foreign = cwd => typeof cwd === 'string' && /^\/Users\/[^/]+/.test(cwd) && !(cwd === home || cwd.startsWith(home + '/'));
  const seen = new Map();                 // sid → { title, cwd, sdk, typed } picked up while reading
  const humanText = j => { const c = j.message && j.message.content; if (j.isMeta) return ''; const t = typeof c === 'string' ? c : Array.isArray(c) ? (c.find(b => b.type === 'text') || {}).text || '' : ''; return t.startsWith('<') ? '' : t; };

  function readLine(line, pos, f, st, cutoff) {
    const info = seen.get(st.sid) || seen.set(st.sid, {}).get(st.sid);
    if (!info.cwd) { const m = /"cwd":"((?:[^"\\]|\\.)+)"/.exec(line.slice(0, 4000)); if (m) try { info.cwd = JSON.parse(`"${m[1]}"`); } catch { } }
    if (line.includes('"type":"assistant"') && line.includes('"usage"')) {
      let j; try { j = JSON.parse(line); } catch { return; }
      const m = j.message || {}, u = m.usage; if (j.type !== 'assistant' || !u || !m.model || m.model === '<synthetic>' || j.isApiErrorMessage) return;
      const at = Date.parse(j.timestamp) || 0; if (!at || at < cutoff) return;
      if (foreign(j.cwd)) return;                                     // synced in from the other Mac: that Mac reports it
      const id = m.id || j.requestId || j.uuid; if (!id) return;
      const v = { inp: u.input_tokens || 0, out: u.output_tokens || 0, cr: u.cache_read_input_tokens || 0, cw: u.cache_creation_input_tokens || 0 };
      const old = q.msg.get(id);
      if (old) { if (v.inp === old.inp && v.out === old.out && v.cr === old.cr && v.cw === old.cw) return;              // a re-logged reply with the same counts (also a resumed copy)
        q.msgSet.run(id, 0, 0, '', 0, '', v.inp, v.out, v.cr, v.cw);
        q.add.run(Math.floor(old.at / HOUR), machine, old.sid, old.model, v.inp - old.inp, v.out - old.out, v.cr - old.cr, v.cw - old.cw, 0); return; }
      q.msgSet.run(id, f.id, st.turn, st.sid, at, m.model, v.inp, v.out, v.cr, v.cw);
      q.add.run(Math.floor(at / HOUR), machine, st.sid, m.model, v.inp, v.out, v.cr, v.cw, 1);
      q.sess.run(machine, st.sid, at);
    } else if (line.startsWith('{"type":"custom-title"') || line.startsWith('{"type":"ai-title"')) {
      try { const j = JSON.parse(line), t = j.customTitle || j.aiTitle; if (t && (j.customTitle || !info.custom)) { info.title = t; if (j.customTitle) info.custom = true; } } catch { }
    } else if (line.includes('"type":"user"') && !line.includes('"tool_result"')) {
      let j; try { j = JSON.parse(line); } catch { return; }
      if (j.type === 'user' && humanText(j)) { st.turn = pos; if (j.entrypoint === 'sdk-cli') info.sdk = true; else if (j.entrypoint === 'cli') info.typed = true; }
    }
  }

  async function readFile(p, size, row, cutoff) {
    const f = row || (q.fileNew.run(p), q.file.get(p));
    let offset = f.offset, turn = f.turn; if (size < offset) { offset = 0; turn = 0; }           // the log was rewritten; reply ids keep it from counting twice
    const st = { sid: sidOf(p), turn }, fd = fs.openSync(p, 'r'), buf = Buffer.allocUnsafe(CHUNK); let carry = null, carryAt = offset, tick = 0;
    try {
      for (let at = offset; at < size;) {
        const n = fs.readSync(fd, buf, 0, Math.min(CHUNK, size - at), at); if (!n) break;
        const data = carry ? Buffer.concat([carry, buf.subarray(0, n)]) : buf.subarray(0, n), base = carry ? carryAt : at;
        at += n; let a = 0, b;
        db.exec('BEGIN');
        try {
          while ((b = data.indexOf(10, a)) >= 0) { if (b - a < MAX_LINE && b > a) readLine(data.toString('utf8', a, b), base + a, f, st, cutoff); a = b + 1; }
          q.fileSet.run(at, base + a, st.turn, f.id); db.exec('COMMIT');
        } catch (e) { db.exec('ROLLBACK'); throw e; }
        carry = a < data.length && data.length - a < MAX_LINE ? Buffer.from(data.subarray(a)) : null; carryAt = base + a;
        if (progress) progress.done += n;
        if (++tick % 8 === 0) await pause();                          // answers the dashboard between chunks
      }
    } finally { fs.closeSync(fd); }
    if (!row || size !== f.size) q.fileSet.run(size, carry ? carryAt : size, st.turn, f.id);
  }

  // ---- names and projects ----
  function projectOf(s) {
    if (/[\\/]project-cards[\\/]run$/.test(s.cwd || '')) return 'Mesh project cards';
    const fixed = s.cwd && db.prepare('SELECT project FROM folders WHERE cwd = ?').get(s.cwd); if (fixed) return fixed.project;
    if (s.cwd && s.cwd !== home && s.cwd.startsWith(home + '/')) { const r = folders.rootOf(s.cwd); if (r) return path.basename(r); }
    return s.titled ? s.name : 'Home';
  }
  const label = (s, info) => {
    if (info && info.title) return { name: info.title, titled: 1 };
    if (s.titled) return { name: s.name, titled: 1 };
    if (s.name) return { name: s.name, titled: 0 };
    const base = s.cwd && s.cwd !== home ? path.basename(s.cwd) : 'Session';
    return { name: `${base} ${s.sid.slice(0, 4)}`, titled: 0 };
  };
  function refreshSessions() {
    const up = db.prepare('UPDATE sessions SET name = ?, titled = ?, cwd = ?, project = ?, headless = ?, typed = ? WHERE machine = ? AND sid = ?');
    db.exec('BEGIN');
    for (const s of db.prepare('SELECT * FROM sessions WHERE machine = ?').all(machine)) {
      const i = seen.get(s.sid) || {}, cwd = s.cwd || i.cwd || '', typed = s.typed || (i.typed ? 1 : 0), headless = !typed && (s.headless || i.sdk) ? 1 : 0;
      const l = label({ ...s, cwd }, i), project = projectOf({ ...s, ...l, cwd });
      up.run(l.name, l.titled, cwd, project, headless, typed, machine, s.sid);
    }
    db.exec('COMMIT'); seen.clear();
    assignLineage();
  }
  // which lineage each session of this Mac belongs to: the handoff's lineage.json files (refreshes), else one per name
  function assignLineage() {
    if (!handoffs) return;
    if (!kv('lineageBackfill', 0)) {                       // once: chains from the refresh log + same-name sessions, last 30 days
      const known = db.prepare('SELECT s.sid, s.name, s.machine, MIN(u.hour) h0, MAX(u.hour) h1 FROM sessions s JOIN usage u ON u.sid = s.sid AND u.machine = s.machine WHERE s.machine = ? AND s.headless = 0 GROUP BY s.sid').all(machine)
        .map(k => ({ sid: k.sid, name: k.name, machine: k.machine, first: k.h0 * HOUR, last: (k.h1 + 1) * HOUR }));
      try { setKv('lineageBackfillResult', LINEAGE.backfill(handoffs, { logs: refreshLogs, known, machine, since: Date.now() - 30 * DAY })); } catch (e) { setKv('lineageBackfillResult', { err: e.message }); }
      setKv('lineageBackfill', Date.now());
    }
    const idx = LINEAGE.index(handoffs), byName = new Map(); for (const l of LINEAGE.all(handoffs)) byName.set(l.name, l);
    const up = db.prepare('UPDATE sessions SET lid = ?, lname = ?, gen = ?, why = ? WHERE machine = ? AND sid = ?');
    db.exec('BEGIN');
    for (const s of db.prepare('SELECT sid, name, titled, headless FROM sessions WHERE machine = ?').all(machine)) {
      const x = idx.get(s.sid), l = !x && s.titled && !s.headless ? byName.get(s.name) : null;
      if (x) up.run(x.lid, x.name, x.gen, x.why, machine, s.sid);
      else if (l) up.run(l.lid, l.name, null, 'same name', machine, s.sid);
      else if (s.titled && !s.headless) up.run(`N:${machine}:${s.name}`, s.name, null, null, machine, s.sid);
      else up.run(s.sid, s.name, null, null, machine, s.sid);
    }
    db.exec('COMMIT');
  }
  // what the app knows about live sessions: their names and colours, and which main session a sub-session's folder belongs to
  function labels(list) {
    const up = db.prepare('UPDATE sessions SET name = ?, titled = ?, color = ? WHERE machine = ? AND sid = ?'), map = db.prepare('INSERT INTO folders(cwd, project) VALUES(?, ?) ON CONFLICT(cwd) DO UPDATE SET project = excluded.project');
    const cw = db.prepare("UPDATE sessions SET cwd = ? WHERE machine = ? AND sid = ? AND (cwd IS NULL OR cwd = '')");   // a Hermes session's folder is known only to the app
    for (const s of list || []) { if (s.parentName && s.cwd && s.cwd !== home) map.run(s.cwd, s.parentName); if (s.name) up.run(s.name, s.auto ? 0 : 1, s.color || '', machine, s.sid); if (s.cwd) cw.run(s.cwd, machine, s.sid); }
  }

  async function scan(list) {
    if (scanning) return { files: 0 };
    scanning = true;
    try { return await scanLogs(list); } finally { scanning = false; progress = null; }
  }
  // Hermes Agent sessions (since 2026-11-07): their totals per session and model live in ~/.hermes/state.db
  // (session_model_usage, cumulative). What grew since the last scan goes into this hour, like a Claude log's new lines.
  function scanHermes() {
    const f = path.join(home, '.hermes', 'state.db'); if (!fs.existsSync(f)) return 0;
    let h; try { h = new DatabaseSync(f, { readOnly: true }); } catch { return 0; }
    let n = 0;
    try {
      const rows = h.prepare(`SELECT u.session_id sid, u.model, SUM(u.input_tokens) inp, SUM(u.output_tokens + u.reasoning_tokens) out, SUM(u.cache_read_tokens) cr, SUM(u.cache_write_tokens) cw,
        SUM(u.api_call_count) turns, MAX(u.last_seen) last, s.title, s.cwd FROM session_model_usage u LEFT JOIN sessions s ON s.id = u.session_id GROUP BY u.session_id, u.model`).all();
      const seenH = kv('hermesSeen', null), first = !seenH, prev = seenH || {}, next = {};
      const hour = Math.floor(Date.now() / HOUR), setName = db.prepare('UPDATE sessions SET name = ?, titled = 1, cwd = COALESCE(NULLIF(cwd, \'\'), ?) WHERE machine = ? AND sid = ?');
      db.exec('BEGIN');
      for (const r of rows) {
        const k = r.sid + '|' + r.model, p0 = prev[k] || [0, 0, 0, 0, 0], cur = [r.inp || 0, r.out || 0, r.cr || 0, r.cw || 0, r.turns || 0]; next[k] = cur;
        const d = cur.map((v, i) => Math.max(0, v - p0[i])); if (!d.some(Boolean)) continue;
        const at = r.last ? Math.round(r.last * 1000) : Date.now(), hr = first ? Math.floor(at / HOUR) : hour;      // the first scan files each total at its session's last activity
        q.add.run(hr, machine, r.sid, r.model, d[0], d[1], d[2], d[3], d[4]); q.sess.run(machine, r.sid, at);
        if (r.title) setName.run(r.title, r.cwd || '', machine, r.sid); n++;
      }
      db.exec('COMMIT'); setKv('hermesSeen', next);
    } catch (e) { try { db.exec('ROLLBACK'); } catch { } } finally { try { h.close(); } catch { } }
    return n;
  }
  async function scanLogs(list) {
    if (list) labels(list);
    scanHermes();
    const backfilled = kv('backfilled', 0), cutoff = backfilled ? Date.now() - KEEP_MS : 0, todo = [];
    for (const p of logs()) { let size; try { size = fs.statSync(p).size; } catch { continue; } const row = q.file.get(p); if (!row || row.size !== size) todo.push([p, size, row]); }
    if (!backfilled) progress = { done: 0, total: todo.reduce((a, t) => a + t[1], 0) };
    for (const [p, size, row] of todo) { try { await readFile(p, size, row, cutoff); } catch { } }
    progress = null; refreshSessions();
    if (!backfilled) setKv('backfilled', Date.now());
    if (Date.now() - kv('prunedAt', 0) > DAY) prune();
    setKv('scanAt', Date.now());
    return { files: todo.length };
  }
  // old replies go, except each session's five heaviest turns
  function prune() {
    const cut = Date.now() - KEEP_MS;
    db.exec(`CREATE TEMP TABLE keep AS SELECT file, turn FROM (SELECT file, turn, ROW_NUMBER() OVER (PARTITION BY sid ORDER BY SUM(inp + out + cr + cw) DESC) n FROM msgs GROUP BY sid, file, turn) WHERE n <= 5;`);
    db.prepare('DELETE FROM msgs WHERE at < ? AND NOT EXISTS (SELECT 1 FROM keep k WHERE k.file = msgs.file AND k.turn = msgs.turn)').run(cut);
    db.exec('DROP TABLE keep'); setKv('prunedAt', Date.now());
  }

  // ---- the other machine ----
  const rows = since => ({ machine, sinceHour: since, usage: db.prepare('SELECT * FROM usage WHERE machine = ? AND hour >= ?').all(machine, since), sessions: db.prepare('SELECT machine, sid, name, titled, cwd, project, color, headless, last_at, lid, lname, gen, why FROM sessions WHERE machine = ? AND last_at >= ?').all(machine, since * HOUR) });
  function importRows(d) {
    if (!d || !d.machine || d.machine === machine) return 0;
    const add = db.prepare('INSERT OR REPLACE INTO usage(hour, machine, sid, model, inp, out, cr, cw, turns) VALUES(?,?,?,?,?,?,?,?,?)'), ses = db.prepare('INSERT OR REPLACE INTO sessions(machine, sid, name, titled, cwd, project, color, headless, last_at, lid, lname, gen, why) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
    db.exec('BEGIN'); db.prepare('DELETE FROM usage WHERE machine = ? AND hour >= ?').run(d.machine, d.sinceHour);
    for (const r of d.usage || []) add.run(r.hour, r.machine, r.sid, r.model, r.inp, r.out, r.cr, r.cw, r.turns);
    for (const s of d.sessions || []) ses.run(s.machine, s.sid, s.name, s.titled, s.cwd, s.project, s.color, s.headless, s.last_at, s.lid || null, s.lname || null, s.gen ?? null, s.why || null);   // (an older build sends no lineage)
    db.exec('COMMIT'); const m = kv('peers', {}); m[d.machine] = Date.now(); setKv('peers', m);
    return (d.usage || []).length;
  }
  const peerSince = name => (kv('peers', {})[name] ? Math.floor(Date.now() / HOUR) - 72 : 0);

  // ---- what the dashboard shows ----
  // a conversation handed from one Mac to the other has its log on both: that hour counts once
  function loadRows(fromHour) {
    const best = new Map();
    for (const r of db.prepare(`SELECT u.*, s.name, s.titled, s.project, s.color, s.headless, s.lid, s.lname, s.gen, s.why FROM usage u LEFT JOIN sessions s ON s.machine = u.machine AND s.sid = u.sid WHERE u.hour >= ?`).all(fromHour)) {
      r.tok = tokOf(r);
      if (!r.headless || r.titled) { if (r.lname && r.lid && !String(r.lid).startsWith('N:') && r.lid !== r.sid) r.project = r.lname; }   // every generation counts for its lineage's project
      r.project = aliasProject(r.project);
      if (!r.lid) r.lid = r.titled && !r.headless && r.name ? `N:${r.machine}:${r.name}` : r.sid; const k = `${r.hour}|${r.sid}|${r.model}`, o = best.get(k); if (!o || r.tok > o.tok) best.set(k, r);
    }
    // the same name is the same work on either Mac: one row, under the refreshed lineage when there is one
    const byName = new Map(); for (const r of best.values()) if (r.lid && r.lid.startsWith('L-') && r.lname) byName.set(r.lname, [r.lid, r.lname]);
    for (const r of best.values()) if (r.lid && r.lid.startsWith('N:')) { const n = r.lid.replace(/^N:[^:]*:/, ''), l = byName.get(n); if (l) { r.lid = l[0]; r.lname = l[1]; if (!r.why) r.why = 'same name'; } else r.lid = 'N:' + n; }
    return [...best.values()];
  }
  const startOfDay = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const tzName = () => { const z = Intl.DateTimeFormat().resolvedOptions().timeZone; return z === 'Asia/Seoul' ? 'KST' : new Intl.DateTimeFormat('en', { timeZoneName: 'short' }).formatToParts(new Date()).find(p => p.type === 'timeZoneName').value; };
  function weekWindow(now, limits) {
    const w = (limits || []).find(l => l.kind === 'weekly_all' && l.resetsAt);
    if (w) { let end = w.resetsAt; while (end <= now) end += 7 * DAY; return { start: end - 7 * DAY, end, source: 'limit', label: 'Since your Claude weekly reset' }; }
    const d = new Date(startOfDay(now)); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return { start: d.getTime(), end: d.getTime() + 7 * DAY, source: 'monday', label: `Since Monday 00:00 ${tzName()} (reset time not readable)` };
  }
  // the display key: a session, or all of one folder's unnamed script runs together
  const isRuns = r => r.headless && !r.titled;
  const keyOf = r => (isRuns(r) ? `runs:${r.project || 'Home'}` : r.lid || r.sid);
  const nameOf = r => (isRuns(r) ? `${r.project || 'Home'} script runs` : r.lname || r.name || r.sid.slice(0, 8));
  function rank(R, a, b, limit = 12) {
    const m = new Map(); let total = 0;
    for (const r of R) { const t = r.hour * HOUR; if (t < a - HOUR + 1 || t >= b) continue; total += r.tok; const k = keyOf(r);
      const e = m.get(k) || m.set(k, { key: k, name: nameOf(r), runs: isRuns(r), color: r.color || '', family: family(r.model), project: r.project || 'Home', tok: 0, byFam: {}, sids: new Map(), gens: new Map(), models: {} }).get(k);
      e.tok += r.tok; e.byFam[family(r.model)] = (e.byFam[family(r.model)] || 0) + r.tok; e.sids.set(r.sid, r.machine); e.models[r.model] = (e.models[r.model] || 0) + r.tok;
      if (r.color && !e.color) e.color = r.color;
      if (!e.runs) { const g = e.gens.get(r.sid) || e.gens.set(r.sid, { sid: r.sid, machine: r.machine, name: r.name || '', gen: r.gen ?? null, why: r.why || '', tok: 0, calls: 0, from: t, to: t }).get(r.sid);
        g.tok += r.tok; g.calls += r.turns || 0; g.from = Math.min(g.from, t); g.to = Math.max(g.to, t + HOUR); } }
    const all = [...m.values()].sort((x, y) => y.tok - x.tok);
    for (const e of all) {
      e.family = Object.entries(e.byFam).sort((x, y) => y[1] - x[1])[0][0]; e.sids = [...e.sids].slice(0, 200).map(([sid, machine]) => ({ sid, machine })); delete e.byFam;
      e.model = Object.entries(e.models).sort((x, y) => y[1] - x[1])[0][0]; delete e.models;
      e.gens = [...e.gens.values()].sort((a, b) => a.from - b.from); e.gens.forEach((g, i) => { if (g.gen == null) g.gen = i + 1; });
    }
    // a folder's script runs sit under the session whose project it is (the biggest one), when that session is listed
    const top = [], byKey = new Map();
    for (const e of all) if (!e.runs) byKey.set(e.key, e);
    const shown = all.filter(e => !e.runs).slice(0, limit);
    for (const e of all) if (e.runs) { const p = shown.find(x => x.project === e.project); if (p) (p.children || (p.children = [])).push(e); else top.push(e); }
    const list = [...shown, ...top].sort((x, y) => y.tok - x.tok).slice(0, limit), inList = new Set(list.map(e => e.key));
    const nested = new Set(shown.flatMap(e => (e.children || []).map(c => c.key)));
    const rest = all.filter(e => !inList.has(e.key) && !nested.has(e.key)), other = rest.reduce((n, e) => n + e.tok, 0);
    for (const e of list) if (e.children && !inList.has(e.key)) delete e.children;
    return { total, count: all.length, top: list, other, otherN: rest.length };
  }
  const sumIn = (R, a, b) => R.reduce((n, r) => { const t = r.hour * HOUR; return t >= a - HOUR + 1 && t < b ? n + r.tok : n; }, 0);
  function projectSlots(order) {
    const map = kv('projectSlots', {}), inUse = new Set(order.filter(p => map[p] != null).map(p => map[p]));
    for (const p of order) if (map[p] == null) { let s = 0; while (inUse.has(s)) s++; map[p] = s; inUse.add(s); }
    for (const k of Object.keys(map)) if (!order.includes(k) && Object.keys(map).length > 40) delete map[k];
    setKv('projectSlots', map); return map;
  }

  // each lineage's average day over the 7 full days before today (days it used nothing count as 0 only after its first day)
  function lineAvg(R, day0) {
    const m = new Map();
    for (const r of R) { const t = r.hour * HOUR; if (t < day0 - 7 * DAY || t >= day0 || (r.headless && !r.titled)) continue; const k = r.lid || r.sid, e = m.get(k) || m.set(k, { tok: 0, first: t }).get(k); e.tok += r.tok; e.first = Math.min(e.first, t); }
    for (const e of m.values()) e.avg = e.tok / Math.max(1, Math.min(7, Math.ceil((day0 - startOfDay(e.first)) / DAY)));
    return m;
  }
  const budgetOf = (e, avg) => BUDGETS[e.name] || (avg && avg.avg > 0 ? Math.round(2 * avg.avg) : 0);
  function dash({ limits, now = Date.now(), models = {} } = {}) {
    const day0 = startOfDay(now), m = new Date(now), m0 = new Date(m.getFullYear(), m.getMonth(), 1).getTime(), pm0 = new Date(m.getFullYear(), m.getMonth() - 1, 1).getTime(), week = weekWindow(now, limits);
    const R = loadRows(Math.floor((Math.min(pm0, week.start - 7 * DAY, day0 - 31 * DAY)) / HOUR) - 1);
    const card = (start, prevStart, prevEnd, label, vs) => ({ label, vs, start, tok: sumIn(R, start, now + 1), prev: sumIn(R, prevStart, prevEnd) });
    const cards = { today: card(day0, day0 - DAY, now - DAY, 'Today', 'same time yesterday'), week: { ...card(week.start, week.start - 7 * DAY, now - 7 * DAY, 'This week', 'same point last week'), note: week.label, source: week.source, end: week.end },
      month: card(m0, pm0, Math.min(m0, pm0 + (now - m0)), 'This month', 'same point last month') };
    const ranked = { day: rank(R, day0, now + 1), week: rank(R, week.start, now + 1), month: rank(R, m0, now + 1) };
    const avgs = lineAvg(R, day0);
    for (const r of Object.values(ranked)) for (const e of r.top.flatMap(x => [x, ...(x.children || [])])) if (!e.runs) { e.lineName = e.name; e.setModel = models[e.name] || null; e.budget = budgetOf(e, avgs.get(e.key)); }
    // last 30 days, by project: the seven biggest keep a colour for good, the rest are Other
    const days = [], byDay = new Map(), proj = new Map();
    for (let i = 29; i >= 0; i--) { const d = new Date(day0); d.setDate(d.getDate() - i); const e = { day: d.getTime(), total: 0, by: {} }; days.push(e); byDay.set(d.getTime(), e); }
    for (const r of R) { const e = byDay.get(startOfDay(r.hour * HOUR)); if (!e) continue; const p = r.project || 'Home'; e.total += r.tok; e.by[p] = (e.by[p] || 0) + r.tok; proj.set(p, (proj.get(p) || 0) + r.tok); }
    const order = [...proj].sort((a, b) => b[1] - a[1]).slice(0, PROJECT_SLOTS).map(x => x[0]), slots = projectSlots(order);
    for (const e of days) { let other = 0; for (const [p, v] of Object.entries(e.by)) if (!order.includes(p)) { other += v; delete e.by[p]; } if (other) e.by.Other = other; }
    const projects = order.map(name => ({ name, slot: slots[name], tok: proj.get(name) })); const otherTok = [...proj].filter(([p]) => !order.includes(p)).reduce((n, x) => n + x[1], 0);
    // by model, this week
    const fam = {}; for (const r of R) { const t = r.hour * HOUR; if (t < week.start - HOUR + 1) continue; const f = family(r.model), e = fam[f] || (fam[f] = { family: f, tok: 0, inp: 0, out: 0, cr: 0, cw: 0 }); e.tok += r.tok; e.inp += r.inp; e.out += r.out; e.cr += r.cr; e.cw += r.cw; }
    const mach = {}; for (const r of R) { const t = r.hour * HOUR; if (t >= m0) mach[r.machine] = (mach[r.machine] || 0) + r.tok; }
    const last24 = sumIn(R, now - DAY, now + 1), CR = R.filter(r => isClaude(r.model)), claude = { week: sumIn(CR, week.start, now + 1), last24: sumIn(CR, now - DAY, now + 1) };
    return { at: now, scanAt: kv('scanAt', 0), self: machine, ready: !!kv('backfilled', 0), progress, cards, ranked, days, projects, otherTok, models: Object.values(fam).sort((a, b) => b.tok - a.tok), machines: mach, peers: kv('peers', {}), manual: kv('manual', null), last24, claude, weekEnd: week.end };
  }

  // a session's last 30 days and its five heaviest turns. The prompt is read from its log now and never saved.
  function session(sids, { anyMachine } = {}, now = Date.now()) {
    const list = sids.slice(0, 200), ph = list.map(() => '?').join(','), day0 = startOfDay(now), since = day0 - 29 * DAY - DAY;
    const days = []; for (let i = 29; i >= 0; i--) { const d = new Date(day0); d.setDate(d.getDate() - i); days.push({ day: d.getTime(), tok: 0 }); }
    const byDay = new Map(days.map(d => [d.day, d]));
    for (const r of db.prepare(`SELECT hour, inp, out, cr, cw FROM usage WHERE hour >= ? AND sid IN (${ph})${anyMachine ? '' : ' AND machine = ?'}`).all(Math.floor(since / HOUR), ...list, ...(anyMachine ? [] : [machine]))) { const e = byDay.get(startOfDay(r.hour * HOUR)); if (e) e.tok += tokOf(r); }
    const turns = db.prepare(`SELECT file, turn, MIN(at) at, SUM(inp + out + cr + cw) tok, COUNT(*) calls, MAX(model) model FROM msgs WHERE sid IN (${ph}) GROUP BY file, turn ORDER BY tok DESC LIMIT 5`).all(...list);
    return { days, turns: turns.map(t => ({ at: t.at, tok: t.tok, calls: t.calls, family: family(t.model), text: describe(t.file, t.turn) })) };
  }
  function describe(fileId, pos) {
    const f = db.prepare('SELECT path FROM files WHERE id = ?').get(fileId); if (!f || !pos && pos !== 0) return '';
    let fd; try {
      fd = fs.openSync(f.path, 'r'); const buf = Buffer.alloc(256 * 1024), n = fs.readSync(fd, buf, 0, buf.length, pos); let s = buf.toString('utf8', 0, n); const e = s.indexOf('\n'); if (e >= 0) s = s.slice(0, e);
      const t = humanText(JSON.parse(s)).replace(/\s+/g, ' ').trim();
      return t.length > 90 ? t.slice(0, 89) + '…' : t;
    } catch { return ''; } finally { if (fd != null) try { fs.closeSync(fd); } catch { } }
  }

  // today's alerts: one session over 30% of the day, the day at 2× the 7-day average, a session past its daily budget,
  // and (once a week) the weekly limit running out before its reset at the last 24 hours' pace. Each fires once.
  const fmt = n => n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : Math.round(n / 1e6) + 'M';
  function alerts(limits, now = Date.now()) {
    const day0 = startOfDay(now), R = loadRows(Math.floor((day0 - 8 * DAY) / HOUR)), today = sumIn(R, day0, now + 1), done = kv('alerted', {}), out = [], dayKey = String(day0);
    const past = []; for (let i = 1; i <= 7; i++) past.push(sumIn(R, day0 - i * DAY, day0 - (i - 1) * DAY));
    const used = past.filter(Boolean); if (!used.length) return out;
    const avg = used.reduce((a, b) => a + b, 0) / used.length;
    // the weekly forecast once per week, the rest once a day
    const send = (k, title, body) => { const id = k.startsWith('w:') ? k : dayKey + ':' + k; if (!done[id]) { done[id] = 1; out.push({ title, body }); } };
    if (today >= avg * 2) send('day', 'Token usage is high today', `Today is at ${(today / avg).toFixed(1)}x your 7-day average.`);
    if (today >= avg * .25) for (const s of rank(R, day0, now + 1, 3).top) if (s.tok / today > .3) send('s:' + s.key, `${s.name} is using a lot today`, `${Math.round(s.tok / today * 100)}% of today's tokens so far.`);
    // a session past its daily budget: 2× its own 7-day average (or the fixed one in local/usage-budgets.json); 20M floor
    const avgs = lineAvg(R, day0);
    for (const s of rank(R, day0, now + 1, 40).top) { if (s.runs) continue; const b = budgetOf(s, avgs.get(s.key)); if (b && s.tok > Math.max(b, 20e6)) send('b:' + s.key, `${s.name} passed its daily token budget`, `${fmt(s.tok)} today vs a budget of ${fmt(b)} (${BUDGETS[s.name] ? 'set' : "2× its 7-day average"}). Check the Token usage board in Mesh.`); }
    // the weekly limit: at the last 24 hours' pace, does it run out before the reset?
    const w = (limits || []).find(l => l.kind === 'weekly_all' && l.resetsAt && l.used > 0);
    if (w) { const wk = weekWindow(now, limits), CR = R.filter(r => isClaude(r.model)), used = sumIn(CR, wk.start, now + 1), d24 = sumIn(CR, now - DAY, now + 1);
      if (used > 0 && d24 > 0) { const perPct = used / w.used, perDay = d24 / perPct, hits = now + (100 - w.used) / perDay * DAY;
        if (hits < wk.end) send('w:' + Math.floor(wk.end / HOUR), 'Weekly limit runs out before the reset', `${Math.round(w.used)}% used. At the last 24 hours' pace (${Math.round(perDay)}% a day) it hits 100% ${new Date(hits).toLocaleString('en', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}, reset ${new Date(wk.end).toLocaleString('en', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}.`); } }
    for (const k of Object.keys(done)) if (k.startsWith('w:') ? +k.slice(2) * HOUR < now - 8 * DAY : !k.startsWith(dayKey)) delete done[k];
    setKv('alerted', done); return out;
  }
  function summary(limits, now = Date.now()) {
    const w = weekWindow(now, limits), R = loadRows(Math.floor(w.start / HOUR) - 1), r = rank(R, w.start, now + 1, 1);
    return { week: r.total, claudeWeek: sumIn(R.filter(x => isClaude(x.model)), w.start, now + 1), top: r.top[0] ? r.top[0].name : '', at: now };
  }
  const setManual = pct => setKv('manual', pct == null ? null : { pct: Math.max(0, Math.min(100, +pct)), at: Date.now(), tok: summary(null).claudeWeek });
  return { scan, rows, importRows, peerSince, dash, session, alerts, summary, setManual, close: () => db.close() };
}

module.exports = { openUsage, family };
