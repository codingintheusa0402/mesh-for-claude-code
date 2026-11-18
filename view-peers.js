// View-only peers (peer.json entries with mode "view", peer-config.js): machines whose sessions Mesh lists as cards and
// can send a prompt to or stop, and nothing else. No terminal mirror, no Resume here, no Move, no transcript or memory
// of any kind goes to or comes from them. Each machine running Mesh watches its view peers itself; their sessions are
// never passed on to the paired machine (/api/local-snapshot stays local), so nothing is listed twice.
//
// kind "ssh-gate" (url "ssh://<ssh alias>"): a restricted SSH gate on the other machine, no server there.
//   ssh <alias> watch 4          one JSON line every 4 s: {"ok":true,"host":…,"t":…,"sessions":[{id,name,status,busy,model,
//                                started,updated,turns,cost_usd,last,sender}]}; one long-lived connection, reconnect 10 → 60 s,
//                                offline after 15 s without a line
//   ssh <alias> send <id> <b64url of the text>      → {"ok":true} | {"ok":false,"error":…}
//   ssh <alias> stop <id>                           → same; both only while the job's status is "running"
// kind "http" (url "http://…", token): another Mesh's /api/local-snapshot, polled every 4 s, send / stop via /api/send,
//   /api/interrupt.
// Session ids here are "view:<peer name>:<id>". Nothing here touches Electron.
const { spawn, execFile } = require('child_process');
const http = require('http');
const { readPeers } = require('./peer-config');

const PREFIX = 'view:';
const POLL_MS = 4000, SILENT_MS = 15000, BACKOFF = [10e3, 20e3, 40e3, 60e3], KEEP_MS = 24 * 3600e3;
const JOB_ID = /^[0-9]{8}-[0-9]{6}-[a-z0-9-]{1,40}$/;
const ALIAS = /^[A-Za-z0-9._-]{1,64}$/;
const SSH = () => process.env.MESH_VIEW_SSH || '/usr/bin/ssh';     // QA points this at a fake gate
const SSH_OPTS = ['-o', 'BatchMode=yes', '-o', 'ServerAliveInterval=15', '-o', 'ConnectTimeout=10'];
const MAX_TEXT = 16 * 1024;     // UTF-8 bytes; as base64url it stays under Windows' 32,767-char command line

const nameOf = e => String(e.name || e.label || (() => { try { return new URL(e.url).hostname; } catch { return 'peer'; } })()).replace(/[^\w.-]+/g, '-').slice(0, 40) || 'peer';
const aliasOf = url => { const m = /^ssh:\/\/([^/?#]+)\/?$/.exec(String(url || '')); return m && ALIAS.test(m[1]) ? m[1] : null; };
const family = m => { const x = /claude-(fable|mythos|opus|sonnet|haiku)/.exec(m || ''); return x ? x[1] : 'other'; };
const isoMs = t => { const v = Date.parse(t || ''); return Number.isFinite(v) ? v : 0; };

// one view peer, either kind
function createLink(entry, onChange) {
  const name = nameOf(entry), kind = entry.kind === 'ssh-gate' || /^ssh:/.test(entry.url) ? 'ssh-gate' : 'http';
  let last = null, lastAt = 0, connAt = 0, host = '', child = null, timer = null, retry = null, tries = 0, stopped = false, err = '';
  const online = () => !!lastAt && Date.now() - lastAt < SILENT_MS;

  function got(j) {
    if (!j || j.ok === false || !Array.isArray(j.sessions)) return;
    last = j; lastAt = Date.now(); tries = 0; err = '';
    if (j.host) host = String(j.host).slice(0, 40);
    onChange && onChange();
  }

  // ---- ssh-gate: one long-lived `watch` stream ----
  function connect() {
    if (stopped) return;
    const alias = aliasOf(entry.url);
    if (!alias) { err = 'bad url (want ssh://<alias>)'; return; }
    let buf = ''; connAt = Date.now();
    child = spawn(SSH(), [...SSH_OPTS, alias, 'watch', '4'], { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', d => {
      buf += d; if (buf.length > 4e6) buf = buf.slice(-1e6);
      let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) try { got(JSON.parse(line)); } catch { } }
    });
    let errBuf = ''; child.stderr.setEncoding('utf8'); child.stderr.on('data', d => { errBuf = (errBuf + d).slice(-400); });
    const gone = () => {
      if (!child) return; child = null;
      if (errBuf.trim()) err = errBuf.trim().split('\n').pop().slice(0, 160);
      if (stopped) return;
      const wait = BACKOFF[Math.min(tries++, BACKOFF.length - 1)];
      retry = setTimeout(connect, wait);
    };
    child.on('exit', gone); child.on('error', e => { err = e.message; gone(); });
  }
  // a stream that stays open but sends nothing for 15 s is dead (sleep, network change): drop it and reconnect
  function watchdog() {
    if (kind !== 'ssh-gate' || !child) return;
    if (Date.now() - Math.max(lastAt, connAt) > SILENT_MS + 5000) { err = 'no update for 20 s'; try { child.kill(); } catch { } }
  }

  // ---- http: poll another Mesh ----
  function httpReq(method, p, body, timeout = 6000) {
    return new Promise((resolve, reject) => {
      const u = new URL(p, entry.url); u.searchParams.set('t', entry.token || '');
      const data = body ? Buffer.from(JSON.stringify(body)) : null;
      const req = http.request(u, { method, timeout, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {} }, res => {
        let s = ''; res.setEncoding('utf8'); res.on('data', d => s += d);
        res.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve({}); } });
      });
      req.on('timeout', () => req.destroy(new Error('timeout'))); req.on('error', reject);
      if (data) req.write(data); req.end();
    });
  }
  async function pollHttp() {
    try {
      const j = await httpReq('GET', '/api/local-snapshot', null, 3500);
      if (j && Array.isArray(j.sessions)) got({ ok: true, host: j.machine || name, sessions: j.sessions.filter(s => s.sid).map(s => ({
        id: s.sid, name: s.name, status: s.offline ? 'stopped' : 'running', busy: s.health === 'working', model: s.model,
        started: s.startedAt ? new Date(s.startedAt).toISOString() : null, updated: null, turns: s.turns, cost_usd: s.todayUsd, last: '' })) });
    } catch (e) { err = e.message; }
  }

  function start() {
    if (kind === 'ssh-gate') { connect(); timer = setInterval(watchdog, 5000); }
    else { pollHttp(); timer = setInterval(pollHttp, POLL_MS); }
  }
  function stop() {
    stopped = true; clearInterval(timer); clearTimeout(retry);
    if (child) { const c = child; child = null; try { c.kill(); } catch { } }
  }

  function run(args, timeout = 20000) {
    return new Promise(resolve => {
      const alias = aliasOf(entry.url); if (!alias) return resolve({ ok: false, err: 'bad peer url' });
      execFile(SSH(), [...SSH_OPTS, alias, ...args], { timeout, maxBuffer: 1e6 }, (e, out, se) => {
        const line = String(out || '').trim().split('\n').pop();
        try { const j = JSON.parse(line); return resolve(j.ok ? { ok: true } : { ok: false, err: String(j.error || j.err || 'refused').slice(0, 200) }); } catch { }
        resolve({ ok: false, err: (e && (e.killed ? 'timed out' : String(se || e.message).trim().split('\n').pop())) || 'no answer' });
      });
    });
  }
  const job = id => ((last && last.sessions) || []).find(s => s.id === id);
  async function send(id, text) {
    text = String(text || ''); if (!text) return { ok: false, err: 'empty' };
    if (Buffer.byteLength(text, 'utf8') > MAX_TEXT) return { ok: false, err: 'text too long (16 KB max for this machine)' };
    if (kind === 'http') return httpReq('POST', '/api/send', { sid: id, text }).catch(e => ({ ok: false, err: e.message }));
    if (!JOB_ID.test(id)) return { ok: false, err: 'bad job id' };
    const j = job(id); if (j && j.status !== 'running') return { ok: false, err: `the job is ${j.status}: send only works while it runs` };
    return run(['send', id, Buffer.from(text, 'utf8').toString('base64url')]);
  }
  async function stopJob(id) {
    if (kind === 'http') return httpReq('POST', '/api/interrupt', { sid: id }).catch(e => ({ ok: false, err: e.message }));
    if (!JOB_ID.test(id)) return { ok: false, err: 'bad job id' };
    const j = job(id); if (j && j.status !== 'running') return { ok: false, err: `the job is ${j.status}` };
    return run(['stop', id]);
  }

  // sessions in the shape the desktop window and the phone page draw (collector.js fields, zeros where unknown)
  function sessions() {
    if (!last || (!online() && Date.now() - lastAt > KEEP_MS)) return [];
    const on = online(), now = Date.now(), label = entry.label || entry.name || host || name;
    return (last.sessions || []).slice(0, 50).map(j => {
      const id = String(j.id || ''), st = String(j.status || ''), upd = isoMs(j.updated) || isoMs(j.started) || lastAt;
      const health = !on ? 'offline' : st === 'running' ? (j.busy ? 'working' : 'idle') : st === 'queued' ? 'waiting' : st === 'failed' ? 'error' : 'idle';
      const since = Math.max(0, (now - upd) / 1000);
      return {
        sid: PREFIX + name + ':' + id, jobId: id, name: String(j.name || id).slice(0, 60), cwd: '', kind: 'job', status: st, jobStatus: st,
        health, model: j.model || '', family: family(j.model), onPeer: true, viewPeer: true, viewName: name, hostKind: 'worker', hostLabel: label,
        offline: !on, canSend: on && st === 'running', owner: null, pane: null, tty: null, pid: null,
        startedAt: isoMs(j.started) || null, turns: +j.turns || 0, jobCost: +j.cost_usd || 0, last: String(j.last || '').slice(0, 160), sender: j.sender || '',
        ctx: 0, ctxMax: 0, lastSpeed: 0, cpu: 0, rssMb: 0, etime: '', tokIn: 0, tokOut: 0, tokCacheRead: 0, tokCacheWrite: 0, totalUsd: 0, todayUsd: 0, totalTok: 0, todayTok: 0, tokHr: 0, tps: 0, usdHr: 0, byModel: {}, freq: 0,
        subagents: 0, errors5m: 0, errors1h: 0, sinceWrite: since, sinceUse: since, spark: new Array(30).fill(0), sparkPeak: 0, log: [], roots: [],
      };
    });
  }
  const info = () => ({ name, label: entry.label || entry.name || host || name, kind, online: online(), lastSeen: lastAt || null, host, err: online() ? '' : err, jobs: ((last && last.sessions) || []).length });
  return { name, start, stop, send, stopJob, sessions, info, key: JSON.stringify([entry.url, entry.token || '', entry.name || '', entry.label || '']) };
}

function createViewPeers({ userData, onChange }) {
  const links = new Map();         // name → link
  let timer = null;
  function sync() {
    const want = new Map(readPeers(userData).views.map(e => [nameOf(e), e]));
    for (const [n, l] of links) if (!want.has(n) || l.key !== JSON.stringify([want.get(n).url, want.get(n).token || '', want.get(n).name || '', want.get(n).label || ''])) { l.stop(); links.delete(n); }
    for (const [n, e] of want) if (!links.has(n)) { const l = createLink(e, onChange); links.set(n, l); l.start(); }
  }
  const parse = sid => {
    if (typeof sid !== 'string' || !sid.startsWith(PREFIX)) return null;
    const rest = sid.slice(PREFIX.length), i = rest.indexOf(':');
    return i > 0 ? { link: links.get(rest.slice(0, i)), id: rest.slice(i + 1) } : null;
  };
  return {
    start() { if (!timer) { sync(); timer = setInterval(sync, POLL_MS); } },
    stop() { clearInterval(timer); timer = null; for (const l of links.values()) l.stop(); links.clear(); },
    owns: sid => !!parse(sid),
    // the snapshot with every view peer's sessions added (never mutates `snap`)
    merge(snap) {
      if (!snap || !links.size) return snap;
      const extra = [...links.values()].flatMap(l => l.sessions());
      return { ...snap, sessions: [...(snap.sessions || []), ...extra], viewPeers: [...links.values()].map(l => l.info()) };
    },
    send(sid, text) { const p = parse(sid); return p && p.link ? p.link.send(p.id, text) : Promise.resolve({ ok: false, err: 'that machine is not configured' }); },
    interrupt(sid) { const p = parse(sid); return p && p.link ? p.link.stopJob(p.id) : Promise.resolve({ ok: false, err: 'that machine is not configured' }); },
    list: () => [...links.values()].map(l => l.info()),
  };
}

module.exports = { createViewPeers, VIEW_PREFIX: PREFIX, JOB_ID };
