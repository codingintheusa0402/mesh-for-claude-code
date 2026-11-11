// Reads live Claude Code state from disk:
//   ~/.claude/sessions/<pid>.json        → which sessions are alive, name, busy/idle
//   ~/.claude/projects/*/<sid>.jsonl     → per-message model + token usage (spend, speed, context)
//   ~/.claude/projects/*/<sid>/subagents → sub-agent transcripts (counted toward parent)
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const HOME = os.homedir();
const SESS_DIR = path.join(HOME, '.claude', 'sessions');
const PROJ_DIR = path.join(HOME, '.claude', 'projects');

// $ per million tokens. cacheWrite = 1.25x input (5m TTL) / 2x input (1h TTL).
const PRICES = [
  ['claude-fable',     { in: 10, out: 50, cr: 0.25 }],
  ['claude-mythos',    { in: 10, out: 50, cr: 0.25 }],
  ['claude-opus-5-5',  { in: 4,  out: 20, cr: 0.20 }],
  ['claude-opus',      { in: 5,  out: 25, cr: 0.50 }],
  ['claude-sonnet-5',  { in: 2,  out: 10, cr: 0.20 }],   // sonnet-5 and sonnet-5-5
  ['claude-sonnet',    { in: 3,  out: 15, cr: 0.30 }],
  ['claude-haiku',     { in: 1,  out: 5,  cr: 0.10 }],
];
function priceFor(model) {
  for (const [p, v] of PRICES) if (model.startsWith(p)) return v;
  return { in: 3, out: 15, cr: 0.3 };
}
function family(model) {
  const m = /claude-(fable|mythos|opus|sonnet|haiku)/.exec(model || '');
  return m ? m[1] : 'other';
}
function ctxWindow(model) { return /haiku/.test(model) ? 200_000 : 1_000_000; }

function costOf(model, u) {
  const p = priceFor(model);
  const cc = u.cache_creation || {};
  const c1h = cc.ephemeral_1h_input_tokens || 0;
  const c5m = cc.ephemeral_5m_input_tokens != null ? cc.ephemeral_5m_input_tokens
    : Math.max(0, (u.cache_creation_input_tokens || 0) - c1h);
  let usd = ((u.input_tokens || 0) * p.in + (u.output_tokens || 0) * p.out +
    (u.cache_read_input_tokens || 0) * p.cr + c5m * p.in * 1.25 + c1h * p.in * 2) / 1e6;
  if (u.speed === 'fast') usd *= 2;
  return usd;
}

const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };

// your always-on server's host names / addresses (mesh.local.json "serverHosts": ["myserver", "100.x.y.z"])
const SERVER_HOSTS = (require('./mesh-name').serverHosts || []).map(h => String(h).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const SERVER_RE = new RegExp((SERVER_HOSTS.length ? `(\\b(ssh|scp|rsync|sftp|mosh)\\b[^\\n]*\\b(${SERVER_HOSTS.join('|')})\\b)|(\\b(${SERVER_HOSTS.join('|')}):)|` : '') + 'tailscale ssh|run-on-server|run_on_server\\.sh|sync_to_server\\.sh|skill:run-on-server', 'i');

class SessionStats {
  constructor(sid) {
    this.sid = sid;
    this.total = { usd: 0, in: 0, out: 0, cr: 0, cw: 0 };
    this.byModel = {};          // model -> {usd,out,in,cr,cw}
    this.today = { usd: 0, out: 0, tok: 0 };   // tok = every token processed: input + cache read/write + output
    this.todayByModel = {};
    this.events = [];           // recent {t, out, usd, model, dur} for rate windows (last 15 min)
    this.lastModel = null;
    this.lastCtx = 0;
    this.lastSpeed = 0;         // tok/s of the most recent completed response
    this.lastAssistantAt = 0;
    this.lastWriteAt = 0;
    this.errors = [];           // timestamps of API error messages
    this.lastError = '';
    this.log = [];              // [{t, kind, text}]
    this.turns = 0;
    this.turnTimes = [];        // timestamps of replies in the last 24 h (activity frequency)
    this.roots = new Map();     // what runs for this session: key -> {kind: loop|cron|monitor|agent, label, at (last activity), born}
  }
  touchRoot(key, kind, label, ts) {
    const r = this.roots.get(key);
    if (r) { r.at = Math.max(r.at, ts || 0); if (label) r.label = label; }
    else this.roots.set(key, { kind, label: label || kind, at: ts || 0, born: ts || 0 });
  }
  pushLog(t, kind, text) {
    this.log.push({ t, kind, text: String(text).replace(/\s+/g, ' ').slice(0, 220) });
    if (this.log.length > 60) this.log.splice(0, this.log.length - 60);
  }
}

class FileTail {
  constructor(file, sid, isSub) {
    this.file = file; this.sid = sid; this.isSub = isSub;
    this.offset = 0; this.rest = '';
    this.prevTs = 0;            // timestamp of last non-assistant line (response start proxy)
    this.msgs = new Map();      // message.id -> {model, usage, start, end}
    this.size = 0;
  }
}

class Collector {
  constructor() {
    this.tails = new Map();     // file -> FileTail
    this.stats = new Map();     // sid -> SessionStats
    this.sessions = new Map();  // pid -> session json (+ proc info)
    this.sidToFile = new Map();
    this.ps = new Map();        // pid -> {ppid, tty, cpu, rss, etime}
    this.dayStart = new Date().setHours(0, 0, 0, 0);
    this.scanning = false;
    this.ready = false;
  }

  stat(sid) {
    let s = this.stats.get(sid);
    if (!s) { s = new SessionStats(sid); this.stats.set(sid, s); }
    return s;
  }

  // ---- session registry -------------------------------------------------
  readSessions() {
    const out = new Map();
    let files = [];
    try { files = fs.readdirSync(SESS_DIR).filter(f => /^\d+\.json$/.test(f)); } catch { }
    for (const f of files) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(SESS_DIR, f), 'utf8'));
        if (!j.pid) continue;
        try { process.kill(j.pid, 0); } catch { continue; }   // dead pid → skip
        out.set(j.pid, j);
      } catch { }
    }
    this.sessions = out;
  }

  // A session started as `claude --remote-control "Name" …` without a title shows up as "user-d1": take the
  // Remote Control name from its exact argv (macOS KERN_PROCARGS2 — ps loses the quotes). Once per pid.
  readRcNames() {
    this.rcNames = this.rcNames || new Map();
    const want = [...this.sessions.entries()].filter(([pid, j]) => !this.rcNames.has(pid) && (!j.nameSource || ['derived', 'auto'].includes(j.nameSource))).map(([pid]) => String(pid));
    if (!want.length || process.platform !== 'darwin') return Promise.resolve();
    const py = `import ctypes,struct,sys,json
libc=ctypes.CDLL('/usr/lib/libc.dylib');out={}
for p in sys.argv[1:]:
  mib=(ctypes.c_int*3)(1,49,int(p));n=ctypes.c_size_t(1<<20);b=ctypes.create_string_buffer(n.value)
  if libc.sysctl(mib,3,b,ctypes.byref(n),None,0)!=0: continue
  r=b.raw[:n.value];c=struct.unpack('i',r[:4])[0];r=r[4:];r=r[r.index(b'\\0'):].lstrip(b'\\0')
  a=[x.decode('utf8','replace') for x in r.split(b'\\0')[:c]]
  out[p]=next((a[i+1] for i,x in enumerate(a[:-1]) if x in('--remote-control','--rc') and not a[i+1].startswith('-')),'')
print(json.dumps(out))`;
    return new Promise(res => execFile('/usr/bin/python3', ['-c', py, ...want], { timeout: 8000 }, (err, so) => {
      let m = {}; try { m = JSON.parse(so); } catch { }
      for (const pid of want) this.rcNames.set(+pid, (m[pid] || '').trim());
      res();
    }));
  }

  refreshPs() {
    // Windows has no ps: parent links from CIM (enough to match a claude.exe to the in-app terminal that runs it), every 5 s
    if (process.platform === 'win32') {
      if (Date.now() - (this.psAt || 0) < 5000) return Promise.resolve();
      this.psAt = Date.now();
      return new Promise(res => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }'], { timeout: 15000, maxBuffer: 8e6, windowsHide: true }, (err, so) => {
        if (!err) { const m = new Map(); for (const l of so.split(/\r?\n/)) { const [p, pp] = l.trim().split(/\s+/); if (+p) m.set(+p, { ppid: +pp, tty: '', cpu: 0, rss: 0, etime: '' }); } this.ps = m; }
        res();
      }));
    }
    return new Promise(res => {
      execFile('ps', [process.platform === 'darwin' ? '-axo' : '-eo', 'pid=,ppid=,tty=,%cpu=,rss=,etime='], { maxBuffer: 8e6 }, (err, so) => {
        if (!err) {
          const m = new Map();
          for (const line of so.split('\n')) {
            const p = line.trim().split(/\s+/);
            if (p.length < 6) continue;
            m.set(+p[0], { ppid: +p[1], tty: p[2], cpu: +p[3], rss: +p[4], etime: p[5] });
          }
          this.ps = m;
        }
        res();
      });
    });
  }

  // The live Claude session that started this process (its Bash ran a script that ran `claude -p`), if any.
  spawnedBy(pid) {
    let p = this.ps.get(pid);
    for (let i = 0; p && i < 12; i++) { const up = this.sessions.get(p.ppid); if (up) return up.sessionId; p = this.ps.get(p.ppid); }
    return null;
  }

  // Is `pid` a descendant of `ancestor`?
  descends(pid, ancestor) {
    for (let i = 0; i < 12 && pid > 1; i++) {
      if (pid === ancestor) return true;
      const p = this.ps.get(pid); if (!p) return false; pid = p.ppid;
    }
    return false;
  }

  // ---- transcript discovery ------------------------------------------------
  discoverFiles() {
    const cutoff = Date.now() - 36 * 3600e3;
    let dirs = [];
    try { dirs = fs.readdirSync(PROJ_DIR); } catch { }
    const liveSids = new Set([...this.sessions.values()].map(s => s.sessionId));
    for (const d of dirs) {
      const pd = path.join(PROJ_DIR, d);
      let ents; try { ents = fs.readdirSync(pd, { withFileTypes: true }); } catch { continue; }
      for (const e of ents) {
        if (e.isFile() && e.name.endsWith('.jsonl')) {
          const sid = e.name.slice(0, -6);
          const f = path.join(pd, e.name);
          let st; try { st = fs.statSync(f); } catch { continue; }
          if (liveSids.has(sid) || st.mtimeMs > cutoff) {
            if (!this.tails.has(f)) this.tails.set(f, new FileTail(f, sid, false));
            this.sidToFile.set(sid, f);
          }
        } else if (e.isDirectory()) {
          const sub = path.join(pd, e.name, 'subagents');
          let subs; try { subs = fs.readdirSync(sub); } catch { continue; }
          for (const s of subs) {
            if (!s.endsWith('.jsonl')) continue;
            const f = path.join(sub, s);
            if (this.tails.has(f)) continue;
            let st; try { st = fs.statSync(f); } catch { continue; }
            if (liveSids.has(e.name) || st.mtimeMs > cutoff) this.tails.set(f, new FileTail(f, e.name, true));
          }
        }
      }
    }
  }

  // ---- incremental read ----------------------------------------------------
  async readTail(t) {
    let st; try { st = fs.statSync(t.file); } catch { return; }
    if (st.size < t.offset) { t.offset = 0; t.rest = ''; }   // truncated/rewritten
    if (st.size === t.offset) return;
    t.size = st.size;
    const initial = t.offset === 0;
    const fd = fs.openSync(t.file, 'r');
    const CH = 4 << 20;
    const buf = Buffer.alloc(CH);
    try {
      while (t.offset < st.size) {
        const n = fs.readSync(fd, buf, 0, Math.min(CH, st.size - t.offset), t.offset);
        if (n <= 0) break;
        t.offset += n;
        const text = t.rest + buf.toString('utf8', 0, n);
        const lines = text.split('\n');
        t.rest = lines.pop();
        const nearEnd = st.size - t.offset < (2 << 20);
        for (const l of lines) this.processLine(t, l, initial && !nearEnd);
        if (initial) await new Promise(r => setImmediate(r));   // stay responsive on big files
      }
    } finally { fs.closeSync(fd); }
    if (!t.isSub) this.stat(t.sid).lastWriteAt = st.mtimeMs;
  }

  processLine(t, line, quiet) {
    if (t.isSub && line) {
      const tsm0 = /"timestamp":"([^"]+)"/.exec(line), ts0 = tsm0 ? Date.parse(tsm0[1]) : 0;
      if (ts0) {
        if (t.agentLabel == null) {                       // the Agent call's description, from <agent>.meta.json
          try { t.agentLabel = JSON.parse(fs.readFileSync(t.file.replace(/\.jsonl$/, '.meta.json'), 'utf8')).description || ''; } catch { t.agentLabel = ''; }
        }
        this.stat(t.sid).touchRoot('agent:' + path.basename(t.file, '.jsonl'), 'agent', t.agentLabel || 'sub-agent', ts0);
      }
    }
    if (!line) return;
    const tsm = /"timestamp":"([^"]+)"/.exec(line);
    const ts = tsm ? Date.parse(tsm[1]) : 0;
    const isAsst = line.includes('"type":"assistant"');
    if (!t.isSub) {                                          // when you or Claude last really did something (a resume only adds housekeeping lines)
      const st = this.stat(t.sid), asked = !isAsst && line.includes('"type":"user"') && !line.includes('"isMeta":true') && !line.includes('"tool_result"') && !line.includes('<local-command') && !line.includes('<command-name>/exit');
      if (ts && (isAsst || asked) && ts > (st.lastUseAt || 0)) st.lastUseAt = ts;
      if (asked) { if (line.includes('"entrypoint":"sdk-cli"')) st.sdk = true; else if (line.includes('"entrypoint":"cli"')) st.cliAsked = true; }   // a script's `claude -p` run vs a prompt typed in
    }
    if (!isAsst) {
      if (ts) t.prevTs = ts;
      if (!t.isSub && line.startsWith('{"type":"custom-title"')) { try { this.stat(t.sid).customTitle = JSON.parse(line).customTitle || ''; } catch { } return; }
      if (!t.isSub && line.startsWith('{"type":"ai-title"')) { try { this.stat(t.sid).aiTitle = JSON.parse(line).aiTitle || ''; } catch { } return; }
      if (quiet) return;
      if (line.includes('"type":"user"') && !t.isSub) {
        let j; try { j = JSON.parse(line); } catch { return; }
        const c = j.message && j.message.content;
        const s = this.stat(t.sid);
        if (ts && /scheduled|cron|<<autonomous-loop/i.test(typeof c === 'string' ? c.slice(0, 400) : JSON.stringify(c || '').slice(0, 400)))
          for (const [k, r] of s.roots) if (r.kind === 'cron' || r.kind === 'loop') r.at = Math.max(r.at, ts);
        if (typeof c === 'string') { if (!j.isMeta && !c.startsWith('<')) s.pushLog(ts, 'you', c); }
        else if (Array.isArray(c)) {
          for (const b of c) {
            if (b.type === 'text' && !j.isMeta && !b.text.startsWith('<')) s.pushLog(ts, 'you', b.text);
            if (b.type === 'tool_result' && b.is_error) s.pushLog(ts, 'err', 'tool error: ' + (typeof b.content === 'string' ? b.content : '').slice(0, 120));
          }
        }
      }
      return;
    }
    let j; try { j = JSON.parse(line); } catch { return; }
    const m = j.message || {};
    const s = this.stat(t.sid);
    if (j.isApiErrorMessage) {
      s.errors.push(ts);
      const txt = (m.content || []).map(b => b.text || '').join(' ');
      s.lastError = txt.slice(0, 200);
      if (!quiet) s.pushLog(ts, 'err', txt);
      return;
    }
    const u = m.usage; if (!u || !m.model || m.model === '<synthetic>') return;
    const id = m.id || j.requestId || j.uuid;
    let rec = t.msgs.get(id);
    if (!rec) {
      rec = { model: m.model, start: t.prevTs || ts, end: ts, cost: 0, out: 0, inp: 0, cr: 0, cw: 0, ev: null };
      t.msgs.set(id, rec);
      if (t.msgs.size > 400) t.msgs.delete(t.msgs.keys().next().value);
      if (!t.isSub) { s.turns++; if (ts > Date.now() - 864e5) s.turnTimes.push(ts); }   // for 24 h frequency
    }
    // Same message is re-logged once per content block with cumulative usage → apply deltas.
    const cost = costOf(m.model, u);
    const out = u.output_tokens || 0, inp = u.input_tokens || 0,
      cr = u.cache_read_input_tokens || 0, cw = u.cache_creation_input_tokens || 0;
    const d = { usd: cost - rec.cost, out: out - rec.out, in: inp - rec.inp, cr: cr - rec.cr, cw: cw - rec.cw };
    Object.assign(rec, { cost, out, inp, cr, cw, end: ts });
    const bm = s.byModel[m.model] || (s.byModel[m.model] = { usd: 0, out: 0, in: 0, cr: 0, cw: 0 });
    for (const k of ['usd', 'out', 'in', 'cr', 'cw']) { s.total[k] += d[k]; bm[k] += d[k]; }
    if (ts >= this.dayStart) {
      const tok = d.in + d.out + d.cr + d.cw;
      s.today.usd += d.usd; s.today.out += d.out; s.today.tok += tok;
      const tm = s.todayByModel[m.model] || (s.todayByModel[m.model] = { usd: 0, out: 0, tok: 0 });
      tm.usd += d.usd; tm.out += d.out; tm.tok += tok;
    }
    const dur = Math.max(0.3, (rec.end - rec.start) / 1000);
    if (ts > Date.now() - 15 * 60e3) {
      // one event per DELTA, stamped when those tokens arrived — so history never shifts as a reply keeps streaming
      if (d.out > 0 || d.usd > 0) s.events.push({ t: ts, out: Math.max(0, d.out), usd: Math.max(0, d.usd), tok: Math.max(0, d.in + d.out + d.cr + d.cw), model: m.model, sub: t.isSub, dur, msg: id });
    }
    // does this session reach the 24/7 server? (ssh/scp/rsync to a host in serverHosts, Tailscale SSH,
    // the run-on-server skill or its scripts) — sticky per session, with the time of the latest use
    if (!t.isSub) for (const b of m.content || []) {
      if (b.type !== 'tool_use') continue;
      const inp = b.input || {};
      if (b.name === 'ScheduleWakeup') {               // /loop without an interval: each tick schedules the next one
        if (inp.stop) s.roots.delete('loop:wakeup'); else s.touchRoot('loop:wakeup', 'loop', String(inp.reason || inp.prompt || '/loop').slice(0, 80), ts);
      } else if (b.name === 'CronCreate') {
        const lab = String(inp.prompt || inp.description || inp.cron || 'cron').replace(/\s+/g, ' ').slice(0, 80);
        s.touchRoot('cron:' + (inp.cron || inp.schedule || '') + lab.slice(0, 30), 'cron', lab, ts);
      } else if (b.name === 'CronDelete') {
        for (const k of [...s.roots.keys()]) if (k.startsWith('cron:')) s.roots.delete(k);
      } else if (b.name === 'Skill' && inp.skill) {     // a skill the session runs (each run refreshes it)
        s.touchRoot('skill:' + inp.skill, 'skill', inp.skill + (inp.args ? ' ' + String(inp.args).replace(/\s+/g, ' ').slice(0, 40) : ''), ts);
      } else if (b.name === 'Monitor') {
        s.touchRoot('monitor:' + String(inp.description || inp.command || '').slice(0, 40), 'monitor', String(inp.description || inp.command || 'monitor').slice(0, 80), ts);
      }
    }
    for (const b of m.content || []) {
      if (b.type !== 'tool_use') continue;
      const inp = b.input || {}, txt = b.name === 'Skill' ? 'skill:' + (inp.skill || '') : String(inp.command || inp.cmd || '');
      if (SERVER_RE.test(txt)) { s.serverUses = (s.serverUses || 0) + 1; s.serverAt = Math.max(s.serverAt || 0, ts || Date.now()); }
    }
    if (!t.isSub) {
      s.lastModel = m.model;
      s.lastCtx = inp + cr + cw;
      s.lastAssistantAt = ts;
      if (out > 20) s.lastSpeed = out / dur;
      if (!quiet) for (const b of m.content || []) {
        if (b.type === 'text' && b.text.trim()) s.pushLog(ts, 'claude', b.text);
        else if (b.type === 'tool_use') s.pushLog(ts, 'tool', b.name + ' ' + summarizeInput(b.input));
      }
    }
  }

  // A Hermes session's numbers come from Hermes' own state.db (hermes-sessions.js), not a Claude transcript
  fillHermes(j) {
    const s = this.stat(j.sessionId), H = j.hermes, now = Date.now();
    s.hermes = true;
    s.lastWriteAt = Math.max(j.updatedAt || 0, j.hook && j.hook.at ? j.hook.at * 1000 : 0);
    if (!H) return;
    const r = H.row, tot = { in: r.input_tokens || 0, out: (r.output_tokens || 0) + (r.reasoning_tokens || 0), cr: r.cache_read_tokens || 0, cw: r.cache_write_tokens || 0 };
    const all = tot.in + tot.out + tot.cr + tot.cw, prev = s.hTot;
    if (prev && all > prev.all) {              // tokens since the last read: one event, for the live rate and the sparkline
      const d = { out: Math.max(0, tot.out - prev.out), tok: all - prev.all };
      s.events.push({ t: now, out: d.out, usd: 0, tok: d.tok, model: r.model, sub: false, dur: 1, msg: 'h' + now });
      if (now >= this.dayStart) {
        s.today.out += d.out; s.today.tok += d.tok;
        const tm = s.todayByModel[r.model] || (s.todayByModel[r.model] = { usd: 0, out: 0, tok: 0 }); tm.out += d.out; tm.tok += d.tok;
      }
    } else if (!prev && r.started_at * 1000 >= this.dayStart) {   // a session started today: all of it is today's
      s.today.out = tot.out; s.today.tok = all; s.todayByModel[r.model] = { usd: 0, out: tot.out, tok: all };
    }
    s.hTot = { ...tot, all };
    s.total = { usd: 0, ...tot };
    s.byModel = {}; for (const u of H.usage) s.byModel[u.model] = { usd: 0, out: u.output_tokens || 0, in: u.input_tokens || 0, cr: u.cache_read_tokens || 0, cw: u.cache_write_tokens || 0 };
    s.lastModel = r.model || s.lastModel; s.customTitle = r.title || s.customTitle;
    s.turns = H.msgs.filter(m => m.role === 'assistant').length;
    const lastU = H.msgs.filter(m => m.role === 'user' || m.role === 'assistant').pop();
    if (lastU) s.lastUseAt = Math.max(s.lastUseAt || 0, lastU.timestamp * 1000);
    if (j.ctx) { s.lastCtx = j.ctx.used; s.ctxMax = j.ctx.max; } else if (j.hook && j.hook.ctx) s.lastCtx = j.hook.ctx;
    s.log = H.msgs.map(m => {
      const t = Math.round(m.timestamp * 1000);
      if (m.role === 'user') return { t, kind: 'you', text: m.content };
      if (m.role === 'tool') return { t, kind: 'tool', text: (m.tool_name || 'tool') + ' ' + m.content };
      if (m.role === 'assistant' && !m.content && m.tool_calls) { let n = ''; try { n = JSON.parse(m.tool_calls).map(c => (c.function || {}).name || c.name).join(', '); } catch { } return { t, kind: 'tool', text: n || 'tool call' }; }
      return { t, kind: 'claude', text: m.content };
    }).filter(e => e.text).map(e => ({ ...e, text: String(e.text).replace(/\s+/g, ' ').slice(0, 220) }));
  }

  // ---- main loop ------------------------------------------------------------
  async tick() {
    if (this.scanning) return;
    this.scanning = true;
    try {
      const now = Date.now();
      const ds = new Date().setHours(0, 0, 0, 0);
      if (ds !== this.dayStart) {           // midnight rollover
        this.dayStart = ds;
        for (const s of this.stats.values()) { s.today = { usd: 0, out: 0, tok: 0 }; s.todayByModel = {}; }
      }
      this.readSessions();
      if (this.extraSessions) {                 // Hermes Agent sessions in Mesh's tmux panes (hermes-sessions.js)
        let ex = []; try { ex = await this.extraSessions(); } catch { }
        for (const j of ex) { this.sessions.set(j.pid, j); this.fillHermes(j); }
      }
      await this.refreshPs();
      await this.readRcNames();
      if (!this._lastDisc || now - this._lastDisc > 5000) { this.discoverFiles(); this._lastDisc = now; }
      for (const t of this.tails.values()) await this.readTail(t);
      for (const s of this.stats.values()) {
        s.events = s.events.filter(e => e.t > now - 15 * 60e3);
        s.errors = s.errors.filter(e => e > now - 3600e3);
        if (s.turnTimes.length && s.turnTimes[0] < now - 864e5) s.turnTimes = s.turnTimes.filter(x => x > now - 864e5);
      }
      this.ready = true;
    } finally { this.scanning = false; }
  }

  snapshot(ptyMap) {
    const now = Date.now();
    const sessions = [];
    const models = {};
    const addModel = (model, v) => {
      const f = family(model);
      const m = models[f] || (models[f] = { family: f, todayUsd: 0, todayOut: 0, todayTok: 0, tps: 0, liveUsdHr: 0, liveTokHr: 0, sessions: 0 });
      m.todayUsd += v.usd; m.todayOut += v.out; m.todayTok += v.tok || 0;
    };
    for (const s of this.stats.values()) for (const [mod, v] of Object.entries(s.todayByModel)) addModel(mod, v);

    for (const [pid, j] of this.sessions) {
      if (j.cwd && /[\\/]project-cards[\\/]run$/.test(j.cwd)) continue;   // the app's own Project card writer (project-cards.js), not a session of yours
      const s = this.stat(j.sessionId);
      const p = this.ps.get(pid) || {};
      const win = s.events.filter(e => e.t > now - 60e3);
      const tps = win.reduce((a, e) => a + e.out, 0) / 60;
      const last5 = s.events.filter(e => e.t > now - 300e3);
      const usdHr = last5.reduce((a, e) => a + e.usd, 0) * 12, tokHr = last5.reduce((a, e) => a + (e.tok || 0), 0) * 12;
      const subActive = new Set(s.events.filter(e => e.sub && e.t > now - 90e3).map(e => e.msg)).size;
      // 30 bins × 10 s = last 5 min, tok/s per bin. Bins sit on fixed 10-s clock boundaries so a bin's height
      // never changes once it's past; the newest (still-filling) bin is the only one that moves.
      const spark = [], edge = Math.ceil(now / 10e3) * 10e3, bins = new Map();
      for (const e of s.events) { const k = Math.ceil(e.t / 10e3) * 10e3; bins.set(k, (bins.get(k) || 0) + e.out); }
      for (let i = 29; i >= 0; i--) spark.push((bins.get(edge - i * 10e3) || 0) / 10);
      const sparkPeak = Math.max(0, ...[...bins.values()].map(v => v / 10));   // highest bin in the last 15 min → steady scale
      const err5 = s.errors.filter(t => t > now - 5 * 60e3).length;
      const sinceWrite = (now - (s.lastWriteAt || j.updatedAt || now)) / 1000;
      let health = j.status === 'busy' ? 'working' : 'idle';
      if (j.status === 'busy' && sinceWrite > 300) health = 'quiet';
      if (err5) health = 'error';
      if (j.status && !['busy', 'idle'].includes(j.status)) health = 'waiting';
      const model = s.lastModel || '';
      if (model && !models[family(model)]) addModel(model, 0, 0);
      const fam = family(model);
      if (models[fam]) { models[fam].tps += tps; models[fam].liveUsdHr += usdHr; models[fam].liveTokHr += tokHr; models[fam].sessions++; }
      let owner = null;
      for (const [ptyId, ptyPid] of ptyMap) if (this.descends(pid, ptyPid)) owner = ptyId;
      sessions.push({
        pid, sid: j.sessionId, name: sessionName(j, s, this.rcNames && this.rcNames.get(pid)), cwd: j.cwd, kind: j.kind, engine: j.engine || undefined, hermesPane: j.kind === 'hermes' ? j.pane : undefined,
        status: j.status, health, tty: p.tty && !/^\?+$/.test(p.tty) ? '/dev/' + p.tty : null,   // macOS prints ??, Linux ? for none
        cpu: p.cpu || 0, rssMb: Math.round((p.rss || 0) / 1024), etime: p.etime || '',
        startedAt: j.startedAt, version: j.version, remote: !!j.bridgeSessionId,
        model, family: fam, ctx: s.lastCtx, ctxMax: (s.hermes && s.ctxMax) || ctxWindow(model),
        totalUsd: s.total.usd, todayUsd: s.today.usd, totalTok: s.total.in + s.total.out + s.total.cr + s.total.cw, todayTok: s.today.tok, tokHr, tokIn: s.total.in, tokOut: s.total.out,
        tokCacheRead: s.total.cr, tokCacheWrite: s.total.cw,
        byModel: s.byModel, tps, lastSpeed: s.lastSpeed, usdHr, turns: s.turns,
        // activity frequency: replies over 24 h, recent ones weigh more (half-life 3 h)
        freq: s.turnTimes.reduce((a, x) => a + Math.pow(.5, (now - x) / 108e5), 0),
        subagents: subActive, errors5m: err5, errors1h: s.errors.length, lastError: s.lastError, serverUses: s.serverUses || 0, serverAt: s.serverAt || 0,
        sinceWrite, sinceUse: s.lastUseAt ? (now - s.lastUseAt) / 1000 : sinceWrite, spark, sparkPeak,
        // nobody named it (Claude's folder + id, e.g. web-42), or a script's `claude -p` run nobody ever typed into
        spawnedBy: this.spawnedBy(pid), auto: j.nameSource === 'derived' && !s.customTitle && !s.aiTitle, headless: j.entrypoint === 'sdk-cli' || (!!s.sdk && !s.cliAsked),
 log: s.log.slice(-40), owner,
        // roots: loop jobs / monitors / sub-agents of this session active in the last 24 h (newest first, max 8)
        roots: [...s.roots.values()].filter(r => r.at > now - 864e5).sort((a, b) => b.at - a.at).slice(0, 8),
      });
    }
    sessions.sort((a, b) => a.startedAt - b.startedAt);
    let todayAll = 0, todayTok = 0; for (const m of Object.values(models)) { todayAll += m.todayUsd; todayTok += m.todayTok; }
    return { t: now, ready: this.ready, sessions, models: Object.values(models), todayUsd: todayAll, todayTok };
  }
}

// Display name: an explicit /rename wins, then a name Claude set itself, then the conversation's
// title (custom/AI) — the auto "user-xx" derived name only as a last resort.
function sessionName(j, s, rcName) {
  if (j.name && j.nameSource && !['derived', 'auto'].includes(j.nameSource)) return j.name;
  return s.customTitle || (j.nameSource === 'auto' && j.name) || rcName || s.aiTitle || j.name || j.sessionId.slice(0, 8);
}

function summarizeInput(inp) {
  if (!inp) return '';
  const v = inp.command || inp.file_path || inp.pattern || inp.description || inp.url || inp.query || inp.skill || '';
  return String(v).replace(HOME, '~').slice(0, 140);
}

module.exports = { Collector, costOf, family };
