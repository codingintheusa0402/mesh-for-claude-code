// Project cards (2026-11-02): how each session's project runs — what it does, its rules, its checks before
// publishing / running, to-dos (and what waits on you), its schedule, and recent activity.
//   · facts are read from the project's folders (project-folders.js allOf): rule files (CLAUDE.md, PLAYBOOK.md, RULES.md,
//     AGENTS.md, README.md …), the SKILL.md files the session uses, check / gate scripts, TODO and queue files, the
//     session's transcript (latest report, "waiting on you" lines, last actions)
//   · the schedule is computed here, never by a model: launchd jobs and crontab lines that run something in those
//     folders, with run time, next run and last result (launchd exit status + the job's log)
//   · Claude Haiku (headless `claude -p`) turns the rest into short items, each with the file it came from
//     (DeepSeek V4.1 Flash through Ollama instead for a Hermes session or a project that runs on Hermes)
//   · keys, tokens, passwords and email addresses are masked before anything is sent or shown
//   · cached in the app's own data folder (never in a repo), regenerated when a source file changes or once a day;
//     the schedule part is recomputed on every read
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { execFile } = require('child_process');

const DAY = 24 * 3600e3;
const RULE_NAMES = /^(CLAUDE|PLAYBOOK|RULES?|AGENTS|README|SOP|GUIDELINES|CONVENTIONS|CHECKLIST)(\.[a-z]+)?\.md$/i;
const CHECK_NAME = /(check|gate|guard|verify|validate|preflight|lint|qa|test|publish|review)/i;
const TODO_NAME = /(todo|backlog|queue|pending|inbox)/i;
const WAIT_RE = /(waiting on you|waiting for you|needs? you|need from you|you need to|action needed|only you can|please (log ?in|sign in|approve|confirm|decide|reply)|blocked on|your (ok|go-?ahead|approval|decision)|tell me (when|if|which))/i;

function mask(s) {
  return String(s || '')
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[private key]')
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-ant-[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9]{24,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|xox[abpr]-[A-Za-z0-9-]{10,}|apify_api_[A-Za-z0-9]{10,}|EAA[A-Za-z0-9]{40,}|ya29\.[A-Za-z0-9_-]{20,})\b/g, '[key]')
    .replace(/(chat\.googleapis\.com\/v1\/spaces\/[^\s'"]*?(key|token)=)[^\s'"&]+/g, '$1[key]')
    .replace(/\b(bearer|token|api[_-]?key|secret|password|passwd|pwd)(["'\s:=]+)[A-Za-z0-9/+_.\-]{8,}/gi, '$1$2[hidden]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]+/g, '[email]');
}

function createProjectCards({ home, userData, findTranscript, allOf, claudeBin, onHermes }) {
  const dir = path.join(userData, 'project-cards'); try { fs.mkdirSync(dir, { recursive: true }); } catch { }
  const tilde = p => String(p || '').replace(home, '~');
  const read = (f, n = 4000) => { try { const s = fs.readFileSync(f, 'utf8'); return s.length > n ? s.slice(0, n) + '\n…' : s; } catch { return ''; } };
  const stat = f => { try { return fs.statSync(f); } catch { return null; } };
  const keyOf = folders => crypto.createHash('sha1').update(folders.join('|')).digest('hex').slice(0, 16);

  // ---------- schedule (launchd + cron) ----------
  let jobsCache = { at: 0, list: [] };
  const sh = (cmd, args) => new Promise(res => execFile(cmd, args, { maxBuffer: 8e6, timeout: 15000 }, (e, out) => res(e ? '' : String(out))));
  async function allJobs() {
    if (Date.now() - jobsCache.at < 60e3) return jobsCache.list;
    const la = path.join(home, 'Library', 'LaunchAgents'), status = new Map();
    for (const l of (await sh('/bin/launchctl', ['list'])).split('\n').slice(1)) { const [pid, st, label] = l.split('\t'); if (label) status.set(label.trim(), { pid: pid === '-' ? null : +pid, exit: st === '-' ? null : +st }); }
    const list = [];
    let files = []; try { files = fs.readdirSync(la).filter(f => f.endsWith('.plist')); } catch { }
    for (const f of files) {
      const j = await plist(path.join(la, f)); if (!j || !j.Label) continue;
      const args = (j.ProgramArguments || []).concat(j.Program || []).join(' ');
      list.push({ kind: 'launchd', label: j.Label, file: path.join(la, f), cmd: args, wd: j.WorkingDirectory || '', cal: j.StartCalendarInterval || null, every: j.StartInterval || null,
        keepAlive: !!j.KeepAlive, atLoad: !!j.RunAtLoad, out: j.StandardOutPath || '', err: j.StandardErrorPath || '', disabled: !!j.Disabled, loaded: status.has(j.Label), ...(status.get(j.Label) || {}) });
    }
    for (const l of (await sh('/usr/bin/crontab', ['-l'])).split('\n')) {
      const m = /^\s*([^#\s]\S*\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.+)$/.exec(l); if (m) list.push({ kind: 'cron', label: m[2].slice(0, 60), cron: m[1], cmd: m[2], file: 'crontab' });
    }
    jobsCache = { at: Date.now(), list }; return list;
  }
  function plist(f) { return new Promise(res => execFile('/usr/bin/plutil', ['-convert', 'json', '-o', '-', f], { timeout: 5000 }, (e, out) => { try { res(e ? null : JSON.parse(out)); } catch { res(null); } })); }
  const two = n => String(n).padStart(2, '0'), DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function calText(c) {
    const one = x => { const t = x.Hour != null ? `${two(x.Hour)}:${two(x.Minute || 0)}` : x.Minute != null ? `:${two(x.Minute)} every hour` : 'every minute';
      return (x.Weekday != null ? DOW[x.Weekday % 7] + ' ' : x.Day != null ? `day ${x.Day} ` : x.Hour != null ? 'daily ' : '') + t; };
    return (Array.isArray(c) ? c : [c]).map(one).join(', ');
  }
  function nextCal(c, from = new Date()) {
    let best = null;
    for (const x of Array.isArray(c) ? c : [c]) for (let i = 1; i <= 60 * 24 * 8; i++) {
      const d = new Date(from.getTime() + i * 60e3); d.setSeconds(0, 0);
      if (x.Minute != null && d.getMinutes() !== x.Minute) continue; if (x.Hour != null && d.getHours() !== x.Hour) continue;
      if (x.Weekday != null && d.getDay() !== x.Weekday % 7) continue; if (x.Day != null && d.getDate() !== x.Day) continue; if (x.Month != null && d.getMonth() + 1 !== x.Month) continue;
      if (!best || d < best) best = d; break;
    }
    return best;
  }
  function cronNext(expr, from = new Date()) {
    const [mi, ho, dm, mo, dw] = expr.split(/\s+/), ok = (f, v) => f === '*' || f.split(',').some(p => p.includes('/') ? v % +p.split('/')[1] === 0 : p.includes('-') ? v >= +p.split('-')[0] && v <= +p.split('-')[1] : +p === v);
    for (let i = 1; i <= 60 * 24 * 8; i++) { const d = new Date(from.getTime() + i * 60e3); if (ok(mi, d.getMinutes()) && ok(ho, d.getHours()) && ok(dm, d.getDate()) && ok(mo, d.getMonth() + 1) && ok(dw, d.getDay())) return d; }
    return null;
  }
  function lastOf(j) {
    const logs = [j.out, j.err].filter(Boolean).map(f => ({ f, st: stat(f) })).filter(x => x.st);
    const last = logs.reduce((a, b) => (!a || b.st.mtimeMs > a.st.mtimeMs ? b : a), null);
    let tail = ''; if (last) { const t = read(last.f, 1e9); tail = t.slice(-1500); }
    const lastLine = tail.trim().split('\n').pop() || '';
    let result = j.pid ? 'running' : j.exit == null ? (last ? 'ran' : 'not run yet') : j.exit === 0 ? 'ok' : `failed (exit ${j.exit})`;
    if (/\bskip(ped|ping)?\b/i.test(lastLine) && j.exit === 0) result = 'skipped';
    if (j.exit === 0 && /\b(error|traceback|failed)\b/i.test(lastLine)) result = 'ok? (log ends with an error)';
    return { at: last ? last.st.mtimeMs : null, result, line: mask(lastLine).slice(0, 200), log: last ? tilde(last.f) : '' };
  }
  async function scheduleFor(folders) {
    const out = [];
    for (const j of await allJobs()) {
      const hay = j.cmd + ' ' + (j.wd || '');
      if (!folders.some(f => hay.includes(f + '/') || hay.endsWith(f) || hay.includes(f + ' '))) continue;
      if (j.kind === 'cron') { const n = cronNext(j.cron); out.push({ label: j.label, when: `cron ${j.cron}`, next: n && n.getTime(), last: null, result: '—', src: 'crontab' }); continue; }
      if (!j.loaded && !j.keepAlive) { out.push({ label: j.label, when: 'not loaded (off)', next: null, ...lastOf(j), src: tilde(j.file) }); continue; }
      const L = lastOf(j);
      const when = j.cal ? calText(j.cal) : j.every ? `every ${j.every >= 3600 ? j.every / 3600 + ' h' : j.every >= 60 ? j.every / 60 + ' min' : j.every + ' s'}` : j.keepAlive ? 'always on' : j.atLoad ? 'at login' : 'on demand';
      const next = j.cal ? (nextCal(j.cal) || {}).getTime?.() : j.every ? (L.at ? Math.max(Date.now(), L.at + j.every * 1000) : Date.now() + j.every * 1000) : null;
      out.push({ label: j.label, when, next: next || null, running: !!j.pid, ...L, src: tilde(j.file) });
    }
    return out.sort((a, b) => (a.next || 9e15) - (b.next || 9e15));
  }

  // ---------- sources ----------
  function walk(d, depth, fn) {
    let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      if (e.name.startsWith('.') || /^(node_modules|dist|build|venv|\.venv|__pycache__|out|vendor|Pods)$/.test(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (depth > 0) walk(p, depth - 1, fn); } else fn(p, e.name);
    }
  }
  function transcriptBits(sid) {
    const f = sid && findTranscript(sid); if (!f) return { report: '', waiting: [], actions: [], skills: [] };
    const st = stat(f), len = Math.min(st.size, 3 * 1024 * 1024), b = Buffer.alloc(len), fd = fs.openSync(f, 'r');
    try { fs.readSync(fd, b, 0, len, st.size - len); } finally { fs.closeSync(fd); }
    const texts = [], actions = [], skills = new Set();
    for (const l of b.toString('utf8').split('\n')) {
      if (l.indexOf('"assistant"') < 0) continue; let j; try { j = JSON.parse(l); } catch { continue; }
      if (j.type !== 'assistant' || !j.message || !Array.isArray(j.message.content)) continue;
      const t = Date.parse(j.timestamp || '') || 0;
      for (const c of j.message.content) {
        if (c.type === 'text' && c.text) texts.push({ t, text: c.text });
        if (c.type === 'tool_use') {
          if (c.name === 'Skill' && c.input && c.input.skill) skills.add(String(c.input.skill));
          const i = c.input || {}, what = i.description || i.command || i.file_path || i.skill || i.url || '';
          actions.push({ t, text: `${c.name}${what ? ': ' + String(what).split('\n')[0].slice(0, 140) : ''}` });
        }
      }
    }
    const waiting = [];
    for (const x of texts.slice(-40)) for (const line of x.text.split('\n')) if (WAIT_RE.test(line) && line.length < 400) waiting.push({ t: x.t, text: line.replace(/^[\s*>#-]+/, '').trim() });
    const last = texts.length ? texts[texts.length - 1] : null;
    return { report: last ? last.text.slice(0, 2500) : '', reportAt: last ? last.t : 0, waiting: waiting.slice(-10), actions: actions.slice(-8).reverse(), skills: [...skills] };
  }
  function gather(folders, sid) {
    const files = [], seen = new Set(), add = (kind, p, n) => { if (seen.has(p)) return; seen.add(p); files.push({ kind, path: p, text: mask(read(p, n)), mtime: (stat(p) || {}).mtimeMs || 0 }); };
    for (const d of folders) {
      walk(d, 1, (p, name) => { if (RULE_NAMES.test(name) || /rule|playbook/i.test(name) && /\.md$/i.test(name)) add('rules', p, 5000); });
      walk(d, 2, (p, name) => {
        if (/\.(py|sh|js|mjs|ts)$/.test(name) && CHECK_NAME.test(name) && files.filter(f => f.kind === 'check').length < 14) {
          const src = read(p, 60000), blocks = /sys\.exit\(\s*[1-9]|exit\s+[1-9]|raise\s+\w|process\.exit\(\s*[1-9]|assert\s|SystemExit/.test(src);
          if (!seen.has(p)) { seen.add(p); files.push({ kind: 'check', path: p, text: mask(src.split('\n').slice(0, 50).join('\n')), blocks, mtime: (stat(p) || {}).mtimeMs || 0 }); }
        }
        if (TODO_NAME.test(name) && /\.(md|txt|json|jsonl|csv|ya?ml)$/i.test(name) && files.filter(f => f.kind === 'todo').length < 6) add('todo', p, 2500);
      });
    }
    const tb = transcriptBits(sid);
    for (const s of tb.skills.slice(0, 4)) { const p = path.join(home, '.claude', 'skills', s, 'SKILL.md'); if (stat(p)) add('skill', p, 3000); }
    return { files, tb };
  }

  // ---------- generation (Claude Haiku, headless) ----------
  const queue = []; let running = false;
  function enqueue(job) { return new Promise((res, rej) => { queue.push({ job, res, rej }); pump(); }); }
  async function pump() {
    if (running || !queue.length) return; running = true;
    const { job, res, rej } = queue.shift();
    try { res(await job()); } catch (e) { rej(e); } finally { running = false; pump(); }
  }
  async function haiku(prompt) {
    const bin = await claudeBin(), cwd = path.join(dir, 'run'); try { fs.mkdirSync(cwd, { recursive: true }); } catch { }
    return new Promise((res, rej) => {
      const p = execFile(bin, ['-p', '--model', 'haiku', '--output-format', 'json', '--setting-sources', 'project', '--strict-mcp-config', '--no-session-persistence',
        '--disallowedTools', 'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Task', 'Agent'],
        { cwd, timeout: 180000, maxBuffer: 2e7, env: { ...process.env, NO_COLOR: '1' } }, (e, out) => {
          if (e && !out) return rej(e);
          try { const r = JSON.parse(out); const t = String(r.result || ''); const m = t.match(/\{[\s\S]*\}/); res(JSON.parse(m ? m[0] : t)); } catch (err) { rej(new Error('card parse failed')); }
        });
      p.stdin.end(prompt);
    });
  }
  // a project that runs on Hermes gets its card from DeepSeek V4.1 Flash through the local Ollama app: no Claude (2026-11-07)
  function flash(prompt) {
    return new Promise((res, rej) => {
      const body = JSON.stringify({ model: 'deepseek-v4.1-flash:1017-cloud', stream: false, messages: [{ role: 'user', content: prompt }] });
      const rq = require('http').request({ host: '127.0.0.1', port: 11434, path: '/api/chat', method: 'POST', headers: { 'Content-Type': 'application/json' }, timeout: 180000 }, r => {
        let d = ''; r.on('data', c => d += c); r.on('end', () => { try { const t = JSON.parse(d).message.content || ''; const m = t.match(/\{[\s\S]*\}/); res(JSON.parse(m ? m[0] : t)); } catch { rej(new Error('card parse failed')); } });
      });
      rq.on('error', rej); rq.on('timeout', () => rq.destroy(new Error('timeout'))); rq.end(body);
    });
  }
  function promptFor(name, folders, g) {
    const srcs = g.files.map((f, i) => `[S${i + 1}] ${f.kind.toUpperCase()} ${tilde(f.path)}${f.kind === 'check' ? (f.blocks ? '  (contains exit/raise: can block)' : '  (no blocking exit found)') : ''}\n${f.text}`);
    const t = g.tb;
    srcs.push(`[T1] SESSION LATEST REPORT (${t.reportAt ? new Date(t.reportAt).toISOString() : 'n/a'})\n${mask(t.report)}`);
    srcs.push(`[T2] SESSION LINES THAT MAY WAIT ON THE OWNER\n${t.waiting.map(w => `- (${new Date(w.t).toISOString()}) ${mask(w.text)}`).join('\n') || '(none)'}`);
    srcs.push(`[T3] SESSION RECENT ACTIONS\n${t.actions.map(a => `- (${new Date(a.t).toISOString()}) ${mask(a.text)}`).join('\n') || '(none)'}`);
    return `You write a compact "project card" for the owner of a software project run by a Claude Code session named "${name}" in ${folders.map(tilde).join(', ')}.
Use ONLY the sources below. Every item must cite the source id it came from (S1…, T1…). Plain, short English. Never include secrets.
Return ONLY a JSON object:
{"intro": "2-3 plain sentences: what this project does and how it runs",
 "rules": [{"text": "one hard rule, <= 20 words", "src": "S…"}],                 // at most 8, the most important
 "checks": [{"text": "what is checked before publishing/running", "src": "S…", "enforced": true}],   // enforced=true only for a script that can block (exit/raise); rules that only say to check = false
 "todo": [{"text": "open item", "src": "S…|T…", "waiting_on_owner": false}],      // at most 8; waiting_on_owner=true when the owner must act
 "activity": [{"time": "ISO time", "text": "what was done / published", "src": "T3|T1|S…"}]}   // the last 5
If a section has nothing, use an empty list.

${srcs.join('\n\n')}`;
  }

  const fileFor = k => path.join(dir, k + '.json');
  const genFail = new Map();
  const loadCard = k => { try { return JSON.parse(fs.readFileSync(fileFor(k), 'utf8')); } catch { return null; } };
  const busy = new Set();
  function fingerprint(g) { return crypto.createHash('sha1').update(g.files.map(f => f.path + ':' + Math.round(f.mtime)).join('|') + '|' + g.tb.waiting.map(w => w.t).join(',') + '|' + (g.tb.reportAt || 0)).digest('hex'); }
  // → the card for one session (generates in the background when missing / stale; returns what it has right away)
  async function card(s, opts = {}) {
    const folders = allOf(s.sid, s.cwd);
    if (!folders.length) return { sid: s.sid, name: s.name, folders: [], empty: true, schedule: [] };
    const k = keyOf(folders), g = gather(folders, s.sid), fp = fingerprint(g), old = loadCard(k);
    const schedule = await scheduleFor(folders);
    const empty = !g.files.some(f => f.kind === 'rules' || f.kind === 'skill') && !schedule.length;
    const stale = !old || old.fp !== fp || Date.now() - old.at > DAY || opts.force;
    if (stale && !empty && !busy.has(k)) {
      busy.add(k);
      const run = enqueue(async () => {
        const j = await (onHermes && onHermes(s) ? flash : haiku)(promptFor(s.name, folders, g));
        const srcMap = Object.fromEntries(g.files.map((f, i) => ['S' + (i + 1), tilde(f.path)]).concat([['T1', 'session’s latest report'], ['T2', 'session messages'], ['T3', 'session actions']]));
        const fix = a => (Array.isArray(a) ? a : []).map(x => ({ ...x, text: mask(x.text), src: srcMap[x.src] || x.src || '' }));
        const c = { key: k, at: Date.now(), fp, intro: mask(j.intro || '').replace(/\s*\((?:[ST]\d+(?:,\s*)?)+\)/g, ''), rules: fix(j.rules), checks: fix(j.checks), todo: fix(j.todo), activity: fix(j.activity),
          ruleFiles: g.files.filter(f => f.kind === 'rules' || f.kind === 'skill').map(f => tilde(f.path)) };
        fs.writeFileSync(fileFor(k), JSON.stringify(c, null, 1)); genFail.delete(k); return c;
      }).catch(e => { genFail.set(k, String(e && e.message || e)); }).finally(() => busy.delete(k));
      if (opts.wait || !old) { try { await (opts.wait ? run : Promise.race([run, new Promise(r => setTimeout(r, opts.waitMs || 0))])); } catch { } }
    }
    const c = loadCard(k) || {};
    const waitingN = (c.todo || []).filter(x => x.waiting_on_owner).length, failedN = schedule.filter(x => /^failed/.test(x.result)).length;
    const next = schedule.find(x => x.next) || null;
    return { sid: s.sid, name: s.name, folders: folders.map(tilde), empty, generating: busy.has(k), genFailed: genFail.get(k) || null, at: c.at || null, intro: c.intro || '', rules: c.rules || [], checks: c.checks || [],
      todo: c.todo || [], activity: c.activity || [], ruleFiles: c.ruleFiles || [], schedule, waitingN, failedN, next: next && { label: next.label, at: next.next, when: next.when } };
  }
  // light version for lists: intro line + badges + next run (no generation wait); cached 5 min (it reads every transcript)
  let sumCache = { at: 0, key: '', out: {} };
  async function summary(sessions) {
    const sk = sessions.map(s => s.sid).join(',');
    if (sk === sumCache.key && Date.now() - sumCache.at < 5 * 60e3) return sumCache.out;
    const out = {};
    for (const s of sessions) { try { const c = await card(s); out[s.sid] = { intro: (c.intro || '').split(/(?<=\.)\s/)[0].slice(0, 160), waitingN: c.waitingN, failedN: c.failedN, next: c.next, empty: c.empty, generating: c.generating }; } catch { } }
    sumCache = { at: Date.now(), key: sk, out }; return out;
  }
  // open a source file in its app (only files inside home that exist)
  function safeFile(p) { const f = String(p || '').replace(/^~/, home); return f.startsWith(home + '/') && !f.includes('/../') && stat(f) && stat(f).isFile() ? f : null; }
  return { card, summary, safeFile, mask };
}
module.exports = { createProjectCards, mask };
