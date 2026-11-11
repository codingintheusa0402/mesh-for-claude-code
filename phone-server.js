// Phone access: a tiny HTTP server that serves the iPhone web app (phone/) and a JSON + SSE API
// backed by the same functions the desktop window uses. Off by default; enabled from the 📱 button.
// Every data/control endpoint requires the pairing token (?t=…); static code files don't.
// Reach it on the Wi-Fi IP or the Tailscale IP — it is never exposed through Tailscale Funnel.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const APP_NAME = require('./mesh-name').name;           // the app's name — one setting (mesh-name.js)

const PORT = +process.env.MESH_PHONE_PORT || 47320;   // env override: isolated test runs
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

function createPhoneServer(ctx) {
  // ctx: { root, userData, getSnap, getHistory, sendToSession, interruptSession, resumeOnMac, rename, convert,
  //        commandsFor, ptys, ptyBus, termOpen?, termClose?, bind?, peer? }
  // peer (peer.js): the other machine — its sessions are merged into what the phone sees, and calls for them
  // are forwarded there, so the Mac and the server show one mesh.
  // Mac: ptys are node-pty terminals. Server (server/mesh-server.js): ptys are tmux panes, termOpen/termClose
  // start and stop streaming a pane while a phone is watching it; bind limits the listening address.
  const cfgFile = path.join(ctx.userData, 'phone.json');
  let cfg = { enabled: false, token: '' };
  try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(cfgFile, 'utf8')) }; } catch { }
  if (!cfg.token) cfg.token = crypto.randomBytes(18).toString('base64url');
  const save = () => { try { fs.writeFileSync(cfgFile, JSON.stringify(cfg)); } catch { } };
  save();

  let server = null;
  const clients = new Set();                // SSE telemetry streams
  let peerPolledAt = 0;                     // the other machine is mirroring us → keep the snapshot fresh
  const okToken = t => typeof t === 'string' && t.length === cfg.token.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(cfg.token));

  // static files: phone/ app + the shared renderer engine + xterm
  const STATIC = {
    '/': 'phone/index.html', '/app-name.js': 'renderer/app-name.js', '/phone.js': 'phone/phone.js', '/phone.css': 'phone/phone.css', '/usage-view.js': 'renderer/usage-view.js', '/usage-view.css': 'renderer/usage-view.css', '/icon.png': 'renderer/icon.png',
    '/apple-touch-icon.png': 'build/icon-ios.png',
    '/mesh.js': 'renderer/mesh.js', '/mother.js': 'renderer/mother.js', '/bubbles.js': 'renderer/bubbles.js', '/organism.js': 'renderer/organism.js', '/portal.js': 'renderer/portal.js', '/probe.js': 'renderer/probe.js', '/probe/probe_sheet.png': 'renderer/probe/probe_sheet.png', '/blackhole.js': 'renderer/blackhole.js', '/endurance.js': 'renderer/endurance.js', '/handles.js': 'renderer/handles.js', '/probe-life.js': 'renderer/probe-life.js', '/probe-tidy.js': 'renderer/probe-tidy.js', '/probe/probe.glb': 'renderer/probe/probe.glb', '/endurance/endurance_sheet.webp': 'renderer/endurance/endurance_sheet.webp', '/endurance/endurance.json': 'renderer/endurance/endurance.json', '/endurance/endurance.glb': 'renderer/endurance/endurance.glb', '/three3d.js': 'renderer/three3d.js',
    // three.js (the 3-D Endurance + black hole): every file by name, no folder serving
    '/vendor/three/three.module.js': 'renderer/vendor/three/three.module.js', '/vendor/three/three.core.js': 'renderer/vendor/three/three.core.js', '/vendor/three/addons/loaders/GLTFLoader.js': 'renderer/vendor/three/addons/loaders/GLTFLoader.js', '/vendor/three/addons/loaders/DRACOLoader.js': 'renderer/vendor/three/addons/loaders/DRACOLoader.js', '/vendor/three/addons/utils/BufferGeometryUtils.js': 'renderer/vendor/three/addons/utils/BufferGeometryUtils.js', '/vendor/three/addons/utils/SkeletonUtils.js': 'renderer/vendor/three/addons/utils/SkeletonUtils.js', '/vendor/three/addons/libs/draco/gltf/draco_decoder.js': 'renderer/vendor/three/addons/libs/draco/gltf/draco_decoder.js', '/vendor/three/addons/libs/draco/gltf/draco_decoder.wasm': 'renderer/vendor/three/addons/libs/draco/gltf/draco_decoder.wasm', '/vendor/three/addons/libs/draco/gltf/draco_wasm_wrapper.js': 'renderer/vendor/three/addons/libs/draco/gltf/draco_wasm_wrapper.js', '/pixel.js': 'renderer/pixel.js', '/md.js': 'renderer/md.js', '/term-stamps.js': 'renderer/term-stamps.js',
    '/xterm.js': 'node_modules/@xterm/xterm/lib/xterm.js', '/xterm.css': 'node_modules/@xterm/xterm/css/xterm.css', '/addon-fit.js': 'node_modules/@xterm/addon-fit/lib/addon-fit.js',
  };

  const peer = ctx.peer || null;
  const view = s => peer && s ? peer.merge(s) : s;              // what the phone sees: local + the other machine
  const remote = sid => !!(peer && sid && peer.owns(sid));
  const termId = p => { try { return decodeURIComponent(p.slice(10)); } catch { return p.slice(10); } };   // tmux pane ids (%0) arrive encoded
  const body = (req, max = 2e6) => new Promise(res => { let b = ''; req.on('data', c => { b += c; if (b.length > max) req.destroy(); }); req.on('end', () => { try { res(JSON.parse(b || '{}')); } catch { res({}); } }); });
  const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
  const sse = res => { res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' }); res.write('retry: 2000\n\n'); };
  const send = (res, ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);

  async function handle(req, res) {
    const u = new URL(req.url, 'http://x'), p = u.pathname;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'GET' && STATIC[p]) {
      const hot = ctx.hotRoot && ctx.hotRoot(), f = path.join(hot && fs.existsSync(path.join(hot, STATIC[p])) ? hot : ctx.root, STATIC[p]);   // a UI-only update, loaded in place
      fs.readFile(f, (err, data) => {
        if (err) { res.writeHead(404); return res.end(); }
        if (/\.(html|js)$/.test(f) && /index\.html$|app-name\.js$/.test(f)) data = Buffer.from(String(data).split('Mesh for Claude Code').join(APP_NAME));   // the configured name
        res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(data);
      });
      return;
    }
    const tok = u.searchParams.get('t') || req.headers['x-mesh-token'];
    if (p === '/manifest.webmanifest') {      // start_url carries the token so the home-screen app is paired
      if (!okToken(tok)) { res.writeHead(401); return res.end(); }
      res.writeHead(200, { 'Content-Type': MIME['.webmanifest'] });
      return res.end(JSON.stringify({ name: APP_NAME, short_name: 'Mesh', id: '/', scope: '/', start_url: '/?t=' + cfg.token, display: 'standalone', background_color: '#000000', theme_color: '#000000',
        icons: [{ src: '/apple-touch-icon.png', sizes: '1024x1024', type: 'image/png' }] }));
    }
    if (!p.startsWith('/api/')) { res.writeHead(404); return res.end(); }
    if (!okToken(tok)) return json(res, 401, { error: 'not paired — scan the QR code in ' + APP_NAME + ' on your Mac (or pair with the server link)' });

    if (p === '/api/events' && req.method === 'GET') {
      sse(res); const c = { res }; clients.add(c);
      const s = view(ctx.getSnap()); if (s) send(res, 'telemetry', s);
      req.on('close', () => clients.delete(c)); return;
    }
    if (p === '/api/local-snapshot') { peerPolledAt = Date.now(); const snapNow = ctx.getSnap(); if (!snapNow) return json(res, 503, { error: 'starting' }); return json(res, 200, { ...snapNow, caps: ['upload', 'resize'] }); }   // caps: what this build accepts from the peer   // for the peer (never merged)
    if (p === '/api/history') return json(res, 200, await ctx.getHistory());
    if ((p === '/api/archify' || p === '/api/archify/html') && ctx.archify && req.method === 'GET') {     // Archify diagrams, for the other Mac (archify.js)
      const sid = u.searchParams.get('sid') || '';
      return json(res, 200, await (p === '/api/archify' ? ctx.archify.status(sid) : ctx.archify.html(sid)));
    }
    if (p === '/api/details') {
      const sid = u.searchParams.get('sid') || '';
      if (remote(sid)) return json(res, 200, await peer.forward('GET', '/api/details', undefined, { sid }).catch(e => ({ ok: false, err: 'Couldn\'t reach the other Mac: ' + e.message })));
      return json(res, 200, await ctx.details(sid));
    }
    if (p === '/api/ollama-status') return json(res, 200, await require('./ollama-engine').status());
    if (p === '/api/ollama-credits') return json(res, 200, await require('./ollama-engine').credits());
    if (p === '/api/folders' && ctx.folders) return json(res, 200, { folders: ctx.folders() });          // for the other Mac's folder buttons
    if (p === '/api/folder-here' && ctx.folderHere) return json(res, 200, { here: !!ctx.folderHere(u.searchParams.get('rel') || '') });
    if (p === '/api/usage' && ctx.usage) return json(res, 200, await ctx.usage.dash());                  // token usage (usage-main.js)
    if (p === '/api/usage/rows' && ctx.usage) return json(res, 200, await ctx.usage.rows(+u.searchParams.get('since') || 0));
    if (p === '/api/usage/session' && req.method === 'GET' && ctx.usage) { const sids = (u.searchParams.get('sids') || '').split(',').filter(Boolean); return json(res, 200, await ctx.usage.sessionLocal(sids)); }
    if (p === '/api/cards') return json(res, 200, ctx.cards ? await ctx.cards.summary() : {});          // project cards (project-cards.js)
    if (p === '/api/card') { const sid = u.searchParams.get('sid') || ''; if (remote(sid)) return json(res, 200, await peer.forward('GET', '/api/card', undefined, { sid, ...(u.searchParams.get('force') === '1' ? { force: '1' } : {}) }, 20000).catch(() => null)); return json(res, 200, ctx.cards ? await ctx.cards.get(sid, u.searchParams.get('force') === '1') : null); }
    if (p === '/api/usage/session' && req.method === 'POST' && ctx.usage) { const b = await body(req); return json(res, 200, await ctx.usage.session(b.list || [])); }
    if (p === '/api/usage/manual' && req.method === 'POST' && ctx.usage) { const b = await body(req); await ctx.usage.setManual(b.pct); return json(res, 200, { ok: true }); }
    if (p === '/api/card/ask' && req.method === 'POST') { const b = await body(req); return json(res, 200, ctx.cards ? { ok: true, r: await ctx.cards.ask(String(b.sid || '')) } : { ok: false }); }
    if (p === '/api/stamps') {                                          // when each prompt / reply was made
      const sid = u.searchParams.get('sid') || '';
      if (remote(sid)) return json(res, 200, await peer.forward('GET', '/api/stamps', undefined, { sid }).catch(() => []));
      return json(res, 200, ctx.stamps ? await ctx.stamps(sid) : []);
    }
    if (p === '/api/orchestrator' && req.method === 'GET' && ctx.orchestrator) return json(res, 200, ctx.orchestrator.get(u.searchParams.get('cwd') || '~'));   // which agent runs a project (main.js)
    if (p === '/api/refresh' && req.method === 'GET' && ctx.refresh) return json(res, 200, ctx.refresh.get());   // session refresh (session-refresh.js)
    if (p === '/api/commands') return json(res, 200, await ctx.commandsFor(u.searchParams.get('cwd') || ''));
    if (p.startsWith('/api/term/') && req.method === 'GET') {           // live terminal of an in-app session
      const id = termId(p);
      if (peer && peer.ownsTerm(id)) return peer.pipeTerm(id, res, fn => req.on('close', fn)).catch(e => json(res, 502, { error: e.message }));
      const pt = ctx.ptys.get(id); if (!pt) return json(res, 404, { error: 'no such terminal' });
      sse(res);
      const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { } }, 15e3);   // lets the other side see a dead connection (peer.js watchStream)
      req.on('close', () => clearInterval(ping));
      if (ctx.termOpen) await ctx.termOpen(id);                           // server: start streaming the tmux pane
      // listen first and hold output back until init went out, so nothing falls between the snapshot and the stream
      let held = [];
      const on = (pid, d, seq) => { if (pid === id) held ? held.push({ d, seq }) : send(res, 'data', d); }, off = pid => { if (pid === id) send(res, 'exit', {}); };
      const sz = (pid, cols, rows) => { if (pid === id) held ? held.push({ size: { cols, rows } }) : send(res, 'size', { cols, rows }); };   // the terminal was resized on the host
      ctx.ptyBus.on('data', on); ctx.ptyBus.on('exit', off); ctx.ptyBus.on('resize', sz);
      const snap = ctx.termSnapshot ? await ctx.termSnapshot(id).catch(() => null) : null;     // Mac app: the window's exact screen
      const screen = snap && typeof snap === 'object' ? snap.screen : snap, upto = (snap && snap.seq) || 0;
      send(res, 'init', { cols: pt.proc.cols, rows: pt.proc.rows, backlog: screen != null ? screen : pt.buf || '' });
      // what the snapshot or backlog already holds must not play twice: repeated cursor moves land on the wrong lines
      for (const h of held) { if (h.size) send(res, 'size', h.size); else if (screen != null && !(h.seq <= upto)) send(res, 'data', h.d); } held = null;
      req.on('close', () => { ctx.ptyBus.off('data', on); ctx.ptyBus.off('exit', off); ctx.ptyBus.off('resize', sz); if (ctx.termClose) ctx.termClose(id); }); return;
    }
    if (p === '/api/handoff/file' && req.method === 'PUT') return ctx.handoff ? ctx.handoff.receiveFile(u.searchParams, req, res) : json(res, 404, {});   // a session moving here (handoff.js)
    if (req.method !== 'POST') return json(res, 405, {});
    const b = await body(req, p === '/api/upload' ? 40e6 : 2e6);
    if (p === '/api/upload') {                                           // a file pasted/dropped into the peer's mirror of our terminal
      // from the iPhone: the file belongs on the machine that runs the session / terminal it's attached to
      if ((b.sid && remote(b.sid)) || (b.term && peer && peer.ownsTerm(b.term)))
        return json(res, 200, await peer.upload(b.name, b.b64).catch(e => ({ ok: false, err: `${peer.label()}: ${e.message}` })));
      const name = path.basename(String(b.name || 'file')).replace(/[^\w.\- ]+/g, '_').slice(-80) || 'file';
      const dir = path.join(os.tmpdir(), 'claude-mesh-paste'); fs.mkdirSync(dir, { recursive: true });
      const f = path.join(dir, `${Date.now().toString(36)}-${name}`);
      fs.writeFileSync(f, Buffer.from(String(b.b64 || ''), 'base64'));
      return json(res, 200, { ok: true, path: f });
    }
    if (ctx.noteInput && (p === '/api/send' || p.startsWith('/api/term/'))) ctx.noteInput();
    if (['/api/send', '/api/interrupt', '/api/rename'].includes(p) && remote(b.sid))
      return json(res, 200, await peer.forward('POST', p, b).catch(e => ({ ok: false, err: `${peer.label()}: ${e.message}` })));
    if (p.startsWith('/api/term/') && peer && peer.ownsTerm(termId(p)))
      return json(res, 200, await (b.resize ? peer.termResize(termId(p), b.resize.cols, b.resize.rows) : peer.termWrite(termId(p), String(b.data || ''))).catch(() => ({ ok: false })));
    if (p === '/api/send') return json(res, 200, await ctx.sendToSession(b.sid, String(b.text || '')));
    if (p === '/api/interrupt') return json(res, 200, await ctx.interruptSession(b.sid));
    if (p === '/api/resume') {
      if (b.engine) {                                                    // only Mesh's own switch, the credits fallback, or Kevin's own request; always logged
        if (!/^(Mesh window|auto-credits|You asked|Kevin asked)/.test(String(b.by || ''))) return json(res, 403, { ok: false, err: 'engine switches come from Mesh' });
        if (ctx.logEngine) ctx.logEngine(b.sid, b.engine === 'ollama' ? b.ollamaModel : 'claude', String(b.by).slice(0, 120));
      }
      return json(res, 200, ctx.resumeOnMac(b.sid, b.engine ? { engine: b.engine, ollamaModel: b.ollamaModel } : undefined));
    }
    // move a session to the other Mac (handoff.js): run by whichever machine has it — from the phone or the peer
    if (p === '/api/handoff/move') {
      if (remote(b.sid)) return json(res, 200, await peer.forward('POST', p, b, undefined, 15 * 60e3).catch(e => ({ ok: false, err: `${peer.label()}: ${e.message}` })));
      return json(res, 200, ctx.handoff ? await ctx.handoff.move(b.sid) : { ok: false, err: 'not supported here' });
    }
    if (p === '/api/handoff/start') return json(res, 200, ctx.handoffStart ? await ctx.handoffStart(b) : { ok: false, err: 'not supported here' });
    if (p === '/api/refresh' && ctx.refresh) {
      if (b.now && remote(b.sid)) return json(res, 200, await peer.forward('POST', p, b, undefined, 60 * 60e3).catch(e => ({ ok: false, err: e.message })));
      if (b.rehearse) return json(res, 200, await ctx.refresh.rehearse(String(b.sid || '')));
      if (b.inventory) return json(res, 200, ctx.refresh.inventory());
      return json(res, 200, b.now ? await ctx.refresh.now(String(b.sid || '')) : ctx.refresh.set(b));
    }
    if (p === '/api/archify' && ctx.archify) return json(res, 200, await ctx.archify.op(String(b.sid || ''), String(b.op || '')));
    if (p === '/api/orchestrator' && ctx.orchestrator) return json(res, 200, ctx.orchestrator.set(String(b.cwd || ''), String(b.orchestrator || '')));
    if (p === '/api/hermes/new' && ctx.hermesNew) return json(res, 200, await ctx.hermesNew({ cwd: String(b.cwd || '~'), name: String(b.name || '').slice(0, 80), resumeSid: b.resumeSid ? String(b.resumeSid) : undefined }));   // a Hermes session in a tmux pane here
    if (p === '/api/rename') return json(res, 200, await ctx.rename(b.sid, String(b.name || '').slice(0, 120)));
    if (p === '/api/convert') return json(res, 200, await ctx.convert(b.sid, b.task || ''));
    if (p.startsWith('/api/term/')) {                                    // keystrokes from the phone's terminal
      const pt = ctx.ptys.get(termId(p)); if (!pt) return json(res, 404, {});
      if (b.resize) return json(res, 200, ctx.termResize ? ctx.termResize(termId(p), +b.resize.cols, +b.resize.rows) : { ok: false });   // the peer's window is in use: its size wins
      pt.proc.write(String(b.data || '')); return json(res, 200, { ok: true });
    }
    json(res, 404, {});
  }

  function start() {
    if (server) return;
    server = http.createServer((req, res) => handle(req, res).catch(e => { try { json(res, 500, { error: String(e.message || e) }); } catch { } }));
    server.on('error', e => { console.error('phone server', e.message); server = null; });
    server.listen(PORT, ctx.bind || '0.0.0.0');
  }
  function stop() { if (!server) return; for (const c of clients) try { c.res.end(); } catch { } clients.clear(); server.close(); server = null; }

  // addresses the phone can use: Wi-Fi/LAN and Tailscale (100.64.0.0/10)
  function urls() {
    const out = [];
    for (const [name, list] of Object.entries(os.networkInterfaces())) for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const ts = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a.address);
      if (ts || /^(en|bridge)/.test(name)) out.push({ kind: ts ? 'Tailscale (anywhere)' : 'Wi-Fi (same network)', url: `http://${a.address}:${PORT}/?t=${cfg.token}` });
    }
    return out.sort((a, b) => a.kind.localeCompare(b.kind)).reverse();
  }

  if (cfg.enabled && !ctx.passive) start();        // passive: a CLI run (--pair / --status) beside the running service
  return {
    alert(a) { for (const c of clients) try { send(c.res, 'alert', a); } catch { } },
    broadcast(snap) { if (!clients.size) return; const v = view(snap); for (const c of clients) try { send(c.res, 'telemetry', v); } catch { } },
    status: () => ({ enabled: cfg.enabled, running: !!server, port: PORT, urls: urls(), clients: clients.size,
                     peerWatching: Date.now() - peerPolledAt < 15000, peer: peer ? { online: peer.online(), label: peer.label() } : null }),
    setEnabled(v) { cfg.enabled = !!v; save(); v ? start() : stop(); },
    regenerate() { cfg.token = crypto.randomBytes(18).toString('base64url'); save(); for (const c of clients) try { c.res.end(); } catch { } clients.clear(); },
  };
}

module.exports = { createPhoneServer };
