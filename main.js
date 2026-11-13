const { app, BrowserWindow, ipcMain, dialog, Notification, shell, clipboard, screen, Menu, powerMonitor, desktopCapturer, systemPreferences, session } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
// macOS can wedge on Desktop/Documents/Downloads/iCloud (2026-11-08): sync reads there would freeze the window, so they
// are checked in the background and skipped while stuck (fs-guard.js). Wrapped first, before any module reads a folder.
let notifyFsStuck = () => { };
const fsGuard = process.platform === 'darwin' && !process.env.MESH_NO_FSGUARD
  ? require('./fs-guard').createGuard({
    probe: process.env.MESH_FSGUARD_STUCK ? r => Promise.resolve(!process.env.MESH_FSGUARD_STUCK.split(':').includes(r)) : null,   // QA: pretend these folders are stuck
    onChange: c => { console.warn('[fs-guard]', c.state, c.root, c.why); notifyFsStuck(c); } }) : null;
if (fsGuard) fsGuard.wrap(fs);
const { execFile, execFileSync } = require('child_process');
const pty = require('node-pty');
const { Collector } = require('./collector');
const { EventEmitter } = require('events');
const { createPhoneServer } = require('./phone-server');
const { createHandoff } = require('./handoff');
const { createPeer } = require('./peer');             // the paired machine: one mesh on the iPhone whichever machine serves it
const { createCore, cleanEnv, loginShell, linuxToken, winClaudeBin } = require('./core');
const IS_WIN = process.platform === 'win32';
const ptyBus = new EventEmitter(); ptyBus.setMaxListeners(50);   // pty output fan-out (desktop + phone terminals)
const panes = require('./tmux-panes')({ ptyBus });
const APP_NAME = require('./mesh-name').name;           // the app's name — one setting (mesh-name.js)
// a fingerprint of this build's own code, so the two Macs can tell when they run different versions
// (same source = same fingerprint, whichever machine built it)
const BUILD = (() => {
  const h = require('crypto').createHash('sha1');
  const walk = d => { for (const f of fs.readdirSync(path.join(__dirname, d)).sort()) {
    const r = d ? d + '/' + f : f;
    if (r === 'node_modules' || r.startsWith('.')) continue;
    let st; try { st = fs.statSync(path.join(__dirname, r)); } catch { continue; }
    if (st.isDirectory()) { if (!d && !['renderer', 'phone'].includes(f)) continue; walk(r); }
    else if (/\.(js|html|css)$/.test(f)) { h.update(r); h.update(fs.readFileSync(path.join(__dirname, r))); }
  } };
  try { walk(''); } catch { }
  return h.digest('hex').slice(0, 8);
})();           // Claude sessions in tmux panes (the mini keeps them there)
let lastSnap = null, phone = null;

const HOME = os.homedir();
// the data folder comes from the name setting (mesh-name.js dataDir — an install can keep an older folder name so its
// pairing, caches and saved orbits survive a rename); MESH_USERDATA: isolated test runs
const MESH = require('./mesh-name');
app.setName(APP_NAME);
app.setPath('userData', process.env.MESH_USERDATA || path.join(app.getPath('appData'), MESH.dataDir));
ipcMain.on('app:name', e => { e.returnValue = APP_NAME; });
const collector = new Collector();
// Hermes Agent sessions (hermes-sessions.js): they live in tmux panes like Claude's and show up as full sessions
const hermes = require('./hermes-sessions')({ userData: app.getPath('userData') });
collector.extraSessions = () => hermes.sessions(panes.list());
const ptys = new Map();          // id -> { proc, title, kind, cwd }
let win = null;
let nextId = 1;

function createWindow() {
  win = new BrowserWindow({
    width: 1680, height: 1020, minWidth: 340, minHeight: 240,
    backgroundColor: '#05060a', title: APP_NAME,
    ...(IS_WIN ? { autoHideMenuBar: true } : { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 14 } }),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: true },
  });
  if (process.env.MESH_SIZE) { const [w, h] = process.env.MESH_SIZE.split('x').map(Number); win.setSize(w, h); }   // test runs
  else keepOnScreen(loadBounds());
  win.on('moved', saveBounds); win.on('resized', saveBounds);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // links in the page (the probe's speech bubble, markdown in panels) open in the default browser, never in a new app window
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.on('closed', () => { win = null; });
  // tell the renderer when nobody can see the window so it stops drawing (telemetry keeps flowing)
  const vis = v => () => win && win.webContents.send('win:visible', v);
  win.on('hide', vis(false)); win.on('minimize', vis(false)); win.on('show', vis(true)); win.on('restore', vis(true));
  app.on('hide', vis(false)); app.on('show', vis(true));
  if (process.env.MESH_DEBUG) win.webContents.on('console-message', (e, ...a) => console.log('[renderer]', JSON.stringify(e.message ?? a)));
}

// the window comes back where it was, and never hangs off the edge of the screen — also after a resolution or
// display change (e.g. the mini's screen switched to 2560×1440 while the window was bigger or further right)
const BOUNDS_F = () => path.join(app.getPath('userData'), 'window-bounds.json');
function loadBounds() { try { return JSON.parse(fs.readFileSync(BOUNDS_F(), 'utf8')); } catch { return null; } }
function saveBounds() { if (win && !win.isFullScreen() && !win.isMaximized()) try { fs.writeFileSync(BOUNDS_F(), JSON.stringify(win.getBounds())); } catch { } }
function keepOnScreen(want) {
  if (!win || win.isFullScreen()) return;
  const b = want || win.getBounds(), wa = screen.getDisplayMatching(b).workArea;
  const width = Math.min(b.width, wa.width), height = Math.min(b.height, wa.height);
  const x = Math.min(Math.max(b.x, wa.x), wa.x + wa.width - width), y = Math.min(Math.max(b.y, wa.y), wa.y + wa.height - height);
  const cur = win.getBounds();
  if (cur.x !== x || cur.y !== y || cur.width !== width || cur.height !== height) win.setBounds({ x, y, width, height });
}
app.whenReady().then(() => {
  const fix = () => setTimeout(() => keepOnScreen(), 300);
  screen.on('display-metrics-changed', fix); screen.on('display-removed', fix); screen.on('display-added', fix);
});

// ---------------- terminals (node-pty) ----------------
// cleanEnv / loginShell come from core.js (shared with the server program)

const TMUX_SESSION = process.env.MESH_QA ? 'mesh-qa' : 'mesh';

// ---------------- orchestrator per project ----------------
// A project folder says which agent runs it: <project>/.mesh.json {"orchestrator": "hermes" | "claude"}.
// The project is the first folder under ~ that holds the session's folder (~/blog for ~/blog/drafts), or the nearest
// folder with a .mesh.json. Kept in the folder so both Macs and every tool (scripts, the relay) read the same answer.
function projectRoot(cwd) {
  cwd = path.resolve(String(cwd || HOME));
  for (let d = cwd; d.startsWith(HOME) && d !== HOME; d = path.dirname(d)) if (fs.existsSync(path.join(d, '.mesh.json'))) return d;
  const rel = path.relative(HOME, cwd).split(path.sep)[0];
  return rel && !rel.startsWith('..') ? path.join(HOME, rel) : null;
}
function orchestratorFor(cwd) {
  const root = projectRoot(cwd); if (!root) return { root: null, orchestrator: 'claude' };
  let o = 'claude'; try { o = JSON.parse(fs.readFileSync(path.join(root, '.mesh.json'), 'utf8')).orchestrator === 'hermes' ? 'hermes' : 'claude'; } catch { }
  return { root, orchestrator: o, rootTilde: '~' + root.slice(HOME.length) };
}
function setOrchestrator(cwd, o) {
  const root = projectRoot(cwd); if (!root || !fs.existsSync(root)) return { ok: false, err: 'no project folder for ' + cwd };
  const f = path.join(root, '.mesh.json'); let j = {}; try { j = JSON.parse(fs.readFileSync(f, 'utf8')) || {}; } catch { }
  j.orchestrator = o === 'hermes' ? 'hermes' : 'claude'; j.changedAt = new Date().toISOString();
  fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n'); logEngine('project:' + path.basename(root), 'orchestrator ' + j.orchestrator, 'You asked (Mesh window)');
  return { ok: true, ...orchestratorFor(cwd) };
}
const fromTildeP = d => !d ? HOME : d === '~' ? HOME : d.startsWith('~/') ? path.join(HOME, d.slice(2)) : d;
ipcMain.handle('orch:get', async (_e, cwd, onPeer) => onPeer && peerLink ? peerLink.forward('GET', '/api/orchestrator', undefined, { cwd }).catch(() => ({ orchestrator: 'claude' })) : orchestratorFor(fromTildeP(cwd)));
ipcMain.handle('orch:set', async (_e, cwd, o, onPeer) => onPeer && peerLink ? peerLink.forward('POST', '/api/orchestrator', { cwd, orchestrator: o }).catch(e => ({ ok: false, err: e.message })) : setOrchestrator(fromTildeP(cwd), o));
// Hermes needs the Ollama app (its provider here) and Hermes itself on this Mac
const hermesHere = async () => require('./ollama-engine').hermesInstalled() && !!(await require('./ollama-engine').status().catch(() => ({}))).running;
// Start a Hermes Agent session in a tmux pane: a fresh one under a name of its own, or an earlier one by id.
// Always on Ollama: its config (~/.hermes/config.yaml) has no other provider, and --accept-hooks runs the Mesh/no-Claude hook.
async function spawnHermes({ cwd, name, resumeSid, cols, rows, session }) {
  if (IS_WIN || !panes.available()) return { ok: false, err: 'Hermes sessions need tmux' };
  cwd = fs.existsSync(fromTildeP(cwd)) ? fromTildeP(cwd) : HOME;
  // never a second copy of a Hermes session that is already open in a pane (2026-11-07: the reopen-after-restart ran
  // before the Hermes list was read, and resumed the running sessions a second time): hand back that pane instead
  if (resumeSid) { await panes.refresh(); const have = Object.entries(hermes.list()).find(([id, r]) => r.sid === resumeSid && panes.has(id)); if (have) return { ok: true, id: have[0], pid: (panes.list().find(p => p.id === have[0]) || {}).pid, title: have[1].name, cwd: have[1].cwd, pane: true, kind: 'hermes', existing: true }; }
  const nm = resumeSid ? String(name || 'Hermes') : await hermes.freshName(name || 'Hermes · ' + path.basename(cwd));
  const quoted = "'" + nm.replace(/'/g, "'\\''") + "'";
  const cmd = resumeSid && /^[\w.-]+$/.test(resumeSid) ? `exec hermes chat --resume ${resumeSid} --yolo --accept-hooks` : `exec hermes chat --continue ${quoted} --create-if-missing --yolo --accept-hooks`;
  const p = await panes.spawnPane({ session: session || TMUX_SESSION, cwd, title: nm, shell: loginShell(), args: ['-l', '-i', '-c', cmd], cols, rows, env: { COLORTERM: 'truecolor', TERM_PROGRAM: 'ClaudeMesh', MESH_HERMES: '1' } });
  if (!p) return { ok: false, err: "tmux couldn't open the pane" };
  hermes.add(p.id, { name: nm, cwd, sid: resumeSid || null });
  return { ok: true, id: p.id, pid: p.pid, title: nm, cwd, pane: true, kind: 'hermes' };
}
ipcMain.handle('hermes:new', async (_e, o) => {
  o = o || {};
  if (o.onPeer) { if (!peerLink) return { ok: false, err: 'no other Mac paired' }; const r = await peerLink.forward('POST', '/api/hermes/new', o, undefined, 30000).catch(e => ({ ok: false, err: e.message })); return r && r.ok ? { ...r, id: 'peer:' + r.id, onPeer: true } : r; }
  return spawnHermes(o);
});
ipcMain.handle('hermes:here', () => hermesHere());
ipcMain.handle('pty:spawn', async (_e, opts) => {
  const id = 't' + nextId++;
  const cwd = opts.cwd && fs.existsSync(opts.cwd) ? opts.cwd : HOME;
  const sh = loginShell();
  let args = IS_WIN ? ['-NoLogo'] : ['-l'];
  let title = opts.title || 'shell';
  // A project that runs on Hermes never gets a Claude session, and a Hermes conversation is never resumed by Claude:
  // both open in Hermes instead (2026-11-07: a restore once ran `claude --resume <hermes id>` in a Hermes project)
  if (opts.kind === 'claude' && !IS_WIN) {
    const hsid = (/--resume\s+(local-[\w-]+)/.exec(opts.flags || '') || [])[1];
    if (hsid || orchestratorFor(cwd).orchestrator === 'hermes') {
      const r = await spawnHermes({ cwd, name: opts.title && !/starting/.test(opts.title) ? opts.title : undefined, resumeSid: hsid, cols: opts.cols, rows: opts.rows });
      if (r.ok) { console.log('claude refused in a Hermes project, opened Hermes:', cwd); return r; }
      return { id: null, err: r.err };
    }
  }
  if (opts.kind === 'claude') {
    let flags = (opts.flags || '').trim();
    const ollamaModel = opts.engine === 'ollama' && /^[\w.:/-]+$/.test(opts.ollamaModel || '') ? opts.ollamaModel : null;   // an open model instead of Claude (ollama-engine.js)
    // every Claude session started from Mesh runs with bypass-permissions + Remote Control
    // (not for subcommands like `attach <id>`, which take no session flags)
    if (!/^(attach|agents|logs|stop|rm|respawn)\b/.test(flags)) {
      if (!/--dangerously-skip-permissions|--permission-mode/.test(flags)) flags = '--dangerously-skip-permissions ' + flags;
      if (ollamaModel) flags = flags.replace(/(^|\s)(--remote-control|--rc|--model\s+\S+)(?=\s|$)/g, ' ');     // Remote Control needs a claude.ai login
      else if (!/--remote-control\b|(^|\s)--rc\b/.test(flags)) flags = '--remote-control ' + flags;
      flags = flags.trim();
    }
    // exec so the claude pid == pty pid; -i loads the user's PATH (~/.local/bin) like Terminal does
    args = IS_WIN ? ['-NoLogo', '-Command', `& '${(winClaudeBin() || 'claude').replace(/'/g, "''")}' ${flags}`]   // PowerShell: run claude, the tab closes with it
      : ['-l', '-i', '-c', ollamaModel ? `exec ollama launch claude --model ${ollamaModel} -- ${flags}` : `exec claude ${flags}`];
    title = opts.title || 'claude';
  }
  if (opts.kind === 'hermes' && !IS_WIN) {                  // a full Hermes session in tmux (spawnHermes); a plain terminal only without tmux
    const r = await spawnHermes({ cwd, name: opts.name || opts.title, resumeSid: opts.resumeSid, cols: opts.cols, rows: opts.rows });
    if (r.ok) return r;
    args = ['-l', '-i', '-c', 'exec hermes chat --yolo --accept-hooks']; title = opts.title || 'Hermes Agent';
  }
  // Claude sessions live in tmux, so an app restart doesn't touch them; Mesh only reconnects
  if (opts.kind === 'claude' && !IS_WIN && panes.available()) {
    const p = await panes.spawnPane({ session: TMUX_SESSION, cwd, title, shell: sh, args, cols: opts.cols, rows: opts.rows, env: { COLORTERM: 'truecolor', TERM_PROGRAM: 'ClaudeMesh' } });
    if (p) return { id: p.id, pid: p.pid, title, cwd, pane: true };
  }
  const proc = pty.spawn(sh, args, {
    name: 'xterm-256color', cols: opts.cols || 120, rows: opts.rows || 32, cwd,
    env: { ...cleanEnv(), TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'ClaudeMesh' },
  });
  const entry = { proc, title, kind: opts.kind, cwd, buf: '', seq: 0 };
  ptys.set(id, entry);
  proc.onData(d => {
    const seq = ++entry.seq;                                     // lets a snapshot say how far it got (phone-server.js)
    if (entry.hold) entry.hold.push([d, seq]); else win && win.webContents.send('pty:data', id, d, seq);   // (held while the window reloads)
    entry.buf = (entry.buf + d).slice(-1500000);                 // backlog for a phone that opens this terminal later
    ptyBus.emit('data', id, d, seq);
  });
  proc.onExit(({ exitCode }) => {
    ptys.delete(id);
    win && win.webContents.send('pty:exit', id, exitCode);
    ptyBus.emit('exit', id);
  });
  return { id, pid: proc.pid, title, cwd };
});
ipcMain.on('pty:write', (_e, id, data) => {
  updater.noteInput();
  if (peerLink && peerLink.ownsTerm(id)) return void peerLink.termWrite(id, data).catch(() => { });   // a mirrored terminal of the peer
  if (panes.has(id)) return panes.write(id, data);                                                     // a tmux pane on this machine
  const p = ptys.get(id); if (p) p.proc.write(data);
});
// a clean copy of an in-app terminal's screen, serialized by the window's xterm (the raw backlog replays
// redraws made at other sizes and garbles); null if the window can't answer in time
const snapWaits = new Map(); let snapSeq = 0;
ipcMain.on('term:snap:reply', (_e, rq, data, seq) => { const w = snapWaits.get(rq); if (w) { snapWaits.delete(rq); w(data == null ? null : { screen: data, seq }); } });
function termSnapshot(id) {
  if (panes.has(id)) return Promise.resolve(panes.snapshot(id));   // tmux knows its pane's screen itself
  if (!win) return Promise.resolve(null);
  return new Promise(res => {
    const rq = ++snapSeq; snapWaits.set(rq, res); win.webContents.send('term:snap', rq, id);
    setTimeout(() => { if (snapWaits.delete(rq)) res(null); }, 1500);
  });
}
// Mirrors of the peer machine's in-app terminals: its /api/term SSE stream re-emitted as pty:data / pty:exit
const peerTerms = new Map();   // id (peer:…) -> upstream response
ipcMain.on('peerterm:open', async (_e, id) => {
  // the window asks again after a reload: drop the old link, so this window gets its own screen and stream
  const old = peerTerms.get(id); if (old) { peerTerms.delete(id); old.destroy(); }
  if (panes.has(id)) return openPaneView(id);
  if (!peerLink || (peerTerms.has(id) && !old)) return;
  peerTerms.set(id, null);
  // a failed connect must say so, or the window thinks it's attached and the tab stays frozen for good
  const failed = () => { peerTerms.delete(id); if (win) win.webContents.send('peerterm:closed', id); };
  let up;
  try { up = await peerLink.openTerm(id); } catch { return failed(); }
  if (!peerTerms.has(id)) return up.destroy();          // closed while connecting
  if (up.statusCode !== 200) { up.resume(); return failed(); }
  peerTerms.set(id, up);
  let buf = '';
  up.setEncoding('utf8');
  up.on('data', chunk => {
    buf += chunk; let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      const ev = (block.match(/^event: (.*)$/m) || [])[1], dm = block.match(/^data: (.*)$/m);
      if (!ev || !dm || !win) continue;
      let d; try { d = JSON.parse(dm[1]); } catch { continue; }
      if (ev === 'data') win.webContents.send('pty:data', id, d);
      else if (ev === 'init' || ev === 'size') win.webContents.send('peerterm:' + ev, id, d);
      else if (ev === 'exit') win.webContents.send('pty:exit', id, 0);
    }
  });
  const gone = () => { if (peerTerms.get(id) === up) { peerTerms.delete(id); if (win) win.webContents.send('peerterm:closed', id); } };
  up.on('end', gone); up.on('error', gone); up.on('close', gone);
});
// this window's view of one of our own tmux panes: the same events a peer mirror gets, straight from ptyBus
function openPaneView(id) {
  if (peerTerms.has(id) || !win) return;
  let held = [];
  const on = (pid, d) => { if (pid === id && win) held ? held.push(d) : win.webContents.send('pty:data', id, d); };
  const sz = (pid, cols, rows) => { if (pid === id && win) win.webContents.send('peerterm:size', id, { cols, rows }); };
  const off = pid => { if (pid === id && win) win.webContents.send('pty:exit', id, 0); };
  ptyBus.on('data', on); ptyBus.on('resize', sz); ptyBus.on('exit', off);
  const view = { destroy() { ptyBus.off('data', on); ptyBus.off('resize', sz); ptyBus.off('exit', off); panes.close(id); } };
  peerTerms.set(id, view);
  panes.open(id).then(() => {
    const p = panes.proc(id); if (!p || !win || peerTerms.get(id) !== view) return;
    win.webContents.send('peerterm:init', id, { cols: p.proc.cols, rows: p.proc.rows, backlog: panes.snapshot(id) });
    for (const d of held) win.webContents.send('pty:data', id, d); held = null;
  });
}
ipcMain.on('peerterm:close', (_e, id) => { const up = peerTerms.get(id); peerTerms.delete(id); if (up) up.destroy(); });
ipcMain.on('pty:resize', (_e, id, c, r) => {
  const p = ptys.get(id);
  if (p && c > 0 && r > 0 && (c !== p.proc.cols || r !== p.proc.rows)) try { p.proc.resize(c, r); ptyBus.emit('resize', id, c, r); } catch { }
});
// Whichever machine is being used sets the size of a shared terminal (like tmux's "latest" window-size): the
// peer's mirror asks for its pane size, the pty is resized so Claude Code rewraps, and our window scales its copy
// to that size until it is used here again (then it fits itself and takes the size back).
function termResize(id, c, r) {
  if (panes.has(id)) {
    if (!(c >= 20 && c <= 500 && r >= 5 && r <= 200) || !panes.resize(id, c, r)) return { ok: false };
    ptyBus.emit('resize', id, c, r); return { ok: true };
  }
  const p = ptys.get(id);
  if (!p || !(c >= 20 && c <= 500 && r >= 5 && r <= 200)) return { ok: false };
  if (c !== p.proc.cols || r !== p.proc.rows) try { p.proc.resize(c, r); } catch { return { ok: false }; }
  ptyBus.emit('resize', id, c, r);   // also when unchanged: the asking mirror waits for this as confirmation
  if (win) win.webContents.send('pty:remoteSize', id, c, r);
  return { ok: true };
}
ipcMain.on('peerterm:resize', (_e, id, c, r) => { if (panes.has(id)) return void termResize(id, c, r); if (peerLink) peerLink.termResize(id, c, r).catch(() => { }); });
ipcMain.on('pty:kill', (_e, id) => { const p = ptys.get(id); if (p) try { p.proc.kill(); } catch { } });

// ---------------- control of sessions running in Terminal.app ----------------
function osa(lines) {
  if (process.platform !== 'darwin') return Promise.resolve({ ok: false, out: 'notfound', err: 'Terminal.app control is macOS only' });
  return new Promise(res => execFile('/usr/bin/osascript', lines.flatMap(l => ['-e', l]),
    (err, so, se) => res({ ok: !err, out: (so || '').trim(), err: (se || '').trim() })));
}
const asStr = s => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

// Sessions hosted in a tmux pane (a machine can keep its Claude sessions in tmux windows) have a tty but no
// Terminal.app tab: type into the pane with send-keys instead. Looked up by tty on every call (panes come and go).
const TMUX = ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux'].find(p => fs.existsSync(p)) || 'tmux';
// launched from the Dock there is no locale, and tmux then mangles tabs and non-ASCII text (Korean prompts) into '_'
const TMUX_ENV = { ...process.env, LANG: 'en_US.UTF-8', LC_CTYPE: 'en_US.UTF-8' };
function tmuxPaneForTty(tty) {
  if (!tty || IS_WIN) return null;
  try {
    for (const l of execFileSync(TMUX, ['list-panes', '-a', '-F', '#{pane_id}|#{pane_tty}'], { timeout: 5000, env: TMUX_ENV }).toString().split('\n')) {
      const [id, t] = l.split('|'); if (t === tty) return id;
    }
  } catch { }
  return null;
}
function tmuxKeys(pane, ...args) {
  try { execFileSync(TMUX, ['send-keys', '-t', pane, ...args], { timeout: 5000, env: TMUX_ENV }); return { ok: true, out: 'tmux' }; }
  catch (e) { return { ok: false, err: String(e.message || e) }; }
}
// External session by tty: tmux pane if it has one, else the Terminal.app tab (osascript 'notfound' when neither).
function extSend(tty, text) {
  const clean = String(text).replace(/\r?\n/g, ' ');
  const pane = tmuxPaneForTty(tty);
  if (!pane) return osa(terminalTabScript(tty, [`do script ${asStr(clean)} in t`]));
  const r = tmuxKeys(pane, '-l', clean);
  if (r.ok) setTimeout(() => tmuxKeys(pane, 'Enter'), 60);          // Enter after the text settles, like ctlSend
  return r;
}
function extInterrupt(tty) {
  const pane = tmuxPaneForTty(tty);
  return pane ? tmuxKeys(pane, 'Escape') : osa(terminalTabScript(tty, ['do script (ASCII character 27) in t']));
}
function extFocus(tty) {
  if (tmuxPaneForTty(tty)) return { ok: true, out: 'tmux' };          // nothing to bring forward for a tmux pane
  return osa(terminalTabScript(tty, ['set selected of t to true', 'set index of w to 1', 'activate']));
}

function terminalTabScript(tty, body) {
  return ['tell application "Terminal"',
    'repeat with w in windows', 'repeat with t in tabs of w',
    `if tty of t is ${asStr(tty)} then`, ...body, 'return "ok"', 'end if',
    'end repeat', 'end repeat', 'return "notfound"', 'end tell'];
}

// Typing into the external session: Terminal "do script" types the text then CR (= Enter).
const hermesByTty = tty => tty && ((lastSnap && lastSnap.sessions) || []).find(s => s.kind === 'hermes' && s.tty === tty && s.hermesPane);
ipcMain.handle('ext:send', async (_e, tty, text) => { const h = hermesByTty(tty); return h ? hermesSend(h.hermesPane, text) : extSend(tty, text); });
ipcMain.handle('ext:interrupt', async (_e, tty) => { const h = hermesByTty(tty); return h ? interruptSession(h.sid) : extInterrupt(tty); });
ipcMain.handle('ext:focus', async (_e, tty) => extFocus(tty));

// Write to an in-app session (owned pty) by id
function ctlSend(ptyId, text, submit) {
  const p = ptys.get(ptyId); if (!p) return { ok: false };
  p.proc.write(String(text));
  if (submit) setTimeout(() => p.proc.write('\r'), 60);
  return { ok: true };
}
ipcMain.handle('ctl:send', (_e, ptyId, text, submit) => ctlSend(ptyId, text, submit));

// by session id (used by the phone): in-app → pty, Terminal.app → AppleScript
const liveSession = sid => lastSnap && lastSnap.sessions.find(s => s.sid === sid);
// Hermes' input box (prompt_toolkit): what's typed there and not sent yet. Its placeholder hint is italic (\e[3m), typed text isn't.
function hermesDraft(pane) {
  let out = ''; try { out = execFileSync(TMUX, ['capture-pane', '-p', '-e', '-t', pane], { timeout: 5000, env: TMUX_ENV }).toString(); } catch { return null; }
  const line = out.split('\n').reverse().find(l => l.includes('\u276f ')); if (line == null) return null;
  const after = line.slice(line.indexOf('\u276f ') + 2);
  if (/^(\x1b\[[\d;]*m)*\x1b\[3m/.test(after)) return '';                       // only the hint
  return after.replace(/\x1b\[[\d;]*m/g, '').trim();
}
// Text into a Hermes session: never into a half-typed message of yours (waits up to 2 minutes for the box to be empty),
// and Enter a moment after the text, or Hermes takes it as part of a paste.
async function hermesSend(pane, text) {
  for (let i = 0; i < 120; i++) { const d = hermesDraft(pane); if (!d) break; if (i === 119) return { ok: false, err: 'unsent text in its input box: not mixing into it' }; await new Promise(r => setTimeout(r, 1000)); }
  // as a bracketed paste, so a message with several lines arrives exactly as written (line breaks kept, nothing sent early)
  const buf = 'mesh-h' + process.pid, f = path.join(os.tmpdir(), buf + '.txt');
  let r; try {
    fs.writeFileSync(f, String(text).replace(/\r\n?/g, '\n'));
    execFileSync(TMUX, ['load-buffer', '-b', buf, f], { timeout: 5000, env: TMUX_ENV });
    execFileSync(TMUX, ['paste-buffer', '-p', '-d', '-b', buf, '-t', pane], { timeout: 5000, env: TMUX_ENV }); r = { ok: true };
  } catch (e) { r = { ok: false, err: String(e.message || e) }; } finally { try { fs.unlinkSync(f); } catch { } }
  if (!r.ok) return r;
  await new Promise(r2 => setTimeout(r2, 450)); tmuxKeys(pane, 'Enter');
  return { ok: true, out: 'tmux' };
}
// what is typed into a Claude Code session's input box in a tmux pane and not sent ('' = empty; its hint is dim)
function claudeDraft(pane) {
  let out = ''; try { out = execFileSync(TMUX, ['capture-pane', '-p', '-e', '-t', pane], { timeout: 5000, env: TMUX_ENV }).toString(); } catch { return ''; }
  const line = out.split('\n').reverse().find(l => l.includes('\u276f')); if (line == null) return '';
  const after = line.slice(line.indexOf('\u276f') + 1).replace(/^(\u00a0| )/, '');
  if (/^(\x1b\[[\d;]*m)*\x1b\[(2|3)m/.test(after)) return '';
  return after.replace(/\x1b\[[\d;]*m/g, '').trim();
}
async function sendToSession(sid, text) {
  const s = liveSession(sid); if (!s) return { ok: false, err: 'session is not running' };
  if (s.kind === 'hermes' && s.hermesPane) return hermesSend(s.hermesPane, text);
  // a Claude session in tmux: never mix into a half-typed message of yours (waits up to 2 minutes for the box to be empty)
  if (s.pane && !s.owner) for (let i = 0; claudeDraft(s.pane); i++) { if (i >= 119) return { ok: false, err: 'unsent text in its input box: not mixing into it' }; await new Promise(r => setTimeout(r, 1000)); }
  if (s.owner) return ctlSend(s.owner, text, true);
  if (s.tty && s.kind !== 'bg') return extSend(s.tty, text);
  return { ok: false, err: 'background session — view only' };
}
async function interruptSession(sid) {
  const s = liveSession(sid); if (!s) return { ok: false };
  if (s.kind === 'hermes' && s.hermesPane) return hermesDraft(s.hermesPane) ? { ok: false, err: 'unsent text in its input box' } : tmuxKeys(s.hermesPane, 'C-c');   // one Ctrl+C on an empty box stops the turn (with a draft it would only clear the draft)
  if (s.owner) { const p = ptys.get(s.owner); if (p) p.proc.write('\x1b'); return { ok: true }; }
  if (s.tty) return extInterrupt(s.tty);
  return { ok: false };
}

ipcMain.handle('dlg:dir', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], defaultPath: HOME });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('notify', (_e, title, body) => { new Notification({ title, body, silent: false }).show(); });
ipcMain.handle('open:path', (_e, p) => shell.openPath(p));
// bubble colour chosen per session (renderer/organism.js ORB_PAL keys c1…c5); null = automatic (by model)
const COLORS_FILE = path.join(app.getPath('userData'), 'colors.json');
let sessionColors = {}; try { sessionColors = JSON.parse(fs.readFileSync(COLORS_FILE, 'utf8')) || {}; } catch { }
const baseSid = sid => String(sid || '').replace(/^peer:/, '');
function paintSessions(list) { for (const s of list || []) { const c = sessionColors[baseSid(s.remoteSid || s.sid)]; if (c) s.color = c; } }
ipcMain.handle('color:set', (_e, sid, key) => {
  sid = baseSid(sid); if (!sid) return false;
  if (key && /^c[1-5]$/.test(key)) sessionColors[sid] = key; else delete sessionColors[sid];
  try { fs.writeFileSync(COLORS_FILE, JSON.stringify(sessionColors)); } catch { }
  return true;
});
// session groups (sidebar headers + Doctor-Strange portals on the mesh, renderer/portal.js):
// { groups: { id: { name, collapsed } }, members: { baseSid: id } }; shared with the phone through the snapshot
const GROUPS_FILE = path.join(app.getPath('userData'), 'groups.json');
let sessionGroups = { groups: {}, members: {} };
try { sessionGroups = { ...sessionGroups, ...JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8')) }; } catch { }
const saveGroups = () => { try { fs.writeFileSync(GROUPS_FILE, JSON.stringify(sessionGroups)); } catch { } };
function groupSessions(snapshot) {
  for (const s of snapshot.sessions || []) { const g = sessionGroups.members[baseSid(s.remoteSid || s.sid)]; if (g && sessionGroups.groups[g]) s.group = g; }
  snapshot.groups = sessionGroups.groups;
}
ipcMain.handle('group:set', (_e, sid, gid) => {             // gid null → ungroup; an emptied group disappears
  sid = baseSid(sid); if (!sid) return false;
  if (gid && sessionGroups.groups[gid]) sessionGroups.members[sid] = gid; else delete sessionGroups.members[sid];
  for (const id of Object.keys(sessionGroups.groups)) if (!Object.values(sessionGroups.members).includes(id)) delete sessionGroups.groups[id];
  saveGroups(); return true;
});
ipcMain.handle('group:create', (_e, name, sids) => {
  const id = 'g' + Date.now().toString(36);
  sessionGroups.groups[id] = { name: String(name || 'Group').slice(0, 40), collapsed: false, at: Date.now() };
  for (const sid of sids || []) sessionGroups.members[baseSid(sid)] = id;
  saveGroups(); return id;
});
ipcMain.handle('group:update', (_e, gid, patch) => {        // { name?, collapsed? }
  const g = sessionGroups.groups[gid]; if (!g) return false;
  if (typeof patch.name === 'string' && patch.name.trim()) g.name = patch.name.trim().slice(0, 40);
  if (typeof patch.collapsed === 'boolean') g.collapsed = patch.collapsed;
  saveGroups(); return true;
});
ipcMain.handle('group:delete', (_e, gid) => {
  delete sessionGroups.groups[gid];
  for (const [sid, g] of Object.entries(sessionGroups.members)) if (g === gid) delete sessionGroups.members[sid];
  saveGroups(); return true;
});
// Screen Sharing.app to the other Mac (its Tailscale address from peer.json)
// today's Google Calendar in the header ribbon (calendar.js; one-time read-only connect per Mac)
const calendar = require('./calendar')({ userData: app.getPath('userData'), openExternal: u => shell.openExternal(u), onChange: st => win && win.webContents.send('cal', st) });
app.whenReady().then(() => { calendar.start(); require('electron').powerMonitor.on('resume', () => calendar.wake()); });
ipcMain.handle('cal:get', () => calendar.get());
ipcMain.handle('cal:connect', () => { calendar.connect(); return true; });
ipcMain.handle('cal:refresh', () => calendar.refresh());
ipcMain.handle('cal:open', (_e, u) => /^https:\/\/(calendar\.google\.com|www\.google\.com\/calendar|meet\.google\.com|console\.(developers|cloud)\.google\.com)\//.test(String(u || '')) ? shell.openExternal(u) : false);
// Window menu → "Show" toggles for the header items and the panels (saved per Mac in <userData>/ui.json)
const UI_FILE = path.join(app.getPath('userData'), 'ui.json');
const UI_ITEMS = [
  ['models', 'Model usage chips'], ['cal', "Today's calendar"], ['counts', 'Session counts (working / idle / API errors)'],
  ['versions', 'Version warning'], ['left', 'Usage left (session / week / credits)'], ['mem', 'Memory (this Mac / other Mac)'], ['viewSeg', 'Mesh / Split / Grid switch'],
  ['simple', 'Simple mode button'], ['sched', 'Schedules button'], ['vnc', 'Screen Share button'], ['phone', 'iPhone button'],
  ['bell', 'Notifications bell'], null, ['side', 'Sessions sidebar'], ['panel', 'Session details panel'], ['usage', 'Usage card under the star'],
];
// View menu → "Mesh" toggles for the mesh's features (same ui.json; renderer → viz.hideFx, checked by viz.off(key))
const MESH_ITEMS = [
  ['mStars', 'Starfield'], ['mFlames', "Star's flames"], ['mRing', 'Orbit ring & spin band'], ['mTrails', 'Orbit trails'],
  ['mLinks', 'Link strands to the star'], null, ['mLabels', 'Name tags'], ['mSparkles', 'Sparks inside bubbles'], ['mRoots', 'Session roots (loops, agents, skills)'],
  ['mNova', 'Finish flare'], null, ['mSigil', 'Group portal sigils'], ['mSparks', 'Group portal sparks'], ['mProbe', 'Probe droid'], ['mCuss', 'Probe swears (off = clean language)'], null, ['mBlackHole', 'Black hole'], ['mEndurance', 'Endurance station'],
];
const WINDOW_MESH = [['mOrbitLines', 'Orbit lines'], ['mLinks', 'Lines to the mother star'], ['mSpinBand', 'Orbit control disk'], ['mCine', 'Screen saver after 3 min idle']];
let uiHidden = {}; try { uiHidden = JSON.parse(fs.readFileSync(UI_FILE, 'utf8')) || {}; } catch { }
// Team use: features that need a team's own setup on this Mac appear only where it exists (local/ add-ons, below), and
// the header can carry the team's name (<userData>/team.json). An optional guide link comes from mesh.local.json guideUrl.
const FEATURES = {
  schedules: false,                                                                                         // turned on by a local add-on
  calendar: fs.existsSync(path.join(os.homedir(), '.config', 'gws_shim', 'token.json')),                    // Google app registration
};
const TEAM_FILE = path.join(app.getPath('userData'), 'team.json');
let team = {}; try { team = JSON.parse(fs.readFileSync(TEAM_FILE, 'utf8')) || {}; } catch { }
ipcMain.handle('features', () => FEATURES);
ipcMain.handle('team:get', () => team);
ipcMain.handle('team:set', (_e, name) => { team = { name: String(name || '').trim().slice(0, 40) }; try { fs.writeFileSync(TEAM_FILE, JSON.stringify(team)); } catch { } return team; });
// Help ▸ Mesh Manual: every object (pictured by the app's own renderer) and how to use the app (renderer/manual.html)
let manualWin = null;
function openManual() {
  if (manualWin && !manualWin.isDestroyed()) return manualWin.focus();
  manualWin = new BrowserWindow({ width: 1180, height: 860, title: APP_NAME + ' Manual', backgroundColor: '#000000',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  manualWin.loadFile(path.join(__dirname, 'renderer', 'manual.html'));
  manualWin.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
}
// Window ▸ Panels: the dock's panels (renderer/dock.js reports them; MCP screens come and go)
let dockPanels = [], dockKey = '';
ipcMain.on('dock:state', (_e, l) => { const k = JSON.stringify(l || []); if (k === dockKey) return; dockKey = k; dockPanels = Array.isArray(l) ? l : []; buildMenu(); });
function buildMenu() {
  const docked = dockPanels.length > 0;
  const dockCmd = c => win && win.webContents.send('dock:cmd', c);
  const panelItems = docked ? [{ label: 'Panels', enabled: false },
    ...dockPanels.filter(p => !p.group || p.id === 'live').map(p => ({ label: p.title, type: 'checkbox', checked: !!p.shown, click: () => dockCmd({ op: 'toggle', id: p.id }) })),
    ...(dockPanels.some(p => p.group === 'live') ? [{ label: 'Live panels', submenu: dockPanels.filter(p => p.group === 'live').map(p => ({ label: p.title, type: 'checkbox', checked: !!p.shown, click: () => dockCmd({ op: 'toggle', id: p.id }) })) }] : []),
    { label: 'Reset Panel Layout', click: () => dockCmd({ op: 'reset' }) }, { type: 'separator' }] : [];
  const show = UI_ITEMS.filter(it => !(docked && it && (it[0] === 'side' || it[0] === 'panel'))).map(it => it ? { label: it[1], type: 'checkbox', checked: !uiHidden[it[0]], click: m => {
    uiHidden[it[0]] = !m.checked; try { fs.writeFileSync(UI_FILE, JSON.stringify(uiHidden)); } catch { }
    win && win.webContents.send('ui:hidden', uiHidden);
  } } : { type: 'separator' });
  const meshShow = MESH_ITEMS.map(it => it ? { label: it[1], type: 'checkbox', checked: !uiHidden[it[0]], click: m => {
    uiHidden[it[0]] = !m.checked; try { fs.writeFileSync(UI_FILE, JSON.stringify(uiHidden)); } catch { }
    win && win.webContents.send('ui:hidden', uiHidden); buildMenu();     // (Link strands also sits in the Window menu)
  } } : { type: 'separator' });
  meshShow.push({ type: 'separator' }, { label: 'Show all mesh features', click: () => { for (const it of MESH_ITEMS) if (it) delete uiHidden[it[0]]; try { fs.writeFileSync(UI_FILE, JSON.stringify(uiHidden)); } catch { } win && win.webContents.send('ui:hidden', uiHidden); buildMenu(); } });
  show.push({ type: 'separator' }, { label: 'Show everything', click: () => { uiHidden = {}; try { fs.writeFileSync(UI_FILE, '{}'); } catch { } win && win.webContents.send('ui:hidden', uiHidden); buildMenu(); } });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { label: 'Set Team Name…', click: () => win && win.webContents.send('team:edit') }, { label: 'Session Refresh…', click: () => win && win.webContents.send('refresh:open') }, { type: 'separator' },
      { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' },
      { label: `Restart ${app.name}`, accelerator: 'CmdOrCtrl+Alt+R', click: () => updater.restartNow() }, { role: 'quit' }] },
    { role: 'fileMenu' },
    // Undo goes through the page: in a terminal it is Claude Code's own undo (Ctrl+_), elsewhere the normal text undo
    { label: 'Edit', submenu: [{ label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => win && win.webContents.send('edit:undo') }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'pasteAndMatchStyle' }, { role: 'delete' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }, { type: 'separator' },
      { label: 'Mesh', enabled: false }, ...meshShow, { type: 'separator' },
      { label: 'Play Screen Saver (in 5 s)', accelerator: 'CmdOrCtrl+Shift+S', click: () => win && win.webContents.send('cine:play') },
      { label: 'Screen Saver Stories', submenu: [
        { label: 'Play All Stories (skip the intro)', click: () => win && win.webContents.send('cine:play', { stories: true }) }, { type: 'separator' },
        ...[['supernova', 'Supernova'], ['heist', 'The Heist'], ['endurance', 'Endurance Down'], ['hide', 'Hide and Seek'], ['race', 'Grand Prix']].map(([k, l]) => ({ label: l, click: () => win && win.webContents.send('cine:play', { stories: true, story: k }) }))] }] },
    // mesh lines and controls: Orbit lines = the main ring's hairline ellipses, each hand-placed session's orbit and the
    // coloured trails; Lines to the mother star = the strands (same switch as View ▸ Mesh ▸ Link strands); Orbit control
    // disk = the dashed spin band (the ring still spins when it's hidden)
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, ...panelItems, { label: 'Show', enabled: false }, ...show,
      { type: 'separator' }, ...WINDOW_MESH.map(([k, label]) => ({ label, type: 'checkbox', checked: !uiHidden[k], click: m => {
        uiHidden[k] = !m.checked; try { fs.writeFileSync(UI_FILE, JSON.stringify(uiHidden)); } catch { }
        win && win.webContents.send('ui:hidden', uiHidden); buildMenu();
      } })),
      { label: 'Reset sizes & positions', click: () => win && win.webContents.send('mesh:resetLayout') },
      { type: 'separator' }, { label: 'Reopen last sessions without asking', type: 'checkbox', checked: !uiHidden.askRestore, click: m => {
        uiHidden.askRestore = !m.checked; try { fs.writeFileSync(UI_FILE, JSON.stringify(uiHidden)); } catch { } } }, { type: 'separator' }, { role: 'front' }] },
    { role: 'help', submenu: [{ label: APP_NAME + ' Manual', accelerator: 'CmdOrCtrl+Shift+/', click: openManual }, { type: 'separator' },
      ...(MESH.guideUrl ? [{ label: APP_NAME + ' guide', click: () => shell.openExternal(MESH.guideUrl) }] : [])] },
  ]));
}
app.whenReady().then(buildMenu);

// ---------------- MCP screens (renderer/mcp-panels.js) ----------------
// What each MCP server is doing, from the live sessions' transcripts; plus a live view of the app window an MCP drives
// (Blender, Chrome …) through screen capture — needs macOS Screen Recording permission for this app.
const { createMcpActivity } = require('./mcp-activity');
const mcpAct = createMcpActivity({ findTranscript: sid => core.findTranscript(sid) });
ipcMain.handle('mcp:activity', () => mcpAct.activity(((lastSnap && lastSnap.sessions) || []).filter(s => !s.onPeer && s.sid).map(s => ({ sid: s.sid, name: s.name }))));
ipcMain.handle('mcp:image', (_e, id) => mcpAct.image(String(id || '')));
// ---------------- Live panel (renderer/live-panels.js): what a session's job is doing right now ----------------
const { createLiveJobs } = require('./live-job');
const liveJobs = createLiveJobs({ findTranscript: sid => core.findTranscript(sid), home: HOME });
const { createLiveCdp } = require('./live-cdp');
const liveCdp = createLiveCdp((key, msg) => { if (win && !win.isDestroyed()) win.webContents.send('live:msg', key, msg); });
ipcMain.handle('live:job', (_e, sid, opts) => { const s = ((lastSnap && lastSnap.sessions) || []).find(x => x.sid === sid && !x.onPeer); return s ? liveJobs.job(s, opts || {}) : null; });
ipcMain.handle('live:watch', (_e, key, port, hosts, targetId) => { port = +port; if (!(port > 1024 && port < 65536)) return; return liveCdp.watch(String(key), port, Array.isArray(hosts) ? hosts.slice(0, 8) : [], targetId || null); });
ipcMain.handle('live:unwatch', (_e, key) => liveCdp.unwatch(String(key)));
ipcMain.handle('live:doc', async (_e, d) => {
  if (!d || !d.id) return null;
  if (!localAddon || !localAddon.docPreview) return { kind: 'link', url: d.url };      // public build: just the link
  try { return await localAddon.docPreview(d); } catch (e) { return { kind: 'link', url: d.url, err: String(e.message || e) }; }
});
app.on('before-quit', () => liveCdp.stopAll());
// ---------------- a session's project folder (Sessions button + the cargo pod on its bubble) ----------------
const { createFolders } = require('./project-folders');
const projFolders = createFolders({ findTranscript: sid => core.findTranscript(sid), home: HOME });
// Sub-sessions: an unnamed session or a script's run hangs under the named session that works in the same project
// (e.g. web-42 in ~/web → Shop Project, whose folders are ~/web + ~/api). Sessions tree it in Sessions. Worked out when
// the set of sessions changes and every 10 min (transcripts are read), then just applied to each snapshot.
let subParents = {}, subKey = '', subAt = 0;
function linkSubSessions(snap) {
  const kid = s => s.auto || s.headless, key = snap.sessions.map(s => s.sid + (kid(s) ? '*' : '')).sort().join();
  if (key !== subKey || Date.now() - subAt > 10 * 60e3) {
    subKey = key; subAt = Date.now(); subParents = {};
    const kids = snap.sessions.filter(kid), mains = kids.length ? snap.sessions.filter(s => !kid(s)) : [];
    for (const k of kids) {
      const F = projFolders.allOf(k.sid, k.cwd)[0]; if (!F) continue;
      // the session that has worked there the most (a passing look from another session doesn't make it the parent)
      let best = null, most = 2;
      for (const s of mains) { const n = (s.cwd === F ? 1e6 : 0) + projFolders.hitsIn(s.sid, F); if (n > most) { best = s; most = n; } }
      if (best) subParents[k.sid] = best.sid;
    }
  }
  // a session another session actually started belongs to that one, whatever folder it runs in
  const here = new Set(snap.sessions.map(s => s.sid));
  for (const s of snap.sessions) { const p = s.spawnedBy && here.has(s.spawnedBy) ? s.spawnedBy : subParents[s.sid]; if (p) s.parent = p; }
}
// token usage (usage-main.js)
const USAGE_MACHINE = (() => { try { const c = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'peer.json'), 'utf8')); if (c.selfLabel) return c.selfLabel; } catch { } return os.hostname().split('.')[0]; })();
const usageBoard = require('./usage-main').createUsage({ userData: app.getPath('userData'), machine: USAGE_MACHINE,
  snapshot: () => lastSnap, limits: () => (core.usage() || {}).limits || null, limitsPending: () => !core.usage() && !core.usageTried(), peer: () => peerLink, mask: t => cards.mask(t), onAlert: a => { if (phone) phone.alert(a); },
  models: () => (refresher ? refresher.models() : {}) });
app.whenReady().then(() => usageBoard.start());
ipcMain.handle('usage:dash', () => usageBoard.dash());
ipcMain.handle('usage:session', (_e, list) => usageBoard.session(list));
ipcMain.handle('usage:manual', (_e, pct) => usageBoard.setManual(pct));
const localFolders = () => projFolders.folders(((lastSnap && lastSnap.sessions) || []).filter(s => !s.onPeer && s.sid).map(s => ({ sid: s.sid, cwd: s.cwd })));
const folderMirror = require('./folder-mirror');
// Engine switches are Kevin's: each one is written down with who made it (<userData>/engine-switches.jsonl)
const engineLogged = new Map(), engineSeen = new Map();
const engineExpect = new Map();         // sid -> the model Mesh just switched it to
function logEngine(sid, to, by) {
  engineLogged.set(sid, Date.now()); if (!/^inside the session/.test(by)) engineExpect.set(sid, to);
  const s = ((lastSnap && lastSnap.sessions) || []).find(x => x.sid === sid);
  fs.appendFile(path.join(app.getPath('userData'), 'engine-switches.jsonl'), JSON.stringify({ at: new Date().toISOString(), sid, name: s ? s.name : '', to, by }) + '\n', () => { });
}
ipcMain.on('engine:log', (_e, sid, to, by) => logEngine(sid, to, by));
// a model changed some other way, such as /model typed in the session, still gets a line
function watchEngines(snap) {
  for (const s of snap.sessions) {
    if (s.onPeer || !s.model) continue;
    const e = /^(claude-|<synthetic)/i.test(s.model) || /\b(opus|sonnet|haiku|fable)\b/i.test(s.model) ? 'claude' : s.model, was = engineSeen.get(s.sid);
    // a switch Mesh made shows up with the session's next reply, however late (Ollama names the model without its -cloud tag)
    const norm = m => String(m || '').replace(/[-:]cloud$/, ''), exp = engineExpect.get(s.sid);
    if (was && was !== e && exp && norm(exp) === norm(e)) engineExpect.delete(s.sid);
    else if (was && was !== e && norm(was) !== norm(e) && Date.now() - (engineLogged.get(s.sid) || 0) > 180e3) logEngine(s.sid, e, 'inside the session (/model or a script)');
    engineSeen.set(s.sid, e);
  }
}
ipcMain.handle('hermes:installed', () => require('./ollama-engine').hermesInstalled());
ipcMain.handle('ollama:status', (_e, onPeer) => onPeer && peerLink ? peerLink.forward('GET', '/api/ollama-status', undefined, undefined, 12000).catch(() => ({ installed: false })) : require('./ollama-engine').status());
let peerFolders = {};                                                        // sid → path relative to home, on the other Mac
ipcMain.handle('folders', async () => {
  const out = localFolders(); if (!peerLink) return out;
  if (peerLink.online()) { const r = await peerLink.forward('GET', '/api/folders').catch(() => null); if (r && r.folders) peerFolders = r.folders; }
  const who = peerLink.name() || peerLink.label();
  for (const [sid, rel] of Object.entries(peerFolders)) {
    const f = folderMirror.resolve(rel, who) || { path: '', label: rel.split('/').pop(), why: `on ${who}, not on this Mac yet`, pending: true };
    if (!out[sid]) out[sid] = f; out['peer:' + sid] = f;                     // (a session live on both Macs shows twice)
  }
  return out;
});
// ---------------- project cards (project-cards.js): how each session's project runs ----------------
const { createProjectCards } = require('./project-cards');
const cards = createProjectCards({ home: HOME, userData: app.getPath('userData'), findTranscript: sid => core.findTranscript(sid),
  allOf: (sid, cwd) => projFolders.allOf(refresher ? refresher.aliasOf(sid) : sid, cwd), claudeBin: () => core.resolveClaude(),
  onHermes: s => s.kind === 'hermes' || orchestratorFor(s.cwd).orchestrator === 'hermes' });
const localSessions = () => ((lastSnap && lastSnap.sessions) || []).filter(s => !s.onPeer && s.sid);
const CARD_ASK = 'Please write a short CLAUDE.md in this project folder (create it, or add to the one there) for whoever runs this project next: 1) what the project does in 2-3 lines, 2) its hard rules, 3) the checks it runs before publishing or running (say which are enforced by a script and which are only written down), 4) its schedule (launchd jobs / cron: what runs when). Keep it under 60 lines and never include keys, tokens or emails.';
ipcMain.handle('cards:summary', () => cards.summary(localSessions()));
ipcMain.handle('cards:get', (_e, sid, force) => { const s = localSessions().find(x => x.sid === sid); if (s) return cards.card(s, { force: !!force, waitMs: 1500 }).then(c => c && { ...c, refreshed: refresher && refresher.lastFor(s.name) });
  return peerLink && peerLink.owns(sid) ? peerLink.forward('GET', '/api/card', undefined, { sid, ...(force ? { force: '1' } : {}) }, 20000).catch(() => null) : null; });
ipcMain.handle('cards:open', (_e, p) => { const f = cards.safeFile(p); return f ? shell.openPath(f) : 'not a file in your home folder'; });
ipcMain.handle('cards:ask', (_e, sid) => sendToSession(sid, CARD_ASK));
// ---------------- Code map: an interactive knowledge graph of a session's project (codemap.js, Graphify) ----------------
const codemap = require('./codemap').createCodemap({
  home: HOME, env: () => cleanEnv(),
  projectOf: (sid, cwd) => { if (process.env.MESH_CODEMAP_PROJECT) return process.env.MESH_CODEMAP_PROJECT;   // QA
    const a = refresher ? refresher.aliasOf(sid) : sid; const f = projFolders.folders([{ sid: a, cwd: cwd || (liveSession(sid) || {}).cwd }])[a]; return f ? f.path : null; },
  onChange: (project, ev) => {
    for (const w of cmWins.values()) if (!w.isDestroyed()) w.webContents.send('codemap:changed');
    if (ev && ev.error && ev.error !== 'Cancelled' && Notification.isSupported()) new Notification({ title: 'Code map', body: `${path.basename(project)}: ${ev.error}`.slice(0, 200) }).show();
  },
});
const cmWins = new Map();       // sid -> viewer window
const cmAllowed = new Set();    // files the viewer may show / open: only the graph and report Mesh itself reported
const cmCall = (sid, op) => {
  if (peerSess(sid)) return op === 'status' || op === 'html' ? peerLink.forward('GET', op === 'html' ? '/api/codemap/html' : '/api/codemap', undefined, { sid }, 60e3).catch(e => ({ ok: false, err: `${peerLink.label()}: ${e.message}` }))
    : peerLink.forward('POST', '/api/codemap', { sid, op }, undefined, 60e3).catch(e => ({ ok: false, err: `${peerLink.label()}: ${e.message}` }));
  const cwd = (liveSession(sid) || {}).cwd;
  return op === 'status' ? codemap.status(sid, cwd) : op === 'html' ? codemap.htmlOf(sid, cwd) : op === 'generate' ? codemap.generate(sid, cwd) : op === 'cancel' ? codemap.cancel(sid, cwd) : { ok: false };
};
const cmStatus = async (_e, sid) => {
  const st = await cmCall(sid, 'status');
  // the other Mac's map is copied here, so the viewer can load it (and "Open in browser" works on this Mac)
  if (st && st.ok && st.html && peerSess(sid)) {
    const local = path.join(codemap.OUT, '_from-peer', String(st.project || sid).replace(/[^\w.-]+/g, '_').slice(-120) + '.html');
    const stamp = (st.meta && st.meta.at) || 0, have = (() => { try { return fs.statSync(local).mtimeMs >= stamp; } catch { return false; } })();
    if (!have) { const h = await cmCall(sid, 'html'); if (h && h.ok) { fs.mkdirSync(path.dirname(local), { recursive: true }); fs.writeFileSync(local, h.html); } }
    st.html = fs.existsSync(local) ? local : null; st.report = null; st.remote = peerLink.label();
  }
  if (st && st.ok) for (const f of [st.html, st.report]) if (f) cmAllowed.add(f);
  return st;
};
const cmOk = p => !!p && (cmAllowed.has(p) || p.startsWith(codemap.OUT + path.sep));
ipcMain.handle('codemap:status', cmStatus);
ipcMain.handle('codemap:show', (e, file, top) => {
  const w = BrowserWindow.fromWebContents(e.sender); if (!w || !w.cmView) return;
  const a = w.cmView; if (top > 0) a.top = Math.round(top);
  const [cw, ch] = w.getContentSize(); a.view.setBounds({ x: 0, y: a.top, width: cw, height: Math.max(0, ch - a.top) });
  if (!cmOk(file) || !/\.html$/.test(file)) { a.view.setVisible(false); return; }
  a.view.setVisible(true);
  const key = file + '|' + (() => { try { return fs.statSync(file).mtimeMs; } catch { return 0; } })();
  if (a.file !== key) { a.file = key; a.view.webContents.loadFile(file); }
});
ipcMain.handle('codemap:generate', (_e, sid) => cmCall(sid, 'generate'));
ipcMain.handle('codemap:cancel', (_e, sid) => cmCall(sid, 'cancel'));
ipcMain.handle('codemap:reveal', (_e, p) => { if (cmOk(p)) shell.showItemInFolder(p); });
ipcMain.handle('codemap:browser', (_e, p) => { if (cmOk(p)) return /\.html$/.test(p) ? shell.openExternal(require('url').pathToFileURL(p).href) : shell.openPath(p); });
// open the viewer; a project without a map, or with commits newer than its map, is (re)built right away (seconds)
ipcMain.handle('codemap:open', async (_e, sid, name) => {
  const w0 = cmWins.get(sid); if (w0 && !w0.isDestroyed()) { w0.show(); w0.focus(); return { ok: true }; }
  const st = await cmStatus(null, sid);
  if (st && st.ok === false && !st.project) return st;
  if (st && st.ok && (!st.html || st.behind > 0) && !st.running && !st.queued) await cmCall(sid, 'generate');
  const w = new BrowserWindow({ width: 1280, height: 860, title: 'Code map · ' + (name || ''), backgroundColor: '#0b0d14',
    webPreferences: { preload: path.join(__dirname, 'codemap-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  cmWins.set(sid, w); w.on('closed', () => cmWins.delete(sid));
  w.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  // the graph itself: its own view below the header, no preload and its own session, so its scripts (third-party,
  // generated) can use storage and load their library normally but can't reach Mesh. The header page says what to show.
  const { WebContentsView } = require('electron');
  const view = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'codemap' } });
  view.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  view.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  view.setVisible(false); w.contentView.addChildView(view); w.cmView = { view, top: 64, file: null };
  const lay = () => { if (w.isDestroyed()) return; const [cw, ch] = w.getContentSize(); view.setBounds({ x: 0, y: w.cmView.top, width: cw, height: Math.max(0, ch - w.cmView.top) }); };
  w.on('resize', lay); lay();
  w.loadFile(path.join(__dirname, 'renderer', 'codemap.html'), { query: { sid, name: name || '' } });
  return { ok: true };
});
ipcMain.handle('folder:open', (_e, p) => projFolders.safe(p) ? shell.openPath(p).then(err => ({ ok: !err, err })) : { ok: false, err: 'not a folder in your home folder' });
let mcpSources = new Map(), mcpPicked = null;
// which app owns each window (window names alone don't say: a Chrome window's name is just its page title).
// CGWindowListCopyWindowInfo through JavaScript for Automation; owner names need no permission.
function windowOwners() {
  return new Promise(res => {
    const js = "ObjC.import('CoreGraphics');var a=ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly|$.kCGWindowListExcludeDesktopElements,0));var o={};for(var i=0;i<a.count;i++){var w=a.objectAtIndex(i);o[ObjC.unwrap(w.objectForKey('kCGWindowNumber'))]=ObjC.unwrap(w.objectForKey('kCGWindowOwnerName'));}JSON.stringify(o)";
    require('child_process').execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', js], { timeout: 4000 }, (err, out) => { try { res(err ? {} : JSON.parse(out)); } catch { res({}); } });
  });
}
ipcMain.handle('mcp:sources', async (_e, ask) => {
  const status = process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'granted';
  if (status !== 'granted' && !ask) return { status, sources: [] };
  try {
    const [srcs, owners] = await Promise.all([desktopCapturer.getSources({ types: ['window', 'screen'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false }), windowOwners()]);
    mcpSources = new Map(srcs.map(s => [s.id, s]));
    return { status: process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'granted',
      sources: srcs.map(s => { const n = (/^window:(\d+):/.exec(s.id) || [])[1]; return { id: s.id, name: s.name, owner: s.id.startsWith('screen:') ? 'Screen' : (owners[n] || '') }; }) };
  } catch (e) { return { status, sources: [], err: String(e.message || e) }; }
});
ipcMain.handle('mcp:pick', (_e, id) => { mcpPicked = mcpSources.get(String(id)) || null; return !!mcpPicked; });
ipcMain.handle('mcp:screenSettings', () => shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'));
app.whenReady().then(() => {
  // getDisplayMedia() in the window gets exactly the window the MCP panel picked — never a system picker
  session.defaultSession.setDisplayMediaRequestHandler((_req, cb) => { const s = mcpPicked; mcpPicked = null; s ? cb({ video: s }) : cb({}); });
});

// ---------------- first launch: install what Mesh needs if it's missing (Claude Code; on Windows also Git + VC++) ----------------
// Same scripts the installers run (installer/bootstrap*.{ps1,sh}, official sources only). Asked once per missing set.
const SETUP_DIR = app.isPackaged ? path.join(process.resourcesPath, 'installer') : path.join(__dirname, 'installer');
function setupCheck() {
  return new Promise(res => {
    const done = (err, so) => res(String(so || '').trim().split(/\r?\n/).pop() || (err ? 'error' : 'ok'));
    if (IS_WIN) execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(SETUP_DIR, 'bootstrap.ps1'), '-CheckOnly'], { timeout: 30000, windowsHide: true }, done);
    else if (process.platform === 'darwin') execFile('/bin/bash', [path.join(SETUP_DIR, 'bootstrap-mac.sh'), '--check'], { timeout: 30000 }, done);
    else res('ok');
  });
}
function runSetup() {
  if (IS_WIN) {
    const ps = `$env:APP_NAME = '${APP_NAME.replace(/'/g, "''")}'; & '${path.join(SETUP_DIR, 'bootstrap.ps1').replace(/'/g, "''")}'; Read-Host '  Press Enter to close this window'`;
    // detached on Windows = its own new console window, so the user sees each step
    require('child_process').spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], { detached: true, stdio: 'ignore' }).unref();
  } else {
    osa(['tell application "Terminal"', `do script ${asStr("APP_NAME='" + APP_NAME.replace(/'/g, "'\\''") + "' bash '" + path.join(SETUP_DIR, 'bootstrap-mac.sh').replace(/'/g, "'\\''") + "'")}`, 'activate', 'end tell']);
  }
}
app.whenReady().then(async () => {
  if (process.env.MESH_SKIP_SETUP) return;
  const r = await setupCheck();
  if (!/^missing:/.test(r)) return;
  const names = { claude: 'Claude Code (official installer from claude.ai)', git: 'Git for Windows (git-scm.com)', vc: 'Microsoft Visual C++ runtime' };
  const list = r.slice(8).split(',').map(x => '• ' + (names[x.trim()] || x.trim())).join('\n');
  const skipF = path.join(app.getPath('userData'), 'setup-skipped.txt');
  try { if (fs.readFileSync(skipF, 'utf8') === r) return; } catch { }
  const box = o => win ? dialog.showMessageBox(win, o) : dialog.showMessageBox(o);
  const { response } = await box({
    type: 'info', title: APP_NAME, message: APP_NAME + ' needs a few programs',
    detail: `These will be downloaded from their official sources and installed. You can watch the install in a new window.\n\n${list}\n\nWhen it's done, open ${APP_NAME} again.`,
    buttons: ['Install now', 'Later'], defaultId: 0, cancelId: 1,
  });
  if (response === 0) runSetup(); else try { fs.writeFileSync(skipF, r); } catch { }
});
ipcMain.handle('ui:hidden', () => uiHidden);
ipcMain.handle('vnc:open', (_e, host) => /^[\w.-]+$/.test(String(host || '')) ? shell.openExternal('vnc://' + host) : false);
ipcMain.handle('home', () => HOME);

// ---------------- shared with the server program (core.js): commands, history, details, agents, usage ----------------
// Plan usage: the same request Claude Code's /usage makes, with the login Claude Code keeps in the keychain.
// The token is read per request and never stored or logged.
function keychainToken() {
  if (process.platform !== 'darwin') return Promise.resolve(linuxToken());   // Windows/Linux Claude Code keeps it in ~/.claude/.credentials.json
  return new Promise(res => execFile('/usr/bin/security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], { timeout: 10000 }, (err, so) => {
    try { res(err ? null : JSON.parse(so).claudeAiOauth.accessToken); } catch { res(null); }
  }));
}
const core = createCore({ userData: app.getPath('userData'), getToken: keychainToken });
const { commandsFor, sessionDetails, renameTranscript, convertToAgent, refreshAgents, refreshUsage } = core;
// Hermes conversations live in ~/.hermes/state.db, not in ~/.claude/projects: list the interactive ones too, so a
// Hermes session that was closed (/exit) can be found and reopened from "All sessions" (resume → spawnHermes).
// A conversation Hermes moved into a child session when it compacted is listed once, as its newest part.
async function hermesHistory() {
  if (!fs.existsSync(path.join(process.env.HERMES_HOME || path.join(HOME, '.hermes'), 'state.db'))) return [];
  const rows = await require('./hermes-sessions').sql(`select id,title,cwd,started_at,last_activity_at,message_count from sessions s
    where source in ('local','cli') and message_count>0 and not exists (select 1 from sessions c where c.parent_session_id=s.id)`) || [];
  return rows.map(r => ({ sid: r.id, file: null, kind: 'hermes', entry: 'hermes', mtime: Math.round((r.last_activity_at || r.started_at) * 1000), size: 0,
    msgs: r.message_count, cwd: r.cwd || HOME, title: r.title || 'Hermes', aiTitle: '', first: '', last: '', branch: '' }));
}
const scanHistory = async () => {
  const [claude, herm] = await Promise.all([core.listHistory(), hermesHistory().catch(() => [])]);
  return [...claude, ...herm].sort((a, b) => b.mtime - a.mtime);
};
ipcMain.handle('cmds:list', (_e, cwd) => commandsFor(cwd));
ipcMain.handle('probe:match', (_e, ask, sessions) => core.probeMatch(ask, sessions));   // the probe's "find me …" (probe.js)
// the Endurance's hangar (renderer/hangar.js): every skill / slash command / connector Claude Code can use here.
// Skills: ~/.claude/skills/*/SKILL.md, plugin skills (~/.claude/plugins/cache/<market>/<plugin>/<ver>/skills/*), commands
// (~/.claude/commands/*.md). Connectors: `claude mcp list` (MCP servers + claude.ai connectors), cached 10 min.
let hangarMcp = { at: 0, list: [] };
const frontMatter = f => {                                  // name / description, incl. folded (>-, |) multi-line values
  try {
    const t = fs.readFileSync(f, 'utf8').slice(0, 6000), m = t.match(/^---\r?\n([\s\S]*?)\r?\n---/); if (!m) return {};
    const L = m[1].split(/\r?\n/), o = {};
    for (let i = 0; i < L.length; i++) {
      const k = L[i].match(/^(name|description):\s*(.*)$/); if (!k) continue;
      let v = k[2].trim();
      if (/^[>|][-+]?$/.test(v) || v === '') { const parts = []; while (i + 1 < L.length && /^\s+\S/.test(L[i + 1])) parts.push(L[++i].trim()); v = parts.join(' '); }
      o[k[1]] = v.replace(/^["']|["']$/g, '');
    }
    return o;
  } catch { return {}; }
};
ipcMain.handle('hangar:list', async () => {
  const H = os.homedir(), skills = [], seen = new Set();
  const add = (name, desc, src, file, plugin) => { if (!name || seen.has(name)) return; seen.add(name); let lines = 0, mtime = 0; try { const st = fs.statSync(file); mtime = st.mtimeMs; lines = fs.readFileSync(file, 'utf8').split('\n').length; } catch { } skills.push({ name, desc: String(desc || '').slice(0, 400), src, lines, mtime, file, plugin }); };
  const dirs = d => { try { return fs.readdirSync(d, { withFileTypes: true }).filter(e => e.isDirectory() || e.isSymbolicLink()).map(e => e.name); } catch { return []; } };
  for (const n of dirs(path.join(H, '.claude', 'skills'))) { const fm = frontMatter(path.join(H, '.claude', 'skills', n, 'SKILL.md')); if (fm.name || fs.existsSync(path.join(H, '.claude', 'skills', n, 'SKILL.md'))) add(fm.name || n, fm.description, 'skill', path.join(H, '.claude', 'skills', n, 'SKILL.md')); }
  try { for (const f of fs.readdirSync(path.join(H, '.claude', 'commands'))) if (f.endsWith('.md')) { const fm = frontMatter(path.join(H, '.claude', 'commands', f)); add(f.slice(0, -3), fm.description, 'command', path.join(H, '.claude', 'commands', f)); } } catch { }
  const cache = path.join(H, '.claude', 'plugins', 'cache');
  for (const mk of dirs(cache)) for (const pl of dirs(path.join(cache, mk))) {
    const vers = dirs(path.join(cache, mk, pl)).sort(); const v = vers[vers.length - 1]; if (!v) continue;
    for (const sk of dirs(path.join(cache, mk, pl, v, 'skills'))) { const fm = frontMatter(path.join(cache, mk, pl, v, 'skills', sk, 'SKILL.md')); add(`${pl}:${fm.name || sk}`, fm.description, 'plugin', path.join(cache, mk, pl, v, 'skills', sk, 'SKILL.md'), `${pl}@${mk}`); }
  }
  skills.sort((a, b) => a.name.localeCompare(b.name));
  if (Date.now() - hangarMcp.at > 600000 || hangarMcp.stale) {
    hangarMcp.stale = false;
    hangarMcp.at = Date.now();
    hangarMcp.p = new Promise(res => execFile('/bin/zsh', ['-lc', 'claude mcp list'], { timeout: 60000, maxBuffer: 1 << 20 }, (err, out) => {
      const list = [];
      for (const l of String(out || '').split('\n')) { const m = l.match(/^(.+?):\s.*\s-\s(✔|✗|⚠|!)\s*(.*)$/); if (m) list.push({ name: m[1].trim(), ok: m[2] === '✔', status: m[3].trim() }); }
      hangarMcp.err = err ? String(err.killed ? 'timed out' : err.message).split('\n')[0].slice(0, 160) : null;
      if (list.length) hangarMcp.list = list; if (err || !list.length) hangarMcp.at = 0; res();
    }));
  }
  if (!hangarMcp.list.length && hangarMcp.p) await hangarMcp.p;
  return { skills, connectors: hangarMcp.list, connectorsErr: hangarMcp.err || null };
});
// remove / undo / discover / install for the hangar (hangar-main.js)
require('./hangar-main')({ ipcMain, shell, frontMatterText: t => { const p = path.join(os.tmpdir(), 'mesh-fm-' + process.pid + '.md'); fs.writeFileSync(p, t); const o = frontMatter(p); try { fs.unlinkSync(p); } catch { } return o; }, mcpStale: () => { hangarMcp.stale = true; } });
// adopt a session Mesh can't reach (2026-11-01: e.g. one inside an orphaned tmux server, or a Terminal tab that's
// gone): stop it (SIGTERM, SIGKILL after 10 s — Claude Code saves as it goes) and resume it in an in-app terminal.
// Only a Claude process whose ~/.claude/sessions/<pid>.json says it IS that session.
ipcMain.handle('session:adopt', async (_e, { pid, sid, cwd, name }) => {
  pid = +pid; sid = String(sid || '');
  let own = false; try { own = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'sessions', pid + '.json'), 'utf8')).sessionId === sid; } catch { }
  if (!own || !/^[0-9a-f-]{36}$/.test(sid)) return { ok: false, err: 'not that session' };
  const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
  try { process.kill(pid, 'SIGTERM'); } catch { }
  for (let i = 0; i < 50 && alive(); i++) await new Promise(r => setTimeout(r, 200));
  if (alive()) { try { process.kill(pid, 'SIGKILL'); } catch { } await new Promise(r => setTimeout(r, 500)); }
  if (!win) return { ok: false, err: 'no window' };
  win.webContents.send('handoff:start', { sid, cwd: cwd || os.homedir(), name: String(name || '') });
  return { ok: true };
});
// screen lock → Simple mode (2026-10-29, Kevin: he works the mini from his phone over Screen Sharing when it's locked):
// lock → the renderer turns Simple on (if it wasn't); unlock → it turns it back off, unless a Screen Sharing / VNC client
// is connected (screensharingd running) — then it stays Simple until that client disconnects (checked every 20 s)
// (macOS hides root's sockets from netstat / lsof here, but screensharingd only runs while a viewer is connected)
const vncConnected = () => new Promise(res => execFile('/usr/bin/pgrep', ['-x', 'screensharingd'], { timeout: 5000 }, e => res(!e)));
let lockWatch = null;
app.whenReady().then(() => {
  const send = (k, v) => win && !win.isDestroyed() && win.webContents.send('screen:lock', { [k]: v });
  powerMonitor.on('lock-screen', () => { clearInterval(lockWatch); lockWatch = null; send('locked', true); });
  powerMonitor.on('unlock-screen', async () => {
    clearInterval(lockWatch); lockWatch = null;
    if (!(await vncConnected())) return send('locked', false);
    send('remote', true);                                                      // unlocked from a Screen Sharing client: stay Simple
    lockWatch = setInterval(async () => { if (!(await vncConnected())) { clearInterval(lockWatch); lockWatch = null; send('locked', false); } }, 20000);
  });
});
ipcMain.handle('sys:idle', () => { try { return powerMonitor.getSystemIdleTime(); } catch { return 0; } });   // seconds since any input on this Mac (the screen saver, cine.js)
// the history list shows both machines: our transcripts, plus the peer's that haven't been synced here yet
// (tagged with its name; resuming one starts it over there, where its transcript is)
let peerHist = [];
// an old copy of a session that was handed off twice (All sessions keeps the current one + one "replaced"): its transcript
// goes to the Trash. Only a transcript of this machine, never a running session.
const TRASH_MIN_AGE = 7 * 864e5;
function trashBlocker(sid, f) {
  const ud = app.getPath('userData'), read = n => { try { return fs.readFileSync(path.join(ud, n), 'utf8'); } catch { return ''; } };
  try { if (Date.now() - fs.statSync(f).mtimeMs < TRASH_MIN_AGE) return 'active in the last 7 days'; } catch { return 'no transcript'; }
  try { if (require('child_process').execFileSync('/bin/ps', ['-axww', '-o', 'command'], { encoding: 'utf8', timeout: 5000 }).includes(sid)) return 'running'; }
  catch { return 'could not check running sessions'; }
  if (read('last-sessions.json').includes(sid) || read('running.json').includes(sid)) return 'in the restore list';
  if (read('trash-keep.json').includes(sid)) return 'on the keep list';
  return null;
}
ipcMain.handle('hist:trash', async (_e, sid) => {
  if (((lastSnap && lastSnap.sessions) || []).some(s => s.sid === sid)) return { ok: false, err: 'running' };
  const f = core.findTranscript(sid), root = path.join(HOME, '.claude', 'projects') + path.sep;
  if (!f || !f.startsWith(root) || !f.endsWith('.jsonl')) return { ok: false, err: 'no transcript' };
  // Rule (2026-11-10): the cleanup only moves a transcript that is older than 7 days AND whose session is confirmed ended.
  // The snapshot alone missed live sessions (a resumed session shows under another id), so running sessions' transcripts
  // were trashed. Refused when: written in the last 7 days (also covers a copy the other Mac is still writing), named by
  // any running process (claude --resume <id>), in Mesh's restore list, or on the keep list (trash-keep.json).
  const why = trashBlocker(sid, f); if (why) return { ok: false, err: why };
  try {
    await shell.trashItem(f);
    const dir = f.slice(0, -6); if (fs.existsSync(dir)) await shell.trashItem(dir).catch(() => { });   // its sub-agent transcripts
    fs.appendFileSync(path.join(app.getPath('userData'), 'trashed-sessions.jsonl'), JSON.stringify({ at: new Date().toISOString(), sid, file: f }) + '\n');
    return { ok: true };
  } catch (e) { return { ok: false, err: e.message }; }
});
ipcMain.handle('hist:list', async () => {
  const local = await scanHistory();
  if (!peerLink || !peerLink.online()) return local;
  const got = await peerLink.forward('GET', '/api/history').catch(() => null);
  if (Array.isArray(got)) peerHist = got;                                    // one failed call doesn't drop its rows from the list
  const theirs = peerHist;
  const mine = new Set(local.map(h => h.sid)), label = peerLink.label();
  const extra = theirs.filter(h => h && h.sid && !mine.has(h.sid)).map(h => ({ ...h, file: null, onPeer: true, hostLabel: label }));
  return [...local, ...extra].sort((a, b) => b.mtime - a.mtime);
});
ipcMain.handle('peer:resume', (_e, sid, opts) => peerLink ? peerLink.forward('POST', '/api/resume', { sid, ...(opts || {}) }).catch(e => ({ ok: false, err: String(e.message || e) })) : { ok: false, err: 'no peer' });
ipcMain.handle('hist:rename', async (_e, sid, name) => {
  const s = liveSession(sid);
  if (s && s.kind === 'hermes' && s.hermesPane) return hermesSend(s.hermesPane, '/title ' + String(name || '').replace(/[\r\n]/g, ' ').slice(0, 120));   // Hermes keeps the title in its own state.db
  return renameTranscript(sid, name);
});
ipcMain.handle('sess:details', (_e, sid) => !liveSession(sid) && peerLink && peerLink.owns(sid)
  ? peerLink.forward('GET', '/api/details', undefined, { sid }).catch(e => ({ ok: false, err: String(e.message || e) })) : sessionDetails(sid));
// a session running on the peer machine: send / interrupt go through its phone server
// files pasted or dropped into a mirror of the peer's terminal: copy them over, hand back the peer's paths
// (a path on this machine means nothing to a session running on the other one). Folders/huge files keep their path.
ipcMain.handle('peer:upload', async (_e, paths) => {
  const out = []; let err = null;
  for (const f of paths || []) {
    try {
      const st = fs.statSync(f);
      if (!peerLink || !st.isFile() || st.size > 25e6) { out.push(f); continue; }
      const r = await peerLink.upload(path.basename(f), fs.readFileSync(f).toString('base64'));
      if (r && r.path) out.push(r.path); else { err = 'not supported there — update/restart ' + APP_NAME + ' on ' + peerLink.label(); break; }
    } catch (e) { err = String(e.message || e); break; }
  }
  return err ? { err } : { paths: out };
});
ipcMain.handle('peer:send', (_e, sid, text) => peerLink ? peerLink.forward('POST', '/api/send', { sid, text }).catch(e => ({ ok: false, err: String(e.message || e) })) : { ok: false, err: 'no peer' });
ipcMain.handle('peer:interrupt', (_e, sid) => peerLink ? peerLink.forward('POST', '/api/interrupt', { sid }).catch(e => ({ ok: false, err: String(e.message || e) })) : { ok: false, err: 'no peer' });
// stop a running session (one outside the app — in-app terminals are closed by the renderer)
ipcMain.handle('session:stop', async (_e, pid) => {
  pid = +pid; if (!pid || pid === process.pid) return { ok: false, err: 'bad pid' };
  if (!(lastSnap && lastSnap.sessions.some(s => s.pid === pid))) return { ok: false, err: 'not a session on this machine' };   // never a peer's pid
  try { process.kill(pid, 'SIGTERM'); } catch (e) { return { ok: e.code === 'ESRCH', err: e.message }; }
  for (let i = 0; i < 30; i++) { await new Promise(r => setTimeout(r, 100)); try { process.kill(pid, 0); } catch { return { ok: true }; } }
  try { process.kill(pid, 'SIGKILL'); } catch { } return { ok: true };
});

// ---------------- optional add-ons for this machine (local/, gitignored) ----------------
// A team can drop extra main-process features into local/main.js (e.g. a scheduled-jobs view of its own servers);
// it gets { ipcMain, app, execFile, fs, path, HOME } and may return { features: { … } }. Nothing here when absent.
let localAddon = null;
try { localAddon = require('./local/main.js')({ ipcMain, app, execFile, fs, path, HOME }); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') console.warn('[local add-on]', e.message); }
if (localAddon && localAddon.features) Object.assign(FEATURES, localAddon.features);

// ---------------- background agents (`claude agents`, `claude --bg`) — core.js ----------------
ipcMain.handle('agent:convert', (_e, sid, cwd, task) => convertToAgent(sid, cwd, task));
ipcMain.handle('agent:stop', async (_e, id) => { const r = await core.claudeCli(['stop', id]); refreshAgents(true); return r; });
ipcMain.handle('agent:logs', (_e, id) => core.claudeCli(['logs', id]));
ipcMain.handle('agents:list', () => refreshAgents(true));

if (process.env.MESH_DEBUG) ipcMain.handle('debug:shot', async (_e, f) => { const img = await win.webContents.capturePage(); fs.writeFileSync(f, img.toPNG()); return true; });

// ---------------- clipboard: files copied in Finder, images (screenshots), text ----------------
const PASTE_DIR = path.join(os.tmpdir(), 'claude-mesh-paste');
const unxml = v => v.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
// Electron 44 clipboard is async (W3C-style ClipboardItem). Finder copies expose
// NSFilenamesPboardType (all files) and text/uri-list; screenshots expose image/png.
ipcMain.on('clip:write', (_e, text) => { if (typeof text === 'string' && text.length <= 5e6) clipboard.writeText(text); });
ipcMain.handle('clip:read', async () => {
  let items = [];
  try { items = await clipboard.read(); } catch { }
  for (const it of items) {
    const t = it.types;
    const fnames = t.find(x => x.includes('NSFilenamesPboardType'));
    if (fnames) {
      const xml = await (await it.getType(fnames)).text();
      const paths = [...xml.matchAll(/<string>([^<]+)<\/string>/g)].map(m => unxml(m[1]));
      if (paths.length) return { kind: 'files', paths };
    }
    if (t.includes('text/uri-list')) {
      const list = (await (await it.getType('text/uri-list')).text()).split(/\r?\n/).filter(u => u.startsWith('file://'));
      if (list.length) return { kind: 'files', paths: list.map(u => decodeURIComponent(new URL(u).pathname)) };
    }
    // copied text often carries a rendered picture of itself too (Sheets, Slides, Chat, Notes): text wins,
    // only a clipboard with no text (screenshots, "Copy Image") pastes as an image
    if (t.includes('text/plain') && (await (await it.getType('text/plain')).text()).trim()) break;
    const imgType = t.find(x => /^image\/(png|jpeg|gif|webp|tiff)$/.test(x));
    if (imgType) {
      const buf = Buffer.from(await (await it.getType(imgType)).arrayBuffer());
      fs.mkdirSync(PASTE_DIR, { recursive: true });
      const f = path.join(PASTE_DIR, `pasted-${new Date().toISOString().replace(/[:.]/g, '-')}.${imgType.split('/')[1].replace('jpeg', 'jpg')}`);
      fs.writeFileSync(f, buf);
      return { kind: 'files', paths: [f], image: true };
    }
  }
  let text = ''; try { text = await clipboard.readText(); } catch { }
  return { kind: 'text', text };
});

// ---------------- plan usage limits (what /usage shows) — core.js ----------------
ipcMain.handle('usage:refresh', () => refreshUsage(true));

// ---------------- phone access (phone-server.js) ----------------
let peerLink = null, handoff = null, switches = null;
// the session panel / right-click menu: "Move to <other Mac>" — run here if it runs here, else by the other Mac
ipcMain.handle('handoff:move', async (_e, sid) => {
  if (!handoff) return { ok: false, err: 'not ready' };
  const local = lastSnap && lastSnap.sessions.find(s => s.sid === sid && !s.onPeer);
  if (!local && peerLink.owns(sid)) return peerLink.forward('POST', '/api/handoff/move', { sid }, undefined, 15 * 60e3).catch(e => ({ ok: false, err: e.message }));
  return handoff.move(sid);
});
function initPhone() {
  peerLink = createPeer({ userData: app.getPath('userData'), selfKind: 'mac' }); peerLink.start();
  switches = require('./switches').createSwitches({ peer: () => peerLink, machine: USAGE_MACHINE });   // mode switches (switches.js)
  if (!process.env.MESH_QA) folderMirror.createMirror({ machine: USAGE_MACHINE, peer: () => peerLink, folders: localFolders, enabled: !!require('./mesh-name').folderMirror }).start();
  // moving a session to the other Mac (handoff.js): this side stops / sends, the other side receives / starts it in-app
  handoff = createHandoff({
    peer: peerLink, liveSession: sid => (lastSnap && lastSnap.sessions.find(s => s.sid === sid && !s.onPeer)) || null,
    findTranscript: sid => core.findTranscript(sid), histEntry: sid => core.histEntry(sid), ptys,
    startHere: (sid, cwd, name) => win && win.webContents.send('handoff:start', { sid, cwd, name }),
    progress: p => win && win.webContents.send('handoff:progress', p),
  });
  phone = createPhoneServer({
    root: __dirname, userData: app.getPath('userData'), ptys: { get: id => ptys.get(id) || panes.proc(id) }, ptyBus, peer: peerLink, termSnapshot, termResize,
    termOpen: id => panes.has(id) ? panes.open(id) : null, termClose: id => { if (panes.has(id)) panes.close(id); },
    getSnap: () => lastSnap,
    getHistory: () => scanHistory(),
    codemap: { status: sid => cmCall(sid, 'status'), html: sid => cmCall(sid, 'html'), op: (sid, op) => ['generate', 'cancel'].includes(op) ? cmCall(sid, op) : { ok: false } },
    details: sid => sessionDetails(sid),
    stamps: sid => stampsFor(core.findTranscript(sid)),
    usage: usageBoard,
    folders: () => { const o = {}; for (const [sid, f] of Object.entries(localFolders())) { const r = folderMirror.relOf(f.path); if (r) o[sid] = r; } return o; },
    folderHere: rel => folderMirror.here(rel),
    cards: { summary: () => cards.summary(localSessions()), get: (sid, force) => { const s = localSessions().find(x => x.sid === sid); return s ? cards.card(s, { force: !!force, waitMs: 1500 }).then(c => c && { ...c, refreshed: refresher && refresher.lastFor(s.name) }) : null; }, ask: sid => sendToSession(sid, CARD_ASK) },   // times beside prompts/replies in the phone terminal
    commandsFor,
    sendToSession, interruptSession,
    logEngine, noteInput: () => updater.noteInput(), hotRoot: () => updater.hotRoot(), resumeOnMac: (sid, opts) => { if (!win) return { ok: false }; win.webContents.send('phone:resume', sid, opts); return { ok: true }; },
    handoff,
    orchestrator: { get: cwd => orchestratorFor(fromTildeP(cwd)), set: (cwd, o) => setOrchestrator(fromTildeP(cwd), o) },
    hermesNew: o => spawnHermes(o || {}),
    switches: { get: hop => switches.get(hop), set: (id, on, from, hop) => switches.set(id, on, from, hop), setInterval: (id, sec, from, hop) => switches.setInterval(id, sec, from, hop) },
    refresh: { get: () => refresher.settings(), set: p => refresher.set(p || {}), now: sid => refresher.now(sid), rehearse: sid => refresher.rehearse(sid), inventory: () => refresher.inventory(), unpark: n => refresher.unpark(n) },
    // a session moved here from the other Mac: open it in a fresh in-app terminal (not a select of its mirror)
    handoffStart: b => { if (!win) return { ok: false, err: APP_NAME + ' window is not open' }; win.webContents.send('handoff:start', { sid: String(b.sid || ''), cwd: handoff.fromTilde(String(b.cwd || '~')), name: String(b.name || '') }); return { ok: true }; },
    rename: async (sid, name) => {
      const s = liveSession(sid);
      if (s && s.kind === 'hermes') { const r = await sendToSession(sid, '/title ' + name); return r && r.ok !== false ? { ok: true } : { ok: false, err: 'Hermes session did not take the name' }; }
      if (s && (s.owner || (s.tty && s.kind !== 'bg'))) { const r = await sendToSession(sid, '/rename ' + name); if (r && r.ok !== false && r.out !== 'notfound') return { ok: true }; }
      return renameTranscript(sid, name);
    },
    convert: async (sid, task) => {
      const s = liveSession(sid), h = core.histEntry(sid);
      if (s && s.owner) { const p = ptys.get(s.owner); if (p) try { p.proc.kill(); } catch { } await new Promise(r => setTimeout(r, 1500)); }
      return convertToAgent(sid, (s && s.cwd) || (h && h.cwd) || HOME, task);
    },
  });
}
ipcMain.handle('phone:status', () => phone.status());
// when each prompt / reply in a session was made (renderer/term-stamps.js time column)
const { stampsFor } = require('./transcript-stamps');
ipcMain.handle('stamps', (_e, sid) => stampsFor(core.findTranscript(String(sid || ''))));
ipcMain.handle('phone:set', (_e, v) => { phone.setEnabled(v); return phone.status(); });
ipcMain.handle('phone:regen', () => { phone.regenerate(); return phone.status(); });
ipcMain.handle('phone:qr', (_e, url) => require('qrcode').toDataURL(url, { margin: 1, width: 360, color: { dark: '#0a0826', light: '#ffffff' } }));

// ---------------- reopen last sessions ----------------
// While running, the in-app Claude sessions are recorded to userData/last-sessions.json. On the next
// launch the window asks whether to reopen them; recording resumes only after that answer, so a fresh
// (empty) app never overwrites the list before you've been asked.
const LAST_FILE = () => path.join(app.getPath('userData'), 'last-sessions.json');
// seamless updates: see updater.js
const updater = require('./updater').createUpdater({ app, powerMonitor, getWin: () => win, userData: app.getPath('userData'),
  sessions: () => (lastSnap && lastSnap.sessions) || [], inAppBusy: () => ((lastSnap && lastSnap.sessions) || []).some(s => s.owner && ptys.has(s.owner) && s.health === 'working') || !!(refresher && refresher.running()),   // never in the middle of a session refresh
  beforeQuit: () => { quitting = true; }, log: m => { try { fs.appendFileSync(path.join(app.getPath('userData'), 'update.log'), `${new Date().toISOString()} ${m}\n`); } catch { } } });
ipcMain.on('update:saved', (_e, state, terms) => { for (const t of terms || []) { const p = ptys.get(t.id); if (p) p.hold = p.hold || []; } updater.saved(state, terms); });
ipcMain.handle('update:handoff', () => updater.handoff());
ipcMain.on('update:ready', () => updater.ready());
ipcMain.on('update:rollback', () => updater.rollback());
ipcMain.handle('update:info', () => updater.info());
ipcMain.handle('pty:adopted', (_e, id) => { const p = ptys.get(id); if (p && p.hold) { for (const [d, s] of p.hold) win && win.webContents.send('pty:data', id, d, s); p.hold = null; } });
let restorePending = null, restoreAnswered = false, quitting = false, lastSaved = '';
function readLastSessions() { try { const d = JSON.parse(fs.readFileSync(LAST_FILE(), 'utf8')); return Array.isArray(d.sessions) ? d : null; } catch { return null; } }
function recordSessions(snap) {
  if (quitting || !restoreAnswered) return;
  // (tmux sessions too: they outlive the app, but not a reboot)
  const meshPanes = new Set(panes.list().filter(p => p.title.startsWith(TMUX_SESSION + ':')).map(p => p.id));
  const list = snap.sessions.filter(s => (s.owner || meshPanes.has(s.pane)) && !s.headless).map(s => ({ sid: s.sid, cwd: s.cwd, name: s.name, model: s.model || '', ...(s.kind === 'hermes' ? { kind: 'hermes' } : {}) }));
  const shells = [...ptys.values()].filter(p => p.kind !== 'claude').map(p => ({ cwd: p.cwd, title: p.title }));
  const key = JSON.stringify([list, shells]); if (key === lastSaved) return; lastSaved = key;
  try { fs.writeFileSync(LAST_FILE(), JSON.stringify({ at: Date.now(), sessions: list, shells })); } catch { }
}
// 2026-10-28: by default the sessions are reopened without asking (Window ▸ Reopen last sessions without asking);
// untick it and the launch asks first, as it used to
// (once per launch: a window reload must not reopen sessions from the list read at startup)
ipcMain.handle('restore:get', () => { if (restoreAnswered) return { sessions: [], auto: true }; if (restorePending === null) restorePending = readLastSessions() || { sessions: [] }; return { ...restorePending, auto: !uiHidden.askRestore }; });
ipcMain.handle('restore:done', () => { restoreAnswered = true; return true; });
app.on('before-quit', () => { quitting = true; panes.stopAll(); try { updater.quitting(); } catch { } });

// ---------------- this machine's memory (what Activity Monitor calls "Memory Used") ----------------
// app memory (anonymous − purgeable) + wired + compressed, from vm_stat; pressure 1 normal / 2 warning / 4 critical
let hostMem = null;
let loopSig = '', loopBusyAt = 0;
function readMem() {
  if (process.platform !== 'darwin') { const free = os.freemem(), total = os.totalmem(); hostMem = { used: total - free, total, pressure: free / total < 0.08 ? 4 : free / total < 0.15 ? 2 : 1 }; return; }
  require('child_process').execFile('/usr/bin/vm_stat', (err, out) => {
    if (err) return;
    const ps = +(out.match(/page size of (\d+)/) || [, 16384])[1];
    const pg = k => +((out.match(new RegExp(k + ':\\s+(\\d+)')) || [, 0])[1]);
    const used = (pg('Anonymous pages') - pg('Pages purgeable') + pg('Pages wired down') + pg('Pages occupied by compressor')) * ps;
    require('child_process').execFile('/usr/sbin/sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'], (e2, lv) => {
      hostMem = { used, total: os.totalmem(), pressure: +String(lv || '1').trim() || 1 };
    });
  });
}
readMem(); setInterval(readMem, 5000);

// ---------------- telemetry loop ----------------
async function loop() {
  try {
    await collector.tick();
    if (win) {
      const ptyMap = new Map([...ptys].map(([id, p]) => [id, p.proc.pid]));
      const snap = collector.snapshot(ptyMap);
      snap.agents = core.agents(); refreshAgents();
      snap.usage = core.usage(); refreshUsage();
      snap.mem = hostMem; snap.build = BUILD; snap.usageSum = usageBoard.summary(); snap.machine = USAGE_MACHINE;
      snap.ptys = [...ptys].map(([id, p]) => ({ id, pid: p.proc.pid, title: p.title, kind: p.kind, cwd: p.cwd }));
      panes.refresh();
      const byTty = new Map(panes.list().map(p => [p.tty, p]));
      for (const s of snap.sessions) {
        const p = !s.owner && s.tty && byTty.get(s.tty); if (!p) continue;
        s.pane = p.id;
        snap.ptys.push({ id: p.id, pid: p.pid, title: s.name, kind: 'tmux', cwd: s.cwd });
      }
      // panes we started that have no session yet (a new Claude still at its "trust this folder?" question has none):
      // without this the window dropped the new tab at the next update, and the session sat there unseen (2026-11-10)
      for (const p of panes.list()) if (p.title.startsWith(TMUX_SESSION + ':') && !snap.ptys.some(x => x.id === p.id))
        snap.ptys.push({ id: p.id, pid: p.pid, title: p.title.slice(TMUX_SESSION.length + 1) || 'session', kind: 'tmux', cwd: null });
      if (refresher) refresher.decorate(snap);
      paintSessions(snap.sessions); groupSessions(snap); linkSubSessions(snap);
      // the window shows BOTH machines (the peer's sessions and terminals merged in); phone + peer keep the local snap
      const shown = peerLink ? peerLink.merge(snap) : snap;
      if (shown !== snap) { paintSessions(shown.sessions); groupSessions(shown); }   // includes the peer's terminals (peer:… ids, onPeer)
      win.webContents.send('telemetry', shown);
      lastSnap = snap; watchEngines(snap); if (phone) phone.broadcast(snap); recordSessions(snap);
      const sig = snap.sessions.map(s => s.sid + s.health).join();
      if (sig !== loopSig || snap.sessions.some(s => s.health === 'working')) { loopSig = sig; loopBusyAt = Date.now(); }
    }
  } catch (e) { console.error(e); }
  setTimeout(loop, Date.now() - loopBusyAt > 20000 ? 4000 : 1000);   // every second while anything happens, every 4 when nothing has for 20 s
}

// ---------------- session refresh (session-refresh.js) ----------------
let refresher = null;
function alertOwner(title, step) {
  try { new Notification({ title, body: step, silent: false }).show(); } catch { }
  const c = (require('./mesh-name').usageAlert || {}).cmd;           // the team's alert command (mesh.local.json), e.g. a chat/phone notifier
  if (Array.isArray(c) && !process.env.MESH_QA) { const a = c.map(x => String(x).replace(/^~(?=\/)/, HOME).replace('{title}', title).replace('{body}', step)); require('child_process').execFile(a[0], a.slice(1), { timeout: 30000 }, () => { }); }
}
function initRefresh() {
  refresher = require('./session-refresh').createRefresh({
    userData: app.getPath('userData'), getSnap: () => lastSnap, panes, hermes, spawnHermes, sendToSession, loginShell, hermesDraft,
    tmux: args => { try { return execFileSync(TMUX, args, { timeout: 8000, env: TMUX_ENV }).toString(); } catch { return null; } },
    findTranscript: sid => core.findTranscript(sid), sql: require('./hermes-sessions').sql, quietFor: () => updater.quietFor(), alert: alertOwner,
    claudeBin: () => core.resolveClaude(),
    report: text => { const to = (require('./mesh-name').refreshReportTo || APP_NAME); const g = ((lastSnap && lastSnap.sessions) || []).find(x => x.name === to && !x.onPeer); if (g) sendToSession(g.sid, text); },   // results the owner asked to hear about go to the session named like the app (or refreshReportTo)
    remap: (from, to) => {                                     // colour and group follow the session; the window moves its orbit (prevSid)
      if (sessionColors[from]) { sessionColors[to] = sessionColors[from]; try { fs.writeFileSync(COLORS_FILE, JSON.stringify(sessionColors)); } catch { } }
      if (sessionGroups.members[from]) { sessionGroups.members[to] = sessionGroups.members[from]; delete sessionGroups.members[from]; saveGroups(); }
    },
  });
}
const peerSess = sid => !liveSession(sid) && peerLink && peerLink.owns(sid);
// mode switches: every flip is confirmed here first (취소 is the default); nothing is written on cancel
ipcMain.handle('sw:get', async () => switches ? switches.get() : []);
ipcMain.handle('sw:interval', async (_e, id, sec) => switches ? switches.setInterval(id, sec, USAGE_MACHINE) : { ok: false, err: 'not ready' });   // no popup: it only changes how often
ipcMain.handle('sw:set', async (_e, id, on) => {
  if (!switches) return { ok: false, err: 'not ready' };
  const sw = (await switches.get()).find(x => x.id === id); if (!sw) return { ok: false, err: 'no such switch' };
  const msg = on ? (sw.confirmOn || `Turn ${sw.label} on?`) : (sw.confirmOff || `Turn ${sw.label} off?`);
  const r = await dialog.showMessageBox(win, { type: on ? 'warning' : 'question', message: sw.label, detail: msg, buttons: ['취소', on ? (sw.onLabel || '켜기') : (sw.offLabel || '끄기')], defaultId: 0, cancelId: 0, noLink: true });
  if (r.response !== 1) return { ok: false, cancelled: true };
  return switches.set(id, !!on, USAGE_MACHINE);
});
ipcMain.handle('refresh:get', async (_e, onPeer) => onPeer ? (peerLink ? peerLink.forward('GET', '/api/refresh').catch(e => ({ err: e.message })) : null) : refresher.settings());
ipcMain.handle('refresh:set', async (_e, p, onPeer) => onPeer ? peerLink.forward('POST', '/api/refresh', p, undefined, p && p.unpark ? 5 * 60e3 : undefined).catch(e => ({ err: e.message })) : p && p.unpark ? refresher.unpark(String(p.unpark)) : refresher.set(p || {}));
// the token board's model picker: a session's model, from its next refresh (on the Mac it runs on)
ipcMain.handle('usage:model', async (_e, name, model) => { const here = ((lastSnap && lastSnap.sessions) || []).some(s => s.name === name && !s.onPeer);
  if (!here && peerLink && peerLink.online() && ((lastSnap && lastSnap.sessions) || []).some(s => s.name === name && s.onPeer)) return peerLink.forward('POST', '/api/refresh', { session: name, model }).catch(e => ({ err: e.message }));
  return refresher.set({ session: name, model }); });
ipcMain.handle('refresh:now', async (_e, sid) => peerSess(sid) ? peerLink.forward('POST', '/api/refresh', { now: true, sid }, undefined, 60 * 60e3).catch(e => ({ ok: false, err: e.message })) : refresher.now(sid));

app.whenReady().then(async () => {
  app.setName(APP_NAME);
  if (fsGuard) {
    let last = 0;
    notifyFsStuck = c => {                            // once per 30 min, only when a folder becomes stuck
      if (c.state !== 'stuck' || Date.now() - last < 30 * 60e3 || !Notification.isSupported()) return; last = Date.now();
      new Notification({ title: APP_NAME + ': macOS folder access is stuck', body: `${c.stuck.map(r => r.replace(HOME, '~')).join(', ')} does not answer. ${APP_NAME} skips it for now. If it lasts, restart the Mac.` }).show();
    };
    await Promise.race([fsGuard.start(), new Promise(r => setTimeout(r, 3000))]);
    if (fsGuard.stuck().length) notifyFsStuck({ state: 'stuck', stuck: fsGuard.stuck() });
  }
  initRefresh();
  createWindow();
  initPhone();
  loop();
  updater.start();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => {
  quitting = true;                                   // keep last-sessions.json as it was at quit
  for (const p of ptys.values()) try { p.proc.kill(); } catch { }
  app.quit();
});

// Debug: MESH_SHOT=/path.png captures the window after it settles.
if (process.env.MESH_EVAL) app.whenReady().then(() => setTimeout(() => win && win.webContents.executeJavaScript(process.env.MESH_EVAL).catch(e => console.log('eval err', e)), 3000));
if (process.env.MESH_SHOT) app.whenReady().then(() => setTimeout(async () => {
  if (!win) return;
  const img = await win.webContents.capturePage();
  fs.writeFileSync(process.env.MESH_SHOT, img.toPNG());
  if (process.env.MESH_SHOT_QUIT) app.quit();
}, +(process.env.MESH_SHOT_DELAY || 7000)));
