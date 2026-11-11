#!/usr/bin/env node
// Server program (an always-on Linux box, e.g. WSL Ubuntu). The headless twin of the Mac app's phone access:
// it serves the SAME iPhone web app (phone/) and API (phone-server.js), but for the Claude Code sessions
// running on THIS machine (in a tmux session — mesh-name.js tmuxSession, default "mesh"). The iPhone app falls back to it when the Mac is off.
//
//   systemd --user mesh  (server/install.sh)          always on, port 47320, pairing token in ~/.mesh-server/phone.json
//   mesh-server.js --pair                             print the pairing link (+ QR) for the iPhone app
//   mesh-server.js --status                           what it sees right now
//
// Terminals: a session's tmux pane is streamed while a phone watches it (tmux pipe-pane → file → SSE) and
// keystrokes go back with tmux send-keys. Nothing here is synced with the Mac: each machine shows only
// the sessions it runs itself.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { EventEmitter } = require('events');
const { execFile, execFileSync } = require('child_process');
const { StringDecoder } = require('string_decoder');

const ROOT = path.join(__dirname, '..');
const { Collector } = require(path.join(ROOT, 'collector'));
const { createPhoneServer } = require(path.join(ROOT, 'phone-server'));
const { createCore, linuxToken, HOME } = require(path.join(ROOT, 'core'));
const { createPeer } = require(path.join(ROOT, 'peer'));

const MESH = require(path.join(ROOT, 'mesh-name')), APP_NAME = MESH.name;
const USERDATA = process.env.MESH_USERDATA || path.join(HOME, '.mesh-server');   // env override: isolated test runs
const PANES = path.join(USERDATA, 'panes');
const TMUX_SESSION = MESH.tmuxSession;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const core = createCore({ userData: USERDATA, getToken: async () => linuxToken() });
const collector = new Collector();
const ptyBus = new EventEmitter(); ptyBus.setMaxListeners(50);
let lastSnap = null, phone = null;

// ---------------- tmux ----------------
const tmux = args => new Promise(res => execFile('tmux', args, { timeout: 10000 }, (err, so) => res(err ? null : String(so))));
const tmuxSync = args => { try { return execFileSync('tmux', args, { timeout: 10000 }).toString(); } catch { return ''; } };
let panes = new Map();            // pane id (%N) -> { pid, cols, rows, title }
async function refreshPanes() {
  const out = await tmux(['list-panes', '-a', '-F', '#{pane_id}\t#{pane_pid}\t#{pane_width}\t#{pane_height}\t#{session_name}:#{window_name}']);
  const m = new Map();
  for (const l of (out || '').split('\n')) {
    const [id, pid, w, h, title] = l.split('\t'); if (!id) continue;
    m.set(id, { pid: +pid, cols: +w || 120, rows: +h || 32, title });
    const o = panes.get(id);
    if (o && (o.cols !== m.get(id).cols || o.rows !== m.get(id).rows)) ptyBus.emit('resize', id, m.get(id).cols, m.get(id).rows);
  }
  panes = m;
}
// keystrokes from the phone: printable runs as literal text, control bytes one by one (Esc, arrows, ^C …)
function paneWrite(id, data) {
  const s = String(data || ''); if (!s) return;
  let run = '';
  const flush = () => { if (run) { tmuxSync(['send-keys', '-t', id, '-l', run]); run = ''; } };
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c < 32 || c === 127) { flush(); tmuxSync(['send-keys', '-t', id, '-H', c.toString(16).padStart(2, '0')]); }
    else run += ch;
  }
  flush();
}
// what the pane shows now (+ scrollback), as the terminal's opening content
function paneBacklog(id) {
  const out = tmuxSync(['capture-pane', '-p', '-e', '-t', id, '-S', '-2000']);
  return out.replace(/\n+$/, '').split('\n').join('\r\n');
}
// phone-server.js expects a Map-like of pty entries: { proc: { cols, rows, pid, write }, buf }
const ptys = {
  get(id) {
    const p = panes.get(id); if (!p) return null;
    return { proc: { cols: p.cols, rows: p.rows, pid: p.pid, write: d => paneWrite(id, d) }, get buf() { return paneBacklog(id); } };
  },
  [Symbol.iterator]() { return panes.entries(); },
};

// ---------------- live streaming of a pane (only while someone watches) ----------------
const streams = new Map();        // pane id -> { n, file, pos, dec, timer }
const paneFile = id => path.join(PANES, id.replace(/[^\w]/g, '_') + '.raw');
async function termOpen(id) {
  let s = streams.get(id);
  if (s) { s.n++; return; }
  fs.mkdirSync(PANES, { recursive: true });
  const file = paneFile(id); try { fs.unlinkSync(file); } catch { }
  fs.writeFileSync(file, '');
  await tmux(['pipe-pane', '-t', id, `cat >> '${file}'`]);
  s = { n: 1, file, pos: 0, dec: new StringDecoder('utf8'), timer: null };
  s.timer = setInterval(() => {
    let st; try { st = fs.statSync(file); } catch { return; }
    if (st.size <= s.pos) return;
    const fd = fs.openSync(file, 'r');
    try {
      const b = Buffer.alloc(Math.min(st.size - s.pos, 1 << 20)); const n = fs.readSync(fd, b, 0, b.length, s.pos); s.pos += n;
      const text = s.dec.write(b.subarray(0, n)); if (text) ptyBus.emit('data', id, text);
    } finally { fs.closeSync(fd); }
    if (s.pos > 64 << 20) { s.pos = 0; fs.truncateSync(file, 0); }          // long watch: don't let the file grow forever
  }, 120);
  streams.set(id, s);
  log(`stream on  ${id}`);
}
function termClose(id) {
  const s = streams.get(id); if (!s) return;
  if (--s.n > 0) return;
  clearInterval(s.timer); streams.delete(id);
  tmuxSync(['pipe-pane', '-t', id]);                                          // no command = stop piping
  try { fs.unlinkSync(s.file); } catch { }
  log(`stream off ${id}`);
}
// a crash while streaming would leave pipe-pane writing forever → clean up at start
function cleanupStale() {
  try { for (const f of fs.readdirSync(PANES)) { const id = '%' + f.replace(/^_/, '').replace(/\.raw$/, ''); tmuxSync(['pipe-pane', '-t', id]); fs.unlinkSync(path.join(PANES, f)); } } catch { }
}

// ---------------- control ----------------
const liveSession = sid => lastSnap && lastSnap.sessions.find(s => s.sid === sid);
async function sendToSession(sid, text) {
  const s = liveSession(sid); if (!s) return { ok: false, err: 'session is not running' };
  if (!s.owner) return { ok: false, err: 'not in a tmux pane — view only' };
  paneWrite(s.owner, String(text).replace(/\r?\n/g, ' '));
  await new Promise(r => setTimeout(r, 60)); tmuxSync(['send-keys', '-t', s.owner, 'Enter']);
  return { ok: true };
}
async function interruptSession(sid) {
  const s = liveSession(sid); if (!s || !s.owner) return { ok: false };
  tmuxSync(['send-keys', '-t', s.owner, 'Escape']); return { ok: true };
}
// "Resume on the server": a new tmux window in the server's tmux session (same flags the app gives every session)
function resumeHere(sid) {
  const live = liveSession(sid);                                     // already running here → never a second copy
  if (live) return { ok: true, pane: live.owner || null, already: true };
  const projDir = path.join(HOME, '.claude', 'projects');
  const hasTranscript = !!core.histEntry(sid) || (fs.existsSync(projDir) &&
    fs.readdirSync(projDir).some(d => fs.existsSync(path.join(projDir, d, sid + '.jsonl'))));
  if (!/^[0-9a-f-]{36}$/.test(sid) || !hasTranscript) return { ok: false, err: 'history not on this machine yet' };
  const h = core.histEntry(sid), cwd = (h && h.cwd && fs.existsSync(h.cwd)) ? h.cwd : HOME;
  const name = ((h && (h.title || h.aiTitle || h.first)) || sid.slice(0, 8)).replace(/[^\w가-힣 -]/g, '').trim().slice(0, 18) || sid.slice(0, 8);
  if (!tmuxSync(['has-session', '-t', TMUX_SESSION]) && !panes.size) tmuxSync(['new-session', '-d', '-s', TMUX_SESSION]);
  const cmd = `cd '${cwd}' && export PATH=$HOME/.local/bin:$PATH; claude --dangerously-skip-permissions --remote-control --resume ${sid}; echo; echo [session ended]; exec bash`;
  const r = tmuxSync(['new-window', '-d', '-t', TMUX_SESSION, '-n', name, '-P', '-F', '#{pane_id}', cmd]);
  return { ok: !!r.trim(), pane: r.trim() };
}

// ---------------- telemetry loop ----------------
const hostInfo = { kind: 'server', name: os.hostname(), label: 'the server' };
async function tick() {
  try {
    await refreshPanes();
    await collector.tick();
    const ptyMap = new Map([...panes].map(([id, p]) => [id, p.pid]));
    const snap = collector.snapshot(ptyMap);
    for (const s of snap.sessions) {                     // the session file names its pane: "mesh:@4.%4"
      if (s.owner) continue;
      const j = collector.sessions.get(s.pid), m = j && /%\d+$/.exec(j.tmux || '');
      if (m && panes.has(m[0])) s.owner = m[0];
    }
    snap.agents = core.agents(); core.refreshAgents();
    snap.usage = core.usage(); core.refreshUsage();
    snap.host = hostInfo;
    snap.ptys = [...panes].map(([id, p]) => ({ id, pid: p.pid, title: p.title, kind: 'tmux', cwd: '' }));
    lastSnap = snap;
    if (phone) phone.broadcast(snap);
    for (const id of streams.keys()) if (!panes.has(id)) { ptyBus.emit('exit', id); termClose(id); }
  } catch (e) { log('tick', e.message); }
  const st = phone && phone.status(), watching = st && (st.clients > 0 || st.peerWatching);
  setTimeout(tick, watching ? 1000 : 10000);                                   // light when nobody is looking
}

const peerLink = createPeer({ userData: USERDATA, selfKind: 'server' });   // the Mac (peer.json), one mesh for the iPhone
function main() {
  fs.mkdirSync(USERDATA, { recursive: true });
  cleanupStale();
  const cli = process.argv.includes('--pair') || process.argv.includes('--status');
  phone = createPhoneServer({
    root: ROOT, userData: USERDATA, ptys, ptyBus, termOpen, termClose, passive: cli,
    peer: cli ? null : peerLink,
    getSnap: () => lastSnap,
    getHistory: () => core.listHistory(),
    details: sid => core.sessionDetails(sid),
    commandsFor: core.commandsFor,
    sendToSession, interruptSession,
    resumeOnMac: sid => resumeHere(sid),
    rename: async (sid, name) => {
      const s = liveSession(sid);
      if (s && s.owner) { const r = await sendToSession(sid, '/rename ' + name); if (r.ok) return r; }
      return core.renameTranscript(sid, name);
    },
    convert: async (sid, task) => { const s = liveSession(sid), h = core.histEntry(sid); return core.convertToAgent(sid, (s && s.cwd) || (h && h.cwd) || HOME, task); },
  });
  if (process.argv.includes('--pair')) return pair();
  if (process.argv.includes('--status')) return status();
  phone.setEnabled(true);
  peerLink.start();
  log(`${APP_NAME} server on :${phone.status().port} — ${phone.status().urls.map(u => u.url.replace(/t=.*/, 't=…')).join(', ') || 'no Tailscale address yet'}`);
  tick();
  process.on('SIGTERM', () => { for (const id of [...streams.keys()]) { streams.get(id).n = 1; termClose(id); } process.exit(0); });
}
function pair() {
  const urls = phone.status().urls.filter(u => /Tailscale/.test(u.kind));
  if (!urls.length) { console.log('No Tailscale address on this machine yet.'); return; }
  console.log(`\n${APP_NAME} (server) pairing link — paste it into the iPhone app (three-finger hold → Add host):\n`);
  for (const u of urls) console.log('  ' + u.url);
  try { require('qrcode').toString(urls[0].url, { type: 'terminal', small: true }, (_e, s) => console.log('\n' + s)); } catch { }
}
async function status() {
  await refreshPanes(); await collector.tick(); await collector.tick();
  const snap = collector.snapshot(new Map([...panes].map(([id, p]) => [id, p.pid])));
  console.log(`panes: ${[...panes].map(([id, p]) => `${id}=${p.title}`).join(' ')}`);
  for (const s of snap.sessions) console.log(`${s.sid.slice(0, 8)}  ${s.name.padEnd(24)} ${s.health.padEnd(8)} pane=${s.owner || '-'} ${s.cwd}`);
  console.log('usage token:', linuxToken() ? 'found' : 'none');
}
main();
