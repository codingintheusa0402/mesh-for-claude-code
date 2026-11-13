// Mesh — move a Claude session to the other Mac (2026-10-29). One owner at a time, the same order as moving any
// job between the machines: stop it here → copy its transcript (+ its <sid>/ folder: sub-agent logs, tool results)
// to the other Mac's ~/.claude/projects/<project of its folder> → start it there in an in-app terminal with --resume →
// wait until it shows up running there. If any step fails it is started again here, so it's never lost.
// The folder is carried across as ~/… (the Macs' user names differ). Works from either Mac, and from the iPhone
// (phone-server: /api/handoff/move, forwarded to whichever machine runs the session).
// Peer endpoints (phone-server.js): PUT /api/handoff/file (streamed), POST /api/handoff/start.
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const HOME = os.homedir();
const PROJ = path.join(HOME, '.claude', 'projects');
const enc = dir => dir.replace(/[^A-Za-z0-9]/g, '-');                 // how Claude Code names a project folder
const toTilde = d => d && d.startsWith(HOME) ? '~' + d.slice(HOME.length) : d;
const fromTilde = d => !d ? HOME : d === '~' ? HOME : d.startsWith('~/') ? path.join(HOME, d.slice(2)) : d;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

function createHandoff({ peer, liveSession, findTranscript, histEntry, ptys, startHere, progress }) {
  // ---------------- sending side ----------------
  // stream one file to the peer (PUT, raw body) — no size limit, no base64
  function sendFile(file, sid, rel, cwd, onBytes) {
    const cfg = peer.config(); if (!cfg) return Promise.reject(new Error('no other Mac paired'));
    const u = new URL('/api/handoff/file', cfg.url);
    for (const [k, v] of Object.entries({ t: cfg.token, sid, rel, cwd })) u.searchParams.set(k, v);
    const size = fs.statSync(file).size;
    return new Promise((resolve, reject) => {
      const req = http.request(u, { method: 'PUT', timeout: 120000, headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': size } }, res => {
        let s = ''; res.on('data', d => s += d); res.on('end', () => { let j = {}; try { j = JSON.parse(s || '{}'); } catch { } res.statusCode === 200 && j.ok ? resolve(j) : reject(new Error(j.err || 'upload failed (' + res.statusCode + ')')); });
      });
      req.on('error', reject); req.on('timeout', () => req.destroy(new Error('upload timed out')));
      const rs = fs.createReadStream(file); rs.on('data', d => onBytes && onBytes(d.length)); rs.on('error', reject); rs.pipe(req);
    });
  }
  const filesOf = dir => { const out = []; const walk = d => { let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { } for (const e of es) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (e.isFile()) out.push(f); } }; walk(dir); return out; };

  // stop the local copy: SIGTERM (Claude Code saves as it goes), SIGKILL after 10 s; in-app terminal closes with it
  async function stopHere(s) {
    if (!s || !s.pid || s.watchOnly) return;
    try { process.kill(s.pid, 'SIGTERM'); } catch { }
    for (let i = 0; i < 50 && alive(s.pid); i++) await sleep(200);
    if (alive(s.pid)) { try { process.kill(s.pid, 'SIGKILL'); } catch { } await sleep(500); }
    if (s.owner) { const p = ptys.get(s.owner); if (p) try { p.proc.kill(); } catch { } }
  }

  let busy = false;
  async function move(sid) {
    if (busy) return { ok: false, err: 'another move is in progress' };
    if (!peer.config()) return { ok: false, err: 'no other Mac paired (📱 → Other machine)' };
    if (!peer.online()) return { ok: false, err: `${peer.label()} is offline` };
    const s = liveSession(sid), h = histEntry(sid), file = findTranscript(sid);
    if (!file) return { ok: false, err: 'transcript not found on this Mac' };
    if (s && s.kind === 'bg') return { ok: false, err: 'background agents can\'t be moved yet' };
    const cwd = toTilde((s && s.cwd) || (h && h.cwd) || HOME), name = (s && s.name) || (h && (h.title || h.aiTitle)) || '';
    busy = true;
    const say = (stage, pct) => progress && progress({ sid, stage, pct, to: peer.label() });
    let stopped = false;
    try {
      // 1. stop here (a running session keeps writing its transcript — it must stop before the copy)
      if (s) { say('Stopping here'); await stopHere(s); stopped = true; await sleep(400); }
      // 2. copy: the transcript, then its folder
      const dir = file.slice(0, -'.jsonl'.length), list = [[file, path.basename(file)], ...filesOf(dir).map(f => [f, path.relative(path.dirname(file), f)])];
      const total = list.reduce((a, [f]) => a + fs.statSync(f).size, 0) || 1; let done = 0, lastPct = -1;
      for (const [f, rel] of list) await sendFile(f, sid, rel, cwd, n => { done += n; const p = Math.floor(done / total * 100); if (p !== lastPct && p % 5 === 0) { lastPct = p; say('Copying', p); } });
      // 3. start it there, in an in-app terminal
      say('Starting on ' + peer.label());
      const r = await peer.forward('POST', '/api/handoff/start', { sid, cwd, name });
      if (!r || r.ok === false) throw new Error((r && r.err) || 'the other Mac did not start it');
      // 4. verify it's running there
      say('Checking it runs on ' + peer.label());
      let up = false;
      for (let i = 0; i < 45 && !up; i++) { await sleep(1000); up = (await peer.sessionsNow()).some(x => x.sid === sid && x.pid); }
      if (!up) throw new Error('it did not come up on ' + peer.label() + ' within 45 s');
      say('Done');
      return { ok: true, to: peer.label(), bytes: total };
    } catch (e) {
      // anything failed → it runs here again (never left with no owner)
      if (stopped) { try { startHere(sid, fromTilde(cwd), name); } catch { } }
      return { ok: false, err: e.message, restartedHere: stopped };
    } finally { busy = false; }
  }

  // ---------------- receiving side ----------------
  // PUT /api/handoff/file?sid&rel&cwd — written to a temp file, then renamed into place; any older copy of the same
  // transcript under another project folder is set aside (so `--resume` finds this one)
  function receiveFile(q, req, res) {
    const sid = String(q.get('sid') || ''), rel = String(q.get('rel') || ''), cwd = fromTilde(String(q.get('cwd') || '~'));
    const bad = m => { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, err: m })); };
    if (!/^[0-9a-f-]{36}$/.test(sid)) return bad('bad session id');
    if (!rel || rel.includes('..') || path.isAbsolute(rel) || !(rel === sid + '.jsonl' || rel.startsWith(sid + '/'))) return bad('bad path');
    const projDir = path.join(PROJ, enc(cwd)), dest = path.join(projDir, rel), tmp = dest + '.part-' + process.pid;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const ws = fs.createWriteStream(tmp);
    req.pipe(ws);
    ws.on('finish', () => {
      try {
        fs.renameSync(tmp, dest);
        if (rel === sid + '.jsonl') {
          for (const d of fs.readdirSync(PROJ)) {
            const f = path.join(PROJ, d, sid + '.jsonl');
            if (d !== enc(cwd) && fs.existsSync(f)) fs.renameSync(f, f + '.moved-away');
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true }));
      } catch (e) { bad(e.message); }
    });
    ws.on('error', e => bad(e.message)); req.on('error', () => { try { fs.unlinkSync(tmp); } catch { } });
  }

  return { move, receiveFile, busy: () => busy, fromTilde };
}

module.exports = { createHandoff };
