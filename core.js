// Host-independent pieces of Mesh shared by the Mac app (main.js) and the headless server
// program (server/mesh-server.js): session history, per-session details, custom slash commands,
// background agents (`claude agents`) and plan-usage limits. Nothing here touches Electron.
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFile } = require('child_process');
const APP_NAME = require('./mesh-name').name;           // the app's name — one setting (mesh-name.js)

const HOME = os.homedir();
const PROJ_DIR = path.join(HOME, '.claude', 'projects');

// a child Claude must not think it runs inside another Claude session
function cleanEnv() {
  const e = { ...process.env };
  for (const k of Object.keys(e)) if (/^(CLAUDECODE|CLAUDE_CODE_|ELECTRON_|MESH_)/.test(k)) delete e[k];
  return e;
}
function loginShell() { return process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash'); }
// Windows: where Claude Code's official installer (claude.ai/install.ps1) and npm put the binary
function winClaudeBin() {
  const c = [path.join(HOME, '.local', 'bin', 'claude.exe'), path.join(process.env.APPDATA || '', 'npm', 'claude.cmd')];
  return c.find(p => fs.existsSync(p)) || null;
}

// opts: { userData (cache dir), getToken: async () → Claude OAuth access token or null }
function createCore(opts) {
  const userData = opts.userData;
  fs.mkdirSync(userData, { recursive: true });

  // ---------------- custom slash commands: ~/.claude/{commands,skills} (+ the session's project .claude) ----------------
  function readDesc(file) {
    try {
      const head = fs.readFileSync(file, 'utf8').slice(0, 1500);
      const fm = /^---\n([\s\S]*?)\n---/.exec(head);
      if (fm) {
        const name = (/^name:\s*(.+)$/m.exec(fm[1]) || [])[1];
        let desc = (/^description:\s*(?:>-?|\|)?\s*\n?\s*([^\n]+)/m.exec(fm[1]) || [])[1] || '';
        return { name: name && name.trim().replace(/^["']|["']$/g, ''), desc: desc.trim().replace(/^["']|["']$/g, '') };
      }
      return { desc: (head.split('\n').find(l => l.trim() && !l.startsWith('#')) || '').trim() };
    } catch { return {}; }
  }
  function scanCommands(base, scope) {
    const out = [];
    try { for (const f of fs.readdirSync(path.join(base, 'commands'))) if (f.endsWith('.md')) { const d = readDesc(path.join(base, 'commands', f)); out.push({ cmd: '/' + f.slice(0, -3), desc: d.desc || 'Custom command', group: scope }); } } catch { }
    try {
      for (const e of fs.readdirSync(path.join(base, 'skills'), { withFileTypes: true })) {
        if (e.isDirectory()) { const f = path.join(base, 'skills', e.name, 'SKILL.md'); if (fs.existsSync(f)) { const d = readDesc(f); out.push({ cmd: '/' + (d.name || e.name), desc: d.desc || 'Skill', group: scope }); } }
        else if (e.name.endsWith('.md')) { const d = readDesc(path.join(base, 'skills', e.name)); out.push({ cmd: '/' + (d.name || e.name.slice(0, -3)), desc: d.desc || 'Skill', group: scope }); }
      }
    } catch { }
    return out;
  }
  function commandsFor(cwd) {
    const list = scanCommands(path.join(HOME, '.claude'), 'Your skills & commands');
    if (cwd && cwd !== HOME) list.push(...scanCommands(path.join(cwd, '.claude'), 'Project'));
    const seen = new Set(); return list.filter(c => !seen.has(c.cmd) && seen.add(c.cmd));
  }

  // ---------------- session history (what `claude --resume` lists) ----------------
  const histCache = new Map();      // file -> { mtimeMs, size, meta }
  const readSlice = (fd, pos, len) => { const b = Buffer.alloc(len); const n = fs.readSync(fd, b, 0, len, pos); return b.toString('utf8', 0, n); };
  const promptText = m => {
    const c = m && m.content; let t = typeof c === 'string' ? c : Array.isArray(c) ? (c.find(x => x.type === 'text') || {}).text || '' : '';
    t = t.trim(); if (!t || /^<(command|local-command|system-reminder|bash-)/.test(t) || t.startsWith('Caveat:')) return '';
    return t.replace(/\s+/g, ' ').slice(0, 200);
  };
  function histMeta(file, st) {
    const meta = { sid: path.basename(file, '.jsonl'), file, mtime: st.mtimeMs, size: st.size, cwd: '', first: '', last: '', aiTitle: '', title: '', entry: '', branch: '' };
    let fd; try { fd = fs.openSync(file, 'r'); } catch { return null; }
    try {
      let head = '';
      for (let n = 262144; ; n *= 4) {          // grow the head until the first prompt + cwd are in it (big pastes)
        head = readSlice(fd, 0, Math.min(st.size, n));
        if (n >= st.size || n >= 16777216 || (/"cwd":/.test(head) && /"type":"user"[^\n]*"origin":\{"kind":"human"/.test(head))) break;
      }
      for (const line of head.split('\n')) {
        if (!line.includes('"type":"user"') && !line.includes('"cwd"')) continue;
        let j; try { j = JSON.parse(line); } catch { continue; }
        if (!meta.cwd && j.cwd) meta.cwd = j.cwd;
        if (!meta.entry && j.entrypoint) meta.entry = j.entrypoint;
        if (!meta.branch && j.gitBranch) meta.branch = j.gitBranch;
        if (!meta.first && j.type === 'user' && !j.isMeta && !j.isSidechain) meta.first = promptText(j.message);
        if (meta.cwd && meta.first && meta.entry) break;
      }
      const tl = Math.min(st.size, 524288), tail = readSlice(fd, st.size - tl, tl).split('\n');
      for (let i = tail.length - 1; i >= 0 && !(meta.last && meta.aiTitle); i--) {
        const l = tail[i];
        if (!meta.last && l.includes('"type":"last-prompt"')) try { meta.last = (JSON.parse(l).lastPrompt || '').replace(/\s+/g, ' ').slice(0, 200); } catch { }
        if (!meta.aiTitle && l.includes('"type":"ai-title"')) try { meta.aiTitle = JSON.parse(l).aiTitle || ''; } catch { }
      }
    } finally { fs.closeSync(fd); }
    return meta.first || meta.last ? meta : null;
  }
  // titles can sit anywhere in a big transcript → read each changed file once and take the LAST
  // custom-title / ai-title record (Buffer.lastIndexOf is far faster than grep on ~1GB of jsonl)
  const T_CUSTOM = Buffer.from('{"type":"custom-title"'), T_AI = Buffer.from('{"type":"ai-title"');
  async function scanTitles(file, meta, from = 0) {
    let buf;
    try {
      if (!from) buf = await fs.promises.readFile(file);
      else { const fh = await fs.promises.open(file, 'r'); try { buf = Buffer.alloc(meta.size - from); await fh.read(buf, 0, buf.length, from); } finally { await fh.close(); } }
    } catch { return; }
    const pick = tag => { const i = buf.lastIndexOf(tag); if (i < 0) return null; let e = buf.indexOf(10, i); if (e < 0) e = buf.length; try { return JSON.parse(buf.toString('utf8', i, e)); } catch { return null; } };
    const c = pick(T_CUSTOM), a = pick(T_AI);
    if (c && c.customTitle != null) meta.title = c.customTitle;
    if (a && a.aiTitle) meta.aiTitle = a.aiTitle;
  }
  const HIST_CACHE_FILE = path.join(userData, 'history-cache.json');
  let histLoaded = false, histScan = null;
  const listHistory = () => histScan || (histScan = scanHistory().finally(() => { histScan = null; }));
  async function scanHistory() {
    if (!histLoaded) {                 // warm start from the previous run's cache
      histLoaded = true;
      try { for (const [f, c] of Object.entries(JSON.parse(fs.readFileSync(HIST_CACHE_FILE, 'utf8')))) histCache.set(f, c); } catch { }
    }
    const files = [];
    try { for (const d of fs.readdirSync(PROJ_DIR)) { const dir = path.join(PROJ_DIR, d); try { for (const f of fs.readdirSync(dir)) if (f.endsWith('.jsonl')) files.push(path.join(dir, f)); } catch { } } } catch { }
    let changed = 0;
    for (const f of files) {
      let st; try { st = fs.statSync(f); } catch { continue; }
      const c = histCache.get(f);
      if (c && c.mtimeMs === st.mtimeMs && c.size === st.size) continue;
      const meta = histMeta(f, st);
      // a growing transcript only needs its new bytes scanned; earlier titles carry over
      const grew = c && c.meta && meta && st.size > c.size;
      if (grew) { meta.title = c.meta.title; meta.aiTitle = meta.aiTitle || c.meta.aiTitle; }
      if (meta) await scanTitles(f, meta, grew ? c.size : 0);
      histCache.set(f, { mtimeMs: st.mtimeMs, size: st.size, meta }); changed++;
    }
    const live = new Set(files);
    for (const f of histCache.keys()) if (!live.has(f)) { histCache.delete(f); changed++; }
    if (changed) try { fs.writeFileSync(HIST_CACHE_FILE, JSON.stringify(Object.fromEntries(histCache))); } catch { }
    return [...histCache.values()].map(c => c.meta).filter(Boolean).sort((a, b) => b.mtime - a.mtime);
  }
  const histEntry = sid => [...histCache.values()].map(c => c.meta).find(m => m && m.sid === sid) || null;
  function findTranscript(sid) {
    const h = histEntry(sid); if (h) return h.file;
    try { for (const d of fs.readdirSync(PROJ_DIR)) { const f = path.join(PROJ_DIR, d, sid + '.jsonl'); if (fs.existsSync(f)) return f; } } catch { }
    return null;
  }
  // Rename = the same record `/rename` writes, appended to the transcript (shows in the /resume picker)
  function renameTranscript(sid, name) {
    const file = findTranscript(sid);
    if (!file) return { ok: false, err: 'transcript not found' };
    fs.appendFileSync(file, JSON.stringify({ type: 'custom-title', customTitle: String(name), sessionId: sid }) + '\n');
    const h = histEntry(sid); if (h) h.title = String(name);
    return { ok: true };
  }

  // ---------------- session details (press-and-hold on a session bubble) ----------------
  // Skills / slash commands / tools a session used, its latest compaction summary (its "context md"),
  // first & last prompt, and the CLAUDE.md instructions it runs under. Parsed incrementally per file.
  const detailCache = new Map();          // file -> { size, skills, cmds, tools, summary, lastText }
  const bump = (o, k) => { if (k) o[k] = (o[k] || 0) + 1; };
  async function sessionDetails(sid) {
    const file = findTranscript(sid); if (!file) return { ok: false, err: 'transcript not found' };
    const st = fs.statSync(file);
    let d = detailCache.get(file);
    if (!d || st.size < d.size) d = { size: 0, skills: {}, cmds: {}, tools: {}, summary: '', summaryAt: '', lastText: '', rest: '' };
    if (st.size > d.size) {                                   // read only the new bytes
      const fh = await fs.promises.open(file, 'r');
      try {
        const CH = 8 << 20;
        for (let pos = d.size; pos < st.size; pos += CH) {
          const len = Math.min(CH, st.size - pos), b = Buffer.alloc(len); await fh.read(b, 0, len, pos);
          const lines = (d.rest + b.toString('utf8')).split('\n'); d.rest = lines.pop();
          for (const line of lines) {
            if (line.includes('"name":"Skill"')) for (const m of line.matchAll(/"name":"Skill","input":\{"skill":"([^"]+)"/g)) bump(d.skills, m[1]);
            if (line.includes('<command-name>')) for (const m of line.matchAll(/<command-name>\/?([^<]+)<\/command-name>/g)) bump(d.cmds, '/' + m[1].trim());
            if (line.includes('"type":"tool_use"')) for (const m of line.matchAll(/"type":"tool_use","id":"[^"]*","name":"([^"]+)"/g)) if (m[1] !== 'Skill') bump(d.tools, m[1]);
            if (line.includes('"isCompactSummary":true')) {
              try { const j = JSON.parse(line), c = j.message && j.message.content; const t = typeof c === 'string' ? c : Array.isArray(c) ? c.map(x => x.text || '').join('\n') : '';
                d.summary = t.replace(/^This session is being continued[^\n]*\n+/, '').replace(/^The summary below covers[^\n]*\n+/, '').trim(); d.summaryAt = j.timestamp || ''; } catch { }
            }
            if (line.includes('"type":"assistant"') && line.includes('"type":"text"')) {
              try { const j = JSON.parse(line), t = (j.message.content || []).filter(x => x.type === 'text').map(x => x.text).join('\n').trim(); if (t.length > 40) d.lastText = t; } catch { }
            }
          }
        }
      } finally { await fh.close(); }
      d.size = st.size; detailCache.set(file, d);
    }
    const meta = histEntry(sid) || histMeta(file, st) || {};
    const cwd = meta.cwd || '';
    const readMd = f => { try { const t = fs.readFileSync(f, 'utf8'); return { path: f.replace(HOME, '~'), text: t.length > 6000 ? t.slice(0, 6000) + '\n…' : t }; } catch { return null; } };
    const instructions = [cwd && cwd !== HOME && readMd(path.join(cwd, 'CLAUDE.md')), cwd && readMd(path.join(cwd, '.claude', 'CLAUDE.md')), readMd(path.join(HOME, 'CLAUDE.md')), readMd(path.join(HOME, '.claude', 'CLAUDE.md'))]
      .filter(Boolean).filter((v, i, a) => a.findIndex(x => x.path === v.path) === i);
    const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);
    return { ok: true, sid, cwd, title: meta.title || meta.aiTitle || '', first: meta.first || '', last: meta.last || '',
      skills: top(d.skills, 30), cmds: top(d.cmds, 20), tools: top(d.tools, 12),
      summary: d.summary.slice(0, 12000), summaryAt: d.summaryAt, lastText: d.lastText.slice(0, 1500), instructions };
  }

  // ---------------- background agents (`claude agents`, `claude --bg`) ----------------
  let claudeBin = null;            // resolved once through a login shell (PATH from the user's profile)
  function resolveClaude() {
    if (claudeBin) return Promise.resolve(claudeBin);
    if (process.platform === 'win32') return Promise.resolve(claudeBin = winClaudeBin() || 'claude');
    return new Promise(res => execFile(loginShell(), ['-l', '-i', '-c', 'command -v claude'], { env: cleanEnv(), timeout: 15000 }, (_e, so) => {
      const p = String(so || '').trim().split('\n').pop(); claudeBin = p && fs.existsSync(p) ? p : path.join(HOME, '.local', 'bin', 'claude'); res(claudeBin);
    }));
  }
  async function claudeCli(args, cwd) {
    const bin = await resolveClaude();
    return new Promise(res => execFile(bin, args, { cwd: cwd && fs.existsSync(cwd) ? cwd : HOME, env: { ...cleanEnv(), PATH: path.dirname(bin) + path.delimiter + (process.env.PATH || '/usr/bin:/bin') }, timeout: 60000, maxBuffer: 16e6, shell: /\.cmd$/i.test(bin) },
      (err, so, se) => res({ ok: !err, out: String(so || '').trim(), err: String(se || (err && err.message) || '').trim() })));
  }
  // the probe's "find me …": which live session or installed skill fits what you asked for. A quick Haiku call picks it
  // from the list (it understands paraphrases and Korean); the renderer falls back to keyword matching if this fails.
  // sessions = [{ sid, name, cwd, last }] from the renderer. → { ok, kind: 'session'|'skill'|'none', id, why }
  async function probeMatch(ask, sessions) {
    const skills = commandsFor(HOME).filter(c => c.group === 'Your skills & commands').slice(0, 120);
    const clip = (x, n) => String(x || '').replace(/\s+/g, ' ').slice(0, n);
    const list = [
      'SESSIONS (running Claude Code sessions):',
      ...(sessions || []).slice(0, 60).map(s => `- session ${s.sid} | ${clip(s.name, 60)} | dir ${clip(s.cwd, 60)} | last asked: ${clip(s.last, 140)}`),
      'SKILLS (installed skills and commands):',
      ...skills.map(c => `- skill ${c.cmd} | ${clip(c.desc, 260)}`),
    ].join('\n');
    const prompt = `You route a request to the right place in a dashboard of Claude Code sessions and skills.\n\nREQUEST: ${clip(ask, 600)}\n\n${list}\n\n`
      + 'Pick the ONE best match. Prefer a running session when the request is about work that session is already doing; '
      + 'A request to change, fix or ask about a feature of a project goes to the session whose name or directory is that project '
      + '(the ' + APP_NAME + ' session works on the ' + APP_NAME + ' app itself: its probe droid, bubbles, black hole, Endurance station, mother star). '
      + 'Prefer a skill when the request is a task a skill performs. If nothing fits well, answer none.\n'
      + 'Reply with only JSON, no prose: {"kind":"session"|"skill"|"none","id":"<session id or /skill-name>","why":"<12 words max>"}';
    const r = await claudeCli(['-p', prompt, '--model', 'haiku']);
    const m = r.ok && /\{[\s\S]*\}/.exec(r.out);
    if (!m) return { ok: false, err: r.err || 'no answer' };
    try {
      const j = JSON.parse(m[0]), kind = ['session', 'skill', 'none'].includes(j.kind) ? j.kind : 'none';
      if (kind === 'session' && !(sessions || []).some(s => s.sid === j.id)) return { ok: true, kind: 'none', why: '' };
      if (kind === 'skill' && !skills.some(c => c.cmd === j.id)) return { ok: true, kind: 'none', why: '' };
      return { ok: true, kind, id: j.id || '', why: clip(j.why, 120), desc: kind === 'skill' ? (skills.find(c => c.cmd === j.id) || {}).desc || '' : '' };
    } catch { return { ok: false, err: 'bad answer' }; }
  }
  let agentsCache = [], agentsAt = 0, agentsBusy = false;
  async function refreshAgents(force) {
    if (agentsBusy || (!force && Date.now() - agentsAt < 8000)) return agentsCache;
    agentsBusy = true;
    try {
      const r = await claudeCli(['agents', '--json']);
      const i = r.out.indexOf('['); if (i >= 0) agentsCache = JSON.parse(r.out.slice(i)).filter(a => a.kind === 'background');
      agentsAt = Date.now();
    } catch { } finally { agentsBusy = false; }
    return agentsCache;
  }
  // Convert a session into a background agent: resume it under the same id with --bg
  async function convertToAgent(sid, cwd, task) {
    const args = ['--bg', '--dangerously-skip-permissions', '--resume', sid];
    if (task && task.trim()) args.push(task.trim());
    const r = await claudeCli(args, cwd);
    refreshAgents(true);
    return r;
  }

  // ---------------- plan usage limits (what /usage shows) ----------------
  // Same request Claude Code's /usage makes, with the login Claude Code keeps (keychain on the Mac,
  // ~/.claude/.credentials.json on Linux). The token is read per request and never stored or logged.
  // Falls back to the last status-line payload.
  let usage = null, usageAt = 0, usageBusy = false;
  async function refreshUsage(force) {
    if (usageBusy || (!force && Date.now() - usageAt < 180000)) return usage;
    usageBusy = true; usageAt = Date.now();
    try {
      const tok = opts.getToken ? await opts.getToken() : null;
      if (tok) {
        const r = await fetch('https://api.anthropic.com/api/oauth/usage', { headers: { Authorization: 'Bearer ' + tok, 'anthropic-beta': 'oauth-2025-04-20' }, signal: AbortSignal.timeout(15000) });
        if (r.ok) {
          const d = await r.json();
          const limits = (d.limits || []).map(l => ({
            label: l.kind === 'session' ? 'Session' : l.scope && l.scope.model ? l.scope.model.display_name : l.kind === 'weekly_all' ? 'All models' : (l.kind || '').replace(/_/g, ' '),
            kind: l.kind, group: l.group, used: +l.percent || 0, resetsAt: Date.parse(l.resets_at) || 0, severity: l.severity, active: !!l.is_active,
          }));
          // dollar allowances: the plan's monthly credit grant (any entry carrying limit_dollars — the API names it by
          // codename) and pay-as-you-go extra usage when it's switched on
          const credits = [];
          for (const v of Object.values(d)) if (v && typeof v === 'object' && v.limit_dollars > 0)
            credits.push({ label: 'Credits', limit: +v.limit_dollars, used: +v.used_dollars || 0, left: v.remaining_dollars != null ? +v.remaining_dollars : v.limit_dollars - (v.used_dollars || 0), resetsAt: Date.parse(v.resets_at) || 0 });
          const x = d.extra_usage;
          if (x && x.is_enabled && x.monthly_limit > 0) {
            const k = 10 ** (x.decimal_places || 0);
            credits.push({ label: 'Extra usage', limit: x.monthly_limit / k, used: (x.used_credits || 0) / k, left: (x.monthly_limit - (x.used_credits || 0)) / k, resetsAt: 0, currency: x.currency });
          }
          if (limits.length) { usage = { limits, credits, at: Date.now(), src: 'api', monthly: monthlyFrom(limits) }; return usage; }
        }
      }
      // fallback: rate_limits from the newest status-line payload (session + week only)
      const j = JSON.parse(fs.readFileSync(path.join(HOME, '.claude', 'state', 'mesh-statusline.json'), 'utf8')).rate_limits || {};
      const L = []; if (j.five_hour) L.push({ label: 'Session', kind: 'session', group: 'session', used: j.five_hour.used_percentage, resetsAt: j.five_hour.resets_at * 1000 });
      if (j.seven_day) L.push({ label: 'All models', kind: 'weekly_all', group: 'weekly', used: j.seven_day.used_percentage, resetsAt: j.seven_day.resets_at * 1000 });
      if (L.length) usage = { limits: L, credits: (usage && usage.credits) || [], at: Date.now(), src: 'statusline', monthly: monthlyFrom(L) };
    } catch { } finally { usageBusy = false; }
    return usage;
  }
  // There is no monthly plan limit, so "monthly" = this calendar month's share of the weekly
  // allowance: each week's peak usage %, weighted by how many of its days fall in this month,
  // over the number of weeks in the month. Week peaks are remembered across restarts.
  function monthlyFrom(limits) {
    const wk = limits.find(l => l.kind === 'weekly_all'); if (!wk || !wk.resetsAt) return null;
    const f = path.join(userData, 'weekly-usage.json');
    let hist = {}; try { hist = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { }
    const key = String(Math.round(wk.resetsAt / 3600e3));            // one entry per weekly window
    hist[key] = Math.max(hist[key] || 0, wk.used);
    try { fs.writeFileSync(f, JSON.stringify(hist)); } catch { }
    const now = new Date(), m0 = new Date(now.getFullYear(), now.getMonth(), 1).getTime(), m1 = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
    let sum = 0;
    for (const [k, used] of Object.entries(hist)) {
      const end = +k * 3600e3, start = end - 7 * 864e5, overlap = Math.max(0, Math.min(end, m1) - Math.max(start, m0));
      sum += used * overlap / (7 * 864e5);
    }
    return Math.min(1, sum / 100 / ((m1 - m0) / (7 * 864e5)));
  }

  return {
    HOME, cleanEnv, loginShell,
    commandsFor, listHistory, histEntry, findTranscript, renameTranscript, sessionDetails,
    claudeCli, resolveClaude, probeMatch, agents: () => agentsCache, refreshAgents, convertToAgent,
    usage: () => usage, usageTried: () => usageAt > 0 && !usageBusy, refreshUsage,
  };
}

// Linux Claude Code keeps its login here (the Mac uses the keychain — see main.js)
function linuxToken() {
  try { return JSON.parse(fs.readFileSync(path.join(HOME, '.claude', '.credentials.json'), 'utf8')).claudeAiOauth.accessToken || null; } catch { return null; }
}

module.exports = { createCore, cleanEnv, loginShell, linuxToken, winClaudeBin, HOME };
